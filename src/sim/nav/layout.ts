/**
 * Walkable geometry for PEOPLE, derived only from `places.ts`.
 *
 * The walkable world is a union of axis-aligned rectangles ("zones"):
 *   - every non-robot area rect, inset by half a wall thickness (so two neighbouring areas are separated
 *     by a 0.2 m wall gap),
 *   - one small bridge per door in `DOORS`, through the wall (door width x wall thickness + 0.6 m), the ONLY
 *     place where neighbouring areas connect,
 *   - the two pharmacist zones inside the robot-only pharmacy core (the core itself contributes nothing else).
 * Beds are rect obstacles, and so is every piece of non-overhead furniture of the building layout (`getLayout().footprints`:
 * circles and rotated rects, measured with true distance). Furniture that belongs to a station (`serves`: a reception
 * desk, a chair, a counter) may be touched by points and edges within its `reach` of the station. Segment queries are
 * exact (no sampling). A uniform grid keeps every query to a handful of candidates.
 *
 * Margin semantics: `margin` is the clearance from walls and obstacles that a body centre needs. Area zones
 * shrink by the margin on every side. A door bridge shrinks only across the opening (clearance from the
 * jambs); along the walking direction it grows just enough to meet the neighbouring areas' shrunk rects, so
 * a margin-0.3 line through a doorway is walkable for any margin, not only 0.3.
 *
 * Robots: the MedPods ride a ceiling rail (W2), so the corridors are entirely the people's. The pharmacy core is robot-only
 * space but for the two pharmacist zones.
 *
 * Coordinates: metres, x east, z south (north = -z). One floor (y = 0).
 */
import { getLayout } from '@/scene/building/layout'
import type { Footprint } from '@/scene/building/layout/types'
import { AREAS, BANDS, CORE, CORRIDOR_CENTER, DOORS, PHARMACY, ROOMS, WALL, wardSign, type AreaId, type Rect } from '../places'
import type { Vec2, WardId } from '../types'
import { nodeAnchor } from './ids'

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type ZoneKind = 'area' | 'door' | 'pharmacist'

export interface WalkZone extends Rect {
  id: string
  kind: ZoneKind
  /** The area this zone was derived from (area and pharmacist zones). */
  area?: AreaId
  /** Door bridges only: the axis along which walkers pass through (perpendicular to the wall). */
  walkAxis?: 'x' | 'z'
  /** True where straight shortcuts are fine (rooms, halls). False for corridors and doorways. */
  open: boolean
  ward?: WardId
}

export interface Obstacle extends Rect {
  id: string
}

// ---------------------------------------------------------------------------------------------
// Constants derived from the contract
// ---------------------------------------------------------------------------------------------

const HALF_WALL = WALL.thickness / 2
/** A bridge extends this far beyond the wall faces on each side. */
const BRIDGE_PAD = 0.3
const BRIDGE_HALF_DEPTH = HALF_WALL + BRIDGE_PAD
/** Bed footprint: 1.0 m across (x), 2.1 m along (z). */
export const BED_SIZE = { x: 1.0, z: 2.1 } as const
/** The pharmacist zone is this wide on each side of the pharmacist door, and ends this far behind the desk. */
const PHARMACIST_HALF_WIDTH = 2
const PHARMACIST_BEHIND_DESK = 1.5

const EPS = 1e-6

// ---------------------------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------------------------

function inset(r: Rect, d: number): Rect {
  return { x0: r.x0 + d, x1: r.x1 - d, z0: r.z0 + d, z1: r.z1 - d }
}

const zones: WalkZone[] = []

for (const a of AREAS) {
  if (a.kind === 'robot') continue
  zones.push({
    id: `area:${a.id}`,
    kind: 'area',
    area: a.id,
    ...inset(a.rect, HALF_WALL),
    open: a.id !== 'corridorA' && a.id !== 'corridorB',
    ward: a.ward,
  })
}

