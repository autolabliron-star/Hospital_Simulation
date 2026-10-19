/**
 * The lab inside the real Simulation: a morning of orders (the draw centre's curve for outpatients, STAT ER orders, pre-scan creatinine) and
 * the ward's own samples, from 07:30 to 12:30, then drained until 14:00. Orders are injected with lab.order + lab.send the way the draw
 * centre does it (a tube every 12 s).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { analyserOf, testById } from '@/content/lab'
import { CONFIG } from '../config'
import { timeAtHour } from '../population/schedule'
import { LAB } from '../places'
import { Simulation } from '../Simulation'
import type { LabOrder } from '../types'
import { Driver, run, tatMinutes } from './testkit'

const CFG = CONFIG.lab
const SEED = 7
const SCIENTIST = 'Scientist Arjun'

interface Morning {
  sim: Simulation
  driver: Driver
  orders: LabOrder[]
  complete: Map<string, number>
  violations: string[]
  maxSlots: number
  maxFlying: number
  maxReviewQueue: number
  reviewStarts: { id: string; availableThen: boolean }[]
  /** The lab's events, collected as they happen (the sim's log only keeps the last 2000). */
  events: { type: string; t: number; text: string; subjectId?: string }[]
  trips: number
  scientistSeen: { atTerminal: number; away: number }
}

function morning(seed: number): Morning {
  const sim = new Simulation(seed, { population: false })
  const driver = new Driver(sim, seed)
  const lab = sim.lab
  const m: Morning = { sim, driver, orders: driver.orders, complete: new Map(), violations: [], maxSlots: 0, maxFlying: 0, maxReviewQueue: 0, reviewStarts: [], events: [], trips: 0, scientistSeen: { atTerminal: 0, away: 0 } }
  lab.onOrderComplete = (o) => m.complete.set(o.id, (m.complete.get(o.id) ?? 0) + 1)
  lab.verifier.onReviewStart = (id) => m.reviewStarts.push({ id, availableThen: lab.scientist.available })
  let flying = 0
  lab.pneumatic.onLaunch = () => {
    flying++
    m.maxFlying = Math.max(m.maxFlying, flying)
  }
  lab.pneumatic.onLand = () => flying--
  let tick = 0
  let lastEvent = 0
  run(sim, (14 - CONFIG.sim.startHour) * 3600, driver, () => {
    tick++
    if (tick % 30 === 0) {
      for (const e of sim.log.since(lastEvent)) {
        lastEvent = e.id
        if (e.type === 'samplesReceived' || e.type === 'labResults') m.events.push({ type: e.type, t: e.t, text: e.text, subjectId: e.subjectId })
      }
    }
    const p = lab.lane.pucks
    for (let k = 1; k < p.length; k++) if (p[k - 1].sample.where.s - p[k].sample.where.s < CFG.puckGap - 1e-6 && m.violations.length < 5) m.violations.push(`pucks too close at t=${sim.t}`)
    if (lab.verifier.reviewing && lab.scientist.away && m.violations.length < 5) m.violations.push(`review while the scientist is away at t=${sim.t}`)
    if (tick % 60 === 0) {
      let used = 0
      for (const s of lab.state.slots) if (s !== null) used++
      m.maxSlots = Math.max(m.maxSlots, used)
      m.maxReviewQueue = Math.max(m.maxReviewQueue, lab.state.reviewQueue)
      if (lab.scientist.away) m.scientistSeen.away++
      else m.scientistSeen.atTerminal++
    }
  })
  m.trips = lab.scientist.trips
  return m
}

let day: Morning

beforeAll(() => {
  day = morning(SEED)
}, 300_000)

/** Every order in the lab (the tests read the protected map). The draw centre's own orders (src/sim/blood) share the lab with ours. */
function allOrders(sim: Simulation): LabOrder[] {
  return [...(sim.lab as unknown as { orders: Map<string, LabOrder> }).orders.values()]
}
/** The orders this test injected plus the ward's own samples: what the gates are about. */
function mine(m: Morning): LabOrder[] {
  const ids = new Set(m.orders.map((o) => o.id))
  return allOrders(m.sim).filter((o) => ids.has(o.id) || o.source === 'background')
}

