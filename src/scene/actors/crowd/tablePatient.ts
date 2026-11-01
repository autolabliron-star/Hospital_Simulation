/**
 * R5 wave 2 (agent G): a procedure patient on the OR table. The crowd lays a lying person flat on the mattress it is given; this file is the extra a person
 * lying on the OR table (seat `orTable:*`) with an `Entity.patientPose` (`PatientPoseView`) needs, as small allocation-free pieces the rig (rig.ts, steps 4, 6
 * and 9) composes:
 *
 *   - the TABLE'S TRANSFORM, the same one the live table top, the boots, the drapes and the robot's ports use (src/sim/surgery/tablePose.ts `tableMatrixInto`,
 *     about the pivot on the column), carried into the person's root frame (`tableRootInto`) and applied to the WHOLE laid-flat body, so a tipped table keeps
 *     the patient on its pad to the last bit. Raw tilt and roll, not smoothed: the table top is drawn from the same numbers.
 *   - PLACEMENT: the pelvis centre lies `PELVIS_ON_TABLE[position]` along the table (src/sim/procedure/body.ts): lithotomy slides the body toward the feet.
 *   - TWO FOLLOWERS (`TableBody.st`), critically damped at `TABLE_OMEGA` (the table's own `OMEGA_BOOT`: the boots swing in as the legs do): how far the legs are
 *     in the boots (0 flat .. 1 lithotomy, which also slides the pelvis) and how far the arms are tucked (0 as they lie .. 1 along the sides). A person who first
 *     appears on the table, a Jump (the entity changes), a warm start or a long gap in drawing snaps to where the pose says, with no swing.
 *   - LITHOTOMY LEGS: each ankle goes to `LITHOTOMY_LEG.ankle` (mirrored) by the rig's two-bone leg solve; the knee falls outward and up (`LITHO_POLE`, the
 *     direction of the contract's own knee from the hip-ankle line) as the avatar's own thigh and shin put it: a short leg reaches as far as it can along the
 *     line, a long one bends more. The foot sits square to the shin, in the boot (`footToShin`).
 *   - TUCKED ARMS: each wrist goes to `BODY_LANDMARKS.wristTucked` (mirrored) with the arm along the side, the palm in.
 *
 * R5 wave 3 (the CT cryo table `scanTable:cryo` and the ultrasound couch `usCouch:us`: "procedure tables", `RigInput.tableKind` 1): the same machinery lays the patient
 * on those too, and adds the positions and arms the OR does not use. They have no tilt: the pose's `rollDeg` rolls the BODY (a wedge under one side; + lifts the patient's
 * right, as everywhere), and:
 *   - PRONE: the body is rolled a half turn about its long axis (`psi` = pi), the head turned to the patient's left on the pad, the legs lowered onto the pad with the feet
 *     plantar-flexed and the knees bowing up (the rig solves the ankles to table-frame points, as it does the boots);
 *   - OBLIQUE (`obliqueLeftUp`: the kidney's right lateral decubitus): rolled onto the right side by `OBLIQUE_DEG`, the left flank up toward the robot, the legs stacked;
 *   - ABOVE THE HEAD / ONE UP: the wrists go to table-frame points over the head (both arms, forearms on the pad when prone) or, for the ProSense patient, the treated
 *     side's hand behind the head on a pillow with the other arm along the side.
 * The roll is ONE number `psi` (the body's rotation about its long axis, + lifts the patient's LEFT), the sum of the turn (pi), the oblique roll and the wedge, each its own
 * critically damped follower. The torso rests on the pad at every angle through its measured support function (`LieFit`: the lowest of the torso's vertices as the body
 * turns, measured on each avatar's mesh at attach: `measureLieFit`; an analytic ellipse before that and for the procedural body), so the turn passes over the pad without
 * a limb through it. Nothing here runs for anybody who is not on a procedure table: they are solved exactly as before. Nothing allocates per frame.
 */
import { BODY_LANDMARKS, LITHOTOMY_LEG } from '@/sim/procedure/body'
import { newTablePose, setTablePose, tableMatrixInto, type TablePose } from '@/sim/surgery/tablePose'
import type { PatientPoseView } from '@/sim/types'
import { NOMINAL_BODY, P, type BodyDims } from './constants'
import type { RigInput } from './rig'

