/**
 * The ProSense cryoablation in the ultrasound room (docs/research/cryoablation.md): an ultrasound "exam" whose steps are a procedure
 * (place, freeze, thaw, freeze). `detail` is the ice ball's size carried across the steps, `activity` the cryogen flow. The demo
 * (`startDemoScan('us', 'us-cryo-breast')`) and the booked outpatient (op-19, 10:15) both run to the end and the patient goes home.
 */
import { describe, expect, it } from 'vitest'
import { OUTPATIENTS, outpatientTimeSeconds, protocolById } from '@/content/imaging'
import { presentationOf } from '@/content/roster'
import { CONFIG } from '../config'
import { clockText } from '../events'
import { Rng } from '../rng'
import { Simulation } from '../Simulation'
import { buildExam, CRYO, drawPlan, iceSize, isProcedure, scanningSeconds, stepOf } from './exam'
import { DEMO_PROCEDURES } from './department'

const DT = CONFIG.sim.step
const CRYO_ID = 'us-cryo-breast'
const proto = protocolById(CRYO_ID)
const who = { patientId: 'p', patientName: 'Test Patient' }

describe('the cryoablation protocol', () => {
  it('is an ultrasound procedure on the breast: place, freeze, thaw, freeze', () => {
    expect(proto.modality).toBe('us')
    expect(proto.bodyPart).toBe('breast')
    expect(proto.sequences.map(stepOf)).toEqual(['place', 'freeze', 'thaw', 'freeze'])
    expect(isProcedure(proto)).toBe(true)
    expect(isProcedure(protocolById('us-abdo'))).toBe(false)
    // a real ProSense breast procedure is 30-45 minutes; the sim's (compressed) steps are about 20 minutes
    const total = proto.sequences.reduce((t, s) => t + s.seconds, 0)
    expect(total).toBeGreaterThanOrEqual(15 * 60)
    expect(total).toBeLessThanOrEqual(30 * 60)
  })

  it('is a demo procedure of the ultrasound room only', () => {
    expect(DEMO_PROCEDURES.us).toContain(CRYO_ID)
    for (const m of ['mri', 'ct', 'xray'] as const) expect(DEMO_PROCEDURES[m] ?? []).not.toContain(CRYO_ID)
  })
})

describe('the ice ball (iceSize)', () => {
  const seqs = proto.sequences
  const at = (i: number, p: number) => iceSize(seqs, i, p)

  it('is 0 before the procedure and through the probe placement', () => {
    expect(at(-1, 0)).toBe(0)
    for (let k = 0; k <= 10; k++) expect(at(0, k / 10)).toBe(0)
  })

  it('grows through each freeze, eases back a little in the thaw, and is full size at the end of the second freeze', () => {
    for (const i of [1, 3]) {
      for (let k = 1; k <= 100; k++) expect(at(i, k / 100), `freeze ${i} at ${k}%`).toBeGreaterThan(at(i, (k - 1) / 100))
    }
    for (let k = 1; k <= 100; k++) expect(at(2, k / 100), `thaw at ${k}%`).toBeLessThanOrEqual(at(2, (k - 1) / 100))
    expect(at(1, 1)).toBeCloseTo(CRYO.firstFreezeSize, 6)
    expect(at(2, 0)).toBeCloseTo(at(1, 1), 6)
    expect(at(2, 1)).toBeCloseTo(CRYO.firstFreezeSize * CRYO.thawKeep, 6)
    expect(at(3, 0)).toBeCloseTo(at(2, 1), 6)
    expect(at(3, 1)).toBeCloseTo(1, 6)
    // carried across the steps: no jumps at the boundaries, and it never leaves 0..1
    for (let i = 0; i < seqs.length; i++) for (let k = 0; k <= 20; k++) expect(at(i, k / 20)).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < seqs.length; i++) for (let k = 0; k <= 20; k++) expect(at(i, k / 20)).toBeLessThanOrEqual(1)
  })
})

describe('the cryoablation plan', () => {
  it('has a consent and local-anaesthetic talk, skin prep and a dressing, longer than a scan; the demo patient keeps the anaesthetic', () => {
    const exam = buildExam('e', proto, who, 'outpatient', 1)
    const scan = buildExam('s', protocolById('us-renal'), who, 'outpatient', 1)
    const [e0, e1] = CONFIG.imaging.explainSeconds.us
    const [p0] = CONFIG.imaging.positioningSeconds.us
    for (let seed = 1; seed <= 50; seed++) {
      const plan = drawPlan(new Rng(seed), exam, { demo: false, transported: false })
      expect(plan.explainS).toBeGreaterThanOrEqual(e0 * CRYO.explainFactor)
      expect(plan.explainS).toBeLessThanOrEqual(e1 * CRYO.explainFactor)
      expect(plan.positionS).toBeGreaterThanOrEqual(p0 * CRYO.positionFactor)
      expect(plan.cleanupS).toBeGreaterThan(drawPlan(new Rng(seed), scan, { demo: false, transported: false }).cleanupS)
      expect(plan.gapS).toHaveLength(exam.sequences.length - 1)
      const demo = drawPlan(new Rng(seed), exam, { demo: true, transported: false })
      expect(demo.explainS).toBeGreaterThan(0)
      expect(demo.explainS).toBeLessThan(plan.explainS)
    }
    // the booked visit (call, talk, positioning, the four steps, the dressing) fits the ultrasound's slot before the 11:00 booking
    const plan = drawPlan(new Rng(3), exam, { demo: false, transported: false })
    expect(plan.explainS + plan.positionS + scanningSeconds(exam, plan) + plan.cleanupS).toBeLessThan(40 * 60)
  })
})

