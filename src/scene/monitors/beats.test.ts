/**
 * The beats, the breaths and the waveforms: the beat timing follows the rate with a little variability, the displayed HR is counted from the beats,
 * the generation is deterministic whatever the chunking; the morphology of every trace (PQRST, the pleth's dicrotic notch, the arterial line between
 * diastolic and systolic, the capnogram's baseline and plateau, the impedance trace).
 */
import { describe, expect, it } from 'vitest'
import { displayedHr, displayedRr, extendBeats, extendBreaths, rrInterval, startBeats, startBreaths, TimeRing, type BreathDrive, type HeartDrive } from './beats'
import { capnoAt, ecgAt, lookFor, pqrst, pulseAt, pulseShape, respAt } from './waves'

const heart = (hr: number, o: Partial<HeartDrive> = {}): HeartDrive => ({ hr, rsa: 0.03, breathPeriod: 4, jitter: 0.012, ...o })
const breath = (rr: number, jitter = 0.08): BreathDrive => ({ rr, jitter })

function beatsAt(seed: number, hr: number, until: number, chunks = 1): TimeRing {
  const r = new TimeRing(512)
  startBeats(r, seed, 0, heart(hr))
  for (let i = 1; i <= chunks; i++) extendBeats(r, seed, (until * i) / chunks, heart(hr))
  return r
}

function breathsAt(seed: number, rr: number, until: number, jitter = 0.08): TimeRing {
  const r = new TimeRing(128)
  startBreaths(r, seed, 0, breath(rr, jitter))
  extendBreaths(r, seed, until, breath(rr, jitter))
  return r
}

describe('the beats', () => {
  it('come at the rate asked, with a little variability, and the displayed HR is counted from them', () => {
    for (const hr of [52, 68, 90, 128]) {
      const r = beatsAt(11, hr, 120)
      const rrs: number[] = []
      for (let n = r.first + 1; n < r.end; n++) rrs.push(r.at(n) - r.at(n - 1))
      const mean = rrs.reduce((a, b) => a + b, 0) / rrs.length
      expect(60 / mean).toBeGreaterThan(hr * 0.97)
      expect(60 / mean).toBeLessThan(hr * 1.03)
      // variability: the RR intervals are not all the same, and never wild
      expect(Math.max(...rrs) - Math.min(...rrs)).toBeGreaterThan(0.01)
      for (const x of rrs) expect(Math.abs(x - 60 / hr)).toBeLessThan((60 / hr) * 0.12)
      expect(Math.abs(displayedHr(r, 60) - hr)).toBeLessThanOrEqual(4)
    }
  })

  it('are deterministic and do not depend on how the generation is cut into calls', () => {
    const a = beatsAt(5, 74, 90, 1)
    const b = beatsAt(5, 74, 90, 17)
    expect(a.count).toBe(b.count)
    for (let n = a.first; n < a.end; n++) expect(a.at(n)).toBe(b.at(n))
    const c = beatsAt(6, 74, 90, 1)
    expect(c.at(c.first + 3)).not.toBe(a.at(a.first + 3))
    expect(rrInterval(5, 9, 10, heart(74))).toBe(rrInterval(5, 9, 10, heart(74)))
  })

  it('keeps the last `cap` events and finds the beat at any time by binary search', () => {
    const r = new TimeRing(16)
    for (let i = 0; i < 40; i++) r.push(i * 0.8)
    expect(r.count).toBe(16)
    expect(r.first).toBe(24)
    expect(r.indexAt(30.0)).toBe(37)
    expect(r.indexAt(19.0)).toBe(23) // older than the ring: first - 1
    expect(r.indexAt(1000)).toBe(39)
    expect(r.rateAt(31.9, 8)).toBeCloseTo(75, 6)
  })

  it('breathes at the rate asked; a ventilator exactly', () => {
    const vent = breathsAt(3, 12, 120, 0)
    for (let n = vent.first + 1; n < vent.end; n++) expect(vent.at(n) - vent.at(n - 1)).toBeCloseTo(5, 9)
    expect(displayedRr(vent, 100)).toBe(12)
    const own = breathsAt(3, 16, 200)
    expect(Math.abs(displayedRr(own, 150) - 16)).toBeLessThanOrEqual(3)
  })
})

