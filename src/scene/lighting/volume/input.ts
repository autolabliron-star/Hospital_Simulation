/**
 * What the light-volume bake reads, as plain numbers (W3). `buildVolumeInput()` derives it from the contract (the areas and ceiling heights in
 * src/sim/places.ts, the wall pieces, the walk-mode ceiling layout and its panel cell); bake.ts is a pure function of it, so the tests can feed
 * it a synthetic hospital as well as the real one.
 *
 * Coordinates: metres, x east, z south, y up (the layout's own). The volume covers the building's footprint (BUILDING) and the storey plus a
 * margin, in cells of 0.5 m by 0.5 m by 0.6 m:
 *
 *   204 x 88 x 6 texels, 4 bytes each = 430 KB.
 *
 * The cell is chosen so the texel CENTRES sit 0.25 m off the 0.5 m lattice the walls' x and z lines mostly lie on: a texel never lands inside a
 * 0.2 m wall, and the 0.2 m normal offset the shader samples with keeps a wall's lit side on its own side of the line.
 */
import { AREAS, BUILDING, WALL, areaAt, ceilingHeight, type Area } from '@/sim/places'
import { buildWallPieces } from '@/scene/building/layout/walls'
import { cellCounts } from '@/scene/building/layout/walk/ceilings'
import { CEILING_CELL } from '@/scene/building/render/walk/ceilingTexture'
import type { WallPiece } from '@/scene/building/layout/types'

export interface VolumeGrid {
  /** The low corner (metres). */
  x0: number
  y0: number
  z0: number
  /** Cell size in x and z, and height of a layer. */
  cell: number
  layer: number
  /** Texels along x, z (rows) and y (layers). */
  nx: number
  nz: number
  ny: number
}

const CELL = 0.5
const LAYER = 0.6
const LAYERS = 6

export const VOLUME_GRID: Readonly<VolumeGrid> = {
  x0: BUILDING.x0,
  y0: 0,
  z0: BUILDING.z0,
  cell: CELL,
  layer: LAYER,
  nx: Math.ceil((BUILDING.x1 - BUILDING.x0) / CELL),
  nz: Math.ceil((BUILDING.z1 - BUILDING.z0) / CELL),
  ny: LAYERS,
}

/** The box the volume covers (metres): the sampler's `uLvSize`. */
export function gridSize(g: VolumeGrid): { x: number; y: number; z: number } {
  return { x: g.nx * g.cell, y: g.ny * g.layer, z: g.nz * g.cell }
}

/** One emissive ceiling panel: its centre on the plan and its emitting area (m2). It faces down. */
export interface PanelLight {
  x: number
  z: number
  area: number
}

export interface VolumeArea {
  id: string
  x0: number
  x1: number
  z0: number
  z1: number
  /** Ceiling height (metres), or null when the area is open to the sky (the atrium). */
  ceiling: number | null
  /** A nested area (a patient room) wins over the band it sits in, as `areaAt` does. */
  nested: boolean
  panels: PanelLight[]
}

/** A wall's footprint (the thickness included), and how much it occludes: 1 solid, less for glass. */
export interface WallBox {
  x0: number
  x1: number
  z0: number
  z1: number
  weight: number
}

/**
 * A run of glazing that lets the sky in: on the line `c` (z when `alongX`, x otherwise) from `a` to `b`, from the floor to `y1`. `side` is the
 * direction, along the axis across the line, to the room that is lit (+1 toward higher coordinates). `area` indexes `VolumeInput.areas`.
 */
export interface WindowRun {
  alongX: boolean
  c: number
  a: number
  b: number
  side: 1 | -1
  y1: number
  area: number
  /** How much of the sky's light gets through (glass tint, mullions, trees): 1 = all. */
  strength: number
}

export interface VolumeInput {
  grid: VolumeGrid
  areas: VolumeArea[]
  walls: WallBox[]
  windows: WindowRun[]
  /** The height the architect's section cut stops the walls at (the overview AO ignores a wall above it). */
  cutHeight: number
}

/** Occlusion weight of a wall class. */
const WALL_WEIGHT: Record<WallPiece['cls'], number> = { solid: 1, glassFull: 0.3, glassCut: 0.3, skip: 0.3 }
/** How much of the sky's light each kind of glazing passes. */
const WINDOW_STRENGTH: Record<WallPiece['cls'], number> = { solid: 0, glassFull: 0.8, glassCut: 1, skip: 0.7 }

/** The emitting share of a ceiling cell's width and depth (the painted panel is 3 x 1 tiles of a 5 x 5 cell, less its 4 px frame). */
function panelShare(): { w: number; h: number } {
  const { tiles, tilePx, panel } = CEILING_CELL
  const size = tiles * tilePx
  return { w: (panel.w * tilePx - 8) / size, h: (panel.h * tilePx - 8) / size }
}

