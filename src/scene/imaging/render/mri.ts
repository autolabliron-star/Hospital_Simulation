/**
 * R3 "Real screens": an MR image of the synthetic body. The contrast is not painted: it comes from each tissue's proton density, T1 and T2
 * (3 T) through the sequence's signal equation, so CSF is dark on T1 and bright on T2, fat is bright until it is suppressed, and flowing
 * blood is a black void on spin echo. Pure and deterministic.
 *
 *   T1, T2, PD   spin echo          PD (1 - e^-TR/T1) e^-TE/T2
 *   PDFS         PD with fat saturation (fat x 0.1, a little less suppressed at the edges of the field)
 *   FLAIR, STIR  inversion recovery PD |1 - 2 e^-TI/T1 + e^-TR/T1| e^-TE/T2   (FLAIR nulls the fluid, STIR the fat)
 *   DWI          the T2 signal times e^-b ADC (b = 1000 s/mm^2): fluid dark, cellular tissue bright, at a coarse matrix
 *   LOC          the localiser's fast gradient echo (inflowing blood bright)
 *
 * Then what a real scanner adds: chemical shift (the fat image displaced a pixel along the readout), the receive coil's shading, Gibbs
 * ringing along the phase direction at sharp edges, and Rician noise (so the background is a grey haze, never pure black).
 */
import type { Phantom } from '../phantom/body'
import { TABLE, tissue } from '../phantom/tissues'
import { gaussianNoise, resize } from './filters'
import { value3 } from './noise'
import { SliceRaster, type Plane } from './raster'

const T_FLUID = tissue('csf')
const T_FAT = tissue('fat')

export type MriSeq = 'T1' | 'T2' | 'PD' | 'PDFS' | 'FLAIR' | 'STIR' | 'DWI' | 'LOC'
export type Coil = 'head' | 'spine' | 'knee' | 'body'

export interface MriRequest {
  plane: Plane
  seq: MriSeq
  coil: Coil
  /** Signal to noise of the bright tissue. */
  snr: number
  seed: number
  slice: number
  size: number
}

const SEQ: Record<MriSeq, { tr: number; te: number; ti: number }> = {
  T1: { tr: 520, te: 12, ti: 0 },
  T2: { tr: 4200, te: 98, ti: 0 },
  PD: { tr: 3000, te: 30, ti: 0 },
  PDFS: { tr: 3000, te: 35, ti: 0 },
  FLAIR: { tr: 9000, te: 120, ti: 2500 },
  STIR: { tr: 3500, te: 40, ti: 260 },
  DWI: { tr: 5000, te: 80, ti: 0 },
  LOC: { tr: 8, te: 4, ti: 0 },
}

/** Repetition, echo and inversion times (ms) of each sequence, for the scanner's words on the screen. */
export const MRI_TIMING: Readonly<Record<MriSeq, { tr: number; te: number; ti: number }>> = SEQ

/** The signal of a tissue in a sequence (0..~1). */
export function mriSignal(t: number, seq: MriSeq): number {
  const pd = TABLE.pd[t]
  if (pd <= 0) return 0
  const t1 = TABLE.t1[t]
  const t2 = TABLE.t2[t]
  const fat = TABLE.fat[t] === 1
  const flow = TABLE.flow[t] === 1
  const q = SEQ[seq]
  if (seq === 'LOC') {
    // spoiled gradient echo, flip 25 degrees; inflow makes blood bright
    if (flow) return 0.9
    const a = (25 * Math.PI) / 180
    const e1 = Math.exp(-q.tr / t1)
    return (pd * Math.sin(a) * (1 - e1)) / (1 - Math.cos(a) * e1) * Math.exp(-q.te / (t2 * 0.7)) * 4
  }
  if (flow) return 0.03 * pd
  // turbo spin echo keeps fat bright (J-coupling): its effective T2 is about twice the true one
  const t2e = fat ? t2 * 2 : t2
  let s: number
  if (seq === 'FLAIR' || seq === 'STIR') s = pd * Math.abs(1 - 2 * Math.exp(-q.ti / t1) + Math.exp(-q.tr / t1)) * Math.exp(-q.te / t2e)
  else s = pd * (1 - Math.exp(-q.tr / t1)) * Math.exp(-q.te / t2e)
  if (seq === 'DWI') s *= Math.exp(-TABLE.adc[t])
  if (seq === 'PDFS' && fat) s *= 0.1
  return s
}

export class MriRenderer {
  private readonly raster = new SliceRaster()
  private water = new Float32Array(0)
  private fat = new Float32Array(0)
  private sig = new Float32Array(0)
  private ring = new Float32Array(0)
  private big = new Float32Array(0)
  private n1 = new Float32Array(0)
  private n2 = new Float32Array(0)
  private grey = new Uint8Array(0)

