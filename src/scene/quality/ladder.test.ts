import { describe, expect, it } from 'vitest'
import { DprDeferral, MAX_DEFER_MS, STILL_SECONDS, type DprContext } from './dprDefer'
import {
  DEFAULT_LADDER_CONFIG,
  MAX_LEVEL,
  QUALITY_STEPS,
  QualityLadder,
  appliedDpr,
  clampLevel,
  percentileOf,
  type LadderAction,
  type LadderConfig,
} from './ladder'

const CFG = DEFAULT_LADDER_CONFIG
const FRAME = 1000 / 60
/** A frame: its interval and its work, in ms. */
type Frame = [interval: number, work: number]

const CALM: Frame = [FRAME, 4]
const LATE: Frame = [FRAME * 2, 4] // a missed 60 fps frame
const HEAVY: Frame = [FRAME, 15] // on time, but 15 ms of main-thread work

/** Drives a ladder like PowerLoop would: every frame advances the clock by its interval. */
class Rig {
  now = 1000
  readonly ladder: QualityLadder

  constructor(
    config: Partial<LadderConfig> = {},
    level = 0,
    public dpr = 2,
    public cap = 60,
  ) {
    this.ladder = new QualityLadder(config, level)
  }

  get level(): number {
    return this.ladder.level
  }

  frame(f: Frame): LadderAction {
    this.now += f[0]
    return this.ladder.sample(this.now, f[0], f[1], this.cap, this.dpr)
  }

  /** `n` frames from a generator; returns the actions, in order. */
  run(n: number, gen: (i: number) => Frame): LadderAction[] {
    const out: LadderAction[] = []
    for (let i = 0; i < n; i++) {
      const a = this.frame(gen(i))
      if (a !== null) out.push(a)
    }
    return out
  }

  calm(n: number): LadderAction[] {
    return this.run(n, () => CALM)
  }

  /** Frames until the ladder moves, at most `max`. Returns the action and how many frames it took. */
  until(gen: (i: number) => Frame, max = 2000): { action: LadderAction; frames: number } {
    for (let i = 0; i < max; i++) {
      const a = this.frame(gen(i))
      if (a !== null) return { action: a, frames: i + 1 }
    }
    return { action: null, frames: max }
  }

  /** Time passes with no frames (a quicker way through a grace period). */
  idle(ms: number): void {
    this.now += ms
  }

  /** The show is on: ready, and the ready grace has passed. */
  start(): this {
    this.ladder.setReady(true, this.now)
    this.idle(CFG.readyGraceMs + 1)
    return this
  }
}

/** One frame in `every` is late. */
const lateEvery = (every: number) => (i: number): Frame => (i % every === 0 ? LATE : CALM)

