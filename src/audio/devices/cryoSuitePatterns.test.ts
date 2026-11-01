/**
 * R4: the cryo suite's sounds in node: the CT whir only while the rotor turns (the imaging CT's pitch), the servo chirps only while the robot moves,
 * the argon hiss only while argon runs (periodic: windows join with no gap and no repeat), and the freeze beep once on a fresh freeze, never at load.
 */
import { describe, expect, it } from 'vitest'
import { anaesState, cryoState } from '@/scene/cryoSuite/testkit'
import { CRYO_SUITE } from '@/sim/places'
import { ctPitchHz } from '../patterns'
import { createCryoPattern, HISS_PERIOD_S, newCryoMemory, planCryo, VENT_AT } from './cryoSuitePatterns'
import { BREATH_PERIOD_S } from './surgeryPatterns'
import type { DeviceEvent, DroneSpec, PatternSink, PlanWindow } from './registry'

function sink() {
  const events: DeviceEvent[] = []
  const drones: DroneSpec[] = []
  const out: PatternSink = { event: (e) => void events.push(e), drone: (d) => void drones.push(d) }
  return { out, events, drones }
}
const win = (from: number, to: number, simTime = 100, simSpeed = 1): PlanWindow => ({ from, to, now: from, simTime, simSpeed, listener: { x: 0, y: 0, z: 0 } })

describe('the cryo suite sounds', () => {
  it('the CT whirs only while the rotor turns, at the imaging CT\'s pitch', () => {
    const s = cryoState({ step: 'checkCt', tablePos: 1 })
    s.argon = false
    const a = sink()
    planCryo(s, newCryoMemory(), win(0, 0.1), a.out)
    expect(a.drones).toHaveLength(1)
    expect(a.drones[0].hz).toBeCloseTo(ctPitchHz(1), 9)
    s.rotor = 0
    const b = sink()
    planCryo(s, newCryoMemory(), win(0, 0.1), b.out)
    expect(b.drones).toHaveLength(0)
  })

  it('the arm chirps while it moves, not while stowed or aligned; nothing while paused', () => {
    const count = (phase: 'stowed' | 'aiming' | 'aligned', speed = 1) => {
      const s = cryoState({ step: 'aim', robot: phase, robotNeedle: 0 })
      s.argon = false
      const o = sink()
      planCryo(s, newCryoMemory(), win(0, 2, 100, speed), o.out)
      return o.events.length
    }
    expect(count('aiming')).toBeGreaterThan(0)
    expect(count('stowed')).toBe(0)
    expect(count('aligned')).toBe(0)
    expect(count('aiming', 0)).toBe(0)
  })

  it('the argon hisses in puffs that join up across windows with no gap and no repeat', () => {
    const s = cryoState({ step: 'freeze1' })
    const mem = newCryoMemory()
    const o = sink()
    for (let k = 0; k < 30; k++) planCryo(s, mem, win(k * 0.1, (k + 1) * 0.1), o.out)
    const times = o.events.filter((e) => e.kind === 'noise' && e.f0 > 4000).map((e) => e.t)
    expect(times).toHaveLength(Math.ceil(3 / HISS_PERIOD_S))
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(HISS_PERIOD_S, 9)
  })

  it('beeps once when a freeze starts, never at the first look (load, a Jump)', () => {
    const s = cryoState({ step: 'checkCt' })
    s.argon = false
    s.rotor = 0
    const mem = newCryoMemory()
    const o = sink()
    planCryo(s, mem, win(0, 0.1, 100), o.out)
    expect(o.events).toHaveLength(0)
    s.step = 'freeze1'
    s.stepSince = 99
    planCryo(s, mem, win(0.1, 0.2, 100), o.out)
    const beeps = o.events.filter((e) => e.kind === 'tone' && e.f0 === 880)
    expect(beeps).toHaveLength(2)
    planCryo(s, mem, win(0.2, 0.3, 100), o.out)
    expect(o.events.filter((e) => e.kind === 'tone' && e.f0 === 880)).toHaveLength(2)
    // a fresh state at a freeze (a Jump) is only learnt
    const j = cryoState({ step: 'freeze2' })
    const o2 = sink()
    planCryo(j, mem, win(0.3, 0.4, 100), o2.out)
    expect(o2.events.filter((e) => e.kind === 'tone' && e.f0 === 880)).toHaveLength(0)
  })

  it('a pattern with no sim yet says nothing', () => {
    const o = sink()
    createCryoPattern(() => null).plan(win(0, 1), o.out)
    expect(o.events).toHaveLength(0)
  })
})

