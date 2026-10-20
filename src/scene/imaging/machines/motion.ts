/**
 * The state-to-pose maths of the animated machines: pure functions, no three.js, no DOM, no allocation in the per-frame ones
 * (they write into an `out` object). The sim publishes a `ScannerState` (phase, tablePos, activity, detail, exam); these turn it
 * into table positions, rotor angles, X-ray tube poses, probe poses and glow levels. Tested in `motion.test.ts`.
 *
 * `rig.ts` calls them every frame; the geometry builders import the layout constants below, so the pose and the drawing always
 * agree about where things are.
 */
import { IMAGING } from '@/sim/places'
import type { BodyPart, ImagingExam, ScannerPhase } from '@/sim/types'
import { couchDirToWorld, couchToWorld, worldToCouch } from '../phantom/frame'
import { patientParams, type PatientParams } from '../phantom/params'
import { blendFrames, newProbeFrame, viewFrame, viewSpec, type ProbeFrame, type UsViewId, type ViewSpec } from '../phantom/usViews'
import { usViewOf } from '../images/ultrasound'

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

/** Move `v` towards `want` at `rate` per second (exponential, frame-rate independent; `dt` 0 changes nothing). */
export function smoothTo(v: number, want: number, rate: number, dt: number): number {
  return v + (want - v) * (1 - Math.exp(-rate * dt))
}

/** Move `level` towards `target` linearly, covering the whole 0..1 range in `seconds`. */
export function stepToward(level: number, target: number, dt: number, seconds: number): number {
  const step = dt / seconds
  return target > level ? Math.min(target, level + step) : Math.max(target, level - step)
}

// ---------------------------------------------------------------------------------------------
// Tables (MRI and CT)
// ---------------------------------------------------------------------------------------------

/** The moving table top of the MRI and the CT is this long and this wide (m). */
export const CRADLE = { length: 2.2, width: 0.46 } as const

export interface TableAnchor {
  out: { x: number; z: number }
  in: { x: number; z: number }
}

/** World x of the table's centre (= the patient's body centre) for `tablePos` 0 (out) .. 1 (in the bore). */
export function tableX(t: TableAnchor, tablePos: number): number {
  return t.out.x + (t.in.x - t.out.x) * clamp01(tablePos)
}

/** The x range the whole table top sweeps over its travel (what `src/scene/rooms/imaging.ts` `tableTravel` reserves). */
export function tableSweep(t: TableAnchor, len: number = CRADLE.length): [number, number] {
  return [Math.min(t.out.x, t.in.x) - len / 2, Math.max(t.out.x, t.in.x) + len / 2]
}

// ---------------------------------------------------------------------------------------------
// MRI
// ---------------------------------------------------------------------------------------------

export type CoilKind = 'head' | 'knee' | 'spine'

/** Which coil rides the table for an exam's body part (none without an exam). Brain, head and neck use the head coil. */
export function coilFor(bodyPart: BodyPart | null | undefined): CoilKind | null {
  if (bodyPart === null || bodyPart === undefined) return null
  if (bodyPart === 'knee') return 'knee'
  if (bodyPart === 'lumbarSpine') return 'spine'
  return 'head'
}

/** Where each coil sits on the table top, in metres from the table's centre (+ is towards the head, east). */
export const COIL_OFFSET: Record<CoilKind, number> = { head: 0.78, knee: -0.55, spine: 0.05 }

/** The MRI LED ring: `idleLevel` (dim, steady) when the magnet is idle, bright and pulsing at 2.5 Hz while it scans. */
export const LED_PULSE_HZ = 2.5

/** Brightness 0..1 of the blue ring for the published `activity` (0.15 idle .. 1 scanning) at time `t` (s). */
export function ledLevel(activity: number, t: number): number {
  const a = clamp01(activity)
  const depth = 0.45 * clamp01((a - 0.3) / 0.7)
  const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * LED_PULSE_HZ * t)
  return a * (1 - depth * (1 - pulse))
}

/** Colour multiplier of the LED ring for a level (above 1 at full brightness, so it blooms). */
export const ledGain = (level: number): number => 0.2 + 2 * level

// ---------------------------------------------------------------------------------------------
// CT
// ---------------------------------------------------------------------------------------------

