/**
 * R5 wave 3 (agent J): the skin of the patient on a procedure table as a HEIGHT FIELD, the top surface of the body over the table, in the patient's own frame (`z` along the
 * table toward the feet from the pelvis, `x` across, `h` above the pad). The drapes of the CT and ultrasound rooms are shaped over it. It is rasterised from the patient's
 * triangles, skinned as the GPU draws them now (crowd/skinSource.ts `skinInto`), so a body of any size, in any position (face down, on its side, rolled on the couch) is
 * fitted exactly, with no table of numbers to go stale. The prepped plate reads the field itself (the highest triangle at each cell's middle, read bilinearly: it hugs the
 * skin within a centimetre); the sheet reads a wide maximum-filtered copy (a 4 cm cross-section spacing cannot dip into the body between samples).
 *
 * A fit is a JOB, spread over frames (P1): `beginFit` clears the rows the stage reads and `stepFit(budget)` does at most `budget` units of work (a unit is about a hundredth of a
 * millisecond on an M4: `FIT_UNITS_PER_MS`) of the raster of the triangles, then of the two passes of the blur, into a SECOND pair of grids; when it is complete the two pairs swap,
 * so the stage always reads a whole fit, never half of one. Only the rows the stage reads are fitted (`zLo` .. `zHi`, the sheet's span, plus the blur's reach): a triangle wholly
 * outside them costs a few comparisons, the blur covers those rows only (rows of the grids outside are not valid: nothing reads them). `fitField` is the whole job in one call
 * (the tests', and a first fit with no budget).
 *
 * Every grid is allocated once; rasterising and blurring allocate nothing.
 */

/** The field's extent (metres) and its cell: the whole body from the hands over the head to the toes, and the arms out to either side. */
export const FIELD = { z0: -1.25, z1: 1.15, x0: -0.64, x1: 0.64, cell: 0.01 } as const
export const FIELD_NZ = Math.ceil((FIELD.z1 - FIELD.z0) / FIELD.cell)
export const FIELD_NX = Math.ceil((FIELD.x1 - FIELD.x0) / FIELD.cell)

/** A cell no triangle covers. */
export const NO_SKIN = -9

/**
 * The blur radii (cells) of the sheet's copy: along and across. Along it is at least the sheet's 4 cm row spacing, so that of two rows either side of a point BOTH stand over the skin there
 * (a point between them is a blend of the two: it cannot dip under a peak one of them covers), across at least the 2.5 cm lattice.
 */
export const WIDE_BLUR = { rz: 5, rx: 3 } as const

/**
 * How far past the rows the stage reads (`zLo` .. `zHi`) the raster reaches, so the blur is exact over them (its along radius is 5 cells; 3 cm of the rest is for the bilinear
 * reads a row's neighbours, and what is left is slack).
 */
export const FIT_MARGIN = 0.08

/**
 * The work units a millisecond of the fit is worth on an M4 (measured: the whole stage's span, 3 999 triangles of an avatar, is about 380 000 units in 1.3 to 1.7 ms). A unit is a
 * sub-sample of the raster or a splat (about 4 ns); the blur's rows are charged what they cost in those (`ROW_UNITS_X`, `ROW_UNITS_Z`: about 1.5 ns a cell a pass).
 */
export const FIT_UNITS_PER_MS = 240_000
/** What a row of the two blur passes is worth in units, per cell of the row. */
export const ROW_UNITS_X = 2
export const ROW_UNITS_Z = 3

export interface SkinField {
  /** The top surface per cell (row-major: nz rows of nx), NO_SKIN where no triangle covers it. Valid over the rows of the last fit (the sheet's span and `FIT_MARGIN`). */
  h: Float32Array
  /** The same, maximum-filtered over WIDE_BLUR. Valid over the rows `WIDE_BLUR.rz` inside those. */
  wide: Float32Array
  /** The fit in progress: its grids and the blur's middle. */
  nh: Float32Array
  nwide: Float32Array
  tmp: Float32Array
  /** How many fits were completed (the tests count them). */
  fits: number
  /** A fit is running (`beginFit` .. the last `stepFit`). */
  busy: boolean
  /** 0 idle, 1 rasterising, 2 blurring along x, 3 blurring along z. */
  phase: number
  /** The next triangle (phase 1) or row (phases 2 and 3). */
  next: number
  tris: number
  v: ArrayLike<number>
  index: ArrayLike<number>
  /** The rows the fit covers (inclusive), from `zLo` and `zHi`. */
  i0: number
  i1: number
  /** The work units the last fit took, and the last `stepFit` call (the tests). */
  work: number
  slice: number
}

