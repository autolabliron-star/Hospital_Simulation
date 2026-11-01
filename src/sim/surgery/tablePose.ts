/**
 * R5 wave 2: the OR table top's pose, one pure transform shared by the sim and the scene. The procedure engine's targets and foci, the robot's
 * ports, the live table top, the patient's body, the drapes and the skin marks all move with it, so a hand on the abdomen, a port on the skin
 * and a drape over the legs stay together when the table tips.
 *
 * The top tilts about the cross axis (head end up +: reverse Trendelenburg; down -: Trendelenburg) and rolls about the long axis (+ lifts the
 * patient's right, which is west: the table's head is north), both about the pivot on its column (`SURGERY.tablePivot`): roll first, then tilt.
 * Sim frame (x east, y up from the level's floor, z south); the scene passes its own offsets to `tableMatrixInto`. A level table is the
 * identity to the last bit.
 *
 * Everything writes into preallocated objects: nothing allocates per frame.
 */
import { SURGERY } from '../places'
import type { Vec3 } from '../types'

const DEG = Math.PI / 180

/** The table top's tilt and roll (degrees), with their cached trigonometry. Set with `setTablePose`. */
export interface TablePose {
  tiltDeg: number
  rollDeg: number
  cT: number
  sT: number
  cR: number
  sR: number
}

export function newTablePose(): TablePose {
  return { tiltDeg: 0, rollDeg: 0, cT: 1, sT: 0, cR: 1, sR: 0 }
}

/** Set the tilt and roll (degrees); cheap when they have not changed. */
export function setTablePose(p: TablePose, tiltDeg: number, rollDeg: number): void {
  if (p.tiltDeg !== tiltDeg) {
    p.tiltDeg = tiltDeg
    p.cT = Math.cos(tiltDeg * DEG)
    p.sT = Math.sin(tiltDeg * DEG)
  }
  if (p.rollDeg !== rollDeg) {
    p.rollDeg = rollDeg
    p.cR = Math.cos(rollDeg * DEG)
    p.sR = Math.sin(rollDeg * DEG)
  }
}

/** The pivot in the sim frame: on the column, `tablePivot.dz` toward the feet from the table's centre. */
export const TABLE_PIVOT: Readonly<Vec3> = Object.freeze({
  x: SURGERY.table.at.x,
  y: SURGERY.tablePivot.y,
  z: SURGERY.table.at.z + SURGERY.tablePivot.dz,
})

/**
 * A point given on the level table (sim frame), moved with the top's tilt and roll. `out` may be the point itself.
 *   x' = px + cR e + sR v
 *   y' = py - cT sR e + cT cR v - sT u
 *   z' = pz - sT sR e + sT cR v + cT u          (e, v, u: the point minus the pivot, in x, y, z)
 */
export function tablePointInto(p: TablePose, x: number, y: number, z: number, out: Vec3): Vec3 {
  if (p.sT === 0 && p.sR === 0) {
    out.x = x
    out.y = y
    out.z = z
    return out
  }
  const e = x - TABLE_PIVOT.x
  const v = y - TABLE_PIVOT.y
  const u = z - TABLE_PIVOT.z
  const e2 = e * p.cR + v * p.sR
  const v2 = v * p.cR - e * p.sR
  out.x = TABLE_PIVOT.x + e2
  out.z = TABLE_PIVOT.z + u * p.cT + v2 * p.sT
  out.y = TABLE_PIVOT.y + v2 * p.cT - u * p.sT
  return out
}

/** A direction (no pivot) turned with the top: the table's up, its long axis, a drape's normal. `out` may be the vector itself. */
export function tableDirInto(p: TablePose, x: number, y: number, z: number, out: Vec3): Vec3 {
  const e2 = x * p.cR + y * p.sR
  const v2 = y * p.cR - x * p.sR
  out.x = e2
  out.z = z * p.cT + v2 * p.sT
  out.y = v2 * p.cT - z * p.sT
  return out
}

/**
 * A point in the table top's own frame: `d` metres from the table's centre toward the feet, `x` across (east +: the patient's left when
 * supine), `h` above the top surface (`SURGERY.table.height`). The landmarks of src/sim/procedure/body.ts are given in this frame.
 */
export function tableLocalInto(p: TablePose, d: number, x: number, h: number, out: Vec3): Vec3 {
  const t = SURGERY.table
  return tablePointInto(p, t.at.x + x, t.height + h, t.at.z + d, out)
}

/**
 * The top's transform as a column-major 4x4 matrix (three.js `Matrix4.elements` order) about the pivot moved by `offX`, `offY`, `offZ`: the
 * scene passes its drawn-frame offsets (level 2's x shift and floor height), the sim passes none. Multiply the level table's geometry by it.
 */
export function tableMatrixInto(p: TablePose, out: { [i: number]: number }, offX = 0, offY = 0, offZ = 0): void {
  const { cT, sT, cR, sR } = p
  // the linear part, by rows (see tablePointInto)
  const m00 = cR
  const m01 = sR
  const m02 = 0
  const m10 = -cT * sR
  const m11 = cT * cR
  const m12 = -sT
  const m20 = -sT * sR
  const m21 = sT * cR
  const m22 = cT
  const px = TABLE_PIVOT.x + offX
  const py = TABLE_PIVOT.y + offY
  const pz = TABLE_PIVOT.z + offZ
  out[0] = m00
  out[1] = m10
  out[2] = m20
  out[3] = 0
  out[4] = m01
  out[5] = m11
  out[6] = m21
  out[7] = 0
  out[8] = m02
  out[9] = m12
  out[10] = m22
  out[11] = 0
  out[12] = px - (m00 * px + m01 * py + m02 * pz)
  out[13] = py - (m10 * px + m11 * py + m12 * pz)
  out[14] = pz - (m20 * px + m21 * py + m22 * pz)
  out[15] = 1
}
