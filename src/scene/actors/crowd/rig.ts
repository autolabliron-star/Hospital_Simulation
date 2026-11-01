// Ported from Waltz City (src/scene/actors/crowd/rig.ts). Kept: the layered solve, planted feet, pelvis, leg IK. New: lying, the seat/stand
// blend, hand-reach arm IK, held items and the prop frame. W1 (the player walks briskly and runs): `run` and `brisk` blends from the measured speed (a run pose
// for anybody going fast, whatever the sim called the animation), the arms follow a smooth stride phase, the pelvis crouches and bounces with the stride, and the coat follows the legs.
// W3 (the player's slot only, `RigInput.driven`): the feet are planned from the body's true velocity and intent (gait.ts), the run and brisk blends follow at once, the
// trunk leans into acceleration and rolls into curves, and the head leads turns. Every NPC takes the old paths, number for number.
// W3 wave B (realistic people): every length comes from the person's own skeleton (`Dims.b`: NOMINAL_BODY, which is BODY to the last bit, or a
// Rocketbox avatar's measured BodyDims), with its waist, neck and shoulder offsets front to back and its own seated and lying pelvis heights.
// R5 (step-by-step procedures): the procedure actions (surgicalPoses.ts) get the act's world work point, smoothed per hand (`actContext`), and its progress;
// the arm solve takes an elbow "wing"; a hand holding an aimed instrument turns its wrist to the work (`aimArm`: a closed-form pronation + wrist bend, the
// arm solved again for the wrist so the hand stays on its target); both hands' instrument frames follow the wrist (P.prop, P.propL: `instrumentFrame`,
// never mirrored); a procedure patient's breathing tube rides P.propL at the mouth; a sterile gown hangs a long skirt.
// R5 wave 2 (the OR table): a patient lying on the OR table with a `PatientPoseView` (RigInput.table*, tablePatient.ts) is laid at PELVIS_ON_TABLE[position], carried with the
// table's tilt and roll as one rigid body (step 9), the legs steered into the boots (lithotomy, step 4) and the arms tucked along the sides (step 6). Nobody else is touched.
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
import { BLEND_SECONDS, advanceBlend, blendTo, createBlender, MODE_INDEX, MODES, type Blender, type Mode, type Posture } from './blend'
import { briskBlend, createPlanter, resetPlanter, runBlend, updatePlanter, type Planter } from './gait'
import { createLegResult, setFootMatrix, solveLeg } from './ik'
import { createHeadLook, lookPitch, lookYaw, updateHeadLook, type HeadLook } from './look'
import { HAIR_BACK, HAIR_CAP, HAIR_FRONT, type HairPiece } from './hair'
import { FACE, blinkAt, expressionOf, faceZ, mouthOpenAt } from './face'
import { AIM_L, AIM_R, ARM_L, ARM_R, MOP, REACH_L, REACH_R, U, UP_COUNT, blendUpper, createPoseCtx, mopPoints, type PoseCtx } from './pose'
import { ACTION_DEFS, DEFAULT_WORK } from './surgicalPoses'
import { GRIP_AXIS, specOfKind, type ToolSpec } from './instrumentTable'
import { ATTIRE } from '@/sim/types'
import { BACKREST, MATTRESS } from '@/scene/rooms/bedParts'
import { reclineAngle } from '@/scene/rooms/bedPose'
import { BODY_LANDMARKS, LITHOTOMY_LEG, PELVIS_ON_TABLE } from '@/sim/procedure/body'
import { LITHO_POLE, TUCK_EXTEND, TUCK_PRON, TUCK_WING, createTableBody, footToShin, stepTableBody, tableRootInto, uprightOfLying, type TableBody } from './tablePatient'

export interface Dims {
  /** Overall size relative to the nominal body. */
  s: number
  /** Width factor of torso and pelvis. */
  w: number
  /** Thickness factor of the limbs (they follow the build, less than the torso does). */
  tl: number
  /** W3 wave B: the skeleton's proportions (NOMINAL_BODY, or the realistic avatar's own, see BodyDims in constants.ts). */
  b: Readonly<BodyDims>
  /**
   * R5: the middle of the mouth in the head part's own frame (nominal metres, origin the neck base): where a procedure patient's breathing tube comes out.
   * The procedural face's (PROCEDURAL_MOUTH), or an avatar's own, measured on its face (avatars.ts measureFaceFit, model.ts).
   */
  mouth: [number, number, number]
  /**
   * R5: the middle of the hand in the hand part's frame: how far towards the palm and how far down the hand (nominal metres). The procedural mitten's
   * (PROCEDURAL_GRIP: on its palm), or an avatar's own, measured on its mesh (avatars.ts measureHandGrip). An instrument's grip point is this plus its grip's.
   */
  grip: [number, number]
}

/** R5: the procedural mitten's grip middle: on its palm, half way down the hand (ACT_HANDS.palm, BODY.hand). */
export const PROCEDURAL_GRIP: readonly [number, number] = [0.02, 0.085]
/** R5: the procedural head's mouth (face.ts), head frame. */
export const PROCEDURAL_MOUTH: readonly [number, number, number] = [0, FACE.mouthY, faceZ(0, FACE.mouthY)]

/**
 * R5: the hands of a procedure action. The act's world point is smoothed per hand (critically damped at WORK_RATE per second, at most WORK_SPEED m/s), so a
 * new point (the tray, then the handover) is a hand moving there; the instrument a hand holds fades in and out over a few frames (INSTRUMENT_RATE); the hand
 * aim turns the wrist within these limits (radians): wrist bend [-1.0, 0.9], pronation [-1.6, 1.8].
 */
