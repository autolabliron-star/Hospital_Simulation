// Ported from Waltz City (src/scene/actors/crowd/rig.ts). Kept: the layered solve, planted feet, pelvis, leg IK. New: lying, the seat/stand
// blend, hand-reach arm IK, held items and the prop frame. W1 (the player walks briskly and runs): `run` and `brisk` blends from the measured speed (a run pose
// for anybody going fast, whatever the sim called the animation), the arms follow a smooth stride phase, the pelvis crouches and bounces with the stride, and the coat follows the legs.
// W3 (the player's slot only, `RigInput.driven`): the feet are planned from the body's true velocity and intent (gait.ts), the run and brisk blends follow at once, the
// trunk leans into acceleration and rolls into curves, and the head leads turns. Every NPC takes the old paths, number for number.
// W3 wave B (realistic people): every length comes from the person's own skeleton (`Dims.b`: NOMINAL_BODY, which is BODY to the last bit, or a
// Rocketbox avatar's measured BodyDims), with its waist, neck and shoulder offsets front to back and its own seated and lying pelvis heights.
/**
 * The rig solver: one person's state and, each frame, the part matrices that pose the instanced body.
 *
 * Inputs are plain numbers (position, heading, smoothed velocity, the pose mode, the posture, the held item), outputs
 * are PART_COUNT x 3x4 matrices relative to the person's root (feet on the floor at the origin, facing +Z), written
 * straight into the pose texture's row. Pure maths, no three.js, so the whole pipeline is unit tested in node.
 *
 * Layers, in order:
 *   1. style weights (happy, slumped, speaking, run, hold, sit, lie) eased over a fraction of a second
 *   2. the pose blender (blend.ts): mode weights that sum to 1, 0.25 s cross-fade, upper-body angles and hand targets
 *   3. the footfall planner (gait.ts) for standing and walking people, or the seat for seated ones
 *   4. pelvis: sways over the planted feet; its height is whatever keeps both planted legs reachable. Sitting and
 *      standing are both solved and mixed by the sit weight, so standing up or sitting down is a short slide, not a pop
 *   5. leg IK to the planted feet (ik.ts), chest, head (with the smoothed look-at)
 *   6. arms: forward kinematics from the pose angles, pulled onto the hand targets by a two-bone solve where a pose has them
 *   7. the held item's frame, from the right hand
 *   8. lying: the whole upright body is tipped flat about the pelvis onto the mattress
 */
import type { Look } from './outfit'
import { LEG_LENGTH, LEG_MAX, LEG_RELAXED, LIE_LEG, LIE_RECLINE_LIFT_MAX, NOMINAL_BODY, P, PART_COUNT, PROP, standPelvis, type BodyDims } from './constants'
import { MAT, clamp, damp, isFiniteMat, noise1, rnd, setRotXZY, setRotYXZ, setZero, mul, setTranslation, smoothstep, transformPoint, translateLocal, wrapPi } from './math'
import { advanceBlend, blendTo, createBlender, MODE_INDEX, type Blender, type Mode, type Posture } from './blend'
import { briskBlend, createPlanter, resetPlanter, runBlend, updatePlanter, type Planter } from './gait'
import { createLegResult, setFootMatrix, solveLeg } from './ik'
import { createHeadLook, lookPitch, lookYaw, updateHeadLook, type HeadLook } from './look'
import { HAIR_BACK, HAIR_CAP, HAIR_FRONT, type HairPiece } from './hair'
import { blinkAt, expressionOf, mouthOpenAt } from './face'
import { ARM_L, ARM_R, MOP, REACH_L, REACH_R, U, UP_COUNT, blendUpper, createPoseCtx, mopPoints, type PoseCtx } from './pose'
import { BACKREST, MATTRESS } from '@/scene/rooms/bedParts'
import { reclineAngle } from '@/scene/rooms/bedPose'

export interface Dims {
  /** Overall size relative to the nominal body. */
  s: number
  /** Width factor of torso and pelvis. */
  w: number
  /** Thickness factor of the limbs (they follow the build, less than the torso does). */
  tl: number
  /** W3 wave B: the skeleton's proportions (NOMINAL_BODY, or the realistic avatar's own, see BodyDims in constants.ts). */
  b: Readonly<BodyDims>
}

export interface PersonRig {
  look: Look
  dims: Dims
  ctx: PoseCtx
  blender: Blender
  planter: Planter
  headLook: HeadLook
  happy: number
  slump: number
  speaking: number
  /** 0 at a walk, 1 at a run: eased from the measured speed (gait.ts `runBlend`), so anybody who moves fast runs, whatever the sim called the animation. */
  run: number
  /** 0 at the NPCs' walk (up to 1.4 m/s) .. 1 at a brisk walk (2 m/s) and above: the arm swing, elbows and crouch of somebody going faster than a stroll. */
  brisk: number
  /**
   * The driven body's lean (W3): the trunk's forward lean from the acceleration (radians, + forward) and the sideways roll into a curve (+ rolls to
   * the right, so a left turn leans negative), both eased so a spring's acceleration never shows as a twitch. 0 for everybody that is not driven.
   */
  lean: number
  roll: number
  /** 0..1: how firmly the right hand holds `holdKind`. */
  hold: number
  /** The item the hand is moving to or holding (a PROP value). Changes only when the hand has let go. */
  holdKind: number
  /** 0 standing .. 1 seated, 0 .. 1 lying: eased so a posture change is a motion. */
  sit: number
  lie: number
  /** Blended upper-body pose of the last solve. */
  up: Float32Array
  seatSpread: number
  seatForward: number
  seatBack: 0 | 1 | -1
  /** Last solve: how flat the body lies (0 upright, 1 flat). */
  lastLie: number
  /** Last solve: how far the pelvis and all above it ride up because the bed head is raised (m; 0 flat, up to LIE_RECLINE_LIFT_MAX); the feet stay planted. */
  lastLift: number
  /** What the last solve put into the prop frame (a PROP value, PROP.none when nothing is drawn) and its scale. */
  propDraw: number
  propScale: number
  /** The face of the last solve (W1), written into the pose texture's face texel: where the eyes look, the expression, the blink, an open mouth. */
  face: Face
}

