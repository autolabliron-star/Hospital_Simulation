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
 * Nothing here allocates per call: the readout's strings are rebuilt only when a shown value changes (cryoReadoutInto), the colours are
 * fixed strings, the depth gradient is kept per context.
 */
import { IMAGING_UI, fillImaging } from '@/content/imagingUi'
import type { ImagingExam, ScanStep } from '@/sim/types'
import type { Ctx2D, Surface } from './ctx'
import { grey } from './ctx'
import { blitTile } from './paint'
import { US_APEX_Y, US_DEPTH_END, US_HALF_ANGLE, type UsScene } from './ultrasound'

/** The fan's depth reaches this fraction of the picture height. */
export const US_BOTTOM = US_DEPTH_END
/** Half the width of the linear probe's picture, as a fraction of the picture. */
export const US_LINEAR_HALF = 0.36

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

/** The ice ball's radius along the beam at full size (detail 1), mm: a 30 mm ball round a ~12 mm tumour leaves a margin of about 7 mm. */
export const ICE_RADIUS_MM = 15
/** The ice ball is longer along the probe than across it (an ellipse on the picture: across = radius x this). */
export const ICE_ELONGATION = 1.15
/** The cryoprobe's slope on the picture (radians below the horizontal): it comes in from the side, in the plane of the probe. */
export const NEEDLE_ANGLE = 0.3
/** The probe in the tissue before it cools (°C), the tip at the coldest (ProSense: about -170 °C) and where the thaw ends. */
export const PROBE_WARM_C = 34
export const PROBE_COLD_C = -170
const THAW_RATE = 3.2
const FREEZE_RATE = 14

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

/** The ice ball of size `ice` (0..1, ScannerState.detail) round the scene's tumour. */
export function iceShapeInto(scene: UsScene, ice: number, out: IceShape): IceShape {
  const k = ice < 0 ? 0 : ice > 1 ? 1 : ice
  const r = ICE_RADIUS_MM * k * scene.mm
  out.cx = scene.tx
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

/** The probe advanced `advance` (0..1) of the way to its place: through the tumour, the tip just past its centre. */
export function needleInto(scene: UsScene, advance: number, out: NeedleLine): NeedleLine {
  const c = Math.cos(NEEDLE_ANGLE)
  const s = Math.sin(NEEDLE_ANGLE)
  const a = advance < 0 ? 0 : advance > 1 ? 1 : advance
  const tx = scene.tx + c * scene.tr * 0.5
  const ty = scene.ty + s * scene.tr * 0.5
  const L = (tx + 0.5) / c
  out.ex = tx - c * L
  out.ey = ty - s * L
  const reach = L * (0.22 + 0.78 * a)
  out.px = out.ex + c * reach
  out.py = out.ey + s * reach
  return out
}

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
}

export function createCryoReadout(): CryoReadout {
  return { active: false, step: 'sweep', freezeNo: 0, advance: 0, ice: 0, tempC: 0, elapsed: 0, iceW: 0, iceD: 0, label: '', temp: '', timer: '', size: '', kLabel: NaN, kTemp: NaN, kTimer: NaN, kSize: NaN }
}

const STEP_CODE: Record<ScanStep, number> = { sweep: 0, place: 1, freeze: 2, thaw: 3 }

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))

/**
 * Fill the readout for step `seqIndex` of `exam` at `progress` (0..1) with ice ball size `detail`. Builds a string only when the value it
 * shows changes (a few times a second at most); otherwise allocation-free.
 */
export function cryoReadoutInto(out: CryoReadout, exam: Pick<ImagingExam, 'sequences'>, seqIndex: number, progress: number, detail: number): CryoReadout {
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
  out.advance = step === 'place' ? q * q * (3 - 2 * q) : 1
  out.ice = step === 'place' ? 0 : detail < 0 ? 0 : detail > 1 ? 1 : detail
  out.tempC = Math.round(probeTempC(step, freezes, p))
  out.elapsed = Math.floor(p * seq.seconds)
  const rMm = ICE_RADIUS_MM * out.ice
  out.iceD = Math.round(rMm * 2)
  out.iceW = Math.round(rMm * 2 * ICE_ELONGATION)

  const t = IMAGING_UI.us.cryo
  const kLabel = STEP_CODE[step] * 10 + freezes
  if (kLabel !== out.kLabel) {
    out.kLabel = kLabel
    out.label = step === 'freeze' ? fillImaging(t.freeze, { n: freezes }) : step === 'thaw' ? t.thaw : t.place
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
  return out
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

/** The probe and the ice ball, drawn inside the picture's clip after the speckle. */
export function paintCryoOverlay(t: Ctx2D, S: number, scene: UsScene, cryo: CryoReadout): void {
  if (!cryo.active || scene.tr <= 0) return
  const ax = S / 2
  const n = needleInto(scene, cryo.advance, _needle)
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

  if (cryo.ice > 0.004) {
    const g = iceShapeInto(scene, cryo.ice, _ice)
    const thaw = cryo.step === 'thaw'
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
  }
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
  const colour = cryo.step === 'freeze' ? RO_COLD : cryo.step === 'thaw' ? RO_THAW : RO_PLACE
  const x = 8 * u
  roLabel(c, cryo.label, x, 42 * u, 'left', roMid, 12 * u, colour)
  roLabel(c, cryo.temp, x, 60 * u, 'left', roBig, 18 * u, cryo.step === 'place' ? RO_INK : colour)
  roLabel(c, cryo.timer, x, 74 * u, 'left', roSmall, 11 * u, RO_DIM)
  if (cryo.size) roLabel(c, cryo.size, x, 87 * u, 'left', roSmall, 11 * u, RO_INK)
  // the probe's name where it comes into the picture, just under the shaft and its reverberations (clear of the readout above)
  if (scene.tr > 0) {
    const n = needleInto(scene, cryo.advance, _needle)
    const xe = -US_LINEAR_HALF + 0.01
    const ye = n.ey + (xe - n.ex) * Math.tan(NEEDLE_ANGLE)
    roLabel(c, IMAGING_UI.us.cryo.probe, S / 2 + xe * S, ye * S + 22 * u, 'left', roTiny, 8 * u, RO_DIM)
  }
}
