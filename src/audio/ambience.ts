/**
 * Ambience while you walk the hospital (W1): footsteps, the room tone of each area, door whooshes, the pod chime and
 * the lift ding. Web Audio, synthesized, no files. Ambience.tsx starts and stops the engine and supplies its inputs.
 *
 * W3: a footstep is a HEEL STRIKE of your own legs, not a rate timed from your speed. The crowd's footfall planner counts every landing of
 * your feet in `walkStride` (src/scene/player/state.ts), and the engine plays one step for each increment of `walkStride.steps`: so a
 * stop's last shuffle, a step backwards and a turn on the spot make a sound, a sound never lags behind a foot by more than a tick, and a
 * stride that stops stepping goes silent.
 *
 * The first half is pure (the steps you hear, the tone of each area, one-shot triggers with their cooldowns): no audio, no
 * React, no sim singleton, so it runs under vitest in node.
 *
 * The engine is one AudioContext, created only once audio is unlocked and you are walking. Everything is built once:
 * a looping pink bed carries the room tone, a looping white source carries the footsteps and the door whooshes (each
 * event is a gain envelope on it), and four sine bells ring round-robin for the pod chime and the lift ding. Nothing
 * is allocated per tick. Like the scanner sounds it plans 120 ms ahead on a 50 ms tick, suspends when the tab is hidden
 * or the sound has been quiet for a while, and mutes with M (the master fades to zero).
 *
 * Levels: AMBIENCE_MASTER is the scanner's own trim (0.2), and the voices here are softer than the scanner's knocks and
 * chugs (their envelopes peak at 0.55 and 0.8 before the trim). These are envelope estimates, not a listening test.
 */
import type { Area, AreaKind } from '@/sim/places'
import type { Vec2 } from '@/sim/types'
import { walkStride } from '@/scene/player/state'
import { clamp01, noiseSamples } from './patterns'

// ---------------------------------------------------------------------------------------------
// Pure timing and decisions (node-testable)
// ---------------------------------------------------------------------------------------------

// Footsteps ---------------------------------------------------------------------------------

/** The part of your stride the footsteps read: the fields of `walkStride` (src/scene/player/state.ts). */
export interface AmbienceStride {
  /** Heel strikes since the page loaded: one step is played for each increment. */
  readonly steps: number
  /** Which foot struck last: 0 left, 1 right. */
  readonly foot: number
  /** The body's speed at the last strike (m/s) and the run blend of the legs (0 walking .. 1 running). */
  readonly strikeSpeed: number
  readonly run: number
}

/** The most steps one tick plays: after a Jump, a long pause or a tab that was hidden the count has moved on by more than you walked, and a burst of steps would be a glitch. */
export const STEP_BURST_MAX = 3
/** Spacing of the steps of a burst (s): two strikes inside one tick are heard as two. */
const STEP_BURST_GAP_S = 0.03

/** Heel strikes to play now: the increase of the stride's count since the engine last looked (`seen`), at most `STEP_BURST_MAX`; none if it did not grow (or restarted). */
export function strikesSince(seen: number, steps: number): number {
  const n = steps - seen
  if (!(n > 0)) return 0
  return n > STEP_BURST_MAX ? STEP_BURST_MAX : Math.floor(n)
}

/** How one step sounds: its loudness (an envelope peak, before the master trim), how long it rings (s) and how far its band is pulled down (heavier when running). */
export interface StepVoice {
  peak: number
  decayS: number
  /** Multiplies the foot's band: 1 walking, lower running. */
  band: number
}

/**
 * The voice of a step from the speed at the strike and the run blend: a shuffle at a stop is soft, a walk is a firm step, a run is louder, longer and darker.
 * Always above 0 and never above `STEP_PEAK`.
 */
export function stepVoice(strikeSpeed: number, run: number, out: StepVoice = { peak: 0, decayS: 0, band: 1 }): StepVoice {
  const w = clamp01(strikeSpeed / 3.2)
  const r = clamp01(run)
  out.peak = STEP_PEAK * (0.72 + 0.22 * w + 0.06 * r)
  out.decayS = 0.07 + 0.03 * r
  out.band = 1 - 0.12 * r
  return out
}

// Room tone -------------------------------------------------------------------------------------

export type RoomTone = 'airy' | 'corridor' | 'busy' | 'quiet' | 'outdoor' | 'hum' | 'machine'

