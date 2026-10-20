/**
 * R3 live patient monitors: the faces, in face pixels (x right, y down). A face is cut into rectangles that TILE it exactly (the tests check):
 *
 *   statics   painted whole into the atlas (the header, the numbers, the station's bay labels) and shown by one quad each
 *   bands     the sweeping traces: three quads each (sweep.ts), over two prepainted sweep slots and a label slot in the atlas
 *
 * Each rectangle belongs to a ROW: the patient it shows (a bedside monitor has one, the PACU central station three; -1 is the monitor itself,
 * like the station's title bar). A row with nobody in it shows the layout's standby face instead, quad by quad, so a half-empty station still looks
 * right.
 *
 *   bedside3  PACU and ER bedside monitor: ECG II, pleth, respiration (or CO2) bands; HR, SpO2, NIBP, RR and temperature on the right
 *   bedside2  pre-op bedside monitor: ECG II and pleth, larger
 *   triage    a spot-check monitor: big SpO2, pulse rate, NIBP and temperature, one pleth band
 *   or        the anaesthesia monitor: ECG II, ART (an arterial line, prostatectomy) or V5, pleth and the capnogram; the same numbers plus CO2
 *   station   the PACU's central station: three bays, each an ECG and a pleth band with HR, SpO2 and NIBP
 */
import { MONITORS } from '@/content/monitors'

export type FaceLayoutId = 'bedside3' | 'bedside2' | 'triage' | 'or' | 'station'

/** What a band shows; the wave is picked per patient (`waveOf`). */
export type BandChannel = 'ecg' | 'second' | 'pleth' | 'breath'
export type WaveKind = 'ecg' | 'ecgV' | 'pleth' | 'art' | 'co2' | 'resp'

export type StaticRole = 'header' | 'numerics' | 'spotNumbers' | 'spotFooter' | 'stationHeader' | 'stationLabel' | 'stationNumerics'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface StaticSpec extends Rect {
  role: StaticRole
  row: number
}

export interface BandSpec extends Rect {
  channel: BandChannel
  row: number
  /** 'fast' sweeps the screen in SWEEP.fast seconds (25 mm/s on a real monitor), 'slow' in SWEEP.slow (the breathing traces). */
  speed: 'fast' | 'slow'
}

export interface FaceLayout {
  id: FaceLayoutId
  w: number
  h: number
  rows: number
  statics: readonly StaticSpec[]
  bands: readonly BandSpec[]
  /** Width of the band label (the lead name) at the left of every band: the erase bar never wipes it (sweep.ts). */
  labelW: number
}

/** Seconds per sweep across a band. */
export const SWEEP = { fast: 6, slow: 24 } as const

/** Width of the erase bar, face pixels. */
export const GAP = 6

const band = (channel: BandChannel, x: number, y: number, w: number, h: number, row = 0): BandSpec => ({
  channel,
  row,
  x,
  y,
  w,
  h,
  speed: channel === 'breath' ? 'slow' : 'fast',
})

const BEDSIDE_W = 384
const BEDSIDE_H = 256
const HEADER = 22

function bedside(id: 'bedside3' | 'bedside2', channels: readonly BandChannel[]): FaceLayout {
  const waveW = 256
  const top = HEADER
  const bandH = (BEDSIDE_H - top) / channels.length
  return {
    id,
    w: BEDSIDE_W,
    h: BEDSIDE_H,
    rows: 1,
    labelW: 44,
    statics: [
      { role: 'header', row: 0, x: 0, y: 0, w: BEDSIDE_W, h: top },
      { role: 'numerics', row: 0, x: waveW, y: top, w: BEDSIDE_W - waveW, h: BEDSIDE_H - top },
    ],
    bands: channels.map((c, i) => band(c, 0, top + Math.round(i * bandH), waveW, Math.round((i + 1) * bandH) - Math.round(i * bandH))),
  }
}

const OR_W = 384
const OR_H = 240

function orLayout(): FaceLayout {
  const top = 20
  const waveW = 256
  const channels: BandChannel[] = ['ecg', 'second', 'pleth', 'breath']
  const bandH = (OR_H - top) / channels.length
  return {
    id: 'or',
    w: OR_W,
    h: OR_H,
    rows: 1,
    labelW: 40,
    statics: [
      { role: 'header', row: 0, x: 0, y: 0, w: OR_W, h: top },
      { role: 'numerics', row: 0, x: waveW, y: top, w: OR_W - waveW, h: OR_H - top },
    ],
    bands: channels.map((c, i) => band(c, 0, top + Math.round(i * bandH), waveW, Math.round((i + 1) * bandH) - Math.round(i * bandH))),
  }
}

