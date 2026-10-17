/**
 * Collision on the nav grid, with no physics engine. Your body is a circle of `BODY.radius`. The ground it may stand on is
 * the people's walkable layout (`isWalkable(x, z, margin)`: every area inset by the wall, every door bridge, minus the beds and the
 * furniture footprints, all grown by the margin) PLUS the paved plaza outside the main entrance (`PLAYER_PLAZA`, which only you
 * walk on, so it is not part of the people's layout). The plaza stops `margin` short of the building's wall everywhere, and meets
 * the entrance door's bridge exactly, so you can walk up to the doors and in.
 *
 * A step is split into pieces no longer than `MOVE.maxSubstep` (a walkable margin is at least 0.6 m across, so a piece can never
 * hop over a wall or a bed). Each piece is tried whole; if it is blocked the body goes as far as it can (bisection), then SLIDES
 * along what blocked it with the rest of the step: along an axis (a wall of the building), or turned a little off the way it was
 * going (a round table, a rotated desk). A step never ends on a point that is not walkable.
 */
import { isWalkable, nearestWalkable } from '@/sim/nav/layout'
import { PLAYER_PLAZA, WALL } from '@/sim/places'
import type { Vec2 } from '@/sim/types'
import { BODY, MOVE } from './tuning'

const HALF_WALL = WALL.thickness / 2

/**
 * Is (x, z) on the plaza, with a body of radius `margin`? The east edge stops a wall's half thickness plus the margin short of
 * the building's wall line, which is where the entrance door's bridge begins, so the two are one continuous floor.
 */
export function inPlaza(x: number, z: number, margin: number = BODY.radius): boolean {
  const r = PLAYER_PLAZA
  return x >= r.x0 + margin && x <= r.x1 - HALF_WALL - margin && z >= r.z0 + margin && z <= r.z1 - margin
}

/** Can your body centre stand here? (The one test every step is checked with.) */
export function walkableAt(x: number, z: number, margin: number = BODY.radius): boolean {
  return isWalkable(x, z, margin, margin) || inPlaza(x, z, margin)
}

export interface BodyMove {
  x: number
  z: number
  /** True when the body got less than it asked for (it touched something). */
  blocked: boolean
}

export function newBodyMove(): BodyMove {
  return { x: 0, z: 0, blocked: false }
}

const _s = { x: 0, z: 0 }
const _near = { x: 0, z: 0 }
/** Angles tried when a step is blocked, as (cos, sin) pairs: turn the step by this much and shorten it by the cosine. */
const SLIDE_ANGLES = [22.5, 45, 67.5].map((d) => ({ c: Math.cos((d * Math.PI) / 180), s: Math.sin((d * Math.PI) / 180) }))

/** Largest t in [0, 1] such that (x + t dx, z + t dz) is walkable, given that t = 0 is (bisection, 7 rounds: a millimetre on a 0.1 m step). */
function reach(x: number, z: number, dx: number, dz: number, margin: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2
    if (walkableAt(x + dx * mid, z + dz * mid, margin)) lo = mid
    else hi = mid
  }
  return lo
}

/** Try to move from (x, z) by (dx, dz) as far as possible, sliding. Writes the new position to `_s` and returns how much of the step was kept (0..1 of its length). */
function pieceStep(x: number, z: number, dx: number, dz: number, margin: number): number {
  _s.x = x
  _s.z = z
  const want = Math.hypot(dx, dz)
  if (want < 1e-12) return 1
  if (walkableAt(x + dx, z + dz, margin)) {
    _s.x = x + dx
    _s.z = z + dz
    return 1
  }
  // as far as it goes, then slide with what is left
  const t = reach(x, z, dx, dz, margin)
  let px = x + dx * t
  let pz = z + dz * t
  const rx = dx * (1 - t)
  const rz = dz * (1 - t)
  const rem = Math.hypot(rx, rz)
  let kept = t * want
  if (rem > 1e-9) {
    const slid = slide(px, pz, rx, rz, margin)
    if (slid > 0) {
      px = _s.x
      pz = _s.z
      kept += slid
    }
  }
  _s.x = px
  _s.z = pz
  return Math.min(1, kept / want)
}

