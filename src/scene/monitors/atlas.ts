/**
 * R3 live patient monitors: the plan of the ONE atlas texture every monitor face is drawn from (a fixed `DataTexture`, flipY false, row 0 at v = 0).
 *
 *   per monitor   every static of its layout (header, numbers, ...) and, per band, TWO sweep slots (the sweep being drawn and the one before it,
 *                 swapped each sweep: paintSlot.ts) and a label slot (the band's label on a blank strip, under the erase bar)
 *   per layout    the standby face, whole: rows with nobody in them show it (the pre-op monitor shares the bedside monitor's: IDLE_SHARED)
 *
 * Packed into shelves 2048 px wide, tallest first, with a 2 px gutter so the mip levels of one region barely touch the next. Pure and deterministic;
 * the tests check the plan (inside the atlas, no overlaps, every region present, the size about 2048 x 1800).
 */
import type { MonitorDef } from './anchors'
import { GAP, LAYOUT_IDS, LAYOUTS, type FaceLayoutId } from './layouts'

export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface BandRegions {
  entries: [Region, Region]
  label: Region
}

export interface MonitorRegions {
  statics: Region[]
  bands: BandRegions[]
}

export interface AtlasPlan {
  width: number
  height: number
  monitors: MonitorRegions[]
  idle: Record<FaceLayoutId, Region>
}

export const ATLAS_WIDTH = 2048

/**
 * Layouts whose standby face is another's (the same picture: the pre-op monitor's statics are the bedside monitor's, and a standby face draws no
 * band lines), so they share one region.
 */
export const IDLE_SHARED: Partial<Record<FaceLayoutId, FaceLayoutId>> = { bedside2: 'bedside3' }
export const GUTTER = 2

interface Want {
  w: number
  h: number
  order: number
  region: Region
}

/**
 * First-fit shelf packing, tallest first (ties: widest first, then request order): each region goes on the first shelf with room left, else on a new
 * shelf (a shelf is as tall as its first, tallest region). Fills in each `region`; returns the height used.
 */
export function packShelves(wants: Want[], width: number, gutter: number): number {
  const sorted = wants.slice().sort((a, b) => b.h - a.h || b.w - a.w || a.order - b.order)
  const shelves: { y: number; h: number; x: number }[] = []
  let top = 0
  for (const want of sorted) {
    const w = want.w + gutter
    const h = want.h + gutter
    if (w > width) throw new Error(`monitors atlas: a ${want.w} px region does not fit a ${width} px atlas`)
    let shelf = shelves.find((s) => s.h >= h && s.x + w <= width)
    if (!shelf) {
      shelf = { y: top, h, x: 0 }
      shelves.push(shelf)
      top += h
    }
    want.region.x = shelf.x
    want.region.y = shelf.y
    want.region.w = want.w
    want.region.h = want.h
    shelf.x += w
  }
  return top
}

/** The atlas plan for these monitors. */
export function planAtlas(defs: readonly MonitorDef[], width = ATLAS_WIDTH, gutter = GUTTER): AtlasPlan {
  const wants: Want[] = []
  const want = (w: number, h: number): Region => {
    const region: Region = { x: 0, y: 0, w, h }
    wants.push({ w, h, order: wants.length, region })
    return region
  }
  const idle = {} as Record<FaceLayoutId, Region>
  for (const id of LAYOUT_IDS) {
    const same = IDLE_SHARED[id]
    if (!same) idle[id] = want(LAYOUTS[id].w, LAYOUTS[id].h)
  }
  for (const id of LAYOUT_IDS) {
    const same = IDLE_SHARED[id]
    if (same) idle[id] = idle[same]
  }
  const monitors: MonitorRegions[] = defs.map((d) => ({
    statics: d.layout.statics.map((s) => want(s.w, s.h)),
    bands: d.layout.bands.map((b) => ({ entries: [want(b.w, b.h), want(b.w, b.h)], label: want(d.layout.labelW + GAP, b.h) })),
  }))
  const used = packShelves(wants, width, gutter)
  return { width, height: Math.ceil(used / 8) * 8, monitors, idle }
}

/** Every region of a plan, for the tests and the probe. */
export function allRegions(plan: AtlasPlan): Region[] {
  const out: Region[] = [...new Set(Object.values(plan.idle))]
  for (const m of plan.monitors) {
    out.push(...m.statics)
    for (const b of m.bands) out.push(b.entries[0], b.entries[1], b.label)
  }
  return out
}