describe('the rungs', () => {
  it('go from DPR 1.5 down to 1.0, then the effects lite, then AO lighter, then off', () => {
    expect(QUALITY_STEPS.map((s) => s.dpr)).toEqual([1.5, 1.25, 1.0, 1.0, 1.0, 1.0])
    expect(QUALITY_STEPS.map((s) => s.ao)).toEqual(['full', 'full', 'full', 'full', 'light', 'off'])
    expect(QUALITY_STEPS.map((s) => s.fx)).toEqual(['full', 'full', 'full', 'lite', 'lite', 'lite'])
    expect(QUALITY_STEPS.map((s) => s.id)).toEqual(['dpr-1.5', 'dpr-1.25', 'dpr-1.0', 'fx-lite', 'ao-light', 'ao-off'])
    expect(MAX_LEVEL).toBe(5)
  })

  it('the effects-lite rung comes after DPR 1.0 and before any AO cut, and the AO rungs keep it lite', () => {
    const lite = QUALITY_STEPS.findIndex((s) => s.fx === 'lite')
    expect(QUALITY_STEPS[lite]).toMatchObject({ id: 'fx-lite', dpr: 1.0, ao: 'full', fx: 'lite' })
    expect(QUALITY_STEPS.slice(0, lite).every((s) => s.ao === 'full' && s.fx === 'full')).toBe(true)
    expect(QUALITY_STEPS.slice(lite).every((s) => s.fx === 'lite')).toBe(true)
    expect(QUALITY_STEPS[lite - 1].dpr).toBe(1.0)
  })

  it('apply a pixel ratio capped by the display, never below 1', () => {
    expect(appliedDpr(QUALITY_STEPS[0], 2)).toBe(1.5) // a Retina MacBook
    expect(appliedDpr(QUALITY_STEPS[0], 1)).toBe(1) // a 1080p external display
    expect(appliedDpr(QUALITY_STEPS[0], 1.25)).toBe(1.25)
    expect(appliedDpr(QUALITY_STEPS[1], 2)).toBe(1.25)
    expect(appliedDpr(QUALITY_STEPS[2], 3)).toBe(1)
    expect(appliedDpr(QUALITY_STEPS[0], 0.8)).toBe(1)
    expect(appliedDpr(QUALITY_STEPS[0], Number.NaN)).toBe(1)
  })

  it('clamp a level into the ladder', () => {
    expect(clampLevel(-3)).toBe(0)
    expect(clampLevel(99)).toBe(MAX_LEVEL)
    expect(clampLevel(2.4)).toBe(2)
    expect(clampLevel(Number.NaN)).toBe(0)
  })
})

describe('the window statistics', () => {
  it('takes percentiles by nearest rank', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentileOf(v, 0.95)).toBe(95)
    expect(percentileOf(v, 0.9)).toBe(90)
    expect(percentileOf(v, 1)).toBe(100)
    expect(percentileOf([], 0.95)).toBe(0)
  })

  it('records the share of late frames and the p95 work of the last window', () => {
    const r = new Rig().start()
    r.run(120, (i) => (i % 10 === 0 ? [FRAME * 2, 6] : [FRAME, 6]))
    expect(r.ladder.last.windows).toBe(1)
    expect(r.ladder.last.lateShare).toBeCloseTo(0.1, 6)
    expect(r.ladder.last.workP95).toBeCloseTo(6, 4)
  })
})

describe('the ladder before and after the show starts', () => {
  it('does nothing until it is ready, however bad the frames are', () => {
    const r = new Rig()
    expect(r.run(2000, () => LATE)).toEqual([])
    expect(r.level).toBe(0)
    expect(r.ladder.last.windows).toBe(0)
  })

  it('waits a grace after ready, then needs a whole window of evidence', () => {
    const r = new Rig()
    r.ladder.setReady(true, r.now)
    const started = r.now
    const { action, frames } = r.until(() => LATE)
    expect(action).toBe('down')
    // no decision inside the grace, and after it a full window (120 frames) had to fill
    expect(r.now - started).toBeGreaterThanOrEqual(CFG.readyGraceMs + 120 * LATE[0] - LATE[0])
    expect(frames).toBeGreaterThan(120)
    expect(r.level).toBe(1)
  })

  it('stops again if the show is taken away', () => {
    const r = new Rig().start()
    r.ladder.setReady(false, r.now)
    expect(r.run(500, () => LATE)).toEqual([])
    expect(r.level).toBe(0)
  })

  it('does nothing when not in auto mode (a forced rung), and still measures nothing', () => {
    const r = new Rig().start()
    r.ladder.auto = false
    expect(r.run(1000, () => LATE)).toEqual([])
    r.ladder.auto = true
    expect(r.until(() => LATE).action).toBe('down')
  })
})