describe('a morning in the real Simulation (07:30-12:30, drained to 14:00)', () => {
  it('every sample reaches the archive and every order completes, once', () => {
    const { sim, orders, complete } = day
    expect(orders.length).toBeGreaterThan(100)
    for (const o of orders) {
      expect(o.completeAt, `${o.id} ${o.panel}`).not.toBeNull()
      expect(complete.get(o.id), o.id).toBe(1)
      for (const id of o.sampleIds) expect(sim.lab.samples.get(id)!.stage).toBe('archived')
      expect(o.receivedAt).not.toBeNull()
      expect(o.drawnAt).not.toBeNull()
      expect(o.completeAt!).toBeGreaterThan(o.receivedAt!)
    }
    // the ward's own samples that arrived before 13:00 are finished too (later ones are still on their way at 14:00)
    const bg = allOrders(sim).filter((o) => o.source === 'background')
    expect(bg.length).toBeGreaterThan(60)
    for (const o of bg) if (o.orderedAt < timeAtHour(13)) expect(o.completeAt, o.id).not.toBeNull()
    expect(sim.lab.state.archived).toBeGreaterThan(300)
    expect(sim.lab.state.reviewQueue).toBe(0)
    // the camera only flags a haemolysed tube: it is spun, measured and archived like any other
    const flagged = [...sim.lab.samples.samples.values()].filter((s) => s.qc === 'haemolysed')
    expect(flagged.length).toBeLessThan(0.02 * sim.lab.samples.samples.size)
    for (const s of flagged) expect(s.stage).toBe('archived')
  })

  it('keeps at least 95 % of the results of every analyser inside its target turnaround, and every STAT result', () => {
    const orders = mine(day).filter((o) => o.completeAt !== null)
    const lines: string[] = []
    for (const kind of ['haematology', 'chemistry', 'immunoassay', 'coagulation'] as const) {
      const [lo, hi] = CFG.tatTargetMinutes[kind]
      const results = orders.flatMap((o) => o.results.filter((r) => analyserOf(r.testId) === kind).map((r) => ({ o, r, tat: tatMinutes(o, r.verifiedAt!) })))
      expect(results.length, kind).toBeGreaterThan(10)
      const inside = (xs: typeof results) => xs.filter((x) => x.tat >= lo && x.tat <= hi).length / xs.length
      const strict = inside(results)
      lines.push(`${kind}: ${results.length} results, ${(100 * strict).toFixed(1)} % inside [${lo}, ${hi}] min`)
      // (HbA1c's analyticSeconds is 840 since the W4 integration, so its un-spun EDTA tube fits the chemistry window too: no exemption)
      expect(strict, lines[lines.length - 1]).toBeGreaterThanOrEqual(0.95)
      for (const x of results) expect(x.tat, `${kind} ${x.r.testId} in ${x.o.id}`).toBeLessThanOrEqual(hi)
      const stat = results.filter((x) => x.o.priority === 'stat')
      if (stat.length > 0) expect(inside(stat), `${kind} STAT`).toBe(1)
    }
    expect(lines.length).toBe(4)
  })

  it('verifies 85 % of the results automatically (within 5 points), and the KPIs agree with the orders', () => {
    const { sim } = day
    const orders = allOrders(sim).filter((o) => o.completeAt !== null)
    const results = orders.flatMap((o) => o.results)
    const auto = results.filter((r) => r.verifiedBy === 'auto').length / results.length
    expect(auto).toBeGreaterThan(0.8)
    expect(auto).toBeLessThan(0.9)
    const k = sim.lab.state.kpis
    expect(k.autoVerifiedPct!).toBeGreaterThan(80)
    expect(k.autoVerifiedPct!).toBeLessThan(90)
    // the KPI counts every verified result, including those of orders still waiting for their other tests
    expect(Math.abs(k.autoVerifiedPct! - 100 * auto)).toBeLessThan(1)
    const tats = orders.map((o) => (o.completeAt! - o.drawnAt!) / 60).sort((a, b) => a - b)
    const median = (tats[(tats.length - 1) >> 1] + tats[tats.length >> 1]) / 2
    expect(Math.abs(k.medianTatMin! - median)).toBeLessThan(0.3)
    expect(k.medianTatMin!).toBeGreaterThan(8)
    expect(k.medianTatMin!).toBeLessThan(40)
    const received = [...sim.lab.samples.samples.values()].filter((s) => s.stageAt.received !== undefined).length
    expect(k.samplesToday).toBe(received)
    expect(k.onTrack).toBe([...sim.lab.samples.samples.values()].filter((s) => s.stageAt.received !== undefined && s.stage !== 'archived').length)
    expect(sim.lab.state.archived).toBe([...sim.lab.samples.samples.values()].filter((s) => s.stage === 'archived').length)
  })

  it('keeps its invariants all morning: one tube in the pipe, pucks apart, slots enough, reviews only while the scientist is at the terminal', () => {
    expect(day.violations).toEqual([])
    expect(day.maxFlying).toBe(1)
    expect(day.maxSlots).toBeGreaterThan(10)
    expect(day.maxSlots).toBeLessThanOrEqual(64)
    expect(day.reviewStarts.length).toBeGreaterThan(15)
    for (const r of day.reviewStarts) expect(r.availableThen).toBe(true)
  })

  it('has a real scientist: a person in the crowd who reviews at the terminal and goes to load reagents every 30-45 minutes', () => {
    const { sim } = day
    const e = sim.entities.get('lab-sci-1')!
    expect(e).toBeDefined()
    expect(e.role).toBe('labScientist')
    expect(e.name).toBe(SCIENTIST)
    expect(sim.people.some((p) => p.entity === e)).toBe(true)
    // 6.5 hours: a trip every 30-45 min is 8 to 13 trips
    expect(day.trips).toBeGreaterThanOrEqual(8)
    expect(day.trips).toBeLessThanOrEqual(14)
    // he is away only a small part of the time
    const away = day.scientistSeen.away / (day.scientistSeen.away + day.scientistSeen.atTerminal)
    expect(away).toBeGreaterThan(0.01)
    expect(away).toBeLessThan(0.1)
    // every manual verification is by him
    const manual = allOrders(sim).flatMap((o) => o.results).filter((r) => r.verifiedBy !== 'auto' && r.verifiedBy !== null)
    expect(manual.length).toBeGreaterThan(20)
    for (const r of manual) expect(r.verifiedBy).toBe(SCIENTIST)
  })

  it('logs "samplesReceived" and "labResults" for the draw centre\'s orders (not for the ward\'s own samples), with the minutes after the draw', () => {
    const { orders, events } = day
    const received = events.filter((e) => e.type === 'samplesReceived' && /^T\d+$/.test(e.subjectId ?? ''))
    const results = events.filter((e) => e.type === 'labResults' && /^T\d+$/.test(e.subjectId ?? ''))
    expect(received.length).toBe(orders.length)
    expect(results.length).toBe(orders.length)
    const receivedText = new Set(received.map((e) => e.text))
    const resultsText = new Set(results.map((e) => e.text))
    for (const o of orders) {
      expect(receivedText.has(o.ticket ? `Lab received ${o.ticket}'s samples.` : `Lab received ${o.patientName}'s samples.`), o.id).toBe(true)
      expect(resultsText.has(`Results ready for ${o.patientName}, ${Math.max(0, Math.round((o.completeAt! - o.drawnAt!) / 60))} min after the draw.`), o.id).toBe(true)
    }
    // the ward's own samples are not logged
    expect(events.filter((e) => e.subjectId?.startsWith('ward-')).length).toBe(0)
  })

  it('measures each test analyticSeconds after its tube was aspirated, in the order the analysers finish', () => {
    const { sim, orders } = day
    for (const o of orders.slice(0, 60))
      for (const r of o.results) {
        const test = testById(r.testId)
        const s = sim.lab.samples.get(o.sampleIds.find((id) => sim.lab.samples.get(id)!.tests.includes(r.testId))!)!
        // measured no sooner than the tube reached an analyser plus the aspiration plus the analytic time
        expect(r.measuredAt - s.stageAt.analysing!).toBeGreaterThanOrEqual(test.analyticSeconds + CFG.aspirateSeconds[test.analyser] - 1e-6)
      }
  })
})