/** The pharmacist zone behind each pharmacist door: the only part of the robot-only core people may enter. */
export const PHARMACIST_ZONES: { ward: WardId; rect: Rect }[] = (['A', 'B'] as WardId[]).map((w) => {
  const door = DOORS.find((d) => d.id === `pharmacist${w}`)
  if (!door) throw new Error(`No pharmacist door for ward ${w}`)
  const s = wardSign(w)
  const deskAbs = Math.abs(PHARMACY.desk[w].spot.z)
  const wallAbs = BANDS.innerWall - HALF_WALL
  const nearAbs = deskAbs - PHARMACIST_BEHIND_DESK
  const za = s * nearAbs
  const zb = s * wallAbs
  return {
    ward: w,
    rect: {
      x0: door.center.x - PHARMACIST_HALF_WIDTH,
      x1: door.center.x + PHARMACIST_HALF_WIDTH,
      z0: Math.min(za, zb),
      z1: Math.max(za, zb),
    },
  }
})
for (const p of PHARMACIST_ZONES) {
  zones.push({ id: `pharmacist:${p.ward}`, kind: 'pharmacist', area: 'core', ...p.rect, open: true, ward: p.ward })
}

for (const d of DOORS) {
  const hw = d.width / 2
  const cx = d.center.x
  const cz = d.center.z
  const alongX = d.wallAxis === 'x' // wall runs along x, so the opening spans x and the walkers pass along z
  zones.push({
    id: `door:${d.id}`,
    kind: 'door',
    walkAxis: alongX ? 'z' : 'x',
    x0: alongX ? cx - hw : cx - BRIDGE_HALF_DEPTH,
    x1: alongX ? cx + hw : cx + BRIDGE_HALF_DEPTH,
    z0: alongX ? cz - BRIDGE_HALF_DEPTH : cz - hw,
    z1: alongX ? cz + BRIDGE_HALF_DEPTH : cz + hw,
    open: false,
  })
}

/** Every walkable rectangle (areas, pharmacist zones, door bridges), at margin 0. */
export const WALK_ZONES: readonly WalkZone[] = zones

/** Beds: 1.0 m x 2.1 m rect obstacles centred at `room.bed`. */
export const OBSTACLES: readonly Obstacle[] = ROOMS.map((r) => ({
  id: `bed:${r.id}`,
  x0: r.bed.x - BED_SIZE.x / 2,
  x1: r.bed.x + BED_SIZE.x / 2,
  z0: r.bed.z - BED_SIZE.z / 2,
  z1: r.bed.z + BED_SIZE.z / 2,
}))

// ---------------------------------------------------------------------------------------------
// Solids: beds and furniture footprints
// ---------------------------------------------------------------------------------------------

/** Furniture clearance a graph edge keeps (the building layout's keep-clear rule). Walls and beds use NAV margin 0.3. */
export const FURNITURE_MARGIN = 0.35

const KIND_CIRCLE = 0
const KIND_RECT = 1
const KIND_BED = 2

/** One thing in the way: a circle, a rotated rect (both measured with true distance) or a bed (an axis-aligned rect). */
export interface Solid {
  id: string
  kind: 0 | 1 | 2
  x: number
  z: number
  /** Half extents along the footprint's own axes (a circle: hw = radius). */
  hw: number
  hd: number
  cos: number
  sin: number
  /** Axis-aligned bounds of the shape itself. */
  bx0: number
  bx1: number
  bz0: number
  bz1: number
  /** Stations this piece of furniture belongs to: points within `reach` of one of them may touch it. */
  nodes: Vec2[]
  reach: number
}