const EMPTY: ArrayLike<number> = new Float32Array(0)

export function newSkinField(): SkinField {
  const n = FIELD_NZ * FIELD_NX
  return {
    h: new Float32Array(n).fill(NO_SKIN),
    wide: new Float32Array(n).fill(NO_SKIN),
    nh: new Float32Array(n).fill(NO_SKIN),
    nwide: new Float32Array(n).fill(NO_SKIN),
    tmp: new Float32Array(n),
    fits: 0,
    busy: false,
    phase: 0,
    next: 0,
    tris: 0,
    v: EMPTY,
    index: EMPTY,
    i0: 0,
    i1: FIELD_NZ - 1,
    work: 0,
    slice: 0,
  }
}

/** The rows of the field the metres `zLo` .. `zHi` (patient frame z) reach, widened by `margin`. */
function rowOf(z: number): number {
  const i = Math.floor((z - FIELD.z0) / FIELD.cell)
  return i < 0 ? 0 : i > FIELD_NZ - 1 ? FIELD_NZ - 1 : i
}

/**
 * Start fitting the body whose vertices are `v` (three floats each: x across, h above the pad, z toward the feet: `skinInto`'s output) with `tris` triangles listed by `index`, to the
 * rows `zLo` .. `zHi` (metres; the stage's span; the default is the whole field) and `FIT_MARGIN` beyond. `v` and `index` must not change until the fit is complete. A fit in progress
 * is dropped.
 */
export function beginFit(f: SkinField, v: ArrayLike<number>, index: ArrayLike<number>, tris: number, zLo = -Infinity, zHi = Infinity): void {
  f.v = v
  f.index = index
  f.tris = tris
  f.i0 = zLo === -Infinity ? 0 : rowOf(zLo - FIT_MARGIN)
  f.i1 = zHi === Infinity ? FIELD_NZ - 1 : rowOf(zHi + FIT_MARGIN)
  f.nh.fill(NO_SKIN, f.i0 * FIELD_NX, (f.i1 + 1) * FIELD_NX)
  f.busy = true
  f.phase = 1
  f.next = 0
  f.work = 0
}

/** Drop the fit in progress (nothing is swapped: the grids the stage reads stay the last whole fit). */
export function cancelFit(f: SkinField): void {
  f.busy = false
  f.phase = 0
  f.v = EMPTY
  f.index = EMPTY
}

/** The rows the raster writes (module scratch of the job being stepped; the job is single-threaded). */
let R0 = 0
let R1 = FIELD_NZ - 1

/**
 * Do up to `budget` work units of the fit begun by `beginFit` (at least one triangle or row, so every call makes progress; `Infinity`: all of it). Returns true when it completed
 * (the grids were swapped and `f.fits` counted), false while more is left. Does nothing (false) when no fit is running.
 */
