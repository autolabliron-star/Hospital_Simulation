/**
 * R5 wave 3: the CT suite's anaesthesia monitor, a tile of the cryo screens (screens.ts `TILE.anaes`, on the machine's tower, anaesMachine.ts). Pure
 * painters and waveforms (a `Ctx2D`, so they run against the software canvas in node): synthetic, display-only, never an alarm.
 *
 *   in use   heart rate, SpO2, blood pressure, end-tidal CO2 and the ventilation's rate and pressure as numbers, and four traces: the ECG and the pulse
 *            wave (the heart goes on), the capnogram and the airway pressure (the breathing)
 *   standby  "Standby / No patient connected" and a flat line: the kidney's case (the nurse sedates it, no machine in use) and the machine between cases
 *
 * THE HELD BREATH. While `state.apnoea` is true (the anaesthetist pauses the ventilator for a scan or a needle push) the two ventilation traces go FLAT:
 * the capnogram at zero, the airway pressure at its baseline; the numbers that come from breaths show "--". When the ventilator resumes, a first breath
 * begins at once (its inspiration, then its expiration's CO2 wave two seconds later). `observeMonitor` records each hold's start and end in `MonitorMemory`
 * (every frame, a few numbers, no allocation); the traces are pure functions of the display time and that memory, so a repaint redraws the whole
 * 8-second strip from nothing. Display time is REAL time (frozen while the sim is paused): the strip scrolls at one speed whatever the sim's.
 */
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import { MONITORS } from '@/content/monitors'
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import type { CryoSuiteState } from '@/sim/types'
import { anaesInUse, ventilated } from './anaesInUse'
import { INK, simulatedTag } from './ctPaint'

/** The strip shows this many seconds, newest at the right. */
export const STRIP_S = 8
/** The breath period (s) of the machine's ventilation (12 a minute) and of a patient breathing unaided (15 a minute). */
export const VENT_BREATH_S = 5
export const OWN_BREATH_S = 4
/** The ventilator's inspiration lasts this long (s) at the start of each breath; the expiration (the capnogram's wave) follows. */
export const INSPIRE_S = 1.8
/** Pressure (cmH2O) the airway sits at between breaths. */
export const PEEP = 5

// ---------------------------------------------------------------------------------------------
// The patient's numbers (synthetic, from the case's image seed)
// ---------------------------------------------------------------------------------------------

