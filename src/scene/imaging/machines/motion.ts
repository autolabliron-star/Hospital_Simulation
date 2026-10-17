/**
 * The state-to-pose maths of the animated machines: pure functions, no three.js, no DOM, no allocation in the per-frame ones
 * (they write into an `out` object). The sim publishes a `ScannerState` (phase, tablePos, activity, detail, exam); these turn it
 * into table positions, rotor angles, X-ray tube poses, probe poses and glow levels. Tested in `motion.test.ts`.
 *
 * `rig.ts` calls them every frame; the geometry builders import the layout constants below, so the pose and the drawing always
 * agree about where things are.
 */
import { IMAGING } from '@/sim/places'
import type { BodyPart, ScannerPhase } from '@/sim/types'

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

/** The probe's sweep along the couch (z) and how far it rocks across it. */
export const PROBE = {
  sweepZ0: 8.2,
  sweepZ1: 9.0,
  crossX: 0.05,
  /** Contact height above the mattress top (the abdomen's surface), the lift when hovering, the press when in contact. */
  surface: 0.12,
  hover: 0.045,
  press: 0.02,
  rockDegrees: 12,
  rockHz: 0.4,
  /** The probe leans toward the sonographer (east) while held, in radians about z (negative: top toward +x). */
  lean: -0.3,
  /** The hand is drawn only once the probe is further than this from its holder (m). */
  handDistance: 0.05,
} as const

export interface ProbePose {
  x: number
  y: number
  z: number
  /** Rock about x (the sweep direction), radians. */
  rx: number
  /** Lean about z, radians. */
  tz: number
}

/** Hand on the probe over the patient (positioning, gel, scanning) or parked on the cart (everything else). */
export function probeActive(phase: ScannerPhase): boolean {
  return phase === 'positioning' || phase === 'tableIn' || phase === 'scanning'
}

/** Where the probe wants to be. While scanning `detail` runs the sweep along z and `activity` is skin contact. */
export function probeTargetInto(out: ProbePose, phase: ScannerPhase, detail: number, activity: number, t: number): ProbePose {
  if (!probeActive(phase)) {
    out.x = US_CART.holder.x
    out.y = US_CART.holder.y
    out.z = US_CART.holder.z
    out.rx = 0
    out.tz = 0
    return out
  }
  const couch = US.table.out
  const d = clamp01(detail)
  const a = clamp01(activity)
  const scanning = phase === 'scanning'
  let x = couch.x + (scanning ? PROBE.crossX * Math.sin(d * 4 * Math.PI) : 0)
  let z = lerp(PROBE.sweepZ0, PROBE.sweepZ1, d)
  let y = US.table.height + PROBE.surface + PROBE.hover * (1 - a) - PROBE.press * a
  if (phase === 'positioning') {
    // gel: a slow circle just above the skin
    x += 0.03 * Math.sin(2 * Math.PI * 0.5 * t)
    z += 0.04 * Math.cos(2 * Math.PI * 0.5 * t)
    y += 0.012 * Math.sin(2 * Math.PI * 1.0 * t)
  }
  out.x = x
  out.y = y
  out.z = z
  out.rx = a * ((PROBE.rockDegrees * Math.PI) / 180) * Math.sin(2 * Math.PI * PROBE.rockHz * t)
  out.tz = PROBE.lean
  return out
}

/** True once the probe has left its holder far enough for the hand to be on it. */
export function handShown(p: ProbePose): boolean {
  const dx = p.x - US_CART.holder.x
  const dy = p.y - US_CART.holder.y
  const dz = p.z - US_CART.holder.z
  return dx * dx + dy * dy + dz * dz > PROBE.handDistance * PROBE.handDistance
}
