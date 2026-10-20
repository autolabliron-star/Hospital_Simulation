/**
 * R3 (endoscope): what the camera looks at, per procedure, as a field the plate bake (plates.ts) samples per pixel. Pure: no canvas, no randomness that is
 * not a seed. Clean and non-graphic by design: closed, intact organs under a glistening serosa, fat, fascia and fine surface vessels; nothing cut, nothing
 * red (noBlood.ts makes that a guarantee on top).
 *
 * Plate coordinates: x 0..16/9 left to right, y 0..1 top to bottom (the plate's height is the unit). The camera window (view.ts) shows about the middle
 * 86 %, so the edges are margin for panning.
 *
 *   cholecystectomy   the underside of the liver across the top, the gallbladder lying on it (retracted up toward the upper right: fundus up, the neck
 *                     and Hartmann's pouch toward the middle), the cystic duct running down-left into fat, a peritoneal veil over Calot's triangle,
 *                     the duodenum lower right and omental fat lower left.
 *   hysterectomy      the uterus in the middle (a big smooth dome), the round ligaments, fallopian tubes with their fimbriae and the ovaries on both
 *                     sides on the broad ligaments, the sigmoid colon with its fat tags behind, the bladder's peritoneal fold in front.
 *   prostatectomy     the bladder's dome across the top with its muscle fibres, the bladder neck, the prostate below it under a small fat pad with the
 *                     dorsal veins, the endopelvic fascia over the levator muscles at the sides, puboprostatic bands at the bottom.
 *
 * A layout is a background function plus a list of parts drawn back to front. Each part has a shape (an ellipse, a tapered tube along a polyline, or the
 * region above a wavy edge), a tissue, and a height profile (a rim height plus a dome that rises over `depth` inside the rim). A "film" part is a thin
 * translucent sheet (fascia, a peritoneal veil): it tints what is under it and barely adds height.
 */
import type { SurgeryProcedure } from '@/sim/types'
import { clamp01, distPolyline, fbm, Lattice, mix, polylineLengths, ridge, sdEllipse, smooth, vnoise, worley, type Cell, type OnLine } from './field'

/** The procedures in plate order (a plate per procedure, indexed like this). */
export const PROCEDURE_KEYS = ['cholecystectomy', 'hysterectomy', 'prostatectomy'] as const satisfies readonly SurgeryProcedure[]
export type ProcIndex = 0 | 1 | 2

export const procIndex = (p: SurgeryProcedure): ProcIndex => (p === 'hysterectomy' ? 1 : p === 'prostatectomy' ? 2 : 0)

export const PLATE_ASPECT = 16 / 9
const A = PLATE_ASPECT

/** The tissues. */
export const T = {
  peritoneum: 0,
  fat: 1,
  liver: 2,
  gallbladder: 3,
  bowel: 4,
  uterus: 5,
  ovary: 6,
  tube: 7,
  ligament: 8,
  bladder: 9,
  prostate: 10,
  fascia: 11,
  muscle: 12,
  duct: 13,
  vein: 14,
} as const
export type Tissue = (typeof T)[keyof typeof T]
export const TISSUE_NAMES = Object.keys(T) as (keyof typeof T)[]

/** One sample of the field: the albedo (sRGB 0..1), the height (0 far .. 1 near the camera), how wet and glossy, how much fine relief, the top tissue. */
export interface TissueSample {
  r: number
  g: number
  b: number
  h: number
  gloss: number
  micro: number
  tissue: number
}

export const newSample = (): TissueSample => ({ r: 0, g: 0, b: 0, h: 0, gloss: 0, micro: 0, tissue: 0 })

// ---------------------------------------------------------------------------------------------
// Noise sources (one lattice per role, so the patterns are independent)
// ---------------------------------------------------------------------------------------------

const L1 = new Lattice(0x51a7)
const L2 = new Lattice(0x2b9e)
const L3 = new Lattice(0x7c31)
const FAT_SEED = 0x6a11
const FOLLICLE_SEED = 0x3d07
const LIVER_SEED = 0x1f45

