/**
 * The health kiosks' sounds, in node: every voice is sane, the tracker starts the right sounds at the right edges (and nothing at load or in a quiet lobby),
 * the cuff's pump and hiss are periodic on the audio clock (consecutive windows join with no gap and no repeat), and the pattern plugs into the registry.
 */
import { describe, expect, it } from 'vitest'
import { HEALTH_KIOSKS } from '@/sim/places'
import type { HealthKioskPhase, HealthKioskState, VitalsReading } from '@/sim/types'
import {
  DEFAULT_PULSE,
  HISS_PERIOD_S,
  KIOSK_SOUNDS,
  KioskSoundTracker,
  PROMPT_PHASES,
  PUMP_PERIOD_S,
  createKioskPattern,
  deflationHiss,
  devicePatterns,
  doneBeep,
  kioskSoundAt,
  PRINT_DELAY_S,
  PRINT_S,
  PRINT_TICK_S,
  printerBurst,
  printerTick,
  printerWhirr,
  promptChime,
  pulseTick,
  pumpBuzz,
  settledBeeps,
  touchBeep,
} from './kioskPatterns'
import { registerDevicePattern, devicePatterns as registered, type DeviceEvent, type DroneSpec, type PatternSink, type PlanWindow } from './registry'

function state(index: number, phase: HealthKioskPhase, over: Partial<HealthKioskState> = {}): HealthKioskState {
  const busy = phase !== 'idle'
  return { index, phase, phaseTime: 0, progress: 0, kind: busy ? 'full' : null, userId: null, userName: null, bpRound: 0, cuff: 0, reading: null, assisted: false, sessionsToday: 0, version: 0, ...over }
}

function sink(): PatternSink & { events: DeviceEvent[]; drones: DroneSpec[] } {
  const events: DeviceEvent[] = []
  const drones: DroneSpec[] = []
  return { events, drones, event: (e) => events.push(e), drone: (d) => drones.push(d) }
}

const win = (from: number, to: number): PlanWindow => ({ from, to, now: from, simTime: 0, simSpeed: 1, listener: { x: 0, y: 1.6, z: 0 } })

/** A look at the kiosks at audio time `t` (a 50 ms window). */
function look(tr: KioskSoundTracker, ks: HealthKioskState[], t: number) {
  const s = sink()
  tr.step(ks, win(t, t + 0.05), s)
  return s
}

describe('the voices', () => {
  const all: DeviceEvent[] = [
    ...touchBeep(0),
    ...settledBeeps(0),
    ...promptChime(0),
    ...pumpBuzz(0),
    ...deflationHiss(0),
    ...pulseTick(0),
    ...doneBeep(0),
    ...printerBurst(0),
    ...printerBurst(1, 0.3, kioskSoundAt(0)),
  ]

  it('every event has finite, audible, polite numbers: a peak under 0.3, a positive duration, pitches between 90 Hz and 8 kHz', () => {
    for (const e of all) {
      expect(Number.isFinite(e.t)).toBe(true)
      expect(e.t).toBeGreaterThanOrEqual(0)
      expect(e.peak).toBeGreaterThan(0)
      expect(e.peak).toBeLessThanOrEqual(0.3)
      expect(e.dur).toBeGreaterThan(0)
      expect(e.f0).toBeGreaterThan(90)
      expect(e.f1).toBeLessThan(8000)
      expect(e.attack).toBeGreaterThanOrEqual(0)
      expect(e.attack).toBeLessThan(e.dur)
    }
  })

  it('beeps are tones, the pump is a low sawtooth buzz, the hiss and the printer are noise, the tick is a short click', () => {
    expect(touchBeep(0).every((e) => e.kind === 'tone')).toBe(true)
    expect(settledBeeps(0).length).toBe(2) // a DOUBLE beep
    expect(settledBeeps(0)[1].t).toBeGreaterThan(settledBeeps(0)[0].t)
    expect(promptChime(0).length).toBe(2)
    const buzz = pumpBuzz(0).find((e) => e.kind === 'tone')!
    expect(buzz.kind === 'tone' && buzz.wave).toBe('sawtooth')
    expect(buzz.f0).toBeLessThan(200)
    const hiss = deflationHiss(0)[0]
    expect(hiss.kind).toBe('noise')
    expect(hiss.f1).toBeLessThan(hiss.f0) // falls
    const tick = pulseTick(0)[0]
    expect(tick.kind).toBe('noise')
    expect(tick.dur).toBeLessThan(0.03)
    expect(doneBeep(0).length).toBe(2)
    expect(KIOSK_SOUNDS).toMatchObject({ touchBeep, settledBeeps, promptChime, pumpBuzz, deflationHiss, pulseTick, doneBeep, printerBurst })
  })

  it('the printer burst ticks all through its length, and a longer one has more ticks', () => {
    const p = printerBurst(2, 1.1)
    const ticks = p.filter((e) => e.kind === 'noise' && e.dur < 0.03)
    expect(ticks.length).toBeGreaterThan(15)
    expect(Math.max(...ticks.map((e) => e.t))).toBeLessThan(2 + 1.1)
    expect(printerBurst(0, 2.2).length).toBeGreaterThan(printerBurst(0, 1.1).length)
    expect(printerWhirr(0).length).toBe(1)
    expect(printerTick(0).length).toBe(1)
  })

  it('sounds come from the tower of their kiosk, chest high', () => {
    for (let i = 0; i < 2; i++) {
      const at = kioskSoundAt(i)
      expect(at.x).toBe(HEALTH_KIOSKS[i].tower.x)
      expect(at.y).toBe(1.2)
      expect(at.z).toBeLessThan(HEALTH_KIOSKS[i].tower.z)
    }
  })
})

