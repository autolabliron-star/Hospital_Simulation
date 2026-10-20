/**
 * R3 "Real screens": the trunk from the upper thighs to the lung bases, the region of the abdominal and renal ultrasound, CT of the abdomen
 * and pelvis, the lumbar MRI axials and the pelvis radiograph. Built from the patient's parameters (params.ts) into a body.ts builder.
 *
 * Layers (a higher layer wins where parts overlap):
 *   1 fat outline (the skin)   2 abdominal wall muscle   3 visceral fat (the cavity)   4-6 gut: walls, contents, gas
 *   6 lung bases   7 solid organs   8-12 kidneys (perirenal fat, cortex, pyramids, sinus, pelvis)   13-15 gallbladder (wall, bile, stone)
 *   16-17 vessels (wall, lumen)   18 retroperitoneal muscles   19-21 bone (discs, cortex, marrow)   22-23 spinal canal   24-25 bladder
 */
import { mixSeed, mulberry32 } from '@/sim/rng'
import { basisMatrix, type BodyBuilder, type V3 } from '../body'
import type { KidneyParams, PatientParams } from '../params'
import { tissue } from '../tissues'
import { boneTube, buildLumbarSpine, buildPelvis } from './skeleton'
export { VERTEBRAE } from './skeleton'

const T = {
  fat: tissue('fat'),
  muscle: tissue('muscle'),
  visceral: tissue('visceralFat'),
  liver: tissue('liver'),
  bile: tissue('bile'),
  gbWall: tissue('gbWall'),
  cortex: tissue('kidneyCortex'),
  medulla: tissue('kidneyMedulla'),
  sinus: tissue('sinusFat'),
  urine: tissue('urine'),
  perirenal: tissue('perirenalFat'),
  spleen: tissue('spleen'),
  pancreas: tissue('pancreas'),
  gutWall: tissue('gutWall'),
  gutFluid: tissue('gutFluid'),
  gas: tissue('gas'),
  stool: tissue('stool'),
  blood: tissue('blood'),
  vesselWall: tissue('vesselWall'),
  cortical: tissue('cortical'),
  marrow: tissue('marrow'),
  disc: tissue('disc'),
  csf: tissue('csf'),
  nerve: tissue('nerve'),
  bladderWall: tissue('bladderWall'),
  lung: tissue('lung'),
  stone: tissue('stone'),
  psoas: tissue('psoas'),
  adrenal: tissue('adrenal'),
  pelvicOrgan: tissue('pelvicOrgan'),
  calcification: tissue('calcification'),
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** The trunk outline's half-width (L) and half-depth (P) at a height S, before the build scale: the shape the wall and the ribs follow. */
const OUTLINE: [s: number, a: number, b: number][] = [
  [-140, 170, 112],
  [0, 182, 118],
  [110, 168, 112],
  [200, 150, 106],
  [300, 156, 112],
  [420, 165, 122],
  [520, 168, 128],
  [600, 172, 120],
  [680, 150, 88],
]

/** Half-width and half-depth of the outline at height `s` (mm, already in the scaled frame), interpolated. */
export function outlineAt(p: PatientParams, s: number): [number, number] {
  const z = s / p.height
  let k = 0
  while (k < OUTLINE.length - 2 && OUTLINE[k + 1][0] < z) k++
  const [z0, a0, b0] = OUTLINE[k]
  const [z1, a1, b1] = OUTLINE[k + 1]
  const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)))
  return [(a0 + (a1 - a0) * t) * p.width, (b0 + (b1 - b0) * t) * p.depth]
}

/** The body envelope as stacked tapered elliptic cylinders, inset by `inset` mm all round. */
function envelope(b: BodyBuilder, name: string, t: number, layer: number, p: PatientParams, inset: number, insetBack = inset): void {
  const part = b.part(name, t, { layer, smooth: 20, outline: layer === 1 })
  for (let k = 0; k + 1 < OUTLINE.length; k++) {
    const [z0, a0, b0] = OUTLINE[k]
    const [z1, a1, b1] = OUTLINE[k + 1]
    // the front edge sits `inset` in from the belly and the back edge `insetBack` in from the back
    const cy = (inset - insetBack) / 2
    const bi = (inset + insetBack) / 2
    part.taper(0, cy, z0 * p.height, z1 * p.height, a0 * p.width - inset, b0 * p.depth - bi, a1 * p.width - inset, b1 * p.depth - bi)
  }
}