export const ACT_HANDS = { workRate: 10, workSpeed: 1.5, instrumentRate: 18, wrist: [-1.0, 0.9], pron: [-1.6, 1.8], strokeHz: [2, 3], palm: 0.02 } as const
/** R5: how long a change into, out of or between the procedure actions' poses takes (the others keep blend.ts BLEND_SECONDS). */
export const ACT_BLEND_SECONDS = 0.45

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
  // ---- R5 procedure actions
  /** The act's work point, smoothed per hand (nominal body frame): left x, y, z, its velocity, then the right's (12 floats). */
  work: Float64Array
  /** The smoothing has been seeded (from the hands) since the act came on. */
  workOn: boolean
  /** The middles of the hands at the end of the last solve (nominal body frame): left x, y, z, right x, y, z. */
  hands: Float64Array
  /** The act's progress last frame, and how fast it moves (per second, smoothed), and the sim clock's rate: what fades a stroke that runs too fast. */
  progPrev: number
  progRate: number
  simPrev: number
  simRate: number
  /** The instrument in each hand (an instrumentTable kind, 0 none), how far it is shown (0..1), and its moving part (0..1). */
  instL: number
  instR: number
  instVisL: number
  instVisR: number
  toolL: number
  toolR: number
  /** The patient's breathing tube is drawn in the left-hand frame (P.propL) this frame. */
  tube: boolean
  /** The last pronation the hand aim chose for each hand (left, right; NaN: none), so it keeps to one of its two solutions. */
  aimPron: Float64Array
  /** R5 wave 2: a patient on the OR table: the table's pose and matrix, and the lithotomy and tucked-arm followers (tablePatient.ts). Idle for everybody else. */
  tbl: TableBody
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
  /**
   * S1: how many times faster than real time the feet cycle (the sim at 2x to 4x: the legs keep up; 10x and 30x: capped, the feet slide). Absent = 1.
   * The planner is advanced by `dt * gaitRate`; the body's other blends keep the real `dt`.
   */
  gaitRate?: number
  /** World point to look at, or null. */
  hasLook: boolean
  lookX: number
  lookY: number
  lookZ: number
  // --- R5: the procedure action (Entity.act; the pose is `mode`, an action mode of blend.ts) ---
  /** An act is set (the person is at their step spot). */
  actOn: boolean
  /** Its progress 0..1 and the sim clock (seconds): what the strokes follow (surgicalPoses.ts). */
  actProg: number
  simT: number
  /** The world point the hands work at (drawn coordinates, like the look-at), if the act names one. */
  hasWork: boolean
  workX: number
  workY: number
  workZ: number
  /** The instrument in each hand (instrumentTable.ts kind; 0 none). */
  toolL: number
  toolR: number
  /** Sterile attire bits (ATTIRE in sim/types.ts): the gown hangs a long skirt, the gloves keep the hands clasped (the model picks the 'sterile' mode). */
  attire: number
  /** A procedure patient with a breathing tube in (PatientPoseView.airway 'tube'): drawn at the mouth in the left-hand frame. */
  tube: boolean
  // --- R5 wave 2: a patient lying on the OR table (seat `orTable:*`; every other lying person leaves these at their defaults and is solved exactly as before) ---
  /** Lying on the OR table. */
  tableSeat: boolean
  /** The entity carries a `PatientPoseView` (without one the legs and arms settle back to lying, then the table paths are off). */
  tablePose: boolean
  /** Where the pose puts the patient: legs in the boots (`position` 'lithotomy'; supine and the CT table's positions lie flat) and arms tucked (`arms` 'tucked'; the others lie as they do). */
  tableLith: boolean
  tableTuck: boolean
  /** The table top's tilt (head end up +) and roll (+ lifts the patient's right), degrees: the pose's `headTiltDeg` and `rollDeg`. */
  tableTilt: number
  tableRoll: number
  /** The drawn-frame offsets of the table's pivot (the level's: sim x shifted, floor height), as the scene passes to `tableMatrixInto`. */
  tableOffX: number
  tableOffY: number
  tableOffZ: number
  /** Place the followers at once: a warm start, or a Jump (the entity was replaced). */
  tableSnap: boolean
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
    dims: { s: look.scale, w: look.build, tl: 1 + (look.build - 1) * 0.6, b: body, mouth: [PROCEDURAL_MOUTH[0], PROCEDURAL_MOUTH[1], PROCEDURAL_MOUTH[2]], grip: [PROCEDURAL_GRIP[0], PROCEDURAL_GRIP[1]] },
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
    work: new Float64Array(12),
    workOn: false,
    hands: new Float64Array([0.2, 0.84, 0.07, -0.2, 0.84, 0.07]),
    progPrev: 0,
    progRate: 0,
    simPrev: 0,
    simRate: 0,
    instL: 0,
    instR: 0,
    instVisL: 0,
    instVisR: 0,
    toolL: 0,
    toolR: 0,
    tube: false,
    aimPron: new Float64Array([NaN, NaN]),
    tbl: createTableBody(),
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
    actOn: false,
    actProg: 0,
    simT: 0,
    hasWork: false,
    workX: 0,
    workY: 0,
    workZ: 0,
    toolL: 0,
    toolR: 0,
    attire: 0,
    tube: false,
    tableSeat: false,
    tablePose: false,
    tableLith: false,
    tableTuck: false,
    tableTilt: 0,
    tableRoll: 0,
    tableOffX: 0,
    tableOffY: 0,
    tableOffZ: 0,
    tableSnap: false,
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
/**
 * R5: a sterile gown's skirt to mid-calf (the procedural body's skirt piece in the gown colour; an avatar's gown skirt mesh, attire.ts, on the same frame).
 * Width, length (the skirt piece reaches 0.38 below the pelvis at 1: the gown 0.62), seated length.
 */
export const SURGICAL_GOWN_OVERLAY: readonly [number, number, number] = [1.12, 1.63, 0.8]

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
/** R5 wave 2: the table's transform in the root frame (tablePatient.ts tableRootInto). */
const iTR = MAT * 16
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

