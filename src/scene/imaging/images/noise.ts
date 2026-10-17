/**
 * Pre-generated noise. Tiles are made once (deterministic from a fixed seed) and then only blitted: the per-frame cost of
 * "noise" is a drawImage, never a per-pixel loop. The byte generators are pure so node tests can check them.
 */
import { mulberry32 } from '@/sim/rng'
import type { Env, Surface } from './ctx'

export const TILE = 256

/** Roughly Gaussian noise (sum of three uniforms) centred on 128, as opaque grey RGBA. */
export function gaussianNoiseBytes(seed: number, w: number, h: number, sigma = 40): Uint8ClampedArray {
  const rnd = mulberry32(seed)
  const out = new Uint8ClampedArray(w * h * 4)
  const k = sigma / 0.5 // the sum of three uniforms in [-0.5, 0.5] has sd 0.5
  for (let i = 0; i < w * h; i++) {
    const n = rnd() + rnd() + rnd() - 1.5
    const v = 128 + n * k
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return out
}

/**
 * Speckle: noise that is correlated a little more along x than along y (the look of ultrasound grains), then stretched
 * back to a useful contrast. Tiles wrap, so any offset blits seamlessly.
 */
export function speckleNoiseBytes(seed: number, w: number, h: number): Uint8ClampedArray {
  const base = gaussianNoiseBytes(seed, w, h, 60)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      // 3 wide, 2 tall box (wrapping)
      for (let dy = 0; dy < 2; dy++) {
        const yy = (y + dy) % h
        for (let dx = -1; dx <= 1; dx++) sum += base[(yy * w + ((x + dx + w) % w)) * 4]
      }
      const v = 128 + (sum / 6 - 128) * 1.9
      const i = (y * w + x) * 4
      out[i] = out[i + 1] = out[i + 2] = v
      out[i + 3] = 255
    }
  }
  return out
}

export type TileKind = 'fine' | 'speckle'

const SEEDS: Record<TileKind, number> = { fine: 0x9e3779b1, speckle: 0x7f4a7c15 }

/** Make one noise tile on a surface from `env`. */
export function makeTile(env: Env, kind: TileKind): Surface {
  const s = env.createSurface(TILE, TILE)
  const bytes = kind === 'fine' ? gaussianNoiseBytes(SEEDS.fine, TILE, TILE) : speckleNoiseBytes(SEEDS.speckle, TILE, TILE)
  const img = s.ctx.createImageData(TILE, TILE)
  img.data.set(bytes)
  s.ctx.putImageData(img, 0, 0)
  return s
}

/** The mean and standard deviation of a byte tile's red channel (for tests). */
export function tileStats(bytes: Uint8ClampedArray): { mean: number; sd: number } {
  let s = 0
  let s2 = 0
  const n = bytes.length / 4
  for (let i = 0; i < n; i++) {
    const v = bytes[i * 4]
    s += v
    s2 += v * v
  }
  const mean = s / n
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) }
}