const _cell: Cell = { f1: 0, f2: 0, id: 0, px: 0, py: 0 }
const _on: OnLine = { d: 0, t: 0 }

/** Fine surface vessels: thin, branching, sparse lines (0..1), mauve or purple when drawn, never red. */
function vessels(x: number, y: number, scale: number, sparsity: number): number {
  const wx = x + 0.035 * (vnoise(L2, x * 7, y * 7) - 0.5)
  const wy = y + 0.035 * (vnoise(L2, x * 7 + 31, y * 7 + 17) - 0.5)
  const gate = smooth(sparsity, sparsity + 0.18, fbm(L2, x * 2.2 + 11, y * 2.2 + 3, 2))
  if (gate <= 0) return 0
  const big = smooth(0.93, 0.985, ridge(L1, wx * scale, wy * scale, 2))
  const fine = smooth(0.965, 0.995, ridge(L3, wx * scale * 2.6 + 9, wy * scale * 2.6 + 4, 1)) * 0.45
  return clamp01(Math.max(big, fine) * gate)
}

/** Streaks along a direction (fibres of fascia and muscle): fbm stretched `stretch` times across `dir`. */
function fibres(x: number, y: number, dir: number, along: number, stretch: number): number {
  const c = Math.cos(dir)
  const s = Math.sin(dir)
  const u = c * x + s * y
  const v = -s * x + c * y
  return fbm(L3, u * along, v * along * stretch, 3)
}

// ---------------------------------------------------------------------------------------------
// Tissues: albedo, gloss, fine relief, and a little height of their own (lobules, follicles, fibres)
// ---------------------------------------------------------------------------------------------

interface Mat {
  r: number
  g: number
  b: number
  gloss: number
  micro: number
  bump: number
}
const _m: Mat = { r: 0, g: 0, b: 0, gloss: 0, micro: 0, bump: 0 }

function set(m: Mat, r: number, g: number, b: number, gloss: number, micro: number, bump: number): void {
  m.r = r
  m.g = g
  m.b = b
  m.gloss = gloss
  m.micro = micro
  m.bump = bump
}

/** Mix a colour into the material by `k`. */
function tint(m: Mat, r: number, g: number, b: number, k: number): void {
  m.r = mix(m.r, r, k)
  m.g = mix(m.g, g, k)
  m.b = mix(m.b, b, k)
}

function shade(m: Mat, k: number): void {
  m.r *= k
  m.g *= k
  m.b *= k
}

function fatMat(x: number, y: number, m: Mat): void {
  // lobules: Worley cells, a low dome each, a little paler in the middle; thin orange-pink septa with fine capillaries between them; small sub-lobules
  worley(FAT_SEED, x * 12, y * 12, 0.95, _cell)
  const edge = _cell.f2 - _cell.f1
  // a rounded lobule: away from the septa and near its own middle
  const inside = 0.55 * smooth(0, 0.42, edge) + 0.45 * smooth(0.95, 0.15, _cell.f1)
  const id = _cell.id
  // small sub-lobules: a cheap fine noise instead of a second cell pass
  const sub = vnoise(L3, x * 30, y * 30)
  const tone = 0.5 + 0.5 * fbm(L2, x * 3 + 21, y * 3 + 4, 2)
  set(m, mix(0.99, 0.95, id), mix(0.84, 0.73, id * tone), mix(0.45, 0.34, id), 0.95, 0.9, 0.0075 * Math.pow(inside, 0.7) + 0.002 * sub)
  shade(m, 0.88 + 0.1 * inside + 0.04 * sub)
  tint(m, 0.93, 0.7, 0.5, smooth(0.06, 0, edge) * 0.38)
  tint(m, 0.8, 0.56, 0.58, vessels(x, y, 9, 0.5) * 0.35)
}

