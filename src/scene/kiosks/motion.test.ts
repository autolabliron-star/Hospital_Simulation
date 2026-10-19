/**
 * The state-to-light maths of the health kiosks, phase by phase: the levels each phase asks for, the periodic parts, the digits and the five segments of
 * the printed slip. Pure functions: no three.js, no DOM.
 */
import { describe, expect, it } from 'vitest'
import type { HealthKioskPhase, HealthKioskState, VitalsReading } from '@/sim/types'
import { PING_RINGS, SLIP_SEGMENTS } from './geometry'
import { BEAM_ALPHA, PING_HZ, SLIP_PRINT_SHARE, digitValue, digitsLit, levelsInto, newLevels, pingLevel, qrFlicker, slipAlpha, type KioskLevels } from './motion'

const PHASES: HealthKioskPhase[] = ['idle', 'calling', 'login', 'height', 'weight', 'bodyFat', 'sit', 'spo2', 'bp', 'bpRest', 'temp', 'report']

function reading(over: Partial<VitalsReading> = {}): VitalsReading {
  return { id: 'r1', personId: 'p1', personName: 'Test Patient', at: 0, source: 'kiosk', station: 0, sys: null, dia: null, pulse: null, spo2: null, tempC: null, heightCm: null, weightKg: null, bmi: null, bodyFatPct: null, bp: [], partial: true, ...over }
}

function kiosk(phase: HealthKioskPhase, over: Partial<HealthKioskState> = {}): HealthKioskState {
  const busy = phase !== 'idle'
  return { index: 0, phase, phaseTime: 0, progress: 0, kind: busy ? 'full' : null, userId: busy ? 'p1' : null, userName: busy ? 'Test Patient' : null, bpRound: 0, cuff: 0, reading: busy ? reading() : null, assisted: false, sessionsToday: 0, version: 1, ...over }
}

/** The levels of a state, sampled at 1/60 s steps over a second (the lights that pulse are checked over the whole second). */
function sampled(k: HealthKioskState, t0 = 0): KioskLevels[] {
  const out: KioskLevels[] = []
  for (let i = 0; i < 60; i++) {
    const l = newLevels()
    levelsInto(l, k, t0 + i / 60)
    out.push(l)
  }
  return out
}
const range = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)]

describe('every phase', () => {
  it('writes every level, so nothing is left over from the phase before', () => {
    const shared = newLevels()
    for (const p of PHASES) {
      const k = kiosk(p, { progress: 0.4, cuff: p === 'bp' ? 0.5 : 0, reading: kiosk(p).reading })
      levelsInto(shared, k, 3.3)
      const fresh = newLevels()
      levelsInto(fresh, k, 3.3)
      expect(Array.from(shared.ping), p).toEqual(Array.from(fresh.ping))
      for (const key of Object.keys(fresh) as (keyof KioskLevels)[]) if (key !== 'ping') expect(shared[key], `${p}.${key}`).toBe(fresh[key])
    }
  })

  it('keeps every level in its range', () => {
    for (const p of PHASES) {
      for (const l of sampled(kiosk(p, { progress: 0.6, cuff: 0.7 }))) {
        expect(l.led).toBeGreaterThanOrEqual(0)
        expect(l.led).toBeLessThanOrEqual(1)
        expect(l.ledGain).toBeGreaterThan(0)
        expect(l.ledGain).toBeLessThan(2.5)
        expect(l.beam).toBeGreaterThanOrEqual(0)
        expect(l.beam).toBeLessThanOrEqual(BEAM_ALPHA)
        for (const r of l.ping) {
          expect(r).toBeGreaterThanOrEqual(0)
          expect(r).toBeLessThanOrEqual(1)
        }
        for (const v of [l.digits, l.grips, l.clip, l.cuffAmber, l.cuffGreen, l.face, l.ir, l.qr, l.bpLed]) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
        }
        expect(l.slip).toBeGreaterThanOrEqual(0)
        expect(l.slip).toBeLessThanOrEqual(SLIP_SEGMENTS)
        expect(l.cuffGain).toBeGreaterThan(0)
        expect(l.cuffGain).toBeLessThan(2.5)
      }
    }
  })
})

describe('status LED', () => {
  it('is green and breathing when free, blue when somebody uses it, pulsing while they are called, steady green for the report', () => {
    const idle = sampled(kiosk('idle'))
    expect(idle.every((l) => l.led === 0)).toBe(true)
    const [lo, hi] = range(idle.map((l) => l.ledGain))
    expect(hi - lo).toBeGreaterThan(0.05) // it breathes
    expect(hi).toBeLessThan(1)
    for (const p of ['login', 'height', 'weight', 'bodyFat', 'sit', 'spo2', 'bp', 'bpRest', 'temp'] as HealthKioskPhase[]) {
      expect(sampled(kiosk(p)).every((l) => l.led === 1), p).toBe(true)
    }
    const calling = sampled(kiosk('calling'))
    expect(calling.every((l) => l.led === 1)).toBe(true)
    const [clo, chi] = range(calling.map((l) => l.ledGain))
    expect(chi - clo).toBeGreaterThan(0.6) // a clear pulse
    const report = sampled(kiosk('report', { progress: 0.5 }))
    expect(report.every((l) => l.led === 0)).toBe(true)
    expect(report.every((l) => l.ledGain === report[0].ledGain)).toBe(true)
  })
})

