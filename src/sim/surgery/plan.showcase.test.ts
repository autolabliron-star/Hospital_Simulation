/**
 * S1: the showcase day's plan (plan.ts, `planDay(rng, 'showcase')`). The quiet plan is byte-identical to before the showcase existed; the
 * showcase lands a case at the console and an early case in recovery at the anchor hour, with the next patient already in a pre-op bay.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { timeAtHour } from '../population/schedule'
import { Rng } from '../rng'
import { ARRIVE_SECONDS, planDay, timelineOf, type PlannedCase } from './plan'

const SEEDS = Array.from({ length: 60 }, (_, i) => 3000 + i * 53)
const SC = CONFIG.surgery.showcase
const anchor = timeAtHour(SC.anchorHour)
const min = (s: number) => s / 60

/** sha1 of JSON.stringify(planDay(new Rng(seed))) before S1 (with the new `earlyBayAt: null` field left out). */
const QUIET_SHA1: Record<number, string> = {
  1: 'db81d321e8cae8984253dbb9674b7fe5b6974a2b',
  7: 'da5a667692e82279fb653ebc27a8ef5a8abb1d8b',
  42: '9ede48610ab5bc73ed836c748be73f956dca79f4',
  1000: '4734b3d6f2ddf0f0bc81648e6821987e4206d8e0',
  5101: 'd6146dddda647fcc7646c6ed43b107bcfbf63ef5',
  9999: 'ed3c4c5db626652d96c49a9f9092b7a2768827cd',
  31337: '5ba7163836bb682b4d0440cd8d9b86ebb931f489',
  123456: 'e35d90cef94cdec19838130c3b801390116ce14f',
}

const showcase = SEEDS.map((s) => planDay(new Rng(s), 'showcase'))

describe('planDay quiet', () => {
  it('is byte-identical to the plan before the showcase existed (earlyBayAt aside, always null)', () => {
    for (const [seed, sha] of Object.entries(QUIET_SHA1)) {
      const plan = planDay(new Rng(Number(seed)))
      for (const c of plan) expect(c.earlyBayAt).toBeNull()
      const json = JSON.stringify(plan, (k, v) => (k === 'earlyBayAt' ? undefined : v))
      expect(createHash('sha1').update(json).digest('hex'), `seed ${seed}`).toBe(sha)
      expect(JSON.stringify(planDay(new Rng(Number(seed)), 'quiet'))).toBe(JSON.stringify(plan))
    }
  })

  it('has visitsAt = nurseEnd for every case, so the visits follow the nurse as before', () => {
    for (const seed of SEEDS) {
      for (const c of planDay(new Rng(seed))) {
        const tl = timelineOf(c)
        expect(tl.visitsAt).toBe(tl.nurseEnd)
        expect(tl.anaesEnd).toBe(tl.nurseEnd + c.preOp.anaes)
      }
    }
  })
})

