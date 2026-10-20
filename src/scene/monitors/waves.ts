/**
 * R3 live patient monitors: the waveforms, as pure functions of the display time and the patient's beat and breath rings (beats.ts). Every function
 * is allocation-free (the slot painter calls them a few thousand times per sweep). Synthetic and display-only.
 *
 *   ecgAt     lead II (or V5): P, Q, R, S and T as Gaussians around each R wave, the QT stretching with the RR interval (Bazett), a little baseline
 *             wander with the breathing and a hair of noise (mV)
 *   pulseAt   the photoplethysmogram, and the arterial line with the same function: a fast systolic upstroke a pulse transit time after the R wave,
 *             a decay with the DICROTIC NOTCH and the dicrotic wave on it, each beat ending where the next begins (0..1 of the beat's own swing)
 *   capnoAt   the capnogram: inspiratory baseline, the phase II upstroke, the alveolar plateau rising slowly to the end-tidal value, the inspiratory
 *             downstroke (mmHg)
 *   respAt    the impedance respiration trace (0..1)
 */
import { hashSigned, hashUnit, type TimeRing } from './beats'

/** How one patient's traces look: seeded per patient (look.ts would be one line, so it lives here). */
export interface WaveLook {
  /** R, P and T amplitudes (mV) of lead II; V5 scales them. */
  r: number
  p: number
  tw: number
  /** S depth (mV, positive number). */
  s: number
  /** Pulse transit time R -> pleth upstroke and R -> arterial upstroke (s). */
  pttPleth: number
  pttArt: number
  /** Depth of the dicrotic notch on the pleth and the arterial line (fraction of the swing). */
  notch: number
  /** How much the breathing swings the pleth and the arterial line (fraction). */
  respSwing: number
  seed: number
}

export function lookFor(seed: number): WaveLook {
  const u = (k: number): number => hashUnit(seed, 100 + k)
  return {
    r: 0.9 + 0.6 * u(1),
    p: 0.1 + 0.06 * u(2),
    tw: 0.22 + 0.16 * u(3),
    s: 0.18 + 0.2 * u(4),
    pttPleth: 0.2 + 0.06 * u(5),
    pttArt: 0.12 + 0.03 * u(6),
    notch: 0.06 + 0.06 * u(7),
    respSwing: 0.04 + 0.05 * u(8),
    seed,
  }
}

const gauss = (x: number, mu: number, sigma: number): number => {
  const d = (x - mu) / sigma
  return Math.exp(-0.5 * d * d)
}

const smooth01 = (e0: number, e1: number, x: number): number => {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0)
  return t * t * (3 - 2 * t)
}

/** The PQRST complex of one beat at `u` seconds from its R wave, for an RR of `rr` seconds. `lead` 1 is V5: a taller R, a deeper S, a taller T. */
export function pqrst(u: number, rr: number, look: WaveLook, lead: 0 | 1): number {
  if (u < -0.4 || u > 0.75) return 0
  const k = Math.sqrt(Math.min(1.6, Math.max(0.35, rr)))
  const rA = lead === 1 ? look.r * 1.35 : look.r
  const sA = lead === 1 ? look.s * 1.6 : look.s
  const tA = lead === 1 ? look.tw * 1.25 : look.tw
  let v = look.p * gauss(u, -0.165 * k, 0.026 * k)
  v -= 0.09 * gauss(u, -0.028, 0.0085)
  v += rA * gauss(u, 0, 0.0105)
  v -= sA * gauss(u, 0.026, 0.0095)
  // the T wave rises slowly and falls faster
  const tMu = 0.27 * k
  v += tA * (u < tMu ? gauss(u, tMu, 0.062 * k) : gauss(u, tMu, 0.045 * k))
  return v
}

/** Lead II (lead 0) or V5 (lead 1) at display time `t`, in mV. */
export function ecgAt(t: number, beats: TimeRing, breaths: TimeRing, look: WaveLook, lead: 0 | 1): number {
  let v = 0
  // the beats whose complex reaches t: R waves from 0.75 s before t to 0.4 s after it
  let i = beats.indexAt(t + 0.4)
  for (; i >= beats.first; i--) {
    const r = beats.at(i)
    if (r < t - 0.75) break
    const next = i + 1 < beats.end ? beats.at(i + 1) : r + 0.9
    v += pqrst(t - r, next - r, look, lead)
  }
  // the electrical axis swings a little with the breathing, and the baseline wanders with it
  const b = breathPhase(t, breaths)
  v *= 1 + 0.05 * Math.sin(b * Math.PI * 2)
  v += 0.035 * Math.sin(b * Math.PI * 2 + 0.6)
  // a hair of noise (a few microvolts), seeded by the sample's time
  v += 0.008 * hashSigned(look.seed, Math.floor(t * 500))
  return v
}

