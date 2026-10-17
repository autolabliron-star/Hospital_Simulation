/**
 * What the chase camera asks of the building: how far a camera-sized ball can travel along the boom before it touches a wall,
 * and how high the ceiling is where the camera would be. There is no physics engine in this project, so the walls are plain
 * boxes: built ONCE from `buildWallPieces()` (the same wall lines the building draws), every one as tall as `WALL.height` (in
 * walk mode the walls are full height), plus
 *
 *   - the door LINTELS: the wall above every door and opening, from `WALL.doorHeight` up, so the camera cannot lift over a door
 *     header and cannot go through the top of an opening, and
 *   - the MedDrawer cabinets: the 0.8 m gaps in the room/corridor walls are filled by a closed cabinet, so they are solid.
 *
 * A sweep is the ray against each box grown by the ball's radius (the Minkowski sum of a box and a ball, with its rounded corners
 * squared off: a little conservative at corners, never optimistic). The camera ball never ends inside such a box.
 * Ceilings come from the contract (`ceilingHeight(areaAt(x, z))`); `null` is open sky (the atrium's glass roof, and outdoors).
 */
import { buildSignage } from '@/scene/building/layout/walk/signage'
import { DRAWER_GAP, buildWallPieces, wallGaps } from '@/scene/building/layout/walls'
import { ROOMS, WALL, areaAt, ceilingHeight } from '@/sim/places'
import type { Vec3 } from '@/sim/types'

/** What the camera needs from the world (the real one is `WallBoxProbe`; tests pass small fakes). */
export interface BoomProbe {
  /** The distance a ball of `radius` travels along the unit direction `dir` from `from` before it touches a wall, or null if it gets `length` metres. */
  cast(from: Vec3, dir: Vec3, length: number, radius: number): number | null
  /** The ceiling's height above the floor at (x, z), metres, or null under open sky. */
  ceilingAt(x: number, z: number): number | null
}

/** Nothing in the way, no ceiling. */
export const OPEN_PROBE: BoomProbe = { cast: () => null, ceilingAt: () => null }

/** An axis-aligned box of wall, metres. */
export interface WallBox {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

const HALF = WALL.thickness / 2

/** Every wall, lintel and cabinet of the building as boxes. Pure maths, so it is checked in node. */
export function buildWallBoxes(): WallBox[] {
  const boxes: WallBox[] = []
  for (const p of buildWallPieces()) {
    // a wall end that is not a door or cabinet cut runs on to fill the corner, half a wall thickness
    const a = p.a - (p.cutA ? 0 : HALF)
    const b = p.b + (p.cutB ? 0 : HALF)
    if (p.alongX) boxes.push({ x0: a, x1: b, y0: 0, y1: WALL.height, z0: p.c - HALF, z1: p.c + HALF })
    else boxes.push({ x0: p.c - HALF, x1: p.c + HALF, y0: 0, y1: WALL.height, z0: a, z1: b })
  }
  const isDrawer = (z: number, a: number, b: number): boolean =>
    ROOMS.some((r) => Math.abs(r.drawer.z - z) < 1e-3 && Math.abs(r.drawer.x - DRAWER_GAP / 2 - a) < 1e-3 && Math.abs(r.drawer.x + DRAWER_GAP / 2 - b) < 1e-3)
  const gaps = wallGaps()
  for (const [z, list] of gaps.alongX) {
    for (const g of list) {
      const y0 = isDrawer(z, g.a, g.b) ? 0 : WALL.doorHeight
      boxes.push({ x0: g.a, x1: g.b, y0, y1: WALL.height, z0: z - HALF, z1: z + HALF })
    }
  }
  for (const [x, list] of gaps.alongZ) {
    for (const g of list) boxes.push({ x0: x - HALF, x1: x + HALF, y0: WALL.doorHeight, y1: WALL.height, z0: g.a, z1: g.b })
  }
  // the hanging wayfinding signs (walk mode): the camera ducks under a sign instead of passing through it
  for (const b of buildSignage().boxes) {
    if (b.part === 'signBody') boxes.push({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, z0: b.z0, z1: b.z1 })
  }
  return boxes
}

export class WallBoxProbe implements BoomProbe {
  readonly boxes: readonly WallBox[]
  /** x0 x1 y0 y1 z0 z1 per box, flat, for the sweep's inner loop. */
  private readonly flat: Float64Array

