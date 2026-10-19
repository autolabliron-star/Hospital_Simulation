/**
 * Pure maths for picking a room with the mouse: is this press a click or a drag, and where does the pointer ray hit the
 * floor. No three.js here, so it is unit-tested in node. `RoomPicker` feeds it the camera ray.
 */
import { LEVEL2_FOOTPRINT, LEVEL_Y, levelDx, rectLevel, toSimInto, type LevelId } from '@/sim/levels'
import { areaAt, type Area, type Rect } from '@/sim/places'
import type { Vec3 } from '@/sim/types'

/** A press is a click when the pointer moved less than this many pixels... */
export const CLICK_MAX_MOVE_PX = 6
/** ...and was released sooner than this many milliseconds after it went down. */
export const CLICK_MAX_MS = 350

export type PressKind = 'click' | 'drag' | 'hold'

/**
 * @param movedPx the largest distance the pointer got from where it went down during the press
 * @param ms      how long the press lasted
 */
export function classifyPress(movedPx: number, ms: number): PressKind {
  if (movedPx >= CLICK_MAX_MOVE_PX) return 'drag'
  return ms < CLICK_MAX_MS ? 'click' : 'hold'
}

export interface FloorHit {
  x: number
  z: number
}

/** Where the ray (origin o, direction d) meets the horizontal plane at height `y`; false if it points up or along it. */
export function intersectFloor(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, out: FloorHit, y = 0): boolean {
  if (dy > -1e-9) return false
  const t = (y - oy) / dy
  if (t < 0) return false
  out.x = ox + dx * t
  out.z = oz + dz * t
  return true
}

/** The room or area under a floor point, or null outside the building. */
export function areaUnder(x: number, z: number): Area | null {
  return areaAt(x, z)
}

/** Where a pointer ray met a floor, in SIM coordinates, and the level that floor is on. */
export interface LevelHit {
  x: number
  z: number
  level: LevelId
}

const _drawn: Vec3 = { x: 0, y: 0, z: 0 }
const _flat: FloorHit = { x: 0, z: 0 }

/**
 * R2: the floor the pointer ray meets, given the level the overview shows (the ray is in DRAWN coordinates, `out` is in SIM coordinates).
 *
 *   Level 1 shown   the plane y = 0, as ever.
 *   Level 2 shown   first the plane y = 4.2 (level 2's floor, drawn): a hit inside the footprint (drawn x -62..-40, z -22..22) is on level 2, and is
 *                   mapped to the sim strip (`toSimInto`, x + 150) so `areaAt` finds the level-2 room. A hit outside the footprint, or no hit
 *                   there, falls back to y = 0: the ground-floor rooms outside the footprint stay pickable.
 *
 * Allocation-free (module scratch). False when the ray points up or along the floor.
 */
export function intersectLevels(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, shown: LevelId, out: LevelHit): boolean {
  if (shown === 2 && intersectFloor(ox, oy, oz, dx, dy, dz, _flat, LEVEL_Y[2])) {
    const r = LEVEL2_FOOTPRINT
    if (_flat.x >= r.x0 && _flat.x <= r.x1 && _flat.z >= r.z0 && _flat.z <= r.z1) {
      _drawn.x = _flat.x
      _drawn.y = LEVEL_Y[2]
      _drawn.z = _flat.z
      toSimInto(_drawn, 2, _drawn)
      out.x = _drawn.x
      out.z = _drawn.z
      out.level = 2
      return true
    }
  }
  if (!intersectFloor(ox, oy, oz, dx, dy, dz, _flat, 0)) return false
  out.x = _flat.x
  out.z = _flat.z
  out.level = 1
  return true
}

/** The room under the pointer ray with `shown` on screen (see `intersectLevels`), or null outside the building. `hit` receives the floor point (sim). */
export function pickArea(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, shown: LevelId, hit: LevelHit): Area | null {
  return intersectLevels(ox, oy, oz, dx, dy, dz, shown, hit) ? areaUnder(hit.x, hit.z) : null
}

/** Where the hover tint of a room is drawn (a unit plane laid flat, scaled to `w` x `d`): the centre, as drawn. */
export interface TintBox {
  x: number
  y: number
  z: number
  w: number
  d: number
}

/**
 * The tint of the room `rect` (sim coordinates) as drawn: `lift` above its floor, which is at y = 0 on level 1 and 4.2 on level 2, where the room also
 * stands 150 m west of its place in the sim strip (`levelDx`). So a level-2 room is tinted where it is drawn, not where the sim keeps it.
 */
export function tintBox(rect: Rect, lift: number, out: TintBox): TintBox {
  const level = rectLevel(rect)
  out.x = (rect.x0 + rect.x1) / 2 + levelDx(level)
  out.y = lift + LEVEL_Y[level]
  out.z = (rect.z0 + rect.z1) / 2
  out.w = rect.x1 - rect.x0
  out.d = rect.z1 - rect.z0
  return out
}
