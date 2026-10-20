/**
 * R3 live patient monitors: the slow numbers behind a monitor (the targets the beats follow, the SpO2, the blood pressure, the CO2, the temperature),
 * as pure, seeded functions of the patient's baseline, where they are (`Situation`) and the SIM time. Synthetic and display-only: nothing in the sim
 * reads these, no value is ever judged, and the monitors never alarm.
 *
 * The baseline is the patient's own body from the health kiosks' model (src/sim/vitals/model.ts `Profile`), so a patient who used a kiosk shows the
 * same blood pressure on their bedside monitor. What changes it:
 *
 *   triage   a spot check: the white-coat offset on top (like the triage nurse's reading), one NIBP when the cuff goes on
 *   er       the acuity (1 most urgent): a faster heart and breathing, a little less SpO2, settling over the first hour in the bay; NIBP every 15
 *            minutes for acuity 1-2, every 30 for the rest
 *   preop    a little nervous: +6 bpm and the white coat; NIBP every 30 minutes
 *   or       awake on the table, then anaesthetised (slower heart, lower pressure, on the ventilator, SpO2 99-100), the CO2 climbing for about 15
 *            minutes once the robot is docked (the insufflated CO2 is absorbed), easing off after the console ends, waking at emergence; NIBP
 *            every 5 minutes, and an arterial line for the prostatectomy
 *   pacu     recovering: the heart, the breathing and the pressure settling and the SpO2 and the temperature coming up over the first half hour;
 *            NIBP every 15 minutes
 *
 * Every value wanders a little around its target (seeded smooth noise over sim time), and is kept inside plausible adult ranges.
 */
import type { Profile } from '@/sim/vitals/model'
import type { CasePhase, SurgeryProcedure } from '@/sim/types'
import { hashSigned, hashUnit } from './beats'

export type MonitorContext = 'or' | 'pacu' | 'preop' | 'er' | 'triage'

/** What the monitors need of a patient's body. */
export interface Baseline {
  seed: number
  age: number
  hr: number
  sys: number
  dia: number
  spo2: number
  tempC: number
  whiteCoatSys: number
  whiteCoatDia: number
}

export function baselineFrom(p: Profile, seed: number): Baseline {
  return { seed, age: p.age, hr: p.pulse, sys: p.sys, dia: p.dia, spo2: p.spo2, tempC: p.tempC, whiteCoatSys: p.whiteCoatSys, whiteCoatDia: p.whiteCoatDia }
}

/** Where the patient is and what is happening there (sim times). Filled by occupancy.ts, mutated in place. */
export interface Situation {
  context: MonitorContext
  /** Sim time the patient came onto this monitor. */
  since: number
  /** ER and triage: acuity 1 (most urgent) .. 5; 3 elsewhere. */
  acuity: number
  /** OR: the theatre phase. */
  phase: CasePhase | null
  procedure: SurgeryProcedure | null
  /** OR: sim time the robot docked (the insufflated CO2 starts to show), and the console's end (it eases off). */
  dockedAt: number | null
  insufflationEnd: number | null
}

export function newSituation(context: MonitorContext): Situation {
  return { context, since: 0, acuity: 3, phase: null, procedure: null, dockedAt: null, insufflationEnd: null }
}

/** The targets at one moment. */
export interface VitalsNow {
  hr: number
  spo2: number
  sys: number
  dia: number
  temp: number
  /** Breaths per minute, and whether a ventilator gives them (no jitter, I:E 1:2). */
  rr: number
  ventilated: boolean
  /** Inspiratory share of a breath. */
  iFrac: number
  /** End-tidal CO2 (mmHg); `co2` says whether a CO2 trace is connected. */
  etco2: number
  co2: boolean
  /** An arterial line is in (the ART trace and number). */
  art: boolean
  /** Respiratory sinus arrhythmia depth and beat-to-beat wobble for the heart (beats.ts HeartDrive). */
  rsa: number
  jitter: number
}

export function newVitals(): VitalsNow {
  return { hr: 70, spo2: 98, sys: 120, dia: 75, temp: 36.8, rr: 14, ventilated: false, iFrac: 0.4, etco2: 36, co2: false, art: false, rsa: 0.03, jitter: 0.012 }
}

