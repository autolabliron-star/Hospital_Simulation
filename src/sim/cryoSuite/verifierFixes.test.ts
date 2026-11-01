/**
 * R5 wave 3, the three findings an adversarial verifier left after the review round (V1..V3), proved (and, in fix round 3, the findings it left after the
 * first fix of V1):
 *
 *   V1  the empty stretcher: after the dressing it is brought back from lift B (never made inside the scan room): the ward porter is driven along the lane
 *       (lane.ts) up the corridor, through recovery and the scan room's door to the park beside the table, due there at the dressing's end; he takes the patient
 *       out himself (no hand over: two bodies on one spot, one of them popping), backs the stretcher out along the lane, turns it slowly and pushes it to the bay.
 *       At no tick, on the lane or in the scan room, does a stretcher the team holds overlap the table, the patient, the robot's base, the gantry, the anaesthesia
 *       machine, a wall or the body of anybody, and no stretcher or person pops (the audit, testkit.ts `StretcherAudit`). With no porter free the nurse walks out and
 *       takes one on clear floor outside the door. A warm start puts the porter where the nominal trip has him. The porter is kept free for the case's trip.
 *   V2  the transfer onto the CT table starts only with the stretcher parked beside it: the arrival's first step lasts the porter's trip, and the published
 *       view never shows the transfer step (caption, the team's lines, the table pose) while the patient is still on the stretcher
 *   V3  a lung or liver needle is advanced only during the held breath (live and watch), and the kidney's needle clock is the one it always was
 *
 * Each runs a watch case of each target (a CryoHospital with the crowd on, stepped at 0.1 s) or the pure functions.
 */
import { describe, expect, it } from 'vitest'
import { CRYO_STAFF } from '@/content/staff'
import { scriptFor } from '@/content/procedures'
import { CONFIG } from '../config'
import type { Actor } from '../er/actor'
import { newCursor, stepAt, watchTotalSeconds } from '../procedure'
import { timeAtHour } from '../population/schedule'
import type { CryoTarget } from '../types'
import { CryoCase } from './case'
import { apnoeaCap, holdsBreathAt, needleClockInto, needleInAt, newHoldWindow, newNeedleClock, NEEDLE_HOLD_MARGIN, PUSH_IN0, PUSH_IN1, pushHoldInto } from './derive'
import { cryoTimeline, targetOf } from './plan'
import { compiledForTarget, transferStepOf } from './script'
import { cryoSeats, CryoHospital, cryoSuite, distToStretcher, StretcherAudit, stretcherBlocked, stretcherOverlaps } from './testkit'

const TARGETS: readonly CryoTarget[] = ['kidney', 'lung', 'liver']
const PORTER = CRYO_STAFF.find((s) => s.title === 'wardPorter')!.id

// ---------------------------------------------------------------------------------------------------------------------
// V1: the stretcher's way
// ---------------------------------------------------------------------------------------------------------------------

interface Appearance {
  t: number
  id: string
  x: number
  z: number
  heading: number
}

interface Trace {
  h: CryoHospital
  demo: CryoCase
  audit: StretcherAudit
  /** Each empty stretcher that began to exist (nobody held one near its place the tick before) while the case was in its dressing or going out, and who held it. */
  appeared: Appearance[]
  /** When the dressing was due to end, and when the 'out' step began. */
  dressingEnd: number
  outSince: number
  /** The stretcher's holder and pose at the first tick at or after the dressing's end. */
  atEnd: { id: string; x: number; z: number; heading: number } | null
  /** Who held a stretcher at the first tick of the 'out' step. */
  holders: string[]
  /** Whether the nurse was ever lent out (`engagedBy`) from the dressing's start to the 'out' step. */
  nurseLent: boolean
  /** The radiographer: the closest she came to her step-back spot while a stretcher was on the lane, and how far from her place at the table's foot she stood at the dressing's end. */
  radWay: number
  radAtEnd: number
  /** Each person who held a stretcher (empty or loaded) between the dressing's start and the patient's arrival in recovery. */
  held: Set<string>
  /** The time the patient was settled in recovery. */
  pacuAt: number
}

/** Each pusher who holds an empty stretcher now (not the patient riding). */
function pushers(h: CryoHospital) {
  const out: { id: string; x: number; z: number; heading: number }[] = []
  for (const p of h.people) {
    if (p.entity.vehicle !== 'stretcher' || p.entity.riding === true) continue
    out.push({ id: p.entity.id, x: p.walker.x, z: p.walker.z, heading: p.walker.heading })
  }
  return out
}

