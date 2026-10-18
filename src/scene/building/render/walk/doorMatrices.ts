/**
 * Instance matrices of the walk-mode door leaves (W1). Pure maths on Float32Arrays (16 floats per instance, column-major), so the
 * leaf positions are tested in node and the frame callback writes them without allocating.
 *
 *   auto    per door: 2 glass leaves (a unit plane scaled to the leaf) and 2 x 4 frame bars (a unit box scaled to each bar);
 *   swing   per door: 1 leaf (a unit box scaled to the leaf) turning about its hinge to one side of the wall or the other: the door is
 *           double-acting (W3), so `dir` (+1 toward the door's `into` side, -1 to the other side) says which. `dir` is the DoorBank's
 *           `swing`; the drawn leaf and the solid blocker box share the one formula, so they agree for both directions.
 */
import { DOOR_LEAF } from '../../layout/walk/doors'
import type { WalkDoor } from '../../layout/walk/types'

/** The glass leaf's width: half the clear opening (the opening minus its two 3.5 cm jambs), plus a centimetre where the leaves meet. */
export const autoLeafWidth = (d: WalkDoor): number => (d.width - 0.07) / 2 + 0.01
/**
 * How far a leaf slides when fully open: its own width and 3.5 cm more, so the whole leaf has gone into the wall beside the opening
 * (its inner edge 5 mm inside the jamb line). Before W3 it stopped 5.5 cm short and its inner edge stood in the opening; with the
 * leaves solid (`writeLeafBlockers`) that would be a blocker sticking into the clear opening of an open door.
 */
export const autoTravel = (d: WalkDoor): number => autoLeafWidth(d) + 0.035
/** The leaf of a swing door: the opening minus a centimetre and a half of clearance at each side. */
export const swingLeafWidth = (d: WalkDoor): number => d.width - 0.03

/** `c` and `s` are cos and sin of the yaw that turns the unit box's x axis to point along the leaf: x axis -> (c, 0, -s). */
export function setInstance(a: Float32Array, i: number, px: number, py: number, pz: number, c: number, s: number, sx: number, sy: number, sz: number): void {
  const o = i * 16
  a[o] = c * sx
  a[o + 1] = 0
  a[o + 2] = -s * sx
  a[o + 3] = 0
  a[o + 4] = 0
  a[o + 5] = sy
  a[o + 6] = 0
  a[o + 7] = 0
  a[o + 8] = s * sz
  a[o + 9] = 0
  a[o + 10] = c * sz
  a[o + 11] = 0
  a[o + 12] = px
  a[o + 13] = py
  a[o + 14] = pz
  a[o + 15] = 1
}

const BAR = { top: 0.05, side: 0.04, thickness: DOOR_LEAF.autoThickness + 0.01 } as const

/** A blocker is a centimetre thicker than the leaf it stands for (each side's half-thickness grows by this). */
export const LEAF_BLOCKER_GROW = 0.01
const AUTO_BLOCKER_HV = BAR.thickness / 2 + LEAF_BLOCKER_GROW
const SWING_BLOCKER_HV = DOOR_LEAF.thickness / 2 + LEAF_BLOCKER_GROW

/** A world position from a coordinate along the wall and one across it. */
const wx = (d: WalkDoor, along: number, across: number): number => (d.wallAxis === 'x' ? along : across)
const wz = (d: WalkDoor, along: number, across: number): number => (d.wallAxis === 'x' ? across : along)

/**
 * Write the two glass leaves of the auto door number `slot` (and their 8 frame bars) for an opening `e` (0..1).
 * `glass` holds 2 instances per door, `bars` 8 per door.
 */
export function writeAutoDoor(glass: Float32Array, bars: Float32Array, slot: number, d: WalkDoor, e: number): void {
  const alongX = d.wallAxis === 'x'
  const mid = alongX ? d.x : d.z
  const across = (alongX ? d.z : d.x) + d.offset
  // x axis of the unit plane / box -> +x for a wall along x, -> +z for a wall along z
  const c = alongX ? 1 : 0
  const s = alongX ? 0 : -1
  const lw = autoLeafWidth(d)
  const h = DOOR_LEAF.height
  const y0 = 0.02
  for (let side = 0; side < 2; side++) {
    const dir = side === 0 ? -1 : 1
    const along = mid + dir * ((lw - 0.01) / 2 + e * autoTravel(d))
    const leaf = slot * 2 + side
    setInstance(glass, leaf, wx(d, along, across), y0 + h / 2, wz(d, along, across), c, s, lw - 0.02, h, 1)
    const b = leaf * 4
    setInstance(bars, b, wx(d, along, across), y0 + BAR.top / 2, wz(d, along, across), c, s, lw, BAR.top, BAR.thickness)
    setInstance(bars, b + 1, wx(d, along, across), y0 + h - BAR.top / 2, wz(d, along, across), c, s, lw, BAR.top, BAR.thickness)
    for (let k = 0; k < 2; k++) {
      const a = along + (k === 0 ? -1 : 1) * (lw / 2 - BAR.side / 2)
      setInstance(bars, b + 2 + k, wx(d, a, across), y0 + h / 2, wz(d, a, across), c, s, BAR.side, h, BAR.thickness)
    }
  }
}

