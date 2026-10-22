/**
 * Observations for the patient record: the NEWS2 score of a set (display only: nothing in the sim reads it), the kiosk and triage readings the sim
 * already took, and the ward observation rounds (06:00, 14:00, 22:00), which the sim does not model and the record draws: a deterministic function
 * of the patient and the time (their own baseline from the vitals profile, the admission's deviation from the stay template fading over the stay,
 * and a little noise from an Rng seeded by the patient and the time). Never Math.random, never a sim stream.
 */
import type { StayTemplate } from '@/content/patientHistory'
import type { Rng } from '../rng'
import type { VitalsReading } from '../types'

export type Acvpu = 'A' | 'C' | 'V' | 'P' | 'U'

/** One set of observations. A value the source did not measure is null. */
export interface ObsSet {
  /** Seconds since 00:00 of the demo's day 0 (see record.ts `absOf`). */
  at: number
  rr: number | null
  spo2: number | null
  /** On supplemental oxygen. */
  o2: boolean | null
  sys: number | null
  dia: number | null
  pulse: number | null
  acvpu: Acvpu | null
  tempC: number | null
  source: 'ward' | 'triage' | 'kiosk' | 'player'
}

export interface News2 {
  score: number
  /** Some parameters were not recorded: the score is a lower bound. */
  partial: boolean
  missing: string[]
}

/** The patient's own resting values (the vitals profile, plus a breathing rate). */
export interface Baseline {
  sys: number
  dia: number
  pulse: number
  spo2: number
  tempC: number
  rr: number
}

const band = (v: number, cuts: readonly [number, number][]): number => {
  for (const [max, score] of cuts) if (v <= max) return score
  return 0
}

/** NEWS2 (Royal College of Physicians, 2017), SpO2 scale 1. Display only: the sim never reads it. */
export function news2(o: ObsSet): News2 {
  let score = 0
  const missing: string[] = []
  if (o.rr === null) missing.push('RR')
  else score += band(o.rr, [[8, 3], [11, 1], [20, 0], [24, 2], [Infinity, 3]])
  if (o.spo2 === null) missing.push('SpO2')
  else score += band(o.spo2, [[91, 3], [93, 2], [95, 1], [Infinity, 0]])
  if (o.o2 === null) missing.push('air/O2')
  else if (o.o2) score += 2
  if (o.sys === null) missing.push('BP')
  else score += band(o.sys, [[90, 3], [100, 2], [110, 1], [219, 0], [Infinity, 3]])
  if (o.pulse === null) missing.push('pulse')
  else score += band(o.pulse, [[40, 3], [50, 1], [90, 0], [110, 1], [130, 2], [Infinity, 3]])
  if (o.acvpu === null) missing.push('ACVPU')
  else if (o.acvpu !== 'A') score += 3
  if (o.tempC === null) missing.push('temp')
  else score += band(o.tempC, [[35.0, 3], [36.0, 1], [38.0, 0], [39.0, 1], [Infinity, 2]])
  return { score, partial: missing.length > 0, missing }
}

/** A kiosk or triage reading the sim took, as an observation set. */
export function obsOfReading(r: VitalsReading, at: number): ObsSet {
  return {
    at,
    rr: null,
    spo2: r.spo2,
    o2: r.source === 'kiosk' || r.source === 'player' ? false : null,
    sys: r.sys,
    dia: r.dia,
    pulse: r.pulse,
    acvpu: null,
    tempC: r.tempC,
    source: r.source,
  }
}

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)
/** The admission deviation halves about every 21 hours. */
const TAU_HOURS = 30

/**
 * The observation set of a patient at `at`, `hoursIn` after arrival: their baseline, plus the stay's admission deviation fading with time, plus a
 * little noise from `rng` (fork it per time so every set is independent of the others).
 */
export function wardObs(base: Baseline, stay: StayTemplate, hoursIn: number, at: number, rng: Rng, source: ObsSet['source'] = 'ward'): ObsSet {
  const s = stay.obs
  const k = Math.exp(-Math.max(0, hoursIn) / TAU_HOURS)
  const r1 = (x: number) => Math.round(x * 10) / 10
  const sys = Math.round(clamp(base.sys + (s.sys ?? 0) * k + rng.gaussian(0, 5), 80, 220))
  // the diastolic stays at least 25 below the systolic (a plausible pulse pressure)
  const dia = Math.round(clamp(base.dia + (s.sys ?? 0) * 0.5 * k + rng.gaussian(0, 4), 40, Math.max(40, sys - 25)))
  return {
    at,
    rr: Math.round(clamp(base.rr + (s.rr ?? 0) * k + rng.gaussian(0, 1), 8, 36)),
    spo2: Math.round(clamp(base.spo2 + (s.spo2 ?? 0) * k + rng.gaussian(0, 0.8), 84, 100)),
    o2: hoursIn < (s.o2Days ?? 0) * 24,
    sys,
    dia,
    pulse: Math.round(clamp(base.pulse + (s.pulse ?? 0) * k + rng.gaussian(0, 3), 40, 160)),
    acvpu: s.acvpu !== undefined && hoursIn < 18 ? s.acvpu : 'A',
    tempC: r1(clamp(base.tempC + (s.tempC ?? 0) * k + rng.gaussian(0, 0.15), 35.0, 40.5)),
    source,
  }
}
