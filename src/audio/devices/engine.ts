/**
 * The device sound engine (W4): Web Audio, synthesized, no files, no React. DeviceSounds.tsx starts and stops it and supplies its inputs.
 *
 * Shape (the scanner and ambience engines' shape): one AudioContext, created only once audio is unlocked, unmuted and somebody could hear
 * something (a listener, at least one pattern). Everything feeds a master trim (about -14 dBFS peaks) through a gentle low-pass and a compressor.
 * A 4 Hz watch follows mute (M), unlock, tab visibility, the pause and the listener; while live a 50 ms scheduler asks every registered
 * pattern (registry.ts) to plan the next 120 ms: it receives `tone` and `noise` events, each with the world position it comes from, and `drone`
 * calls for the continuous voices (a rotor's whine, the conveyor's hum). Distance and walls scale every voice (`soundGain`). The context is suspended
 * after 2 s of quiet and whenever the tab is hidden or the demo paused, and closed on `stop`.
 *
 * Nothing is built per frame (this runs on timers, not in a frame callback); per event it makes a few nodes and disconnects them when they end.
 */
import type { Vec3 } from '@/sim/types'
import { noiseSamples } from '../patterns'
import {
  devicePatterns,
  registryVersion,
  soundGain,
  type DeviceEvent,
  type DevicePattern,
  type DroneSpec,
  type PatternSink,
  type PlanWindow,
} from './registry'

/** What the engine reads from the outside world. DeviceSounds.tsx supplies it from the stores and the sim. */
export interface DeviceInputs {
  audio(): { muted: boolean; unlocked: boolean }
  /** A hidden tab or a paused demo: stay silent. */
  hidden(): boolean
  /** Where you (walking) or the focused room (overview) listens from; null when nobody does. */
  listener(): Vec3 | null
  /** Sim seconds now, and the speed of the demo (0 paused). */
  sim(): { t: number; speed: number }
  /** For tests: a stand-in for `new AudioContext()`. */
  createContext?: () => AudioContext
}

const WATCH_MS = 250
const TICK_MS = 50
const LOOKAHEAD_S = 0.12
const FADE_S = 0.3
const SUSPEND_AFTER_S = 2
/** Master level: voices peak around -14 dBFS after this trim. */
export const DEVICE_MASTER_TRIM = 0.2
const NOISE_S = 4
/** The most events one tick schedules (a runaway pattern must not flood the audio thread), and the most drones alive at once. */
export const MAX_EVENTS_PER_TICK = 24
export const MAX_DRONES = 12

interface Drone {
  id: string
  gain: GainNode
  nodes: AudioNode[]
  /** Everything that runs on its own (stopped when the drone is dropped), and the oscillators among it whose pitch follows the pattern. */
  sources: AudioScheduledSourceNode[]
  osc: OscillatorNode[]
  /** The multiplier of each oscillator's pitch (a whine has a second voice an octave up). */
  mult: number[]
  seen: number
  quietSince: number
}

interface Rig {
  ctx: AudioContext
  master: GainNode
  pink: AudioBuffer
  white: AudioBuffer
  noiseCursor: number
  drones: Map<string, Drone>
}

export interface EngineStats {
  ticks: number
  events: number
  skipped: number
  contexts: number
}

export class DeviceEngine {
  private rig: Rig | null = null
  private broken = false
  private watchTimer: ReturnType<typeof setInterval> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private cursor = 0
  private lastAudible = Number.NEGATIVE_INFINITY
  private tickNo = 0
  private list: readonly DevicePattern[] = []
  private listVersion = -1
  private open = false
  readonly stats: EngineStats = { ticks: 0, events: 0, skipped: 0, contexts: 0 }
  private readonly onVisibility = (): void => this.watch()
  private readonly window: PlanWindow = { from: 0, to: 0, now: 0, simTime: 0, simSpeed: 1, listener: { x: 0, y: 0, z: 0 } }
  private budget = 0
  private readonly sink: PatternSink = {
    event: (e) => this.schedule(e),
    drone: (d) => this.setDrone(d),
  }

  constructor(private readonly inputs: DeviceInputs) {}

