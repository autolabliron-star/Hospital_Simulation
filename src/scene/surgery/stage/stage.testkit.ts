// A test kit, not shipped: every real avatar (LOD 0 skinned on the CPU exactly as the avatar vertex shader does) lying on the OR table as agent G's rig poses
// it, in the TABLE'S OWN frame (d toward the feet from the table's centre, x across, east +, h above the pad's top), at any tilt and roll of the top.
import type { AvatarEntry } from '@/scene/actors/crowd/avatars'
import { applyBinds } from '@/scene/actors/crowd/avatars'
import { cpuMesh, loadBody, readIndex, skinAll, type CpuMesh } from '@/scene/actors/crowd/avatars.testkit'
import { PART_COUNT } from '@/scene/actors/crowd/constants'
import { lookFor } from '@/scene/actors/crowd/outfit'
import { createRig, makeInput, solveRig } from '@/scene/actors/crowd/rig'
import { LEVEL_Y, levelDx } from '@/sim/levels'
import { SURGERY } from '@/sim/places'
import { newTablePose, setTablePose, tableMatrixInto } from '@/sim/surgery/tablePose'

export const AVATARS: readonly AvatarEntry[] = readIndex().avatars

/** The four avatars a gowned patient can be (avatars.ts GOWN wardrobe). */
export const GOWN_AVATARS: readonly string[] = ['female_adult_17', 'medical_female_01', 'male_adult_13', 'male_adult_12']

const OFF_X = levelDx(2)
const OFF_Y = LEVEL_Y[2]
const X0 = SURGERY.table.at.x + OFF_X
const Z0 = SURGERY.table.at.z
const TOP = SURGERY.table.height

export interface PosedBody {
  avatar: AvatarEntry
  mesh: CpuMesh
  /** Skinned vertices in the table's frame, three floats each: x across, h above the top, d toward the feet (so a triangle is three of these). */
  v: Float32Array
  /** The partner of the vertices: the main part (joint 0) of each, for picking out the legs. */
  parts: Uint8Array
  /** Each part's joint (the origin of its matrix: the hip is the thigh's, the knee the shin's, the ankle the foot's) in the same frame, three floats a part: x, h, d. */
  joints: Float64Array
}

const meshes = new Map<string, Promise<CpuMesh>>()
function meshOf(a: AvatarEntry): Promise<CpuMesh> {
  let p = meshes.get(a.id)
  if (!p) {
    p = loadBody(a, 0).then(cpuMesh)
    meshes.set(a.id, p)
  }
  return p
}

export interface PoseOptions {
  lith: boolean
  tilt?: number
  roll?: number
  scale?: number
}

/**
 * The avatar on the table (tucked arms, as the scripts have them), settled for 300 frames. The table frame is the LEVEL table's: the drawn points are carried back
 * through the inverse of the top's matrix, so a tipped table gives the same numbers as a level one if the body rides the pad exactly (which tablePatient.test pins).
 */
export async function poseBody(a: AvatarEntry, o: PoseOptions): Promise<PosedBody> {
  const mesh = await meshOf(a)
  const look = { ...lookFor({ id: 'patient', role: 'patient', outfit: 'gown', variant: 5 }), scale: o.scale ?? 1 }
  const rig = createRig(look, a.body)
  const inp = makeInput()
  inp.posture = 'lie'
  inp.mode = 'lie'
  inp.seatHeight = TOP
  inp.x = X0
  inp.y = OFF_Y
  inp.z = Z0
  inp.tableSeat = true
  inp.tableOffX = OFF_X
  inp.tableOffY = OFF_Y
  inp.tablePose = true
  inp.tableLith = o.lith
  inp.tableTuck = true
  inp.tableTilt = o.tilt ?? 0
  inp.tableRoll = o.roll ?? 0
  const rows = new Float32Array(PART_COUNT * 12)
  for (let i = 0; i < 300; i++) {
    inp.time = i / 60
    solveRig(rig, inp, rows, 0)
    inp.tableSnap = false
  }
  const raw = rows.slice()
  applyBinds(rows, 0, a.bindInverse)
  const s = skinAll(mesh, rows)
  const n = mesh.count
  // the drawn frame -> the level table's: undo the top's matrix (about the pivot moved by the level's offsets)
  const pose = newTablePose()
  setTablePose(pose, o.tilt ?? 0, o.roll ?? 0)
  const M = new Float64Array(16)
  tableMatrixInto(pose, M, OFF_X, OFF_Y, 0)
  const v = new Float32Array(n * 3)
  const parts = new Uint8Array(n)
  // the joints: the rig's own part matrices as solved, before the binds go into them
  const joints = new Float64Array(PART_COUNT * 3)
  for (let q = 0; q < PART_COUNT; q++) {
    const wx = raw[q * 12 + 3] + inp.x - M[12]
    const wy = raw[q * 12 + 7] + inp.y - M[13]
    const wz = raw[q * 12 + 11] + inp.z - M[14]
    joints[q * 3] = M[0] * wx + M[1] * wy + M[2] * wz - X0
    joints[q * 3 + 1] = M[4] * wx + M[5] * wy + M[6] * wz - OFF_Y - TOP
    joints[q * 3 + 2] = M[8] * wx + M[9] * wy + M[10] * wz - Z0
  }
  for (let i = 0; i < n; i++) {
    const wx = s[i * 3] + inp.x - M[12]
    const wy = s[i * 3 + 1] + inp.y - M[13]
    const wz = s[i * 3 + 2] + inp.z - M[14]
    // the linear part is a rotation: its inverse is its transpose
    const lx = M[0] * wx + M[1] * wy + M[2] * wz
    const ly = M[4] * wx + M[5] * wy + M[6] * wz
    const lz = M[8] * wx + M[9] * wy + M[10] * wz
    v[i * 3] = lx - X0
    v[i * 3 + 1] = ly - OFF_Y - TOP
    v[i * 3 + 2] = lz - Z0
    parts[i] = Math.round(mesh.joints[i * 4])
  }
  return { avatar: a, mesh, v, parts, joints }
}

