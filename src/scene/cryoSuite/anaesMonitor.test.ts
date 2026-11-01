/**
 * R5 wave 3: the anaesthesia machine's monitor in node. In use only for a lung or liver case with the patient connected; standby otherwise (the kidney: the
 * nurse sedates it, no machine in use). The ventilation traces (the capnogram and the airway pressure) go FLAT while `state.apnoea` is true and resume when it
 * ends; the heart's traces go on. Probed as pure waveforms and, on a software canvas, pixel by pixel. Never an alarm word, never red.
 */
import { describe, expect, it } from 'vitest'
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import { ALARM_WORDS, MONITORS } from '@/content/monitors'
import { CRYO_STEPS, type CryoStep } from '@/sim/types'
import { anaesInUse, ventilated } from './anaesInUse'
import {
  breathOrigin,
  co2Frac,
  ecgFrac,
  heldAt,
  INSPIRE_S,
  newMonitorMemory,
  observeMonitor,
  paintAnaesMonitor,
  PEEP,
  pawFrac,
  pulseFrac,
  STRIP_S,
  vitalsFor,
  VENT_BREATH_S,
  type MonitorMemory,
} from './anaesMonitor'
import { rasterSurface, redPixels, type RasterSurface } from './rasterTestkit'
import { anaesState, cryoState } from './testkit'

const W = 394
const H = 256

describe('when the machine is in use', () => {
  it('only for a lung or liver case with the patient connected, from the step the monitors go on to the one before the patient leaves', () => {
    for (const step of CRYO_STEPS) {
      const want = CRYO_STEPS.indexOf(step) >= CRYO_STEPS.indexOf('sedation') && CRYO_STEPS.indexOf(step) <= CRYO_STEPS.indexOf('dressing')
      expect(anaesInUse(anaesState({ step: step as CryoStep })), `lung ${step}`).toBe(want)
      expect(anaesInUse(anaesState({ step: step as CryoStep, target: 'liver' })), `liver ${step}`).toBe(want)
    }
    // the kidney's nurse sedation has no machine in use, whatever the airway
    expect(anaesInUse(anaesState({ target: 'kidney' }))).toBe(false)
    expect(anaesInUse(cryoState({ step: 'freeze1' }))).toBe(false)
    // a lung case not yet connected (no airway), or between cases (no script), is standby
    expect(anaesInUse(anaesState({ airway: 'none' }))).toBe(false)
    const between = anaesState()
    between.procedure.procedureId = null
    expect(anaesInUse(between)).toBe(false)
    expect(anaesInUse(anaesState({ airway: 'nasalCannula', awareness: 'awake' }))).toBe(true)
  })

  it('the machine ventilates through a tube, or a mask while the patient is asleep; the cannula is the patient breathing alone', () => {
    expect(ventilated(anaesState({ airway: 'tube' }))).toBe(true)
    expect(ventilated(anaesState({ airway: 'oxygenMask', awareness: 'asleep' }))).toBe(true)
    expect(ventilated(anaesState({ airway: 'oxygenMask', awareness: 'awake' }))).toBe(false)
    expect(ventilated(anaesState({ airway: 'nasalCannula', awareness: 'sedated' }))).toBe(false)
  })
})

describe('the numbers', () => {
  it('are synthetic, steady for a patient (the same seed, the same numbers) and in the ranges of a resting adult', () => {
    for (let seed = 0; seed < 200; seed++) {
      const v = vitalsFor(seed * 7919 + 13)
      expect(v).toEqual(vitalsFor(seed * 7919 + 13))
      expect(v.hr).toBeGreaterThanOrEqual(62)
      expect(v.hr).toBeLessThanOrEqual(75)
      expect([98, 99]).toContain(v.spo2)
      expect(v.sys).toBeGreaterThan(v.dia)
      expect(v.map).toBeGreaterThan(v.dia - 1)
      expect(v.map).toBeLessThan(v.sys)
      expect(v.etco2).toBeGreaterThanOrEqual(34)
      expect(v.etco2).toBeLessThanOrEqual(38)
      expect(v.rr).toBeCloseTo(12, 9)
      expect(v.peak).toBeGreaterThan(PEEP + 8)
    }
    expect(new Set(Array.from({ length: 50 }, (_, i) => vitalsFor(i * 31 + 5).hr)).size).toBeGreaterThan(3)
  })
})

