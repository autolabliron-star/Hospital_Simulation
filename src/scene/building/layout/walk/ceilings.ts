/**
 * Ceilings (W1 walk mode): one quad per area at `ceilingHeight(area)`, none where that is null (the healing atrium keeps its sky).
 * The pharmacy core gets one too, above its glass box. A quad is cut at the chunk edges (./chunks.ts) so each merged mesh stays local.
 *
 * The look is in a texture the renderer paints once: a cell of 5 x 5 light ceiling tiles with a 3 x 1 soft light panel in its middle
 * (the same picture, in white on black, is the emissive map). Here we only say how often the cell repeats over an area: about every
 * 3 m, at least once, so a corridor gets a row of panels down its middle and a patient room four.
 */
import { AREAS, ceilingHeight, type Area } from '@/sim/places'
import { CHUNK_EDGES } from './chunks'
import type { CeilingPiece } from './types'

/** Nominal distance between light panels, metres. */
export const PANEL_PITCH = 3.0

export function cellCounts(a: Area): { nx: number; nz: number } {
  return { nx: Math.max(1, Math.round((a.rect.x1 - a.rect.x0) / PANEL_PITCH)), nz: Math.max(1, Math.round((a.rect.z1 - a.rect.z0) / PANEL_PITCH)) }
}

export function buildCeilings(): CeilingPiece[] {
  const out: CeilingPiece[] = []
  for (const a of AREAS) {
    const y = ceilingHeight(a.id)
    if (y === null) continue
    const r = a.rect
    const { nx, nz } = cellCounts(a)
    const w = r.x1 - r.x0
    const cuts = [r.x0, ...CHUNK_EDGES.filter((e) => e > r.x0 + 1e-9 && e < r.x1 - 1e-9), r.x1]
    for (let i = 0; i + 1 < cuts.length; i++) {
      out.push({
        area: a.id,
        y,
        x0: cuts[i],
        x1: cuts[i + 1],
        z0: r.z0,
        z1: r.z1,
        u0: (nx * (cuts[i] - r.x0)) / w,
        u1: (nx * (cuts[i + 1] - r.x0)) / w,
        v0: 0,
        v1: nz,
      })
    }
  }
  return out
}