/**
 * Play a watch case of `target` from its start until its patient is in recovery (plus `after` more seconds), auditing every tick (the stretcher the team holds is
 * nowhere solid and has nobody inside it, nothing pops). `setup` runs once the case is booked and may return a function run after every tick (the tests that hold
 * a porter back or take his away).
 */
function trace(target: CryoTarget, opts: { setup?: (h: CryoHospital, demo: CryoCase) => (() => void) | void; after?: number; seed?: number; hour?: number } = {}): Trace {
  const h = cryoSuite(opts.seed ?? 31, { crowd: true, hour: opts.hour ?? 9 })
  const c = h.cryo
  h.step(0.1)
  // (a day case in the room: the watch case waits its turn, from the start of the list)
  expect(['started', 'queued']).toContain(c.startWatch(target, { fromStart: true }))
  const demo = c.runs.find((r) => r.plan.demo)!
  const each = opts.setup?.(h, demo)
  const audit = new StretcherAudit(h)
  const tr: Trace = { h, demo, audit, appeared: [], dressingEnd: 0, outSince: 0, atEnd: null, holders: [], nurseLent: false, radWay: 9, radAtEnd: 9, held: new Set(), pacuAt: -1 }
  const way = h.cryo.sites.spots.makeWay.at
  const foot = h.cryo.sites.anchor('ctFoot', 0).at
  let prev: { id: string; x: number; z: number }[] = []
  let outAt = -1
  let doneAt = -1
  for (let i = 0; i < 90000; i++) {
    h.step(0.1)
    audit.tick(0.1)
    if (each) each()
    if (demo.roomStep === 'dressing' && demo.stage === 'room') tr.dressingEnd = demo.until
    const now = pushers(h)
    const dressing = demo.stage === 'room' && demo.roomStep === 'dressing'
    if (dressing || demo.stage === 'toPacu') {
      for (const p of now) {
        tr.held.add(p.id)
        // a stretcher whose pusher stood nowhere near the tick before (a tick's drive is under 0.2 m) is a new one
        if (prev.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.35) === undefined) tr.appeared.push({ t: h.t, id: p.id, x: p.x, z: p.z, heading: p.heading })
      }
      if (tr.atEnd === null && h.t >= tr.dressingEnd && tr.dressingEnd > 0 && now.length > 0) tr.atEnd = { ...now[0] }
      const nurse = c.team.get('sedation')
      if (nurse !== null && nurse.engagedBy !== null) tr.nurseLent = true
      const rad = c.team.get('ctRadiographer')
      if (rad !== null && now.length > 0) tr.radWay = Math.min(tr.radWay, Math.hypot(rad.x - way.x, rad.z - way.z))
      if (rad !== null && tr.atEnd !== null && tr.radAtEnd === 9) tr.radAtEnd = Math.hypot(rad.x - foot.x, rad.z - foot.z)
    }
    if (outAt < 0 && demo.stage === 'toPacu') {
      outAt = h.t
      tr.outSince = demo.outSince!
      tr.holders = now.map((p) => p.id)
    }
    if (doneAt < 0 && demo.stage === 'pacu') {
      doneAt = h.t
      tr.pacuAt = h.t
    }
    prev = dressing || demo.stage === 'toPacu' ? now : []
    if (doneAt >= 0 && h.t >= doneAt + (opts.after ?? 20)) break
  }
  expect(outAt, `${target}: the case reached its 'out' step`).toBeGreaterThan(0)
  expect(doneAt, `${target}: the patient reached recovery`).toBeGreaterThan(0)
  return tr
}

const watched = new Map<CryoTarget, Trace>()
const watch = (t: CryoTarget): Trace => {
  let tr = watched.get(t)
  if (tr === undefined) watched.set(t, (tr = trace(t)))
  return tr
}

