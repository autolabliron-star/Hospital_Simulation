/**
 * The painters of the health kiosks' screens: the touchscreen on each tower, the blood-pressure unit's display and the triage desk's results list. Each
 * paints one 320 x 200 tile of the shared W4 atlas (src/scene/w4kit) from a plain view model (src/ui/kioskView.ts); they run at most 2 Hz and only when the
 * tile's version changed, never inside a frame callback, so they may build strings. Soft teal on dark, like the rest of the hospital's screens, with
 * "Simulated" on every one.
 */
import type { BpScreenView, FieldRow, KioskScreenView, TriageRow } from '@/ui/kioskView'
import { KIOSK_UI, fillUi } from '@/content/kioskUi'

/** The design size of every tile; painters scale to the canvas they get. */
const W = 320
const H = 200

export const COLORS = {
  bg: '#0d2023',
  band: '#133539',
  track: '#1b4a4f',
  teal: '#1fb5ad',
  tealSoft: '#7fd6cf',
  text: '#e8f6f4',
  dim: '#8fb5b1',
  faint: '#4f7773',
  amber: '#f0a33a',
  green: '#3ccf6e',
  white: '#f5faf9',
} as const

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const font = (weight: number, px: number): string => `${weight} ${px}px ${FONT}`

type Ctx = CanvasRenderingContext2D

function label(ctx: Ctx, s: string, x: number, y: number, f: string, color: string, align: CanvasTextAlign = 'left'): void {
  ctx.font = f
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(s, x, y)
}

