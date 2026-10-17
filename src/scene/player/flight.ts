/**
 * The walk <-> overview flights: a tween of where the camera stands, what it looks at and its lens, over
 * `CONFIG.player.camera.modeFlightSeconds`. It is the same swoop as the room focus (`cameraApi.flyTo`): the camera moves in
 * orbit coordinates round what it looks at (distance, pitch, yaw) with a bulge in the distance, so a long hop swoops instead of
 * sliding through the building. It is ours and not the rig's because the rig clamps its distance and angles (it cannot stand
 * three metres from a target, nor look from below the horizon), which is exactly where a walk starts and ends.
 *
 * Pure maths (no three.js, no React). The flight ends EXACTLY at its destination: the last tick writes the destination's own
 * numbers, not an interpolation that landed near them.
 */
import { easeInOutCubic, lerpAngleDeg, lookAtToPose, poseToLookAt, type CameraPose, type LookAt } from '@/scene/camera/cameraApi'
import { FLIGHT } from './tuning'

/** Where the camera stands, what it looks at and its lens: everything a flight blends. */
export interface FlightState extends LookAt {
  fov: number
}

export function newFlightState(): FlightState {
  return { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: FLIGHT.overviewFov }
}

export function copyFlightState(from: FlightState, to: FlightState): FlightState {
  to.px = from.px
  to.py = from.py
  to.pz = from.pz
  to.tx = from.tx
  to.ty = from.ty
  to.tz = from.tz
  to.fov = from.fov
  return to
}

const mkPose = (): CameraPose => ({ target: { x: 0, y: 0, z: 0 }, distance: 1, pitchDeg: 50, yawDeg: 0 })

export class ModeFlight {
  active = false
  /** Seconds into the flight, and its length. */
  t = 0
  dur: number = FLIGHT.seconds
  /** The state right now (written by `start` and `tick`). */
  readonly now: FlightState = newFlightState()
  private readonly from = newFlightState()
  private readonly to = newFlightState()
  private readonly fromPose = mkPose()
  private readonly toPose = mkPose()
  private readonly mixPose = mkPose()
  private readonly mixLook: LookAt = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 }
  private bulge = 0

  /** Begin a flight. With `seconds` of 0 (reduced motion) it is over at once: `now` is the destination. Returns whether it is still flying. */
  start(from: FlightState, to: FlightState, seconds: number = FLIGHT.seconds): boolean {
    copyFlightState(from, this.from)
    copyFlightState(to, this.to)
    lookAtToPose(this.from, this.fromPose)
    lookAtToPose(this.to, this.toPose)
    this.dur = seconds
    this.t = 0
    this.bulge = Math.min(
      FLIGHT.bulgeMax,
      FLIGHT.bulgePerMetre * Math.hypot(this.toPose.target.x - this.fromPose.target.x, this.toPose.target.z - this.fromPose.target.z),
    )
    if (seconds <= 0) {
      this.active = false
      copyFlightState(this.to, this.now)
      return false
    }
    this.active = true
    copyFlightState(this.from, this.now)
    return true
  }

  /** Advance by `dt` seconds. Returns true on the tick that ends the flight (and `now` is then exactly the destination). Allocates nothing. */
  tick(dt: number): boolean {
    if (!this.active) return false
    this.t += dt > FLIGHT.maxFrameDt ? FLIGHT.maxFrameDt : dt
    if (this.t >= this.dur) {
      this.active = false
      copyFlightState(this.to, this.now)
      return true
    }
    const e = easeInOutCubic(this.t / this.dur)
    const a = this.fromPose
    const b = this.toPose
    const m = this.mixPose
    m.target.x = a.target.x + (b.target.x - a.target.x) * e
    m.target.y = a.target.y + (b.target.y - a.target.y) * e
    m.target.z = a.target.z + (b.target.z - a.target.z) * e
    m.distance = a.distance + (b.distance - a.distance) * e + this.bulge * Math.sin(Math.PI * e)
    m.pitchDeg = a.pitchDeg + (b.pitchDeg - a.pitchDeg) * e
    m.yawDeg = lerpAngleDeg(a.yawDeg, b.yawDeg, e)
    poseToLookAt(m, this.mixLook)
    const n = this.now
    n.px = this.mixLook.px
    n.py = this.mixLook.py
    n.pz = this.mixLook.pz
    n.tx = this.mixLook.tx
    n.ty = this.mixLook.ty
    n.tz = this.mixLook.tz
    n.fov = this.from.fov + (this.to.fov - this.from.fov) * e
    return false
  }

  /** How far through the flight, 0..1 (0 when idle). */
  get progress(): number {
    return this.active ? Math.min(1, this.t / Math.max(this.dur, 1e-6)) : 0
  }

  cancel(): void {
    this.active = false
  }
}