describe('V1: the checker itself', () => {
  it('finds the stretcher the nurse used to make across the table, the robot and the patient, a stretcher through a wall, a body inside one, and finds the park clear', () => {
    // (the old creation: the nurse at the table's south side facing north, the stretcher 1.45 m ahead across the table and the robot's base)
    const old = stretcherOverlaps(92.9, 18.05, -2.97)
    expect(old).toContain('l2:cryo:ct:table')
    expect(old).toContain('l2:cryo:robot')
    // a stretcher pushed east into the wall by the pusher at (96, 19.5), and one swung into the anaesthesia machine
    expect(stretcherOverlaps(96, 19.5, Math.PI / 2).some((n) => n.startsWith('wall'))).toBe(true)
    expect(stretcherOverlaps(92.5, 19.6, -Math.PI / 2)).toContain('l2:cryo:anaes')
    // the corridor's wall and recovery's beds are found too (the room's own check does not look there)
    expect(stretcherBlocked(106.4, 11.0, Math.PI).length).toBeGreaterThan(0)
    expect(stretcherBlocked(101.5, 19.5, Math.PI / 2).length).toBeGreaterThan(0)
    // the park is clear
    const park = cryoSuite(31, { crowd: false, hour: 9 }).cryo.sites.spots.stretcherPark
    expect(stretcherOverlaps(park.at.x, park.at.z, park.heading)).toEqual([])
    expect(stretcherBlocked(park.at.x, park.at.z, park.heading, 0.05)).toEqual([])
    // a body inside the box is found, one beside it is not (the audit's own rule)
    expect(distToStretcher(93.55, 18.9, park.at.x, park.at.z, park.heading)).toBe(0)
    expect(distToStretcher(94.6, 17.4, park.at.x, park.at.z, park.heading)).toBeGreaterThan(0.5)
  })

  it('finds a pop, and sees the stretcher on the lane (the audit is not blind)', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    h.step(0.1)
    expect(h.cryo.startWatch('kidney', { fromStart: true })).toBe('started')
    const audit = new StretcherAudit(h)
    // the porter drives up the corridor from lift B: the audit sees the stretcher driven along the lane, and finds nothing wrong
    for (let i = 0; i < 100; i++) {
      h.step(0.1)
      audit.tick(0.1)
    }
    expect(audit.ticks).toBeGreaterThan(50)
    expect(audit.problems).toEqual([])
    // the porter is put a metre and a half away, as the old hand over and park snaps put him: a jump
    const porter = h.personById(PORTER) as Actor
    porter.placeAt(porter.walker.x, porter.walker.z + 1.5, porter.walker.heading)
    h.step(0.1)
    audit.tick(0.1)
    expect(audit.problems.some((p) => p.startsWith('jump'))).toBe(true)
  })
})

