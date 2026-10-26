/**
 * R4: the cryoablation day's plan (pure, seeded): the list, the needle paths covering the tumour plus the margin, the step lengths, the demo.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { timeAtHour } from '../population/schedule'
import { Rng } from '../rng'
import { coverRadius, cryoTimeline, ENTRY_X, ENTRY_Y, iceCoverageGap, MARGIN_MM, planCase, planCryoDay, ROOM_STEPS, type PlannedCryoCase } from './plan'

const SEEDS = Array.from({ length: 50 }, (_, i) => 900 + i * 37)
const cfg = CONFIG.cryoSuite

describe('the cryoablation plan', () => {
  it('is the same for the same seed and differs for another', () => {
    expect(JSON.stringify(planCryoDay(new Rng(5).fork('plan')))).toBe(JSON.stringify(planCryoDay(new Rng(5).fork('plan'))))
    expect(JSON.stringify(planCryoDay(new Rng(6).fork('plan')))).not.toBe(JSON.stringify(planCryoDay(new Rng(5).fork('plan'))))
  })

  it('books one case per list hour, jittered inside the band, each after the previous turnover', () => {
    for (const seed of SEEDS) {
      const plan = planCryoDay(new Rng(seed).fork('plan'))
      expect(plan.map((p) => p.id)).toEqual(cfg.listHours.map((_, i) => `cryo-${i + 1}`))
      plan.forEach((p, i) => {
        expect(Math.abs(p.plannedIn - timeAtHour(cfg.listHours[i]))).toBeLessThanOrEqual(cfg.listJitterMinutes * 60 + 1e-6)
        expect(p.demo).toBe(false)
        if (i > 0) expect(p.nominalIn).toBeGreaterThanOrEqual(cryoTimeline(plan[i - 1]).turnoverEnd)
        expect(p.nominalIn).toBeGreaterThanOrEqual(p.plannedIn)
      })
    }
  })

  it('draws the tumour, 2..4 needles (more for a bigger tumour), errors, step lengths and recovery inside their bands', () => {
    const all: PlannedCryoCase[] = SEEDS.flatMap((seed) => planCryoDay(new Rng(seed).fork('plan')))
    for (const p of all) {
      expect(p.tumourMm).toBeGreaterThanOrEqual(cfg.tumourMm[0])
      expect(p.tumourMm).toBeLessThanOrEqual(cfg.tumourMm[1])
      expect(p.needles.length).toBeGreaterThanOrEqual(cfg.needles[0])
      expect(p.needles.length).toBeLessThanOrEqual(Math.min(cfg.needles[1], cfg.maxNeedles))
      for (const n of p.needles) {
        expect(n.errorMm).toBeGreaterThanOrEqual(cfg.aimErrorMm[0] - 0.05)
        expect(n.errorMm).toBeLessThanOrEqual(cfg.aimErrorMm[1] + 0.05)
        // the paths come in from the patient's left (the robot's side), entry well outside the tumour
        expect(n.entry.x).toBeGreaterThan(n.tip.x)
        // inside the band the scene's robot reaches (lateral entries, never up by the table top)
        expect(n.entry.x).toBeGreaterThanOrEqual(ENTRY_X[0])
        expect(n.entry.x).toBeLessThanOrEqual(ENTRY_X[1])
        expect(n.entry.y).toBeGreaterThanOrEqual(ENTRY_Y[0])
        expect(n.entry.y).toBeLessThanOrEqual(ENTRY_Y[1])
        expect(Math.hypot(n.entry.x - n.tip.x, n.entry.y - n.tip.y)).toBeGreaterThan(60)
      }
      expect(p.aimSeconds).toHaveLength(p.needles.length)
      expect(p.steps.aim).toBeCloseTo(p.aimSeconds.reduce((a, b) => a + b, 0), 6)
      for (const s of ROOM_STEPS) {
        const span = s === 'aim' ? cfg.stepMinutes.aimPerNeedle.map((m) => m * p.needles.length) : cfg.stepMinutes[s]
        expect(p.steps[s], s).toBeGreaterThanOrEqual(span[0] * 60 - 1e-6)
        expect(p.steps[s], s).toBeLessThanOrEqual(span[1] * 60 + 1e-6)
      }
      expect(p.pacuSeconds).toBeGreaterThanOrEqual(cfg.pacuMinutes[0] * 60)
      expect(p.pacuSeconds).toBeLessThanOrEqual(cfg.pacuMinutes[1] * 60)
      expect(p.iceMm).toBeGreaterThanOrEqual(cfg.iceMm[0])
      expect(p.iceMm).toBeLessThanOrEqual(cfg.iceMm[1])
      expect(p.iceMm).toBeGreaterThanOrEqual(p.tumourMm + 2 * MARGIN_MM)
    }
    // a bigger tumour never gets fewer needles on average
    const small = all.filter((p) => p.tumourMm < 24).map((p) => p.needles.length)
    const big = all.filter((p) => p.tumourMm > 30).map((p) => p.needles.length)
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    expect(mean(big)).toBeGreaterThan(mean(small))
  })

  it('fans the needle paths so the ice covers the tumour plus at least 5 mm (sampled on a grid offset from the plan\'s)', () => {
    for (const seed of SEEDS) {
      for (const p of planCryoDay(new Rng(seed).fork('plan'))) {
        expect(iceCoverageGap(p, 1, 0.5), `${seed} ${p.id}`).toBe(0)
        expect(iceCoverageGap(p, 1.3, 0.21), `${seed} ${p.id}`).toBe(0)
        // and the per-needle ice is no bigger than needed: it would not cover a tumour 8 mm bigger
        expect(coverRadius(p.needles, p.tumourMm / 2 + MARGIN_MM + 8, 2, 0)).toBeGreaterThan(p.needleIceMm)
      }
    }
  })

  it('has a demo that scales every step and the turnover by demoScale, not the recovery', () => {
    const live = planCase(new Rng(3).fork('x'), 'a', 0, 1000, false)
    const demo = planCase(new Rng(3).fork('x'), 'a', 0, 1000, true)
    expect(demo.needles).toEqual(live.needles)
    for (const s of ROOM_STEPS) expect(demo.steps[s]).toBeCloseTo(live.steps[s] * cfg.demoScale, 6)
    expect(demo.turnoverSeconds).toBeCloseTo(live.turnoverSeconds * cfg.demoScale, 6)
    expect(demo.pacuSeconds).toBeCloseTo(live.pacuSeconds, 6)
  })

  it('lays the timeline out step after step from nominalIn', () => {
    const p = planCryoDay(new Rng(11).fork('plan'))[0]
    const tl = cryoTimeline(p)
    let at = p.nominalIn
    for (const s of ROOM_STEPS) {
      expect(tl.start[s]).toBeCloseTo(at, 6)
      at += p.steps[s]
      expect(tl.end[s]).toBeCloseTo(at, 6)
    }
    expect(tl.roomEnd).toBe(tl.end.out)
    expect(tl.turnoverEnd).toBeCloseTo(tl.roomEnd + p.turnoverSeconds, 6)
    expect(tl.pacuOut).toBeCloseTo(tl.pacuIn + p.pacuSeconds, 6)
  })
})