/** A memory that watched 20 s of breathing, a held breath from 20 s to 32 s, and 3 s of breathing again. */
function remembered(): MonitorMemory {
  const m = newMonitorMemory()
  const run = anaesState()
  const held = anaesState({ apnoea: true })
  for (let t = 0; t < 20; t += 0.25) observeMonitor(m, run, t)
  for (let t = 20; t < 32; t += 0.25) observeMonitor(m, held, t)
  for (let t = 32; t <= 35; t += 0.25) observeMonitor(m, run, t)
  return m
}

describe('the held breath', () => {
  const v = vitalsFor(4242)
  const samples = (from: number, to: number, f: (t: number) => number, step = 0.05): number[] => {
    const out: number[] = []
    for (let t = from; t < to; t += step) out.push(f(t))
    return out
  }
  const span = (a: number[]): number => Math.max(...a) - Math.min(...a)

  it('records when the flag flips: one hold per apnoea, its start and its end (and nothing while the flag stays)', () => {
    const m = newMonitorMemory()
    const run = anaesState()
    const held = anaesState({ apnoea: true })
    expect(heldAt(m, 5)).toBe(false)
    observeMonitor(m, run, 1)
    observeMonitor(m, held, 20.1)
    const snapshot = Array.from(m.holds)
    observeMonitor(m, held, 22)
    observeMonitor(m, held, 25)
    expect(Array.from(m.holds)).toEqual(snapshot)
    expect(heldAt(m, 19.9)).toBe(false)
    expect(heldAt(m, 20.1)).toBe(true)
    expect(heldAt(m, 1000)).toBe(true)
    observeMonitor(m, run, 31.9)
    expect(heldAt(m, 31.8)).toBe(true)
    expect(heldAt(m, 31.9)).toBe(false)
    expect(heldAt(m, 40)).toBe(false)
    expect(breathOrigin(m, 31.8)).toBe(0)
    expect(breathOrigin(m, 40)).toBe(31.9)
    // more holds than it keeps: the oldest are forgotten, nothing breaks
    for (let k = 0; k < 9; k++) {
      observeMonitor(m, held, 100 + 10 * k)
      observeMonitor(m, run, 105 + 10 * k)
    }
    // (it keeps the last four: 150 to 185)
    expect(heldAt(m, 102)).toBe(false)
    expect(heldAt(m, 152)).toBe(true)
    expect(heldAt(m, 182)).toBe(true)
    expect(heldAt(m, 187)).toBe(false)
    expect(breathOrigin(m, 200)).toBe(185)
    expect(Array.from(m.holds).every((x) => typeof x === 'number')).toBe(true)
  })

  it('the capnogram and the airway pressure are FLAT for the whole hold (zero, and PEEP) and breathe before and after; the heart\'s traces go on', () => {
    const m = remembered()
    const co2 = (t: number) => co2Frac(t, m, v, VENT_BREATH_S)
    const paw = (t: number) => pawFrac(t, m, v, VENT_BREATH_S)
    // before: breathing (a wave up to the end-tidal value and back to zero, a pressure rise to the peak)
    expect(Math.max(...samples(8, 18, co2))).toBeGreaterThan(0.7)
    expect(Math.min(...samples(8, 18, co2))).toBe(0)
    expect(Math.max(...samples(8, 18, paw))).toBeGreaterThan((v.peak - 1) / 22)
    expect(span(samples(8, 18, paw))).toBeGreaterThan(0.3)
    // during: flat as a ruler
    expect(span(samples(20, 32, co2))).toBe(0)
    expect(samples(20, 32, co2)[0]).toBe(0)
    expect(span(samples(20, 32, paw))).toBe(0)
    expect(samples(20, 32, paw)[0]).toBeCloseTo(PEEP / 22, 12)
    // after: a first breath begins as the ventilator resumes (its breath in, then the wave of the breath out two seconds later)
    expect(co2(32.5)).toBe(0)
    expect(paw(32.6)).toBeGreaterThan((PEEP + 6) / 22)
    expect(co2(32 + INSPIRE_S + 0.8)).toBeGreaterThan(0.6)
    expect(Math.max(...samples(32, 35, co2))).toBeGreaterThan(0.6)
    // the heart goes on all through
    const hr = vitalsFor(4242).hr
    expect(span(samples(20, 32, (t) => ecgFrac(t, hr), 0.004))).toBeGreaterThan(0.5)
    expect(span(samples(20, 32, (t) => pulseFrac(t, hr)))).toBeGreaterThan(0.5)
  })

  it('without the memory of a hold the same moments breathe (so the flat line is the held breath\'s doing)', () => {
    const none = newMonitorMemory()
    expect(span(samples(20, 32, (t) => co2Frac(t, none, v, VENT_BREATH_S)))).toBeGreaterThan(0.7)
    expect(span(samples(20, 32, (t) => pawFrac(t, none, v, VENT_BREATH_S)))).toBeGreaterThan(0.3)
  })

  it('the strip is 8 seconds, newest at the right', () => {
    expect(STRIP_S).toBe(8)
  })
})

