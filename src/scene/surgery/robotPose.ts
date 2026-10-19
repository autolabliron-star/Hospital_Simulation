/**
 * R2 (agent O): the da Vinci 5 patient cart as a skeleton, from `RobotState` (src/sim/types.ts), and nothing else. Pure: no three.js, no React, no allocation
 * (every function writes into a preallocated `RobotPose`), so the rig (rig.ts) can call it every frame and the node tests judge the arms' reach.
 *
 * The cart is an Xi-style patient cart: a wheeled base, a telescoping column, and an overhead boom that turns on the column and reaches out; the four arms hang
 * from a row of mounts along the boom's head. Each arm is a drop link, an upper arm, a forearm and a spar (the instrument arm), the spar's axis passing through the
 * port on the patient (the remote centre of motion). Coordinates are SIM coordinates (the level-2 group moves them), y above the floor; headings follow
 * atan2(dx, dz) (0 faces +z, pi/2 faces +x).
 *
 *   boom        boomHeight is the TOP of the boom (the cart's overall height: 1.74 m stowed, 2.47 m raised). It points along cart.heading + boomYaw and is
 *               `boomMin..boomMax` long (boomExtend 0..1) from the column. The four mounts sit `spacing` apart along the head, under the boom.
 *   arm         every arm lies in a vertical plane (azimuth psi) through its shoulder S: upper arm S -> E (L1), forearm E -> W (L2), spar W -> Q (the spar's
 *               axis d, from the wrist down toward the port P = W + d * sparWP). Angles are measured from straight down: 0 down, pi/2 outward, pi up.
 *   poses       the arm blends joint by joint: stowed (folded in a Z) -> deployed (reaching forward, ready to dock) as the boom rises, then -> the solved pose
 *               as `engage` goes 0 -> 1. The solved pose is a 2-link IK to the wrist target W = P - d sparWP, with the spar tilt chosen (a bisection) so the
 *               arm is comfortably bent, never stretched.
 *   tip motion  small seeded insertion, pitch and yaw moves while the console phase runs (`tipMotion`), shared with the endoscope painter: the spar turns
 *               about the port (so it always passes through it), the wrist target moves, the IK follows.
 */
import { SURGERY } from '@/sim/places'
import type { RobotState } from '@/sim/types'
import { LASER_TARGET } from './dims'

export const ARM_COUNT = 4
const TAU = Math.PI * 2

/** The cart's build. Metres. */
export const CART = {
  /** The cart's footprint (places.ts SURGERY.cart.size) and where the column stands along its length (+ forward). */
  w: SURGERY.cart.size.w,
  l: SURGERY.cart.size.l,
  colZ: 0.1,
  /** Heights: the base's top, the column's lower section's top. */
  baseTop: 0.44,
  lowerTop: 1.4,
  /** The boom: its beam's thickness, its reach from the column's axis to the middle of the head, the head's length. */
  boomThick: 0.18,
  boomMin: 0.45,
  boomMax: 1.5,
  headLen: 0.95,
  /** The four mounts are this far apart along the head; a drop link carries the shoulder this far below the boom's underside. */
  spacing: 0.2,
  drop: 0.3,
  /** Arm links, the wrist-to-port distance along the spar, and the spar's drawn length (it ends 0.1 above the port). */
  L1: 0.5,
  L2: 0.5,
  sparWP: 0.62,
  sparLen: 0.52,
  /** Where the carriage rides along the spar from the wrist, and how deep the instrument tip is below the port. */
  carriage: 0.3,
  tipDepth: 0.09,
} as const

/** Joint limits (radians): the shoulder's angle from straight down, the elbow's bend, the spar's tilt from vertical. */
export const LIMITS = {
  shoulder: [-0.9, 2.4] as readonly [number, number],
  bend: 2.9,
  tilt: [-1.1, 1.3] as readonly [number, number],
} as const

/** The boom's height range (m): below this the arms are folded, above `DEPLOY_AT` they are in the deployed pose. */
export const BOOM_STOWED = SURGERY.cart.size.stowedHeight
export const DEPLOY_AT = 2.2

interface Joints {
  a1: number
  a2: number
  beta: number
}
/** Folded in a Z over the cart, and ready to dock (the arms reached forward and up). */
const STOWED: Joints = { a1: 0.35, a2: -2.0, beta: 0 }
const DEPLOYED: Joints = { a1: 1.25, a2: 1.1, beta: 0.35 }

