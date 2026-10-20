/**
 * R3 "Real screens": seeded noise for the image renderers, allocation-free. A hashed integer lattice in 3D (so noise is FIXED TO THE TISSUE:
 * the same point of the same patient always gets the same value, and a probe that moves slides over the same speckle), read through
 * trilinear interpolation:
 *
 *   gaussPair   two independent Gaussian fields (the in-phase and quadrature parts of the ultrasound scatterers: their magnitude is
 *               Rayleigh-distributed speckle)
 *   value3      a smooth 0..1 field (tissue texture: the coarse mottling of the liver, the lobules of fat, fibres in muscle)
 *
 * Gaussian values come from a fixed table indexed by the hash, which is much cheaper than a Box-Muller per lattice point.
 */
import { mulberry32 } from '@/sim/rng'

const TABLE_BITS = 12
const TABLE_MASK = (1 << TABLE_BITS) - 1

/** 4096 standard-normal values, fixed for every patient (the hash decides which one a lattice point gets). */
export const GAUSS: Float32Array = (() => {
  const r = mulberry32(0x6a09e667)
  const out = new Float32Array(1 << TABLE_BITS)
  for (let i = 0; i < out.length; i += 2) {
    const u1 = Math.max(1e-12, r())
    const u2 = r()
    const m = Math.sqrt(-2 * Math.log(u1))
    out[i] = m * Math.cos(2 * Math.PI * u2)
    out[i + 1] = m * Math.sin(2 * Math.PI * u2)
  }
  return out
})()

/** A 32-bit hash of an integer lattice point and a seed. */
export function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x9e3779b1) ^ seed
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** The result of `gaussPair` (module scratch: read it right after the call). */
export const PAIR = { i: 0, q: 0 }

/**
 * Two Gaussian fields at a point (mm), on a lattice of `cell` mm, trilinearly interpolated. The interpolation lowers the variance a little;
 * the caller's gain absorbs that. Writes PAIR.
 */
export function gaussPair(x: number, y: number, z: number, cell: number, seed: number): void {
  const fx = x / cell
  const fy = y / cell
  const fz = z / cell
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const iz = Math.floor(fz)
  const tx = fx - ix
  const ty = fy - iy
  const tz = fz - iz
  let si = 0
  let sq = 0
  for (let c = 0; c < 8; c++) {
    const dx = c & 1
    const dy = (c >> 1) & 1
    const dz = (c >> 2) & 1
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz)
    const h = hash3(ix + dx, iy + dy, iz + dz, seed)
    si += w * GAUSS[h & TABLE_MASK]
    sq += w * GAUSS[(h >>> TABLE_BITS) & TABLE_MASK]
  }
  PAIR.i = si
  PAIR.q = sq
}

/** A smooth value field 0..1 on a lattice of `cell` mm (smoothstep-weighted trilinear). */
export function value3(x: number, y: number, z: number, cell: number, seed: number): number {
  const fx = x / cell
  const fy = y / cell
  const fz = z / cell
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const iz = Math.floor(fz)
  let tx = fx - ix
  let ty = fy - iy
  let tz = fz - iz
  tx = tx * tx * (3 - 2 * tx)
  ty = ty * ty * (3 - 2 * ty)
  tz = tz * tz * (3 - 2 * tz)
  let s = 0
  for (let c = 0; c < 8; c++) {
    const dx = c & 1
    const dy = (c >> 1) & 1
    const dz = (c >> 2) & 1
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz)
    s += w * ((hash3(ix + dx, iy + dy, iz + dz, seed) & 0xffff) / 65535)
  }
  return s
}

/** Two octaves of `value3`: a little more natural texture for the price of two lookups. */
export function fbm2(x: number, y: number, z: number, cell: number, seed: number): number {
  return 0.65 * value3(x, y, z, cell, seed) + 0.35 * value3(x, y, z, cell * 0.45, seed ^ 0x51ed27)
}
