/**
 * Collision, with no physics engine: your body is a circle of `BODY.radius` that SLIDES along everything solid, keeping its speed.
 *
 * What is solid (see `solids.ts`): the walls and cabinets, every bed and piece of furniture (no station exemption: people may stand
 * against their own desk, you may not), the pharmacist desks and the MedVend island, the canopy columns and planters, and fences
 * along the edge of the floor you may stand on. What moves (`DynamicShapes`, filled by the owner each frame): the leaves of closed
 * doors (`src/scene/blockers.ts`), standing people, pushed wheelchairs and stretchers, their riders and the MealBots.
 *
 * `moveBody` is a swept-circle collide-and-slide (`sweep.ts` holds the exact maths):
 *   0. anything MOVING that overlaps the body pushes it out first (at most `maxPush` a frame, and the push itself is a slide against the
 *      static solids, so a door or a person can never push you into a wall);
 *   1. a step that meets something is cut into pieces of at most `SUBSTEP` metres (a curved obstacle is then followed within 0.1 mm; a
 *      clear step is one sweep), each of which is up to `MAX_ITERATIONS` rounds of: sweep a circle of radius r + skin, move to the first contact (a skin-sized gap
 *      exactly), remove the motion INTO the surface and carry on with what is left along it. In a crease (the new direction pushes into
 *      a surface already met) the motion stops. A body that STARTS overlapping a shape ignores it while the motion goes away from it
 *      (so you can always walk out of a seat or of a leaf that closed on you) and never goes deeper in.
 *   2. the backstop: the people's region test (`isWalkable` at margin 0.18, which never rejects a legal contact: at a convex jamb a
 *      touching body is 0.3 sin 45 = 0.212 from the corner) and the plaza must still agree. If the solids and the region ever disagree the
 *      step falls back per axis, and `collisionStats.backstopFallbacks` counts it (the walk tests insist it stays 0).
 *
 * `walkableAt(x, z, margin)` is "inside the region and no static solid within `margin`"; `settle` pushes a point out of the static solids
 * and then falls back to the people's nearest-walkable search; `inPlaza` is the paved apron (the entrance door's bridge meets it exactly).
 */
import { BLOCKER_STRIDE, blockerSources } from '@/scene/blockers'
import { CONFIG } from '@/sim/config'
import { isWalkable, nearestWalkable, zoneAt } from '@/sim/nav/layout'
import { PLAYER_PLAZA, WALL } from '@/sim/places'
import type { Vec2 } from '@/sim/types'
import { GROUP, KIND_BOX, KIND_CIRCLE, QUERY_CAPACITY, SOLID_STRIDE, queryStatic, staticSolids } from './solids'
import { newSweepHit, overlapCircleBox, overlapCircleCircle, sweepCircleBox, sweepCircleCircle } from './sweep'
import { BODY } from './tuning'

const HALF_WALL = WALL.thickness / 2

/** The body stops this short of every solid (metres). */
export const SKIN: number = CONFIG.player.bodySkin
/** The margin of the region backstop (see the module comment). */
export const REGION_MARGIN = 0.18
/** A step that meets something is cut into pieces no longer than this (metres): a curved obstacle is then followed within 0.1 mm. A clear step is one sweep. */
export const SUBSTEP = 0.01
/** Rounds of sweep-and-slide a piece gets. */
export const MAX_ITERATIONS = 4
/** How many moving shapes the body looks at (the nearest ones are collected; the rest are ignored). */
export const DYNAMIC_CAPACITY = 64

/** Counters for the tests: the region backstop is a safety net, and a walk must never need it. */
export const collisionStats = { backstopFallbacks: 0 }

/**
 * Is (x, z) on the plaza, with a body of radius `margin`? The east edge stops a wall's half thickness plus the margin short of
 * the building's wall line, which is where the entrance door's bridge begins, so the two are one continuous floor.
 */