/** The pose of one arm, everything the rig draws. Positions are sim x, y above the floor, sim z. */
export interface ArmPose {
  index: number
  drape: number
  engage: number
  /** The boom mount (underside of the boom), the shoulder, the elbow, the wrist (top of the spar), the spar's end, the carriage, the tip, the port. */
  mx: number
  my: number
  mz: number
  sx: number
  sy: number
  sz: number
  ex: number
  ey: number
  ez: number
  wx: number
  wy: number
  wz: number
  qx: number
  qy: number
  qz: number
  cx: number
  cy: number
  cz: number
  tx: number
  ty: number
  tz: number
  px: number
  py: number
  pz: number
  /** The spar's axis, a unit vector from the wrist toward the port. */
  dx: number
  dy: number
  dz: number
  /** The arm plane's horizontal axis (a unit vector, outward from the shoulder) and its lateral unit vector (horizontal, perpendicular). */
  ux: number
  uz: number
  lx: number
  lz: number
  /** The joint angles that produced it (for the tests): shoulder from straight down, forearm from straight down, the spar's tilt from vertical. */
  a1: number
  a2: number
  beta: number
  /** The wrist target of the solved pose (0 when the arm is not engaged) and how far the forward kinematics missed it (m). */
  targetX: number
  targetY: number
  targetZ: number
  error: number
  /** The instrument's insertion move this frame (m), and whether an instrument is fitted. */
  insert: number
  fitted: boolean
}

export interface RobotPose {
  /** The cart's base on the floor, its heading, and the column's axis (world). */
  cartX: number
  cartZ: number
  heading: number
  colX: number
  colZ: number
  /** The boom: top height, its world direction (angle and unit vector), its length from the column, the head's centre. */
  boomTop: number
  boomAngle: number
  boomUx: number
  boomUz: number
  boomLen: number
  headX: number
  headZ: number
  /** 0 folded, 1 deployed (from the boom height). */
  deploy: number
  /** The laser crosshair: on, and where it lands. */
  laser: boolean
  laserX: number
  laserY: number
  laserZ: number
  arms: ArmPose[]
}

function newArm(index: number): ArmPose {
  return {
    index,
    drape: 0,
    engage: 0,
    mx: 0, my: 0, mz: 0,
    sx: 0, sy: 0, sz: 0,
    ex: 0, ey: 0, ez: 0,
    wx: 0, wy: 0, wz: 0,
    qx: 0, qy: 0, qz: 0,
    cx: 0, cy: 0, cz: 0,
    tx: 0, ty: 0, tz: 0,
    px: 0, py: 0, pz: 0,
    dx: 0, dy: -1, dz: 0,
    ux: 0, uz: 1, lx: 1, lz: 0,
    a1: 0, a2: 0, beta: 0,
    targetX: 0, targetY: 0, targetZ: 0, error: 0,
    insert: 0,
    fitted: false,
  }
}

export function newRobotPose(): RobotPose {
  return {
    cartX: 0, cartZ: 0, heading: 0, colX: 0, colZ: 0,
    boomTop: 0, boomAngle: 0, boomUx: 0, boomUz: 1, boomLen: 0, headX: 0, headZ: 0,
    deploy: 0,
    laser: false, laserX: 0, laserY: 0, laserZ: 0,
    arms: [newArm(0), newArm(1), newArm(2), newArm(3)],
  }
}