function serosaMat(x: number, y: number, m: Mat): void {
  const n = fbm(L1, x * 5, y * 5, 3)
  set(m, 0.88, 0.61, 0.53, 0.65, 0.3, 0.003 * n)
  shade(m, 0.88 + 0.2 * n)
  // fat showing through the thin peritoneum
  tint(m, 0.93, 0.79, 0.52, smooth(0.52, 0.72, fbm(L2, x * 3 + 5, y * 3, 3)) * 0.4)
  tint(m, 0.76, 0.48, 0.5, vessels(x, y, 7, 0.48) * 0.55)
}

function material(tissue: number, x: number, y: number, dir: number, m: Mat): void {
  switch (tissue) {
    case T.fat:
      fatMat(x, y, m)
      return
    case T.liver: {
      const n = fbm(L1, x * 5 + 3, y * 5, 3)
      worley(LIVER_SEED, x * 55, y * 55, 0.8, _cell)
      set(m, 0.47, 0.26, 0.23, 0.9, 0.2, 0.0015 * n)
      shade(m, (0.88 + 0.22 * n) * (0.96 + 0.04 * smooth(0, 0.2, _cell.f2 - _cell.f1)))
      // the capsule's paler bloom here and there
      tint(m, 0.55, 0.36, 0.33, smooth(0.6, 0.85, fbm(L3, x * 3, y * 3, 2)) * 0.25)
      return
    }
    case T.gallbladder: {
      const n = fbm(L1, x * 4 + 7, y * 4 + 2, 3)
      set(m, 0.62, 0.67, 0.6, 1, 0.3, 0.002 * n)
      shade(m, 0.9 + 0.16 * n)
      tint(m, 0.8, 0.83, 0.77, smooth(0.5, 0.78, fbm(L2, x * 5, y * 5, 3)) * 0.55)
      tint(m, 0.66, 0.5, 0.58, vessels(x, y, 11, 0.36) * 0.6)
      return
    }
    case T.bowel: {
      const n = fbm(L1, x * 7 + 1, y * 7 + 9, 3)
      set(m, 0.9, 0.59, 0.49, 0.8, 0.35, 0.003 * n)
      shade(m, 0.9 + 0.16 * n)
      tint(m, 0.68, 0.45, 0.55, vessels(x + 3, y, 8, 0.4) * 0.7)
      return
    }
    case T.uterus: {
      const n = fbm(L1, x * 4 + 13, y * 4 + 5, 3)
      set(m, 0.87, 0.6, 0.58, 0.95, 0.22, 0.0015 * n)
      shade(m, 0.92 + 0.12 * n)
      tint(m, 0.76, 0.52, 0.58, vessels(x + 7, y + 2, 6, 0.5) * 0.4)
      return
    }
    case T.ovary: {
      worley(FOLLICLE_SEED, x * 34, y * 34, 0.85, _cell)
      const f = smooth(0.42, 0.12, _cell.f1)
      set(m, 0.91, 0.8, 0.75, 0.6, 0.35, 0.005 * f)
      tint(m, 0.86, 0.8, 0.82, f * 0.35)
      return
    }
    case T.tube: {
      const n = fibres(x, y, dir, 9, 3)
      set(m, 0.88, 0.6, 0.59, 0.85, 0.45, 0.004 * n)
      shade(m, 0.9 + 0.16 * n)
      tint(m, 0.72, 0.48, 0.58, vessels(x, y + 4, 12, 0.45) * 0.5)
      return
    }
    case T.ligament: {
      const n = fbm(L2, x * 6 + 2, y * 6 + 8, 3)
      set(m, 0.88, 0.69, 0.65, 0.75, 0.4, 0.003 * n)
      shade(m, 0.92 + 0.12 * n)
      tint(m, 0.74, 0.5, 0.56, vessels(x + 5, y + 5, 8, 0.45) * 0.5)
      return
    }
    case T.bladder: {
      const n = fibres(x, y, dir, 4, 9)
      set(m, 0.8, 0.6, 0.54, 0.55, 0.3, 0.0015 * n)
      shade(m, 0.88 + 0.18 * n)
      tint(m, 0.7, 0.5, 0.58, vessels(x + 2, y + 6, 7, 0.45) * 0.6)
      return
    }
    case T.prostate: {
      const n = fbm(L1, x * 6 + 4, y * 6 + 1, 3)
      set(m, 0.84, 0.65, 0.57, 0.8, 0.35, 0.003 * n)
      shade(m, 0.9 + 0.16 * n)
      tint(m, 0.62, 0.46, 0.6, vessels(x + 9, y + 1, 10, 0.4) * 0.6)
      return
    }
    case T.fascia: {
      const n = fibres(x, y, dir, 5, 10)
      set(m, 0.9, 0.8, 0.76, 0.7, 0.4, 0.0015 * n)
      shade(m, 0.88 + 0.16 * n)
      return
    }
    case T.muscle: {
      const n = fibres(x, y, dir, 4, 12)
      set(m, 0.78, 0.46, 0.39, 0.5, 0.3, 0.004 * n)
      shade(m, 0.84 + 0.24 * n)
      return
    }
    case T.duct: {
      const n = fbm(L2, x * 9, y * 9, 2)
      set(m, 0.86, 0.8, 0.68, 0.55, 0.2, 0.0015 * n)
      shade(m, 0.92 + 0.12 * n)
      return
    }
    case T.vein: {
      const n = fbm(L3, x * 12, y * 12, 2)
      set(m, 0.58, 0.47, 0.64, 0.9, 0.2, 0.001 * n)
      shade(m, 0.92 + 0.12 * n)
      return
    }
    default:
      serosaMat(x, y, m)
  }
}

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------