/** What the close-up head shows; see TEX.face and TEX.gear in constants.ts. */
export interface Face {
  /** Where the iris looks, relative to the head's own facing: radians, + yaw to the left, + pitch up. */
  eyeYaw: number
  eyePitch: number
  /** -1 a small frown (unwell) .. 0 neutral (neutral, waiting) .. +1 a slight smile (happy). */
  expression: number
  /** 0 open .. 1 shut. */
  blink: number
  /** 0 shut .. 1 wide while the person talks. */
  mouthOpen: number
}

export interface RigInput {
  dt: number
  time: number
  /** Root position (feet on the floor) and heading. */
  x: number
  y: number
  z: number
  heading: number
  /** Smoothed ground velocity and speed, m/s. */
  vx: number
  vz: number
  speed: number
  mode: Mode
  posture: Posture
  mood: 'neutral' | 'happy' | 'waiting' | 'unwell'
  /** Seat surface height (sitting) or mattress height (lying) above the floor. */
  seatHeight: number
  /** Height of the footplate when the feet do not reach the floor (a wheelchair), above the floor. */
  footRest: number
  /** The item in the right hand (a PROP value). */
  prop: number
  /**
   * A lying person is in a bed that has a blanket for them (a ward bed, an ER trolley or a stretcher: head.ts `inBlanketBed`). The rig then puts the blanket
   * (PROP.blanket) in the prop frame, on the mattress under the hips, for as long as they lie. Anybody else lying (a scanner table) lies bare.
   */
  covered: boolean
  /** World point to look at, or null. */
  hasLook: boolean
  lookX: number
  lookY: number
  lookZ: number
  // --- W3: the driven body (the player; every NPC leaves these at their defaults and is planned exactly as before) ---
  /**
   * `vx`, `vz` and `speed` above are the body's TRUE velocity, and the fields below say what its keys ask for (the contract `walkBody`, state.ts):
   * the feet plan from them (gait.ts, `PlanterIntent`), the trunk leans into the acceleration and rolls into curves, the head leads turns.
   */
  driven: boolean
  /** The speed spring's acceleration (world, m/s^2). */
  ax: number
  az: number
  /** Heading rate, rad/s, positive = `atan2(dx, dz)` growing (a turn to the left). */
  turnRate: number
  /** The velocity the keys ask for (m/s), 0 with no key held. */
  wishX: number
  wishZ: number
  /** No key held, still coasting to a stop, and where the body will come to rest. */
  stopping: boolean
  restX: number
  restZ: number
}

export function createRig(look: Look, body: Readonly<BodyDims> = NOMINAL_BODY): PersonRig {
  const h = look.seed
  const ctx = createPoseCtx(h, look.hand, (k) => rnd(h, k))
  return {
    look,
    dims: { s: look.scale, w: look.build, tl: 1 + (look.build - 1) * 0.6, b: body },
    ctx,
    blender: createBlender('relaxed'),
    planter: createPlanter(),
    headLook: createHeadLook(),
    happy: 0,
    slump: 0,
    speaking: 0.5,
    run: 0,
    brisk: 0,
    lean: 0,
    roll: 0,
    hold: 0,
    holdKind: PROP.none,
    sit: 0,
    lie: 0,
    up: new Float32Array(UP_COUNT),
    seatSpread: rnd(h, 71),
    seatForward: rnd(h, 72),
    seatBack: rnd(h, 73) < 0.3 ? (rnd(h, 74) < 0.5 ? 1 : -1) : 0,
    lastLie: 0,
    lastLift: 0,
    propDraw: PROP.none,
    propScale: 0,
    face: { eyeYaw: 0, eyePitch: 0, expression: 0, blink: 0, mouthOpen: 0 },
  }
}

export function makeInput(): RigInput {
  return {
    dt: 1 / 60,
    time: 0,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: 0,
    speed: 0,
    mode: 'relaxed',
    posture: 'stand',
    mood: 'neutral',
    seatHeight: 0.45,
    footRest: 0,
    prop: PROP.none,
    covered: false,
    hasLook: false,
    lookX: 0,
    lookY: 0,
    lookZ: 0,
    driven: false,
    ax: 0,
    az: 0,
    turnRate: 0,
    wishX: 0,
    wishZ: 0,
    stopping: false,
    restX: 0,
    restZ: 0,
  }
}

/** How the skirt piece is scaled (x/z width, y length, seated length) for each outfit overlay. */
const OVERLAY: Record<Look['overlay'], readonly [number, number, number]> = {
  none: [0, 0, 0],
  skirt: [1, 1, 0.62],
  coat: [0.9, 1.22, 0.72],
  gown: [1, 0.86, 0.6],
}

// scratch matrices (Float64 for accuracy, copied into the Float32 pose row at the end)
const S = new Float64Array(MAT * 20)
const iP = 0
const iC = MAT
const iH = MAT * 2
const iSL = MAT * 3
const iEL = MAT * 4
const iWL = MAT * 5
const iSR = MAT * 6
const iER = MAT * 7
const iWR = MAT * 8
const iT1 = MAT * 9
const iT2 = MAT * 10
const iT3 = MAT * 11
const iHL = MAT * 12
const iHR = MAT * 13
const iPR = MAT * 14
const iLT = MAT * 15
const LEG = new Float64Array(MAT * 4) // thighL, shinL, thighR, shinR
const legL = createLegResult()
const legR = createLegResult()

/** Stand and seated solves of the pelvis and feet, mixed by the sit weight. Indices into the scratch arrays. */
const PX = 0
const PY = 1
const PZ = 2
const PYAW = 3
const PROLL = 4
const PPITCH = 5
const AX0 = 6
const AZ0 = 7
const AY0 = 8
const YAW0 = 9
const PITCH0 = 10
const AX1 = 11
const AZ1 = 12
const AY1 = 13
const YAW1 = 14
const PITCH1 = 15
const STANDING = new Float64Array(16)
const SEATED = new Float64Array(16)

/**
 * The driven body's lean and roll (W3). The trunk's forward lean in radians per m/s^2 of acceleration along the facing (braking leans it back), with
 * its limits; the roll into a curve per (m/s of speed x rad/s of turn); how fast both follow. The pelvis takes two thirds of the lean and the chest the
 * rest, so the chest ends up leaning by the whole of it (+3 m/s^2: 4 degrees, -6: 4.6 degrees back, the most a hard start gives: 7 degrees).
 */
export const LEAN = { perAccel: 0.024, forward: 0.12, back: 0.08, pelvisShare: 2 / 3, rollPerSpeedTurn: 0.03, rollMax: 0.09, follow: 14, headLead: 0.3, headLeadMax: 0.5, headLeadFrom: 0.12 } as const

