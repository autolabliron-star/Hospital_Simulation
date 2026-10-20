/**
 * R3 "Real screens": what makes one synthetic patient differ from the next, drawn from the exam's image seed (`ImagingExam.imageSeed`): body
 * build, fat, organ positions, sizes and tilts, bladder filling, breathing and heart rate, and a few benign normal variants (a small
 * gallstone in about one patient in seven). Pure and cheap (a few dozen seeded draws), so the main thread can compute the probe targets
 * and the worker the anatomy from the same numbers.
 *
 * Landmarks are in the patient frame of body.ts (LPS millimetres, origin between the hip joints) for an average adult, then scaled by the
 * build: L by `width`, P by `depth`, S by `height`.
 */
import { mixSeed, mulberry32 } from '@/sim/rng'
import type { V3 } from './body'

export interface KidneyParams {
  /** Centre (LPS mm). */
  c: V3
  /** Unit long axis, from the lower to the upper pole. */
  axis: V3
  /** Unit direction the hilum faces (anteromedial). */
  hilum: V3
  /** Pole-to-pole length, width and thickness (mm). */
  len: number
  width: number
  thick: number
  /** Cortex thickness (mm) and number of medullary pyramids. */
  cortex: number
  pyramids: number
}

export interface PatientParams {
  seed: number
  /** Build: scale of the body's width (L), depth (P) and length (S), and the subcutaneous fat (mm). */
  width: number
  depth: number
  height: number
  fat: number
  /** 25..85 years: brain atrophy, disc hydration, marrow fat, small calcifications. */
  age: number
  /** Breathing: period (s), phase (0..1) and the cranio-caudal excursion of the liver (mm). */
  breathPeriod: number
  breathPhase: number
  breathAmp: number
  heartRate: number
  kidneyR: KidneyParams
  kidneyL: KidneyParams
  /** Liver: centre of the right lobe and a size factor; how low its inferior tip reaches (S, mm). */
  liver: { c: V3; scale: number; tipS: number }
  gallbladder: { c: V3; axis: V3; len: number; radius: number; stone: boolean; stoneR: number }
  spleen: { c: V3; scale: number }
  /** 0.3 (nearly empty) .. 1 (full). */
  bladderFill: number
  /** Which limb an extremity exam images: -1 the right (patient's right is -L), +1 the left. */
  side: -1 | 1
  /** Head size factor (0.94..1.06) and the ventricles' and sulci's widening with age (0 young .. 1 old). */
  headScale: number
  atrophy: number
  /** A seed for the bowel loops (their positions and what they hold). */
  bowelSeed: number
}

const n3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** The patient of an image seed. */
export function patientParams(imageSeed: number): PatientParams {
  const r = mulberry32(mixSeed(imageSeed >>> 0, 0x5ca1ab1e))
  const u = (lo: number, hi: number): number => lo + (hi - lo) * r()
  const width = u(0.92, 1.1)
  const depth = u(0.9, 1.14)
  const height = u(0.95, 1.05)
  const fat = u(10, 32) * (0.6 + 0.5 * (depth - 0.9) / 0.24)
  const age = Math.round(u(25, 85))
  const at = (l: number, p: number, s: number): V3 => [l * width, p * depth, s * height]

  const kidney = (side: -1 | 1): KidneyParams => {
    // the right kidney (side -1, patient's right is -L) sits about 1.5 cm lower than the left; upper poles lean medially and posteriorly
    const dz = side < 0 ? -10 : 8
    const c = at(side * u(56, 66), u(48, 60), u(232, 252) + dz)
    const tiltMed = u(10, 20) * (Math.PI / 180)
    const tiltPost = u(8, 18) * (Math.PI / 180)
    const axis = n3([-side * Math.sin(tiltMed), Math.sin(tiltPost), 1])
    // the hilum faces medially and forward
    const hilum = n3([-side * 1, -u(0.5, 0.8), 0])
    return { c, axis, hilum, len: u(100, 118), width: u(50, 60), thick: u(32, 40), cortex: u(7, 10), pyramids: 9 + Math.floor(r() * 4) }
  }
  const kidneyR = kidney(-1)
  const kidneyL = kidney(1)
  const liverScale = u(0.92, 1.1)
  const gbLen = u(62, 90)
  const stone = r() < 0.15
  return {
    seed: imageSeed,
    width,
    depth,
    height,
    fat,
    age,
    breathPeriod: u(3.6, 5.2),
    breathPhase: r(),
    breathAmp: u(8, 14),
    heartRate: Math.round(u(58, 86)),
    kidneyR,
    kidneyL,
    liver: { c: at(-72, 2, u(322, 340)), scale: liverScale, tipS: u(222, 250) * height },
    gallbladder: { c: at(-56, -58, u(262, 280)), axis: n3([-0.25, -0.55, -0.8]), len: gbLen, radius: u(13, 19), stone, stoneR: u(4, 7) },
    spleen: { c: at(90, 36, u(318, 340)), scale: u(0.88, 1.12) },
    bladderFill: u(0.35, 1),
    bowelSeed: mixSeed(imageSeed >>> 0, 0xb0e1),
    side: r() < 0.55 ? -1 : 1,
    headScale: u(0.94, 1.06),
    atrophy: Math.max(0, Math.min(1, (age - 45) / 40)),
  }
}

/** The cranio-caudal shift of the mobile organs (mm, + toward the head: they rise as you breathe out) at time `t` (s). */
export function breathShift(p: PatientParams, t: number): number {
  const ph = t / p.breathPeriod + p.breathPhase
  // breathing is not a sine: a quicker inspiration, a slower expiration and a pause at the end of it
  const f = ph - Math.floor(ph)
  const insp = 0.38
  const k = f < insp ? 0.5 - 0.5 * Math.cos((Math.PI * f) / insp) : 0.5 + 0.5 * Math.cos((Math.PI * (f - insp)) / (1 - insp))
  return -p.breathAmp * k
}