describe('stepping down', () => {
  it('steps down when more than 5 % of a window missed their frame', () => {
    const r = new Rig().start()
    const { action } = r.until(lateEvery(4)) // 25 % late
    expect(action).toBe('down')
    expect(r.level).toBe(1)
    expect(r.ladder.reason).toBe('late')
  })

  it('shrugs off a few hitches: a handful of late frames in a window is not load', () => {
    const r = new Rig().start()
    expect(r.run(120 * 10, lateEvery(40))).toEqual([]) // 3 of 120: 2.5 %
    expect(r.run(120 * 10, lateEvery(24))).toEqual([]) // 5 of 120: 4.2 %
    expect(r.level).toBe(0)
  })

  it('shrugs off one long stall', () => {
    const r = new Rig().start()
    const out = r.run(120 * 6, (i) => (i === 200 ? [800, 4] : CALM))
    expect(out).toEqual([])
    expect(r.level).toBe(0)
  })

  it('steps down when the p95 of the frame work is past 12 ms, with every frame on time', () => {
    const r = new Rig().start()
    expect(r.run(120 * 3, () => [FRAME, 11])).toEqual([]) // 11 ms is inside the budget
    const { action } = r.until(() => HEAVY)
    expect(action).toBe('down')
    expect(r.ladder.reason).toBe('heavy')
  })

  it('does not step down for a handful of heavy frames', () => {
    const r = new Rig().start()
    expect(r.run(120 * 5, (i) => (i % 40 === 0 ? [FRAME, 30] : CALM))).toEqual([])
  })

  it('reads the thresholds against the cap: a deliberate 30 fps is not slow', () => {
    const r = new Rig({}, 0, 2, 30).start()
    // 33 ms between frames and 20 ms of work are normal at a 30 cap (budget 24 ms, late after 40 ms)
    expect(r.run(120 * 5, () => [1000 / 30, 20])).toEqual([])
    expect(r.level).toBe(0)
    // but a gap of 50 ms is a missed frame at 30
    expect(r.until(() => [50, 5]).action).toBe('down')
  })

  it('does not read a throttled page as a GPU in trouble: against a 30 Hz display, 33 ms frames are on time', () => {
    const r = new Rig().start()
    const throttled = (f: Frame): LadderAction => {
      r.now += f[0]
      return r.ladder.sample(r.now, f[0], f[1], 60, 2, 33.3)
    }
    let moved = 0
    for (let i = 0; i < 120 * 5; i++) if (throttled([33.3, 3]) !== null) moved++
    expect(moved).toBe(0)
    expect(r.level).toBe(0)
    // but a frame that misses even the slow display is late: 50 ms gaps against a 33 ms display
    let down = 0
    for (let i = 0; i < 120 * 3; i++) if (throttled([i % 2 === 0 ? 66 : 33.3, 3]) === 'down') down++
    expect(down).toBeGreaterThan(0)
  })

  it('on a 120 Hz display (8.3 ms) the late limit is still the 60 fps cap: 33 ms frames are late', () => {
    const r = new Rig().start()
    const fast = (f: Frame): LadderAction => {
      r.now += f[0]
      return r.ladder.sample(r.now, f[0], f[1], 60, 2, 8.33)
    }
    let down = 0
    for (let i = 0; i < 120 * 5; i++) if (fast([33.3, 3]) === 'down') down++
    expect(down).toBeGreaterThan(0)
  })

  it('walks down one rung at a time to the bottom and stays there', () => {
    const r = new Rig().start()
    const moves: number[] = []
    for (let i = 0; i < 9; i++) {
      const { action } = r.until(() => LATE, 1500)
      if (action === 'down') moves.push(r.level)
    }
    expect(moves).toEqual([1, 2, 3, 4, 5])
    expect(r.level).toBe(MAX_LEVEL)
    expect(r.run(2000, () => LATE)).toEqual([])
  })

  it('lets a rung settle before it counts again', () => {
    const r = new Rig().start()
    r.until(() => LATE)
    expect(r.level).toBe(1)
    // the step's own grace (1.5 s, about 90 frames) plus a whole fresh window must pass before the next decision
    const second = r.until(() => LATE)
    expect(second.frames).toBeGreaterThan(120 + Math.floor(CFG.stepGraceMs / LATE[0]) - 2)
    expect(r.level).toBe(2)
  })

  it('on a 1080p display (pixel ratio 1) skips the pixel-ratio rungs, which look identical, and goes straight to the effects lite', () => {
    const r = new Rig({}, 0, 1).start()
    r.until(() => LATE)
    expect(r.level).toBe(3)
    expect(QUALITY_STEPS[r.level]).toMatchObject({ ao: 'full', fx: 'lite' })
    r.until(() => LATE)
    expect(r.level).toBe(4)
    expect(QUALITY_STEPS[r.level].ao).toBe('light')
    r.until(() => LATE)
    expect(r.level).toBe(5)
    expect(QUALITY_STEPS[r.level].ao).toBe('off')
  })

  it('on a Retina display (pixel ratio 2) takes every rung', () => {
    const l = new QualityLadder()
    expect(l.nextDown(0, 2)).toBe(1)
    expect(l.nextDown(1, 2)).toBe(2)
    expect(l.nextDown(2, 2)).toBe(3)
    expect(l.nextDown(3, 2)).toBe(4)
    expect(l.nextDown(4, 2)).toBe(5)
    expect(l.nextDown(5, 2)).toBe(-1)
    expect(l.nextDown(0, 1)).toBe(3)
    expect(l.nextDown(0, 1.25)).toBe(2) // 1.5 and 1.25 look the same on a 1.25 display
  })
})

