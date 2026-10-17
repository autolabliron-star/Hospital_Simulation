/**
 * Arrival curves and the deterministic arrival processes behind them (skill: "arrival curve by hour").
 * Everything is a pure function of the config tables and a seeded Rng.
 */
import { CONFIG } from '../config'
import { isNightHour } from '../day/roster'
import type { Rng } from '../rng'

export type Curve = readonly (readonly [number, number])[]

/** Rate from a piecewise-linear table of [clock hour, value]; zero before the first point and after the last. */
export function rateAt(curve: Curve, hour: number): number {
  const n = curve.length
  if (n === 0 || hour < curve[0][0] || hour > curve[n - 1][0]) return 0
  for (let i = 1; i < n; i++) {
    const [h1, v1] = curve[i]
    if (hour <= h1) {
      const [h0, v0] = curve[i - 1]
      return h1 === h0 ? v1 : v0 + ((v1 - v0) * (hour - h0)) / (h1 - h0)
    }
  }
  return curve[n - 1][1]
}

/** Level from a piecewise-linear table; holds the first value before it and the last value after it. */
export function levelAt(curve: Curve, hour: number): number {
  const n = curve.length
  if (n === 0) return 0
  if (hour <= curve[0][0]) return curve[0][1]
  if (hour >= curve[n - 1][0]) return curve[n - 1][1]
  return rateAt(curve, hour)
}

/** Clock hour for a sim time in seconds. */
export function hourAt(t: number): number {
  return CONFIG.sim.startHour + t / 3600
}

/** Sim time in seconds for a clock hour. */
export function timeAtHour(hour: number): number {
  return (hour - CONFIG.sim.startHour) * 3600
}

/**
 * An inhomogeneous Poisson process by thinning: `next()` returns the sim time of the next arrival (Infinity once the
 * curve has ended). Same seed, same times.
 */
export class ArrivalProcess {
  private t: number
  private readonly peak: number
  private readonly end: number

  constructor(
    private readonly rng: Rng,
    private readonly curve: Curve,
    startT = 0,
  ) {
    this.t = startT
    this.peak = Math.max(0, ...curve.map((p) => p[1]))
    this.end = curve.length ? timeAtHour(curve[curve.length - 1][0]) : -Infinity
  }

  next(): number {
    if (this.peak <= 0) return Infinity
    for (let guard = 0; guard < 100000; guard++) {
      this.t += -Math.log(1 - this.rng.float()) / (this.peak / 3600)
      if (this.t > this.end) return Infinity
      if (this.rng.float() * this.peak <= rateAt(this.curve, hourAt(this.t))) return this.t
    }
    return Infinity
  }
}

/**
 * Ambulance arrivals: one a first-at time, then one every 12-20 minutes until `day.ambulanceLastHour` (the L1 full day;
 * M3 stopped at noon). At night the gap stretches (`NIGHT_STRETCH`): the ER runs at night rates, and a crew is a quarter
 * of the night shift.
 *
 * The sequence is anchored at the earliest start of the run (`anchorT`: 0, or negative for a warm start before 07:30), so
 * the day is the same whatever hour a Jump starts at (a later start skips what is already past: `skipTo`).
 */
export const NIGHT_STRETCH = 1.5

export class AmbulanceSchedule {
  private t = Infinity
  private started = false

  constructor(
    private readonly rng: Rng,
    private readonly anchorT = 0,
  ) {}

  next(): number {
    const cfg = CONFIG.er.ambulance
    if (!this.started) this.t = this.anchorT + cfg.firstAt
    else {
      const gap = this.rng.between(cfg.every)
      this.t += isNightHour(hourAt(this.t) % 24) ? gap * NIGHT_STRETCH : gap
    }
    this.started = true
    if (hourAt(this.t) > CONFIG.day.ambulanceLastHour) this.t = Infinity
    return this.t
  }

  /** The first arrival at or after `t0` (a warm start at a later hour skips the ones before it). */
  skipTo(t0: number): number {
    let t = this.next()
    while (t < t0) t = this.next()
    return t
  }
}