/** One value of the stand/seat mix: `a` when the weight is 0 or 1 (already the right array), otherwise the blend of the two solves. */
function mixAt(a: Float64Array, i: number, k: number): number {
  return k === 0 ? a[i] : STANDING[i] + (SEATED[i] - STANDING[i]) * k
}

function putPart(out: Float32Array, o: number, part: number, m: Float64Array, mo: number, sx: number, sy: number, sz: number): void {
  const b = o + part * MAT
  out[b] = m[mo] * sx
  out[b + 1] = m[mo + 1] * sy
  out[b + 2] = m[mo + 2] * sz
  out[b + 3] = m[mo + 3]
  out[b + 4] = m[mo + 4] * sx
  out[b + 5] = m[mo + 5] * sy
  out[b + 6] = m[mo + 6] * sz
  out[b + 7] = m[mo + 7]
  out[b + 8] = m[mo + 8] * sx
  out[b + 9] = m[mo + 9] * sy
  out[b + 10] = m[mo + 10] * sz
  out[b + 11] = m[mo + 11]
}

/** Smooth minimum of two numbers (polynomial), so the pelvis height has no kink where the limiting leg changes. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/**
 * Where the right hand goes for each held item, and the left hand for the two-handed ones: points in the root frame
 * (nominal size, x to the left, y above the floor of a standing person, z forward). [x, y, z] or null.
 */
interface HoldSpec {
  r: readonly [number, number, number]
  l: readonly [number, number, number] | null
  /** The item's frame from the hand: offset in the root frame (nominal), then tilt about X (radians). */
  off: readonly [number, number, number]
  tilt: number
  /** How strongly the item hangs from the arm's swing (bags, folders). */
  swing: number
}
const HOLD: readonly (HoldSpec | null)[] = [
  null, // none
  { r: [-0.11, 1.05, 0.26], l: null, off: [0.12, 0.03, 0.0], tilt: 0.5, swing: 0 }, // tablet
  { r: [-0.2, 0.86, 0.12], l: null, off: [0, 0.03, 0], tilt: 0, swing: 0.8 }, // folder
  { r: [-0.15, 1.06, 0.34], l: [0.15, 1.06, 0.34], off: [0.15, 0.02, 0], tilt: 0, swing: 0 }, // tray
  { r: [-0.15, 1.12, 0.24], l: null, off: [0, 0, 0], tilt: 0, swing: 0 }, // coffee cup
  { r: [-0.24, 0.8, 0.02], l: null, off: [0, 0.05, 0], tilt: 0, swing: 0.5 }, // bag
  { r: [-0.16, 1.08, 0.28], l: null, off: [0, 0.02, 0.02], tilt: 0.28, swing: 0 }, // flowers
  null, // mop (follows the two hands in 'clean')
]

/**
 * Two-bone arm solve in the chest frame. Writes pitch, roll, twist and elbow into `up` at `base` (the hand's FK block),
 * mixed with the angles already there by `w`. The target is the middle of the hand (the wrist plus 0.085 along the forearm).
 * `side` is +1 for the left arm. A target out of reach is pulled in to the arm's full length.
 */
function solveArmReach(up: Float32Array, base: number, side: 1 | -1, w: number, tx: number, ty: number, tz: number, shX: number, shY: number, shZ: number, s: number, B: Readonly<BodyDims>): void {
  const L1 = B.upperArm * s
  const L2 = (B.forearm + B.hand) * s
  const dx = tx - side * shX
  const dy = ty - shY
  const dz = tz - shZ
  const dRaw = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
  const d = clamp(dRaw, Math.abs(L1 - L2) + 0.02 * s, (L1 + L2) * 0.998)
  const hx = dx / dRaw
  const hy = dy / dRaw
  const hz = dz / dRaw
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  // the elbow bends down and out: the pole, made perpendicular to the shoulder-to-hand line
  let nx = side * 0.55
  let ny = -1
  let nz = -0.25
  const dot = nx * hx + ny * hy + nz * hz
  nx -= dot * hx
  ny -= dot * hy
  nz -= dot * hz
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  nx /= nl
  ny /= nl
  nz /= nl
  // upper arm direction u
  const ux = hx * cosA + nx * sinA
  const uy = hy * cosA + ny * sinA
  const uz = hz * cosA + nz * sinA
  // forearm direction f = (hand - elbow) / L2
  let fx = hx * d - ux * L1
  let fy = hy * d - uy * L1
  let fz = hz * d - uz * L1
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1
  fx /= fl
  fy /= fl
  fz /= fl
  const elbow = Math.acos(clamp(ux * fx + uy * fy + uz * fz, -1, 1))
  const sr = Math.asin(clamp(ux, -1, 1))
  const pitch = Math.atan2(uz, -uy)
  // twist: undo pitch then roll on the forearm direction, what is left is the elbow's own bend rotated about the arm axis
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const y1 = fy * cp - fz * sp
  const z1 = fy * sp + fz * cp
  const cs = Math.cos(sr)
  const ss = Math.sin(sr)
  const x2 = fx * cs + y1 * ss
  const z2 = z1
  let twist = Math.atan2(x2, z2) * side
  twist *= smoothstep(0.02, 0.2, Math.sin(elbow))
  const k = clamp(w, 0, 1)
  up[base] += (pitch - up[base]) * k
  up[base + 1] += (side * sr - up[base + 1]) * k
  up[base + 2] += (twist - up[base + 2]) * k
  up[base + 3] += (elbow - up[base + 3]) * k
  up[base + 4] *= 1 - 0.8 * k
}

/** Add a hand target (nominal root frame) to the blended reach block with weight `k`, keeping the weighted mean of targets. */
function addReach(up: Float32Array, base: number, k: number, x: number, y: number, z: number): void {
  const w0 = clamp(up[base], 0, 1)
  const add = k * (1 - w0)
  const w1 = w0 + add
  if (w1 < 1e-5) return
  // up[base+1..3] hold the sum of weight * target, so the new target is simply the old sum plus the added share
  up[base + 1] += add * x
  up[base + 2] += add * y
  up[base + 3] += add * z
  up[base] = w1
}

/**
 * Solve one person. Writes PART_COUNT x 12 floats at `out[o..]`.
 * The planter is advanced here for standing people, so call exactly once per rendered frame.
 */