  constructor(boxes: readonly WallBox[] = buildWallBoxes()) {
    this.boxes = boxes
    const f = new Float64Array(boxes.length * 6)
    boxes.forEach((b, i) => {
      f[i * 6] = b.x0
      f[i * 6 + 1] = b.x1
      f[i * 6 + 2] = b.y0
      f[i * 6 + 3] = b.y1
      f[i * 6 + 4] = b.z0
      f[i * 6 + 5] = b.z1
    })
    this.flat = f
  }

  cast(from: Vec3, dir: Vec3, length: number, radius: number): number | null {
    const f = this.flat
    const n = f.length
    const ox = from.x
    const oy = from.y
    const oz = from.z
    const dx = dir.x
    const dy = dir.y
    const dz = dir.z
    // the box that holds the whole sweep, for a cheap reject
    const ex = ox + dx * length
    const ey = oy + dy * length
    const ez = oz + dz * length
    const sx0 = Math.min(ox, ex) - radius
    const sx1 = Math.max(ox, ex) + radius
    const sy0 = Math.min(oy, ey) - radius
    const sy1 = Math.max(oy, ey) + radius
    const sz0 = Math.min(oz, ez) - radius
    const sz1 = Math.max(oz, ez) + radius
    let best = Infinity
    for (let i = 0; i < n; i += 6) {
      const x0 = f[i] - radius
      const x1 = f[i + 1] + radius
      const y0 = f[i + 2] - radius
      const y1 = f[i + 3] + radius
      const z0 = f[i + 4] - radius
      const z1 = f[i + 5] + radius
      if (x1 < sx0 || x0 > sx1 || y1 < sy0 || y0 > sy1 || z1 < sz0 || z0 > sz1) continue
      let tmin = 0
      let tmax = Math.min(length, best)
      let miss = false
      // x slab
      if (Math.abs(dx) < 1e-12) {
        if (ox < x0 || ox > x1) miss = true
      } else {
        let t1 = (x0 - ox) / dx
        let t2 = (x1 - ox) / dx
        if (t1 > t2) {
          const t = t1
          t1 = t2
          t2 = t
        }
        if (t1 > tmin) tmin = t1
        if (t2 < tmax) tmax = t2
      }
      if (miss || tmin > tmax) continue
      // y slab
      if (Math.abs(dy) < 1e-12) {
        if (oy < y0 || oy > y1) continue
      } else {
        let t1 = (y0 - oy) / dy
        let t2 = (y1 - oy) / dy
        if (t1 > t2) {
          const t = t1
          t1 = t2
          t2 = t
        }
        if (t1 > tmin) tmin = t1
        if (t2 < tmax) tmax = t2
      }
      if (tmin > tmax) continue
      // z slab
      if (Math.abs(dz) < 1e-12) {
        if (oz < z0 || oz > z1) continue
      } else {
        let t1 = (z0 - oz) / dz
        let t2 = (z1 - oz) / dz
        if (t1 > t2) {
          const t = t1
          t1 = t2
          t2 = t
        }
        if (t1 > tmin) tmin = t1
        if (t2 < tmax) tmax = t2
      }
      if (tmin > tmax) continue
      if (tmin < best) best = tmin
    }
    return best <= length ? best : null
  }

  ceilingAt(x: number, z: number): number | null {
    const area = areaAt(x, z)
    return area ? ceilingHeight(area.id) : null
  }
}

/**
 * Is the point inside any wall box grown by `radius`? (For tests and the camera's own safety net: a ball centre that is inside
 * a grown box is a ball that overlaps a wall.)
 */
export function insideWallBox(boxes: readonly WallBox[], x: number, y: number, z: number, radius: number): WallBox | null {
  for (const b of boxes) {
    if (x > b.x0 - radius && x < b.x1 + radius && y > b.y0 - radius && y < b.y1 + radius && z > b.z0 - radius && z < b.z1 + radius) return b
  }
  return null
}
