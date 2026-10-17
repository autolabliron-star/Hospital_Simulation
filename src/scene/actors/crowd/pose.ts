// Ported from Waltz City (src/scene/actors/crowd/pose.ts); relaxed, talk, wave and the seated modes are Waltz's. Tablet, give, push, clean, sitTablet, lie and the hand-reach targets are new.
/**
 * Upper-body poses. Each pose mode is a small pure function of time that fills in the joint angles of
 * the chest, head and both arms; the blender (blend.ts) mixes them with weights that always sum to 1.
 * Legs and pelvis are not here: they come from the foot planner (gait.ts) or from the seat (rig.ts).
 *
 * Angle conventions (radians, character frame: +X left, +Y up, +Z forward):
 *   arm pitch   forward swing at the shoulder. 0 hangs, PI/2 points forward, PI points up.
 *   arm roll    outward swing ("abduction"). 0 hangs, PI/2 points sideways. Positive is away from the body
 *               for both arms: the rig mirrors the sign for the right arm.
 *   arm twist   spin about the upper arm's own axis; with the elbow bent it sweeps the forearm sideways.
 *   elbow       flexion, 0 straight, PI/2 a right angle, the forearm swings forward and up.
 *   wrist       hand pitch relative to the forearm, positive bends the hand up.
 *   pronation   spin of the hand about the forearm: 0 = thumb forward ("handshake"), about 1.4 = palm down.
 *   chest/head  pitch positive leans or nods forward, yaw positive turns to the character's left.
 *
 * HAND REACH (new). Some poses care where the hand IS (a wheelchair handle, a tablet, a mop), not which
 * angles get it there. A pose may also write a reach target per hand: a point in the body's root frame
 * (nominal size, x to the left, y above the floor of a standing person, z forward) and a weight. The
 * entries are premultiplied by the weight, so the blender's plain weighted sum is also the right way to
 * mix them; `rig.ts` turns the mixed target into arm angles with a two-bone solve and blends those angles
 * with the pose's own (approximate) angles by the mixed weight.
 */
import { noise1, TAU, clamp } from './math'
import { MODES, type Mode } from './blend'
import { reclineAngle } from '@/scene/rooms/bedPose'

export const U = {
  chestYaw: 0,
  chestPitch: 1,
  chestRoll: 2,
  headYaw: 3,
  headPitch: 4,
  headRoll: 5,
  lPitch: 6,
  lRoll: 7,
  lTwist: 8,
  lElbow: 9,
  lWrist: 10,
  lPron: 11,
  rPitch: 12,
  rRoll: 13,
  rTwist: 14,
  rElbow: 15,
  rWrist: 16,
  rPron: 17,
  /** Extra height of the whole body above its planted stance, metres (a happy bounce). */
  hop: 18,
  // reach: weight, then weight * target (x, y, z), left hand then right hand
  lReachW: 19,
  lReachX: 20,
  lReachY: 21,
  lReachZ: 22,
  rReachW: 23,
  rReachX: 24,
  rReachY: 25,
  rReachZ: 26,
} as const
export const UP_COUNT = 27
export const ARM_L = U.lPitch
export const ARM_R = U.rPitch
/** First index of each hand's reach block. */
export const REACH_L = U.lReachW
export const REACH_R = U.rReachW

/** Everything a mode may depend on. One object per person, updated each frame by the rig. */
export interface PoseCtx {
  t: number
  seed: number
  /** +1 right-handed, -1 left-handed: which arm is "the" gesturing arm. */
  hand: 1 | -1
  /** Locomotion intensity, 0 standing to 1 at a normal walk. */
  motion: number
  /** 0 at a walk, 1 at a run (elbows bent to a right angle, arms pumping, the chest leans in). */
  run: number
  /** 0 at the NPCs' stroll (up to 1.4 m/s) .. 1 at a brisk walk and above (a longer swing with the elbows less bent). */
  brisk: number
  /** This person's size relative to the nominal body (a fixed handle is the same place for a tall and a short pusher). */
  size: number
  /** Gait progress: +1 left foot furthest ahead, -1 right foot furthest ahead. */
  gait: number
  /** 1 while this person is the one talking, small while listening. */
  speaking: number
  happy: number
  slump: number
  /** 0..1: how far the bed head is raised under a person lying in a ward bed (0 flat, 1 about 45 degrees). Only the 'lie' mode reads it. */
  recline: number
  // personality
  armRoll: number
  armElbow: number
  gestureRate: number
  breathHz: number
}