/**
 * How fast the legs swing into the boots and the arms tuck (1 / s): the live table top's `OMEGA_BOOT` (src/scene/surgery/table.ts), by value (features talk through
 * registries, not imports; tablePatient.test.ts pins the two equal). A critically damped follower reaches 95 % at 4.74 / omega: about 1.5 s.
 */
export const TABLE_OMEGA = 3.2

/**
 * How fast the arms go over the head or behind it, and come down again (1 / s): slower than the boots (R5 wave 3). A raised arm sweeps a metre and a half over the pad, and a
 * follower at `TABLE_OMEGA` (3.2) peaks at 1.18 per second: the hand then moved 3.1 to 4.4 cm in a frame at 60 Hz (2 to 2.6 m/s, with the roll's own motion added during a turn),
 * more than a patient being lifted into position moves it. At 1.1 the arms are 95 % there in 4.3 s, a little after the roll's 3 s (`TURN_OMEGA`), and no joint moves more than 2.2 cm
 * in a frame (1.3 m/s) through every transition of the five scripts (armTransitions.test.ts pins 3 cm). The hand's way is `ARM_SWEEP`: over the pad, round the shoulder, in the table's frame,
 * so the arm lagging the roll does not matter to where it goes.
 */
export const ARM_OMEGA = 1.1

/** A person not drawn for this long (seconds) is placed at once when they are seen again: the boots are long in. */
export const TABLE_SNAP_GAP = 1

/** A follower below this is at rest (0): the person is solved exactly as any other lying person. */
export const TABLE_REST = 0.002

/** The elbow's wing for a tucked arm (solveArmReach's pole): out to the side, over the pad's edge rather than into it. */
export const TUCK_WING = 1
/**
 * How far (metres) a tucked wrist may be moved from the contract's landmark, away from the shoulder, to straighten an arm that would bow out at the elbow: the nominal
 * wrist (body.ts) is about 0.49 m from its shoulder and the arm 0.5 to 0.54 m long, which would bend the elbow 20 to 25 degrees. Within the 3 cm the wrist is allowed.
 */
export const TUCK_EXTEND = 0.025
/** The pronation of a tucked hand (pose.ts: 0 is the handshake, thumb forward; the palm faces the thigh). */
export const TUCK_PRON = 0.2

/**
 * Where the left knee points, in the table's own frame across (x, outward is the left's +) and up (h): the contract's knee's offset from the line between its
 * hip and its ankle, perpendicular to that line (body.ts: BODY_LANDMARKS.hip, LITHOTOMY_LEG.knee and .ankle), unit length. The rig's leg solve takes this as
 * the knee's pole, so a leg of any length bends the same way the contract's does.
 */
function lithotomyPole(): { x: number; up: number } {
  const H = BODY_LANDMARKS.hip
  const K = LITHOTOMY_LEG.knee
  const A = LITHOTOMY_LEG.ankle
  let ud = A.d - H.d
  let ux = A.x - H.x
  let uh = A.h - H.h
  const ul = Math.hypot(ud, ux, uh)
  ud /= ul
  ux /= ul
  uh /= ul
  const vd = K.d - H.d
  const vx = K.x - H.x
  const vh = K.h - H.h
  const dot = vd * ud + vx * ux + vh * uh
  const px = vx - dot * ux
  const ph = vh - dot * uh
  const pl = Math.hypot(px, ph)
  return { x: px / pl, up: ph / pl }
}
export const LITHO_POLE: Readonly<{ x: number; up: number }> = Object.freeze(lithotomyPole())

// ---------------------------------------------------------------------------------------------
// R5 wave 3: the roll about the long axis, and the arms and legs of the positions the OR does not use
// ---------------------------------------------------------------------------------------------

/** How fast a log-roll (the turn onto the front, the positioning onto the side) goes (1 / s): a critically damped follower reaches 95 % at 4.74 / omega, about 3 s. */
export const TURN_OMEGA = 1.6
/** The kidney's position: rolled onto the right side by this much, the left flank up (the usual lateral decubitus is 45 to 60 degrees; the pad's wedge holds it). */
export const OBLIQUE_DEG = 55
export const OBLIQUE_RAD = (OBLIQUE_DEG * Math.PI) / 180
/** A roll follower below this (degrees) is at rest. */
export const ROLL_REST = 0.02