interface Sample {
  step: string
  seq: number
  progress: number
  detail: number
  activity: number
  phase: string
}

/** The event-log lines of a run (the log keeps only the latest events, so they are collected as the run goes). */
const logs = new WeakMap<Simulation, { last: number; texts: string[] }>()
const logOf = (sim: Simulation): string[] => logs.get(sim)?.texts ?? []

/** Run until `until` holds (or the time limit), sampling the ultrasound every step. */
function runUs(sim: Simulation, until: (s: Simulation) => boolean, limitS: number, samples: Sample[]): void {
  const sc = sim.imaging.machines.us
  let log = logs.get(sim)
  if (!log) logs.set(sim, (log = { last: -1, texts: [] }))
  for (let i = 0, n = Math.round(limitS / DT); i < n && !until(sim); i++) {
    sim.step(DT)
    for (const e of sim.log.since(log.last)) {
      log.texts.push(e.text)
      log.last = e.id
    }
    const st = sc.state
    samples.push({ step: sc.session?.step ?? 'idle', seq: st.sequence, progress: st.progress, detail: st.detail, activity: st.activity, phase: st.phase })
  }
}

/** Checks the ScannerState the scene reads over a whole cryoablation. */
function checkProcedure(samples: Sample[]): void {
  const scan = samples.filter((s) => s.step === 'scan')
  expect(new Set(scan.map((s) => s.seq))).toEqual(new Set([0, 1, 2, 3]))
  // the phases in order: prep, positioning, scanning, cleanup, idle
  const phases: string[] = []
  for (const s of samples) if (phases.at(-1) !== s.phase) phases.push(s.phase)
  expect(phases.filter((p) => p !== 'idle')).toEqual(['prep', 'positioning', 'scanning', 'cleanup'])
  for (let i = 1; i < scan.length; i++) {
    const a = scan[i - 1]
    const b = scan[i]
    if (a.seq !== b.seq) continue
    expect(b.progress, `progress in step ${b.seq}`).toBeGreaterThanOrEqual(a.progress)
    const kind = stepOf(proto.sequences[b.seq])
    if (kind === 'freeze') expect(b.detail, `ice in freeze ${b.seq}`).toBeGreaterThanOrEqual(a.detail)
    if (kind === 'thaw') expect(b.detail, 'ice in the thaw').toBeLessThanOrEqual(a.detail)
    if (kind === 'place') {
      expect(b.detail).toBe(0)
      expect(b.activity).toBeLessThanOrEqual(CRYO.placeActivity + 1e-9)
    }
    // the cryogen flows while freezing (after its ramp), and is off by the end of the thaw
    if (kind === 'freeze' && b.progress > 0.1) expect(b.activity, `flow in freeze ${b.seq}`).toBeGreaterThan(0.99)
    if (kind === 'thaw' && b.progress > 0.2) expect(b.activity, 'flow in the thaw').toBeLessThan(0.01)
  }
  const endOf = (seq: number) => scan.filter((s) => s.seq === seq).at(-1)!
  expect(endOf(1).detail).toBeCloseTo(CRYO.firstFreezeSize, 2)
  expect(endOf(2).detail).toBeCloseTo(CRYO.firstFreezeSize * CRYO.thawKeep, 2)
  expect(endOf(3).progress).toBeCloseTo(1, 3)
  expect(endOf(3).detail).toBeCloseTo(1, 3)
  // full size at the end, and held through the dressing
  const cleanup = samples.filter((x) => x.phase === 'cleanup')
  expect(cleanup.length).toBeGreaterThan(0)
  for (const s of cleanup) expect(s.detail).toBe(1)
}

const ofDemo = (sim: Simulation) => sim.people.filter((p) => p.entity.id.startsWith('demo'))

