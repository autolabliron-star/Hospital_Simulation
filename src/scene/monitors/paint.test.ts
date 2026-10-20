/**
 * The painters on a recording canvas: every static of every layout paints with and without a patient (the words from monitors.json, the patient's
 * name, "Simulated", never an alarm word); a slot chunk clears and clips to its own columns and strokes its trace; the label slot carries the label.
 */
import { describe, expect, it } from 'vitest'
import { ALARM_WORDS, MONITORS } from '@/content/monitors'
import { extendBeats, extendBreaths, startBeats, startBreaths, TimeRing } from './beats'
import { LAYOUTS, waveLabel, type WaveKind } from './layouts'
import { newRowNumbers, paintIdleFace, paintStatic, stationBeds, type FaceData } from './paintFace'
import { paintLabelSlot, paintSlotChunk, traceY, type WaveSource } from './paintSlot'
import { recCtx } from './testkit'
import { newVitals } from './vitals'
import { lookFor } from './waves'

function row(name = 'Rosa Lindgren') {
  const r = newRowNumbers()
  Object.assign(r, { name, hr: 72, spo2: 97, rr: 14, temp: 36.7, nibpEvery: 15, art: true, artSys: 121, artDia: 68, co2: true, etco2: 37, ventilated: true })
  Object.assign(r.nibp, { has: true, sys: 118, dia: 72, map: 87, at: 3600, n: 2 })
  return r
}

function source(): WaveSource {
  const beats = new TimeRing(256)
  const breaths = new TimeRing(64)
  startBeats(beats, 9, -30, { hr: 72, rsa: 0.03, breathPeriod: 4, jitter: 0.01 })
  extendBeats(beats, 9, 30, { hr: 72, rsa: 0.03, breathPeriod: 4, jitter: 0.01 })
  startBreaths(breaths, 9, -30, { rr: 14, jitter: 0 })
  extendBreaths(breaths, 9, 60, { rr: 14, jitter: 0 })
  return { beats, breaths, look: lookFor(9), vit: newVitals() }
}

describe('the face painters', () => {
  it('paint every static of every layout, with a patient and without, in the copy\'s words and never an alarm word', () => {
    for (const layout of Object.values(LAYOUTS)) {
      for (const who of [row(), null]) {
        const rec = recCtx()
        const d: FaceData = { layout, bed: 'ER 3', rowBeds: stationBeds(), simT: 3600, rows: Array.from({ length: layout.rows }, () => who) }
        for (const s of layout.statics) paintStatic(rec.ctx, 10, 20, s, d)
        expect(rec.count('save')).toBe(rec.count('restore'))
        expect(rec.texts.length).toBeGreaterThan(0)
        for (const t of rec.texts) expect(t).not.toMatch(ALARM_WORDS)
        if (layout.id !== 'station') {
          expect(rec.texts).toContain('ER 3')
          expect(rec.texts).toContain(MONITORS.simulated)
        }
        if (who) {
          const all = rec.texts.join(' ')
          expect(all).toMatch(/Rosa|Lindgren/)
          expect(all).toContain(layout.id === 'triage' ? MONITORS.params.pr : MONITORS.params.hr)
          expect(all).toContain('118/72')
        } else {
          expect(rec.texts.join(' ')).not.toMatch(/Rosa/)
        }
      }
    }
  })

  it('the theatre monitor shows the arterial line and the CO2 with the ventilator\'s rate', () => {
    const rec = recCtx()
    const d: FaceData = { layout: LAYOUTS.or, bed: MONITORS.beds.or, rowBeds: [], simT: 3600, rows: [row()] }
    for (const s of LAYOUTS.or.statics) paintStatic(rec.ctx, 0, 0, s, d)
    expect(rec.texts).toContain(MONITORS.params.art)
    expect(rec.texts).toContain('121/68')
    expect(rec.texts).toContain(MONITORS.params.co2)
    expect(rec.texts).toContain('37')
    expect(rec.texts.join(' ')).toContain(MONITORS.params.awrr)
  })

  it('paints a standby face for every layout, "Standby" on the single-patient ones', () => {
    for (const layout of Object.values(LAYOUTS)) {
      const rec = recCtx()
      paintIdleFace(rec.ctx, 0, 0, layout, stationBeds())
      expect(rec.count('save')).toBe(rec.count('restore'))
      if (layout.rows === 1) expect(rec.texts).toContain(MONITORS.standby)
      else expect(rec.texts).toContain(MONITORS.station.empty)
    }
  })
})

describe('the slot painters', () => {
  it('a chunk clears and clips to its own columns, strokes one trace, and draws the label only when it reaches the label', () => {
    const src = source()
    for (const wave of ['ecg', 'ecgV', 'pleth', 'art', 'co2', 'resp'] as WaveKind[]) {
      const rec = recCtx()
      paintSlotChunk(rec.ctx, 100, 50, 256, 78, 44, wave, src, 0, 6, 120, 141)
      expect(rec.count('clip')).toBe(1)
      expect(rec.count('stroke')).toBe(1)
      expect(rec.texts).toEqual([])
      expect(rec.count('lineTo')).toBeGreaterThan(20)
      const head = recCtx()
      paintSlotChunk(head.ctx, 100, 50, 256, 78, 44, wave, src, 0, 6, 0, 30)
      expect(head.texts[0]).toBe(waveLabel(wave))
    }
    const none = recCtx()
    paintSlotChunk(none.ctx, 0, 0, 256, 78, 44, 'ecg', src, 0, 6, 50, 50)
    expect(none.calls).toEqual([])
  })

  it('every trace stays inside its band', () => {
    const src = source()
    for (const wave of ['ecg', 'ecgV', 'pleth', 'art', 'co2', 'resp'] as WaveKind[]) {
      for (const h of [36, 55, 78, 117]) {
        for (let t = 0; t < 20; t += 0.011) {
          const y = traceY(wave, t, h, src)
          expect(y).toBeGreaterThanOrEqual(2)
          expect(y).toBeLessThanOrEqual(h - 2)
        }
      }
    }
  })

  it('the label slot is blank with the label on it', () => {
    const rec = recCtx()
    paintLabelSlot(rec.ctx, 0, 0, 50, 78, 'art')
    expect(rec.texts[0]).toBe(MONITORS.waves.art)
    expect(rec.count('fillRect')).toBe(1)
  })
})
