/**
 * R5: the watch camera's limits (pure, allocation-free). Whatever a shot, a dolly or your free look asks for, the eye is kept
 *
 *   1. inside its area (the room's walls) less `ROOM_MARGIN`,
 *   2. under the ceiling (`BoomProbe.ceilingAt`) less `CEILING_MARGIN`, and above `MIN_EYE_Y`,
 *   3. out of a cylinder of `PERSON_RADIUS` round each person of the room (below `PERSON_TOP`: over their heads is fine),
 *   4. on the near side of every wall between it and what it looks at: a ball of `CAST_RADIUS` swept from the look point to the eye (the walls of the
 *      chase camera's own probe, in SIM coordinates); where it hits, the eye comes in to `WALL_GAP` short of the hit.
 *
 * The last rule wins (a wall is never crossed, even if that brings the eye closer to someone).
 *
 * Choosing a shot's pose (shots.ts `pickAltInto`) asks more of a candidate eye than the clamp can give: out of the furniture, the robot cart and the
 * surgical lights (`Obstacles`, each with its own bottom and top), and a clear line to what it looks at: nobody's body between the lens and the look
 * point (`segmentClearOfPeople`: each person a vertical capsule of `BODY_RADIUS` from the floor to `BODY_TOP`).
 */
import type { BoomProbe } from '@/scene/player/boomProbe'
import type { Rect } from '@/sim/places'
import type { Vec3 } from '@/sim/types'

export const ROOM_MARGIN = 0.3
export const CEILING_MARGIN = 0.35
export const MIN_EYE_Y = 0.45
export const PERSON_RADIUS = 0.3
export const PERSON_TOP = 1.95
export const CAST_RADIUS = 0.1
export const WALL_GAP = 0.15
/** A body, for the line of sight: a vertical capsule this wide and tall. */
export const BODY_RADIUS = 0.28
export const BODY_TOP = 1.85
/** A candidate eye keeps at least this far from anyone (more than the clamp's `PERSON_RADIUS`, so the clamp never has to move it). */
export const PERSON_CLEAR = 0.35
/** How far a candidate eye keeps out of an obstacle's footprint, and above or below it. */
export const OBSTACLE_MARGIN = 0.15
export const OBSTACLE_HEIGHT_MARGIN = 0.25
/** A ceiling where the probe knows none (open sky never happens indoors). */
const DEFAULT_CEILING = 3.0

/** The people the eye keeps clear of this frame: floor positions, preallocated (`newPeople`), refilled every frame. */
export interface PeopleBuf {
  count: number
  readonly x: Float64Array
  readonly z: Float64Array
}

export function newPeople(capacity = 24): PeopleBuf {
  return { count: 0, x: new Float64Array(capacity), z: new Float64Array(capacity) }
}

export function addPerson(buf: PeopleBuf, x: number, z: number): void {
  if (buf.count >= buf.x.length) return
  buf.x[buf.count] = x
  buf.z[buf.count] = z
  buf.count++
}

const _dir: Vec3 = { x: 0, y: 0, z: 0 }

/** Is (x, z) inside the rectangle shrunk by `margin`? */
export function insideRect(r: Readonly<Rect>, x: number, z: number, margin = 0): boolean {
  return x >= r.x0 + margin && x <= r.x1 - margin && z >= r.z0 + margin && z <= r.z1 - margin
}

/**
 * Keep `eye` within the limits for a camera looking at `target`, writing the result into `out` (may be `eye`). `area` is the rectangle the eye stands in
 * (sim coordinates). Allocation-free.
 */
