/**
 * The X-ray room's ceiling tube as geometry (pure builders). Two rails run along z at the ceiling; a carriage rides them; a
 * telescopic column hangs from the carriage; the tube head pivots about the z axis at the column's foot, pointing down at the table
 * or WEST at the wall detector. The room already draws the radiography table, the wall detector, the booth and the console: not
 * redrawn here. Static parts are in world coordinates; the carriage, column and head are built so that `rig.ts` only sets their
 * z (and, for the column, a y scale; for the head, a rotation about z).
 *
 *   carriage   x and y absolute (world), z = 0   -> mesh.position.z = carriage z
 *   column     x centred on 0, y from 0 down to -1 (a unit length) -> mesh.position = (x, columnTopY, z), scale.y = length
 *   head       centred on its pivot (the focal spot)            -> mesh.position = (x, pivotY, z), rotation.z = angle
 */
import type { BufferGeometry } from 'three'
import type { ConsoleScreen } from '@/scene/building/layout'
import { IMAGING } from '@/sim/places'
import { bx, COL, cyl, GlowBuilder, type GlowGeometry, merge, plane, rbox, rbx } from './geometry'
import { consoleFurniture } from './monitors'
import { XRAY_POSE } from './motion'

const M = IMAGING.xray.machine
const TBL = IMAGING.xray.table

export const XRAY = {
  /** The tube runs along x = the anchor's x; the rails are `railDx` either side. */
  x: M.x,
  rail: { dx: 0.55, y0: 2.72, y1: 2.84, z0: 4.6, z1: 10.6, w: 0.1 },
  /** The carriage's cross beam (underside, top, half length in x, half width in z) and the fixed housing the column slides in. */
  beam: { y0: 2.58, y1: 2.7, halfX: 0.72, halfZ: 0.16 },
  housing: { y0: 2.3, half: 0.14 },
  /** The wall detector's face (a warm panel, see rooms/imaging.ts): x of its front, centre height and z. */
  wall: { x: -39.53, y: 1.15, z: XRAY_POSE.wallZ },
  /** The red exposure lamp over the booth door. */
  lamp: { x: -35.6, y: 2.35, z: 2.0 },
  /** Side of the collimator light square (m). */
  field: 0.35,
} as const

/** The two ceiling rails, their end stops, the lamp bracket and the bezel and stand of the booth monitor (all static). */
export function buildXrayStatic(screens: readonly ConsoleScreen[]): BufferGeometry {
  const { rail } = XRAY
  const parts: BufferGeometry[] = []
  for (const k of [-1, 1]) {
    const x = XRAY.x + k * rail.dx
    parts.push(bx(x - rail.w / 2, x + rail.w / 2, rail.y0, rail.y1, rail.z0, rail.z1, COL.grey))
    parts.push(bx(x - 0.06, x + 0.06, rail.y0 - 0.01, rail.y1 + 0.01, rail.z0, rail.z0 + 0.06, COL.dark))
    parts.push(bx(x - 0.06, x + 0.06, rail.y0 - 0.01, rail.y1 + 0.01, rail.z1 - 0.06, rail.z1, COL.dark))
  }
  // the lamp's bracket (the lamp itself is in the glow mesh)
  const l = XRAY.lamp
  parts.push(bx(l.x - 0.1, l.x + 0.1, l.y - 0.07, l.y - 0.04, l.z - 0.05, l.z + 0.05, COL.dark))
  parts.push(...consoleFurniture(screens))
  return merge(parts)
}

