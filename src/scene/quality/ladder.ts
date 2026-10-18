/**
 * The adaptive quality ladder, as a pure state machine (no React, no three.js, no clock of its own: every method is handed `now`),
 * so every rule is proven under vitest in node. <Quality /> feeds it the real frame times; render.store.ts holds the level.
 *
 * The rungs, best first: pixel ratio 1.5 -> 1.25 -> 1.0, then the effects lite (W3: the ceiling-panel reflection on the floors goes), then
 * the ambient occlusion lighter, then off. (The sun's shadow is baked once, so there is no shadow rung.) A rung the display cannot show is
 * skipped: on a 1080p screen (devicePixelRatio 1) the three pixel-ratio rungs are the same picture, so the first step down goes straight
 * to the effects-lite rung.
 *
 * It measures in WINDOWS of `windowFrames` drawn frames (about 2 s at 60 fps), two numbers per frame:
 *   interval  the gap to the previous drawn frame. More than `lateFactor` cap intervals is a missed frame.
 *   work      the milliseconds `advance()` took on the main thread (the 12 ms budget in CLAUDE.md, scaled by 60 / cap).
 *
 * Down: a window where more than `downLateShare` of the frames were late (the p95 of the interval is past the limit), or where the
 *       p95 of the work is past the budget. One bad window is enough.
 * Up:   `upWindows` windows IN A ROW with next to no late frames and the p95 work under `upWorkShare` of the budget, and the rung
 *       above not banned. This is a trial: the GPU's load cannot be read from here, only whether frames stay on time.
 *
 * What keeps it from flickering (hysteresis):
 *   - the thresholds are far apart (5 % late to go down, 1 % late and 60 % of the budget to go up);
 *   - going up takes a long calm run (16 s), going down one bad window (2 s);
 *   - after any move it lets `stepGraceMs` pass before it counts again (the resize and the buffer reallocation are their own hitch);
 *   - a step down within `thrashMs` of a step up means the better rung is too heavy for this machine: it is banned, for
 *     `banMs`, doubling each time it fails again, up to `banMaxMs`.
 *
 * It does nothing until told the show is `ready`, then waits `readyGraceMs`; the same wait follows a Jump (`noteJump`) and a resume
 * from a pause (`noteResume`), and a change of the frame cap throws the half-filled window away.
 *
 * Throttling is not slowness. When the browser window is covered (occluded but still 'visible'), Chromium delivers animation frames at
 * 2 to 4 a second while the page is perfectly healthy. A frame whose gap is far above the cap's interval (more than
 * `throttleFactor` intervals, and never less than `throttleMinGapMs`) with little work behind it is that, so it is not counted as
 * late and not stored. Two such frames in a row mean the page is being throttled: the half-filled window is thrown away like a
 * resume, and `throttleGraceMs` starts again with every further throttled frame, so it ends that long after normal pacing returns.
 * A real slow GPU (frames 2 to 3 intervals late, continuously) is far from that limit and still steps down.
 *
 * One guard against a useless descent: lowering the pixel ratio cannot make the CPU faster. If the only reason to step down was
 * the work budget (nothing late) and the next window's work did not fall by at least 10 %, the step is taken back and the work
 * trigger is switched off for `workGuardMs`. Late frames still count.
 */

export type AoLevel = 'full' | 'light' | 'off'
/** W3: the realistic light's extras. 'lite' drops the floors' ceiling-panel reflection (a uniform: nothing recompiles). */
export type FxLevel = 'full' | 'lite'

export interface QualityStep {
  id: string
  label: string
  /** The pixel ratio asked for. The applied value is also capped by the display's devicePixelRatio (see `appliedDpr`). */
  dpr: number
  ao: AoLevel
  fx: FxLevel
}

/** Index 0 is the best. The AO rungs carry fx 'lite' (a machine that cannot afford the AO cannot afford the reflection). */
export const QUALITY_STEPS: readonly QualityStep[] = [
  { id: 'dpr-1.5', label: 'DPR 1.5, AO full', dpr: 1.5, ao: 'full', fx: 'full' },
  { id: 'dpr-1.25', label: 'DPR 1.25, AO full', dpr: 1.25, ao: 'full', fx: 'full' },
  { id: 'dpr-1.0', label: 'DPR 1.0, AO full', dpr: 1.0, ao: 'full', fx: 'full' },
  { id: 'fx-lite', label: 'DPR 1.0, AO full, FX lite', dpr: 1.0, ao: 'full', fx: 'lite' },
  { id: 'ao-light', label: 'DPR 1.0, AO light, FX lite', dpr: 1.0, ao: 'light', fx: 'lite' },
  { id: 'ao-off', label: 'DPR 1.0, AO off, FX lite', dpr: 1.0, ao: 'off', fx: 'lite' },
]