function makeSolid(f: Footprint): Solid {
  const circle = f.kind === 'circle'
  const c = Math.cos(f.rotationY)
  const s = Math.sin(f.rotationY)
  const ex = circle ? f.hw : f.hw * Math.abs(c) + f.hd * Math.abs(s)
  const ez = circle ? f.hw : f.hw * Math.abs(s) + f.hd * Math.abs(c)
  const nodes: Vec2[] = []
  for (const id of f.serves?.nodes ?? []) {
    const a = nodeAnchor(id)
    if (a) nodes.push({ x: a.x, z: a.z })
  }
  return {
    id: f.id,
    kind: circle ? KIND_CIRCLE : KIND_RECT,
    x: f.x,
    z: f.z,
    hw: f.hw,
    hd: f.hd,
    cos: c,
    sin: s,
    bx0: f.x - ex,
    bx1: f.x + ex,
    bz0: f.z - ez,
    bz1: f.z + ez,
    nodes,
    reach: f.serves?.reach ?? 0,
  }
}

function bedSolid(o: Obstacle): Solid {
  return {
    id: o.id,
    kind: KIND_BED,
    x: (o.x0 + o.x1) / 2,
    z: (o.z0 + o.z1) / 2,
    hw: (o.x1 - o.x0) / 2,
    hd: (o.z1 - o.z0) / 2,
    cos: 1,
    sin: 0,
    bx0: o.x0,
    bx1: o.x1,
    bz0: o.z0,
    bz1: o.z1,
    nodes: [],
    reach: 0,
  }
}

/**
 * Every solid: the beds, then each non-overhead furniture footprint of the building layout (the bed footprints are inside
 * the bed obstacles, so they are skipped). Overhead and outdoor footprints are not obstacles.
 */
export const SOLIDS: readonly Solid[] = [
  ...OBSTACLES.map(bedSolid),
  ...getLayout()
    .footprints.filter((f) => !f.overhead && f.area !== 'outside' && !f.id.endsWith(':bed'))
    .map(makeSolid),
]

/** Signed distance from a point to a footprint solid: negative inside. */
function solidSigned(s: Solid, px: number, pz: number): number {
  const dx = px - s.x
  const dz = pz - s.z
  if (s.kind === KIND_CIRCLE) return Math.hypot(dx, dz) - s.hw
  const lx = dx * s.cos - dz * s.sin
  const lz = dx * s.sin + dz * s.cos
  const qx = Math.abs(lx) - s.hw
  const qz = Math.abs(lz) - s.hd
  if (qx <= 0 && qz <= 0) return Math.max(qx, qz)
  return Math.hypot(qx > 0 ? qx : 0, qz > 0 ? qz : 0)
}

function nearStation(s: Solid, px: number, pz: number): boolean {
  for (let i = 0; i < s.nodes.length; i++) if (Math.hypot(s.nodes[i].x - px, s.nodes[i].z - pz) <= s.reach) return true
  return false
}

/** Does solid `s` block a body whose centre is at the point, with `wallM` clearance for beds and `furnM` for furniture? */
function solidBlocksPoint(s: Solid, px: number, pz: number, wallM: number, furnM: number): boolean {
  if (s.kind === KIND_BED) {
    return px > s.bx0 - wallM + EPS && px < s.bx1 + wallM - EPS && pz > s.bz0 - wallM + EPS && pz < s.bz1 + wallM - EPS
  }
  if (furnM < 0) return false
  if (px < s.bx0 - furnM || px > s.bx1 + furnM || pz < s.bz0 - furnM || pz > s.bz1 + furnM) return false
  if (solidSigned(s, px, pz) >= furnM - EPS) return false
  return !nearStation(s, px, pz)
}

let T0 = 0
let T1 = 1

/** Clip the segment a + t d (t in [0, 1]) to the closed rect; on a hit the parameter range is left in T0..T1. */
function clipToRect(ax: number, az: number, dx: number, dz: number, x0: number, x1: number, z0: number, z1: number): boolean {
  let t0 = 0
  let t1 = 1
  if (Math.abs(dx) < 1e-12) {
    if (ax < x0 || ax > x1) return false
  } else {
    let ta = (x0 - ax) / dx
    let tb = (x1 - ax) / dx
    if (ta > tb) {
      const t = ta
      ta = tb
      tb = t
    }
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return false
  }
  if (Math.abs(dz) < 1e-12) {
    if (az < z0 || az > z1) return false
  } else {
    let ta = (z0 - az) / dz
    let tb = (z1 - az) / dz
    if (ta > tb) {
      const t = ta
      ta = tb
      tb = t
    }
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return false
  }
  T0 = t0
  T1 = t1
  return true
}