/** The ranges every value stays in (synthetic adults; the tests hold every context to them). */
export const RANGES = {
  hr: [42, 150],
  spo2: [90, 100],
  sys: [85, 190],
  dia: [45, 115],
  temp: [35.2, 38.6],
  rr: [8, 30],
  etco2: [28, 48],
} as const

const clamp = (x: number, r: readonly [number, number]): number => (x < r[0] ? r[0] : x > r[1] ? r[1] : x)

/** Seeded smooth noise in -1..1 over `t`, changing on a time scale of `period` seconds (value noise with smoothstep between knots). */
export function wander(seed: number, k: number, t: number, period: number): number {
  const x = t / period
  const i = Math.floor(x)
  const f = x - i
  const s = f * f * (3 - 2 * f)
  const a = hashSigned(seed ^ Math.imul(k + 1, 0x27d4eb2d), i)
  const b = hashSigned(seed ^ Math.imul(k + 1, 0x27d4eb2d), i + 1)
  return a + (b - a) * s
}

const ACUITY_HR = [24, 15, 8, 3, 0] as const
const ACUITY_RR = [7, 4, 2, 1, 0] as const
const ACUITY_SPO2 = [-4, -2, -1, 0, 0] as const
const ACUITY_SYS = [12, 8, 5, 2, 0] as const

/** The theatre phases in which the patient is anaesthetised and on the ventilator. */
const UNDER: ReadonlySet<CasePhase> = new Set<CasePhase>(['induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing'])
/** ... and waking up. */
const WAKING: ReadonlySet<CasePhase> = new Set<CasePhase>(['emergence', 'out'])

/** The ventilator's rate for a patient (10-14 breaths a minute, seeded). */
export function ventRate(b: Baseline): number {
  return 10 + Math.floor(hashUnit(b.seed, 41) * 5)
}

/** The extra CO2 (mmHg) the insufflation adds at `t`: up to about 6, over a quarter of an hour after docking, easing off after the console. */
export function insufflationRise(s: Situation, t: number): number {
  if (s.dockedAt === null || t < s.dockedAt) return 0
  let rise = 6 * (1 - Math.exp(-(t - s.dockedAt) / 600))
  if (s.insufflationEnd !== null && t > s.insufflationEnd) rise *= Math.exp(-(t - s.insufflationEnd) / 480)
  return rise
}

