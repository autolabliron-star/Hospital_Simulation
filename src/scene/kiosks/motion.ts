/**
 * The state-to-light maths of the health kiosks: pure functions, no three.js, no DOM, nothing allocated per call (they write into an `out` object). The sim
 * publishes one `HealthKioskState` per kiosk (phase, how far through it, the cuff, the reading so far); `levelsInto` turns it into the TARGET level of every
 * light, `rig.ts` eases the lights to them and writes a colour buffer only when a level moved. Tested in motion.test.ts.
 *
 * Phases (src/sim/vitals/station.ts): idle, calling, login, height, weight, bodyFat, sit, spo2, bp, bpRest, temp, report.
 *   status LED        green when free, blue while in use (breathing when idle, pulsing while somebody is called)
 *   QR window         flickers while the card or code is scanned (login), a faint standby glow otherwise
 *   ultrasonic ping   a faint beam and three rings travelling down it (height)
 *   LED digits        "---" while weighing (weight), the weight once it is known (body fat), off otherwise
 *   grip sleeves      a soft blue breathing light while the hands are on the handles (body fat)
 *   SpO2 LEDs         red, pulsing at the pulse's rate (spo2)
 *   cuff ring         teal at rest, amber as it inflates (bp, with the cuff level), green when the reading is done (bpRest)
 *   face ring + IR    a green ring round the camera and a red dot pulsing in it (temp)
 *   paper slip        five segments of paper coming out of the printer slot (report)
 */
import { clamp01 } from '@/scene/imaging/machines/motion'
import type { HealthKioskState } from '@/sim/types'
import { PING_RINGS, SLIP_SEGMENTS } from './geometry'

export { clamp01, lerp, smoothTo, stepToward } from '@/scene/imaging/machines/motion'

const TAU = Math.PI * 2

export interface KioskLevels {
  /** Status LED colour: 0 green (free) .. 1 blue (in use), and its brightness. */
  led: number
  ledGain: number
  /** The ultrasonic beam's opacity, and the three rings' brightness. */
  beam: number
  ping: Float64Array
  /** 0..1 how lit the platform's digits are, and what they show: tenths of a kilogram (0..999), or -1 for "---". */
  digits: number
  digitValue: number
  grips: number
  /** Both SpO2 LEDs. */
  clip: number
  /** Cuff ring colour: 0 teal .. 1 amber, then toward green by `cuffGreen`; brightness `cuffGain`. */
  cuffAmber: number
  cuffGreen: number
  cuffGain: number
  face: number
  ir: number
  qr: number
  /** How many of the slip's segments are out (0..5, fractional). */
  slip: number
  bpLed: number
}

export function newLevels(): KioskLevels {
  return { led: 0, ledGain: 0, beam: 0, ping: new Float64Array(PING_RINGS), digits: 0, digitValue: -1, grips: 0, clip: 0, cuffAmber: 0, cuffGreen: 0, cuffGain: 0, face: 0, ir: 0, qr: 0, slip: 0, bpLed: 0 }
}

/** The beam is at most this opaque (it is a faint cone of light). */
export const BEAM_ALPHA = 0.13
/** Hz of the pings, the SpO2 pulse and the others. */
export const PING_HZ = 1.4
export const SPO2_HZ = 1.3
export const IR_HZ = 3.5
export const GRIP_HZ = 0.8
/** A slip printed over this share of the report phase. */
export const SLIP_PRINT_SHARE = 0.7

const pulse = (t: number, hz: number, phase = 0): number => 0.5 + 0.5 * Math.sin(TAU * hz * t + phase)

/** The QR window's flicker: mostly lit, dropping out in short bursts (a sum of two incommensurate square-ish waves). */
export function qrFlicker(t: number): number {
  const a = Math.sin(TAU * 9 * t)
  const b = Math.sin(TAU * 23.3 * t + 1.3)
  return a + 0.6 * b > -0.1 ? 1 : 0.3
}

