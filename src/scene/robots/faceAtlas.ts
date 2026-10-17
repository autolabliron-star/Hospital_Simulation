/**
 * The MedPod face screens share ONE canvas atlas. Pod `i` always reads cell `i`; the cell shows the destination room
 * ("A3") or, with no order, a charge glyph. A cell is redrawn only when its label changes, and the whole atlas is one
 * texture upload, so nine idle pods cost nothing per frame.
 *
 * The cell mapping is pure (`faceCell`) and tested in node; the canvas part is skipped where there is no DOM.
 */
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'

export const ATLAS = { cols: 4, rows: 4, cellW: 128, cellH: 64 } as const
export const ATLAS_CELLS = ATLAS.cols * ATLAS.rows

export interface FaceCell {
  index: number
  col: number
  /** Row counted from the top of the canvas. */
  row: number
  /** Lower-left corner and size of the cell in texture space (v up). */
  u: number
  v: number
  w: number
  h: number
}

/** Pod index → atlas cell. Row-major from the top-left of the canvas; deterministic and stable. */
export function faceCell(index: number): FaceCell {
  if (!Number.isInteger(index) || index < 0 || index >= ATLAS_CELLS) throw new Error(`Pod face cell ${index} is outside the ${ATLAS_CELLS}-cell atlas`)
  const col = index % ATLAS.cols
  const row = Math.floor(index / ATLAS.cols)
  return { index, col, row, u: col / ATLAS.cols, v: 1 - (row + 1) / ATLAS.rows, w: 1 / ATLAS.cols, h: 1 / ATLAS.rows }
}

/** What a pod's face shows: the room of the order it carries, or '' for the charge glyph. */
export function faceLabel(roomId: string | undefined): string {
  return roomId ?? ''
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const BG = '#10282a'
const EDGE = '#1f5f5a'
const TEXT = '#b4f7ee'
const GLYPH = '#58d6c4'

export interface FaceAtlas {
  texture: CanvasTexture
  /** Redraw one cell. Cheap; flags the texture for upload. */
  draw(index: number, label: string): void
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** A lightning bolt in a box of side `s` centred on (cx, cy). */
function bolt(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const pts: [number, number][] = [
    [0.58, 0.0],
    [0.2, 0.56],
    [0.46, 0.56],
    [0.38, 1.0],
    [0.8, 0.4],
    [0.54, 0.4],
  ]
  ctx.beginPath()
  pts.forEach(([x, y], i) => {
    const px = cx + (x - 0.5) * s
    const py = cy + (y - 0.5) * s
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.closePath()
  ctx.fill()
}

/** The shared atlas canvas and texture, or null where there is no document (node tests, workers). */
export function createFaceAtlas(): FaceAtlas | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS.cols * ATLAS.cellW
  canvas.height = ATLAS.rows * ATLAS.cellH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4

  const draw = (index: number, label: string): void => {
    const c = faceCell(index)
    const x = c.col * ATLAS.cellW
    const y = c.row * ATLAS.cellH
    // the whole cell is background, so mip levels that blend neighbouring cells only blend the same dark colour
    ctx.fillStyle = BG
    ctx.fillRect(x, y, ATLAS.cellW, ATLAS.cellH)
    ctx.strokeStyle = EDGE
    ctx.lineWidth = 3
    roundRect(ctx, x + 8, y + 8, ATLAS.cellW - 16, ATLAS.cellH - 16, 10)
    ctx.stroke()
    if (label) {
      ctx.fillStyle = TEXT
      ctx.font = `700 ${label.length > 2 ? 34 : 40}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, x + ATLAS.cellW / 2, y + ATLAS.cellH / 2 + 2)
    } else {
      ctx.fillStyle = GLYPH
      bolt(ctx, x + ATLAS.cellW / 2, y + ATLAS.cellH / 2, ATLAS.cellH * 0.6)
    }
    texture.needsUpdate = true
  }
  for (let i = 0; i < ATLAS_CELLS; i++) draw(i, '')
  return { texture, draw }
}
