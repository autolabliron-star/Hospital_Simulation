/**
 * The bake-matched ambient as a FIELD over the building's plan: at every point of each storey, the SH9 diffuse light of the zone that owns it
 * (./sh.ts, from that zone's Cycles probe), plus a weight that says how much of the live light the bake replaces there (1 in an authored zone,
 * 0 outside the building and in zones the manifest does not list). Live objects read it per fragment (../volume/glsl.ts, BAKE_MAIN), so a
 * person in the ER is lit by the ER's probe and one in the lobby by the lobby's, whichever zone the camera is in, and the hand-over at a door is
 * a short blend instead of a switch.
 *
 * Layout (one RGBA half-float 3D texture, `nx` x `nz` x 14, linear filtering across the plan only): the 27 coefficients and the weight are 28
 * floats = 7 RGBA texels per cell, stored as 7 depth slices per storey (slices 0..6 level 1, 7..13 level 2). The shader reads each slice at its
 * texel centre, so the hardware filter blends neighbouring CELLS (1 m apart) and never two slices. Coefficients are premultiplied by the
 * weight, so filtering and blurring stay linear: E = SH(sum w c) and the live share is 1 - sum w.
 *
 *   texel 0  c0.rgb, c1.r      texel 3  c4.rgb, c5.r      texel 6  c8.rgb, w
 *   texel 1  c1.gb,  c2.rg     texel 4  c5.gb,  c6.rg
 *   texel 2  c2.b,   c3.rgb    texel 5  c6.b,   c7.rgb
 *
 * Level 2's page outside the level-2 footprint repeats level 1's (a tall thing in the atrium above the split height reads its own zone). Zones
 * are grown by one cell (so a person against a facade or a partition still reads its own zone at full weight) and the page is blurred once
 * with [1 2 1] / 4 each way: a door between two zones blends over about 2 m.
 *
 * Pure (sources in, floats out) so node tests it; built once after the probes load (Lighting.tsx), never per frame.
 */
import { DataUtils } from 'three'
import { BUILDING } from '@/sim/places'
import { LEVEL2_FOOTPRINT } from '@/sim/levels'
import { SH_FLOATS } from './sh'

/** One zone's say in the field. */
export interface FieldSource {
  /** Shown in the probe and the report. */
  name: string
  level: 1 | 2
  /** Does the zone own this DRAWN plan point on its level? */
  contains(x: number, z: number): boolean
  /** Its SH9 radiance coefficients (27 floats). */
  sh: ArrayLike<number>
}

/** Floats per cell (27 coefficients + the weight) and the RGBA texels they fill. */
export const CELL_FLOATS = 28
export const CELL_TEXELS = 7
export const PAGES = 2
export const SLICES = CELL_TEXELS * PAGES

export interface FieldGrid {
  /** Low corner (drawn metres) and cell size. */
  x0: number
  z0: number
  cell: number
  nx: number
  nz: number
}

/** The building with 4 m around it (the forecourt and the plaza read weight 0: live light out there). */
export const BAKE_GRID: Readonly<FieldGrid> = (() => {
  const margin = 4
  const cell = 1
  const x0 = BUILDING.x0 - margin
  const z0 = BUILDING.z0 - margin
  return { x0, z0, cell, nx: Math.ceil((BUILDING.x1 + margin - x0) / cell), nz: Math.ceil((BUILDING.z1 + margin - z0) / cell) }
})()

/** Fragments above this drawn height read level 2's page (the floors' reflection uses the same split). */
export const BAKE_SPLIT_Y = 3.9

const inL2 = (x: number, z: number): boolean => x >= LEVEL2_FOOTPRINT.x0 && x <= LEVEL2_FOOTPRINT.x1 && z >= LEVEL2_FOOTPRINT.z0 && z <= LEVEL2_FOOTPRINT.z1

/** Which source owns each cell of a page (-1: none), before growing. */
function ownership(sources: readonly FieldSource[], grid: FieldGrid, page: 0 | 1): Int16Array {
  const own = new Int16Array(grid.nx * grid.nz).fill(-1)
  for (let r = 0; r < grid.nz; r++) {
    const z = grid.z0 + (r + 0.5) * grid.cell
    for (let c = 0; c < grid.nx; c++) {
      const x = grid.x0 + (c + 0.5) * grid.cell
      const level = page === 1 && inL2(x, z) ? 2 : 1
      for (let s = 0; s < sources.length; s++) {
        if (sources[s].level === level && sources[s].contains(x, z)) {
          own[r * grid.nx + c] = s
          break
        }
      }
    }
  }
  return own
}

/** Grow the owned cells by one (4-neighbours; a cell between two zones takes the first it finds). */
function grow(own: Int16Array, grid: FieldGrid): Int16Array {
  const out = own.slice()
  const { nx, nz } = grid
  for (let r = 0; r < nz; r++) {
    for (let c = 0; c < nx; c++) {
      const i = r * nx + c
      if (own[i] >= 0) continue
      if (c > 0 && own[i - 1] >= 0) out[i] = own[i - 1]
      else if (c < nx - 1 && own[i + 1] >= 0) out[i] = own[i + 1]
      else if (r > 0 && own[i - nx] >= 0) out[i] = own[i - nx]
      else if (r < nz - 1 && own[i + nx] >= 0) out[i] = own[i + nx]
    }
  }
  return out
}

