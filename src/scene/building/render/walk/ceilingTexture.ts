/**
 * The ceiling picture (W1), painted ONCE and repeated over every ceiling: a cell of 5 x 5 light ceiling tiles with a soft 3 x 1 light
 * panel in the middle. The same cell, white on black, is the emissive map, so the panels glow and nothing else does. The walk layout
 * says how often the cell repeats over each area (./../../layout/walk/ceilings.ts): about every 3 m.
 *
 * The painter only needs `fillStyle` and `fillRect`, so a stub can run it in node.
 */
export const CEILING_CELL = {
  tiles: 5,
  tilePx: 64,
  /** The light panel, in tiles: x, y, width, height (aligned to the tile seams). */
  panel: { x: 1, y: 2, w: 3, h: 1 },
} as const

export const CEILING_PX = CEILING_CELL.tiles * CEILING_CELL.tilePx

export interface CeilingPaint {
  fillStyle: string | CanvasGradient | CanvasPattern
  fillRect(x: number, y: number, w: number, h: number): void
}

const BASE = '#f2f2ee'
const SEAM = '#cfd2ce'
const PANEL_FRAME = '#d9d8cf'
const PANEL_DIFFUSER = '#f7f5ec'

/**
 * Paint the albedo cell (`emissive` false) or the emissive cell (true). Seams are 2 px, half on each side of a tile edge, so they stay
 * 2 px wide where the cell repeats.
 */
export function paintCeilingCell(ctx: CeilingPaint, emissive: boolean): void {
  const { tiles, tilePx, panel } = CEILING_CELL
  const size = CEILING_PX
  ctx.fillStyle = emissive ? '#000000' : BASE
  ctx.fillRect(0, 0, size, size)
  if (!emissive) {
    ctx.fillStyle = SEAM
    for (let i = 0; i <= tiles; i++) {
      ctx.fillRect(i * tilePx - 1, 0, 2, size)
      ctx.fillRect(0, i * tilePx - 1, size, 2)
    }
  }
  const x = panel.x * tilePx
  const y = panel.y * tilePx
  const w = panel.w * tilePx
  const h = panel.h * tilePx
  if (emissive) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8)
    return
  }
  ctx.fillStyle = PANEL_FRAME
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = PANEL_DIFFUSER
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8)
}