/** How much of the leg's own lying pose gives way to the roll's legs, by the angle: nothing under 7 degrees (the ProSense wedge), all of it past 29. */
export const LEG_ROLL_FROM = 0.12
export const LEG_ROLL_TO = 0.5
/**
 * The roll's legs: where an ankle rests (table frame, metres at nominal size): the joint's height over the pad, half the spacing of the ankles (side by side on the pad, as the
 * hips are), how high the upper leg rides over the lower one when the body lies on its side (a leg's thickness), and how far the foot is plantar-flexed lying on its front (the
 * toes trail on the pad). Feet rest on the pad with the toes at most a couple of centimetres into it.
 */
export const ROLL_LEGS = { rest: 0.06, half: 0.115, stack: 0.115, plantar: 1.05 } as const

/**
 * The arms above the head (table frame, relative to the pelvis, metres at nominal size; the left arm's: the right mirrors across the body's own midline): the WRIST
 * lies over the head on the pad. Supine the hands are beyond the crown, prone the forearms lie by the head (bent at the elbow), on its side the arm that is up rests on
 * the support that holds it (`rise` over the pad per metre of the roll's sine).
 */
export const ARMS_UP = { d: -1.02, dProne: -0.98, lat: 0.13, rest: 0.06, rise: 0.22 } as const
/**
 * The way a hand goes to the arms-above-the-head place and back (R5 wave 3, P11), in the table's frame: from where the lying pose's hand lies at the side of the hip (the arm straight,
 * as the lying pose has it) it slides over the pad round the shoulder (an arc about the shoulder as the table sees it, at the arm's own distance from it, drawn in by `pull` metres
 * through the middle, up by `lift` metres: the hand and its fingers clear the pad) out beside the body and up to `ARMS_UP`. The old way, the angles mixed linearly with the lying pose's,
 * swept a raised arm through the chest's front, which face down is the table (wrists 37 to 49 cm under the pad for 3 to 4 s of each turn); this one never leaves the pad's plane
 * whatever the roll does underneath, always passes the side the arm lies on (never across the body), and never asks the elbow to snap from straight to bent (the distance from the
 * shoulder changes smoothly). `blend` is how much of the lift (0..1) the lying pose takes to give way to the solved arm: the solve starts at the lying pose, so it moves nothing, but it
 * has to be done before the roll has turned the arms hanging at the sides under the pad. `floor` is the lowest the rest hand's place is put (metres over the pad) when the arms rest at a roll.
 * `swing` (R5 wave 3, P11 residual twitch): the solved arm's twist is not the lying pose's (about 0 against 2.2 to 2.5 radians for the pole) and the angles are blended in over ten frames,
 * so the forearm and the hand rolled about the arm's own axis at up to 0.4 radians a frame (3.1 to 4.1 cm a frame at the fingers and the upper arm, the joints 1.3 cm). While the arms go up
 * the elbow now starts on the lying arm's own side of the shoulder-to-hand line (so the solve IS the lying pose, the hand where the lying arm has it) and swings round that line to the
 * pole between `blend` and `swing` (the follower's own 0..1): the hand stays on its way and the twist eases over the first part of the sweep (0.17 radians a frame at most). It ends
 * before the elbow has bent much (the hand has gone about a fifth of the way); coming down the solve is the old one.
 */
export const ARM_SWEEP = { pull: 0.12, lift: 0.03, floor: 0.05, blend: 0.03, swing: 0.25 } as const
/** One arm up for the breast patient: the wrist behind the head on a pillow (d, across, height over the pad). The other arm is the tucked one. */
export const ARM_ONE = { d: -0.93, lat: 0.14, h: 0.11 } as const
/** The prone patient's head: turned to the patient's left (toward the anaesthetist) by this much (radians), from this roll on, and nodding down onto the pad (the neck flexes about its own cross axis). */
export const PRONE_HEAD = { yaw: 1.2, nod: 0.2, from: 1.9, to: 2.8 } as const

