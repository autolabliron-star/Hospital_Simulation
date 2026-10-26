/**
 * R4: the cryoablation suite's poses, pure (no three.js): where the CT table is, where each needle is in the room, and the needle-guidance robot's arm.
 *
 * Coordinates are SIM (the layer's group puts them on level 2): x east, y up from the level-2 floor, z south. The patient lies head WEST with the left
 * flank NORTH (CRYO_SUITE), so a needle path given in the planning slice (mm from the tumour centre: +x the patient's left, +y posterior; dz toward the
 * head) maps to the room as: x = target.x - dz, y = target.y - y, z = target.z - x (the posterior side is down, on the table).
 *
 * The arm is a genuine 5-axis chain from `CRYO_SUITE.robot.mount`:
 *   J1  yaw about the vertical at the shoulder S (a column `ARM.column` above the mount)
 *   J2  shoulder pitch, upper arm `ARM.upper` to the elbow E
 *   J3  elbow pitch, forearm `ARM.fore` to the wrist W
 *   J4  wrist yaw: the guide's heading psi = J1 + J4; the hand runs `ARM.hand` from W HORIZONTALLY, square to that heading (h = (cos psi, 0, -sin psi)),
 *       so it never lies along the needle
 *   J5  guide pitch about the hand's axis: the guide axis u = (cos J5 sin psi, -sin J5, cos J5 cos psi)
 * A guide pose (centre G and axis u: 5 numbers) has exactly one elbow-up solution: `solveArm`. `forwardArm` runs the chain from the angles (the tests
 * check the two agree). The guide centre sits on the planned path, `ARM.standoff` outside the skin entry.
 *
 * Nothing here allocates once the outputs exist (`newArmPose`, `newGuide`): the rig calls `armTargetInto` and `solveArm` every frame.
 */
import { CRYO_SUITE } from '@/sim/places'
import type { CryoNeedleState, CryoRobotPhase, CryoSuiteState } from '@/sim/types'

/** Metres per mm. */
export const MM = 0.001

/** The arm's dimensions (m). */
export const ARM = {
  /** From the mount (the baked column stub's top) up to the shoulder axis. */
  column: 0.14,
  upper: 0.62,
  fore: 0.56,
  hand: 0.16,
  /** The guide's centre sits this far outside the skin entry, on the path. */
  standoff: 0.05,
  /** The guide sleeve's length along the path. */
  guideLen: 0.07,
} as const

/** A cryoneedle: the shaft from the tip back to the handle, and the handle. */
export const NEEDLE = { length: 0.175, dia: 0.0045, handleLen: 0.07, handleDia: 0.018 } as const

/** How long the robot's moves take on screen (sim seconds since `robot.since`). */
export const ROBOT_TIMING = { deploy: 8, aimTravel: 12, aimSettle: 6, retract: 6 } as const

const T = CRYO_SUITE.ct.table
const TARGET = CRYO_SUITE.target
const MOUNT = CRYO_SUITE.robot.mount
/** The target's x offset from the table's centre (the kidney lies 0.25 m toward the head from the body's centre). */
export const TARGET_DX = TARGET.x - T.out.x

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth01 = (v: number): number => {
  const k = clamp01(v)
  return k * k * (3 - 2 * k)
}

/** The table's centre x (the patient's body centre) for tablePos 0 (out) .. 1 (in the bore). */
export function cryoTableX(tablePos: number): number {
  return T.out.x + (T.in.x - T.out.x) * clamp01(tablePos)
}

export interface P3 {
  x: number
  y: number
  z: number
}

/** A point of the planning slice (mm from the tumour centre) in the room, with the table at `tablePos`. */
export function patientPointInto(tablePos: number, mmX: number, mmY: number, dz: number, out: P3): P3 {
  out.x = cryoTableX(tablePos) + TARGET_DX - dz * MM
  out.y = TARGET.y - mmY * MM
  out.z = TARGET.z - mmX * MM
  return out
}

/** A guide pose: its centre and its axis (unit, pointing from the skin toward the tip). */
export interface Guide {
  g: P3
  u: P3
}

export const newGuide = (): Guide => ({ g: { x: 0, y: 0, z: 0 }, u: { x: 0, y: -1, z: 0 } })