const ELLIPSE = 0
const TUBE = 1
const ABOVE = 2

interface Part {
  tissue: number
  kind: number
  cx: number
  cy: number
  rx: number
  ry: number
  rot: number
  pts: Float64Array
  acc: Float64Array
  r0: number
  r1: number
  /** ABOVE: the edge is y = e0 + e1 x + amp sin(freq x + ph). */
  e0: number
  e1: number
  amp: number
  freq: number
  ph: number
  base: number
  dome: number
  depth: number
  edge: number
  wobble: number
  film: number
  dir: number
  /** A box around everything the part can touch (its shape, edge and wobble): a sample outside it skips the part. */
  x0: number
  y0: number
  x1: number
  y1: number
}

const EMPTY = new Float64Array(0)

function part(tissue: number, over: Partial<Part>): Part {
  return boxed({
    tissue,
    kind: ELLIPSE,
    cx: 0,
    cy: 0,
    rx: 0.1,
    ry: 0.1,
    rot: 0,
    pts: EMPTY,
    acc: EMPTY,
    r0: 0.03,
    r1: 0.03,
    e0: 0,
    e1: 0,
    amp: 0,
    freq: 0,
    ph: 0,
    base: 0.4,
    dome: 0.1,
    depth: 0.1,
    edge: 0.012,
    wobble: 0.015,
    film: 0,
    dir: 0,
    x0: -Infinity,
    y0: -Infinity,
    x1: Infinity,
    y1: Infinity,
    ...over,
  })
}

/** Set a part's box (an ABOVE part keeps the whole plate). */
function boxed(p: Part): Part {
  const m = p.edge + p.wobble + 0.004
  if (p.kind === ELLIPSE) {
    const r = Math.max(p.rx, p.ry) + m
    p.x0 = p.cx - r
    p.x1 = p.cx + r
    p.y0 = p.cy - r
    p.y1 = p.cy + r
  } else if (p.kind === TUBE) {
    const r = Math.max(p.r0, p.r1) + m
    p.x0 = Infinity
    p.y0 = Infinity
    p.x1 = -Infinity
    p.y1 = -Infinity
    for (let i = 0; i < p.pts.length; i += 2) {
      p.x0 = Math.min(p.x0, p.pts[i] - r)
      p.x1 = Math.max(p.x1, p.pts[i] + r)
      p.y0 = Math.min(p.y0, p.pts[i + 1] - r)
      p.y1 = Math.max(p.y1, p.pts[i + 1] + r)
    }
  }
  return p
}