function kidney(b: BodyBuilder, side: 'R' | 'L', k: KidneyParams): void {
  const R = basisMatrix(k.axis, k.hilum)
  const w = k.hilum
  const v = cross(k.axis, k.hilum)
  const hl = k.len / 2
  const hw = k.width / 2
  const ht = k.thick / 2
  b.part(`perirenalFat${side}`, T.perirenal, { layer: 8, mobility: 0.5 }).ellipsoid(k.c, [hl + 16, hw + 18, ht + 16], R)
  b.part(`adrenal${side}`, T.adrenal, { layer: 8, mobility: 0.5 }).ellipsoid(add(k.c, k.axis, hl + 12), [12, 4, 14], R)
  // the cortex: a bean (the hilum notch subtracted from an ellipsoid)
  b.part(`kidneyCortex${side}`, T.cortex, { layer: 9, mobility: 0.5 })
    .ellipsoid(k.c, [hl, hw, ht], R)
    .minus()
    .ellipsoid(add(k.c, w, hw * 0.92), [hl * 0.3, hw * 0.42, ht * 0.5], R)
  // the medullary pyramids in a ring round the sinus, bases toward the cortex, apices toward the sinus
  const rng = mulberry32(mixSeed(Math.round(k.c[2] * 100), side === 'R' ? 11 : 13))
  const n = k.pyramids
  const pyr = b.part(`pyramids${side}`, T.medulla, { layer: 10, mobility: 0.5 })
  const gap = 0.75
  for (let i = 0; i < n; i++) {
    // around the ring in the plane of the long axis and the hilum (the kidney's coronal plane), skipping the hilum (+w, at a = -pi/2):
    // each pyramid's centre lies a cortex and a little more under the surface in its direction
    const a = -Math.PI / 2 + gap + ((2 * Math.PI - 2 * gap) * (i + 0.5)) / n + (rng() - 0.5) * 0.16
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const surface = 1 / Math.sqrt((ca / hl) ** 2 + (sa / hw) ** 2)
    const dist = Math.max(4, surface - k.cortex - 8)
    const off = (rng() - 0.5) * ht * 0.6
    const radial: V3 = [k.axis[0] * ca - w[0] * sa, k.axis[1] * ca - w[1] * sa, k.axis[2] * ca - w[2] * sa]
    const c = add(add(k.c, radial, dist), v, off)
    // local x along the radial direction (base toward the cortex, apex toward the sinus), y through the kidney's thickness
    pyr.ellipsoid(c, [8.5, ht * 0.4, hw * 0.25], basisMatrix(radial, v))
  }
  // the sinus fat: three overlapping lobes along the long axis (the calyces), shifted toward the hilum
  const sinus = b.part(`sinus${side}`, T.sinus, { layer: 11, mobility: 0.5, smooth: 6 })
  const sc = add(k.c, w, hw * 0.22)
  sinus.ellipsoid(sc, [hl * 0.62, hw * 0.3, ht * 0.38], R)
  sinus.ellipsoid(add(sc, k.axis, hl * 0.36), [hl * 0.2, hw * 0.28, ht * 0.32], R)
  sinus.ellipsoid(add(sc, k.axis, -hl * 0.36), [hl * 0.2, hw * 0.28, ht * 0.32], R)
  sinus.ellipsoid(add(k.c, w, hw * 0.75), [hl * 0.18, hw * 0.35, ht * 0.4], R)
  // a small, non-dilated renal pelvis at the hilum and the renal vein toward the IVC / aorta side
  b.part(`renalPelvis${side}`, T.urine, { layer: 12, mobility: 0.5 }).ellipsoid(add(k.c, w, hw * 0.72), [hl * 0.1, hw * 0.12, ht * 0.14], R)
  const hil = add(k.c, w, hw * 1.05)
  const toward: V3 = side === 'R' ? [-22, 22, k.c[2] - 4] : [16, 18, k.c[2] + 6]
  b.part(`renalVessel${side}`, T.blood, { layer: 17, mobility: 0.3 }).capsule(hil, toward, side === 'R' ? 4.5 : 5)
}