export function clampEyeInto(eye: Readonly<Vec3>, target: Readonly<Vec3>, area: Readonly<Rect>, probe: BoomProbe, people: Readonly<PeopleBuf>, out: Vec3): Vec3 {
  let x = eye.x
  let y = eye.y
  let z = eye.z
  // 1. the room
  const x0 = area.x0 + ROOM_MARGIN
  const x1 = area.x1 - ROOM_MARGIN
  const z0 = area.z0 + ROOM_MARGIN
  const z1 = area.z1 - ROOM_MARGIN
  if (x < x0) x = x0
  else if (x > x1) x = x1
  if (z < z0) z = z0
  else if (z > z1) z = z1
  // 2. the ceiling and the floor
  const ceiling = probe.ceilingAt(x, z) ?? DEFAULT_CEILING
  const top = ceiling - CEILING_MARGIN
  if (y > top) y = top
  if (y < MIN_EYE_Y) y = MIN_EYE_Y
  // 3. the people (twice, so a push out of one cylinder into a neighbour's is pushed out again)
  if (y < PERSON_TOP) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < people.count; i++) {
        const dx = x - people.x[i]
        const dz = z - people.z[i]
        const d2 = dx * dx + dz * dz
        if (d2 >= PERSON_RADIUS * PERSON_RADIUS) continue
        const d = Math.sqrt(d2)
        if (d > 1e-6) {
          x = people.x[i] + (dx / d) * PERSON_RADIUS
          z = people.z[i] + (dz / d) * PERSON_RADIUS
        } else {
          // standing right in someone: step back toward the side away from the look point
          let bx = x - target.x
          let bz = z - target.z
          const l = Math.sqrt(bx * bx + bz * bz)
          bx = l > 1e-6 ? bx / l : 1
          bz = l > 1e-6 ? bz / l : 0
          x = people.x[i] + bx * PERSON_RADIUS
          z = people.z[i] + bz * PERSON_RADIUS
        }
      }
    }
  }
  // 4. the walls between the look point and the eye
  const dx = x - target.x
  const dy = y - target.y
  const dz = z - target.z
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len > 1e-4) {
    _dir.x = dx / len
    _dir.y = dy / len
    _dir.z = dz / len
    const hit = probe.cast(target, _dir, len, CAST_RADIUS)
    if (hit !== null) {
      const d = hit - WALL_GAP > 0.05 ? hit - WALL_GAP : 0.05
      x = target.x + _dir.x * d
      y = target.y + _dir.y * d
      z = target.z + _dir.z * d
    }
  }
  out.x = x
  out.y = y
  out.z = z
  return out
}

// ---------------------------------------------------------------------------------------------
// Obstacles: furniture, the robot cart, the surgical lights
// ---------------------------------------------------------------------------------------------

/** Boxes (`kind` 0: a rotated rectangle, half extents `hw` x `hd` along its own x and z) and cylinders (`kind` 1: radius `hw`) from `bottom` to `top`. */
export interface Obstacles {
  count: number
  readonly kind: Uint8Array
  readonly x: Float64Array
  readonly z: Float64Array
  readonly hw: Float64Array
  readonly hd: Float64Array
  readonly cos: Float64Array
  readonly sin: Float64Array
  readonly bottom: Float64Array
  readonly top: Float64Array
}

export function newObstacles(capacity = 48): Obstacles {
  return {
    count: 0,
    kind: new Uint8Array(capacity),
    x: new Float64Array(capacity),
    z: new Float64Array(capacity),
    hw: new Float64Array(capacity),
    hd: new Float64Array(capacity),
    cos: new Float64Array(capacity),
    sin: new Float64Array(capacity),
    bottom: new Float64Array(capacity),
    top: new Float64Array(capacity),
  }
}

/** Add an obstacle; returns its slot (-1 when full). `rotation` turns a box like a footprint's `rotationY` (or an entity's heading). */
export function addObstacle(o: Obstacles, kind: 0 | 1, x: number, z: number, hw: number, hd: number, rotation: number, bottom: number, top: number): number {
  const i = o.count
  if (i >= o.x.length) return -1
  o.kind[i] = kind
  o.hw[i] = hw
  o.hd[i] = hd
  o.bottom[i] = bottom
  o.top[i] = top
  o.count++
  moveObstacle(o, i, x, z, rotation)
  return i
}

/** Move an obstacle (the cart, every frame). Allocation-free. */
export function moveObstacle(o: Obstacles, i: number, x: number, z: number, rotation: number): void {
  o.x[i] = x
  o.z[i] = z
  o.cos[i] = Math.cos(rotation)
  o.sin[i] = Math.sin(rotation)
}

/** The obstacle (slot) the point is in or within the margins of, or -1. Allocation-free. */
export function insideObstacle(o: Readonly<Obstacles>, x: number, y: number, z: number, margin = OBSTACLE_MARGIN, heightMargin = OBSTACLE_HEIGHT_MARGIN): number {
  for (let i = 0; i < o.count; i++) {
    if (y < o.bottom[i] - heightMargin || y > o.top[i] + heightMargin) continue
    const dx = x - o.x[i]
    const dz = z - o.z[i]
    if (o.kind[i] === 1) {
      const r = o.hw[i] + margin
      if (dx * dx + dz * dz < r * r) return i
      continue
    }
    const c = o.cos[i]
    const s = o.sin[i]
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    if (lx < o.hw[i] + margin && lx > -o.hw[i] - margin && lz < o.hd[i] + margin && lz > -o.hd[i] - margin) return i
  }
  return -1
}