/** Slide (rx, rz) from (px, pz): turned a little, or along one axis. Writes `_s` and returns the distance actually moved (0 if nothing worked). */
function slide(px: number, pz: number, rx: number, rz: number, margin: number): number {
  // turned off the way it was going by 22.5 degrees (round things), either side
  const first = SLIDE_ANGLES[0]
  for (let side = -1; side <= 1; side += 2) {
    const tx = (rx * first.c - side * rz * first.s) * first.c
    const tz = (rz * first.c + side * rx * first.s) * first.c
    if (walkableAt(px + tx, pz + tz, margin)) {
      _s.x = px + tx
      _s.z = pz + tz
      return Math.hypot(tx, tz)
    }
  }
  // along an axis (the walls of the building), the longer one first
  const xFirst = Math.abs(rx) >= Math.abs(rz)
  for (let k = 0; k < 2; k++) {
    const alongX = xFirst === (k === 0)
    const ax = alongX ? rx : 0
    const az = alongX ? 0 : rz
    if ((ax !== 0 || az !== 0) && walkableAt(px + ax, pz + az, margin)) {
      _s.x = px + ax
      _s.z = pz + az
      return Math.hypot(ax, az)
    }
  }
  // turned more
  for (let a = 1; a < SLIDE_ANGLES.length; a++) {
    const an = SLIDE_ANGLES[a]
    for (let side = -1; side <= 1; side += 2) {
      const tx = (rx * an.c - side * rz * an.s) * an.c
      const tz = (rz * an.c + side * rx * an.s) * an.c
      if (walkableAt(px + tx, pz + tz, margin)) {
        _s.x = px + tx
        _s.z = pz + tz
        return Math.hypot(tx, tz)
      }
    }
  }
  return 0
}

/**
 * Move the body from (x, z) by (dx, dz), sliding along walls and furniture. Never ends on a point that is not walkable (if the
 * body STARTS on one, see `settle`). Writes into `out` and returns it.
 */
export function moveBody(x: number, z: number, dx: number, dz: number, out: BodyMove, margin: number = BODY.radius): BodyMove {
  let cx = x
  let cz = z
  let blocked = false
  const dist = Math.hypot(dx, dz)
  if (dist > 1e-12) {
    const n = Math.max(1, Math.ceil(dist / MOVE.maxSubstep))
    const sx = dx / n
    const sz = dz / n
    for (let i = 0; i < n; i++) {
      const kept = pieceStep(cx, cz, sx, sz, margin)
      cx = _s.x
      cz = _s.z
      if (kept < 0.999) {
        blocked = true
        if (kept <= 1e-6) break
      }
    }
  }
  out.x = cx
  out.z = cz
  out.blocked = blocked
  return out
}

/**
 * The nearest point you can stand on to (x, z): the point itself when it is fine (a body just spawned, or carried over a Jump, or
 * put down by another system). Writes into `out` and returns it; if there is nowhere (which the layout rules out), it is unchanged.
 */
export function settle(x: number, z: number, out: Vec2, margin: number = BODY.radius): Vec2 {
  if (walkableAt(x, z, margin)) {
    out.x = x
    out.z = z
    return out
  }
  nearestWalkable(x, z, margin, _near)
  const navOk = isWalkable(_near.x, _near.z, margin, margin)
  // the plaza's nearest point: clamp into its walkable rectangle
  const r = PLAYER_PLAZA
  const px = Math.min(r.x1 - HALF_WALL - margin, Math.max(r.x0 + margin, x))
  const pz = Math.min(r.z1 - margin, Math.max(r.z0 + margin, z))
  const plazaD = (px - x) * (px - x) + (pz - z) * (pz - z)
  const navD = navOk ? (_near.x - x) * (_near.x - x) + (_near.z - z) * (_near.z - z) : Infinity
  if (plazaD <= navD) {
    out.x = px
    out.z = pz
  } else {
    out.x = _near.x
    out.z = _near.z
  }
  return out
}
