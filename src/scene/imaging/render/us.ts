/**
 * R3 "Real screens": a B-mode ultrasound image of the synthetic body, simulated the way a scanner forms one. Pure and deterministic: the
 * same probe frame, time, frame number and patient give the same bytes.
 *
 *   1. lines     a curvilinear array (C5-1, 3.5 MHz): `lines` scan lines fanned over the field of view from the convex face (radius
 *                `radius` mm); each line is sampled every depth/samples mm
 *   2. tissue    each sample looks up the tissue it is in (body.ts labelAt, with the breathing shift of the mobile organs)
 *   3. speckle   scatterers fixed to the tissue: two Gaussian fields (in phase and quadrature) times the tissue's backscatter and its
 *                coarse texture; their magnitude after the beam's blur is Rayleigh speckle, which slides with the organ
 *   4. echoes    at every change of tissue, a specular echo of the impedance mismatch ((Z2-Z1)/(Z2+Z1))^2, strongest where the beam meets the
 *                surface square-on (capsules, the diaphragm, the gallbladder wall, bone); the rest is transmitted
 *   5. loss      attenuation on the way in and out (dB/cm/MHz per tissue); bone, stones and gas stop nearly everything (a shadow, and
 *                ring-down bands behind gas); fluid barely attenuates, so the gain lifts what lies behind it (posterior enhancement)
 *   6. beam      a short axial blur and a lateral blur that is narrowest at the focus and widens with distance from it
 *   7. display   envelope, electronic noise, depth gain (TGC) that cancels the average tissue loss, 60 dB log compression, then scan
 *                conversion of the fan onto the picture through a precomputed look-up table
 *
 * Probe off the skin (contact 0): the face meets air, and the image is only the transducer's own reverberation bands.
 */
import { labelAt, partNormal, type Phantom } from '../phantom/body'
import { breathShift, type PatientParams } from '../phantom/params'
import { TABLE, TISSUES, tissue } from '../phantom/tissues'
import type { ProbeFrame } from '../phantom/usViews'
import { PAIR, gaussPair, hash3, value3 } from './noise'

export interface UsPreset {
  lines: number
  samples: number
  /** Field of view (degrees) and the face's radius of curvature (mm). */
  fov: number
  radius: number
  /** Centre frequency (MHz). */
  freq: number
  /** Dynamic range (dB) and overall gain (dB). */
  dr: number
  gain: number
  /** A linear array (the vein scanner's): its width (mm); the lines are parallel and the picture a rectangle. */
  linear?: number
}

/** The focused room's preset (the worker renders it at 10 Hz). */
export const US_FULL: UsPreset = { lines: 128, samples: 384, fov: 62, radius: 50, freq: 3.5, dr: 55, gain: 0 }
/** The background preset (other rooms' monitors at 1 Hz): a quarter of the work. */
export const US_LITE: UsPreset = { lines: 72, samples: 224, fov: 62, radius: 50, freq: 3.5, dr: 55, gain: 0 }
/** The blood-draw robot's needle guide: a 38 mm linear array at 10 MHz, 3 cm deep. */
export const US_LINEAR: UsPreset = { lines: 72, samples: 192, fov: 0, radius: 0, freq: 10, dr: 52, gain: 0, linear: 38 }

export interface UsRequest {
  frame: ProbeFrame
  /** Imaging depth (mm) and focal depth (mm). */
  depth: number
  focus: number
  /** Sim time (s): breathing. */
  t: number
  /** Frame number: the electronic noise. */
  n: number
  preset: UsPreset
  /** Output picture size (px, square). */
  size: number
  /** A needle in the tissue (LPS mm, from its entry point to its tip): a strong, straight reflector with a comet tail. */
  needle?: { ax: number; ay: number; az: number; bx: number; by: number; bz: number }
}

export interface UsGeometry {
  /** Pixels per mm, the apex's picture position (px) and the fan's half angle (rad). */
  k: number
  apexX: number
  apexY: number
  half: number
  radius: number
  depth: number
}

