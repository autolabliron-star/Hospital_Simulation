/**
 * The emote icon atlas: ten flat, rounded vector icons, drawn once on a 2D canvas (no emoji fonts, which look
 * different on every OS, and no image files). Each sits in a soft white circular badge with a faint shadow ring.
 *
 * Colours come from the shared palette (`STATUS`, `WAYFINDING` in materials.ts): the pill is teal, the heart rose,
 * the hourglass amber. Darker and lighter shades are mixed from those, never new hues.
 *
 * The layout and UV maths are pure and unit tested. Only `createEmoteAtlas` touches the DOM.
 */
import { CanvasTexture, SRGBColorSpace } from 'three'
import { STATUS, WAYFINDING } from '@/scene/materials'
import type { Emote } from '@/sim/types'

/** Every emote that has an icon (`none` draws nothing). */
export type IconEmote = Exclude<Emote, 'none'>

/**
 * Atlas cell of each icon, left to right, top to bottom. A `Record` over `IconEmote`, so adding a value to the
 * contract's `Emote` union without drawing it is a compile error here.
 */
export const ICON_CELL: Record<IconEmote, number> = {
  tablet: 0,
  pill: 1,
  hourglass: 2,
  bed: 3,
  check: 4,
  scan: 5,
  heart: 6,
  question: 7,
  coffee: 8,
  meal: 9,
}

export const ICON_EMOTES = Object.keys(ICON_CELL) as IconEmote[]

export const COLS = 3
export const ROWS = 4
/** Pixels per (square) atlas cell. */
export const CELL = 192
export const ATLAS_WIDTH = COLS * CELL
export const ATLAS_HEIGHT = ROWS * CELL
/** Inset of each icon's UV rect from its cell edge, so mip-mapping never samples a neighbour. */
const INSET = 2

/** Instance code of an emote: 0 for `none`, otherwise its atlas cell + 1. */
export const EMOTE_CODE: Record<Emote, number> = {
  none: 0,
  tablet: ICON_CELL.tablet + 1,
  pill: ICON_CELL.pill + 1,
  hourglass: ICON_CELL.hourglass + 1,
  bed: ICON_CELL.bed + 1,
  check: ICON_CELL.check + 1,
  scan: ICON_CELL.scan + 1,
  heart: ICON_CELL.heart + 1,
  question: ICON_CELL.question + 1,
  coffee: ICON_CELL.coffee + 1,
  meal: ICON_CELL.meal + 1,
}

/** A rectangle in texture UV space (0 to 1, origin bottom-left, as in WebGL). */
export interface UvRect {
  x: number
  y: number
  w: number
  h: number
}

/** UV rect of the atlas cell with this index, inset by a couple of pixels. */
export function uvRectForCell(index: number): UvRect {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  const left = col * CELL + INSET
  const right = (col + 1) * CELL - INSET
  const top = row * CELL + INSET
  const bottom = (row + 1) * CELL - INSET
  // Canvas rows run top-down. CanvasTexture flips Y by default, so the canvas top sits at v = 1.
  const u0 = left / ATLAS_WIDTH
  const u1 = right / ATLAS_WIDTH
  const v0 = 1 - bottom / ATLAS_HEIGHT
  const v1 = 1 - top / ATLAS_HEIGHT
  return { x: u0, y: v0, w: u1 - u0, h: v1 - v0 }
}

/** Where each icon sits in the atlas. */
export const EMOTE_UV = Object.fromEntries(ICON_EMOTES.map((e) => [e, uvRectForCell(ICON_CELL[e])])) as Record<IconEmote, UvRect>

/** The UV rects as one flat table indexed by `(code - 1) * 4`, for the per-frame loop. */
export const UV_TABLE: Float32Array = (() => {
  const t = new Float32Array(ICON_EMOTES.length * 4)
  for (const e of ICON_EMOTES) {
    const r = EMOTE_UV[e]
    const i = ICON_CELL[e] * 4
    t[i] = r.x
    t[i + 1] = r.y
    t[i + 2] = r.w
    t[i + 3] = r.h
  }
  return t
})()

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `a` mixed toward `b` by `t` (0 = a, 1 = b), as a hex colour. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const ch = (i: number) => Math.round(ca[i] + (cb[i] - ca[i]) * t)
  return `#${((1 << 24) | (ch(0) << 16) | (ch(1) << 8) | ch(2)).toString(16).slice(1)}`
}

