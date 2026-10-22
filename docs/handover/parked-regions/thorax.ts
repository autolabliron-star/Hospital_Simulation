/**
 * R3 "Real screens": the chest, from the base of the neck down to the diaphragm, for CT of the chest (lung and mediastinal windows), the PA
 * chest radiograph and the topogram. Always built together with abdomen.ts (which owns the trunk's outline, the wall, the spine up to T8,
 * ribs 8-12, the liver and the spleen) and standing in for its simple lung bases.
 *
 * What is in it: both lungs (three lobes on the right, two on the left, fissures, a seeded tree of bronchi with their arteries and of
 * veins that tapers to the periphery), the diaphragm's domes, the trachea and the main bronchi, the heart (four chambers, the walls with a
 * thick left ventricle, pericardial fat), the great vessels (aorta with its arch and branches, pulmonary trunk and arteries, caval veins,
 * pulmonary veins, azygos), the oesophagus, mediastinal fat and the thymus remnant, the thyroid, the bony thorax (ribs 1-7 with their
 * costal cartilages and necks, a sternum, clavicles, scapulae, T1-T7 and C7 from skeleton.ts) and the soft tissue of the chest wall, the
 * back and the shoulders (arms are out of the field).
 *
 * Layers (a higher layer wins where parts overlap): 4-5 chest wall, muscles   6 lungs   7 mediastinal fat   8 diaphragm, thymus
 *   9 pericardial fat, bronchial and oesophageal walls   11-12 heart walls, lung vessels, airway lumen   14-15 heart cavities and papillary
 *   muscles   16-17 great vessels (wall, blood)   19-23 bone, cartilage, canal (skeleton.ts)
 */
import { mixSeed, mulberry32, type RandomFn } from '@/sim/rng'
import { basisMatrix, type BodyBuilder, type PartBuilder, type V3 } from '../body'
import type { PatientParams } from '../params'
import { tissue } from '../tissues'
import { outlineAt } from './abdomen'
import { boneTube, buildUpperSpine, levelDims, UPPER_SPINE } from './skeleton'
import type { Landmarks, RegionId } from './types'

const T = {
  fat: tissue('fat'),
  muscle: tissue('muscle'),
  visceral: tissue('visceralFat'),
  lung: tissue('lung'),
  airway: tissue('airway'),
  blood: tissue('blood'),
  vesselWall: tissue('vesselWall'),
  myocardium: tissue('myocardium'),
  diaphragm: tissue('diaphragm'),
  gutWall: tissue('gutWall'),
  cartilage: tissue('cartilage'),
  cortical: tissue('cortical'),
  marrow: tissue('marrow'),
  thyroid: tissue('thyroid'),
}

const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)

/** How the rib cage narrows toward the thoracic inlet: [S, width factor, depth factor] on the trunk outline's ring (abdomen.ts ribs follow it up to S 470). */
const NARROW: [number, number, number][] = [
  [470, 1, 1],
  [520, 0.97, 0.95],
  [560, 0.88, 0.86],
  [590, 0.74, 0.76],
  [615, 0.6, 0.68],
  [640, 0.5, 0.6],
  [670, 0.42, 0.55],
]

/** The ring of the ribs (centre line) at a height `s` (scaled mm): half-width A, half-depth B and the ring's centre P. */
function cage(p: PatientParams, s: number): { A: number; B: number; cy: number } {
  const [a, b] = outlineAt(p, s)
  const A0 = a - p.fat - 12
  const B0 = b - p.fat - 12
  const z = s / p.height
  let k = 0
  while (k < NARROW.length - 2 && NARROW[k + 1][0] < z) k++
  const [z0, wa0, wb0] = NARROW[k]
  const [z1, wa1, wb1] = NARROW[k + 1]
  const t = clamp((z - z0) / (z1 - z0), 0, 1)
  const fa = wa0 + (wa1 - wa0) * t
  const fb = wb0 + (wb1 - wb0) * t
  return { A: A0 * fa, B: B0 * fb, cy: (1 - fb) * B0 * 0.55 }
}

/** A tube through points whose radius changes linearly from r0 to r1 along them, as cones. */
function tube(part: PartBuilder, pts: V3[], r0: number, r1: number): void {
  const n = pts.length - 1
  for (let i = 0; i < n; i++) part.cone(pts[i], pts[i + 1], r0 + ((r1 - r0) * i) / n, r0 + ((r1 - r0) * (i + 1)) / n)
}

/** A tube with its own radius at every point. */
function tubeR(part: PartBuilder, pts: V3[], r: number[], grow = 0): void {
  for (let i = 0; i + 1 < pts.length; i++) part.cone(pts[i], pts[i + 1], r[i] + grow, r[i + 1] + grow)
}

interface Seg {
  a: V3
  b: V3
  ra: number
  rb: number
}

/**
 * A seeded branching tree from a root to `count` random points of a lobe (chosen inside the lung): the points are joined, nearest first, to the
 * nearest part of the tree already grown (in steps of about 15 mm), so it fans out evenly through the lobe. A branch's radius follows the
 * number of points beyond it (the tapering of real bronchi and vessels): `c` x leaves^0.4, at least `rMin`. Segments come out in depth-first
 * order, so neighbours in the list are neighbours in space.
 */