/**
 * The leaf's direction (unit, in x and z) of a swing door opened by `angle` radians toward the `into` side (`dir` +1, the default) or
 * toward the other side of the wall (`dir` -1).
 */
export function swingDirection(d: WalkDoor, angle: number, dir: number = 1): { x: number; z: number } {
  const co = Math.cos(angle)
  const si = dir < 0 ? -Math.sin(angle) : Math.sin(angle)
  return { x: -d.hinge * d.along.x * co + d.into.x * si, z: -d.hinge * d.along.z * co + d.into.z * si }
}

/**
 * Write the leaf of the swing door number `slot` for an opening `e` (0..1), swung toward the `into` side (`dir` +1, the default) or the
 * other side of the wall (`dir` -1).
 */
export function writeSwingDoor(leaves: Float32Array, slot: number, d: WalkDoor, e: number, dir: number = 1): void {
  const angle = e * d.maxAngle
  const co = Math.cos(angle)
  const si = dir < 0 ? -Math.sin(angle) : Math.sin(angle)
  // the unit direction of the leaf: from the hinge, along the wall toward the far jamb, turning toward the side it swings to
  const dx = -d.hinge * d.along.x * co + d.into.x * si
  const dz = -d.hinge * d.along.z * co + d.into.z * si
  const lw = swingLeafWidth(d)
  const hx = d.x + d.hinge * d.along.x * (d.width / 2 - 0.015)
  const hz = d.z + d.hinge * d.along.z * (d.width / 2 - 0.015)
  setInstance(leaves, slot, hx + dx * (lw / 2), 0.02 + DOOR_LEAF.height / 2, hz + dz * (lw / 2), dx, -dz, lw, DOOR_LEAF.height, DOOR_LEAF.thickness)
}

/** Boxes `writeLeafBlockers` writes for these doors: 2 per auto door, 1 per swing door. */
export function leafBlockerCount(doors: readonly WalkDoor[]): number {
  let n = 0
  for (let i = 0; i < doors.length; i++) n += doors[i].kind === 'auto' ? 2 : 1
  return n
}

/**
 * The leaves as solid floor boxes for the player's body (src/scene/blockers.ts: cx, cz, ux, uz, hu, hv per box), written into `out` for
 * the openings in `shown` (one per door, the same numbers the leaf matrices are written from) and, for the swing doors, the sides in
 * `swing` (one per door, the DoorBank's `swing`: +1 toward the door's `into` side, -1 the other way; omitted: all +1). Returns how many
 * boxes it wrote (`leafBlockerCount`). Allocation-free: it shares the leaf geometry (`autoLeafWidth`, `autoTravel`, `swingLeafWidth`)
 * with the matrices and does the swing leaf's direction inline, and never calls `swingDirection`, which allocates.
 *
 *   auto    two boxes along the wall, each as wide as the leaf and `LEAF_BLOCKER_GROW` thicker than the frame bars on each side; at
 *           e = 1 they are inside the wall beside the opening (no blocker in the clear opening of an open door);
 *   swing   one box along the leaf at its present angle, hinged at the jamb, `LEAF_BLOCKER_GROW` thicker than the leaf on each side.
 */
export function writeLeafBlockers(doors: readonly WalkDoor[], shown: ArrayLike<number>, out: Float64Array, swing?: ArrayLike<number>): number {
  let n = 0
  for (let i = 0; i < doors.length; i++) {
    const d = doors[i]
    const e = shown[i]
    if (d.kind === 'auto') {
      const alongX = d.wallAxis === 'x'
      const mid = alongX ? d.x : d.z
      const across = (alongX ? d.z : d.x) + d.offset
      const lw = autoLeafWidth(d)
      for (let side = 0; side < 2; side++) {
        const along = mid + (side === 0 ? -1 : 1) * ((lw - 0.01) / 2 + e * autoTravel(d))
        const o = n * 6
        out[o] = alongX ? along : across
        out[o + 1] = alongX ? across : along
        out[o + 2] = alongX ? 1 : 0
        out[o + 3] = alongX ? 0 : 1
        out[o + 4] = lw / 2
        out[o + 5] = AUTO_BLOCKER_HV
        n++
      }
    } else {
      const angle = e * d.maxAngle
      const co = Math.cos(angle)
      const si = swing !== undefined && swing[i] < 0 ? -Math.sin(angle) : Math.sin(angle)
      const dx = -d.hinge * d.along.x * co + d.into.x * si
      const dz = -d.hinge * d.along.z * co + d.into.z * si
      const lw = swingLeafWidth(d)
      const hx = d.x + d.hinge * d.along.x * (d.width / 2 - 0.015)
      const hz = d.z + d.hinge * d.along.z * (d.width / 2 - 0.015)
      const o = n * 6
      out[o] = hx + dx * (lw / 2)
      out[o + 1] = hz + dz * (lw / 2)
      out[o + 2] = dx
      out[o + 3] = dz
      out[o + 4] = lw / 2
      out[o + 5] = SWING_BLOCKER_HV
      n++
    }
  }
  return n
}