const ellipse = (tissue: number, cx: number, cy: number, rx: number, ry: number, rot: number, over: Partial<Part> = {}): Part =>
  part(tissue, { kind: ELLIPSE, cx, cy, rx, ry, rot, depth: Math.min(rx, ry), dir: rot, ...over })

function tube(tissue: number, xy: readonly number[], r0: number, r1: number, over: Partial<Part> = {}): Part {
  const pts = Float64Array.from(xy)
  const dir = Math.atan2(xy[xy.length - 1] - xy[1], xy[xy.length - 2] - xy[0])
  return part(tissue, { kind: TUBE, pts, acc: polylineLengths(pts), r0, r1, dir, depth: 1, ...over })
}

/** The same part mirrored about the plate's vertical middle. */
function mirror(p: Part): Part {
  const pts = Float64Array.from(p.pts)
  for (let i = 0; i < pts.length; i += 2) pts[i] = A - pts[i]
  return boxed({ ...p, cx: A - p.cx, rot: -p.rot, dir: Math.PI - p.dir, pts, acc: p.kind === TUBE ? polylineLengths(pts) : p.acc })
}

// ---------------------------------------------------------------------------------------------
// The three layouts
// ---------------------------------------------------------------------------------------------

interface Layout {
  /** The deep background: tissue, albedo and a low height. */
  background(x: number, y: number, m: Mat, out: TissueSample): void
  parts: readonly Part[]
}

/** Peritoneum with fat in it, low and far from the camera. */
function deepBackground(fatShare: number, low: number): Layout['background'] {
  return (x, y, m, out) => {
    const f = smooth(fatShare - 0.08, fatShare + 0.08, fbm(L2, x * 2.6 + 41, y * 2.6 + 7, 3))
    if (f > 0.5) {
      fatMat(x, y, m)
      out.tissue = T.fat
    } else {
      serosaMat(x, y, m)
      out.tissue = T.peritoneum
    }
    out.h = low + 0.07 * fbm(L1, x * 1.7 + 3, y * 1.7 + 9, 2) + m.bump
  }
}

const CHOLE: Layout = {
  background: deepBackground(0.5, 0.24),
  parts: [
    // duodenum lower right, omental fat lower left
    ellipse(T.bowel, 1.45, 0.99, 0.46, 0.24, -0.25, { base: 0.3, dome: 0.16, depth: 0.2, wobble: 0.02 }),
    ellipse(T.fat, 0.3, 0.99, 0.64, 0.28, 0.15, { base: 0.36, dome: 0.1, depth: 0.22, wobble: 0.03, edge: 0.02 }),
    // fat in Calot's triangle, under a thin peritoneal veil
    ellipse(T.fat, 0.66, 0.7, 0.25, 0.14, 0.55, { base: 0.42, dome: 0.07, depth: 0.1, wobble: 0.025, edge: 0.02 }),
    ellipse(T.fascia, 0.7, 0.66, 0.21, 0.1, 0.6, { film: 0.42, wobble: 0.03, edge: 0.03 }),
    // the underside of the liver across the top, its edge running down to the left
    part(T.liver, { kind: ABOVE, e0: 0.43, e1: -0.11 / A, amp: 0.022, freq: 3.1, ph: 0.7, base: 0.55, dome: 0.22, depth: 0.35, edge: 0.008, wobble: 0.012 }),
    // the cystic duct down into the fat, with peritoneal strands over it
    tube(T.duct, [0.86, 0.54, 0.71, 0.64, 0.57, 0.74, 0.42, 0.87], 0.036, 0.029, { base: 0.46, dome: 0.03, depth: 1.4, wobble: 0.006 }),
    tube(T.fascia, [0.83, 0.49, 0.66, 0.6, 0.52, 0.64], 0.02, 0.016, { film: 0.5, wobble: 0.01, edge: 0.012 }),
    tube(T.fascia, [0.9, 0.6, 0.76, 0.74, 0.66, 0.84], 0.016, 0.012, { film: 0.45, wobble: 0.01, edge: 0.012 }),
    // the gallbladder on the liver: the fundus retracted to the upper right, the neck and Hartmann's pouch in the middle
    tube(T.gallbladder, [1.4, 0.09, 1.2, 0.25, 1.0, 0.39, 0.86, 0.52], 0.175, 0.075, { base: 0.66, dome: 0.12, depth: 1.3, wobble: 0.012 }),
    ellipse(T.gallbladder, 0.93, 0.46, 0.105, 0.078, 0.6, { base: 0.66, dome: 0.08, wobble: 0.01 }),
  ],
}