export function solveRig(r: PersonRig, inp: RigInput, out: Float32Array, o: number): void {
  const dt = clamp(inp.dt, 0, 0.1)
  const d = r.dims
  const s = d.s
  // the skeleton's proportions: NOMINAL_BODY for the procedural crowd (every number as before), an avatar's own for a realistic person
  const B = d.b
  const standP = standPelvis(B)
  const look = r.look
  const posture = inp.posture
  const t = inp.time
  const seed = look.seed
  const mode = inp.mode

  // 1. style weights
  const happyT = inp.mood === 'happy' ? 1 : 0
  const slumpT = inp.mood === 'unwell' ? 1 : 0
  const seatedNow = posture === 'sit'
  const speakT = seatedNow ? 0.5 + 0.5 * noise1(t * 0.3, seed + 40) : mode === 'talk' ? 1 : 0.5
  r.happy = damp(r.happy, happyT, 4, dt)
  r.slump = damp(r.slump, slumpT, 4, dt)
  r.speaking = damp(r.speaking, speakT, 6, dt)
  // the driven body is given its true speed, which already moves smoothly: its pose follows it closely (the blends of an NPC lag it by 0.2 s)
  const follow = inp.driven ? 20 : 5
  r.run = damp(r.run, posture === 'stand' ? runBlend(inp.speed) : 0, follow, dt)
  if (r.run < 0.003) r.run = 0
  r.brisk = damp(r.brisk, posture === 'stand' ? briskBlend(inp.speed) : 0, follow, dt)
  if (r.brisk < 0.003) r.brisk = 0
  r.sit = damp(r.sit, seatedNow ? 1 : 0, 7, dt)
  r.lie = damp(r.lie, posture === 'lie' ? 1 : 0, 5, dt)
  if (r.sit < 0.002) r.sit = 0
  else if (r.sit > 0.998) r.sit = 1
  if (r.lie < 0.002) r.lie = 0
  else if (r.lie > 0.998) r.lie = 1
  const sb = r.sit
  const lb = r.lie

  // the held item: the hand lets go of the old one before it takes the new one
  if (inp.prop !== r.holdKind) {
    r.hold = damp(r.hold, 0, 9, dt)
    if (r.hold < 0.03) {
      r.hold = 0
      r.holdKind = inp.prop
    }
  } else r.hold = damp(r.hold, r.holdKind === PROP.none ? 0 : 1, 7, dt)
  if (r.hold > 0.995) r.hold = 1

  // 2. pose blend
  blendTo(r.blender, mode)
  advanceBlend(r.blender, dt)
  const wts = r.blender.weights
  const holdOk = wts[MODE_INDEX.relaxed] + wts[MODE_INDEX.talk] + wts[MODE_INDEX.sit] + wts[MODE_INDEX.sitTalk] + wts[MODE_INDEX.sitListen]

  // 3. feet
  const pl = r.planter
  if (posture === 'stand') updatePlanter(pl, dt, inp.x, inp.z, inp.heading, inp.vx, inp.vz, inp.speed, s, inp.driven ? inp : null)
  else resetPlanter(pl, inp.x, inp.z, inp.heading, s)
  const standing = posture === 'stand'
  const motion = standing ? clamp(inp.speed / 1.2, 0, 1) : 0
  // the arms and torso follow the feet: `gait` (the difference of the foot positions) as it always was, and for somebody going faster than a
  // stroll the smooth stride phase instead (`swing`), which does not stop while both feet are down
  const gait = standing ? pl.gait + (pl.swing - pl.gait) * r.brisk : 0

  const c = r.ctx
  c.t = t
  c.motion = motion
  c.run = standing ? r.run : 0
  c.brisk = standing ? r.brisk : 0
  c.size = s
  c.gait = gait
  c.speaking = r.speaking
  c.happy = r.happy
  c.slump = r.slump
  const up = r.up
  blendUpper(wts, c, up)

  // 4. pelvis and legs. The standing solve and the seated solve are both computed while the sit weight is between 0 and 1.
  const ch = Math.cos(inp.heading)
  const sh = Math.sin(inp.heading)
  // the driven body leans into its acceleration (along the facing) and rolls into a curve: forward for +a, back for braking, INTO the turn (a left
  // turn, +turnRate, rolls the trunk to the left: negative roll). Eased, so the spring's acceleration never shows as a twitch.
  let leanT = 0
  let rollT = 0
  if (inp.driven && standing) {
    leanT = clamp(LEAN.perAccel * (inp.ax * sh + inp.az * ch), -LEAN.back, LEAN.forward)
    rollT = clamp(-LEAN.rollPerSpeedTurn * inp.speed * inp.turnRate, -LEAN.rollMax, LEAN.rollMax)
  }
  r.lean = damp(r.lean, leanT, LEAN.follow, dt)
  r.roll = damp(r.roll, rollT, LEAN.follow, dt)
  const hop = up[U.hop]
  const ankleY = B.ankle * s
  const legLen = (B.thigh + B.shin) * s
  const hipHalf = B.hipHalf * s * (0.5 + 0.5 * d.w)
  const idleN = noise1(t * 0.35, seed + 30)
  const legFactor = LEG_RELAXED + (LIE_LEG - LEG_RELAXED) * lb
  const surface = Math.max(inp.seatHeight, 0)
  // a patient in a ward bed with the head raised: the torso turns about the waist joint (the skinning seams need it so), but the backrest turns about its
  // hinge, a little below the back, so at an angle phi the torso's back would sink into the slab by (liePelvis + hinge depth) * (1 - cos phi) more than it
  // does lying flat. The pelvis and everything above it ride up by that much along the torso's normal, i.e. by (that) / cos phi vertically, at most
  // LIE_RECLINE_LIFT_MAX: the pelvis moves forward in the upright body (the lying body's `up`), the feet stay planted and the legs slope up to the hips
  // under the blanket. The back stays in the slab, the legs on the mattress, and nothing tears (the whole upper body moves as one)
  let rideUp = 0
  if (lb > 0) {
    const phi = reclineAngle(r.ctx.recline) * wts[MODE_INDEX.lie]
    if (phi > 1e-4) rideUp = lb * Math.min(LIE_RECLINE_LIFT_MAX, ((B.liePelvis + (MATTRESS.top - BACKREST.hingeY)) * (1 - Math.cos(phi))) / Math.cos(phi))
  }
  r.lastLift = rideUp
  const ST = STANDING
  const SE = SEATED
  if (sb < 1) {
    const f0 = pl.feet[0]
    const f1 = pl.feet[1]
    // world -> root frame
    let dx = f0.x - inp.x
    let dz = f0.z - inp.z
    ST[AX0] = dx * ch - dz * sh
    ST[AZ0] = dx * sh + dz * ch
    dx = f1.x - inp.x
    dz = f1.z - inp.z
    ST[AX1] = dx * ch - dz * sh
    ST[AZ1] = dx * sh + dz * ch
    // a realistic body lying down: the feet go back by its own `lieFeet`, so its heels rest on the mattress (the procedural body has none)
    if (lb > 0 && B.lieFeet !== 0) {
      ST[AZ0] -= B.lieFeet * s * lb
      ST[AZ1] -= B.lieFeet * s * lb
    }
    ST[AY0] = ankleY + f0.lift + hop
    ST[AY1] = ankleY + f1.lift + hop
    ST[YAW0] = wrapPi(f0.yaw - inp.heading)
    ST[YAW1] = wrapPi(f1.yaw - inp.heading)
    ST[PITCH0] = f0.pitch
    ST[PITCH1] = f1.pitch
    const load = (pl.stance[0] - pl.stance[1]) / (pl.stance[0] + pl.stance[1] + 1e-3)
    const m = motion
    // a runner sways less over the planted foot and leans in from the pelvis a little
    const sway = 1 - 0.6 * r.run
    ST[PX] = 0.03 * s * m * load * sway + (1 - m) * 0.014 * s * idleN
    // a runner's hips sit a little behind the point the sim calls the body: the trailing leg is what reaches furthest (the foot is left 0.5 m behind at toe-off), the leading one lands near
    ST[PZ] = 0.01 * s * m - 0.04 * s * r.run + rideUp
    ST[PYAW] = -0.075 * m * gait + (1 - m) * 0.03 * noise1(t * 0.3, seed + 31)
    ST[PROLL] = 0.05 * m * load * sway + (1 - m) * 0.02 * noise1(t * 0.27, seed + 32) + r.roll
    ST[PPITCH] = 0.02 + 0.03 * m + 0.04 * r.run + r.lean * LEAN.pelvisShare
    // the pelvis is as high as the legs allow: the most stretched planted leg decides
    const lmax = LEG_MAX * legLen
    const cyw = Math.cos(ST[PYAW])
    const syw = Math.sin(ST[PYAW])
    const hx0 = ST[PX] + hipHalf * cyw
    const hz0 = ST[PZ] - hipHalf * syw
    const hx1 = ST[PX] - hipHalf * cyw
    const hz1 = ST[PZ] + hipHalf * syw
    const r0 = lmax * lmax - (ST[AX0] - hx0) * (ST[AX0] - hx0) - (ST[AZ0] - hz0) * (ST[AZ0] - hz0)
    const r1 = lmax * lmax - (ST[AX1] - hx1) * (ST[AX1] - hx1) - (ST[AZ1] - hz1) * (ST[AZ1] - hz1)
    const floorSq = 0.45 * lmax * (0.45 * lmax)
    const hy0 = ST[AY0] + Math.sqrt(Math.max(r0, floorSq))
    const hy1 = ST[AY1] + Math.sqrt(Math.max(r1, floorSq))
    const bounce = 0.02 * s * r.happy * m * (1 - Math.abs(gait))
    // going faster than a stroll the knees stay a little bent (a few cm lower, so the legs never have to be fully stretched to reach the next
    // step), a runner sits lower still and rises and sinks with the stride (`pl.bounce`, from the planter)
    const crouch = (0.045 * r.brisk * (1 - r.run) + 0.004 * r.run) * s - pl.bounce * s
    const relaxed = ankleY + legFactor * legLen + hop + bounce - crouch
    const hip = Math.min(smin(hy0, hy1, 0.03 * s), relaxed)
    ST[PY] = hip + B.hipDrop * s
  }
  if (sb > 0) {
    const lat = (0.115 + 0.035 * r.seatSpread) * s
    const fwd = (0.4 + 0.1 * r.seatForward) * s
    const backL = r.seatBack === 1 ? 0.14 * s : 0
    const backR = r.seatBack === -1 ? 0.14 * s : 0
    const rest = inp.footRest
    SE[AX0] = lat
    SE[AZ0] = fwd - backL
    SE[AX1] = -lat
    SE[AZ1] = fwd - backR
    SE[AY0] = ankleY + rest + (backL > 0 ? 0.01 : 0)
    SE[AY1] = ankleY + rest + (backR > 0 ? 0.01 : 0)
    SE[YAW0] = 0.1
    SE[YAW1] = -0.1
    SE[PITCH0] = backL > 0 ? -0.25 : 0
    SE[PITCH1] = backR > 0 ? -0.25 : 0
    SE[PX] = 0
    SE[PZ] = -0.02 * s
    SE[PYAW] = 0.02 * noise1(t * 0.3, seed + 31)
    SE[PROLL] = 0.015 * noise1(t * 0.27, seed + 32)
    SE[PPITCH] = -0.02
    SE[PY] = surface + B.seatedPelvis * s
  }
  const A = sb >= 1 ? SE : ST
  const mixk = sb <= 0 || sb >= 1 ? 0 : sb
  const pX = mixAt(A, PX, mixk)
  const pY = mixAt(A, PY, mixk)
  const pZ = mixAt(A, PZ, mixk)
  const pYaw = mixAt(A, PYAW, mixk)
  const pRoll = mixAt(A, PROLL, mixk)
  const pPitch = mixAt(A, PPITCH, mixk)
  const ax0 = mixAt(A, AX0, mixk)
  const az0 = mixAt(A, AZ0, mixk)
  const ay0 = mixAt(A, AY0, mixk)
  const yaw0 = mixAt(A, YAW0, mixk)
  const pitch0 = mixAt(A, PITCH0, mixk)
  const ax1 = mixAt(A, AX1, mixk)
  const az1 = mixAt(A, AZ1, mixk)
  const ay1 = mixAt(A, AY1, mixk)
  const yaw1 = mixAt(A, YAW1, mixk)
  const pitch1 = mixAt(A, PITCH1, mixk)
  // the pelvis height a relaxed upright body would have, for the reach targets (they follow the pelvis, not its bob)
  const pelvisRef = standP * s + (surface + B.seatedPelvis * s - standP * s) * sb

  const P_ = iP
  setRotYXZ(S, P_, pYaw, pPitch, pRoll)
  setTranslation(S, P_, pX, pY, pZ)

  // hips and the two legs
  const hipDrop = B.hipDrop * s
  transformPoint(S, P_, hipHalf, -hipDrop, 0, S, iHL)
  transformPoint(S, P_, -hipHalf, -hipDrop, 0, S, iHR)
  const thighL = B.thigh * s
  const shinL = B.shin * s
  solveLeg(LEG, 0, S[iHL], S[iHL + 1], S[iHL + 2], ax0, ay0, az0, Math.sin(yaw0 * 0.7), Math.cos(yaw0 * 0.7), thighL, shinL, legL)
  solveLeg(LEG, MAT * 2, S[iHR], S[iHR + 1], S[iHR + 2], ax1, ay1, az1, Math.sin(yaw1 * 0.7), Math.cos(yaw1 * 0.7), thighL, shinL, legR)

  // 5. chest, head
  const lyaw = lookYaw(r.headLook)
  const lpit = lookPitch(r.headLook)
  const cYaw = up[U.chestYaw] + 0.1 * motion * gait + 0.2 * lyaw
  const cPitch = up[U.chestPitch] + 0.025 * motion + r.lean * (1 - LEAN.pelvisShare)
  const cRoll = up[U.chestRoll] - 0.5 * pRoll
  setRotYXZ(S, iT1, cYaw, cPitch, cRoll)
  // C = P * T(0, waist) * R
  copy12(S, iC, S, P_)
  translateLocal(S, iC, 0, B.waist * s, B.waistZ * s)
  mul(S, iT2, S, iC, S, iT1)
  copy12(S, iC, S, iT2)

  const hYaw = up[U.headYaw] + 0.8 * lyaw - 0.5 * (cYaw + pYaw)
  const hPitch = up[U.headPitch] + lpit - 0.5 * (cPitch + pPitch)
  const hRoll = up[U.headRoll] - 0.5 * (cRoll + pRoll)
  copy12(S, iH, S, iC)
  translateLocal(S, iH, 0, B.neck * s, B.neckZ * s)
  setRotYXZ(S, iT1, hYaw, hPitch, hRoll)
  mul(S, iT2, S, iH, S, iT1)
  copy12(S, iH, S, iT2)

  // 6. arms: hand targets from the poses and from the held item, then the two-bone solve
  const shX = B.shoulderHalf * s * (0.5 + 0.5 * d.w)
  const shY = B.shoulderUp * s
  const shZ = B.shoulderZ * s
  const spec = HOLD[r.holdKind]
  if (spec && r.hold > 0.01 && holdOk > 0.01) {
    const k = smoothstep(0, 1, r.hold) * holdOk
    addReach(up, REACH_R, k, spec.r[0], spec.r[1], spec.r[2])
    if (spec.l) addReach(up, REACH_L, k, spec.l[0], spec.l[1], spec.l[2])
  }
  armReach(up, REACH_L, ARM_L, 1, shX, shY, shZ, s, pelvisRef, standP, B)
  armReach(up, REACH_R, ARM_R, -1, shX, shY, shZ, s, pelvisRef, standP, B)
  arm(+1, up, ARM_L, iSL, iEL, iWL, shX, shY, shZ, s, B)
  arm(-1, up, ARM_R, iSR, iER, iWR, shX, shY, shZ, s, B)

  // 7. the held item's frame, from the right hand (before any lying transform)
  const propKind = r.holdKind
  const propVis = smoothstep(0, 1, r.hold) * (1 - wts[MODE_INDEX.push]) * (1 - lb)
  const mopW = wts[MODE_INDEX.clean]
  if (mopW > 0.01) {
    // the mop follows the cleaning pose: its head on the floor ahead while the hands are on the pole
    mopPoints(t, seed, MOPPTS)
    const gx = S[iWR + 3] - 0.085 * s * S[iWR + 1]
    const gy = S[iWR + 7] - 0.085 * s * S[iWR + 5]
    const gz = S[iWR + 11] - 0.085 * s * S[iWR + 9]
    const hx = MOPPTS[6] * s
    const hz = MOPPTS[8] * s
    const bx = MOPPTS[9] * s
    const by = pelvisRef + (MOPPTS[10] - standP) * s
    const bz = MOPPTS[11] * s
    let ux = bx - hx
    let uy = by
    let uz = bz - hz
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1
    ux /= ul
    uy /= ul
    uz /= ul
    // mop frame: origin at the floor point (lerped to the hand while the pose blends in), local +Y up the pole
    const k = mopW
    let vx = ux * k
    let vy = uy * k + (1 - k)
    let vz = uz * k
    const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1
    vx /= vl
    vy /= vl
    vz /= vl
    // X axis = normalize(Y x Z0) with Z0 = (0, 0, 1)
    let xx = vy
    let xy = -vx
    let xz = 0
    const xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1
    xx /= xl
    xy /= xl
    xz /= xl
    // Z axis = X x Y
    const zx = xy * vz - xz * vy
    const zy = xz * vx - xx * vz
    const zz = xx * vy - xy * vx
    const sc = s * smoothstep(0, 0.6, mopW)
    const px = gx + (hx - gx) * k
    const py = gy + (0 - gy) * k
    const pz = gz + (hz - gz) * k
    S[iPR] = xx
    S[iPR + 1] = vx
    S[iPR + 2] = zx
    S[iPR + 3] = px
    S[iPR + 4] = xy
    S[iPR + 5] = vy
    S[iPR + 6] = zy
    S[iPR + 7] = py
    S[iPR + 8] = xz
    S[iPR + 9] = vz
    S[iPR + 10] = zz
    S[iPR + 11] = pz
    putPart(out, o, P.prop, S, iPR, sc, sc, sc)
    r.propDraw = PROP.mop
    r.propScale = sc
  } else if (spec && propVis > 0.02) {
    const gx = S[iWR + 3] - 0.085 * s * S[iWR + 1]
    const gy = S[iWR + 7] - 0.085 * s * S[iWR + 5]
    const gz = S[iWR + 11] - 0.085 * s * S[iWR + 9]
    // hanging items swing with the arm
    const swing = -spec.swing * (up[ARM_R] - 0.03)
    setRotYXZ(S, iPR, 0, spec.tilt + swing, 0)
    S[iPR + 3] = gx + spec.off[0] * s
    S[iPR + 7] = gy + spec.off[1] * s
    S[iPR + 11] = gz + spec.off[2] * s
    const sc = s * propVis
    putPart(out, o, P.prop, S, iPR, sc, sc, sc)
    r.propDraw = propKind
    r.propScale = sc
  } else {
    setZero(out, o + P.prop * MAT)
    r.propDraw = PROP.none
    r.propScale = 0
  }

  // 8. write the parts
  const ts = s * d.tl
  const tw = s * d.w
  putPart(out, o, P.pelvis, S, P_, tw, s, tw)
  putPart(out, o, P.chest, S, iC, tw, s, tw)
  putPart(out, o, P.head, S, iH, s, s, s)
  putPart(out, o, P.armL, S, iSL, ts, s, ts)
  putPart(out, o, P.foreL, S, iEL, ts, s, ts)
  putPart(out, o, P.handL, S, iWL, s, s, s)
  putPart(out, o, P.armR, S, iSR, ts, s, ts)
  putPart(out, o, P.foreR, S, iER, ts, s, ts)
  putPart(out, o, P.handR, S, iWR, s, s, s)
  putPart(out, o, P.thighL, LEG, 0, ts, s, ts)
  putPart(out, o, P.shinL, LEG, MAT, ts, s, ts)
  putPart(out, o, P.thighR, LEG, MAT * 2, ts, s, ts)
  putPart(out, o, P.shinR, LEG, MAT * 3, ts, s, ts)
  setFootMatrix(S, iT1, legL.ankleX, legL.ankleY, legL.ankleZ, yaw0, pitch0)
  putPart(out, o, P.footL, S, iT1, s, s, s)
  setFootMatrix(S, iT1, legR.ankleX, legR.ankleY, legR.ankleZ, yaw1, pitch1)
  putPart(out, o, P.footR, S, iT1, s, s, s)

  // the skirt piece (skirt, white coat or gown) hangs from the pelvis; seated it drapes forward over the lap. Going faster than a stroll it follows
  // the legs a little instead of hanging like a stiff dress: it tips with the thighs (and trails back at a run), opens front to back as the legs
  // stride, and rides up a little at a run. (The NPCs' stroll has none of it: `brisk` is 0 for them.)
  const ov = OVERLAY[look.overlay]
  if (ov[1] > 0) {
    let lenK = ov[1] + (ov[2] - ov[1]) * sb
    let pitch = 0.95 * sb
    let zk = 1
    const follow = r.brisk * (1 - sb) * (1 - lb)
    if (follow > 0.001) {
      // how far each thigh swings forward (+) or back (-) of the vertical
      const th0 = Math.atan2(legL.kneeZ - S[iHL + 2], S[iHL + 1] - legL.kneeY)
      const th1 = Math.atan2(legR.kneeZ - S[iHR + 2], S[iHR + 1] - legR.kneeY)
      const hi = th0 > th1 ? th0 : th1
      const lo = th0 > th1 ? th1 : th0
      pitch += follow * clamp(0.15 * (hi + lo) - 0.06 * r.run, -0.1, 0.1)
      zk += follow * 0.3 * clamp((hi - lo) / 1.1, 0, 1)
      lenK *= 1 - 0.08 * r.run * follow
    }
    if (pitch > 0.001 || pitch < -0.001) {
      copy12(S, iT1, S, P_)
      setRotYXZ(S, iT2, 0, pitch, 0)
      mul(S, iT3, S, iT1, S, iT2)
      putPart(out, o, P.skirt, S, iT3, tw * ov[0], s * lenK, tw * ov[0] * zk)
    } else putPart(out, o, P.skirt, S, P_, tw * ov[0], s * lenK, tw * ov[0])
  } else setZero(out, o + P.skirt * MAT)

  // hair rides on the head
  hairPiece(out, o, P.hairCap, HAIR_CAP[look.hairStyle], s)
  const back = HAIR_BACK[look.hairStyle]
  if (back) hairPiece(out, o, P.hairBack, back, s)
  else setZero(out, o + P.hairBack * MAT)
  const front = HAIR_FRONT[look.hairStyle]
  if (front) hairPiece(out, o, P.hairFront, front, s)
  else setZero(out, o + P.hairFront * MAT)

  // the face: where the eyes look (the head look-at leads with the eyes), the expression from the mood, the blink, the mouth while talking
  faceOf(r, t, seed, wts[MODE_INDEX.talk] + wts[MODE_INDEX.sitTalk])

  // 9. lying: tip the whole upright body flat about the pelvis, head towards the back of the heading, face up
  if (lb > 0) {
    const theta = -(Math.PI / 2) * lb
    const cT = Math.cos(theta)
    const sT = Math.sin(theta)
    const lieY = pY + (surface + B.liePelvis - pY) * lb
    // T = [R | t], R = Rx(theta), t = pivotLie - R * pivotUp
    S[iLT] = 1
    S[iLT + 1] = 0
    S[iLT + 2] = 0
    S[iLT + 3] = 0
    S[iLT + 4] = 0
    S[iLT + 5] = cT
    S[iLT + 6] = -sT
    S[iLT + 7] = lieY - cT * pY
    S[iLT + 8] = 0
    S[iLT + 9] = sT
    S[iLT + 10] = cT
    S[iLT + 11] = -sT * pY
    for (let part = 0; part < PART_COUNT; part++) {
      const b = o + part * MAT
      for (let i = 0; i < MAT; i++) S[iT2 + i] = out[b + i]
      mul(S, iT3, S, iLT, S, iT2)
      for (let i = 0; i < MAT; i++) out[b + i] = S[iT3 + i]
    }
  }
  r.lastLie = lb

  // the blanket of a patient in a bed: carried in the prop frame, set down in the lying body's own frame (x across the bed, y up, z head to feet) with its
  // origin on the mattress under the hips, after the body was laid flat (a lying patient holds nothing, so the frame is free). It rises with the lying
  // blend: flat on the mattress while the patient is still getting in, a covered body once lying
  if (inp.covered && lb > 0.02) {
    const rise = smoothstep(0, 1, lb)
    S[iPR] = 1
    S[iPR + 1] = 0
    S[iPR + 2] = 0
    S[iPR + 3] = 0
    S[iPR + 4] = 0
    S[iPR + 5] = 1
    S[iPR + 6] = 0
    S[iPR + 7] = surface
    S[iPR + 8] = 0
    S[iPR + 9] = 0
    S[iPR + 10] = 1
    S[iPR + 11] = 0
    putPart(out, o, P.prop, S, iPR, s, s * rise, s)
    r.propDraw = PROP.blanket
    r.propScale = s * rise
  }

  // guard against any NaN so one bad frame can never poison the planter
  if (!isFiniteMat(S, P_) || !isFiniteMat(S, iWL)) {
    resetPlanter(pl, inp.x, inp.z, inp.heading, s)
    for (let i = 0; i < PART_COUNT * MAT; i++) out[o + i] = 0
    r.propDraw = PROP.none
    r.propScale = 0
  }
}

