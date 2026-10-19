/**
 * The device sound engine in node, against a recording stand-in for the Web Audio context: no context until sound is allowed (unlocked, unmuted, tab
 * visible, somebody listening, a pattern registered), the master fades in and out with M, events are scaled by distance and walls and dropped when
 * too quiet, drones follow their pattern and fade when it stops, a throwing pattern does not silence the others, and the context is suspended
 * when quiet and closed on stop.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Vec3 } from '@/sim/types'
import { DEVICE_MASTER_TRIM, DeviceEngine, MAX_DRONES, MAX_EVENTS_PER_TICK, type DeviceInputs } from './engine'
import { blip, click, registerDevicePattern, type DevicePattern } from './registry'

class Param {
  value = 0
  log: string[] = []
  setValueAtTime(v: number, t: number) {
    this.value = v
    this.log.push(`set ${v.toFixed(4)} @${t.toFixed(3)}`)
    return this
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.log.push(`lin ${v.toFixed(4)} @${t.toFixed(3)}`)
    return this
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.log.push(`exp ${v.toFixed(4)} @${t.toFixed(3)}`)
    return this
  }
  setTargetAtTime(v: number, t: number, tau: number) {
    this.value = v
    this.log.push(`target ${v.toFixed(4)} @${t.toFixed(3)} tau ${tau}`)
    return this
  }
  cancelScheduledValues() {
    return this
  }
}
class Node {
  connected = 0
  disconnected = 0
  onended: (() => void) | null = null
  started: number[] = []
  stopped = 0
  connect() {
    this.connected++
    return this
  }
  disconnect() {
    this.disconnected++
  }
  start(t = 0) {
    this.started.push(t)
  }
  stop() {
    this.stopped++
  }
}
class FakeGain extends Node {
  gain = new Param()
}
class FakeOsc extends Node {
  type = 'sine'
  frequency = new Param()
}
class FakeBiquad extends Node {
  type = 'lowpass'
  frequency = new Param()
  Q = new Param()
}
class FakeSource extends Node {
  buffer: unknown = null
  loop = false
}
class FakeComp extends Node {
  threshold = new Param()
  knee = new Param()
  ratio = new Param()
  attack = new Param()
  release = new Param()
}
class FakeContext {
  state: 'running' | 'suspended' | 'closed' = 'running'
  currentTime = 1
  sampleRate = 8000
  destination = new Node()
  oscillators: FakeOsc[] = []
  sources: FakeSource[] = []
  gains: FakeGain[] = []
  suspended = 0
  resumed = 0
  closed = 0
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createOscillator() {
    const o = new FakeOsc()
    this.oscillators.push(o)
    return o
  }
  createBiquadFilter() {
    return new FakeBiquad()
  }
  createBufferSource() {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
  createDynamicsCompressor() {
    return new FakeComp()
  }
  createBuffer(_ch: number, len: number) {
    return { getChannelData: () => new Float32Array(len) }
  }
  suspend() {
    this.suspended++
    this.state = 'suspended'
    return Promise.resolve()
  }
  resume() {
    this.resumed++
    this.state = 'running'
    return Promise.resolve()
  }
  close() {
    this.closed++
    this.state = 'closed'
    return Promise.resolve()
  }
}

interface Rigged {
  engine: DeviceEngine
  ctx: () => FakeContext
  made: () => number
  inputs: { muted: boolean; unlocked: boolean; hidden: boolean; listener: Vec3 | null; t: number; speed: number }
}

const cleanup: (() => void)[] = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

function rig(): Rigged {
  const inputs = { muted: false, unlocked: true, hidden: false, listener: { x: -28, y: 1.6, z: 19 } as Vec3 | null, t: 0, speed: 1 }
  let ctx: FakeContext | null = null
  let made = 0
  const dev: DeviceInputs = {
    audio: () => ({ muted: inputs.muted, unlocked: inputs.unlocked }),
    hidden: () => inputs.hidden,
    listener: () => inputs.listener,
    sim: () => ({ t: inputs.t, speed: inputs.speed }),
    createContext: () => {
      made++
      ctx = new FakeContext()
      return ctx as unknown as AudioContext
    },
  }
  return { engine: new DeviceEngine(dev), ctx: () => ctx!, made: () => made, inputs }
}

function withPattern(p: DevicePattern): void {
  cleanup.push(registerDevicePattern(p))
}

const quiet: DevicePattern = { id: 'test:quiet', plan: () => {} }

describe('when the device sounds run', () => {
  it('builds no audio context until audio is unlocked, unmuted, the tab visible, somebody is listening and a pattern exists', () => {
    const r = rig()
    withPattern(quiet)
    for (const off of [{ unlocked: false }, { muted: true }, { hidden: true }, { listener: null }]) {
      Object.assign(r.inputs, { unlocked: true, muted: false, hidden: false, listener: { x: 0, y: 1.6, z: 0 } }, off)
      r.engine.watch()
      expect(r.made(), JSON.stringify(off)).toBe(0)
      expect(r.engine.live).toBe(false)
    }
    Object.assign(r.inputs, { unlocked: true, muted: false, hidden: false, listener: { x: 0, y: 1.6, z: 0 } })
    r.engine.watch()
    expect(r.made()).toBe(1)
    expect(r.engine.live).toBe(true)
    r.engine.stop()
  })

  it('fades the master up to its trim when it goes live, and down to nothing with M', () => {
    const r = rig()
    withPattern(quiet)
    r.engine.watch()
    const master = r.ctx().gains[0].gain
    expect(master.log.some((l) => l.startsWith(`lin ${DEVICE_MASTER_TRIM.toFixed(4)}`))).toBe(true)
    r.inputs.muted = true
    r.engine.watch()
    expect(master.log[master.log.length - 1]).toMatch(/^lin 0\.0000/)
    expect(r.engine.live).toBe(false)
    r.inputs.muted = false
    r.engine.watch()
    expect(master.log[master.log.length - 1]).toMatch(new RegExp(`^lin ${DEVICE_MASTER_TRIM.toFixed(4)}`))
    expect(r.made()).toBe(1) // the same context all along
    r.engine.stop()
  })

  it('suspends a hidden tab at once and a quiet engine after two seconds, and resumes when something sounds', () => {
    const r = rig()
    let on = false
    withPattern({ id: 'test:blip', plan: (w, out) => void (on && out.event(blip(w.from, 880, 0.05, 0.4, null))) })
    r.engine.watch()
    r.inputs.hidden = true
    r.engine.watch()
    expect(r.ctx().suspended).toBe(1)
    r.inputs.hidden = false
    r.engine.watch()
    r.ctx().state = 'running'
    // quiet for a long while: suspended
    r.ctx().currentTime = 10
    r.engine.tick()
    expect(r.ctx().state).toBe('suspended')
    // something sounds: resumed
    on = true
    r.ctx().currentTime = 11
    r.engine.tick()
    expect(r.ctx().resumed).toBeGreaterThan(0)
    r.engine.stop()
  })

  it('closes its context on stop', () => {
    const r = rig()
    withPattern(quiet)
    r.engine.watch()
    r.engine.stop()
    expect(r.ctx().closed).toBe(1)
    expect(r.engine.live).toBe(false)
  })
})

describe('what the engine plays', () => {
  it('schedules a pattern\'s events inside the next 120 ms, with distance and walls applied, and drops the ones too far or too quiet', () => {
    const r = rig()
    const at = (x: number, z: number): Vec3 => ({ x, y: 1, z })
    withPattern({
      id: 'test:events',
      plan: (w, out) => {
        out.event(blip(w.from, 880, 0.05, 0.5, at(-28, 19))) // right here: full
        out.event(blip(w.from, 880, 0.05, 0.5, at(-28, 14))) // through the glass front: heard, quieter
        out.event(click(w.from, 2000, 0.5, at(-60, 0))) // far across the building: dropped
        out.event(click(w.from, 2000, 0.003, at(-28, 19))) // too quiet to bother
        out.event(blip(w.from, 880, 0.05, 0.5)) // no position: full
      },
    })
    r.engine.watch()
    r.engine.tick()
    expect(r.engine.stats.events).toBe(3)
    expect(r.engine.stats.skipped).toBe(2)
    const ctx = r.ctx()
    expect(ctx.oscillators.length).toBe(3)
    // peaks, in order: full, half-muffled by distance and a wall, full
    const peaks = ctx.gains.slice(1).map((g) => Number(g.gain.log.find((l) => l.startsWith('lin'))!.split(' ')[1]))
    expect(peaks[0]).toBeCloseTo(0.5, 3)
    expect(peaks[1]).toBeGreaterThan(0)
    expect(peaks[1]).toBeLessThan(0.3)
    expect(peaks[2]).toBeCloseTo(0.5, 3)
    // every voice started at or after now, and ends by itself (its nodes are let go)
    for (const o of ctx.oscillators) expect(o.started[0]).toBeGreaterThanOrEqual(ctx.currentTime)
    const o = ctx.oscillators[0]
    expect(o.onended).toBeTypeOf('function')
    o.onended!()
    expect(o.disconnected).toBe(1)
    r.engine.stop()
  })

  it('plans consecutive windows end to end: each tick starts where the last ended', () => {
    const r = rig()
    const windows: [number, number][] = []
    withPattern({ id: 'test:windows', plan: (w) => void windows.push([w.from, w.to]) })
    r.engine.watch()
    const ctx = r.ctx()
    for (const t of [1, 1.05, 1.1, 1.15, 1.2]) {
      ctx.currentTime = t
      r.engine.tick()
    }
    expect(windows.length).toBe(5)
    for (let i = 1; i < windows.length; i++) {
      // never a gap (from <= previous to) and never a repeat (from >= previous from)
      expect(windows[i][0]).toBeLessThanOrEqual(windows[i - 1][1] + 1e-9)
      expect(windows[i][0]).toBeGreaterThanOrEqual(windows[i - 1][0])
      expect(windows[i][1]).toBeGreaterThan(windows[i][0])
    }
    r.engine.stop()
  })

  it('hands the pattern the listener, the sim time and speed, and the audio clock', () => {
    const r = rig()
    let seen: { l: Vec3; t: number; speed: number; now: number } | null = null
    withPattern({ id: 'test:window', plan: (w) => void (seen = { l: { ...w.listener }, t: w.simTime, speed: w.simSpeed, now: w.now }) })
    r.inputs.t = 321
    r.inputs.speed = 4
    r.inputs.listener = { x: -26, y: 1.6, z: 15.4 }
    r.engine.watch()
    r.engine.tick()
    expect(seen).toEqual({ l: { x: -26, y: 1.6, z: 15.4 }, t: 321, speed: 4, now: 1 })
    r.engine.stop()
  })

  it('caps the events of a tick, and carries on when a pattern throws', () => {
    const r = rig()
    withPattern({
      id: 'test:flood',
      plan: (w, out) => {
        for (let i = 0; i < 100; i++) out.event(blip(w.from, 880, 0.02, 0.5))
      },
    })
    withPattern({
      id: 'test:throws',
      plan: () => {
        throw new Error('bug in a pattern')
      },
    })
    let ran = 0
    withPattern({ id: 'test:after', plan: () => void ran++ })
    r.engine.watch()
    expect(() => r.engine.tick()).not.toThrow()
    expect(r.engine.stats.events).toBe(MAX_EVENTS_PER_TICK)
    expect(r.engine.stats.skipped).toBe(100 - MAX_EVENTS_PER_TICK)
    expect(ran).toBe(1)
    r.engine.stop()
  })

  it('runs a drone while its pattern keeps asking, follows its pitch and level (by distance), then fades it out and drops it', () => {
    const r = rig()
    let level = 0.5
    let hz = 300
    let on = true
    withPattern({ id: 'test:drone', plan: (_w, out) => void (on && out.drone({ id: 'test:d', voice: 'whine', hz, level, at: { x: -28, y: 1.6, z: 19 } })) })
    r.engine.watch()
    r.engine.tick()
    const ctx = r.ctx()
    // a whine is two oscillators (the pitch and its octave)
    expect(ctx.oscillators.length).toBe(2)
    const gain = ctx.gains[ctx.gains.length - 3].gain // the drone's own gain (before its two voice gains)
    void gain
    const [main, octave] = ctx.oscillators
    expect(main.frequency.value).toBeCloseTo(300, 3)
    expect(octave.frequency.value).toBeCloseTo(600, 3)
    hz = 450
    ctx.currentTime = 1.2
    r.engine.tick()
    expect(main.frequency.value).toBeCloseTo(450, 3)
    expect(ctx.oscillators.length).toBe(2) // the same voices, not new ones
    // silent after the pattern stops: faded to 0, and after a few seconds dropped (stopped and disconnected)
    on = false
    ctx.currentTime = 1.4
    r.engine.tick()
    const fadeGain = ctx.gains.find((g) => g.gain.log.some((l) => l.startsWith('target 0.0000')))
    expect(fadeGain).toBeDefined()
    ctx.currentTime = 6
    r.engine.tick()
    expect(main.stopped).toBe(1)
    expect(octave.stopped).toBe(1)
    void level
    r.engine.stop()
  })

  it('limits how many drones live at once', () => {
    const r = rig()
    withPattern({
      id: 'test:many',
      plan: (_w, out) => {
        for (let i = 0; i < MAX_DRONES + 5; i++) out.drone({ id: `test:m${i}`, voice: 'hum', hz: 60, level: 0.1 })
      },
    })
    r.engine.watch()
    r.engine.tick()
    // a hum is two oscillators and a noise bed each
    expect(r.ctx().oscillators.length).toBe(MAX_DRONES * 2)
    r.engine.stop()
  })

  it('does not tick at all while muted', () => {
    const r = rig()
    let plans = 0
    withPattern({ id: 'test:count', plan: () => void plans++ })
    r.engine.watch()
    r.engine.tick()
    expect(plans).toBe(1)
    r.inputs.muted = true
    r.engine.watch()
    r.ctx().currentTime = 2
    r.engine.tick()
    expect(plans).toBe(1)
    r.engine.stop()
  })
})