/** The CT rotor does this many turns per second at activity 1 (the sim ramps `activity` itself). */
export const ROTOR_TURNS_PER_SECOND = 2

const TAU = Math.PI * 2

/** The rotor angle (radians, wrapped to 0..2pi) after `dt` seconds at the published rotor speed fraction `activity`. */
export function rotorAdvance(angle: number, activity: number, dt: number): number {
  const a = angle + clamp01(activity) * ROTOR_TURNS_PER_SECOND * TAU * dt
  return a - Math.floor(a / TAU) * TAU
}

/** Red positioning lasers show only while the patient is being positioned. */
export const laserTarget = (phase: ScannerPhase): 0 | 1 => (phase === 'positioning' ? 1 : 0)
export const LASER_FADE_SECONDS = 0.3

/** The CT status strip: 0 = standby (amber), 1 = green (rotor above half speed). */
export const ctStatusTarget = (activity: number): 0 | 1 => (activity > 0.5 ? 1 : 0)

// ---------------------------------------------------------------------------------------------
// X-ray
// ---------------------------------------------------------------------------------------------

const XR = IMAGING.xray

/** The ceiling tube: where it hangs over the table and at the wall detector, and the column it hangs from. */
export const XRAY_POSE = {
  /** Carriage z over the table (the table's centre) and at the wall detector (the detector's z, see rooms/imaging.ts). */
  tableZ: XR.table.out.z,
  wallZ: 5.3,
  /** The tube head's pivot (the focal spot) height over the table and at the wall (about the detector's centre). */
  pivotYTable: 1.95,
  pivotYWall: 1.2,
  /** The column hangs from the carriage beam's underside; the head housing is `headHalf` tall either side of the pivot. */
  columnTopY: 2.58,
  headHalf: 0.15,
  /** The head turns this far about the z axis to point WEST at the detector (negative: -y -> -x). */
  wallAngle: -Math.PI / 2,
} as const

export interface XrayPose {
  /** z of the carriage on its rails. */
  carriageZ: number
  /** Rotation of the tube head about z (0 = pointing down). */
  headAngle: number
  /** Height of the head's pivot. */
  pivotY: number
  /** Length of the telescopic column from the carriage down to the head. */
  columnLength: number
  /** How much further the column has telescoped out than over the table (m). */
  columnDrop: number
}

/** The tube pose for the sim's eased `detail` (0 over the table, 1 at the wall detector). Allocates nothing. */
export function xrayPoseInto(out: XrayPose, detail: number): XrayPose {
  const d = clamp01(detail)
  out.carriageZ = lerp(XRAY_POSE.tableZ, XRAY_POSE.wallZ, d)
  out.headAngle = XRAY_POSE.wallAngle * d
  out.pivotY = lerp(XRAY_POSE.pivotYTable, XRAY_POSE.pivotYWall, d)
  out.columnLength = XRAY_POSE.columnTopY - out.pivotY - XRAY_POSE.headHalf
  out.columnDrop = XRAY_POSE.pivotYTable - out.pivotY
  return out
}

export function xrayPose(detail: number): XrayPose {
  return xrayPoseInto({ carriageZ: 0, headAngle: 0, pivotY: 0, columnLength: 0, columnDrop: 0 }, detail)
}

/** The collimator light shows while the radiographer lines up and exposes. */
export function collimatorOn(phase: ScannerPhase): boolean {
  return phase === 'positioning' || phase === 'scanning' || phase === 'tableIn'
}

/** The light square is on the table (detail below one half) or on the wall detector (one half or more). */
export const collimatorTarget = (phase: ScannerPhase, detail: number, where: 'table' | 'wall'): 0 | 1 => {
  if (!collimatorOn(phase)) return 0
  return (detail < 0.5) === (where === 'table') ? 1 : 0
}

/** The red exposure lamp over the booth door: dim at rest, lit for the whole scan step, brightest during the flash. */
export function lampLevel(phase: ScannerPhase, activity: number): number {
  if (activity > 0.5) return 1
  return phase === 'scanning' ? 0.65 : 0.12
}

export const lampGain = (level: number): number => 0.25 + 2.2 * level

