// R5 wave 3 (agent J): a test kit, not shipped. The helpers the procedure stage's tests share: a patient of the crowd's test kit posed on a procedure table and skinned (the body as
// the GPU draws it), the skin as the stage takes it, the stage's triangles and the exact top of a set of triangles at a point.
import { AVATARS, TestPatient, type ProcTableId } from '@/scene/actors/crowd/procTable.testkit'
import type { PatientPoseView } from '@/sim/types'
import type { ProcMemory, ProcSkin } from './stage'

/**
 * The two bodies that wear a coat and a dress that rises 5 to 20 cm off the body (avatars.ts GOWN). The stage's tests used to leave them out; the ProSense patient is an outpatient
 * in everyday clothes, so they are in now, as every other avatar is: the field is fitted to the mesh as drawn, clothes and all, and the drapes lie over them.
 */
export const GARMENT = ['medical_male_05', 'female_adult_15']
export const SCALES = [0.94, 1, 1.06]
export const BODIES = AVATARS
export const ALL_BODIES = AVATARS
/** What the patient may wear: a gown, or everyday clothes (the ProSense outpatient, until the sim has her change into a gown). */
export const OUTFITS: readonly ('gown' | 'everyday')[] = ['gown', 'everyday']

/** A patient of avatar `who` (or the procedural body) on `table`, in `pose`, snapped there and settled (the arms and legs at rest), in a gown or in everyday clothes. */
export async function posedPatient(who: (typeof AVATARS)[number] | 'procedural', table: ProcTableId, pose: Partial<PatientPoseView>, scale = 1, outfit: 'gown' | 'everyday' = 'gown'): Promise<TestPatient> {
  const p = await TestPatient.make(who, table, scale, outfit)
  p.setPose(pose)
  p.snap(4)
  p.run(30)
  return p
}

/** The patient's skin as `stepProcStage` takes it. */
export function skinOf(tp: TestPatient, version = 1): ProcSkin {
  const b = tp.skin()
  return { v: b.v, index: b.index, tris: Math.floor(b.index.length / 3), version }
}

/** The triangles (x, h, z corners) of the given parts of the stage. */
export function partTris(mem: ProcMemory, part: number): Float32Array {
  const a = mem.parts[part * 2]
  const b = mem.parts[part * 2 + 1]
  const m = mem.mesh
  const tri = new Float32Array((b - a) * 3)
  for (let i = a; i < b; i++) {
    const v = m.idx[i] * 3
    tri[(i - a) * 3] = m.pos[v]
    tri[(i - a) * 3 + 1] = m.pos[v + 1]
    tri[(i - a) * 3 + 2] = m.pos[v + 2]
  }
  return tri
}

/** The exact top of triangles at (z, x): the highest of their surfaces there, -Infinity where none covers it. */
export function exactTop(tri: Float32Array, z: number, x: number): number {
  let best = -Infinity
  for (let t = 0; t + 8 < tri.length; t += 9) {
    const ax = tri[t], ah = tri[t + 1], az = tri[t + 2]
    const bx = tri[t + 3], bh = tri[t + 4], bz = tri[t + 5]
    const cx = tri[t + 6], ch = tri[t + 7], cz = tri[t + 8]
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(den) < 1e-14) continue
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den
    const l3 = 1 - l1 - l2
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
    const h = l1 * ah + l2 * bh + l3 * ch
    if (h > best) best = h
  }
  return best
}
