/**
 * Drives the Simulation from the render loop: whole fixed steps from an accumulator (scaled by the speed
 * setting), then interpolated poses for the frame, and slow state published at ~4 Hz.
 * Called from a useFrame at FRAME_PRIORITY.sim (before cameras and labels).
 */
import { CONFIG } from './config'
import type { Simulation } from './Simulation'

const STEP = CONFIG.sim.step
/** Never run more than this many steps in one frame (a long hitch must not snowball). */
const MAX_STEPS_PER_FRAME = 40

export class SimLoop {
  speed = 1
  paused = false
  private acc = 0
  private publishTimer = 0

  constructor(
    /** Replaced by `replace` when a Jump rebuilds the hospital at another hour (L1). */
    public sim: Simulation,
    private readonly publish: (sim: Simulation, loop: SimLoop) => void,
  ) {}

  frame(dt: number): void {
    if (!this.paused) {
      this.acc += Math.min(dt, 0.1) * this.speed
      let n = 0
      while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME) {
        this.sim.step(STEP)
        this.acc -= STEP
        n++
      }
      if (n === MAX_STEPS_PER_FRAME) this.acc = 0
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

  /** Swap in a rebuilt hospital (L1 Jump); speed and pause stay as they are. */
  replace(next: Simulation): void {
    this.sim = next
    this.acc = 0
    this.publishNow()
  }
}