/**
 * Which arm is the one up for a ProSense patient (+1 the patient's left, -1 the right): the treated side. The sim's script rolls her slightly toward the OTHER side (a wedge
 * under the treated side's back lifts it: `rollDeg` < 0 lifts the left), so the lifted side is the treated one; a patient not rolled has the room's own side, which the
 * layout fixes as the left (places.ts `UsProcedureSpots.side`).
 */
export function oneUpSide(pose: Pick<PatientPoseView, 'rollDeg'> | null): number {
  return pose !== null && pose.rollDeg > 0.5 ? -1 : 1
}

/**
 * What a patient's pose says to the rig (`RigInput.table*`), for the table kind `kind` (0 the OR table, 1 a procedure table; see head.ts `tableKindOf`): the crowd model's
 * and the tests' one way of writing it. A null pose is a person who lies on the table with no pose (the followers settle them back to lying).
 */
export function writeTableInput(inp: RigInput, kind: number, pose: Pick<PatientPoseView, 'position' | 'arms' | 'headTiltDeg' | 'rollDeg'> | null): void {
  inp.tableSeat = true
  inp.tableKind = kind
  inp.tablePose = pose !== null
  inp.tableLith = pose !== null && pose.position === 'lithotomy'
  inp.tableTuck = pose !== null && pose.arms === 'tucked'
  inp.tableProne = pose !== null && pose.position === 'prone'
  inp.tableSide = pose !== null && pose.position === 'obliqueLeftUp'
  inp.tableUp = pose !== null && pose.arms === 'aboveHead'
  inp.tableOne = pose !== null && pose.arms === 'oneUp'
  inp.tableOneSide = oneUpSide(pose)
  inp.tableTilt = pose !== null ? pose.headTiltDeg : 0
  inp.tableRoll = pose !== null ? pose.rollDeg : 0
}

/** Bins of the torso's support function: every 15 degrees of the roll. */
export const LIE_BINS = 24

/**
 * The torso's support function: `m[k]` is the lowest height (metres, nominal size) any vertex of the torso (the pelvis and chest parts, the shoulders and the buttocks in)
 * reaches above the pelvis centre once the body, lying flat, is rolled by `psi` = 2 pi k / LIE_BINS about its long axis through the pelvis centre: min over vertices of
 * (x sin psi + z cos psi), (x, z) across and forward of the pelvis part's origin (a left vertex at x > 0 goes UP for psi > 0). `m[0]` is minus the back's depth. The rig keeps
 * the torso on the pad by lifting the pelvis `m(0) - m(psi)` at every angle.
 */
export interface LieFit {
  m: Float32Array
}

/** The support function of an ellipse-ish torso: `a` across (half-width), `back` and `front` the depths behind and ahead of the pelvis centre. */
export function ellipseLieFit(a: number, back: number, front: number): LieFit {
  const m = new Float32Array(LIE_BINS)
  for (let k = 0; k < LIE_BINS; k++) {
    const psi = (2 * Math.PI * k) / LIE_BINS
    const s = Math.sin(psi)
    const c = Math.cos(psi)
    const b = c >= 0 ? back : front
    m[k] = -Math.sqrt(a * a * s * s + b * b * c * c)
  }
  return { m }
}

/**
 * A skeleton's torso before its mesh is measured (and the procedural body's): an ellipse as wide as its shoulders. The procedural body's pelvis loft is 0.105 deep and 0.162 wide,
 * its chest a little deeper; a realistic avatar's back is its `liePelvis` plus the 2.5 cm it sinks into the pad, its front 12 cm.
 */
export function defaultLieFit(B: Readonly<BodyDims>): LieFit {
  if (B === NOMINAL_BODY) return ellipseLieFit(0.17, 0.105, 0.105)
  return ellipseLieFit(B.shoulderHalf + 0.02, B.liePelvis + 0.025, 0.12)
}

