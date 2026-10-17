/**
 * Pure maths for picking a room with the mouse: is this press a click or a drag, and where does the pointer ray hit the
 * floor. No three.js here, so it is unit-tested in node. `RoomPicker` feeds it the camera ray.
 */
import { areaAt, type Area } from '@/sim/places'

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
