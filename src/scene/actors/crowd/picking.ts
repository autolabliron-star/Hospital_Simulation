// Ported from Waltz City (src/scene/actors/crowd/picking.ts); a person is now any capsule segment (standing, seated or lying), not only a vertical one.
/**
 * Picking people with a ray: a person is a capsule (a segment from the feet or seat to the head, a horizontal segment for a lying
 * person) with a radius that grows with distance so somebody 150 m away is still about 14 px wide to click. Pure maths: the
 * renderer feeds it the camera ray. Far cheaper than testing instance triangles, and it never goes stale because it is evaluated
 * against the live positions at the moment of the click.
 */
export interface RayHit {
  /** Distance along the ray to the closest approach. */
  t: number
  /** Distance of the ray from the person's axis at that point. */
  dist: number
}

/** Pick radius in metres for a person `d` metres from the camera: at least a body width, about 14 px on screen far away. */
export function pickRadius(d: number): number {
  return Math.max(0.34, 0.009 * d)
}

/**
 * Closest approach of the ray (o, unit direction u) to the segment a to b. Returns null when the closest approach is further than
 * `radius` or behind the ray origin.
 */
export function rayVsSegment(
  ox: number,
  oy: number,
  oz: number,
  ux: number,
  uy: number,
  uz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
): RayHit | null {
  const vx = bx - ax
  const vy = by - ay
  const vz = bz - az
  const wx = ox - ax
  const wy = oy - ay
  const wz = oz - az
  const B = ux * vx + uy * vy + uz * vz
  const C = vx * vx + vy * vy + vz * vz
  const D = ux * wx + uy * wy + uz * wz
  const E = vx * wx + vy * wy + vz * wz
  const den = C - B * B
  let t: number
  if (den < 1e-9) t = C > 0 ? E / C : 0
  else t = (E - B * D) / den
  t = t < 0 ? 0 : t > 1 ? 1 : t
  // with t clamped to the segment, the best ray parameter is the projection of that segment point on the ray (never behind the origin)
  const s = Math.max(0, B * t - D)
  const px = ox + ux * s - (ax + vx * t)
  const py = oy + uy * s - (ay + vy * t)
  const pz = oz + uz * s - (az + vz * t)
  const dist = Math.sqrt(px * px + py * py + pz * pz)
  return dist <= radius ? { t: s, dist } : null
}

/** A vertical person: feet-to-head segment at (cx, cz) from y0 to y1 (the Waltz helper, kept for its callers and tests). */
export function rayVsPerson(ox: number, oy: number, oz: number, ux: number, uy: number, uz: number, cx: number, y0: number, y1: number, cz: number, radius: number): RayHit | null {
  return rayVsSegment(ox, oy, oz, ux, uy, uz, cx, y0, cz, cx, y1, cz, radius)
}