export function inPlaza(x: number, z: number, margin: number = BODY.radius): boolean {
  const r = PLAYER_PLAZA
  return x >= r.x0 + margin && x <= r.x1 - HALF_WALL - margin && z >= r.z0 + margin && z <= r.z1 - margin
}

/** The region backstop: on the people's floor (furniture ignored) or on the plaza, with `margin` of clearance from walls. */
export function inRegion(x: number, z: number, margin: number = REGION_MARGIN): boolean {
  return isWalkable(x, z, margin, -1) || inPlaza(x, z, margin)
}

// ---------------------------------------------------------------------------------------------
// The moving shapes
// ---------------------------------------------------------------------------------------------

/**
 * The shapes that move, collected by the owner each frame into one fixed buffer: SOLID_STRIDE numbers each (kind, cx, cz, ux, uz, hu, hv; a
 * circle has its radius in hu), the same layout as the static solids. `clear()`, add, then `moveBody`.
 */
export class DynamicShapes {
  readonly data = new Float64Array(DYNAMIC_CAPACITY * SOLID_STRIDE)
  count = 0
  /** The most one frame pushes the body out of a shape it overlaps (metres). The owner sets it from the frame time. */
  maxPush = 0.1

  clear(): void {
    this.count = 0
  }

  addCircle(cx: number, cz: number, r: number): boolean {
    if (this.count >= DYNAMIC_CAPACITY) return false
    const o = this.count++ * SOLID_STRIDE
    const d = this.data
    d[o] = KIND_CIRCLE
    d[o + 1] = cx
    d[o + 2] = cz
    d[o + 3] = 1
    d[o + 4] = 0
    d[o + 5] = r
    d[o + 6] = r
    return true
  }

  /** An oriented box: unit axis (ux, uz), half extents hu along it and hv along v = (-uz, ux). */
  addBox(cx: number, cz: number, ux: number, uz: number, hu: number, hv: number): boolean {
    if (this.count >= DYNAMIC_CAPACITY) return false
    const o = this.count++ * SOLID_STRIDE
    const d = this.data
    d[o] = KIND_BOX
    d[o + 1] = cx
    d[o + 2] = cz
    d[o + 3] = ux
    d[o + 4] = uz
    d[o + 5] = hu
    d[o + 6] = hv
    return true
  }

