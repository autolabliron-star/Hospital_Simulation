/**
 * Helpers for the body's node tests (nothing in the app imports this file): exact clearances from the static solids and from the
 * registered door-leaf blockers, a fake blocker source, a BodyMover driver, and a recorder. The tests drive a pure `BodyMover` frame by
 * frame, so every claim is checked on every frame, not on the last one.
 */
import { BLOCKER_STRIDE, registerBlockers, type BlockerSource } from '@/scene/blockers'
import { BodyMover } from './body'
import { KIND_CIRCLE, QUERY_CAPACITY, SOLID_STRIDE, queryStatic, staticSolids } from './solids'

const _idx = new Int32Array(QUERY_CAPACITY)

/** The distance from (px, pz) to an oriented box: 0 inside it. */
export function boxDistance(px: number, pz: number, cx: number, cz: number, ux: number, uz: number, hu: number, hv: number): number {
  const ox = px - cx
  const oz = pz - cz
  const lx = ox * ux + oz * uz
  const lz = -ox * uz + oz * ux
  const qx = Math.max(Math.abs(lx) - hu, 0)
  const qz = Math.max(Math.abs(lz) - hv, 0)
  return Math.hypot(qx, qz)
}

export interface Clearance {
  /** The distance from the point to the nearest solid (a point inside a box core counts as 0), `Infinity` when nothing is near. */
  d: number
  /** What it is. */
  id: string
}

/** The nearest static solid to (x, z) within `reach` metres, and the distance to it (surface to point). */
export function staticClearance(x: number, z: number, reach = 1): Clearance {
  const s = staticSolids()
  const n = queryStatic(x - reach, x + reach, z - reach, z + reach, _idx)
  let best = Infinity
  let id = ''
  for (let k = 0; k < n; k++) {
    const i = _idx[k]
    const o = i * SOLID_STRIDE
    const d =
      s.data[o] === KIND_CIRCLE
        ? Math.max(Math.hypot(x - s.data[o + 1], z - s.data[o + 2]) - s.data[o + 5], 0)
        : boxDistance(x, z, s.data[o + 1], s.data[o + 2], s.data[o + 3], s.data[o + 4], s.data[o + 5], s.data[o + 6])
    if (d < best) {
      best = d
      id = s.ids[i]
    }
  }
  return { d: best, id }
}

/** The distance from (x, z) to the nearest live box of a blocker source. */
export function blockerClearance(src: BlockerSource, x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < src.count; i++) {
    const o = i * BLOCKER_STRIDE
    const d = boxDistance(x, z, src.data[o], src.data[o + 1], src.data[o + 2], src.data[o + 3], src.data[o + 4], src.data[o + 5])
    if (d < best) best = d
  }
  return best
}

/** A blocker source a test writes boxes into. Register it, drive the body, call the returned function when done. */
export class FakeBlockers implements BlockerSource {
  readonly data = new Float64Array(64 * BLOCKER_STRIDE)
  count = 0
  constructor(readonly name: string = 'test leaves') {}

  clear(): this {
    this.count = 0
    return this
  }

  add(cx: number, cz: number, ux: number, uz: number, hu: number, hv: number): this {
    const o = this.count++ * BLOCKER_STRIDE
    this.data[o] = cx
    this.data[o + 1] = cz
    this.data[o + 2] = ux
    this.data[o + 3] = uz
    this.data[o + 4] = hu
    this.data[o + 5] = hv
    return this
  }

  register(): () => void {
    return registerBlockers(this)
  }
}

/** A classic-scheme mover at (x, z): the direction of travel is the camera's facing, so a test steers by angle. */
export function classicMover(x: number, z: number): BodyMover {
  const m = new BodyMover('classic')
  m.place(x, z)
  return m
}

/** The compass angle (atan2(dx, dz)) from one point to another. */
export function bearing(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(tx - fx, tz - fz)
}