/** The targets for `b` in situation `s` at sim time `t`, written into `out` (returned). Allocation-free. */
export function vitalsAt(b: Baseline, s: Situation, t: number, out: VitalsNow): VitalsNow {
  let hr = b.hr
  let sys = b.sys
  let dia = b.dia
  let spo2 = b.spo2
  let temp = b.tempC
  let rr = 15
  let ventilated = false
  let iFrac = 0.4
  let etco2 = 36 + 2 * hashSigned(b.seed, 43)
  let co2 = false
  let art = false
  let rsa = b.age < 40 ? 0.045 : b.age < 65 ? 0.03 : 0.018
  const since = t - s.since
  switch (s.context) {
    case 'triage':
      hr += 5
      sys += b.whiteCoatSys
      dia += b.whiteCoatDia
      rr = 16
      break
    case 'er': {
      const a = Math.max(1, Math.min(5, Math.round(s.acuity))) - 1
      const f = 0.55 + 0.45 * Math.exp(-Math.max(0, since) / 2400)
      hr += ACUITY_HR[a] * f
      rr = 15 + ACUITY_RR[a] * f
      spo2 += ACUITY_SPO2[a] * f
      sys += ACUITY_SYS[a] * f + 0.5 * b.whiteCoatSys
      dia += 0.4 * ACUITY_SYS[a] * f + 0.5 * b.whiteCoatDia
      break
    }
    case 'preop':
      hr += 6
      sys += 4 + b.whiteCoatSys
      dia += 2 + b.whiteCoatDia
      break
    case 'pacu': {
      const m = Math.max(0, since) / 60
      const e = Math.exp(-m / 25)
      hr += 4 + 8 * e
      sys += 4 + 6 * e
      dia += 2 + 3 * e
      spo2 = Math.min(100, spo2 + 1) - 3 * Math.exp(-m / 15)
      rr = 14 + 3 * e
      temp = b.tempC - 0.7 + 0.6 * (1 - Math.exp(-m / 50))
      etco2 = 38 + 1.5 * hashSigned(b.seed, 44)
      break
    }
    case 'or': {
      co2 = true
      art = s.procedure === 'prostatectomy'
      const ph = s.phase
      if (ph !== null && UNDER.has(ph)) {
        hr -= 6
        sys *= 0.84
        dia *= 0.85
        ventilated = true
        rr = ventRate(b)
        iFrac = 0.33
        spo2 = 99 + (hashUnit(b.seed, 45) < 0.6 ? 1 : 0)
        etco2 = 34 + 3 * hashUnit(b.seed, 46) + insufflationRise(s, t)
        temp = b.tempC - 0.5 * Math.min(1, Math.max(0, since) / 7200)
        rsa *= 0.3
      } else if (ph !== null && WAKING.has(ph)) {
        hr += 10
        sys *= 1.05
        rr = 14
        spo2 = Math.min(100, spo2 + 1)
        etco2 = 40 + 1.5 * hashSigned(b.seed, 47)
        temp = b.tempC - 0.5
      } else {
        // awake on the table, breathing oxygen through the mask before induction
        hr += 8
        sys += 10
        dia += 5
        spo2 = Math.min(100, spo2 + 1)
      }
      break
    }
  }
  // a slow wander around every target
  const seed = b.seed
  hr += 2 * wander(seed, 1, t, 90)
  sys += 4 * wander(seed, 2, t, 240)
  dia += 2.5 * wander(seed, 3, t, 240)
  spo2 += 0.7 * wander(seed, 4, t, 150)
  temp += 0.05 * wander(seed, 5, t, 600)
  etco2 += 0.8 * wander(seed, 6, t, 180)
  if (!ventilated) rr += 1.2 * wander(seed, 7, t, 120)
  out.hr = clamp(hr, RANGES.hr)
  out.sys = clamp(sys, RANGES.sys)
  out.dia = clamp(Math.min(dia, out.sys - 25), RANGES.dia)
  out.spo2 = clamp(spo2, RANGES.spo2)
  out.temp = clamp(temp, RANGES.temp)
  out.rr = clamp(rr, RANGES.rr)
  out.ventilated = ventilated
  out.iFrac = iFrac
  out.etco2 = clamp(etco2, RANGES.etco2)
  out.co2 = co2
  out.art = art
  out.rsa = rsa
  out.jitter = ventilated ? 0.006 : 0.012
  return out
}

// ---------------------------------------------------------------------------------------------
// Non-invasive blood pressure: a cuff reading on a schedule
// ---------------------------------------------------------------------------------------------

/** Seconds between automatic cuff readings in a situation (Infinity: one reading only, the triage spot check). */
export function nibpInterval(s: Situation): number {
  switch (s.context) {
    case 'or':
      return 5 * 60
    case 'pacu':
      return 15 * 60
    case 'preop':
      return 30 * 60
    case 'er':
      return s.acuity <= 2 ? 15 * 60 : 30 * 60
    case 'triage':
      return Infinity
  }
}

/** The first cuff reading comes this long after the patient is connected. */
export const NIBP_FIRST = 45

export interface NibpReading {
  /** False until the first reading. */
  has: boolean
  sys: number
  dia: number
  map: number
  /** Sim time of the reading, and its number (0 for the first). */
  at: number
  n: number
}

export function newNibp(): NibpReading {
  return { has: false, sys: 0, dia: 0, map: 0, at: 0, n: -1 }
}

const scratch = newVitals()

/** The latest cuff reading at sim time `t` (the targets at the reading's own time, plus the cuff's few mmHg of scatter). Allocation-free. */
export function nibpAt(b: Baseline, s: Situation, t: number, out: NibpReading): NibpReading {
  const first = s.since + NIBP_FIRST
  if (t < first) {
    out.has = false
    out.n = -1
    return out
  }
  const every = nibpInterval(s)
  const n = Number.isFinite(every) ? Math.floor((t - first) / every) : 0
  const at = first + n * (Number.isFinite(every) ? every : 0)
  vitalsAt(b, s, at, scratch)
  out.has = true
  out.n = n
  out.at = at
  out.sys = Math.round(scratch.sys + 3 * hashSigned(b.seed ^ 0x1b873593, n))
  out.dia = Math.round(scratch.dia + 2 * hashSigned(b.seed ^ 0x1b873593, n + 1000))
  out.map = Math.round(out.dia + (out.sys - out.dia) / 3)
  return out
}
