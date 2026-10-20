/**
 * R3 "Real screens": a radiograph (and a CT topogram) of the synthetic body, by line integrals: for every detector pixel the ray from the
 * focal spot is intersected exactly with every shape it meets (closed forms for ellipsoids, boxes, capsules and the trunk's elliptic
 * tubes), where parts overlap the higher layer wins, and the attenuation sums mu x length along the ray. Bone's cortex is crossed
 * tangentially at its edges, so it shows the bright rim real radiographs have. Then the detector:
 *
 *   scatter   a broad haze (more through a thick trunk than a wrist)
 *   mottle    quantum noise, stronger where fewer photons get through
 *   blur      the detector's own unsharpness
 *   DR        log, a large-radius equalisation and a little edge enhancement, a sigmoid look-up table set from the collimated field's own
 *             range, and the electronic shutter (black outside the collimation)
 *
 * Parts are binned into detector tiles by their projected boxes, so a ray only meets what can be on it. Pure and deterministic.
 */
import { M_BOX, M_CAPSULE, M_CONE, M_ELLIPSOID, type Phantom } from '../phantom/body'
import { TABLE, tissue } from '../phantom/tissues'
import { gaussianBlur, gaussianNoise } from './filters'

export interface Projection {
  /** Focal spot (LPS mm). */
  sx: number
  sy: number
  sz: number
  /** Detector centre and its axes (unit: picture right u, picture down v), and its size (mm). */
  dx: number
  dy: number
  dz: number
  ux: number
  uy: number
  uz: number
  vx: number
  vy: number
  vz: number
  width: number
  height: number
}

export interface XrayRequest {
  proj: Projection
  /** Tube voltage (kV): lower voltage, more bone contrast. */
  kv: number
  /** Scatter-to-primary ratio (0.2 extremity .. 2 trunk) and the photon count that sets the mottle. */
  spr: number
  photons: number
  /** Collimated field as fractions of the detector (centred). */
  fieldW: number
  fieldH: number
  seed: number
  /** Output size (px, square). */
  size: number
  /** CT topogram look: no shutter, flatter processing. */
  topogram?: boolean
}

const TILE = 16
const byValue = (x: number, y: number): number => x - y
const T_CORTICAL = tissue('cortical')
const T_MARROW = tissue('marrow')
const T_STONE = tissue('stone')
const T_CALC = tissue('calcification')