export const MAX_LEVEL = QUALITY_STEPS.length - 1

export function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(MAX_LEVEL, Math.max(0, Math.round(n)))
}

/** The pixel ratio a rung really renders at on a display: capped by the display, and never below 1 (R3F's own floor). */
export function appliedDpr(step: QualityStep, deviceDpr: number): number {
  const d = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1
  return Math.max(1, Math.min(step.dpr, d))
}

export interface LadderConfig {
  /** Drawn frames per measuring window. */
  windowFrames: number
  /** The frame-work budget in ms at 60 fps (CLAUDE.md: 12). Scaled by 60 / cap, so a deliberate 30 fps is not read as slow. */
  budgetMs: number
  /** A frame is late when its interval is longer than this many cap intervals. */
  lateFactor: number
  /** Step down when more than this share of a window's frames were late. */
  downLateShare: number
  /** Step up needs at most this share late... */
  upLateShare: number
  /** ...and the p95 work at most this share of the budget. */
  upWorkShare: number
  /** Consecutive calm windows before a step up. */
  upWindows: number
  /** Quiet time after `setReady(true)`. */
  readyGraceMs: number
  /** Quiet time after a Jump. */
  jumpGraceMs: number
  /** Quiet time after a resume from a pause. */
  resumeGraceMs: number
  /** Quiet time after the ladder itself moved. */
  stepGraceMs: number
  /** A gap above this many cap (or display) intervals, with little work, is a throttled page, not a slow one. */
  throttleFactor: number
  /** ...but never a gap shorter than this (ms): a GPU that slow is still a GPU in trouble. */
  throttleMinGapMs: number
  /** Throttled frames in a row that make it throttling rather than one hitch. */
  throttleFrames: number
  /** Quiet time after the last throttled frame. */
  throttleGraceMs: number
  /** A step down this soon after a step up bans the rung it came from. */
  thrashMs: number
  /** First ban, doubling on each repeat, up to `banMaxMs`. */
  banMs: number
  banMaxMs: number
  /** How long the work trigger stays off once a work-only step proved useless. */
  workGuardMs: number
  /** A work-only step is useless if the next window's p95 work is above this share of the one that caused it. */
  futileGain: number
}

export const DEFAULT_LADDER_CONFIG: Readonly<LadderConfig> = {
  windowFrames: 120,
  budgetMs: 12,
  lateFactor: 1.2,
  downLateShare: 0.05,
  upLateShare: 0.01,
  upWorkShare: 0.6,
  upWindows: 8,
  readyGraceMs: 5000,
  jumpGraceMs: 4000,
  resumeGraceMs: 1500,
  stepGraceMs: 1500,
  throttleFactor: 4,
  throttleMinGapMs: 150,
  throttleFrames: 2,
  throttleGraceMs: 2000,
  thrashMs: 30_000,
  banMs: 120_000,
  banMaxMs: 900_000,
  workGuardMs: 180_000,
  futileGain: 0.9,
}

/** Longest display refresh period the ladder believes (a page throttled to 20 fps); anything slower is treated as unknown. */
export const MAX_REFRESH_MS = 50

export type LadderAction = 'down' | 'up' | null
export type LadderReason = 'late' | 'heavy' | 'headroom' | 'futile' | 'forced'

/** The p-th percentile (nearest rank, p in 0..1) of a list of numbers. Allocates: for tests and tools. */
export function percentileOf(values: ArrayLike<number>, p: number): number {
  const n = values.length
  if (n === 0) return 0
  const sorted = Array.from(values).sort((a, b) => a - b)
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))]
}

export class QualityLadder {
  /** The current rung, an index into QUALITY_STEPS. */
  level: number
  /** False: the ladder only measures. (`?quality=N` forces a rung.) */
  auto = true
  /** Why the last move happened. */
  reason: LadderReason | null = null
  /** Frames set aside as throttling (a covered window), over the whole session: for the probe overlay and tests. */
  throttledFrames = 0
  /** The last evaluated window, written in place: for the probe overlay. */
  readonly last = { lateShare: 0, workP95: 0, windows: 0 }