/** [1 2 1] / 4 along x, then along z, clamped at the edges, over `CELL_FLOATS` channels per cell. */
function blur(page: Float32Array, grid: FieldGrid): void {
  const { nx, nz } = grid
  const tmp = new Float32Array(page.length)
  for (let r = 0; r < nz; r++) {
    for (let c = 0; c < nx; c++) {
      const a = (r * nx + Math.max(c - 1, 0)) * CELL_FLOATS
      const b = (r * nx + c) * CELL_FLOATS
      const d = (r * nx + Math.min(c + 1, nx - 1)) * CELL_FLOATS
      for (let k = 0; k < CELL_FLOATS; k++) tmp[b + k] = 0.25 * page[a + k] + 0.5 * page[b + k] + 0.25 * page[d + k]
    }
  }
  for (let r = 0; r < nz; r++) {
    for (let c = 0; c < nx; c++) {
      const a = (Math.max(r - 1, 0) * nx + c) * CELL_FLOATS
      const b = (r * nx + c) * CELL_FLOATS
      const d = (Math.min(r + 1, nz - 1) * nx + c) * CELL_FLOATS
      for (let k = 0; k < CELL_FLOATS; k++) page[b + k] = 0.25 * tmp[a + k] + 0.5 * tmp[b + k] + 0.25 * tmp[d + k]
    }
  }
}

export interface BakeField {
  grid: FieldGrid
  /** RGBA floats in the texture's order: ((slice x nz + row) x nx + col) x 4. */
  data: Float32Array
  /** Cells owned (before growing) per page, for the probe and tests. */
  owned: [number, number]
}

/** Build the field. `grid` defaults to BAKE_GRID. */
export function buildBakeField(sources: readonly FieldSource[], grid: FieldGrid = BAKE_GRID): BakeField {
  const { nx, nz } = grid
  const cells = nx * nz
  const data = new Float32Array(cells * SLICES * 4)
  const owned: [number, number] = [0, 0]
  for (const page of [0, 1] as const) {
    const raw = ownership(sources, grid, page)
    for (let i = 0; i < cells; i++) if (raw[i] >= 0) owned[page]++
    const own = grow(raw, grid)
    const values = new Float32Array(cells * CELL_FLOATS)
    for (let i = 0; i < cells; i++) {
      const s = own[i]
      if (s < 0) continue
      const sh = sources[s].sh
      for (let k = 0; k < SH_FLOATS; k++) values[i * CELL_FLOATS + k] = sh[k]
      values[i * CELL_FLOATS + SH_FLOATS] = 1
    }
    blur(values, grid)
    for (let t = 0; t < CELL_TEXELS; t++) {
      const slice = page * CELL_TEXELS + t
      for (let i = 0; i < cells; i++) {
        const o = (slice * cells + i) * 4
        const v = i * CELL_FLOATS + t * 4
        data[o] = values[v]
        data[o + 1] = values[v + 1]
        data[o + 2] = values[v + 2]
        data[o + 3] = values[v + 3]
      }
    }
  }
  return { grid, data, owned }
}

/**
 * Read a field back the way the shader does at a drawn point (bilinear over the cells of the page chosen by y, the texel centres of the
 * slices), into `out` (28 floats: the premultiplied coefficients and the weight). For tests and the probe; the GPU does this per fragment.
 */
export function sampleBakeField(field: BakeField, x: number, y: number, z: number, out: Float32Array = new Float32Array(CELL_FLOATS)): Float32Array {
  const { grid, data } = field
  const { nx, nz } = grid
  const page = y > BAKE_SPLIT_Y ? 1 : 0
  // texel centres at (i + 0.5) cells; clamp to the edge like ClampToEdgeWrapping
  const fx = Math.min(Math.max((x - grid.x0) / grid.cell - 0.5, 0), nx - 1)
  const fz = Math.min(Math.max((z - grid.z0) / grid.cell - 0.5, 0), nz - 1)
  const c0 = Math.floor(fx)
  const r0 = Math.floor(fz)
  const c1 = Math.min(c0 + 1, nx - 1)
  const r1 = Math.min(r0 + 1, nz - 1)
  const tx = fx - c0
  const tz = fz - r0
  out.fill(0)
  for (let t = 0; t < CELL_TEXELS; t++) {
    const base = (page * CELL_TEXELS + t) * nx * nz
    for (let k = 0; k < 4; k++) {
      const v00 = data[(base + r0 * nx + c0) * 4 + k]
      const v10 = data[(base + r0 * nx + c1) * 4 + k]
      const v01 = data[(base + r1 * nx + c0) * 4 + k]
      const v11 = data[(base + r1 * nx + c1) * 4 + k]
      out[t * 4 + k] = (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz
    }
  }
  return out
}

/** The field as half floats for the GPU (RGBA16F is filterable in WebGL2 core, float32 is not). */
export function toHalfFloats(data: Float32Array, out: Uint16Array = new Uint16Array(data.length)): Uint16Array {
  for (let i = 0; i < data.length; i++) out[i] = DataUtils.toHalfFloat(data[i])
  return out
}
