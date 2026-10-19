/**
 * W4 device sounds: the registry the kiosks, the draw centre and the lab register their sound patterns in, and the plain data a pattern speaks in.
 * Pure (no Web Audio, no React, no sim singleton): patterns are testable in node, and the engine (engine.ts) turns what they say into sound.
 *
 * HOW TO ADD SOUNDS (agents S1 and S2): write a file `src/audio/devices/<yourName>Patterns.ts` that either
 *   - calls `registerDevicePattern(pattern)` at module level, or
 *   - exports `devicePatterns: DevicePattern[]` (DeviceSounds.tsx loads every `*Patterns.ts` file of this folder by glob and registers those).
 * A pattern is `{ id, plan(window, sink) }`. The engine calls `plan` about 20 times a second while you can hear anything, with the audio-clock window
 * [from, to) to fill. Say what to play with `sink.event(...)` (a tone or a burst of band-passed noise at an audio time, with the world position it
 * comes from) and what runs continuously with `sink.drone(...)` (a whine or a hum whose level and pitch you set each call). Keep patterns periodic
 * on the audio clock (an event's time depends on its index only), so consecutive windows join up with no gap and no repeat: `periodic()` does that.
 * Read the sim yourself (`import { sim } from '@/sim'`) inside `plan`; never inside a function that runs at import time.
 *
 * Loudness: `peak` is 0..1 before the engine's master trim (about -14 dBFS at 1). The engine multiplies it by `soundGain` (distance and walls).
 */
import { areaAt } from '@/sim/places'
import type { Vec3 } from '@/sim/types'

export type DeviceWave = 'sine' | 'triangle' | 'square' | 'sawtooth'

/** A pitched voice: a short attack, an exponential decay over `dur`, and a glide from `f0` to `f1` Hz (equal for a steady tone). */
export interface ToneEvent {
  kind: 'tone'
  /** Audio-clock seconds. */
  t: number
  f0: number
  f1: number
  dur: number
  peak: number
  wave: DeviceWave
  attack: number
  /** Where it comes from (world metres); null or absent: right here, no distance fall-off. */
  at?: Vec3 | null
}

/** A burst of band-passed noise: its centre glides from `f0` to `f1` Hz, `q` sets how narrow it is (a whoosh is wide, a click is tight). */
export interface NoiseEvent {
  kind: 'noise'
  t: number
  f0: number
  f1: number
  q: number
  dur: number
  peak: number
  attack: number
  at?: Vec3 | null
}

export type DeviceEvent = ToneEvent | NoiseEvent

/** A continuous voice. The engine owns its oscillators; the pattern says, on every plan, how loud and how high it is now (level 0 or no call: it fades out). */
export interface DroneSpec {
  /** Unique across patterns ("lab:cfg0"). */
  id: string
  voice: 'whine' | 'hum'
  hz: number
  /** 0..1 before the master trim. */
  level: number
  at?: Vec3 | null
}

export interface PlanWindow {
  /** The audio-clock window to fill: [from, to). */
  from: number
  to: number
  /** The audio clock now (`from` is never behind it). */
  now: number
  /** Sim seconds, and how many sim seconds pass in a real one (the demo's 1x, 2x or 4x; 0 paused). */
  simTime: number
  simSpeed: number
  /** Where you (or the focused room) are listening from. */
  listener: Vec3
}

export interface PatternSink {
  event(e: DeviceEvent): void
  drone(d: DroneSpec): void
}

export interface DevicePattern {
  id: string
  plan(w: PlanWindow, out: PatternSink): void
}

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

const patterns = new Map<string, DevicePattern>()
let version = 0

/** Register (or replace) a pattern; returns the function that removes it. */
export function registerDevicePattern(p: DevicePattern): () => void {
  patterns.set(p.id, p)
  version++
  return () => {
    if (patterns.get(p.id) === p) {
      patterns.delete(p.id)
      version++
    }
  }
}

export function devicePatterns(): readonly DevicePattern[] {
  return [...patterns.values()]
}

/** Bumped whenever the set of patterns changes (the engine re-reads the list only then). */
export function registryVersion(): number {
  return version
}

/** Register every pattern a set of modules exports as `devicePatterns` (what `import.meta.glob('./*Patterns.ts', { eager: true })` returns). */
export function registerPatternModules(modules: Readonly<Record<string, unknown>>): () => void {
  const offs: (() => void)[] = []
  for (const mod of Object.values(modules)) {
    const list = (mod as { devicePatterns?: unknown } | null)?.devicePatterns
    if (Array.isArray(list)) for (const p of list as DevicePattern[]) offs.push(registerDevicePattern(p))
  }
  return () => {
    for (const off of offs) off()
  }
}

// ---------------------------------------------------------------------------------------------
// Where a sound is heard
// ---------------------------------------------------------------------------------------------

/** Full volume within this many metres of a source, silent beyond `FAR`; between them the level falls off smoothly (squared). */
export const NEAR = 2.5
export const FAR = 16
/** A sound from another room is muffled by this much (walls and doors). */
export const OTHER_ROOM = 0.5

const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0)

/** The level (0..1) at which a listener at `listener` hears a source at `at` (null: no fall-off). */
export function soundGain(listener: Vec3, at: Vec3 | null | undefined): number {
  if (!at) return 1
  const d = Math.hypot(listener.x - at.x, listener.y - at.y, listener.z - at.z)
  const t = clamp01(1 - (d - NEAR) / (FAR - NEAR))
  const g = t * t
  if (g <= 0) return 0
  const here = areaAt(listener.x, listener.z)
  const there = areaAt(at.x, at.z)
  return here?.id === there?.id ? g : g * OTHER_ROOM
}

// ---------------------------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------------------------

/**
 * The times `offset + k * period` (k an integer) that fall in [from, to): periodic on the audio clock, so any window can be generated on its own
 * and consecutive windows join with no gap and no repeat. `fn` is called with each time and its index.
 */
export function periodic(from: number, to: number, period: number, offset: number, fn: (t: number, k: number) => void): void {
  if (!(period > 0) || !(to > from)) return
  let k = Math.ceil((from - offset) / period - 1e-9)
  for (let t = offset + k * period; t < to - 1e-12; k++, t = offset + k * period) {
    if (t >= from - 1e-9) fn(t, k)
  }
}

/** A short click: a very brief tight band of noise around `hz`. */
export function click(t: number, hz: number, peak: number, at?: Vec3 | null): NoiseEvent {
  return { kind: 'noise', t, f0: hz, f1: hz, q: 2.2, dur: 0.014, peak, attack: 0.001, at }
}

/** A plain pitched blip. */
export function blip(t: number, hz: number, dur: number, peak: number, at?: Vec3 | null, wave: DeviceWave = 'sine'): ToneEvent {
  return { kind: 'tone', t, f0: hz, f1: hz, dur, peak, wave, attack: 0.004, at }
}