/** The body's triangles as nine floats each (x, h, d for three corners). */
export function trianglesOf(b: PosedBody): Float32Array {
  const idx = b.mesh.index
  const out = new Float32Array(idx.length * 3)
  for (let i = 0; i < idx.length; i++) {
    const k = idx[i] * 3
    out[i * 3] = b.v[k]
    out[i * 3 + 1] = b.v[k + 1]
    out[i * 3 + 2] = b.v[k + 2]
  }
  return out
}

/** A height field over (d, x): the highest surface of any triangle above each cell, rasterised from nine-float triangles (x, h, d per corner). */
export class HeightField {
  readonly nd: number
  readonly nx: number
  readonly h: Float32Array
  constructor(readonly d0: number, readonly d1: number, readonly x0: number, readonly x1: number, readonly cell: number) {
    this.nd = Math.ceil((d1 - d0) / cell)
    this.nx = Math.ceil((x1 - x0) / cell)
    this.h = new Float32Array(this.nd * this.nx).fill(-Infinity)
  }

  /** Rasterise triangles (x, h, d corners), taking the maximum height. `up` only: skip downward-facing triangles (the underside of the sheet). */
  add(tri: ArrayLike<number>, facing: 'any' | 'up' = 'any'): this {
    const { cell } = this
    for (let t = 0; t + 8 < tri.length; t += 9) {
      const ax = tri[t], ah = tri[t + 1], ad = tri[t + 2]
      const bx = tri[t + 3], bh = tri[t + 4], bd = tri[t + 5]
      const cx = tri[t + 6], ch = tri[t + 7], cd = tri[t + 8]
      const den = (bd - cd) * (ax - cx) + (cx - bx) * (ad - cd)
      if (Math.abs(den) < 1e-14) continue
      if (facing === 'up') {
        // the normal's h component (x, h, d right-handed with h up: the cross product of two edges in plan)
        const ny = (bd - ad) * (cx - ax) - (bx - ax) * (cd - ad)
        if (ny <= 0) continue
      }
      const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx)
      const minD = Math.min(ad, bd, cd), maxD = Math.max(ad, bd, cd)
      const i0 = Math.max(0, Math.floor((minD - this.d0) / cell)), i1 = Math.min(this.nd - 1, Math.floor((maxD - this.d0) / cell))
      const j0 = Math.max(0, Math.floor((minX - this.x0) / cell)), j1 = Math.min(this.nx - 1, Math.floor((maxX - this.x0) / cell))
      for (let i = i0; i <= i1; i++) {
        const d = this.d0 + (i + 0.5) * cell
        for (let j = j0; j <= j1; j++) {
          const x = this.x0 + (j + 0.5) * cell
          const l1 = ((bd - cd) * (x - cx) + (cx - bx) * (d - cd)) / den
          const l2 = ((cd - ad) * (x - cx) + (ax - cx) * (d - cd)) / den
          const l3 = 1 - l1 - l2
          const e = -1e-9
          if (l1 < e || l2 < e || l3 < e) continue
          const hh = l1 * ah + l2 * bh + l3 * ch
          const k = i * this.nx + j
          if (hh > this.h[k]) this.h[k] = hh
        }
      }
    }
    return this
  }

  at(d: number, x: number): number {
    const i = Math.floor((d - this.d0) / this.cell)
    const j = Math.floor((x - this.x0) / this.cell)
    if (i < 0 || j < 0 || i >= this.nd || j >= this.nx) return -Infinity
    return this.h[i * this.nx + j]
  }
}
