/**
 * R3 "Real screens": the tissues of the synthetic body on a slice plane, with partial volume at the edges: the shared first step of the CT
 * and MRI renderers. The body is sampled at the corners of a B x B pixel grid; a pixel whose four corners agree is that tissue; a pixel on
 * an edge is sampled four more times inside (two a quarter-slice in front of the plane, two behind it), and keeps its two commonest
 * tissues and their mix. That is anti-aliasing and slice thickness for about 1.3 lookups a pixel. Pure; one instance per renderer keeps its
 * buffers.
 */
import { labelAt, type Phantom } from '../phantom/body'

/** A slice: centre, the picture's right (u) and down (v) directions and the normal (unit, LPS), its field of view and thickness (mm). */
export interface Plane {
  cx: number
  cy: number
  cz: number
  ux: number
  uy: number
  uz: number
  vx: number
  vy: number
  vz: number
  nx: number
  ny: number
  nz: number
  fov: number
  thick: number
}

/** A plane from a centre and two in-plane directions (the normal is their cross product). */
export function plane(c: readonly number[], u: readonly number[], v: readonly number[], fov: number, thick: number): Plane {
  const nx = u[1] * v[2] - u[2] * v[1]
  const ny = u[2] * v[0] - u[0] * v[2]
  const nz = u[0] * v[1] - u[1] * v[0]
  return { cx: c[0], cy: c[1], cz: c[2], ux: u[0], uy: u[1], uz: u[2], vx: v[0], vy: v[1], vz: v[2], nx, ny, nz, fov, thick }
}

export class SliceRaster {
  size = 0
  /** Per pixel: the main tissue, the second tissue, the main tissue's share (0..1). */
  tA = new Uint8Array(0)
  tB = new Uint8Array(0)
  wA = new Float32Array(0)
  /** Per pixel: the main part (for per-part detail such as flow), -1 for air. */
  pA = new Int32Array(0)
  private corner = new Int32Array(0)

  rasterize(ph: Phantom, p: Plane, size: number, breath = 0): void {
    if (this.size !== size) {
      this.size = size
      this.tA = new Uint8Array(size * size)
      this.tB = new Uint8Array(size * size)
      this.wA = new Float32Array(size * size)
      this.pA = new Int32Array(size * size)
      this.corner = new Int32Array((size + 1) * (size + 1))
    }
    const S1 = size + 1
    const step = p.fov / size
    const half = p.fov / 2
    const cor = this.corner
    // the corners of the pixel grid
    for (let y = 0; y <= size; y++) {
      const b = y * step - half
      for (let x = 0; x <= size; x++) {
        const a = x * step - half
        cor[y * S1 + x] = labelAt(ph, p.cx + p.ux * a + p.vx * b, p.cy + p.uy * a + p.vy * b, p.cz + p.uz * a + p.vz * b, breath)
      }
    }
    const tissueOf = (i: number): number => (i < 0 ? 0 : ph.partTissue[i])
    const dz = p.thick / 4
    // per pixel: the four corners, and four more samples inside where they disagree
    const cand = [0, 0, 0, 0, 0, 0, 0, 0]
    const part = [0, 0, 0, 0, 0, 0, 0, 0]
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const k = y * size + x
        const c0 = cor[y * S1 + x]
        const c1 = cor[y * S1 + x + 1]
        const c2 = cor[(y + 1) * S1 + x]
        const c3 = cor[(y + 1) * S1 + x + 1]
        const t0 = tissueOf(c0)
        if (t0 === tissueOf(c1) && t0 === tissueOf(c2) && t0 === tissueOf(c3)) {
          this.tA[k] = t0
          this.tB[k] = t0
          this.wA[k] = 1
          this.pA[k] = c0
          continue
        }
        let n = 0
        part[n] = c0
        cand[n++] = t0
        part[n] = c1
        cand[n++] = tissueOf(c1)
        part[n] = c2
        cand[n++] = tissueOf(c2)
        part[n] = c3
        cand[n++] = tissueOf(c3)
        for (let s = 0; s < 4; s++) {
          const a = (x + 0.25 + 0.5 * (s & 1)) * step - half
          const b = (y + 0.25 + 0.5 * (s >> 1)) * step - half
          const d = s === 0 || s === 3 ? -dz : dz
          const i = labelAt(ph, p.cx + p.ux * a + p.vx * b + p.nx * d, p.cy + p.uy * a + p.vy * b + p.ny * d, p.cz + p.uz * a + p.vz * b + p.nz * d, breath)
          part[n] = i
          cand[n++] = tissueOf(i)
        }
        // the two commonest tissues of the eight samples
        let bestT = cand[0]
        let bestN = 0
        let secT = cand[0]
        let secN = 0
        let bestP = part[0]
        for (let i = 0; i < 8; i++) {
          let c = 0
          for (let j = 0; j < 8; j++) if (cand[j] === cand[i]) c++
          if (c > bestN) {
            if (cand[i] !== bestT) {
              secT = bestT
              secN = bestN
            }
            bestT = cand[i]
            bestN = c
            bestP = part[i]
          } else if (cand[i] !== bestT && c > secN) {
            secT = cand[i]
            secN = c
          }
        }
        this.tA[k] = bestT
        this.tB[k] = secN > 0 ? secT : bestT
        this.wA[k] = bestN / (bestN + secN)
        this.pA[k] = bestP
      }
    }
  }
}