/** The support function at angle `psi` (radians, any), interpolated between bins. */
export function lieSupport(f: LieFit, psi: number): number {
  const TAU = 2 * Math.PI
  let x = ((psi % TAU) + TAU) % TAU
  x = (x / TAU) * LIE_BINS
  const i = Math.floor(x)
  const t = x - i
  const a = f.m[i % LIE_BINS]
  const b = f.m[(i + 1) % LIE_BINS]
  return a + (b - a) * t
}

/** How far the pelvis rides up to keep the torso on the pad when the body is rolled by `psi` (m(0) - m(psi): up to a few centimetres, or down when the front is the shallower side). */
export function rollLift(f: LieFit, psi: number): number {
  return f.m[0] - lieSupport(f, psi)
}

/**
 * Measure an avatar's torso (LOD 0): the vertices that belong most to the pelvis or the chest part, in the pelvis part's own frame (the bind pose put through the part's inverse
 * bind), their lowest `x sin psi + z cos psi` per bin. Null when the mesh has no torso.
 */
export function measureLieFit(pos: ArrayLike<number>, joints: ArrayLike<number>, weights: ArrayLike<number>, count: number, bindInverse: ArrayLike<number>): LieFit | null {
  const b = P.pelvis * 12
  const m = new Float32Array(LIE_BINS).fill(Infinity)
  const sn = new Float64Array(LIE_BINS)
  const cs = new Float64Array(LIE_BINS)
  for (let k = 0; k < LIE_BINS; k++) {
    sn[k] = Math.sin((2 * Math.PI * k) / LIE_BINS)
    cs[k] = Math.cos((2 * Math.PI * k) / LIE_BINS)
  }
  let n = 0
  for (let v = 0; v < count; v++) {
    // the part with the most weight
    let best = -1
    let bw = 0
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k]
      if (w > bw) {
        bw = w
        best = Math.round(joints[v * 4 + k])
      }
    }
    if (best !== P.pelvis && best !== P.chest) continue
    const x = pos[v * 3]
    const y = pos[v * 3 + 1]
    const z = pos[v * 3 + 2]
    const ux = bindInverse[b] * x + bindInverse[b + 1] * y + bindInverse[b + 2] * z + bindInverse[b + 3]
    const uz = bindInverse[b + 8] * x + bindInverse[b + 9] * y + bindInverse[b + 10] * z + bindInverse[b + 11]
    n++
    for (let k = 0; k < LIE_BINS; k++) {
      const h = ux * sn[k] + uz * cs[k]
      if (h < m[k]) m[k] = h
    }
  }
  return n > 0 ? { m } : null
}

// follower slots in `TableBody.st` (value, velocity)
export const F_LITH = 0
export const F_TUCK = 2
export const F_TURN = 4
export const F_SIDE = 6
export const F_UP = 8
export const F_ONE = 10
export const F_ROLL = 12
const FOLLOWERS = 14

/** What a patient on the table remembers between frames. */
export interface TableBody {
  /** The table top's tilt and roll (cached trigonometry), and its 4x4 in the DRAWN frame (column-major, about the pivot moved by the level's offsets). */
  pose: TablePose
  m: Float64Array
  /**
   * [legs in the boots 0..1, v, arms tucked 0..1, v, turned onto the front 0..1, v, rolled onto the side 0..1, v, arms above the head 0..1, v, one arm up 0..1, v,
   * the wedge's roll (degrees, + lifts the right), v]: critically damped followers (F_*).
   */
  st: Float64Array
  /** False until the first frame on the table, which places the followers where the pose says (no swing on a warm start). */
  init: boolean
  /** The frame time of the last frame this person was solved on the table. */
  last: number
  /** The table paths are taken this frame: the pose is given, or a follower has not yet come to rest. */
  on: boolean
  /** The body's roll about its long axis this frame (radians, + lifts the patient's left), its cosine and sine; the treated side (+1 left, -1 right) of the one arm up. */
  psi: number
  cPsi: number
  sPsi: number
  oneSide: number
  /**
   * The body's roll (radians) the raised arms rest at: the roll whenever the arms are at rest, held while they are raised or on their way (R5 wave 3, P11: the hand's sweep starts from
   * where the lying pose's hand lies at that roll, and comes back to it).
   */
  armPsi: number
  /**
   * The twist of each arm's last solve per placement (`ARM_REFS`: tucked, above the head, one up; left then right), unwrapped over time: the twist is an atan2 and wraps at +-pi
   * while the arm's angles are MIXED with the lying pose's, so a twist crossing the wrap mid-mix swings the forearm round the arm in one frame. The rig takes each new twist
   * on the branch nearest this one (rig.ts `solveArmReach`); NaN (the placement is not in force) takes the branch nearest zero. See `unwrapTwist`.
   */
  twistRef: Float64Array
}

