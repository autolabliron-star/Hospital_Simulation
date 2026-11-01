/**
 * Building an exam from a protocol, and drawing the durations of one visit to a scanner. Pure and deterministic: every
 * random draw comes from the Rng passed in, in a fixed order, so the same seed gives the same exam times.
 */
import { CONFIG } from '../config'
import type { Rng } from '../rng'
import type { BodyPart, ImagingExam, ImagingModality, ScanSequence, ScanStep } from '../types'

const CRYO = CONFIG.imaging.cryo

/** What the sim needs from a protocol (src/content/imaging.ts `Protocol` satisfies it). */
export interface ProtocolLike {
  id: string
  modality: ImagingModality
  bodyPart: BodyPart
  name: string
  sequences: ScanSequence[]
}

/**
 * A ProSense case's exam: the contract's `ImagingExam` plus what the picture needs of the case (R5 fix K9): the lump it treats, in mm. It is structurally an
 * `ImagingExam` (every consumer takes it); `lumpMmOfExam` reads the field back from one the type does not know. (Change request: `lumpMm?: number` on
 * `ImagingExam` in src/sim/types.ts, then this extension can go.)
 */
export interface CryoExam extends ImagingExam {
  lumpMm?: number
}

/** The size (mm) of the lump the case treats (a ProSense case's exam; undefined for every scan). */
export function lumpMmOfExam(exam: ImagingExam): number | undefined {
  return (exam as CryoExam).lumpMm
}

export function buildExam(
  id: string,
  protocol: ProtocolLike,
  who: { patientId: string; patientName: string },
  source: ImagingExam['source'],
  imageSeed: number,
  /** R5 wave 3: a ProSense case's own sequences (its programme and a probe move: `cryoSequences`), in place of the protocol's. */
  sequences?: readonly ScanSequence[],
  /** R5 fix K9: the lump the ProSense case treats (mm; `CryoCase.lumpMm`): the picture draws this one. */
  lumpMm?: number,
): CryoExam {
  const exam: CryoExam = {
    id,
    modality: protocol.modality,
    bodyPart: protocol.bodyPart,
    protocol: protocol.name,
    sequences: (sequences ?? protocol.sequences).map((s) => ({ ...s })),
    patientId: who.patientId,
    patientName: who.patientName,
    source,
    imageSeed,
  }
  if (lumpMm !== undefined) exam.lumpMm = lumpMm
  return exam
}

/** The durations of one visit, drawn when the scanner takes the patient (sim seconds). */
export interface ExamPlan {
  /** The operator calls the patient. */
  callS: number
  /** MRI: in the cubicle (0 for a patient who is already changed). A ProSense case: the gown change in a cubicle before lying down (R5 fix K19; every such patient changes, the demo's too). */
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
  /**
   * R5 wave 3, a ProSense case only: the sonographer checks the console and the probe before the patient comes in, then the walk in and lying
   * down take `arriveS` (the units `check` and `arrive`, src/content/procedures.ts). Absent for every scan.
   */
  checkS?: number
  arriveS?: number
  /**
   * A watch case only: the seconds each sequence runs (the script's watch seconds of its unit), in place of the sequence's own `seconds`
   * (which then hold the console's clinical minutes). Absent: the sequences' own.
   */
  seqS?: number[]
}