export function createPoseCtx(seed: number, hand: 1 | -1, rnd: (k: number) => number): PoseCtx {
  return {
    t: 0,
    seed,
    hand,
    motion: 0,
    run: 0,
    brisk: 0,
    size: 1,
    gait: 0,
    speaking: 0.5,
    happy: 0,
    slump: 0,
    recline: 0,
    armRoll: 0.05 + rnd(61) * 0.09,
    armElbow: 0.14 + rnd(62) * 0.16,
    gestureRate: 0.8 + rnd(63) * 0.45,
    breathHz: 0.2 + rnd(64) * 0.1,
  }
}

type Out = Float32Array

function arm(o: Out, base: number, pitch: number, roll: number, twist: number, elbow: number, wrist: number, pron: number): void {
  o[base] = pitch
  o[base + 1] = roll
  o[base + 2] = twist
  o[base + 3] = elbow
  o[base + 4] = wrist
  o[base + 5] = pron
}

/** Write a hand-reach target (root frame, nominal size) at full weight. `base` is REACH_L or REACH_R. */
function reach(o: Out, base: number, x: number, y: number, z: number): void {
  o[base] = 1
  o[base + 1] = x
  o[base + 2] = y
  o[base + 3] = z
}

/** The arm base indices of the gesturing (dominant) and the other arm. */
const dom = (c: PoseCtx) => (c.hand === 1 ? ARM_R : ARM_L)
const sub = (c: PoseCtx) => (c.hand === 1 ? ARM_L : ARM_R)
const sine = (t: number, hz: number, phase: number) => Math.sin(TAU * hz * t + phase)

