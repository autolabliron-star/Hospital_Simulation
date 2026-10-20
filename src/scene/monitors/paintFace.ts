/**
 * R3 live patient monitors: painting the still parts of a face (the header, the numbers, the station's bay labels) and the standby faces. A static
 * is painted whole into the staging sheet at (ox, oy) in its OWN coordinates (0..w, 0..h) and copied into its atlas region; the pump repaints the
 * numbers once a second for a monitor somebody is looking at and every five seconds otherwise.
 *
 * Pure canvas-2D calls on a `Ctx2D`. Every word is from src/content/monitors.json; every number is synthetic (`RowNumbers`, filled by the hub
 * from vitals.ts and beats.ts). Nothing is ever flagged: no alarm colours, no limits, no messages.
 */
import { fillMonitor, MONITORS } from '@/content/monitors'
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { clockText } from './clock'
import { COLOUR, STATION_ROWS, type FaceLayout, type StaticSpec } from './layouts'
import { FONT } from './paintSlot'
import type { NibpReading } from './vitals'

/** The numbers one row shows. */
export interface RowNumbers {
  name: string
  hr: number
  spo2: number
  rr: number
  temp: number
  nibp: NibpReading
  /** Minutes between automatic cuff readings (0: a single reading). */
  nibpEvery: number
  art: boolean
  artSys: number
  artDia: number
  co2: boolean
  etco2: number
  ventilated: boolean
}

export function newRowNumbers(): RowNumbers {
  return {
    name: '',
    hr: 0,
    spo2: 0,
    rr: 0,
    temp: 0,
    nibp: { has: false, sys: 0, dia: 0, map: 0, at: 0, n: -1 },
    nibpEvery: 0,
    art: false,
    artSys: 0,
    artDia: 0,
    co2: false,
    etco2: 0,
    ventilated: false,
  }
}

/** Everything a face's statics read. `rows[r]` is null for a row with nobody in it. */
export interface FaceData {
  layout: FaceLayout
  bed: string
  /** The station's bay names, by row. */
  rowBeds: readonly string[]
  /** The sim time (the header clock). */
  simT: number
  rows: readonly (RowNumbers | null)[]
}

function text(c: Ctx2D, s: string, x: number, y: number, px: number, colour: string, weight = 500, align: CanvasTextAlign = 'left'): void {
  c.font = `${weight} ${px}px ${FONT}`
  c.fillStyle = colour
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  c.fillText(s, x, y)
}

function rule(c: Ctx2D, x: number, y: number, w: number): void {
  c.fillStyle = COLOUR.rule
  c.fillRect(x, y, w, 1)
}

/** `text` cut with an ellipsis so it fits `maxW` at the current font. */
function fit(c: Ctx2D, s: string, maxW: number): string {
  if (c.measureText(s).width <= maxW) return s
  let n = s.length
  while (n > 1 && c.measureText(`${s.slice(0, n)}…`).width > maxW) n--
  return `${s.slice(0, n).trimEnd()}…`
}

const dash = (has: boolean, v: string): string => (has ? v : '--')
const pressure = (sys: number, dia: number): string => `${sys}/${dia}`
const mapOf = (sys: number, dia: number): number => Math.round(dia + (sys - dia) / 3)

function nibpCaption(r: RowNumbers): string {
  if (!r.nibp.has) return r.nibpEvery > 0 ? fillMonitor(MONITORS.nibp.auto, { n: r.nibpEvery }) : MONITORS.nibp.manual
  return fillMonitor(MONITORS.nibp.at, { time: clockText(r.nibp.at) })
}

// ---------------------------------------------------------------------------------------------
// The statics
// ---------------------------------------------------------------------------------------------

function paintHeader(c: Ctx2D, w: number, h: number, d: FaceData, row: RowNumbers | null, title: string): void {
  c.fillStyle = COLOUR.header
  c.fillRect(0, 0, w, h)
  const base = Math.round(h * 0.7)
  text(c, d.bed, 6, base, 12, COLOUR.text, 700)
  c.font = `700 12px ${FONT}`
  const x = 6 + c.measureText(d.bed).width + 10
  const right = w - 6
  text(c, clockText(d.simT), right, base, 12, COLOUR.text, 700, 'right')
  c.font = `700 12px ${FONT}`
  const clockW = c.measureText(clockText(d.simT)).width
  text(c, MONITORS.simulated, right - clockW - 10, base, 9, COLOUR.dim, 600, 'right')
  c.font = `600 9px ${FONT}`
  const simW = c.measureText(MONITORS.simulated).width
  const nameRoom = right - clockW - simW - 24 - x
  c.font = `500 12px ${FONT}`
  const who = row ? row.name : title
  if (who !== '' && nameRoom > 20) text(c, fit(c, who, nameRoom), x, base, 12, row ? COLOUR.text : COLOUR.dim, 500)
}