  /** Every live box of every registered blocker source (door leaves) within `radius` metres of (x, z). */
  addBlockers(x: number, z: number, radius: number): void {
    const sources = blockerSources()
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s]
      const d = src.data
      for (let i = 0; i < src.count; i++) {
        const o = i * BLOCKER_STRIDE
        const reach = radius + d[o + 4] + d[o + 5]
        const dx = d[o] - x
        const dz = d[o + 1] - z
        if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue
        this.addBox(d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5])
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Where you can stand
// ---------------------------------------------------------------------------------------------

const _hit = newSweepHit()
const _best = newSweepHit()
const _push = newSweepHit()
const _idx = new Int32Array(QUERY_CAPACITY)
const _sx = { x: 0, z: 0 }
const _near = { x: 0, z: 0 }

/**
 * How far a circle of radius `r` at (x, z) overlaps the static solids (the deepest, metres; 0 when clear), the push-out normal in
 * `_push`. `walls` restricts it to the walls and fences (placing you on a seat respects those only).
 */
function staticOverlap(x: number, z: number, r: number, walls: boolean): number {
  const s = staticSolids()
  const n = queryStatic(x - r, x + r, z - r, z + r, _idx)
  const data = s.data
  let best = 0
  for (let k = 0; k < n; k++) {
    const i = _idx[k]
    if (walls && s.group[i] !== GROUP.wall) continue
    const o = i * SOLID_STRIDE
    const depth =
      data[o] === KIND_CIRCLE
        ? overlapCircleCircle(x, z, r, data[o + 1], data[o + 2], data[o + 5], _hit)
        : overlapCircleBox(x, z, r, data[o + 1], data[o + 2], data[o + 3], data[o + 4], data[o + 5], data[o + 6], _hit)
    if (depth > best) {
      best = depth
      _push.nx = _hit.nx
      _push.nz = _hit.nz
      _push.depth = depth
    }
  }
  return best
}

/** The region ALONE, with no beds or furniture in it: on the people's floor (any zone) or on the plaza, with `margin` of clearance from walls. */
function inFloor(x: number, z: number, margin: number): boolean {
  return zoneAt(x, z, margin) !== null || inPlaza(x, z, margin)
}

/** Can your body centre stand here? Inside the region, and clear of every static solid by `margin`. (The one test every step is checked with.) */
export function walkableAt(x: number, z: number, margin: number = BODY.radius): boolean {
  if (!inRegion(x, z, margin < REGION_MARGIN ? margin : REGION_MARGIN)) return false
  return staticOverlap(x, z, margin, false) === 0
}

export interface BodyMove {
  x: number
  z: number
  /** True when the body got less than it asked for (it touched something). */
  blocked: boolean
  /** How much of the asked distance it got: the length actually moved over the length asked, 0..1 (1 for a step of nothing). */
  progress: number
}

export function newBodyMove(): BodyMove {
  return { x: 0, z: 0, blocked: false, progress: 1 }
}

// ---------------------------------------------------------------------------------------------
// Collide and slide
// ---------------------------------------------------------------------------------------------

/** Directions of the surfaces met so far in one piece (for the crease test). */
const _nx = new Float64Array(MAX_ITERATIONS + 2)
const _nz = new Float64Array(MAX_ITERATIONS + 2)

/** The first thing a circle of radius R moving from (px, pz) by (dx, dz) meets, in `_best`. False when the way is clear. */
function firstHit(px: number, pz: number, dx: number, dz: number, R: number, dyn: DynamicShapes | null): boolean {
  let tBest = 1
  let found = false
  const x0 = (dx < 0 ? px + dx : px) - R - 1e-6
  const x1 = (dx < 0 ? px : px + dx) + R + 1e-6
  const z0 = (dz < 0 ? pz + dz : pz) - R - 1e-6
  const z1 = (dz < 0 ? pz : pz + dz) + R + 1e-6
  const s = staticSolids()
  const n = queryStatic(x0, x1, z0, z1, _idx)
  const data = s.data
  for (let k = 0; k < n; k++) {
    const o = _idx[k] * SOLID_STRIDE
    const hit =
      data[o] === KIND_CIRCLE
        ? sweepCircleCircle(px, pz, dx, dz, R, data[o + 1], data[o + 2], data[o + 5], tBest, _hit)
        : sweepCircleBox(px, pz, dx, dz, R, data[o + 1], data[o + 2], data[o + 3], data[o + 4], data[o + 5], data[o + 6], tBest, _hit)
    if (hit) {
      tBest = _hit.t
      _best.t = _hit.t
      _best.nx = _hit.nx
      _best.nz = _hit.nz
      _best.overlap = _hit.overlap
      _best.depth = _hit.depth
      found = true
    }
  }
  if (dyn !== null) {
    const m = dyn.count
    const d = dyn.data
    for (let k = 0; k < m; k++) {
      const o = k * SOLID_STRIDE
      const hit =
        d[o] === KIND_CIRCLE
          ? sweepCircleCircle(px, pz, dx, dz, R, d[o + 1], d[o + 2], d[o + 5], tBest, _hit)
          : sweepCircleBox(px, pz, dx, dz, R, d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5], d[o + 6], tBest, _hit)
      if (hit) {
        tBest = _hit.t
        _best.t = _hit.t
        _best.nx = _hit.nx
        _best.nz = _hit.nz
        _best.overlap = _hit.overlap
        _best.depth = _hit.depth
        found = true
      }
    }
  }
  return found
}

/**
 * One piece of the step: slide from (px, pz) by (dx, dz). Writes the end point to `_sx`. Returns the number of surfaces met.
 */
