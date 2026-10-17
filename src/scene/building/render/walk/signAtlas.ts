/**
 * The sign atlas (W1): every picture on a hanging sign or a door plate, drawn ONCE into one small canvas (system font, no CDN fonts)
 * and shown as a few quads of one mesh. Identical pictures share a cell.
 *
 * Two halves, so the node tests can see the first:
 *   packAtlas()   pure: shelf-packs the tiles of the walk layout and says where each one lives (the geometry needs this);
 *   paintAtlas()  draws the tiles into a 2D context (anything with the canvas drawing methods used here), once, at mount.
 *
 * The look follows docs/M2-ART.md: soft white faces with a teal header, the wayfinding colours as the accents, thin elegant type.
 */
import { WAYFINDING } from '@/scene/materials'
import type { SignAccent } from '@/content/signs'
import type { ArrowKind, SignRow, Tile } from '../../layout/walk/types'

export interface AtlasCell {
  x: number
  y: number
  w: number
  h: number
}

export interface PackedAtlas {
  width: number
  height: number
  cells: Map<string, AtlasCell>
}

export const ATLAS_WIDTH = 2048
/** Empty pixels around every cell, so mip levels never bleed one picture into another. */
export const ATLAS_PAD = 4

export function packAtlas(tiles: readonly Tile[], width: number = ATLAS_WIDTH): PackedAtlas {
  const order = [...tiles].sort((p, q) => q.h - p.h || q.w - p.w || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0))
  const cells = new Map<string, AtlasCell>()
  let cx = 0
  let cy = 0
  let rowH = 0
  for (const t of order) {
    const cw = t.w + ATLAS_PAD * 2
    const ch = t.h + ATLAS_PAD * 2
    if (cx + cw > width) {
      cx = 0
      cy += rowH
      rowH = 0
    }
    cells.set(t.key, { x: cx + ATLAS_PAD, y: cy + ATLAS_PAD, w: t.w, h: t.h })
    cx += cw
    rowH = Math.max(rowH, ch)
  }
  return { width, height: cy + rowH, cells }
}

// ---------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------

/** The slice of the canvas 2D API the painter uses (a real context, or a recording stub in the tests). */
export interface Paint2D {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(a: number): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(): void
  stroke(): void
  fillRect(x: number, y: number, w: number, h: number): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const INK = '#1f3836'
const INK_SOFT = '#5d8782'
const TEAL = '#2f6f69'
const PAPER = '#f6faf9'
const RULE = '#d9e6e3'
const NEUTRAL = '#6f9a94'

const accentColor = (a: SignAccent): string => (a === 'neutral' ? NEUTRAL : WAYFINDING[a])

function roundRect(ctx: Paint2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0)
  ctx.lineTo(x + w, y + h - r)
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
  ctx.lineTo(x + r, y + h)
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
  ctx.lineTo(x, y + r)
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5)
  ctx.closePath()
}

/** Text with a hand-made letter spacing (ctx.letterSpacing is not everywhere). Returns the width drawn. */
function spaced(ctx: Paint2D, text: string, x: number, y: number, gap: number): number {
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + gap
  }
  return cx - x - gap
}

/** Text that shrinks (down to 60 %) to fit `maxW`. */
function fitted(ctx: Paint2D, text: string, x: number, y: number, size: number, weight: number, maxW: number): void {
  let s = size
  ctx.font = `${weight} ${s}px ${FONT}`
  const w = ctx.measureText(text).width
  if (w > maxW) {
    s = Math.max(size * 0.6, (size * maxW) / w)
    ctx.font = `${weight} ${s}px ${FONT}`
  }
  ctx.fillText(text, x, y)
}

const ARROW: readonly (readonly [number, number])[] = [
  [0, -1],
  [0.72, -0.18],
  [0.3, -0.18],
  [0.3, 0.9],
  [-0.3, 0.9],
  [-0.3, -0.18],
  [-0.72, -0.18],
]
const ARROW_TURN: Record<ArrowKind, number> = { ahead: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 }

