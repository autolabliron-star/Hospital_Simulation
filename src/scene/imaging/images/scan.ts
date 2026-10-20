/**
 * Which picture belongs to which step of an exam. Pure: (exam, step, slice) -> the shape model, the look and the words round it.
 * Slices are spread across the part of the anatomy a scan covers, in the order the scanner acquires them, and every slice of every series
 * of one exam comes from the same exam seed, so the T1 and T2 of one patient show the same patient.
 */
import { mixSeed } from '@/sim/rng'
import type { ImagingExam, ImagingModality, ScanSequence } from '@/sim/types'
import { brainAxial, brainSagittal } from './brain'
import { kneeCoronal, kneeSagittal } from './knee'
import { ctLook, mriLook, xrayLook, type Look } from './looks'
import { neckAxial } from './neck'
import * as RX from './radiograph'
import type { SliceModel } from './shapes'
import { lumbarAxial, lumbarSagittal } from './spine'
import { CT_WINDOWS, windowLabel, type CtWindow } from './tones'
import { abdomenAxial, chestAxial } from './torso'
import { usViewOf, type UsView } from './ultrasound'

/** The parts of an exam the picture needs (so tests and the viewer can pass plain objects). */
export type ExamLike = Pick<ImagingExam, 'modality' | 'bodyPart' | 'imageSeed' | 'sequences'> & Partial<Pick<ImagingExam, 'id' | 'protocol' | 'patientName'>>

export const CHEST_WINDOW: CtWindow = { width: 1400, level: -400 }

export interface SlicePick {
  kind: 'slice'
  model: SliceModel
  look: Look
  /** MRI surface coils: the picture falls off toward the edges. */
  coil: boolean
  /** A stable number to offset the grain tile by, so each slice has its own noise. */
  grain: number
  /** Short words for the image corner: "T2 SAG", "W:80 L:40". */
  tag: string
}

export interface UsPick {
  kind: 'us'
  view: UsView
  tag: string
}

export type ImagePick = SlicePick | UsPick

const PLANE_TAG: Record<ScanSequence['plane'], string> = { axial: 'AX', sagittal: 'SAG', coronal: 'COR', projection: '', sweep: '', scout: 'LOC' }

/** Position of slice `k` of `n` across [lo, hi]. */
export function slicePos(k: number, n: number, lo: number, hi: number): number {
  if (n <= 1) return (lo + hi) / 2
  return lo + ((hi - lo) * (Math.max(0, Math.min(n - 1, k)) + 0.5)) / n
}

function grainOf(exam: ExamLike, seq: number, slice: number): number {
  const h = mixSeed(exam.imageSeed >>> 0, seq * 131 + slice * 7 + 1)
  return (h % 10007) / 10007
}

const isLateral = (s: ScanSequence): boolean => /lateral/i.test(s.name)

function mriPick(exam: ExamLike, seq: ScanSequence, si: number, k: number): SlicePick {
  const seed = exam.imageSeed
  const n = seq.images
  const look = mriLook(seq.contrast)
  const tag = seq.plane === 'scout' ? 'LOCALISER' : `${look.label}${PLANE_TAG[seq.plane] ? ' ' + PLANE_TAG[seq.plane] : ''}`
  const grain = grainOf(exam, si, k)
  let model: SliceModel
  let coil = true
  switch (exam.bodyPart) {
    case 'lumbarSpine':
    case 'cervicalSpine':
      model = seq.plane === 'axial' ? lumbarAxial(seed, slicePos(k, n, 0.04, 0.96)) : lumbarSagittal(seed, seq.plane === 'scout' ? 0.5 : slicePos(k, n, 0.22, 0.78))
      break
    case 'knee':
      model = seq.plane === 'sagittal' || seq.plane === 'scout' ? kneeSagittal(seed, seq.plane === 'scout' ? 0.5 : slicePos(k, n, 0.12, 0.88)) : kneeCoronal(seed, slicePos(k, n, 0.12, 0.9))
      break
    default:
      coil = false
      model = seq.plane === 'axial' ? brainAxial(seed, slicePos(k, n, 0.05, 0.95)) : brainSagittal(seed, seq.plane === 'scout' ? 0.5 : slicePos(k, n, 0.2, 0.8))
  }
  return { kind: 'slice', model, look, coil, grain, tag }
}

