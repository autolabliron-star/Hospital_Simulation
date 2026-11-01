/**
 * The one table transform shared by the sim and the scene (R5 wave 2, tablePose.ts): the column-major matrix the scene's live table top uses agrees with the
 * point transform the sim's targets, ports and focus points use to 1e-9, it is a proper rotation (orthonormal, determinant +1), a level table is the identity to
 * the last bit, the pivot stays put, and a head-down tilt lowers the head and raises the feet.
 */
import { describe, expect, it } from 'vitest'
import { SURGERY } from '../places'
import type { Vec3 } from '../types'
import { newTablePose, setTablePose, tableDirInto, tableLocalInto, tableMatrixInto, tablePointInto, TABLE_PIVOT } from './tablePose'

const POSES: readonly [number, number][] = [
  [0, 0],
  [-25, 0],
  [-30, 4],
  [25, -8],
  [12, 10],
  [-5, -15],
  [0, 20],
  [-45, 45],
]

/** A grid of points over and around the table (sim frame): x across, y from the floor to a metre over the top, z along. */
function* points(): Generator<[number, number, number]> {
  const t = SURGERY.table
  for (const dx of [-0.6, -0.25, 0, 0.3, 0.9]) for (const y of [0, 0.4, 0.8, 0.88, 1.06, 1.5]) for (const dz of [-1.1, -0.5, 0, 0.2, 0.7, 1.2]) yield [t.at.x + dx, y, t.at.z + dz]
}

/** Apply a column-major 4x4 to a point. */
function apply(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
}

describe('the table matrix agrees with the point transform', () => {
  it('moves every point of the table and the air over it exactly where tablePointInto does (1e-9), for tilts and rolls either way', () => {
    const p = newTablePose()
    const m = new Float64Array(16)
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    let n = 0
    for (const [tilt, roll] of POSES) {
      setTablePose(p, tilt, roll)
      tableMatrixInto(p, m)
      for (const [x, y, z] of points()) {
        tablePointInto(p, x, y, z, out)
        const q = apply(m, x, y, z)
        expect(Math.abs(q[0] - out.x), `tilt ${tilt} roll ${roll} x`).toBeLessThan(1e-9)
        expect(Math.abs(q[1] - out.y), `tilt ${tilt} roll ${roll} y`).toBeLessThan(1e-9)
        expect(Math.abs(q[2] - out.z), `tilt ${tilt} roll ${roll} z`).toBeLessThan(1e-9)
        n++
      }
    }
    expect(n).toBe(POSES.length * 5 * 6 * 6)
  })

  it('does the same with the scene\'s drawn-frame offsets: the pivot and the point both moved, the result moved by the same amount', () => {
    const p = newTablePose()
    const m = new Float64Array(16)
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    // level 2's x shift (-150) and its floor height (4.2)
    const off = [-150, 4.2, 0.3] as const
    for (const [tilt, roll] of POSES) {
      setTablePose(p, tilt, roll)
      tableMatrixInto(p, m, off[0], off[1], off[2])
      for (const [x, y, z] of points()) {
        tablePointInto(p, x, y, z, out)
        const q = apply(m, x + off[0], y + off[1], z + off[2])
        expect(Math.abs(q[0] - (out.x + off[0]))).toBeLessThan(1e-9)
        expect(Math.abs(q[1] - (out.y + off[1]))).toBeLessThan(1e-9)
        expect(Math.abs(q[2] - (out.z + off[2]))).toBeLessThan(1e-9)
      }
    }
  })

  it('agrees with tableDirInto on directions (the linear part) and with tableLocalInto on the table\'s own frame', () => {
    const p = newTablePose()
    const m = new Float64Array(16)
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    const t = SURGERY.table
    for (const [tilt, roll] of POSES) {
      setTablePose(p, tilt, roll)
      tableMatrixInto(p, m)
      for (const [x, y, z] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.5, 0.8]] as const) {
        tableDirInto(p, x, y, z, out)
        expect(Math.abs(m[0] * x + m[4] * y + m[8] * z - out.x)).toBeLessThan(1e-12)
        expect(Math.abs(m[1] * x + m[5] * y + m[9] * z - out.y)).toBeLessThan(1e-12)
        expect(Math.abs(m[2] * x + m[6] * y + m[10] * z - out.z)).toBeLessThan(1e-12)
      }
      // a point 0.4 m toward the feet, 0.1 across, 0.2 above the top
      tableLocalInto(p, 0.4, 0.1, 0.2, out)
      const q = apply(m, t.at.x + 0.1, t.height + 0.2, t.at.z + 0.4)
      expect(Math.abs(q[0] - out.x)).toBeLessThan(1e-9)
      expect(Math.abs(q[1] - out.y)).toBeLessThan(1e-9)
      expect(Math.abs(q[2] - out.z)).toBeLessThan(1e-9)
    }
  })
})

