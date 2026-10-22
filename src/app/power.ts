// Adapted from the living-3d-world template (Waltz City src/app/power.ts): the pacer and the paused clock are the proven parts.
import { create } from 'zustand'

/**
 * How hard the demo may run the computer, as pure rules plus two tiny stores. Nothing here touches the DOM at import time, so
 * every rule runs under vitest in node. The frame loop (PowerLoop.tsx) reads `usePower` every animation frame and feeds the
 * inputs (tab visibility, window focus, battery, presentation mode, the loading screen) into a `PowerMachine`.
 *
 *   - Paused while the tab is hidden, always. A window that merely lost the focus keeps running (F-02: screen sharing, a notes window
 *     or the meeting toolbar take the focus, and the shared picture must not freeze). `?pauseOnBlur=1` brings the old blur pause back
 *     for a laptop demo that should rest in the background; presentation mode (`?present=1`) ignores it.
 *   - At most 60 frames a second, so a 120 Hz display does not double the work.
 *   - 30 frames a second on the loading screen, and on battery in normal mode when you are not walking. Presentation mode holds 60 on
 *     battery, and so does walk mode (W3: a walk at 30 fps is the judder the game was built to avoid; the overview, which is a view
 *     of a slow world, still saves the battery).
 *   - The time handed to R3F is the game's own clock, clamped per frame, so resuming never fast-forwards the simulation.
 */
export type PauseReason = 'hidden' | 'background' | null

/** Longest step one frame may take after a hitch or a pause, in seconds, so the simulation and the cameras never jump. */
export const MAX_FRAME_SECONDS = 0.1

// ---------------------------------------------------------------------------------------------
// The power state machine (pure)
// ---------------------------------------------------------------------------------------------

export interface PowerInputs {
  /** `document.hidden`: the tab is not on screen. */
  hidden: boolean
  /** The window has the keyboard focus. */
  focused: boolean
  /** `?pauseOnBlur=1`: pause when the window loses focus (off by default, F-02). */
  pauseOnBlur?: boolean
  /** Presentation mode (`?present=1`). */
  present: boolean
  /** The laptop runs on battery (Battery API; false where it is not available). */
  onBattery: boolean
  /** The loading screen is up: warm-up is running, or the Enter button has not been pressed. */
  loading: boolean
  /** W3: you are in walk mode (walking, or flying between the overview and the walk): the camera moves every frame, 60 fps even on battery. */
  walking?: boolean
}

export interface PowerDecision {
  paused: boolean
  reason: PauseReason
  /** The frame cap, 60 or 30. */
  fps: number
  onBattery: boolean
}

/**
 * Why the demo should be paused right now, or null. Hidden always pauses; losing focus pauses only when `pauseOnBlur` is on (F-02,
 * off by default), outside presentation mode, and never on the loading screen (W3): the loading screen must draw behind itself, so the first full frame (the post-processing passes and the
 * baked sun shadow compile on it) happens before Enter, not on the first frame of the demo. A page opened in a window without focus
 * (another window in front, the browser pane of the app) would otherwise compile all of them on Enter.
 */
export function pauseReason(hidden: boolean, focused: boolean, present: boolean, loading = false, pauseOnBlur = false): PauseReason {
  if (hidden) return 'hidden'
  if (pauseOnBlur && !focused && !present && !loading) return 'background'
  return null
}

/**
 * The frame cap. The loading screen is 30 in every mode; battery halves it in normal mode only, and never while you walk (W3: the
 * chase camera and the legs at 30 fps are the "his walk is not smooth" complaint; only the overview saves the battery).
 */
export function frameCap(onBattery: boolean, present: boolean, loading: boolean, walking = false): number {
  if (loading) return 30
  if (onBattery && !present && !walking) return 30
  return 60
}

/** Is `mode` (a `PlayerMode`) walk mode, the flights to and from it included? Everything but the overview: the camera moves every frame there. */
export function isWalkingMode(mode: string): boolean {
  return mode !== 'overview'
}

/** Every input at once in, the decision out. */
export function resolvePower(i: PowerInputs): PowerDecision {
  const reason = pauseReason(i.hidden, i.focused, i.present, i.loading, i.pauseOnBlur === true)
  return { paused: reason !== null, reason, fps: frameCap(i.onBattery, i.present, i.loading, i.walking === true), onBattery: i.onBattery }
}

/**
 * Holds the inputs and the current decision. `set` merges a patch and calls `onChange` only when the decision changed, so
 * a burst of focus events costs nothing. PowerLoop wires `onChange` to the `usePower` store; tests wire it to a spy.
 */
export class PowerMachine {
  private readonly i: PowerInputs
  private d: PowerDecision

  constructor(
    initial: Partial<PowerInputs> = {},
    private readonly onChange: (next: PowerDecision, prev: PowerDecision) => void = () => undefined,
  ) {
    this.i = { hidden: false, focused: true, pauseOnBlur: false, present: false, onBattery: false, loading: false, walking: false, ...initial }
    this.d = resolvePower(this.i)
  }