/**
 * Slots of `TableBody.twistRef`: placement (0 tucked, 1 above the head, 2 one up) x 2 + arm (0 left, 1 right), then the angle of the elbow's swing round the shoulder-to-hand line of the
 * arms above the head (`ARM_SWEEP.swing`, rig.ts `solveArmReach`), left then right.
 */
export const ARM_REFS = 8

export function createTableBody(): TableBody {
  const pose = newTablePose()
  const m = new Float64Array(16)
  tableMatrixInto(pose, m)
  return { pose, m, st: new Float64Array(FOLLOWERS), init: false, last: -1e9, on: false, psi: 0, cPsi: 1, sPsi: 0, oneSide: 1, armPsi: 0, twistRef: new Float64Array(ARM_REFS).fill(NaN) }
}

/** `a` (an angle) on the branch nearest `ref` (any angle; NaN: nearest zero). Allocation-free: the rig's twist and pitch unwrapping. */
export function unwrapNear(a: number, ref: number): number {
  const TAU = 2 * Math.PI
  const r = ref === ref ? ref : 0
  let d = a - r
  d -= TAU * Math.round(d / TAU)
  return r + d
}

/** One step of a critically damped follower toward `target` (the exact solution: any frame time is stable, nothing overshoots). Reads and writes st[i], st[i + 1]. */
export function settleAt(st: Float64Array, i: number, target: number, omega: number, dt: number): void {
  if (dt <= 0) return
  const x = st[i] - target
  const t = (st[i + 1] + omega * x) * dt
  const e = Math.exp(-omega * dt)
  st[i] = target + (x + t) * e
  st[i + 1] = (st[i + 1] - omega * t) * e
}

const DEG = Math.PI / 180

/**
 * Step the patient's followers and the table's pose for this frame (`dt` real seconds, `inp.time` the frame time). Returns whether the table paths are taken:
 * not for anybody who is not on a procedure table, and not once the pose is gone and the followers are at rest. A person who leaves the table (or whose pose goes)
 * lets the followers settle back, so the legs come down, the arms untuck and the body rolls back instead of popping.
 */