/** The emitting rectangles of an area's panels as the ceiling texture lays them out: one per cell of `cellCounts`, in the middle of it. */
export function panelRectsOf(a: Area): { x0: number; x1: number; z0: number; z1: number }[] {
  const r = a.rect
  const { nx, nz } = cellCounts(a)
  const cw = (r.x1 - r.x0) / nx
  const ch = (r.z1 - r.z0) / nz
  const share = panelShare()
  const hw = (share.w * cw) / 2
  const hh = (share.h * ch) / 2
  const out: { x0: number; x1: number; z0: number; z1: number }[] = []
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = r.x0 + (i + 0.5) * cw
      const cz = r.z0 + (j + 0.5) * ch
      out.push({ x0: cx - hw, x1: cx + hw, z0: cz - hh, z1: cz + hh })
    }
  }
  return out
}

/** The panels of an area as light sources: the centre and the emitting area of each rectangle. */
export function panelsOf(a: Area): PanelLight[] {
  return panelRectsOf(a).map((p) => ({ x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, area: (p.x1 - p.x0) * (p.z1 - p.z0) }))
}

function wallBox(p: WallPiece, thick: number): WallBox {
  const a = p.a - (p.cutA ? 0 : thick / 2)
  const b = p.b + (p.cutB ? 0 : thick / 2)
  const w = WALL_WEIGHT[p.cls]
  return p.alongX ? { x0: a, x1: b, z0: p.c - thick / 2, z1: p.c + thick / 2, weight: w } : { x0: p.c - thick / 2, x1: p.c + thick / 2, z0: a, z1: b, weight: w }
}

const PROBE = 0.3
const isSky = (a: Area | null): boolean => a === null || a.id === 'atrium'

/** Where this line is also the edge of an area, the along-axis extents of that area: the places a window run must be cut. */
function cutsAlong(p: WallPiece): number[] {
  const out = new Set<number>([p.a, p.b])
  for (const area of AREAS) {
    const r = area.rect
    const edges = p.alongX ? [r.z0, r.z1] : [r.x0, r.x1]
    if (!edges.some((e) => Math.abs(e - p.c) < 1e-6)) continue
    for (const v of p.alongX ? [r.x0, r.x1] : [r.z0, r.z1]) if (v > p.a + 1e-6 && v < p.b - 1e-6) out.add(v)
  }
  return [...out].sort((u, v) => u - v)
}

/** The glazing between a roofed room and the sky (outside, or the atrium), cut at every area edge. */
export function buildWindows(pieces: readonly WallPiece[], areaIndex: ReadonlyMap<string, number>): WindowRun[] {
  const out: WindowRun[] = []
  for (const p of pieces) {
    const strength = WINDOW_STRENGTH[p.cls]
    if (strength <= 0) continue
    const cuts = cutsAlong(p)
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]
      const b = cuts[i + 1]
      if (b - a < 0.3) continue
      const mid = (a + b) / 2
      const lo = p.alongX ? areaAt(mid, p.c - PROBE) : areaAt(p.c - PROBE, mid)
      const hi = p.alongX ? areaAt(mid, p.c + PROBE) : areaAt(p.c + PROBE, mid)
      let room: Area | null = null
      let side: 1 | -1 = 1
      if (isSky(lo) && !isSky(hi)) {
        room = hi
        side = 1
      } else if (isSky(hi) && !isSky(lo)) {
        room = lo
        side = -1
      }
      if (!room) continue
      const area = areaIndex.get(room.id)
      const y1 = ceilingHeight(room.id)
      if (area === undefined || y1 === null) continue
      out.push({ alongX: p.alongX, c: p.c, a, b, side, y1, area, strength })
    }
  }
  return out
}

/** The real hospital, as the bake reads it. Deterministic and pure. */
export function buildVolumeInput(): VolumeInput {
  const areas: VolumeArea[] = AREAS.map((a) => {
    const ceiling = ceilingHeight(a.id)
    return {
      id: a.id,
      x0: a.rect.x0,
      x1: a.rect.x1,
      z0: a.rect.z0,
      z1: a.rect.z1,
      ceiling,
      nested: a.kind === 'room',
      panels: ceiling === null ? [] : panelsOf(a),
    }
  })
  const index = new Map(areas.map((a, i) => [a.id, i]))
  const pieces = buildWallPieces()
  return {
    grid: { ...VOLUME_GRID },
    areas,
    walls: pieces.map((p) => wallBox(p, WALL.thickness)),
    windows: buildWindows(pieces, index),
    cutHeight: WALL.cutHeight,
  }
}