function branchTree(rng: RandomFn, root: V3, count: number, sample: () => V3 | null, c: number, rMin: number): Seg[] {
  const targets: V3[] = []
  for (let tries = 0; tries < count * 80 && targets.length < count; tries++) {
    const q = sample()
    if (q) targets.push(q)
  }
  const d2 = (a: V3, q: V3): number => (a[0] - q[0]) ** 2 + (a[1] - q[1]) ** 2 + (a[2] - q[2]) ** 2
  targets.sort((u, v) => d2(u, root) - d2(v, root))
  const pos: V3[] = [root]
  const parent: number[] = [-1]
  const term: number[] = [0]
  for (const t of targets) {
    let best = 0
    let bd = Infinity
    for (let i = 0; i < pos.length; i++) {
      const d = d2(pos[i], t)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    let cur = best
    let at = pos[best]
    for (let guard = 0; guard < 12; guard++) {
      const dist = Math.sqrt(d2(at, t))
      if (dist <= 17) break
      const k = (13 + 4 * rng()) / dist
      at = [at[0] + (t[0] - at[0]) * k + (rng() - 0.5) * 3, at[1] + (t[1] - at[1]) * k + (rng() - 0.5) * 3, at[2] + (t[2] - at[2]) * k + (rng() - 0.5) * 3]
      pos.push(at)
      parent.push(cur)
      term.push(0)
      cur = pos.length - 1
    }
    pos.push(t)
    parent.push(cur)
    term.push(1)
  }
  const n = pos.length
  const leaves = term.slice()
  for (let i = n - 1; i > 0; i--) leaves[parent[i]] += leaves[i]
  const kids: number[][] = Array.from({ length: n }, () => [])
  for (let i = 1; i < n; i++) kids[parent[i]].push(i)
  const R = (l: number): number => Math.max(rMin, c * Math.pow(Math.max(1, l), 0.36))
  const out: Seg[] = []
  const stack: number[] = [0]
  while (stack.length > 0) {
    const i = stack.pop()!
    // the biggest branch last, so it is walked first
    const ks = kids[i].slice().sort((u, v) => leaves[u] - leaves[v])
    for (const k of ks) {
      out.push({ a: pos[i], b: pos[k], ra: R(leaves[i]), rb: R(leaves[k]) })
      stack.push(k)
    }
  }
  return out
}

/** Costal levels: bony drop (mm) from the back to the costochondral end, the angle round the ring where it ends, and the rise of the cartilage to the sternum. */
const RIBS: [drop: number, thEnd: number, rise: number, radius: number][] = [
  [30, 1.9, 6, 4.2],
  [46, 2.1, 18, 4.5],
  [58, 2.25, 30, 4.8],
  [66, 2.3, 40, 5.0],
  [70, 2.35, 46, 5.2],
  [70, 2.4, 48, 5.4],
  [66, 2.45, 48, 5.5],
]

export function buildThorax(b: BodyBuilder, p: PatientParams, regions: readonly RegionId[]): Landmarks {
  void regions
  const W = p.width
  const D = p.depth
  const H = p.height
  const sz = Math.cbrt(W * D * H)
  const at = (l: number, pp: number, s: number): V3 => [l * W, pp * D, s * H]
  const lm: Landmarks = {}
  const rng = mulberry32(mixSeed(p.seed >>> 0, 0x7b01))

  // --- the spine above T8 ------------------------------------------------------------------------------------------------------
  buildUpperSpine(b, p)
  const vT = (k: number): V3 => {
    const [, s, pp] = UPPER_SPINE[7 - k]
    return [0, pp * D, s * H]
  }
  for (let k = 1; k <= 7; k++) lm[`vertT${k}`] = vT(k)

  // --- the dome of the diaphragm: over the liver on the right, over the stomach and the spleen on the left --------------------------
  const L = p.liver
  const lr: V3 = [82 * L.scale * W, 86 * L.scale * D, 78 * L.scale * H]
  const topR = L.c[2] + lr[2]
  const topL = Math.max(380 * H, p.spleen.c[2] + 54 * p.spleen.scale * H) + 3
  const domeLc: V3 = [62 * W, 6 * D, topL - 80 * H]
  const domeLr: V3 = [86 * W, 90 * D, 80 * H]
  const shell = (name: string, c: V3, r: V3): void => {
    b.part(name, T.diaphragm, { layer: 8, mobility: 1 })
      .ellipsoid(c, [r[0] + 3.5, r[1] + 3.5, r[2] + 3.5])
      .minus()
      .ellipsoid(c, r)
      .box([c[0], c[1], c[2] + 0.5 * r[2] - 200], [300, 300, 200], 0)
  }
  shell('diaphragmR', L.c, lr)
  shell('diaphragmL', domeLc, domeLr)
  lm.domeR = [L.c[0], L.c[1], topR + 3.5]
  lm.domeL = [domeLc[0], domeLc[1], topL]

  // --- the lungs: the ring's inside, the mediastinum cut out by the parts that fill it (higher layers) -----------------------------
  const gap = 3
  const levels = [392, 430, 470, 520, 560, 590, 615, 640, 650]
  /** The pleura's ring at S (unscaled): half-axes and centre. */
  const ring = (s: number): { A: number; B: number; cy: number } => {
    const c = cage(p, s * H)
    return { A: c.A - 9, B: c.B - 9, cy: c.cy }
  }
  for (const sd of [-1, 1] as const) {
    const part = b.part(sd < 0 ? 'lungR' : 'lungL', T.lung, { layer: 6, mobility: 0.8 })
    for (let k = 0; k + 1 < levels.length; k++) {
      const r0 = ring(levels[k])
      const r1 = ring(levels[k + 1])
      part.taper(0, (r0.cy + r1.cy) / 2, levels[k] * H, levels[k + 1] * H, r0.A, r0.B, r1.A, r1.B)
    }
    // the apex, and the lower lung that runs down round the dome into the costophrenic recess
    const ra = ring(646)
    part.ellipsoid([0, ra.cy, 646 * H], [ra.A * 0.92, ra.B * 0.92, 15 * H])
    const rl = ring(380)
    part.ellipsoid([sd * (rl.A * 0.5 + 1), rl.cy, 372 * H], [rl.A * 0.5 - 3, rl.B - 6, 54 * H])
    // minus the other side of the midline and the dome of the diaphragm
    part.minus().box([sd * (gap - 200), 0, 520 * H], [200, 300, 300], 0)
    if (sd < 0) part.ellipsoid(L.c, lr)
    else part.ellipsoid(domeLc, domeLr)
  }
  // the fissures: thin sheets of pleura. Right: oblique and horizontal. Left: oblique.
  const fis = b.part('fissures', T.vesselWall, { layer: 6, mobility: 0.8 })
  fis.ellipsoid(at(-84, 6, 470), [34 * W, 98 * sz, 0.8], [42, 0, 0])
  fis.ellipsoid(at(-86, -26, 500), [32 * W, 42 * sz, 0.7], [7, 4, 0])
  fis.ellipsoid(at(84, 8, 466), [34 * W, 98 * sz, 0.8], [42, 0, 0])
  const apexOf = (sd: -1 | 1): V3 => {
    const r = ring(646)
    return [sd * (r.A * 0.5 + gap), r.cy, 655 * H]
  }
  lm.apexR = apexOf(-1)
  lm.apexL = apexOf(1)

  // --- the mediastinal fat: a column behind the sternum, round the trachea and the vessels, and behind the heart --------------------
  b.part('mediastinumUp', T.visceral, { layer: 7 }).taper(2 * W, -6 * D, 520 * H, 668 * H, 36 * W, 48 * D, 20 * W, 32 * D)
  b.part('mediastinumPost', T.visceral, { layer: 7 }).ellipsoid(at(0, 28, 480), [46 * W, 24 * D, 62 * H]).ellipsoid(at(0, 22, 402), [40 * W, 34 * D, 34 * H])
  // the thymus remnant and the thyroid
  b.part('thymus', T.fat, { layer: 8 }).ellipsoid(at(-6, -52, 566), [14 * W, 8 * D, 28 * H]).ellipsoid(at(10, -52, 560), [14 * W, 8 * D, 26 * H])
  const thy = b.part('thyroid', T.thyroid, { layer: 9 })
  for (const sd of [-1, 1]) thy.ellipsoid(at(sd * 15, 3, 660), [8 * W, 8 * D, 19 * H])
  thy.ellipsoid(at(0, -6, 650), [10 * W, 3 * D, 5 * H])

  // --- the airway: trachea, carina, main bronchi -------------------------------------------------------------------------------
  const carina = at(-1, 10, 560)
  lm.carina = carina
  const trachea: V3[] = [at(-0.5, 4, 678), at(-0.5, 5, 640), at(-1, 7, 600), carina]
  tube(b.part('tracheaWall', T.vesselWall, { layer: 9 }), trachea, 12 * sz, 12 * sz)
  tube(b.part('trachea', T.airway, { layer: 12 }), trachea, 9.8 * sz, 9.8 * sz)
  const rMain: V3[] = [carina, at(-24, 12, 546), at(-36, 13, 538)]
  const lMain: V3[] = [carina, at(20, 13, 549), at(42, 17, 531), at(54, 20, 516)]
  const bi: V3[] = [at(-36, 13, 538), at(-42, 16, 520), at(-46, 18, 505)]
  const mainWall = b.part('mainBronchiWall', T.vesselWall, { layer: 9 })
  const mainLumen = b.part('mainBronchi', T.airway, { layer: 12 })
  tube(mainWall, rMain, 9.2 * sz, 8.4 * sz)
  tube(mainLumen, rMain, 7.4 * sz, 6.6 * sz)
  tube(mainWall, bi, 8.2 * sz, 7.2 * sz)
  tube(mainLumen, bi, 6.4 * sz, 5.6 * sz)
  tube(mainWall, lMain, 7.6 * sz, 6.8 * sz)
  tube(mainLumen, lMain, 6 * sz, 5.2 * sz)

  // --- the oesophagus (behind the trachea, in front of the spine), the azygos --------------------------------------------------------
  const eso: V3[] = [at(2, 23, 660), at(2, 25, 600), at(3, 27, 560), at(4, 31, 520), at(3, 34, 490), at(0, 39, 460), at(-2, 41, 430), at(2, 34, 400), at(8, 28, 372)]
  tube(b.part('oesophagus', T.gutWall, { layer: 9 }), eso, 7.2 * sz, 7.2 * sz)
  const azy: V3[] = [at(-20, 48, 420), at(-22, 46, 470), at(-22, 40, 520), at(-22, 28, 552), at(-26, 10, 561), at(-32, -6, 556), at(-35, -16, 545)]
  tube(b.part('azygos', T.blood, { layer: 17 }), azy, 4.5 * sz, 4.5 * sz)

  // --- the heart: the pericardial fat, then the walls, then the blood ----------------------------------------------------------------
  const axis = unit([0.588, -0.504, -0.672])
  const Rax = basisMatrix(axis, [0, 1, 0])
  const axisRV = unit([0.35, -0.35, -0.87])
  const Rrv = basisMatrix(axisRV, [0, 1, 0])
  const s3 = (x: number, y: number, z: number): V3 => [x * sz, y * sz, z * sz]
  // the pericardial sac and its fat (the heart sits on the diaphragm)
  b.part('pericardium', T.visceral, { layer: 9 })
    .ellipsoid(at(40, -32, 456), [60 * W, 40 * D, 48 * H])
    .ellipsoid(at(10, -34, 470), [50 * W, 42 * D, 42 * H])
    .ellipsoid(at(-12, -20, 496), [48 * W, 34 * D, 40 * H])
  // the left ventricle: a thick wall, then its blood
  const lvC = at(46, -30, 462)
  const lvOuter = s3(55, 35, 32)
  b.part('lvWall', T.myocardium, { layer: 12 }).ellipsoid(lvC, lvOuter, Rax)
  b.part('lvBlood', T.blood, { layer: 14 }).ellipsoid(at(45, -29, 466), s3(43, 23, 20), Rax)
  const pap = b.part('papillary', T.myocardium, { layer: 15 })
  pap.ellipsoid(at(52, -22, 446), s3(6, 6, 13), Rax).ellipsoid(at(58, -32, 450), s3(5, 5, 12), Rax)
  // the right ventricle: a crescent hugging the left ventricle's front and right side
  const rvC = at(12, -46, 474)
  b.part('rvWall', T.myocardium, { layer: 11 }).ellipsoid(rvC, s3(54, 34, 28), Rrv)
  b.part('rvBlood', T.blood, { layer: 14 }).ellipsoid(at(11, -45, 476), s3(48, 27, 21), Rrv).minus().ellipsoid(lvC, [lvOuter[0] + 0.5, lvOuter[1] + 0.5, lvOuter[2] + 0.5], Rax)
  // the atria
  b.part('raWall', T.myocardium, { layer: 11 }).ellipsoid(at(-34, -30, 478), [27 * W, 27 * D, 36 * H])
  b.part('raBlood', T.blood, { layer: 14 }).ellipsoid(at(-34, -30, 478), [24 * W, 24 * D, 33 * H])
  b.part('laWall', T.myocardium, { layer: 11 }).ellipsoid(at(16, 8, 500), [38 * W, 21 * D, 22 * H]).ellipsoid(at(46, -28, 506), s3(12, 9, 11))
  b.part('laBlood', T.blood, { layer: 14 }).ellipsoid(at(16, 8, 500), [35.5 * W, 18.5 * D, 19.5 * H]).ellipsoid(at(46, -28, 506), s3(9.5, 6.5, 8.5))
  // the valves' orifices: blood joining the chambers (mitral, tricuspid, the left and right outflow)
  const inflow = b.part('heartInflow', T.blood, { layer: 14 })
  inflow.capsule(at(28, -6, 488), at(38, -20, 476), 11 * sz).capsule(at(-20, -38, 478), at(2, -44, 476), 12 * sz)
  inflow.capsule(at(38, -28, 472), at(8, -22, 492), 10.5 * sz).capsule(at(14, -52, 482), at(18, -50, 498), 12 * sz)

  // --- the great vessels -------------------------------------------------------------------------------------------------------------
  const aoP: V3[] = [at(4, -18, 496), at(1, -16, 520), at(-1, -12, 546), at(7, 0, 568), at(22, 12, 573), at(33, 26, 557), at(34, 34, 534), at(31, 38, 500), at(26, 36, 462), at(18, 28, 430), at(12, 22, 410), at(10, 20, 400)]
  const aoR = [17.5, 16.5, 15.5, 14.8, 14.2, 13.5, 12.8, 12.4, 12, 11.5, 11, 10.5]
  const wallParts: [string, V3[], number[]][] = [['aortaThx', aoP, aoR]]
  const vessel = (name: string, pts: V3[], r: number[]): void => wallParts.push([name, pts, r])
  vessel('brachiocephalic', [at(1, -8, 566), at(-6, -4, 590), at(-16, -2, 608)], [8, 7.8, 7.5])
  vessel('carotidR', [at(-16, -2, 608), at(-21, 4, 640), at(-23, 8, 676)], [4.6, 4.5, 4.4])
  vessel('subclavianR', [at(-16, -2, 608), at(-42, -4, 622), at(-78, -2, 630), at(-110, 2, 632)], [5.8, 5.6, 5.2, 5])
  vessel('carotidL', [at(12, 0, 572), at(14, 4, 610), at(15, 10, 676)], [4.7, 4.5, 4.4])
  vessel('subclavianL', [at(24, 12, 572), at(38, 12, 606), at(70, 8, 628), at(110, 4, 632)], [5.8, 5.6, 5.3, 5])
  vessel('ptrunk', [at(18, -52, 496), at(20, -42, 516), at(18, -28, 534)], [14.5, 14, 13])
  vessel('rpa', [at(18, -28, 534), at(10, -2, 528), at(-10, 4, 526), at(-36, -2, 520)], [10.5, 10, 9.6, 9])
  vessel('lpa', [at(18, -28, 534), at(34, -12, 542), at(48, 4, 546), at(58, 12, 536), at(62, 22, 516)], [10.5, 10, 9.4, 9, 8.4])
  vessel('interlobarR', [at(-36, -2, 520), at(-54, 10, 508), at(-60, 24, 482), at(-64, 36, 446)], [9, 8.5, 7.2, 6])
  vessel('interlobarL', [at(62, 22, 516), at(66, 28, 490), at(70, 38, 452)], [8.4, 7.4, 6])
  vessel('svc', [at(-28, -12, 590), at(-32, -16, 555), at(-36, -22, 515), at(-36, -26, 497)], [9.6, 9.6, 9.6, 9.6])
  vessel('bcvL', [at(70, -12, 628), at(30, -18, 606), at(-14, -16, 594)], [7, 7, 7])
  vessel('bcvR', [at(-48, -6, 630), at(-26, -10, 602), at(-20, -12, 590)], [6, 6, 6])
  vessel('ivcThx', [at(-18, 10, 392), at(-26, -6, 420), at(-30, -20, 448), at(-32, -24, 462)], [11, 11, 11, 11])
  vessel('pvRS', [at(-50, -2, 518), at(-34, 2, 510), at(-20, 4, 506)], [5.6, 5.8, 6])
  vessel('pvRI', [at(-52, 26, 490), at(-36, 18, 492), at(-22, 10, 494)], [6, 6.2, 6.4])
  vessel('pvLS', [at(52, -2, 516), at(46, 0, 510), at(40, 2, 504)], [5.6, 5.8, 6])
  vessel('pvLI', [at(58, 26, 490), at(48, 18, 492), at(40, 10, 494)], [6, 6.2, 6.4])
  // each vessel: a wall, then blood; the aorta gets a bulge for its root (the sinuses of Valsalva)
  for (const [name, pts, r] of wallParts) {
    tubeR(b.part(`${name}Wall`, T.vesselWall, { layer: 16 }), pts.map((q) => q), r.map((x) => x * sz), 2)
    tubeR(b.part(name, T.blood, { layer: 17 }), pts, r.map((x) => x * sz))
  }

  // --- the bronchial trees, with their arteries, and the pulmonary veins ----------------------------------------------------------------
  const heartC = at(34, -32, 462)
  const raC = at(-34, -30, 478)
  const domeAt = (sd: -1 | 1, x: number, y: number): number => {
    const c = sd < 0 ? L.c : domeLc
    const r = sd < 0 ? lr : domeLr
    const k = 1 - ((x - c[0]) / r[0]) ** 2 - ((y - c[1]) / r[1]) ** 2
    return k > 0 ? c[2] + r[2] * Math.sqrt(k) : 345 * H
  }
  const inLung =
    (sd: -1 | 1) =>
    (q: V3, m: number): boolean => {
      const [x, y, z] = q
      if (z > 650 * H - m || z < domeAt(sd, x, y) + m + 4) return false
      const rg = cage(p, z)
      const A = rg.A - 9 - m
      const B = rg.B - 9 - m
      if (A < 6 || B < 6) return false
      const ex = x / A
      const ey = (y - rg.cy) / B
      if (ex * ex + ey * ey > 1) return false
      const mm = m * 0.4
      if (x * sd < (y > 0 ? 40 * W : 30 * W) + mm) return false
      const hx = (x - heartC[0]) / (70 * W + mm)
      const hy = (y - heartC[1]) / (52 * D + mm)
      const hz = (z - heartC[2]) / (60 * H + mm)
      if (hx * hx + hy * hy + hz * hz < 1) return false
      const rx = (x - raC[0]) / (30 * W + mm)
      const ry = (y - raC[1]) / (30 * D + mm)
      const rz = (z - raC[2]) / (40 * H + mm)
      return rx * rx + ry * ry + rz * rz >= 1
    }
  /** Bronchus roots: origin, first direction target (the lobe's middle) and the spread of its targets, radius. */
  // which lobe a point is in: by the side of the oblique fissure, and (on the right) the horizontal one
  const oblique = (q: V3): number => 0.67 * (q[1] - 6 * D) - 0.74 * (q[2] - 470 * H)
  type LobeId = 'RUL' | 'RML' | 'RLL' | 'LUL' | 'LING' | 'LLL'
  const inLobe = (id: LobeId, q: V3): boolean => {
    const v = oblique(q)
    switch (id) {
      case 'RUL':
        return v < 0 && q[2] >= 498 * H
      case 'RML':
        return v < 0 && q[2] < 498 * H
      case 'LUL':
        return v < 0 && q[2] >= 476 * H
      case 'LING':
        return v < 0 && q[2] < 476 * H
      default:
        return v >= 0
    }
  }
  const lobes: { id: LobeId; sd: -1 | 1; from: V3; r: number; n: number; vein: V3 }[] = [
    { id: 'RUL', sd: -1, from: at(-36, 13, 538), r: 5, n: 330, vein: at(-50, -2, 518) },
    { id: 'RML', sd: -1, from: at(-46, 18, 505), r: 3.8, n: 150, vein: at(-48, -4, 512) },
    { id: 'RLL', sd: -1, from: at(-46, 18, 505), r: 5.2, n: 380, vein: at(-52, 26, 490) },
    { id: 'LUL', sd: 1, from: at(42, 17, 531), r: 4.8, n: 310, vein: at(52, -2, 516) },
    { id: 'LING', sd: 1, from: at(54, 20, 516), r: 3.8, n: 130, vein: at(52, 0, 510) },
    { id: 'LLL', sd: 1, from: at(54, 20, 516), r: 5, n: 360, vein: at(58, 26, 490) },
  ]
  const groupSize = 14
  let treeNo = 0
  for (const lobe of lobes) {
    const inside = inLung(lobe.sd)
    const sample = (): V3 | null => {
      const q: V3 = [lobe.sd * (30 + 110 * rng()) * W, (rng() * 2 - 1) * 100 * D, (335 + 320 * rng()) * H]
      return inside(q, 7) && inLobe(lobe.id, q) ? q : null
    }
    const segs = branchTree(rng, lobe.from, lobe.n, sample, lobe.r / Math.pow(lobe.n, 0.36), 1.1)
    // their arteries run beside them; the bronchi are drawn down to a radius of about 1.4 mm
    for (let g = 0; g < segs.length; g += 24) {
      const art = b.part(`artery${treeNo}_${g}`, T.blood, { layer: 11, mobility: 0.8 })
      for (const s of segs.slice(g, g + 24)) {
        const d = unit(sub(s.b, s.a))
        const side = unit(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]))
        const off = s.ra + s.ra * 1.05 + 1.2
        art.cone(add(s.a, side, off), add(s.b, side, s.rb + s.rb * 1.05 + 1.2), s.ra * 1.05, s.rb * 1.05)
      }
    }
    const big = segs.filter((s) => s.ra >= 1.5)
    for (let g = 0; g < big.length; g += groupSize) {
      const name = `bronchi${treeNo}_${g}`
      const wall = b.part(`${name}Wall`, T.vesselWall, { layer: 9, mobility: 0.8 })
      const lumen = b.part(`${name}Lumen`, T.airway, { layer: 12, mobility: 0.8 })
      for (const s of big.slice(g, g + groupSize)) {
        wall.cone(s.a, s.b, s.ra + 0.9 + 0.1 * s.ra, s.rb + 0.9 + 0.1 * s.rb)
        lumen.cone(s.a, s.b, s.ra, s.rb)
      }
    }
    treeNo++
    // the veins: their own tree from the hilum, running between the bronchi
    const vsegs = branchTree(rng, lobe.vein, Math.round(lobe.n * 0.8), sample, (lobe.r * 0.85) / Math.pow(lobe.n * 0.8, 0.36), 1.0)
    for (let g = 0; g < vsegs.length; g += 24) {
      const vp = b.part(`vein${treeNo}_${g}`, T.blood, { layer: 11, mobility: 0.8 })
      for (const s of vsegs.slice(g, g + 24)) vp.cone(s.a, s.b, s.ra, s.rb)
    }
  }

  // --- the bony thorax: ribs, cartilages, sternum, clavicles, scapulae ------------------------------------------------------------------
  const ribStart = (side: -1 | 1, k: number): { pts: V3[]; end: V3; sEnd: number; thEnd: number } => {
    const [drop, thEnd, , ] = RIBS[k - 1]
    const [, sT, pT] = UPPER_SPINE[7 - k]
    const d = levelDims(`T${k}`)
    const yT = pT * D
    const sTop = sT * H
    const yb = yT + d.hd + d.cd
    const pts: V3[] = [
      [side * d.hw * 0.8, yT + d.hd * 0.4, sTop + d.hh + 2],
      [side * (d.hw + 10), yT + d.hd + 3, sTop + d.hh * 0.6],
      [side * (d.tp - 1), yb + 1, sTop + 1],
    ]
    const s0 = sTop + 4 * H
    const c0 = cage(p, s0)
    const th0 = Math.asin(clamp((d.tp + 6) / c0.A, 0, 0.9))
    const n = 10
    let sEnd = s0
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const th = th0 + (thEnd - th0) * u
      const s = s0 - drop * H * Math.pow(u, 1.15)
      const c = cage(p, s)
      pts.push([side * c.A * Math.sin(th), c.cy + c.B * Math.cos(th), s])
      sEnd = s
    }
    return { pts, end: pts[pts.length - 1], sEnd, thEnd }
  }
  const sternumP = (s: number): number => {
    const c = cage(p, s)
    return c.cy - c.B * 0.99 - 3
  }
  for (const sd of [-1, 1] as const) {
    for (let k = 1; k <= 7; k++) {
      const r = ribStart(sd, k)
      const side = sd < 0 ? 'R' : 'L'
      boneTube(b, `rib${k}${side}`, r.pts, RIBS[k - 1][3], 1.7)
      // the costal cartilage rises to the sternum
      const rise = RIBS[k - 1][2] * H
      const cp: V3[] = []
      for (let i = 0; i <= 4; i++) {
        const u = i / 4
        const th = r.thEnd + (2.98 - r.thEnd) * u
        const s = r.sEnd + rise * Math.pow(u, 0.8)
        const c = cage(p, s)
        cp.push([sd * c.A * Math.sin(th), c.cy + c.B * Math.cos(th), s])
      }
      const cart = b.part(`costal${k}${side}`, T.cartilage, { layer: 19 })
      for (let i = 0; i + 1 < cp.length; i++) cart.capsule(cp[i], cp[i + 1], 4.4)
    }
    // ribs 8-12 are abdomen.ts's; their necks (to the vertebra) are added here
    const levels8: [number, number, number][] = [
      [8, 388, 2.3],
      [9, 362, 2.25],
      [10, 335, 2.1],
      [11, 307, 1.55],
      [12, 277, 1.1],
    ]
    for (const [lv, s, sw] of levels8) {
      void sw
      const d = levelDims(`T${lv}`)
      const v = [0, 0, 0]
      void v
      const row = lv === 8 ? [63] : lv === 9 ? [61] : lv === 10 ? [58] : lv === 11 ? [54] : [50]
      const yT = row[0] * D
      const sT = s * H
      const yb = yT + d.hd + d.cd
      // the first point of abdomen.ts's rib: th = 0.22 on the ring
      const sRib = sT - 70 * (0.22 / Math.PI) * H
      const [a, bb] = outlineAt(p, sRib)
      const first: V3 = [sd * (a - p.fat - 12) * Math.sin(0.22), (bb - p.fat - 12) * Math.cos(0.22), sRib]
      const neck: V3[] = [[sd * d.hw * 0.8, yT + d.hd * 0.4, sT + d.hh + 2], [sd * (d.hw + 10), yT + d.hd + 3, sT + d.hh * 0.6], [sd * (d.tp - 1), yb + 1, sT + 1], first]
      boneTube(b, `ribNeck${lv}${sd < 0 ? 'R' : 'L'}`, neck, lv >= 11 ? 4.6 : 5.4, 1.7)
    }
  }
  // the sternum: manubrium, body and xiphoid on the front of the ring
  const notchS = 600 * H
  lm.sternalNotch = [0, sternumP(notchS), notchS]
  const stP = (s: number): V3 => [0, sternumP(s), s]
  const stSeg = (name: string, s0: number, s1: number, hw: number, ht: number): void => {
    const a = stP(s0 * H)
    const e = stP(s1 * H)
    const c: V3 = [0, (a[1] + e[1]) / 2, (a[2] + e[2]) / 2]
    const ang = (Math.atan2(e[1] - a[1], a[2] - e[2]) * 180) / Math.PI
    const half = Math.hypot(a[1] - e[1], a[2] - e[2]) / 2
    b.part(`${name}Cortex`, T.cortical, { layer: 20 }).box(c, [hw, ht, half], 3, [ang, 0, 0])
    b.part(`${name}Marrow`, T.marrow, { layer: 21 }).box(c, [hw - 1.6, ht - 1.6, half - 1.6], 1.5, [ang, 0, 0])
  }
  stSeg('manubrium', 600, 552, 26, 7)
  stSeg('sternumBody1', 551, 500, 14.5, 5)
  stSeg('sternumBody2', 499, 448, 16, 5)
  stSeg('sternumBody3', 447, 396, 17, 5)
  b.part('xiphoid', T.cartilage, { layer: 19 }).capsule(stP(395 * H), stP(372 * H), 5)
  // the clavicles, curving from the manubrium over the first rib to the acromion
  const cf = cage(p, 596 * H)
  const pf = cf.cy - cf.B - 6
  for (const sd of [-1, 1] as const) {
    const pts: V3[] = [[sd * 12 * W, pf, 597 * H], [sd * 45 * W, pf - 6, 606 * H], [sd * 85 * W, pf - 3, 613 * H], [sd * 120 * W, pf + 22, 618 * H], [sd * 152 * W, 0, 620 * H]]
    boneTube(b, `clavicle${sd < 0 ? 'R' : 'L'}`, pts, 6, 2.2)
    // the scapula: a blade on the back of the ribs, its spine running out to the acromion
    const cs = cage(p, 500 * H)
    const xs = 72 * W
    const pb = cs.cy + cs.B * Math.sqrt(Math.max(0.05, 1 - (xs / cs.A) ** 2)) + 16
    const rot: V3 = [0, 0, -sd * 24]
    b.part(`scapula${sd < 0 ? 'R' : 'L'}Cortex`, T.cortical, { layer: 20 }).ellipsoid([sd * xs, pb, 524 * H], [34 * W, 3.8, 66 * H], rot)
    b.part(`scapula${sd < 0 ? 'R' : 'L'}Marrow`, T.marrow, { layer: 21 }).ellipsoid([sd * xs, pb, 524 * H], [31 * W, 1.6, 62 * H], rot)
    const spine: V3[] = [[sd * 62 * W, pb + 2, 590 * H], [sd * 92 * W, pb - 8, 598 * H], [sd * 122 * W, 62 * D, 608 * H], [sd * 146 * W, 28 * D, 614 * H], [sd * 156 * W, 0, 620 * H]]
    boneTube(b, `scapulaSpine${sd < 0 ? 'R' : 'L'}`, spine, 5, 1.8)
  }

  // --- the soft tissue of the chest wall, the back and the shoulders ------------------------------------------------------------------
  const wallLevels = [392, 430, 470, 520, 560, 590, 615, 640, 660]
  const wallPart = b.part('chestWall', T.muscle, { layer: 4 })
  for (let k = 0; k + 1 < wallLevels.length; k++) {
    const c0 = cage(p, wallLevels[k] * H)
    const c1 = cage(p, wallLevels[k + 1] * H)
    wallPart.taper(0, (c0.cy + c1.cy) / 2, wallLevels[k] * H, wallLevels[k + 1] * H, c0.A + 9, c0.B + 9, c1.A + 9, c1.B + 9)
  }
  wallPart.minus()
  for (let k = 0; k + 1 < wallLevels.length; k++) {
    const c0 = cage(p, wallLevels[k] * H)
    const c1 = cage(p, wallLevels[k + 1] * H)
    wallPart.taper(0, (c0.cy + c1.cy) / 2, wallLevels[k] * H - 1, wallLevels[k + 1] * H + 1, c0.A - 9, c0.B - 9, c1.A - 9, c1.B - 9)
  }
  const c5 = cage(p, 525 * H)
  for (const sd of [-1, 1] as const) {
    // the pectoral muscle on the front of the ribs
    b.part(`pectoral${sd}`, T.muscle, { layer: 5 }).ellipsoid([sd * 50 * W, c5.cy - c5.B - 2, 520 * H], [44 * W, 10 * D, 62 * H], [0, 0, -sd * 16]).ellipsoid([sd * 42 * W, cf.cy - cf.B - 4, 582 * H], [38 * W, 10 * D, 32 * H], [0, 0, -sd * 10])
    // the shoulder: a cap of fat and muscle outside the trunk's outline (the arm is out of the field)
    b.part(`shoulderFat${sd}`, T.fat, { layer: 1 }).ellipsoid(at(sd * 170, 6, 612), [26 * W, 56 * D, 34 * H])
    b.part(`shoulderMuscle${sd}`, T.muscle, { layer: 5 }).ellipsoid(at(sd * 168, 6, 610), [18 * W, 44 * D, 28 * H])
  }
  // the back: the erector spinae on either side of the spine and the trapezius over it, up to the neck
  const backLevels = [420, 470, 520, 570, 620, 660]
  const erector = (sd: -1 | 1): void => {
    const part = b.part(`erectorUp${sd}`, T.muscle, { layer: 5 })
    for (let k = 0; k + 1 < backLevels.length; k++) {
      const s0 = backLevels[k] * H
      const s1 = backLevels[k + 1] * H
      const y0 = outlineAt(p, s0)[1] - p.fat - 26
      const y1 = outlineAt(p, s1)[1] - p.fat - 26
      part.taper(sd * 36 * W, (y0 + y1) / 2, s0, s1, 24 * W - k * 2, 16 * D, 20 * W - k * 2, 14 * D)
    }
  }
  erector(-1)
  erector(1)
  const trap = b.part('trapezius', T.muscle, { layer: 5, smooth: 6 })
  for (let k = 0; k + 1 < backLevels.length; k++) {
    const s0 = backLevels[k] * H
    const s1 = backLevels[k + 1] * H
    const y0 = outlineAt(p, s0)[1] - p.fat - 14
    const y1 = outlineAt(p, s1)[1] - p.fat - 14
    const a0 = [62, 78, 96, 110, 90, 60][k] * W
    const a1 = [78, 96, 110, 90, 60, 50][k] * W
    trap.taper(0, (y0 + y1) / 2, s0, s1, a0, 9 * D, a1, 9 * D)
  }
  // the upper torso: above the heart the ring gives way to a mass of muscle (pectorals, trapezius, the muscles of the shoulder girdle and the
  // base of the neck) out to the abdomen's wall, with the fat planes between
  const torso = b.part('upperTorso', T.muscle, { layer: 4 })
  const tl: [number, number][] = [[530, 0], [570, 0.35], [600, 0.75], [630, 1], [665, 1], [680, 1]]
  for (let k = 0; k + 1 < tl.length; k++) {
    const row = (s: number, t: number): [number, number, number] => {
      const c = cage(p, s * H)
      const [oa, ob] = outlineAt(p, s * H)
      return [c.A + 9 + t * (oa - p.fat - 24 - c.A - 9), c.B + 9 + t * (ob - p.fat - 24 - c.B - 9), c.cy * (1 - t)]
    }
    const [a0, b0, y0] = row(tl[k][0], tl[k][1])
    const [a1, b1, y1] = row(tl[k + 1][0], tl[k + 1][1])
    torso.taper(0, (y0 + y1) / 2, tl[k][0] * H, tl[k + 1][0] * H, a0, b0, a1, b1)
  }

  // --- landmarks ------------------------------------------------------------------------------------------------------------------------
  lm.heart = at(36, -34, 462)
  return lm
}
