/**
 * The scanner sound engine: Web Audio, no React. ScannerSounds.tsx starts and stops it and supplies its inputs.
 *
 * Shape: one AudioContext, created only once audio is unlocked. Each machine has a bus gain, and only the focused
 * machine's bus is open. The buses feed a trim (about -14 dBFS peaks), a gentle low-pass and a compressor, then the
 * speakers. A 4 Hz watch follows focus, mute, unlock and visibility. While a scanner room is focused, a 50 ms
 * scheduler plans the next 120 ms of sound from the pure functions in patterns.ts.
 */
import type { ImagingModality } from '@/sim/types'
import {
  CT_PITCH_LOW_HZ,
  CT_SMOOTH_TAU_S,
  approach,
  chugEvents,
  clamp01,
  ctGain,
  ctPitchHz,
  edgeEvents,
  mriPatternEvents,
  noiseSamples,
  patternOfKind,
  viewOf,
  whatShouldPlay,
  type MachineSnap,
  type ScannerView,
  type VoiceEvent,
} from './patterns'

/** What the engine reads from the outside world. ScannerSounds.tsx supplies it from the stores and the sim. */
export interface EngineInputs {
  /** The focused scanner modality, or null when no scanner room is focused. */
  focus(): ImagingModality | null
  audio(): { muted: boolean; unlocked: boolean }
  hidden(): boolean
  scanner(m: ImagingModality): ScannerView | undefined
}

const MODALITY_LIST: readonly ImagingModality[] = ['mri', 'ct', 'xray', 'us']
const WATCH_MS = 250
const TICK_MS = 50
const LOOKAHEAD_S = 0.12
const EDGE_DELAY_S = 0.01
const FADE_S = 0.3
const SUSPEND_AFTER_S = 2
/** Master level: sources peak around -14 dBFS after this trim. */
const MASTER_TRIM = 0.2
const NOISE_S = 4

interface Rig {
  ctx: AudioContext
  buses: Record<ImagingModality, GainNode>
  pink: AudioBuffer
  white: AudioBuffer
  tone: OscillatorNode
  bedGain: GainNode
  toneGain: GainNode
  noiseCursor: number
}

export class ScannerEngine {
  private rig: Rig | null = null
  private broken = false
  private watchTimer: ReturnType<typeof setInterval> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private focus: ImagingModality | null = null
  private wasLive = false
  private prev: MachineSnap | null = null
  private cursor = 0
  private ctSpeed = 0
  private lastWhirSpeed = -1
  private lastAudible = Number.NEGATIVE_INFINITY
  private gateOpen: Record<ImagingModality, boolean> = { mri: false, ct: false, xray: false, us: false }
  private readonly onVisibility = (): void => this.watch()

  constructor(private readonly inputs: EngineInputs) {}

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
    this.focus = null
    this.wasLive = false
    this.prev = null
    this.gateOpen = { mri: false, ct: false, xray: false, us: false }
    if (rig) void rig.ctx.close().catch(() => undefined)
  }

  /** 4 Hz: decides whether sound should run, opens the focused bus, and suspends the context when it is quiet. */
  private watch(): void {
    const focus = this.inputs.focus()
    const { muted, unlocked } = this.inputs.audio()
    const hidden = this.inputs.hidden()
    const live = focus !== null && unlocked && !muted && !hidden
    if (focus !== this.focus || live !== this.wasLive) this.prev = null
    this.focus = focus
    this.wasLive = live
    // The AudioContext exists only once audio is unlocked and a scanner room is focused.
    if (live && this.rig === null && !this.broken) this.rig = this.createRig()
    const rig = this.rig
    if (rig === null) return
    const now = rig.ctx.currentTime
    for (const m of MODALITY_LIST) {
      const open = live && m === focus
      if (open !== this.gateOpen[m]) {
        this.gateOpen[m] = open
        fadeTo(rig.buses[m].gain, open ? 1 : 0, now)
      }
    }
    if (live) this.startTicking()
    else this.stopTicking()
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

  /** 50 ms lookahead: plans the events in [now, now + 120 ms) and updates the CT whir. Runs only while focused. */
  private tick(): void {
    const rig = this.rig
    const m = this.focus
    if (rig === null || m === null) return
    const { ctx } = rig
    const now = ctx.currentTime
    const audio = this.inputs.audio()
    const view = viewOf(m, this.inputs.scanner(m))
    const decision = whatShouldPlay(m, view, audio.muted, audio.unlocked)
    if (decision.kind === 'silent') return
    const snap: MachineSnap = { phase: view.phase, activity: clamp01(view.activity) }
    const prev = this.prev
    this.prev = snap
    if (prev === null) this.ctSpeed = snap.activity
    // Phase changes fade the machine's sound out and back in over FADE_S.
    if (prev !== null && prev.phase !== snap.phase) dip(rig.buses[m].gain, now)

    const events = edgeEvents(m, prev, snap, now + EDGE_DELAY_S)
    const from = Math.max(this.cursor, now)
    const to = now + LOOKAHEAD_S
    if (to > from) {
      this.cursor = to
      if (m === 'mri') {
        events.push(...chugEvents(from, to, snap.activity))
        events.push(...mriPatternEvents(patternOfKind(decision.kind), from, to, decision.level))
      }
    }
    for (const ev of events) schedule(rig, m, ev)

    let audible: boolean
    if (m === 'mri') {
      audible = true // the helium pump never stops
    } else if (m === 'ct') {
      this.ctSpeed = approach(this.ctSpeed, snap.activity, TICK_MS / 1000, CT_SMOOTH_TAU_S)
      if (Math.abs(this.ctSpeed - this.lastWhirSpeed) > 1e-4) {
        this.lastWhirSpeed = this.ctSpeed
        setWhir(rig, now, this.ctSpeed)
      }
      audible = this.ctSpeed > 0.003 || snap.activity > 0.01
    } else {
      audible = events.length > 0
    }

    if (audible) {
      this.lastAudible = now
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    } else if (now - this.lastAudible > SUSPEND_AFTER_S) {
      suspend(ctx)
    }
  }

  private createRig(): Rig | null {
    if (typeof AudioContext === 'undefined') {
      this.broken = true
      return null
    }
    try {
      return buildRig(new AudioContext())
    } catch {
      this.broken = true
      return null
    }
  }
}

