/**
 * The robotic day's plan (plan.ts) is pure and seeded: the same seed plans the same list, and every number is inside its CONFIG.surgery band.
 */
import { describe, expect, it } from 'vitest'
import { SURGERY_COPY } from '@/content/surgery'
import { CONFIG } from '../config'
import { timeAtHour } from '../population/schedule'
import { Rng } from '../rng'
import { ARRIVE_SECONDS, planDay, ROOM_PHASES, timelineOf, type PlannedCase } from './plan'

const SEEDS = Array.from({ length: 50 }, (_, i) => 1000 + i * 37)
const plans = SEEDS.map((s) => planDay(new Rng(s)))

describe('planDay', () => {
  it('is deterministic: the same seed gives the same list, down to the exchanges', () => {
    for (const seed of SEEDS.slice(0, 10)) expect(JSON.stringify(planDay(new Rng(seed)))).toBe(JSON.stringify(planDay(new Rng(seed))))
    expect(JSON.stringify(plans[0])).not.toBe(JSON.stringify(plans[1]))
  })

  it('uses one of the templates, starts at firstInHour, and never starts a case after lastStartHour', () => {
    for (const plan of plans) {
      expect(plan.length).toBeGreaterThanOrEqual(2)
      const names = plan.map((c) => c.procedure)
      expect(CONFIG.surgery.templates.some((t) => t.length >= names.length && names.every((n, i) => t[i] === n))).toBe(true)
      expect(plan[0].plannedIn).toBeCloseTo(timeAtHour(CONFIG.surgery.firstInHour), 6)
      for (const c of plan) expect(c.plannedIn).toBeLessThanOrEqual(timeAtHour(CONFIG.surgery.lastStartHour))
    }
  })

  it('draws room time and console time inside their bands, and the ten phases add up to the room time', () => {
    for (const plan of plans) {
      for (const c of plan) {
        const [rLo, rHi] = CONFIG.surgery.roomMinutes[c.procedure]
        const [cLo, cHi] = CONFIG.surgery.consoleMinutes[c.procedure]
        expect(c.roomSeconds / 60).toBeGreaterThanOrEqual(rLo)
        expect(c.roomSeconds / 60).toBeLessThanOrEqual(rHi)
        expect(c.consoleSeconds / 60).toBeGreaterThanOrEqual(cLo)
        expect(c.consoleSeconds / 60).toBeLessThanOrEqual(cHi)
        expect(c.phases.console).toBe(c.consoleSeconds)
        let sum = 0
        for (const p of ROOM_PHASES) {
          expect(c.phases[p], `${c.id} ${p}`).toBeGreaterThan(60)
          sum += c.phases[p]
        }
        expect(sum).toBeCloseTo(c.roomSeconds, 6)
        // the other phases are scaled together but stay close to real life (never below 60 % of their band's low end)
        for (const p of ROOM_PHASES) {
          if (p === 'console') continue
          expect(c.phases[p] / 60, `${c.procedure} ${p}`).toBeGreaterThanOrEqual(CONFIG.surgery.phaseMinutes[p][0] * 0.6)
          expect(c.phases[p] / 60, `${c.procedure} ${p}`).toBeLessThanOrEqual(CONFIG.surgery.phaseMinutes[p][1] + 1e-9)
        }
      }
    }
  })

  it('draws the visits, the recovery, the turnover and the drape inside their bands', () => {
    for (const plan of plans) {
      for (const c of plan) {
        const m = (x: number) => x / 60
        const inBand = (x: number, band: readonly [number, number]) => {
          expect(m(x)).toBeGreaterThanOrEqual(band[0])
          expect(m(x)).toBeLessThanOrEqual(band[1])
        }
        inBand(c.preOp.gown, CONFIG.surgery.preOpMinutes.gown)
        inBand(c.preOp.nurse, CONFIG.surgery.preOpMinutes.nurse)
        inBand(c.preOp.anaes, CONFIG.surgery.preOpMinutes.anaesthetist)
        inBand(c.preOp.surgeon, CONFIG.surgery.preOpMinutes.surgeon)
        inBand(c.pacuSeconds, CONFIG.surgery.pacuMinutes)
        inBand(c.turnoverSeconds, CONFIG.surgery.turnoverMinutes)
        inBand(c.drapeSeconds, CONFIG.surgery.drapeMinutes)
        if (c.outcome === 'home') inBand(c.phase2Seconds, CONFIG.surgery.phase2Minutes)
        else expect(c.phase2Seconds).toBe(0)
      }
    }
  })

  it('chains the list: planned wheels-in = the previous plus its room time and turnover; a late case delays the next through the turnover', () => {
    for (const plan of plans) {
      plan.forEach((c, k) => {
        if (k === 0) return
        const prev = plan[k - 1]
        expect(c.plannedIn).toBeCloseTo(prev.plannedIn + prev.roomSeconds + prev.turnoverSeconds, 6)
        // the room really frees up this late, and the case runs no earlier than that or than its own schedule
        expect(c.nominalIn).toBeGreaterThanOrEqual(prev.nominalIn + prev.roomSeconds + prev.turnoverSeconds - 1e-6)
        expect(c.nominalIn).toBeGreaterThanOrEqual(c.plannedIn - 1e-6)
      })
      for (const c of plan) {
        expect(c.nominalIn).toBeCloseTo(Math.max(c.plannedIn + c.delay, plan[c.index - 1] ? plan[c.index - 1].nominalIn + plan[c.index - 1].roomSeconds + plan[c.index - 1].turnoverSeconds : -Infinity), 6)
      }
    }
    // some seeds run late, some on time
    const delays = plans.flatMap((p) => p.map((c) => c.delay))
    expect(delays.some((d) => d > 0)).toBe(true)
    expect(delays.some((d) => d === 0)).toBe(true)
  })

  it('has every patient arrive 60-90 minutes before the planned wheels-in, in time to be gowned before their pre-op visits begin', () => {
    for (const plan of plans) {
      for (const c of plan) {
        const before = (c.plannedIn - c.arriveAt) / 60
        expect(before).toBeGreaterThanOrEqual(CONFIG.surgery.arriveBeforeMinutes[0])
        expect(before).toBeLessThanOrEqual(CONFIG.surgery.arriveBeforeMinutes[1])
        const tl = timelineOf(c)
        expect(tl.preOpStart).toBeGreaterThanOrEqual(c.arriveAt + ARRIVE_SECONDS)
      }
    }
  })

  it('sends day cases home and ward cases up by the seeded shares (a prostatectomy is never a day case)', () => {
    const all: PlannedCase[] = plans.flat()
    for (const c of all) if (c.procedure === 'prostatectomy') expect(c.outcome).toBe('ward')
    const chole = all.filter((c) => c.procedure === 'cholecystectomy')
    const home = chole.filter((c) => c.outcome === 'home').length / chole.length
    expect(chole.length).toBeGreaterThan(40)
    expect(home).toBeGreaterThan(0.75)
    expect(home).toBeLessThan(1)
    expect(all.some((c) => c.outcome === 'home')).toBe(true)
    expect(all.some((c) => c.outcome === 'ward')).toBe(true)
  })

  it('plans the instrument exchanges inside the console phase: never on the endoscope arm, never repeating what the arm holds', () => {
    for (const plan of plans) {
      for (const c of plan) {
        const copy = SURGERY_COPY.procedures[c.procedure]
        const held = copy.instruments.slice()
        expect(c.exchanges.length).toBeGreaterThanOrEqual(1)
        let last = -1
        for (const e of c.exchanges) {
          expect(e.at).toBeGreaterThan(0)
          expect(e.at).toBeLessThan(c.consoleSeconds)
          expect(e.at).toBeGreaterThanOrEqual(last)
          last = e.at
          expect(e.arm).not.toBe(1)
          expect(e.instrument).not.toBe(held[e.arm])
          expect(held.includes(e.instrument)).toBe(false)
          held[e.arm] = e.instrument
        }
        // roughly exchangesPerHour: a short case has a few, a long one a dozen
        const perHour = (c.exchanges.length / c.consoleSeconds) * 3600
        expect(perHour).toBeGreaterThan(CONFIG.surgery.exchangesPerHour[0] * 0.4)
        expect(perHour).toBeLessThan(CONFIG.surgery.exchangesPerHour[1] * 1.6)
      }
    }
  })

  it('lays the timeline out in order, and every stage fits before the next', () => {
    for (const plan of plans) {
      for (const c of plan) {
        const tl = timelineOf(c)
        const order = [tl.arriveAt, tl.upstairsBy, tl.preOpStart, tl.gownEnd, tl.nurseEnd, tl.anaesEnd, tl.readyAt, tl.toTheatreAt, c.nominalIn]
        for (let i = 1; i < order.length; i++) expect(order[i], `${c.id} step ${i}`).toBeGreaterThan(order[i - 1])
        expect(tl.drapeEnd).toBeLessThan(c.nominalIn)
        expect(tl.drapeStart).toBeLessThan(tl.drapeEnd)
        let at = c.nominalIn
        for (const p of ROOM_PHASES) {
          expect(tl.phaseStart[p]).toBeCloseTo(at, 6)
          at += c.phases[p]
          expect(tl.phaseEnd[p]).toBeCloseTo(at, 6)
        }
        expect(tl.outAt).toBeCloseTo(c.nominalIn + c.roomSeconds, 6)
        expect(tl.pacuOut).toBeGreaterThan(tl.pacuIn)
        expect(tl.leftAt).toBeGreaterThan(tl.pacuOut)
        // the whole case is done well within the day
        expect(tl.leftAt).toBeLessThan(timeAtHour(CONFIG.surgery.teamToHour))
      }
    }
  })
})