  start(): void {
    if (this.watchTimer !== null) return
    this.watchTimer = setInterval(() => this.watch(), WATCH_MS)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility)
    this.watch()
  }

  stop(): void {
    if (this.watchTimer !== null) clearInterval(this.watchTimer)
    this.watchTimer = null
    this.stopTicking()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    const rig = this.rig
    this.rig = null
    this.open = false
    if (rig) void rig.ctx.close().catch(() => undefined)
  }

  /** Is the master open (voices can be heard)? For tests and the probe. */
  get live(): boolean {
    return this.open
  }

  /** 4 Hz: decides whether sound should run, fades the master, and suspends the context when it is quiet. */
  watch(): void {
    const { muted, unlocked } = this.inputs.audio()
    const hidden = this.inputs.hidden()
    const listener = this.inputs.listener()
    if (registryVersion() !== this.listVersion) {
      this.listVersion = registryVersion()
      this.list = devicePatterns()
    }
    const live = unlocked && !muted && !hidden && listener !== null && this.list.length > 0
    if (live && this.rig === null && !this.broken) this.rig = this.createRig()
    const rig = this.rig
    if (live !== this.open) {
      this.open = live
      if (rig) fadeTo(rig.master.gain, live ? DEVICE_MASTER_TRIM : 0, rig.ctx.currentTime)
    }
    if (live && rig) this.startTicking()
    else this.stopTicking()
    if (rig === null) return
    const now = rig.ctx.currentTime
    if (hidden) suspend(rig.ctx)
    else if (!live && now - this.lastAudible > SUSPEND_AFTER_S) suspend(rig.ctx)
  }

  private startTicking(): void {
    if (this.tickTimer === null) this.tickTimer = setInterval(() => this.tick(), TICK_MS)
  }

  private stopTicking(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer)
    this.tickTimer = null
  }

  /** 50 ms lookahead: plans [now, now + 120 ms) for every pattern and updates the drones. Runs only while live. */
  tick(): void {
    const rig = this.rig
    const listener = this.inputs.listener()
    if (rig === null || listener === null || !this.open) return
    const { ctx } = rig
    const now = ctx.currentTime
    const from = Math.max(this.cursor, now)
    const to = now + LOOKAHEAD_S
    if (!(to > from)) return
    this.cursor = to
    this.tickNo++
    this.stats.ticks++
    const sim = this.inputs.sim()
    const w = this.window
    w.from = from
    w.to = to
    w.now = now
    w.simTime = sim.t
    w.simSpeed = sim.speed
    w.listener.x = listener.x
    w.listener.y = listener.y
    w.listener.z = listener.z
    this.budget = MAX_EVENTS_PER_TICK
    const before = this.stats.events
    for (const p of this.list) {
      try {
        p.plan(w, this.sink)
      } catch {
        // one pattern's bug must not silence the others (or the demo)
      }
    }
    // drones the patterns did not mention this tick fade out
    for (const d of rig.drones.values()) {
      if (d.seen !== this.tickNo) {
        d.gain.gain.cancelScheduledValues(now)
        d.gain.gain.setTargetAtTime(0, now, 0.1)
        if (d.quietSince === Number.POSITIVE_INFINITY) d.quietSince = now
        else if (now - d.quietSince > 3) this.dropDrone(rig, d)
      }
    }
    if (this.stats.events > before || [...rig.drones.values()].some((d) => d.seen === this.tickNo)) {
      this.lastAudible = now
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    } else if (now - this.lastAudible > SUSPEND_AFTER_S) suspend(ctx)
  }

  // ----- events -----

  private schedule(e: DeviceEvent): void {
    const rig = this.rig
    if (rig === null) return
    if (this.budget <= 0) {
      this.stats.skipped++
      return
    }
    const g = soundGain(this.window.listener, e.at)
    const peak = e.peak * g
    if (peak < 0.004) {
      this.stats.skipped++
      return
    }
    this.budget--
    this.stats.events++
    const t = Math.max(e.t, rig.ctx.currentTime)
    if (e.kind === 'tone') tone(rig, t, e, peak)
    else noise(rig, t, e, peak)
  }

  // ----- drones -----

  private setDrone(d: DroneSpec): void {
    const rig = this.rig
    if (rig === null) return
    let dr = rig.drones.get(d.id)
    if (!dr) {
      if (rig.drones.size >= MAX_DRONES) return
      dr = buildDrone(rig, d)
      rig.drones.set(d.id, dr)
    }
    dr.seen = this.tickNo
    dr.quietSince = Number.POSITIVE_INFINITY
    const now = rig.ctx.currentTime
    const level = Math.max(0, d.level) * soundGain(this.window.listener, d.at)
    dr.gain.gain.cancelScheduledValues(now)
    dr.gain.gain.setTargetAtTime(level, now, 0.08)
    for (let i = 0; i < dr.osc.length; i++) {
      dr.osc[i].frequency.cancelScheduledValues(now)
      dr.osc[i].frequency.setTargetAtTime(Math.max(20, d.hz * dr.mult[i]), now, 0.06)
    }
  }

  private dropDrone(rig: Rig, d: Drone): void {
    for (const o of d.sources) {
      try {
        o.stop()
      } catch {
        // already stopped
      }
    }
    for (const n of d.nodes) n.disconnect()
    d.gain.disconnect()
    rig.drones.delete(d.id)
  }

  private createRig(): Rig | null {
    try {
      const make = this.inputs.createContext
      if (!make && typeof AudioContext === 'undefined') {
        this.broken = true
        return null
      }
      this.stats.contexts++
      return buildRig(make ? make() : new AudioContext())
    } catch {
      this.broken = true
      return null
    }
  }
}