export function stepTableBody(tb: TableBody, inp: RigInput, dt: number): boolean {
  const st = tb.st
  if (!inp.tableSeat) {
    // (somebody who left the table is solved as any other lying person from this frame: they were moved, not lowered)
    tb.init = false
    tb.on = false
    st.fill(0)
    tb.twistRef.fill(NaN)
    tb.psi = 0
    tb.armPsi = 0
    tb.cPsi = 1
    tb.sPsi = 0
    return false
  }
  const gap = inp.time - tb.last
  tb.last = inp.time
  const lith = inp.tableLith ? 1 : 0
  const tuck = inp.tableTuck ? 1 : 0
  const turn = inp.tableProne ? 1 : 0
  const side = inp.tableSide ? 1 : 0
  const up = inp.tableUp ? 1 : 0
  const one = inp.tableOne ? 1 : 0
  // (on the OR table the pose's roll tips the top; on a procedure table it is a wedge under the body)
  const roll = inp.tableKind === 1 ? inp.tableRoll : 0
  // the raised arm's side (R5 wave 3): the pose asks for it while one arm is up; once the pose is gone (a null view reads +1) or says other arms, the side of the arm that is still up is
  // kept until its follower is at rest, so the raised arm comes down on its own side instead of the other arm going up in its place
  if (inp.tableOne || !(st[F_ONE] > TABLE_REST)) tb.oneSide = inp.tableOneSide < 0 ? -1 : 1
  if (!tb.init || inp.tableSnap || gap < 0 || gap > TABLE_SNAP_GAP) {
    tb.init = true
    tb.oneSide = inp.tableOneSide < 0 ? -1 : 1
    tb.twistRef.fill(NaN)
    st.fill(0)
    st[F_LITH] = lith
    st[F_TUCK] = tuck
    st[F_TURN] = turn
    st[F_SIDE] = side
    st[F_UP] = up
    st[F_ONE] = one
    st[F_ROLL] = roll
  } else {
    settleAt(st, F_LITH, lith, TABLE_OMEGA, dt)
    settleAt(st, F_TUCK, tuck, TABLE_OMEGA, dt)
    settleAt(st, F_TURN, turn, TURN_OMEGA, dt)
    settleAt(st, F_SIDE, side, TURN_OMEGA, dt)
    settleAt(st, F_UP, up, ARM_OMEGA, dt)
    settleAt(st, F_ONE, one, ARM_OMEGA, dt)
    settleAt(st, F_ROLL, roll, TABLE_OMEGA, dt)
  }
  const moving = st[F_LITH] > TABLE_REST || st[F_TUCK] > TABLE_REST || st[F_TURN] > TABLE_REST || st[F_SIDE] > TABLE_REST || st[F_UP] > TABLE_REST || st[F_ONE] > TABLE_REST || Math.abs(st[F_ROLL]) > ROLL_REST
  if (inp.tablePose || moving) tb.on = true
  else {
    tb.on = false
    st.fill(0)
    tb.twistRef.fill(NaN)
  }
  // the body's roll: the half turn, the lateral position and the wedge (the pose's + lifts the patient's right, so it is a roll of the left DOWN)
  const psi = Math.PI * st[F_TURN] + OBLIQUE_RAD * st[F_SIDE] - st[F_ROLL] * DEG
  tb.psi = psi
  if (st[F_UP] <= TABLE_REST) tb.armPsi = psi
  tb.cPsi = Math.cos(psi)
  tb.sPsi = Math.sin(psi)
  setTablePose(tb.pose, inp.tableTilt, inp.tableKind === 1 ? 0 : inp.tableRoll)
  return tb.on
}

/**
 * The table's transform in the person's ROOT frame (the frame the part matrices are in: feet at the origin, facing the heading), a 3x4 at out[o..o + 12) in the
 * rig's row-major layout. The table matrix is in the drawn frame (`tableMatrixInto`: the pivot moved by the level's offsets, the scene's own frame); with
 * W = Rh q + t0 the drawn point of a root-frame point q (Rh the heading, t0 the root's drawn position) the root-frame matrix is Rh^T M Rh with the translation
 * Rh^T (M t0 - t0), so the rest of the rig, which works in the root frame, needs no other change. A level table is the identity.
 */
export function tableRootInto(tb: TableBody, x: number, y: number, z: number, heading: number, offX: number, offY: number, offZ: number, out: Float64Array, o: number): void {
  const M = tb.m
  tableMatrixInto(tb.pose, M, offX, offY, offZ)
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  // A = Mlin Rh: Rh rows are [c 0 s], [0 1 0], [-s 0 c]; Mlin[i][j] = M[4 j + i]
  for (let i = 0; i < 3; i++) {
    const m0 = M[i]
    const m1 = M[4 + i]
    const m2 = M[8 + i]
    A3[i * 3] = m0 * c - m2 * s
    A3[i * 3 + 1] = m1
    A3[i * 3 + 2] = m0 * s + m2 * c
  }
  // Rh^T A, with Rh^T rows [c 0 -s], [0 1 0], [s 0 c]
  for (let j = 0; j < 3; j++) {
    out[o + j] = c * A3[j] - s * A3[6 + j]
    out[o + 4 + j] = A3[3 + j]
    out[o + 8 + j] = s * A3[j] + c * A3[6 + j]
  }
  // Rh^T (Mlin t0 + m - t0)
  const w0 = M[0] * x + M[4] * y + M[8] * z + M[12] - x
  const w1 = M[1] * x + M[5] * y + M[9] * z + M[13] - y
  const w2 = M[2] * x + M[6] * y + M[10] * z + M[14] - z
  out[o + 3] = c * w0 - s * w2
  out[o + 7] = w1
  out[o + 11] = s * w0 + c * w2
}
const A3 = new Float64Array(9)

