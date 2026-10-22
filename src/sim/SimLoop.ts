/**
 * Drives the Simulation from the render loop: whole fixed steps from an accumulator (scaled by the speed
 * setting), then interpolated poses for the frame, and slow state published at ~4 Hz.
 * Called from a useFrame at FRAME_PRIORITY.sim (before cameras and labels).
 */
import { CONFIG } from './config'
import type { Simulation } from './Simulation'

const STEP = CONFIG.sim.step
/** Check the wall-clock budget every this many steps (a power of two, so the test is a mask). */
const BUDGET_CHECK_MASK = 3

/** Wall clock in ms: performance.now when available, else Date.now. */
export type NowFn = () => number
const defaultNow: NowFn =
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now()

/**
 * Never run more than this many steps in one frame (a long hitch must not snowball): at least `maxStepsMin`, and
 * `ceil(speed × 2.2)` so 30× (66) still covers the 60 steps one 30 fps frame needs.
 */
export function maxStepsPerFrame(speed: number): number {
  return Math.max(CONFIG.sim.maxStepsMin, Math.ceil(speed * 2.2))
}

export class SimLoop {
  speed = 1
  paused = false
  private acc = 0
  private publishTimer = 0
  /** F-01: frames in a row in which a step, the sync or the publish threw. */
  private failedFrames = 0
  /** F-01: the sim is paused by the failure counter and waits for `replace` (a rebuild) to bring it back. */
  private recovering = false
  /** F-01: how many frames have had an error since this loop was made (never reset; for the probe and tests). */
  errorFrames = 0
  /** F-01: the latest error that was contained. */
  lastError: unknown = null
  /**
   * F-01: called once when `maxConsecutiveStepErrors` frames in a row failed. The sim is already paused; the owner rebuilds the
   * hospital (a Jump to the current hour behind the veil) and `replace` resumes it.
   */
  onRecover: (() => void) | null = null

  constructor(
    /** Replaced by `replace` when a Jump rebuilds the hospital at another hour (L1). */
    public sim: Simulation,
    private readonly publish: (sim: Simulation, loop: SimLoop) => void,
    /** Injectable wall clock (tests); defaults to performance.now / Date.now. */
    private readonly now: NowFn = defaultNow,
  ) {}

  frame(dt: number): void {
    // F-16: NaN, a negative or an infinite dt would poison the accumulator for good
    if (!(dt > 0) || !Number.isFinite(dt)) dt = 0
    if (!this.paused) {
      let failed = false
      this.acc += Math.min(dt, 0.1) * this.speed
      if (!Number.isFinite(this.acc)) this.acc = 0
      const maxSteps = maxStepsPerFrame(this.speed)
      const budgetMs = CONFIG.sim.stepBudgetMs
      const t0 = this.acc >= STEP ? this.now() : 0
      let n = 0
      let cut = false
      while (this.acc >= STEP) {
        if (n >= maxSteps) {
          cut = true
          break
        }
        // The budget is checked every few steps, never before the first, so a slow frame still advances.
        if ((n & BUDGET_CHECK_MASK) === 0 && n > 0 && this.now() - t0 >= budgetMs) {
          cut = true
          break
        }
        try {
          this.sim.step(STEP)
        } catch (error) {
          // F-01: most throws are local to one entity: contain it, drop this frame's leftover time and try again next frame
          this.noteError(error, 'step')
          failed = true
          this.acc = 0
          break
        }
        this.acc -= STEP
        n++
      }
      // The cap or the budget stopped us: drop the leftover so a slow stretch never snowballs.
      if (cut || n >= maxSteps) this.acc = 0
      try {
        this.sim.sync(this.acc / STEP)
      } catch (error) {
        this.noteError(error, 'sync')
        failed = true
      }
      if (failed) this.failedFrames++
      else if (n > 0) this.failedFrames = 0
      if (failed && !this.recovering && this.failedFrames >= CONFIG.sim.maxConsecutiveStepErrors) this.startRecovery()
    }
    this.publishTimer += dt
    if (this.publishTimer >= 1 / CONFIG.sim.publishHz) {
      this.publishTimer = 0
      this.publishSafe()
    }
  }

  private noteError(error: unknown, where: string): void {
    this.errorFrames++
    this.lastError = error
    // once per streak, so a throw on every frame does not flood the console
    if (this.failedFrames === 0) console.error(`Simulation ${where} threw; the frame was contained.`, error)
  }

  private publishSafe(): void {
    try {
      this.publish(this.sim, this)
    } catch (error) {
      this.errorFrames++
      this.lastError = error
      console.error('Publishing the world state threw; the frame was contained.', error)
    }
  }

  private startRecovery(): void {
    this.recovering = true
    this.paused = true
    console.error(`Simulation failed ${this.failedFrames} frames in a row: paused, rebuilding the hospital at the current hour.`)
    this.publishSafe()
    try {
      this.onRecover?.()
    } catch (error) {
      console.error('Simulation recovery hook threw.', error)
    }
  }

  /** Publish now (after a speed or pause change, so the HUD reacts at once). */
  publishNow(): void {
    this.publishSafe()
  }

  /** S1: the sim was run forward outside the loop (a short Skip): drop the accumulator and publish at once. */
  resync(): void {
    this.acc = 0
    this.publishNow()
  }

  /** Swap in a rebuilt hospital (L1 Jump); speed and pause stay as they are. */
  replace(next: Simulation): void {
    this.sim = next
    this.acc = 0
    this.failedFrames = 0
    // a rebuild that came from the failure counter brings the sim back (the presenter's own pause stays as it was)
    if (this.recovering) {
      this.recovering = false
      this.paused = false
    }
    this.publishNow()
  }
}