/** Cut a string to `n` characters with an ellipsis (the painters have no layout engine: names are short). */
export function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`
}

function bar(ctx: Ctx, x: number, y: number, w: number, h: number, k: number, color: string): void {
  ctx.fillStyle = COLORS.track
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = color
  ctx.fillRect(x, y, Math.max(0, Math.min(1, k)) * w, h)
}

function begin(ctx: Ctx, w: number, h: number): void {
  ctx.save()
  ctx.scale(w / W, h / H)
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'
}

function footer(ctx: Ctx, left: string, right: string): void {
  ctx.fillStyle = COLORS.band
  ctx.fillRect(0, H - 22, W, 22)
  label(ctx, left, 12, H - 7, font(500, 11), COLORS.dim)
  label(ctx, right, W - 12, H - 7, font(500, 11), COLORS.dim, 'right')
}

function valueColor(r: FieldRow): string {
  if (!r.measured) return COLORS.faint
  return r.outOfRange ? COLORS.amber : COLORS.white
}

/** The touchscreen: the step, how far through it, the values as they fill in, the progress dots and "Simulated". */
export function paintKioskScreen(ctx: Ctx, w: number, h: number, v: KioskScreenView): void {
  begin(ctx, w, h)
  // header
  ctx.fillStyle = COLORS.band
  ctx.fillRect(0, 0, W, 38)
  label(ctx, v.title, 14, 26, font(650, v.idle ? 22 : 20), COLORS.text)
  for (let i = 0; i < v.dots.length; i++) {
    const d = v.dots[i]
    ctx.fillStyle = d.state === 'done' ? COLORS.teal : d.state === 'current' ? COLORS.white : COLORS.track
    ctx.beginPath()
    ctx.arc(W - 14 - (v.dots.length - 1 - i) * 10, 19, d.state === 'current' ? 4 : 3, 0, Math.PI * 2)
    ctx.fill()
  }
  if (v.idle) {
    label(ctx, v.hint, W / 2, 96, font(500, 15), COLORS.tealSoft, 'center')
    // a plus in a ring: the sign of the station
    ctx.strokeStyle = COLORS.teal
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(W / 2, 140, 22, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = COLORS.teal
    ctx.fillRect(W / 2 - 3, 128, 6, 24)
    ctx.fillRect(W / 2 - 12, 137, 24, 6)
    footer(ctx, v.footer, '')
    ctx.restore()
    return
  }
  bar(ctx, 14, 46, W - 28, 5, v.progress, COLORS.teal)
  label(ctx, v.hint, 14, 70, font(500, 13), COLORS.tealSoft)
  // the eight values: two columns of four, the one being measured marked
  for (let i = 0; i < v.rows.length; i++) {
    const r = v.rows[i]
    const col = i < 4 ? 0 : 1
    const row = i % 4
    const x = 16 + col * 150
    const y = 92 + row * 22
    if (r.current) {
      ctx.fillStyle = COLORS.teal
      ctx.fillRect(x - 8, y - 11, 3, 21)
    }
    label(ctx, r.label, x, y - 2, font(500, 10), r.current ? COLORS.tealSoft : COLORS.dim)
    label(ctx, r.value, x, y + 12, font(650, 15), valueColor(r))
    if (r.measured && r.unit !== '') label(ctx, r.unit, x + 4 + approxWidth(r.value, 15), y + 12, font(500, 10), COLORS.dim)
  }
  footer(ctx, v.userName !== null ? clip(v.userName, 22) : '', v.footer)
  ctx.restore()
}

/** Width of a string in the value font without measuring (a digit is about 0.56 em, other characters a bit less). */
function approxWidth(s: string, px: number): number {
  let n = 0
  for (const c of s) n += c >= '0' && c <= '9' ? 0.58 : c === '/' ? 0.42 : 0.4
  return n * px
}

/** The blood-pressure unit's display: SYS and DIA large, the pulse, the cuff's pressure falling or rising as a bar. */
export function paintBpScreen(ctx: Ctx, w: number, h: number, v: BpScreenView): void {
  begin(ctx, w, h)
  ctx.fillStyle = COLORS.band
  ctx.fillRect(0, 0, W, 34)
  label(ctx, v.title, 14, 23, font(650, 18), COLORS.text)
  if (v.round !== null) label(ctx, v.round, W - 14, 23, font(500, 13), COLORS.tealSoft, 'right')
  if (!v.inUse) {
    label(ctx, KIOSK_UI.bpScreen.freeHint, W / 2, 105, font(600, 22), COLORS.tealSoft, 'center')
    footer(ctx, v.unit, v.footer)
    ctx.restore()
    return
  }
  const sysColor = !v.measuring && v.sys !== KIOSK_UI.pending ? (v.sysOut ? COLORS.amber : COLORS.white) : COLORS.faint
  const diaColor = !v.measuring && v.dia !== KIOSK_UI.pending ? (v.diaOut ? COLORS.amber : COLORS.white) : COLORS.faint
  label(ctx, KIOSK_UI.bpScreen.sys, 16, 56, font(600, 12), COLORS.dim)
  label(ctx, v.sys, 16, 92, font(700, 40), sysColor)
  label(ctx, KIOSK_UI.bpScreen.dia, 16, 114, font(600, 12), COLORS.dim)
  label(ctx, v.dia, 16, 150, font(700, 40), diaColor)
  label(ctx, KIOSK_UI.bpScreen.pulse, 128, 114, font(600, 12), COLORS.dim)
  label(ctx, v.pulse, 128, 150, font(700, 30), v.pulse === KIOSK_UI.pending ? COLORS.faint : COLORS.white)
  // the cuff: a vertical bar that fills as the cuff inflates and empties as it releases
  const bx = 262
  const by = 46
  const bh = 120
  ctx.fillStyle = COLORS.track
  ctx.fillRect(bx, by, 28, bh)
  ctx.fillStyle = v.cuff > 0.05 ? COLORS.amber : COLORS.teal
  ctx.fillRect(bx, by + bh * (1 - Math.max(0, Math.min(1, v.cuff))), 28, bh * Math.max(0, Math.min(1, v.cuff)))
  label(ctx, KIOSK_UI.bpScreen.cuff, bx + 14, by - 4, font(600, 10), COLORS.dim, 'center')
  footer(ctx, v.unit, v.footer)
  ctx.restore()
}

/** The triage desk's list: the latest kiosk readings of patients waiting for triage. */
export function paintTriageScreen(ctx: Ctx, w: number, h: number, rows: readonly TriageRow[], total: number): void {
  const ui = KIOSK_UI.triageScreen
  begin(ctx, w, h)
  ctx.fillStyle = COLORS.band
  ctx.fillRect(0, 0, W, 32)
  label(ctx, ui.title, 12, 22, font(650, 17), COLORS.text)
  label(ctx, String(total), W - 12, 22, font(650, 17), COLORS.tealSoft, 'right')
  label(ctx, ui.columns.name, 12, 50, font(600, 10), COLORS.dim)
  label(ctx, ui.columns.bp, 170, 50, font(600, 10), COLORS.dim)
  label(ctx, ui.columns.spo2, 232, 50, font(600, 10), COLORS.dim)
  label(ctx, ui.columns.temp, 288, 50, font(600, 10), COLORS.dim)
  if (rows.length === 0) {
    label(ctx, ui.empty, W / 2, 105, font(500, 13), COLORS.faint, 'center')
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const y = 72 + i * 21
    if (i % 2 === 0) {
      ctx.fillStyle = '#10292d'
      ctx.fillRect(0, y - 14, W, 21)
    }
    label(ctx, clip(r.name, 18), 12, y, font(550, 13), COLORS.text)
    label(ctx, r.bp, 170, y, font(650, 13), r.bpOut ? COLORS.amber : COLORS.white)
    label(ctx, r.spo2, 232, y, font(650, 13), r.spo2Out ? COLORS.amber : COLORS.white)
    label(ctx, r.temp, 288, y, font(650, 13), r.tempOut ? COLORS.amber : COLORS.white)
  }
  if (total > rows.length) label(ctx, fillUi(ui.more, { n: total - rows.length }), 12, H - 28, font(500, 11), COLORS.dim)
  footer(ctx, ui.footer, '')
  ctx.restore()
}