describe('the lab in the Simulation (shorter runs)', () => {
  it('replays the identical day for the same seed, and another day for another seed', () => {
    const fingerprint = (seed: number) => {
      const sim = new Simulation(seed, { population: false })
      const d = new Driver(sim, seed, { injectUntilHour: 9.0 })
      run(sim, 2.5 * 3600, d)
      return {
        stages: [...sim.lab.samples.samples.values()].map((s) => [s.id, s.tube, s.priority, s.qc, s.slot, s.archiveSlot, JSON.stringify(s.stageAt), s.where.line, s.where.module, s.where.s]),
        events: sim.log.events.filter((e) => /^(samples|lab)/.test(e.type)).map((e) => `${e.id} ${e.t} ${e.type} ${e.text}`),
        orders: allOrders(sim).map((o) => [o.id, o.completeAt, JSON.stringify(o.results)]),
        kpis: sim.lab.state.kpis,
        pneumatic: sim.lab.state.pneumatic,
        analysers: sim.lab.state.analysers,
        centrifuges: sim.lab.state.centrifuges,
        slots: sim.lab.state.slots,
      }
    }
    const a = fingerprint(3)
    const b = fingerprint(3)
    expect(b).toEqual(a)
    expect(a.stages.length).toBeGreaterThan(80)
    expect(fingerprint(4).stages).not.toEqual(a.stages)
  }, 240_000)

  it('starts empty at a warm-start hour and the ward\'s samples arrive from there on (none after the last arrival hour)', () => {
    const at = (hour: number, seconds: number) => {
      const sim = new Simulation(5, { population: false, startHour: hour })
      expect(sim.lab.samples.samples.size).toBe(0)
      expect(sim.lab.state.archived).toBe(0)
      expect(sim.lab.state.kpis.samplesToday).toBe(0)
      run(sim, seconds)
      return sim
    }
    const busy = at(10.5, 1800)
    const bg = allOrders(busy).filter((o) => o.source === 'background')
    expect(bg.length).toBeGreaterThanOrEqual(2)
    expect(bg.every((o) => o.orderedAt > timeAtHour(10.5))).toBe(true)
    expect(busy.lab.state.kpis.samplesToday).toBeGreaterThanOrEqual(4)
    const late = at(23.4, 1500)
    // the arrival curve ends at 23:30
    expect(allOrders(late).filter((o) => o.source === 'background').every((o) => o.orderedAt < timeAtHour(23.5))).toBe(true)
  }, 120_000)

  it('"Send a sample now" flies one STAT demo tube from robot 0\'s riser, spins it at once and logs its way', () => {
    const sim = new Simulation(2, { population: false, startHour: 2 })
    sim.lab.sendDemo()
    run(sim, 3600)
    const demo = allOrders(sim).filter((o) => o.source === 'demo')
    expect(demo.length).toBe(1)
    const o = demo[0]
    expect(o.sampleIds.length).toBe(1)
    const s = sim.lab.samples.get(o.sampleIds[0])!
    expect(s.where.source).toBe(0)
    expect(s.priority).toBe('stat')
    expect(s.stage).toBe('archived')
    expect(o.completeAt).not.toBeNull()
    const text = sim.log.events.filter((e) => e.type === 'samplesReceived' || e.type === 'labResults').map((e) => e.text)
    expect(text[0]).toBe('Lab received the demo sample from the tube.')
    expect(text[1]).toMatch(/^Demo sample verified, \d+ min after it was sent\.$/)
    expect(sim.lab.state.pneumatic.sentToday).toBe(1)
  }, 60_000)

  it('the scientist walks to a tech spot to load reagents and back to the terminal', () => {
    const sim = new Simulation(2, { population: false, startHour: 2 })
    const sci = sim.lab.scientist
    const e = sim.entities.get('lab-sci-1')!
    expect(Math.hypot(e.position.x - LAB.terminal.at.x, e.position.z - LAB.terminal.at.z)).toBeLessThan(0.05)
    let atTech = false
    let nearTech = Infinity
    run(sim, 3600, undefined, () => {
      if (sci.atTech) {
        sim.sync(1)
        atTech = true
        for (const s of LAB.tech) nearTech = Math.min(nearTech, Math.hypot(e.position.x - s.at.x, e.position.z - s.at.z))
      }
    })
    expect(atTech).toBe(true)
    expect(nearTech).toBeLessThan(0.3)
    expect(sci.trips).toBeGreaterThanOrEqual(1)
    run(sim, 300)
    sim.sync(1)
    expect(sci.away).toBe(false)
    expect(Math.hypot(e.position.x - LAB.terminal.at.x, e.position.z - LAB.terminal.at.z)).toBeLessThan(0.6)
  }, 120_000)
})