const MOPPTS = new Float64Array(12)

function copy12(dst: Float64Array, d: number, src: Float64Array, s: number): void {
  for (let i = 0; i < MAT; i++) dst[d + i] = src[s + i]
}

/** Turn one hand's blended reach block into arm angles (in `up`, at the FK block `base`). */
const TGT = new Float64Array(3)
function armReach(up: Float32Array, reachBase: number, base: number, side: 1 | -1, shX: number, shY: number, shZ: number, s: number, pelvisRef: number, standP: number, B: Readonly<BodyDims>): void {
  const w = up[reachBase]
  if (!(w > 0.002)) return
  const k = w > 1 ? 1 : w
  // the blended, weight-premultiplied target -> a point in the root frame at this person's size
  const tx = (up[reachBase + 1] / w) * s
  const ty = pelvisRef + (up[reachBase + 2] / w - standP) * s
  const tz = (up[reachBase + 3] / w) * s
  // root frame -> chest frame: the chest matrix is at S[iC]
  const dx = tx - S[iC + 3]
  const dy = ty - S[iC + 7]
  const dz = tz - S[iC + 11]
  TGT[0] = S[iC] * dx + S[iC + 4] * dy + S[iC + 8] * dz
  TGT[1] = S[iC + 1] * dx + S[iC + 5] * dy + S[iC + 9] * dz
  TGT[2] = S[iC + 2] * dx + S[iC + 6] * dy + S[iC + 10] * dz
  solveArmReach(up, base, side, k, TGT[0], TGT[1], TGT[2], shX, shY, shZ, s, B)
}

