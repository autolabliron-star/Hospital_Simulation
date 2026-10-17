/**
 * The flap of a rail portal as a pure little state machine (no three.js, no sim): it lifts while a pod is near and drops a
 * moment after the last one has gone. `raw` is a 0..1 value moved at a fixed rate in sim time (frozen when paused, quicker at 2x
 * and 4x); the flap's angle is that value through a smoothstep, so it eases in and out. RailPortals.tsx drives it each frame and the
 * node tests drive it against the real simulation to prove a flap is always out of a pod's way.
 */
import { PORTAL } from './layout'

export interface PortalState {
  /** Opening, 0 = shut (hanging), 1 = fully lifted. */
  raw: number
  /** Sim seconds since a pod was last near. */
  since: number
}

export const newPortalState = (): PortalState => ({ raw: 0, since: 99 })

/** Advance one portal by `simDt` seconds of sim time. `near`: a pod is within `PORTAL.trigger` of it. */
export function stepPortal(s: PortalState, near: boolean, simDt: number): void {
  s.since = near ? 0 : s.since + simDt
  const want = near || s.since < PORTAL.closeAfter ? 1 : 0
  // move toward `want` and rest there
  if (want > s.raw) s.raw = Math.min(1, s.raw + simDt * PORTAL.speed)
  else if (want < s.raw) s.raw = Math.max(0, s.raw - simDt * PORTAL.speed)
}

/** The flap's angle up from hanging (radians) for an opening value. */
export function flapAngle(raw: number): number {
  return raw * raw * (3 - 2 * raw) * PORTAL.lift
}