describe('the tracker: edges', () => {
  it('learns at the first look: nothing starts at load, whatever the kiosks are doing', () => {
    const tr = new KioskSoundTracker()
    expect(look(tr, [state(0, 'bp', { cuff: 0.5 }), state(1, 'report')], 0).events).toEqual([])
    expect(look(tr, [state(0, 'bp', { cuff: 0.5 }), state(1, 'report')], 0.05).events).toEqual([])
  })

  it('a quiet lobby makes no events', () => {
    const tr = new KioskSoundTracker()
    for (let i = 0; i < 100; i++) expect(look(tr, [state(0, 'idle'), state(1, 'idle')], i * 0.05).events).toEqual([])
  })

  it('login: a touch beep; the step prompts: a chime; the weight is in: the double beep; the temperature is taken: a beep', () => {
    const tr = new KioskSoundTracker()
    const ks = [state(0, 'idle'), state(1, 'idle')]
    look(tr, ks, 0)
    ks[0] = state(0, 'login')
    const login = look(tr, ks, 0.05)
    expect(login.events.length).toBe(touchBeep(0).length)
    expect(login.events.every((e) => e.at && e.at.x === HEALTH_KIOSKS[0].tower.x)).toBe(true)
    ks[0] = state(0, 'height')
    expect(look(tr, ks, 0.1).events.length).toBe(promptChime(0).length)
    ks[0] = state(0, 'weight')
    expect(look(tr, ks, 0.15).events.length).toBe(0) // weighing: the scale is working, silently
    ks[0] = state(0, 'bodyFat')
    const settled = look(tr, ks, 0.2)
    expect(settled.events.length).toBe(settledBeeps(0).length + promptChime(0).length) // the double beep, and the handles prompt
    ks[0] = state(0, 'sit')
    expect(look(tr, ks, 0.25).events.length).toBe(promptChime(0).length)
    ks[0] = state(0, 'temp')
    expect(look(tr, ks, 0.3).events.length).toBe(promptChime(0).length)
    ks[0] = state(0, 'report')
    const report = look(tr, ks, 0.35)
    // leaving the temperature step beeps, the report is done, the printer's motor starts a moment later (its head ticks follow on the audio clock)
    expect(report.events.length).toBe(touchBeep(0).length + doneBeep(0).length + printerWhirr(0).length)
    expect(Math.max(...report.events.map((e) => e.t))).toBeCloseTo(0.35 + PRINT_DELAY_S, 9)
  })

  it('every kiosk sounds from its own tower', () => {
    const tr = new KioskSoundTracker()
    const ks = [state(0, 'idle'), state(1, 'idle')]
    look(tr, ks, 0)
    ks[1] = state(1, 'height')
    const s = look(tr, ks, 0.05)
    expect(s.events.length).toBeGreaterThan(0)
    for (const e of s.events) expect(e.at!.x).toBe(HEALTH_KIOSKS[1].tower.x)
  })

  it('a step cut short (back to idle) does not beep as if it had finished', () => {
    const tr = new KioskSoundTracker()
    const ks = [state(0, 'weight'), state(1, 'idle')]
    look(tr, ks, 0)
    ks[0] = state(0, 'idle')
    expect(look(tr, ks, 0.05).events).toEqual([])
    const tr2 = new KioskSoundTracker()
    const ks2 = [state(0, 'temp'), state(1, 'idle')]
    look(tr2, ks2, 0)
    ks2[0] = state(0, 'idle')
    expect(look(tr2, ks2, 0.05).events).toEqual([])
  })

  it('the rest after a cuff reading is a done beep; the same phase again is not', () => {
    const tr = new KioskSoundTracker()
    const ks = [state(0, 'bp', { cuff: 0 }), state(1, 'idle')]
    look(tr, ks, 0)
    ks[0] = state(0, 'bpRest')
    expect(look(tr, ks, 0.05).events.length).toBe(doneBeep(0).length)
    expect(look(tr, ks, 0.1).events).toEqual([])
    expect(PROMPT_PHASES.has('bp')).toBe(false)
  })
})