/** Where the fan lies in a square picture: centred, its top just under a 7% band for the text, its foot above a 9% band. */
export function fanGeometry(preset: UsPreset, depth: number, size: number): UsGeometry {
  if (preset.linear) {
    // a rectangle W x depth mm, centred, its top at the 7% band (apexX/Y: the face's centre)
    const k = Math.min((size * 0.92) / preset.linear, (size * 0.8) / depth)
    return { k, apexX: size / 2, apexY: size * 0.07, half: 0, radius: 0, depth }
  }
  const h = (preset.fov * Math.PI) / 360
  const R = preset.radius
  const wMm = 2 * (R + depth) * Math.sin(h)
  const hMm = R + depth - R * Math.cos(h)
  const k = Math.min((size * 0.95) / wMm, (size * 0.8) / hMm)
  const top = size * 0.07
  return { k, apexX: size / 2, apexY: top - R * Math.cos(h) * k, half: h, radius: R, depth }
}

const T_AIR = 0
const T_SKIN = tissue('skin')
/** The needle is drawn as cortical bone's strongest echo (a separate pseudo-tissue id keeps it apart: the table has no steel). */
const T_NEEDLE = tissue('stone')
const NEEDLE_R2 = 0.45 * 0.45

/** Squared distance from a point to a segment (allocation-free). */
function segDist2(x: number, y: number, z: number, n: { ax: number; ay: number; az: number; bx: number; by: number; bz: number }): number {
  const ex = n.bx - n.ax
  const ey = n.by - n.ay
  const ez = n.bz - n.az
  const px = x - n.ax
  const py = y - n.ay
  const pz = z - n.az
  const ee = ex * ex + ey * ey + ez * ez
  let t = ee > 0 ? (px * ex + py * ey + pz * ez) / ee : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = px - ex * t
  const qy = py - ey * t
  const qz = pz - ez * t
  return qx * qx + qy * qy + qz * qz
}
/** Echoes the automatic gain does not judge by: air, gas, lung and bone (their reverberation and shadows are not tissue). */
const GAIN_SKIP = new Uint8Array(TISSUES.length)
for (const n of ['air', 'gas', 'lung', 'sinusAir', 'airway', 'cortical', 'marrow', 'stone', 'calcification']) GAIN_SKIP[tissue(n)] = 1
const T_FAT = tissue('fat')
/** Impedance of the probe's lens and gel. */
const Z_LENS = 1.5
/** How bright a perfect reflector is (envelope units: a specular echo of reflection coefficient r is r * SPEC_K). */
const SPEC_K = 60
/** The electronic noise floor (envelope units, before the depth gain). */
const NOISE = 0.000008
/** The gain reference when the fan holds no tissue (a probe in the air): the level soft tissue would have (dB). */
const REF_DEFAULT = -25
/** Speckle lattice and texture lattice (mm). */
const SPECKLE_CELL = 0.32
const TEXTURE_CELL = 3.2
/** The soft-tissue attenuation the depth gain cancels (dB/cm/MHz). */
const TGC_ALPHA = 0.5

interface Lut {
  key: string
  idx: Int32Array
  fu: Uint8Array
  fv: Uint8Array
}

export interface UsFrame {
  /** Greyscale picture, size x size (0 outside the fan). */
  grey: Uint8Array
  size: number
  geometry: UsGeometry
  /** Fraction of the fan's samples in each tissue (by tissue id). */
  tissueShare: Float32Array
  /** Fraction of the fan that hit each named part (by part index of the phantom). */
  partShare: Float32Array
  /** Mean display grey (0..255) of each tissue in the fan (NaN where absent): the picture's contrast, for tests. */
  tissueGrey: Float32Array
}

/** A renderer keeps its buffers between frames (one per worker slot). */
export class UsRenderer {
  private I = new Float32Array(0)
  private Q = new Float32Array(0)
  private T2 = new Float32Array(0)
  private G = new Uint8Array(0)
  private part = new Int32Array(0)
  private lut: Lut | null = null
  private readonly hist = new Int32Array(140)
  /** The last frame's gain reference and brightest echo (dB), for tests and tuning. */
  lastRef = 0
  lastTop = 0
  private readonly bandCorr = new Float32Array(12)
  private grey = new Uint8Array(0)
  private readonly n3 = [0, 0, 0]

