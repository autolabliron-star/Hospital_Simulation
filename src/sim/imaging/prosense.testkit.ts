/**
 * Shared harness of the ProSense tests (prosense*.test.ts): run one cryoablation case in the ultrasound room, in the living day (the demo, real
 * windows) or in watch mode, and trace the step engine's view, the two people and the patient every tick.
 */
import { expect } from 'vitest'
import { presentationOf } from '@/content/roster'
import { IMAGING_STAFF } from '@/content/staff'
import { anchorSpot, compiledFor, midSeconds } from '../procedure'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'
import type { ProcAnchor, ProcedureId } from '../types'

export const DT = CONFIG.sim.step

export interface StepTrace {
  flat: number
  index: number
  id: string
  unit: string
  /** Sim time the step first showed, and the step's published window. */
  at: number
  since: number
  ends: number
  /** Per role (breastRadiologist, sonographer): its anchor at the step, and the seconds after the step began it was first within 0.5 m (null: never). */
  anchor: (ProcAnchor | null)[]
  reached: (number | null)[]
}

export interface CaseTrace {
  seed: number
  protocol: string
  procedureId: ProcedureId
  watch: boolean
  steps: StepTrace[]
  /** Sim time the view first showed a step, and the last tick it did. */
  from: number
  to: number
  /** Ticks in which the patient carried the view's pose / was on the couch / had it while not on the couch. */
  posedTicks: number
  onCouchTicks: number
  wrongPoseTicks: number
  /** The patientPose was null again after the case. */
  poseClearedAfter: boolean
  stuck: string[]
  name: string
  age: number
  relocate: boolean
  /** The view was empty (and no one carried its pose) before the press and after the case, on every scanner. */
  emptyBefore: boolean
  emptyAfter: boolean
  /** The event log of the run, in order, and every scanner's view `procedureId` seen non-null in a scanner other than the ultrasound. */
  lines: string[]
  otherScannersNonEmpty: number
  /** Seconds after the case ended until the radiologist had left the simulation (null: still there when the run stopped). */
  doctorGoneAfter: number | null
  doctorEntityId: string | null
  /** The sonographer sat back down (she is at her station and the view's roles are idle). */
  sonographerHome: boolean
}

const near = (x: number, z: number, anchor: ProcAnchor): boolean => {
  const s = anchorSpot(anchor)
  return Math.hypot(x - s.at.x, z - s.at.z) < 0.5
}

/**
 * Run a case to the end. `watch` presses "Watch step by step"; otherwise the usual demo button (real windows). The case ends when the scanner has
 * been released and is idle again with the case's exam done.
 */