/**
 * Each tone is a filtered-noise bed. The low-pass cutoff sets its colour (higher is airier) and the level its loudness,
 * 0..1 before the bed's peak. Patient rooms are the quietest; the ER is a little busier than a corridor.
 *
 * R2, level 2 (the robotic surgery suite): `hum` is the quiet clinical air-handling of the suite, darker and softer than a corridor; `machine` is the
 * robotic OR's, a touch louder and a touch brighter than the hum (the cart's fans, the anaesthesia machine, the room's air), still well under the ER.
 */
export const ROOM_TONES: Record<RoomTone, { cutoffHz: number; level: number }> = {
  airy: { cutoffHz: 2400, level: 0.6 },
  corridor: { cutoffHz: 900, level: 0.45 },
  busy: { cutoffHz: 1500, level: 0.8 },
  quiet: { cutoffHz: 420, level: 0.2 },
  outdoor: { cutoffHz: 3000, level: 0.35 },
  hum: { cutoffHz: 560, level: 0.3 },
  machine: { cutoffHz: 760, level: 0.42 },
}

/**
 * The room tone of an area. Named areas first, where the mood matters (lobby and atrium airy, ER and triage busy,
 * the quiet room quiet, the corridors soft); then by kind. Outside the building (null) is `outdoor`. Level 2 (R2) has its own: a quiet clinical `hum`
 * throughout the suite, the robotic OR a little more `machine`, and the family lounge `quiet` (a waiting room, away from the machines).
 */
export function toneForArea(area: Pick<Area, 'id' | 'kind'> | null): RoomTone {
  if (area === null) return 'outdoor'
  switch (area.id) {
    case 'lobby':
    case 'atrium':
    case 'loungeA':
      return 'airy'
    case 'er':
    case 'triage':
      return 'busy'
    case 'quietB':
      return 'quiet'
    case 'spine':
    case 'corridorA':
    case 'corridorB':
    case 'core':
    case 'liftA':
    case 'liftB':
      return 'corridor'
    case 'l2Or':
    case 'l2Cryo': // R4: the CT and the cryo console
      return 'machine'
    case 'l2Lounge':
      return 'quiet'
    case 'l2LiftA':
    case 'l2LiftB':
    case 'l2Corridor':
    case 'l2PreOp':
    case 'l2Staff':
    case 'l2Sterile':
    case 'l2Hall':
    case 'l2Pacu':
    case 'l2CryoControl':
      return 'hum'
  }
  return toneByKind(area.kind)
}

function toneByKind(kind: AreaKind): RoomTone {
  switch (kind) {
    case 'public':
      return 'airy'
    case 'clinical':
      return 'busy'
    case 'room':
      return 'quiet'
    case 'staff':
    case 'robot':
    case 'service':
      return 'corridor'
  }
}

/** The room tone changes over this many seconds (a cross-fade of colour and level). */
export const TONE_FADE_S = 1

// One-shots --------------------------------------------------------------------------------------

/** How close you must come to set a sound off (`enterM`), how far you must go to set it again (`exitM`), and the gap between two of the same kind. */
export interface Reach {
  enterM: number
  exitM: number
  cooldownS: number
}

/** Auto doors: a whoosh once per approach. */
export const DOOR_REACH: Reach = { enterM: 2, exitM: 3.5, cooldownS: 4 }
/** A pod moving past: the chime once per pass. */
export const POD_REACH: Reach = { enterM: 3, exitM: 4.5, cooldownS: 6 }
/** The lift lobby: the ding once per visit. A visit ends when you walk clear of the wider radius. */
export const LIFT_REACH: Reach = { enterM: 2.5, exitM: 4, cooldownS: 10 }
/** A pod faster than this (m/s) is passing, not parked. */
export const POD_MOVING_SPEED = 0.2

/** One approach's memory. `armed` is true until you come in close; `lastAt` is the audio time of the last sound. */
export interface Trigger {
  armed: boolean
  lastAt: number
}

export function newTrigger(): Trigger {
  return { armed: true, lastAt: Number.NEGATIVE_INFINITY }
}

/**
 * Feeds one distance sample and says whether a sound starts on it. It starts when you come within `enterM` after being
 * beyond `exitM` (or the first time, if you start close), and the cooldown has passed. Coming in close always uses up
 * the approach, even when the cooldown blocks the sound, so the sound never plays late while you stand still.
 */