describe('the tracker: the printer', () => {
  it('the motor starts once and the head ticks run on the audio clock for the whole slip, a few per plan and never all at once', () => {
    const tr = new KioskSoundTracker()
    const ks = [state(0, 'temp'), state(1, 'idle')]
    look(tr, ks, 0)
    ks[0] = state(0, 'report')
    const t0 = 0.05
    const edge = look(tr, ks, t0)
    const motor = edge.events.filter((e) => e.kind === 'noise' && e.dur > 0.5)
    expect(motor.length).toBe(1)
    expect(motor[0].t).toBeCloseTo(t0 + PRINT_DELAY_S, 9)
    expect(motor[0].dur).toBeCloseTo(PRINT_S, 9)
    const ticks: number[] = []
    let most = 0
    for (let i = 1; i < 60; i++) {
      const s = look(tr, ks, t0 + i * 0.05)
      most = Math.max(most, s.events.length)
      for (const e of s.events) if (e.kind === 'noise' && e.dur < 0.03) ticks.push(e.t)
      expect(s.events.filter((e) => e.kind === 'noise' && e.dur > 0.5)).toEqual([]) // the motor is not started again
    }
    expect(most).toBeLessThanOrEqual(3) // the engine drops what is past 24 events in a tick: this never comes near
    expect(ticks.length).toBeGreaterThanOrEqual(Math.floor(PRINT_S / PRINT_TICK_S) - 1)
    expect(ticks.length).toBeLessThanOrEqual(Math.ceil(PRINT_S / PRINT_TICK_S) + 1)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeCloseTo(PRINT_TICK_S, 6)
    expect(ticks[0]).toBeGreaterThanOrEqual(t0 + PRINT_DELAY_S - 1e-9)
    expect(ticks[ticks.length - 1]).toBeLessThan(t0 + PRINT_DELAY_S + PRINT_S)
  })
})