function slidePiece(px: number, pz: number, dx: number, dz: number, R: number, dyn: DynamicShapes | null): number {
  let remX = dx
  let remZ = dz
  let met = 0
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (remX * remX + remZ * remZ < 1e-18) break
    if (!firstHit(px, pz, remX, remZ, R, dyn)) {
      px += remX
      pz += remZ
      remX = 0
      remZ = 0
      break
    }
    const t = _best.t
    px += remX * t
    pz += remZ * t
    remX *= 1 - t
    remZ *= 1 - t
    const nx = _best.nx
    const nz = _best.nz
    // the motion into the surface is gone; what is left runs along it
    const into = remX * nx + remZ * nz
    if (into < 0) {
      remX -= into * nx
      remZ -= into * nz
    }
    // a crease: the new direction pushes into a surface met earlier in this piece, and in the plane that leaves nowhere to go
    let creased = false
    for (let k = 0; k < met; k++) {
      if (remX * _nx[k] + remZ * _nz[k] < -1e-9) {
        creased = true
        break
      }
    }
    _nx[met] = nx
    _nz[met] = nz
    met++
    if (creased) {
      remX = 0
      remZ = 0
      break
    }
  }
  _sx.x = px
  _sx.z = pz
  return met
}

/** Phase 0: the moving shapes push the body out of whatever they overlap, through the static solids only. Returns the end point in `_sx`. */
function pushOutOfDynamics(x: number, z: number, R: number, dyn: DynamicShapes): void {
  let px = x
  let pz = z
  let budget = dyn.maxPush
  const d = dyn.data
  for (let pass = 0; pass < 2 && budget > 1e-9; pass++) {
    let moved = false
    for (let k = 0; k < dyn.count && budget > 1e-9; k++) {
      const o = k * SOLID_STRIDE
      const depth =
        d[o] === KIND_CIRCLE
          ? overlapCircleCircle(px, pz, R, d[o + 1], d[o + 2], d[o + 5], _push)
          : overlapCircleBox(px, pz, R, d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5], d[o + 6], _push)
      if (depth <= 0) continue
      const step = depth < budget ? depth : budget
      slidePiece(px, pz, _push.nx * step, _push.nz * step, R, null)
      const mx = _sx.x - px
      const mz = _sx.z - pz
      px = _sx.x
      pz = _sx.z
      budget -= Math.hypot(mx, mz)
      moved = true
    }
    if (!moved) break
  }
  _sx.x = px
  _sx.z = pz
}

/**
 * Move the body from (x, z) by (dx, dz), sliding along walls, furniture, doors and people. Writes into `out` and returns it. A body
 * that starts clear never ends overlapping anything; one that starts overlapping something can only leave it.
 */
export function moveBody(x: number, z: number, dx: number, dz: number, out: BodyMove, dyn: DynamicShapes | null = null, margin: number = BODY.radius): BodyMove {
  const R = margin + SKIN
  let px = x
  let pz = z
  if (dyn !== null && dyn.count > 0) {
    pushOutOfDynamics(px, pz, R, dyn)
    px = _sx.x
    pz = _sx.z
  }
  const sx = px
  const sz = pz
  const dist = Math.hypot(dx, dz)
  if (dist > 1e-12) {
    if (!firstHit(px, pz, dx, dz, R, dyn)) {
      // nothing in the way (the sweep is exact, so a long step cannot hop a wall): one piece
      px += dx
      pz += dz
    } else {
      const n = Math.ceil(dist / SUBSTEP)
      const mx = dx / n
      const mz = dz / n
      for (let i = 0; i < n; i++) {
        slidePiece(px, pz, mx, mz, R, dyn)
        px = _sx.x
        pz = _sx.z
      }
    }
  }
  // the backstop (see the module comment): solids and region agree, so this never fires in a walk; if they ever disagree, per axis
  if (!inRegion(px, pz) && inRegion(sx, sz)) {
    collisionStats.backstopFallbacks++
    if (inRegion(px, sz)) {
      pz = sz
    } else if (inRegion(sx, pz)) {
      px = sx
    } else {
      px = sx
      pz = sz
    }
  }
  const got = Math.hypot(px - sx, pz - sz)
  out.x = px
  out.z = pz
  out.progress = dist > 1e-12 ? Math.min(1, got / dist) : 1
  out.blocked = out.progress < 0.999
  return out
}