describe('planDay showcase', () => {
  it('is deterministic', () => {
    for (const seed of SEEDS.slice(0, 10)) expect(JSON.stringify(planDay(new Rng(seed), 'showcase'))).toBe(JSON.stringify(planDay(new Rng(seed), 'showcase')))
    expect(JSON.stringify(showcase[0])).not.toBe(JSON.stringify(showcase[1]))
  })

  it('opens with the early case and the console case, then the seeded template', () => {
    for (const plan of showcase) {
      expect(plan.length).toBeGreaterThanOrEqual(3)
      expect(plan.map((c) => c.index)).toEqual(plan.map((_, i) => i))
      expect(new Set(plan.map((c) => c.id)).size).toBe(plan.length)
      expect(plan[0].procedure).toBe(SC.early)
      expect(plan[0].outcome).toBe('home')
      expect(plan[1].procedure).toBe(SC.atConsole)
      expect(plan[0].delay).toBe(0)
      expect(plan[1].delay).toBe(0)
      for (const c of plan) expect(c.plannedIn).toBeLessThanOrEqual(timeAtHour(CONFIG.surgery.lastStartHour))
    }
  })

  it('has the console case in its console phase at the anchor hour, 8 to 14 minutes in, robot docked and surgeon seated', () => {
    for (const plan of showcase) {
      const c = plan[1]
      const tl = timelineOf(c)
      const elapsed = anchor - tl.phaseStart.console
      expect(tl.phaseEnd.docking, c.id).toBeCloseTo(tl.phaseStart.console, 6)
      expect(min(elapsed)).toBeGreaterThanOrEqual(SC.consoleElapsedMinutes[0] - 1e-6)
      expect(min(elapsed)).toBeLessThanOrEqual(SC.consoleElapsedMinutes[1] + 1e-6)
      expect(anchor).toBeLessThan(tl.phaseEnd.console)
      expect(c.nominalIn).toBe(c.plannedIn)
    }
  })

  it('has the early case in recovery at the anchor hour with 15 to 25 minutes left, then home', () => {
    let longest = 0
    for (const plan of showcase) {
      const c = plan[0]
      const tl = timelineOf(c)
      expect(tl.pacuIn).toBeLessThan(anchor)
      const left = tl.pacuOut - anchor
      expect(min(left)).toBeGreaterThanOrEqual(SC.pacuLeftMinutes[0] - 1e-6)
      expect(min(left)).toBeLessThanOrEqual(SC.pacuLeftMinutes[1] + 1e-6)
      expect(tl.phase2End).toBeGreaterThan(tl.pacuOut)
      expect(c.outcome).toBe('home')
      // (its recovery is derived from the layout: long, but never absurd)
      expect(min(c.pacuSeconds)).toBeGreaterThanOrEqual(CONFIG.surgery.pacuMinutes[0])
      longest = Math.max(longest, min(c.pacuSeconds))
    }
    expect(longest).toBeLessThanOrEqual(CONFIG.surgery.pacuMinutes[1] + 30)
  })

  it('turns the room over for the drawn turnover between each case out and the next one in', () => {
    for (const plan of showcase) {
      const tl0 = timelineOf(plan[0])
      expect(plan[1].nominalIn - tl0.outAt).toBeCloseTo(plan[0].turnoverSeconds, 6)
      expect(min(plan[0].turnoverSeconds)).toBeGreaterThanOrEqual(CONFIG.surgery.turnoverMinutes[0])
      expect(min(plan[0].turnoverSeconds)).toBeLessThanOrEqual(CONFIG.surgery.turnoverMinutes[1])
      for (let i = 1; i < plan.length; i++) {
        const prev = timelineOf(plan[i - 1])
        expect(plan[i].nominalIn - prev.outAt, `${plan[i].id}`).toBeGreaterThanOrEqual(plan[i - 1].turnoverSeconds - 1e-6)
      }
    }
  })

  it('has the first template case lying in a pre-op bay from nextBayHour, waiting there until the visits fit in front of wheels-in', () => {
    for (const plan of showcase) {
      const c = plan[2]
      const bayAt = timeAtHour(SC.nextBayHour)
      expect(c.earlyBayAt).toBe(bayAt)
      const tl = timelineOf(c)
      expect(tl.preOpStart).toBe(bayAt)
      expect(tl.upstairsBy).toBeLessThanOrEqual(bayAt)
      expect(c.arriveAt).toBeLessThanOrEqual(bayAt - ARRIVE_SECONDS)
      // on a bed at the anchor hour, gowned and checked by the nurse; the doctors come after the previous case has left the room
      expect(anchor).toBeGreaterThan(tl.preOpStart)
      expect(tl.nurseEnd).toBeGreaterThan(anchor)
      expect(tl.visitsAt).toBeGreaterThan(tl.nurseEnd)
      expect(tl.visitsAt).toBeGreaterThan(timelineOf(plan[1]).outAt)
      expect(tl.anaesEnd).toBeCloseTo(tl.visitsAt + c.preOp.anaes, 6)
      expect(tl.readyAt - tl.anaesEnd).toBeCloseTo(c.preOp.surgeon, 6)
      // nobody else is early
      for (const o of plan) if (o !== c) expect(o.earlyBayAt).toBeNull()
    }
  })

  it('keeps the template cases\' draws (their forks), only their times shift', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const quiet = planDay(new Rng(seed))
      const plan = planDay(new Rng(seed), 'showcase')
      const strip = (c: PlannedCase) => {
        const { id: _i, index: _x, plannedIn: _p, nominalIn: _n, arriveAt: _a, earlyBayAt: _e, ...rest } = c
        return JSON.stringify(rest)
      }
      const n = Math.min(quiet.length, plan.length - 2)
      expect(n).toBeGreaterThanOrEqual(1)
      for (let k = 0; k < n; k++) expect(strip(plan[k + 2]), `seed ${seed} case ${k}`).toBe(strip(quiet[k]))
    }
  })

  it('the first team spawn hour is derived: the quiet plan keeps teamFromHour, the showcase starts well before the early case is draped', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const quiet = planDay(new Rng(seed))
      expect(timelineOf(quiet[0]).drapeStart).toBeGreaterThan(timeAtHour(CONFIG.surgery.teamFromHour) + 1200)
      const first = timelineOf(showcase[SEEDS.indexOf(seed)][0])
      expect(first.drapeStart).toBeLessThan(timeAtHour(CONFIG.day.startHour))
    }
  })
})