  private readonly cfg: LadderConfig
  private readonly size: number
  private readonly work: Float32Array
  private readonly interval: Float32Array
  private readonly scratch: Float32Array
  private n = 0
  private cap = 60
  private refresh = 0
  private throttleStreak = 0
  private ready = false
  private graceUntil = 0
  private goodStreak = 0
  private lastUpAt = -Infinity
  private lastUpTo = -1
  private readonly banUntil: number[] = QUALITY_STEPS.map(() => -Infinity)
  private readonly failures: number[] = QUALITY_STEPS.map(() => 0)
  private heavyCheck = false
  private heavyBaseline = 0
  private heavyFrom = 0
  private workGuardUntil = -Infinity

  constructor(config: Partial<LadderConfig> = {}, level = 0) {
    this.cfg = { ...DEFAULT_LADDER_CONFIG, ...config }
    this.size = Math.max(4, Math.floor(this.cfg.windowFrames))
    this.work = new Float32Array(this.size)
    this.interval = new Float32Array(this.size)
    this.scratch = new Float32Array(this.size)
    this.level = clampLevel(level)
  }

  get isReady(): boolean {
    return this.ready
  }

  /** Until the warm-up is done and the viewer is in, the ladder does nothing. Turning it on starts the grace. */
  setReady(ready: boolean, now: number): void {
    if (ready === this.ready) return
    this.ready = ready
    this.abandon()
    if (ready) this.graceUntil = Math.max(this.graceUntil, now + this.cfg.readyGraceMs)
  }

  /** The hospital was rebuilt at another hour: shaders and buffers are new, so wait before counting. */
  noteJump(now: number): void {
    this.abandon()
    this.graceUntil = Math.max(this.graceUntil, now + this.cfg.jumpGraceMs)
  }

  /** The first frame after a pause (or tab switch). */
  noteResume(now: number): void {
    this.abandon()
    this.graceUntil = Math.max(this.graceUntil, now + this.cfg.resumeGraceMs)
  }

  /** Someone else set the rung (a dev switch, `?quality=`). Measure afresh from there. */
  forceLevel(level: number, now: number): void {
    this.level = clampLevel(level)
    this.abandon()
    this.graceUntil = Math.max(this.graceUntil, now + this.cfg.stepGraceMs)
  }

  /**
   * Feed one drawn frame. Returns 'down' or 'up' when the ladder moved (read the new `level` and `reason`), else null. It allocates
   * nothing. `intervalMs` 0 means "no previous frame": a resume. `refreshMs` is the fastest display period seen (0: not known): a frame
   * is late against the slower of the cap's interval and the display's, so a browser that throttles the page to 30 fps (Energy
   * Saver, Low Power Mode) does not read as a GPU in trouble and walk the picture down for nothing.
   */
  sample(now: number, intervalMs: number, workMs: number, capFps: number, deviceDpr = 1, refreshMs = 0): LadderAction {
    if (!this.auto || !this.ready) return null
    if (!(intervalMs > 0)) {
      this.throttleStreak = 0
      this.noteResume(now)
      return null
    }
    this.refresh = refreshMs > 0 ? Math.min(refreshMs, MAX_REFRESH_MS) : 0
    if (capFps !== this.cap) {
      this.cap = capFps
      this.abandon()
    }
    // a covered window: frames arrive a few times a second while the page is healthy. Set them aside, and after two in a row
    // throw the window away and keep the grace running until normal pacing has been back for a while.
    if (this.isThrottled(intervalMs, workMs)) {
      this.throttledFrames++
      if (++this.throttleStreak >= this.cfg.throttleFrames) {
        this.abandon()
        this.graceUntil = Math.max(this.graceUntil, now + this.cfg.throttleGraceMs)
      }
      return null
    }
    this.throttleStreak = 0
    if (now < this.graceUntil) return null
    this.interval[this.n] = intervalMs
    this.work[this.n] = workMs >= 0 ? workMs : 0
    if (++this.n < this.size) return null
    this.n = 0
    return this.evaluate(now, deviceDpr)
  }