describe('login: the QR window', () => {
  it('flickers between dim and lit while the code is scanned, and only glows faintly when free', () => {
    const values = new Set<number>()
    for (let i = 0; i < 600; i++) values.add(qrFlicker(i / 600))
    expect([...values].sort()).toEqual([0.3, 1])
    const login = sampled(kiosk('login')).map((l) => l.qr)
    expect(Math.min(...login)).toBe(0.3)
    expect(Math.max(...login)).toBe(1)
    const idle = sampled(kiosk('idle')).map((l) => l.qr)
    expect(Math.max(...idle)).toBeLessThan(0.3)
    expect(sampled(kiosk('height')).every((l) => l.qr === 0)).toBe(true)
  })
})

describe('height: the ultrasonic ping', () => {
  it('shows a faint beam and rings that travel down it, in this phase only', () => {
    const h = sampled(kiosk('height', { progress: 0.5 }))
    expect(Math.max(...h.map((l) => l.beam))).toBeGreaterThan(0.08)
    expect(Math.max(...h.map((l) => l.beam))).toBeLessThanOrEqual(BEAM_ALPHA)
    for (let r = 0; r < PING_RINGS; r++) expect(Math.max(...h.map((l) => l.ping[r])), `ring ${r}`).toBeGreaterThan(0.95)
    // the wave runs downward: within one period ring 0 (the top) peaks first, then ring 1, then ring 2
    const peak = (r: number): number => {
      let best = 0
      let at = 0
      for (let i = 0; i < 1000; i++) {
        const v = pingLevel(i / 1000 / PING_HZ, r)
        if (v > best) {
          best = v
          at = i
        }
      }
      return at
    }
    expect(peak(0)).toBeLessThan(peak(1))
    expect(peak(1)).toBeLessThan(peak(2))
    for (const p of PHASES.filter((p) => p !== 'height')) {
      for (const l of sampled(kiosk(p))) {
        expect(l.beam, p).toBe(0)
        expect(Array.from(l.ping), p).toEqual([0, 0, 0])
      }
    }
  })

  it('pingLevel is periodic at PING_HZ and staggers the rings', () => {
    for (let r = 0; r < PING_RINGS; r++) expect(pingLevel(0.3, r)).toBeCloseTo(pingLevel(0.3 + 1 / PING_HZ, r), 9)
    expect(pingLevel(0.3, 0)).not.toBeCloseTo(pingLevel(0.3, 2), 3)
  })
})

describe('weight and body fat: the LED digits', () => {
  it('show dashes (blinking) while weighing, the weight once it is known during the body-fat step, and are off otherwise', () => {
    const weighing = sampled(kiosk('weight'))
    expect(weighing.every((l) => l.digitValue === -1 && l.digits > 0.5)).toBe(true)
    expect(range(weighing.map((l) => l.digits))[1] - range(weighing.map((l) => l.digits))[0]).toBeGreaterThan(0.2) // blinks
    const fat = kiosk('bodyFat', { reading: reading({ weightKg: 71.43 }) })
    expect(digitsLit(fat)).toBe(true)
    expect(digitValue(fat)).toBe(714)
    expect(sampled(fat).every((l) => l.digitValue === 714 && l.digits === 1)).toBe(true)
    // not yet known: dashes; clamped to 3 digits
    expect(digitValue(kiosk('bodyFat'))).toBe(-1)
    expect(digitValue(kiosk('bodyFat', { reading: reading({ weightKg: 250 }) }))).toBe(999)
    expect(digitValue(kiosk('weight', { reading: reading({ weightKg: 70 }) }))).toBe(-1)
    for (const p of PHASES.filter((p) => p !== 'weight' && p !== 'bodyFat')) {
      expect(digitsLit(kiosk(p)), p).toBe(false)
      expect(sampled(kiosk(p)).every((l) => l.digits === 0), p).toBe(true)
    }
  })
})

describe('body fat: the grips', () => {
  it('glow with a soft breathing blue while the hands are on them', () => {
    const [lo, hi] = range(sampled(kiosk('bodyFat')).map((l) => l.grips))
    expect(lo).toBeGreaterThanOrEqual(0.55)
    expect(hi).toBeLessThanOrEqual(1)
    expect(hi - lo).toBeGreaterThan(0.3)
    expect(sampled(kiosk('weight')).every((l) => l.grips === 0)).toBe(true)
  })
})