/** Where in its breath `t` is: 0 at an inspiration start, 1 at the next (0.5 when there are no breaths). */
export function breathPhase(t: number, breaths: TimeRing): number {
  const i = breaths.indexAt(t)
  if (i < breaths.first || i + 1 >= breaths.end) return 0.5
  const a = breaths.at(i)
  const b = breaths.at(i + 1)
  return b > a ? (t - a) / (b - a) : 0
}

/**
 * One beat's pulse at `u` seconds after its upstroke began, for a beat lasting `period` seconds: 0 at the start and the end of the beat, about 1 at
 * the systolic peak. `rise` is the upstroke time, `tau` the decay, `notch` the dip before the dicrotic wave.
 */
export function pulseShape(u: number, period: number, rise: number, tau: number, notch: number): number {
  if (u <= 0 || period <= 0 || u >= period) return 0
  // pull the tail down to 0 at the end of the beat so each beat ends where the next begins
  return pulseRaw(u, rise, tau, notch) - (u / period) * pulseRaw(period, rise, tau, notch)
}

/** The pulse before its tail is pulled down: the upstroke, the decay, the notch and the dicrotic wave after it. */
function pulseRaw(x: number, rise: number, tau: number, notch: number): number {
  const up = smooth01(0, rise, x)
  const down = x > rise ? Math.exp(-(x - rise) / tau) : 1
  const tn = rise + 0.17
  return up * down - notch * gauss(x, tn, 0.022) + notch * 1.4 * gauss(x, tn + 0.065, 0.04)
}

/**
 * The pleth (art = false) or the arterial line (art = true) at `t`, as 0..1 of the beat's swing (the arterial line maps it to diastolic..systolic).
 * The breathing swings the amplitude a little.
 */
export function pulseAt(t: number, beats: TimeRing, breaths: TimeRing, look: WaveLook, art: boolean): number {
  const ptt = art ? look.pttArt : look.pttPleth
  const i = beats.indexAt(t - ptt)
  if (i < beats.first || i + 1 >= beats.end) return 0
  const onset = beats.at(i) + ptt
  const period = beats.at(i + 1) - beats.at(i)
  const v = art ? pulseShape(t - onset, period, 0.075, 0.42, look.notch * 1.6) : pulseShape(t - onset, period, 0.12, 0.34, look.notch)
  const b = breathPhase(t, breaths)
  return v * (1 - look.respSwing + look.respSwing * Math.cos(b * Math.PI * 2))
}

/**
 * The capnogram at `t` in mmHg: `etco2` at the end of each expiration, `iFrac` the inspiratory share of a breath. Each breath starts with
 * inspiration: the CO2 falls to 0 in the first 0.1 s, stays there, rises steeply (phase II) once expiration starts, then climbs slowly along the
 * alveolar plateau (phase III) to `etco2`.
 */
export function capnoAt(t: number, breaths: TimeRing, etco2: number, iFrac: number, seed: number): number {
  const i = breaths.indexAt(t)
  if (i < breaths.first || i + 1 >= breaths.end) return 0
  const a = breaths.at(i)
  const period = breaths.at(i + 1) - a
  const u = t - a
  // each breath's end-tidal value wobbles by about half a mmHg
  const et = etco2 + 0.6 * hashSigned(seed ^ 0x2c1b3c6d, i)
  const prevEt = etco2 + 0.6 * hashSigned(seed ^ 0x2c1b3c6d, i - 1)
  const fall = Math.min(0.12, period * 0.05)
  if (u < fall) return prevEt * (1 - smooth01(0, fall, u))
  const e = iFrac * period
  if (u < e) return 0
  const rise = Math.min(0.35, period * 0.08)
  const x = u - e
  if (x < rise) return et * 0.86 * smooth01(0, rise, x)
  // phase III: 86 % to 100 % of the end-tidal value over the rest of expiration, slightly concave
  const f = (x - rise) / Math.max(0.01, period - e - rise)
  return et * (0.86 + 0.14 * Math.sqrt(Math.min(1, f)))
}

/** The impedance respiration trace at `t`, 0..1: a rounded inspiration over `iFrac` of the breath, then a slower expiration and a pause. */
export function respAt(t: number, breaths: TimeRing, iFrac: number, seed: number): number {
  const i = breaths.indexAt(t)
  if (i < breaths.first || i + 1 >= breaths.end) return 0
  const a = breaths.at(i)
  const period = breaths.at(i + 1) - a
  const u = (t - a) / period
  const amp = 0.85 + 0.15 * hashSigned(seed ^ 0x68e31da4, i)
  if (u < iFrac) return amp * (0.5 - 0.5 * Math.cos((Math.PI * u) / iFrac))
  return amp * (1 - smooth01(iFrac, Math.min(0.97, iFrac + 0.55), u))
}