  /** Render one frame of `ph` (built from `params`). */
  render(ph: Phantom, params: PatientParams, req: UsRequest): UsFrame {
    const { preset, depth, frame: f, size } = req
    const L = preset.lines
    const N = preset.samples
    const total = L * N
    if (this.I.length !== total) {
      this.I = new Float32Array(total)
      this.Q = new Float32Array(total)
      this.T2 = new Float32Array(total)
      this.G = new Uint8Array(total)
      this.part = new Int32Array(total)
    }
    const I = this.I
    const Q = this.Q
    const part = this.part
    const breath = breathShift(params, req.t)
    const seed = params.seed | 0
    const half = (preset.fov * Math.PI) / 360
    const R = preset.radius
    const dr = depth / N
    const drCm = dr / 10
    const f0 = preset.freq
    // the virtual apex behind the convex face
    const apx = f.ox - f.bx * R
    const apy = f.oy - f.by * R
    const apz = f.oz - f.bz * R
    const contact = f.contact
    const echo = TABLE.echo
    const struct = TABLE.structure
    const att = TABLE.att
    const zt = TABLE.z
    const n3 = this.n3

    const lin = preset.linear ?? 0
    const nd = req.needle
    for (let i = 0; i < L; i++) {
      const th = lin ? 0 : -half + (2 * half * (i + 0.5)) / L
      const s = Math.sin(th)
      const c = Math.cos(th)
      const dx = f.ax * s + f.bx * c
      const dy = f.ay * s + f.by * c
      const dz = f.az * s + f.bz * c
      // a convex array's lines start on its curved face; a linear array's side by side along it
      const off = lin ? -lin / 2 + (lin * (i + 0.5)) / L : 0
      const x0 = lin ? f.ox + f.ax * off : apx + dx * R
      const y0 = lin ? f.oy + f.ay * off : apy + dy * R
      const z0 = lin ? f.oz + f.az * off : apz + dz * R
      // amplitude left after the round trip so far
      let T = 1
      let prevT = -1
      let prevPart = -1
      let reverb = 0
      let reverbJ = 0
      // ring-down bands behind gas differ from line to line (comet tails on some, a dirty shadow on others)
      const lineHash = hash3(i, 7, 3, seed)
      const period = 6 + (lineHash & 3)
      const tail = (lineHash >>> 2) % 5 === 0 ? 1 : 0.35
      // the face is convex: near its edges the gel fills the gap down to the skin
      const coupled = lin ? 3 : R * (1 - c) + 10
      for (let j = 0; j < N; j++) {
        const r = (j + 0.5) * dr
        const px = x0 + dx * r
        const py = y0 + dy * r
        const pz = z0 + dz * r
        const pi = labelAt(ph, px, py, pz, breath)
        let ti = pi < 0 ? T_AIR : ph.partTissue[pi]
        // the needle: steel, so nearly everything reflects (a bright line, its comet tail and a shadow)
        if (nd && segDist2(px, py, pz, nd) < NEEDLE_R2) ti = T_NEEDLE
        // the first 2.5 mm under a probe in contact: the echogenic dermis over the fat
        if (r < 2.5 && contact > 0.5 && ti === T_FAT) ti = T_SKIN
        // a probe in contact pushes the gel into any air gap under the face
        if (r < coupled && contact > 0.5 && ti === T_AIR) ti = T_FAT
        const k = i * N + j
        part[k] = pi
        // tissue coordinates (the organ's own frame: breathing removed) for the speckle and the texture
        const qz = pi < 0 ? pz : pz - ph.partMob[pi] * breath
        let amp = echo[ti]
        const st = struct[ti]
        if (st > 0) amp *= 1 + st * 1.7 * (value3(px, py, qz, TEXTURE_CELL, seed ^ (ti * 0x9e37)) - 0.5)
        gaussPair(px, py, qz, SPECKLE_CELL, seed)
        let vi = amp * PAIR.i * T
        const vq = amp * PAIR.q * T
        // an interface: specular echo and transmission loss
        const prevZ = prevT < 0 ? Z_LENS : zt[prevT]
        if (ti !== prevT) {
          const z2 = zt[ti]
          const rc = (z2 - prevZ) / (z2 + prevZ)
          const refl = rc * rc
          let cosA = 1
          const surf = pi >= 0 && (prevPart < 0 || ph.partLayer[pi] >= ph.partLayer[prevPart]) ? pi : prevPart
          if (surf >= 0) {
            partNormal(ph, surf, px, py, surf === pi ? qz : pz - ph.partMob[surf] * breath, n3)
            cosA = Math.abs(n3[0] * dx + n3[1] * dy + n3[2] * dz)
          }
          const spec = Math.abs(rc) * SPEC_K * cosA * cosA * cosA * T
          vi += spec
          T *= 1 - refl
          if (refl > 0.5 || ti === T_NEEDLE) {
            // gas or an air gap: what little gets through rings down in bands; a needle rings in a comet tail
            reverb = Math.abs(rc) * SPEC_K * (prevT < 0 ? 0.5 : ti === T_NEEDLE ? 0.5 : 0.14 * tail)
            reverbJ = j
          }
        }
        // attenuation over this sample, both ways
        T *= Math.pow(10, (-2 * att[ti] * f0 * drCm) / 20)
        if (reverb > 0.02) {
          const ph2 = (j - reverbJ) % period
          vi += ph2 < 2 ? reverb : reverb * 0.08 * PAIR.q
          reverb *= prevT < 0 ? 0.95 : 0.86
        }
        I[k] = vi
        Q[k] = vq
        prevT = ti
        prevPart = pi
      }
    }

    this.blur(L, N, depth, R, half, preset)
    this.compress(ph, L, N, dr, f0, preset, req.n, seed)
    const lut = this.lutFor(preset, depth, size)
    const out = this.scanConvert(lut, N, size)
    // what the fan shows
    const nt = TISSUES.length
    const tissueShare = new Float32Array(nt)
    const tissueGrey = new Float32Array(nt)
    const partShare = new Float32Array(ph.nParts)
    const G = this.G
    for (let k = 0; k < total; k++) {
      const pi = part[k]
      const ti = pi < 0 ? T_AIR : ph.partTissue[pi]
      tissueShare[ti] += 1 / total
      tissueGrey[ti] += G[k]
      if (pi >= 0) partShare[pi] += 1 / total
    }
    for (let t = 0; t < nt; t++) tissueGrey[t] = tissueShare[t] > 0 ? tissueGrey[t] / (tissueShare[t] * total) : NaN
    return { grey: out, size, geometry: fanGeometry(preset, depth, size), tissueShare, partShare, tissueGrey }
  }