/** A parameter box's caption (label left, unit or note right). */
function caption(c: Ctx2D, x: number, y: number, w: number, label: string, note: string, colour: string): void {
  text(c, label, x, y, 10, colour, 650)
  if (note !== '') text(c, note, x + w, y, 9, colour, 500, 'right')
}

/** The bedside and OR numbers column. */
function paintNumerics(c: Ctx2D, w: number, h: number, d: FaceData, r: RowNumbers | null): void {
  c.fillStyle = COLOUR.bg
  c.fillRect(0, 0, w, h)
  c.fillStyle = COLOUR.rule
  c.fillRect(0, 0, 1, h)
  const P = MONITORS.params
  const U = MONITORS.units
  const L = 7
  const W = w - 13
  const live = r !== null
  const or = d.layout.id === 'or'
  // heights of the boxes: HR, then the second box (ART in theatre with an arterial line, else NIBP), SpO2, the breathing, the last line
  const boxes = or ? [48, 50, 44, 50, h - 192] : [62, 54, 56, 32, h - 204]
  let y = 0
  // HR
  caption(c, L, y + 13, W, P.hr, U.bpm, COLOUR.ecg)
  text(c, live ? String(r.hr) : '--', w - 6, y + boxes[0] - 6, or ? 32 : 36, COLOUR.ecg, 700, 'right')
  y += boxes[0]
  rule(c, 4, y, w - 8)
  // the second box
  if (or && live && r.art) {
    caption(c, L, y + 13, W, P.art, U.mmHg, COLOUR.art)
    text(c, pressure(r.artSys, r.artDia), w - 6, y + 34, 20, COLOUR.art, 700, 'right')
    text(c, `(${mapOf(r.artSys, r.artDia)})`, w - 6, y + boxes[1] - 4, 13, COLOUR.art, 600, 'right')
  } else if (or) {
    caption(c, L, y + 13, W, P.nibp, live ? nibpCaption(r) : '', COLOUR.nibp)
    text(c, live ? dash(r.nibp.has, pressure(r.nibp.sys, r.nibp.dia)) : '--', w - 6, y + 34, 20, COLOUR.nibp, 700, 'right')
    if (live && r.nibp.has) text(c, `(${r.nibp.map})`, w - 6, y + boxes[1] - 4, 13, COLOUR.nibp, 600, 'right')
  } else {
    caption(c, L, y + 13, W, P.spo2, U.percent, COLOUR.pleth)
    text(c, live ? String(r.spo2) : '--', w - 6, y + boxes[1] - 6, 32, COLOUR.pleth, 700, 'right')
  }
  y += boxes[1]
  rule(c, 4, y, w - 8)
  // the third box: SpO2 in theatre, NIBP at the bedside
  if (or) {
    caption(c, L, y + 13, W, P.spo2, U.percent, COLOUR.pleth)
    text(c, live ? String(r.spo2) : '--', w - 6, y + boxes[2] - 5, 28, COLOUR.pleth, 700, 'right')
  } else {
    caption(c, L, y + 13, W, P.nibp, live ? nibpCaption(r) : '', COLOUR.nibp)
    text(c, live ? dash(r.nibp.has, pressure(r.nibp.sys, r.nibp.dia)) : '--', w - 6, y + 36, 21, COLOUR.nibp, 700, 'right')
    if (live && r.nibp.has) text(c, `(${r.nibp.map})`, w - 6, y + boxes[2] - 5, 12, COLOUR.nibp, 600, 'right')
  }
  y += boxes[2]
  rule(c, 4, y, w - 8)
  // the breathing: CO2 (end-tidal, inspired, the ventilator's rate) in theatre, the respiration rate at the bedside
  if (or) {
    caption(c, L, y + 13, W, P.co2, U.mmHg, COLOUR.co2)
    text(c, P.etco2, L, y + 36, 10, COLOUR.co2, 600)
    text(c, live ? String(Math.round(r.etco2)) : '--', L + 62, y + 38, 22, COLOUR.co2, 700, 'right')
    text(c, `${P.fico2} ${live ? 0 : '--'}`, w - 6, y + 27, 10, COLOUR.co2, 600, 'right')
    text(c, `${P.awrr} ${live ? r.rr : '--'}`, w - 6, y + 42, 10, COLOUR.co2, 600, 'right')
  } else {
    caption(c, L, y + 12, W, P.rr, U.perMin, COLOUR.resp)
    text(c, live ? String(r.rr) : '--', w - 6, y + boxes[3] - 3, 20, COLOUR.resp, 700, 'right')
  }
  y += boxes[3]
  rule(c, 4, y, w - 8)
  // the last line: the cuff under an arterial line, else the temperature
  if (or && live && r.art) {
    text(c, P.nibp, L, y + boxes[4] - 8, 10, COLOUR.nibp, 650)
    text(c, r.nibp.has ? `${pressure(r.nibp.sys, r.nibp.dia)} (${r.nibp.map})` : MONITORS.nibp.none, w - 6, y + boxes[4] - 8, 11, COLOUR.nibp, 600, 'right')
  } else {
    text(c, P.temp, L, y + boxes[4] - 8, 10, COLOUR.temp, 650)
    text(c, live ? `${r.temp.toFixed(1)} ${U.celsius}` : '--', w - 6, y + boxes[4] - 8, 12, COLOUR.temp, 600, 'right')
  }
}