export function runCase(seed: number, protocol: string, watch: boolean, opts: { startHour?: number; limitS?: number } = {}): CaseTrace {
  const sim = new Simulation(seed, { startHour: opts.startHour ?? 10, inFlight: false })
  const img = sim.imaging
  const allEmpty = (): boolean => (['mri', 'ct', 'xray', 'us'] as const).every((m) => img.scanners[m].procedure.procedureId === null)
  const emptyBefore = allEmpty()
  const pressed = watch ? img.startDemoScan('us', protocol, { watch: true }) : img.startDemoScan('us', protocol)
  if (!pressed) throw new Error(`the press was refused (${protocol}, watch ${watch})`)
  const sc = img.machines.us
  const view = sc.state.procedure
  const procId = (view.procedureId ?? (protocol === 'us-cryo-breast' ? 'us-breastCancer' : 'us-fibroadenoma')) as ProcedureId
  const steps: StepTrace[] = []
  let last = -1
  let from = -1
  let to = -1
  let posedTicks = 0
  let onCouchTicks = 0
  let wrongPoseTicks = 0
  let cur: StepTrace | null = null
  let name = ''
  let age = 0
  let ran = false
  const limit = Math.round((opts.limitS ?? (watch ? 1500 : 4200)) / DT)
  let finished = false
  const lines: string[] = []
  let lastLog = -1
  let otherNon = 0
  for (let i = 0; i < limit && !finished; i++) {
    sim.step(DT)
    const t = sim.t
    for (const e of sim.log.since(lastLog)) {
      lines.push(e.text)
      lastLog = e.id
    }
    for (const m of ['mri', 'ct', 'xray'] as const) if (img.scanners[m].procedure.procedureId !== null) otherNon++
    if (view.procedureId !== null) {
      ran = true
      if (from < 0) from = t
      to = t
      if (view.stepIndex !== last) {
        last = view.stepIndex
        cur = { flat: view.stepIndex, index: -1, id: view.stepId, unit: view.unit, at: t, since: view.stepSince, ends: view.stepEnds, anchor: [null, null], reached: [null, null] }
        steps.push(cur)
      }
      if (cur !== null) {
        cur.ends = view.stepEnds
        const doc = img.radiologist
        const who = [doc, sc.operator]
        for (let r = 0; r < 2; r++) {
          const a = view.roles[r]?.anchor ?? null
          if (cur.anchor[r] === null) cur.anchor[r] = a
          const e = who[r]
          if (a !== null && e !== null && cur.reached[r] === null && near(e.x, e.z, a)) cur.reached[r] = t - cur.at
        }
      }
      const person = img.outpatients.find((o) => o.booking.patientId === sc.session?.booking.patientId)
      if (person) {
        if (name === '') {
          name = person.name
          age = person.age
        }
        const onCouch = person.seat === sc.sites.tableSeat
        if (onCouch) onCouchTicks++
        if (person.entity.patientPose === view.patient) {
          posedTicks++
          if (!onCouch) wrongPoseTicks++
        }
      }
    }
    if (ran && view.procedureId === null && sc.state.phase === 'idle' && sc.session === null) finished = true
  }
  const endT = sim.t
  const doctorId = img.radiologist?.entity.id ?? null
  let doctorGone: number | null = img.radiologist === null ? 0 : null
  for (let i = 0; i < Math.round(90 / DT) && doctorGone === null; i++) {
    sim.step(DT)
    if (img.radiologist === null) doctorGone = sim.t - endT
  }
  for (const e of sim.log.since(lastLog)) lines.push(e.text)
  const person = img.outpatients.find((o) => o.id.startsWith('demo'))
  const cleared = person === undefined ? true : person.entity.patientPose == null
  const exam = img.exams.find((e) => e.protocol.toLowerCase().includes(protocol === 'us-cryo-breast' ? 'cryoablation, left' : 'fibroadenoma'))
  const relocate = exam !== undefined && exam.sequences.length > 4
  const cs = compiledFor(procId)
  if (cs !== undefined) {
    for (const st of steps) st.index = cs.script.steps.findIndex((s) => s.id === st.id)
  }
  return {
    seed,
    protocol,
    procedureId: procId,
    watch,
    steps,
    from,
    to,
    posedTicks,
    onCouchTicks,
    wrongPoseTicks,
    poseClearedAfter: cleared,
    stuck: [...img.stuckLog],
    name,
    age,
    relocate,
    emptyBefore,
    emptyAfter: allEmpty(),
    lines,
    otherScannersNonEmpty: otherNon,
    doctorGoneAfter: doctorGone,
    doctorEntityId: doctorId,
    sonographerHome: sc.operator !== null && sc.operator.isAtStation(),
  }
}

/** The steps a case plays, in order: the whole script, without the probe move when the case has none. */
export function expectedSteps(c: CaseTrace): string[] {
  const cs = compiledFor(c.procedureId)!
  return cs.script.steps.filter((s) => c.relocate || (s.unit !== 'relocate' && s.unit !== 'freeze3')).map((s) => s.id)
}

