/**
 * W4 health kiosks: the synthetic body behind every reading. Pure and seeded (no Math.random, no clock): a person's profile is a function of their
 * id, their name and the hints the caller has, and every measurement adds the noise of its device on top of the profile's true value.
 *
 *   profileFor(id, name, hint, rng)  height (the avatar's own), weight by BMI ~ N(26, 4), body fat by Deurenberg, blood pressure, pulse, SpO2 and
 *                                    temperature from the content baselines by age (+ the content shifts of an ER reason), a white-coat offset
 *   readingAt(profile, source, rng)  a complete reading: a kiosk (or player) session in one go, or a nurse's triage reading with the white-coat offset
 *   measure*(...)                    one device's value, for the station script which fills a reading in step by step
 *
 * Everything is display data. Nothing here decides anything about a person: no flag, no "high" or "low" (the UI styles a value from content ranges).
 */
import { erVitalsShiftFor } from '@/content/erVitals'
import { LAB_CATALOGUE, erPanelFor, vitalsBaselineFor } from '@/content/lab'
import { CONFIG } from '../config'
import type { Rng } from '../rng'
import type { VitalsReading, VitalsSource } from '../types'
import { avatarCrownM, avatarIsFemale, variantOf } from './body'
import { TUNING } from './tuning'

/** Everything true about one person (the consulting-room values). The kiosks and the triage nurse each measure it with their own noise. */
export interface Profile {
  id: string
  name: string
  female: boolean
  age: number
  heightCm: number
  weightKg: number
  bmi: number
  bodyFatPct: number
  sys: number
  dia: number
  pulse: number
  spo2: number
  tempC: number
  /** mmHg a waiting-area reading runs below the consulting room, per person; added to a triage reading. */
  whiteCoatSys: number
  whiteCoatDia: number
  /** The content panel the ER reason maps to (its shifts were applied), or null. */
  panel: string | null
}

/** What the caller knows about the person. Anything missing is drawn from the seeded profile stream. */
export interface ProfileHint {
  age?: number
  /** The ER reason text (content/roster.ts): its panel's shifts apply. */
  reason?: string
  /** A panel id straight from content/lab.json. */
  panel?: string
  /** The entity's `variant` (default: derived from the id, which is how every entity gets it). */
  variant?: number
}

const r1 = (x: number): number => Math.round(x * 10) / 10
const r0 = (x: number): number => Math.round(x)
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

/** Body fat % by Deurenberg et al. 1991: 1.2 BMI + 0.23 age - 10.8 (1 for a man, 0 for a woman) - 5.4. */
export function deurenbergBodyFat(bmi: number, age: number, male: boolean): number {
  return 1.2 * bmi + 0.23 * age - 10.8 * (male ? 1 : 0) - 5.4
}

/** BMI = kg / m^2. */
export function bmiOf(weightKg: number, heightCm: number): number {
  const m = heightCm / 100
  return weightKg / (m * m)
}

/** A seeded age for somebody the content has none for (the ER walk-ins and the walk-up visitors). */
export function drawAge(rng: Rng): number {
  const a = TUNING.age
  return Math.round(rng.clampedGaussian(a.mean, a.sd, a.min, a.max))
}

function pairDraw(rng: Rng, pair: readonly [number, number], lo: number, hi: number): number {
  return clamp(rng.gaussian(pair[0], pair[1]), lo, hi)
}

/**
 * The seeded profile of a person. The draws come from a stream forked by the id, so the same person has the same body whichever system asks first
 * (the kiosk, the triage nurse), and the order of arrivals never changes anybody's numbers.
 */