function distPointSegment(px: number, pz: number, ax: number, az: number, dx: number, dz: number): number {
  const l2 = dx * dx + dz * dz
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

/** Distance from a point to the axis-aligned box [-hw, hw] x [-hd, hd] (0 inside). */
function distPointBox(px: number, pz: number, hw: number, hd: number): number {
  const qx = Math.abs(px) - hw
  const qz = Math.abs(pz) - hd
  return Math.hypot(qx > 0 ? qx : 0, qz > 0 ? qz : 0)
}

/** Does the segment a + t d (t in [0,1]) pass through solid `s` grown by the clearance? Touching the grown edge is allowed. */
function solidBlocksSegment(s: Solid, ax: number, az: number, dx: number, dz: number, wallM: number, furnM: number): boolean {
  if (s.kind === KIND_BED) {
    return clipToRect(ax, az, dx, dz, s.bx0 - wallM + EPS, s.bx1 + wallM - EPS, s.bz0 - wallM + EPS, s.bz1 + wallM - EPS)
  }
  if (furnM < 0) return false
  // quick reject with the bounding box grown by the clearance
  const sx0 = Math.min(ax, ax + dx)
  const sx1 = Math.max(ax, ax + dx)
  const sz0 = Math.min(az, az + dz)
  const sz1 = Math.max(az, az + dz)
  if (sx1 < s.bx0 - furnM || sx0 > s.bx1 + furnM || sz1 < s.bz0 - furnM || sz0 > s.bz1 + furnM) return false
  let blocked: boolean
  if (s.kind === KIND_CIRCLE) {
    blocked = distPointSegment(s.x, s.z, ax, az, dx, dz) - s.hw < furnM - EPS
  } else {
    // into the footprint's own frame: l = R (p - c) with R = [[cos, -sin], [sin, cos]]
    const ox = ax - s.x
    const oz = az - s.z
    const lax = ox * s.cos - oz * s.sin
    const laz = ox * s.sin + oz * s.cos
    const ldx = dx * s.cos - dz * s.sin
    const ldz = dx * s.sin + dz * s.cos
    if (clipToRect(lax, laz, ldx, ldz, -(s.hw - EPS), s.hw - EPS, -(s.hd - EPS), s.hd - EPS)) {
      blocked = true
    } else {
      // no interior hit: the closest approach is an endpoint to the box, or a corner to the segment
      let d = Math.min(distPointBox(lax, laz, s.hw, s.hd), distPointBox(lax + ldx, laz + ldz, s.hw, s.hd))
      for (let i = 0; i < 4 && d >= furnM - EPS; i++) {
        const cx = i & 1 ? s.hw : -s.hw
        const cz = i & 2 ? s.hd : -s.hd
        d = Math.min(d, distPointSegment(cx, cz, lax, laz, ldx, ldz))
      }
      blocked = d < furnM - EPS
    }
  }
  if (!blocked || s.nodes.length === 0) return blocked
  // a station's own furniture may be touched by the edges that reach it
  for (let i = 0; i < s.nodes.length; i++) if (distPointSegment(s.nodes[i].x, s.nodes[i].z, ax, az, dx, dz) <= s.reach) return false
  return true
}

// ---------------------------------------------------------------------------------------------
// Spatial index (a uniform grid of 2 m cells: a query looks at a handful of zones and solids, not hundreds)
// ---------------------------------------------------------------------------------------------

const GRID = { x0: -66, z0: -26, cell: 2, cols: 56, rows: 26 } as const
/** Items are filed under every cell their bounds, grown by this much, touch: queries with a margin up to it are exact. */
const GRID_REACH = 1.2

function cellX(x: number): number {
  const i = Math.floor((x - GRID.x0) / GRID.cell)
  return i < 0 ? 0 : i >= GRID.cols ? GRID.cols - 1 : i
}

function cellZ(z: number): number {
  const i = Math.floor((z - GRID.z0) / GRID.cell)
  return i < 0 ? 0 : i >= GRID.rows ? GRID.rows - 1 : i
}

interface CellIndex {
  start: Int32Array
  items: Int32Array
}

function buildIndex(count: number, bounds: (i: number) => [number, number, number, number]): CellIndex {
  const cells = GRID.cols * GRID.rows
  const start = new Int32Array(cells + 1)
  const span = (i: number): [number, number, number, number] => {
    const [x0, x1, z0, z1] = bounds(i)
    return [cellX(x0 - GRID_REACH), cellX(x1 + GRID_REACH), cellZ(z0 - GRID_REACH), cellZ(z1 + GRID_REACH)]
  }
  for (let i = 0; i < count; i++) {
    const [cx0, cx1, cz0, cz1] = span(i)
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) start[cz * GRID.cols + cx + 1]++
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c]
  const items = new Int32Array(start[cells])
  const fill = start.slice(0, cells)
  for (let i = 0; i < count; i++) {
    const [cx0, cx1, cz0, cz1] = span(i)
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) items[fill[cz * GRID.cols + cx]++] = i
  }
  return { start, items }
}