const HYST_LEFT: Part[] = [
  // the broad ligament, the round ligament, the ovary, the tube with its fimbriae, the utero-ovarian ligament
  ellipse(T.ligament, 0.46, 0.58, 0.4, 0.2, -0.25, { base: 0.3, dome: 0.05, wobble: 0.03, edge: 0.02 }),
  tube(T.tube, [0.66, 0.36, 0.45, 0.3, 0.22, 0.3, 0.02, 0.38], 0.026, 0.02, { base: 0.38, dome: 0.016, depth: 2, wobble: 0.01 }),
  ellipse(T.ovary, 0.38, 0.69, 0.1, 0.066, 0.35, { base: 0.38, dome: 0.06, depth: 0.09 }),
  tube(T.tube, [0.64, 0.43, 0.52, 0.47, 0.4, 0.52, 0.31, 0.6, 0.25, 0.7], 0.028, 0.046, { base: 0.4, dome: 0.03, depth: 1.5, wobble: 0.014 }),
  tube(T.ligament, [0.64, 0.5, 0.53, 0.6, 0.45, 0.66], 0.018, 0.015, { base: 0.38, dome: 0.012, depth: 2 }),
]

const HYST: Layout = {
  background: deepBackground(0.55, 0.14),
  parts: [
    // the pelvic side walls
    ellipse(T.peritoneum, -0.05, 0.55, 0.4, 0.75, 0, { base: 0.25, dome: 0.12, depth: 0.25, wobble: 0.03 }),
    ellipse(T.peritoneum, A + 0.05, 0.55, 0.4, 0.75, 0, { base: 0.25, dome: 0.12, depth: 0.25, wobble: 0.03 }),
    // the sigmoid behind, with its fat tags
    ellipse(T.bowel, 0.5, 0.08, 0.5, 0.17, 0.08, { base: 0.26, dome: 0.13, depth: 0.15 }),
    ellipse(T.bowel, 1.3, 0.05, 0.52, 0.15, -0.1, { base: 0.26, dome: 0.13, depth: 0.14 }),
    ellipse(T.fat, 0.75, 0.16, 0.07, 0.045, 0.3, { base: 0.37, dome: 0.03 }),
    ellipse(T.fat, 1.05, 0.13, 0.06, 0.04, -0.4, { base: 0.37, dome: 0.03 }),
    ellipse(T.fat, 0.32, 0.2, 0.06, 0.035, 0.1, { base: 0.37, dome: 0.03 }),
    ...HYST_LEFT,
    ...HYST_LEFT.map(mirror),
    // the uterus, and the bladder's peritoneal fold in front of it
    ellipse(T.uterus, A / 2, 0.5, 0.3, 0.27, 0, { base: 0.46, dome: 0.3, depth: 0.32, wobble: 0.012, edge: 0.016 }),
    ellipse(T.peritoneum, A / 2, 1.02, 0.6, 0.17, 0, { base: 0.4, dome: 0.06, depth: 0.12 }),
  ],
}