/** What every case must satisfy, in the day and in watch mode (the label names the seed and the mode). */
export function expectCase(c: CaseTrace): void {
  const label = `${c.protocol} seed ${c.seed} ${c.watch ? 'watch' : 'day'}`
  const cs = compiledFor(c.procedureId)!
  expect(c.stuck, label).toEqual([])
  expect(c.emptyBefore, `${label}: empty view before`).toBe(true)
  expect(c.emptyAfter, `${label}: empty view after`).toBe(true)
  expect(c.otherScannersNonEmpty, `${label}: other scanners`).toBe(0)
  // every script step visited, in order, none twice
  expect(c.steps.map((s) => s.id), `${label}: the steps`).toEqual(expectedSteps(c))
  // the steps tile their unit exactly; a unit begins where the last one ended (the walk in may hold a moment, never begin early)
  for (let i = 1; i < c.steps.length; i++) {
    const a = c.steps[i - 1]
    const b = c.steps[i]
    if (a.unit === b.unit) {
      // (the unit `arrive` follows the patient, day and watch: `patientArrives` ends when she starts changing, wherever the plan had put it; every other step tiles exactly)
      // (early: before the planned end; late: the step ran on to a tick before the next began)
      if (b.id === 'changeGown') expect(b.since, `${label}: ${a.id} -> ${b.id}`).toBeLessThanOrEqual(a.ends + 0.05)
      else expect(Math.abs(b.since - a.ends), `${label}: ${a.id} -> ${b.id}`).toBeLessThan(1e-6)
    } else {
      expect(b.since - a.ends, `${label}: ${a.id} -> ${b.id} (units)`).toBeGreaterThanOrEqual(-0.05)
      expect(b.since - a.ends, `${label}: ${a.id} -> ${b.id} (units)`).toBeLessThan(6)
    }
  }
  // both people at their anchors within 20 s of a step's start (the sonographer fetches the patient in the unit `arrive`: there by its end)
  for (const st of c.steps) {
    for (let r = 0; r < 2; r++) {
      if (st.anchor[r] === null) continue
      const got = st.reached[r]
      expect(got, `${label}: ${st.id} role ${r} (${st.anchor[r]}) never arrived`).not.toBeNull()
      const limit = r === 1 && st.unit === 'arrive' ? st.ends - st.since + 0.1 : 20
      expect(got!, `${label}: ${st.id} role ${r} (${st.anchor[r]}) took ${got}`).toBeLessThanOrEqual(limit)
    }
  }
  // the patient carries the view's pose exactly while she lies on the couch, and not otherwise
  expect(c.posedTicks, `${label}: posed`).toBeGreaterThan(60)
  expect(c.wrongPoseTicks, `${label}: posed off the couch`).toBe(0)
  // (the people move after the scanner steps: she carries it from the tick after she lands on the couch)
  expect(c.onCouchTicks - c.posedTicks, `${label}: posed whenever on the couch`).toBeGreaterThanOrEqual(0)
  expect(c.onCouchTicks - c.posedTicks, `${label}: posed whenever on the couch`).toBeLessThanOrEqual(2)
  expect(c.poseClearedAfter, `${label}: pose cleared`).toBe(true)
  // the people: a woman of the right age, the radiologist gone and the sonographer back at her station
  expect(presentationOf(c.name), `${label}: ${c.name}`).toBe('female')
  if (c.protocol === 'us-cryo-breast') {
    expect(c.age).toBeGreaterThanOrEqual(70)
    expect(c.age).toBeLessThanOrEqual(82)
  } else {
    expect(c.age).toBeGreaterThanOrEqual(20)
    expect(c.age).toBeLessThanOrEqual(45)
  }
  expect(c.doctorEntityId, label).toBe(IMAGING_STAFF[0].id)
  expect(c.doctorGoneAfter, `${label}: the radiologist leaves`).not.toBeNull()
  expect(c.doctorGoneAfter!, `${label}: the radiologist leaves`).toBeLessThan(60)
  expect(c.sonographerHome, `${label}: the sonographer is back`).toBe(true)
  // the log tells it: the WHO pauses, the anaesthetic, the nitrogen, the dressing, and the end
  const log = c.lines.join('\n')
  const timeOut = log.indexOf('Time Out: the team has confirmed the patient, the side and the plan.')
  const local = log.indexOf('numbed with local anaesthetic')
  const dressing = log.indexOf('A small dressing is put on the probe site')
  const signOut = log.indexOf('Sign Out: the treatment is recorded')
  expect(timeOut, `${label}: Time Out`).toBeGreaterThanOrEqual(0)
  expect(local, `${label}: local anaesthetic`).toBeGreaterThan(timeOut)
  expect(log, label).toMatch(/liquid nitrogen is flowing/)
  expect(dressing, `${label}: dressing`).toBeGreaterThan(local)
  expect(signOut, `${label}: Sign Out`).toBeGreaterThan(dressing)
  expect(log, label).toContain(`The cryoablation for ${c.name} is finished`)
  void cs
}

