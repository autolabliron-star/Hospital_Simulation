/**
 * Draws one ultrasound frame: the sector fan (or, for the breast, the linear probe's rectangle) with near-field layers, the structures of
 * `usScene` at their echo level, posterior enhancement and shadows, moving speckle (a wrapped noise tile slid over the picture), depth
 * attenuation and the ruler. About 25 canvas calls plus a dozen tile blits: well under a millisecond, so it can run at 10 Hz in the focused room.
 *
 * During a cryoablation (ScanSequence.step 'place' | 'freeze' | 'thaw', docs/research/cryoablation.md) it adds what the sonographer
 * watches: the cryoprobe as a bright straight line coming in from the side to the tumour, then the ice ball as it really looks on
 * ultrasound: a thick bright curved leading edge facing the transducer with a black acoustic shadow behind it, growing with the ice ball's
 * size (ScannerState.detail) until the tumour and a margin round it have gone into the shadow; while thawing the edge is softer and the
 * shadow lighter. `paintCryoReadout` writes the step, the probe temperature, the step timer and the ice ball's size over the picture.
 *
 * R5 wave 3: a scripted ProSense case (the step engine, src/sim/imaging/prosense.ts) names the stage of the picture in the script's `scope` key
 * of each step (`ScannerState.procedure.scope`): survey (the lump measured, the probe's path planned), local (the anaesthetic needle and its
 * dark pocket), nick, probeIn (the probe line entering the lump), saline (a dark fluid layer lifting the skin off the lump), programme, freeze
 * (the ice ball), measure35 / measure40 (calipers on the ice ball's long axis, the target in the readout), lumpCheck (the fibroadenoma inside
 * the ice ball), thaw, thawFree (the ice melting), probeOut, dressing, relocate (the probe moved to a second spot, the first ice ball gone) and
 * freeze3 (the ice ball over the second spot), hold (the skin prep, the draping and the Time Out: the survey's stored picture, one still frame: the transducer is not
 * on the skin), standby (the probe out and the gel wiped: a still, quiet frame). `cryoReadoutInto`'s optional last
 * argument carries them in. The picture follows the sim's ice ball (`ScannerState.detail`) everywhere, including its melt in the thaw before the probe
 * is moved or drawn out; the lump it draws is the case's own (`usScene`'s `lumpMm`), and every mark (ice ball, callipers, lump, probe) stays inside the
 * linear probe's field (R5 fixes K9-K15).
 *
 * Nothing here allocates per call: the readout's strings are rebuilt only when a shown value changes (cryoReadoutInto), the colours are
 * fixed strings, the depth gradient is kept per context.
 */
import { IMAGING_UI, fillImaging } from '@/content/imagingUi'
import { CONFIG } from '@/sim/config'
import type { ImagingExam, ScanStep } from '@/sim/types'
import type { Ctx2D, Surface } from './ctx'
import { grey } from './ctx'
import { blitTile } from './paint'
import { US_APEX_Y, US_DEPTH_END, US_HALF_ANGLE, type UsScene } from './ultrasound'

const CRYO = CONFIG.imaging.cryo

/** The fan's depth reaches this fraction of the picture height. */
export const US_BOTTOM = US_DEPTH_END
/**
 * Half the width of the linear probe's picture, as a fraction of the picture: a wide-footprint array, 6 cm deep, so the 42 mm ice ball, the lump and the
 * probe's second spot (R5 fix K12: the 40 mm callipers were off the 0.36-wide picture) all fit with the depth ruler clear at the right edge.
 */
export const US_LINEAR_HALF = 0.46

/** The fan's near-field interfaces (fractions of the picture from the apex). */
const NEAR_LAYERS: readonly number[] = [0.012, 0.075, 0.108]
/** The ruler's numbers, made once. */
const CM_LABELS: readonly string[] = Array.from({ length: 41 }, (_, i) => String(i))

type Gradient = ReturnType<Ctx2D['createLinearGradient']>
let gradCtx: Ctx2D | null = null
let gradKey = -1
let gradCached: Gradient | null = null

/** The depth-attenuation gradient, kept while the context and the geometry stay the same. */
function depthGradient(t: Ctx2D, ay: number, R: number): Gradient {
  const key = ay * 100003 + R
  if (gradCached && gradCtx === t && gradKey === key) return gradCached
  const g = t.createLinearGradient(0, ay, 0, ay + R)
  g.addColorStop(0, 'rgb(255,255,255)')
  g.addColorStop(1, 'rgb(120,120,120)')
  gradCtx = t
  gradKey = key
  gradCached = g
  return g
}