const ZONE_INDEX = buildIndex(zones.length, (i) => [zones[i].x0, zones[i].x1, zones[i].z0, zones[i].z1])
const SOLID_INDEX = buildIndex(SOLIDS.length, (i) => [SOLIDS[i].bx0, SOLIDS[i].bx1, SOLIDS[i].bz0, SOLIDS[i].bz1])

/** Marks which items a segment query has already seen (an item is filed under several cells). */
const zoneSeen = new Int32Array(zones.length)
const solidSeen = new Int32Array(SOLIDS.length)
let stamp = 0

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

/** Effective bounds of a zone for a given margin (see the module comment). Written into `B` (no allocation). */
const B = { x0: 0, x1: 0, z0: 0, z1: 0 }

function boundsFor(q: WalkZone, m: number): boolean {
  if (q.walkAxis === undefined) {
    B.x0 = q.x0 + m
    B.x1 = q.x1 - m
    B.z0 = q.z0 + m
    B.z1 = q.z1 - m
  } else {
    const grow = Math.max(0, HALF_WALL + m - BRIDGE_HALF_DEPTH)
    if (q.walkAxis === 'z') {
      B.x0 = q.x0 + m
      B.x1 = q.x1 - m
      B.z0 = q.z0 - grow
      B.z1 = q.z1 + grow
    } else {
      B.z0 = q.z0 + m
      B.z1 = q.z1 - m
      B.x0 = q.x0 - grow
      B.x1 = q.x1 + grow
    }
  }
  return B.x0 <= B.x1 + EPS && B.z0 <= B.z1 + EPS
}

function zoneContains(q: WalkZone, x: number, z: number, m: number): boolean {
  if (!boundsFor(q, m)) return false
  return x >= B.x0 - EPS && x <= B.x1 + EPS && z >= B.z0 - EPS && z <= B.z1 + EPS
}

/** Is the point inside a bed (grown by `margin`)? */
export function inObstacle(x: number, z: number, margin = 0): boolean {
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i]
    if (x > o.x0 - margin + EPS && x < o.x1 + margin - EPS && z > o.z0 - margin + EPS && z < o.z1 + margin - EPS) return true
  }
  return false
}

/** Does any solid block the point? `wallM` grows beds, `furnM` grows furniture. */
function pointBlocked(x: number, z: number, wallM: number, furnM: number): boolean {
  if (Math.max(wallM, furnM) > GRID_REACH) {
    for (let i = 0; i < SOLIDS.length; i++) if (solidBlocksPoint(SOLIDS[i], x, z, wallM, furnM)) return true
    return false
  }
  const c = cellZ(z) * GRID.cols + cellX(x)
  for (let k = SOLID_INDEX.start[c]; k < SOLID_INDEX.start[c + 1]; k++) {
    if (solidBlocksPoint(SOLIDS[SOLID_INDEX.items[k]], x, z, wallM, furnM)) return true
  }
  return false
}

