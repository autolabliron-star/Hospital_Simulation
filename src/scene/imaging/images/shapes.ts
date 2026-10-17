/**
 * The vocabulary of the image generators. An anatomy function turns (seed, slice position) into a `SliceModel`: a list of
 * shapes in a normalised square (x right, y down, -1..1), each tagged with a TISSUE. How bright a tissue is depends on the
 * modality (an MRI weighting, a CT window, a radiograph), so one anatomy serves several looks. Everything here is pure.
 */
import { mulberry32 } from '@/sim/rng'

export type Tissue =
  | 'air' //       gas, lung-free air, outside the body (black everywhere)
  | 'lung'
  | 'scalp' //     scalp and subcutaneous fat
  | 'fat'
  | 'muscle'
  | 'bone' //      cortical bone
  | 'marrow' //    cancellous bone and bone marrow
  | 'gm' //        grey matter
  | 'wm' //        white matter
  | 'csf' //       cerebrospinal fluid, vitreous, urine, bile, simple fluid
  | 'cord' //      spinal cord and nerve roots
  | 'disc' //      intervertebral disc nucleus
  | 'annulus' //   disc rim
  | 'vessel' //    arterial blood in a vessel (flow void on MRI, enhancing early on contrast CT)
  | 'vein' //      venous blood: like 'vessel', but it enhances later (portal venous phase)
  | 'cartilage'
  | 'meniscus'
  | 'ligament' //  ligaments and tendons
  | 'liver'
  | 'spleen'
  | 'kidney'
  | 'bowel'
  | 'heart'
  | 'organ' //     other soft-tissue organs (pancreas, thyroid, stomach wall)
  | 'cushion' //   the CT table and its pad

export interface EllipseP {
  k: 'e'
  t: Tissue
  cx: number
  cy: number
  rx: number
  ry: number
  rot?: number
  /** Opacity 0..1 (default 1). */
  a?: number
}

/** A closed shape through the listed points (x, y pairs), smoothed with quadratic curves. */
export interface PolyP {
  k: 'p'
  t: Tissue
  pts: number[]
  a?: number
}

/** An open stroke of width `w` (normalised units) through the listed points. */
export interface LineP {
  k: 'l'
  t: Tissue
  pts: number[]
  w: number
  a?: number
}

export type Prim = EllipseP | PolyP | LineP

export interface SliceModel {
  prims: Prim[]
  /** Annotations the anatomy wants drawn on the image (side markers etc.). */
  marker?: { text: string; x: number; y: number }
}

// ---------------------------------------------------------------------------------------------
// numeric helpers
// ---------------------------------------------------------------------------------------------

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const smooth = (a: number, b: number, x: number): number => {
  const k = clamp01((x - a) / (b - a))
  return k * k * (3 - 2 * k)
}
/** A smooth bump: 0 outside [a, b], 1 at the middle third, with smooth shoulders. */
export const bump = (z: number, a: number, b: number): number => {
  const w = (b - a) / 3
  return smooth(a, a + w, z) * (1 - smooth(b - w, b, z))
}

/** A few small, deterministic variations per exam seed (head size, tilt, wiggle phases...). */
export interface Variation {
  /** 0.95 .. 1.05 */
  size: number
  /** -0.04 .. 0.04 radians */
  tilt: number
  /** 0.9 .. 1.1 */
  organ: number
  /** phases for wiggles and jitter */
  phase: number[]
  /** raw stream for anything else */
  rand: () => number
}

export function variation(seed: number): Variation {
  const r = mulberry32((seed ^ 0x5bd1e995) >>> 0)
  const size = 0.95 + 0.1 * r()
  const tilt = (r() - 0.5) * 0.08
  const organ = 0.9 + 0.2 * r()
  const phase = Array.from({ length: 8 }, () => r() * Math.PI * 2)
  return { size, tilt, organ, phase, rand: mulberry32((seed ^ 0x27d4eb2f) >>> 0) }
}