/**
 * A point of the LYING frame (the root frame after the body was laid flat: x across, y up from the root, z toward the feet, the pelvis `slide` along) in the
 * UPRIGHT frame the rig solves the legs and arms in: the inverse of the lie transform `q = R (u - (0, pY, 0)) + (0, lieY, slide)`, R = Rx(theta) (rig.ts step 9;
 * `cT`, `sT` its cosine and sine). Writes out[o..o + 3).
 */
export function uprightOfLying(out: Float64Array, o: number, qx: number, qy: number, qz: number, cT: number, sT: number, lieY: number, slide: number, pY: number): void {
  const y = qy - lieY
  const z = qz - slide
  out[o] = qx
  out[o + 1] = cT * y + sT * z + pY
  out[o + 2] = -sT * y + cT * z
}

/**
 * The roll about the body's long axis as a 3x4 (the rig's row-major layout) at out[o..o + 12): the lying frame turned by psi (`c`, `s` its cosine and sine; + lifts the
 * patient's left) about the line through (x 0, y `pivY`) along the table, then the whole body lifted by `dy`. Applied after the lie transform: the torso goes where its
 * support function says it rests on the pad.
 */
export function rollMatrixInto(out: Float64Array, o: number, c: number, s: number, pivY: number, dy: number): void {
  out[o] = c
  out[o + 1] = -s
  out[o + 2] = 0
  out[o + 3] = s * pivY
  out[o + 4] = s
  out[o + 5] = c
  out[o + 6] = 0
  out[o + 7] = pivY - c * pivY + dy
  out[o + 8] = 0
  out[o + 9] = 0
  out[o + 10] = 1
  out[o + 11] = 0
}

/**
 * A point of the FINAL lying frame (the table's own: after the lie transform and the roll) in the upright frame the rig solves the limbs in: the roll undone (about
 * (x 0, y `pivY`), lifted by `dy`), then `uprightOfLying`. Writes out[o..o + 3).
 */
export function uprightOfRolled(out: Float64Array, o: number, qx: number, qy: number, qz: number, c: number, s: number, pivY: number, dy: number, cT: number, sT: number, lieY: number, slide: number, pY: number): void {
  const a = qx
  const b = qy - pivY - dy
  uprightOfLying(out, o, c * a + s * b, pivY - s * a + c * b, qz, cT, sT, lieY, slide, pY)
}

/**
 * The foot of a leg in the boot: the standing foot matrix at S[o..] (origin at the ankle) turned toward the shin's own frame (LEG[l..], the leg solve's: Y up the
 * shin, X the knee's hinge, Z the way the toes point, square to the shin) by `k`, then made orthonormal again. The origin is kept. At k = 0 it changes nothing.
 */
export function footToShin(S: Float64Array, o: number, leg: Float64Array, l: number, k: number): void {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = o + r * 4 + c
      S[i] += (leg[l + r * 4 + c] - S[i]) * k
    }
  }
  // Gram-Schmidt on the columns X, Y, Z
  let xx = S[o]
  let xy = S[o + 4]
  let xz = S[o + 8]
  const xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1
  xx /= xl
  xy /= xl
  xz /= xl
  let yx = S[o + 1]
  let yy = S[o + 5]
  let yz = S[o + 9]
  const d = yx * xx + yy * xy + yz * xz
  yx -= d * xx
  yy -= d * xy
  yz -= d * xz
  const yl = Math.sqrt(yx * yx + yy * yy + yz * yz) || 1
  yx /= yl
  yy /= yl
  yz /= yl
  S[o] = xx
  S[o + 4] = xy
  S[o + 8] = xz
  S[o + 1] = yx
  S[o + 5] = yy
  S[o + 9] = yz
  S[o + 2] = xy * yz - xz * yy
  S[o + 6] = xz * yx - xx * yz
  S[o + 10] = xx * yy - xy * yx
}

/** A drawn-frame point moved with the table (the table matrix `m`, column-major): writes into out[0..3). For the pick capsule. */
export function tableMovePoint(m: Float64Array, x: number, y: number, z: number, out: Float64Array): void {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12]
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13]
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14]
}
