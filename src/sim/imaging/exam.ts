/**
 * Building an exam from a protocol, and drawing the durations of one visit to a scanner. Pure and deterministic: every
 * random draw comes from the Rng passed in, in a fixed order, so the same seed gives the same exam times.
 */
import { CONFIG } from '../config'
import type { Rng } from '../rng'
import type { BodyPart, ImagingExam, ImagingModality, ScanSequence, ScanStep } from '../types'

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

/**
 * The ultrasound-guided cryoablation (ProSense, docs/research/cryoablation.md): an ultrasound "exam" whose steps are a procedure
 * (place, freeze, thaw, freeze) instead of scan sweeps. Change request: these belong in CONFIG.imaging (`cryo`).
 */
export const CRYO = {
  /** The consent and the local anaesthetic take this many times the ultrasound history talk (`explainSeconds.us`). */
  explainFactor: 3,
  /** The demo patient is already consented: only the local anaesthetic, this share of a normal talk. */
  demoExplainFactor: 0.4,
  /** Skin prep, gel and a sterile drape: this many times the ultrasound positioning. */
  positionFactor: 2.5,
  /** A small dressing on the probe site, then the room wiped down: this many times the usual cleanup. */
  cleanupFactor: 2,
  /** Ice-ball size (0..1) at the end of a freeze that is not the last one; the last freeze ends at 1. */
  firstFreezeSize: 0.8,
  /** The share of its size the ice ball keeps through a thaw. */
  thawKeep: 0.85,
  /** `activity` (cryogen flow) while the probe is being placed: probe contact only, no cryogen. */
  placeActivity: 0.15,
  /** How fast the cryogen flow ramps up at a freeze, and down at a thaw or a pause (fraction per second). */
  flowUpPerSecond: 0.25,
  flowDownPerSecond: 0.2,
} as const

/** What a sequence does (absent = a scan sweep). */
export function stepOf(s: ScanSequence): ScanStep {
  return s.step ?? 'sweep'
}

/** Is this exam a procedure (the cryoablation) rather than a scan? */
export function isProcedure(exam: { sequences: readonly ScanSequence[] }): boolean {
  for (const s of exam.sequences) if (stepOf(s) !== 'sweep') return true
  return false
}

const easeOut = (k: number): number => 1 - (1 - k) * (1 - k)
const smooth = (k: number): number => k * k * (3 - 2 * k)

/**
 * The ice ball's size (0..1) at `progress` through sequence `i` of a cryoablation (`i` = -1: none yet), carried across the
 * steps: a freeze grows it fast at first and then slower (towards `CRYO.firstFreezeSize`, the last freeze to 1), a thaw
 * eases it back to `CRYO.thawKeep` of its size, placing the probe leaves it as it is. Pure, no allocation: the scene may call it.
 */
export function iceSize(sequences: readonly ScanSequence[], i: number, progress: number): number {
  let last = -1
  for (let k = 0; k < sequences.length; k++) if (stepOf(sequences[k]) === 'freeze') last = k
  let size = 0
  for (let k = 0; k <= i && k < sequences.length; k++) {
    const q = k < i ? 1 : progress <= 0 ? 0 : progress >= 1 ? 1 : progress
    const step = stepOf(sequences[k])
    if (step === 'freeze') {
      const target = k === last ? 1 : Math.max(size, CRYO.firstFreezeSize)
      size += (target - size) * easeOut(q)
    } else if (step === 'thaw') {
      size -= size * (1 - CRYO.thawKeep) * smooth(q)
    }
  }
  return size
}

const span = (r: Record<string, readonly [number, number]>, m: string): readonly [number, number] => r[m] ?? [0, 0]

/** Is the pause after sequence `i` the wait between two contrast phases of a CT (arterial, then portal venous)? */
export function isPhaseGap(exam: ImagingExam, i: number): boolean {
  return exam.modality === 'ct' && exam.sequences[i]?.contrast === 'arterial' && exam.sequences[i + 1]?.contrast === 'portal'
}

export function drawPlan(rng: Rng, exam: ImagingExam, o: PlanOptions): ExamPlan {
  const m = exam.modality
  const cfg = CONFIG.imaging
  // MRI total prep = cubicle + screening; the demo patient keeps only the screening
  const prep = m === 'mri' ? rng.between(cfg.mriPrepSeconds) : 0
  const changeS = m === 'mri' && !o.demo && !o.transported ? prep * cfg.mriChangeShare : 0
  const screenS = m === 'mri' ? Math.max(35, prep * (1 - cfg.mriChangeShare)) : 0
  const procedure = isProcedure(exam)
  // the cryoablation: consent and the local anaesthetic before, skin prep and a sterile drape, a dressing after (the same draws, scaled,
  // except that the demo patient still gets the local anaesthetic: one extra draw for her)
  const explainS = procedure
    ? rng.between(span(cfg.explainSeconds, m)) * (o.demo ? CRYO.demoExplainFactor : CRYO.explainFactor)
    : m === 'mri' || o.demo
      ? 0
      : rng.between(span(cfg.explainSeconds, m)) * (o.transported ? 0.6 : 1)
  const positionS = rng.between(span(cfg.positioningSeconds, m)) * (procedure ? CRYO.positionFactor : 1)
  const gapS: number[] = []
  for (let i = 0; i < exam.sequences.length - 1; i++) {
    // one draw per gap, whatever its kind, so the stream stays the same length; a contrast CT's portal phase follows the arterial one
    // `ctPhaseGapSeconds` later (the contrast takes 35-45 s to reach the veins), not the generic pause of a setup between sequences
    gapS.push(rng.between(isPhaseGap(exam, i) ? cfg.ctPhaseGapSeconds : cfg.betweenStepsSeconds))
  }
  return {
    callS: o.demo ? cfg.demoCallSeconds : cfg.callSeconds,
    changeS,
    screenS,
    explainS,
    positionS,
    gapS,
    tableS: cfg.tableSeconds[m] ?? 0,
    cleanupS: rng.between(cfg.cleanupSeconds) * (procedure ? CRYO.cleanupFactor : 1),
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