describe('the waveforms', () => {
  const look = lookFor(42)
  const beats = beatsAt(42, 70, 60)
  const breaths = breathsAt(42, 14, 60)

  it('ECG: the R wave is the tallest point of each beat, the P wave before it, the T wave after it, the S dip right after R', () => {
    const rr = 60 / 70
    let maxU = 0
    let maxV = -Infinity
    for (let u = -0.4; u <= 0.7; u += 0.001) {
      const v = pqrst(u, rr, look, 0)
      if (v > maxV) {
        maxV = v
        maxU = u
      }
    }
    expect(Math.abs(maxU)).toBeLessThan(0.003)
    expect(maxV).toBeCloseTo(look.r, 1)
    expect(pqrst(-0.165 * Math.sqrt(rr), rr, look, 0)).toBeGreaterThan(0.06) // P
    expect(pqrst(0.027, rr, look, 0)).toBeLessThan(0) // S
    expect(pqrst(0.27 * Math.sqrt(rr), rr, look, 0)).toBeGreaterThan(0.15) // T
    expect(pqrst(0.5 * rr + 0.2, rr, look, 0)).toBeLessThan(0.05) // the flat stretch before the next P
    // V5: a taller R
    expect(pqrst(0, rr, look, 1)).toBeGreaterThan(pqrst(0, rr, look, 0))
    // on the ring: a sample at every beat's R time is a peak
    for (let n = beats.first + 2; n < beats.end - 2; n++) {
      const t = beats.at(n)
      expect(ecgAt(t, beats, breaths, look, 0)).toBeGreaterThan(ecgAt(t + 0.05, beats, breaths, look, 0) + 0.5)
    }
  })

  it('pleth: a fast upstroke, a peak, then the dicrotic notch and the dicrotic wave on the way down, 0 where a beat ends and the next begins', () => {
    const period = 60 / 70
    const v = (u: number): number => pulseShape(u, period, 0.12, 0.34, 0.09)
    expect(v(0)).toBe(0)
    expect(v(period)).toBe(0)
    // the peak is right after the upstroke
    let peakU = 0
    for (let u = 0; u < period; u += 0.002) if (v(u) > v(peakU)) peakU = u
    expect(peakU).toBeGreaterThan(0.09)
    expect(peakU).toBeLessThan(0.18)
    // after the peak: a local minimum (the notch) followed by a local maximum (the dicrotic wave)
    let notch = -1
    let wave = -1
    for (let u = peakU + 0.02; u < period - 0.05; u += 0.002) {
      if (notch < 0 && v(u) < v(u - 0.002) && v(u) < v(u + 0.002)) notch = u
      else if (notch > 0 && wave < 0 && v(u) > v(u - 0.002) && v(u) > v(u + 0.002)) wave = u
    }
    expect(notch).toBeGreaterThan(0)
    expect(wave).toBeGreaterThan(notch)
    expect(wave - notch).toBeLessThan(0.12)
    // on the ring: inside 0..1, rising a pulse transit time after each R wave
    for (let t = 2; t < 55; t += 0.013) {
      const p = pulseAt(t, beats, breaths, look, false)
      expect(p).toBeGreaterThanOrEqual(-0.05)
      expect(p).toBeLessThanOrEqual(1.05)
    }
    const r = beats.at(beats.first + 5)
    expect(pulseAt(r + look.pttPleth + 0.13, beats, breaths, look, false)).toBeGreaterThan(pulseAt(r + look.pttPleth + 0.01, beats, breaths, look, false) + 0.4)
  })

  it('arterial line: the upstroke comes before the pleth\'s (a shorter transit time)', () => {
    expect(look.pttArt).toBeLessThan(look.pttPleth)
    const r = beats.at(beats.first + 6)
    const t = r + look.pttArt + 0.08
    expect(pulseAt(t, beats, breaths, look, true)).toBeGreaterThan(pulseAt(t, beats, breaths, look, false))
  })

  it('capnogram: 0 during inspiration, a steep rise once expiration starts, a plateau rising to the end-tidal value', () => {
    const vent = breathsAt(8, 12, 80, 0)
    const et = 38
    const iFrac = 0.33
    const a = vent.at(vent.first + 3)
    const period = 5
    expect(capnoAt(a + 0.5, vent, et, iFrac, 8)).toBe(0)
    expect(capnoAt(a + iFrac * period - 0.05, vent, et, iFrac, 8)).toBe(0)
    const plateauStart = capnoAt(a + iFrac * period + 0.6, vent, et, iFrac, 8)
    const plateauEnd = capnoAt(a + period - 0.02, vent, et, iFrac, 8)
    expect(plateauStart).toBeGreaterThan(et * 0.8)
    expect(plateauEnd).toBeGreaterThan(plateauStart)
    expect(Math.abs(plateauEnd - et)).toBeLessThan(1.5)
    // the inspiratory downstroke: at the next breath's start it falls back to 0 within a tenth of a second
    expect(capnoAt(a + period + 0.15, vent, et, iFrac, 8)).toBe(0)
  })

  it('respiration: rises over inspiration, falls over expiration, rests near 0 before the next breath', () => {
    const vent = breathsAt(8, 12, 80, 0)
    const a = vent.at(vent.first + 3)
    expect(respAt(a + 0.01, vent, 0.4, 8)).toBeLessThan(0.05)
    expect(respAt(a + 2.0, vent, 0.4, 8)).toBeGreaterThan(0.7)
    expect(respAt(a + 4.9, vent, 0.4, 8)).toBeLessThan(0.05)
  })
})