function buildRig(ctx: AudioContext): Rig {
  const master = ctx.createGain()
  master.gain.value = 0
  const warm = ctx.createBiquadFilter()
  warm.type = 'lowpass'
  warm.frequency.value = 5200
  warm.Q.value = 0.5
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.knee.value = 10
  comp.ratio.value = 3
  comp.attack.value = 0.005
  comp.release.value = 0.2
  master.connect(warm)
  warm.connect(comp)
  comp.connect(ctx.destination)
  return { ctx, master, pink: noiseBuffer(ctx, 'pink', 21), white: noiseBuffer(ctx, 'white', 23), noiseCursor: 0, drones: new Map() }
}

function noiseBuffer(ctx: AudioContext, kind: 'white' | 'pink', seed: number): AudioBuffer {
  const len = Math.round(ctx.sampleRate * NOISE_S)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  buf.getChannelData(0).set(noiseSamples(kind, len, seed))
  return buf
}

function suspend(ctx: AudioContext): void {
  if (ctx.state === 'running') void ctx.suspend().catch(() => undefined)
}

/** Moves a gain to `target` over FADE_S, from wherever it is now. */
function fadeTo(param: AudioParam, target: number, now: number): void {
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(target, now + FADE_S)
}

/** A short attack and an exponential decay into the master, returned so the voice can route through it. */
function env(rig: Rig, t: number, peak: number, attack: number, dur: number): GainNode {
  const g = rig.ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(Math.max(peak, 1e-4), t + attack)
  g.gain.exponentialRampToValueAtTime(1e-4, t + Math.max(dur, attack + 0.005))
  g.connect(rig.master)
  return g
}

function release(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  src.onended = () => {
    for (const n of nodes) n.disconnect()
  }
}

/** Where in the noise buffer the next noise voice starts: deterministic and spread out, so no two voices are the same snippet. */
function nextOffset(rig: Rig): number {
  rig.noiseCursor = (rig.noiseCursor + 0.0371) % (NOISE_S - 0.5)
  return rig.noiseCursor
}

function tone(rig: Rig, t: number, e: Extract<DeviceEvent, { kind: 'tone' }>, peak: number): void {
  const ctx = rig.ctx
  const o = ctx.createOscillator()
  o.type = e.wave
  o.frequency.setValueAtTime(Math.max(20, e.f0), t)
  if (e.f1 !== e.f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, e.f1), t + e.dur)
  const g = env(rig, t, peak, e.attack, e.dur)
  o.connect(g)
  o.start(t)
  o.stop(t + e.dur + 0.03)
  release(o, [o, g])
}

function noise(rig: Rig, t: number, e: Extract<DeviceEvent, { kind: 'noise' }>, peak: number): void {
  const ctx = rig.ctx
  const n = ctx.createBufferSource()
  n.buffer = e.f0 >= 1500 || e.q > 1.5 ? rig.white : rig.pink
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = e.q
  bp.frequency.setValueAtTime(Math.max(40, e.f0), t)
  if (e.f1 !== e.f0) bp.frequency.exponentialRampToValueAtTime(Math.max(40, e.f1), t + e.dur)
  const g = env(rig, t, peak, e.attack, e.dur)
  n.connect(bp)
  bp.connect(g)
  n.start(t, nextOffset(rig), e.dur + 0.05)
  release(n, [n, bp, g])
}

function buildDrone(rig: Rig, d: DroneSpec): Drone {
  const ctx = rig.ctx
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(rig.master)
  const nodes: AudioNode[] = []
  const sources: AudioScheduledSourceNode[] = []
  const osc: OscillatorNode[] = []
  const mult: number[] = []
  if (d.voice === 'whine') {
    // a triangle at the pitch and a quieter sine an octave up: a rotor's whine
    for (const [wave, m, level] of [
      ['triangle', 1, 0.7],
      ['sine', 2, 0.3],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = wave
      o.frequency.value = d.hz * m
      const g = ctx.createGain()
      g.gain.value = level
      o.connect(g)
      g.connect(gain)
      o.start()
      osc.push(o)
      sources.push(o)
      mult.push(m)
      nodes.push(g)
    }
  } else {
    // a low sine and its octave with a bed of low-passed pink noise: the conveyor's hum
    const bed = ctx.createBufferSource()
    bed.buffer = rig.pink
    bed.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 240
    const bg = ctx.createGain()
    bg.gain.value = 0.45
    bed.connect(lp)
    lp.connect(bg)
    bg.connect(gain)
    bed.start()
    sources.push(bed)
    nodes.push(lp, bg, bed)
    for (const [m, level] of [
      [1, 0.5],
      [2, 0.2],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = d.hz * m
      const g = ctx.createGain()
      g.gain.value = level
      o.connect(g)
      g.connect(gain)
      o.start()
      osc.push(o)
      sources.push(o)
      mult.push(m)
      nodes.push(g)
    }
  }
  return { id: d.id, gain, nodes, sources, osc, mult, seen: -1, quietSince: Number.POSITIVE_INFINITY }
}
