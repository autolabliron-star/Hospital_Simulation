/**
 * Pure timing, pattern and decision logic for the scanner sounds. No Web Audio and no React, so it runs under vitest
 * in node. scanners.ts turns these events into sound.
 *
 * Patterns are periodic on the audio clock: an event's time depends only on its index, never on when it was asked
 * for. Any window can be generated on its own, and consecutive windows join up with no gaps and no repeats.
 */
import type { ImagingModality, ScannerPhase, ScannerState } from '@/sim/types'

/** The part of a scanner the sounds read. A ScannerState satisfies it. */
export type ScannerView = Pick<ScannerState, 'modality' | 'phase' | 'activity' | 'sequence' | 'exam'>

/** MRI rhythms, chosen by the sequence contrast (and the scout plane). */
export type MriPattern = 'scout' | 'T1' | 'T2' | 'FLAIR' | 'PD' | 'DWI'

/** What the engine should play for the focused machine. Every MRI kind has the helium chug underneath. */
export type SoundKind = 'silent' | 'mri:chug' | `mri:${MriPattern}` | 'ct:whir' | 'xray:armed' | 'us:armed'

export interface PlayDecision {
  kind: SoundKind
  /** 0..1: how loud the machine's own state is (MRI activity, CT rotor speed, X-ray flash). */
  level: number
}

/** The machine state the edge sounds compare between two samples. */
export interface MachineSnap {
  phase: ScannerPhase
  activity: number
}

/** One sound to start at audio time `t`. `level` is 0..1, before the master trim. */
export type VoiceEvent =
  | { kind: 'knock'; t: number; level: number; click: boolean }
  | { kind: 'chirp'; t: number; level: number }
  | { kind: 'buzz'; t: number; level: number; freq: number; dur: number }
  | { kind: 'chug'; t: number; level: number }
  | { kind: 'beep'; t: number; level: number }
  | { kind: 'click'; t: number; level: number }
  | { kind: 'chime'; t: number; level: number }

/** MRI knocking needs at least this activity. Between sequences the sim drops to about 0.15, so the room goes quiet. */
export const KNOCK_MIN_ACTIVITY = 0.4
/** The helium pump runs about every 1.2 s, idle or not. */
export const CHUG_PERIOD_S = 1.2
const CHUG_OFFSET_S = 0.4
/** T2 knocks come in pairs. Pairs per second, so the knock rate is twice this: about 3.5 knocks a second. */
export const T2_PAIRS_PER_S = 1.75
/** X-ray: one beep on each upward crossing of this activity. */
export const XRAY_CROSSING = 0.5
export const CT_PITCH_LOW_HZ = 110
export const CT_PITCH_HIGH_HZ = 260
/** CT whir gain at full rotor speed, before the master trim. */
export const CT_GAIN_MAX = 1
/** Time constant for CT spin-up and spin-down: about 95% of a step is reached in 1.5 s. */
export const CT_SMOOTH_TAU_S = 0.5

export function clamp01(x: number): number {
  return x > 0 ? (x < 1 ? x : 1) : 0
}