/** The interval where a ray (o + t d) is inside a member, into out[0..1]; false if it misses. */
export function memberChord(ph: Phantom, m: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, out: number[]): boolean {
  const d = ph.memData
  const o = m * 20
  const kind = ph.memKind[m]
  if (kind === M_CAPSULE || kind === M_CONE) {
    const ax = d[o]
    const ay = d[o + 1]
    const az = d[o + 2]
    const bx = d[o + 3]
    const by = d[o + 4]
    const bz = d[o + 5]
    const r = kind === M_CAPSULE ? d[o + 6] : (d[o + 6] + d[o + 7]) / 2
    let lo = Infinity
    let hi = -Infinity
    // the two end spheres
    for (let e = 0; e < 2; e++) {
      const cx = e ? bx : ax
      const cy = e ? by : ay
      const cz = e ? bz : az
      const px = ox - cx
      const py = oy - cy
      const pz = oz - cz
      const b = px * dx + py * dy + pz * dz
      const c = px * px + py * py + pz * pz - r * r
      const disc = b * b - c
      if (disc > 0) {
        const s = Math.sqrt(disc)
        lo = Math.min(lo, -b - s)
        hi = Math.max(hi, -b + s)
      }
    }
    // the cylinder between them
    const ex = bx - ax
    const ey = by - ay
    const ez = bz - az
    const len2 = ex * ex + ey * ey + ez * ez
    if (len2 > 1e-9) {
      const len = Math.sqrt(len2)
      const wx = ex / len
      const wy = ey / len
      const wz = ez / len
      const px = ox - ax
      const py = oy - ay
      const pz = oz - az
      const dw = dx * wx + dy * wy + dz * wz
      const pw = px * wx + py * wy + pz * wz
      const qx = dx - dw * wx
      const qy = dy - dw * wy
      const qz = dz - dw * wz
      const rx = px - pw * wx
      const ry = py - pw * wy
      const rz = pz - pw * wz
      const A = qx * qx + qy * qy + qz * qz
      const B = 2 * (qx * rx + qy * ry + qz * rz)
      const C = rx * rx + ry * ry + rz * rz - r * r
      if (A > 1e-12) {
        const disc = B * B - 4 * A * C
        if (disc > 0) {
          const s = Math.sqrt(disc)
          let t0 = (-B - s) / (2 * A)
          let t1 = (-B + s) / (2 * A)
          // clip to the slab between the end planes
          if (Math.abs(dw) > 1e-12) {
            const a0 = -pw / dw
            const a1 = (len - pw) / dw
            const s0 = Math.min(a0, a1)
            const s1 = Math.max(a0, a1)
            t0 = Math.max(t0, s0)
            t1 = Math.min(t1, s1)
          } else if (pw < 0 || pw > len) t1 = t0 - 1
          if (t1 > t0) {
            lo = Math.min(lo, t0)
            hi = Math.max(hi, t1)
          }
        }
      }
    }
    if (hi <= lo) return false
    out[0] = lo
    out[1] = hi
    return true
  }
  // the rigid kinds: the ray in the member's local frame
  const lox = d[o] * ox + d[o + 1] * oy + d[o + 2] * oz + d[o + 3]
  const loy = d[o + 4] * ox + d[o + 5] * oy + d[o + 6] * oz + d[o + 7]
  const loz = d[o + 8] * ox + d[o + 9] * oy + d[o + 10] * oz + d[o + 11]
  const ldx = d[o] * dx + d[o + 1] * dy + d[o + 2] * dz
  const ldy = d[o + 4] * dx + d[o + 5] * dy + d[o + 6] * dz
  const ldz = d[o + 8] * dx + d[o + 9] * dy + d[o + 10] * dz
  if (kind === M_ELLIPSOID) {
    const px = lox / d[o + 12]
    const py = loy / d[o + 13]
    const pz = loz / d[o + 14]
    const qx = ldx / d[o + 12]
    const qy = ldy / d[o + 13]
    const qz = ldz / d[o + 14]
    const A = qx * qx + qy * qy + qz * qz
    const B = 2 * (px * qx + py * qy + pz * qz)
    const C = px * px + py * py + pz * pz - 1
    const disc = B * B - 4 * A * C
    if (disc <= 0) return false
    const s = Math.sqrt(disc)
    out[0] = (-B - s) / (2 * A)
    out[1] = (-B + s) / (2 * A)
    return true
  }
  if (kind === M_BOX) {
    let t0 = -Infinity
    let t1 = Infinity
    const P = [lox, loy, loz]
    const D = [ldx, ldy, ldz]
    for (let a = 0; a < 3; a++) {
      const h = d[o + 12 + a]
      if (Math.abs(D[a]) < 1e-12) {
        if (P[a] < -h || P[a] > h) return false
        continue
      }
      let s0 = (-h - P[a]) / D[a]
      let s1 = (h - P[a]) / D[a]
      if (s0 > s1) {
        const tt = s0
        s0 = s1
        s1 = tt
      }
      t0 = Math.max(t0, s0)
      t1 = Math.min(t1, s1)
    }
    if (t1 <= t0) return false
    out[0] = t0
    out[1] = t1
    return true
  }
  // M_TAPER: an elliptic tube along local z whose half-axes change along it: cut into 8 slabs, each with its own mean half-axes (a
  // radiograph must not show the joins of the trunk's segments as steps)
  const z0 = d[o + 12]
  const z1 = d[o + 13]
  let lo = Infinity
  let hi = -Infinity
  const SLABS = 8
  for (let k = 0; k < SLABS; k++) {
    const za = z0 + ((z1 - z0) * k) / SLABS
    const zb = z0 + ((z1 - z0) * (k + 1)) / SLABS
    const f = (k + 0.5) / SLABS
    const a = d[o + 14] + (d[o + 16] - d[o + 14]) * f
    const b = d[o + 15] + (d[o + 17] - d[o + 15]) * f
    const px = lox / a
    const py = loy / b
    const qx = ldx / a
    const qy = ldy / b
    const A = qx * qx + qy * qy
    let t0 = -Infinity
    let t1 = Infinity
    if (A > 1e-12) {
      const B = 2 * (px * qx + py * qy)
      const C = px * px + py * py - 1
      const disc = B * B - 4 * A * C
      if (disc <= 0) continue
      const s = Math.sqrt(disc)
      t0 = (-B - s) / (2 * A)
      t1 = (-B + s) / (2 * A)
    } else if (px * px + py * py > 1) continue
    if (Math.abs(ldz) > 1e-12) {
      let s0 = (za - loz) / ldz
      let s1 = (zb - loz) / ldz
      if (s0 > s1) {
        const tt = s0
        s0 = s1
        s1 = tt
      }
      t0 = Math.max(t0, s0)
      t1 = Math.min(t1, s1)
    } else if (loz < za || loz > zb) continue
    if (t1 <= t0) continue
    lo = Math.min(lo, t0)
    hi = Math.max(hi, t1)
  }
  if (hi <= lo) return false
  out[0] = lo
  out[1] = hi
  return true
}