/** The planned path of a needle as a guide pose (the table at `tablePos`): the axis from entry to tip, the centre `ARM.standoff` + `back` outside the entry. */
export function pathGuideInto(n: CryoNeedleState, tablePos: number, back: number, out: Guide): Guide {
  const ex = cryoTableX(tablePos) + TARGET_DX - n.dz * MM
  const ey = TARGET.y - n.entry.y * MM
  const ez = TARGET.z - n.entry.x * MM
  // the tip shares the needle's dz (the path lies in its own axial plane)
  let ux = 0
  let uy = (n.entry.y - n.tip.y) * MM
  let uz = (n.entry.x - n.tip.x) * MM
  const len = Math.sqrt(ux * ux + uy * uy + uz * uz)
  if (len < 1e-6) {
    ux = 0
    uy = 0
    uz = 1
  } else {
    ux /= len
    uy /= len
    uz /= len
  }
  out.u.x = ux
  out.u.y = uy
  out.u.z = uz
  const k = ARM.standoff + back
  out.g.x = ex - ux * k
  out.g.y = ey - uy * k
  out.g.z = ez - uz * k
  return out
}

/** The arm's joints and points (the outputs of `solveArm` / `forwardArm`). */
export interface ArmPose {
  /** J1..J5 (radians). */
  j1: number
  j2: number
  j3: number
  j4: number
  j5: number
  m: P3
  s: P3
  e: P3
  w: P3
  g: P3
  /** The guide axis, and the hand's direction (W -> G). */
  u: P3
  h: P3
  /** How far the wrist target was out of reach (0 when reachable). */
  reachError: number
}

export function newArmPose(): ArmPose {
  const p = (): P3 => ({ x: 0, y: 0, z: 0 })
  return { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, m: p(), s: p(), e: p(), w: p(), g: p(), u: p(), h: p(), reachError: 0 }
}

function setP(o: P3, x: number, y: number, z: number): void {
  o.x = x
  o.y = y
  o.z = z
}

/** Run the chain from the joint angles (the mount is fixed). */
export function forwardArm(j1: number, j2: number, j3: number, j4: number, j5: number, out: ArmPose): ArmPose {
  out.j1 = j1
  out.j2 = j2
  out.j3 = j3
  out.j4 = j4
  out.j5 = j5
  setP(out.m, MOUNT.x, MOUNT.y, MOUNT.z)
  setP(out.s, MOUNT.x, MOUNT.y + ARM.column, MOUNT.z)
  const dx = Math.sin(j1)
  const dz = Math.cos(j1)
  const c2 = Math.cos(j2)
  const s2 = Math.sin(j2)
  setP(out.e, out.s.x + ARM.upper * c2 * dx, out.s.y + ARM.upper * s2, out.s.z + ARM.upper * c2 * dz)
  const c23 = Math.cos(j2 + j3)
  const s23 = Math.sin(j2 + j3)
  setP(out.w, out.e.x + ARM.fore * c23 * dx, out.e.y + ARM.fore * s23, out.e.z + ARM.fore * c23 * dz)
  const psi = j1 + j4
  setP(out.h, Math.cos(psi), 0, -Math.sin(psi))
  setP(out.g, out.w.x + ARM.hand * out.h.x, out.w.y, out.w.z + ARM.hand * out.h.z)
  setP(out.u, Math.cos(j5) * Math.sin(psi), -Math.sin(j5), Math.cos(j5) * Math.cos(psi))
  out.reachError = 0
  return out
}

/** Wrap an angle to -pi..pi. */
function wrap(a: number): number {
  let v = a
  while (v > Math.PI) v -= 2 * Math.PI
  while (v < -Math.PI) v += 2 * Math.PI
  return v
}

/**
 * The elbow-up solution that puts the guide's centre at `guide.g` with its axis along `guide.u`. A wrist out of reach is pulled in along the
 * shoulder's line (the pose stays whole) and the shortfall is reported in `reachError`.
 */
