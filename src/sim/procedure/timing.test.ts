/**
 * R5: the step-by-step engine's clock. The windows of a unit tile exactly by step weight, the steps never go backwards, the robot's own
 * sub-windows are the slots, a live case's jitter is seeded per fork, and nothing the frame loop runs allocates.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '../rng'
import { segmentAt, DOCK_SPLIT, UNDOCK_SPLIT, type RobotCaseTimes } from '../surgery/robot'
import { CONFIG } from '../config'
import { caseSteps, compileScript, compiledFor, midSeconds, type CaseSteps } from './script'
import { davinciSlots, newCursor, stepAt, watchTotalSeconds, watchUnitSeconds, type SlotWindow } from './timing'
import { davinciWindows, synthCryo } from './testkit'

const cs = compiledFor('or-cholecystectomy')!
const SEEDS = [1, 7, 42, 1000, 31337]

function laid(mode: 'live' | 'watch', seed: number): CaseSteps {
  return caseSteps(cs, mode, mode === 'live' ? new Rng(seed).fork('script') : null)
}

describe('stepAt: the windows tile each unit exactly', () => {
  for (const mode of ['live', 'watch'] as const) {
    it(`${mode}: every step of every unit is visited once, in order, window after window with no gap or overlap`, () => {
      for (const seed of SEEDS) {
        const steps = laid(mode, seed)
        const cur = newCursor()
        for (const w of davinciWindows(seed)) {
          const slots = w.unit === 'docking' || w.unit === 'undocking' ? davinciSlots : null
          const seen: { flat: number; since: number; until: number }[] = []
          const N = 4000
          for (let j = 0; j < N; j++) {
            const t = w.since + ((w.until - w.since) * (j + 0.5)) / N
            expect(stepAt(steps, w.unit, w.since, w.until, t, slots, cur)).toBe(true)
            const last = seen[seen.length - 1]
            if (last === undefined || last.flat !== cur.flat) seen.push({ flat: cur.flat, since: cur.since, until: cur.until })
          }
          const u = cs.unitIndex.get(w.unit)!
          expect(seen.map((s) => s.flat), `${w.unit} seed ${seed}`).toEqual(Array.from({ length: steps.uLen[u] }, (_, i) => steps.uFirst[u] + i))
          expect(seen[0].since, `${w.unit}: starts with the unit`).toBe(w.since)
          expect(seen[seen.length - 1].until, `${w.unit}: ends with the unit`).toBe(w.until)
          for (let i = 1; i < seen.length; i++) expect(seen[i].since, `${w.unit} step ${i}`).toBe(seen[i - 1].until)
        }
      }
    })
  }

  it('gives each unslotted step its weight share of the window (the live middles, or the watch seconds)', () => {
    for (const mode of ['live', 'watch'] as const) {
      const steps = laid(mode, 7)
      const cur = newCursor()
      const w = davinciWindows(7).find((x) => x.unit === 'console')!
      const u = cs.unitIndex.get('console')!
      for (let f = steps.uFirst[u]; f < steps.uFirst[u] + steps.uLen[u]; f++) {
        const mid = (steps.cumU0[f] + steps.cumU1[f]) / 2 / steps.totalU[u]
        stepAt(steps, 'console', w.since, w.until, w.since + (w.until - w.since) * mid, null, cur)
        expect(cur.flat).toBe(f)
        expect((cur.until - cur.since) / (w.until - w.since)).toBeCloseTo(steps.weight[f] / steps.totalU[u], 9)
        expect(cur.progress).toBeCloseTo(0.5, 9)
      }
    }
  })

  it('a watch window of watchUnitSeconds makes every step last exactly its watch seconds', () => {
    const steps = laid('watch', 1)
    const cur = newCursor()
    let t = 500
    for (const unit of cs.units) {
      const span = watchUnitSeconds(cs, unit)
      const slots = unit === 'docking' || unit === 'undocking' ? davinciSlots : null
      const u = cs.unitIndex.get(unit)!
      for (let f = steps.uFirst[u]; f < steps.uFirst[u] + steps.uLen[u]; f++) {
        const slotted = slots !== null
        const at = t + span * ((steps.cumU0[f] + steps.cumU1[f]) / 2 / steps.totalU[u])
        stepAt(steps, unit, t, t + span, at, slots, cur)
        if (!slotted) expect(cur.until - cur.since, `${unit}/${cs.script.steps[steps.stepOf[f]].id}`).toBeCloseTo(cs.script.steps[steps.stepOf[f]].watchSeconds, 9)
      }
      t += span
    }
    expect(watchTotalSeconds(cs)).toBe(cs.script.steps.reduce((a, s) => a + s.watchSeconds, 0))
    expect(watchTotalSeconds(cs)).toBeGreaterThanOrEqual(CONFIG.procedure.watchTotalSeconds[0])
    expect(watchTotalSeconds(cs)).toBeLessThanOrEqual(CONFIG.procedure.watchTotalSeconds[1])
  })
})

describe('stepAt: monotone, bounded, clamped', () => {
  it('the flat step never goes back as the clock runs, and progress stays in [0, 1]', () => {
    for (const seed of SEEDS) {
      const steps = laid('live', seed)
      const cur = newCursor()
      for (const w of davinciWindows(seed)) {
        const slots = w.unit === 'docking' || w.unit === 'undocking' ? davinciSlots : null
        let prev = -1
        for (let t = w.since - 30; t <= w.until + 30; t += (w.until - w.since) / 700) {
          stepAt(steps, w.unit, w.since, w.until, t, slots, cur)
          expect(cur.flat).toBeGreaterThanOrEqual(prev)
          prev = cur.flat
          expect(cur.progress).toBeGreaterThanOrEqual(0)
          expect(cur.progress).toBeLessThanOrEqual(1)
          expect(cur.index).toBe(steps.stepOf[cur.flat])
        }
      }
    }
  })

  it('stays on the last step, finished, when the unit overruns; the first step, not begun, before it starts', () => {
    const steps = laid('watch', 3)
    const cur = newCursor()
    for (const w of davinciWindows(3)) {
      const u = cs.unitIndex.get(w.unit)!
      const first = steps.uFirst[u]
      const last = first + steps.uLen[u] - 1
      stepAt(steps, w.unit, w.since, w.until, w.until + 500, null, cur)
      expect(cur.flat).toBe(last)
      expect(cur.progress).toBe(1)
      stepAt(steps, w.unit, w.since, w.until, w.since - 500, null, cur)
      expect(cur.flat).toBe(first)
      expect(cur.progress).toBe(0)
    }
  })

  it('says false for a unit the script has no step in, and leaves the cursor alone', () => {
    const steps = caseSteps(compileScript(synthCryo()), 'watch', null)
    const cur = newCursor()
    cur.flat = 99
    expect(stepAt(steps, 'anchorFreeze', 0, 100, 50, null, cur)).toBe(false)
    expect(cur.flat).toBe(99)
  })

  it('is the same step for a warm start, a Jump and a replay (a pure function of the clock)', () => {
    const steps = laid('live', 42)
    const a = newCursor()
    const b = newCursor()
    const w = davinciWindows(42).find((x) => x.unit === 'ports')!
    const t = w.since + (w.until - w.since) * 0.37
    stepAt(steps, 'ports', w.since, w.until, w.since + 1, null, a)
    stepAt(steps, 'ports', w.since, w.until, w.until - 1, null, a)
    stepAt(steps, 'ports', w.since, w.until, t, null, a)
    stepAt(steps, 'ports', w.since, w.until, t, null, b)
    expect(a).toEqual(b)
  })
})

describe('the robot\'s sub-windows are the slots', () => {
  it('davinciSlots writes exactly the boundaries segmentAt finds for the docking and undocking phases', () => {
    const rng = new Rng(99)
    for (let n = 0; n < 40; n++) {
      const dockStart = rng.range(500, 5000)
      const dockEnd = dockStart + rng.range(300, 480)
      const consoleEnd = dockEnd + rng.range(900, 1800)
      const undockStart = consoleEnd
      const undockDur = rng.range(120, 180)
      const retStart = undockStart + UNDOCK_SPLIT[0] * undockDur
      const times: RobotCaseTimes = { caseIndex: 0, drapeStart: 0, drapeEnd: 100, dockStart, dockEnd, undockStart, retStart, undockEnd: undockStart + undockDur, cleanEnd: undockStart + undockDur + 600 }
      const win: SlotWindow = { from: 0, to: 0 }
      const kinds = ['deploying', 'driving', 'docking', 'targeting'] as const
      for (const kind of kinds) {
        davinciSlots(kind, dockStart, dockEnd, win)
        const mid = (win.from + win.to) / 2
        const seg = segmentAt(mid, [times])
        expect(seg.kind).toBe(kind)
        expect(win.from).toBeCloseTo(seg.since, 9)
        expect(win.to).toBeCloseTo(seg.until, 9)
      }
      for (const kind of ['undocking', 'returning'] as const) {
        davinciSlots(kind, undockStart, times.undockEnd, win)
        const seg = segmentAt((win.from + win.to) / 2, [times])
        expect(seg.kind).toBe(kind)
        expect(win.from).toBeCloseTo(seg.since, 9)
        expect(win.to).toBeCloseTo(seg.until, 9)
      }
      // the split fractions are the robot's own
      davinciSlots('deploying', 0, 1000, win)
      expect(win.to / 1000).toBeCloseTo(DOCK_SPLIT[0], 12)
    }
  })

  it('stepAt puts each docking and undocking step inside the robot phase it names', () => {
    for (const mode of ['live', 'watch'] as const) {
      for (const seed of SEEDS) {
        const steps = laid(mode, seed)
        const cur = newCursor()
        const ws = davinciWindows(seed)
        for (const unit of ['docking', 'undocking'] as const) {
          const w = ws.find((x) => x.unit === unit)!
          const times: RobotCaseTimes =
            unit === 'docking'
              ? { caseIndex: 0, drapeStart: 0, drapeEnd: 10, dockStart: w.since, dockEnd: w.until, undockStart: w.until + 900, retStart: w.until + 1000, undockEnd: w.until + 1100, cleanEnd: w.until + 1700 }
              : { caseIndex: 0, drapeStart: 0, drapeEnd: 10, dockStart: 20, dockEnd: 50, undockStart: w.since, retStart: w.since + UNDOCK_SPLIT[0] * (w.until - w.since), undockEnd: w.until, cleanEnd: w.until + 600 }
          for (let j = 0; j < 500; j++) {
            const t = w.since + ((w.until - w.since) * (j + 0.5)) / 500
            stepAt(steps, unit, w.since, w.until, t, davinciSlots, cur)
            const slot = cs.slotOf[cur.index]
            expect(segmentAt(t, [times]).kind, `${unit} t=${j}`).toBe(slot === 'docking' || slot === 'deploying' || slot === 'driving' || slot === 'targeting' || slot === 'undocking' || slot === 'returning' ? slot : '?')
          }
        }
      }
    }
  })

  it('without a SlotFn a slotted unit is tiled whole, by weight', () => {
    const steps = laid('watch', 1)
    const cur = newCursor()
    const w = davinciWindows(1).find((x) => x.unit === 'docking')!
    stepAt(steps, 'docking', w.since, w.until, w.since, null, cur)
    expect(cur.since).toBe(w.since)
    const u = cs.unitIndex.get('docking')!
    stepAt(steps, 'docking', w.since, w.until, w.until + 1, null, cur)
    expect(cur.until).toBe(w.until)
    expect(cur.flat).toBe(steps.uFirst[u] + steps.uLen[u] - 1)
  })
})

describe('caseSteps: the weights', () => {
  it('a live step weighs the middle of its band with a jitter of at most the configured fraction', () => {
    const steps = laid('live', 5)
    for (let f = 0; f < steps.flatCount; f++) {
      const mid = midSeconds(cs.script.steps[steps.stepOf[f]])
      const j = steps.weight[f] / mid - 1
      expect(Math.abs(j)).toBeLessThanOrEqual(CONFIG.procedure.liveJitter + 1e-12)
    }
  })

  it('is deterministic per fork: the same seed gives the same weights, another seed other ones, and a missing rng the plain middles', () => {
    const a = caseSteps(cs, 'live', new Rng(11).fork('script'))
    const b = caseSteps(cs, 'live', new Rng(11).fork('script'))
    const c = caseSteps(cs, 'live', new Rng(12).fork('script'))
    const plain = caseSteps(cs, 'live', null)
    expect(Array.from(a.weight)).toEqual(Array.from(b.weight))
    expect(Array.from(a.weight)).not.toEqual(Array.from(c.weight))
    expect(plain.weight[0]).toBe(midSeconds(cs.script.steps[0]))
    // the fork never moves its parent: the draws on 'script' leave the root's own stream (the day plan's) alone
    const root = new Rng(11)
    const before = new Rng(11).float()
    caseSteps(cs, 'live', root.fork('script'))
    expect(root.float()).toBe(before)
  })

  it('a watch case needs no rng and weighs the script\'s watch seconds', () => {
    const steps = caseSteps(cs, 'watch', null)
    cs.script.steps.forEach((s, i) => expect(steps.weight[i]).toBe(s.watchSeconds))
  })

  it('expands a repeat run n times: flat order, repeat numbers, per-unit totals', () => {
    const syn = compileScript(synthCryo())
    expect(syn.repeatFrom).toBe(3)
    expect(syn.repeatLen).toBe(2)
    const steps = caseSteps(syn, 'watch', null, 3)
    expect(steps.repeatN).toBe(3)
    expect(steps.flatCount).toBe(8 + 4)
    expect(Array.from(steps.stepOf)).toEqual([0, 1, 2, 3, 4, 3, 4, 3, 4, 5, 6, 7])
    expect(Array.from(steps.kOf)).toEqual([1, 1, 1, 1, 1, 2, 2, 3, 3, 1, 1, 1])
    expect(watchUnitSeconds(syn, 'aim', 3)).toBe((10 + 14) * 3 + 12)
    expect(watchUnitSeconds(syn, 'aim', 1)).toBe(10 + 14 + 12)
    const aim = syn.unitIndex.get('aim')!
    expect(steps.totalU[aim]).toBe((10 + 14) * 3 + 12)
    // a script without a repeat run ignores repeatN
    expect(caseSteps(cs, 'watch', null, 5).flatCount).toBe(cs.n)
    // the cursor walks the repeats
    const cur = newCursor()
    const total = steps.totalU[aim]
    const ks: number[] = []
    for (let j = 0; j < 200; j++) {
      stepAt(steps, 'aim', 0, total, (total * (j + 0.5)) / 200, null, cur)
      if (ks[ks.length - 1] !== cur.k) ks.push(cur.k)
    }
    expect(ks).toEqual([1, 2, 3, 1]) // 1, 2, 3 for the repeats, then the step after the run
  })
})