/** The tube head's flash: jumps up with the exposure, falls away in about 0.2 s. */
export function flashLevel(prev: number, activity: number, dt: number): number {
  return activity > 0.5 ? 1 : stepToward(prev, 0, dt, 0.2)
}

// ---------------------------------------------------------------------------------------------
// Ultrasound
// ---------------------------------------------------------------------------------------------

const US = IMAGING.us
const cartAt = US.machine
const stool = US.operator.at

/**
 * The cart and where its parts are, for the geometry and for the probe. The cart body keeps the 0.7 x 0.9 footprint the room
 * reserves; its monitor turns on its arm to face the sonographer on the stool.
 */
export const US_CART = {
  x: cartAt.x,
  z: cartAt.z,
  /** Height of the lens of the probe parked in its holder (on the couch side of the cart, west). */
  holder: { x: cartAt.x - 0.3, y: 0.9, z: cartAt.z - 0.12 },
  /** Where the probe cable plugs into the cart. */
  socket: { x: cartAt.x + 0.05, y: 0.9, z: cartAt.z - 0.2 },
  /** Centre of the monitor head and the way the screen faces (heading of its normal: toward the sonographer). */
  monitor: { x: cartAt.x, y: 1.27, z: cartAt.z + 0.2, yaw: Math.atan2(stool.x - cartAt.x, stool.z - (cartAt.z + 0.2)), w: 0.42, h: 0.32 },
} as const

/**
 * R3: the probe works on THIS patient's anatomy. Each sweep of the exam has a view (images/ultrasound.ts usViewOf: liver, gallbladder,
 * right or left kidney, spleen, bladder) and each view a window on the synthetic body (phantom/usViews.ts): the right kidney is imaged from
 * the right flank, the bladder from just above the pubis. `detail` fans the beam through the organ, the probe rocks a few degrees while in
 * contact, and between sweeps it glides over the skin to the next window (or lifts and moves when that is far). Poses are worked out in
 * the patient's frame (LPS mm) and turned into the world by phantom/frame.ts, so the probe the room shows and the picture the screen
 * draws come from the same numbers.
 */
export const PROBE = {
  /** How far the face lifts off the skin when out of contact (mm), and the rock while in contact (degrees, Hz). */
  hoverMm: 30,
  rockDegrees: 4,
  rockHz: 0.4,
  /** The gel circle while positioning (mm). */
  gelMm: 14,
  /** The hand is drawn only once the probe is further than this from its holder (m). */
  handDistance: 0.05,
} as const

/** Where the probe is in the world: the face centre, the array axis (local x) and the axis up the handle (local y), and skin contact. */
export interface ProbePose {
  x: number
  y: number
  z: number
  ax: number
  ay: number
  az: number
  ux: number
  uy: number
  uz: number
  contact: number
}

export const newProbePose = (): ProbePose => ({ x: 0, y: 0, z: 0, ax: 1, ay: 0, az: 0, ux: 0, uy: 1, uz: 0, contact: 0 })

/** What the probe needs to know about the exam: the patient and the view of every sweep. */
export interface UsProbeContext {
  seed: number
  params: PatientParams
  specs: ViewSpec[]
  views: UsViewId[]
}

/** The context of an exam (null: none, the probe stays in its holder). Allocates: call it when the exam changes. */
export function usProbeContext(exam: Pick<ImagingExam, 'imageSeed' | 'sequences' | 'bodyPart'> | null): UsProbeContext | null {
  if (!exam || exam.sequences.length === 0) return null
  const params = patientParams(exam.imageSeed)
  const views = exam.sequences.map((s) => usViewOf(s.name, exam.bodyPart))
  return { seed: exam.imageSeed, params, views, specs: views.map((v) => viewSpec(v, params)) }
}

/** Hand on the probe over the patient (positioning, gel, scanning) or parked on the cart (everything else). */
export function probeActive(phase: ScannerPhase): boolean {
  return phase === 'positioning' || phase === 'tableIn' || phase === 'scanning'
}

const _a = newProbeFrame()
const _b = newProbeFrame()
const _w = { x: 0, y: 0, z: 0 }