/** How far (nominal metres) a walker's hips may rise above their height at heel strike (see the pelvis in `solveRig`). */
const WALK_BOB = 0.05

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
function solveArmReach(up: Float32Array, base: number, side: 1 | -1, w: number, tx: number, ty: number, tz: number, shX: number, shY: number, shZ: number, s: number, B: Readonly<BodyDims>, wing = 0, handLen = B.hand): void {
  const L1 = B.upperArm * s
  // (R5: the hand aim solves for the wrist itself, `handLen` 0, once the wrist is turned)
  const L2 = (B.forearm + handLen) * s
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
  // the elbow bends down and out: the pole, made perpendicular to the shoulder-to-hand line. R5: `wing` 0..1 swings it out (a surgeon's elbows over the table)
  const wg = clamp(wing, 0, 1)
  let nx = side * (0.55 + 0.65 * wg)
  let ny = -1 + 0.55 * wg
  let nz = -0.25 + 0.15 * wg
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
  // R5 wave 2: a patient on the OR table (tablePatient.ts): the lithotomy and tucked-arm followers and the table's pose step; `tOn` says the table paths run
  const tb = r.tbl
  const tOn = stepTableBody(tb, inp, dt)

  // the held item: the hand lets go of the old one before it takes the new one
  if (inp.prop !== r.holdKind) {
    r.hold = damp(r.hold, 0, 9, dt)
    if (r.hold < 0.03) {
      r.hold = 0
      r.holdKind = inp.prop
    }
  } else r.hold = damp(r.hold, r.holdKind === PROP.none ? 0 : 1, 7, dt)
  if (r.hold > 0.995) r.hold = 1

  // 2. pose blend (R5: into, out of and between the procedure actions it takes ACT_BLEND_SECONDS: a hand crossing a table is not a flick)
  if (mode !== MODES[r.blender.target]) r.blender.duration = MODE_INDEX[mode] >= ACT_FIRST || r.blender.target >= ACT_FIRST ? ACT_BLEND_SECONDS : BLEND_SECONDS
  blendTo(r.blender, mode)
  advanceBlend(r.blender, dt)
  const wts = r.blender.weights
  const holdOk = wts[MODE_INDEX.relaxed] + wts[MODE_INDEX.talk] + wts[MODE_INDEX.sit] + wts[MODE_INDEX.sitTalk] + wts[MODE_INDEX.sitListen]

  // 3. feet
  const pl = r.planter
  if (posture === 'stand') updatePlanter(pl, inp.gaitRate === undefined ? dt : dt * inp.gaitRate, inp.x, inp.z, inp.heading, inp.vx, inp.vz, inp.speed, s, inp.driven ? inp : null)
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
  // W4: the person's own pelvis heights, so hand-reach poses (the seated arm-in at a cuff or robot tunnel) land on the world point
  c.standPelvis = standP
  c.seatedPelvis = B.seatedPelvis
  c.gait = gait
  c.speaking = r.speaking
  c.happy = r.happy
  c.slump = r.slump
  // R5: the procedure action's context (its progress, where the hands work, the stroke fade) before the modes are evaluated
  actContext(r, inp, dt, standP, (standP + (Math.max(inp.seatHeight, 0) / s + B.seatedPelvis - standP) * sb) * s)
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
    // (a patient under anaesthetic on the table does not drift sideways: the pelvis lies where the table puts it)
    if (tOn) ST[PX] = 0
    // a runner's hips sit a little behind the point the sim calls the body: the trailing leg is what reaches furthest (the foot is left 0.5 m behind at toe-off), the leading one lands near
    ST[PZ] = 0.01 * s * m - 0.04 * s * r.run + rideUp
    ST[PYAW] = -0.075 * m * gait + (1 - m) * 0.03 * noise1(t * 0.3, seed + 31)
    ST[PROLL] = 0.05 * m * load * sway + (1 - m) * 0.02 * noise1(t * 0.27, seed + 32) + r.roll
    ST[PPITCH] = 0.02 + 0.012 * m + 0.03 * r.run + r.lean * LEAN.pelvisShare
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
    // (a walker's knee is never locked at mid-stance either: about 15 degrees of bend, which is also what keeps the hips from bobbing more than 4-5 cm)
    const crouch = (0.015 * m * (1 - r.run) + 0.045 * r.brisk * (1 - r.run) + 0.004 * r.run) * s - pl.bounce * s
    let relaxed = ankleY + legFactor * legLen + hop + bounce - crouch
    // a walker's hips ride at most WALK_BOB above where the leading leg can reach at heel strike (the foot `sl` ahead), the knee a little bent at
    // mid-stance as people walk: a long stride then bobs the hips 3-4 cm (2026-10-26 walk), not 10 cm as a straight leg would lift them
    const slp = pl.params.sl
    const ds = ankleY + Math.sqrt(Math.max(lmax * lmax - slp * slp, floorSq)) + WALK_BOB * s + hop
    if (!inp.driven && ds < relaxed) relaxed -= (relaxed - ds) * m * (1 - r.run)
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

  // the lie transform (step 9) is known from here: tip the upright body flat about the pelvis, onto the surface. R5 wave 2: on the table the pelvis also slides toward the feet
  // (lithotomy), and the boots' ankles and the tucked wrists, given on the table, are undone through it into this upright frame
  const lieTheta = -(Math.PI / 2) * lb
  const lieC = Math.cos(lieTheta)
  const lieS = Math.sin(lieTheta)
  const lieY = pY + (surface + B.liePelvis - pY) * lb
  const lieSlide = tOn ? PELVIS_ON_TABLE.lithotomy * tb.st[0] * lb : 0

  // hips and the two legs
  const hipDrop = B.hipDrop * s
  transformPoint(S, P_, hipHalf, -hipDrop, 0, S, iHL)
  transformPoint(S, P_, -hipHalf, -hipDrop, 0, S, iHR)
  const thighL = B.thigh * s
  const shinL = B.shin * s
  // R5 wave 2: lithotomy. Each ankle goes to the boot (LITHOTOMY_LEG.ankle, mirrored), the knee to the side and up (LITHO_POLE): by `kL`, from where the lying legs were
  let lax = ax0
  let lay = ay0
  let laz = az0
  let rax = ax1
  let ray = ay1
  let raz = az1
  let plx = Math.sin(yaw0 * 0.7)
  let plz = Math.cos(yaw0 * 0.7)
  let prx = Math.sin(yaw1 * 0.7)
  let prz = Math.cos(yaw1 * 0.7)
  const kL = tOn ? tb.st[0] * lb : 0
  if (kL > 0.0005) {
    const ank = LITHOTOMY_LEG.ankle
    // (the boot is `ank.d` from the pelvis wherever the pelvis is on its way down the table: at the end that is the boot's own place, and on the way the leg is never
    // asked for more than it has, which would make the knee snap straight)
    uprightOfLying(Q3, 0, ank.x, surface + ank.h, lieSlide + ank.d, lieC, lieS, lieY, lieSlide, pY)
    lax = ax0 + (Q3[0] - ax0) * kL
    lay = ay0 + (Q3[1] - ay0) * kL
    laz = az0 + (Q3[2] - az0) * kL
    rax = ax1 + (-Q3[0] - ax1) * kL
    ray = ay1 + (Q3[1] - ay1) * kL
    raz = az1 + (Q3[2] - az1) * kL
    plx += (LITHO_POLE.x - plx) * kL
    plz += (LITHO_POLE.up - plz) * kL
    prx += (-LITHO_POLE.x - prx) * kL
    prz += (LITHO_POLE.up - prz) * kL
  }
  solveLeg(LEG, 0, S[iHL], S[iHL + 1], S[iHL + 2], lax, lay, laz, plx, plz, thighL, shinL, legL)
  solveLeg(LEG, MAT * 2, S[iHR], S[iHR + 1], S[iHR + 2], rax, ray, raz, prx, prz, thighL, shinL, legR)

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
  // R5 wave 2: a patient's arms tucked along the sides (the wrists at BODY_LANDMARKS.wristTucked), by how far they are tucked and how much of the pose is the lying one
  const kT = tOn ? tb.st[2] * lb * wts[MODE_INDEX.lie] : 0
  if (kT > 0.002) tuckArms(up, kT, shX, shY, shZ, s, B, surface, lieY, pY, lieC, lieS)
  arm(+1, up, ARM_L, iSL, iEL, iWL, shX, shY, shZ, s, B)
  arm(-1, up, ARM_R, iSR, iER, iWR, shX, shY, shZ, s, B)
  // R5: the instruments in the hands (which, how far shown, the moving part) and the hand aim: the wrist turns the tool's tip to the work
  const actW = actWeight(wts)
  updateInstruments(r, inp, dt, actW, up)
  if (r.instL > 0) aimArm(r, up, 1, shX, shY, shZ, s, pelvisRef, standP, B)
  if (r.instR > 0) aimArm(r, up, -1, shX, shY, shZ, s, pelvisRef, standP, B)

  // 7. the held item's frame, from the right hand (before any lying transform). R5: an instrument in the right hand takes the frame (the instruments mesh
  // draws it, oriented by the wrist); the left hand's instrument, or a procedure patient's breathing tube, takes P.propL
  const propKind = r.holdKind
  const propVis = smoothstep(0, 1, r.hold) * (1 - wts[MODE_INDEX.push]) * (1 - lb)
  const mopW = wts[MODE_INDEX.clean]
  r.tube = false
  if (r.instL > 0 && r.instVisL > 0.01) instrumentFrame(out, o, P.propL, iWL, 1, r.instL, r.instVisL, up, AIM_L, s, pelvisRef, standP, d.grip)
  else if (inp.tube && lb > 0.5) {
    tubeFrame(out, o, d.mouth, s)
    r.tube = true
  } else setZero(out, o + P.propL * MAT)
  if (r.instR > 0 && r.instVisR > 0.01) {
    instrumentFrame(out, o, P.prop, iWR, -1, r.instR, r.instVisR, up, AIM_R, s, pelvisRef, standP, d.grip)
    r.propDraw = PROP.none
    r.propScale = 0
  } else if (mopW > 0.01) {
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
  if (kL > 0.0005) footToShin(S, iT1, LEG, MAT, kL)
  putPart(out, o, P.footL, S, iT1, s, s, s)
  setFootMatrix(S, iT1, legR.ankleX, legR.ankleY, legR.ankleZ, yaw1, pitch1)
  if (kL > 0.0005) footToShin(S, iT1, LEG, MAT * 3, kL)
  putPart(out, o, P.footR, S, iT1, s, s, s)

  // the skirt piece (skirt, white coat or gown) hangs from the pelvis; seated it drapes forward over the lap. Going faster than a stroll it follows
  // the legs a little instead of hanging like a stiff dress: it tips with the thighs (and trails back at a run), opens front to back as the legs
  // stride, and rides up a little at a run. (The NPCs' stroll has none of it: `brisk` is 0 for them.)
  const ov = (inp.attire & ATTIRE.gown) !== 0 ? SURGICAL_GOWN_OVERLAY : OVERLAY[look.overlay]
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

  // R5: where the hands ended up (nominal body frame), the seed of the next act's smoothing
  handMiddle(r.hands, 0, iWL, s, B, pelvisRef, standP)
  handMiddle(r.hands, 3, iWR, s, B, pelvisRef, standP)

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
    const cT = lieC
    const sT = lieS
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
    S[iLT + 11] = -sT * pY + lieSlide
    // R5 wave 2: a patient on the table is carried by the table's own transform, the whole laid-flat body as one (the pelvis, the legs in the boots, the arms, the head)
    if (tOn) {
      tableRootInto(tb, inp.x, inp.y, inp.z, inp.heading, inp.tableOffX, inp.tableOffY, inp.tableOffZ, S, iTR)
      mul(S, iT3, S, iTR, S, iLT)
      copy12(S, iLT, S, iT3)
    }
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
/** R5 wave 2: a point of the table's frame carried into the upright frame (tablePatient.ts uprightOfLying). */
const Q3 = new Float64Array(6)
function armReach(up: Float32Array, reachBase: number, base: number, side: 1 | -1, shX: number, shY: number, shZ: number, s: number, pelvisRef: number, standP: number, B: Readonly<BodyDims>, ox = 0, oy = 0, oz = 0, handLen = B.hand): void {
  const wing = up[side === 1 ? U.lWing : U.rWing]
  const w = up[reachBase]
  if (!(w > 0.002)) return
  const k = w > 1 ? 1 : w
  // the blended, weight-premultiplied target -> a point in the root frame at this person's size
  // (R5: plus an offset, root frame: the hand aim's second pass aims the arm past the target by the error a turned wrist made)
  const tx = (up[reachBase + 1] / w) * s + ox
  const ty = pelvisRef + (up[reachBase + 2] / w - standP) * s + oy
  const tz = (up[reachBase + 3] / w) * s + oz
  armReachAt(up, base, side, k, tx, ty, tz, shX, shY, shZ, s, B, wing, handLen)
}

/** The two-bone arm solve for a target given as a root-frame point (metres, this person's size), mixed into the angles at `base` by `k`. */
function armReachAt(up: Float32Array, base: number, side: 1 | -1, k: number, tx: number, ty: number, tz: number, shX: number, shY: number, shZ: number, s: number, B: Readonly<BodyDims>, wing: number, handLen: number): void {
  // root frame -> chest frame: the chest matrix is at S[iC]
  const dx = tx - S[iC + 3]
  const dy = ty - S[iC + 7]
  const dz = tz - S[iC + 11]
  TGT[0] = S[iC] * dx + S[iC + 4] * dy + S[iC + 8] * dz
  TGT[1] = S[iC + 1] * dx + S[iC + 5] * dy + S[iC + 9] * dz
  TGT[2] = S[iC + 2] * dx + S[iC + 6] * dy + S[iC + 10] * dz
  solveArmReach(up, base, side, k, TGT[0], TGT[1], TGT[2], shX, shY, shZ, s, B, wing, handLen)
}

/**
 * R5 wave 2: a patient's arms tucked along the sides: each WRIST goes to `BODY_LANDMARKS.wristTucked` (mirrored; given on the table with the body, so the pelvis's
 * slide cancels), solved in the upright frame through the lie transform (`lieC`, `lieS`, `lieY`, `pY`), the elbow winged out to the side (it falls over the pad's edge
 * rather than into the pad), the palm in. `k` is how far the arms are tucked: the angles of the lying pose are mixed toward the solve by it.
 */
function tuckArms(up: Float32Array, k: number, shX: number, shY: number, shZ: number, s: number, B: Readonly<BodyDims>, surface: number, lieY: number, pY: number, lieC: number, lieS: number): void {
  const w = BODY_LANDMARKS.wristTucked
  for (let a = 0; a < 2; a++) {
    const side: 1 | -1 = a === 0 ? 1 : -1
    const base = side === 1 ? ARM_L : ARM_R
    uprightOfLying(Q3, 0, side * w.x, surface + w.h, w.d, lieC, lieS, lieY, 0, pY)
    // the wrist is moved away from the shoulder by up to TUCK_EXTEND, as far as the arm reaches, so the elbow does not bow out
    transformPoint(S, iC, side * shX, shY, shZ, Q3, 3)
    const vx = Q3[0] - Q3[3]
    const vy = Q3[1] - Q3[4]
    const vz = Q3[2] - Q3[5]
    const dist = Math.sqrt(vx * vx + vy * vy + vz * vz)
    const reach = (B.upperArm + B.forearm) * s * 0.995
    if (dist > 1e-6 && dist < reach) {
      const e = Math.min(reach, dist + TUCK_EXTEND) / dist
      Q3[0] = Q3[3] + vx * e
      Q3[1] = Q3[4] + vy * e
      Q3[2] = Q3[5] + vz * e
    }
    armReachAt(up, base, side, k, Q3[0], Q3[1], Q3[2], shX, shY, shZ, s, B, TUCK_WING, 0)
    up[base + 5] += (TUCK_PRON - up[base + 5]) * k
  }
}

// ---------------------------------------------------------------------------------------------
// R5: the procedure actions (surgicalPoses.ts): the work point, the stroke fade, the instruments, the hand aim. Allocation-free (module scratch).
// ---------------------------------------------------------------------------------------------

/** The first action mode (blend.ts: 'sterile' and every mode after it). */
const ACT_FIRST = MODE_INDEX.sterile
const T3 = new Float64Array(3)
const G3 = new Float64Array(3)

/** The blend weight of the action modes (the sterile rest included). */
function actWeight(wts: Float32Array): number {
  let w = 0
  for (let i = ACT_FIRST; i < wts.length; i++) w += wts[i]
  return w
}

/**
 * The context the action modes read (pose.ts PoseCtx): the act's progress and the sim clock, how fast the strokes would run (they fade above 2 a second),
 * and the work point in the nominal body frame, smoothed per hand (critically damped, at most ACT_HANDS.workSpeed). When the act comes on, the smoothing
 * starts from where the hands are, so the hands are seen to move to the work.
 */
function actContext(r: PersonRig, inp: RigInput, dt: number, standP: number, pelvisRef: number): void {
  const c = r.ctx
  const s = r.dims.s
  const B = r.dims.b
  c.hasLook = inp.hasLook
  c.shoulderY = standP + B.waist + B.shoulderUp
  c.simT = inp.simT
  if (!inp.actOn) {
    r.workOn = false
    r.progRate = 0
    r.simRate = 0
    r.progPrev = 0
    r.simPrev = inp.simT
    c.prog = 0
    c.strokeGain = 1
    return
  }
  const prog = clamp(inp.actProg, 0, 1)
  if (dt > 1e-5 && r.workOn) {
    const dp = prog - r.progPrev
    // (a new step starts over at 0: that is not a rate)
    if (dp >= 0 && dp < 0.5) r.progRate = damp(r.progRate, dp / dt, 4, dt)
    const ds = inp.simT - r.simPrev
    if (ds >= 0 && ds < 60) r.simRate = damp(r.simRate, ds / dt, 4, dt)
  }
  r.progPrev = prog
  r.simPrev = inp.simT
  c.prog = prog
  c.modeProg[r.blender.target] = prog
  const def = ACTION_DEFS[MODES[r.blender.target]]
  const hz = def ? (def.hz > 0 ? r.simRate * def.hz : r.progRate * def.reps) : 0
  c.strokeGain = 1 - smoothstep(ACT_HANDS.strokeHz[0], ACT_HANDS.strokeHz[1], hz)
  // the work point in the nominal body frame (the rig turns a nominal point back into this person's world point: armReach)
  let nx = DEFAULT_WORK[0]
  let ny = DEFAULT_WORK[1]
  let nz = DEFAULT_WORK[2]
  if (inp.hasWork) {
    const ch = Math.cos(inp.heading)
    const sh = Math.sin(inp.heading)
    const dx = inp.workX - inp.x
    const dz = inp.workZ - inp.z
    nx = (dx * ch - dz * sh) / s
    nz = (dx * sh + dz * ch) / s
    ny = (inp.workY - inp.y - pelvisRef) / s + standP
  }
  const W = r.work
  if (!r.workOn) {
    for (let i = 0; i < 3; i++) {
      W[i] = r.hands[i]
      W[3 + i] = 0
      W[6 + i] = r.hands[3 + i]
      W[9 + i] = 0
    }
    r.workOn = true
  }
  springTo(W, 0, nx, ny, nz, dt, s)
  springTo(W, 6, nx, ny, nz, dt, s)
  for (let i = 0; i < 3; i++) {
    c.tL[i] = W[i]
    c.tR[i] = W[6 + i]
  }
}

/** One hand's smoothed work point (W[i..i+2], its velocity at i+3..i+5) one critically damped step towards (tx, ty, tz), no faster than WORK_SPEED. */
function springTo(W: Float64Array, i: number, tx: number, ty: number, tz: number, dt: number, s: number): void {
  if (!(dt > 0)) return
  const w = ACT_HANDS.workRate
  const e = Math.exp(-w * dt)
  T3[0] = tx
  T3[1] = ty
  T3[2] = tz
  let mv = 0
  for (let a = 0; a < 3; a++) {
    const x0 = W[i + a] - T3[a]
    const v0 = W[i + 3 + a]
    const tmp = (v0 + w * x0) * dt
    const x1 = T3[a] + (x0 + tmp) * e
    G3[a] = x1 - W[i + a]
    mv += G3[a] * G3[a]
    W[i + 3 + a] = (v0 - w * tmp) * e
  }
  // at most WORK_SPEED (world metres a second, nominal here)
  const step = Math.sqrt(mv)
  const max = (ACT_HANDS.workSpeed / s) * dt
  const k = step > max ? max / step : 1
  for (let a = 0; a < 3; a++) {
    W[i + a] += G3[a] * k
    if (k < 1) W[i + 3 + a] = (G3[a] * k) / dt
  }
}

/** Which instrument each hand shows and how far (a new one comes in once the old one is gone), and its moving part (from the pose: pose.ts U.lTool). */
function updateInstruments(r: PersonRig, inp: RigInput, dt: number, actW: number, up: Float32Array): void {
  const rate = ACT_HANDS.instrumentRate
  const wantL = actW > 0.3 ? inp.toolL : 0
  const wantR = actW > 0.3 ? inp.toolR : 0
  if (r.instL !== wantL) {
    r.instVisL = r.instL === 0 ? 0 : damp(r.instVisL, 0, rate, dt)
    if (r.instVisL < 0.05) {
      r.instL = wantL
      r.instVisL = 0
    }
  } else if (r.instL !== 0) r.instVisL = r.instVisL > 0.995 ? 1 : damp(r.instVisL, 1, rate, dt)
  if (r.instR !== wantR) {
    r.instVisR = r.instR === 0 ? 0 : damp(r.instVisR, 0, rate, dt)
    if (r.instVisR < 0.05) {
      r.instR = wantR
      r.instVisR = 0
    }
  } else if (r.instR !== 0) r.instVisR = r.instVisR > 0.995 ? 1 : damp(r.instVisR, 1, rate, dt)
  r.toolL = actW > 0.01 ? clamp(up[U.lTool] / actW, 0, 1) : 0
  r.toolR = actW > 0.01 ? clamp(up[U.rTool] / actW, 0, 1) : 0
}

/** The grip point of `spec` in the hand whose wrist matrix is S[iW] (root frame, metres) into G3: the hand's middle (Dims.grip) plus the grip's offset. */
function gripPoint(iW: number, side: 1 | -1, spec: ToolSpec, s: number, grip: readonly number[]): void {
  const gx = -side * (grip[0] * s + spec.offset[0])
  const gy = -grip[1] * s + spec.offset[1]
  const gz = spec.offset[2]
  transformPoint(S, iW, gx, gy, gz, G3)
}

/** The aim point of a hand's pose (root frame, metres) into T3; false when there is none. */
function aimPoint(up: Float32Array, aimBase: number, s: number, pelvisRef: number, standP: number): boolean {
  const aw = up[aimBase]
  if (!(aw > 0.01)) return false
  T3[0] = (up[aimBase + 1] / aw) * s
  T3[1] = pelvisRef + (up[aimBase + 2] / aw - standP) * s
  T3[2] = (up[aimBase + 3] / aw) * s
  return true
}

/**
 * The closed-form hand aim (2 degrees of freedom): the pronation about the forearm and the wrist's bend that turn the grip's tip axis (GRIP_AXIS, in the
 * hand) towards the pose's aim point, within ACT_HANDS' limits, mixed in by the aim's weight; then the wrist matrix is rebuilt (only it changes).
 */
function aimHand(up: Float32Array, armBase: number, aimBase: number, side: 1 | -1, iE: number, iW: number, kind: number, vis: number, s: number, pelvisRef: number, standP: number, B: Readonly<BodyDims>, last: Float64Array, li: number): boolean {
  const spec = specOfKind(kind)
  if (!spec || !spec.aim || vis < 0.01) return false
  const aw = up[aimBase]
  if (!aimPoint(up, aimBase, s, pelvisRef, standP)) return false
  // (from the middle of the hand: steadier than from the grip point, which can sit right on the aim point: a mask on the face)
  const h = B.hand * s
  G3[0] = S[iW + 3] - h * S[iW + 1]
  G3[1] = S[iW + 7] - h * S[iW + 5]
  G3[2] = S[iW + 11] - h * S[iW + 9]
  let vx = T3[0] - G3[0]
  let vy = T3[1] - G3[1]
  let vz = T3[2] - G3[2]
  const len = Math.sqrt(vx * vx + vy * vy + vz * vz)
  if (len < 0.03) return false
  vx /= len
  vy /= len
  vz /= len
  // into the forearm's frame (its rotation is orthonormal: the transpose is the inverse)
  const lx = S[iE] * vx + S[iE + 4] * vy + S[iE + 8] * vz
  const ly = S[iE + 1] * vx + S[iE + 5] * vy + S[iE + 9] * vz
  const lz = S[iE + 2] * vx + S[iE + 6] * vy + S[iE + 10] * vz
  const g = GRIP_AXIS[spec.grip]
  const axx = -side * g[0]
  const ay = g[1]
  const az = g[2]
  // Ry(b) a must have x = lx: R cos(b - phi) = lx
  const R = Math.sqrt(axx * axx + az * az)
  const phi = Math.atan2(az, axx)
  const delta = R > 1e-6 ? Math.acos(clamp(lx / R, -1, 1)) : 0
  // the solution nearest the last frame's (no flips), else the pose's own pronation
  const poseP = Number.isFinite(last[li]) ? last[li] : up[armBase + 5]
  let best = 0
  let bestCost = Infinity
  for (let k = 0; k < 2; k++) {
    const b = phi + (k === 0 ? delta : -delta)
    const p = wrapPi(side * b)
    const over = Math.max(0, ACT_HANDS.pron[0] - p) + Math.max(0, p - ACT_HANDS.pron[1])
    const cost = Math.abs(p - poseP) + 4 * over
    if (cost < bestCost) {
      bestCost = cost
      best = b
    }
  }
  const cb = Math.cos(best)
  const sb = Math.sin(best)
  const uy = ay
  const uz = -axx * sb + az * cb
  const theta = wrapPi(Math.atan2(lz, ly) - Math.atan2(uz, uy))
  const wrist = clamp(-theta, ACT_HANDS.wrist[0], ACT_HANDS.wrist[1])
  const aimed = wrapPi(side * best)
  last[li] = aimed
  // plus the turn the pose's stroke gives the hand (a suture throw, a trocar's twist)
  const pron = clamp(aimed + up[side === 1 ? U.lSpin : U.rSpin], ACT_HANDS.pron[0], ACT_HANDS.pron[1])
  // mixed in by the aim's weight and the instrument's visibility (it fades in and out with the instrument)
  const k = clamp(aw, 0, 1) * smoothstep(0, 1, vis)
  up[armBase + 4] += (wrist - up[armBase + 4]) * k
  up[armBase + 5] += (pron - up[armBase + 5]) * k
  // rebuild the wrist only
  copy12(S, iW, S, iE)
  translateLocal(S, iW, 0, -B.forearm * s, 0)
  setRotXZY(S, iT1, -up[armBase + 4], 0, side * up[armBase + 5])
  mul(S, iT2, S, iW, S, iT1)
  copy12(S, iW, S, iT2)
  return true
}

/**
 * The hand aim of one arm, with the hand kept on its target: the turned wrist moves the hand's middle off it, so the arm is solved again for the WRIST, at
 * the target less the turned hand, and the wrist turned again, up to AIM_PASSES times. `r.aimPron` keeps each hand's last pronation, so the aim does not
 * flip between its two solutions.
 */
const AIM_PASSES = 3
function aimArm(r: PersonRig, up: Float32Array, side: 1 | -1, shX: number, shY: number, shZ: number, s: number, pelvisRef: number, standP: number, B: Readonly<BodyDims>): void {
  const L = side === 1
  const armBase = L ? ARM_L : ARM_R
  const aimBase = L ? AIM_L : AIM_R
  const reachBase = L ? REACH_L : REACH_R
  const iS = L ? iSL : iSR
  const iE = L ? iEL : iER
  const iW = L ? iWL : iWR
  const kind = L ? r.instL : r.instR
  const vis = L ? r.instVisL : r.instVisR
  const pi = L ? 0 : 1
  if (!aimHand(up, armBase, aimBase, side, iE, iW, kind, vis, s, pelvisRef, standP, B, r.aimPron, pi)) {
    r.aimPron[pi] = NaN
    return
  }
  const h = B.hand * s
  for (let pass = 0; pass < AIM_PASSES && reachError(up, reachBase, iW, s, pelvisRef, standP, B); pass++) {
    // the wrist goes to the target less the hand as it is turned now (the middle is the wrist + h down the hand's -Y)
    armReach(up, reachBase, armBase, side, shX, shY, shZ, s, pelvisRef, standP, B, h * S[iW + 1], h * S[iW + 5], h * S[iW + 9], 0)
    arm(side, up, armBase, iS, iE, iW, shX, shY, shZ, s, B)
    aimHand(up, armBase, aimBase, side, iE, iW, kind, vis, s, pelvisRef, standP, B, r.aimPron, pi)
  }
}

/**
 * How far the middle of the hand (wrist matrix S[iW]) is from the pose's reach target, root frame, into G3; true when it is worth another solve (more than
 * 4 mm off and the reach at full weight). Used after the hand aim turned the wrist (the two-bone solve takes the hand straight along the forearm).
 */
function reachError(up: Float32Array, reachBase: number, iW: number, s: number, pelvisRef: number, standP: number, B: Readonly<BodyDims>): boolean {
  const w = up[reachBase]
  if (!(w > 0.5)) return false
  const h = B.hand * s
  G3[0] = (up[reachBase + 1] / w) * s - (S[iW + 3] - h * S[iW + 1])
  G3[1] = pelvisRef + (up[reachBase + 2] / w - standP) * s - (S[iW + 7] - h * S[iW + 5])
  G3[2] = (up[reachBase + 3] / w) * s - (S[iW + 11] - h * S[iW + 9])
  return G3[0] * G3[0] + G3[1] * G3[1] + G3[2] * G3[2] > 0.004 * 0.004
}

/**
 * The frame of the instrument in a hand, from the wrist: origin at the grip point, -Y along the tip axis (to the pose's aim point when the tool aims, the
 * grip's own axis otherwise), +Z towards the thumb (a mask's bag towards its holder). Built by cross products: always right handed, never mirrored.
 * Instruments are real size (not scaled with the person); `vis` shrinks one in and out.
 */
function instrumentFrame(out: Float32Array, o: number, part: number, iW: number, side: 1 | -1, kind: number, vis: number, up: Float32Array, aimBase: number, s: number, pelvisRef: number, standP: number, grip: readonly number[]): void {
  const spec = specOfKind(kind)
  if (!spec) {
    setZero(out, o + part * MAT)
    return
  }
  gripPoint(iW, side, spec, s, grip)
  // the grip's own axis, in the root frame
  const g = GRIP_AXIS[spec.grip]
  const ax = -side * g[0]
  let tx = S[iW] * ax + S[iW + 1] * g[1] + S[iW + 2] * g[2]
  let ty = S[iW + 4] * ax + S[iW + 5] * g[1] + S[iW + 6] * g[2]
  let tz = S[iW + 8] * ax + S[iW + 9] * g[1] + S[iW + 10] * g[2]
  if (spec.aim) {
    const aw = up[aimBase]
    if (aimPoint(up, aimBase, s, pelvisRef, standP)) {
      let vx = T3[0] - G3[0]
      let vy = T3[1] - G3[1]
      let vz = T3[2] - G3[2]
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz)
      if (len > 0.008) {
        const k = clamp(aw, 0, 1)
        vx /= len
        vy /= len
        vz /= len
        tx += (vx - tx) * k
        ty += (vy - ty) * k
        tz += (vz - tz) * k
      }
    }
  }
  let tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
  // Y = -tip
  const yx = -tx / tl
  const yy = -ty / tl
  const yz = -tz / tl
  // Z: the thumb (a mask's: towards its holder), across Y
  let zx = spec.grip === 'mask' ? 0 : S[iW + 2]
  let zy = spec.grip === 'mask' ? 0 : S[iW + 6]
  let zz = spec.grip === 'mask' ? -1 : S[iW + 10]
  let dot = zx * yx + zy * yy + zz * yz
  zx -= dot * yx
  zy -= dot * yy
  zz -= dot * yz
  tl = Math.sqrt(zx * zx + zy * zy + zz * zz)
  if (tl < 1e-3) {
    // the thumb along the tip: take the hand's X instead
    zx = S[iW]
    zy = S[iW + 4]
    zz = S[iW + 8]
    dot = zx * yx + zy * yy + zz * yz
    zx -= dot * yx
    zy -= dot * yy
    zz -= dot * yz
    tl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1
  }
  zx /= tl
  zy /= tl
  zz /= tl
  // X = Y x Z
  const xx = yy * zz - yz * zy
  const xy = yz * zx - yx * zz
  const xz = yx * zy - yy * zx
  S[iPR] = xx
  S[iPR + 1] = yx
  S[iPR + 2] = zx
  S[iPR + 3] = G3[0]
  S[iPR + 4] = xy
  S[iPR + 5] = yy
  S[iPR + 6] = zy
  S[iPR + 7] = G3[1]
  S[iPR + 8] = xz
  S[iPR + 9] = yz
  S[iPR + 10] = zz
  S[iPR + 11] = G3[2]
  const sc = smoothstep(0, 1, vis)
  putPart(out, o, part, S, iPR, sc, sc, sc)
}

/** A procedure patient's breathing tube, at the mouth (head frame `mouth`, nominal): -Y into the mouth, +Y out of the face, X the head's. */
function tubeFrame(out: Float32Array, o: number, mouth: readonly number[], s: number): void {
  transformPoint(S, iH, mouth[0] * s, mouth[1] * s, mouth[2] * s, G3)
  // X = head X, Y = head Z (out of the face), Z = -head Y: right handed
  S[iPR] = S[iH]
  S[iPR + 1] = S[iH + 2]
  S[iPR + 2] = -S[iH + 1]
  S[iPR + 3] = G3[0]
  S[iPR + 4] = S[iH + 4]
  S[iPR + 5] = S[iH + 6]
  S[iPR + 6] = -S[iH + 5]
  S[iPR + 7] = G3[1]
  S[iPR + 8] = S[iH + 8]
  S[iPR + 9] = S[iH + 10]
  S[iPR + 10] = -S[iH + 9]
  S[iPR + 11] = G3[2]
  putPart(out, o, P.propL, S, iPR, 1, 1, 1)
}

/** The middle of a hand (wrist matrix S[iW]) in the nominal body frame into dst[i..i+2]. */
function handMiddle(dst: Float64Array, i: number, iW: number, s: number, B: Readonly<BodyDims>, pelvisRef: number, standP: number): void {
  const h = B.hand * s
  dst[i] = (S[iW + 3] - h * S[iW + 1]) / s
  dst[i + 1] = (S[iW + 7] - h * S[iW + 5] - pelvisRef) / s + standP
  dst[i + 2] = (S[iW + 11] - h * S[iW + 9]) / s
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