export interface PlanOptions {
  /** The demo patient is already changed and already briefed. */
  demo: boolean
  /** An ER patient arrives on the table by porter: no calling, no changing. */
  transported: boolean
}

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
 * eases it back to `CRYO.thawKeep` of its size, placing the probe leaves it as it is (the first time) and, when the probe is
 * MOVED (a later placement, the fibroadenoma's second spot), lets the first ice ball melt away over the step. `grow[k]` (optional) is
 * the share of freeze `k`'s window over which the ice grows, or of a moved probe's window over which the old ice melts (the thaw that comes
 * before the move); it then holds for the rest (the doctor measures it, the probe is moved). Pure, no allocation: the scene may call it.
 */
export function iceSize(sequences: readonly ScanSequence[], i: number, progress: number, grow?: ArrayLike<number>): number {
  let last = -1
  for (let k = 0; k < sequences.length; k++) if (stepOf(sequences[k]) === 'freeze') last = k
  let size = 0
  for (let k = 0; k <= i && k < sequences.length; k++) {
    const q = k < i ? 1 : progress <= 0 ? 0 : progress >= 1 ? 1 : progress
    const step = stepOf(sequences[k])
    if (step === 'freeze') {
      const g = grow !== undefined && grow[k] > 0 && grow[k] < 1 ? Math.min(1, q / grow[k]) : q
      const target = k === last ? 1 : Math.max(size, CRYO.firstFreezeSize)
      size += (target - size) * easeOut(g)
    } else if (step === 'thaw') {
      size -= size * (1 - CRYO.thawKeep) * smooth(q)
    } else if (step === 'place' && k > 0) {
      // a moved probe: the old ice ball melts over `grow[k]` of the step's window (the thaw that starts it) and is gone for the rest
      const g = grow !== undefined && grow[k] > 0 && grow[k] < 1 ? Math.min(1, q / grow[k]) : q
      size -= size * smooth(g)
    }
  }
  return size
}

// ---------------------------------------------------------------------------------------------
// R5 wave 3: one ProSense case (its lump, its programme, whether the probe is moved) and its exam
// ---------------------------------------------------------------------------------------------

/** What a ProSense case's parameters are (drawn once, from a NEW fork, `cryoCaseFor`). */
export interface CryoCase {
  protocolId: string
  /** The lump's size (mm): a fibroadenoma's size picks its programme and whether the probe has to be moved. */
  lumpMm: number
  /** The console programme in clinical minutes [freeze 1, thaw, freeze 2]. */
  minutes: readonly number[]
  /** The probe is moved to a second spot for a second freeze (a fibroadenoma bigger than one ice ball). */
  relocate: boolean
}

/** Is this protocol a ProSense cryoablation (a procedure of the ultrasound with a programme)? */
export function isCryoProtocol(protocolId: string): boolean {
  return Object.hasOwn(CONFIG.imaging.cryoAges, protocolId)
}

function programmeFor(protocolId: string, lumpMm: number): readonly number[] {
  const fixed = CRYO.programmes[protocolId]
  if (fixed !== undefined) return fixed.minutes
  const list = CRYO.fibroadenoma.programmes
  for (const p of list) if (lumpMm <= p.upToMm) return p.minutes
  return list[list.length - 1].minutes
}

/**
 * The parameters of a case of `protocolId` in the living day: the breast cancer's are fixed (a lump of about 1.2 cm, the ICE3 programme), a
 * fibroadenoma's lump is drawn from `rng` (a NEW fork per booking: nothing else draws from it), which picks its programme and whether the probe moves.
 */
export function cryoCaseFor(protocolId: string, rng: Rng): CryoCase {
  if (protocolId !== 'us-cryo-fibroadenoma') return { protocolId, lumpMm: 12, minutes: programmeFor(protocolId, 12), relocate: false }
  const [lo, hi] = CRYO.fibroadenoma.lumpMm
  const lumpMm = Math.round(lo + (hi - lo) * rng.float())
  return { protocolId, lumpMm, minutes: programmeFor(protocolId, lumpMm), relocate: lumpMm > CRYO.fibroadenoma.relocateOverMm }
}

/** The case a "Watch step by step" run shows: the cancer's, or a fibroadenoma big enough to need the probe moved (the script's highlight). */
export function cryoCaseForWatch(protocolId: string): CryoCase {
  if (protocolId !== 'us-cryo-fibroadenoma') return { protocolId, lumpMm: 12, minutes: programmeFor(protocolId, 12), relocate: false }
  const lumpMm = CRYO.fibroadenoma.relocateOverMm + 4
  return { protocolId, lumpMm, minutes: programmeFor(protocolId, lumpMm), relocate: true }
}

/** The unit of the script each exam sequence of a cryoablation is (the sequences run place, freeze 1, thaw, freeze 2 and, for a moved probe, place, freeze 3). */
export const SEQUENCE_UNITS: readonly string[] = ['place', 'freeze1', 'thaw', 'freeze2', 'relocate', 'freeze3']

const seqOf = (name: string, seconds: number, step: ScanStep, images: number): ScanSequence => ({ name, plane: 'sweep', contrast: 'none', seconds, images, step })

/**
 * The sequences of a ProSense case in the living day: the protocol's own for the breast cancer (so its day is unchanged); a fibroadenoma's from
 * its programme (clinical minutes x `dayScale`) and, when the probe is moved, a second placement and a third freeze.
 */
export function cryoSequences(protocol: ProtocolLike, c: CryoCase): ScanSequence[] {
  if (c.protocolId !== 'us-cryo-fibroadenoma') return protocol.sequences.map((s) => ({ ...s }))
  const f = CRYO.fibroadenoma
  const sc = (m: number) => Math.round(m * 60 * f.dayScale)
  const out = [
    seqOf('Probe placement', f.placeSeconds, 'place', 3),
    seqOf('Freeze 1', sc(c.minutes[0]), 'freeze', 4),
    seqOf('Thaw', sc(c.minutes[1]), 'thaw', 3),
    seqOf('Freeze 2', sc(c.minutes[2]), 'freeze', 4),
  ]
  if (c.relocate) out.push(seqOf('Probe moved', f.relocateSeconds, 'place', 3), seqOf('Freeze 3', sc(c.minutes[2]), 'freeze', 4))
  return out
}

/** A watch case's sequences: the console's clinical seconds on the freezes and thaws, the unit's watch seconds on the placements. */
export function cryoWatchSequences(protocol: ProtocolLike, c: CryoCase, unitSeconds: (unit: string) => number): ScanSequence[] {
  const base = cryoSequences(protocol, c)
  const clinical = [c.minutes[0], c.minutes[1], c.minutes[2], c.minutes[2]]
  return base.map((s, i) => {
    if (stepOf(s) === 'place') return { ...s, seconds: Math.max(1, unitSeconds(SEQUENCE_UNITS[i])) }
    const m = i < 4 ? clinical[i - 1] : c.minutes[2]
    return { ...s, seconds: m * 60 }
  })
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
  const plan: ExamPlan = {
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
  // a ProSense case: the console check and the walk in are fixed (no draw: the stream every other draw reads stays the same)
  if (procedure) {
    plan.checkS = CRYO.checkSeconds
    plan.arriveS = CRYO.arriveSeconds
    plan.changeS = CRYO.changeSeconds
  }
  return plan
}

/**
 * The planned seconds of a visit from its first call to the room being free again, from the MEAN of every draw `drawPlan` would make (no rng is
 * touched): the watch projection counts a demo booking ahead of the watch case with it. `scripted`: a ProSense case (the console check and the walk
 * in come first, the walk in is the script's unit `arrive`).
 */
export function expectedVisitSeconds(m: ImagingModality, sequences: readonly ScanSequence[], o: { demo: boolean; scripted: boolean }): number {
  const cfg = CONFIG.imaging
  const mid = (r: readonly [number, number]): number => (r[0] + r[1]) / 2
  const procedure = sequences.some((q) => stepOf(q) !== 'sweep')
  const explain = procedure
    ? mid(span(cfg.explainSeconds, m)) * (o.demo ? CRYO.demoExplainFactor : CRYO.explainFactor)
    : m === 'mri' || o.demo
      ? 0
      : mid(span(cfg.explainSeconds, m))
  const position = mid(span(cfg.positioningSeconds, m)) * (procedure ? CRYO.positionFactor : 1)
  let scanning = 0
  for (let i = 0; i < sequences.length; i++) scanning += m === 'xray' ? Math.max(sequences[i].seconds, cfg.minExposureSeconds) : sequences[i].seconds
  scanning += Math.max(0, sequences.length - 1) * mid(cfg.betweenStepsSeconds)
  const tbl = m === 'mri' || m === 'ct' ? 2 * (cfg.tableSeconds[m] ?? 0) : 0
  const cleanup = mid(cfg.cleanupSeconds) * (procedure ? CRYO.cleanupFactor : 1)
  const before = o.scripted ? CRYO.checkSeconds + CRYO.arriveSeconds : (o.demo ? cfg.demoArrivalSeconds + cfg.demoCallSeconds : cfg.callSeconds) + cfg.prepWalkSeconds
  return before + explain + position + tbl + scanning + cleanup
}

/** Seconds a sequence holds the scanner: an X-ray exposure is held for the detector read-out. */
export function sequenceSeconds(m: ImagingModality, s: ScanSequence): number {
  return m === 'xray' ? Math.max(s.seconds, CONFIG.imaging.minExposureSeconds) : s.seconds
}

/** Seconds sequence `i` of an exam runs: a watch case's own (`plan.seqS`), else the sequence's. */
export function runSeconds(exam: ImagingExam, plan: ExamPlan, i: number): number {
  return plan.seqS !== undefined && plan.seqS[i] !== undefined ? plan.seqS[i] : sequenceSeconds(exam.modality, exam.sequences[i])
}

/** Time from the first sequence to the end of the last, with the pauses between (the scanning phase). */
export function scanningSeconds(exam: ImagingExam, plan: ExamPlan): number {
  let t = 0
  for (let i = 0; i < exam.sequences.length; i++) {
    t += runSeconds(exam, plan, i)
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