describe('R5 wave 3: the anaesthesia machine\'s ventilator', () => {
  /** The start times of the ventilator's breaths (its first noise: a band rising from 320 Hz). */
  const breaths = (events: DeviceEvent[]): number[] => events.filter((e) => e.kind === 'noise' && e.f0 === 320).map((e) => e.t)
  const plan = (s: ReturnType<typeof anaesState>, from: number, to: number, speed = 1) => {
    const o = sink()
    planCryo(s, newCryoMemory(), win(from, to, 100, speed), o.out)
    return o
  }
  const quiet = (s: ReturnType<typeof anaesState>): void => {
    s.rotor = 0
    s.argon = false
    s.robot.phase = 'stowed'
  }

  it('sits at the machine\'s bellows, on the OR ventilator\'s breath (4.8 s)', () => {
    expect(VENT_AT.x).toBe(CRYO_SUITE.anaesMachine.at.at.x)
    expect(VENT_AT.z).toBe(CRYO_SUITE.anaesMachine.at.at.z)
    expect(BREATH_PERIOD_S).toBe(4.8)
    const s = anaesState()
    quiet(s)
    const o = plan(s, 0, 20)
    const t = breaths(o.events)
    expect(t).toHaveLength(Math.ceil(20 / BREATH_PERIOD_S))
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeCloseTo(BREATH_PERIOD_S, 9)
    for (const e of o.events) expect(e.at).toEqual(VENT_AT)
  })

  it('breathes only while the machine works a patient: lung and liver, not the kidney, not before the monitors go on, not while the sim is paused', () => {
    for (const target of ['lung', 'liver'] as const) {
      const s = anaesState({ target })
      quiet(s)
      expect(breaths(plan(s, 0, 10).events).length, target).toBeGreaterThan(0)
    }
    const k = anaesState({ target: 'kidney' })
    quiet(k)
    expect(breaths(plan(k, 0, 10).events)).toHaveLength(0)
    const kn = cryoState({ step: 'freeze1' })
    kn.argon = false
    expect(breaths(plan(kn as never, 0, 10).events)).toHaveLength(0)
    const early = anaesState({ airway: 'none' })
    quiet(early)
    expect(breaths(plan(early, 0, 10).events)).toHaveLength(0)
    const paused = anaesState()
    quiet(paused)
    expect(breaths(plan(paused, 0, 10, 0).events)).toHaveLength(0)
  })

  it('holds its breath: silent for as long as the sim says the breath is held (a scan, a needle push), and back with the window after', () => {
    const s = anaesState()
    quiet(s)
    const mem = newCryoMemory()
    const o = sink()
    // 10 s of windows, the held breath from 3 s to 8 s
    for (let k = 0; k < 100; k++) {
      s.apnoea = k >= 30 && k < 80
      planCryo(s, mem, win(k * 0.1, (k + 1) * 0.1, 100), o.out)
    }
    const t = breaths(o.events)
    // breaths at 0 and 4.8 are planned in windows that were running at the time: 0 yes, 4.8 is inside the hold (3..8): no; 9.6 is after: yes
    expect(t.filter((x) => x >= 3 && x < 8)).toHaveLength(0)
    expect(t.some((x) => x < 3)).toBe(true)
    expect(t.some((x) => x >= 8)).toBe(true)
    // the whole day without a hold has the one in the middle
    const free = sink()
    const m2 = newCryoMemory()
    const s2 = anaesState()
    quiet(s2)
    for (let k = 0; k < 100; k++) planCryo(s2, m2, win(k * 0.1, (k + 1) * 0.1, 100), free.out)
    expect(breaths(free.events).length).toBe(breaths(o.events).length + 1)
  })

  it('joins up across windows with no gap and no repeat', () => {
    const s = anaesState()
    quiet(s)
    const mem = newCryoMemory()
    const o = sink()
    for (let k = 0; k < 150; k++) planCryo(s, mem, win(k * 0.1, (k + 1) * 0.1, 100), o.out)
    const t = breaths(o.events)
    expect(t).toHaveLength(Math.ceil(15 / BREATH_PERIOD_S))
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeCloseTo(BREATH_PERIOD_S, 9)
  })
})