const PROST_LEFT: Part[] = [
  ellipse(T.muscle, 0.02, 0.62, 0.42, 0.62, 0.15, { base: 0.26, dome: 0.1, depth: 0.25, dir: 1.1 }),
  ellipse(T.fascia, 0.3, 0.7, 0.22, 0.32, 0.35, { film: 0.35, dir: 1.2, wobble: 0.03, edge: 0.03 }),
  ellipse(T.fat, 0.42, 0.4, 0.25, 0.18, 0.3, { base: 0.32, dome: 0.06, wobble: 0.03 }),
  tube(T.fascia, [0.78, 0.9, 0.68, 1.03], 0.022, 0.03, { base: 0.6, dome: 0.03, dir: 2.2 }),
]

const PROST: Layout = {
  background: deepBackground(0.45, 0.12),
  parts: [
    ...PROST_LEFT,
    ...PROST_LEFT.map(mirror),
    // the bladder's dome, its neck, the prostate under a small fat pad, the dorsal veins on it
    ellipse(T.bladder, A / 2, 0.16, 0.66, 0.36, 0, { base: 0.42, dome: 0.24, depth: 0.34, dir: 0.2, edge: 0.016 }),
    ellipse(T.bladder, A / 2, 0.47, 0.22, 0.1, 0, { base: 0.46, dome: 0.05, dir: 1.5, edge: 0.016 }),
    ellipse(T.prostate, A / 2, 0.74, 0.3, 0.22, 0, { base: 0.44, dome: 0.2, depth: 0.24, edge: 0.016 }),
    ellipse(T.fat, A / 2, 0.6, 0.16, 0.075, 0, { base: 0.56, dome: 0.04, wobble: 0.025 }),
    tube(T.vein, [A / 2, 0.99, A / 2 - 0.014, 0.88, A / 2 - 0.03, 0.8], 0.011, 0.008, { base: 0.62, dome: 0.008, depth: 1.6, wobble: 0.006 }),
    tube(T.vein, [0.8, 0.97, 0.82, 0.87, 0.83, 0.79], 0.009, 0.007, { base: 0.62, dome: 0.006, depth: 1.6, wobble: 0.006 }),
    tube(T.vein, [0.98, 0.97, 0.955, 0.87, 0.945, 0.79], 0.009, 0.007, { base: 0.62, dome: 0.006, depth: 1.6, wobble: 0.006 }),
    ellipse(T.fascia, A / 2, 0.9, 0.2, 0.12, 0, { film: 0.45, dir: 1.57, wobble: 0.03, edge: 0.03 }),
  ],
}

const LAYOUTS: readonly Layout[] = [CHOLE, HYST, PROST]

/** Points every plate must show its organ at (the tests sample them). */
export const LANDMARKS: readonly (readonly { name: string; x: number; y: number; tissue: number }[])[] = [
  [
    { name: 'liver', x: 0.35, y: 0.14, tissue: T.liver },
    { name: 'gallbladder fundus', x: 1.25, y: 0.22, tissue: T.gallbladder },
    { name: 'gallbladder neck', x: 0.95, y: 0.45, tissue: T.gallbladder },
    { name: 'cystic duct', x: 0.57, y: 0.74, tissue: T.duct },
    { name: 'duodenum', x: 1.5, y: 0.93, tissue: T.bowel },
    { name: 'omental fat', x: 0.2, y: 0.93, tissue: T.fat },
  ],
  [
    { name: 'uterus', x: A / 2, y: 0.5, tissue: T.uterus },
    { name: 'left ovary', x: 0.38, y: 0.69, tissue: T.ovary },
    { name: 'right ovary', x: A - 0.38, y: 0.69, tissue: T.ovary },
    { name: 'left tube', x: 0.4, y: 0.52, tissue: T.tube },
    { name: 'sigmoid', x: 0.5, y: 0.06, tissue: T.bowel },
  ],
  [
    { name: 'bladder', x: A / 2, y: 0.2, tissue: T.bladder },
    { name: 'prostate', x: A / 2 + 0.15, y: 0.8, tissue: T.prostate },
    { name: 'fat pad', x: A / 2 + 0.06, y: 0.6, tissue: T.fat },
    { name: 'left levator', x: 0.08, y: 0.5, tissue: T.muscle },
  ],
]