export class XrayRenderer {
  private tiles: Int32Array[] = []
  private L = new Float32Array(0)
  private a = new Float32Array(0)
  private b = new Float32Array(0)
  private tmp = new Float32Array(0)
  private grey = new Uint8Array(0)
  private readonly seg: number[] = [0, 0]
  // per ray: intervals (start, end, part)
  private iv = new Float64Array(4096 * 3)

  /** Line integrals (sum of mu x mm / 10) per output pixel, for tests. */
  get lastIntegral(): Float32Array {
    return this.L
  }

  render(ph: Phantom, req: XrayRequest): Uint8Array {
    const N = req.size
    const pr = req.proj
    if (this.L.length !== N * N) {
      this.L = new Float32Array(N * N)
      this.a = new Float32Array(N * N)
      this.b = new Float32Array(N * N)
      this.tmp = new Float32Array(N * N)
      this.grey = new Uint8Array(N * N)
    }
    this.binParts(ph, pr, N)
    // the energy: lower kV, bone (and calcium) attenuates relatively more
    const boneGain = 1 + Math.max(0, (85 - req.kv) / 70)
    const mu = TABLE.mu
    const nt = ph.nParts
    const tilesX = Math.ceil(N / TILE)
    for (let j = 0; j < N; j++) {
      const y = ((j + 0.5) / N - 0.5) * pr.height
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) / N - 0.5) * pr.width
        const tx = pr.dx + pr.ux * x + pr.vx * y
        const ty = pr.dy + pr.uy * x + pr.vy * y
        const tz = pr.dz + pr.uz * x + pr.vz * y
        let dx = tx - pr.sx
        let dy = ty - pr.sy
        let dz = tz - pr.sz
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
        dx /= len
        dy /= len
        dz /= len
        const list = this.tiles[Math.floor(j / TILE) * tilesX + Math.floor(i / TILE)]
        // the intervals of every part on this ray
        let n = 0
        for (let q = 0; q < list.length; q++) {
          const p = list[q]
          if (p >= nt) continue
          const m0 = ph.partM0[p]
          for (let m = m0; m < m0 + ph.partMN[p]; m++) {
            if (!memberChord(ph, m, pr.sx, pr.sy, pr.sz, dx, dy, dz, this.seg)) continue
            if (n * 3 + 3 > this.iv.length) break
            this.iv[n * 3] = this.seg[0]
            this.iv[n * 3 + 1] = this.seg[1]
            this.iv[n * 3 + 2] = p
            n++
          }
        }
        this.L[j * N + i] = n === 0 ? 0 : this.integrate(ph, n, mu, boneGain) / 10
      }
    }
    return this.detector(req, N)
  }

  /**
   * The attenuation along the ray from its intervals: the ray is cut at every interval end; each piece takes the mu of the highest layer
   * covering it (the subtracted members of a part are ignored: a radiograph does not see the kidney's hilum notch).
   */
  private integrate(ph: Phantom, n: number, mu: Float64Array, boneGain: number): number {
    const iv = this.iv
    // cut points: all starts and ends, sorted (insertion sort: n is small)
    const cuts = this.cuts(n)
    let sum = 0
    for (let c = 0; c + 1 < cuts.length; c++) {
      const a = cuts[c]
      const b = cuts[c + 1]
      if (b - a < 1e-6) continue
      const mid = (a + b) / 2
      let best = -1
      let layer = -1e9
      for (let k = 0; k < n; k++) {
        if (iv[k * 3] <= mid && mid <= iv[k * 3 + 1]) {
          const p = iv[k * 3 + 2]
          const l = ph.partLayer[p]
          if (l > layer || (l === layer && p > best)) {
            layer = l
            best = p
          }
        }
      }
      if (best < 0) continue
      const t = ph.partTissue[best]
      const bone = t === T_CORTICAL || t === T_MARROW || t === T_STONE || t === T_CALC
      sum += (b - a) * mu[t] * (bone ? boneGain : 1)
    }
    return sum
  }

  private cutArr: number[] = []
  private cuts(n: number): number[] {
    const out = this.cutArr
    out.length = 0
    for (let k = 0; k < n; k++) {
      out.push(this.iv[k * 3], this.iv[k * 3 + 1])
    }
    out.sort(byValue)
    return out
  }

  /** Bin the parts into detector tiles by their boxes' projected corners. */
  private binParts(ph: Phantom, pr: Projection, N: number): void {
    const tilesX = Math.ceil(N / TILE)
    const lists: number[][] = Array.from({ length: tilesX * tilesX }, () => [])
    const box = ph.partBox
    for (let p = 0; p < ph.nParts; p++) {
      let minI = Infinity
      let maxI = -Infinity
      let minJ = Infinity
      let maxJ = -Infinity
      for (let c = 0; c < 8; c++) {
        const x = box[p * 6 + (c & 1 ? 3 : 0)]
        const y = box[p * 6 + 1 + (c & 2 ? 3 : 0)]
        const z = box[p * 6 + 2 + (c & 4 ? 3 : 0)]
        // project the corner from the focal spot onto the detector plane
        const nx = pr.uy * pr.vz - pr.uz * pr.vy
        const ny = pr.uz * pr.vx - pr.ux * pr.vz
        const nz = pr.ux * pr.vy - pr.uy * pr.vx
        const rx = x - pr.sx
        const ry = y - pr.sy
        const rz = z - pr.sz
        const den = rx * nx + ry * ny + rz * nz
        if (Math.abs(den) < 1e-9) continue
        const t = ((pr.dx - pr.sx) * nx + (pr.dy - pr.sy) * ny + (pr.dz - pr.sz) * nz) / den
        const hx = pr.sx + rx * t - pr.dx
        const hy = pr.sy + ry * t - pr.dy
        const hz = pr.sz + rz * t - pr.dz
        const u = hx * pr.ux + hy * pr.uy + hz * pr.uz
        const v = hx * pr.vx + hy * pr.vy + hz * pr.vz
        const i = (u / pr.width + 0.5) * N
        const j = (v / pr.height + 0.5) * N
        minI = Math.min(minI, i)
        maxI = Math.max(maxI, i)
        minJ = Math.min(minJ, j)
        maxJ = Math.max(maxJ, j)
      }
      const i0 = Math.max(0, Math.floor(minI / TILE))
      const i1 = Math.min(tilesX - 1, Math.floor(maxI / TILE))
      const j0 = Math.max(0, Math.floor(minJ / TILE))
      const j1 = Math.min(tilesX - 1, Math.floor(maxJ / TILE))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * tilesX + i].push(p)
    }
    this.tiles = lists.map((l) => Int32Array.from(l))
  }

  /** From line integrals to the displayed radiograph. */
  private detector(req: XrayRequest, N: number): Uint8Array {
    const L = this.L
    const a = this.a
    const b = this.b
    const tmp = this.tmp
    const n = N * N
    // primary intensity, a heel-effect gradient across the field, scatter, mottle
    for (let k = 0; k < n; k++) {
      const x = (k % N) / N
      a[k] = Math.exp(-L[k]) * (1.06 - 0.12 * x)
    }
    gaussianBlur(a, b, tmp, N, N, N * 0.06)
    for (let k = 0; k < n; k++) a[k] = a[k] + req.spr * 0.35 * b[k]
    gaussianNoise(b, req.seed >>> 0)
    for (let k = 0; k < n; k++) a[k] = Math.max(1e-6, a[k] + b[k] * Math.sqrt(Math.max(a[k], 1e-6) / req.photons))
    gaussianBlur(a, a, tmp, N, N, 0.6)
    // DR processing: density (log), equalisation (a large blur taken partly out) and a little edge enhancement
    for (let k = 0; k < n; k++) a[k] = -Math.log(a[k])
    gaussianBlur(a, b, tmp, N, N, N * 0.05)
    for (let k = 0; k < n; k++) a[k] = a[k] - (req.topogram ? 0.2 : 0.35) * b[k]
    gaussianBlur(a, b, tmp, N, N, 1.4)
    for (let k = 0; k < n; k++) a[k] = a[k] + 0.6 * (a[k] - b[k])
    // the collimated field and its range (1st and 99.5th percentile) -> a sigmoid look-up table
    const fx0 = Math.floor(((1 - req.fieldW) / 2) * N)
    const fx1 = Math.ceil(((1 + req.fieldW) / 2) * N)
    const fy0 = Math.floor(((1 - req.fieldH) / 2) * N)
    const fy1 = Math.ceil(((1 + req.fieldH) / 2) * N)
    const vals: number[] = []
    for (let j = fy0; j < fy1; j += 2) for (let i = fx0; i < fx1; i += 2) vals.push(a[j * N + i])
    vals.sort((x, y) => x - y)
    const lo = vals[Math.floor(vals.length * 0.005)] ?? 0
    const hi = vals[Math.floor(vals.length * 0.998)] ?? 1
    const g = this.grey
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i
        const inside = req.topogram || (i >= fx0 && i < fx1 && j >= fy0 && j < fy1)
        if (!inside) {
          g[k] = 0
          continue
        }
        const t = (a[k] - lo) / (hi - lo || 1)
        const s = 1 / (1 + Math.exp(-6 * (t - 0.5)))
        const s0 = 1 / (1 + Math.exp(3))
        const s1 = 1 / (1 + Math.exp(-3))
        const v = (s - s0) / (s1 - s0)
        g[k] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
      }
    }
    return g
  }
}