/** The triage spot-check numbers: SpO2, pulse rate, NIBP and temperature in a row of tiles. */
function paintSpotNumbers(c: Ctx2D, w: number, h: number, r: RowNumbers | null): void {
  c.fillStyle = COLOUR.bg
  c.fillRect(0, 0, w, h)
  const P = MONITORS.params
  const U = MONITORS.units
  const live = r !== null
  const tiles = [
    { x: 0, w: 96 },
    { x: 96, w: 96 },
    { x: 192, w: 128 },
    { x: 320, w: w - 320 },
  ]
  for (let i = 1; i < tiles.length; i++) {
    c.fillStyle = COLOUR.rule
    c.fillRect(tiles[i].x, 8, 1, h - 16)
  }
  const t = tiles
  caption(c, t[0].x + 8, 18, t[0].w - 16, P.spo2, U.percent, COLOUR.pleth)
  text(c, live ? String(r.spo2) : '--', t[0].x + t[0].w / 2, 92, 46, COLOUR.pleth, 700, 'center')
  caption(c, t[1].x + 8, 18, t[1].w - 16, P.pr, U.bpm, COLOUR.ecg)
  text(c, live ? String(r.hr) : '--', t[1].x + t[1].w / 2, 92, 46, COLOUR.ecg, 700, 'center')
  caption(c, t[2].x + 8, 18, t[2].w - 16, P.nibp, U.mmHg, COLOUR.nibp)
  text(c, live && r.nibp.has ? pressure(r.nibp.sys, r.nibp.dia) : MONITORS.nibp.none, t[2].x + t[2].w / 2, 86, 30, COLOUR.nibp, 700, 'center')
  if (live && r.nibp.has) text(c, `(${r.nibp.map})`, t[2].x + t[2].w / 2, 112, 15, COLOUR.nibp, 600, 'center')
  caption(c, t[3].x + 8, 18, t[3].w - 16, P.temp, '', COLOUR.temp)
  text(c, live ? r.temp.toFixed(1) : '--', t[3].x + t[3].w / 2, 86, 22, COLOUR.temp, 700, 'center')
  text(c, U.celsius, t[3].x + t[3].w / 2, 108, 11, COLOUR.temp, 500, 'center')
  rule(c, 0, h - 1, w)
}

function paintSpotFooter(c: Ctx2D, w: number, h: number, r: RowNumbers | null): void {
  c.fillStyle = COLOUR.bg
  c.fillRect(0, 0, w, h)
  c.fillStyle = COLOUR.rule
  c.fillRect(0, 0, 1, h)
  text(c, MONITORS.spotCheck, 10, 22, 12, COLOUR.text, 700)
  if (r !== null && r.nibp.has) text(c, `${MONITORS.params.nibp} ${clockText(r.nibp.at)}`, 10, 42, 10, COLOUR.dim, 600)
  text(c, MONITORS.adult, 10, 58, 9, COLOUR.dim, 600)
  text(c, MONITORS.simulated, 10, h - 8, 9, COLOUR.dim, 600)
}

function paintStationLabel(c: Ctx2D, w: number, h: number, bed: string, r: RowNumbers | null): void {
  c.fillStyle = COLOUR.header
  c.fillRect(0, 0, w, h)
  c.fillStyle = COLOUR.rule
  c.fillRect(0, h - 1, w, 1)
  text(c, bed, 6, 16, 11, COLOUR.text, 700)
  if (r === null) {
    text(c, MONITORS.station.empty, 6, 36, 9, COLOUR.dim, 500)
    return
  }
  const parts = r.name.split(' ')
  const first = parts[0] ?? ''
  const rest = parts.slice(1).join(' ')
  c.font = `500 10px ${FONT}`
  text(c, fit(c, first, w - 10), 6, 34, 10, COLOUR.text, 500)
  c.font = `500 10px ${FONT}`
  if (rest !== '') text(c, fit(c, rest, w - 10), 6, 48, 10, COLOUR.text, 500)
  text(c, MONITORS.adult, 6, h - 8, 8, COLOUR.dim, 600)
}