export function paintUltrasound(t: Ctx2D, S: number, scene: UsScene, speckle: Surface, fine: Surface, time: number, phase: number, live: boolean, cryo: CryoReadout | null = null): void {
  t.setTransform(1, 0, 0, 1, 0, 0)
  t.globalAlpha = 1
  t.globalCompositeOperation = 'source-over'
  t.fillStyle = '#020304'
  t.fillRect(0, 0, S, S)

  const ax = S / 2
  const ay = US_APEX_Y * S
  const R = (US_BOTTOM - US_APEX_Y) * S
  const linear = scene.linear
  const hw = US_LINEAR_HALF * S
  t.save()
  t.beginPath()
  if (linear) t.rect(ax - hw, ay, hw * 2, R)
  else {
    t.moveTo(ax, ay)
    t.arc(ax, ay, R, Math.PI / 2 - US_HALF_ANGLE, Math.PI / 2 + US_HALF_ANGLE)
    t.closePath()
  }
  t.clip()

  t.fillStyle = grey(0.2)
  t.fillRect(0, ay, S, R + 2)
  if (linear) {
    // the skin under a high-frequency probe: a bright entry line, the dermis a little brighter than the fat below it
    t.fillStyle = grey(0.42)
    t.fillRect(0, ay, S, 0.032 * S)
    t.fillStyle = grey(0.92)
    t.fillRect(0, ay + 0.002 * S, S, 0.006 * S)
  } else {
    // soft tissue under the skin: a darker near field with bright layer interfaces, then the general level
    t.fillStyle = grey(0.1)
    t.fillRect(0, ay, S, 0.07 * S)
    t.strokeStyle = grey(0.9)
    t.lineWidth = 1.6
    t.globalAlpha = 0.85
    for (let i = 0; i < NEAR_LAYERS.length; i++) {
      t.beginPath()
      t.arc(ax, ay, NEAR_LAYERS[i] * S, Math.PI / 2 - US_HALF_ANGLE, Math.PI / 2 + US_HALF_ANGLE)
      t.stroke()
      t.globalAlpha = 0.45
    }
    t.globalAlpha = 1
  }

  // the structures, in order: body first, then what lies in it
  for (let i = 0; i < scene.count; i++) {
    const b = scene.blobs[i]
    if (b.rx <= 0.001 || b.ry <= 0.001) continue
    t.fillStyle = grey(0.04 + b.echo * 0.78)
    t.beginPath()
    t.ellipse(ax + b.cx * S, b.cy * S, b.rx * S, b.ry * S, b.rot, 0, Math.PI * 2)
    t.fill()
    if (b.wall > 0) {
      t.strokeStyle = grey(0.95)
      t.lineWidth = 1.3
      t.globalAlpha = b.wall
      t.stroke()
      t.globalAlpha = 1
    }
  }
  // enhancement behind fluid, shadow behind stones: vertical bands below the structure
  for (let i = 0; i < scene.count; i++) {
    const b = scene.blobs[i]
    if (b.behind === 0 || b.rx <= 0.001) continue
    const x0 = ax + (b.cx - b.rx * 0.9) * S
    const y0 = (b.cy + b.ry) * S
    const w = b.rx * 1.8 * S
    if (b.behind > 0) {
      t.globalCompositeOperation = 'lighter'
      t.fillStyle = grey(0.2 * b.behind)
      t.fillRect(x0, y0, w, (US_BOTTOM - b.cy - b.ry) * S)
    } else {
      t.globalCompositeOperation = 'multiply'
      t.fillStyle = grey(0.18)
      t.fillRect(x0, y0, w, (US_BOTTOM - b.cy - b.ry) * S)
    }
    t.globalCompositeOperation = 'source-over'
  }

  // speckle: slides with the probe, so it looks like grains that belong to the tissue (finer under the high-frequency linear probe)
  const grain = linear ? 1.1 : 1.6
  t.globalCompositeOperation = 'overlay'
  t.globalAlpha = 0.8
  blitTile(t, speckle, S, phase * S * 0.35 + 7, time * 0.4 + 11, grain)
  t.globalCompositeOperation = 'soft-light'
  t.globalAlpha = 0.35
  blitTile(t, fine, S, phase * S * 0.35 * 1.3 + 91, time * 0.4 * 1.2 + 3, 1.3)
  t.globalCompositeOperation = 'lighter'
  t.globalAlpha = 0.035
  blitTile(t, fine, S, 130 + phase * 40, 55)
  // depth attenuation (gain compensation leaves the far field a little dimmer)
  t.globalCompositeOperation = 'multiply'
  t.globalAlpha = 1
  t.fillStyle = depthGradient(t, ay, R)
  t.fillRect(0, ay, S, R + 2)
  t.globalCompositeOperation = 'source-over'
  // the cryoablation: the probe, then the ice ball's shadow and leading edge over everything (no speckle in an acoustic shadow)
  if (cryo && cryo.active) paintCryoOverlay(t, S, scene, cryo)
  t.restore()

  // the fan's edges and the depth ruler
  t.strokeStyle = grey(0.35)
  t.lineWidth = 1
  if (!linear) {
    t.beginPath()
    t.moveTo(ax, ay)
    t.lineTo(ax + Math.sin(US_HALF_ANGLE) * R, ay + Math.cos(US_HALF_ANGLE) * R)
    t.moveTo(ax, ay)
    t.lineTo(ax - Math.sin(US_HALF_ANGLE) * R, ay + Math.cos(US_HALF_ANGLE) * R)
    t.stroke()
  }
  t.fillStyle = grey(0.8)
  t.strokeStyle = grey(0.8)
  t.font = '9px ui-monospace, Menlo, monospace'
  t.textAlign = 'right'
  t.textBaseline = 'middle'
  const every = scene.depthCm <= 6 ? 1 : 2
  for (let cm = 1; cm <= scene.depthCm; cm++) {
    const y = ay + (cm / scene.depthCm) * R
    const major = cm % every === 0
    t.beginPath()
    t.moveTo(S - 4, y)
    t.lineTo(S - (major ? 12 : 8), y)
    t.stroke()
    if (major) t.fillText(CM_LABELS[cm < CM_LABELS.length ? cm : 0], S - 15, y)
  }
  t.textAlign = 'left'
  t.textBaseline = 'alphabetic'
  void live
}

// ---------------------------------------------------------------------------------------------
// The cryoablation (ProSense, liquid nitrogen): probe, ice ball, readout
// ---------------------------------------------------------------------------------------------

/**
 * The ice ball's radius along the beam at full size (detail 1), mm (CONFIG.imaging.cryo): 13 mm round a ~12 mm tumour leaves a margin of about 6 mm,
 * and its leading edge stays 6 mm or more under the skin, where the saline layer lifts the skin away from it.
 */
export const ICE_RADIUS_MM = CRYO.iceRadiusMm
/** The ice ball is longer along the probe than across it (an ellipse on the picture: across = radius x this): 41.6 mm along the probe at full size, 35.8 after the first freeze. */
export const ICE_ELONGATION = CRYO.iceElongation
/**
 * The cryoprobe's slope on the picture (radians below the horizontal): it comes in from the side, along the lump's long axis and parallel to the chest wall
 * (docs/research/procedures.md section 11), as the survey's planned path does: under 2 degrees (R5 fix K13: it was 17 degrees oblique).
 */