/** One rib on one side: from beside its vertebra round the back and side toward the front, sloping down. */
function rib(b: BodyBuilder, p: PatientParams, side: -1 | 1, level: number, s0: number, sweep: number): void {
  const pts: V3[] = []
  const n = 9
  for (let i = 0; i <= n; i++) {
    const th = 0.22 + (sweep * i) / n
    const s = s0 - 70 * (th / Math.PI) * p.height
    const [a, bb] = outlineAt(p, s)
    const inA = a - p.fat - 12
    const inB = bb - p.fat - 12
    pts.push([side * inA * Math.sin(th), inB * Math.cos(th), s])
  }
  boneTube(b, `rib${level}${side < 0 ? 'R' : 'L'}`, pts, level >= 11 ? 5 : 6)
}

function bowel(b: BodyBuilder, p: PatientParams): void {
  const r = mulberry32(p.bowelSeed)
  const H = p.height
  // the colon: ascending on the right, transverse across, descending on the left
  const frame: [V3, V3, number][] = [
    [[-108, -18, 70], [-112, -24, 250], 24],
    [[-112, -24, 250], [-60, -70, 285], 22],
    [[-60, -70, 285], [40, -70, 280], 21],
    [[40, -70, 280], [105, -20, 300], 21],
    [[105, -20, 300], [112, 0, 90], 21],
  ]
  frame.forEach(([a, c, rad], i) => {
    const A: V3 = [a[0] * p.width, a[1] * p.depth, a[2] * H]
    const C: V3 = [c[0] * p.width, c[1] * p.depth, c[2] * H]
    b.part(`colonWall${i}`, T.gutWall, { layer: 4, mobility: 0.3 }).capsule(A, C, rad)
    // the left colon (splenic flexure, descending) holds stool: gas there would hide the spleen's window
    const roll = r()
    const content = i >= 3 ? T.stool : roll < 0.5 ? T.gas : T.stool
    b.part(`colon${i}`, content, { layer: content === T.gas ? 6 : 5, mobility: 0.3 }).capsule(A, C, rad - 4)
  })
  // small-bowel loops in the middle of the abdomen
  for (let i = 0; i < 16; i++) {
    const c: V3 = [(-80 + 160 * r()) * p.width, (-85 + 60 * r()) * p.depth, (90 + 150 * r()) * H]
    const ang = r() * Math.PI
    const len = 26 + 22 * r()
    const rad = 10 + 4 * r()
    const d: V3 = [Math.cos(ang) * len, (r() - 0.5) * 12, Math.sin(ang) * len]
    const A = add(c, d, -1)
    const C = add(c, d)
    b.part(`loopWall${i}`, T.gutWall, { layer: 4, mobility: 0.35 }).capsule(A, C, rad)
    const roll = r()
    const content = roll < 0.3 ? T.gas : roll < 0.75 ? T.gutFluid : T.stool
    b.part(`loop${i}`, content, { layer: content === T.gas ? 6 : 5, mobility: 0.35 }).capsule(A, C, rad - 2.6)
  }
}

/**
 * Adds the abdomen and pelvis of a patient, with the trunk's outline and wall up to the shoulders. `lungs` adds simple lung bases above the
 * diaphragm (for when the thorax region is not built with it: the ultrasound's liver dome and spleen windows need the air above).
 */