export function stepTrigger(trigger: Trigger, dist: number, now: number, reach: Reach): boolean {
  if (dist > reach.exitM) trigger.armed = true
  if (!trigger.armed || dist > reach.enterM) return false
  trigger.armed = false
  if (now - trigger.lastAt < reach.cooldownS) return false
  trigger.lastAt = now
  return true
}

/** The pod chime: a pod passing within reach, and moving. A parked pod still uses up the approach, so it never chimes late. */
export function podChimeDue(trigger: Trigger, dist: number, speed: number, now: number): boolean {
  const hit = stepTrigger(trigger, dist, now, POD_REACH)
  return hit && speed >= POD_MOVING_SPEED
}

// UI cues -----------------------------------------------------------------------------------

/**
 * One-shots that the screen asks for (R2: the soft ding behind your lift ride's cover, src/ui/liftRide.store.ts). A counter, not a call: the engine looks at
 * it on every tick, plays the ding on its own rig (so the mute, the unlock and the pause rule it like every other sound here), and a cue that arrives
 * while the engine is silent (muted, hidden, paused) is dropped, never played late.
 */
const cues = { ding: 0 }

/** Ask for the lift ding. Allocation-free; safe to call with no engine running. */
export function cueLiftDing(): void {
  cues.ding++
}

/** How many lift dings have been asked for (tests). */
export function liftDingCues(): number {
  return cues.ding
}

// ---------------------------------------------------------------------------------------------
// The engine (Web Audio, no React)
// ---------------------------------------------------------------------------------------------

/** The part of you the ambience reads. `PlayerView` from the sim satisfies it. */
export interface AmbiencePlayer {
  readonly x: number
  readonly z: number
  readonly speed: number
  readonly mode: string
}

/** The part of a pod driver the ambience reads. `Driver` from the sim satisfies it. */
export interface AmbiencePod {
  readonly pod: { readonly id: string; readonly position: { readonly x: number; readonly z: number }; readonly speed: number }
}

/** What the engine reads from the outside world. Ambience.tsx supplies it from the stores and the sim. */
export interface AmbienceInputs {
  /** You, or null. Read on every tick, because `sim` is a live binding. */
  player(): AmbiencePlayer | null
  /** Your stride (the heel strikes of your legs). Absent: `walkStride`, which is where the crowd writes it. */
  stride?(): AmbienceStride
  /** The live pod array. It is read, never copied. */
  pods(): readonly AmbiencePod[]
  /** The area under a point, or null outside the building. `areaAt` from the sim. */
  area(x: number, z: number): Pick<Area, 'id' | 'kind'> | null
  muted(): boolean
  unlocked(): boolean
  hidden(): boolean
  /** The centres of the auto doors. */
  autoDoors: readonly Vec2[]
  /** The lift standing spots. */
  lifts: readonly Vec2[]
}

const WATCH_MS = 250
const TICK_MS = 50
const LOOKAHEAD_S = 0.12
const ONESHOT_DELAY_S = 0.02
const FADE_S = 0.3
const SUSPEND_AFTER_S = 2
const NOISE_S = 3

/**
 * The master level, the same trim the scanner sounds use (scanners.ts: MASTER_TRIM 0.2). Each voice below is an envelope
 * peak before it, and the band-passed noise voices come out at about a third of their envelope.
 */
export const AMBIENCE_MASTER = 0.2
const STEP_PEAK = 0.5
const BED_PEAK = 0.3
const WHOOSH_PEAK = 0.5
const CHIME_PEAK = 0.2
const DING_PEAK = 0.25
/** Left and right footsteps differ in colour, so a walk sounds less like a loop. */
const STEP_HZ_LEFT = 480
const STEP_HZ_RIGHT = 620
const WHOOSH_HZ_FROM = 300
const WHOOSH_HZ_TO = 1200
const WHOOSH_S = 0.9
/** The pod chime: two rising notes, A5 then D6. */
const CHIME_HZ: readonly [number, number] = [880, 1174.66]
const DING_HZ = 1318.5
const DING_PARTIAL_HZ = 2637
const BELLS = 4

interface Bell {
  osc: OscillatorNode
  gain: GainNode
}

interface Rig {
  ctx: AudioContext
  master: GainNode
  bedFilter: BiquadFilterNode
  bedGain: GainNode
  stepFilter: BiquadFilterNode
  stepGain: GainNode
  whooshFilter: BiquadFilterNode
  whooshGain: GainNode
  bells: Bell[]
  bellNext: number
}