describe('stepping up', () => {
  it('needs eight calm windows in a row (about 16 s), and then steps up one rung', () => {
    const r = new Rig({}, 2).start()
    expect(r.calm(120 * 8 - 1)).toEqual([])
    expect(r.calm(1)).toEqual(['up'])
    expect(r.level).toBe(1)
    expect(r.ladder.reason).toBe('headroom')
  })

  it('climbs back to the top, one rung per calm run', () => {
    const r = new Rig({}, 4).start()
    const levels: number[] = []
    for (let i = 0; i < 6; i++) {
      r.until(() => CALM, 4000)
      levels.push(r.level)
    }
    expect(levels.slice(0, 4)).toEqual([3, 2, 1, 0])
    expect(r.level).toBe(0)
  })

  it('never goes above the top', () => {
    const r = new Rig({}, 0).start()
    expect(r.calm(120 * 40)).toEqual([])
    expect(r.level).toBe(0)
  })

  it('on a 1080p display climbs from the effects lite straight back to the top rung, and from lighter AO back to the effects lite', () => {
    const r = new Rig({}, 3, 1).start()
    r.until(() => CALM, 4000)
    expect(r.level).toBe(0) // 2, 1 and 0 are one picture here; the best of them is rung 0
    const lighter = new Rig({}, 4, 1).start()
    lighter.until(() => CALM, 4000)
    expect(lighter.level).toBe(3)
  })

  it('one window that is merely so-so starts the count again', () => {
    const r = new Rig({}, 2).start()
    // seven calm windows, one with 3 % late frames (not bad enough to step down, not calm enough to count), seven calm again
    expect(r.calm(120 * 7)).toEqual([])
    expect(r.run(120, lateEvery(40))).toEqual([])
    expect(r.calm(120 * 7)).toEqual([])
    expect(r.level).toBe(2)
    expect(r.calm(120)).toEqual(['up']) // the eighth calm window in a row
  })

  it('does not count a window whose work is merely under the budget: it needs real headroom', () => {
    const r = new Rig({}, 2).start()
    // 9 ms of work is inside the 12 ms budget (no step down) but over 60 % of it (no step up)
    expect(r.run(120 * 20, () => [FRAME, 9])).toEqual([])
    expect(r.level).toBe(2)
    // 7 ms is clear headroom
    expect(r.run(120 * 8, () => [FRAME, 7])).toEqual(['up'])
  })

  it('does not step up if one window of the run had 3 % missed frames', () => {
    const r = new Rig({}, 2).start()
    r.calm(120 * 7)
    r.run(120, lateEvery(30)) // 4 late of 120: 3.3 %
    expect(r.calm(120 * 7)).toEqual([])
  })
})

