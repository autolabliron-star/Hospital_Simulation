/**
 * R5 (the stages): the small sprites the step-by-step pictures lay over the tissue, in one more atlas (the instrument atlas of sprites.ts is untouched).
 * Built once per page, shaded per pixel with the same raster the instruments use (pure arithmetic, deterministic), and read by the per-frame compositor
 * (stages.ts) with `drawImage` only:
 *
 *   blob            a soft round patch of cleared tissue: pale, warm, a little mottled (laid over the places the dissection has been through)
 *   glow            the dye's green glow (Firefly): a soft bright dot, stamped along a duct, added to the picture
 *   bagGallbladder  the pale retrieval bag with the gallbladder inside it (a thin film, a bright rim, a streak of light, the neck the string leaves by)
 *   bagProstate     the same bag with the prostate inside
 *
 * Nothing here is red: the specimens are grey-green and beige, the film blue-white (decals.test.ts checks every pixel against the no-blood tiers).
 */
import type { Env, Surface } from '@/scene/imaging/images/ctx'
import { clamp01, Lattice, smooth, vnoise } from './field'
import { raster, type Px, type Rect } from './sprites'

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

export const DECAL_W = 256
export const DECAL_H = 160
/** The rectangles of the atlas (each keeps a 2 px clear margin inside it, like the instrument atlas). */
export const DECAL = {
  blob: r(0, 0, 64, 64),
  glow: r(64, 0, 64, 64),
  bagGallbladder: r(0, 64, 128, 96),
  bagProstate: r(128, 64, 128, 96),
} as const

/** The colours the decals use, 0..255 (the tests read them). */
export const DECAL_COLOURS = {
  cleared: [247, 228, 208],
  glow: [70, 255, 140],
  film: [226, 236, 242],
  gallbladder: [168, 184, 160],
  prostate: [226, 186, 168],
} as const

const L = new Lattice(0x2d11)

function blobPx(u: number, v: number, _px: number, out: Px): void {
  const x = (u - 0.5) * 2
  const y = (v - 0.5) * 2
  const d = Math.sqrt(x * x + y * y)
  // a rounded middle and a long soft edge, mottled a little so a patch never looks airbrushed
  const mottle = 0.78 + 0.44 * vnoise(L, u * 6, v * 6)
  out.r = DECAL_COLOURS.cleared[0]
  out.g = DECAL_COLOURS.cleared[1]
  out.b = DECAL_COLOURS.cleared[2]
  out.a = Math.pow(smooth(1, 0.12, d), 1.3) * mottle
}

function glowPx(u: number, v: number, _px: number, out: Px): void {
  const x = (u - 0.5) * 2
  const y = (v - 0.5) * 2
  const d2 = x * x + y * y
  out.r = DECAL_COLOURS.glow[0]
  out.g = DECAL_COLOURS.glow[1]
  out.b = DECAL_COLOURS.glow[2]
  out.a = Math.exp(-d2 * 3.4) * smooth(1, 0.7, Math.sqrt(d2))
}

/** A bag with a specimen in it: the sack is an ellipse with a short neck to the upper right; its film is faint in the middle and bright at the rim. */
function bagPx(specimen: readonly number[]): (u: number, v: number, px: number, out: Px) => void {
  return (u, v, _px, out) => {
    const x = (u - 0.46) / 0.43
    const y = (v - 0.56) / 0.38
    const d = Math.sqrt(x * x + y * y)
    const body = smooth(1, 0.94, d)
    // the neck: a short, narrow ellipse leaving the sack toward the upper right
    const nx = (u - 0.8 + (v - 0.24) * 0.5) / 0.12
    const ny = (v - 0.24) / 0.085
    const neck = smooth(1, 0.8, Math.sqrt(nx * nx + ny * ny)) * 0.55
    // the film: thin in the middle, bright where it folds at the rim, one soft streak of light across it
    const rim = smooth(0.5, 0.98, d)
    const streak = smooth(0.1, 0, Math.abs(x * 0.62 + y * 0.78 + 0.22)) * smooth(1, 0.5, d)
    const film = body * (0.14 + 0.56 * rim + 0.34 * streak)
    // the specimen inside, lit from the upper left
    const sx = (u - 0.44) / 0.26
    const sy = (v - 0.58) / 0.21
    const sd = Math.sqrt(sx * sx + sy * sy)
    const inside = smooth(1, 0.8, sd) * body
    const lit = 0.84 + 0.26 * clamp01(0.5 - (sx * 0.5 + sy * 0.7) * 0.5)
    const fa = Math.max(film, neck)
    const sa = inside * 0.92
    const a = Math.max(fa, sa)
    if (a <= 0) return
    // specimen under the film: the specimen's colour where it is, the film's over the rest
    const k = sa / (sa + fa * (1 - sa) + 1e-6)
    out.r = DECAL_COLOURS.film[0] * (1 - k) + specimen[0] * lit * k
    out.g = DECAL_COLOURS.film[1] * (1 - k) + specimen[1] * lit * k
    out.b = DECAL_COLOURS.film[2] * (1 - k) + specimen[2] * lit * k
    out.a = a
  }
}

/** The atlas's pixels (RGBA, DECAL_W x DECAL_H). Pure: the same every time. */
export function decalPixels(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(DECAL_W * DECAL_H * 4)
  raster(buf, DECAL_W, DECAL.blob, blobPx)
  raster(buf, DECAL_W, DECAL.glow, glowPx)
  raster(buf, DECAL_W, DECAL.bagGallbladder, bagPx(DECAL_COLOURS.gallbladder))
  raster(buf, DECAL_W, DECAL.bagProstate, bagPx(DECAL_COLOURS.prostate))
  return buf
}

/** The decals of the page: built once (the first `ensureEndoDecals`). */
export const endoDecals: { atlas: Surface | null } = { atlas: null }

/** Build the atlas into a canvas of `env`, once. */
export function ensureEndoDecals(env: Env): void {
  if (endoDecals.atlas) return
  const s = env.createSurface(DECAL_W, DECAL_H)
  const img = s.ctx.createImageData(DECAL_W, DECAL_H)
  img.data.set(decalPixels())
  s.ctx.putImageData(img, 0, 0)
  endoDecals.atlas = s
}

/** For tests: forget the atlas. */
export function resetEndoDecals(): void {
  endoDecals.atlas = null
}
