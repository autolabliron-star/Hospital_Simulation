/**
 * Exact swept-circle tests for the body's collide-and-slide (`collision.ts`): a circle of radius `R` moving from (px, pz) by (dx, dz)
 * against an oriented box or against another circle. Pure maths on plain numbers, allocation free: every function writes into a
 * preallocated `SweepHit` and returns whether the motion is stopped by the shape.
 *
 * Conventions
 *   - A box is (cx, cz) its centre, (ux, uz) a unit axis u on the floor, (hu, hv) its half extents along u and along
 *     v = (-uz, ux). The same layout as a blocker (`src/scene/blockers.ts`).
 *   - `t` is the time of impact in [0, 1] along the motion; the contact normal (nx, nz) is a unit vector pointing OUT of the solid, and
 *     the circle is exactly `R` from the solid at the impact (the Minkowski sum of the box and the circle is exact here: two rectangles
 *     grown along u and along v, plus four quarter discs at the corners).
 *   - A shape the circle STARTS inside of (closer than `R`) reports `overlap` with t = 0 and the normal of the nearest feature, and only
 *     counts when the motion goes INTO it (motion . normal < 0): a body can always walk out of what it overlaps, and never deeper in.
 *   - A body whose CENTRE is inside the shape itself (it was put down on a seat: a chair, a stool, a bench, a bed) walks out the way it
 *     faces, through whichever face that is, when the way out is short (`MAX_ESCAPE`): it is not "deeper in" to cross a bed lengthways.
 *   - A hit always has motion . normal < 0, so a body sliding along a face (motion . normal = 0) is never "hit" by it.
 *   - CONTACT: a body that touches a shape (its distance is R, give or take float rounding: from `R - OVERLAP_EPS` to `R + CONTACT_EPS`) is
 *     decided by the nearest feature's outward normal alone, never by the slab test: the motion is a hit (t = 0) only when it goes INTO the
 *     surface (motion . normal < -INTO_REL |motion|); along it and away from it is free, whatever the rounding. (The slab test sees a start
 *     on the grown box's boundary as "inside" it and used to pick the FAR face's normal for a motion leaving it, so a body at rest against a
 *     wall could not back away from it, nor slide along it, while the motion was still held up at t = 0.)
 */

export interface SweepHit {
  /** Time of impact, 0..1. */
  t: number
  /** Unit contact normal, pointing out of the solid. */
  nx: number
  nz: number
  /** The circle started closer to the solid than R (t is 0). */
  overlap: boolean
  /** Depth of that overlap, metres (R minus the distance); 0 when not overlapping. */
  depth: number
}

export function newSweepHit(): SweepHit {
  return { t: 1, nx: 0, nz: 0, overlap: false, depth: 0 }
}

/** Closer than R by more than this counts as overlapping (below it, the circle is touching). */
export const OVERLAP_EPS = 1e-9
/** A body this close to R, or closer, from a shape (metres, outside the grown shape) is ON the surface: touching. */
export const CONTACT_EPS = 1e-6
/** A hit needs the motion to go into the surface by more than this (motion . normal, metres). */
const INTO_EPS = 1e-12
/** In contact, a hit needs the motion to go into the surface by more than this share of its length (the sine of the angle to the surface). */
const INTO_REL = 1e-9
const PARALLEL_EPS = 1e-14
/** A start this close to a face (metres) is ON it. */
const FACE_EPS = 1e-9
/** A body with its centre inside a shape may walk out the way it faces if that way out is no longer than this (metres): a bed is 2.1 m long. */
export const MAX_ESCAPE = 1.3

// scratch result of the slab test (module level: no allocation)
let _t = 0
let _nlx = 0
let _nlz = 0

/**
 * The ray (lx, lz) + t (ldx, ldz) against the axis-aligned rectangle [x0, x1] x [z0, z1]: where it ENTERS, for t in [0, 1]. On true, `_t` is
 * the entry time (clamped at 0) and (`_nlx`, `_nlz`) the face normal it enters through (pointing out of the rectangle).
 */
function rectEntry(lx: number, lz: number, ldx: number, ldz: number, x0: number, x1: number, z0: number, z1: number, tMax: number): boolean {
  let tIn = -Infinity
  let tOut = Infinity
  let nlx = 0
  let nlz = 0
  if (ldx > -PARALLEL_EPS && ldx < PARALLEL_EPS) {
    // moving along x's faces: only strictly between them is inside; ON a face (a body sliding along it) is grazing, not a hit
    if (lx <= x0 + FACE_EPS || lx >= x1 - FACE_EPS) return false
  } else {
    const ta = (x0 - lx) / ldx
    const tb = (x1 - lx) / ldx
    if (ldx > 0) {
      tIn = ta
      tOut = tb
      nlx = -1
    } else {
      tIn = tb
      tOut = ta
      nlx = 1
    }
  }
  if (ldz > -PARALLEL_EPS && ldz < PARALLEL_EPS) {
    if (lz <= z0 + FACE_EPS || lz >= z1 - FACE_EPS) return false
  } else {
    const ta = (z0 - lz) / ldz
    const tb = (z1 - lz) / ldz
    let zIn: number
    let zOut: number
    let zn: number
    if (ldz > 0) {
      zIn = ta
      zOut = tb
      zn = -1
    } else {
      zIn = tb
      zOut = ta
      zn = 1
    }
    if (zIn > tIn) {
      tIn = zIn
      nlx = 0
      nlz = zn
    }
    if (zOut < tOut) tOut = zOut
  }
  if (tIn > tOut || tOut < 0 || tIn > tMax) return false
  _t = tIn < 0 ? 0 : tIn
  _nlx = nlx
  _nlz = nlz
  return true
}