/**
 * Where a body would stop if it went straight along (dx, dz) and nothing moving were in the way: the point of the first static contact (or
 * the end of the motion). Writes into `out` and returns it.
 */
export function sweepToStop(x: number, z: number, dx: number, dz: number, out: Vec2, margin: number = BODY.radius): Vec2 {
  const R = margin + SKIN
  if (firstHit(x, z, dx, dz, R, null)) {
    out.x = x + dx * _best.t
    out.z = z + dz * _best.t
  } else {
    out.x = x + dx
    out.z = z + dz
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------------------------

/** Push (x, z) out of the static solids (walls only, or everything), a few passes. Writes `_sx`; true when it ends clear. */
function pushOutOfStatics(x: number, z: number, r: number, walls: boolean): boolean {
  let px = x
  let pz = z
  for (let pass = 0; pass < 8; pass++) {
    const depth = staticOverlap(px, pz, r, walls)
    if (depth === 0) {
      _sx.x = px
      _sx.z = pz
      return true
    }
    px += _push.nx * (depth + 1e-3)
    pz += _push.nz * (depth + 1e-3)
  }
  _sx.x = px
  _sx.z = pz
  return staticOverlap(px, pz, r, walls) === 0
}

/**
 * The nearest point you can stand on to (x, z): the point itself when it is fine (a body just spawned, or carried over a Jump, or
 * put down by another system). Otherwise it is pushed out of the static solids, and failing that the people's nearest-walkable search
 * (and the plaza) is used. With `furniture` false only the walls and the region count, so a seat (which is inside its chair) is
 * a fine place to be. Writes into `out` and returns it; if there is nowhere (which the layout rules out), it is unchanged.
 */
export function settle(x: number, z: number, out: Vec2, margin: number = BODY.radius, furniture = true): Vec2 {
  // (with furniture: the region test of the people, which keeps out of beds too; without: the floor alone, so a bed is a place to be)
  const m = margin < REGION_MARGIN ? margin : REGION_MARGIN
  const ok = (px: number, pz: number): boolean => (furniture ? inRegion(px, pz, m) : inFloor(px, pz, m)) && staticOverlap(px, pz, margin, !furniture) === 0
  if (ok(x, z)) {
    out.x = x
    out.z = z
    return out
  }
  if (pushOutOfStatics(x, z, margin, !furniture) && ok(_sx.x, _sx.z)) {
    out.x = _sx.x
    out.z = _sx.z
    return out
  }
  // the people's nearest walkable point, then pushed clear of anything the nav lets people touch (a station's furniture)
  nearestWalkable(x, z, margin, _near)
  const navOk = isWalkable(_near.x, _near.z, margin, margin)
  // the plaza's nearest point: clamp into its walkable rectangle
  const r = PLAYER_PLAZA
  const plazaX = Math.min(r.x1 - HALF_WALL - margin, Math.max(r.x0 + margin, x))
  const plazaZ = Math.min(r.z1 - margin, Math.max(r.z0 + margin, z))
  const plazaD = (plazaX - x) * (plazaX - x) + (plazaZ - z) * (plazaZ - z)
  const navD = navOk ? (_near.x - x) * (_near.x - x) + (_near.z - z) * (_near.z - z) : Infinity
  let bx = navD < plazaD ? _near.x : plazaX
  let bz = navD < plazaD ? _near.z : plazaZ
  if (!ok(bx, bz) && pushOutOfStatics(bx, bz, margin, !furniture)) {
    bx = _sx.x
    bz = _sx.z
  }
  out.x = bx
  out.z = bz
  return out
}