/** One arm by forward kinematics from the chest matrix (in S at iC). `side` +1 = left. */
function arm(side: 1 | -1, up: Float32Array, a: number, iS: number, iE: number, iW: number, shX: number, shY: number, shZ: number, s: number, B: Readonly<BodyDims>): void {
  const pitch = up[a]
  const roll = up[a + 1]
  const twist = up[a + 2]
  const elbow = up[a + 3]
  const wrist = up[a + 4]
  const pron = up[a + 5]
  copy12(S, iS, S, iC)
  translateLocal(S, iS, side * shX, shY, shZ)
  setRotXZY(S, iT1, -pitch, side * roll, side * twist)
  mul(S, iT2, S, iS, S, iT1)
  copy12(S, iS, S, iT2)
  copy12(S, iE, S, iS)
  translateLocal(S, iE, 0, -B.upperArm * s, 0)
  setRotYXZ(S, iT1, 0, -elbow, 0)
  mul(S, iT2, S, iE, S, iT1)
  copy12(S, iE, S, iT2)
  copy12(S, iW, S, iE)
  translateLocal(S, iW, 0, -B.forearm * s, 0)
  setRotXZY(S, iT1, -wrist, 0, side * pron)
  mul(S, iT2, S, iW, S, iT1)
  copy12(S, iW, S, iT2)
}