/**
 * Is the point on walkable ground? `margin` is the clearance a body centre keeps from walls, jambs and beds;
 * `solidMargin` (default: the same) is the clearance it keeps from furniture (a negative value ignores furniture, so a
 * test can check walls and beds on their own). Furniture that belongs to a station
 * (a desk, a counter, a chair) may be touched by points within its `reach`.
 */
export function isWalkable(x: number, z: number, margin = 0, solidMargin = margin): boolean {
  let inside = false
  if (margin > GRID_REACH) {
    for (let i = 0; i < zones.length; i++) {
      if (zoneContains(zones[i], x, z, margin)) {
        inside = true
        break
      }
    }
  } else {
    const c = cellZ(z) * GRID.cols + cellX(x)
    for (let k = ZONE_INDEX.start[c]; k < ZONE_INDEX.start[c + 1]; k++) {
      if (zoneContains(zones[ZONE_INDEX.items[k]], x, z, margin)) {
        inside = true
        break
      }
    }
  }
  return inside && !pointBlocked(x, z, margin, solidMargin)
}

/** Does the segment pass through a solid? */
function segmentBlocked(ax: number, az: number, dx: number, dz: number, wallM: number, furnM: number): boolean {
  if (Math.max(wallM, furnM) > GRID_REACH) {
    for (let i = 0; i < SOLIDS.length; i++) if (solidBlocksSegment(SOLIDS[i], ax, az, dx, dz, wallM, furnM)) return true
    return false
  }
  stamp++
  const cx0 = cellX(Math.min(ax, ax + dx))
  const cx1 = cellX(Math.max(ax, ax + dx))
  const cz0 = cellZ(Math.min(az, az + dz))
  const cz1 = cellZ(Math.max(az, az + dz))
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cz * GRID.cols + cx
      for (let k = SOLID_INDEX.start[c]; k < SOLID_INDEX.start[c + 1]; k++) {
        const i = SOLID_INDEX.items[k]
        if (solidSeen[i] === stamp) continue
        solidSeen[i] = stamp
        if (solidBlocksSegment(SOLIDS[i], ax, az, dx, dz, wallM, furnM)) return true
      }
    }
  }
  return false
}

const LO = new Float64Array(zones.length + 4)
const HI = new Float64Array(zones.length + 4)

/**
 * Does the straight segment stay on walkable ground at this margin? The test is exact: the parts of the segment
 * inside each zone are intervals of t, and together they must cover [0, 1], with no bed or furniture in the way.
 * (`_step` is kept for signature compatibility; nothing is sampled, so a diagonal cannot slip between samples or hop a
 * wall.) `solidMargin` is the clearance from furniture (default: the same as `margin`).
 */
