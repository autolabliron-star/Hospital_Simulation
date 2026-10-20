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

  constructor(
    /** Replaced by `replace` when a Jump rebuilds the hospital at another hour (L1). */
    public sim: Simulation,
    private readonly publish: (sim: Simulation, loop: SimLoop) => void,
    /** Injectable wall clock (tests); defaults to performance.now / Date.now. */
    private readonly now: NowFn = defaultNow,
  ) {}

  frame(dt: number): void {
    if (!this.paused) {
      this.acc += Math.min(dt, 0.1) * this.speed
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
        this.sim.step(STEP)
        this.acc -= STEP
        n++
      }
      // The cap or the budget stopped us: drop the leftover so a slow stretch never snowballs.
      if (cut || n >= maxSteps) this.acc = 0
      this.sim.sync(this.acc / STEP)
    }
    this.publishTimer += dt
    if (this.publishTimer >= 1 / CONFIG.sim.publishHz) {
      this.publishTimer = 0
      this.publish(this.sim, this)
    }
  }

  /** Publish now (after a speed or pause change, so the HUD reacts at once). */
  publishNow(): void {
    this.publish(this.sim, this)
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
    this.publishNow()
  }
}