function hairPiece(out: Float32Array, o: number, part: number, h: HairPiece, s: number): void {
  copy12(S, iT1, S, iH)
  translateLocal(S, iT1, h[3] * s, h[4] * s, h[5] * s)
  if (h[6] !== 0 || h[7] !== 0) {
    setRotYXZ(S, iT2, 0, h[6], h[7])
    mul(S, iT3, S, iT1, S, iT2)
    putPart(out, o, part, S, iT3, h[0] * s, h[1] * s, h[2] * s)
  } else putPart(out, o, part, S, iT1, h[0] * s, h[1] * s, h[2] * s)
}

/** Fill the rig's face for this frame. `talk` is the blend weight of the talking poses. */
function faceOf(r: PersonRig, t: number, seed: number, talk: number): void {
  const f = r.face
  const hl = r.headLook
  // the eyes lead the head (and cover what a neck cannot turn to), then settle on it; while nobody is looked at they wander a little, as eyes do
  const idle = 1 - hl.weight
  f.eyeYaw = hl.eyeYaw + idle * 0.22 * noise1(t * 0.7, seed + 90)
  f.eyePitch = hl.eyePitch + idle * 0.1 * noise1(t * 0.6, seed + 91)
  f.expression = expressionOf(r.happy, r.slump)
  f.blink = blinkAt(t, seed)
  f.mouthOpen = mouthOpenAt(t, seed, talk, r.speaking)
}