export const NEEDLE_ANGLE = 0.03
/** The probe in the tissue before it cools (°C), the tip at the coldest (ProSense: about -170 °C) and where the thaw ends. */
export const PROBE_WARM_C = 34
export const PROBE_COLD_C = -170
const THAW_RATE = 3.2
const FREEZE_RATE = 14
/** Where the probe's thaw ends (°C): the cold tip eased from -170 toward 0 by `THAW_RATE`. */
export const PROBE_THAW_END_C = PROBE_COLD_C * Math.exp(-THAW_RATE)

/** What a scan step does (absent = a plain sweep). */
export const stepOf = (seq: { step?: ScanStep }): ScanStep => seq.step ?? 'sweep'

/** Is this exam a cryoablation (any step that places, freezes or thaws)? */
export function isCryoExam(exam: Pick<ImagingExam, 'sequences'> | null | undefined): boolean {
  if (!exam) return false
  for (let i = 0; i < exam.sequences.length; i++) if (stepOf(exam.sequences[i]) !== 'sweep') return true
  return false
}

/** The probe temperature (°C) at `p` (0..1) through a step: warm while placing, plunging to -170 when freezing, rising toward 0 thawing. */
export function probeTempC(step: ScanStep, freezeNo: number, p: number): number {
  const q = p < 0 ? 0 : p > 1 ? 1 : p
  switch (step) {
    case 'freeze': {
      const from = freezeNo <= 1 ? PROBE_WARM_C : PROBE_COLD_C * Math.exp(-THAW_RATE)
      return PROBE_COLD_C + (from - PROBE_COLD_C) * Math.exp(-q * FREEZE_RATE)
    }
    case 'thaw':
      return PROBE_COLD_C * Math.exp(-q * THAW_RATE)
    default:
      return PROBE_WARM_C
  }
}

/** The probe's temperature (°C) as it is drawn out: from where the thaw ended, warming to body temperature as `p` (0..1) goes through the probe-out step. */
export function probeOutTempC(p: number): number {
  const q = p < 0 ? 0 : p > 1 ? 1 : p
  return PROBE_THAW_END_C + (PROBE_WARM_C - PROBE_THAW_END_C) * q * q * (3 - 2 * q)
}

/** The ice ball on the picture (image units: x across from the middle, y down). */
export interface IceShape {
  cx: number
  cy: number
  /** Half-width across the picture (along the probe). */
  rx: number
  /** Radius along the beam: the leading edge is `ry` nearer the transducer than the centre. */
  ry: number
}

export const newIceShape = (): IceShape => ({ cx: 0, cy: 0, rx: 0, ry: 0 })

/** The ice ball of size `ice` (0..1, ScannerState.detail) round the scene's tumour, `shift` image units along the picture (a moved probe). */
export function iceShapeInto(scene: UsScene, ice: number, out: IceShape, shift = 0): IceShape {
  const k = ice < 0 ? 0 : ice > 1 ? 1 : ice
  const r = ICE_RADIUS_MM * k * scene.mm
  out.cx = scene.tx + shift
  out.cy = scene.ty
  out.rx = r * ICE_ELONGATION
  out.ry = r
  return out
}

/** The cryoprobe on the picture: where it enters (off the left edge) and where its tip is now. */
export interface NeedleLine {
  ex: number
  ey: number
  px: number
  py: number
}

export const newNeedleLine = (): NeedleLine => ({ ex: 0, ey: 0, px: 0, py: 0 })

/** The probe advanced `advance` (0..1) of the way to its place: through the tumour, the tip just past its centre (`shift` image units along the picture: a moved probe). */
export function needleInto(scene: UsScene, advance: number, out: NeedleLine, shift = 0): NeedleLine {
  const c = Math.cos(NEEDLE_ANGLE)
  const s = Math.sin(NEEDLE_ANGLE)
  const a = advance < 0 ? 0 : advance > 1 ? 1 : advance
  const tx = scene.tx + shift + c * scene.tr * 0.5
  const ty = scene.ty + s * scene.tr * 0.5
  const L = (tx + 0.5) / c
  out.ex = tx - c * L
  out.ey = ty - s * L
  const reach = L * (0.22 + 0.78 * a)
  out.px = out.ex + c * reach
  out.py = out.ey + s * reach
  return out
}

/** What the picture shows at a step of the scripted case (the stage a script `scope` key names). 'plain': a step without one (the exam's own: place, freeze, thaw). */
export type CryoStage =
  | 'plain'
  | 'survey'
  | 'local'
  | 'nick'
  | 'probeIn'
  | 'saline'
  | 'programme'
  | 'freeze'
  | 'measure'
  | 'lumpCheck'
  | 'thaw'
  | 'thawFree'
  | 'probeOut'
  | 'dressing'
  | 'relocate'
  | 'standby'
  | 'hold'

const SCOPE_STAGE: Readonly<Record<string, CryoStage>> = {
  survey: 'survey',
  local: 'local',
  nick: 'nick',
  probeIn: 'probeIn',
  saline: 'saline',
  programme: 'programme',
  freeze1: 'freeze',
  freeze2: 'freeze',
  freeze3: 'freeze',
  measure35: 'measure',
  measure40: 'measure',
  lumpCheck: 'lumpCheck',
  thaw: 'thaw',
  thawFree: 'thawFree',
  probeOut: 'probeOut',
  dressing: 'dressing',
  relocate: 'relocate',
  standby: 'standby',
  hold: 'hold',
}

const STAGE_CODE: Readonly<Record<CryoStage, number>> = { plain: 0, survey: 1, local: 2, nick: 3, probeIn: 4, saline: 5, programme: 6, freeze: 7, measure: 8, lumpCheck: 9, thaw: 10, thawFree: 11, probeOut: 12, dressing: 13, relocate: 14, standby: 15, hold: 16 }

