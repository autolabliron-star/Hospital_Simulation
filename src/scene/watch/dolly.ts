/**
 * R5: the watch camera's moves (pure maths, allocation-free: every number a field, `tick` and `poseInto` write in place). The glide of the walkthrough
 * (src/ui/present/glide.ts) taken to 3D:
 *
 *   the eye     a cubic Hermite from where the camera is to the shot's eye, its end tangents along the chord with a gentle crane (the eye lifts a little
 *               in the middle of the move and settles), so it starts and ends at rest under the smootherstep clock
 *   the target  straight from the old look point to the new one, on the same smootherstep
 *   the lens    the same
 *   the clock   2.2 s for a short move up to 3.5 s for a long one (`dollySeconds`)
 *
 * The end pose is read LIVE every frame (`poseInto` takes it): the anchors move (the cart drives, people shift), and the move lands where the shot is
 * now, not where it was. A move longer than `CUT_CHORD` metres, or into another room, is not flown: the director cuts it behind a `DIP_SECONDS` dip to
 * black (the overlay's CSS), and with reduced motion every move is a plain cut.
 */
import { hermite, smootherstep } from '@/ui/present/glide'
import type { Vec3 } from '@/sim/types'

export const DOLLY_MIN_SECONDS = 2.2
export const DOLLY_MAX_SECONDS = 3.5
/** A move longer than this (metres of eye travel) is a cut. */
export const CUT_CHORD = 6
/** The dip to black of a cut: this long to black, the cut, this long back. */
export const DIP_SECONDS = 0.25
/** The crane: how far the middle of a move lifts, per metre of chord (a quarter of the end tangents' vertical part). */
const CRANE_PER_METRE = 0.06
const CRANE_MAX = 0.3

/** How long a move over `chord` metres takes. */
export function dollySeconds(chord: number): number {
  const s = DOLLY_MIN_SECONDS + 0.3 * chord
  return s < DOLLY_MIN_SECONDS ? DOLLY_MIN_SECONDS : s > DOLLY_MAX_SECONDS ? DOLLY_MAX_SECONDS : s
}

export class Dolly {
  active = false
  /** Seconds so far and in all; eased progress 0..1. */
  elapsed = 0
  seconds = 1
  progress = 0
  private e0x = 0
  private e0y = 0
  private e0z = 0
  private t0x = 0
  private t0y = 0
  private t0z = 0
  private fov0 = 45
  // the end tangents, per unit of progress (the chord at the start, plus the crane)
  private mx = 0
  private my = 0
  private mz = 0
  private lift = 0

  /** Begin a move from the pose (`eye`, `target`, `fov`) toward a shot whose eye is now `toEye`. `seconds` defaults to `dollySeconds` of the chord. */
  start(eye: Readonly<Vec3>, target: Readonly<Vec3>, fov: number, toEye: Readonly<Vec3>, seconds?: number): void {
    this.e0x = eye.x
    this.e0y = eye.y
    this.e0z = eye.z
    this.t0x = target.x
    this.t0y = target.y
    this.t0z = target.z
    this.fov0 = fov
    this.mx = toEye.x - eye.x
    this.my = toEye.y - eye.y
    this.mz = toEye.z - eye.z
    const chord = Math.sqrt(this.mx * this.mx + this.my * this.my + this.mz * this.mz)
    const crane = chord * CRANE_PER_METRE
    this.lift = 4 * (crane > CRANE_MAX ? CRANE_MAX : crane)
    this.seconds = seconds ?? dollySeconds(chord)
    this.elapsed = 0
    this.progress = 0
    this.active = true
  }

  /** Advance by `dt` seconds. Returns true on the frame the move ends (`progress` is then exactly 1). */
  tick(dt: number): boolean {
    if (!this.active) return false
    this.elapsed += dt > 0 ? dt : 0
    const t = this.elapsed >= this.seconds ? 1 : this.elapsed / this.seconds
    this.progress = smootherstep(t)
    if (t >= 1) {
      this.active = false
      return true
    }
    return false
  }

  /**
   * The pose at the current progress, toward the shot's live pose (`toEye`, `toTarget`, `toFov`): the eye into `eye`, the look point into `target`;
   * returns the lens. Allocation-free.
   */
  poseInto(toEye: Readonly<Vec3>, toTarget: Readonly<Vec3>, toFov: number, eye: Vec3, target: Vec3): number {
    const u = this.progress
    eye.x = hermite(this.e0x, this.mx, toEye.x, this.mx, u)
    eye.y = hermite(this.e0y, this.my + this.lift, toEye.y, this.my - this.lift, u)
    eye.z = hermite(this.e0z, this.mz, toEye.z, this.mz, u)
    target.x = this.t0x + (toTarget.x - this.t0x) * u
    target.y = this.t0y + (toTarget.y - this.t0y) * u
    target.z = this.t0z + (toTarget.z - this.t0z) * u
    return this.fov0 + (toFov - this.fov0) * u
  }

  cancel(): void {
    this.active = false
  }
}