export function segmentWalkable(ax: number, az: number, bx: number, bz: number, margin = 0, _step = 0.25, solidMargin = margin): boolean {
  const dx = bx - ax
  const dz = bz - az
  if (dx * dx + dz * dz < 1e-18) return isWalkable(ax, az, margin, solidMargin)
  if (segmentBlocked(ax, az, dx, dz, margin, solidMargin)) return false
  let n = 0
  if (margin > GRID_REACH) {
    for (let i = 0; i < zones.length; i++) {
      if (!boundsFor(zones[i], margin)) continue
      if (clipToRect(ax, az, dx, dz, B.x0 - EPS, B.x1 + EPS, B.z0 - EPS, B.z1 + EPS)) {
        LO[n] = T0
        HI[n] = T1
        n++
      }
    }
  } else {
    stamp++
    const cx0 = cellX(Math.min(ax, bx))
    const cx1 = cellX(Math.max(ax, bx))
    const cz0 = cellZ(Math.min(az, bz))
    const cz1 = cellZ(Math.max(az, bz))
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * GRID.cols + cx
        for (let k = ZONE_INDEX.start[c]; k < ZONE_INDEX.start[c + 1]; k++) {
          const i = ZONE_INDEX.items[k]
          if (zoneSeen[i] === stamp) continue
          zoneSeen[i] = stamp
          if (!boundsFor(zones[i], margin)) continue
          if (clipToRect(ax, az, dx, dz, B.x0 - EPS, B.x1 + EPS, B.z0 - EPS, B.z1 + EPS)) {
            LO[n] = T0
            HI[n] = T1
            n++
          }
        }
      }
    }
  }
  let covered = 0
  let progress = true
  while (progress && covered < 1 - 1e-12) {
    progress = false
    for (let k = 0; k < n; k++) {
      if (LO[k] <= covered + 1e-12 && HI[k] > covered) {
        covered = HI[k]
        progress = true
      }
    }
  }
  return covered >= 1 - 1e-12
}

/** The first zone containing the point at this margin (door bridges overlap areas; areas come first). */
export function zoneAt(x: number, z: number, margin = 0): WalkZone | null {
  for (let i = 0; i < zones.length; i++) if (zoneContains(zones[i], x, z, margin)) return zones[i]
  return null
}

/**
 * Does the whole segment lie inside ONE open (non-corridor, non-doorway) zone, clear of beds and furniture? Used for
 * string-pulling: a shortcut is only taken inside a single room or hall, never across a corridor or a door.
 * A rect is convex, so both ends inside it means the whole segment is; only the solids need a sweep.
 */
export function segmentInOpenZone(ax: number, az: number, bx: number, bz: number, margin = 0.3, solidMargin = margin): boolean {
  for (let i = 0; i < zones.length; i++) {
    const q = zones[i]
    if (!q.open || !zoneContains(q, ax, az, margin)) continue
    if (!zoneContains(q, bx, bz, margin)) return false
    return !segmentBlocked(ax, az, bx - ax, bz - az, margin, solidMargin)
  }
  return false
}

/** Push a point out of every solid that blocks it (a few passes). Returns the pushed point in `out`. */
function pushOutOfSolids(out: Vec2, wallM: number, furnM: number): void {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (let i = 0; i < SOLIDS.length; i++) {
      const s = SOLIDS[i]
      if (!solidBlocksPoint(s, out.x, out.z, wallM, furnM)) continue
      moved = true
      if (s.kind === KIND_BED) {
        const dl = out.x - (s.bx0 - wallM)
        const dr = s.bx1 + wallM - out.x
        const du = out.z - (s.bz0 - wallM)
        const dd = s.bz1 + wallM - out.z
        const m = Math.min(dl, dr, du, dd)
        if (m === dl) out.x = s.bx0 - wallM - 0.02
        else if (m === dr) out.x = s.bx1 + wallM + 0.02
        else if (m === du) out.z = s.bz0 - wallM - 0.02
        else out.z = s.bz1 + wallM + 0.02
      } else if (s.kind === KIND_CIRCLE) {
        const dx = out.x - s.x
        const dz = out.z - s.z
        const d = Math.hypot(dx, dz)
        const k = d > 1e-9 ? (s.hw + furnM + 0.02) / d : 0
        out.x = d > 1e-9 ? s.x + dx * k : s.x + s.hw + furnM + 0.02
        out.z = d > 1e-9 ? s.z + dz * k : s.z
      } else {
        const ox = out.x - s.x
        const oz = out.z - s.z
        let lx = ox * s.cos - oz * s.sin
        let lz = ox * s.sin + oz * s.cos
        const qx = Math.abs(lx) - s.hw
        const qz = Math.abs(lz) - s.hd
        if (qx <= 0 && qz <= 0) {
          if (qx > qz) lx = (lx < 0 ? -1 : 1) * (s.hw + furnM + 0.02)
          else lz = (lz < 0 ? -1 : 1) * (s.hd + furnM + 0.02)
        } else {
          const cx = Math.max(-s.hw, Math.min(s.hw, lx))
          const cz = Math.max(-s.hd, Math.min(s.hd, lz))
          const d = Math.hypot(lx - cx, lz - cz)
          const k = (furnM + 0.02) / d
          lx = cx + (lx - cx) * k
          lz = cz + (lz - cz) * k
        }
        out.x = s.x + lx * s.cos + lz * s.sin
        out.z = s.z - lx * s.sin + lz * s.cos
      }
    }
    if (!moved) return
  }
}

