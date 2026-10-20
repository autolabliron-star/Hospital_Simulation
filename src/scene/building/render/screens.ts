/**
 * The shared screen atlas: every screen in the building (bedside, desks, kiosks, monitors, menu board) is a quad showing
 * one tile of ONE canvas texture, drawn once. Static pictures only (the sim's live data arrives in M4 on the command wall),
 * so nothing here redraws. Dark interfaces with soft teal accents keep emissive levels low (skill pitfall "too-bright
 * screens"); the material multiplies by 1.1 at most.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, MeshBasicMaterial, SRGBColorSpace } from 'three'
import { STATUS, WAYFINDING } from '@/scene/materials'
import type { BedState, RoomMeal } from '@/sim/types'
import { ATLAS_COLS, ATLAS_ROWS, TILE, type TileName } from '../layout/screenTiles'

export const TILE_W = 320
export const TILE_H = 200
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

type Painter = (c: CanvasRenderingContext2D, w: number, h: number) => void

function bg(c: CanvasRenderingContext2D, w: number, h: number, top: string, bottom: string): void {
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, top)
  g.addColorStop(1, bottom)
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath()
  c.roundRect(x, y, w, h, r)
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, color: string, weight = 500, align: CanvasTextAlign = 'left'): void {
  c.font = `${weight} ${px}px ${FONT}`
  c.fillStyle = color
  c.textAlign = align
  c.textBaseline = 'middle'
  c.fillText(s, x, y)
}

const PAINTERS: Record<TileName, Painter> = {
  bedside(c, w, h) {
    bg(c, w, h, '#0e2a2d', '#153f43')
    const g = c.createRadialGradient(w * 0.8, h * 0.25, 4, w * 0.8, h * 0.25, w * 0.6)
    g.addColorStop(0, 'rgba(60, 220, 205, 0.38)')
    g.addColorStop(1, 'rgba(60, 220, 205, 0)')
    c.fillStyle = g
    c.fillRect(0, 0, w, h)
    text(c, 'Today', 22, 30, 24, '#9fe3dc', 600)
    text(c, '08:00', 22, 78, 46, '#e8fffb', 600)
    text(c, 'next dose', 24, 112, 19, '#7fc9c2', 500)
    for (let i = 0; i < 3; i++) {
      rr(c, 22, 136 + i * 20, 150 - i * 24, 10, 5)
      c.fillStyle = i === 0 ? STATUS.teal : 'rgba(150, 215, 208, 0.45)'
      c.fill()
    }
    c.beginPath()
    c.arc(w - 62, h - 62, 36, 0, Math.PI * 2)
    c.strokeStyle = 'rgba(120, 230, 215, 0.8)'
    c.lineWidth = 5
    c.stroke()
    text(c, '98%', w - 62, h - 62, 24, '#e8fffb', 600, 'center')
  },
  vitals(c, w, h) {
    // R3: the live patient monitors draw their own faces (src/scene/monitors); a screen left on this tile is a monitor in standby: dark, no text,
    // faint flat lines where the traces would run and dim boxes where the numbers would be
    bg(c, w, h, '#05090b', '#081013')
    c.fillStyle = 'rgba(120, 150, 160, 0.10)'
    c.fillRect(0, 0, w, 16)
    for (let i = 0; i < 3; i++) {
      c.fillStyle = 'rgba(80, 200, 140, 0.16)'
      c.fillRect(14, 48 + i * 52, w - 140, 2)
    }
    for (let i = 0; i < 4; i++) {
      rr(c, w - 108, 26 + i * 42, 94, 30, 4)
      c.fillStyle = 'rgba(140, 170, 180, 0.07)'
      c.fill()
    }
  },
  chart(c, w, h) {
    bg(c, w, h, '#17242a', '#1d2f35')
    rr(c, 0, 0, w, 38, 0)
    c.fillStyle = '#1f6f6b'
    c.fill()
    text(c, 'Ward chart', 14, 20, 20, '#e8fffb', 600)
    for (let i = 0; i < 6; i++) {
      const y = 56 + i * 24
      c.fillStyle = i === 2 ? 'rgba(80, 200, 190, 0.22)' : 'rgba(255, 255, 255, 0.05)'
      c.fillRect(8, y - 10, w - 16, 20)
      c.fillStyle = [STATUS.green, STATUS.teal, STATUS.amber, STATUS.green, STATUS.teal, STATUS.off][i]
      c.beginPath()
      c.arc(24, y, 6, 0, Math.PI * 2)
      c.fill()
      rr(c, 42, y - 4, 90 + ((i * 37) % 70), 8, 4)
      c.fillStyle = 'rgba(214, 240, 236, 0.7)'
      c.fill()
      rr(c, w - 90, y - 4, 60, 8, 4)
      c.fillStyle = 'rgba(214, 240, 236, 0.35)'
      c.fill()
    }
  },
  kiosk(c, w, h) {
    bg(c, w, h, '#102a2e', '#0c1f22')
    text(c, 'Welcome', w / 2, 36, 28, '#d9fffb', 600, 'center')
    text(c, 'Check in here', w / 2, 66, 17, '#7fc9c2', 500, 'center')
    rr(c, 40, 92, w - 80, 56, 16)
    c.fillStyle = STATUS.teal
    c.fill()
    text(c, 'Start', w / 2, 120, 26, '#ffffff', 700, 'center')
    rr(c, 40, 160, (w - 90) / 2, 26, 8)
    c.fillStyle = 'rgba(255, 255, 255, 0.12)'
    c.fill()
    rr(c, 50 + (w - 90) / 2, 160, (w - 90) / 2, 26, 8)
    c.fill()
  },
  reception(c, w, h) {
    bg(c, w, h, '#142329', '#1b2f35')
    text(c, 'Reception', 16, 22, 20, '#e8fffb', 600)
    for (let i = 0; i < 5; i++) {
      const y = 58 + i * 28
      text(c, `A${i + 1}`, 18, y, 20, '#9fe3dc', 600)
      rr(c, 66, y - 6, 150 - i * 12, 12, 6)
      c.fillStyle = 'rgba(214, 240, 236, 0.55)'
      c.fill()
      c.fillStyle = [STATUS.green, STATUS.amber, STATUS.teal, STATUS.green, STATUS.amber][i]
      c.beginPath()
      c.arc(w - 30, y, 7, 0, Math.PI * 2)
      c.fill()
    }
  },
  lab(c, w, h) {
    bg(c, w, h, '#101c28', '#162636')
    text(c, 'Analyser', 14, 20, 18, '#cfe6ff', 600)
    const bars = [0.5, 0.8, 0.35, 0.9, 0.6, 0.72, 0.45]
    bars.forEach((v, i) => {
      const bw = 26
      const x = 20 + i * (bw + 14)
      rr(c, x, h - 20 - v * 120, bw, v * 120, 5)
      c.fillStyle = i === 3 ? STATUS.amber : '#4fb6e8'
      c.fill()
    })
  },
  list(c, w, h) {
    bg(c, w, h, '#14222a', '#1a2c35')
    text(c, 'Orders', 14, 20, 20, '#e8fffb', 600)
    const rows: [string, string][] = [
      ['A3', STATUS.teal],
      ['B6', STATUS.amber],
      ['A7', STATUS.green],
      ['B2', STATUS.teal],
      ['A1', STATUS.green],
    ]
    rows.forEach(([room, color], i) => {
      const y = 56 + i * 28
      c.fillStyle = 'rgba(255, 255, 255, 0.05)'
      c.fillRect(8, y - 11, w - 16, 22)
      text(c, room, 20, y, 19, '#e8fffb', 600)
      rr(c, 70, y - 5, 120, 10, 5)
      c.fillStyle = color
      c.fill()
    })
  },
  map(c, w, h) {
    bg(c, w, h, '#0e1b22', '#13252d')
    c.strokeStyle = 'rgba(120, 220, 210, 0.5)'
    c.lineWidth = 2
    c.strokeRect(12, 22, w - 24, h - 44)
    c.strokeRect(w * 0.4, h * 0.38, w * 0.2, h * 0.24)
    c.beginPath()
    c.moveTo(12, h * 0.3)
    c.lineTo(w - 12, h * 0.3)
    c.moveTo(12, h * 0.7)
    c.lineTo(w - 12, h * 0.7)
    c.stroke()
    const dots: [number, number, string][] = [
      [0.22, 0.3, STATUS.teal],
      [0.55, 0.7, STATUS.amber],
      [0.8, 0.3, STATUS.green],
      [0.35, 0.7, STATUS.teal],
    ]
    for (const [dx, dy, color] of dots) {
      c.fillStyle = color
      c.beginPath()
      c.arc(w * dx, h * dy, 8, 0, Math.PI * 2)
      c.fill()
    }
  },
  console(c, w, h) {
    bg(c, w, h, '#0b0f14', '#10161d')
    for (let i = 0; i < 3; i++) {
      const cx = 56 + i * 100
      c.fillStyle = '#26303a'
      c.beginPath()
      c.arc(cx, 84, 42, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = 'rgba(210, 224, 235, 0.55)'
      c.beginPath()
      c.ellipse(cx, 84, 26 - i * 3, 32, 0, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#0b0f14'
      c.beginPath()
      c.ellipse(cx, 86, 10, 14, 0, 0, Math.PI * 2)
      c.fill()
    }
    text(c, 'Scan ready', 16, h - 26, 22, WAYFINDING.diagnostics, 600)
  },
  menu(c, w, h) {
    bg(c, w, h, '#2a2118', '#1f1810')
    text(c, 'Café', w / 2, 24, 26, '#ffe9bd', 600, 'center')
    const items = ['Flat white', 'Green tea', 'Fruit cup', 'Soup of the day']
    items.forEach((s, i) => {
      text(c, s, 20, 64 + i * 32, 20, '#f5dfb4', 500)
      text(c, `${3 + i}.0`, w - 20, 64 + i * 32, 20, '#e0a03a', 600, 'right')
    })
  },
  directory(c, w, h) {
    bg(c, w, h, '#102128', '#0d1a20')
    const rows: [string, string][] = [
      ['Ward A', WAYFINDING.wardA],
      ['Ward B', WAYFINDING.wardB],
      ['Atrium', WAYFINDING.atrium],
      ['Lab', WAYFINDING.diagnostics],
      ['Emergency', WAYFINDING.emergency],
    ]
    rows.forEach(([s, color], i) => {
      c.fillStyle = color
      c.fillRect(16, 28 + i * 32, 8, 22)
      text(c, s, 40, 40 + i * 32, 21, '#e8fffb', 500)
    })
  },
  idle(c, w, h) {
    bg(c, w, h, '#0c1416', '#10191b')
  },
}

/** Draw the whole atlas once. Returns the texture (and a material that shows it). */
export function createScreenAtlas(): { texture: CanvasTexture; material: MeshBasicMaterial } {
  const canvas = document.createElement('canvas')
  canvas.width = TILE_W * ATLAS_COLS
  canvas.height = TILE_H * ATLAS_ROWS
  const c = canvas.getContext('2d')
  if (!c) throw new Error('screens: no 2d canvas')
  for (const name of Object.keys(TILE) as TileName[]) {
    const i = TILE[name]
    c.save()
    c.translate((i % ATLAS_COLS) * TILE_W, Math.floor(i / ATLAS_COLS) * TILE_H)
    c.beginPath()
    c.rect(0, 0, TILE_W, TILE_H)
    c.clip()
    PAINTERS[name](c, TILE_W, TILE_H)
    c.restore()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 8
  const material = new MeshBasicMaterial({ map: texture, toneMapped: true })
  material.color.setScalar(1.1) // screens stay at or below 1.2 emissive
  return { texture, material }
}

// ---------------------------------------------------------------------------------------------
// Live bedside screens (L1)
// ---------------------------------------------------------------------------------------------

/** What a bedside screen shows. The ward layer (src/scene/meals/ward) redraws one tile only when its room's `RoomStatus.version` changes. */
export interface BedsideInfo {
  roomId: string
  bed: BedState
  /** The occupant (or, for a reserved bed, the patient on the way): a synthetic name. */
  name: string | null
  /** Day of stay, counting the day of admission as 1. */
  day: number
  meal: RoomMeal
}

export type ChipTone = 'peach' | 'blue' | 'teal' | 'amber' | 'green'

export interface BedsideContent {
  /** The small line at the top-left. */
  header: string
  title: string
  subtitle: string | null
  chip: { text: string; tone: ChipTone } | null
  /** The accent of the screen (the glow and the header). */
  accent: ChipTone
}

/** The words of a bedside screen: a pure function of the room's state, so the choices are tested without a canvas. */
export function bedsideContent(info: BedsideInfo): BedsideContent {
  const header = `Bed ${info.roomId}`
  const who = info.name ?? 'Patient'
  const stay = `Day ${Math.max(1, info.day)} of stay`
  const mealChip = info.meal === 'served' ? { text: 'Meal served', tone: 'peach' as const } : info.meal === 'eaten' ? { text: 'Meal finished', tone: 'peach' as const } : null
  switch (info.bed) {
    case 'occupied':
      return { header, title: who, subtitle: stay, chip: mealChip, accent: 'teal' }
    case 'dischargeSigned':
      return { header, title: who, subtitle: stay, chip: { text: 'Going home today', tone: 'blue' }, accent: 'blue' }
    case 'leaving':
      return { header, title: who, subtitle: stay, chip: { text: 'Leaving the ward', tone: 'blue' }, accent: 'blue' }
    case 'reserved':
      return { header: `${header} · next patient`, title: who, subtitle: 'On the way to this bed', chip: { text: 'Bed reserved', tone: 'teal' }, accent: 'teal' }
    case 'needsCleaning':
      return { header, title: 'Bed empty', subtitle: 'Waiting for cleaning', chip: { text: 'Not ready yet', tone: 'amber' }, accent: 'amber' }
    case 'cleaning':
      return { header, title: 'Bed empty', subtitle: 'Cleaning in progress', chip: { text: 'Not ready yet', tone: 'amber' }, accent: 'amber' }
    case 'ready':
      return { header, title: 'Ready for the next patient', subtitle: null, chip: { text: 'Clean and made up', tone: 'green' }, accent: 'green' }
  }
}

const CHIP_COLORS: Record<ChipTone, { fill: string; text: string; glow: string }> = {
  peach: { fill: '#f2a07c', text: '#3a1d10', glow: '60, 220, 205' },
  blue: { fill: '#8fbdf2', text: '#10263f', glow: '120, 170, 240' },
  teal: { fill: STATUS.teal, text: '#04201f', glow: '60, 220, 205' },
  amber: { fill: STATUS.amber, text: '#3a2408', glow: '240, 170, 70' },
  green: { fill: STATUS.green, text: '#07301a', glow: '90, 220, 130' },
}

/** Split `s` into at most `max` lines that each fit `width` at the context's current font. */
function wrapLines(c: CanvasRenderingContext2D, s: string, width: number, max: number): string[] {
  const words = s.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (line && c.measureText(next).width > width && lines.length < max - 1) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** Paint one bedside screen into the (w x h) box at the context's origin. Same dark teal language as the static `bedside` tile. */
export function paintBedsideScreen(c: CanvasRenderingContext2D, w: number, h: number, info: BedsideInfo): void {
  const content = bedsideContent(info)
  const tone = CHIP_COLORS[content.accent]
  bg(c, w, h, '#0e2a2d', '#153f43')
  const g = c.createRadialGradient(w * 0.8, h * 0.2, 4, w * 0.8, h * 0.2, w * 0.6)
  g.addColorStop(0, `rgba(${tone.glow}, 0.34)`)
  g.addColorStop(1, `rgba(${tone.glow}, 0)`)
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
  text(c, content.header, 22, 28, 22, '#9fe3dc', 600)
  // the title: one line shrunk to fit, or (a long sentence) up to two lines
  const fit = w - 44
  let px = 44
  c.font = `600 ${px}px ${FONT}`
  while (px > 26 && c.measureText(content.title).width > fit) {
    px -= 2
    c.font = `600 ${px}px ${FONT}`
  }
  const lines = c.measureText(content.title).width > fit ? wrapLines(c, content.title, fit, 2) : [content.title]
  const lineH = px * 1.12
  const top = content.subtitle ? 84 : 92
  lines.forEach((l, i) => text(c, l, 22, top + i * lineH, px, '#e8fffb', 600))
  if (content.subtitle) text(c, content.subtitle, 22, top + (lines.length - 1) * lineH + 40, 21, '#7fc9c2', 500)
  if (content.chip) {
    const chip = CHIP_COLORS[content.chip.tone]
    c.font = `600 20px ${FONT}`
    const cw = Math.min(w - 44, c.measureText(content.chip.text).width + 34)
    rr(c, 22, h - 52, cw, 32, 16)
    c.fillStyle = chip.fill
    c.fill()
    text(c, content.chip.text, 22 + cw / 2, h - 36, 20, chip.text, 700, 'center')
  }
}

/** The static default look of a bedside screen (what the ward shows before the living-day view exists). */
export function paintBedsideDefault(c: CanvasRenderingContext2D, w: number, h: number): void {
  PAINTERS.bedside(c, w, h)
}