/** The mean y of the pixels near `rgb` in column x of rows [y0, y1), or NaN. */
function traceY(s: RasterSurface, x: number, y0: number, y1: number, rgb: readonly [number, number, number]): number {
  let sum = 0
  let n = 0
  for (let y = Math.floor(y0); y < y1; y++) {
    const p = s.at(x, y)
    if (Math.abs(p[0] - rgb[0]) < 26 && Math.abs(p[1] - rgb[1]) < 26 && Math.abs(p[2] - rgb[2]) < 26) {
      sum += y
      n++
    }
  }
  return n ? sum / n : Number.NaN
}
const AMBER = [240, 163, 58] as const
const PAW = [217, 228, 232] as const

describe('the monitor, painted', () => {
  const pad = 8
  const x1 = Math.round(W * 0.64)
  const top = 30
  const rowH = (H - top - 24) / 4
  const colOf = (t: number, tm: number): number => Math.round(pad + ((t - (tm - STRIP_S)) / STRIP_S) * (x1 - pad))
  const paint = (s = anaesState(), m = remembered(), tm = 35): RasterSurface => {
    const surf = rasterSurface(W, H)
    paintAnaesMonitor(surf.ctx, W, H, s, m, tm)
    return surf
  }

  it('the capnogram\'s and the pressure\'s pixels lie on one row all through the hold, and on many while breathing; flat on the screen the moment the flag flips', () => {
    const m = remembered()
    // the picture at 31 s: the strip spans 23..31, all of it inside the hold
    const held = paint(anaesState({ apnoea: true }), m, 31)
    const co2Rows: number[] = []
    const pawRows: number[] = []
    for (let x = pad + 3; x < x1 - 3; x += 4) {
      co2Rows.push(traceY(held, x, top + 2 * rowH, top + 3 * rowH - 2, AMBER))
      pawRows.push(traceY(held, x, top + 3 * rowH, top + 4 * rowH - 2, PAW))
    }
    expect(co2Rows.every((y) => Number.isFinite(y))).toBe(true)
    expect(Math.max(...co2Rows) - Math.min(...co2Rows)).toBeLessThanOrEqual(1)
    expect(Math.max(...pawRows) - Math.min(...pawRows)).toBeLessThanOrEqual(1)
    // the picture at 19 s (before the hold): the same traces swing across the row
    const run = paint(anaesState(), m, 19)
    const swing = (rows: number[]): number => Math.max(...rows.filter(Number.isFinite)) - Math.min(...rows.filter(Number.isFinite))
    const runCo2: number[] = []
    const runPaw: number[] = []
    for (let x = pad + 3; x < x1 - 3; x += 2) {
      runCo2.push(traceY(run, x, top + 2 * rowH, top + 3 * rowH - 2, AMBER))
      runPaw.push(traceY(run, x, top + 3 * rowH, top + 4 * rowH - 2, PAW))
    }
    expect(swing(runCo2)).toBeGreaterThan(25)
    expect(swing(runPaw)).toBeGreaterThan(20)
    // the heart's traces swing in the held picture too
    const ecgRows: number[] = []
    for (let x = pad + 3; x < x1 - 3; x += 2) ecgRows.push(traceY(held, x, top, top + rowH - 2, [69, 214, 138]))
    expect(swing(ecgRows)).toBeGreaterThan(8)
  })

  it('a hold that ended partway through the strip: flat from its start to its end, breathing again after, at the columns of those times', () => {
    const m = remembered()
    const pic = paint(anaesState(), m, 35)
    const at = (t0: number, t1: number): number[] => {
      const out: number[] = []
      for (let x = colOf(t0, 35) + 1; x < colOf(t1, 35) - 1; x += 2) out.push(traceY(pic, x, top + 2 * rowH, top + 3 * rowH - 2, AMBER))
      return out
    }
    const flat = at(27.2, 31.8)
    expect(flat.length).toBeGreaterThan(30)
    expect(Math.max(...flat) - Math.min(...flat)).toBeLessThanOrEqual(1)
    // the wave of the first breath after the hold (32 + 1.8 .. 35) lifts off the baseline
    const after = at(34.3, 35)
    expect(Math.min(...after.filter(Number.isFinite))).toBeLessThan(Math.max(...flat) - 20)
  })

  it('numbers and words: the breathing\'s numbers show "--" while held and the numbers otherwise; the status line says so', () => {
    const v = vitalsFor(4242)
    const run = paint(anaesState(), newMonitorMemory(), 10).texts
    expect(run).toContain(String(v.hr))
    expect(run).toContain(String(v.spo2))
    expect(run).toContain(String(v.etco2))
    expect(run).toContain(`${v.peak}/${PEEP}`)
    expect(run).toContain(CRYO_SUITE_COPY.monitor.running)
    expect(run).not.toContain('--')
    const m = remembered()
    const held = paint(anaesState({ apnoea: true }), m, 31).texts
    expect(held).toContain(String(v.hr))
    // (the end-tidal CO2 and the airway pressure; the breath rate's line says it too)
    expect(held.filter((t) => t === '--')).toHaveLength(2)
    expect(held.join('|')).toContain(`${MONITORS.params.awrr} --`)
    expect(held).not.toContain(String(v.etco2))
    expect(held).toContain(CRYO_SUITE_COPY.monitor.paused)
    expect(held).not.toContain(CRYO_SUITE_COPY.monitor.running)
    // the pressure, always
    expect(run.join('|')).toMatch(new RegExp(`${MONITORS.params.nibp} ${v.sys}/${v.dia} \\(${v.map}\\)`))
    expect(run).toContain(CRYO_SUITE_COPY.panel.tag)
  })

  it('a patient breathing alone (the cannula): the capnogram from the cannula, no airway pressure, no ventilator line', () => {
    const s = anaesState({ airway: 'nasalCannula', awareness: 'sedated' })
    const pic = paint(s, newMonitorMemory(), 12)
    expect(pic.texts).toContain(CRYO_SUITE_COPY.monitor.spontaneous)
    expect(pic.texts).not.toContain(CRYO_SUITE_COPY.monitor.running)
    // the pressure row is one flat line
    const rows: number[] = []
    for (let x = pad + 3; x < x1 - 3; x += 4) rows.push(traceY(pic, x, top + 3 * rowH, top + 4 * rowH - 2, PAW))
    expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(1)
    // the capnogram breathes
    const co2: number[] = []
    for (let x = pad + 3; x < x1 - 3; x += 2) co2.push(traceY(pic, x, top + 2 * rowH, top + 3 * rowH - 2, AMBER))
    expect(Math.max(...co2.filter(Number.isFinite)) - Math.min(...co2.filter(Number.isFinite))).toBeGreaterThan(25)
  })

  it('standby (the kidney, the machine between cases): "Standby" and "No patient connected", a flat line, no traces', () => {
    for (const s of [cryoState({ step: 'freeze1' }), anaesState({ airway: 'none' }), anaesState({ target: 'kidney' })]) {
      const pic = paint(s, newMonitorMemory(), 12)
      expect(pic.texts).toContain(MONITORS.standby)
      expect(pic.texts).toContain(MONITORS.standbyNote)
      expect(pic.texts).toContain(CRYO_SUITE_COPY.panel.tag)
      expect(pic.texts).not.toContain(String(vitalsFor(s.imageSeed).hr))
      // none of the trace colours anywhere (the ECG's green, the pulse's teal, the capnogram's amber)
      let traces = 0
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = pic.at(x, y)
          if (p[1] > p[0] + 60 || (p[0] > 200 && p[1] > 120 && p[2] < 100)) traces++
        }
      }
      expect(traces).toBe(0)
    }
  })

  it('never an alarm word or a NaN, never red, in any state, at the tile\'s size and others', () => {
    const states = [anaesState(), anaesState({ apnoea: true }), anaesState({ airway: 'nasalCannula', awareness: 'sedated' }), anaesState({ airway: 'none' }), cryoState()]
    const m = remembered()
    for (const s of states) {
      for (const [w, h] of [[W, H], [300, 200], [520, 256]]) {
        const surf = rasterSurface(w, h)
        paintAnaesMonitor(surf.ctx, w, h, s, m, 31)
        for (const t of surf.texts) {
          expect(ALARM_WORDS.test(t), t).toBe(false)
          expect(t).not.toMatch(/NaN|undefined/)
        }
        expect(redPixels(surf)).toBe(0)
      }
    }
  })
})