/** The carriage: a cross beam over both rails with a trolley on each, and the fixed upper housing of the column. */
export function buildXrayCarriage(): BufferGeometry {
  const { beam, rail, housing } = XRAY
  const parts: BufferGeometry[] = [rbx(XRAY.x - beam.halfX, XRAY.x + beam.halfX, beam.y0, beam.y1, -beam.halfZ, beam.halfZ, 0.025, COL.white)]
  for (const k of [-1, 1]) parts.push(bx(XRAY.x + k * rail.dx - 0.08, XRAY.x + k * rail.dx + 0.08, beam.y1, rail.y1 + 0.02, -0.2, 0.2, COL.dark))
  parts.push(rbx(XRAY.x - housing.half, XRAY.x + housing.half, housing.y0, beam.y0, -housing.half, housing.half, 0.03, COL.white))
  parts.push(bx(XRAY.x - housing.half - 0.004, XRAY.x + housing.half + 0.004, housing.y0 + 0.04, housing.y0 + 0.07, -housing.half - 0.004, housing.half + 0.004, COL.dark))
  return merge(parts)
}

/**
 * The telescopic column as a UNIT length (y from 0 down to -1, x and z centred on 0): three nested segments with collars.
 * The mesh is scaled in y to the current column length, so it telescopes without rebuilding any geometry.
 */
export function buildXrayColumn(): BufferGeometry {
  return merge([
    rbx(-0.11, 0.11, -0.5, 0, -0.11, 0.11, 0.015, COL.white),
    bx(-0.122, 0.122, -0.515, -0.495, -0.122, 0.122, COL.grey),
    rbx(-0.09, 0.09, -0.8, -0.5, -0.09, 0.09, 0.012, COL.white),
    bx(-0.1, 0.1, -0.815, -0.795, -0.1, 0.1, COL.grey),
    rbx(-0.07, 0.07, -1.0, -0.8, -0.07, 0.07, 0.01, COL.greyMid),
  ])
}

/** The tube head centred on its pivot, collimator pointing down (-y): housing, cooling band, handle, collimator and its window. */
export function buildXrayHead(): BufferGeometry {
  const h = XRAY_POSE.headHalf
  return merge([
    rbox(2 * h, 2 * h, 0.26, 0.04, COL.white),
    bx(-h - 0.003, h + 0.003, 0.05, 0.09, -0.133, 0.133, COL.greyMid),
    cyl('z', 0.011, 0.24, COL.dark, { x: h + 0.03, y: -0.1 }),
    bx(h, h + 0.03, -0.11, -0.09, -0.1, -0.08, COL.dark),
    bx(h, h + 0.03, -0.11, -0.09, 0.08, 0.1, COL.dark),
    rbx(-0.12, 0.12, -h - 0.17, -h, -0.11, 0.11, 0.02, COL.grey),
    bx(-0.095, 0.095, -h - 0.176, -h - 0.168, -0.085, 0.085, COL.bezel),
    cyl('z', 0.07, 0.02, COL.dark, { z: 0.14 }),
    cyl('z', 0.07, 0.02, COL.dark, { z: -0.14 }),
  ])
}

/** Collimator light on the table and on the wall detector, and the exposure lamp. */
export function buildXrayGlow(): GlowGeometry {
  const s = XRAY.field
  const ty = TBL.height + 0.006
  const tx = TBL.out.x
  const tz = TBL.out.z
  const w = XRAY.wall
  const wx = w.x + 0.004
  const l = XRAY.lamp
  return new GlowBuilder()
    .region('tableFill', '#ffd36a', [plane(s, s, '#ffd36a', { x: tx, y: ty, z: tz })])
    .region('tableCross', '#fff3c4', [plane(s, 0.012, '#fff3c4', { x: tx, y: ty + 0.002, z: tz }), plane(0.012, s, '#fff3c4', { x: tx, y: ty + 0.002, z: tz })])
    .region('wallFill', '#ffb84a', [plane(s, s, '#ffb84a', { x: wx, y: w.y, z: w.z }, '+x')])
    .region('wallCross', '#fff3c4', [plane(s, 0.012, '#fff3c4', { x: wx + 0.002, y: w.y, z: w.z }, '+x'), plane(0.012, s, '#fff3c4', { x: wx + 0.002, y: w.y, z: w.z }, '+x')])
    .region('lamp', '#ff2020', [bx(l.x - 0.08, l.x + 0.08, l.y - 0.04, l.y + 0.04, l.z - 0.06, l.z + 0.06, '#ff2020')])
    .build()
}
