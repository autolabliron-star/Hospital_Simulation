/**
 * R4: the cryo suite's sounds in node: the CT whir only while the rotor turns (the imaging CT's pitch), the servo chirps only while the robot moves,
 * the argon hiss only while argon runs (periodic: windows join with no gap and no repeat), and the freeze beep once on a fresh freeze, never at load.
 */
import { describe, expect, it } from 'vitest'
import { cryoState } from '@/scene/cryoSuite/testkit'
import { ctPitchHz } from '../patterns'
import { createCryoPattern, HISS_PERIOD_S, newCryoMemory, planCryo } from './cryoSuitePatterns'
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