  /** The beam's blur: a short axial Gaussian on each line, then a lateral one across lines that widens away from the focus. */
  private blur(L: number, N: number, depth: number, R: number, half: number, preset: UsPreset): void {
    const I = this.I
    const Q = this.Q
    const T = this.T2
    // axial, 5 taps (sigma about one sample: the pulse length)
    const a0 = 0.4
    const a1 = 0.24
    const a2 = 0.06
    for (const buf of [I, Q]) {
      for (let i = 0; i < L; i++) {
        const o = i * N
        for (let j = 0; j < N; j++) {
          const jm1 = j > 0 ? j - 1 : 0
          const jm2 = j > 1 ? j - 2 : 0
          const jp1 = j < N - 1 ? j + 1 : N - 1
          const jp2 = j < N - 2 ? j + 2 : N - 1
          T[o + j] = a0 * buf[o + j] + a1 * (buf[o + jm1] + buf[o + jp1]) + a2 * (buf[o + jm2] + buf[o + jp2])
        }
      }
      buf.set(T)
    }
    // lateral: the beam's width (mm) at each depth over the line spacing there
    const focus = depth * 0.55
    const dth = (2 * half) / L
    for (const buf of [I, Q]) {
      for (let j = 0; j < N; j++) {
        const r = ((j + 0.5) / N) * depth
        // the beam narrows with frequency; a linear array's lines are evenly spaced
        const width = (1.6 + 0.045 * Math.abs(r - focus) + 0.012 * r) * (3.5 / preset.freq)
        const spacing = preset.linear ? preset.linear / L : Math.max(0.05, (R + r) * dth)
        const sg = Math.max(0.35, width / 2.355 / spacing)
        const w1 = Math.exp(-0.5 / (sg * sg))
        const w2 = Math.exp(-2 / (sg * sg))
        const w3 = Math.exp(-4.5 / (sg * sg))
        const norm = 1 / (1 + 2 * (w1 + w2 + w3))
        for (let i = 0; i < L; i++) {
          const im1 = i > 0 ? i - 1 : 0
          const im2 = i > 1 ? i - 2 : 0
          const im3 = i > 2 ? i - 3 : 0
          const ip1 = i < L - 1 ? i + 1 : L - 1
          const ip2 = i < L - 2 ? i + 2 : L - 1
          const ip3 = i < L - 3 ? i + 3 : L - 1
          T[i * N + j] = norm * (buf[i * N + j] + w1 * (buf[im1 * N + j] + buf[ip1 * N + j]) + w2 * (buf[im2 * N + j] + buf[ip2 * N + j]) + w3 * (buf[im3 * N + j] + buf[ip3 * N + j]))
        }
      }
      buf.set(T)
    }
  }