describe('V1: the stretcher comes from lift B along the lane, and is nowhere solid, at any tick', () => {
  for (const target of TARGETS) {
    it(`${target}: from the porter's first step out of lift B to the patient in recovery the stretcher overlaps nothing solid and no body and nothing pops, and it is never made in the scan room`, () => {
      const tr = watch(target)
      expect(tr.audit.problems).toEqual([])
      expect(tr.h.cryo.stuckFixes, tr.h.cryo.stuckLog.join('|')).toBe(0)
      // the audit saw the stretcher on the lane and in the room for many ticks (the arrival's, the empty one's, the loaded one's)
      expect(tr.audit.ticks).toBeGreaterThan(300)
      // one empty stretcher appears in the dressing, held by the ward porter, at lift B (x about 108): never in the room
      expect(tr.appeared.map((a) => a.id)).toEqual([PORTER])
      expect(tr.appeared[0].x, `where its pusher began: (${tr.appeared[0].x.toFixed(1)}, ${tr.appeared[0].z.toFixed(1)})`).toBeGreaterThan(107)
      expect(tr.appeared[0].z).toBeGreaterThan(17)
    }, 300_000)

    it(`${target}: the porter is at the park by the dressing's end and takes the patient out himself within 3 s; the nurse stays at the table and is never lent, and the radiographer steps back and is back`, () => {
      const tr = watch(target)
      const park = tr.h.cryo.sites.spots.stretcherPark
      // at the dressing's end the stretcher lies at the park, the porter's
      expect(tr.atEnd, 'a stretcher at the dressing\'s end').not.toBeNull()
      expect(tr.atEnd!.id).toBe(PORTER)
      expect(Math.hypot(tr.atEnd!.x - park.at.x, tr.atEnd!.z - park.at.z), 'at the park by the end').toBeLessThan(0.05)
      // the 'out' step begins within 3 s of the dressing's planned end, with the porter (alone) holding the stretcher
      expect(tr.outSince - tr.dressingEnd).toBeGreaterThanOrEqual(0)
      expect(tr.outSince - tr.dressingEnd).toBeLessThanOrEqual(3)
      expect(tr.holders).toEqual([PORTER])
      // nobody else carried a stretcher: no hand over, no jump; and the sedation nurse was not lent for it
      expect([...tr.held]).toEqual([PORTER])
      expect(tr.nurseLent).toBe(false)
      // the radiographer stepped back (to within 40 cm of her step-back spot) while it was on the lane, and stands at her place at the table's foot by the dressing's end
      expect(tr.radWay).toBeLessThan(0.4)
      expect(tr.radAtEnd).toBeLessThan(0.5)
    }, 300_000)

    it(`${target}: the patient is taken to a recovery bay, the porter takes his empty stretcher back to lift B and is gone`, () => {
      const tr = trace(target, { after: 240 })
      const porter = tr.h.personById(PORTER)
      expect(porter, 'the porter has left the building').toBeNull()
      expect(tr.audit.problems).toEqual([])
      expect(tr.h.cryo.stuckFixes, tr.h.cryo.stuckLog.join('|')).toBe(0)
      // (the way out is backing, turning and the crowd's walk to the bay: a minute and a half at most)
      expect(tr.pacuAt - tr.outSince).toBeLessThan(120)
    }, 300_000)
  }

  it('other days and hours (another seed, another time of day): the same, within 3 s, nothing solid, nobody inside', () => {
    for (const [seed, hour] of [[2026, 8.4], [77, 12.7], [5, 15.2]] as const) {
      for (const target of TARGETS) {
        const tr = trace(target, { seed, hour, after: 5 })
        const where = `${target} seed ${seed} at ${hour}`
        expect(tr.audit.problems, where).toEqual([])
        expect(tr.h.cryo.stuckFixes, `${where} ${tr.h.cryo.stuckLog.join('|')}`).toBe(0)
        expect(tr.appeared.map((a) => a.id), where).toEqual([PORTER])
        expect(tr.outSince - tr.dressingEnd, where).toBeGreaterThanOrEqual(0)
        expect(tr.outSince - tr.dressingEnd, where).toBeLessThanOrEqual(3)
      }
    }
  }, 300_000)

  it('no porter free (a live day\'s other work): the nurse walks out of the room, takes a stretcher on clear floor outside its door, drives it in, and takes the patient out herself', () => {
    for (const target of TARGETS) {
      let blocked = false
      const tr = trace(target, {
        setup: (h, demo) => {
          const real = h.cryo.acquirePorter.bind(h.cryo)
          // (the arrival's porter is the day's: once the case is in its room steps the porter is busy elsewhere)
          h.cryo.acquirePorter = (owner: string) => (blocked ? null : real(owner))
          return () => {
            blocked = demo.stage === 'room'
          }
        },
      })
      expect(tr.audit.problems, target).toEqual([])
      expect(tr.h.cryo.stuckFixes, `${target} ${tr.h.cryo.stuckLog.join('|')}`).toBe(0)
      // the stretcher is made outside the room, in the nurse's hands, on clear floor 6 m outside the door (the room's door is at x = 97)
      expect(tr.appeared.map((a) => a.id), target).toEqual(['cryo-nurse'])
      const out = tr.h.cryo.sites.spots.stretcherOut
      expect(Math.hypot(tr.appeared[0].x - out.at.x, tr.appeared[0].z - out.at.z), `${target}: it began at (${tr.appeared[0].x.toFixed(2)}, ${tr.appeared[0].z.toFixed(2)})`).toBeLessThan(0.3)
      expect(stretcherBlocked(out.at.x, out.at.z, out.heading, 0.05)).toEqual([])
      // she has it at the park and takes the patient out, a while after the dressing's end (she walks out and drives it in: some seconds)
      expect(tr.holders, target).toEqual(['cryo-nurse'])
      expect(tr.outSince - tr.dressingEnd, target).toBeGreaterThan(0)
      expect(tr.outSince - tr.dressingEnd, target).toBeLessThan(45)
    }
  }, 600_000)
})

