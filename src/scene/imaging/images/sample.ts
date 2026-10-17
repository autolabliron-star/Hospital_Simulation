/**
 * A tiny software rasteriser for `SliceModel`s: point-samples the shapes (painter's order, same blending rules as the canvas
 * painter) into a grey grid. It exists for the node tests and for previews: it proves the anatomy is non-empty, that fluid is bright
 * on T2, that bone is white on CT, and so on, without a canvas.
 */
import type { Look } from './looks'
import { toneOf } from './looks'
import { isAdditive, XRAY_TONE } from './tones'
import type { Prim, SliceModel } from './shapes'

function inPoly(pts: number[], x: number, y: number): boolean {
  let inside = false
  const n = pts.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2]
    const yi = pts[i * 2 + 1]
    const xj = pts[j * 2]
    const yj = pts[j * 2 + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distSeg(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Does the shape cover the point (x, y) (normalised coordinates)? */
export function covers(p: Prim, x: number, y: number): boolean {
  if (p.k === 'e') {
    if (p.rx <= 1e-6 || p.ry <= 1e-6) return false
    const c = Math.cos(p.rot ?? 0)
    const s = Math.sin(p.rot ?? 0)
    const dx = x - p.cx
    const dy = y - p.cy
    const u = (dx * c + dy * s) / p.rx
    const v = (-dx * s + dy * c) / p.ry
    return u * u + v * v <= 1
  }
  if (p.k === 'p') return p.pts.length >= 6 && inPoly(p.pts, x, y)
  const half = p.w / 2
  if (half <= 1e-6) return false
  for (let i = 0; i + 3 < p.pts.length; i += 2) if (distSeg(p.pts[i], p.pts[i + 1], p.pts[i + 2], p.pts[i + 3], x, y) <= half) return true
  return false
}

/** Grey grid n x n (row-major, 0..1) of a model seen through a look. */
export function rasterize(model: SliceModel, look: Look, n: number): Float32Array {
  const out = new Float32Array(n * n).fill(look.background)
  for (const p of model.prims) {
    const a = p.a ?? 1
    if (a <= 0.001) continue
    const tone = toneOf(look, p.t)
    const add = look.additive && isAdditive(p.t)
    for (let j = 0; j < n; j++) {
      const y = ((j + 0.5) / n) * 2 - 1
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * 2 - 1
        if (!covers(p, x, y)) continue
        const k = j * n + i
        out[k] = add ? Math.min(1, out[k] + tone * a) : out[k] * (1 - a) + tone * a
      }
    }
  }
  return out
}

/** Mean grey of the pixels a tissue covers last (what you actually see of it), or NaN if it never shows. Used to test contrast rules. */
export function visibleTone(model: SliceModel, look: Look, tissue: Prim['t'], n = 96): number {
  const g = rasterize(model, look, n)
  // a pixel "shows" the tissue when the LAST shape covering it has that tissue
  let sum = 0
  let count = 0
  for (let j = 0; j < n; j++) {
    const y = ((j + 0.5) / n) * 2 - 1
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * 2 - 1
      let last: Prim | null = null
      for (const p of model.prims) if ((p.a ?? 1) > 0.5 && covers(p, x, y)) last = p
      if (last && last.t === tissue) {
        sum += g[j * n + i]
        count++
      }
    }
  }
  return count === 0 ? NaN : sum / count
}

/** Fraction of grid pixels brighter than the background by more than `eps`, and the spread (max - min), for "is this image non-empty". */
export function imageStats(g: Float32Array): { mean: number; min: number; max: number; sd: number } {
  let s = 0
  let s2 = 0
  let min = 1
  let max = 0
  for (const v of g) {
    s += v
    s2 += v * v
    if (v < min) min = v
    if (v > max) max = v
  }
  const mean = s / g.length
  return { mean, min, max, sd: Math.sqrt(Math.max(0, s2 / g.length - mean * mean)) }
}

export const XRAY_BASE = XRAY_TONE