describe('the demo cryoablation in the ultrasound room', () => {
  function demoDay(seed: number): { sim: Simulation; samples: Sample[]; name: string; age: number; trace: string } {
    const sim = new Simulation(seed, { startHour: 10, inFlight: false })
    expect(sim.imaging.startDemoScan('us', CRYO_ID)).toBe(true)
    const samples: Sample[] = []
    runUs(sim, () => ofDemo(sim).length > 0, 30, samples)
    const person = sim.imaging.outpatients.find((o) => o.id.startsWith('demo'))!
    expect(person).toBeDefined()
    const name = person.name
    const age = person.age
    const sc = sim.imaging.machines.us
    // the demo goes to the front of the queue: the procedure starts, runs and the scanner is released
    runUs(sim, (s) => s.imaging.released.us > 0 && sc.state.phase === 'idle' && s.imaging.exams.some((e) => e.protocol === proto.name), 60 * 60, samples)
    const trace = samples.filter((_, i) => i % 120 === 0).map((s) => `${s.step}${s.seq} ${s.progress.toFixed(4)} ${s.detail.toFixed(4)} ${s.activity.toFixed(3)}`).join(';')
    return { sim, samples, name, age, trace }
  }

  it('runs the four steps with the ice ball and the cryogen flow, then she gets dressed and goes home', { timeout: 600_000 }, () => {
    const { sim, samples, name, age } = demoDay(7)
    // a woman of 70 or more (the FDA indication): her first name is from the female pool, so her avatar is a woman
    expect(presentationOf(name), name).toBe('female')
    expect(age).toBeGreaterThanOrEqual(70)
    const exam = sim.imaging.exams.find((e) => e.protocol === proto.name)!
    expect(exam.source).toBe('demo')
    expect(exam.bodyPart).toBe('breast')
    expect(exam.sequences.map((s) => s.step)).toEqual(['place', 'freeze', 'thaw', 'freeze'])
    checkProcedure(samples.slice(samples.findIndex((s) => s.phase !== 'idle')))
    expect(sim.imaging.finished.us).toBeGreaterThanOrEqual(1)
    expect(sim.imaging.stuckFixes, sim.imaging.stuckLog.join('; ')).toBe(0)
    // she walks out: gone from the sim within a few minutes
    runUs(sim, (s) => ofDemo(s).length === 0, 8 * 60, [])
    expect(ofDemo(sim)).toEqual([])
    // the log tells the story
    const log = logOf(sim).join('\n')
    expect(log).toMatch(/local anaesthetic/)
    expect(log).toMatch(/liquid nitrogen is flowing/)
    expect(log).toMatch(/thaw/)
    expect(log).toMatch(/dressing/)
  })

  it('is deterministic: the same seed replays the same procedure', { timeout: 600_000 }, () => {
    const a = demoDay(11)
    const b = demoDay(11)
    expect(a.name).toBe(b.name)
    expect(a.trace).toBe(b.trace)
  })

  it('books only a demo procedure of that room, and leaves the default demo of every room as it was', { timeout: 120_000 }, () => {
    const sim = new Simulation(7, { startHour: 10, inFlight: false })
    expect(sim.imaging.startDemoScan('us', 'mri-brain')).toBe(false)
    expect(sim.imaging.startDemoScan('mri', CRYO_ID)).toBe(false)
    expect(sim.imaging.startDemoScan('us', 'no-such-protocol')).toBe(false)
    expect(sim.imaging.bookings.filter((b) => b.kind === 'demo')).toEqual([])
    expect(sim.imaging.startDemoScan('us')).toBe(true)
    expect(sim.imaging.startDemoScan('mri')).toBe(true)
    expect(sim.imaging.bookings.filter((b) => b.kind === 'demo').map((b) => b.protocolId)).toEqual(['us-abdo', 'mri-brain'])
  })
})

describe('the booked cryoablation (op-19)', () => {
  it('runs in the 10:15 ultrasound slot, and she goes home', { timeout: 600_000 }, () => {
    const o = OUTPATIENTS.find((x) => x.protocol === CRYO_ID)!
    expect(o).toBeDefined()
    const sim = new Simulation(7, { startHour: 9.75, inFlight: false })
    const samples: Sample[] = []
    const gone = (s: Simulation) => s.imaging.bookings.some((b) => b.patientId === o.id && b.state === 'done') && !s.people.some((p) => p.entity.id === o.id)
    runUs(sim, gone, 90 * 60, samples)
    const b = sim.imaging.bookings.find((x) => x.patientId === o.id)!
    expect(b.state).toBe('done')
    expect(gone(sim)).toBe(true)
    // her samples: from the start of her exam to its end
    const exam = sim.imaging.exams.find((e) => e.patientId === o.id)!
    expect(exam.sequences.map((s) => s.step)).toEqual(['place', 'freeze', 'thaw', 'freeze'])
    // she is taken at her slot (not before, give or take her early arrival) and the room is free again before the 11:00 booking
    const began = samples.findIndex((x) => x.step === 'scan')
    expect(began).toBeGreaterThan(0)
    const lastStep = sim.t
    const firstStep = lastStep - (samples.length - began) * DT
    expect(firstStep, clockText(firstStep)).toBeGreaterThan(outpatientTimeSeconds(o) - 15 * 60)
    expect(sim.imaging.machines.us.session?.booking.patientId).not.toBe(o.id)
    expect(lastStep, clockText(lastStep)).toBeLessThan(outpatientTimeSeconds({ ...o, time: '11:00' }))
    expect(sim.imaging.stuckFixes, sim.imaging.stuckLog.join('; ')).toBe(0)
    expect(logOf(sim).some((t) => t.includes(`cryoablation for ${o.name} is finished`))).toBe(true)
  })
})