describe('hysteresis: a failed trial is not repeated soon', () => {
  /** Calm until the ladder climbs one rung. */
  function climb(r: Rig): void {
    const { action } = r.until(() => CALM, 12_000)
    expect(action).toBe('up')
  }

  it('bans the rung when the step up is followed by a step down, for two minutes, and for twice as long on the next failure', () => {
    const r = new Rig({}, 2).start()
    climb(r) // 2 -> 1
    expect(r.level).toBe(1)
    const failed = r.until(() => LATE, 1500)
    expect(failed.action).toBe('down')
    expect(r.level).toBe(2)
    expect(r.ladder.isBanned(1, r.now + 119_000)).toBe(true)
    expect(r.ladder.isBanned(1, r.now + 121_000)).toBe(false)

    // calm for a minute and a half: plenty of headroom, but the rung is banned
    expect(r.calm(5400)).toEqual([])
    expect(r.level).toBe(2)
    // the ban runs out, and the next calm window tries again
    climb(r)
    expect(r.level).toBe(1)

    // it fails again: the ban doubles
    r.until(() => LATE, 1500)
    expect(r.level).toBe(2)
    expect(r.ladder.isBanned(1, r.now + 239_000)).toBe(true)
    expect(r.ladder.isBanned(1, r.now + 241_000)).toBe(false)
  })

  it('does not ban a rung when the step down comes long after the step up', () => {
    const r = new Rig({}, 2).start()
    climb(r)
    expect(r.level).toBe(1)
    // a long so-so spell at rung 1 (9 ms of work: neither bad nor calm), about 40 s, longer than the 30 s thrash window
    expect(r.run(120 * 20, () => [FRAME, 9])).toEqual([])
    expect(r.until(() => LATE, 1500).action).toBe('down')
    expect(r.level).toBe(2)
    expect(r.ladder.isBanned(1, r.now)).toBe(false)
  })

  it('does not ban anything for an ordinary step down', () => {
    const r = new Rig().start()
    r.until(() => LATE)
    for (let l = 0; l <= MAX_LEVEL; l++) expect(r.ladder.isBanned(l, r.now)).toBe(false)
  })
})

describe('grace windows', () => {
  it('a Jump throws away the half-filled window and waits 4 s before counting', () => {
    const r = new Rig().start()
    r.run(100, () => LATE) // most of a bad window
    r.ladder.noteJump(r.now)
    expect(r.run(100, () => LATE)).toEqual([]) // the 100 before the Jump are gone, and the grace is running
    const { action, frames } = r.until(() => LATE)
    expect(action).toBe('down')
    expect(frames).toBeGreaterThan(120)
  })

  it('no decision inside the Jump grace, however bad', () => {
    const r = new Rig().start()
    r.ladder.noteJump(r.now)
    const frames = Math.floor((CFG.jumpGraceMs - 100) / LATE[0])
    expect(r.run(frames, () => LATE)).toEqual([])
    expect(r.level).toBe(0)
  })

  it('a resume (a first frame with no interval) waits 1.5 s and drops the window', () => {
    const r = new Rig().start()
    r.run(100, () => LATE)
    expect(r.ladder.sample(r.now + 5, 0, 4, 60, 2)).toBeNull()
    r.now += 5
    expect(r.run(100, () => LATE)).toEqual([]) // inside the grace, and the earlier 100 are gone
  })

  it('a change of the frame cap throws the window away', () => {
    const r = new Rig().start()
    r.run(110, () => LATE)
    r.cap = 30 // Enter was pressed, or the laptop was unplugged
    expect(r.run(100, () => [1000 / 30, 4])).toEqual([])
    expect(r.run(25, () => [1000 / 30, 4])).toEqual([]) // calm at 30: a whole window, no move
    expect(r.level).toBe(0)
  })

  it('moving the rung from outside restarts the measuring', () => {
    const r = new Rig().start()
    r.run(100, () => LATE)
    r.ladder.forceLevel(3, r.now)
    expect(r.level).toBe(3)
    expect(r.run(100, () => LATE)).toEqual([])
  })
})