describe('the matrix is a rotation about the pivot', () => {
  it('is orthonormal with determinant +1, and keeps the pivot where it is', () => {
    const p = newTablePose()
    const m = new Float64Array(16)
    for (const [tilt, roll] of POSES) {
      setTablePose(p, tilt, roll)
      tableMatrixInto(p, m)
      const col = (c: number): [number, number, number] => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]]
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
      const [c0, c1, c2] = [col(0), col(1), col(2)]
      for (const c of [c0, c1, c2]) expect(Math.abs(dot(c, c) - 1), `unit columns at ${tilt}, ${roll}`).toBeLessThan(1e-12)
      expect(Math.abs(dot(c0, c1))).toBeLessThan(1e-12)
      expect(Math.abs(dot(c0, c2))).toBeLessThan(1e-12)
      expect(Math.abs(dot(c1, c2))).toBeLessThan(1e-12)
      // the determinant (the triple product of the columns)
      const det = c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) - c0[1] * (c1[0] * c2[2] - c1[2] * c2[0]) + c0[2] * (c1[0] * c2[1] - c1[1] * c2[0])
      expect(Math.abs(det - 1)).toBeLessThan(1e-12)
      // the bottom row is (0, 0, 0, 1)
      expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1])
      // the pivot is a fixed point
      const q = apply(m, TABLE_PIVOT.x, TABLE_PIVOT.y, TABLE_PIVOT.z)
      expect(Math.abs(q[0] - TABLE_PIVOT.x)).toBeLessThan(1e-12)
      expect(Math.abs(q[1] - TABLE_PIVOT.y)).toBeLessThan(1e-12)
      expect(Math.abs(q[2] - TABLE_PIVOT.z)).toBeLessThan(1e-12)
    }
  })

  it('keeps every distance: two points stay as far apart as they were', () => {
    const p = newTablePose()
    const a: Vec3 = { x: 0, y: 0, z: 0 }
    const b: Vec3 = { x: 0, y: 0, z: 0 }
    const t = SURGERY.table
    setTablePose(p, -25, 6)
    tablePointInto(p, t.at.x - 0.2, 1.0, t.at.z - 0.9, a)
    tablePointInto(p, t.at.x + 0.3, 0.84, t.at.z + 0.95, b)
    const was = Math.hypot(0.5, 0.16, 1.85)
    expect(Math.abs(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - was)).toBeLessThan(1e-12)
  })

  it('is the identity to the last bit when the table is level (the sim\'s level ports are the contract\'s own, unchanged)', () => {
    const p = newTablePose()
    const m = new Float64Array(16)
    tableMatrixInto(p, m)
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    // (=== treats -0 as 0: a level matrix may carry a negative zero, which moves nothing)
    for (let i = 0; i < 16; i++) expect(m[i] === identity[i], `element ${i} is ${m[i]}`).toBe(true)
    // setting the level pose again (from a tilted one) comes back to exactly that
    setTablePose(p, -25, 5)
    setTablePose(p, 0, 0)
    tableMatrixInto(p, m)
    for (let i = 0; i < 16; i++) expect(m[i] === identity[i], `after returning level, element ${i} is ${m[i]}`).toBe(true)
    // and the point transform hands the very same numbers back
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    for (const layout of ['transverse', 'oblique'] as const) {
      for (const port of SURGERY.ports[layout]) {
        tablePointInto(p, port.x, port.y, port.z, out)
        expect(out).toEqual(port)
      }
    }
  })

  it('also gives the pivot offsets back unchanged when level (a level table is the identity in the drawn frame too)', () => {
    const p = newTablePose()
    const m = new Float64Array(16)
    tableMatrixInto(p, m, -150, 4.2, 0)
    for (const i of [12, 13, 14]) expect(Math.abs(m[i])).toBeLessThan(1e-12)
  })
})

describe('the tilt and roll go the way the contract says', () => {
  it('Trendelenburg (negative tilt) lowers the head end and raises the foot end of the top; reverse (positive) does the opposite', () => {
    const p = newTablePose()
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    const t = SURGERY.table
    setTablePose(p, -25, 0)
    tablePointInto(p, t.at.x, t.height, t.at.z - 0.9, out)
    expect(out.y).toBeLessThan(t.height - 0.1)
    tablePointInto(p, t.at.x, t.height, t.at.z + 0.9, out)
    expect(out.y).toBeGreaterThan(t.height + 0.1)
    setTablePose(p, 15, 0)
    tablePointInto(p, t.at.x, t.height, t.at.z - 0.9, out)
    expect(out.y).toBeGreaterThan(t.height + 0.1)
  })

  it('a positive roll lifts the patient\'s right side (west) and lowers the left (east)', () => {
    const p = newTablePose()
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    const t = SURGERY.table
    setTablePose(p, 0, 10)
    tablePointInto(p, t.at.x - 0.25, t.height, t.at.z, out)
    expect(out.y).toBeGreaterThan(t.height + 0.03)
    tablePointInto(p, t.at.x + 0.25, t.height, t.at.z, out)
    expect(out.y).toBeLessThan(t.height - 0.03)
  })

  it('tips a port 25 degrees head-down by a few centimetres only: the pivot sits at the abdomen, so the cart barely has to move', () => {
    const p = newTablePose()
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    setTablePose(p, -25, 0)
    for (const port of SURGERY.ports.transverse) {
      tablePointInto(p, port.x, port.y, port.z, out)
      expect(Math.hypot(out.x - port.x, out.y - port.y, out.z - port.z)).toBeLessThan(0.2)
      expect(out.x).toBeCloseTo(port.x, 9)
    }
  })
})
