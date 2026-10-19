/**
 * W4: the single-tube pneumatic line as pure geometry, shared by the sim (arrival times) and the scene (where the flying tube is drawn), so the
 * two always agree. Contract glue, owned by the orchestrator. Allocation-free after the paths are built (once, at import).
 *
 * A source (robot 0..2, or the manual send station 3) rises from its riser bottom to the trunk height, then joins the trunk at its own x and
 * follows it to the end (the lab's receive station). The flight accelerates at `accel` to `vMax`, then brakes at `decel` to arrive at rest.
 */
import { PNEUMATIC } from './places'
import type { Vec3 } from './types'

export interface PneumaticPath {
  /** Corner points, in order. */
  readonly pts: readonly Vec3[]
  /** Cumulative length at each point (cum[0] = 0). */
  readonly cum: Float64Array
  readonly length: number
}

function buildPath(source: Vec3): PneumaticPath {
  const trunk = PNEUMATIC.trunk
  const pts: Vec3[] = [{ ...source }, { x: source.x, y: trunk[0].y, z: source.z }]
  // join the trunk's first (westbound, along z = trunk[0].z) leg at the source's x, then follow the rest of the trunk
  for (let i = 1; i < trunk.length; i++) pts.push({ ...trunk[i] })
  const cum = new Float64Array(pts.length)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
  }
  return { pts, cum, length: cum[pts.length - 1] }
}

/** Paths by source index: 0..2 the robots, 3 the manual send station. */
export const PNEUMATIC_PATHS: readonly PneumaticPath[] = PNEUMATIC.sources.map(buildPath)
export const MANUAL_SEND_SOURCE = 3

/** The point `d` metres along a source's path (clamped to its ends), written into `out`. */
export function pathPointInto(source: number, d: number, out: Vec3): Vec3 {
  const p = PNEUMATIC_PATHS[source]
  const pts = p.pts
  const cum = p.cum
  const dd = d <= 0 ? 0 : d >= p.length ? p.length : d
  let i = 1
  while (i < pts.length - 1 && cum[i] < dd) i++
  const a = pts[i - 1]
  const b = pts[i]
  const seg = cum[i] - cum[i - 1]
  const t = seg > 1e-9 ? (dd - cum[i - 1]) / seg : 0
  out.x = a.x + (b.x - a.x) * t
  out.y = a.y + (b.y - a.y) * t
  out.z = a.z + (b.z - a.z) * t
  return out
}

/** How long a flight over `length` metres takes with the trapezoid (or triangle) speed profile, seconds. */
export function flightDuration(length: number): number {
  const { vMax, accel, decel } = PNEUMATIC.profile
  const dAcc = (vMax * vMax) / (2 * accel)
  const dDec = (vMax * vMax) / (2 * decel)
  if (dAcc + dDec >= length) {
    // never reaches vMax: peak speed from length = v^2/2a + v^2/2d
    const vPeak = Math.sqrt((2 * length * accel * decel) / (accel + decel))
    return vPeak / accel + vPeak / decel
  }
  return vMax / accel + vMax / decel + (length - dAcc - dDec) / vMax
}

/** Metres covered `t` seconds into a flight over `length` metres (0 before, `length` after). */
export function flightDistance(length: number, t: number): number {
  if (t <= 0) return 0
  const { vMax, accel, decel } = PNEUMATIC.profile
  const total = flightDuration(length)
  if (t >= total) return length
  const dAcc = (vMax * vMax) / (2 * accel)
  const dDec = (vMax * vMax) / (2 * decel)
  let vPeak: number = vMax
  let tCruise = 0
  if (dAcc + dDec >= length) vPeak = Math.sqrt((2 * length * accel * decel) / (accel + decel))
  else tCruise = (length - dAcc - dDec) / vMax
  const tA = vPeak / accel
  if (t <= tA) return 0.5 * accel * t * t
  const dA = 0.5 * accel * tA * tA
  if (t <= tA + tCruise) return dA + vPeak * (t - tA)
  const td = t - tA - tCruise
  return Math.min(length, dA + vPeak * tCruise + vPeak * td - 0.5 * decel * td * td)
}