/** The probe parked in its holder, as a patient-frame probe frame (face down, array along world +x). */
function parkedFrame(out: ProbeFrame): ProbeFrame {
  const h = US_CART.holder
  worldToCouch(h.x, h.y, h.z, _w)
  out.ox = _w.x
  out.oy = _w.y
  out.oz = _w.z
  // world down is +P; world +x is -L
  out.bx = 0
  out.by = 1
  out.bz = 0
  out.ax = -1
  out.ay = 0
  out.az = 0
  out.contact = 0
  return out
}

/** The rock in contact: a slow out-of-plane fan (degrees). */
export const rockOf = (t: number, contact: number): number => PROBE.rockDegrees * contact * Math.sin(2 * Math.PI * PROBE.rockHz * t)

/**
 * Where the probe wants to be, as a probe frame in the patient's frame (LPS mm): parked, spreading gel at the first window, sweeping a view,
 * or moving between two views. Returns true when the probe is in the sonographer's hand. Allocation-free.
 */
export function probeFrameInto(out: ProbeFrame, phase: ScannerPhase, sequence: number, detail: number, activity: number, t: number, ctx: UsProbeContext | null): boolean {
  if (!probeActive(phase) || !ctx) {
    parkedFrame(out)
    return false
  }
  const n = ctx.specs.length
  const p = ctx.params
  if (phase !== 'scanning' || sequence < 0) {
    // gel: a slow circle on the first window, touching the skin
    viewFrame(ctx.specs[0], p, 0, 0, 1, out)
    const cx = out.ay * out.bz - out.az * out.by
    const cy = out.az * out.bx - out.ax * out.bz
    const cz = out.ax * out.by - out.ay * out.bx
    const s = Math.sin(2 * Math.PI * 0.5 * t) * PROBE.gelMm
    const c = Math.cos(2 * Math.PI * 0.5 * t) * PROBE.gelMm * 0.6
    out.ox += out.ax * s + cx * c
    out.oy += out.ay * s + cy * c
    out.oz += out.az * s + cz * c
    out.contact = 0.8
  } else {
    const k = Math.max(0, Math.min(n - 1, sequence))
    if (activity > 0.3) {
      // sweeping view k, in contact, rocking a little
      viewFrame(ctx.specs[k], p, detail, rockOf(t, 1), 1, out)
    } else if (k + 1 < n) {
      // between sweeps: from the end of view k to the start of view k + 1 as detail falls back to 0
      viewFrame(ctx.specs[k], p, 1, 0, 1, _a)
      viewFrame(ctx.specs[k + 1], p, 0, 0, 1, _b)
      blendFrames(_a, _b, 1 - clamp01(detail), p, out)
    } else viewFrame(ctx.specs[k], p, 1, 0, 1, out)
  }
  // out of contact the face lifts off along the beam
  const lift = PROBE.hoverMm * (1 - out.contact)
  out.ox -= out.bx * lift
  out.oy -= out.by * lift
  out.oz -= out.bz * lift
  return true
}

/** The world pose of a probe frame (the face centre on the couch, the array axis, the axis up the handle = minus the beam). */
export function poseFromFrame(f: ProbeFrame, out: ProbePose): ProbePose {
  couchToWorld(f.ox, f.oy, f.oz, _w)
  out.x = _w.x
  out.y = _w.y
  out.z = _w.z
  couchDirToWorld(f.ax, f.ay, f.az, _w)
  out.ax = _w.x
  out.ay = _w.y
  out.az = _w.z
  couchDirToWorld(-f.bx, -f.by, -f.bz, _w)
  out.ux = _w.x
  out.uy = _w.y
  out.uz = _w.z
  out.contact = f.contact
  return out
}

/** Back-compat for the room's tests and the rig: the target pose straight from a state (no smoothing). */
export function probeTargetInto(out: ProbePose, phase: ScannerPhase, detail: number, activity: number, t: number, sequence = 0, ctx: UsProbeContext | null = null, frame: ProbeFrame = _a): ProbePose {
  probeFrameInto(frame, phase, sequence, detail, activity, t, ctx)
  return poseFromFrame(frame, out)
}

/** True once the probe has left its holder far enough for the hand to be on it. */
export function handShown(p: ProbePose): boolean {
  const dx = p.x - US_CART.holder.x
  const dy = p.y - US_CART.holder.y
  const dz = p.z - US_CART.holder.z
  return dx * dx + dy * dy + dz * dz > PROBE.handDistance * PROBE.handDistance
}