const WHITE = '#ffffff'
const BLACK = '#000000'

/** The accent colour of each icon, all taken from the shared palette. */
export const ICON_ACCENT: Record<IconEmote, string> = {
  tablet: WAYFINDING.wardA,
  pill: STATUS.teal,
  hourglass: STATUS.amber,
  bed: WAYFINDING.diagnostics,
  check: STATUS.green,
  scan: WAYFINDING.wardB,
  heart: WAYFINDING.emergency,
  question: mix(STATUS.off, BLACK, 0.45),
  coffee: mix(WAYFINDING.atrium, BLACK, 0.42),
  // a warm peach: the MealBot's light and the host's lanyard (never the pods' teal), so a meal never reads as medicine
  meal: mix(mix(STATUS.amber, WAYFINDING.emergency, 0.5), WHITE, 0.1),
}

// ---------------------------------------------------------------------------------------------
// Drawing (cell coordinates: origin at the badge centre, y down; the badge has radius BADGE_R)
// ---------------------------------------------------------------------------------------------

const BADGE_R = 72
/** Glyphs are designed inside a 92 x 92 box around the origin and enlarged by this to fill the badge. */
const GLYPH_SCALE = 1.25

/** Rounded rectangle path (our own, so it works wherever `roundRect` does not). */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + k, y)
  ctx.lineTo(x + w - k, y)
  ctx.arcTo(x + w, y, x + w, y + k, k)
  ctx.lineTo(x + w, y + h - k)
  ctx.arcTo(x + w, y + h, x + w - k, y + h, k)
  ctx.lineTo(x + k, y + h)
  ctx.arcTo(x, y + h, x, y + h - k, k)
  ctx.lineTo(x, y + k)
  ctx.arcTo(x, y, x + k, y, k)
  ctx.closePath()
}