/** A hash of (seed, k) in [0, 1): the numbers of a synthetic patient need no stream. */
function unit(seed: number, k: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

export interface Vitals {
  hr: number
  spo2: number
  sys: number
  dia: number
  map: number
  etco2: number
  /** The machine's breaths a minute. */
  rr: number
  /** Airway pressure at the top of a breath (cmH2O). */
  peak: number
}

export function vitalsFor(seed: number): Vitals {
  const sys = 108 + Math.floor(unit(seed, 3) * 18)
  const dia = 62 + Math.floor(unit(seed, 4) * 14)
  return {
    hr: 62 + Math.floor(unit(seed, 1) * 14),
    spo2: 98 + (unit(seed, 2) < 0.5 ? 0 : 1),
    sys,
    dia,
    map: Math.round((sys + 2 * dia) / 3),
    etco2: 34 + Math.floor(unit(seed, 5) * 5),
    rr: 60 / VENT_BREATH_S,
    peak: 16 + Math.floor(unit(seed, 6) * 4),
  }
}

// ---------------------------------------------------------------------------------------------
// The held breath's memory
// ---------------------------------------------------------------------------------------------

const HOLDS = 4

export interface MonitorMemory {
  /** The last `HOLDS` held breaths as [from, to] pairs (display seconds; `to` is Infinity while it lasts), the newest at `head`. */
  holds: Float64Array
  head: number
  held: boolean
}

export const newMonitorMemory = (): MonitorMemory => ({ holds: new Float64Array(HOLDS * 2).fill(Number.NEGATIVE_INFINITY), head: HOLDS - 1, held: false })

/** Note the state's held breath at display time `tm` (call every frame: it only writes when the flag flips). */
export function observeMonitor(m: MonitorMemory, s: CryoSuiteState, tm: number): void {
  if (s.apnoea && !m.held) {
    m.held = true
    m.head = (m.head + 1) % HOLDS
    m.holds[m.head * 2] = tm
    m.holds[m.head * 2 + 1] = Number.POSITIVE_INFINITY
  } else if (!s.apnoea && m.held) {
    m.held = false
    m.holds[m.head * 2 + 1] = tm
  }
}

/** Is display time `t` inside a held breath? */
export function heldAt(m: MonitorMemory, t: number): boolean {
  for (let i = 0; i < HOLDS; i++) if (t >= m.holds[i * 2] && t < m.holds[i * 2 + 1]) return true
  return false
}

/** The start of the breath cycle at `t`: where the latest hold that ended by `t` ended (a first breath begins as the ventilator resumes), else 0. */
export function breathOrigin(m: MonitorMemory, t: number): number {
  let o = 0
  for (let i = 0; i < HOLDS; i++) {
    const to = m.holds[i * 2 + 1]
    if (to <= t && to > o) o = to
  }
  return o
}

// ---------------------------------------------------------------------------------------------
// The traces: each a height 0..1 at display time t
// ---------------------------------------------------------------------------------------------

const gauss = (x: number, mu: number, sigma: number): number => {
  const d = (x - mu) / sigma
  return Math.exp(-0.5 * d * d)
}
const smooth = (x: number): number => {
  const k = x < 0 ? 0 : x > 1 ? 1 : x
  return k * k * (3 - 2 * k)
}

/** The ECG (lead II) of a patient at `hr`: P, Q, R, S and T around each R wave, as 0..1 of the row (the baseline a fifth of the way up). */
export function ecgFrac(t: number, hr: number): number {
  const rr = 60 / hr
  const u = ((((t + rr / 2) % rr) + rr) % rr) - rr / 2
  const v = 0.12 * gauss(u, -0.17, 0.025) - 0.1 * gauss(u, -0.03, 0.01) + 1.0 * gauss(u, 0, 0.011) - 0.2 * gauss(u, 0.028, 0.01) + 0.3 * gauss(u, 0.27, 0.05)
  return 0.25 + 0.55 * v
}

/** The pulse wave (SpO2 trace): a fast upstroke, a decay and the small dicrotic bump, each beat a little after its R wave. */
export function pulseFrac(t: number, hr: number): number {
  const rr = 60 / hr
  const u = (((t - 0.2) % rr) + rr) % rr
  const rise = 0.14
  const up = smooth(u / rise)
  const down = u > rise ? Math.exp(-(u - rise) / 0.32) : 1
  const bump = 0.1 * gauss(u, rise + 0.26, 0.04)
  return 0.1 + 0.8 * Math.min(1, up * down + bump)
}

/** The capnogram, 0..1 of 45 mmHg: zero while breathing in, the wave of the breath out (the upstroke, the slowly rising plateau, the downstroke); zero for a held breath. */
export function co2Frac(t: number, m: MonitorMemory, v: Vitals, period: number): number {
  if (heldAt(m, t)) return 0
  const u = ((((t - breathOrigin(m, t)) % period) + period) % period)
  if (u < INSPIRE_S) return 0
  const e = u - INSPIRE_S
  const span = period - INSPIRE_S
  const top = v.etco2 / 45
  if (e < 0.3) return top * 0.88 * smooth(e / 0.3)
  if (e < span - 0.3) return top * (0.88 + 0.12 * ((e - 0.3) / (span - 0.6)))
  return top * smooth((span - e) / 0.3)
}

/** The airway pressure, 0..1 of 22 cmH2O: PEEP between breaths, a rise to the peak in the breath in and a short plateau; PEEP, flat, for a held breath. */
export function pawFrac(t: number, m: MonitorMemory, v: Vitals, period: number): number {
  if (heldAt(m, t)) return PEEP / 22
  const u = ((((t - breathOrigin(m, t)) % period) + period) % period)
  if (u >= INSPIRE_S) return PEEP / 22
  const rise = smooth(u / 0.4)
  const fall = smooth((INSPIRE_S - u) / 0.3)
  const level = PEEP + (v.peak - PEEP) * Math.min(rise, fall) - 1.4 * smooth((u - 0.4) / 1.0) * fall
  return level / 22
}

// ---------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------

const TRACE_COLOURS = { ecg: INK.green, pulse: INK.teal, co2: INK.amber, paw: INK.text } as const

function put(c: Ctx2D, s: string, x: number, y: number, size: number, color: string, weight = 500, align: CanvasTextAlign = 'left'): void {
  c.font = `${weight} ${size}px system-ui, sans-serif`
  c.fillStyle = color
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  c.fillText(s, x, y)
}

/** Draw one trace across [x0, x1] in the row [top, top + rowH): `f(t)` is its height 0..1; newest at the right. */
function strip(c: Ctx2D, x0: number, x1: number, top: number, rowH: number, tm: number, color: string, f: (t: number) => number): void {
  const n = Math.max(8, Math.floor((x1 - x0) / 2))
  c.strokeStyle = color
  c.lineWidth = 1.6
  c.lineJoin = 'round'
  c.beginPath()
  for (let i = 0; i <= n; i++) {
    const t = tm - STRIP_S + (STRIP_S * i) / n
    const y = top + rowH * 0.92 - f(t) * rowH * 0.84
    if (i === 0) c.moveTo(x0, y)
    else c.lineTo(x0 + ((x1 - x0) * i) / n, y)
  }
  c.stroke()
}

function clearTile(c: Ctx2D, w: number, h: number): void {
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  c.setLineDash([])
  c.fillStyle = INK.bg
  c.fillRect(0, 0, w, h)
}

/** The standby screen: the machine between cases, and the kidney's case (no machine in use). */
export function paintAnaesStandby(c: Ctx2D, w: number, h: number): void {
  clearTile(c, w, h)
  put(c, CRYO_SUITE_COPY.monitor.title, 10, 20, 13, INK.dim, 650)
  put(c, MONITORS.standby, w / 2, h * 0.42, 30, INK.text, 650, 'center')
  put(c, MONITORS.standbyNote, w / 2, h * 0.42 + 24, 13, INK.dim, 500, 'center')
  c.fillStyle = '#16232a'
  c.fillRect(12, h * 0.72, w - 24, 2)
  simulatedTag(c, w)
}

/** The monitor of a patient on the machine at display time `tm`. */
export function paintAnaesMonitor(c: Ctx2D, w: number, h: number, s: CryoSuiteState, m: MonitorMemory, tm: number): void {
  if (!anaesInUse(s)) {
    paintAnaesStandby(c, w, h)
    return
  }
  clearTile(c, w, h)
  const v = vitalsFor(s.imageSeed)
  const vent = ventilated(s)
  const held = s.apnoea
  const period = vent ? VENT_BREATH_S : OWN_BREATH_S
  const copy = CRYO_SUITE_COPY.monitor
  const pad = 8
  const top = 30
  const rowH = (h - top - 24) / 4
  const x1 = Math.round(w * 0.64)
  put(c, copy.title, pad, 19, 13, INK.text, 650)

  // the four traces
  const labels = [MONITORS.waves.ecg, MONITORS.waves.pleth, MONITORS.waves.co2, copy.paw]
  for (let i = 0; i < 4; i++) {
    const y = top + i * rowH
    put(c, labels[i], pad + 2, y + 11, 10, INK.dim, 600)
    c.fillStyle = '#16232a'
    c.fillRect(pad, y + rowH - 1, x1 - pad, 1)
  }
  strip(c, pad, x1, top, rowH, tm, TRACE_COLOURS.ecg, (t) => ecgFrac(t, v.hr))
  strip(c, pad, x1, top + rowH, rowH, tm, TRACE_COLOURS.pulse, (t) => pulseFrac(t, v.hr))
  strip(c, pad, x1, top + 2 * rowH, rowH, tm, TRACE_COLOURS.co2, (t) => co2Frac(t, m, v, period))
  strip(c, pad, x1, top + 3 * rowH, rowH, tm, TRACE_COLOURS.paw, (t) => (vent ? pawFrac(t, m, v, period) : 0.02))

  // the numbers: the heart's, then the breathing's ("--" where the number comes from breaths and there are none)
  const nx = x1 + 12
  const block = (i: number, label: string, value: string, unit: string, color: string): void => {
    const y = top + i * rowH
    put(c, label, nx, y + 12, 10, INK.dim, 600)
    put(c, value, nx, y + rowH * 0.82, 26, color, 700)
    put(c, unit, w - pad, y + 12, 10, INK.dim, 500, 'right')
  }
  block(0, MONITORS.params.hr, String(v.hr), MONITORS.units.bpm, INK.green)
  block(1, MONITORS.params.spo2, String(v.spo2), MONITORS.units.percent, INK.teal)
  block(2, `${MONITORS.params.etco2} ${MONITORS.params.co2}`, held || !vent ? '--' : String(v.etco2), MONITORS.units.mmHg, INK.amber)
  block(3, copy.paw, held || !vent ? '--' : `${v.peak}/${PEEP}`, copy.pawUnit, INK.text)
  // the pressure and the rate beside them, small
  put(c, `${MONITORS.params.nibp} ${v.sys}/${v.dia} (${v.map}) ${MONITORS.units.mmHg}`, pad, h - 8, 12, INK.text, 600)
  put(c, `${MONITORS.params.awrr} ${held || !vent ? '--' : Math.round(v.rr)}`, w - pad, h - 8, 12, INK.dim, 600, 'right')
  const status = !vent ? copy.spontaneous : held ? copy.paused : copy.running
  put(c, status, w * 0.5, 19, 11, !vent ? INK.dim : held ? INK.amber : INK.green, 600, 'center')
  simulatedTag(c, w)
}