function isWalking(p: AmbiencePlayer | null): p is AmbiencePlayer {
  return p !== null && p.mode !== 'overview'
}

function distance(a: { readonly x: number; readonly z: number }, x: number, z: number): number {
  const dx = a.x - x
  const dz = a.z - z
  return Math.sqrt(dx * dx + dz * dz)
}

export class AmbienceEngine {
  private rig: Rig | null = null
  private broken = false
  private watchTimer: ReturnType<typeof setInterval> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private masterOn = false
  private cursor = 0
  /** The count of heel strikes already played (-1 until the first tick of a walk adopts the current one: no burst of steps on starting to walk). */
  private seenSteps = -1
  /** The count of `cues.ding` already played or dropped. */
  private seenDing = cues.ding
  private readonly voice: StepVoice = { peak: 0, decayS: 0, band: 1 }
  private lastAudible = Number.NEGATIVE_INFINITY
  private tone: RoomTone | null = null
  private readonly doorTriggers: Trigger[]
  private readonly liftTriggers: Trigger[]
  private readonly podTriggers = new Map<string, Trigger>()
  private readonly onVisibility = (): void => this.watch()

  constructor(private readonly inputs: AmbienceInputs) {
    this.doorTriggers = inputs.autoDoors.map(() => newTrigger())
    this.liftTriggers = inputs.lifts.map(() => newTrigger())
  }

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
    this.resetPlayback()
    if (rig) void rig.ctx.close().catch(() => undefined)
  }

  /** 4 Hz: decides whether sound should run, fades the master, and suspends the context when it is quiet. */
  private watch(): void {
    const walking = isWalking(this.inputs.player())
    const hidden = this.inputs.hidden()
    const live = walking && this.inputs.unlocked() && !this.inputs.muted() && !hidden
    // a ding asked for while nothing can be heard is dropped, so it never plays late when the sound comes back (also before the context exists)
    if (!live) this.seenDing = cues.ding
    // The AudioContext exists only once audio is unlocked and you are walking.
    if (live && this.rig === null && !this.broken) this.rig = this.createRig()
    const rig = this.rig
    if (rig === null) return
    const { ctx } = rig
    const now = ctx.currentTime
    if (live) {
      this.lastAudible = now
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    }
    if (live !== this.masterOn) {
      this.masterOn = live
      rampTo(rig.master.gain, live ? AMBIENCE_MASTER : 0, now, FADE_S)
    }
    if (live) this.startTicking()
    else {
      this.stopTicking()
      this.seenSteps = -1
    }
    if (hidden) suspend(ctx)
    else if (!live && now - this.lastAudible > SUSPEND_AFTER_S) suspend(ctx)
  }

  private startTicking(): void {
    if (this.tickTimer === null) this.tickTimer = setInterval(() => this.tick(), TICK_MS)
  }

  private stopTicking(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer)
    this.tickTimer = null
  }

  /** 50 ms: plans the footsteps, the room tone and the one-shots for the next 120 ms. Runs only while walking. */
  private tick(): void {
    const rig = this.rig
    if (rig === null) return
    const player = this.inputs.player()
    if (!isWalking(player)) return
    const { ctx } = rig
    const now = ctx.currentTime
    const from = Math.max(this.cursor, now)
    const to = now + LOOKAHEAD_S
    if (to <= from) return
    this.cursor = to
    this.playFootsteps(rig, from)
    this.updateTone(rig, player, now)
    this.playCues(rig, now)
    this.updateOneShots(rig, player, now)
    this.lastAudible = now
  }

  /**
   * The lift ding of your ride (`cueLiftDing`): one soft bell. You arrive standing in the other lobby, so the lobby triggers are used up with it (the
   * ding for walking into a lobby would otherwise ring a second time on top of it); they come back when you walk clear of the lobby.
   */
  private playCues(rig: Rig, now: number): void {
    if (cues.ding === this.seenDing) return
    this.seenDing = cues.ding
    liftDing(rig, now + ONESHOT_DELAY_S)
    for (const t of this.liftTriggers) {
      t.armed = false
      t.lastAt = now
    }
  }

  /** One step for each heel strike of your legs since the last tick (the tick is 50 ms, so a step is heard within 50 ms of the foot landing). */
  private playFootsteps(rig: Rig, at: number): void {
    const stride = this.inputs.stride ? this.inputs.stride() : walkStride
    if (this.seenSteps < 0) {
      this.seenSteps = stride.steps
      return
    }
    const n = strikesSince(this.seenSteps, stride.steps)
    this.seenSteps = stride.steps
    if (n === 0) return
    stepVoice(stride.strikeSpeed, stride.run, this.voice)
    // the latest strike was `stride.foot`; the ones before it in this tick alternate behind it
    for (let i = 0; i < n; i++) footstep(rig, at + i * STEP_BURST_GAP_S, (stride.foot + n - 1 - i) & 1, this.voice)
  }

  private updateTone(rig: Rig, player: AmbiencePlayer, now: number): void {
    const tone = toneForArea(this.inputs.area(player.x, player.z))
    if (tone === this.tone) return
    this.tone = tone
    morphBed(rig, tone, now)
  }

  private updateOneShots(rig: Rig, player: AmbiencePlayer, now: number): void {
    const at = now + ONESHOT_DELAY_S
    const { autoDoors, lifts } = this.inputs
    for (let i = 0; i < autoDoors.length; i++) {
      if (stepTrigger(this.doorTriggers[i], distance(autoDoors[i], player.x, player.z), now, DOOR_REACH)) doorWhoosh(rig, at)
    }
    for (let i = 0; i < lifts.length; i++) {
      if (stepTrigger(this.liftTriggers[i], distance(lifts[i], player.x, player.z), now, LIFT_REACH)) liftDing(rig, at)
    }
    const pods = this.inputs.pods()
    for (let i = 0; i < pods.length; i++) {
      const pod = pods[i].pod
      let trigger = this.podTriggers.get(pod.id)
      if (trigger === undefined) {
        trigger = newTrigger()
        this.podTriggers.set(pod.id, trigger)
      }
      if (podChimeDue(trigger, distance(pod.position, player.x, player.z), pod.speed, now)) podChime(rig, at)
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

  /** A new context starts its clock at zero, so every time-based state starts over with it. */
  private resetPlayback(): void {
    this.masterOn = false
    this.cursor = 0
    this.seenSteps = -1
    this.seenDing = cues.ding
    this.lastAudible = Number.NEGATIVE_INFINITY
    this.tone = null
    for (const t of this.doorTriggers) resetTrigger(t)
    for (const t of this.liftTriggers) resetTrigger(t)
    this.podTriggers.clear()
  }
}

function resetTrigger(t: Trigger): void {
  t.armed = true
  t.lastAt = Number.NEGATIVE_INFINITY
}

/** Builds the whole graph once. Every sound after this only changes parameters of these nodes. */
function buildRig(ctx: AudioContext): Rig {
  const master = ctx.createGain()
  master.gain.value = 0
  master.connect(ctx.destination)

  // The bed: pink noise through a low-pass whose cutoff and level morph between room tones.
  const bedSrc = ctx.createBufferSource()
  bedSrc.buffer = noiseBuffer(ctx, 'pink', 23)
  bedSrc.loop = true
  const bedFilter = ctx.createBiquadFilter()
  bedFilter.type = 'lowpass'
  bedFilter.frequency.value = ROOM_TONES.corridor.cutoffHz
  bedFilter.Q.value = 0.5
  const bedGain = ctx.createGain()
  bedGain.gain.value = 0
  bedSrc.connect(bedFilter)
  bedFilter.connect(bedGain)
  bedGain.connect(master)

  const white = noiseBuffer(ctx, 'white', 29)
  // Footsteps: a short band-passed burst. The band alternates between the two feet.
  const stepSrc = ctx.createBufferSource()
  stepSrc.buffer = white
  stepSrc.loop = true
  const stepFilter = ctx.createBiquadFilter()
  stepFilter.type = 'bandpass'
  stepFilter.frequency.value = STEP_HZ_LEFT
  stepFilter.Q.value = 0.9
  const stepGain = ctx.createGain()
  stepGain.gain.value = 0
  stepSrc.connect(stepFilter)
  stepFilter.connect(stepGain)
  stepGain.connect(master)

  // Door whooshes: the same noise, band-passed with a rising sweep.
  const whooshSrc = ctx.createBufferSource()
  whooshSrc.buffer = white
  whooshSrc.loop = true
  const whooshFilter = ctx.createBiquadFilter()
  whooshFilter.type = 'bandpass'
  whooshFilter.frequency.value = WHOOSH_HZ_FROM
  whooshFilter.Q.value = 0.7
  const whooshGain = ctx.createGain()
  whooshGain.gain.value = 0
  whooshSrc.connect(whooshFilter)
  whooshFilter.connect(whooshGain)
  whooshGain.connect(master)

  // Bells for the pod chime and the lift ding: sines that ring round-robin, each with its own envelope.
  const bells: Bell[] = []
  for (let i = 0; i < BELLS; i++) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = CHIME_HZ[0]
    const gain = ctx.createGain()
    gain.gain.value = 0
    osc.connect(gain)
    gain.connect(master)
    osc.start()
    bells.push({ osc, gain })
  }

  bedSrc.start()
  stepSrc.start(0, 1.1)
  whooshSrc.start(0, 2.2)
  return { ctx, master, bedFilter, bedGain, stepFilter, stepGain, whooshFilter, whooshGain, bells, bellNext: 0 }
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

/** Moves a parameter to `target` over `seconds`, from wherever it is now. */
function rampTo(param: AudioParam, target: number, now: number, seconds: number): void {
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(target, now + seconds)
}

/** Cross-fades the bed to a new room tone: its cutoff (colour) and level, over TONE_FADE_S. */
function morphBed(rig: Rig, tone: RoomTone, now: number): void {
  const spec = ROOM_TONES[tone]
  rampTo(rig.bedFilter.frequency, spec.cutoffHz, now, TONE_FADE_S)
  rampTo(rig.bedGain.gain, spec.level * BED_PEAK, now, TONE_FADE_S)
}

/** One footstep at audio time `t`: a short band-passed burst, the band alternating between the feet (side 0 left, 1 right). */
function footstep(rig: Rig, t: number, side: number, voice: StepVoice): void {
  const f = rig.stepFilter.frequency
  f.cancelScheduledValues(t)
  f.setValueAtTime((side === 0 ? STEP_HZ_LEFT : STEP_HZ_RIGHT) * voice.band, t)
  const g = rig.stepGain.gain
  g.cancelScheduledValues(t)
  g.setValueAtTime(0, t)
  g.linearRampToValueAtTime(voice.peak, t + 0.008)
  g.exponentialRampToValueAtTime(1e-4, t + voice.decayS)
}

/** A door whoosh: the noise swells and its band sweeps upward. */
function doorWhoosh(rig: Rig, t: number): void {
  const f = rig.whooshFilter.frequency
  f.cancelScheduledValues(t)
  f.setValueAtTime(WHOOSH_HZ_FROM, t)
  f.exponentialRampToValueAtTime(WHOOSH_HZ_TO, t + WHOOSH_S * 0.8)
  const g = rig.whooshGain.gain
  g.cancelScheduledValues(t)
  g.setValueAtTime(0, t)
  g.linearRampToValueAtTime(WHOOSH_PEAK, t + 0.18)
  g.exponentialRampToValueAtTime(1e-4, t + WHOOSH_S)
}

/** The pod chime: two gentle rising notes. */
function podChime(rig: Rig, t: number): void {
  ring(rig, t, CHIME_HZ[0], CHIME_PEAK, 0.9)
  ring(rig, t + 0.22, CHIME_HZ[1], CHIME_PEAK * 0.8, 1.1)
}

/** The lift ding: one bell with a faint octave partial. */
function liftDing(rig: Rig, t: number): void {
  ring(rig, t, DING_HZ, DING_PEAK, 2.2)
  ring(rig, t, DING_PARTIAL_HZ, DING_PEAK * 0.2, 1)
}

/** Rings the next bell in the round-robin at `freq`. The envelope rises in 10 ms and decays with `decayS`. */
function ring(rig: Rig, t: number, freq: number, peak: number, decayS: number): void {
  const bell = rig.bells[rig.bellNext]
  rig.bellNext = (rig.bellNext + 1) % rig.bells.length
  bell.osc.frequency.cancelScheduledValues(t)
  bell.osc.frequency.setValueAtTime(freq, t)
  const g = bell.gain.gain
  g.cancelScheduledValues(t)
  g.setValueAtTime(0, t)
  g.linearRampToValueAtTime(peak, t + 0.01)
  g.setTargetAtTime(0, t + 0.01, decayS / 5)
}