export function stepFit(f: SkinField, budget: number): boolean {
  if (!f.busy) return false
  R0 = f.i0
  R1 = f.i1
  let spent = 0
  if (f.phase === 1) {
    spent = raster(f, budget)
    if (f.next < f.tris) {
      f.work += spent
      f.slice = spent
      return false
    }
    f.phase = 2
    f.next = f.i0
  }
  if (f.phase === 2) {
    while (f.next <= f.i1) {
      if (spent >= budget) {
        f.work += spent
        f.slice = spent
        return false
      }
      blurRowX(f.nh, f.tmp, f.next, WIDE_BLUR.rx)
      f.next++
      spent += FIELD_NX * ROW_UNITS_X
    }
    f.phase = 3
    f.next = f.i0 === 0 ? 0 : f.i0 + WIDE_BLUR.rz
  }
  // (rows within the blur's reach of the fit's own first and last rows lack part of their window: they are not valid, unless that row is the field's own edge)
  const last = f.i1 === FIELD_NZ - 1 ? FIELD_NZ - 1 : f.i1 - WIDE_BLUR.rz
  while (f.next <= last) {
    if (spent >= budget) {
      f.work += spent
      f.slice = spent
      return false
    }
    blurRowZ(f.tmp, f.nwide, f.next, WIDE_BLUR.rz, f.i0, f.i1)
    f.next++
    spent += FIELD_NX * ROW_UNITS_Z
  }
  f.work += spent
  f.slice = spent
  // complete: the finished grids become the ones the stage reads
  const h = f.h
  f.h = f.nh
  f.nh = h
  const w = f.wide
  f.wide = f.nwide
  f.nwide = w
  f.fits++
  f.busy = false
  f.phase = 0
  f.v = EMPTY
  f.index = EMPTY
  return true
}

/**
 * Rasterise the triangles `f.next` .. until `budget` units are spent into the back grid `f.nh`; returns the units spent, `f.next` the next triangle. A cell takes the highest of four
 * sub-samples inside it, so a ridge or a peak between cell middles is not missed by more than a quarter cell's slope.
 */
function raster(f: SkinField, budget: number): number {
  const v = f.v
  const index = f.index
  const H = f.nh
  const { z0, x0, cell } = FIELD
  const nx = FIELD_NX
  const zLoRow = z0 + R0 * cell
  const zHiRow = z0 + (R1 + 1) * cell
  const tris = f.tris
  let spent = 0
  let t = f.next
  for (; t < tris && spent < budget; t++) {
    const a = index[t * 3] * 3
    const b = index[t * 3 + 1] * 3
    const c = index[t * 3 + 2] * 3
    const az = v[a + 2]
    const bz = v[b + 2]
    const cz = v[c + 2]
    const minZ = az < bz ? (az < cz ? az : cz) : bz < cz ? bz : cz
    const maxZ = az > bz ? (az > cz ? az : cz) : bz > cz ? bz : cz
    // (a triangle wholly outside the rows the stage reads: the head and the arms over it, beyond the feet)
    if (maxZ < zLoRow || minZ >= zHiRow) {
      spent += 2
      continue
    }
    const ax = v[a]
    const ah = v[a + 1]
    const bx = v[b]
    const bh = v[b + 1]
    const cx = v[c]
    const ch = v[c + 1]
    // the corners first: the highest point of a triangle is a corner, a peak narrower than a cell is kept (in the cell it is in), and a triangle seen edge-on (a wall) has
    // nothing else to give
    splat(H, az, ax, ah)
    splat(H, bz, bx, bh)
    splat(H, cz, cx, ch)
    spent += 6
    // barycentric in the (z, x) plane
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (den > -1e-14 && den < 1e-14) {
      // (no footprint: its edges, a point every half cell, stand for it)
      spent += edge(H, az, ax, ah, bz, bx, bh)
      spent += edge(H, bz, bx, bh, cz, cx, ch)
      spent += edge(H, cz, cx, ch, az, ax, ah)
      continue
    }
    const inv = 1 / den
    const minX = ax < bx ? (ax < cx ? ax : cx) : bx < cx ? bx : cx
    const maxX = ax > bx ? (ax > cx ? ax : cx) : bx > cx ? bx : cx
    let i0 = Math.floor((minZ - z0) / cell)
    let i1 = Math.floor((maxZ - z0) / cell)
    let j0 = Math.floor((minX - x0) / cell)
    let j1 = Math.floor((maxX - x0) / cell)
    if (i0 < R0) i0 = R0
    if (j0 < 0) j0 = 0
    if (i1 > R1) i1 = R1
    if (j1 > nx - 1) j1 = nx - 1
    // a steep triangle (over about 56 degrees: a flank's silhouette, a toe) has a sliver of a footprint no sub-sample may hit, and the body's underside would stand for the top
    // there: it is sampled along its own surface instead, on a lattice as fine as half a cell in the plan, each point raising the cell it is in
    const gx = (ah * (bz - cz) + bh * (cz - az) + ch * (az - bz)) * inv
    const gz = (ah * (cx - bx) + bh * (ax - cx) + ch * (bx - ax)) * inv
    if (gx * gx + gz * gz > 2.25) {
      const e0 = Math.hypot(bz - az, bx - ax)
      const e1 = Math.hypot(cz - bz, cx - bx)
      const e2 = Math.hypot(az - cz, ax - cx)
      const longest = e0 > e1 ? (e0 > e2 ? e0 : e2) : e1 > e2 ? e1 : e2
      let n = Math.ceil(longest / (cell * 0.5))
      if (n < 1) n = 1
      else if (n > 12) n = 12
      for (let u = 0; u <= n; u++) {
        for (let w = 0; w <= n - u; w++) {
          const l2 = u / n
          const l3 = w / n
          const l1 = 1 - l2 - l3
          splat(H, l1 * az + l2 * bz + l3 * cz, l1 * ax + l2 * bx + l3 * cx, l1 * ah + l2 * bh + l3 * ch)
        }
      }
      spent += ((n + 1) * (n + 2)) >> 1
    }
    // the barycentric weights are linear in (z, x): l1 = d1z * (z - cz) + d1x * (x - cx) (and l2 likewise), so a sample's weights cost two multiplies each
    const d1z = (cx - bx) * inv
    const d1x = (bz - cz) * inv
    const d2z = (ax - cx) * inv
    const d2x = (cz - az) * inv
    for (let i = i0; i <= i1; i++) {
      const zA = z0 + (i + 0.25) * cell - cz
      const zB = z0 + (i + 0.75) * cell - cz
      for (let j = j0; j <= j1; j++) {
        const xA = x0 + (j + 0.25) * cell - cx
        const xB = x0 + (j + 0.75) * cell - cx
        let best = NO_SKIN
        for (let q = 0; q < 4; q++) {
          const dz = q < 2 ? zA : zB
          const dx = (q & 1) === 0 ? xA : xB
          const l1 = d1z * dz + d1x * dx
          const l2 = d2z * dz + d2x * dx
          const l3 = 1 - l1 - l2
          if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
          const hh = l1 * ah + l2 * bh + l3 * ch
          if (hh > best) best = hh
        }
        const k = i * nx + j
        if (best > H[k]) H[k] = best
      }
    }
    spent += 4 * (i1 - i0 + 1) * (j1 - j0 + 1) + 4
  }
  f.next = t
  return spent
}