/** The script scope after the dressing (the cold pack, the Sign Out, the walk out): the picture holds one still frame, the gel wiped and the probe away. */
export const STANDBY_SCOPE = 'standby'
/** The script scope of the skin prep, the draping and the Time Out (a step of the drape unit carried the survey's scope forward): the survey's stored picture, one still frame, the transducer is not on the skin. */
export const HOLD_SCOPE = 'hold'

/** The part of the procedure view the picture reads (a `ProcedureView` satisfies it). */
export interface ProcScope {
  procedureId: string | null
  scope: string | null
  progress: number
}

/** How far the probe's place moves sideways when it is moved to a second spot (mm along the picture): the first ice ball sits this far to one side, the second this far to the other. */
export const RELOCATE_MM = 6
/** The saline layer under the skin at its thickest (mm). */
export const SALINE_MM = 4

/** The words and numbers of the cryoablation readout. The strings change only when a shown value does. */
export interface CryoReadout {
  /** A cryoablation step is on screen (false: a plain sweep; nothing is drawn). */
  active: boolean
  step: ScanStep
  /** Which freeze this is (1, 2), counted through the exam. */
  freezeNo: number
  /** How far the probe has gone in, 0..1 (rises through 'place', 1 after). */
  advance: number
  /** The ice ball's size 0..1. */
  ice: number
  /** Whole degrees and seconds, and the ice ball's axes in whole mm (across x along the beam). */
  tempC: number
  elapsed: number
  iceW: number
  iceD: number
  label: string
  temp: string
  timer: string
  size: string
  kLabel: number
  kTemp: number
  kTimer: number
  kSize: number
  // --- R5 wave 3: the scripted case's stage (a plain exam leaves these at their defaults, so nothing changes for it) ---
  /** The script drives the picture (`stage` and the numbers below are meaningful). */
  scripted: boolean
  stage: CryoStage
  /** Progress 0..1 through the script's step. */
  stageP: number
  /** The probe is in the picture (false: survey, the anaesthetic, the nick, the dressing). */
  probeShown: boolean
  /** The anaesthetic needle's advance 0..1 (0: none), the saline layer's thickness 0..1, and where the probe's place is: -1 .. 1 along the picture (a moved probe: 0 otherwise). */
  needle: number
  saline: number
  shift: number
  /** Where the ice ball is centred: like `shift` (-1 .. 1), but a moved probe's old ice ball melts at the first spot while the probe slides to the second. */
  iceShift: number
  /** A measurement stage: the target in mm (35, 40), else 0; the fibroadenoma check: the whole lump is inside the ice ball (false: part of it is outside and the probe is moved). */
  target: number
  inside: boolean
  /** The colour of the readout: cold (freezing, measuring), warm (thawing, the probe coming out) or neutral (everything else: the placement, the cleanup). */
  tone: 'place' | 'cold' | 'warm'
  /** The lump's size in mm (the survey reads it; the screen sets it from the scene). */
  lumpMm: number
  /** The stage's own words: the temperature, the timer and the ice ball's size are shown only where they mean something. */
  showTemp: boolean
  showTimer: boolean
  /** The fourth line: the ice ball's size, the target, the programme or the lump's size, whichever the stage shows. */
  note: string
  kNote: number
}

export function createCryoReadout(): CryoReadout {
  return {
    active: false,
    step: 'sweep',
    freezeNo: 0,
    advance: 0,
    ice: 0,
    tempC: 0,
    elapsed: 0,
    iceW: 0,
    iceD: 0,
    label: '',
    temp: '',
    timer: '',
    size: '',
    kLabel: NaN,
    kTemp: NaN,
    kTimer: NaN,
    kSize: NaN,
    scripted: false,
    stage: 'plain',
    stageP: 0,
    probeShown: true,
    needle: 0,
    saline: 0,
    shift: 0,
    iceShift: 0,
    target: 0,
    inside: false,
    tone: 'place',
    lumpMm: 0,
    showTemp: true,
    showTimer: true,
    note: '',
    kNote: NaN,
  }
}

const STEP_CODE: Record<ScanStep, number> = { sweep: 0, place: 1, freeze: 2, thaw: 3 }

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))
const clamp01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k)
const smooth01 = (k: number): number => {
  const u = clamp01(k)
  return u * u * (3 - 2 * u)
}

/**
 * How many times the exam places the probe (a fibroadenoma too big for one ice ball: two): the second placement is the probe MOVED to a second spot.
 */
function placements(exam: Pick<ImagingExam, 'sequences'>): number {
  let places = 0
  for (let i = 0; i < exam.sequences.length; i++) if (stepOf(exam.sequences[i]) === 'place') places++
  return places
}

/**
 * Where the probe is (-1 .. 1 along the picture; 0 when it is placed once) at sequence `si` of an exam with `places` placements: the first spot through
 * the first cycle, sliding across to the second through the move (`slide` 0..1), the second spot after.
 */
function probeSpot(places: number, si: number, slide: number): number {
  return places < 2 ? 0 : si < 4 ? -1 : si === 4 ? -1 + 2 * smooth01(slide) : 1
}

/** Where the ice ball is centred: the first spot until the move (its old ball melts there as the probe slides away), the second after. */
function iceSpot(places: number, si: number): number {
  return places < 2 ? 0 : si <= 4 ? -1 : 1
}

/**
 * Fill the readout for step `seqIndex` of `exam` at `progress` (0..1) with ice ball size `detail`. Builds a string only when the value it
 * shows changes (a few times a second at most); otherwise allocation-free. `proc` (a scripted ProSense case: the view's scope key and the step's
 * progress) names the stage of the picture; without it the exam's own step is what shows, exactly as before the script. The ice ball is always the
 * sim's own (`detail`: it melts in the thaw before a move and before the probe is drawn out, the picture follows it); the probe's places follow the
 * exam's placements, with or without the script (the thumbnails of a moved probe show both spots).
 */