  render(ph: Phantom, req: MriRequest): Uint8Array {
    const size = req.size
    // DWI is acquired on a coarse matrix
    const B = req.seq === 'DWI' ? 128 : size >> 1
    const p = req.plane
    this.raster.rasterize(ph, p, B)
    const nB = B * B
    if (this.water.length !== nB) {
      this.water = new Float32Array(nB)
      this.fat = new Float32Array(nB)
      this.sig = new Float32Array(nB)
      this.ring = new Float32Array(nB)
    }
    const { tA, tB, wA } = this.raster
    const step = p.fov / B
    const half = p.fov / 2
    const seed = req.seed | 0
    // the tissues' signal, water and fat apart (the fat image shifts along the readout)
    for (let y = 0; y < B; y++) {
      const b = (y + 0.5) * step - half
      for (let x = 0; x < B; x++) {
        const k = y * B + x
        const a = (x + 0.5) * step - half
        const ta = tA[k]
        const tb = tB[k]
        const sa = mriSignal(ta, req.seq) * wA[k]
        const sb = mriSignal(tb, req.seq) * (1 - wA[k])
        // a faint texture fixed in the tissue (none is perfectly uniform)
        const px = p.cx + p.ux * a + p.vx * b
        const py = p.cy + p.uy * a + p.vy * b
        const pz = p.cz + p.uz * a + p.vz * b
        const tx = 1 + 0.08 * (value3(px, py, pz, 2.5, seed ^ (ta * 0x2c1b3c6d)) - 0.5)
        this.water[k] = (TABLE.fat[ta] ? 0 : sa) * tx + (TABLE.fat[tb] ? 0 : sb)
        this.fat[k] = (TABLE.fat[ta] ? sa : 0) * tx + (TABLE.fat[tb] ? sb : 0)
      }
    }
    // chemical shift: one pixel along the readout (the picture's x)
    for (let y = 0; y < B; y++) {
      for (let x = 0; x < B; x++) {
        const k = y * B + x
        this.sig[k] = this.water[k] + (x > 0 ? this.fat[k - 1] : 0)
      }
    }
    // Gibbs ringing along the phase direction (the picture's y): a truncated sinc
    const taps = [0.035, -0.07, 0.11, 0.86, 0.11, -0.07, 0.035]
    const tsum = taps.reduce((s, v) => s + v, 0)
    for (let y = 0; y < B; y++) {
      for (let x = 0; x < B; x++) {
        let s = 0
        for (let i = -3; i <= 3; i++) {
          const yy = y + i < 0 ? 0 : y + i >= B ? B - 1 : y + i
          s += taps[i + 3] * this.sig[yy * B + x]
        }
        this.ring[y * B + x] = s / tsum
      }
    }
    const n = size * size
    if (this.big.length !== n) {
      this.big = new Float32Array(n)
      this.n1 = new Float32Array(n)
      this.n2 = new Float32Array(n)
      this.grey = new Uint8Array(n)
    }
    resize(this.ring, B, this.big, size)
    // the receive coil's shading
    const big = this.big
    const hs = p.fov / 2
    for (let y = 0; y < size; y++) {
      const b = ((y + 0.5) / size) * p.fov - hs
      for (let x = 0; x < size; x++) {
        const a = ((x + 0.5) / size) * p.fov - hs
        const py = p.cy + p.uy * a + p.vy * b
        let f = 1
        if (req.coil === 'spine') f = 0.5 + 0.8 * Math.exp(-Math.max(0, 125 - py) / 85)
        else if (req.coil === 'head') f = 0.92 + 0.16 * Math.exp(-(a * a + b * b) / (2 * 75 * 75))
        else if (req.coil === 'knee') f = 0.85 + 0.35 * Math.min(1, (a * a + b * b) / (80 * 80))
        big[y * size + x] *= f
      }
    }
    // Rician noise, scaled to the bright end of the picture
    let peak = 0
    for (let i = 0; i < n; i++) if (big[i] > peak) peak = big[i]
    // the display window: the slice's bright end, but never below half of what fluid or fat gives in this sequence (a slice with neither
    // would otherwise stretch muscle to white, which no radiographer's window does)
    const ref = Math.max(this.quantile(big, 0.995, peak), 0.5 * Math.max(mriSignal(T_FLUID, req.seq), mriSignal(T_FAT, req.seq)))
    const sigma = (ref || 1) / req.snr
    gaussianNoise(this.n1, (seed * 131 + req.slice * 977) >>> 0)
    gaussianNoise(this.n2, (seed * 131 + req.slice * 977 + 1) >>> 0)
    const g = this.grey
    const scale = 1 / ((ref || 1) * 1.05)
    for (let i = 0; i < n; i++) {
      const re = big[i] + this.n1[i] * sigma
      const im = this.n2[i] * sigma
      const v = Math.sqrt(re * re + im * im) * scale
      g[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(Math.pow(v, 0.92) * 255)
    }
    return g
  }

  /** The q-quantile of an image's values (a 256-bin histogram up to `peak`). */
  private quantile(a: Float32Array, q: number, peak: number): number {
    if (peak <= 0) return 0
    const h = new Int32Array(256)
    for (let i = 0; i < a.length; i++) h[Math.min(255, Math.floor((a[i] / peak) * 255))]++
    let acc = 0
    for (let b = 0; b < 256; b++) {
      acc += h[b]
      if (acc >= q * a.length) return ((b + 0.5) / 256) * peak
    }
    return peak
  }
}