describe('SpO2: the finger clip', () => {
  it('pulses red at about the pulse rate, in the spo2 phase only', () => {
    const [lo, hi] = range(sampled(kiosk('spo2')).map((l) => l.clip))
    expect(lo).toBeLessThan(0.35)
    expect(hi).toBeGreaterThan(0.95)
    for (const p of PHASES.filter((p) => p !== 'spo2')) expect(sampled(kiosk(p)).every((l) => l.clip === 0), p).toBe(true)
  })
})

describe('blood pressure: the cuff ring', () => {
  it('is teal at rest, turns amber as the cuff inflates (with kiosk.cuff), and green when the reading is done', () => {
    const rest = levelsInto(newLevels(), kiosk('idle'), 0)
    expect(rest.cuffAmber).toBe(0)
    expect(rest.cuffGreen).toBe(0)
    let last = -1
    let lastGain = 0
    for (const cuff of [0, 0.1, 0.2, 0.4, 0.7, 1]) {
      const l = levelsInto(newLevels(), kiosk('bp', { cuff, progress: cuff * 0.5 }), 0)
      expect(l.cuffAmber).toBeGreaterThanOrEqual(last)
      expect(l.cuffGain).toBeGreaterThanOrEqual(lastGain - 0.2)
      last = l.cuffAmber
      lastGain = l.cuffGain
      expect(l.cuffGreen).toBe(0)
    }
    expect(levelsInto(newLevels(), kiosk('bp', { cuff: 0 }), 0).cuffAmber).toBe(0)
    expect(levelsInto(newLevels(), kiosk('bp', { cuff: 1 }), 0).cuffAmber).toBe(1)
    const done = levelsInto(newLevels(), kiosk('bpRest'), 0)
    expect(done.cuffGreen).toBe(1)
    expect(done.cuffAmber).toBe(0)
    // seated, before the cuff: teal, a little brighter than when free
    expect(levelsInto(newLevels(), kiosk('spo2'), 0).cuffGain).toBeGreaterThan(levelsInto(newLevels(), kiosk('idle'), 0).cuffGain)
  })

  it('lights the BP unit\'s status strip while somebody is seated', () => {
    for (const p of ['sit', 'spo2', 'bp', 'bpRest'] as HealthKioskPhase[]) expect(levelsInto(newLevels(), kiosk(p), 0).bpLed, p).toBeGreaterThan(0.8)
    expect(levelsInto(newLevels(), kiosk('idle'), 0).bpLed).toBeLessThan(0.2)
  })
})

describe('temperature: the camera', () => {
  it('shows the green face ring and a pulsing red infrared dot, in the temp phase only', () => {
    const t = sampled(kiosk('temp'))
    expect(t.every((l) => l.face === 1)).toBe(true)
    const [lo, hi] = range(t.map((l) => l.ir))
    expect(hi).toBeGreaterThan(0.95)
    expect(lo).toBeLessThan(0.45)
    for (const p of PHASES.filter((p) => p !== 'temp')) {
      for (const l of sampled(kiosk(p))) {
        expect(l.face, p).toBe(0)
        expect(l.ir, p).toBe(0)
      }
    }
  })
})

describe('report: the paper slip', () => {
  it('grows out of the slot one segment at a time over the first 70% of the phase, five in all', () => {
    const at = (progress: number): number => levelsInto(newLevels(), kiosk('report', { progress }), 0).slip
    expect(at(0)).toBe(0)
    expect(at(SLIP_PRINT_SHARE / 5)).toBeCloseTo(1, 9)
    expect(at(SLIP_PRINT_SHARE * 0.5)).toBeCloseTo(2.5, 9)
    expect(at(SLIP_PRINT_SHARE)).toBeCloseTo(5, 9)
    expect(at(1)).toBe(SLIP_SEGMENTS)
    expect(SLIP_SEGMENTS).toBe(5)
    let last = -1
    for (let p = 0; p <= 1; p += 0.01) {
      const s = at(p)
      expect(s).toBeGreaterThanOrEqual(last)
      last = s
    }
    for (const ph of PHASES.filter((p) => p !== 'report')) expect(sampled(kiosk(ph)).every((l) => l.slip === 0), ph).toBe(true)
  })

  it('segment n has its alpha 0 until the slip reaches it and 1 once it is out', () => {
    expect(slipAlpha(0, 0)).toBe(0)
    expect(slipAlpha(0.5, 0)).toBeCloseTo(0.5, 9)
    expect(slipAlpha(2.5, 0)).toBe(1)
    expect(slipAlpha(2.5, 2)).toBeCloseTo(0.5, 9)
    expect(slipAlpha(2.5, 3)).toBe(0)
    expect(slipAlpha(5, 4)).toBe(1)
  })
})