export function cryoReadoutInto(out: CryoReadout, exam: Pick<ImagingExam, 'sequences'>, seqIndex: number, progress: number, detail: number, proc: ProcScope | null = null): CryoReadout {
  const n = exam.sequences.length
  if (n === 0) {
    out.active = false
    return out
  }
  const si = seqIndex < 0 ? 0 : seqIndex >= n ? n - 1 : seqIndex
  const seq = exam.sequences[si]
  const step = stepOf(seq)
  out.step = step
  out.active = step !== 'sweep'
  if (!out.active) return out
  let freezes = 0
  for (let i = 0; i <= si; i++) if (stepOf(exam.sequences[i]) === 'freeze') freezes++
  out.freezeNo = freezes
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress
  // the probe reaches its place a little before the placement step ends (the last moments are the check that it is centred)
  const q = Math.min(1, p * 1.2)
  const places = placements(exam)
  out.advance = step === 'place' ? q * q * (3 - 2 * q) : 1
  out.ice = clamp01(detail)
  out.tempC = Math.round(probeTempC(step, freezes, p))
  out.elapsed = Math.floor(p * seq.seconds)
  out.scripted = false
  out.stage = 'plain'
  out.stageP = 0
  out.probeShown = true
  out.needle = 0
  out.saline = 0
  out.shift = probeSpot(places, si, p)
  out.iceShift = iceSpot(places, si)
  out.target = 0
  out.inside = false
  out.showTemp = true
  out.showTimer = true
  out.tone = step === 'freeze' ? 'cold' : step === 'thaw' ? 'warm' : 'place'
  if (proc !== null && proc.procedureId !== null && proc.scope !== null) applyStage(out, si, proc, places)
  const rMm = ICE_RADIUS_MM * out.ice
  out.iceD = Math.round(rMm * 2)
  out.iceW = Math.round(rMm * 2 * ICE_ELONGATION)

  const t = IMAGING_UI.us.cryo
  const kLabel = ((STEP_CODE[step] * 20 + STAGE_CODE[out.stage]) * 10 + freezes) * 2 + (out.inside ? 1 : 0)
  if (kLabel !== out.kLabel) {
    out.kLabel = kLabel
    out.label = labelOf(out.stage, step, freezes, out.inside)
  }
  if (out.tempC !== out.kTemp) {
    out.kTemp = out.tempC
    out.temp = fillImaging(t.temp, { c: out.tempC < 0 ? '−' + -out.tempC : out.tempC })
  }
  if (out.elapsed !== out.kTimer) {
    out.kTimer = out.elapsed
    out.timer = fillImaging(t.timer, { m: pad2(Math.floor(out.elapsed / 60)), s: pad2(out.elapsed % 60) })
  }
  const kSize = out.iceW * 1000 + out.iceD
  if (kSize !== out.kSize) {
    out.kSize = kSize
    out.size = out.iceD > 0 ? fillImaging(t.ice, { w: out.iceW, d: out.iceD }) : ''
  }
  noteInto(out, exam)
  return out
}

function labelOf(stage: CryoStage, step: ScanStep, freezes: number, inside: boolean): string {
  const t = IMAGING_UI.us.cryo
  switch (stage) {
    case 'survey':
      return t.survey
    case 'hold':
      return t.held
    case 'local':
      return t.local
    case 'nick':
      return t.nick
    case 'probeIn':
      return t.place
    case 'saline':
      return t.saline
    case 'programme':
      return t.programme
    case 'measure':
      return t.measure
    case 'lumpCheck':
      return inside ? t.lumpCovered : t.lumpOutside
    case 'thawFree':
      return t.thawFree
    case 'probeOut':
      return t.probeOut
    case 'dressing':
    case 'standby':
      return t.treated
    case 'relocate':
      return t.relocate
    case 'freeze':
      return fillImaging(t.freeze, { n: freezes })
    case 'thaw':
      return t.thaw
    default:
      return step === 'freeze' ? fillImaging(t.freeze, { n: freezes }) : step === 'thaw' ? t.thaw : t.place
  }
}

/** The script's stage over the exam's own step: what the picture shows (the probe, the ice, the layers) at this moment. */
function applyStage(out: CryoReadout, si: number, proc: ProcScope, places: number): void {
  const stage = SCOPE_STAGE[proc.scope as string] ?? 'plain'
  const p = clamp01(proc.progress)
  out.scripted = true
  out.stage = stage
  out.stageP = p
  out.showTemp = false
  out.showTimer = false
  out.tone = 'place'
  switch (stage) {
    case 'survey':
    case 'hold':
    case 'nick':
      out.probeShown = false
      out.advance = 0
      out.ice = 0
      break
    case 'local':
      out.probeShown = false
      out.advance = 0
      out.ice = 0
      out.needle = smooth01(p * 1.15)
      break
    case 'probeIn':
      out.advance = smooth01(p * 1.15)
      out.ice = 0
      out.showTemp = out.showTimer = true
      break
    case 'saline':
      out.advance = 1
      out.ice = 0
      out.saline = smooth01(p * 1.2)
      break
    case 'programme':
      out.advance = 1
      out.ice = 0
      out.saline = 1
      break
    case 'freeze':
      out.advance = 1
      out.saline = 1
      out.showTemp = out.showTimer = true
      out.tone = 'cold'
      break
    case 'thaw':
      out.advance = 1
      out.saline = 1
      out.showTemp = out.showTimer = true
      out.tone = 'warm'
      break
    case 'measure':
      out.advance = 1
      out.saline = 1
      out.target = proc.scope === 'measure35' ? CRYO.targetsMm[0] : CRYO.targetsMm[1]
      out.showTemp = out.showTimer = true
      out.tone = 'cold'
      break
    case 'lumpCheck':
      // a lump one ice ball covers is inside it; a bigger one (the exam has two placements) is not: the probe is moved and the lump frozen again
      out.advance = 1
      out.saline = 1
      out.inside = places < 2
      out.showTemp = out.showTimer = true
      out.tone = 'cold'
      break
    case 'thawFree':
      // the ice melts (the sim's number) and the probe warms from the freeze's -170 °C: the thaw before it is moved, or drawn out
      out.advance = 1
      out.saline = 1
      out.shift = probeSpot(places, si, 0)
      out.tempC = Math.round(probeTempC('thaw', out.freezeNo, p))
      out.showTemp = true
      out.tone = 'warm'
      break
    case 'probeOut':
      out.advance = 1 - smooth01(p * 1.1)
      out.probeShown = out.advance > 0.03
      out.ice = 0
      out.saline = 1
      out.tempC = Math.round(probeOutTempC(p))
      out.showTemp = true
      out.tone = 'warm'
      break
    case 'dressing':
      out.probeShown = false
      out.advance = 0
      out.ice = 0
      out.saline = 1 - smooth01(p)
      break
    case 'standby':
      // the probe out, the gel wiped, the patient off the couch: one still frame of the treated area
      out.probeShown = false
      out.advance = 0
      out.ice = 0
      break
    case 'relocate':
      // the probe is drawn back a little, slid along and pushed in again at the second spot, while its first ice ball (the sim's, melting) stays where it was
      out.advance = 1 - 0.45 * Math.sin(Math.PI * p)
      out.shift = probeSpot(places, si, p)
      out.showTemp = out.showTimer = true
      break
    default:
      break
  }
}