describe('the work trigger cannot burn the ladder down for nothing', () => {
  it('takes a work-only step back when it did not lower the work, and then ignores the work for three minutes', () => {
    const r = new Rig().start()
    expect(r.until(() => HEAVY).action).toBe('down')
    expect(r.level).toBe(1)
    expect(r.ladder.reason).toBe('heavy')
    // the next window: the same 15 ms. A smaller picture did not make the CPU faster.
    const back = r.until(() => HEAVY)
    expect(back.action).toBe('up')
    expect(r.level).toBe(0)
    expect(r.ladder.reason).toBe('futile')
    // the work trigger is off now
    expect(r.run(120 * 20, () => HEAVY)).toEqual([])
    expect(r.level).toBe(0)
    // late frames still count
    expect(r.until(() => LATE).action).toBe('down')
    // and after three minutes the work trigger is back
    const r2 = new Rig().start()
    r2.until(() => HEAVY)
    r2.until(() => HEAVY)
    expect(r2.level).toBe(0)
    r2.idle(CFG.workGuardMs + 1000)
    expect(r2.until(() => HEAVY).action).toBe('down')
  })

  it('keeps a work-only step that did lower the work', () => {
    const r = new Rig().start()
    expect(r.until(() => HEAVY).action).toBe('down')
    // the next window is down to 9 ms: the step helped (and it is under the budget, so nothing more happens)
    expect(r.run(120 * 3, () => [FRAME, 9])).toEqual([])
    expect(r.level).toBe(1)
  })

  it('a step taken for late frames is not second-guessed by the work', () => {
    const r = new Rig().start()
    expect(r.until(() => [FRAME * 2, 15]).action).toBe('down')
    expect(r.ladder.reason).toBe('late')
    const next = r.until(() => [FRAME * 2, 15])
    expect(next.action).toBe('down') // still late: keep walking down
    expect(r.level).toBe(2)
  })
})

/** A frame the browser delivered late because the window is covered: a long gap, almost no work. */
const COVERED: Frame = [300, 3]

