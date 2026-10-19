/**
 * W4 status screens: the small drawing kit every W4 tile painter can use (same dark teal language as the bedside screens, so the whole
 * hospital's screens read as one family). Pure canvas-2D calls on the context it is handed: no DOM, no three.js, so a painter runs in node
 * against a recording context. Painters run at most 2 Hz and may build strings; they never run inside a frame callback.
 */

export const SCREEN_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** The palette of a status screen. */
export const SCREEN_INK = {
  top: '#0e2a2d',
  bottom: '#153f43',
  title: '#9fe3dc',
  main: '#e8fffb',
  soft: '#7fc9c2',
  dim: 'rgba(150, 215, 208, 0.45)',
  teal: '#1fb5ad',
  amber: '#f0a33a',
  green: '#3fb56b',
  red: '#e0584b',
  blue: '#5aa7e0',
} as const

export type ScreenTone = 'teal' | 'amber' | 'green' | 'red' | 'blue'

/** The dark gradient background with a soft glow in the top-right corner. */
export function paintBackground(c: CanvasRenderingContext2D, w: number, h: number, glow: ScreenTone = 'teal'): void {
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, SCREEN_INK.top)
  g.addColorStop(1, SCREEN_INK.bottom)
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
  const r = c.createRadialGradient(w * 0.82, h * 0.18, 4, w * 0.82, h * 0.18, w * 0.6)
  r.addColorStop(0, `${rgba(SCREEN_INK[glow], 0.3)}`)
  r.addColorStop(1, `${rgba(SCREEN_INK[glow], 0)}`)
  c.fillStyle = r
  c.fillRect(0, 0, w, h)
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function paintText(c: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, color: string = SCREEN_INK.main, weight = 500, align: CanvasTextAlign = 'left'): void {
  c.font = `${weight} ${px}px ${SCREEN_FONT}`
  c.fillStyle = color
  c.textAlign = align
  c.textBaseline = 'middle'
  c.fillText(s, x, y)
}

/** A screen title in the top-left corner, with a thin rule under it. */
export function paintTitle(c: CanvasRenderingContext2D, w: number, title: string, tone: ScreenTone = 'teal'): void {
  paintText(c, title, 20, 26, 21, SCREEN_INK.title, 700)
  c.fillStyle = rgba(SCREEN_INK[tone], 0.55)
  c.fillRect(20, 46, w - 40, 2)
}

/** A rounded progress bar: `frac` 0..1. */
export function paintBar(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, tone: ScreenTone = 'teal'): void {
  const f = frac > 0 ? (frac < 1 ? frac : 1) : 0
  c.beginPath()
  c.roundRect(x, y, w, h, h / 2)
  c.fillStyle = SCREEN_INK.dim
  c.fill()
  if (f > 0.001) {
    c.beginPath()
    c.roundRect(x, y, Math.max(h, w * f), h, h / 2)
    c.fillStyle = SCREEN_INK[tone]
    c.fill()
  }
}

/** A pill with centred text. Returns its width, so chips can be laid out in a row. */
export function paintChip(c: CanvasRenderingContext2D, x: number, y: number, label: string, tone: ScreenTone = 'teal', px = 17): number {
  c.font = `700 ${px}px ${SCREEN_FONT}`
  const w = Math.ceil(c.measureText(label).width) + 24
  c.beginPath()
  c.roundRect(x, y, w, px + 12, (px + 12) / 2)
  c.fillStyle = rgba(SCREEN_INK[tone], 0.28)
  c.fill()
  paintText(c, label, x + w / 2, y + (px + 12) / 2, px, SCREEN_INK[tone], 700, 'center')
  return w
}

/** A big number with a small caption under it (the KPI look). */
export function paintStat(c: CanvasRenderingContext2D, x: number, y: number, value: string, caption: string): void {
  paintText(c, value, x, y, 44, SCREEN_INK.main, 650)
  paintText(c, caption, x, y + 34, 17, SCREEN_INK.soft, 500)
}