/** One-pole smoothing towards `target`. Exact for any `dt`, so the result does not depend on the frame rate. */
export function approach(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

/** True on the sample where a value rises through `threshold`. */
export function crossedUp(prev: number, curr: number, threshold: number): boolean {
  return prev < threshold && curr >= threshold
}

/** CT rotor pitch: rises linearly with speed. */
export function ctPitchHz(activity: number): number {
  return CT_PITCH_LOW_HZ + (CT_PITCH_HIGH_HZ - CT_PITCH_LOW_HZ) * clamp01(activity)
}

/** CT whir gain: silent at rest, rises with speed. */
export function ctGain(activity: number): number {
  return CT_GAIN_MAX * clamp01(activity) ** 1.5
}

/**
 * The MRI rhythm for a sequence. A scout plane always gives chirps. Contrasts with no MRI rhythm (`none`, the CT
 * phases `plain`, `arterial`, `portal`, anything unknown) give null, which means no knocks.
 */
export function mriPatternName(contrast: string | null | undefined, plane: string | null | undefined): MriPattern | null {
  if (plane === 'scout') return 'scout'
  switch (contrast) {
    case 'T1':
      return 'T1'
    case 'T2':
      return 'T2'
    case 'FLAIR':
      return 'FLAIR'
    case 'PD':
    case 'STIR':
      return 'PD'
    case 'DWI':
      return 'DWI'
    default:
      return null
  }
}

/** The MRI pattern that should be knocking now, or null (between sequences, not scanning, or no usable sequence). */
export function activeMriPattern(v: ScannerView): MriPattern | null {
  if (v.phase !== 'scanning' || !(v.activity >= KNOCK_MIN_ACTIVITY)) return null
  const seq = v.exam?.sequences[v.sequence]
  return seq ? mriPatternName(seq.contrast, seq.plane) : null
}

/** The MRI pattern named by a sound kind, or null for the chug and for every non-MRI kind. */
export function patternOfKind(kind: SoundKind): MriPattern | null {
  if (!kind.startsWith('mri:') || kind === 'mri:chug') return null
  return kind.slice(4) as MriPattern
}

/** A scanner state for `m`. A state for another modality, or none at all (sim not wired yet), reads as idle. */
export function viewOf(m: ImagingModality, scanner: ScannerView | null | undefined): ScannerView {
  if (scanner && scanner.modality === m) return scanner
  return { modality: m, phase: 'idle', activity: 0, sequence: -1, exam: null }
}

const SILENT: PlayDecision = { kind: 'silent', level: 0 }

/**
 * What the engine should play for the focused machine right now.
 *  - Nothing when no scanner room is focused, the sound is muted, or audio is not unlocked yet.
 *  - MRI: a rhythm while a sequence is knocking, otherwise the chug. Every MRI kind has the chug underneath.
 *  - CT: the whir, at the rotor speed.
 *  - X-ray: armed. Its beeps and clicks are edge sounds (see edgeEvents).
 *  - Ultrasound: armed, level 0. It is nearly silent; only a faint click when a sweep starts (edgeEvents).
 */
export function whatShouldPlay(
  focus: ImagingModality | null,
  scanner: ScannerView | null | undefined,
  muted: boolean,
  unlocked: boolean,
): PlayDecision {
  if (focus === null || muted || !unlocked) return SILENT
  const v = viewOf(focus, scanner)
  const level = clamp01(v.activity)
  switch (focus) {
    case 'mri': {
      const pattern = activeMriPattern(v)
      return pattern ? { kind: `mri:${pattern}`, level } : { kind: 'mri:chug', level }
    }
    case 'ct':
      return { kind: 'ct:whir', level }
    case 'xray':
      return { kind: 'xray:armed', level }
    case 'us':
      return { kind: 'us:armed', level: 0 }
  }
}

/** One periodic stream of events: a time every `period` seconds, starting `offset` seconds in. */
interface Stream {
  period: number
  offset: number
  make: (t: number, level: number) => VoiceEvent
}

const T2_PAIR_S = 1 / T2_PAIRS_PER_S

const MRI_STREAMS: Record<MriPattern, Stream[]> = {
  // quick light chirps, about 6 a second, for the whole scout
  scout: [{ period: 1 / 6, offset: 0, make: (t, l): VoiceEvent => ({ kind: 'chirp', t, level: 0.4 * l }) }],
  // fast, even knocks: 8 a second
  T1: [{ period: 1 / 8, offset: 0, make: (t, l): VoiceEvent => ({ kind: 'knock', t, level: l, click: false }) }],
  // slower paired knocks over a buzzy undertone: 1.75 pairs a second, so about 3.5 knocks a second
  T2: [
    { period: T2_PAIR_S, offset: 0, make: (t, l): VoiceEvent => ({ kind: 'knock', t, level: 0.8 * l, click: false }) },
    { period: T2_PAIR_S, offset: 0.1, make: (t, l): VoiceEvent => ({ kind: 'knock', t, level: 0.8 * l, click: false }) },
    { period: T2_PAIR_S, offset: 0, make: (t, l): VoiceEvent => ({ kind: 'buzz', t, level: 0.2 * l, freq: 140, dur: 0.25 }) },
  ],
  // a pulse train with pauses: three knocks, a short gap, repeat
  FLAIR: [0, 0.18, 0.36].map(
    (offset): Stream => ({ period: 0.9, offset, make: (t, l): VoiceEvent => ({ kind: 'knock', t, level: 0.9 * l, click: false }) }),
  ),
  // a medium knock with a higher click: 5 a second
  PD: [{ period: 0.2, offset: 0, make: (t, l): VoiceEvent => ({ kind: 'knock', t, level: 0.7 * l, click: true }) }],
  // a loud-ish high buzz in bursts, twice a second
  DWI: [{ period: 0.5, offset: 0, make: (t, l): VoiceEvent => ({ kind: 'buzz', t, level: 0.6 * l, freq: 1000, dur: 0.35 }) }],
}

/** Calls `emit` for every t = k * period + offset with from <= t < to. Integer k, so windows never overlap. */
function eachInWindow(from: number, to: number, period: number, offset: number, emit: (t: number) => void): void {
  if (!(to > from)) return
  for (let k = Math.ceil((from - offset) / period); ; k++) {
    const t = k * period + offset
    if (t >= to) return
    if (t >= from) emit(t)
  }
}

function streamEvents(streams: Stream[], from: number, to: number, level: number): VoiceEvent[] {
  const out: VoiceEvent[] = []
  for (const s of streams) eachInWindow(from, to, s.period, s.offset, (t) => out.push(s.make(t, level)))
  return out.sort((a, b) => a.t - b.t)
}

/** The knocks, buzzes or chirps of an MRI pattern in [from, to). A null pattern (no rhythm) gives no events. */
export function mriPatternEvents(pattern: MriPattern | null, from: number, to: number, activity: number): VoiceEvent[] {
  if (!pattern) return []
  return streamEvents(MRI_STREAMS[pattern], from, to, clamp01(activity))
}

/** The helium pump in [from, to): one soft chug every CHUG_PERIOD_S. */
export function chugEvents(from: number, to: number, activity: number): VoiceEvent[] {
  const a = clamp01(activity)
  const out: VoiceEvent[] = []
  eachInWindow(from, to, CHUG_PERIOD_S, CHUG_OFFSET_S, (t) => out.push({ kind: 'chug', t, level: 0.3 * (0.8 + 0.2 * a) }))
  return out
}

/**
 * Sounds that happen once, on a change between two samples: the X-ray beep on each upward crossing of the flash, the
 * mechanical clicks when a machine starts positioning or a sweep begins, and the CT start chime. With no earlier
 * sample (`prev` null, for example right after focusing a room) nothing fires, so entering a room is silent.
 */
export function edgeEvents(modality: ImagingModality, prev: MachineSnap | null, curr: MachineSnap, t: number): VoiceEvent[] {
  if (prev === null) return []
  const out: VoiceEvent[] = []
  const startedScanning = prev.phase !== 'scanning' && curr.phase === 'scanning'
  switch (modality) {
    case 'xray':
      if (crossedUp(prev.activity, curr.activity, XRAY_CROSSING)) out.push({ kind: 'beep', t, level: 0.5 })
      if (prev.phase !== 'positioning' && curr.phase === 'positioning') out.push({ kind: 'click', t, level: 0.5 })
      break
    case 'ct':
      if (startedScanning) out.push({ kind: 'chime', t, level: 0.4 })
      break
    case 'us':
      if (startedScanning) out.push({ kind: 'click', t, level: 0.04 })
      break
    case 'mri':
      break
  }
  return out
}

/**
 * Samples of white or pink noise in [-1, 1], from a seed. Pink uses Paul Kellet's filter. Deterministic, so a test
 * can check it and the engine builds the same buffers every time.
 */
export function noiseSamples(kind: 'white' | 'pink', length: number, seed: number): Float32Array {
  const out = new Float32Array(length)
  let s = seed >>> 0
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  let peak = 0
  for (let i = 0; i < length; i++) {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const white = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
    let v = white
    if (kind === 'pink') {
      b0 = 0.99886 * b0 + white * 0.0555179
      b1 = 0.99332 * b1 + white * 0.0750759
      b2 = 0.969 * b2 + white * 0.153852
      b3 = 0.8665 * b3 + white * 0.3104856
      b4 = 0.55 * b4 + white * 0.5329522
      b5 = -0.7616 * b5 - white * 0.016898
      v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
      b6 = white * 0.115926
    }
    out[i] = v
    peak = Math.max(peak, Math.abs(v))
  }
  if (peak > 0) for (let i = 0; i < length; i++) out[i] /= peak
  return out
}