/** Raise the cells along the segment from (`z0`, `x0`, `h0`) to (`z1`, `x1`, `h1`), a point every half cell; returns the points. */
function edge(H: Float32Array, z0: number, x0: number, h0: number, z1: number, x1: number, h1: number): number {
  const len = Math.hypot(z1 - z0, x1 - x0)
  let n = Math.ceil(len / (FIELD.cell * 0.5))
  if (n < 1) n = 1
  else if (n > 24) n = 24
  for (let i = 1; i < n; i++) {
    const t = i / n
    splat(H, z0 + (z1 - z0) * t, x0 + (x1 - x0) * t, h0 + (h1 - h0) * t)
  }
  return n
}

/** Raise the cell of the point (`z`, `x`) to `h` where it is higher (a point in a row the fit does not cover is dropped). */
function splat(H: Float32Array, z: number, x: number, h: number): void {
  const i = Math.floor((z - FIELD.z0) / FIELD.cell)
  const j = Math.floor((x - FIELD.x0) / FIELD.cell)
  if (i < R0 || j < 0 || i > R1 || j >= FIELD_NX) return
  const k = i * FIELD_NX + j
  if (h > H[k]) H[k] = h
}

/** The maximum filter of row `i` of `src` along x (radius `rx` cells) into the same row of `tmp`. */
function blurRowX(src: Float32Array, tmp: Float32Array, i: number, rx: number): void {
  const nx = FIELD_NX
  const row = i * nx
  for (let j = 0; j < nx; j++) {
    const a = j - rx < 0 ? 0 : j - rx
    const b = j + rx > nx - 1 ? nx - 1 : j + rx
    let m = NO_SKIN
    for (let q = a; q <= b; q++) if (src[row + q] > m) m = src[row + q]
    tmp[row + j] = m
  }
}

