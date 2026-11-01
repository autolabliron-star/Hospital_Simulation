// R5 wave 3 (agent J): a test kit, not shipped. A patient (the procedural body or any realistic avatar, skinned on the CPU exactly as the avatar vertex shader does) lying
// on a PROCEDURE table (the CT cryo table or the ultrasound couch), posed by the same `writeTableInput` the crowd model uses, stepped frame by frame through the rig.
// Everything comes out in the TABLE'S frame: `d` from the root (the pelvis centre of the position) toward the feet, `x` across (the patient's left when supine; the table's
// own +x), `h` above the pad.
import { CRYO_SUITE, IMAGING } from '@/sim/places'
import type { PatientPoseView } from '@/sim/types'
import { applyBinds, type AvatarEntry } from './avatars'
import { cpuMesh, loadBody, readIndex, skinAll, type CpuMesh } from './avatars.testkit'
import { NOMINAL_BODY, P, PART_COUNT, type BodyDims } from './constants'
import { buildBodyGeometries } from './geometry'
import { lookFor } from './outfit'
import { createRig, makeInput, solveRig, type PersonRig, type RigInput } from './rig'
import { measureLieFit, writeTableInput } from './tablePatient'

export const AVATARS: readonly AvatarEntry[] = readIndex().avatars

export type ProcTableId = 'cryo' | 'us'

/** The tables: where the patient's root lies in the sim frame, its heading and the top's height. */
export const TABLES = {
  cryo: { x: CRYO_SUITE.ct.table.out.x, z: CRYO_SUITE.ct.table.out.z, heading: CRYO_SUITE.ct.table.heading, top: CRYO_SUITE.ct.table.height },
  us: { x: IMAGING.us.table.in.x, z: IMAGING.us.table.in.z, heading: IMAGING.us.table.heading, top: IMAGING.us.table.height },
} as const

export const POSE0: Readonly<PatientPoseView> = Object.freeze({
  position: 'supine',
  headTiltDeg: 0,
  rollDeg: 0,
  arms: 'out',
  airway: 'none',
  awareness: 'asleep',
  prep: 0,
  drape: 0,
  marks: 'none',
  catheter: false,
  manipulator: false,
})

const meshes = new Map<string, Promise<CpuMesh>>()
function meshOf(a: AvatarEntry): Promise<CpuMesh> {
  let p = meshes.get(a.id)
  if (!p) {
    p = loadBody(a, 0).then(cpuMesh)
    meshes.set(a.id, p)
  }
  return p
}

interface Proc {
  pos: Float32Array
  part: Uint8Array
  count: number
  index: ArrayLike<number>
}
let procedural: Proc | null = null
/** The procedural body's high-detail mesh as plain arrays: local positions and the part each vertex belongs to. */
function proceduralMesh(): Proc {
  if (procedural === null) {
    const g = buildBodyGeometries().high
    const pos = g.getAttribute('position')
    const ap = g.getAttribute('aPart')
    const count = pos.count
    const p = new Float32Array(count * 3)
    const part = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) p[i * 3 + c] = pos.getComponent(i, c)
      part[i] = Math.round(ap.getComponent(i, 0))
    }
    procedural = { pos: p, part, count, index: g.index!.array as ArrayLike<number> }
  }
  return procedural
}

export interface SkinnedBody {
  /** Vertices in the table frame, three floats each: x across, h above the pad, d toward the feet from the root. */
  v: Float32Array
  /** The part (P.*) that has the most weight of each vertex. */
  parts: Uint8Array
  count: number
  /** The index buffer (triangles). */
  index: ArrayLike<number>
  /** Each part's origin (the joint) in the table frame: x, h, d. */
  joints: Float64Array
}

export class TestPatient {
  readonly rig: PersonRig
  readonly inp: RigInput
  readonly out = new Float32Array(PART_COUNT * 12)
  readonly body: Readonly<BodyDims>
  t = 0
  pose: PatientPoseView = { ...POSE0 }

  private constructor(
    readonly name: string,
    readonly avatar: AvatarEntry | null,
    readonly cpu: CpuMesh | null,
    readonly scale: number,
    readonly table: ProcTableId,
    readonly outfit: 'gown' | 'everyday' = 'gown',
  ) {
    const look = { ...lookFor({ id: 'patient', role: 'patient', outfit, variant: 5 }), scale }
    this.body = avatar ? avatar.body : NOMINAL_BODY
    this.rig = createRig(look, this.body)
    if (cpu && avatar) {
      const fit = measureLieFit(cpu.pos, cpu.joints, cpu.weights, cpu.count, avatar.bindInverse)
      if (fit) this.rig.dims.lie = fit
    }
    const T = TABLES[table]
    const inp = makeInput()
    inp.posture = 'lie'
    inp.mode = 'lie'
    inp.seatHeight = T.top
    inp.x = T.x
    inp.y = 0
    inp.z = T.z
    inp.heading = T.heading
    this.inp = inp
    this.apply()
    this.run(120)
  }