describe('a covered window is throttling, not slowness', () => {
  it('ignores a window of throttled frames: no late count, no step down, nothing evaluated', () => {
    const r = new Rig().start()
    expect(r.run(240, () => COVERED)).toEqual([]) // a minute of 3 to 4 frames a second
    expect(r.level).toBe(0)
    expect(r.ladder.last.windows).toBe(0)
    expect(r.ladder.throttledFrames).toBe(240)
  })

  it('also ignores gaps of 0.5 s and more, with small work', () => {
    const r = new Rig().start()
    expect(r.run(120, () => [500, 2])).toEqual([])
    expect(r.run(60, () => [1200, 6])).toEqual([])
    expect(r.level).toBe(0)
  })

  it('throws away a half-filled window when throttling starts', () => {
    const r = new Rig().start()
    r.run(100, () => LATE) // most of a bad window
    expect(r.run(6, () => COVERED)).toEqual([])
    // normal pacing is back, and it is a slow window: the 100 earlier frames are gone, and the grace has to pass first
    const { action, frames } = r.until(() => LATE)
    expect(action).toBe('down')
    expect(frames).toBeGreaterThan(120 + Math.floor(CFG.throttleGraceMs / LATE[0]) - 3)
  })

  it('restarts the grace when normal pacing returns: calm frames afterwards count only after it, and never step down', () => {
    const r = new Rig().start()
    r.run(10, () => COVERED)
    const before = r.ladder.last.windows
    expect(r.run(120, () => CALM)).toEqual([]) // 2 s of calm: the first 2 s of it were still grace, so no full window yet
    expect(r.ladder.last.windows).toBe(before)
    expect(r.run(120 * 3, () => CALM)).toEqual([])
    expect(r.ladder.last.windows).toBeGreaterThan(before)
    expect(r.level).toBe(0)
  })

  it('does not stop a real slow GPU: frames 2, 2.5 and 3 intervals late, continuously paced, still step down', () => {
    for (const interval of [FRAME * 2, FRAME * 2.5, FRAME * 3]) {
      const r = new Rig().start()
      const { action } = r.until(() => [interval, 4])
      expect(action, `${interval.toFixed(1)} ms`).toBe('down')
      expect(r.ladder.reason).toBe('late')
      expect(r.ladder.throttledFrames).toBe(0)
    }
  })

  it('still steps down for frames 3.6 intervals late (60 ms, 17 fps): below the throttling limit', () => {
    const r = new Rig().start()
    expect(r.until(() => [60, 4]).action).toBe('down')
    // even 140 ms frames with small work are a GPU in trouble, not a covered window (the limit never drops below 150 ms)
    const r2 = new Rig().start()
    expect(r2.until(() => [140, 4]).action).toBe('down')
  })

  it('does not call a frame throttled when the CPU worked all that time: that is a slow page', () => {
    const r = new Rig().start()
    expect(r.until(() => [300, 20]).action).toBe('down')
    expect(r.ladder.throttledFrames).toBe(0)
  })

  it('does not let one long hitch throw the window away, or count against it', () => {
    const r = new Rig().start()
    expect(r.run(120, (i) => (i === 60 ? [400, 3] : LATE))).toEqual([]) // the hitch is set aside: 119 frames stored
    expect(r.ladder.throttledFrames).toBe(1)
    expect(r.frame(LATE)).toBe('down') // the 120th stored frame completes the window
  })

  it('reads the limit against the cap: at 30 fps a 100 ms gap is slow, a 400 ms gap is throttling', () => {
    const slow = new Rig({}, 0, 2, 30).start()
    expect(slow.until(() => [100, 4]).action).toBe('down')
    const covered = new Rig({}, 0, 2, 30).start()
    expect(covered.run(120, () => [400, 4])).toEqual([])
    expect(covered.level).toBe(0)
  })

  it('counts a resume (no previous frame) as before, and starts the streak afresh', () => {
    const r = new Rig().start()
    r.frame(COVERED)
    expect(r.ladder.sample(r.now + 5, 0, 4, 60, 2)).toBeNull()
    r.now += 5
    // one throttled frame after the resume is a lone hitch again, not the second of a pair: no extra grace beyond the resume's
    r.frame(COVERED)
    expect(r.ladder.throttledFrames).toBe(2)
    expect(r.level).toBe(0)
  })
})

describe('the defaults', () => {
  it('keep the budget of CLAUDE.md and the rules of the brief', () => {
    expect(CFG.budgetMs).toBe(12)
    expect(CFG.lateFactor).toBeGreaterThan(1)
    expect(CFG.downLateShare).toBeGreaterThan(CFG.upLateShare) // the thresholds are apart: that is the hysteresis
    expect(CFG.upWindows).toBeGreaterThan(1)
    expect(CFG.readyGraceMs).toBeGreaterThanOrEqual(3000)
    expect(CFG.jumpGraceMs).toBeGreaterThanOrEqual(3000)
    expect(CFG.windowFrames * CFG.upWindows * FRAME).toBeGreaterThan(10_000) // a long run before it climbs
  })
})