function buildRig(ctx: AudioContext): Rig {
  const trim = ctx.createGain()
  trim.gain.value = MASTER_TRIM
  const warm = ctx.createBiquadFilter()
  warm.type = 'lowpass'
  warm.frequency.value = 4500
  warm.Q.value = 0.5
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.knee.value = 10
  comp.ratio.value = 3
  comp.attack.value = 0.005
  comp.release.value = 0.2
  trim.connect(warm)
  warm.connect(comp)
  comp.connect(ctx.destination)

  const buses = {} as Record<ImagingModality, GainNode>
  for (const m of MODALITY_LIST) {
    const bus = ctx.createGain()
    bus.gain.value = 0
    bus.connect(trim)
    buses[m] = bus
  }

  // CT whir: a looping, low-passed pink bed, plus a sine that tracks the rotor.
  const pink = noiseBuffer(ctx, 'pink', 7)
  const white = noiseBuffer(ctx, 'white', 11)
  const bedSrc = ctx.createBufferSource()
  bedSrc.buffer = pink
  bedSrc.loop = true
  const bedLp = ctx.createBiquadFilter()
  bedLp.type = 'lowpass'
  bedLp.frequency.value = 600
  const bedGain = ctx.createGain()
  bedGain.gain.value = 0
  bedSrc.connect(bedLp)
  bedLp.connect(bedGain)
  bedGain.connect(buses.ct)
  const tone = ctx.createOscillator()
  tone.type = 'sine'
  tone.frequency.value = CT_PITCH_LOW_HZ
  const toneGain = ctx.createGain()
  toneGain.gain.value = 0
  tone.connect(toneGain)
  toneGain.connect(buses.ct)
  bedSrc.start()
  tone.start()

  return { ctx, buses, pink, white, tone, bedGain, toneGain, noiseCursor: 0 }
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

/** A phase change: fade out for half of FADE_S, then back in. */
function dip(param: AudioParam, now: number): void {
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(0, now + FADE_S / 2)
  param.linearRampToValueAtTime(1, now + FADE_S)
}

function setWhir(rig: Rig, now: number, speed: number): void {
  const g = ctGain(speed)
  rig.tone.frequency.cancelScheduledValues(now)
  rig.tone.frequency.setTargetAtTime(ctPitchHz(speed), now, 0.05)
  rig.bedGain.gain.cancelScheduledValues(now)
  rig.bedGain.gain.setTargetAtTime(0.9 * g, now, 0.05)
  rig.toneGain.gain.cancelScheduledValues(now)
  rig.toneGain.gain.setTargetAtTime(0.25 * g, now, 0.05)
}

function schedule(rig: Rig, m: ImagingModality, ev: VoiceEvent): void {
  const dest = rig.buses[m]
  switch (ev.kind) {
    case 'knock':
      knock(rig, dest, ev.t, ev.level, ev.click)
      return
    case 'chirp':
      chirp(rig, dest, ev.t, ev.level)
      return
    case 'buzz':
      buzz(rig, dest, ev.t, ev.level, ev.freq, ev.dur)
      return
    case 'chug':
      chug(rig, dest, ev.t, ev.level)
      return
    case 'beep':
      tone(rig, dest, ev.t, 1900, 0.5 * ev.level, 0.01, 0.8)
      return
    case 'click':
      mechClick(rig, dest, ev.t, ev.level)
      return
    case 'chime':
      tone(rig, dest, ev.t, 880, 0.4 * ev.level, 0.01, 0.9)
      tone(rig, dest, ev.t, 1320, 0.2 * ev.level, 0.01, 0.9)
      return
  }
}

/** A short attack and an exponential decay into `dest`, returned so the voice can route through it. */
function env(ctx: AudioContext, dest: AudioNode, t: number, peak: number, attack: number, dur: number): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(Math.max(peak, 1e-4), t + attack)
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur)
  g.connect(dest)
  return g
}