// ---------------------------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------------------------

/** Per part, for one sample: its distance (wobble included; +inf when far outside) and its dome depth there. */
const _dist = new Float64Array(64)
const _deep = new Float64Array(64)

/** The signed distance (negative inside) of a part at (x, y) without its wobble; the dome's depth there goes into `_depth`. */
let _depth = 0.1

function rawDistance(p: Part, x: number, y: number): number {
  if (p.kind === ELLIPSE) {
    _depth = p.depth
    return sdEllipse(x, y, p.cx, p.cy, p.rx, p.ry, p.rot)
  }
  if (p.kind === TUBE) {
    distPolyline(x, y, p.pts, p.acc, _on)
    const r = mix(p.r0, p.r1, _on.t)
    _depth = r * p.depth
    return _on.d - r
  }
  // ABOVE: inside is above the edge (smaller y)
  _depth = p.depth
  return y - (p.e0 + p.e1 * x + p.amp * Math.sin(p.freq * x + p.ph))
}

/** Sample procedure `proc`'s field at plate point (x, y). Writes into `out`. */
export function sampleAnatomy(proc: ProcIndex, x: number, y: number, out: TissueSample): TissueSample {
  const lay = LAYOUTS[proc]
  const m = _m
  const parts = lay.parts
  // front to back: the distances, and the last solid part that covers this point completely (nothing under it can show)
  let start = -1
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) {
      _dist[i] = Infinity
      continue
    }
    const raw = rawDistance(p, x, y)
    _deep[i] = _depth
    if (raw > p.edge + p.wobble) {
      _dist[i] = Infinity
      continue
    }
    const d = raw + p.wobble * (fbm(L1, x * 7 + p.cx * 13, y * 7 + p.cy * 11, 2) - 0.5) * 2
    _dist[i] = d
    if (p.film === 0 && d <= -p.edge) start = i
  }
  let r = 0
  let g = 0
  let b = 0
  let gloss = 0
  let micro = 0
  let h = 0
  if (start < 0) {
    lay.background(x, y, m, out)
    r = m.r
    g = m.g
    b = m.b
    gloss = m.gloss
    micro = m.micro
    h = out.h
  }
  for (let i = start < 0 ? 0 : start; i < parts.length; i++) {
    const d = _dist[i]
    const p = parts[i]
    if (d > p.edge) continue
    const cov = i === start ? 1 : smooth(p.edge, -p.edge, d)
    material(p.tissue, x, y, p.dir, m)
    if (p.film > 0) {
      const k = cov * p.film
      r = mix(r, m.r, k)
      g = mix(g, m.g, k)
      b = mix(b, m.b, k)
      gloss = mix(gloss, m.gloss, k)
      micro = mix(micro, m.micro, k)
      h += 0.006 * cov
      if (k > 0.35) out.tissue = p.tissue
      continue
    }
    const q = clamp01(-d / _deep[i])
    const ph = p.base + p.dome * Math.sqrt(1 - (1 - q) * (1 - q)) + m.bump
    r = mix(r, m.r, cov)
    g = mix(g, m.g, cov)
    b = mix(b, m.b, cov)
    gloss = mix(gloss, m.gloss, cov)
    micro = mix(micro, m.micro, cov)
    h = mix(h, ph, cov)
    if (cov > 0.5) out.tissue = p.tissue
  }
  // a slow warm-cool drift over everything, so no tissue is one flat colour
  const drift = vnoise(L3, x * 1.3 + 50, y * 1.3 + 20) - 0.5
  out.r = r
  out.g = g * (1 + 0.1 * drift)
  out.b = b * (1 + 0.16 * drift)
  out.gloss = gloss
  out.micro = micro
  out.h = h
  return out
}