function triageLayout(): FaceLayout {
  const top = HEADER
  const numbersH = 150
  const waveW = 256
  return {
    id: 'triage',
    w: BEDSIDE_W,
    h: BEDSIDE_H,
    rows: 1,
    labelW: 44,
    statics: [
      { role: 'header', row: 0, x: 0, y: 0, w: BEDSIDE_W, h: top },
      { role: 'spotNumbers', row: 0, x: 0, y: top, w: BEDSIDE_W, h: numbersH },
      { role: 'spotFooter', row: 0, x: waveW, y: top + numbersH, w: BEDSIDE_W - waveW, h: BEDSIDE_H - top - numbersH },
    ],
    bands: [band('pleth', 0, top + numbersH, waveW, BEDSIDE_H - top - numbersH)],
  }
}

/** The station's three bay rows. */
export const STATION_ROWS = 3

function stationLayout(): FaceLayout {
  const top = 21
  const rowH = (OR_H - top) / STATION_ROWS
  const labelColW = 64
  const waveW = 224
  const statics: StaticSpec[] = [{ role: 'stationHeader', row: -1, x: 0, y: 0, w: OR_W, h: top }]
  const bands: BandSpec[] = []
  for (let r = 0; r < STATION_ROWS; r++) {
    const y = top + r * rowH
    const ecgH = Math.ceil(rowH / 2)
    statics.push({ role: 'stationLabel', row: r, x: 0, y, w: labelColW, h: rowH })
    bands.push(band('ecg', labelColW, y, waveW, ecgH, r))
    bands.push(band('pleth', labelColW, y + ecgH, waveW, rowH - ecgH, r))
    statics.push({ role: 'stationNumerics', row: r, x: labelColW + waveW, y, w: OR_W - labelColW - waveW, h: rowH })
  }
  return { id: 'station', w: OR_W, h: OR_H, rows: STATION_ROWS, labelW: 36, statics, bands }
}

export const LAYOUTS: Readonly<Record<FaceLayoutId, FaceLayout>> = {
  bedside3: bedside('bedside3', ['ecg', 'pleth', 'breath']),
  bedside2: bedside('bedside2', ['ecg', 'pleth']),
  triage: triageLayout(),
  or: orLayout(),
  station: stationLayout(),
}

export const LAYOUT_IDS = Object.keys(LAYOUTS) as FaceLayoutId[]

/** The wave a band shows for a patient: the second band is the arterial line when there is one (else lead V5), the breathing band is the capnogram when CO2 is sampled. */
export function waveOf(channel: BandChannel, art: boolean, co2: boolean): WaveKind {
  switch (channel) {
    case 'ecg':
      return 'ecg'
    case 'second':
      return art ? 'art' : 'ecgV'
    case 'pleth':
      return 'pleth'
    case 'breath':
      return co2 ? 'co2' : 'resp'
  }
}

/** A band's label, as the monitor prints it. */
export function waveLabel(w: WaveKind): string {
  return MONITORS.waves[w]
}

/** The colours of the channels: the usual monitor conventions (ECG green, SpO2 cyan, arterial red, CO2 and respiration yellow, NIBP white). */
export const COLOUR = {
  ecg: '#3dff74',
  ecgV: '#3dff74',
  pleth: '#36e2ff',
  art: '#ff4b4b',
  co2: '#ffd84a',
  resp: '#f2ee7a',
  nibp: '#eef3f5',
  temp: '#d8dee2',
  text: '#e9f1f3',
  dim: '#8a9aa0',
  faint: '#46555b',
  bg: '#04080a',
  header: '#0c171b',
  rule: '#1b2a30',
} as const

/** Does every static and band of `l` tile the face exactly: inside it, no overlaps, nothing left uncovered? (area sum plus pairwise overlap test) */
export function tilesFace(l: FaceLayout): boolean {
  const rects: Rect[] = [...l.statics, ...l.bands]
  let area = 0
  for (const r of rects) {
    if (r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 || r.x + r.w > l.w || r.y + r.h > l.h) return false
    area += r.w * r.h
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return false
    }
  }
  return Math.abs(area - l.w * l.h) < 1e-6
}