  /**
   * Envelope, noise, depth gain and log compression into 8-bit greys per sample. Like a scanner's automatic optimisation, the gain is set
   * from the picture itself: the level that 55% of the echoes in the whole fan stay under maps to mid-grey, and each depth band is nudged
   * toward the same level (at most a few dB, smoothly), so deep organs are not lost under a thick wall while a shadow, a cyst or the
   * enhancement behind fluid (narrower than a band) still show.
   */
  private compress(ph: Phantom, L: number, N: number, dr: number, f0: number, preset: UsPreset, n: number, seed: number): void {
    const part = this.part
    const I = this.I
    const Q = this.Q
    const G = this.G
    const D = this.T2
    const total = L * N
    for (let i = 0; i < L; i++) {
      // edge lines are a little weaker (apodisation of the outer elements)
      const e = Math.min(1, (Math.min(i, L - 1 - i) + 1) / 4)
      const edgeDb = 20 * Math.log10(0.55 + 0.45 * e)
      for (let j = 0; j < N; j++) {
        const k = i * N + j
        const r = (j + 0.5) * dr
        const h = hash3(i, j, n, seed ^ 0x2f1)
        const nI = ((h & 0xffff) / 65535 - 0.5) * NOISE * 3.4
        const nQ = ((h >>> 16) / 65535 - 0.5) * NOISE * 3.4
        const vi = I[k] + nI
        const vq = Q[k] + nQ
        const env = Math.sqrt(vi * vi + vq * vq)
        D[k] = 20 * Math.log10(env + 1e-12) + 2 * TGC_ALPHA * f0 * (r / 10) + edgeDb
      }
    }
    // the electronic noise after the depth gain, per sample (echoes 10 dB above it are tissue)
    const noiseDb = 20 * Math.log10(NOISE * 1.7) + 10
    // the fan's level: a histogram of dB in 0.5 dB bins (anything 70 dB under the brightest is no signal and left out)
    let top = -Infinity
    for (let k = 0; k < total; k++) if (D[k] > top) top = D[k]
    const floor = top - 70
    const BINS = 140
    const hist = this.hist
    let minLevel = -Infinity
    let counted = 0
    const level = (from: number, to: number, q: number): number => {
      hist.fill(0)
      let cnt = 0
      for (let i = 0; i < L; i++) {
        for (let j = from; j < to; j++) {
          const k = i * N + j
          const v = D[k]
          const pi = part[k]
          if (pi < 0 || GAIN_SKIP[ph.partTissue[pi]]) continue
          if (v <= floor || v <= minLevel || v <= noiseDb + 2 * TGC_ALPHA * f0 * (((j + 0.5) * dr) / 10)) continue
          const b = Math.min(BINS - 1, Math.floor((v - floor) * 2))
          hist[b]++
          cnt++
        }
      }
      counted = cnt
      if (cnt === 0) return NaN
      let acc = 0
      for (let b = 0; b < BINS; b++) {
        acc += hist[b]
        if (acc >= q * cnt) return floor + (b + 0.5) / 2
      }
      return top
    }
    let ref = level(0, N, 0.55)
    // hardly any tissue (a probe off the skin): the scanner's gain stays where tissue would be, and the noise stays black
    if (Number.isNaN(ref) || counted < total * 0.05) ref = REF_DEFAULT
    this.lastRef = ref
    this.lastTop = top
    // depth bands are judged on tissue only: fluid and shadow (30 dB under the fan's level) would pull the gain up into the noise
    const tissueFloor = ref - 30
    // per depth band: the correction toward the fan's level, limited and smoothed
    const NB = this.bandCorr.length
    minLevel = tissueFloor
    for (let b = 0; b < NB; b++) {
      const lv = level(Math.floor((b * N) / NB), Math.floor(((b + 1) * N) / NB), 0.55)
      const c = Number.isNaN(lv) ? 0 : ref - lv
      this.bandCorr[b] = c < -6 ? -6 : c > 8 ? 8 : c
    }
    const bc = this.bandCorr
    for (let pass = 0; pass < 2; pass++) for (let b = 0; b < NB; b++) bc[b] = (bc[Math.max(0, b - 1)] + 2 * bc[b] + bc[Math.min(NB - 1, b + 1)]) / 4
    // the fan's typical echo sits a little under mid-grey, so fat, sinus and walls stand out bright
    const mid = ref - 0.42 * preset.dr - preset.gain
    for (let j = 0; j < N; j++) {
      const fb = ((j + 0.5) / N) * NB - 0.5
      const b0 = Math.max(0, Math.min(NB - 1, Math.floor(fb)))
      const b1 = Math.min(NB - 1, b0 + 1)
      const t = Math.max(0, Math.min(1, fb - b0))
      const corr = bc[b0] + (bc[b1] - bc[b0]) * t
      for (let i = 0; i < L; i++) {
        const k = i * N + j
        let g = (D[k] + corr - mid) / preset.dr
        g = g < 0 ? 0 : g > 1 ? 1 : g
        G[k] = Math.round(255 * g)
      }
    }
    // speckle reduction (as scanners do): a light 3 x 3 smoothing of the log image in beam space, keeping a third of the original grain
    const S = this.T2
    for (let i = 0; i < L; i++) {
      const im = i > 0 ? i - 1 : 0
      const ip = i < L - 1 ? i + 1 : L - 1
      for (let j = 0; j < N; j++) {
        const jm = j > 0 ? j - 1 : 0
        const jp = j < N - 1 ? j + 1 : N - 1
        const k = i * N + j
        const sm =
          (4 * G[k] + 2 * (G[i * N + jm] + G[i * N + jp] + G[im * N + j] + G[ip * N + j]) + G[im * N + jm] + G[im * N + jp] + G[ip * N + jm] + G[ip * N + jp]) / 16
        S[k] = 0.35 * G[k] + 0.65 * sm
      }
    }
    for (let k = 0; k < L * N; k++) G[k] = S[k]
  }

