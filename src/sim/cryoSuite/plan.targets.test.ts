/**
 * R5 wave 3: the cryo plan's targets (pure, seeded): a kidney case is R4's (the golden test holds it byte for byte), lung and liver cases have their own
 * bands and protocols, the day's list draws its targets on its own fork, and a watch case takes the script's seconds.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Rng } from '../rng'
import type { CryoTarget } from '../types'
import { ALL_ROOM_STEPS, coverRadius, cryoTimeline, iceCoverageGap, MARGIN_MM, planCase, planCryoDay, roomStepsFor, ROOM_STEPS, secondsOf, targetOf, type PlannedCryoCase } from './plan'
import { compiledForTarget, watchTimesFor } from './script'
import { targetSettings } from './targets'

const SEEDS = Array.from({ length: 50 }, (_, i) => 700 + i * 41)
const cfg = CONFIG.cryoSuite
const TARGETS: readonly CryoTarget[] = ['kidney', 'lung', 'liver']

function plans(target: CryoTarget): PlannedCryoCase[] {
  return SEEDS.map((seed) => planCase(new Rng(seed), `p-${seed}`, 0, 36000, false, target))
}

describe('the cryo plan\'s targets', () => {
  it('plans a kidney exactly as before: no target field, no anchor steps, and the same case with the target spelled out', () => {
    for (const seed of SEEDS) {
      const plain = planCase(new Rng(seed), 'k', 0, 36000, false)
      const named = planCase(new Rng(seed), 'k', 0, 36000, false, 'kidney')
      expect(JSON.stringify(named)).toBe(JSON.stringify(plain))
      expect('target' in plain).toBe(false)
      expect(Object.keys(plain.steps)).toEqual([...ROOM_STEPS])
      expect(targetOf(plain)).toBe('kidney')
    }
  })

  it('has the default day all kidney (R4\'s) and the mixed day draw its targets on their own fork: a kidney of the mixed day is the default day\'s case', () => {
    const kinds = new Set<CryoTarget>()
    for (const seed of SEEDS) {
      const plain = planCryoDay(new Rng(seed).fork('plan'))
      const mixed = planCryoDay(new Rng(seed).fork('plan'), { mixed: true })
      expect(plain.every((p) => targetOf(p) === 'kidney')).toBe(true)
      expect(mixed.map((p) => p.id)).toEqual(plain.map((p) => p.id))
      mixed.forEach((p, i) => {
        kinds.add(targetOf(p))
        // (the day's times chain on the earlier cases' turnover, so only a day that starts with a kidney is compared whole)
        if (targetOf(p) === 'kidney' && mixed.slice(0, i).every((q) => targetOf(q) === 'kidney')) expect(JSON.stringify(p)).toBe(JSON.stringify(plain[i]))
      })
      expect(JSON.stringify(planCryoDay(new Rng(seed).fork('plan'), { mixed: true }))).toBe(JSON.stringify(mixed))
    }
    expect([...kinds].sort()).toEqual(['kidney', 'liver', 'lung'])
  })

  it('draws the targets by the configured shares over many cases', () => {
    const count: Record<CryoTarget, number> = { kidney: 0, lung: 0, liver: 0 }
    let n = 0
    for (let seed = 1; seed <= 600; seed++) for (const p of planCryoDay(new Rng(seed).fork('plan'), { mixed: true })) (count[targetOf(p)]++, n++)
    for (const t of TARGETS) expect(count[t] / n, t).toBeCloseTo(cfg.dayTargetShare[t], 1)
  })

  it('gives the lung the anchor freeze and thaw (3 + 3 minutes) and the others none; every step is inside its band', () => {
    for (const target of TARGETS) {
      const ts = targetSettings(target)
      for (const p of plans(target)) {
        expect(roomStepsFor(target).includes('anchorFreeze'), target).toBe(target === 'lung')
        expect(Object.keys(p.steps).sort(), `${target} ${p.id}`).toEqual(roomStepsFor(target).slice().sort())
        for (const s of roomStepsFor(target)) {
          if (s === 'aim') {
            const extra = ts.minutes('aimExtra')
            const lo = cfg.targets[target].stepMinutes?.aimPerNeedle ?? cfg.stepMinutes.aimPerNeedle
            expect(p.steps.aim, `${target} aim`).toBeGreaterThanOrEqual(lo[0] * 60 * p.needles.length + (extra?.[0] ?? 0) * 60 - 1e-6)
            expect(p.steps.aim, `${target} aim`).toBeLessThanOrEqual(lo[1] * 60 * p.needles.length + (extra?.[1] ?? 0) * 60 + 1e-6)
            continue
          }
          const m = ts.minutes(s)!
          expect(secondsOf(p, s), `${target} ${s}`).toBeGreaterThanOrEqual(m[0] * 60 - 1e-6)
          expect(secondsOf(p, s), `${target} ${s}`).toBeLessThanOrEqual(m[1] * 60 + 1e-6)
        }
        expect(p.aimSeconds).toHaveLength(p.needles.length)
        expect(p.needles.length).toBeGreaterThanOrEqual(ts.needles[0])
        expect(p.needles.length).toBeLessThanOrEqual(Math.min(ts.needles[1], cfg.maxNeedles))
        expect(p.tumourMm).toBeGreaterThanOrEqual(ts.tumourMm[0])
        expect(p.tumourMm).toBeLessThanOrEqual(ts.tumourMm[1])
        expect(p.iceMm).toBeGreaterThanOrEqual(ts.iceMm[0])
        expect(p.iceMm).toBeLessThanOrEqual(ts.iceMm[1])
        expect(p.iceMm).toBeGreaterThanOrEqual(p.tumourMm + 2 * MARGIN_MM)
      }
    }
    // the lung's triple freeze 3-3-10-5-10 with the active thaw after it
    const lung = plans('lung')[0]
    expect([lung.steps.anchorFreeze, lung.steps.anchorThaw, lung.steps.freeze1, lung.steps.thaw, lung.steps.freeze2].map((v) => v! / 60)).toEqual([3, 3, 10, 5, 10])
    // the liver's 10-8-10 style: thaw 8-10, freezes 10-12
    for (const p of plans('liver')) expect(p.steps.thaw / 60).toBeGreaterThanOrEqual(8)
  })

  it('keeps the needle paths inside each target\'s band and covering the tumour plus the margin', () => {
    for (const target of TARGETS) {
      const ap = targetSettings(target).approach
      for (const p of plans(target)) {
        for (const n of p.needles) {
          expect(n.entry.x, `${target} ${p.id}`).toBeGreaterThanOrEqual(ap.entryX[0])
          expect(n.entry.x).toBeLessThanOrEqual(ap.entryX[1])
          expect(n.entry.y).toBeGreaterThanOrEqual(ap.entryY[0])
          expect(n.entry.y).toBeLessThanOrEqual(ap.entryY[1])
          // the paths come in from the robot's side, in the PATIENT's frame (the slice: +x her left, +y posterior; src/sim/procedure/ctSlice.ts): the kidney's from her left flank
          // (+x), the prone ones from the back (posterior: +y), not from her left (south, away from the robot: +x) by more than a centimetre
          if (target === 'kidney') expect(n.entry.x).toBeGreaterThan(n.tip.x)
          else {
            expect(n.entry.x, `${target} does not enter from her left`).toBeLessThan(n.tip.x + 10)
            expect(n.entry.y, `${target} enters from the back`).toBeGreaterThan(n.tip.y)
          }
          expect(Math.hypot(n.entry.x - n.tip.x, n.entry.y - n.tip.y)).toBeGreaterThan(40)
        }
        expect(iceCoverageGap(p, 1, 0.5), `${target} ${p.id}`).toBe(0)
        expect(iceCoverageGap(p, 1.3, 0.21), `${target} ${p.id}`).toBe(0)
        expect(coverRadius(p.needles, p.tumourMm / 2 + MARGIN_MM + 8, 2, 0)).toBeGreaterThan(p.needleIceMm)
      }
    }
  })

  it('lays the timeline of every target out step after step, the anchors zero-length unless the lung has them', () => {
    for (const target of TARGETS) {
      const p = plans(target)[3]
      const tl = cryoTimeline(p)
      let at = p.nominalIn
      for (const s of ALL_ROOM_STEPS) {
        expect(tl.start[s], `${target} ${s}`).toBeCloseTo(at, 6)
        at += secondsOf(p, s)
        expect(tl.end[s], `${target} ${s}`).toBeCloseTo(at, 6)
      }
      expect(tl.roomEnd).toBe(tl.end.out)
      if (target !== 'lung') expect(tl.end.anchorThaw - tl.start.anchorFreeze).toBe(0)
    }
  })

  it('takes a watch case\'s unit lengths from its script: the script\'s watch seconds, the needle run once per needle, 600-900 s in all', () => {
    for (const target of TARGETS) {
      const times = watchTimesFor(target)!
      expect(times.needles).toBe(cfg.watchNeedles[target])
      const cs = compiledForTarget(target)!
      for (const seed of SEEDS.slice(0, 12)) {
        const p = planCase(new Rng(seed), 'w', 0, 1000, true, target, times)
        expect(p.demo).toBe(true)
        expect(p.needles).toHaveLength(times.needles)
        // (the first needle in full, the later ones as the script's quicker repeats: ~20 s each, the schema's floor being 8 s a step)
        expect(p.aimSeconds).toEqual(Array.from({ length: times.needles }, (_, i) => (i === 0 ? times.needleSeconds : times.repeatNeedleSeconds)))
        let total = 0
        for (const s of roomStepsFor(target)) {
          expect(secondsOf(p, s), `${target} ${s}`).toBe(times.units[s] ?? 0)
          total += secondsOf(p, s)
        }
        expect(total).toBeGreaterThanOrEqual(600)
        expect(total).toBeLessThanOrEqual(900)
        expect(iceCoverageGap(p, 1, 0.5)).toBe(0)
      }
      // the whole script's seconds with n needles, whatever n the plan may hold (1..4: the plan's most is 4)
      expect(targetSettings(target).needles[1]).toBeLessThanOrEqual(4)
      for (let n = 1; n <= 4; n++) {
        const t = watchTimesFor(target, n)!
        const sum = Object.values(t.units).reduce((a, b) => a + b, 0)
        expect(sum, `${target} with ${n} needles`).toBeGreaterThanOrEqual(600)
        expect(sum, `${target} with ${n} needles`).toBeLessThanOrEqual(900)
      }
      expect(cs.repeatLen, target).toBe(3)
    }
  })

  it('keeps a watch plan without a script on the old scaling (every step x demoScale)', () => {
    const live = planCase(new Rng(3).fork('x'), 'a', 0, 1000, false)
    const demo = planCase(new Rng(3).fork('x'), 'a', 0, 1000, true)
    expect(demo.needles).toEqual(live.needles)
    for (const s of ROOM_STEPS) expect(demo.steps[s]).toBeCloseTo(live.steps[s] * cfg.demoScale, 6)
  })
})