/** The ping rings' brightness: a wave that runs down the beam, ring by ring. */
export function pingLevel(t: number, ring: number): number {
  const x = (t * PING_HZ - ring * 0.2) % 1
  const f = x < 0 ? x + 1 : x
  const s = Math.sin(Math.PI * f)
  return s * s
}

/** Are the platform's digits lit in this state? (They show "---" while weighing and the weight through the body-fat step.) */
export function digitsLit(k: HealthKioskState): boolean {
  return k.phase === 'weight' || k.phase === 'bodyFat'
}

/** What they show: tenths of a kilogram (0..999) once the weight is known (body fat), else -1 for dashes. */
export function digitValue(k: HealthKioskState): number {
  if (k.phase !== 'bodyFat') return -1
  const kg = k.reading?.weightKg
  if (kg === null || kg === undefined) return -1
  return Math.max(0, Math.min(999, Math.round(kg * 10)))
}

/** Fill `out` with the target of every light for state `k` at time `t` (seconds, any steady clock). */
export function levelsInto(out: KioskLevels, k: HealthKioskState, t: number): KioskLevels {
  const phase = k.phase
  const inUse = phase !== 'idle'
  const seated = phase === 'sit' || phase === 'spo2' || phase === 'bp' || phase === 'bpRest'
  const p = clamp01(k.progress)

  // status LED
  out.led = inUse && phase !== 'report' ? 1 : 0
  out.ledGain = phase === 'idle' ? 0.55 + 0.2 * pulse(t, 0.4) : phase === 'calling' ? 0.5 + 0.9 * pulse(t, 1.6) : phase === 'report' ? 1.3 : 1.1

  // the ultrasonic sensor
  const height = phase === 'height'
  out.beam = height ? BEAM_ALPHA * (0.75 + 0.25 * pulse(t, 0.9)) : 0
  for (let r = 0; r < PING_RINGS; r++) out.ping[r] = height ? pingLevel(t, r) : 0

  // the platform's digits
  out.digits = digitsLit(k) ? (phase === 'weight' ? 0.55 + 0.45 * pulse(t, 2.5) : 1) : 0
  out.digitValue = digitValue(k)

  out.grips = phase === 'bodyFat' ? 0.55 + 0.45 * pulse(t, GRIP_HZ) : 0
  out.clip = phase === 'spo2' ? 0.25 + 0.75 * pulse(t, SPO2_HZ) : 0

  // the cuff ring
  out.cuffAmber = 0
  out.cuffGreen = 0
  if (phase === 'bp') {
    out.cuffAmber = clamp01(k.cuff * 3)
    out.cuffGain = 0.8 + 0.7 * clamp01(k.cuff) + 0.12 * pulse(t, 6)
  } else if (phase === 'bpRest') {
    out.cuffGreen = 1
    out.cuffGain = 1.1
  } else {
    out.cuffGain = seated ? 0.85 + 0.2 * pulse(t, 1.2) : phase === 'idle' ? 0.45 : 0.6
  }

  // the camera
  const temp = phase === 'temp'
  out.face = temp ? 1 : 0
  out.ir = temp ? 0.35 + 0.65 * pulse(t, IR_HZ) : 0

  out.qr = phase === 'login' ? qrFlicker(t) : phase === 'idle' ? 0.12 + 0.08 * pulse(t, 0.3) : 0

  // the printed slip: it comes out over the first part of the report and stays out for the rest of it
  out.slip = phase === 'report' ? Math.min(SLIP_SEGMENTS, (p / SLIP_PRINT_SHARE) * SLIP_SEGMENTS) : 0

  out.bpLed = seated ? 0.85 : inUse ? 0.3 : 0.12
  return out
}

/** One segment's alpha when `slip` segments are out: segment 0 comes first and every segment fades in over one unit. */
export function slipAlpha(slip: number, n: number): number {
  return clamp01(slip - n)
}