export function solveArm(guide: Guide, out: ArmPose): ArmPose {
  const u = guide.u
  const hz = Math.sqrt(u.x * u.x + u.z * u.z)
  const sx = MOUNT.x
  const sy = MOUNT.y + ARM.column
  const sz = MOUNT.z
  // the guide's heading; a vertical axis keeps the heading toward the guide from the shoulder
  const psi = hz > 1e-6 ? Math.atan2(u.x, u.z) : Math.atan2(guide.g.x - sx, guide.g.z - sz)
  const j5 = Math.asin(u.y < -1 ? 1 : u.y > 1 ? -1 : -u.y)
  // the wrist: the hand runs square to the heading, horizontally
  const hx = Math.cos(psi)
  const hzz = -Math.sin(psi)
  const wx = guide.g.x - ARM.hand * hx
  const wy = guide.g.y
  const wz = guide.g.z - ARM.hand * hzz
  const j1 = Math.atan2(wx - sx, wz - sz)
  const r = Math.hypot(wx - sx, wz - sz)
  const dy = wy - sy
  let d = Math.hypot(r, dy)
  const dMax = ARM.upper + ARM.fore - 1e-6
  const dMin = Math.abs(ARM.upper - ARM.fore) + 1e-6
  let reach = 0
  if (d > dMax) {
    reach = d - dMax
    d = dMax
  } else if (d < dMin) {
    reach = dMin - d
    d = dMin
  }
  const alpha = Math.atan2(dy, r)
  const cosB = (ARM.upper * ARM.upper + d * d - ARM.fore * ARM.fore) / (2 * ARM.upper * d)
  const beta = Math.acos(cosB < -1 ? -1 : cosB > 1 ? 1 : cosB)
  const j2 = alpha + beta
  // the wrist in the arm's plane (pulled in to the reach if it had to be), and the forearm's elevation to it
  const pr = d * Math.cos(alpha)
  const py = d * Math.sin(alpha)
  const er = ARM.upper * Math.cos(j2)
  const ey = ARM.upper * Math.sin(j2)
  const j3 = Math.atan2(py - ey, pr - er) - j2
  forwardArm(j1, j2, j3, wrap(psi - j1), j5, out)
  out.reachError = reach
  return out
}

// ---------------------------------------------------------------------------------------------
// The robot's target pose from the suite state
// ---------------------------------------------------------------------------------------------

/** Folded over its base: the guide tucked above the cart, pointing down. */
export function stowGuideInto(out: Guide): Guide {
  setP(out.g, MOUNT.x + 0.42, MOUNT.y + 0.32, MOUNT.z - 0.12)
  setP(out.u, 0, -0.97, 0.243)
  normalize(out.u)
  return out
}

/** Ready over the flank: the guide hovering well above the patient, pointing down toward the kidney. */
export function standbyGuideInto(out: Guide): Guide {
  setP(out.g, TARGET.x, 1.5, TARGET.z - 0.42)
  setP(out.u, 0, -0.7, 0.714)
  normalize(out.u)
  return out
}

function normalize(p: P3): void {
  const l = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)
  if (l < 1e-9) {
    setP(p, 0, -1, 0)
    return
  }
  p.x /= l
  p.y /= l
  p.z /= l
}

/** out = a + (b - a) k, the axis by normalised lerp. */
export function blendGuide(a: Guide, b: Guide, k: number, out: Guide): Guide {
  out.g.x = a.g.x + (b.g.x - a.g.x) * k
  out.g.y = a.g.y + (b.g.y - a.g.y) * k
  out.g.z = a.g.z + (b.g.z - a.g.z) * k
  out.u.x = a.u.x + (b.u.x - a.u.x) * k
  out.u.y = a.u.y + (b.u.y - a.u.y) * k
  out.u.z = a.u.z + (b.u.z - a.u.z) * k
  normalize(out.u)
  return out
}

/** How far out along the path the arm comes in from (it approaches and leaves along the needle's axis). */
export const APPROACH_BACK = 0.25

/** Scratch poses for `armTargetInto` (module-level, so a frame allocates nothing). */
const _stow = newGuide()
const _standby = newGuide()
const _pre = newGuide()
const _on = newGuide()

/** The needle the robot works on (clamped into the list), or -1. */
function robotNeedle(s: CryoSuiteState): number {
  const k = s.robot.needle
  if (k < 0 || s.needles.length === 0) return -1
  return k >= s.needles.length ? s.needles.length - 1 : k
}

/**
 * Where the guide should be now, from the state alone (deterministic): stowed over the base, deploying to the standby over the flank, aiming (to the
 * path's approach point, then in along the axis), aligned on the path, retracting (out along the axis, then up to the standby). The table at
 * `tablePos` carries the paths; the sim never aims with the table in.
 */