/** The ray against a circle of radius `rad` at (qx, qz) (the ray's start, relative to it, is outside it). On true: `_t`, and the normal in `_nlx`, `_nlz`. */
function circleEntry(qx: number, qz: number, ldx: number, ldz: number, rad: number, tMax: number): boolean {
  const a = ldx * ldx + ldz * ldz
  if (a < 1e-24) return false
  const b = qx * ldx + qz * ldz
  if (b >= 0) return false // moving away or along
  const c = qx * qx + qz * qz - rad * rad
  const disc = b * b - a * c
  if (disc < 0) return false
  const t = (-b - Math.sqrt(disc)) / a
  if (t > tMax) return false
  const tt = t < 0 ? 0 : t
  const hx = qx + ldx * tt
  const hz = qz + ldz * tt
  const len = Math.hypot(hx, hz)
  if (len < 1e-12) return false
  _t = tt
  _nlx = hx / len
  _nlz = hz / len
  return true
}

/**
 * A circle of radius `R` from (px, pz), moving by (dx, dz), against the oriented box. Reports a hit earlier than `tMax` only (so a caller
 * keeping the earliest of many shapes passes its best so far). On true the hit is in `out`.
 */
export function sweepCircleBox(px: number, pz: number, dx: number, dz: number, R: number, cx: number, cz: number, ux: number, uz: number, hu: number, hv: number, tMax: number, out: SweepHit): boolean {
  const ox = px - cx
  const oz = pz - cz
  // into the box's own frame (u, v), v = (-uz, ux)
  const lx = ox * ux + oz * uz
  const lz = -ox * uz + oz * ux
  const ldx = dx * ux + dz * uz
  const ldz = -dx * uz + dz * ux
  const ax = Math.abs(lx) - hu
  const az = Math.abs(lz) - hv
  let nlx: number
  let nlz: number
  let depth: number
  if (ax <= 0 && az <= 0) {
    // the centre is inside the box itself (put down on a seat): free to walk out the way it faces when that way out is short...
    const along = Math.hypot(ldx, ldz)
    if (along < 1e-12) return false
    const ex = ldx > 0 ? (hu - lx) / ldx : ldx < 0 ? (-hu - lx) / ldx : Infinity
    const ez = ldz > 0 ? (hv - lz) / ldz : ldz < 0 ? (-hv - lz) / ldz : Infinity
    if (Math.min(ex, ez) * along <= MAX_ESCAPE) return false
    // ...otherwise out through the nearest face
    if (-ax < -az) {
      nlx = lx < 0 ? -1 : 1
      nlz = 0
      depth = R - ax
    } else {
      nlx = 0
      nlz = lz < 0 ? -1 : 1
      depth = R - az
    }
  } else {
    const qx = ax > 0 ? ax : 0
    const qz = az > 0 ? az : 0
    const dist = Math.hypot(qx, qz)
    if (dist < R + CONTACT_EPS) {
      // overlapping, or touching (R from it, give or take rounding): the nearest feature's normal decides, and only the motion INTO it counts
      nlx = lx < 0 ? -qx / dist : qx / dist
      nlz = lz < 0 ? -qz / dist : qz / dist
      if (dist < R - OVERLAP_EPS) {
        depth = R - dist
      } else {
        const into = ldx * nlx + ldz * nlz
        if (into >= -INTO_REL * Math.hypot(ldx, ldz) || 0 >= tMax) return false
        out.t = 0
        out.nx = nlx * ux - nlz * uz
        out.nz = nlx * uz + nlz * ux
        out.overlap = false
        out.depth = 0
        return true
      }
    } else {
      // outside by R or more: the first entry into the grown box
      if (!rectEntry(lx, lz, ldx, ldz, -hu - R, hu + R, -hv - R, hv + R, tMax)) return false
      let bestT = Infinity
      let bnx = 0
      let bnz = 0
      if (rectEntry(lx, lz, ldx, ldz, -hu - R, hu + R, -hv, hv, tMax) && _t < bestT) {
        bestT = _t
        bnx = _nlx
        bnz = _nlz
      }
      if (rectEntry(lx, lz, ldx, ldz, -hu, hu, -hv - R, hv + R, tMax) && _t < bestT) {
        bestT = _t
        bnx = _nlx
        bnz = _nlz
      }
      // the four rounded corners
      for (let k = 0; k < 4; k++) {
        const kx = k & 1 ? hu : -hu
        const kz = k & 2 ? hv : -hv
        if (circleEntry(lx - kx, lz - kz, ldx, ldz, R, tMax) && _t < bestT) {
          bestT = _t
          bnx = _nlx
          bnz = _nlz
        }
      }
      if (bestT > tMax || bestT === Infinity) return false
      if (ldx * bnx + ldz * bnz >= -INTO_EPS) return false
      out.t = bestT
      out.nx = bnx * ux - bnz * uz
      out.nz = bnx * uz + bnz * ux
      out.overlap = false
      out.depth = 0
      return true
    }
  }
  // started inside the grown box: only the motion into it counts
  if (ldx * nlx + ldz * nlz >= -INTO_EPS) return false
  if (0 >= tMax) return false
  out.t = 0
  out.nx = nlx * ux - nlz * uz
  out.nz = nlx * uz + nlz * ux
  out.overlap = true
  out.depth = depth
  return true
}