/** Points of a wobbly closed curve: an ellipse whose radius is modulated by a few sines of the angle. */
export function wobble(cx: number, cy: number, rx: number, ry: number, waves: ReadonlyArray<readonly [amp: number, freq: number, phase: number]>, n = 72, rot = 0): number[] {
  const out: number[] = []
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2
    let r = 1
    for (const [a, f, p] of waves) r += a * Math.sin(f * th + p)
    const x = rx * r * Math.cos(th)
    const y = ry * r * Math.sin(th)
    out.push(cx + x * c - y * s, cy + x * s + y * c)
  }
  return out
}

/** A rounded rectangle as polygon points (corner radius r, `seg` points per corner), rotated about its centre. */
export function rrect(cx: number, cy: number, w: number, h: number, r: number, rot = 0, seg = 4): number[] {
  const hw = w / 2
  const hh = h / 2
  const rr = Math.min(r, hw, hh)
  const out: number[] = []
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const corners: [number, number, number][] = [
    [hw - rr, -hh + rr, -Math.PI / 2],
    [hw - rr, hh - rr, 0],
    [-hw + rr, hh - rr, Math.PI / 2],
    [-hw + rr, -hh + rr, Math.PI],
  ]
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2)
      const x = ox + rr * Math.cos(a)
      const y = oy + rr * Math.sin(a)
      out.push(cx + x * c - y * s, cy + x * s + y * c)
    }
  }
  return out
}

/** Points of a polyline sampled from a function of t in [0, 1]. */
export function curve(f: (t: number) => [number, number], n = 12): number[] {
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const [x, y] = f(i / n)
    out.push(x, y)
  }
  return out
}

export const ell = (t: Tissue, cx: number, cy: number, rx: number, ry: number, rot = 0, a = 1): EllipseP => ({ k: 'e', t, cx, cy, rx, ry, rot, a })
export const poly = (t: Tissue, pts: number[], a = 1): PolyP => ({ k: 'p', t, pts, a })
export const line = (t: Tissue, pts: number[], w: number, a = 1): LineP => ({ k: 'l', t, pts, w, a })

/** Mirror a list of points about x = 0 (x, y pairs). */
export function mirrorX(pts: number[]): number[] {
  const out = new Array<number>(pts.length)
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = -pts[i]
    out[i + 1] = pts[i + 1]
  }
  return out
}

/** Count the shapes and the total number of points in a model (a cheap complexity measure). */
export function modelSize(m: SliceModel): { prims: number; points: number } {
  let points = 0
  for (const p of m.prims) points += p.k === 'e' ? 1 : p.pts.length / 2
  return { prims: m.prims.length, points }
}

/** A flat fingerprint of a model's numbers, used to compare two models (determinism and smoothness tests). */
export function flatten(m: SliceModel): number[] {
  const out: number[] = []
  for (const p of m.prims) {
    if (p.k === 'e') out.push(p.cx, p.cy, p.rx, p.ry, p.rot ?? 0, p.a ?? 1)
    else {
      for (let i = 0; i < p.pts.length; i++) out.push(p.pts[i])
      if (p.k === 'l') out.push(p.w)
      out.push(p.a ?? 1)
    }
  }
  return out
}

/** The mean of a polygon's points (x, y pairs). */
export function centroid(pts: number[]): [number, number] {
  let cx = 0
  let cy = 0
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    cx += pts[i * 2]
    cy += pts[i * 2 + 1]
  }
  return [cx / n, cy / n]
}

/** A polygon shrunk toward its centroid by `k` (0..1 of the way in). */
export function shrink(pts: number[], k: number): number[] {
  const [cx, cy] = centroid(pts)
  return pts.map((q, i) => (i % 2 === 0 ? cx + (q - cx) * (1 - k) : cy + (q - cy) * (1 - k)))
}

/** A closed bone for MRI and CT: dense cortex (the outer shape) with the marrow inset inside it, so the cortex shows as a rim. */
export function addBone(prims: Prim[], pts: number[], a = 1, rim = 0.12): void {
  prims.push(poly('bone', pts, a))
  prims.push(poly('marrow', shrink(pts, rim), a))
}

/** A closed bone for a radiograph: the marrow fills the shape and a bright cortical outline runs round it (both add to the film). */
export function addXrayBone(prims: Prim[], pts: number[], a = 1, rim = 0.03): void {
  prims.push(poly('marrow', pts, a))
  prims.push(line('bone', [...pts, pts[0], pts[1]], rim, 0.75 * a))
}