export function profileFor(id: string, name: string, hint: ProfileHint, rng: Rng): Profile {
  const r = rng.fork(`profile:${id}`)
  const variant = hint.variant ?? variantOf(id)
  const age = hint.age ?? drawAge(r)
  const female = avatarIsFemale(id, name, variant)
  const heightCm = r1(avatarCrownM(id, variant) * 100)
  const bmi = clamp(r.gaussian(TUNING.bmi.mean, TUNING.bmi.sd), TUNING.bmi.min, TUNING.bmi.max)
  const weightKg = r1(bmi * (heightCm / 100) ** 2)
  const bodyFatPct = clamp(deurenbergBodyFat(bmi, age, !female), 3, 60)

  const base = vitalsBaselineFor(age)
  const L = TUNING.limits
  let sys = pairDraw(r, base.sys, L.sys[0], L.sys[1])
  let dia = pairDraw(r, base.dia, L.dia[0], L.dia[1])
  let pulse = pairDraw(r, base.pulse, L.pulse[0], L.pulse[1])
  let spo2 = pairDraw(r, base.spo2, L.spo2[0], L.spo2[1])
  let tempC = pairDraw(r, base.tempC, L.tempC[0], L.tempC[1])
  const panel = hint.panel ?? (hint.reason ? erPanelFor(hint.reason) : null)
  // F-24: every acute reason has its own vitals shift (erVitals.json); the lab panel's shift is the fallback for a panel given without a reason
  const shift = (hint.reason ? erVitalsShiftFor(hint.reason) : null) ?? (panel ? LAB_CATALOGUE.panelShifts[panel] : undefined)
  if (shift) {
    sys = clamp(sys + (shift.sys ?? 0), L.sys[0], L.sys[1])
    dia = clamp(dia + (shift.dia ?? 0), L.dia[0], L.dia[1])
    pulse = clamp(pulse + (shift.pulse ?? 0), L.pulse[0], L.pulse[1])
    spo2 = clamp(spo2 + (shift.spo2 ?? 0), L.spo2[0], L.spo2[1])
    tempC = clamp(tempC + (shift.tempC ?? 0), L.tempC[0], L.tempC[1])
  }
  const whiteCoatSys = r.between(CONFIG.vitals.whiteCoatSys)
  return {
    id,
    name,
    female,
    age,
    heightCm,
    weightKg,
    bmi: bmiOf(weightKg, heightCm),
    bodyFatPct,
    sys,
    dia,
    pulse,
    spo2,
    tempC,
    whiteCoatSys,
    whiteCoatDia: whiteCoatSys * CONFIG.vitals.whiteCoatDiaShare,
    panel,
  }
}

// ---------------------------------------------------------------------------------------------
// One device's value (the station fills a reading in step by step)
// ---------------------------------------------------------------------------------------------

/** The ultrasonic sensor over the head: the avatar's height (to 0.1 cm) with a hair of noise, never more than 0.3 cm off. */
export function measureHeight(p: Profile, rng: Rng): number {
  return r1(p.heightCm + clamp(rng.gaussian(0, TUNING.noise.heightCm), -0.3, 0.3))
}

/** The platform's load cells. */
export function measureWeight(p: Profile, rng: Rng): number {
  return r1(p.weightKg + rng.gaussian(0, TUNING.noise.weightKg))
}

/** Hand-to-foot bio-impedance: Deurenberg from the MEASURED BMI and the age, plus the impedance noise. */
export function measureBodyFat(p: Profile, measuredBmi: number, rng: Rng): number {
  return r1(clamp(deurenbergBodyFat(measuredBmi, p.age, !p.female) + rng.gaussian(0, TUNING.noise.bodyFatPct), 3, 60))
}

/** The finger clip: SpO2 (whole percent, at most 100) and the pulse it reads. */
export function measureSpo2(p: Profile, rng: Rng): { spo2: number; pulse: number } {
  return {
    spo2: clamp(r0(p.spo2 + rng.gaussian(0, TUNING.noise.spo2)), TUNING.limits.spo2[0], 100),
    pulse: clamp(r0(p.pulse + rng.gaussian(0, TUNING.noise.pulse)), 35, 185),
  }
}

/** The infrared thermometer at the forehead. */
export function measureTemp(p: Profile, rng: Rng): number {
  return r1(p.tempC + rng.gaussian(0, TUNING.noise.tempC))
}