describe('the pixel-ratio deferral (W3): no resize while you walk', () => {
  const WALKING: DprContext = { mode: 'walk', live: true, stillFor: 0 }
  const STILL: DprContext = { mode: 'walk', live: true, stillFor: STILL_SECONDS }

  it('does nothing when the renderer already has the ratio the rung asks for', () => {
    const d = new DprDeferral()
    expect(d.decide(1.5, 1.5, WALKING, 0)).toBe('none')
    expect(d.waiting).toBe(false)
  })

  it('defers while you walk and move', () => {
    const d = new DprDeferral()
    expect(d.decide(1.5, 1.25, WALKING, 1000)).toBe('wait')
    expect(d.waiting).toBe(true)
    for (let t = 1100; t < 6900; t += 100) expect(d.decide(1.5, 1.25, { ...WALKING, stillFor: 0.2 }, t)).toBe('wait')
  })

  it('applies the moment you stop (still for 0.4 s), and forgets the wait', () => {
    const d = new DprDeferral()
    expect(d.decide(1.5, 1.0, WALKING, 0)).toBe('wait')
    expect(d.decide(1.5, 1.0, { ...WALKING, stillFor: STILL_SECONDS - 0.01 }, 300)).toBe('wait')
    expect(d.decide(1.5, 1.0, STILL, 400)).toBe('apply')
    expect(d.waiting).toBe(false)
  })

  it('applies at once outside walk mode: the overview, and the Tab flights', () => {
    for (const mode of ['overview', 'toWalk', 'toOverview', undefined]) {
      const d = new DprDeferral()
      expect(d.decide(1.5, 1.25, { mode, live: true, stillFor: 0 }, 0), String(mode)).toBe('apply')
    }
    // and leaving walk mode releases a change that was waiting
    const d = new DprDeferral()
    expect(d.decide(1.5, 1.25, WALKING, 0)).toBe('wait')
    expect(d.decide(1.5, 1.25, { mode: 'toOverview', live: true, stillFor: 0 }, 200)).toBe('apply')
    expect(d.waiting).toBe(false)
  })

  it('applies after 6 s even if you never stop (a run through the hospital)', () => {
    const d = new DprDeferral()
    expect(MAX_DEFER_MS).toBe(6000)
    expect(d.decide(1.5, 1.25, WALKING, 10_000)).toBe('wait')
    expect(d.decide(1.5, 1.25, WALKING, 10_000 + MAX_DEFER_MS - 1)).toBe('wait')
    expect(d.decide(1.5, 1.25, WALKING, 10_000 + MAX_DEFER_MS)).toBe('apply')
    expect(d.waiting).toBe(false)
  })

  it('keeps the original 6 s when the rung moves again while waiting', () => {
    const d = new DprDeferral()
    expect(d.decide(1.5, 1.25, WALKING, 0)).toBe('wait')
    expect(d.decide(1.5, 1.0, WALKING, 4000)).toBe('wait') // a second step down: same wait
    expect(d.decide(1.5, 1.0, WALKING, 6000)).toBe('apply')
  })

  it('counts a player who is not there yet (walkBody not live) as still', () => {
    const d = new DprDeferral()
    expect(d.decide(1.5, 1.25, { mode: 'walk', live: false, stillFor: 0 }, 0)).toBe('apply')
  })

  it('a change that is undone while waiting drops the wait', () => {
    const d = new DprDeferral()
    expect(d.decide(1.5, 1.25, WALKING, 0)).toBe('wait')
    expect(d.decide(1.5, 1.5, WALKING, 500)).toBe('none')
    expect(d.waiting).toBe(false)
    // a new change starts a fresh 6 s
    expect(d.decide(1.5, 1.25, WALKING, 5000)).toBe('wait')
    expect(d.decide(1.5, 1.25, WALKING, 10_999)).toBe('wait')
  })

  it('reports who is moving: walking and not yet still', () => {
    const d = new DprDeferral()
    expect(d.moving(WALKING)).toBe(true)
    expect(d.moving(STILL)).toBe(false)
    expect(d.moving({ mode: 'overview', live: true, stillFor: 0 })).toBe(false)
  })
})