/** The maximum filter of row `i` along z (radius `rz` rows, within rows `lo` .. `hi`) of the x-filtered `tmp` into the same row of `dst`. */
function blurRowZ(tmp: Float32Array, dst: Float32Array, i: number, rz: number, lo: number, hi: number): void {
  const nx = FIELD_NX
  const a = i - rz < lo ? lo : i - rz
  const b = i + rz > hi ? hi : i + rz
  for (let j = 0; j < nx; j++) {
    let m = NO_SKIN
    for (let q = a; q <= b; q++) if (tmp[q * nx + j] > m) m = tmp[q * nx + j]
    dst[i * nx + j] = m
  }
}

/**
 * The whole fit in one call: rasterise the triangles of a body (see `beginFit`) into the field's grids, taking the highest surface over each cell, then blur, and swap. `zLo` and `zHi`
 * (metres) limit it to the rows the stage reads; the default is the whole field. A vertex beyond the field is clipped to the rows and columns it covers.
 */
export function fitField(f: SkinField, v: ArrayLike<number>, index: ArrayLike<number>, tris: number, zLo = -Infinity, zHi = Infinity): void {
  beginFit(f, v, index, tris, zLo, zHi)
  stepFit(f, Infinity)
}

/**
 * The highest of the nine cells round (`z`, `x`) (the nearest cell and the ones beside it), metres above the pad, 0 (the pad) where no body is: an upper bound of the skin there to the
 * sub-sample's slope, and of every cell the plate's neighbouring grid points could blend it with (the plate's grid is 1.25 cm, the field's cell 1 cm: the four cells `heightAt` blends
 * left a peak a cell off a grid point out of its tent, and a narrow ridge dipped the plate 3 mm under it). The plate stands over it.
 */
export function maxAt(g: Float32Array, z: number, x: number): number {
  const nz = FIELD_NZ
  const nx = FIELD_NX
  let ci = Math.round((z - FIELD.z0) / FIELD.cell - 0.5)
  let cj = Math.round((x - FIELD.x0) / FIELD.cell - 0.5)
  if (ci < 1) ci = 1
  else if (ci > nz - 2) ci = nz - 2
  if (cj < 1) cj = 1
  else if (cj > nx - 2) cj = nx - 2
  let m = NO_SKIN
  for (let i = ci - 1; i <= ci + 1; i++) {
    const o = i * nx + cj
    if (g[o - 1] > m) m = g[o - 1]
    if (g[o] > m) m = g[o]
    if (g[o + 1] > m) m = g[o + 1]
  }
  return m < 0 ? 0 : m
}

/**
 * The height of a grid (`g`: `h` or `wide`) at (`z`, `x`), metres above the pad: bilinear between cell centres, 0 (the pad) where no body is, clamped to the field.
 * A cell with no skin counts as 0, so a body's edge falls to the pad over a cell.
 */
export function heightAt(g: Float32Array, z: number, x: number): number {
  const nz = FIELD_NZ
  const nx = FIELD_NX
  let fz = (z - FIELD.z0) / FIELD.cell - 0.5
  let fx = (x - FIELD.x0) / FIELD.cell - 0.5
  if (fz < 0) fz = 0
  else if (fz > nz - 1.0001) fz = nz - 1.0001
  if (fx < 0) fx = 0
  else if (fx > nx - 1.0001) fx = nx - 1.0001
  const i = Math.floor(fz)
  const j = Math.floor(fx)
  const tz = fz - i
  const tx = fx - j
  const o = i * nx + j
  const a = g[o] < 0 ? 0 : g[o]
  const b = g[o + 1] < 0 ? 0 : g[o + 1]
  const c = g[o + nx] < 0 ? 0 : g[o + nx]
  const d = g[o + nx + 1] < 0 ? 0 : g[o + nx + 1]
  const p = a + (b - a) * tx
  const q = c + (d - c) * tx
  return p + (q - p) * tz
}