function badge(ctx: CanvasRenderingContext2D, accent: string): void {
  ctx.save()
  ctx.shadowColor = 'rgba(16, 40, 44, 0.32)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3
  ctx.fillStyle = WHITE
  ctx.beginPath()
  ctx.arc(0, 0, BADGE_R, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // the faint ring that keeps a white badge readable on a pale floor
  ctx.save()
  ctx.strokeStyle = mix(accent, WHITE, 0.45)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(0, 0, BADGE_R - 1.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function tablet(ctx: CanvasRenderingContext2D, c: string): void {
  rr(ctx, -26, -38, 52, 76, 9)
  ctx.fillStyle = c
  ctx.fill()
  rr(ctx, -20, -31, 40, 56, 4)
  ctx.fillStyle = mix(c, WHITE, 0.9)
  ctx.fill()
  ctx.strokeStyle = c
  ctx.lineWidth = 4.5
  ctx.beginPath()
  ctx.moveTo(-12, -20)
  ctx.lineTo(12, -20)
  ctx.moveTo(-12, -9)
  ctx.lineTo(8, -9)
  ctx.moveTo(-12, 2)
  ctx.lineTo(12, 2)
  ctx.moveTo(-12, 13)
  ctx.lineTo(3, 13)
  ctx.stroke()
  ctx.fillStyle = WHITE
  ctx.beginPath()
  ctx.arc(0, 32, 3.2, 0, Math.PI * 2)
  ctx.fill()
}

function capsulePath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.moveTo(-25, -19)
  ctx.lineTo(25, -19)
  ctx.arc(25, 0, 19, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(-25, 19)
  ctx.arc(-25, 0, 19, Math.PI / 2, (Math.PI * 3) / 2)
  ctx.closePath()
}

function pill(ctx: CanvasRenderingContext2D, c: string): void {
  ctx.save()
  ctx.rotate(-Math.PI / 4)
  capsulePath(ctx)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = c
  ctx.fillRect(-60, -30, 60, 60)
  ctx.fillStyle = mix(c, WHITE, 0.82)
  ctx.fillRect(0, -30, 60, 60)
  ctx.restore()
  ctx.strokeStyle = c
  ctx.lineWidth = 5
  ctx.lineJoin = 'round'
  capsulePath(ctx)
  ctx.stroke()
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(0, -19)
  ctx.lineTo(0, 19)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(-36, -9)
  ctx.lineTo(-17, -9)
  ctx.stroke()
  ctx.restore()
}

function hourglass(ctx: CanvasRenderingContext2D, c: string): void {
  const frame = mix(c, BLACK, 0.4)
  // glass
  ctx.beginPath()
  ctx.moveTo(-24, -40)
  ctx.lineTo(24, -40)
  ctx.lineTo(4, -4)
  ctx.lineTo(4, 4)
  ctx.lineTo(24, 40)
  ctx.lineTo(-24, 40)
  ctx.lineTo(-4, 4)
  ctx.lineTo(-4, -4)
  ctx.closePath()
  ctx.fillStyle = mix(c, WHITE, 0.85)
  ctx.fill()
  // sand: what is left above, the stream, and the heap below
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.moveTo(-15, -24)
  ctx.lineTo(15, -24)
  ctx.lineTo(4, -4)
  ctx.lineTo(-4, -4)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-22, 37)
  ctx.lineTo(22, 37)
  ctx.lineTo(0, 17)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = c
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, -4)
  ctx.lineTo(0, 18)
  ctx.stroke()
  // outline and end caps
  ctx.strokeStyle = frame
  ctx.lineWidth = 5
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(-24, -40)
  ctx.lineTo(24, -40)
  ctx.lineTo(4, -4)
  ctx.lineTo(4, 4)
  ctx.lineTo(24, 40)
  ctx.lineTo(-24, 40)
  ctx.lineTo(-4, 4)
  ctx.lineTo(-4, -4)
  ctx.closePath()
  ctx.stroke()
  ctx.fillStyle = frame
  rr(ctx, -32, -50, 64, 10, 5)
  ctx.fill()
  rr(ctx, -32, 40, 64, 10, 5)
  ctx.fill()
}

function bed(ctx: CanvasRenderingContext2D, c: string): void {
  const dark = mix(c, BLACK, 0.35)
  ctx.fillStyle = dark
  rr(ctx, -46, -24, 8, 48, 4) // headboard
  ctx.fill()
  rr(ctx, 38, -4, 8, 28, 4) // footboard
  ctx.fill()
  rr(ctx, -38, 10, 76, 8, 3) // frame
  ctx.fill()
  ctx.fillStyle = mix(c, WHITE, 0.7)
  rr(ctx, -36, -3, 72, 14, 5) // mattress
  ctx.fill()
  ctx.fillStyle = c
  rr(ctx, -6, -8, 42, 19, 7) // blanket
  ctx.fill()
  ctx.fillStyle = WHITE
  rr(ctx, -33, -14, 25, 12, 6) // pillow
  ctx.fill()
  ctx.strokeStyle = c
  ctx.lineWidth = 3.5
  ctx.stroke()
}

function check(ctx: CanvasRenderingContext2D, c: string): void {
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.arc(0, 0, 43, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = WHITE
  ctx.lineWidth = 13
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(-19, 2)
  ctx.lineTo(-5, 16)
  ctx.lineTo(21, -14)
  ctx.stroke()
}

function scan(ctx: CanvasRenderingContext2D, c: string): void {
  // the wristband with its barcode
  rr(ctx, -31, -17, 62, 34, 11)
  ctx.fillStyle = WHITE
  ctx.fill()
  ctx.strokeStyle = c
  ctx.lineWidth = 4.5
  ctx.stroke()
  ctx.fillStyle = c
  let x = -21
  for (const w of [3, 2, 5, 2, 3, 5, 2, 4, 3]) {
    ctx.fillRect(x, -9, w, 18)
    x += w + 2
  }
  // the scanner's viewfinder corners
  ctx.strokeStyle = c
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(sx * 42, sy * 22)
    ctx.lineTo(sx * 42, sy * 40)
    ctx.lineTo(sx * 24, sy * 40)
    ctx.stroke()
  }
  // the red scan line
  ctx.strokeStyle = WAYFINDING.emergency
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.moveTo(-40, 0)
  ctx.lineTo(40, 0)
  ctx.stroke()
}

function heart(ctx: CanvasRenderingContext2D, c: string): void {
  ctx.beginPath()
  ctx.moveTo(0, 31)
  ctx.bezierCurveTo(-43, 3, -41, -31, -20, -31)
  ctx.bezierCurveTo(-9, -31, -2, -24, 0, -16)
  ctx.bezierCurveTo(2, -24, 9, -31, 20, -31)
  ctx.bezierCurveTo(41, -31, 43, 3, 0, 31)
  ctx.closePath()
  ctx.fillStyle = c
  ctx.fill()
  ctx.strokeStyle = c
  ctx.lineWidth = 6
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-27, -10)
  ctx.quadraticCurveTo(-28, -20, -18, -22)
  ctx.stroke()
}

