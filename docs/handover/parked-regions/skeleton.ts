/**
 * R3 "Real screens": the skeleton of the trunk: the spine from C7 to the sacrum and coccyx (vertebral bodies kidney-shaped in section with a
 * cortical rim over trabecular marrow, pedicles, laminae, articular facets, spinous and transverse processes sized per level, discs, the
 * spinal canal with epidural fat, thecal sac and cord) and the pelvis with the hips (iliac wings, acetabular cups holding the femoral heads
 * across a joint space of cartilage, obturator foramina, pubic symphysis, ischial spines and tuberosities, sacrum with alae and foramina,
 * the proximal femora with neck, trochanters and a shaft of cortex round yellow marrow). Bones are a cortex (layer 20) round marrow
 * (layer 21); discs and cartilage layer 19; epidural fat 21; canal 22, cord 23. Same patient frame as types.ts. Used by abdomen.ts (S1 up to
 * T8) and thorax.ts (T7 up to C7); a radiograph of the pelvis and the lumbar MRI depend on these shapes most.
 */
import type { BodyBuilder, PartBuilder, V3 } from '../body'
import type { PatientParams } from '../params'
import { tissue } from '../tissues'

const T = {
  cortical: tissue('cortical'),
  marrow: tissue('marrow'),
  yellow: tissue('yellowMarrow'),
  disc: tissue('disc'),
  cartilage: tissue('cartilage'),
  fat: tissue('fat'),
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

/** A bone from one shape drawn twice: the cortex, and the marrow inside it (the same shape pulled in by `shell`). */
function shelled(b: BodyBuilder, name: string, shell: number, shape: (part: PartBuilder, inset: number) => void, marrow = T.marrow): void {
  shape(b.part(`${name}Cortex`, T.cortical, { layer: 20 }), 0)
  shape(b.part(`${name}Marrow`, marrow, { layer: 21 }), shell)
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

/** The upper spine above T8 (thorax.ts builds it): T7 down to C7 (the head region's own neck takes over above), kyphosis peaking at T6-T7. */
export const UPPER_SPINE: [name: string, s: number, p: number][] = [
  ['T7', 415, 64],
  ['T6', 444, 63],
  ['T5', 474, 61],
  ['T4', 506, 58],
  ['T3', 540, 54],
  ['T2', 576, 49],
  ['T1', 612, 44],
  ['C7', 648, 40],
]

/** The depth of the skin at the back (P, unscaled) along the trunk: the spinous processes must stay under it (a copy of abdomen.ts OUTLINE). */
const BACK: [s: number, b: number][] = [
  [-140, 112],
  [0, 118],
  [110, 112],
  [200, 106],
  [300, 112],
  [420, 122],
  [520, 128],
  [600, 120],
  [680, 88],
]

function backSkin(p: PatientParams, s: number): number {
  const z = s / p.height
  let k = 0
  while (k < BACK.length - 2 && BACK[k + 1][0] < z) k++
  const t = Math.max(0, Math.min(1, (z - BACK[k][0]) / (BACK[k + 1][0] - BACK[k][0])))
  return (BACK[k][1] + (BACK[k + 1][1] - BACK[k][1]) * t) * p.depth
}

/** Per level: body half-width, half-depth, half-height; canal depth (AP); pedicle radius; transverse process reach (|x| of the tip); spinous length and drop. */
type Dim = [hw: number, hd: number, hh: number, cd: number, pr: number, tp: number, sp: number, drop: number]
const DIMS: Record<string, Dim> = {
  L5: [26, 18, 12.5, 17, 5.2, 48, 14, 2],
  L4: [25.5, 17.5, 12.5, 17, 4.9, 48, 15, 3],
  L3: [25, 17, 12.5, 16, 4.6, 48, 15, 3],
  L2: [24, 17, 12.5, 16, 4.4, 45, 15, 4],
  L1: [23, 16.5, 12.5, 15.5, 4.2, 40, 15, 6],
  T12: [22.5, 16, 12, 15, 4, 34, 14, 10],
  T11: [21.5, 16, 12, 14.5, 3.8, 33, 14, 14],
  T10: [20.5, 15.5, 11.5, 14, 3.6, 35, 14, 17],
  T9: [19.5, 15, 11, 14, 3.5, 36, 14, 19],
  T8: [19, 15, 11, 14, 3.4, 37, 14, 21],
  T7: [18, 14.5, 11, 13.5, 3.3, 37, 14, 21],
  T6: [17.5, 14, 11, 13.5, 3.2, 37, 14, 21],
  T5: [17, 14, 11, 13, 3.1, 36, 14, 21],
  T4: [16.5, 13.5, 11, 13, 3, 35, 14, 20],
  T3: [16, 13, 11, 13, 3, 34, 13, 18],
  T2: [15.5, 12.5, 11.5, 13, 3, 33, 12, 14],
  T1: [15.5, 12.5, 12, 13.5, 3.1, 31, 12, 8],
  C7: [14.5, 11, 11, 14, 3, 26, 14, 0],
}

/** The size of a vertebra's parts (mm): body half-width, half-depth, half-height, canal depth and the transverse process's reach (thorax.ts hangs the ribs on them). */
export function levelDims(name: string): { hw: number; hd: number; hh: number; cd: number; tp: number } {
  const d = DIMS[name]
  return { hw: d[0], hd: d[1], hh: d[2], cd: d[3], tp: d[5] }
}

/** A vertebral body: an elliptic cylinder, its back concave round the canal (the kidney shape), its sides waisted and its front a little concave. */
function bodyShape(part: PartBuilder, inset: number, c: V3, hw: number, hd: number, hh: number, thoracic: boolean): void {
  const [, y, z] = c
  const v = inset * 1.4
  part.taper(0, y, z - hh + v, z + hh - v, hw - inset, hd - inset, hw - inset, hd - inset)
  // the posterior notch (the canal side), the lateral waist and the anterior concavity are cut out of it
  part.minus()
  const rn = thoracic ? 7 : 9
  const dn = thoracic ? 1.8 : 2.8
  part.capsule([0, y + hd + rn - dn, z - hh - 3], [0, y + hd + rn - dn, z + hh + 3], rn + inset)
  const rw = hh * 1.1
  for (const sd of [-1, 1]) part.capsule([sd * (hw + rw - 1.4), y - hd - 6, z], [sd * (hw + rw - 1.4), y + hd + 6, z], rw + inset)
  const ra = hh
  part.capsule([-hw - 6, y - hd - ra + 1.4, z], [hw + 6, y - hd - ra + 1.4, z], ra + inset)
  part.plus()
}

/** One vertebra at a centre (scaled mm): body, arch, processes. `backMax` is the deepest P the spinous tip may reach. `gap` is the pitch to the next vertebra above. */
function vertebra(b: BodyBuilder, name: string, c: V3, d: Dim, backMax: number, pitch: number): void {
  const [hw, hd, hh, cd, pr, tpx, sp, drop] = d
  const [, y, z] = c
  const thoracic = name[0] === 'T' || name[0] === 'C'
  const lumbar = name[0] === 'L'
  shelled(b, `vert${name}`, 2.3, (part, k) => bodyShape(part, k, c, hw, hd, hh, thoracic))
  // the posterior arch: pedicles run back from the body's upper back corners to the laminae, which meet in the spinous process
  const cw = cd / 2
  const px = cw + pr - 0.8
  const yb = y + hd + cd
  const lt = lumbar ? 2.8 : 2.4
  const lamH = lumbar ? 9.5 : 8
  const arch = b.part(`arch${name}Cortex`, T.cortical, { layer: 20 })
  const core = b.part(`arch${name}Marrow`, T.marrow, { layer: 21 })
  const rise = lumbar ? 11 : 8
  const lamAng = (Math.atan2(rise, px - 1.5) * 180) / Math.PI
  const lamLen = Math.hypot(px - 1.5, rise) / 2 + 1.5
  for (const sd of [-1, 1] as const) {
    // pedicle
    arch.capsule([sd * px, y + hd - 4, z + 2], [sd * px, yb - 1, z + 2], pr)
    core.capsule([sd * px, y + hd - 4, z + 2], [sd * px, yb - 1, z + 2], Math.max(0.8, pr - 1.7))
    // lamina: a flat plate from the pedicle's end, back and inward to the midline
    const lc: V3 = [sd * (px + 1.5) * 0.5, yb - 3 + rise / 2, z]
    arch.ellipsoid(lc, [lamLen, lt, lamH], [0, 0, -sd * lamAng])
    core.ellipsoid(lc, [lamLen - 1.4, Math.max(0.8, lt - 1.5), lamH - 1.5], [0, 0, -sd * lamAng])
    // transverse process (thoracic ones also carry the rib's tubercle)
    const tipY = lumbar ? yb - 9 : yb + 1
    const r0 = lumbar ? pr + 0.8 : pr + 0.4
    const r1 = lumbar ? 2.9 : 3.2
    arch.cone([sd * (px - 1), yb - 7, z + 1.5], [sd * tpx, tipY, z + 1.5], r0, r1)
    core.cone([sd * (px - 1), yb - 7, z + 1.5], [sd * (tpx - 3), tipY, z + 1.5], Math.max(0.8, r0 - 1.6), Math.max(0.8, r1 - 1.6))
    // articular processes: the superior rises from the pedicle's end, the inferior hangs from the lamina (the facet joint is between them)
    const reach = Math.min(pitch * 0.5, 19)
    arch.capsule([sd * (cw + 8.2), yb - 6, z + 7], [sd * (cw + 8.2), yb - 4, z + reach], 3)
    arch.capsule([sd * (cw + 1.2), yb + 1, z - 7], [sd * (cw + 1.2), yb + 3, z - reach - 3], 3)
  }
  // the spinous process: a tall plate pointing back in the lumbar spine, a slender rod sloping down in the thoracic
  const yr = yb - 3 + rise
  const room = Math.max(5, backMax - yr)
  const len = Math.min(sp, room)
  if (lumbar || drop < 10) {
    arch.ellipsoid([0, yr + len / 2 - 1, z - drop * 0.3], [3.4, len / 2 + 1, 10], [0, 0, 0])
    core.ellipsoid([0, yr + len / 2 - 1, z - drop * 0.3], [1.6, Math.max(1, len / 2 - 1), 8.2], [0, 0, 0])
  } else {
    arch.cone([0, yr - 1, z + 2], [0, yr + len, z - drop - 6], 3.8, 2.6)
    core.cone([0, yr - 1, z + 2], [0, yr + len - 2, z - drop - 4], 1.8, 1.0)
  }
}

/** The disc between a vertebra and the next one up: a slab filling the gap, its rim bulging a little past the bodies. */
function discBetween(b: BodyBuilder, name: string, c: V3, hw: number, hd: number, z0: number, z1: number): void {
  const zc = (z0 + z1) / 2
  const t = Math.max(1.2, (z1 - z0) / 2)
  b.part(`disc${name}`, T.disc, { layer: 19 })
    .taper(0, c[1], z0 - 0.4, z1 + 0.4, hw - 0.5, hd - 0.5, hw - 0.5, hd - 0.5)
    .ellipsoid([0, c[1], zc], [hw + 1.6, hd + 1.6, t * 0.62])
}

/** The spinal canal of a run of levels: epidural fat, the thecal sac, and the cord (to the conus at L1-2, the cauda equina below). */
function canalRun(b: BodyBuilder, p: PatientParams, levels: { name: string; c: V3; hd: number; cd: number }[], conus: boolean): void {
  const fat = b.part(`epiduralFat${levels[0].name}`, T.fat, { layer: 21 })
  const sac = b.part(`thecalSac${levels[0].name}`, T.csf, { layer: 22 })
  const cord = b.part(`cord${levels[0].name}`, T.nerve, { layer: 23 })
  const pt = (l: { c: V3; hd: number; cd: number }): V3 => [0, l.c[1] + l.hd + l.cd / 2, l.c[2]]
  const rc = (l: { cd: number }): number => l.cd / 2
  for (let i = 0; i + 1 < levels.length; i++) {
    const a = levels[i]
    const c = levels[i + 1]
    const thoracic = a.c[2] > 260 * p.height
    fat.cone(pt(a), pt(c), rc(a) + 0.3, rc(c) + 0.3)
    fat.cone([0, pt(a)[1] + 3.5, pt(a)[2]], [0, pt(c)[1] + 3.5, pt(c)[2]], rc(a) - 1, rc(c) - 1)
    sac.cone(pt(a), pt(c), rc(a) - (thoracic ? 1.3 : 1.6), rc(c) - (thoracic ? 1.3 : 1.6))
    if (!conus || a.c[2] >= 225 * p.height) cord.cone(pt(a), pt(c), thoracic ? 4.2 : 4.6, thoracic ? 4.2 : 4.6)
  }
}

/** The sacrum and the coccyx: a curved wedge with alae, four pairs of foramina, a canal, and the joints to the iliac wings. */
function sacrum(b: BodyBuilder, p: PatientParams): void {
  const W = p.width
  const D = p.depth
  const H = p.height
  const at = (l: number, pp: number, s: number): V3 => [l * W, pp * D, s * H]
  // the curve of the sacrum (S, P of the centre of its body) and the half thickness of the body
  const Q: [number, number, number][] = [
    [84, 62, 17],
    [52, 76, 15],
    [18, 89, 12],
    [-18, 96, 9],
    [-48, 97, 6],
  ]
  const ang = (i: number): number => {
    const [s0, p0] = Q[i]
    const [s1, p1] = Q[i + 1]
    return (Math.atan2(p1 - p0, s0 - s1) * 180) / Math.PI
  }
  const bodyW = [27, 25, 20, 15]
  const wall = b.part('sacrumCortex', T.cortical, { layer: 20, smooth: 4 })
  const mar = b.part('sacrumMarrow', T.marrow, { layer: 21, smooth: 4 })
  for (let i = 0; i < 4; i++) {
    const [s0, p0, h0] = Q[i]
    const [s1, p1, h1] = Q[i + 1]
    const c = at(0, (p0 + p1) / 2, (s0 + s1) / 2)
    const len = Math.hypot(s0 - s1, p0 - p1) / 2 + 1
    const h = (h0 + h1) / 2
    wall.box(c, [bodyW[i] * 0.98, h, len], 6, [ang(i), 0, 0])
    mar.box(c, [bodyW[i] * 0.98 - 2.2, h - 2.2, len - 2.2], 4, [ang(i), 0, 0])
  }
  // the posterior wall behind the canal (fused laminae, the median crest) and the lateral masses with the foramina between their bars
  const post = b.part('sacrumPostCortex', T.cortical, { layer: 20, smooth: 3 })
  const postM = b.part('sacrumPostMarrow', T.marrow, { layer: 21, smooth: 3 })
  const canalAP = [18, 13, 9, 5]
  for (let i = 0; i < 4; i++) {
    const [s0, p0, h0] = Q[i]
    const [s1, p1, h1] = Q[i + 1]
    const pc = (p0 + h0 + canalAP[i] + 4 + p1 + h1 + canalAP[Math.min(3, i + 1)] + 4) / 2
    const c = at(0, pc, (s0 + s1) / 2)
    const len = Math.hypot(s0 - s1, p0 - p1) / 2
    post.box(c, [bodyW[i] * 0.7, 4, len], 3, [ang(i), 0, 0])
    postM.box(c, [bodyW[i] * 0.7 - 1.6, 2.4, len - 1.6], 2, [ang(i), 0, 0])
  }
  for (const sd of [-1, 1] as const) {
    // the ala: the wide upper lateral mass that meets the ilium
    wall.ellipsoid(at(sd * 42, 70, 66), [27 * W, 25 * D, 18 * H], [0, 0, sd * 12])
    mar.ellipsoid(at(sd * 42, 70, 66), [27 * W - 2.2, 25 * D - 2.2, 18 * H - 2.2], [0, 0, sd * 12])
    // the lateral columns of S2-S4 and the bars between the foramina
    const lat = b.part(`sacrumLat${sd}Cortex`, T.cortical, { layer: 20, smooth: 2 })
    const latM = b.part(`sacrumLat${sd}Marrow`, T.marrow, { layer: 21, smooth: 2 })
    const pts: V3[] = [at(sd * 38, 78, 40), at(sd * 33, 88, 14), at(sd * 25, 94, -14), at(sd * 17, 97, -40)]
    for (let i = 0; i + 1 < pts.length; i++) {
      lat.capsule(pts[i], pts[i + 1], 7.5 - i)
      latM.capsule(pts[i], pts[i + 1], 5.5 - i)
    }
    for (const [s, w] of [[48, 40], [20, 31], [-8, 23], [-34, 16]] as [number, number][]) {
      const idx = Math.max(0, Math.min(3, Math.round((84 - s) / 33)))
      const py = Q[idx][1] + 2
      lat.capsule(at(sd * 8, py, s), at(sd * w, py + 6, s), 3.4)
      latM.capsule(at(sd * 8, py, s), at(sd * w - sd * 1, py + 6, s), 1.8)
    }
  }
  // the sacral canal: nerve roots in CSF to S2 and the tapering sac, fat beyond
  const canal = b.part('sacralCanal', T.csf, { layer: 22 })
  const cf = b.part('sacralCanalFat', T.fat, { layer: 21 })
  let prev: V3 | null = null
  for (let i = 0; i < 4; i++) {
    const [s0, p0, h0] = Q[i]
    const pc = at(0, p0 + h0 + canalAP[i] / 2, s0)
    if (prev) {
      cf.cone(prev, pc, canalAP[i - 1] / 2 + 0.3, canalAP[i] / 2 + 0.3)
      if (i <= 2) canal.cone(prev, pc, canalAP[i - 1] / 2 - 1.4, canalAP[i] / 2 - 1.4)
    }
    prev = pc
  }
  // the coccyx: three small segments curling forward
  const cx: V3[] = [at(0, 97, -48), at(0, 98, -60), at(0, 94, -70), at(0, 88, -76)]
  boneTube(b, 'coccyx', cx, 6, 1.6)
}

/** The spine from the sacrum up to T8, discs, the spinal canal, the cord and the cauda equina. */
export function buildLumbarSpine(b: BodyBuilder, p: PatientParams): void {
  const H = p.height
  const D = p.depth
  sacrum(b, p)
  const run: { name: string; c: V3; hd: number; cd: number }[] = []
  for (let i = 1; i < VERTEBRAE.length; i++) {
    const [name, s0, p0] = VERTEBRAE[i]
    const d = DIMS[name]
    const c: V3 = [0, p0 * D, s0 * H]
    const next = VERTEBRAE[i + 1]
    const pitch = next ? (next[1] - s0) * H : 27 * H
    vertebra(b, name, c, d, backSkin(p, s0 * H) - 12, pitch)
    run.push({ name, c, hd: d[1], cd: d[3] })
  }
  // the discs: L5-S1 (between the sacral base and L5), then each level up to T9-T8
  const l5 = VERTEBRAE[1]
  b.part('discS1', T.disc, { layer: 19 })
    .taper(0, (l5[2] + 5) * D, (l5[1] - DIMS.L5[2]) * H - 10.5, (l5[1] - DIMS.L5[2]) * H + 0.4, 25, 18, 25, 18)
    .ellipsoid([0, (l5[2] + 5) * D, (l5[1] - DIMS.L5[2]) * H - 5], [27, 19.5, 5])
  for (let i = 1; i + 1 < VERTEBRAE.length; i++) {
    const [name, s0, p0] = VERTEBRAE[i]
    const [, s1, p1] = VERTEBRAE[i + 1]
    const d0 = DIMS[name]
    const d1 = DIMS[VERTEBRAE[i + 1][0]]
    const z0 = s0 * H + d0[2]
    const z1 = s1 * H - d1[2]
    discBetween(b, `${name}`, [0, ((p0 + p1) / 2) * D, 0], (d0[0] + d1[0]) / 2, (d0[1] + d1[1]) / 2, z0, z1)
  }
  // the canal: from the sacral hiatus to T8 (the thoracic part continues in buildUpperSpine)
  canalRun(b, p, run, true)
  // the cauda equina below the conus: rootlets in the sac down to S2
  const cauda = b.part('caudaEquina', T.nerve, { layer: 23 })
  const sp = run[0]
  const top = run[4]
  for (const sd of [-1, 1]) for (const k of [2.5, 5]) cauda.capsule([sd * k, sp.c[1] + sp.hd + 8, sp.c[2]], [sd * k * 0.6, top.c[1] + top.hd + 8, 230 * H], 0.9)
}

/** T7 up to C7 with their discs, and the canal and cord running on from T8. Built by thorax.ts. */
export function buildUpperSpine(b: BodyBuilder, p: PatientParams): void {
  const H = p.height
  const D = p.depth
  const levels = [VERTEBRAE[VERTEBRAE.length - 1], ...UPPER_SPINE]
  const run: { name: string; c: V3; hd: number; cd: number }[] = []
  for (let i = 0; i < levels.length; i++) {
    const [name, s0, p0] = levels[i]
    const d = DIMS[name]
    const c: V3 = [0, p0 * D, s0 * H]
    if (i > 0) {
      const next = levels[i + 1]
      const pitch = next ? (next[1] - s0) * H : 30 * H
      vertebra(b, name, c, d, backSkin(p, s0 * H) - 12, pitch)
    }
    run.push({ name, c, hd: d[1], cd: d[3] })
  }
  for (let i = 0; i + 1 < levels.length; i++) {
    const [name, s0, p0] = levels[i]
    const [n1, s1, p1] = levels[i + 1]
    const d0 = DIMS[name]
    const d1 = DIMS[n1]
    discBetween(b, name, [0, ((p0 + p1) / 2) * D, 0], (d0[0] + d1[0]) / 2, (d0[1] + d1[1]) / 2, s0 * H + d0[2], s1 * H - d1[2])
  }
  canalRun(b, p, run, false)
}

/** The pelvis and the hips. */
export function buildPelvis(b: BodyBuilder, p: PatientParams): void {
  const W = p.width
  const D = p.depth
  const H = p.height
  const at = (l: number, pp: number, s: number): V3 => [l * W, pp * D, s * H]
  for (const sd of [-1, 1] as const) {
    // the iliac wing: thin curved plates fanning from the acetabular roof to the crest (a thicker crest), concave toward the front
    const crest: V3[] = [at(sd * 50, 62, 112), at(sd * 92, 52, 128), at(sd * 132, 26, 134), at(sd * 150, -8, 128), at(sd * 138, -48, 112), at(sd * 108, -82, 96)]
    const root: V3[] = [at(sd * 56, 56, 62), at(sd * 80, 46, 40), at(sd * 92, 30, 26), at(sd * 98, 8, 22), at(sd * 98, -20, 24), at(sd * 98, -50, 28)]
    const wc = b.part(`ilium${sd}Cortex`, T.cortical, { layer: 20, smooth: 3 })
    const wm = b.part(`ilium${sd}Marrow`, T.marrow, { layer: 21, smooth: 2 })
    const cr = b.part(`iliacCrest${sd}Cortex`, T.cortical, { layer: 20 })
    const crm = b.part(`iliacCrest${sd}Marrow`, T.marrow, { layer: 21 })
    for (let i = 0; i < crest.length; i++) {
      const a = root[i]
      const e = crest[i]
      const m: V3 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2, (a[2] + e[2]) / 2]
      const long: V3 = [e[0] - a[0], e[1] - a[1], e[2] - a[2]]
      // along the arc: the neighbouring blade's crest point
      const nb = crest[Math.min(crest.length - 1, i + 1)]
      const pb = crest[Math.max(0, i - 1)]
      const tang: V3 = [nb[0] - pb[0], nb[1] - pb[1], nb[2] - pb[2]]
      const R = basisFrame(long, tang)
      const half = Math.hypot(long[0], long[1], long[2]) / 2 + 2
      const arc = Math.hypot(tang[0], tang[1], tang[2]) / 2 * 0.95 + 3
      wc.ellipsoid(m, [half, arc, 4.2], R)
      wm.ellipsoid(m, [half - 2, arc - 2, 1.6], R)
      if (i + 1 < crest.length) {
        cr.capsule(e, crest[i + 1], 4.4)
        crm.capsule(e, crest[i + 1], 2.4)
      }
    }
    // the iliac body above the acetabulum and the posterior inferior part down to the ischial spine (the greater sciatic notch between)
    shelled(b, `iliacBody${sd}`, 2.6, (part, k) => {
      part.ellipsoid(at(sd * 90, 18, 28), [17 - k, 34 - k, 24 - k])
      part.ellipsoid(at(sd * 74, 44, 38), [14 - k, 16 - k, 24 - k], [0, 0, sd * 20])
    })
    // the acetabular cup: a shell round the head, open to the side, forward and down; a joint space of cartilage between it and the head
    const hc = at(sd * 96, 2, 0)
    const open = unit3([sd * 0.74, -0.32, -0.6])
    const cupNet = cupMembers(hc, open)
    const cupC = b.part(`acetabulum${sd}Cortex`, T.cortical, { layer: 20, smooth: 3 })
    const cupM = b.part(`acetabulum${sd}Marrow`, T.marrow, { layer: 21, smooth: 3 })
    for (const [a0, a1] of cupNet) {
      cupC.capsule(a0, a1, 7)
      cupM.capsule(a0, a1, 5.2)
    }
    b.part(`hipCartilage${sd}`, T.cartilage, { layer: 19 }).sphere(hc, 27.4)
    // the ischium: the posterior column to the tuberosity, the ischial spine pointing in, the ramus going forward to meet the pubis
    const isc = b.part(`ischium${sd}Cortex`, T.cortical, { layer: 20, smooth: 3 })
    const ism = b.part(`ischium${sd}Marrow`, T.marrow, { layer: 21, smooth: 2 })
    const ip: V3[] = [at(sd * 84, 24, -16), at(sd * 74, 38, -40), at(sd * 68, 44, -62)]
    for (let i = 0; i + 1 < ip.length; i++) {
      isc.capsule(ip[i], ip[i + 1], 11.5)
      ism.capsule(ip[i], ip[i + 1], 8.5)
    }
    isc.ellipsoid(at(sd * 66, 44, -66), [15, 13, 10])
    ism.ellipsoid(at(sd * 66, 44, -66), [12.5, 10.5, 7.5])
    isc.cone(at(sd * 80, 34, -12), at(sd * 64, 40, -6), 6, 2)
    ism.cone(at(sd * 80, 34, -12), at(sd * 68, 39, -8), 3.5, 1)
    // the pubis and the obturator foramen: a ring of bone round an oval hole (superior ramus, body, inferior ramus, ischial ramus)
    const ring: V3[] = [at(sd * 80, 6, -14), at(sd * 62, -30, -10), at(sd * 36, -54, -10), at(sd * 14, -62, -14), at(sd * 22, -56, -40), at(sd * 38, -42, -62), at(sd * 54, -14, -72), at(sd * 66, 22, -66)]
    boneTube(b, `pubisRing${sd}`, ring, 8, 2)
    // the ischial tuberosity joins the ring at its bottom; the ring's rear (the ischium) was drawn above
    b.part(`pubicBody${sd}Cortex`, T.cortical, { layer: 20 }).ellipsoid(at(sd * 13, -60, -16), [11, 9, 17])
    b.part(`pubicBody${sd}Marrow`, T.marrow, { layer: 21 }).ellipsoid(at(sd * 13, -60, -16), [8.8, 6.8, 14.8])
    // the femur: head, neck, greater and lesser trochanters, and the shaft (cortex round yellow marrow)
    femur(b, p, sd)
  }
  // the pubic symphysis: a fibrocartilage disc between the two pubic bodies
  b.part('pubicSymphysis', T.cartilage, { layer: 19 }).ellipsoid(at(0, -60, -16), [4.5, 9, 17])
  // the sacroiliac joints: cartilage between the sacral ala and the iliac wing
  for (const sd of [-1, 1] as const) b.part(`sacroiliac${sd}`, T.cartilage, { layer: 19 }).ellipsoid(at(sd * 62, 66, 68), [3.4 * W, 22 * D, 26 * H], [0, 0, sd * 12])
}

/** The acetabular cup as a net of fat tubes round the head (a hemisphere open toward `open`): meridians and the rim, no subtracted shapes (a radiograph must see it). */
function cupMembers(hc: V3, open: V3): [V3, V3][] {
  const R = basisFrame([-open[0], -open[1], -open[2]], [0, 1, 0])
  const dirAt = (polar: number, az: number): V3 => {
    const lx = Math.cos(polar)
    const ly = Math.sin(polar) * Math.cos(az)
    const lz = Math.sin(polar) * Math.sin(az)
    return [R[0] * lx + R[1] * ly + R[2] * lz, R[3] * lx + R[4] * ly + R[5] * lz, R[6] * lx + R[7] * ly + R[8] * lz]
  }
  const rad = 34.5
  const pt = (polar: number, az: number): V3 => {
    const d = dirAt(polar, az)
    return [hc[0] + d[0] * rad, hc[1] + d[1] * rad, hc[2] + d[2] * rad]
  }
  const out: [V3, V3][] = []
  const n = 8
  const rim = (80 * Math.PI) / 180
  for (let k = 0; k < n; k++) {
    const az = (2 * Math.PI * k) / n
    out.push([pt(0, 0), pt(rim / 2, az)], [pt(rim / 2, az), pt(rim, az)], [pt(rim, az), pt(rim, az + (2 * Math.PI) / n)])
  }
  return out
}

function unit3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** A rotation matrix (row-major, local -> world) with local x along `ex`, local y as near to `ey` as is perpendicular to it. */
function basisFrame(ex: V3, ey: V3): number[] {
  const x = unit3(ex)
  const d = ey[0] * x[0] + ey[1] * x[1] + ey[2] * x[2]
  const y = unit3([ey[0] - x[0] * d, ey[1] - x[1] * d, ey[2] - x[2] * d])
  const z: V3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]
}

