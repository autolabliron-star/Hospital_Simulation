/**
 * R3 "Real screens": a CT slice of the synthetic body. Pure and deterministic (same request, same bytes).
 *
 *   1. tissues    the slice plane rasterised at half the output matrix with partial volume (raster.ts)
 *   2. HU         each tissue's Hounsfield units in the phase of the scan (plain, arterial: bright aorta and renal cortex, portal-venous:
 *                 bright liver and portal vein), plus the tissue's own texture fixed in the body (trabecular bone in marrow, mottled
 *                 liver, fat lobules)
 *   3. matrix     resized to the output matrix (512 x 512, the CT standard)
 *   4. noise      quantum noise with CT's blotchy, mid-frequency texture (white noise band-passed by a difference of Gaussians),
 *                 a few HU in the head, more in the body
 *   5. kernel     soft tissue (as is) or sharp (lung and bone: an unsharp mask that also sharpens the noise)
 *   6. window     the window and level to 8-bit greys; black outside the circular field of view
 */
import { type Phantom } from '../phantom/body'
import { TABLE, tissue } from '../phantom/tissues'
import { gaussianBlur, gaussianNoise, resize, stdev } from './filters'
import { value3 } from './noise'
import { SliceRaster, type Plane } from './raster'

export type CtPhase = 'plain' | 'arterial' | 'portal'

export interface CtRequest {
  plane: Plane
  phase: CtPhase
  level: number
  width: number
  kernel: 'soft' | 'sharp'
  /** Standard deviation of the noise (HU). */
  noiseHu: number
  /** The patient's seed and a number for this slice (its noise). */
  seed: number
  slice: number
  size: number
}

const T_MARROW = tissue('marrow')
const T_CANCELLOUS = tissue('cancellous')

export class CtRenderer {
  private readonly raster = new SliceRaster()
  private hu = new Float32Array(0)
  private big = new Float32Array(0)
  private n1 = new Float32Array(0)
  private n2 = new Float32Array(0)
  private tmp = new Float32Array(0)
  private grey = new Uint8Array(0)

  /** Hounsfield units of the last slice at the output matrix (for tests). */
  get lastHu(): Float32Array {
    return this.big
  }

  render(ph: Phantom, req: CtRequest): Uint8Array {
    const size = req.size
    const B = size >> 1
    const p = req.plane
    this.raster.rasterize(ph, p, B)
    if (this.hu.length !== B * B) this.hu = new Float32Array(B * B)
    if (this.big.length !== size * size) {
      this.big = new Float32Array(size * size)
      this.n1 = new Float32Array(size * size)
      this.n2 = new Float32Array(size * size)
      this.tmp = new Float32Array(size * size)
      this.grey = new Uint8Array(size * size)
    }
    const huT = req.phase === 'arterial' ? TABLE.huArt : req.phase === 'portal' ? TABLE.huPort : TABLE.hu
    const tex = TABLE.huTex
    const { tA, tB, wA } = this.raster
    const step = p.fov / B
    const half = p.fov / 2
    const seed = req.seed | 0
    for (let y = 0; y < B; y++) {
      const b = (y + 0.5) * step - half
      for (let x = 0; x < B; x++) {
        const k = y * B + x
        const a = (x + 0.5) * step - half
        const ta = tA[k]
        let v = wA[k] * huT[ta] + (1 - wA[k]) * huT[tB[k]]
        const amp = tex[ta]
        if (amp > 3) {
          const px = p.cx + p.ux * a + p.vx * b
          const py = p.cy + p.uy * a + p.vy * b
          const pz = p.cz + p.uz * a + p.vz * b
          // trabecular bone is fine and contrasty; soft tissue texture is coarse and faint
          const cell = ta === T_MARROW || ta === T_CANCELLOUS ? 0.9 : 3.5
          v += amp * 2 * (value3(px, py, pz, cell, seed ^ (ta * 0x45d9f3b)) - 0.5) * wA[k]
        }
        this.hu[k] = v
      }
    }
    resize(this.hu, B, this.big, size)
    // CT noise: white noise band-passed (difference of Gaussians), normalised to the asked HU
    const n = size * size
    gaussianNoise(this.n1, (seed * 31 + req.slice * 7919) >>> 0)
    gaussianBlur(this.n1, this.n2, this.tmp, size, size, 0.75)
    gaussianBlur(this.n1, this.n1, this.tmp, size, size, 2.4)
    for (let i = 0; i < n; i++) this.n2[i] -= 0.85 * this.n1[i]
    const sd = stdev(this.n2) || 1
    const big = this.big
    const k = req.noiseHu / sd
    for (let i = 0; i < n; i++) big[i] += this.n2[i] * k
    if (req.kernel === 'sharp') {
      gaussianBlur(big, this.n1, this.tmp, size, size, 1.2)
      for (let i = 0; i < n; i++) big[i] += 0.9 * (big[i] - this.n1[i])
    }
    // window and level; the circular reconstruction field of view
    const lo = req.level - req.width / 2
    const g = this.grey
    const r2 = (size / 2) * (size / 2)
    for (let y = 0; y < size; y++) {
      const dy = y + 0.5 - size / 2
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - size / 2
        const i = y * size + x
        if (dx * dx + dy * dy > r2) {
          g[i] = 0
          continue
        }
        const v = (big[i] - lo) / req.width
        g[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
      }
    }
    return g
  }
}