  private evaluate(now: number, deviceDpr: number): LadderAction {
    const cfg = this.cfg
    const cap = this.cap > 0 ? this.cap : 60
    const lateMs = Math.max(1000 / cap, this.refresh) * cfg.lateFactor
    const budget = cfg.budgetMs * (60 / cap)

    let late = 0
    for (let i = 0; i < this.size; i++) if (this.interval[i] > lateMs) late++
    const lateShare = late / this.size
    const workP95 = this.percentile(this.work, 0.95)
    this.last.lateShare = lateShare
    this.last.workP95 = workP95
    this.last.windows++

    const isLate = lateShare > cfg.downLateShare
    const isHeavy = now >= this.workGuardUntil && workP95 > budget

    // the previous step down was for the work budget alone: did it bring the work down?
    if (this.heavyCheck) {
      this.heavyCheck = false
      if (isHeavy && !isLate && workP95 > this.heavyBaseline * cfg.futileGain) {
        this.workGuardUntil = now + cfg.workGuardMs
        return this.move(this.heavyFrom, now, 'futile', 'up')
      }
    }

    if (isLate || isHeavy) {
      this.goodStreak = 0
      const to = this.nextDown(this.level, deviceDpr)
      if (to < 0) return null // already at the bottom
      // stepping down right after stepping up: the rung above is too heavy for this machine, keep off it for a while
      if (this.level === this.lastUpTo && now - this.lastUpAt < cfg.thrashMs) {
        this.ban(this.level, now)
        this.lastUpTo = -1
      }
      const workOnly = isHeavy && !isLate
      if (workOnly) {
        this.heavyBaseline = workP95
        this.heavyFrom = this.level
      }
      const action = this.move(to, now, isLate ? 'late' : 'heavy', 'down')
      this.heavyCheck = workOnly
      return action
    }

    const calm = lateShare <= cfg.upLateShare && workP95 <= cfg.upWorkShare * budget
    if (!calm) {
      this.goodStreak = 0
      return null
    }
    if (++this.goodStreak < cfg.upWindows) return null
    const to = this.nextUp(this.level, deviceDpr)
    if (to < 0 || now < this.banUntil[to]) return null
    const action = this.move(to, now, 'headroom', 'up')
    this.lastUpAt = now
    this.lastUpTo = to
    return action
  }

  private move(to: number, now: number, reason: LadderReason, action: 'down' | 'up'): LadderAction {
    this.level = to
    this.reason = reason
    this.goodStreak = 0
    this.graceUntil = now + this.cfg.stepGraceMs
    return action
  }

  private ban(level: number, now: number): void {
    const ms = Math.min(this.cfg.banMaxMs, this.cfg.banMs * 2 ** this.failures[level])
    this.failures[level]++
    this.banUntil[level] = now + ms
  }

  /** Is this rung banned right now? (probe and tests) */
  isBanned(level: number, now: number): boolean {
    return now < this.banUntil[clampLevel(level)]
  }

  /** The next rung below `level` that looks different on this display, or -1 at the bottom. */
  nextDown(level: number, deviceDpr: number): number {
    const here = QUALITY_STEPS[level]
    for (let l = level + 1; l <= MAX_LEVEL; l++) if (!sameLook(QUALITY_STEPS[l], here, deviceDpr)) return l
    return -1
  }

  /** The next rung above `level` that looks different on this display (the best of its equals), or -1 at the top. */
  nextUp(level: number, deviceDpr: number): number {
    const here = QUALITY_STEPS[level]
    for (let l = level - 1; l >= 0; l--) {
      if (sameLook(QUALITY_STEPS[l], here, deviceDpr)) continue
      let best = l
      while (best > 0 && sameLook(QUALITY_STEPS[best - 1], QUALITY_STEPS[l], deviceDpr)) best--
      return best
    }
    return -1
  }

  /** Throw away the half-filled window and every streak that depended on it. */
  private abandon(): void {
    this.n = 0
    this.goodStreak = 0
    this.heavyCheck = false
  }

  /** Is this frame a throttled page rather than a slow one? Far past the interval, with little work behind it. */
  private isThrottled(intervalMs: number, workMs: number): boolean {
    const period = Math.max(1000 / (this.cap > 0 ? this.cap : 60), this.refresh)
    const limit = Math.max(this.cfg.throttleFactor * period, this.cfg.throttleMinGapMs)
    return intervalMs > limit && workMs < this.cfg.budgetMs * (60 / (this.cap > 0 ? this.cap : 60))
  }

  private percentile(values: Float32Array, p: number): number {
    this.scratch.set(values)
    this.scratch.sort()
    return this.scratch[Math.min(this.size - 1, Math.max(0, Math.ceil(p * this.size) - 1))]
  }
}

function sameLook(a: QualityStep, b: QualityStep, deviceDpr: number): boolean {
  return a.ao === b.ao && a.fx === b.fx && appliedDpr(a, deviceDpr) === appliedDpr(b, deviceDpr)
}