describe('the tracker: the cuff', () => {
  /** Run the cuff 0 -> 1 -> 0 over a reading as the service does (a rise, a hold, a fall), looking every 50 ms; returns every event with its audio time. */
  function reading(pulse: number | null): { pump: number[]; hiss: number[]; ticks: number[]; end: number } {
    const tr = new KioskSoundTracker()
    const ks = [state(0, 'spo2'), state(1, 'idle')]
    look(tr, ks, 0)
    const pump: number[] = []
    const hiss: number[] = []
    const ticks: number[] = []
    const rise = 6
    const hold = 3
    const fall = 12
    const total = rise + hold + fall
    let t = 0.05
    const cuffAt = (s: number): number => (s <= rise ? s / rise : s <= rise + hold ? 1 : Math.max(0, 1 - (s - rise - hold) / fall))
    for (let s = 0; s < total; s += 0.05) {
      ks[0] = state(0, 'bp', { cuff: cuffAt(s), progress: s / total, bpRound: 1, reading: pulse === null ? null : ({ pulse } as VitalsReading) })
      for (const e of look(tr, ks, t).events) {
        if (e.kind === 'tone') pump.push(e.t)
        else if (e.f0 > 4000) hiss.push(e.t)
        else if (e.dur < 0.03) ticks.push(e.t)
      }
      t += 0.05
    }
    return { pump, hiss, ticks, end: t }
  }

  it('buzzes while the cuff inflates, is silent through the hold, then hisses with a tick for every heartbeat as it lets go', () => {
    const r = reading(60)
    expect(r.pump.length).toBeGreaterThan(20)
    expect(Math.max(...r.pump)).toBeLessThan(0.05 + 6.4) // only while rising (a latch's worth of delay at most)
    expect(r.hiss.length).toBeGreaterThan(20)
    expect(Math.min(...r.hiss)).toBeGreaterThan(6 + 3 - 0.5) // after the hold
    // one tick a second at 60 bpm over the 12 s fall
    expect(r.ticks.length).toBeGreaterThanOrEqual(10)
    expect(r.ticks.length).toBeLessThanOrEqual(13)
    const gaps = r.ticks.slice(1).map((t, i) => t - r.ticks[i])
    for (const g of gaps) expect(g).toBeCloseTo(1, 6)
  })

  it('the pump and the hiss are periodic on the audio clock: the pump every 0.16 s with no gap and no repeat across windows', () => {
    const r = reading(null)
    const gaps = r.pump.slice(1).map((t, i) => t - r.pump[i])
    for (const g of gaps) expect(g).toBeCloseTo(PUMP_PERIOD_S, 6)
    const hg = r.hiss.slice(1).map((t, i) => t - r.hiss[i])
    for (const g of hg) expect(g).toBeCloseTo(HISS_PERIOD_S, 6)
    // with no pulse in the reading yet the ticks use the default pulse
    const tg = r.ticks.slice(1).map((t, i) => t - r.ticks[i])
    for (const g of tg) expect(g).toBeCloseTo(60 / DEFAULT_PULSE, 6)
  })

  it('stops with the step: nothing pumps once the phase is no longer the cuff', () => {
    const tr = new KioskSoundTracker()
    const ks = [state(0, 'bp', { cuff: 0 }), state(1, 'idle')]
    look(tr, ks, 0)
    let t = 0.05
    for (let c = 0; c <= 0.3; c += 0.01) {
      ks[0] = state(0, 'bp', { cuff: c })
      look(tr, ks, t)
      t += 0.05
    }
    ks[0] = state(0, 'idle')
    look(tr, ks, t)
    t += 0.05
    for (let i = 0; i < 20; i++) {
      const s = look(tr, ks, t)
      t += 0.05
      expect(s.events).toEqual([])
    }
  })
})

describe('the pattern', () => {
  it('reads the kiosks through the reader it is given, and plans nothing when there are none', () => {
    let kiosks: HealthKioskState[] | null = null
    const p = createKioskPattern(() => kiosks)
    expect(p.id).toBe('kiosk')
    const s = sink()
    p.plan(win(0, 0.05), s)
    expect(s.events).toEqual([])
    kiosks = [state(0, 'idle'), state(1, 'idle')]
    p.plan(win(0.05, 0.1), s) // learns
    kiosks[0] = state(0, 'login')
    p.plan(win(0.1, 0.15), s)
    expect(s.events.length).toBe(touchBeep(0).length)
    expect(s.events[0].t).toBeCloseTo(0.1, 9)
  })

  it('is exported for the engine\'s glob (devicePatterns) without building a hospital, and plugs into the registry', () => {
    expect(devicePatterns.length).toBe(1)
    expect(devicePatterns[0].id).toBe('kiosk')
    // (its live reader loads the sim on the first plan, in the browser: nothing here builds a hospital)
    const off = registerDevicePattern(devicePatterns[0])
    expect(registered().some((p) => p.id === 'kiosk')).toBe(true)
    off()
    expect(registered().some((p) => p.id === 'kiosk')).toBe(false)
  })
})
