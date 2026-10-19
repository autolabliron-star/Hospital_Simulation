import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Rng } from '../rng'
import { manualSecondsFor, planDraw, plannedOutcome, straightSeconds, tubeSeconds, type PlanRng } from './plan'

const FOUR = ['citrate', 'serum', 'heparin', 'EDTA'] as const

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

describe('the robot draw plan', () => {
  it('a 4-tube straight draw takes 150-240 s from the card scan to the bandage, median 170-215', () => {
    const rng = new Rng(404)
    const times: number[] = []
    for (let i = 0; i < 2000; i++) times.push(straightSeconds(planDraw(rng, FOUR)))
    times.sort((a, b) => a - b)
    const median = pct(times, 0.5)
    expect(median).toBeGreaterThanOrEqual(170)
    expect(median).toBeLessThanOrEqual(215)
    // the whole spread sits inside the research band (MagicNurse 205 s, Aletta median 157 s)
    expect(pct(times, 0.005)).toBeGreaterThanOrEqual(150)
    expect(pct(times, 0.995)).toBeLessThanOrEqual(240)
    expect(times[0]).toBeGreaterThanOrEqual(145)
    expect(times[times.length - 1]).toBeLessThanOrEqual(245)
  })

  it('keeps the tubes in the order of draw, once each, with their inversions from the content', () => {
    const plan = planDraw(new Rng(1), FOUR)
    expect(plan.tubes.map((t) => t.kind)).toEqual([...FOUR])
    expect(plan.tubes.map((t) => t.inversions)).toEqual([4, 5, 8, 8])
    for (const t of plan.tubes) {
      expect(t.fill).toBeGreaterThanOrEqual(CONFIG.blood.fillSeconds[t.kind][0])
      expect(t.fill).toBeLessThanOrEqual(CONFIG.blood.fillSeconds[t.kind][1])
      expect(tubeSeconds(t)).toBeCloseTo(t.fill + t.inversions * CONFIG.blood.inversionSeconds, 9)
    }
  })

  it('the nurse draws 4.5-8 % of 2,000 seeded plans (no vein, two missed sticks, or the arm moving twice)', () => {
    const rng = new Rng(2026)
    let nurse = 0
    const reasons: Record<string, number> = { noVein: 0, missed: 0, moved: 0 }
    const n = 2000
    for (let i = 0; i < n; i++) {
      const o = plannedOutcome(planDraw(rng, ['EDTA', 'heparin']))
      if (o.by === 'nurse') {
        nurse++
        reasons[o.reason]++
      }
    }
    expect(nurse / n).toBeGreaterThanOrEqual(0.045)
    expect(nurse / n).toBeLessThanOrEqual(0.08)
    // no vein is the main reason (about 6 %)
    expect(reasons.noVein).toBeGreaterThan(reasons.missed + reasons.moved)
  })

  it('the first stick holds about 94.5 % of the time when a vein is found', () => {
    const rng = new Rng(77)
    let found = 0
    let first = 0
    for (let i = 0; i < 4000; i++) {
      const p = planDraw(rng, ['EDTA'])
      if (p.noVein) continue
      found++
      if (!p.attempts[0].missed) first++
    }
    expect(first / found).toBeGreaterThan(0.92)
    expect(first / found).toBeLessThan(0.97)
  })

  it('is the same plan for the same stream, and draws the same number of values whatever the outcome', () => {
    const a = planDraw(new Rng(9), FOUR)
    const b = planDraw(new Rng(9), FOUR)
    expect(b).toEqual(a)
    const count = (force: boolean) => {
      let n = 0
      const rng: PlanRng = {
        between: (span) => {
          n++
          return (span[0] + span[1]) / 2
        },
        chance: () => {
          n++
          return force
        },
        int: (lo) => {
          n++
          return lo
        },
      }
      planDraw(rng, FOUR)
      return n
    }
    expect(count(true)).toBe(count(false))
  })

  it('a hand draw is shorter for fewer remaining tubes, inside 55-90 s for a full set', () => {
    const rng = new Rng(5)
    for (let i = 0; i < 200; i++) {
      const p = planDraw(rng, FOUR)
      expect(p.manualSeconds).toBeGreaterThanOrEqual(55)
      expect(p.manualSeconds).toBeLessThanOrEqual(90)
      expect(manualSecondsFor(p, 4)).toBeCloseTo(p.manualSeconds, 9)
      expect(manualSecondsFor(p, 1)).toBeLessThan(manualSecondsFor(p, 4))
    }
  })
})
