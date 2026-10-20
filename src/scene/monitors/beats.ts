/**
 * R3 live patient monitors: the beats and the breaths behind every trace. Pure, seeded and allocation-free after construction.
 *
 * A patient's heart is a ring of R-wave times on the display clock (clock.ts), generated AHEAD of the sweep by the pump: the slot painter (paintSlot.ts)
 * reads the beats of the sweep it paints, and the HR on the screen is counted FROM those beats (60 / the mean of the last RR intervals), so the number
 * and the trace always agree. The breaths are a second ring (inspiration starts) for the capnogram and the impedance trace.
 *
 *   RR(n) = 60 / HR * (1 + RSA sin(2 pi t / breath + phase) + jitter h(seed, n))   respiratory sinus arrhythmia plus a seeded beat-to-beat wobble
 *   breath(n) = 60 / RR * (1 + jitter h(seed, n))                                   a ventilator's breaths have no jitter
 *
 * The same seed, start time and rate parameters always give the same beats, however the extension is cut into calls.
 */
import { mixSeed } from '@/sim/rng'

/** A seeded number in -1..1 for (seed, n): the beat-to-beat wobble. */
export function hashSigned(seed: number, n: number): number {
  return (mixSeed(seed, n + 1) / 4294967296) * 2 - 1
}

/** A seeded number in 0..1 for (seed, n). */
export function hashUnit(seed: number, n: number): number {
  return mixSeed(seed, n + 1) / 4294967296
}

/**
 * A ring of event times (seconds, increasing): the beats or the breaths of one patient. Events are numbered from 0 for ever; the ring keeps the last
 * `cap` of them, which covers every sweep a painter can still be drawing (the pump keeps about two fast sweeps and two slow sweeps around now).
 */
export class TimeRing {
  readonly times: Float64Array
  /** Number of the oldest event kept, and how many are kept. */
  first = 0
  count = 0

  constructor(readonly cap: number) {
    this.times = new Float64Array(cap)
  }

  /** The number of the next event to generate. */
  get end(): number {
    return this.first + this.count
  }

  /** Time of event `n` (it must be kept: first <= n < end). */
  at(n: number): number {
    return this.times[n % this.cap]
  }

  /** Time of the newest event, or -Infinity. */
  last(): number {
    return this.count === 0 ? -Infinity : this.at(this.end - 1)
  }

  push(t: number): void {
    const n = this.end
    this.times[n % this.cap] = t
    if (this.count < this.cap) this.count++
    else this.first++
  }

  clear(): void {
    this.first = 0
    this.count = 0
  }

  /** The number of the last event at or before `t`, or `first - 1` when every kept event is later. Binary search, allocation-free. */
  indexAt(t: number): number {
    let lo = this.first
    let hi = this.end - 1
    if (this.count === 0 || this.at(lo) > t) return this.first - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.at(mid) <= t) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Events per minute from the last `n` intervals ending at or before `t` (0 when there are fewer than 2 events). */
  rateAt(t: number, n: number): number {
    const i = this.indexAt(t)
    if (i - 1 < this.first) return 0
    const j = Math.max(this.first, i - n)
    const span = this.at(i) - this.at(j)
    return span > 0 ? (60 * (i - j)) / span : 0
  }
}

/** What drives the heart while a stretch of beats is generated (set by the pump from the vitals model; read, never kept). */
export interface HeartDrive {
  /** Target rate, beats per minute. */
  hr: number
  /** Respiratory sinus arrhythmia depth (fraction of the RR interval). */
  rsa: number
  /** Breath period (seconds) the RSA follows. */
  breathPeriod: number
  /** Seeded beat-to-beat wobble (fraction of the RR interval). */
  jitter: number
}

/** The RR interval (seconds) of the beat that starts at `t`, beat number `n`. */
export function rrInterval(seed: number, n: number, t: number, d: HeartDrive): number {
  const base = 60 / Math.max(30, Math.min(200, d.hr))
  const phase = hashUnit(seed, 7) * Math.PI * 2
  const rsa = d.rsa * Math.sin((2 * Math.PI * t) / Math.max(1, d.breathPeriod) + phase)
  const rr = base * (1 + rsa + d.jitter * hashSigned(seed, n))
  return rr < 0.3 ? 0.3 : rr > 2 ? 2 : rr
}

/** Start a heart at `t0` (the first beat lands within one RR after it, at a seeded offset). */
export function startBeats(ring: TimeRing, seed: number, t0: number, d: HeartDrive): void {
  ring.clear()
  ring.push(t0 + hashUnit(seed, 3) * (60 / Math.max(30, d.hr)))
}

/** Generate beats until the newest is later than `until`. */
export function extendBeats(ring: TimeRing, seed: number, until: number, d: HeartDrive): void {
  if (ring.count === 0) startBeats(ring, seed, until, d)
  let guard = 0
  while (ring.last() <= until && guard++ < 4096) {
    const n = ring.end - 1
    const t = ring.at(n)
    ring.push(t + rrInterval(seed, n, t, d))
  }
}

/** What drives the breathing while a stretch of breaths is generated. */
export interface BreathDrive {
  /** Breaths per minute. */
  rr: number
  /** Seeded breath-to-breath wobble (0 on the ventilator). */
  jitter: number
}

export function breathInterval(seed: number, n: number, d: BreathDrive): number {
  const base = 60 / Math.max(4, Math.min(40, d.rr))
  return base * (1 + d.jitter * hashSigned(seed ^ 0x5bd1e995, n))
}

export function startBreaths(ring: TimeRing, seed: number, t0: number, d: BreathDrive): void {
  ring.clear()
  ring.push(t0 + hashUnit(seed, 5) * (60 / Math.max(4, d.rr)))
}

/** Generate breaths (inspiration starts) until the newest is later than `until`. */
export function extendBreaths(ring: TimeRing, seed: number, until: number, d: BreathDrive): void {
  if (ring.count === 0) startBreaths(ring, seed, until, d)
  let guard = 0
  while (ring.last() <= until && guard++ < 4096) {
    const n = ring.end - 1
    ring.push(ring.at(n) + breathInterval(seed, n, d))
  }
}

/** The heart rate the monitor shows at `t`: counted from the last 8 beats, rounded (0 before there are two). */
export function displayedHr(beats: TimeRing, t: number): number {
  return Math.round(beats.rateAt(t, 8))
}

/** The respiration rate the monitor shows at `t`: counted from the last 4 breaths. */
export function displayedRr(breaths: TimeRing, t: number): number {
  return Math.round(breaths.rateAt(t, 4))
}