  /** A patient wearing `who` ('procedural' or an avatar) on `table`, level and supine, settled. `outfit`: in a gown (the procedural body's skirt hangs from the pelvis) or in everyday clothes. */
  static async make(who: AvatarEntry | 'procedural', table: ProcTableId, scale = 1, outfit: 'gown' | 'everyday' = 'gown'): Promise<TestPatient> {
    if (who === 'procedural') return new TestPatient('procedural', null, null, scale, table, outfit)
    return new TestPatient(who.id, who, await meshOf(who), scale, table, outfit)
  }

  /** Lie as `pose` says (fields left out are the plain level supine patient's). */
  setPose(pose: Partial<PatientPoseView> | null): void {
    this.pose = pose === null ? { ...POSE0, position: 'supine' } : { ...POSE0, ...pose }
    this.apply(pose === null)
  }

  private apply(none = false): void {
    writeTableInput(this.inp, 1, none ? null : this.pose)
    this.inp.tableSnap = false
  }

  run(frames: number, dt = 1 / 60): void {
    for (let i = 0; i < frames; i++) {
      this.t += dt
      this.inp.time = this.t
      this.inp.dt = dt
      solveRig(this.rig, this.inp, this.out, 0)
      this.inp.tableSnap = false
    }
  }

  /** Place every follower at once (a warm start). */
  snap(frames = 2): void {
    this.inp.tableSnap = true
    this.run(1)
    this.run(frames - 1)
  }

  /** The origin of part `part` in the table frame. */
  joint(part: number): [number, number, number] {
    const o = part * 12
    return [this.out[o + 3], this.out[o + 7] - this.inp.seatHeight, this.out[o + 11]]
  }

  /** The skinned body in the table frame, as the GPU would draw it now. */
  skin(): SkinnedBody {
    const rows = this.out.slice()
    const surf = this.inp.seatHeight
    const joints = new Float64Array(PART_COUNT * 3)
    for (let q = 0; q < PART_COUNT; q++) {
      joints[q * 3] = this.out[q * 12 + 3]
      joints[q * 3 + 1] = this.out[q * 12 + 7] - surf
      joints[q * 3 + 2] = this.out[q * 12 + 11]
    }
    if (this.avatar && this.cpu) {
      applyBinds(rows, 0, this.avatar.bindInverse)
      const s = skinAll(this.cpu, rows)
      const n = this.cpu.count
      const v = new Float32Array(n * 3)
      const parts = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        v[i * 3] = s[i * 3]
        v[i * 3 + 1] = s[i * 3 + 1] - surf
        v[i * 3 + 2] = s[i * 3 + 2]
        let best = 0
        let bw = -1
        for (let k = 0; k < 4; k++) {
          const w = this.cpu.weights[i * 4 + k]
          if (w > bw) {
            bw = w
            best = Math.round(this.cpu.joints[i * 4 + k])
          }
        }
        parts[i] = best
      }
      return { v, parts, count: n, index: this.cpu.index, joints }
    }
    const pm = proceduralMesh()
    const v = new Float32Array(pm.count * 3)
    for (let i = 0; i < pm.count; i++) {
      const o = pm.part[i] * 12
      const x = pm.pos[i * 3]
      const y = pm.pos[i * 3 + 1]
      const z = pm.pos[i * 3 + 2]
      v[i * 3] = rows[o] * x + rows[o + 1] * y + rows[o + 2] * z + rows[o + 3]
      v[i * 3 + 1] = rows[o + 4] * x + rows[o + 5] * y + rows[o + 6] * z + rows[o + 7] - surf
      v[i * 3 + 2] = rows[o + 8] * x + rows[o + 9] * y + rows[o + 10] * z + rows[o + 11]
    }
    return { v, parts: pm.part, count: pm.count, index: pm.index, joints }
  }
}

/** The lowest `h` (above the pad) of the vertices of the parts `which` (every part when omitted), and the highest. */
export function heightRange(b: SkinnedBody, which?: readonly number[]): { lo: number; hi: number } {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < b.count; i++) {
    if (which && !which.includes(b.parts[i])) continue
    const h = b.v[i * 3 + 1]
    if (h < lo) lo = h
    if (h > hi) hi = h
  }
  return { lo, hi }
}

export const TORSO = [P.pelvis, P.chest]
export const HEAD = [P.head, P.hairCap, P.hairBack, P.hairFront]
export const LEFT_ARM = [P.armL, P.foreL, P.handL]
export const RIGHT_ARM = [P.armR, P.foreR, P.handR]
export const LEGS = [P.thighL, P.shinL, P.footL, P.thighR, P.shinR, P.footR]