/** Disconnects a finished voice's nodes so the audio graph does not grow. */
function release(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  src.onended = () => {
    for (const n of nodes) n.disconnect()
  }
}

/** Where in the noise buffer the next noise voice starts. Deterministic and spread out, so voices differ. */
function nextOffset(rig: Rig): number {
  rig.noiseCursor = (rig.noiseCursor + 0.0371) % (NOISE_S - 0.5)
  return rig.noiseCursor
}

/** A plain sine voice: frequency, peak, attack and total length. */
function tone(rig: Rig, dest: AudioNode, t: number, freq: number, peak: number, attack: number, dur: number): void {
  const ctx = rig.ctx
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.value = freq
  const g = env(ctx, dest, t, peak, attack, dur)
  o.connect(g)
  o.start(t)
  o.stop(t + dur + 0.02)
  release(o, [o, g])
}

/** The MRI knock: band-passed pink noise at about 300 Hz, a short falling sine, and an optional higher click. */
function knock(rig: Rig, dest: AudioNode, t: number, level: number, click: boolean): void {
  const ctx = rig.ctx
  const n = ctx.createBufferSource()
  n.buffer = rig.pink
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 300
  bp.Q.value = 1.2
  const g = env(ctx, dest, t, 0.55 * level, 0.003, 0.09)
  n.connect(bp)
  bp.connect(g)
  n.start(t, nextOffset(rig), 0.1)
  release(n, [n, bp, g])

  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(190, t)
  o.frequency.exponentialRampToValueAtTime(110, t + 0.07)
  const og = env(ctx, dest, t, 0.35 * level, 0.002, 0.1)
  o.connect(og)
  o.start(t)
  o.stop(t + 0.1)
  release(o, [o, og])

  if (click) tone(rig, dest, t, 3200, 0.2 * level, 0.001, 0.012)
}

/** The scout chirp: a quick upward sine sweep. */
function chirp(rig: Rig, dest: AudioNode, t: number, level: number): void {
  const ctx = rig.ctx
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(1500, t)
  o.frequency.linearRampToValueAtTime(2400, t + 0.05)
  const g = env(ctx, dest, t, 0.12 * level, 0.004, 0.07)
  o.connect(g)
  o.start(t)
  o.stop(t + 0.08)
  release(o, [o, g])
}

/** A square-wave buzz, low-passed: the DWI beeping and the T2 undertone. */
function buzz(rig: Rig, dest: AudioNode, t: number, level: number, freq: number, dur: number): void {
  const ctx = rig.ctx
  const o = ctx.createOscillator()
  o.type = 'square'
  o.frequency.value = freq
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = freq * 1.6
  const g = env(ctx, dest, t, 0.3 * level, 0.02, dur)
  o.connect(lp)
  lp.connect(g)
  o.start(t)
  o.stop(t + dur + 0.02)
  release(o, [o, lp, g])
}

/** The helium pump: a soft low-passed noise thump with a low sine under it. */
function chug(rig: Rig, dest: AudioNode, t: number, level: number): void {
  const ctx = rig.ctx
  const n = ctx.createBufferSource()
  n.buffer = rig.pink
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 220
  const g = env(ctx, dest, t, 0.8 * level, 0.05, 0.22)
  n.connect(lp)
  lp.connect(g)
  n.start(t, nextOffset(rig), 0.25)
  release(n, [n, lp, g])

  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(70, t)
  o.frequency.exponentialRampToValueAtTime(45, t + 0.15)
  const og = env(ctx, dest, t, 0.3 * level, 0.01, 0.18)
  o.connect(og)
  o.start(t)
  o.stop(t + 0.2)
  release(o, [o, og])
}

/** A tiny mechanical click: a very short band-passed white noise burst. */
function mechClick(rig: Rig, dest: AudioNode, t: number, level: number): void {
  const ctx = rig.ctx
  const n = ctx.createBufferSource()
  n.buffer = rig.white
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 2500
  bp.Q.value = 2
  const g = env(ctx, dest, t, 0.6 * level, 0.001, 0.012)
  n.connect(bp)
  bp.connect(g)
  n.start(t, nextOffset(rig), 0.015)
  release(n, [n, bp, g])
}
