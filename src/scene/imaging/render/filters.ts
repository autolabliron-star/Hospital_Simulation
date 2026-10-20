/**
 * R3 "Real screens": small image filters the slice renderers share (Float32 images, row-major, square or w x h): separable Gaussian blur,
 * bilinear resize, seeded Gaussian noise. Pure; scratch buffers are passed in or kept by the caller.
 */
import { mulberry32 } from '@/sim/rng'

/** Gaussian blur of `src` (w x h) into `dst` with standard deviation `sigma` pixels (separable, edges clamped). `tmp` must be w * h. */
export function gaussianBlur(src: Float32Array, dst: Float32Array, tmp: Float32Array, w: number, h: number, sigma: number): void {
  if (sigma <= 0.05) {
    dst.set(src)
    return
  }
  const r = Math.max(1, Math.ceil(sigma * 2.6))
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma))
    sum += k[i + r]
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  for (let y = 0; y < h; y++) {
    const o = y * w
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i
        s += k[i + r] * src[o + xx]
      }
      tmp[o + x] = s
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i
        s += k[i + r] * tmp[yy * w + x]
      }
      dst[y * w + x] = s
    }
  }
}

/** Bilinear resize of a square `n` image to a square `m` image (pixel centres aligned). */
export function resize(src: Float32Array, n: number, dst: Float32Array, m: number): void {
  const k = n / m
  for (let y = 0; y < m; y++) {
    let fy = (y + 0.5) * k - 0.5
    fy = fy < 0 ? 0 : fy > n - 1 ? n - 1 : fy
    const y0 = Math.floor(fy)
    const y1 = y0 + 1 < n ? y0 + 1 : y0
    const ty = fy - y0
    for (let x = 0; x < m; x++) {
      let fx = (x + 0.5) * k - 0.5
      fx = fx < 0 ? 0 : fx > n - 1 ? n - 1 : fx
      const x0 = Math.floor(fx)
      const x1 = x0 + 1 < n ? x0 + 1 : x0
      const tx = fx - x0
      const a = src[y0 * n + x0] + (src[y0 * n + x1] - src[y0 * n + x0]) * tx
      const b = src[y1 * n + x0] + (src[y1 * n + x1] - src[y1 * n + x0]) * tx
      dst[y * m + x] = a + (b - a) * ty
    }
  }
}

/** Fill `out` with seeded standard-normal noise. */
export function gaussianNoise(out: Float32Array, seed: number): void {
  const r = mulberry32(seed >>> 0)
  for (let i = 0; i < out.length; i += 2) {
    const u1 = Math.max(1e-12, r())
    const u2 = r()
    const m = Math.sqrt(-2 * Math.log(u1))
    out[i] = m * Math.cos(2 * Math.PI * u2)
    if (i + 1 < out.length) out[i + 1] = m * Math.sin(2 * Math.PI * u2)
  }
}

/** The standard deviation of an image's values. */
export function stdev(a: Float32Array): number {
  let s = 0
  let s2 = 0
  for (let i = 0; i < a.length; i++) {
    s += a[i]
    s2 += a[i] * a[i]
  }
  const m = s / a.length
  return Math.sqrt(Math.max(0, s2 / a.length - m * m))
}