/** The readout's fourth line: the programme, the target, the lump's size or the ice ball's size, whichever the stage shows (built only when its numbers change). */
function noteInto(out: CryoReadout, exam: Pick<ImagingExam, 'sequences'>): void {
  const t = IMAGING_UI.us.cryo
  let key = 0
  switch (out.stage) {
    case 'programme': {
      let a = 0
      let b = 0
      let c = 0
      let f = 0
      for (let i = 0; i < exam.sequences.length && f < 3; i++) {
        const sq = exam.sequences[i]
        const m = Math.round(sq.seconds / 60)
        if (stepOf(sq) === 'freeze') {
          if (f === 0) a = m
          else c = m
          f++
        } else if (stepOf(sq) === 'thaw' && b === 0) b = m
      }
      key = 100000 + a * 10000 + b * 100 + c
      if (key !== out.kNote) {
        out.kNote = key
        out.note = fillImaging(t.programmeLine, { a, b, c })
      }
      return
    }
    case 'measure': {
      key = 200000 + out.iceW * 100 + out.target
      if (key !== out.kNote) {
        out.kNote = key
        out.note = fillImaging(t.measureLine, { w: out.iceW, t: out.target })
      }
      return
    }
    case 'survey':
    case 'hold': {
      key = 300000 + out.lumpMm
      if (key !== out.kNote) {
        out.kNote = key
        out.note = out.lumpMm > 0 ? fillImaging(t.lump, { d: out.lumpMm }) : ''
      }
      return
    }
    default:
      key = 400000 + out.kSize
      if (key !== out.kNote) {
        out.kNote = key
        out.note = out.size
      }
  }
}

/** The lump's size the survey reads out (mm), set by the screen from the scene before it paints. */
export function setLumpMm(out: CryoReadout, mm: number): void {
  const v = Math.round(mm)
  if (v === out.lumpMm) return
  out.lumpMm = v
  out.kNote = NaN
  noteLumpInto(out)
}

function noteLumpInto(out: CryoReadout): void {
  if (out.stage === 'survey' || out.stage === 'hold') out.note = out.lumpMm > 0 ? fillImaging(IMAGING_UI.us.cryo.lump, { d: out.lumpMm }) : ''
}

const _ice = newIceShape()
const _needle = newNeedleLine()

/** The leading edge and the shadow behind it: the upper half of the ice ball, then straight down to the bottom of the picture. */
function shadowPath(t: Ctx2D, cx: number, cy: number, rx: number, ry: number, bottom: number): void {
  t.beginPath()
  t.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2)
  t.lineTo(cx + rx, bottom)
  t.lineTo(cx - rx, bottom)
  t.closePath()
}

const DASH: number[] = [4, 4]
const SOLID: number[] = []
/** The anaesthetic needle's slope on the picture (radians): a little steeper than the cryoprobe's (which runs along the lump), it goes in from the side above the lump. */
const LOCAL_ANGLE = 0.16
const LOCAL_C = Math.cos(LOCAL_ANGLE)
const LOCAL_S = Math.sin(LOCAL_ANGLE)

/** A small cross (a calliper's end) centred on (x, y). */
function plus(t: Ctx2D, x: number, y: number, arm: number): void {
  t.beginPath()
  t.moveTo(x - arm, y)
  t.lineTo(x + arm, y)
  t.moveTo(x, y - arm)
  t.lineTo(x, y + arm)
  t.stroke()
}

/** The saline layer: a dark (fluid) band just under the skin, `k` (0..1) of its full thickness, with a bright lower border. */
function paintSaline(t: Ctx2D, S: number, scene: UsScene, k: number): void {
  const y0 = (US_APEX_Y + 0.034) * S
  const h = SALINE_MM * scene.mm * S * (k < 0 ? 0 : k > 1 ? 1 : k)
  const x0 = S / 2 - US_LINEAR_HALF * S
  const w = 2 * US_LINEAR_HALF * S
  t.globalCompositeOperation = 'source-over'
  t.fillStyle = '#030506'
  t.globalAlpha = 0.9
  t.fillRect(x0, y0, w, h)
  t.fillStyle = grey(0.72)
  t.globalAlpha = 0.5
  t.fillRect(x0, y0 + h - 1, w, 1.2)
  t.globalAlpha = 1
}