export function armTargetInto(s: CryoSuiteState, t: number, out: Guide): Guide {
  const phase: CryoRobotPhase = s.robot.phase
  const since = t - s.robot.since
  stowGuideInto(_stow)
  standbyGuideInto(_standby)
  const k = robotNeedle(s)
  if (phase === 'stowed') return blendGuide(_stow, _stow, 0, out)
  if (phase === 'deploying' || k < 0) return blendGuide(_stow, _standby, smooth01(since / ROBOT_TIMING.deploy), out)
  const n = s.needles[k]
  pathGuideInto(n, s.tablePos, APPROACH_BACK, _pre)
  pathGuideInto(n, s.tablePos, 0, _on)
  if (phase === 'aligned') return blendGuide(_on, _on, 0, out)
  if (phase === 'aiming') {
    const a = since / ROBOT_TIMING.aimTravel
    if (a < 1) return blendGuide(_standby, _pre, smooth01(a), out)
    return blendGuide(_pre, _on, smooth01((since - ROBOT_TIMING.aimTravel) / ROBOT_TIMING.aimSettle), out)
  }
  // retracting: out along the axis, then up to the standby
  const r = since / ROBOT_TIMING.retract
  if (r < 0.4) return blendGuide(_on, _pre, smooth01(r / 0.4), out)
  return blendGuide(_pre, _standby, smooth01((r - 0.4) / 0.6), out)
}

/**
 * Ease the drawn guide toward the target (a time constant of `tau` seconds of visual time); `snap` (the first frame, a Jump) puts it there at once.
 * Returns the drawn guide.
 */
export function easeGuide(drawn: Guide, target: Guide, dt: number, tau: number, snap: boolean): Guide {
  const k = snap || dt <= 0 ? (snap ? 1 : 0) : 1 - Math.exp(-dt / tau)
  return blendGuide(drawn, target, k, drawn)
}

// ---------------------------------------------------------------------------------------------
// Needles
// ---------------------------------------------------------------------------------------------

/** Where a needle is drawn: its tip, its handle end (the hub), and whether it shows. */
export interface NeedlePose {
  shown: boolean
  tip: P3
  hub: P3
  u: P3
}

export const newNeedlePose = (): NeedlePose => ({ shown: false, tip: { x: 0, y: 0, z: 0 }, hub: { x: 0, y: 0, z: 0 }, u: { x: 0, y: 0, z: 1 } })

const _ng = newGuide()

/**
 * A needle in the room: shown once it is in (or sitting in the aligned guide, ready to go in); the whole needle slides along its path with `inserted`
 * (0 the tip at the skin, 1 at the planned tip).
 */
export function needlePoseInto(s: CryoSuiteState, k: number, out: NeedlePose): NeedlePose {
  const n = s.needles[k]
  const ready = s.robot.phase === 'aligned' && robotNeedle(s) === k
  out.shown = n !== undefined && (n.inserted > 0.001 || ready)
  if (!out.shown) return out
  pathGuideInto(n, s.tablePos, -ARM.standoff, _ng) // the guide pose at the skin entry: g = the entry
  const depth = Math.hypot(n.tip.x - n.entry.x, n.tip.y - n.entry.y) * MM * clamp01(n.inserted)
  setP(out.u, _ng.u.x, _ng.u.y, _ng.u.z)
  setP(out.tip, _ng.g.x + _ng.u.x * depth, _ng.g.y + _ng.u.y * depth, _ng.g.z + _ng.u.z * depth)
  setP(out.hub, out.tip.x - _ng.u.x * NEEDLE.length, out.tip.y - _ng.u.y * NEEDLE.length, out.tip.z - _ng.u.z * NEEDLE.length)
  return out
}

// ---------------------------------------------------------------------------------------------
// Keep-out boxes (for the tests and the rig's own sanity)
// ---------------------------------------------------------------------------------------------

export interface Box3 {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

/** The patient's body on the table at `tablePos` (head west), and the table (pedestal and cradle). */
export function patientBoxInto(tablePos: number, out: Box3): Box3 {
  const cx = cryoTableX(tablePos)
  out.x0 = cx - 0.95
  out.x1 = cx + 0.85
  out.y0 = T.height
  out.y1 = T.height + 0.24
  out.z0 = T.out.z - 0.18
  out.z1 = T.out.z + 0.18
  return out
}

export function tableBoxInto(tablePos: number, out: Box3): Box3 {
  const cx = cryoTableX(tablePos)
  out.x0 = Math.min(cx - 1.1, T.out.x - 1.4)
  out.x1 = Math.max(cx + 1.1, T.out.x + 1.1)
  out.y0 = 0
  out.y1 = T.height
  out.z0 = T.out.z - 0.3
  out.z1 = T.out.z + 0.3
  return out
}

/** Distance from a point to a box (0 inside). */
export function boxDistance(b: Box3, x: number, y: number, z: number): number {
  const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0
  const dy = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0
  const dz = z < b.z0 ? b.z0 - z : z > b.z1 ? z - b.z1 : 0
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