/**
 * One cuff reading (`round` 1, 2, 3). The kiosk stands in the waiting area, so it reads the person's true pressure (plus noise; the first reading
 * runs a little high); a nurse in the consulting room adds the white-coat offset (see `triageBp`).
 */
export function measureBp(p: Profile, round: number, rng: Rng): [number, number] {
  const n = TUNING.noise
  const settle = round <= 1 ? n.bpFirstExtraSys : 0
  const sys = r0(p.sys + settle + rng.gaussian(0, n.bpSys))
  const dia = r0(p.dia + settle * 0.5 + rng.gaussian(0, n.bpDia))
  return [clamp(sys, 70, 240), clamp(dia, 35, 140)]
}

/** The mean of the cuff readings a kiosk reports: both of two, or the last two of three (the first is the one that runs high). */
export function bpOfRounds(bp: readonly (readonly [number, number])[]): [number, number] | null {
  if (bp.length === 0) return null
  const use = bp.length >= 3 ? bp.slice(-2) : bp
  let s = 0
  let d = 0
  for (const [a, b] of use) {
    s += a
    d += b
  }
  return [r0(s / use.length), r0(d / use.length)]
}

// ---------------------------------------------------------------------------------------------
// A whole reading
// ---------------------------------------------------------------------------------------------

export function emptyReading(id: string, personId: string, personName: string, source: VitalsSource, station: number | null, at: number): VitalsReading {
  return { id, personId, personName, at, source, station, sys: null, dia: null, pulse: null, spo2: null, tempC: null, heightCm: null, weightKg: null, bmi: null, bodyFatPct: null, bp: [], partial: true }
}

/** The triage nurse's cuff reading: the white-coat offset is added to the true value (so the kiosk's waiting-area reading is lower by that much). */
export function triageBp(p: Profile, rng: Rng): [number, number] {
  const n = TUNING.triageNoise
  return [clamp(r0(p.sys + p.whiteCoatSys + rng.gaussian(0, n.sys)), 70, 250), clamp(r0(p.dia + p.whiteCoatDia + rng.gaussian(0, n.dia)), 35, 150)]
}

/**
 * A complete reading in one go. 'triage': a nurse's manual vitals (white-coat offset on the pressure, no height or weight). 'kiosk' and 'player': the
 * whole kiosk session with one cuff reading (the station script takes two or three).
 */
export function readingAt(
  p: Profile,
  source: VitalsSource,
  rng: Rng,
  o: { id?: string; at?: number; station?: number | null } = {},
): VitalsReading {
  const id = o.id ?? `${source}:${p.id}`
  const at = o.at ?? 0
  if (source === 'triage') {
    const n = TUNING.triageNoise
    const bp = triageBp(p, rng)
    const rd = emptyReading(id, p.id, p.name, 'triage', null, at)
    rd.bp = [bp]
    rd.sys = bp[0]
    rd.dia = bp[1]
    rd.pulse = clamp(r0(p.pulse + p.whiteCoatSys * 0.1 + rng.gaussian(0, n.pulse)), 35, 185)
    rd.spo2 = clamp(r0(p.spo2 + rng.gaussian(0, n.spo2)), TUNING.limits.spo2[0], 100)
    rd.tempC = r1(p.tempC + rng.gaussian(0, n.tempC))
    rd.partial = false
    return rd
  }
  const rd = emptyReading(id, p.id, p.name, source, o.station ?? null, at)
  rd.heightCm = measureHeight(p, rng)
  rd.weightKg = measureWeight(p, rng)
  rd.bmi = r1(bmiOf(rd.weightKg, rd.heightCm))
  rd.bodyFatPct = measureBodyFat(p, rd.bmi, rng)
  const o2 = measureSpo2(p, rng)
  rd.spo2 = o2.spo2
  rd.pulse = o2.pulse
  const bp = measureBp(p, 1, rng)
  rd.bp = [bp]
  rd.sys = bp[0]
  rd.dia = bp[1]
  rd.tempC = measureTemp(p, rng)
  rd.partial = false
  return rd
}