/**
 * How tall a piece of furniture is (m), by its footprint id (the eye may pass over what is lower than it): the theatre's, then (R5 wave 3) the CT suite's
 * and the ultrasound room's, whose pieces are lower than the 2.2 m a footprint of unknown height is assumed to be.
 */
export function furnitureTop(id: string): number {
  if (/:table$/.test(id)) return 1.3 // with the patient on it
  if (/:chair$/.test(id)) return 1.35
  if (/:console:(surgeon|teach)$/.test(id)) return 1.65
  if (/:(vision|anaesthesia)$/.test(id)) return 1.95
  if (/:stool$/.test(id)) return 0.8
  if (/:(backtable|mayo|desk)$/.test(id)) return 1.2
  if (/:scrub$/.test(id)) return 1.9
  // the CT cryo suite
  if (/:cryo:ct:gantry$/.test(id)) return 2.2
  if (/:cryo:robot$/.test(id)) return 1.6 // its base 0.85 m and the arm folded over it
  if (/:cryo:console$/.test(id)) return 1.5
  if (/:cryo:anaes$/.test(id)) return 1.7 // the machine and its monitor tower
  if (/:cryo:cylinders$/.test(id)) return 1.3
  if (/:cryo:cabinet$/.test(id)) return 1.1
  if (/:cryoctl:station$/.test(id)) return 1.2
  // the ultrasound room
  if (/:us:couch$/.test(id)) return 1.15 // with the patient on it
  if (/:us:cart$/.test(id)) return 1.5
  if (/:us:cryo$/.test(id)) return 1.3 // the ProSense console
  if (/:us:counter$/.test(id)) return 1.05
  if (/:us:cabinet$/.test(id)) return 2.0
  return 2.2
}

// ---------------------------------------------------------------------------------------------
// The line of sight
// ---------------------------------------------------------------------------------------------

/**
 * Is the line from `eye` to `target` clear of every person's body (a vertical capsule of `radius` from the floor to `top` at each of `people`)? The last
 * `skipNearTarget` metres before the look point do not count (hands at the work point are what the shot is of), nor does anything past `maxFromEye`
 * metres from the lens (a wide shot of the room only needs its foreground clear: the team round the table is what it shows). Allocation-free.
 */
export function segmentClearOfPeople(
  eye: Readonly<Vec3>,
  target: Readonly<Vec3>,
  people: Readonly<PeopleBuf>,
  radius = BODY_RADIUS,
  top = BODY_TOP,
  skipNearTarget = 0.3,
  maxFromEye = Number.POSITIVE_INFINITY,
): boolean {
  const dx = target.x - eye.x
  const dy = target.y - eye.y
  const dz = target.z - eye.z
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len < 1e-6) return true
  const nearEnd = 1 - skipNearTarget / len
  const farEnd = maxFromEye / len
  const tEnd = nearEnd < farEnd ? nearEnd : farEnd
  if (tEnd <= 0) return true
  const a = dx * dx + dz * dz
  const r2 = radius * radius
  for (let i = 0; i < people.count; i++) {
    const fx = eye.x - people.x[i]
    const fz = eye.z - people.z[i]
    const c = fx * fx + fz * fz - r2
    let t0 = 0
    let t1 = tEnd
    if (a < 1e-9) {
      // a vertical line: inside the circle or not, the whole way
      if (c >= 0) continue
    } else {
      const b = fx * dx + fz * dz
      const disc = b * b - a * c
      if (disc <= 0) continue
      const sq = Math.sqrt(disc)
      const lo = (-b - sq) / a
      const hi = (-b + sq) / a
      t0 = lo > 0 ? lo : 0
      t1 = hi < tEnd ? hi : tEnd
      if (t0 >= t1) continue
    }
    // within the body's circle from t0 to t1: blocked if the line is below the top of the body anywhere there (and above the floor)
    const y0 = eye.y + dy * t0
    const y1 = eye.y + dy * t1
    const low = y0 < y1 ? y0 : y1
    const high = y0 < y1 ? y1 : y0
    if (low < top && high > 0) return false
  }
  return true
}
