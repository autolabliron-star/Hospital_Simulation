/**
 * R3 "Real screens": the lower skeleton of the trunk: the lumbar and lower thoracic spine (T8 to the sacrum, with discs, the spinal canal,
 * the cord and the cauda equina) and the pelvis with the hips (iliac wings, acetabula, pubic and ischial rami, sacrum, femoral heads, necks
 * and upper shafts). Bones are a cortex (layer 20) round marrow (layer 21); discs layer 19; canal 22, cord 23. Same patient frame as
 * types.ts. Used by abdomen.ts; a radiograph of the pelvis and the lumbar MRI depend on these shapes most.
 */
import type { BodyBuilder, V3 } from '../body'
import type { PatientParams } from '../params'
import { tissue } from '../tissues'

const T = {
  cortical: tissue('cortical'),
  marrow: tissue('marrow'),
  disc: tissue('disc'),
  csf: tissue('csf'),
  nerve: tissue('nerve'),
}

export function boneBox(b: BodyBuilder, name: string, c: V3, half: V3, round: number, rot: V3 = [0, 0, 0], shell = 2): void {
  b.part(`${name}Cortex`, T.cortical, { layer: 20 }).box(c, half, round, rot)
  b.part(`${name}Marrow`, T.marrow, { layer: 21 }).box(c, [half[0] - shell, half[1] - shell, half[2] - shell], Math.max(0.5, round - shell), rot)
}

export function boneTube(b: BodyBuilder, name: string, pts: V3[], r: number, shell = 1.8): void {
  const c = b.part(`${name}Cortex`, T.cortical, { layer: 20 })
  const m = b.part(`${name}Marrow`, T.marrow, { layer: 21 })
  for (let i = 0; i + 1 < pts.length; i++) {
    c.capsule(pts[i], pts[i + 1], r)
    m.capsule(pts[i], pts[i + 1], Math.max(0.6, r - shell))
  }
}

/** The vertebral levels from S1 to T9 at their heights (mm, unscaled), and the front-back position of the body's centre. */
export const VERTEBRAE: [name: string, s: number, p: number][] = [
  ['S1', 70, 62],
  ['L5', 104, 52],
  ['L4', 140, 46],
  ['L3', 176, 44],
  ['L2', 211, 45],
  ['L1', 245, 47],
  ['T12', 277, 50],
  ['T11', 307, 54],
  ['T10', 335, 58],
  ['T9', 362, 61],
  ['T8', 388, 63],
]

/** The spine from the sacrum up to T8, discs, the spinal canal, the cord and the cauda equina. */
export function buildLumbarSpine(b: BodyBuilder, p: PatientParams): void {
  const H = p.height
  const D = p.depth
  for (let i = 0; i < VERTEBRAE.length; i++) {
    const [name, s0, p0] = VERTEBRAE[i]
    const s = s0 * H
    const pp = p0 * D
    const lumbar = s0 < 260
    const hw = lumbar ? 24 : 19
    const hd = lumbar ? 17 : 15
    const hh = name === 'S1' ? 14 : lumbar ? 12.5 : 11
    if (name === 'S1') {
      // the sacrum: a broad, backward-tilted wedge between the iliac wings
      boneBox(b, 'sacrum', [0, pp + 14, s - 22], [44, 18, 40], 8, [-24, 0, 0], 3)
    } else boneBox(b, `vert${name}`, [0, pp, s], [hw, hd, hh], 5)
    // the disc above it
    if (i + 1 < VERTEBRAE.length) {
      const [, s1, p1] = VERTEBRAE[i + 1]
      const mid = ((s0 + s1) / 2) * H
      const midP = ((p0 + p1) / 2) * D
      const top = name === 'S1' ? s + 18 : s + hh
      const t = Math.max(2.5, (s1 * H - (lumbar ? 12.5 : 11) - top) / 2)
      b.part(`disc${name}`, T.disc, { layer: 19 }).box([0, midP, mid], [hw - 1, hd - 1, t], 3)
    }
    if (name === 'S1') continue
    // the posterior arch: pedicles, laminae and the spinous process; the transverse processes
    const arch = b.part(`arch${name}Cortex`, T.cortical, { layer: 20 })
    const back = pp + hd
    for (const sd of [-1, 1]) {
      arch.capsule([sd * 13, back, s], [sd * 9, back + 20, s - 3], 4.5)
      arch.capsule([sd * 15, back + 4, s], [sd * (lumbar ? 46 : 34), back + 8, s + 2], lumbar ? 5 : 4)
    }
    arch.capsule([0, back + 22, s - 2], [0, back + (lumbar ? 48 : 42), s - (lumbar ? 6 : 14)], lumbar ? 6 : 4.5)
  }
  // the spinal canal, the cord down to the conus at L1-2 and the cauda equina below
  const canal = b.part('thecalSac', T.csf, { layer: 22 })
  const cord = b.part('cord', T.nerve, { layer: 23 })
  for (let i = 1; i + 1 < VERTEBRAE.length; i++) {
    const a = VERTEBRAE[i]
    const c = VERTEBRAE[i + 1]
    const pa: V3 = [0, (a[2] + (a[1] < 260 ? 17 : 15)) * D + 9, a[1] * H]
    const pc: V3 = [0, (c[2] + (c[1] < 260 ? 17 : 15)) * D + 9, c[1] * H]
    canal.capsule(pa, pc, 9)
    if (a[1] >= 225) cord.capsule(pa, pc, 4.6)
  }
  const sp = VERTEBRAE[1]
  for (const sd of [-1, 1]) for (const k of [2.5, 5]) cord.capsule([sd * k, (sp[2] + 17) * D + 10, sp[1] * H], [sd * k * 0.6, (VERTEBRAE[5][2] + 17) * D + 9, 230 * H], 0.9)
}


/** The pelvis and the hips. */
export function buildPelvis(b: BodyBuilder, p: PatientParams): void {
  const W = p.width
  const D = p.depth
  const H = p.height
  const at = (l: number, pp: number, s: number): V3 => [l * W, pp * D, s * H]
  for (const sd of [-1, 1] as const) {
    // the iliac wing: a thin curved plate, cortex round a little marrow
    boneBox(b, `ilium${sd}`, at(sd * 112, 42, 78), [12 * W, 48 * D, 50 * H], 10, [12, 0, sd * 18], 3)
    boneBox(b, `acetabulum${sd}`, at(sd * 96, 18, 12), [22, 28, 26], 12, [0, 0, 0], 3)
    // the femoral head and neck
    b.part(`femoralHead${sd}Cortex`, T.cortical, { layer: 20 }).sphere(at(sd * 96, 2, 0), 24)
    b.part(`femoralHead${sd}Marrow`, T.marrow, { layer: 21 }).sphere(at(sd * 96, 2, 0), 21.5)
    boneTube(b, `femoralNeck${sd}`, [at(sd * 96, 2, 0), at(sd * 128, 8, -32), at(sd * 138, 10, -80), at(sd * 136, 6, -150)], 16, 4)
    // the pubic ramus and the ischium
    boneTube(b, `pubis${sd}`, [at(sd * 82, 0, 0), at(sd * 36, -46, -18), at(sd * 6, -56, -22)], 9)
    boneTube(b, `ischium${sd}`, [at(sd * 88, 26, -8), at(sd * 70, 40, -52)], 11)
  }

}