  get inputs(): Readonly<PowerInputs> {
    return this.i
  }

  get decision(): PowerDecision {
    return this.d
  }

  set(patch: Partial<PowerInputs>): PowerDecision {
    Object.assign(this.i, patch)
    const next = resolvePower(this.i)
    const prev = this.d
    if (next.paused !== prev.paused || next.reason !== prev.reason || next.fps !== prev.fps || next.onBattery !== prev.onBattery) {
      this.d = next
      this.onChange(next, prev)
    }
    return this.d
  }
}

// ---------------------------------------------------------------------------------------------
// The stores
// ---------------------------------------------------------------------------------------------

interface PowerState {
  paused: boolean
  reason: PauseReason
  /** The frame cap in force. */
  fps: number
  onBattery: boolean
  set: (patch: Partial<Pick<PowerState, 'paused' | 'reason' | 'fps' | 'onBattery'>>) => void
}

/** The decision, for readers (the frame loop, the quality ladder, the audio engines, the probe). Written by PowerLoop only. */
export const usePower = create<PowerState>()((setState) => ({
  paused: false,
  reason: null,
  fps: 60,
  onBattery: false,
  set: (patch) => {
    if (patch.paused !== undefined) notePaused(patch.paused)
    setState(patch)
  },
}))

/** `?present=1` (also `true`). Pure, for tests. */
export function presentFromSearch(search: string): boolean {
  try {
    const v = new URLSearchParams(search).get('present')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

/** `?pauseOnBlur=1` (also `true`): the opt-in blur pause. Pure, for tests. */
export function pauseOnBlurFromSearch(search: string): boolean {
  try {
    const v = new URLSearchParams(search).get('pauseOnBlur')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

interface PresentState {
  /** Presentation mode: 60 fps on battery, no pause on blur, developer panels hidden. */
  on: boolean
  setOn: (on: boolean) => void
  toggle: () => void
}

export const usePresent = create<PresentState>()((set) => ({
  on: typeof window !== 'undefined' && presentFromSearch(window.location.search),
  setOn: (on) => set({ on }),
  toggle: () => set((s) => ({ on: !s.on })),
}))

// ---------------------------------------------------------------------------------------------
// The paused clock
// ---------------------------------------------------------------------------------------------

/**
 * The demo's own stopwatch. `performance.now()` keeps running while the window is in the background, so anything that times
 * the viewer (a toast's hold time, a tour beat) can read this instead: it is `performance.now()` minus every moment spent paused,
 * and it stands still while paused. Only the difference between two readings means anything.
 */
let pausedSince: number | null = null
let pausedTotal = 0

/** Called when the demo pauses or resumes (usePower.set does it). Repeated calls with the same state are harmless. */
export function notePaused(paused: boolean, now: number = nowMs()): void {
  if (paused) {
    if (pausedSince === null) pausedSince = now
  } else if (pausedSince !== null) {
    pausedTotal += now - pausedSince
    pausedSince = null
  }
}

export function activeNow(now: number = nowMs()): number {
  return (pausedSince === null ? now : pausedSince) - pausedTotal
}

/** Tests: forget every pause. */
export function resetActiveClock(): void {
  pausedSince = null
  pausedTotal = 0
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// ---------------------------------------------------------------------------------------------
// The frame-time clamp
// ---------------------------------------------------------------------------------------------

/** One frame's step in seconds: never negative, never more than MAX_FRAME_SECONDS, and 0 for anything that is not a number. */
export function clampFrameDelta(seconds: number): number {
  if (!(seconds > 0)) return 0
  return seconds > MAX_FRAME_SECONDS ? MAX_FRAME_SECONDS : seconds
}

/**
 * The game time handed to R3F's `advance()`, in seconds. It grows by the real gap between two drawn frames, clamped, and the
 * first frame after a (re)start grows by exactly one frame at the cap. A pause, a hidden tab or an hour in another window
 * therefore adds one frame to the clock, not an hour: the simulation never fast-forwards, and `clock.elapsedTime` driven
 * animations carry on from where they stopped.
 */
export class GameClock {
  private last = -1
  private t = 0

  /** Game seconds so far. */
  get time(): number {
    return this.t
  }

  /** Call for every drawn frame with its animation-frame timestamp in ms. Returns the new game time in seconds. */
  tick(nowMilliseconds: number, fps: number): number {
    this.t += this.last < 0 ? 1 / fps : clampFrameDelta((nowMilliseconds - this.last) / 1000)
    this.last = nowMilliseconds
    return this.t
  }

  /** The loop was paused or restarted: the next tick adds one frame, whatever the wall clock says. */
  reset(): void {
    this.last = -1
  }
}

// ---------------------------------------------------------------------------------------------
// The frame pacer
// ---------------------------------------------------------------------------------------------

/**
 * Decides which animation frames to draw so the demo runs at (at most) its frame cap with EVEN spacing.
 *
 * Comparing elapsed time against the cap's interval gets uneven on a display whose refresh rate is not a whole
 * multiple of the cap: on 144 Hz, "draw when 16.7 ms have passed" draws every third frame, 21 ms apart, which is
 * 48 fps and a visible judder. So the pacer learns the display's refresh period from the gaps between animation
 * frames (their median, which ignores the odd dropped frame) and draws every N-th frame, N being the whole number
 * of display frames closest to the cap's interval, rounding toward more frames per second: 120 Hz at a 60 cap is
 * every 2nd frame (a MacBook Pro's ProMotion screen), 144 Hz is every 2nd (72 fps), 240 Hz every 4th, a 60 Hz display at a
 * 30 cap every 2nd. Until the period is known, and while it is changing, it falls back to elapsed time.
 *
 * It allocates nothing after construction: the gaps live in a ring buffer and the median is taken in a scratch array.
 */
export class FramePacer {
  static readonly MIN_SAMPLES = 12
  static readonly WINDOW = 36
  /** How many frames in a row must want a different divisor before it changes. */
  static readonly SETTLE = 24

  private readonly gaps = new Float64Array(FramePacer.WINDOW)
  private readonly scratch = new Float64Array(FramePacer.WINDOW)
  private gapCount = 0
  private gapHead = 0
  private prevTick = -1
  private divisor = 0
  private candidate = 0
  private candidateTicks = 0
  private lastDrawn = -1
  private fps = 0
  private minPeriod = 0

  /**
   * The fastest refresh period seen so far, in ms (8.3 on a 120 Hz screen, 16.7 on 60 Hz, 33 when the browser throttles the page to
   * 30 fps, as Chrome's Energy Saver and macOS Low Power Mode can), or 0 before it is learned. The minimum, not the latest: frames
   * the GPU is late with stretch the gaps between animation frames, and only the best case says what the display itself delivers.
   */
  get refreshMs(): number {
    return this.minPeriod
  }

  /** The display's refresh period in ms as learned so far, or 0 before enough frames have been seen. */
  get period(): number {
    const n = this.gapCount
    if (n < FramePacer.MIN_SAMPLES) return 0
    const s = this.scratch
    for (let i = 0; i < n; i++) {
      // insertion sort of the ring into the scratch array (at most 36 numbers)
      const v = this.gaps[i]
      let j = i - 1
      while (j >= 0 && s[j] > v) {
        s[j + 1] = s[j]
        j--
      }
      s[j + 1] = v
    }
    return s[Math.floor((n - 1) / 2)]
  }

  /** The demo was paused (or the cap changed): the next frame is drawn at once and the gap across the pause is not a sample. */
  reset(): void {
    this.prevTick = -1
    this.lastDrawn = -1
  }

  /** Call for every animation frame with its timestamp in ms. True means: draw this one. */
  accept(now: number, fps: number): boolean {
    if (this.prevTick >= 0) {
      const gap = now - this.prevTick
      if (gap > 1 && gap < 100) {
        this.gaps[this.gapHead] = gap
        this.gapHead = this.gapHead + 1 === FramePacer.WINDOW ? 0 : this.gapHead + 1
        if (this.gapCount < FramePacer.WINDOW) this.gapCount++
      }
    }
    this.prevTick = now

    // a new cap (the loading screen's 30 becomes 60 on Enter, battery) takes effect at once, not after the settling time
    if (fps !== this.fps) {
      this.fps = fps
      this.divisor = 0
      this.candidateTicks = 0
    }
    const interval = 1000 / fps
    const period = this.period
    if (period > 0) {
      if (this.minPeriod === 0 || period < this.minPeriod) this.minPeriod = period
      const want = Math.max(1, Math.floor(interval / period + 0.15))
      if (this.divisor === 0) this.divisor = want
      if (want !== this.divisor) {
        this.candidateTicks = want === this.candidate ? this.candidateTicks + 1 : 1
        this.candidate = want
        if (this.candidateTicks >= FramePacer.SETTLE) {
          this.divisor = want
          this.candidateTicks = 0
        }
      } else this.candidateTicks = 0
    }

    let draw: boolean
    if (this.divisor > 0 && period > 0) {
      // N display frames since the last draw, with half a frame of slack: even spacing when frames are cheap, and when a
      // frame takes longer than one display frame the next tick that arrives late is drawn at once instead of waiting a
      // whole extra tick (counting ticks would turn a 12 ms frame on a 120 Hz display into 40 fps)
      draw = this.lastDrawn < 0 || now - this.lastDrawn >= (this.divisor - 0.5) * period
    } else {
      // not learned yet: elapsed time, with a small allowance for frames that arrive a little early
      draw = this.lastDrawn < 0 || now - this.lastDrawn >= interval - 2
    }
    if (draw) this.lastDrawn = now
    return draw
  }
}