/** Watch mode: every step lasts its watch seconds, and the case as a whole their sum. */
export function expectWatchLengths(c: CaseTrace): void {
  const label = `${c.protocol} seed ${c.seed} watch`
  const cs = compiledFor(c.procedureId)!
  const secs = new Map(cs.script.steps.map((s) => [s.id, s.watchSeconds]))
  let total = 0
  c.steps.forEach((st, i) => {
    const len = i + 1 < c.steps.length ? c.steps[i + 1].at - st.at : st.ends - st.since
    // (the unit `arrive` follows the patient: the gown step is exactly her 30 s, the walks before and after it take what they take, and the unit keeps its length: below)
    const follows = st.unit === 'arrive' && st.id !== 'changeGown'
    if (!follows) {
      expect(Math.abs(len - secs.get(st.id)!), `${label}: ${st.id} lasted ${len}, its watch seconds are ${secs.get(st.id)}`).toBeLessThan(0.05)
      expect(Math.abs(st.ends - st.since - secs.get(st.id)!), `${label}: ${st.id} window`).toBeLessThan(1e-6)
    }
    total += secs.get(st.id)!
  })
  const arrive = c.steps.filter((st) => st.unit === 'arrive')
  const after = c.steps[c.steps.indexOf(arrive.at(-1)!) + 1]
  const arriveSeconds = arrive.reduce((t, st) => t + secs.get(st.id)!, 0)
  expect(Math.abs(after.at - arrive[0].at - arriveSeconds), `${label}: the unit arrive keeps its length`).toBeLessThan(0.1)
  expect(Math.abs(arrive.at(-1)!.ends - arrive[0].since - arriveSeconds), `${label}: the unit arrive's window`).toBeLessThan(1e-6)
  // (the exam ends a moment after the last step's window: the patient has to be off the couch)
  expect(c.to - c.from - total, `${label}: the whole case`).toBeGreaterThanOrEqual(-0.05)
  expect(c.to - c.from - total, `${label}: the whole case`).toBeLessThan(1)
  expect(total).toBeGreaterThanOrEqual(600)
  expect(total).toBeLessThanOrEqual(900)
}

/** The living day: a step's share of its unit is the middle of its real-minute band, to within the seeded jitter. */
export function expectDayWeights(c: CaseTrace): void {
  const label = `${c.protocol} seed ${c.seed} day`
  const cs = compiledFor(c.procedureId)!
  const mid = new Map(cs.script.steps.map((s) => [s.id, midSeconds(s)]))
  const len = (i: number) => (i + 1 < c.steps.length && c.steps[i + 1].unit === c.steps[i].unit ? c.steps[i + 1].at - c.steps[i].at : c.steps[i].ends - c.steps[i].since)
  for (let i = 0; i < c.steps.length; i++) {
    // (the unit `arrive` follows the patient in the day: its steps' lengths are what she does, not the weights)
    if (c.steps[i].unit === 'arrive') continue
    for (let j = i + 1; j < c.steps.length && c.steps[j].unit === c.steps[i].unit; j++) {
      const want = mid.get(c.steps[i].id)! / mid.get(c.steps[j].id)!
      const got = len(i) / len(j)
      // each weight is jittered by up to +-15%: the ratio of two stays within 1.35 of the ratio of the middles
      expect(got / want, `${label}: ${c.steps[i].id} / ${c.steps[j].id}`).toBeGreaterThan(1 / 1.4)
      expect(got / want, `${label}: ${c.steps[i].id} / ${c.steps[j].id}`).toBeLessThan(1.4)
    }
  }
}