function paintStationNumerics(c: Ctx2D, w: number, h: number, r: RowNumbers | null): void {
  c.fillStyle = COLOUR.bg
  c.fillRect(0, 0, w, h)
  c.fillStyle = COLOUR.rule
  c.fillRect(0, 0, 1, h)
  c.fillRect(0, h - 1, w, 1)
  const P = MONITORS.params
  const live = r !== null
  text(c, P.hr, 6, 12, 8, COLOUR.ecg, 650)
  text(c, live ? String(r.hr) : '--', w - 6, 26, 22, COLOUR.ecg, 700, 'right')
  text(c, P.spo2, 6, 38, 8, COLOUR.pleth, 650)
  text(c, live ? String(r.spo2) : '--', w - 6, 52, 18, COLOUR.pleth, 700, 'right')
  text(c, live && r.nibp.has ? `${pressure(r.nibp.sys, r.nibp.dia)} (${r.nibp.map})` : MONITORS.nibp.none, w - 6, h - 6, 10, COLOUR.nibp, 600, 'right')
}

/** Paint static `s` of a face at (ox, oy) of the sheet, in its own coordinates. */
export function paintStatic(c: Ctx2D, ox: number, oy: number, s: StaticSpec, d: FaceData): void {
  c.save()
  c.beginPath()
  c.rect(ox, oy, s.w, s.h)
  c.clip()
  c.translate(ox, oy)
  const row = s.row >= 0 ? (d.rows[s.row] ?? null) : null
  switch (s.role) {
    case 'header':
      paintHeader(c, s.w, s.h, d, row, MONITORS.standby)
      break
    case 'stationHeader':
      paintHeader(c, s.w, s.h, d, null, '')
      break
    case 'numerics':
      paintNumerics(c, s.w, s.h, d, row)
      break
    case 'spotNumbers':
      paintSpotNumbers(c, s.w, s.h, row)
      break
    case 'spotFooter':
      paintSpotFooter(c, s.w, s.h, row)
      break
    case 'stationLabel':
      paintStationLabel(c, s.w, s.h, d.rowBeds[s.row] ?? '', row)
      break
    case 'stationNumerics':
      paintStationNumerics(c, s.w, s.h, row)
      break
  }
  c.restore()
}

/**
 * The standby face of a layout, whole, at (ox, oy): what a row with nobody in it shows (quad by quad). The statics with no patient, the wave area
 * dark, and "Standby" in the middle of the waves. It draws nothing per band, so layouts with the same statics can share it (atlas.ts IDLE_SHARED).
 */
export function paintIdleFace(c: Ctx2D, ox: number, oy: number, layout: FaceLayout, rowBeds: readonly string[]): void {
  c.save()
  c.beginPath()
  c.rect(ox, oy, layout.w, layout.h)
  c.clip()
  c.fillStyle = COLOUR.bg
  c.fillRect(ox, oy, layout.w, layout.h)
  const d: FaceData = { layout, bed: '', rowBeds, simT: 0, rows: [] }
  for (const s of layout.statics) {
    if (s.role === 'header') {
      c.save()
      c.translate(ox + s.x, oy + s.y)
      c.fillStyle = COLOUR.header
      c.fillRect(0, 0, s.w, s.h)
      text(c, MONITORS.standby, 6, Math.round(s.h * 0.7), 12, COLOUR.dim, 700)
      text(c, MONITORS.simulated, s.w - 6, Math.round(s.h * 0.7), 9, COLOUR.dim, 600, 'right')
      c.restore()
    } else if (s.role !== 'stationHeader') {
      paintStatic(c, ox + s.x, oy + s.y, s, d)
    }
  }
  let x0 = Infinity
  let x1 = 0
  let y0 = Infinity
  let y1 = 0
  for (const b of layout.bands) {
    x0 = Math.min(x0, b.x)
    x1 = Math.max(x1, b.x + b.w)
    y0 = Math.min(y0, b.y)
    y1 = Math.max(y1, b.y + b.h)
  }
  if (layout.rows === 1) {
    const cx = ox + (x0 + x1) / 2
    const cy = oy + (y0 + y1) / 2
    text(c, MONITORS.standby, cx, cy, 20, COLOUR.dim, 650, 'center')
    text(c, MONITORS.standbyNote, cx, cy + 20, 10, COLOUR.faint, 500, 'center')
  }
  c.restore()
}

/** The station's bay names (rows). */
export function stationBeds(): string[] {
  return Array.from({ length: STATION_ROWS }, (_, i) => fillMonitor(MONITORS.beds.pacu, { n: i + 1 }))
}
