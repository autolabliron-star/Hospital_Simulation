/**
 * S1: the lab's in-flight warm. With `inFlight: true` the showcase opens on a lab that is already working: about CONFIG.opening.labTubes
 * ward tubes in different places (a spinning centrifuge, racks, the lane, an analyser), a review under way, all finishing normally.
 */
import { describe, expect, it } from 'vitest'
import { testById } from '@/content/lab'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'
import type { Sample } from '../types'
import type { Lab } from './index'
import { makeBench, run, samplesOf, tatMinutes } from './testkit'

const SEED = 7
const open = (seed: number) => new Simulation(seed, { inFlight: true, opening: 'showcase' })
const PRE_LAB = new Set(['ordered', 'labelled', 'drawn', 'inTube', 'archived'])
/** Tubes inside the lab (received and not yet in the fridge). */
const inLab = (lab: Lab): Sample[] => samplesOf(lab).filter((s) => !PRE_LAB.has(s.stage))
const pastInlet = (s: Sample): boolean => s.where.line === 'track' || (s.where.line === 'module' && s.where.module !== 'receive')

/** The ward tubes the in-flight warm put in the lab (the draw centre and the ER may add their own tubes at the opening). */
const placedBy = (lab: Lab, t0: number): Sample[] => samplesOf(lab).filter((s) => lab.orderById(s.orderId)!.source === 'background' && lab.orderById(s.orderId)!.orderedAt <= t0)

function fingerprint(lab: Lab) {
  return {
    samples: samplesOf(lab).map((s) => [s.id, s.tube, s.stage, s.where.line, s.where.module, Math.round(s.where.s * 1000), s.slot, s.archiveSlot, s.stageAt]),
    orders: [...lab.samples.samples.values()].map((s) => lab.orderById(s.orderId)!).map((o) => [o.id, o.orderedAt, o.drawnAt, o.receivedAt, o.completeAt]),
    state: JSON.parse(JSON.stringify(lab.state)),
  }
}