/** A white arrow in a coloured disc: up for ahead, down for behind. */
export function drawArrow(ctx: Paint2D, kind: ArrowKind, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(ARROW_TURN[kind])
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ARROW.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px * r * 0.62, py * r * 0.62) : ctx.lineTo(px * r * 0.62, py * r * 0.62)))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function paintSign(ctx: Paint2D, t: Extract<Tile, { kind: 'sign' }>): void {
  const { w, h } = t
  roundRect(ctx, 0, 0, w, h, 12)
  ctx.fillStyle = PAPER
  ctx.fill()
  // header band with the title
  ctx.save()
  roundRect(ctx, 0, 0, w, h, 12)
  ctx.clip()
  ctx.fillStyle = TEAL
  ctx.fillRect(0, 0, w, 32)
  ctx.restore()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = `600 17px ${FONT}`
  spaced(ctx, t.title.toUpperCase(), 16, 17, 2.6)

  const rows = t.rows
  const top = 32
  const rowH = (h - top - 6) / Math.max(1, rows.length)
  rows.forEach((row: SignRow, i) => {
    const y0 = top + 3 + i * rowH
    const yc = y0 + rowH / 2
    if (i > 0) {
      ctx.fillStyle = RULE
      ctx.fillRect(14, y0 - 1, w - 28, 2)
    }
    const r = Math.min(rowH * 0.36, 24)
    drawArrow(ctx, row.arrow, 14 + r + 2, yc, r, accentColor(row.accent))
    const x = 14 + r * 2 + 18
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = INK
    if (rows.length <= 2 && row.detail) {
      fitted(ctx, row.label, x, yc - rowH * 0.15, Math.min(34, rowH * 0.4), 600, w - x - 16)
      ctx.fillStyle = INK_SOFT
      fitted(ctx, row.detail, x, yc + rowH * 0.24, Math.min(19, rowH * 0.23), 400, w - x - 16)
    } else {
      const size = Math.min(30, rowH * 0.5)
      fitted(ctx, row.label, x, yc, size, 600, (w - x - 16) * (row.detail ? 0.55 : 1))
      if (row.detail) {
        ctx.fillStyle = INK_SOFT
        ctx.textAlign = 'right'
        fitted(ctx, row.detail, w - 16, yc, Math.min(17, rowH * 0.34), 400, (w - x - 16) * 0.5)
        ctx.textAlign = 'left'
      }
    }
  })
}

function paintRoomPlate(ctx: Paint2D, t: Extract<Tile, { kind: 'room' }>): void {
  const { w, h } = t
  roundRect(ctx, 0, 0, w, h, 14)
  ctx.fillStyle = PAPER
  ctx.fill()
  // the ward's own colour down the left edge: the blue of ward A, the green of ward B
  ctx.save()
  roundRect(ctx, 0, 0, w, h, 14)
  ctx.clip()
  ctx.fillStyle = t.id.startsWith('B') ? WAYFINDING.wardB : WAYFINDING.wardA
  ctx.fillRect(0, 0, 16, h)
  ctx.restore()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = INK_SOFT
  ctx.font = `600 20px ${FONT}`
  ctx.textAlign = 'left'
  const cap = t.caption.toUpperCase()
  const gap = 3
  const total = [...cap].reduce((s, ch) => s + ctx.measureText(ch).width + gap, -gap)
  spaced(ctx, cap, 16 + (w - 16 - total) / 2, 30, gap)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#245852'
  ctx.font = `700 70px ${FONT}`
  ctx.fillText(t.id, 16 + (w - 16) / 2, 82)
}

function paintNamePlate(ctx: Paint2D, t: Extract<Tile, { kind: 'name' }>): void {
  const { w, h } = t
  roundRect(ctx, 0, 0, w, h, 12)
  ctx.fillStyle = TEAL
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (t.sub) {
    fitted(ctx, t.label, w / 2, h * 0.38, 38, 600, w - 40)
    ctx.fillStyle = '#cfe6e2'
    fitted(ctx, t.sub, w / 2, h * 0.76, 22, 400, w - 40)
  } else {
    fitted(ctx, t.label, w / 2, h / 2 + 1, 44, 600, w - 40)
  }
}

/** Draw every tile at its cell. The context must be clear (a new canvas). */
export function paintAtlas(ctx: Paint2D, packed: PackedAtlas, tiles: readonly Tile[]): void {
  for (const t of tiles) {
    const cell = packed.cells.get(t.key)
    if (!cell) throw new Error(`sign atlas: no cell for ${t.key}`)
    ctx.save()
    ctx.translate(cell.x, cell.y)
    if (t.kind === 'sign') paintSign(ctx, t)
    else if (t.kind === 'room') paintRoomPlate(ctx, t)
    else paintNamePlate(ctx, t)
    ctx.restore()
  }
}