/** The proximal femur: the head sits in the acetabulum at L +-96, P 2, S 0. */
function femur(b: BodyBuilder, p: PatientParams, sd: -1 | 1): void {
  const W = p.width
  const D = p.depth
  const H = p.height
  const at = (l: number, pp: number, s: number): V3 => [l * W, pp * D, s * H]
  const hc = at(sd * 96, 2, 0)
  // the head and neck: neck-shaft angle about 125 degrees, a little anteversion
  const axis = unit3([sd * 0.8, 0.2, -0.57])
  const nk: V3 = [hc[0] + axis[0] * 56, hc[1] + axis[1] * 56, hc[2] + axis[2] * 56]
  shelled(b, `femoralHead${sd}`, 1.8, (part, k) => {
    part.sphere(hc, 24 - k)
    part.cone([hc[0] + axis[0] * 14, hc[1] + axis[1] * 14, hc[2] + axis[2] * 14], nk, 14 - k, 16.5 - k)
  })
  // the greater trochanter on top of the shaft, the lesser behind and below
  shelled(b, `trochanter${sd}`, 2, (part, k) => {
    part.ellipsoid(at(sd * 150, 12, -22), [15 - k, 22 - k, 28 - k], [0, 0, 0])
  })
  shelled(b, `lesserTrochanter${sd}`, 1.6, (part, k) => {
    part.cone(at(sd * 134, 14, -66), at(sd * 124, 28, -76), 8 - k, 4.5 - k)
  })
  // the shaft: a tube of cortex round the medullary canal of yellow marrow, from the trochanters down to where the body's outline ends
  const s0 = at(sd * 142, 10, -36)
  const s1 = at(sd * 140, 8, -128)
  b.part(`femoralShaft${sd}Cortex`, T.cortical, { layer: 20 }).cone(s0, s1, 17, 15)
  b.part(`femoralShaft${sd}Marrow`, T.marrow, { layer: 21 }).cone(s0, at(sd * 141, 9, -64), 12.5, 11)
  b.part(`femoralShaft${sd}Yellow`, T.yellow, { layer: 21 }).cone(at(sd * 141, 9, -62), s1, 11, 9.5)
}