function ctPick(exam: ExamLike, seq: ScanSequence, si: number, k: number): SlicePick {
  const seed = exam.imageSeed
  const n = seq.images
  const grain = grainOf(exam, si, k)
  if (seq.plane === 'scout') {
    // the topogram: a flat "radiograph" of the region
    const model = exam.bodyPart === 'chest' ? RX.chestPA(seed) : exam.bodyPart === 'head' || exam.bodyPart === 'cervicalSpine' ? brainSagittal(seed, 0.5, true) : RX.pelvisAP(seed)
    return { kind: 'slice', model, look: xrayLook(), coil: false, grain, tag: 'TOPOGRAM' }
  }
  switch (exam.bodyPart) {
    case 'head':
    case 'brain':
      return { kind: 'slice', model: brainAxial(seed, slicePos(k, n, 0.04, 0.96), true), look: ctLook('plain', CT_WINDOWS.brain), coil: false, grain, tag: `AX  ${windowLabel(CT_WINDOWS.brain)}` }
    case 'cervicalSpine':
    case 'neck':
      return { kind: 'slice', model: neckAxial(seed, slicePos(k, n, 0, 1)), look: ctLook(seq.contrast, CT_WINDOWS.neck), coil: false, grain, tag: `AX  ${windowLabel(CT_WINDOWS.neck)}` }
    case 'chest':
      return { kind: 'slice', model: chestAxial(seed, slicePos(k, n, 0.02, 0.98)), look: ctLook(seq.contrast, CHEST_WINDOW), coil: false, grain, tag: `AX  ${windowLabel(CHEST_WINDOW)}` }
    default:
      return { kind: 'slice', model: abdomenAxial(seed, slicePos(k, n, 0.02, 0.98)), look: ctLook(seq.contrast, CT_WINDOWS.abdomen), coil: false, grain, tag: `AX  ${windowLabel(CT_WINDOWS.abdomen)}` }
  }
}

function xrayPick(exam: ExamLike, seq: ScanSequence, si: number): SlicePick {
  const seed = exam.imageSeed
  const lat = isLateral(seq)
  let model: SliceModel
  switch (exam.bodyPart) {
    case 'ankle':
      model = lat ? RX.ankleLateral(seed) : RX.ankleAP(seed)
      break
    case 'wrist':
      model = lat ? RX.wristLateral(seed) : RX.wristPA(seed)
      break
    case 'chest':
      model = lat ? RX.chestLateral(seed) : RX.chestPA(seed)
      break
    case 'knee':
      // R3: no vector radiograph of the knee; the worker draws it, and without one the knee's bone shapes stand in
      model = lat ? kneeSagittal(seed, 0.5) : kneeCoronal(seed, 0.5)
      break
    default:
      model = lat ? RX.hipLateral(seed) : RX.pelvisAP(seed)
  }
  return { kind: 'slice', model, look: xrayLook(), coil: false, grain: grainOf(exam, si, 0), tag: seq.name.split(' ')[0].toUpperCase() }
}

/** The picture for slice `k` of step `si` of an exam. */
export function pickImage(exam: ExamLike, si: number, k: number): ImagePick {
  const seq = exam.sequences[Math.max(0, Math.min(exam.sequences.length - 1, si))]
  switch (exam.modality) {
    case 'mri':
      return mriPick(exam, seq, si, k)
    case 'ct':
      return ctPick(exam, seq, si, k)
    case 'xray':
      return xrayPick(exam, seq, si)
    case 'us':
      return { kind: 'us', view: usViewOf(seq.name, exam.bodyPart), tag: 'B-MODE' }
  }
}

/** The slice number (0-based) that a step has reached at `progress` (0..1), and how far through that slice it is. */
export function sliceAt(images: number, progress: number): { index: number; frac: number } {
  const n = Math.max(1, images)
  const p = Math.max(0, Math.min(1, progress)) * n
  const index = Math.min(n - 1, Math.floor(p))
  return { index, frac: Math.min(1, p - index) }
}

// ---------------------------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------------------------

const MRI_PARAMS: Record<string, string> = {
  T1: 'TR 520 TE 12',
  T2: 'TR 4200 TE 98',
  FLAIR: 'TR 9000 TE 120 TI 2500',
  DWI: 'b 0/1000',
  PD: 'TR 3000 TE 35 FS',
  STIR: 'TR 3500 TE 40 TI 150',
  none: 'Localiser',
}

/** Scan parameters in a line, the way a console shows them (invented, plausible, fixed). */
export function paramsLine(modality: ImagingModality, seq: ScanSequence, bodyPart: string): string {
  switch (modality) {
    case 'mri':
      return `${MRI_PARAMS[seq.contrast] ?? ''}  3.0 T`.trim()
    case 'ct':
      return seq.plane === 'scout' ? '120 kV  35 mA' : `120 kV  ${bodyPart === 'head' ? 280 : 210} mAs  ${seq.contrast === 'plain' ? '5.0' : '1.25'} mm`
    case 'xray':
      return bodyPart === 'chest' ? '110 kV  2 mAs' : bodyPart === 'pelvis' ? '75 kV  16 mAs' : '55 kV  3.2 mAs'
    case 'us':
      return 'C5-1  3.5 MHz  Gain 62'
  }
}