/** The local anaesthetic: a thin needle goes in from the side to just above the lump, a dark pocket of fluid spreads round the lump. */
function paintLocal(t: Ctx2D, S: number, scene: UsScene, k: number): void {
  const ax = S / 2
  const tipX = scene.tx - scene.tw * 0.15
  const tipY = scene.ty - scene.th * 0.8
  const L = (tipX + 0.5) / LOCAL_C
  const ex = tipX - LOCAL_C * L
  const ey = tipY - LOCAL_S * L
  const reach = L * (0.25 + 0.75 * (k < 0 ? 0 : k > 1 ? 1 : k))
  const x1 = ax + (ex + LOCAL_C * reach) * S
  const y1 = (ey + LOCAL_S * reach) * S
  // the pocket of anaesthetic round the lump, growing as the needle arrives
  t.globalCompositeOperation = 'source-over'
  t.fillStyle = '#020304'
  t.globalAlpha = 0.4 * k
  t.beginPath()
  t.ellipse(ax + scene.tx * S, (scene.ty - scene.th * 0.2) * S, scene.tw * 1.55 * S, scene.th * 1.7 * S, 0, 0, Math.PI * 2)
  t.fill()
  t.globalAlpha = 1
  t.lineCap = 'round'
  t.strokeStyle = grey(0.92)
  t.lineWidth = Math.max(1.1, 0.0035 * S)
  t.beginPath()
  t.moveTo(ax + ex * S, ey * S)
  t.lineTo(x1, y1)
  t.stroke()
  t.lineCap = 'butt'
}

/**
 * The survey's marks (the planned path along the lump's long axis and calipers on the lump) and the fibroadenoma check (the lump's outline, dashed, drawn
 * OVER the ice ball and its shadow: R5 fix K11, it was painted under the shadow and could not be seen).
 */
function paintLumpMarks(t: Ctx2D, S: number, scene: UsScene, cryo: CryoReadout): void {
  const ax = S / 2
  const cx = ax + scene.tx * S
  const cy = scene.ty * S
  const rx = scene.tw * S
  const ry = scene.th * S
  t.globalCompositeOperation = 'source-over'
  t.strokeStyle = RO_PLACE
  t.lineWidth = 1.2
  t.globalAlpha = 0.9
  if (cryo.stage === 'survey' || cryo.stage === 'hold') {
    t.setLineDash(DASH)
    t.beginPath()
    t.moveTo(ax - US_LINEAR_HALF * S, cy)
    t.lineTo(ax + US_LINEAR_HALF * S, cy)
    t.stroke()
    t.setLineDash(SOLID)
    plus(t, cx - rx, cy, 4)
    plus(t, cx + rx, cy, 4)
  } else {
    t.setLineDash(DASH)
    t.beginPath()
    t.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    t.stroke()
    t.setLineDash(SOLID)
  }
  t.globalAlpha = 1
}

/** The callipers' two ends and their level on the picture (image units: x from the middle of the picture, y down). */
export interface Calipers {
  x0: number
  x1: number
  y: number
}

export const newCalipers = (): Calipers => ({ x0: 0, x1: 0, y: 0 })

/** The callipers on an ice ball of size `ice` (0..1) at the probe spot `iceShift` (-1 .. 1): the two ends of its long axis. */
export function calipersInto(scene: UsScene, ice: number, iceShift: number, out: Calipers): Calipers {
  const g = iceShapeInto(scene, ice, _ice, iceShift * RELOCATE_MM * scene.mm)
  out.x0 = g.cx - g.rx
  out.x1 = g.cx + g.rx
  out.y = g.cy
  return out
}

/** Callipers on the ice ball's long axis (along the probe), read against the target in the readout. */
function paintCalipers(t: Ctx2D, cx: number, cy: number, rx: number): void {
  t.globalCompositeOperation = 'source-over'
  t.strokeStyle = '#ffffff'
  t.lineWidth = 1.4
  t.globalAlpha = 0.95
  plus(t, cx - rx, cy, 5)
  plus(t, cx + rx, cy, 5)
  t.setLineDash(DASH)
  t.beginPath()
  t.moveTo(cx - rx, cy)
  t.lineTo(cx + rx, cy)
  t.stroke()
  t.setLineDash(SOLID)
  t.globalAlpha = 1
}