function lerpTo(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Standing, strolling, walking briskly, running: the arms follow the feet (`gait`: +1 when the left foot is furthest ahead) and the speed.
 *
 *   stroll  (c.brisk = 0, c.run = 0)  the NPCs' walk, as it always was
 *   brisk   a longer swing, and the elbow bends only a little more as the arm goes forward (it used to close to 50 degrees and hold the
 *           forearm out in front on every forward swing)
 *   run     the elbows bent between 70 and 100 degrees (they close as the arm comes forward and open as it goes back, so the hand behind ends
 *           behind the hips and the two hands are never both held out in front), the arms pump from about -0.7 to +0.65 rad at the shoulder,
 *           the chest leans in (with the pelvis the trunk is about 15 degrees from vertical, the whole body about 9 degrees from the ankle),
 *           the head stays up
 */
function evalRelaxed(c: PoseCtx, o: Out): void {
  const m = c.motion
  const r = c.run
  const b = c.brisk
  const amp = (0.09 + 0.36 * m + 0.04 * b + 0.17 * r) * (1 + 0.32 * c.happy) * (1 - 0.55 * c.slump)
  const breath = Math.sin(TAU * c.breathHz * c.t + c.seed)
  const slumpArm = 0.12 * c.slump
  const sway = noise1(c.t * 0.5, c.seed + 3)
  // the mean of the swing sits ahead of the body for a runner (the elbow is bent, the hand comes up in front of the chest)
  const mean = 0.03 - 0.04 * r
  // left arm goes back when the left foot is ahead
  const pl = -amp * c.gait + mean + 0.012 * breath + 0.02 * sway + slumpArm
  const pr = amp * c.gait + mean - 0.012 * breath - 0.02 * sway + slumpArm
  const fwdL = amp > 1e-3 ? Math.max(0, pl) / (amp + 0.06) : 0
  const fwdR = amp > 1e-3 ? Math.max(0, pr) / (amp + 0.06) : 0
  const roll = c.armRoll + 0.05 * m * (1 - c.slump) - 0.03 * c.slump - 0.04 * r
  const e0 = c.armElbow + 0.1 * c.slump + 0.88 * r
  // how much more the elbow closes as the arm goes forward
  const closing = 0.5 - 0.2 * b + 0.26 * r
  arm(o, ARM_L, pl, roll, 0, e0 + m * (0.16 + closing * fwdL), 0.02 * sway, 0.2)
  arm(o, ARM_R, pr, roll, 0, e0 + m * (0.16 + closing * fwdR), -0.02 * sway, 0.2)
  o[U.chestPitch] = -0.03 * c.happy + 0.2 * c.slump + 0.2 * r
  o[U.chestRoll] = 0.01 * sway
  o[U.headPitch] = -0.06 * c.happy + 0.42 * c.slump + 0.02 * breath - 0.1 * r
  o[U.headYaw] = 0.05 * noise1(c.t * 0.35, c.seed + 5)
  o[U.headRoll] = 0.02 * noise1(c.t * 0.3, c.seed + 6)
}

function evalTalk(c: PoseCtx, o: Out, seated: boolean): void {
  const t = c.t * c.gestureRate
  const burst = 0.5 + 0.5 * noise1(c.t * 0.7, c.seed + 7)
  const amp = (0.3 + 0.7 * c.speaking) * (0.4 + 0.6 * burst)
  const lift = seated ? -0.18 : 0
  const d = dom(c)
  const s = sub(c)
  arm(
    o,
    d,
    0.62 + lift + 0.28 * amp * sine(t, 0.52, c.seed),
    0.2 + 0.14 * amp * sine(t, 0.34, c.seed * 1.7),
    0.5 * amp * sine(t, 0.83, c.seed * 2.3),
    1.32 + 0.38 * amp * sine(t, 0.67, c.seed * 0.9),
    0.1 * amp * sine(t, 1.3, c.seed * 3.1),
    0.5,
  )
  const talkative = clamp((c.speaking - 0.35) / 0.4, 0, 1)
  const a2 = amp * (0.35 + 0.45 * talkative)
  arm(
    o,
    s,
    lerpTo(0.12, 0.42 + lift + 0.2 * a2 * sine(t, 0.46, c.seed * 1.3), talkative),
    c.armRoll + 0.1 * a2 * sine(t, 0.31, c.seed * 2.9),
    0.35 * a2 * sine(t, 0.77, c.seed * 0.4) * talkative,
    lerpTo(c.armElbow + 0.2, 1.15 + 0.3 * a2 * sine(t, 0.61, c.seed * 1.1), talkative),
    0.08 * a2 * sine(t, 1.1, c.seed),
    0.4,
  )
  o[U.chestPitch] = 0.03 + 0.025 * amp * sine(t, 0.5, c.seed)
  o[U.chestYaw] = 0.06 * amp * sine(t, 0.29, c.seed * 1.9)
  o[U.headPitch] = 0.03 + 0.05 * c.speaking * sine(t, 1.1, c.seed * 0.7) + 0.02 * noise1(c.t * 0.4, c.seed + 8)
  o[U.headYaw] = 0.07 * amp * sine(t, 0.23, c.seed * 2.1)
  o[U.headRoll] = 0.04 * sine(t, 0.19, c.seed)
}

function evalWave(c: PoseCtx, o: Out): void {
  const d = dom(c)
  const s = sub(c)
  const sweep = sine(c.t, 2.5, c.seed)
  arm(o, d, 2.0, 0.28, 0.12 + 0.55 * sweep, 0.95, 0.15 * sweep, 0.2)
  arm(o, s, 0.04, c.armRoll, 0, c.armElbow, 0, 0.2)
  o[U.chestPitch] = -0.03
  o[U.chestRoll] = -0.04 * c.hand
  o[U.headPitch] = -0.05
  o[U.headRoll] = 0.1 * c.hand
  o[U.headYaw] = 0.03 * sweep
}

/** Standing, looking at a tablet held in front of the chest: the right hand holds it, the left taps. */
function evalTablet(c: PoseCtx, o: Out): void {
  const read = noise1(c.t * 0.6, c.seed + 9)
  const tap = Math.max(0, sine(c.t, 0.7, c.seed)) * 0.02
  arm(o, ARM_R, 0.95, 0.1, 0, 1.75, -0.35, 0.8)
  arm(o, ARM_L, 0.95, 0.12, 0, 1.7, -0.3, 0.9)
  reach(o, REACH_R, -0.11, 1.07, 0.27)
  reach(o, REACH_L, 0.1 - 0.03 * read, 1.13 - tap, 0.31)
  o[U.chestPitch] = 0.05
  o[U.headPitch] = 0.4 + 0.04 * read
  o[U.headYaw] = 0.03 * noise1(c.t * 0.4, c.seed + 4)
  o[U.headRoll] = 0.04 * c.hand
}

/** Handing something forward: the right arm reaches out, palm up, with a small lean and a nod. */
function evalGive(c: PoseCtx, o: Out): void {
  const hold = 0.5 + 0.5 * sine(c.t, 0.35, c.seed)
  arm(o, ARM_R, 1.25, 0.12, 0, 0.55, 0.1, -0.9)
  arm(o, ARM_L, 0.06, c.armRoll, 0, c.armElbow + 0.1, 0, 0.2)
  reach(o, REACH_R, -0.1, 1.14 + 0.01 * hold, 0.5 + 0.02 * hold)
  o[U.chestPitch] = 0.1
  o[U.chestYaw] = -0.1
  o[U.headPitch] = 0.1 + 0.06 * sine(c.t, 0.5, c.seed)
  o[U.headYaw] = 0.05 * noise1(c.t * 0.3, c.seed + 25)
}

/** The handle height and reach of every pushed vehicle, in the pusher's frame (the vehicle models match them). */
export const HANDLE = { y: 0.98, ahead: 0.4, half: 0.18 } as const

/** Pushing a wheelchair, stretcher or cart: both hands on the handle, leaning in, eyes ahead. */
function evalPush(c: PoseCtx, o: Out): void {
  const breath = Math.sin(TAU * c.breathHz * c.t + c.seed)
  arm(o, ARM_L, 1.0, 0.1, 0, 0.35, 0, 1.4)
  arm(o, ARM_R, 1.0, 0.1, 0, 0.35, 0, 1.4)
  // the handle is fixed in space: the targets are scaled back so that, at this person's size, the hands land on it (the rig scales targets by `size`)
  const k = 1 / c.size
  reach(o, REACH_L, HANDLE.half * k, HANDLE.y * k, HANDLE.ahead * k)
  reach(o, REACH_R, -HANDLE.half * k, HANDLE.y * k, HANDLE.ahead * k)
  o[U.chestPitch] = 0.14 + 0.01 * breath
  o[U.headPitch] = -0.1 + 0.02 * breath
  o[U.headYaw] = 0.03 * noise1(c.t * 0.3, c.seed + 26)
}

/**
 * The mop: a pole from the floor to the cleaner's chest. Its head sweeps side to side in front of the cleaner while
 * the hands ride on the pole. Writes the two hand points and the head point (all root frame, nominal size).
 * `out` = [Lx, Ly, Lz, Rx, Ry, Rz, Hx, Hy, Hz, Bx, By, Bz].
 */
export const MOP = { sweepHz: 0.42, sweep: 0.5, headAhead: 0.7, top: { y: 1.18, z: 0.12 }, upperHand: 0.1, lowerHand: 0.32 } as const
export function mopPoints(t: number, seed: number, out: number[] | Float32Array | Float64Array): void {
  const s = Math.sin(TAU * MOP.sweepHz * t + seed)
  const hx = MOP.sweep * s
  const bx = -0.09 * s
  const by = MOP.top.y
  const bz = MOP.top.z
  const dx = bx - hx
  const dy = by
  const dz = bz - MOP.headAhead
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const ux = dx / len
  const uy = dy / len
  const uz = dz / len
  out[0] = bx - MOP.upperHand * ux
  out[1] = by - MOP.upperHand * uy
  out[2] = bz - MOP.upperHand * uz
  out[3] = bx - MOP.lowerHand * ux
  out[4] = by - MOP.lowerHand * uy
  out[5] = bz - MOP.lowerHand * uz
  out[6] = hx
  out[7] = 0
  out[8] = MOP.headAhead
  out[9] = bx
  out[10] = by
  out[11] = bz
}
const mopScratch = new Float64Array(12)

/** Mopping: both hands on the pole, the chest turning with the sweep, eyes on the floor ahead. */
function evalClean(c: PoseCtx, o: Out): void {
  mopPoints(c.t, c.seed, mopScratch)
  const s = Math.sin(TAU * MOP.sweepHz * c.t + c.seed)
  arm(o, ARM_L, 0.95, 0.05, 0, 0.9, 0, 1.2)
  arm(o, ARM_R, 0.85, 0.08, 0, 0.7, 0, 1.2)
  reach(o, REACH_L, mopScratch[0], mopScratch[1], mopScratch[2])
  reach(o, REACH_R, mopScratch[3], mopScratch[4], mopScratch[5])
  o[U.chestYaw] = -0.22 * s
  o[U.chestPitch] = 0.2
  o[U.chestRoll] = 0.04 * s
  o[U.headPitch] = 0.32
  o[U.headYaw] = 0.1 * s
}

function evalSit(c: PoseCtx, o: Out): void {
  const sway = noise1(c.t * 0.4, c.seed + 14)
  const breath = Math.sin(TAU * c.breathHz * c.t + c.seed)
  arm(o, ARM_L, 0.2 + 0.015 * sway, 0.1, 0, 1.05, -0.05, 0.9)
  arm(o, ARM_R, 0.2 - 0.015 * sway, 0.1, 0, 1.05, -0.05, 0.9)
  o[U.chestPitch] = -0.02 + 0.012 * breath + 0.02 * sway
  o[U.chestRoll] = 0.02 * noise1(c.t * 0.25, c.seed + 15)
  o[U.headPitch] = 0.03 + 0.02 * breath
  o[U.headYaw] = 0.09 * noise1(c.t * 0.3, c.seed + 16)
  o[U.headRoll] = 0.03 * noise1(c.t * 0.22, c.seed + 17)
}

function evalTyping(c: PoseCtx, o: Out): void {
  // bursts of typing between pauses to read: wrists flutter while "on", rest while "off"
  const on = clamp(0.5 + 1.6 * noise1(c.t * 0.5, c.seed + 18), 0, 1)
  const flutter = on * 0.05
  const f1 = Math.sin(c.t * 41 + c.seed)
  const f2 = Math.sin(c.t * 37 + c.seed * 1.7)
  const read = noise1(c.t * 0.3, c.seed + 19)
  arm(o, ARM_L, 0.42 + 0.02 * read, 0.1, 0, 1.3 + 0.02 * f2 * on, -0.22 + flutter * f1, 1.35)
  arm(o, ARM_R, 0.42 - 0.02 * read, 0.1, 0, 1.3 + 0.02 * f1 * on, -0.22 + flutter * f2, 1.35)
  o[U.chestPitch] = 0.1 + 0.02 * read
  o[U.headPitch] = 0.2 + 0.05 * read + 0.03 * on
  o[U.headYaw] = 0.04 * noise1(c.t * 0.25, c.seed + 20)
  o[U.headRoll] = 0.02 * noise1(c.t * 0.2, c.seed + 21)
}

/** Seated with a tablet in the lap, both hands on it, reading. */
function evalSitTablet(c: PoseCtx, o: Out): void {
  const read = noise1(c.t * 0.6, c.seed + 9)
  arm(o, ARM_R, 0.85, 0.1, 0, 1.95, -0.45, 0.55)
  arm(o, ARM_L, 0.75, 0.1, 0, 1.9, -0.4, 0.8)
  reach(o, REACH_R, -0.1, 0.98, 0.26)
  reach(o, REACH_L, 0.09, 1.0, 0.28)
  o[U.chestPitch] = 0.12
  o[U.headPitch] = 0.42 + 0.04 * read
  o[U.headYaw] = 0.03 * noise1(c.t * 0.4, c.seed + 4)
  o[U.headRoll] = 0.04 * c.hand
}

function evalSitListen(c: PoseCtx, o: Out): void {
  const t = c.t
  // slow nods now and then
  const nodGate = clamp((noise1(t * 0.22, c.seed + 22) - 0.1) * 3, 0, 1)
  const nod = nodGate * Math.sin(TAU * 0.9 * t + c.seed)
  const breath = Math.sin(TAU * c.breathHz * t + c.seed)
  arm(o, ARM_L, 0.24, -0.1, 0.15, 1.2, 0, 0.8)
  arm(o, ARM_R, 0.24, -0.1, -0.15, 1.2, 0, 0.8)
  o[U.chestPitch] = -0.05 + 0.012 * breath
  o[U.headPitch] = 0.02 + 0.06 * nod
  o[U.headYaw] = 0.06 * noise1(t * 0.18, c.seed + 23)
  o[U.headRoll] = 0.03 * noise1(t * 0.2, c.seed + 24)
}

/**
 * Lying on a bed or stretcher (the whole body is tipped flat by rig.ts; this is the pose in the body's own frame):
 * arms rest at the sides with soft elbows, the head lifted a little on the pillow, slow breathing.
 *
 * RECLINE (L1). In a ward bed with the head raised the torso bends at the waist while the legs stay flat. rig.ts tips the whole
 * upright body flat, so a forward lean of the chest here is a torso raised off the mattress there: `chestPitch = phi`, the angle
 * of the backrest. The head follows the torso and keeps the pillow lift (the rig gives the head back half of the chest's pitch,
 * so it is asked for half of phi extra). The arms hang along the torso (pitch about 0), which dips the elbows to the blanket, and
 * the elbows bend by phi so the forearms lie along the mattress with the hands on the blanket at the waist.
 */
function evalLie(c: PoseCtx, o: Out): void {
  const breath = Math.sin(TAU * c.breathHz * 0.8 * c.t + c.seed)
  const shift = noise1(c.t * 0.12, c.seed + 27)
  const phi = reclineAngle(c.recline)
  const r = phi / (Math.PI / 4)
  // hands rest on the mattress beside the hips: in the upright frame that is slightly behind the body line
  arm(o, ARM_L, -0.12 + 0.12 * r + 0.02 * shift, 0.24, 0, 0.12 + 0.9 * phi, 0.05, 0.5)
  arm(o, ARM_R, -0.12 + 0.12 * r - 0.02 * shift, 0.24, 0, 0.12 + 0.9 * phi, 0.05, 0.5)
  o[U.chestPitch] = 0.012 * breath + phi
  o[U.headPitch] = 0.2 + 0.5 * phi + 0.012 * breath
  o[U.headYaw] = 0.12 * noise1(c.t * 0.1, c.seed + 28)
  o[U.headRoll] = 0.04 * noise1(c.t * 0.13, c.seed + 29)
}

/** Fill `o` (UP_COUNT floats) with the pose of `mode` at the context's time. Every entry is written. */
export function evalMode(mode: Mode, c: PoseCtx, o: Out): void {
  o.fill(0)
  switch (mode) {
    case 'relaxed':
      return evalRelaxed(c, o)
    case 'talk':
      return evalTalk(c, o, false)
    case 'wave':
      return evalWave(c, o)
    case 'tablet':
      return evalTablet(c, o)
    case 'give':
      return evalGive(c, o)
    case 'push':
      return evalPush(c, o)
    case 'clean':
      return evalClean(c, o)
    case 'sit':
      return evalSit(c, o)
    case 'typing':
      return evalTyping(c, o)
    case 'sitTalk':
      return evalTalk(c, o, true)
    case 'sitTablet':
      return evalSitTablet(c, o)
    case 'sitListen':
      return evalSitListen(c, o)
    case 'lie':
      return evalLie(c, o)
  }
}

const scratch = new Float32Array(UP_COUNT)

/**
 * Weighted sum of every mode with a weight above a hair. `weights` is the blender's weight array (sums to 1).
 * `acc` receives the blended pose (angles and the premultiplied reach block).
 */
export function blendUpper(weights: ArrayLike<number>, c: PoseCtx, acc: Out): void {
  acc.fill(0)
  let used = 0
  for (let i = 0; i < MODES.length; i++) used += weights[i] > 1e-3 ? weights[i] : 0
  const inv = used > 0 ? 1 / used : 1
  for (let i = 0; i < MODES.length; i++) {
    const w = weights[i]
    if (!(w > 1e-3)) continue
    evalMode(MODES[i], c, scratch)
    const k = w * inv
    for (let j = 0; j < UP_COUNT; j++) acc[j] += scratch[j] * k
  }
}