describe('V1: a warm start keeps the stretcher consistent', () => {
  /** A day whose first case is in its dressing, `before` seconds before the dressing's planned end (negative: after it). */
  function inDressing(before: number, crowd = false): { h: CryoHospital; run: CryoCase } {
    const base = cryoSuite(2026, { crowd: false })
    const plan = base.cryo.plan[0]
    const tl = cryoTimeline(plan)
    const hour = CONFIG.sim.startHour + (tl.end.dressing - before) / 3600
    const h = cryoSuite(2026, { crowd, hour })
    return { h, run: h.cryo.runs[0] }
  }

  it('anywhere in the trip (in the corridor, turning at the stage, on the lane, at the park) the porter is where the nominal trip has him, never made in the scan room, and the case goes on, on time', () => {
    const sites = cryoSuite(2026, { crowd: false }).cryo.sites
    const lane = sites.lane
    // (before the end: the trip's phases, from just after he was called for to the park)
    const trip = sites.stretcherTrip
    // (the phases, by the seconds left to the dressing's end: up the corridor, turning at the stage, on the lane, at the park)
    expect(trip).toBeCloseTo(sites.stretcherLift + 2.5 + sites.stretcherDrive, 9)
    for (const before of [trip - 0.5, trip - 4, trip - 8, trip - sites.stretcherLift - 1, sites.stretcherDrive - 3, sites.stretcherDrive - 9, sites.stretcherDrive - 15, 2, 0.5]) {
      const { h, run } = inDressing(before, true)
      expect(run.stage, `${before}`).toBe('room')
      expect(run.roomStep, `${before}`).toBe('dressing')
      const holders = pushers(h)
      expect(holders.map((p) => p.id), `${before} s before the end`).toEqual([PORTER])
      // where he is on the way: the corridor, the stage, or the lane (within a metre of the pose the nominal time gives)
      const p = holders[0]
      const onWay = [lane.lift, lane].some((l) => {
        for (let s = 0; s <= l.length; s += 0.1) {
          const q = l.poseAt(s, { x: 0, z: 0, heading: 0 })
          if (Math.hypot(q.x - p.x, q.z - p.z) < 0.15) return true
        }
        return false
      })
      expect(onWay, `${before} s before the end: at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBe(true)
      expect(stretcherBlocked(p.x, p.z, p.heading, 0)).toEqual([])
      const audit = new StretcherAudit(h)
      for (let i = 0; i < 5000 && (run.stage as string) === 'room'; i++) {
        h.step(0.1)
        audit.tick(0.1)
      }
      expect(run.stage, `${before}`).toBe('toPacu')
      expect(audit.problems, `${before} s before the end`).toEqual([])
      // (on time: the dressing's end was `before` s after the start of this run, give or take the drive's own slack)
      expect(h.t - cryoTimeline(run.plan).end.dressing, `${before}`).toBeLessThan(3.5)
      expect(h.cryo.stuckFixes, `${before} ${h.cryo.stuckLog.join('|')}`).toBe(0)
    }
  }, 300_000)

  it('a dressing that is over with no recovery bay free: the porter already waits with the stretcher at the park, the patient on the table (never made across it)', () => {
    const base = cryoSuite(2026, { crowd: false })
    const tl = cryoTimeline(base.cryo.plan[0])
    const t0 = timeAtHour(CONFIG.sim.startHour + (tl.end.dressing + 30) / 3600)
    // every recovery bay is taken when the day is placed just after the dressing: the case is still on the table, waiting for one
    const h = new CryoHospital(2026, { crowd: false, seats: cryoSeats('layout'), t0 })
    const rec = h.cryo.sites.recovery
    for (const ref of rec.pacu) expect(rec.claim(ref, 'blocker')).toBe(true)
    h.cryo.startDay(t0)
    const run = h.cryo.runs[0]
    expect(run.stage).toBe('room')
    expect(run.roomStep).toBe('dressing')
    const holders = pushers(h)
    expect(holders.map((p) => p.id)).toEqual([PORTER])
    const park = h.cryo.sites.spots.stretcherPark
    expect(Math.hypot(holders[0].x - park.at.x, holders[0].z - park.at.z)).toBeLessThan(0.05)
    expect(stretcherOverlaps(holders[0].x, holders[0].z, holders[0].heading)).toEqual([])
    // still waiting a while later, the stretcher where it was; then a bay frees up: he takes the patient out
    h.run(20, 0.1)
    expect(run.stage).toBe('room')
    expect(pushers(h).map((p) => p.id)).toEqual([PORTER])
    for (const ref of rec.pacu) rec.release(ref, 'blocker')
    expect(h.runUntil(() => run.stage === 'toPacu', 60, 0.1)).toBe(true)
    expect(h.cryo.stuckFixes, h.cryo.stuckLog.join('|')).toBe(0)
  })
})

describe('V1: the porter is kept free for the empty stretcher\'s trip', () => {
  it('a case in its dressing, due to call for him within two and a half minutes, holds the others\' jobs off: acquirePorter says no to them; further off it does not', () => {
    const base = cryoSuite(2026, { crowd: false })
    const tl = cryoTimeline(base.cryo.plan[0])
    const trip = base.cryo.sites.stretcherTrip
    const at = (before: number) => cryoSuite(2026, { crowd: false, hour: CONFIG.sim.startHour + (tl.end.dressing - before) / 3600 })
    // 100 s before he is called for: within the window of 150 s
    const near = at(trip + 100)
    const c = near.cryo.runs[0]
    expect(c.roomStep).toBe('dressing')
    expect(c.wantsPorter(near.t, 150)).toBe(true)
    expect(near.cryo.acquirePorter('some-other-case')).toBeNull()
    // a quarter of an hour before: the porter is the day's, another job may have him
    const far = at(trip + 900)
    expect(far.cryo.runs[0].wantsPorter(far.t, 150)).toBe(false)
    expect(far.cryo.acquirePorter('some-other-case')).not.toBeNull()
    // the case itself is served once it calls for him (the next tick of a run that is past the call)
    const past = at(trip - 3)
    expect(past.cryo.runs[0].roomStep).toBe('dressing')
    expect(pushers(past).map((p) => p.id)).toEqual([PORTER])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// V2: the transfer step runs only with the patient there
// ---------------------------------------------------------------------------------------------------------------------

interface Arrival {
  /** First ticks (s into the case) of: the porter at the park, the patient off the stretcher, the transfer step published. */
  parked: number
  unloaded: number
  transfer: number
  /** The published step and the team's step at every tick the patient was still on the stretcher. */
  seenWhileMounted: Set<string>
  teamWhileMounted: Set<string>
  poseWhileMounted: Set<string>
  /** The porter's trip and the length of the arrival's first step, in seconds. */
  wheelsIn: number
}

function arrival(target: CryoTarget, hold?: { until: number }): Arrival {
  const h = cryoSuite(31, { crowd: true, hour: 9 })
  const c = h.cryo
  h.step(0.1)
  expect(c.startWatch(target)).toBe('started')
  const demo = c.runs.find((r) => r.plan.demo)!
  const t0 = h.t
  const v = c.state.procedure
  const steps = demo.proc!.steps.cs.script.steps
  const at = transferStepOf(demo.proc!.steps.cs)
  const a: Arrival = { parked: -1, unloaded: -1, transfer: -1, seenWhileMounted: new Set(), teamWhileMounted: new Set(), poseWhileMounted: new Set(), wheelsIn: steps.find((s) => s.id === 'wheelsIn')!.watchSeconds }
  let wrapped = false
  for (let i = 0; i < 3000 && demo.stage !== 'room'; i++) {
    h.step(0.1)
    const porter = (demo as unknown as { porter: { isAt(k: string): boolean } | null }).porter
    if (hold !== undefined && !wrapped && porter !== null) {
      // (the porter is held up: for the case he is not at the park yet, whatever he did)
      const real = porter.isAt.bind(porter)
      porter.isAt = (key: string) => h.t - t0 >= hold.until && real(key)
      wrapped = true
    }
    const t = h.t - t0
    if (a.parked < 0 && porter !== null && porter.isAt(`${demo.id}:park`)) a.parked = t
    if (a.unloaded < 0 && demo.patient !== null && !demo.patient.mounted) a.unloaded = t
    if (a.transfer < 0 && v.procedureId !== null && v.stepId === steps[at].id) a.transfer = t
    if (demo.patient !== null && demo.patient.mounted && v.procedureId !== null) {
      a.seenWhileMounted.add(v.stepId)
      a.poseWhileMounted.add(v.patient.position)
      const cur = c.team.ctx.cur
      if (c.team.ctx.script !== null && cur.index >= 0) a.teamWhileMounted.add(steps[cur.index].id)
    }
  }
  return a
}

describe('V2: the transfer onto the CT table starts only with the stretcher parked beside it', () => {
  for (const target of TARGETS) {
    it(`${target}: the arrival's first step lasts the porter's trip with room to spare, and the totals stay in the 10-15 minute band`, () => {
      const script = scriptFor(`cryo-${target}`)!
      const wheels = script.steps.find((s) => s.id === 'wheelsIn')!
      const h = cryoSuite(31, { crowd: false, hour: 9 })
      const trip = h.cryo.sites.stretcherTrip
      // (the trip from lift B is about 26 s; the step covers it with a margin, about 30 s)
      expect(wheels.watchSeconds).toBeGreaterThanOrEqual(28)
      expect(wheels.watchSeconds).toBeLessThanOrEqual(36)
      expect(trip).toBeGreaterThan(20)
      const cs = compiledForTarget(target)!
      const [lo, hi] = CONFIG.procedure.watchTotalSeconds
      for (let n = 1; n <= 4; n++) {
        expect(watchTotalSeconds(cs, n), `${target} ${n} needles`).toBeGreaterThanOrEqual(lo)
        expect(watchTotalSeconds(cs, n), `${target} ${n} needles`).toBeLessThanOrEqual(hi)
      }
    })

    it(`${target}: the stretcher is parked when the transfer step begins, the patient is moved across inside it, and the pose, caption and lines wait for it`, () => {
      const a = arrival(target)
      expect(a.parked, 'the porter parked').toBeGreaterThan(0)
      expect(a.transfer, 'the transfer step was published').toBeGreaterThan(0)
      // the step begins with the stretcher parked (a tick's grace), and the patient comes off it as it begins
      expect(a.parked).toBeLessThanOrEqual(a.transfer + 0.05)
      expect(a.unloaded).toBeGreaterThanOrEqual(a.transfer - 0.05)
      expect(a.unloaded).toBeLessThanOrEqual(a.transfer + 0.5)
      // while the patient is on the stretcher the view, the team's lines and the table pose are the first step's
      expect([...a.seenWhileMounted]).toEqual(['wheelsIn'])
      expect([...a.teamWhileMounted]).toEqual(['wheelsIn'])
      expect([...a.poseWhileMounted]).toEqual(['supine'])
    }, 300_000)

    it(`${target}: a porter held up past the step's start leaves the view on the step before it (the safety hold) until the stretcher is parked`, () => {
      const a = arrival(target, { until: 41 })
      // the transfer step is under the clock from about 30 s, the porter is not at the park before 41 s: nothing of the transfer is published until then
      expect(a.parked).toBeGreaterThanOrEqual(41)
      expect(a.transfer).toBeGreaterThanOrEqual(41)
      expect(a.unloaded).toBeGreaterThanOrEqual(41)
      expect([...a.seenWhileMounted]).toEqual(['wheelsIn'])
      expect([...a.teamWhileMounted]).toEqual(['wheelsIn'])
      expect([...a.poseWhileMounted]).toEqual(['supine'])
      expect(a.transfer).toBeLessThanOrEqual(a.unloaded + 0.05)
    }, 300_000)
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// V3: the needle moves only while the breath is held
// ---------------------------------------------------------------------------------------------------------------------

describe('V3: a lung or liver needle goes in only during the held breath', () => {
  it('in the living day each needle\'s travel lies inside the held window of its push step (both ends, with the margin), the kidney\'s clock is the old one, and needleInAt is where it ends', () => {
    const cap = CONFIG.cryoSuite.apnoeaSeconds
    const w = newHoldWindow()
    const cur = newCursor()
    const clock = newNeedleClock()
    const seen = new Set<string>()
    for (const seed of [3, 77, 31, 2026, 5, 11]) {
      const base = cryoSuite(seed, { crowd: false })
      for (const run of base.cryo.runs) {
        const plan = run.plan
        const target = targetOf(plan)
        const sc = run.proc!
        const tl = cryoTimeline(plan)
        const since = tl.start.aim
        const until = tl.end.aim
        for (let i = 0; i < plan.needles.length; i++) {
          needleClockInto(plan, sc.steps, i, since, until, clock)
          // the push step this needle's travel is in
          const mid = since + clock.a + 0.5 * (clock.in0 + clock.in1)
          expect(stepAt(sc.steps, 'aim', since, until, mid, null, cur)).toBe(true)
          expect(sc.steps.cs.script.steps[cur.index].id).toBe('pushNeedle')
          const push0 = cur.since - since - clock.a
          const len = cur.until - cur.since
          expect(apnoeaCap(plan)).toBe(cap)
          if (holdsBreathAt(sc.steps.cs, cur.index)) {
            seen.add(target)
            pushHoldInto(len, cap, w)
            expect(clock.in0, `${target} seed ${seed} needle ${i}: starts inside the breath`).toBeGreaterThanOrEqual(push0 + w.from + Math.min(NEEDLE_HOLD_MARGIN, 0.1 * (w.to - w.from)) - 1e-6)
            expect(clock.in1, `${target} seed ${seed} needle ${i}: in before the breath ends`).toBeLessThanOrEqual(push0 + w.to - Math.min(NEEDLE_HOLD_MARGIN, 0.1 * (w.to - w.from)) + 1e-6)
            expect(clock.in1 - clock.in0, 'a real travel, not the minutes of the step').toBeGreaterThan(5)
            expect(clock.in1 - clock.in0).toBeLessThanOrEqual(cap)
          } else {
            // the kidney's push holds no breath: its needle clock is the push's 5 % to 80 %, as it always was
            expect(target).toBe('kidney')
            seen.add(target)
            expect(clock.in0).toBeCloseTo(push0 + PUSH_IN0 * len, 9)
            expect(clock.in1).toBeCloseTo(push0 + PUSH_IN1 * len, 9)
          }
          expect(needleInAt(plan, i, sc.steps, since, until)).toBeCloseTo(clock.a + clock.in1, 9)
        }
      }
    }
    expect([...seen].sort()).toEqual(['kidney', 'liver', 'lung'])
  })

  it('in a watch case it is inside the held window too (the whole push part), for every needle of the lung and the liver', () => {
    const w = newHoldWindow()
    const cur = newCursor()
    const clock = newNeedleClock()
    for (const target of ['lung', 'liver'] as const) {
      const h = cryoSuite(31, { crowd: false, hour: 9 })
      h.step(0.1)
      expect(h.cryo.startWatch(target)).toBe('started')
      const demo = h.cryo.runs.find((r) => r.plan.demo)!
      const sc = demo.proc!
      const since = 1000
      const aim = sc.steps.cs.unitIndex.get('aim')!
      const span = sc.steps.totalU[aim]
      expect(apnoeaCap(demo.plan)).toBeNull()
      for (let i = 0; i < demo.plan.needles.length; i++) {
        needleClockInto(demo.plan, sc.steps, i, since, since + span, clock)
        const mid = since + clock.a + 0.5 * (clock.in0 + clock.in1)
        expect(stepAt(sc.steps, 'aim', since, since + span, mid, null, cur)).toBe(true)
        pushHoldInto(cur.until - cur.since, null, w)
        const push0 = cur.since - since - clock.a
        expect(clock.in0).toBeGreaterThanOrEqual(push0 + w.from - 1e-9)
        expect(clock.in1).toBeLessThanOrEqual(push0 + w.to + 1e-9)
      }
    }
  })

  it('as played in the living day: at every tick a needle moves (inserted between 0 and 1 in the aim step) the breath is held, for the lung and the liver', () => {
    const seen = new Set<string>()
    let moving = 0
    for (const [seed, target] of [[3, 'lung'], [3, 'liver'], [77, 'lung'], [77, 'liver']] as const) {
      const base = cryoSuite(seed, { crowd: false })
      const plan = base.cryo.plan.find((p) => targetOf(p) === target)!
      const tl = cryoTimeline(plan)
      // (a warm start just before the case's aim step, played through it)
      const h = cryoSuite(seed, { crowd: false, hour: CONFIG.sim.startHour + (tl.start.aim - 3) / 3600 })
      const s = h.cryo.state
      const end = timeAtHour(CONFIG.sim.startHour + (tl.end.aim + 3) / 3600)
      const longest = { run: 0, now: 0 }
      const fullAt: number[] = []
      for (let i = 0; i < 200000 && h.t < end; i++) {
        h.step(0.1)
        if (s.step !== 'aim' || s.caseId !== plan.id) continue
        s.needles.forEach((n, k) => {
          if (n.inserted >= 1 && fullAt[k] === undefined) fullAt[k] = h.t
        })
        const any = s.needles.some((n) => n.inserted > 0 && n.inserted < 1)
        if (any) {
          moving++
          expect(s.apnoea, `${target} seed ${seed} at ${h.t.toFixed(1)} s: a needle moves while the patient breathes`).toBe(true)
          longest.now += 0.1
          longest.run = Math.max(longest.run, longest.now)
        } else longest.now = 0
      }
      seen.add(`${seed}:${target}`)
      // "Needle k of n" is said as needle k is fully in (the clock sayNeedles reads is the one the scene's needle moves by)
      const said = h.log.events.filter((e) => e.type === 'cryoNeedle' && e.subjectId === `${plan.id}-patient`)
      expect(said.length, `${target} seed ${seed}`).toBe(plan.needles.length)
      said.forEach((e, k) => expect(Math.abs(e.t - fullAt[k]), `${target} seed ${seed} needle ${k + 1}`).toBeLessThanOrEqual(0.25))
      // the longest a needle was moving in one go: a breath's worth, not the minute of the push
      expect(longest.run, `${target} seed ${seed}`).toBeLessThanOrEqual(CONFIG.cryoSuite.apnoeaSeconds + 0.5)
      expect(longest.run, `${target} seed ${seed}`).toBeGreaterThan(5)
    }
    expect(seen.size).toBe(4)
    expect(moving).toBeGreaterThan(100)
  }, 300_000)
})