/** The probe and the ice ball, drawn inside the picture's clip after the speckle (and, in a scripted case, the stage's layers: saline, the lump's marks, the anaesthetic needle, calipers). */
export function paintCryoOverlay(t: Ctx2D, S: number, scene: UsScene, cryo: CryoReadout): void {
  if (!cryo.active || scene.tr <= 0) return
  const ax = S / 2
  const shiftU = cryo.shift * RELOCATE_MM * scene.mm
  const iceU = cryo.iceShift * RELOCATE_MM * scene.mm
  if (cryo.saline > 0.004) paintSaline(t, S, scene, cryo.saline)
  if (cryo.stage === 'survey' || cryo.stage === 'hold') paintLumpMarks(t, S, scene, cryo)
  if (cryo.needle > 0.004) paintLocal(t, S, scene, cryo.needle)
  if (cryo.probeShown) {
    const n = needleInto(scene, cryo.advance, _needle, shiftU)
    const x0 = ax + n.ex * S
    const y0 = n.ey * S
    const x1 = ax + n.px * S
    const y1 = n.py * S
    const w = Math.max(1.5, 0.0065 * S)
    t.globalCompositeOperation = 'source-over'
    t.lineCap = 'round'
    t.strokeStyle = grey(0.96)
    // reverberation: fainter copies of the shaft just deeper
    for (let k = 1; k <= 2; k++) {
      t.globalAlpha = 0.24 / k
      t.lineWidth = w * 0.8
      t.beginPath()
      t.moveTo(x0, y0 + k * 0.015 * S)
      t.lineTo(x1, y1 + k * 0.015 * S)
      t.stroke()
    }
    t.globalAlpha = 1
    t.lineWidth = w
    t.beginPath()
    t.moveTo(x0, y0)
    t.lineTo(x1, y1)
    t.stroke()
    // the tip: the brightest point, while it is being placed
    t.globalCompositeOperation = 'lighter'
    t.fillStyle = grey(0.85)
    t.globalAlpha = cryo.step === 'place' ? 1 : 0.6
    t.beginPath()
    t.arc(x1, y1, 0.011 * S, 0, Math.PI * 2)
    t.fill()
    t.globalCompositeOperation = 'source-over'
  }

  if (cryo.ice > 0.004) {
    const g = iceShapeInto(scene, cryo.ice, _ice, iceU)
    // (a thawing ice ball, and the old one melting at a probe move: the shadow lightens and the edge softens)
    const thaw = cryo.tone === 'warm' || cryo.stage === 'relocate'
    const cx = ax + g.cx * S
    const cy = g.cy * S
    const rx = g.rx * S
    const ry = g.ry * S
    const bottom = US_BOTTOM * S + 2
    // the acoustic shadow: nothing comes back from behind the ice (a soft fringe first, then the core)
    // (still frozen while thawing: the shadow lightens but the tumour stays hidden)
    t.fillStyle = '#020304'
    t.globalAlpha = thaw ? 0.3 : 0.45
    shadowPath(t, cx, cy, rx * 1.07, ry * 1.04, bottom)
    t.fill()
    t.globalAlpha = thaw ? 0.86 : 0.95
    shadowPath(t, cx, cy, rx, ry, bottom)
    t.fill()
    // the leading edge: thick and bright where the beam meets it square-on (the top), weaker toward the sides
    const lw = Math.max(2, 0.014 * S) * (thaw ? 0.7 : 1)
    t.lineCap = 'butt'
    t.strokeStyle = grey(1)
    t.globalAlpha = thaw ? 0.14 : 0.26
    t.lineWidth = lw * 2.6
    t.beginPath()
    t.ellipse(cx, cy, rx, ry, 0, Math.PI + 0.3, Math.PI * 2 - 0.3)
    t.stroke()
    t.globalAlpha = thaw ? 0.3 : 0.6
    t.lineWidth = lw * 0.6
    t.beginPath()
    t.ellipse(cx, cy, rx, ry, 0, Math.PI + 0.12, Math.PI * 2 - 0.12)
    t.stroke()
    t.globalAlpha = thaw ? 0.55 : 0.97
    t.lineWidth = lw
    t.beginPath()
    t.ellipse(cx, cy, rx, ry, 0, Math.PI + 0.5, Math.PI * 2 - 0.5)
    t.stroke()
    if (cryo.stage === 'measure') paintCalipers(t, cx, cy, rx)
  }
  // the fibroadenoma check: the lump's outline over the ice ball, so it can be read against the edge
  if (cryo.stage === 'lumpCheck') paintLumpMarks(t, S, scene, cryo)
  t.globalAlpha = 1
  t.lineCap = 'butt'
}

const RO_FONT = 'ui-monospace, Menlo, Consolas, monospace'
const RO_INK = 'rgba(214,232,234,0.95)'
const RO_DIM = 'rgba(160,186,190,0.92)'
const RO_COLD = '#9edcff'
const RO_THAW = '#ffd68c'
const RO_PLACE = '#7ee0c3'
let roSize = -1
let roBig = ''
let roMid = ''
let roSmall = ''
let roTiny = ''

function roLabel(c: Ctx2D, s: string, x: number, y: number, align: 'left' | 'right', font: string, px: number, fill: string): void {
  c.font = font
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  c.lineJoin = 'round'
  c.lineWidth = Math.max(2, px * 0.28)
  c.strokeStyle = 'rgba(0,0,0,0.8)'
  c.strokeText(s, x, y)
  c.fillStyle = fill
  c.fillText(s, x, y)
}

/** The readout over the picture (top left, clear of the depth ruler): the step, the probe temperature, the step timer, the ice ball; and the probe's label. */
export function paintCryoReadout(c: Ctx2D, S: number, scene: UsScene, cryo: CryoReadout): void {
  if (!cryo.active) return
  const u = S / 384
  if (roSize !== S) {
    roSize = S
    roBig = 'bold ' + Math.round(18 * u) + 'px ' + RO_FONT
    roMid = 'bold ' + Math.round(12 * u) + 'px ' + RO_FONT
    roSmall = Math.round(11 * u) + 'px ' + RO_FONT
    roTiny = 'bold ' + Math.round(8 * u) + 'px ' + RO_FONT
  }
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  // (cold while freezing and measuring, warm while thawing and as the probe comes out, neutral for the rest: the cleanup is not a freeze)
  const colour = cryo.tone === 'cold' ? RO_COLD : cryo.tone === 'warm' ? RO_THAW : RO_PLACE
  const x = 8 * u
  roLabel(c, cryo.label, x, 42 * u, 'left', roMid, 12 * u, colour)
  // the lines under the label stack: the probe temperature, the step timer, then the stage's note (the ice ball's size, the target, the programme, the lump)
  let y = 60 * u
  if (cryo.showTemp) {
    roLabel(c, cryo.temp, x, y, 'left', roBig, 18 * u, cryo.tone === 'place' && cryo.stage === 'plain' ? RO_INK : colour)
    y += 14 * u
  }
  if (cryo.showTimer) {
    roLabel(c, cryo.timer, x, y, 'left', roSmall, 11 * u, RO_DIM)
    y += 13 * u
  }
  if (cryo.note) roLabel(c, cryo.note, x, y, 'left', roSmall, 11 * u, RO_INK)
  // the probe's name where it comes into the picture, just under the shaft and its reverberations (clear of the readout above)
  if (scene.tr > 0 && cryo.probeShown) {
    const n = needleInto(scene, cryo.advance, _needle, cryo.shift * RELOCATE_MM * scene.mm)
    const xe = -US_LINEAR_HALF + 0.01
    const ye = n.ey + (xe - n.ex) * Math.tan(NEEDLE_ANGLE)
    roLabel(c, IMAGING_UI.us.cryo.probe, S / 2 + xe * S, ye * S + 22 * u, 'left', roTiny, 8 * u, RO_DIM)
  }
}