/** Snap a point to the closest walkable point (keeping `margin`, and `solidMargin` from furniture). Writes into `out` and returns it. */
export function nearestWalkable(x: number, z: number, margin: number, out: Vec2, solidMargin = margin): Vec2 {
  if (isWalkable(x, z, margin, solidMargin)) {
    out.x = x
    out.z = z
    return out
  }
  let best = Infinity
  let bx = x
  let bz = z
  for (let i = 0; i < zones.length; i++) {
    if (!boundsFor(zones[i], margin)) continue
    out.x = Math.min(B.x1, Math.max(B.x0, x))
    out.z = Math.min(B.z1, Math.max(B.z0, z))
    for (let pass = 0; pass < 3; pass++) {
      pushOutOfSolids(out, margin, solidMargin)
      // pushing may leave the zone; pull it back in (the zone bounds are re-read: `B` was overwritten by the solid tests)
      if (!boundsFor(zones[i], margin)) break
      out.x = Math.min(B.x1, Math.max(B.x0, out.x))
      out.z = Math.min(B.z1, Math.max(B.z0, out.z))
    }
    if (!isWalkable(out.x, out.z, margin, solidMargin)) continue
    const d = (out.x - x) * (out.x - x) + (out.z - z) * (out.z - z)
    if (d < best) {
      best = d
      bx = out.x
      bz = out.z
    }
  }
  out.x = bx
  out.z = bz
  return out
}

// ---------------------------------------------------------------------------------------------
// Corridor and core helpers
// ---------------------------------------------------------------------------------------------

/** z of the corridor centre line (people walk it) for a ward. */
export function corridorLineZ(w: WardId): number {
  return wardSign(w) * CORRIDOR_CENTER
}

const CORRIDOR_RECTS: { ward: WardId; rect: Rect }[] = (['A', 'B'] as WardId[]).map((w) => {
  const a = AREAS.find((q) => q.id === (w === 'A' ? 'corridorA' : 'corridorB'))
  if (!a) throw new Error(`No corridor for ward ${w}`)
  return { ward: w, rect: inset(a.rect, 0.05) }
})

/** The ward whose corridor interior (strictly inside the walls) the segment passes through, or null. Exact. */
export function segmentTouchesCorridor(ax: number, az: number, bx: number, bz: number): WardId | null {
  for (const c of CORRIDOR_RECTS) {
    const r = c.rect
    if (clipToRect(ax, az, bx - ax, bz - az, r.x0, r.x1, r.z0, r.z1)) return c.ward
  }
  return null
}

/** The ward whose corridor contains the point (strictly inside the walls), or null. */
export function inCorridorBand(x: number, z: number): WardId | null {
  for (const c of CORRIDOR_RECTS) {
    const r = c.rect
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return c.ward
  }
  return null
}

/** Inside the robot-only pharmacy core and outside the pharmacist zones? (Strictly inside the core walls.) */
export function inRobotOnlyCore(x: number, z: number): boolean {
  const e = 0.01
  if (!(x > CORE.x0 + e && x < CORE.x1 - e && z > CORE.z0 + e && z < CORE.z1 - e)) return false
  for (const p of PHARMACIST_ZONES) {
    const r = p.rect
    if (x >= r.x0 - e && x <= r.x1 + e && z >= r.z0 - e && z <= r.z1 + e) return false
  }
  return true
}