function question(ctx: CanvasRenderingContext2D, c: string): void {
  ctx.strokeStyle = c
  ctx.fillStyle = c
  ctx.lineWidth = 13
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.arc(0, -13, 19, Math.PI, Math.PI * 2.5)
  ctx.lineTo(0, 17)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 37, 6.5, 0, Math.PI * 2)
  ctx.fill()
}

function coffee(ctx: CanvasRenderingContext2D, c: string): void {
  // steam
  ctx.strokeStyle = mix(c, WHITE, 0.45)
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  for (const x of [-13, 1, 15]) {
    ctx.beginPath()
    ctx.moveTo(x, -14)
    ctx.bezierCurveTo(x - 9, -22, x + 9, -30, x, -40)
    ctx.stroke()
  }
  // handle
  ctx.strokeStyle = c
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.arc(25, 8, 11, -Math.PI / 2, Math.PI / 2)
  ctx.stroke()
  // cup
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.moveTo(-27, -6)
  ctx.lineTo(27, -6)
  ctx.lineTo(22, 25)
  ctx.quadraticCurveTo(21, 34, 12, 34)
  ctx.lineTo(-12, 34)
  ctx.quadraticCurveTo(-21, 34, -22, 25)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = mix(c, WHITE, 0.3)
  rr(ctx, -29, -10, 58, 8, 4)
  ctx.fill()
  // saucer
  ctx.fillStyle = mix(c, BLACK, 0.3)
  rr(ctx, -37, 36, 74, 7, 3.5)
  ctx.fill()
}

function meal(ctx: CanvasRenderingContext2D, c: string): void {
  // two wisps of steam rising from the knob (the meal is hot)
  ctx.strokeStyle = mix(c, WHITE, 0.5)
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  for (const x of [-9, 9]) {
    ctx.beginPath()
    ctx.moveTo(x, -33)
    ctx.bezierCurveTo(x - 6, -37, x + 6, -40, x, -45)
    ctx.stroke()
  }
  // the cloche over a plate (a meal tray arriving)
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.arc(0, 14, 32, Math.PI, Math.PI * 2)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = mix(c, WHITE, 0.35)
  ctx.beginPath()
  ctx.ellipse(-12, -2, 7, 12, -0.6, 0, Math.PI * 2)
  ctx.fill()
  // knob
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.arc(0, -22, 6.5, 0, Math.PI * 2)
  ctx.fill()
  // plate
  ctx.fillStyle = mix(c, BLACK, 0.3)
  rr(ctx, -40, 17, 80, 8, 4)
  ctx.fill()
}

const GLYPH: Record<IconEmote, (ctx: CanvasRenderingContext2D, accent: string) => void> = {
  tablet,
  pill,
  hourglass,
  bed,
  check,
  scan,
  heart,
  question,
  coffee,
  meal,
}

/** Draws one emote icon (badge and glyph), centred on the origin of the current transform. */
export function drawEmoteIcon(ctx: CanvasRenderingContext2D, emote: IconEmote): void {
  const accent = ICON_ACCENT[emote]
  ctx.save()
  badge(ctx, accent)
  ctx.scale(GLYPH_SCALE, GLYPH_SCALE)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  GLYPH[emote](ctx, accent)
  ctx.restore()
}

/** Draws every icon into one canvas and wraps it as a texture. Browser only. */
export function createEmoteAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_WIDTH
  canvas.height = ATLAS_HEIGHT
  const ctx = canvas.getContext('2d')
  if (ctx) {
    for (const emote of ICON_EMOTES) {
      const i = ICON_CELL[emote]
      ctx.save()
      ctx.translate((i % COLS) * CELL + CELL / 2, Math.floor(i / COLS) * CELL + CELL / 2)
      drawEmoteIcon(ctx, emote)
      ctx.restore()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 2
  return texture
}