  private lutFor(preset: UsPreset, depth: number, size: number): Lut {
    const key = `${preset.lines}x${preset.samples}x${preset.fov}x${preset.radius}x${preset.linear ?? 0}@${depth}/${size}`
    if (this.lut && this.lut.key === key) return this.lut
    const geo = fanGeometry(preset, depth, size)
    const L = preset.lines
    const N = preset.samples
    const idx = new Int32Array(size * size).fill(-1)
    const fu = new Uint8Array(size * size)
    const fv = new Uint8Array(size * size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (preset.linear) {
          const lx = (x + 0.5 - geo.apexX) / geo.k + preset.linear / 2
          const ly = (y + 0.5 - geo.apexY) / geo.k
          if (lx < 0 || lx > preset.linear || ly < 0 || ly > depth) continue
          let u = (lx / preset.linear) * L - 0.5
          let v = (ly / depth) * N - 0.5
          u = u < 0 ? 0 : u > L - 1.001 ? L - 1.001 : u
          v = v < 0 ? 0 : v > N - 1.001 ? N - 1.001 : v
          const i0 = Math.floor(u)
          const j0 = Math.floor(v)
          const p = y * size + x
          idx[p] = i0 * N + j0
          fu[p] = Math.round((u - i0) * 255)
          fv[p] = Math.round((v - j0) * 255)
          continue
        }
        const dx = (x + 0.5 - geo.apexX) / geo.k
        const dy = (y + 0.5 - geo.apexY) / geo.k
        const rho = Math.sqrt(dx * dx + dy * dy)
        const th = Math.atan2(dx, dy)
        if (Math.abs(th) > geo.half || rho < geo.radius || rho > geo.radius + depth) continue
        let u = ((th + geo.half) / (2 * geo.half)) * L - 0.5
        let v = ((rho - geo.radius) / depth) * N - 0.5
        u = u < 0 ? 0 : u > L - 1.001 ? L - 1.001 : u
        v = v < 0 ? 0 : v > N - 1.001 ? N - 1.001 : v
        const i0 = Math.floor(u)
        const j0 = Math.floor(v)
        const p = y * size + x
        idx[p] = i0 * N + j0
        fu[p] = Math.round((u - i0) * 255)
        fv[p] = Math.round((v - j0) * 255)
      }
    }
    this.lut = { key, idx, fu, fv }
    return this.lut
  }

  private scanConvert(lut: Lut, N: number, size: number): Uint8Array {
    if (this.grey.length !== size * size) this.grey = new Uint8Array(size * size)
    const out = this.grey
    const G = this.G
    for (let p = 0; p < size * size; p++) {
      const k = lut.idx[p]
      if (k < 0) {
        out[p] = 0
        continue
      }
      const u = lut.fu[p] / 255
      const v = lut.fv[p] / 255
      const a = G[k] + (G[k + 1] - G[k]) * v
      const b = G[k + N] + (G[k + N + 1] - G[k + N]) * v
      out[p] = a + (b - a) * u
    }
    return out
  }
}