// ---------------------------------------------------------------------------------------------
// Small maths
// ---------------------------------------------------------------------------------------------

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Smooth 0..1 ease (smoothstep). */
export function smooth01(x: number): number {
  const u = clamp01(x)
  return u * u * (3 - 2 * u)
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/** The shortest signed turn from `a` to `b`. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  else if (d < -Math.PI) d += TAU
  return d
}

// ---------------------------------------------------------------------------------------------
// Seeded tip motion (shared with the endoscope painter)
// ---------------------------------------------------------------------------------------------

/** A small deterministic hash to 0..1 of a seed and two integers. */
export function h01(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

export interface TipMotion {
  /** The instrument slides in (+) or out along its axis (m), about +-2.5 cm. */
  insert: number
  /** The shaft turns about the port, in the arm's plane (+: the tip swings toward the cart) and across it (radians), about +-0.07. */
  pitch: number
  yaw: number
  /** The jaws, 0 closed .. 1 open (the endoscope has none). */
  jaw: number
  /** The instrument rolls about its own axis (radians). */
  roll: number
}

/** Amplitudes of the console phase's small moves. */
export const TIP = { insert: 0.025, pitch: 0.07, yaw: 0.07, roll: 0.6 } as const

/**
 * The small moves of arm `arm` at time `t` (seconds) from the case's `seed`: a few slow sines of seeded frequencies and phases, so the same seed and time
 * always give the same tip, with no state. The endoscope arm (index 1) drifts a little and has no jaws. Writes into `out`.
 */
export function tipMotion(arm: number, t: number, seed: number, out: TipMotion): TipMotion {
  const k = arm * 7 + 3
  const f1 = 0.13 + 0.17 * h01(seed, k, 1)
  const f2 = 0.31 + 0.23 * h01(seed, k, 2)
  const f3 = 0.11 + 0.14 * h01(seed, k, 3)
  const f4 = 0.23 + 0.19 * h01(seed, k, 4)
  const f5 = 0.17 + 0.21 * h01(seed, k, 5)
  const f6 = 0.37 + 0.31 * h01(seed, k, 6)
  const p1 = TAU * h01(seed, k, 11)
  const p2 = TAU * h01(seed, k, 12)
  const p3 = TAU * h01(seed, k, 13)
  const p4 = TAU * h01(seed, k, 14)
  const p5 = TAU * h01(seed, k, 15)
  const p6 = TAU * h01(seed, k, 16)
  const g = arm === 1 ? 0.35 : 1
  out.insert = g * TIP.insert * (0.65 * Math.sin(TAU * f1 * t + p1) + 0.35 * Math.sin(TAU * f2 * t + p2))
  out.pitch = g * TIP.pitch * (0.7 * Math.sin(TAU * f3 * t + p3) + 0.3 * Math.sin(TAU * f4 * t + p4))
  out.yaw = g * TIP.yaw * (0.7 * Math.sin(TAU * f5 * t + p5) + 0.3 * Math.sin(TAU * f1 * 1.9 * t + p2))
  out.roll = g * TIP.roll * Math.sin(TAU * f6 * t + p6)
  // the jaws: open and close in slow bites, closed a good part of the time
  const s = Math.sin(TAU * (0.16 + 0.12 * h01(seed, k, 7)) * t + p4)
  const jaw = arm === 1 ? 0 : clamp01(0.5 + 0.9 * s)
  out.jaw = jaw * jaw * (3 - 2 * jaw)
  return out
}

/** The tip motion's gain over a robot phase: nothing until the console phase has settled, nothing again as the arms undock. */
export function motionGain(r: Readonly<RobotState>, t: number): number {
  if (r.phase === 'docked') return smooth01((t - r.phaseSince) / 4)
  if (r.phase === 'undocking') return 1 - smooth01((t - r.phaseSince) / 1.5)
  return 0
}

// ---------------------------------------------------------------------------------------------
// The skeleton
// ---------------------------------------------------------------------------------------------

const _tip: TipMotion = { insert: 0, pitch: 0, yaw: 0, jaw: 0, roll: 0 }

/** The arm's two links solved in its vertical plane: from the shoulder (the origin) to the wrist at (wr, wy) (wy relative to the shoulder), elbow up. Fills `a1`, `a2`. */
function elbowUp(wr: number, wy: number, out: ArmPose): void {
  const reach = CART.L1 + CART.L2
  let d = Math.hypot(wr, wy)
  const min = Math.abs(CART.L1 - CART.L2) + 1e-3
  if (d > reach - 1e-3) d = reach - 1e-3
  if (d < min) d = min
  const gamma = Math.atan2(wy, wr)
  const cosTau = (CART.L1 * CART.L1 + d * d - CART.L2 * CART.L2) / (2 * CART.L1 * d)
  const tau = Math.acos(cosTau > 1 ? 1 : cosTau < -1 ? -1 : cosTau)
  const th1 = gamma + tau
  const er = CART.L1 * Math.cos(th1)
  const ey = CART.L1 * Math.sin(th1)
  // the wrist as far as the arm can reach it (a target beyond reach is stretched toward)
  const wr2 = d * Math.cos(gamma)
  const wy2 = d * Math.sin(gamma)
  const th2 = Math.atan2(wy2 - ey, wr2 - er)
  out.a1 = Math.atan2(Math.cos(th1), -Math.sin(th1))
  out.a2 = Math.atan2(Math.cos(th2), -Math.sin(th2))
}

/** The spar tilts the solver may choose (the physical limits, LIMITS.tilt, also leave room for the tip motion's pitch on top). */
const SOLVE_TILT: readonly [number, number] = [-0.7, 0.8]

/**
 * The spar tilt that leaves the arm comfortably bent: the wrist sits on a sphere of radius sparWP round the port, and this walks along its arc (the spar leaning
 * along the horizontal direction `chi`, port at the horizontal offset (hx, hz) and height `py` from the shoulder at height `sy`) until the shoulder-to-wrist
 * distance is `want`, or as near as the tilt limits allow. A bisection (the distance falls as the spar leans toward the shoulder), so it is continuous in its inputs.
 */
function solveTilt(hx: number, hz: number, chi: number, py: number, sy: number, want: number): number {
  let lo = SOLVE_TILT[0]
  let hi = SOLVE_TILT[1]
  if (tiltDistance(lo, hx, hz, chi, py, sy) <= want) return lo
  if (tiltDistance(hi, hx, hz, chi, py, sy) >= want) return hi
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2
    if (tiltDistance(mid, hx, hz, chi, py, sy) > want) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** The shoulder-to-wrist distance when the spar leans `b` along the horizontal direction `chi` (see solveTilt). */
function tiltDistance(b: number, hx: number, hz: number, chi: number, py: number, sy: number): number {
  const lean = CART.sparWP * Math.sin(b)
  const dx = hx - lean * Math.sin(chi)
  const dz = hz - lean * Math.cos(chi)
  const dy = py + CART.sparWP * Math.cos(b) - sy
  return Math.sqrt(dx * dx + dz * dz + dy * dy)
}

/** How far into its comfortable reach the solved arm is held (the fraction of L1 + L2). */
const WANT = 0.8 * (CART.L1 + CART.L2)

/**
 * Write the whole skeleton of the cart for robot state `r` at sim time `t` into `out`. Allocation-free. The solved pose of an engaged arm uses its port
 * (`arms[i].port`, sim coordinates); an arm with `engage` > 0 and no port stays in its base pose.
 */
export function poseRobot(r: Readonly<RobotState>, t: number, out: RobotPose): RobotPose {
  const h = r.cart.heading
  const sinH = Math.sin(h)
  const cosH = Math.cos(h)
  out.cartX = r.cart.x
  out.cartZ = r.cart.z
  out.heading = h
  out.colX = r.cart.x + sinH * CART.colZ
  out.colZ = r.cart.z + cosH * CART.colZ
  out.boomTop = r.boomHeight
  out.boomAngle = h + r.boomYaw
  out.boomUx = Math.sin(out.boomAngle)
  out.boomUz = Math.cos(out.boomAngle)
  out.boomLen = lerp(CART.boomMin, CART.boomMax, clamp01(r.boomExtend))
  out.headX = out.colX + out.boomUx * out.boomLen
  out.headZ = out.colZ + out.boomUz * out.boomLen
  out.deploy = smooth01((r.boomHeight - BOOM_STOWED) / (DEPLOY_AT - BOOM_STOWED))
  out.laser = r.laser
  const ep = r.arms[1].port
  out.laserX = ep ? ep.x : LASER_TARGET.x
  out.laserY = ep ? ep.y : LASER_TARGET.y
  out.laserZ = ep ? ep.z : LASER_TARGET.z

  const mountY = r.boomHeight - CART.boomThick
  const shoulderY = mountY - CART.drop
  const gain = motionGain(r, t)
  const tip = _tip

  for (let i = 0; i < ARM_COUNT; i++) {
    const s = r.arms[i]
    const a = out.arms[i]
    a.drape = s.drape
    a.engage = s.engage
    a.fitted = s.instrument !== ''
    const along = (i - 1.5) * CART.spacing
    a.mx = out.headX + out.boomUx * along
    a.my = mountY
    a.mz = out.headZ + out.boomUz * along
    a.sx = a.mx
    a.sy = shoulderY
    a.sz = a.mz

    // the base pose: folded or deployed, the arm's plane along the boom, a little fan across the row in the deployed pose
    const fan = (i - 1.5) * 0.1 * out.deploy
    let a1 = lerp(STOWED.a1, DEPLOYED.a1, out.deploy)
    let a2 = lerp(STOWED.a2, DEPLOYED.a2, out.deploy)
    let beta = lerp(STOWED.beta, DEPLOYED.beta, out.deploy)
    let psi = out.boomAngle + fan
    let chi = psi
    a.targetX = 0
    a.targetY = 0
    a.targetZ = 0
    a.error = 0
    a.insert = 0

    const port = s.port
    // An arm swings onto its port as `engage` goes 0 -> 1 (docking, targeting) and off it again (undocking). In the console phase it stays on its port: an
    // `engage` dip then is the bedside assistant changing the instrument, which withdraws along the spar (the carriage rides up, the tip leaves the patient).
    const docked = r.phase === 'docked'
    const e1 = port !== null ? clamp01(s.engage) : 0
    const pull = docked && e1 > 0 ? clamp01((1 - e1) / 0.45) : 0
    const eJoint = docked && e1 > 0 ? 1 : e1
    if (port !== null && eJoint > 0) {
      const e = smooth01(eJoint)
      // the spar passes through the port, turned about it by the console phase's small moves (the endoscope arm moves less)
      const m = tipMotion(i, t, r.motionSeed, tip)
      const g = gain * (e * e * e * e) * (1 - pull)
      const hx = port.x - a.sx
      const hz = port.z - a.sz
      const pr = Math.hypot(hx, hz)
      // the spar leans along the horizontal direction from the shoulder to the port; with the shoulder right over the port that direction is undefined, so it
      // eases to the boom's own
      const toP = pr > 1e-6 ? Math.atan2(hx, hz) : out.boomAngle
      const chi0 = out.boomAngle + angleDelta(out.boomAngle, toP) * smooth01((pr - 0.1) / 0.3)
      let bt = solveTilt(hx, hz, chi0, port.y, shoulderY, WANT)
      bt += m.pitch * g
      const sb = Math.sin(bt)
      const chiT = chi0 + (m.yaw * g) / (Math.abs(sb) > 0.25 ? Math.abs(sb) : 0.25)
      const dx = sb * Math.sin(chiT)
      const dy = -Math.cos(bt)
      const dz = sb * Math.cos(chiT)
      const wx = port.x - dx * CART.sparWP
      const wy = port.y - dy * CART.sparWP
      const wz = port.z - dz * CART.sparWP
      a.targetX = wx
      a.targetY = wy
      a.targetZ = wz
      const psiT = Math.atan2(wx - a.sx, wz - a.sz)
      elbowUp(Math.hypot(wx - a.sx, wz - a.sz), wy - shoulderY, a)
      const a1T = a.a1
      const a2T = a.a2
      a1 += (a1T - a1) * e
      a2 += (a2T - a2) * e
      beta += (bt - beta) * e
      psi += angleDelta(psi, psiT) * e
      chi += angleDelta(chi, chiT) * e
      a.insert = m.insert * g
    }

    // forward kinematics from the (blended) joint angles
    a.a1 = a1
    a.a2 = a2
    a.beta = beta
    a.ux = Math.sin(psi)
    a.uz = Math.cos(psi)
    a.lx = a.uz
    a.lz = -a.ux
    const r1 = Math.sin(a1)
    a.ex = a.sx + a.ux * CART.L1 * r1
    a.ey = a.sy - CART.L1 * Math.cos(a1)
    a.ez = a.sz + a.uz * CART.L1 * r1
    const r2 = Math.sin(a2)
    a.wx = a.ex + a.ux * CART.L2 * r2
    a.wy = a.ey - CART.L2 * Math.cos(a2)
    a.wz = a.ez + a.uz * CART.L2 * r2
    const sb = Math.sin(beta)
    a.dx = sb * Math.sin(chi)
    a.dy = -Math.cos(beta)
    a.dz = sb * Math.cos(chi)
    a.qx = a.wx + a.dx * CART.sparLen
    a.qy = a.wy + a.dy * CART.sparLen
    a.qz = a.wz + a.dz * CART.sparLen
    a.px = a.wx + a.dx * CART.sparWP
    a.py = a.wy + a.dy * CART.sparWP
    a.pz = a.wz + a.dz * CART.sparWP
    const ride = CART.carriage + a.insert - 0.2 * pull
    a.cx = a.wx + a.dx * ride
    a.cy = a.wy + a.dy * ride
    a.cz = a.wz + a.dz * ride
    // the tip goes in to tipDepth below the port once engaged, and leaves the patient as the instrument withdraws
    const depth = CART.sparWP + (CART.tipDepth + a.insert) * e1 * (1 - pull) - 0.12 * pull
    a.tx = a.wx + a.dx * depth
    a.ty = a.wy + a.dy * depth
    a.tz = a.wz + a.dz * depth
    if (port !== null && eJoint > 0) {
      const ex = a.wx - a.targetX
      const ey = a.wy - a.targetY
      const ez = a.wz - a.targetZ
      a.error = Math.sqrt(ex * ex + ey * ey + ez * ez)
    }
  }
  return out
}
