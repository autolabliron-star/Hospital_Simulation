/**
 * Building an exam from a protocol, and drawing the durations of one visit to a scanner. Pure and deterministic: every
 * random draw comes from the Rng passed in, in a fixed order, so the same seed gives the same exam times.
 */
import { CONFIG } from '../config'
import type { Rng } from '../rng'
import type { BodyPart, ImagingExam, ImagingModality, ScanSequence } from '../types'

/** What the sim needs from a protocol (src/content/imaging.ts `Protocol` satisfies it). */
export interface ProtocolLike {
  id: string
  modality: ImagingModality
  bodyPart: BodyPart
  name: string
  sequences: ScanSequence[]
}

export function buildExam(
  id: string,
  protocol: ProtocolLike,
  who: { patientId: string; patientName: string },
  source: ImagingExam['source'],
  imageSeed: number,
): ImagingExam {
  return {
    id,
    modality: protocol.modality,
    bodyPart: protocol.bodyPart,
    protocol: protocol.name,
    sequences: protocol.sequences.map((s) => ({ ...s })),
    patientId: who.patientId,
    patientName: who.patientName,
    source,
    imageSeed,
  }
}

/** The durations of one visit, drawn when the scanner takes the patient (sim seconds). */
export interface ExamPlan {
  /** The operator calls the patient. */
  callS: number
  /** MRI: in the cubicle (0 for a patient who is already changed). */
  changeS: number
  /** MRI: the safety-screening talk (0 for other modalities). */
  screenS: number
  /** CT, X-ray, ultrasound: questions on the table before positioning (0 for MRI and for the demo patient). */
  explainS: number
  positionS: number
  /** The pause after sequence i, for i = 0 .. n-2. */
  gapS: number[]
  tableS: number
  cleanupS: number
  /** From "images sent" to "report ready". */
  reportS: number
}

export interface PlanOptions {
  /** The demo patient is already changed and already briefed. */
  demo: boolean
  /** An ER patient arrives on the table by porter: no calling, no changing. */
  transported: boolean
}

const span = (r: Record<string, readonly [number, number]>, m: string): readonly [number, number] => r[m] ?? [0, 0]

export function drawPlan(rng: Rng, exam: ImagingExam, o: PlanOptions): ExamPlan {
  const m = exam.modality
  const cfg = CONFIG.imaging
  // MRI total prep = cubicle + screening; the demo patient keeps only the screening
  const prep = m === 'mri' ? rng.between(cfg.mriPrepSeconds) : 0
  const changeS = m === 'mri' && !o.demo && !o.transported ? prep * cfg.mriChangeShare : 0
  const screenS = m === 'mri' ? Math.max(35, prep * (1 - cfg.mriChangeShare)) : 0
  const explainS = m === 'mri' || o.demo ? 0 : rng.between(span(cfg.explainSeconds, m)) * (o.transported ? 0.6 : 1)
  const positionS = rng.between(span(cfg.positioningSeconds, m))
  const gapS: number[] = []
  for (let i = 0; i < exam.sequences.length - 1; i++) gapS.push(rng.between(cfg.betweenStepsSeconds))
  return {
    callS: o.demo ? cfg.demoCallSeconds : cfg.callSeconds,
    changeS,
    screenS,
    explainS,
    positionS,
    gapS,
    tableS: cfg.tableSeconds[m] ?? 0,
    cleanupS: rng.between(cfg.cleanupSeconds),
    reportS: rng.between(span(cfg.reportSeconds, m)),
  }
}

/** Seconds a sequence holds the scanner: an X-ray exposure is held for the detector read-out. */
export function sequenceSeconds(m: ImagingModality, s: ScanSequence): number {
  return m === 'xray' ? Math.max(s.seconds, CONFIG.imaging.minExposureSeconds) : s.seconds
}

/** Time from the first sequence to the end of the last, with the pauses between (the scanning phase). */
export function scanningSeconds(exam: ImagingExam, plan: ExamPlan): number {
  let t = 0
  for (let i = 0; i < exam.sequences.length; i++) {
    t += sequenceSeconds(exam.modality, exam.sequences[i])
    if (i < plan.gapS.length) t += plan.gapS[i]
  }
  return t
}

/** The hash of a string to a 31-bit seed (so a patient's images are the same on every replay). */
export function imageSeedOf(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 0) & 0x7fffffff
}