describe('lab in-flight warm', () => {
  it('after the build and the 50 s pre-roll the lab is visibly working, with the tubes in different places', () => {
    const sim = open(SEED)
    expect(placedBy(sim.lab, 0)).toHaveLength(CONFIG.opening.labTubes)
    // nothing was said while placing
    expect(sim.log.events.filter((e) => e.type === 'samplesReceived' || e.type === 'labResults')).toHaveLength(0)
    sim.preRoll(CONFIG.opening.preRollSeconds)
    const live = inLab(sim.lab)
    expect(live.length).toBeGreaterThanOrEqual(3)
    expect(live.filter(pastInlet).length).toBeGreaterThanOrEqual(1)
    // not all piled in one place
    expect(new Set(live.map((s) => s.where.module ?? s.where.line)).size).toBeGreaterThanOrEqual(2)
    // a centrifuge is spinning, a review is under way (the scientist is at work), the counters agree
    expect(sim.lab.state.centrifuges.some((c) => c.phase === 'spinning')).toBe(true)
    expect(sim.lab.verifier.reviewing).toBe(true)
    expect(sim.lab.state.kpis.onTrack).toBe(live.length)
    expect(sim.lab.state.slots.filter((x) => x !== null).length).toBeGreaterThanOrEqual(live.length)
    // the same on a Jump / Skip pre-roll (60 s)
    const jump = open(SEED + 1)
    jump.preRoll(60)
    expect(inLab(jump.lab).length).toBeGreaterThanOrEqual(3)
  }, 120_000)

  it('is deterministic', () => {
    const a = open(3)
    const b = open(3)
    a.preRoll(50)
    b.preRoll(50)
    expect(fingerprint(b.lab)).toEqual(fingerprint(a.lab))
    const c = open(4)
    c.preRoll(50)
    expect(fingerprint(c.lab)).not.toEqual(fingerprint(a.lab))
  }, 120_000)

  it('without inFlight the lab starts empty, as before', () => {
    const sim = new Simulation(SEED, { population: false })
    expect(sim.lab.samples.samples.size).toBe(0)
    expect(sim.lab.state.kpis.samplesToday).toBe(0)
    const warm = new Simulation(SEED, { population: false, startHour: 10.5 })
    expect(warm.lab.samples.samples.size).toBe(0)
  }, 60_000)

  it('every placed tube finishes: results, verified, archived, turnaround inside the targets, no stuck counters', () => {
    const bench = makeBench(5, CONFIG.sim.startHour)
    const lab = bench.lab
    lab.warmInFlight(bench.world.t)
    const placed = samplesOf(lab)
    expect(placed.length).toBe(CONFIG.opening.labTubes)
    const orders = [...new Set(placed.map((s) => s.orderId))].map((id) => lab.orderById(id)!)
    expect(orders.every((o) => o.source === 'background' && o.orderedAt <= bench.world.t && o.drawnAt !== null && o.completeAt === null)).toBe(true)
    // the placed tubes' stage times are on the private clock before the opening and never run backwards
    for (const s of placed) {
      const ts = Object.values(s.stageAt) as number[]
      expect(ts.every((v) => v <= bench.world.t + 1e-6)).toBe(true)
    }
    bench.run(3600)
    for (const s of placed) {
      expect(s.stage).toBe('archived')
      expect(s.slot).toBe(-1)
      expect(s.archiveSlot).toBeGreaterThanOrEqual(0)
    }
    for (const o of orders) {
      expect(o.completeAt).not.toBeNull()
      expect(o.results.length).toBe(o.tests.length)
      for (const r of o.results) expect(r.verifiedAt).not.toBeNull()
    }
    expect(lab.state.slots.filter((x) => x !== null).length).toBe(samplesOf(lab).filter((s) => s.stage !== 'archived').length)
    expect(lab.state.kpis.onTrack).toBe(inLab(lab).length)
    expect(lab.state.archived).toBe(samplesOf(lab).filter((s) => s.stage === 'archived').length)
    expect(lab.state.analysers.haematology.running).toBeLessThanOrEqual(1)
    // drain: stop nothing, just look that nobody waits for ever (an hour on, only the ward's newest tubes can be inside)
    const late = samplesOf(lab).filter((s) => s.stage !== 'archived')
    expect(late.every((s) => bench.world.t - s.stageAt.ordered! < 3600)).toBe(true)
    expect(lab.state.reviewQueue).toBeLessThanOrEqual(2)
  }, 120_000)

  it('turnaround of the placed orders stays inside the analysers\' targets', () => {
    for (const seed of [1, 2, 3]) {
      const bench = makeBench(seed, CONFIG.sim.startHour)
      bench.lab.warmInFlight(bench.world.t)
      const orders = [...new Set(samplesOf(bench.lab).map((s) => s.orderId))].map((id) => bench.lab.orderById(id)!)
      bench.run(3600)
      for (const o of orders)
        for (const r of o.results) {
          const kind = analyserKind(r.testId)
          const [lo, hi] = CONFIG.lab.tatTargetMinutes[kind]
          const tat = tatMinutes(o, r.verifiedAt!)
          expect(tat, `${seed} ${o.id} ${r.testId}`).toBeGreaterThanOrEqual(lo)
          expect(tat, `${seed} ${o.id} ${r.testId}`).toBeLessThanOrEqual(hi)
        }
    }
  }, 240_000)

  it('the whole simulation: 60 sim minutes after the opening, every placed tube is archived with its results', () => {
    const sim = open(SEED)
    sim.preRoll(CONFIG.opening.preRollSeconds)
    const t0 = 0
    const placed = placedBy(sim.lab, t0)
    expect(placed.length).toBe(CONFIG.opening.labTubes)
    run(sim, 3600)
    for (const s of placed) expect(s.stage).toBe('archived')
    const orders = [...new Set(placed.map((s) => s.orderId))].map((id) => sim.lab.orderById(id)!)
    for (const o of orders) {
      expect(o.completeAt).not.toBeNull()
      expect(o.results.length).toBe(o.tests.length)
    }
    const live = inLab(sim.lab)
    expect(sim.lab.state.kpis.onTrack).toBe(live.length)
  }, 600_000)
})

function analyserKind(testId: string) {
  return testById(testId).analyser
}
