/**
 * R3 live patient monitors: painting the traces. A sweep slot is one band's picture of one sweep (layouts.ts SWEEP seconds of trace, left to right);
 * the pump (hub.ts) paints it in CHUNKS of columns, each only where the screen does not show that slot at the moment (sweep.ts), into the staging
 * sheet, and copies the chunk into the atlas. Every chunk clears its columns and draws the trace a little past both edges with the chunk clipped, so
 * the chunks join without a seam. The label slot is the band's label on a blank strip (under the erase bar).
 *
 * Pure canvas-2D calls on a `Ctx2D` (the node tests run them on a recording mock). The traces come from waves.ts.
 */
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import type { TimeRing } from './beats'
import { COLOUR, waveLabel, type WaveKind } from './layouts'
import type { VitalsNow } from './vitals'
import { capnoAt, ecgAt, pulseAt, respAt, type WaveLook } from './waves'

export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** What a trace is drawn from: the patient's beats and breaths, their look, and the current targets (the arterial pressures, the CO2). */
export interface WaveSource {
  beats: TimeRing
  breaths: TimeRing
  look: WaveLook
  vit: VitalsNow
}

/** Full scale of the arterial line and the capnogram (mmHg). */
export const ART_SCALE = 160
export const CO2_SCALE = 50

/** The y (band pixels) of a wave's value at display time `t` in a band `h` tall. Allocation-free. */
export function traceY(wave: WaveKind, t: number, h: number, src: WaveSource): number {
  let y: number
  switch (wave) {
    case 'ecg':
    case 'ecgV': {
      const v = ecgAt(t, src.beats, src.breaths, src.look, wave === 'ecgV' ? 1 : 0)
      y = h * 0.62 - v * ((h * 0.36) / 1.2)
      break
    }
    case 'pleth':
      y = h - 6 - pulseAt(t, src.beats, src.breaths, src.look, false) * (h - 20) * 0.9
      break
    case 'art': {
      const v = pulseAt(t, src.beats, src.breaths, src.look, true)
      const mm = src.vit.dia + (src.vit.sys - src.vit.dia) * v
      y = h - 4 - (mm / ART_SCALE) * (h - 10)
      break
    }
    case 'co2': {
      const mm = capnoAt(t, src.breaths, src.vit.etco2, src.vit.iFrac, src.look.seed)
      y = h - 4 - (mm / CO2_SCALE) * (h - 12)
      break
    }
    case 'resp':
      y = h * 0.82 - respAt(t, src.breaths, src.vit.iFrac, src.look.seed) * h * 0.55
      break
  }
  return y < 2 ? 2 : y > h - 2 ? h - 2 : y
}

/** The band's label (and, for the pressure traces, its scale) at the band's top-left, in band coordinates offset by (ox, oy). */
function paintLabel(c: Ctx2D, ox: number, oy: number, wave: WaveKind): void {
  c.font = `600 10px ${FONT}`
  c.textAlign = 'left'
  c.textBaseline = 'top'
  c.fillStyle = COLOUR[wave]
  c.fillText(waveLabel(wave), ox + 4, oy + 3)
  if (wave === 'art' || wave === 'co2') {
    c.font = `500 8px ${FONT}`
    c.globalAlpha = 0.75
    c.fillText(String(wave === 'art' ? ART_SCALE : CO2_SCALE), ox + 4, oy + 15)
    c.globalAlpha = 1
  }
}

/** The label slot: the blank strip under the erase bar, with the label where the band shows it. */
export function paintLabelSlot(c: Ctx2D, ox: number, oy: number, w: number, h: number, wave: WaveKind): void {
  c.save()
  c.beginPath()
  c.rect(ox, oy, w, h)
  c.clip()
  c.fillStyle = COLOUR.bg
  c.fillRect(ox, oy, w, h)
  paintLabel(c, ox, oy, wave)
  c.restore()
}

/** Sample spacing (band pixels): the ECG and the arterial line are sharp, so they are sampled at half pixels. */
const STEP: Record<WaveKind, number> = { ecg: 0.5, ecgV: 0.5, art: 0.5, pleth: 1, co2: 1, resp: 1 }

/**
 * Columns [x0, x1) of a sweep slot `w` x `h` whose column 0 is display time `t0` and which spans `period` seconds, painted at (ox, oy) of the sheet
 * (the slot's own (0, 0) is there; only the chunk's columns are touched). `labelW` is where the label ends.
 */
export function paintSlotChunk(
  c: Ctx2D,
  ox: number,
  oy: number,
  w: number,
  h: number,
  labelW: number,
  wave: WaveKind,
  src: WaveSource,
  t0: number,
  period: number,
  x0: number,
  x1: number,
): void {
  if (x1 <= x0) return
  c.save()
  c.beginPath()
  c.rect(ox + x0, oy, x1 - x0, h)
  c.clip()
  c.fillStyle = COLOUR.bg
  c.fillRect(ox + x0, oy, x1 - x0, h)
  if (x0 < labelW) paintLabel(c, ox, oy, wave)
  const step = STEP[wave]
  const a = Math.max(0, x0 - 2)
  const b = Math.min(w, x1 + 2)
  const colour = COLOUR[wave]
  if (wave === 'co2') {
    // the capnogram is filled under its line, faintly
    c.beginPath()
    c.moveTo(ox + a, oy + h - 4)
    for (let x = a; x <= b; x += step) c.lineTo(ox + x, oy + traceY(wave, t0 + (x / w) * period, h, src))
    c.lineTo(ox + b, oy + h - 4)
    c.closePath()
    c.globalAlpha = 0.18
    c.fillStyle = colour
    c.fill()
    c.globalAlpha = 1
  }
  c.beginPath()
  for (let x = a; x <= b; x += step) {
    const y = oy + traceY(wave, t0 + (x / w) * period, h, src)
    if (x === a) c.moveTo(ox + x, y)
    else c.lineTo(ox + x, y)
  }
  c.strokeStyle = colour
  c.lineWidth = wave === 'ecg' || wave === 'ecgV' ? 1.6 : 1.5
  c.lineJoin = 'round'
  c.lineCap = 'round'
  c.stroke()
  c.restore()
}