/** A circle of radius `R` from (px, pz), moving by (dx, dz), against a circle of radius `r` at (cx, cz). */
export function sweepCircleCircle(px: number, pz: number, dx: number, dz: number, R: number, cx: number, cz: number, r: number, tMax: number, out: SweepHit): boolean {
  const qx = px - cx
  const qz = pz - cz
  const rad = R + r
  const dist2 = qx * qx + qz * qz
  if (dist2 < (rad - OVERLAP_EPS) * (rad - OVERLAP_EPS)) {
    const dist = Math.sqrt(dist2)
    // the centre inside the circle itself (put down on a stool): free to walk out in any direction, the way out is at most r
    if (dist < r && r <= MAX_ESCAPE) return false
    let nx = 1
    let nz = 0
    if (dist > 1e-9) {
      nx = qx / dist
      nz = qz / dist
    }
    if (dx * nx + dz * nz >= -INTO_EPS) return false
    if (0 >= tMax) return false
    out.t = 0
    out.nx = nx
    out.nz = nz
    out.overlap = true
    out.depth = rad - dist
    return true
  }
  const reach = rad + CONTACT_EPS
  if (dist2 < reach * reach) {
    // touching (rad from it, give or take rounding): the line of centres is the normal, and only the motion INTO it counts
    const dist = Math.sqrt(dist2)
    const nx = qx / dist
    const nz = qz / dist
    if (dx * nx + dz * nz >= -INTO_REL * Math.hypot(dx, dz) || 0 >= tMax) return false
    out.t = 0
    out.nx = nx
    out.nz = nz
    out.overlap = false
    out.depth = 0
    return true
  }
  if (!circleEntry(qx, qz, dx, dz, rad, tMax)) return false
  if (dx * _nlx + dz * _nlz >= -INTO_EPS) return false
  out.t = _t
  out.nx = _nlx
  out.nz = _nlz
  out.overlap = false
  out.depth = 0
  return true
}

/**
 * How far a circle of radius `R` at (px, pz) overlaps the box (R minus its distance to the box, 0 when clear), with the push-out normal
 * written to `out.nx / out.nz`. For settling a body out of a solid and for the dynamic push-out.
 */
export function overlapCircleBox(px: number, pz: number, R: number, cx: number, cz: number, ux: number, uz: number, hu: number, hv: number, out: SweepHit): number {
  const ox = px - cx
  const oz = pz - cz
  const lx = ox * ux + oz * uz
  const lz = -ox * uz + oz * ux
  const ax = Math.abs(lx) - hu
  const az = Math.abs(lz) - hv
  let nlx: number
  let nlz: number
  let depth: number
  if (ax <= 0 && az <= 0) {
    if (-ax < -az) {
      nlx = lx < 0 ? -1 : 1
      nlz = 0
      depth = R - ax
    } else {
      nlx = 0
      nlz = lz < 0 ? -1 : 1
      depth = R - az
    }
  } else {
    const qx = ax > 0 ? ax : 0
    const qz = az > 0 ? az : 0
    const dist = Math.hypot(qx, qz)
    if (dist >= R - OVERLAP_EPS) return 0
    nlx = lx < 0 ? -qx / dist : qx / dist
    nlz = lz < 0 ? -qz / dist : qz / dist
    depth = R - dist
  }
  out.nx = nlx * ux - nlz * uz
  out.nz = nlx * uz + nlz * ux
  out.depth = depth
  return depth
}

/** The same for a circle of radius `r` at (cx, cz). */
export function overlapCircleCircle(px: number, pz: number, R: number, cx: number, cz: number, r: number, out: SweepHit): number {
  const qx = px - cx
  const qz = pz - cz
  const rad = R + r
  const dist2 = qx * qx + qz * qz
  if (dist2 >= (rad - OVERLAP_EPS) * (rad - OVERLAP_EPS)) return 0
  const dist = Math.sqrt(dist2)
  if (dist > 1e-9) {
    out.nx = qx / dist
    out.nz = qz / dist
  } else {
    out.nx = 1
    out.nz = 0
  }
  out.depth = rad - dist
  return out.depth
}