/**
 * Aim the head at a world point (call before `solveRig`; the result is used by that frame's solve).
 * `headY` is the head centre's height above the root.
 */
export function aimHead(r: PersonRig, dt: number, inp: RigInput, headY: number): void {
  if (!inp.hasLook) {
    // the driven body's head leads a turn: it looks at a point 3 m ahead along heading + 0.3 x the turn rate (at most 0.5 rad), the eyes first (look.ts),
    // and the chest follows a fifth of the way (solveRig). With nobody to look at and no turn, the head relaxes as it always did.
    if (inp.driven && inp.posture === 'stand' && Math.abs(inp.turnRate) > LEAN.headLeadFrom) {
      const lead = clamp(LEAN.headLead * inp.turnRate, -LEAN.headLeadMax, LEAN.headLeadMax)
      updateHeadLook(r.headLook, dt, lead - r.up[U.chestYaw], 0, true)
      return
    }
    updateHeadLook(r.headLook, dt, 0, 0, false)
    return
  }
  const dx = inp.lookX - inp.x
  const dz = inp.lookZ - inp.z
  const horiz = Math.sqrt(dx * dx + dz * dz)
  const yaw = wrapPi(Math.atan2(dx, dz) - inp.heading - r.up[U.chestYaw])
  const pitch = Math.atan2(inp.lookY - (inp.y + headY), Math.max(horiz, 0.01))
  updateHeadLook(r.headLook, dt, yaw, pitch, true)
}

export { LEG_LENGTH, MOP }
