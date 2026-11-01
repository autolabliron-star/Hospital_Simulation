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
 * `aboveHead` and `oneUp` arms and the prone and oblique positions belong to wave 3 (the CT and ultrasound tables) and fall back to the lying arms and legs.
 * Nothing here runs for anybody who is not on the OR table: they are solved exactly as before. Nothing allocates per frame.
 */
import { BODY_LANDMARKS, LITHOTOMY_LEG } from '@/sim/procedure/body'
import { newTablePose, setTablePose, tableMatrixInto, type TablePose } from '@/sim/surgery/tablePose'
import type { RigInput } from './rig'

/**
 * How fast the legs swing into the boots and the arms tuck (1 / s): the live table top's `OMEGA_BOOT` (src/scene/surgery/table.ts), by value (features talk through
 * registries, not imports; tablePatient.test.ts pins the two equal). A critically damped follower reaches 95 % at 4.74 / omega: about 1.5 s.
 */
export const TABLE_OMEGA = 3.2

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

/** What a patient on the table remembers between frames. */
export interface TableBody {
  /** The table top's tilt and roll (cached trigonometry), and its 4x4 in the DRAWN frame (column-major, about the pivot moved by the level's offsets). */
  pose: TablePose
  m: Float64Array
  /** [legs in the boots 0..1, its velocity, arms tucked 0..1, its velocity]. */
  st: Float64Array
  /** False until the first frame on the table, which places the followers where the pose says (no swing on a warm start). */
  init: boolean
  /** The frame time of the last frame this person was solved on the table. */
  last: number
  /** The table paths are taken this frame: the pose is given, or a follower has not yet come to rest. */
  on: boolean
}

export function createTableBody(): TableBody {
  const pose = newTablePose()
  const m = new Float64Array(16)
  tableMatrixInto(pose, m)
  return { pose, m, st: new Float64Array(4), init: false, last: -1e9, on: false }
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

/**
 * Step the patient's followers and the table's pose for this frame (`dt` real seconds, `inp.time` the frame time). Returns whether the table paths are taken:
 * not for anybody who is not on the OR table, and not once the pose is gone and the followers are at rest. A person who leaves the table (or whose pose goes)
 * lets the followers settle back, so the legs come down and the arms untuck instead of popping.
 */
export function stepTableBody(tb: TableBody, inp: RigInput, dt: number): boolean {
  const st = tb.st
  if (!inp.tableSeat) {
    // (somebody who left the table is solved as any other lying person from this frame: they were moved, not lowered)
    tb.init = false
    tb.on = false
    st[0] = 0
    st[1] = 0
    st[2] = 0
    st[3] = 0
    return false
  }
  const gap = inp.time - tb.last
  tb.last = inp.time
  const lith = inp.tableLith ? 1 : 0
  const tuck = inp.tableTuck ? 1 : 0
  if (!tb.init || inp.tableSnap || gap < 0 || gap > TABLE_SNAP_GAP) {
    tb.init = true
    st[0] = lith
    st[1] = 0
    st[2] = tuck
    st[3] = 0
  } else {
    settleAt(st, 0, lith, TABLE_OMEGA, dt)
    settleAt(st, 2, tuck, TABLE_OMEGA, dt)
  }
  if (inp.tablePose || st[0] > TABLE_REST || st[2] > TABLE_REST) tb.on = true
  else {
    tb.on = false
    st[0] = 0
    st[1] = 0
    st[2] = 0
    st[3] = 0
  }
  setTablePose(tb.pose, inp.tableTilt, inp.tableRoll)
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