export function buildAbdomen(b: BodyBuilder, p: PatientParams, opts: { lungs?: boolean } = {}): void {
  const W = p.width
  const D = p.depth
  const H = p.height
  const at = (l: number, pp: number, s: number): V3 => [l * W, pp * D, s * H]

  // --- the wall ---------------------------------------------------------------------------------------------------
  envelope(b, 'outline', T.fat, 1, p, 0)
  envelope(b, 'wall', T.muscle, 2, p, p.fat, p.fat * 0.6)
  envelope(b, 'cavity', T.visceral, 3, p, p.fat + 11, p.fat * 0.6 + 22)

  // --- the back: erector spinae, quadratus lumborum, psoas -----------------------------------------------------------
  for (const sd of [-1, 1] as const) {
    b.part(`erector${sd}`, T.muscle, { layer: 18 }).taper(sd * 38 * W, 88 * D, 40 * H, 420 * H, 26 * W, 20 * D, 30 * W, 24 * D)
    b.part(`quadratus${sd}`, T.muscle, { layer: 18 }).ellipsoid(at(sd * 72, 62, 200), [20 * W, 13 * D, 70 * H], [0, 0, sd * -10])
    b.part(`psoas${sd}`, T.psoas, { layer: 18 }).cone(at(sd * 34, 46, 262), at(sd * 62, 22, 50), 9, 26)
  }

  // --- lung bases above the diaphragm -------------------------------------------------------------------------------
  if (opts.lungs !== false) b.part('lungR', T.lung, { layer: 6, mobility: 0.8 }).ellipsoid(at(-84, 22, 505), [92 * W, 98 * D, 150 * H]).ellipsoid(at(-120, 60, 400), [42 * W, 50 * D, 70 * H])
  if (opts.lungs !== false) b.part('lungL', T.lung, { layer: 6, mobility: 0.8 }).ellipsoid(at(86, 26, 495), [86 * W, 96 * D, 150 * H]).ellipsoid(at(122, 62, 385), [40 * W, 50 * D, 70 * H])

  // --- solid organs ---------------------------------------------------------------------------------------------------
  const L = p.liver
  const ls = L.scale
  b.part('liver', T.liver, { layer: 7, mobility: 1, smooth: 28 })
    .ellipsoid(L.c, [82 * ls * W, 86 * ls * D, 78 * ls * H])
    .ellipsoid([L.c[0] - 22 * W, L.c[1] - 8 * D, (L.tipS + 58) * 1], [58 * ls * W, 60 * ls * D, 52 * ls * H], [0, 0, 12])
    .ellipsoid(at(18, -42, 352), [72 * ls * W, 34 * ls * D, 44 * ls * H], [0, 0, -14])
    .ellipsoid(at(-12, 18, 340), [26 * W, 24 * D, 30 * H])
    .minus()
    // the kidney's impression on the liver's underside
    .ellipsoid(p.kidneyR.c, [60, 34, 30])
  // the hepatic veins draining into the IVC, the portal vein and two branches (echogenic walls)
  const ivcTop = at(-18, 10, 392)
  for (const [l, pp, s] of [
    [-100, 0, 340],
    [-50, -30, 360],
    [10, -40, 372],
  ] as V3[]) {
    b.part('hepaticVein', T.blood, { layer: 17, mobility: 1 }).cone(ivcTop, at(l, pp, s), 6, 2.5)
  }
  const pv0 = at(-8, -8, 268)
  const pv1 = at(-42, -6, 296)
  b.part('portalWall', T.vesselWall, { layer: 16, mobility: 1 }).capsule(pv0, pv1, 8.5).cone(pv1, at(-92, -8, 302), 6.5, 3.5).cone(pv1, at(-10, -35, 330), 6, 3)
  b.part('portalVein', T.blood, { layer: 17, mobility: 1 }).capsule(pv0, pv1, 6.5).cone(pv1, at(-92, -8, 302), 4.8, 2).cone(pv1, at(-10, -35, 330), 4.4, 1.8)

  const S = p.spleen
  b.part('spleen', T.spleen, { layer: 7, mobility: 0.9, smooth: 10 })
    .ellipsoid(S.c, [30 * S.scale * W, 50 * S.scale * D, 54 * S.scale * H], [12, 0, -22])
    .minus()
    .ellipsoid([S.c[0] - 34 * W, S.c[1] - 18 * D, S.c[2]], [26, 36, 40])

  b.part('pancreas', T.pancreas, { layer: 7, mobility: 0.6, smooth: 10 })
    .ellipsoid(at(-28, -14, 258), [22 * W, 16 * D, 24 * H])
    .capsule(at(-18, -18, 262), at(40, -10, 272), 11)
    .capsule(at(40, -10, 272), at(82, 22, 292), 9)

  // the stomach: wall, fluid, and the air that rises to the front in a patient lying on their back
  const st = at(56, -42, 318)
  b.part('stomachWall', T.gutWall, { layer: 4, mobility: 0.8 }).ellipsoid(st, [52 * W, 38 * D, 62 * H], [0, 0, 18])
  b.part('stomach', T.gutFluid, { layer: 5, mobility: 0.8 }).ellipsoid(st, [47 * W, 33 * D, 57 * H], [0, 0, 18])
  b.part('stomachGas', T.gas, { layer: 6, mobility: 0.8 }).ellipsoid(add(st, [0, -26 * D, 8]), [34 * W, 9, 38 * H], [0, 0, 18])

  bowel(b, p)

  // --- kidneys ----------------------------------------------------------------------------------------------------------
  kidney(b, 'R', p.kidneyR)
  kidney(b, 'L', p.kidneyL)

  // --- gallbladder: wall, bile, and (in some patients) a stone lying at the back (the lowest point when supine) ----------------
  const G = p.gallbladder
  const gR = basisMatrix(G.axis, [1, 0, 0])
  b.part('gbWall', T.gbWall, { layer: 13, mobility: 1 }).ellipsoid(G.c, [G.len / 2 + 2.5, G.radius + 2.5, G.radius + 2.5], gR).ellipsoid(add(G.c, G.axis, G.len * 0.28), [G.len * 0.2 + 2.5, G.radius * 1.12 + 2.5, G.radius * 1.12 + 2.5], gR)
  b.part('bile', T.bile, { layer: 14, mobility: 1 }).ellipsoid(G.c, [G.len / 2, G.radius, G.radius], gR).ellipsoid(add(G.c, G.axis, G.len * 0.28), [G.len * 0.2, G.radius * 1.12, G.radius * 1.12], gR)
  if (G.stone) b.part('gallstone', T.stone, { layer: 15, mobility: 1 }).sphere(add(add(G.c, G.axis, G.len * 0.22), [0, G.radius - G.stoneR - 1.5, 0]), G.stoneR)

  // --- great vessels ------------------------------------------------------------------------------------------------------
  const ao0 = at(14, 18, 102)
  const ao1 = at(10, 20, 400)
  b.part('aortaWall', T.vesselWall, { layer: 16 }).capsule(ao0, ao1, 12.5)
  b.part('aorta', T.blood, { layer: 17 }).capsule(ao0, ao1, 10.5)
  if (p.age > 60) b.part('aorticPlaque', T.calcification, { layer: 18 }).sphere(at(18, 28, 150), 2.2)
  for (const sd of [-1, 1]) {
    b.part('iliacWall', T.vesselWall, { layer: 16 }).capsule(ao0, at(sd * 70, 8, -5), 7.5)
    b.part('iliac', T.blood, { layer: 17 }).capsule(ao0, at(sd * 70, 8, -5), 6)
  }
  b.part('ivc', T.blood, { layer: 17, mobility: 0.3 }).ellipsoid(at(-24, 16, 245), [13 * W, 10 * D, 150 * H]).capsule(at(-24, 16, 380), ivcTop, 11)

  // --- bones: spine, ribs, pelvis, hips ---------------------------------------------------------------------------------
  buildLumbarSpine(b, p)
  const levels: [number, number, number][] = [
    [8, 388, 2.3],
    [9, 362, 2.25],
    [10, 335, 2.1],
    [11, 307, 1.55],
    [12, 277, 1.1],
  ]
  for (const sd of [-1, 1] as const) for (const [lv, s, sw] of levels) rib(b, p, sd, lv, s * H, sw)
  buildPelvis(b, p)

  // --- pelvis: bladder, the pelvic organ, rectum ---------------------------------------------------------------------------
  const f = Math.cbrt(p.bladderFill)
  const bc = at(0, -36 + 6 * (1 - f), 28 + 20 * f)
  const br: V3 = [52 * f * W, 38 * f * D, 44 * f * H]
  b.part('bladderWall', T.bladderWall, { layer: 24 }).ellipsoid(bc, [br[0] + 3, br[1] + 3, br[2] + 3])
  b.part('bladder', T.urine, { layer: 25 }).ellipsoid(bc, br)
  b.part('pelvicOrgan', T.pelvicOrgan, { layer: 7 }).ellipsoid(at(0, 18, 34 + 10 * f), [30 * W, 22 * D, 34 * H], [20, 0, 0])
  b.part('rectumWall', T.gutWall, { layer: 4 }).capsule(at(0, 52, -10), at(0, 46, 72), 17)
  b.part('rectum', T.stool, { layer: 5 }).capsule(at(0, 52, -10), at(0, 46, 72), 13)
}
