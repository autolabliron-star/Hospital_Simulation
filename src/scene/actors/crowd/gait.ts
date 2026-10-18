// Ported from Waltz City (src/scene/actors/crowd/gait.ts). W1 adds the speed-dependent gait (a brisk walk and a run, with a flight phase) for the player; the walk up to 1.4 m/s is
// Waltz's, number for number.
/**
 * Footfall planner: where each foot is, in the world, every frame.
 *
 * This is the answer to reference bug 5 (a bad walk cycle: feet sliding, steps out of step with the speed).
 * It does not play a canned clip. Each foot is either PLANTED, which means it stays at one fixed world
 * position (so it cannot slide however the body moves above it), or SWINGING to a landing spot that is
 * predicted from where the body is going. A foot swings when it has been left too far behind the body, so
 * the number of steps follows the DISTANCE travelled, never the time: stand still and nothing steps, walk
 * twice as far and you take (about) twice as many steps. The same rule handles every other case:
 *
 *   starting     the body moves off, the rear foot is left behind, it steps, then the other one
 *   stopping     the body halts with a foot trailing, which steps up to its rest position
 *   turning      a planted foot whose toes point too far from the body's heading steps round
 *   standing     feet stay put while the pelvis sways above them (see rig.ts), they only re-home when
 *                the body has drifted away from them
 *
 * Step length and swing time follow the walking speed (a tall person strides further), arm swing and
 * pelvis sway are driven from the actual foot positions (`gait`, `stance`), so the whole body stays in
 * step with the legs by construction.
 *
 * SPEED-DEPENDENT GAIT (W1: the player walks at 2 m/s and runs at 4.2). `gaitParams` turns the speed into the numbers the planner
 * works with: where a foot lands ahead of the body (`sl`), how far behind it may trail before it lifts (`sb`), the swing time, and
 * the `gate`, the fraction of the other foot's swing that must be over before this one may lift.
 *
 *   up to 1.4 m/s    the original walk (every NPC): the numbers and the code path are the old ones, frame for frame (gait.test.ts compares)
 *   1.4 to about 2.2 a brisk walk, blended in from the old one: cadence rises with speed (2.05 steps/s at 1.4, about 2.5 at 2.0), the
 *                    step is 0.7 to 0.85 m, the swing is under half the cycle, the foot lands a little nearer the body than it leaves it
 *   2.2 to 2.8       a smooth blend to a run
 *   from about 2.4   a run: cadence 2.7 to 3.1 steps/s, step 0.9 to 1.6 m (1.4 m at 4.2), the foot lands under the body (0.3 m ahead),
 *                    a swing longer than a step, so BOTH feet are off the ground for a moment (the flight phase: `gate` < 1 lets the
 *                    next foot lift before the last one has landed), a higher knee and heel lift
 *
 * Why it is built this way. In steady state a foot is planted for (sl + sb) / v seconds and in the air for `dur`, so one foot's cycle
 * is T = (sl + sb) / v + dur, a step takes T / 2 and the step length is v T / 2. Feet alternate when a step takes at least as long as
 * a swing (T / 2 >= dur), and the old planner broke that rule above about 1.9 m/s (its swing time grew with speed while its stride
 * did not), which is what forced the emergency "lunge" steps. `gaitParams` derives (sl + sb) from the cadence and the swing
 * fraction, so the rule holds by construction at every speed.
 *
 * Three more things keep the new gait steady where the old one drifted into a limp:
 *   the lock      the old feet were two independent oscillators that only avoided each other, so a start from rest that gave them an uneven
 *                 rhythm (a short step then a long one) kept it for ever, and the long steps were the lunges. Here a foot lifts half a
 *                 cycle (`gap`) after the other one lifted, so the rhythm is even within a step or two of any start or turn.
 *   the start     the first swing after rest is short (the body is away before a normal one would end) and a foot that is a tenth past
 *                 its limit lifts without waiting for the other (a brief scramble) instead of waiting until the leg cannot reach.
 *   the swing     a foot starts with the body's own speed (`swingEase`), so a runner's trailing foot is not left 0.8 m behind the pelvis.
 * The arms and torso follow a smooth stride phase (`swing`, a cosine of each foot's own cycle) rather than the difference of the foot
 * positions (`gait`), which stops changing while both feet are down.
 *
 * DRIVEN BODY (W3: the player). Everybody else is planned from a speed measured after the fact (a 0.1 s lag), which is right for an NPC that
 * walks at a steady pace and wrong for a body that starts in 0.35 s, stops in 0.28 s and backs up. `updatePlanter(..., intent)` is given the
 * body's TRUE velocity and what its keys ask for (`PlanterIntent`, the contract `walkBody`), and plans from that:
 *
 *   starting     the first step lifts on the first frame the keys ask for movement (`moving` follows the wish, not the measured speed), quick
 *                (`DRIVEN.firstSwing`), so a foot is down within 0.2 s and the body never outruns its legs
 *   direction    the stride offset and the "left behind" measure follow the direction of MOTION (the velocity, or the wish while slow), not the
 *                facing: backing up takes real steps backwards, the arms still swing against the legs in space
 *   stopping     the swing targets are the REST point the body will stop at plus the lateral foot offset, so the last step lands under the body;
 *                a planted foot more than 0.12 m from its rest spot steps, the farther one first, one step per foot once the body is still
 *   turning      on the spot a foot re-plants at 0.45 rad of (predicted: 0.15 s ahead at the turn rate) mismatch, swings 0.24 s, the foot on
 *                the turn side first, the second waits until the first is 60 % through; when the turn is over the feet close up to 0.14 rad
 *
 * With `intent` null every line below runs as it always did (gait.test.ts compares the NPCs' feet frame by frame against the old planner).
 *
 * Pure maths, no three.js. All positions are world metres, headings follow the simulation (0 faces +Z).
 */
import { clamp, damp, smoother01, smoothstep, wrapPi } from './math'

export interface Foot {
  /** Ankle position on the ground plane, world. */
  x: number
  z: number
  /** Foot heading, world radians. */
  yaw: number
  /** Ankle height above its resting height: the swing arc plus the heel or toe contact allowance. */
  lift: number
  /** Toe pitch, positive = toes up. */
  pitch: number
  stepping: boolean
  /** Swing progress 0..1 and the swing's duration in seconds. */
  t: number
  dur: number
  /** Where the swing started (kept for debugging and tests). */
  sx: number
  sz: number
  spitch: number
  /** Where it is heading, re-predicted every frame. */
  tx: number
  tz: number
  tyaw: number
  /** Footfalls so far. */
  steps: number
  /** How this swing is eased (see `swingEase`): the blend from the old curve to the new one, and the share of the foot's world travel that is the body's own. */
  mix: number
  lam: number
  /** The planter's clock when the last swing began (the other foot may not lift sooner than half a cycle after it, see `GaitParams.gap`). */
  liftAt: number
}

export interface Planter {
  /** 0 = left, 1 = right. */
  feet: [Foot, Foot]
  /** Walking, with hysteresis. */
  moving: boolean
  /** +1 left foot furthest ahead, -1 right foot furthest ahead, 0 together. */
  gait: number
  /** Weight on each foot: 1 planted, falling to 0 half way through a swing. */
  stance: [number, number]
  /** Metres travelled and footfalls taken since creation (tests and debugging). */
  distance: number
  steps: number
  /** Index of the foot that stepped last, to check that feet alternate. */
  lastStepper: number
  initialised: boolean
  px: number
  pz: number
  /**
   * A smooth stride phase for the arms and torso: +1 when the left foot is at its heel strike (furthest ahead), -1 for the right.
   * `gait` is the difference of the foot positions, which stops changing while both feet are down; this one is a cosine of each foot's
   * own cycle phase, so it never freezes, and it is what the swinging arms follow once the person is walking briskly.
   */
  swing: number
  /** The walk to run blend of the last update (0 walking, 1 running) and the runner's vertical bounce in metres (nominal body, + up). */
  run: number
  bounce: number
  /** Both feet off the ground right now (a run's flight phase) and how long this flight has lasted, seconds (tests and debugging). */
  air: boolean
  airTime: number
  /** Steps that were started although the other foot was still in the air and the gate was shut: emergencies (the leg ran out of reach). */
  forced: number
  /** Seconds since the planter began (the time base of the lift-off gap). */
  clock: number
  /** Swings begun so far, and the count when the person last began to walk: no swing since then means the next one is the first step of a start from rest. */
  lifts: number
  liftsAtMove: number
  /** Going faster than the NPCs' walk, or not yet back at rest since: a person who stops from a brisk walk closes their feet one at a time, without a hop. */
  fast: boolean
  /** What `gaitParams` said for the last update (the swing time of the step in progress, the cadence, ...). */
  params: GaitParams
  /** Footfalls (heel strikes) of the last update, and the foot (0 left, 1 right) of the latest one (-1 before the first). The player's footsteps and camera bob read these. */
  landed: number
  lastLanded: number
  // --- the driven path (`PlanterIntent`) ---
  /** Seconds a move key has been held without a break, and seconds the body has been at rest (speed under `DRIVEN.settleSpeed`; 0 while it moves). */
  wishFor: number
  restFor: number
  /** Footfalls of each foot since the body came to rest (a foot closes up to its rest spot once). */
  restSteps: [number, number]
  /** The first step of a start is due at once. */
  kick: boolean
  /** The clock of the last re-plant for a turn on the spot (feet close up to the new heading for a while after). */
  turnAt: number
  /** At a stop: a foot is due to step but the other one has not landed yet (it lands in a hurry). */
  waiting: boolean
  /** The body was going against what the keys ask for last frame (backing up, and then W): when that ends the legs start afresh. */
  opposing: boolean
}

export const GAIT = {
  /** Lateral distance of a foot from the body's centre line. */
  homeLat: 0.115,
  toeOut: 0.1,
  /** Standing: a planted foot this far from its rest spot gets re-homed. */
  idleStepDist: 0.2,
  idleStepYaw: 0.7,
  moveOn: 0.22,
  moveOff: 0.12,
  swingIdle: 0.3,
  liftIdle: 0.032,
  /** Beyond this the leg cannot reach: step at once whatever the other foot is doing (a gait with a longer stride lifts the limit with it). */
  maxReach: 0.58,
  /** A jump bigger than this between frames is a teleport, not a step. */
  teleport: 2.5,
} as const

/** The driven body (W3). Distances in metres, times in seconds, angles in radians. */
export const DRIVEN = {
  /** A move key is held when the wished speed is above this (m/s). */
  wishOn: 0.05,
  /** The body is at rest below this speed (m/s). */
  settleSpeed: 0.05,
  /** The first swing of a start from rest: a foot is down within 0.2 s of the first input. */
  firstSwing: 0.17,
  /** and it lands this share of a steady stride ahead of the body. */
  firstStride: 0.75,
  /**
   * The second and third steps of a start trail and wait for less than a steady stride (a share of the trailing limit and of the time between lifts):
   * the body is pulling away at full acceleration, and the foot that stayed behind must follow before it is left 0.5 m back.
   */
  startScale: [0.5, 0.85] as readonly number[],
  /** And their swings are quicker than a steady one (seconds), so the rhythm grows into the steady one without two feet in the air at once. The lock between lifts is off for as many steps. */
  startSwing: [0.2, 0.27, 0.33, 0.36] as readonly number[],
  /** The time between lifts of the first steps as a share of the steady one (`GaitParams.gap`). */
  startGap: [0.45, 0.6, 0.8, 0.92] as readonly number[],
  /** Stopping: a planted foot this far from its rest spot steps; the swing of such a step. */
  restThreshold: 0.12,
  stopSwing: 0.26,
  /** At a stop a planted foot may trail the body this far (m, nominal body) before it lifts whatever the other foot is doing: it is the limit the legs can take without the pelvis sinking. */
  stopTrail: 0.42,
  /** A swing that has longer than that to go when the stop begins runs this much faster. */
  stopBoost: 1.7,
  /** Turning on the spot: re-plant at this yaw mismatch, predicted this far ahead at the turn rate; the swing; when the second may lift; the closing-up threshold after a turn. */
  turnReplant: 0.45,
  turnLead: 0.15,
  turnSwing: 0.24,
  turnGate: 0.6,
  turnSettle: 0.14,
  /** Above this turn rate (rad/s) the body is turning, not standing. */
  turning: 0.25,
  /** The body has turned round (backing up, then W): a foot still in the air has this long left to come down (s). */
  reverseSwing: 0.15,
  /** How far ahead (in frames of travel) the moving planner looks when it asks whether a foot is out of reach: the NPCs' is half a frame, a run at 30 fps wants a whole one. */
  lookAhead: 1,
  /** Move keys held for this long without moving: the body is blocked, the feet stop stepping. */
  stalled: 0.5,
} as const

/** Speeds (m/s) that shape the gait: the old walk holds up to `walk`, the brisk walk is fully in by `brisk`, the run blends in over `runFrom`..`runTo`. */
export const SPEEDS = { walk: 1.4, brisk: 2.0, runFrom: 2.2, runTo: 2.8 } as const

/** The vertical bounce of a runner (nominal body, metres): how far the body sinks during a foot's stance and rises during the flight. */
export const BOUNCE = { dip: 0.01, rise: 0.01, follow: 30 } as const

/** Half the ankle excursion front to back at walking speed `v` (m/s) for a nominal body. */
export function halfStride(v: number): number {
  return clamp(0.15 + 0.17 * v, 0.15, 0.46)
}

/** Duration of a swing at speed `v`. */
export function swingTime(v: number): number {
  return clamp(0.36 + 0.043 * v, 0.3, 0.5)
}

/** 0 walking .. 1 running, from the (smoothed) ground speed: the blend of the gait, the arm swing and the torso lean. */
export function runBlend(speed: number): number {
  return smoothstep(SPEEDS.runFrom, SPEEDS.runTo, speed)
}

/** 0 at the old walk (and below) .. 1 at the brisk walk and above: how far from the NPC gait a person has moved. */
export function briskBlend(speed: number): number {
  return smoothstep(SPEEDS.walk, SPEEDS.brisk, speed)
}

/** What the planner works with at one speed (all lengths scaled by the person's size, times are not). */
export interface GaitParams {
  /** Where a foot lands ahead of the body, and how far behind the body it trails before it lifts (metres). */
  sl: number
  sb: number
  /** Seconds a swing lasts. */
  dur: number
  /** The fraction of the other foot's swing that has to be over before this foot may lift: 1 in a walk (the other one is down), less in a run (the flight). */
  gate: number
  /** Peak height of the ankle in a swing (metres). */
  lift: number
  /** 0 walking .. 1 running. */
  run: number
  /** Steps per second at steady speed, and the share of a foot's cycle it spends in the air (> 0.5 means a flight phase). */
  cadence: number
  swingFrac: number
  /**
   * The time between one foot's lift-off and the other's, seconds: a step (0 for the old walk). Without it the two feet are independent
   * oscillators that only avoid each other, so whatever uneven rhythm they start in (a short step, then a long one) they keep for ever.
   * With it a foot may not lift much sooner than this after the other, and one that is two thirds of the way to its lift-off point does so
   * once the time is up: the rhythm is locked to half a cycle within a step or two.
   */
  gap: number
}

export function createGaitParams(): GaitParams {
  return { sl: 0.15, sb: 0.15, dur: 0.36, gate: 1, lift: 0.03, run: 0, cadence: 0, swingFrac: 0.43, gap: 0 }
}

/**
 * The gait at speed `v` (m/s, 0 when standing) for a body of size `scale`. Writes into `out` and returns it; allocates nothing.
 * For v <= 1.4 this is the original walk, number for number.
 */
export function gaitParams(v: number, scale: number, out: GaitParams): GaitParams {
  const S0 = halfStride(v)
  const dur0 = swingTime(v)
  const lift0 = 0.03 + 0.045 * clamp(v / 1.4, 0, 1.3)
  out.run = 0
  out.gate = 1
  out.gap = 0
  // the original walk: a foot lands S0 ahead and lifts S0 behind, so a cycle is 2 S0 / v + dur0
  const vv = v < 0.05 ? 0.05 : v
  const f0 = 1 / (S0 / vv + dur0 / 2)
  const phi0 = clamp((dur0 * f0) / 2, 0.15, 0.7)
  if (v <= SPEEDS.walk) {
    out.sl = S0 * scale
    out.sb = out.sl
    out.dur = dur0
    out.lift = lift0
    out.cadence = f0
    out.swingFrac = phi0
    return out
  }
  const vc = v > 8 ? 8 : v
  // the brisk walk, blended in from the old one
  const kb = briskBlend(vc)
  const f1 = Math.min(2.7, 2.05 + 0.68 * (vc - SPEEDS.walk))
  const phi1 = Math.min(0.5, 0.43 + 0.1 * (vc - SPEEDS.walk))
  const share1 = 0.5 - 0.05 * clamp((vc - SPEEDS.walk) / 0.6, 0, 1)
  let f = f0 + (f1 - f0) * kb
  let phi = phi0 + (phi1 - phi0) * kb
  let share = 0.5 + (share1 - 0.5) * kb
  let lift = lift0 + 0.02 * smoothstep(1.8, 2.4, vc)
  // the run
  const w = runBlend(vc)
  if (w > 0) {
    // a run is specified by its cadence and by the share of each step the body spends in the air (the flight): the stance then takes the rest of
    // the step, and the foot's swing (in the air for `phi` of its cycle) is the stance's complement: phi = (1 + flight share) / 2
    const f2 = Math.min(3.7, 2 + 0.333 * vc)
    const flight2 = 0.16 + 0.17 * (1 - Math.exp(-Math.max(vc - 2.6, 0) / 0.9))
    const phi2 = (1 + flight2) / 2
    f += (f2 - f) * w
    phi += (phi2 - phi) * w
    share += (0.31 - share) * w
    lift += (0.16 + 0.06 * clamp(vc - 2.6, 0, 2) - lift) * w
  }
  const cycle = 2 / f
  const travel = vc * cycle * (1 - phi)
  out.sl = share * travel * scale
  out.sb = (1 - share) * travel * scale
  out.dur = phi * cycle
  out.gate = phi <= 0.5 ? 1 : (0.92 * 0.5) / phi
  out.gap = 1 / f
  out.lift = lift
  out.run = w
  out.cadence = f
  out.swingFrac = phi
  return out
}

/**
 * Toe pitch of a planted foot from how far through its stance it is (`ps` = +1 at the front limit, -1 at the back limit). A runner lands
 * flatter (less heel up) and pushes off further onto the toes.
 */
export function stancePitch(ps: number, motion: number, run = 0): number {
  const heel = 0.18 * (1 - 0.75 * run) * smoothstep(0.5, 1.0, ps)
  const toe = -(0.65 + 0.5 * run) * smoothstep(-0.35 + 0.2 * run, -1.0 + 0.1 * run, ps)
  return motion * (heel + toe)
}

/** Ankle height allowance so a pitched foot's heel (toes up) or ball (toes down) stays on the ground. */
export function contactLift(pitch: number): number {
  return pitch >= 0 ? 0.07 * Math.sin(pitch) : 0.13 * Math.sin(-pitch)
}

/**
 * How far a foot has come in its swing, 0..1, at progress `t`. The old walk eases the foot's WORLD position with a smootherstep, which
 * starts and stops it gently. That is fine at a stroll, but a body moving at 4 m/s runs on ahead of a foot that starts slowly, so the
 * trailing foot would be left 0.8 m behind the body (more than the leg can reach). Here the foot starts with the body's own speed
 * (`lam`, the body's share of the foot's travel) and still ends with zero speed over the ground at touchdown: a cubic with e'(0) = lam,
 * e'(1) = 0. `mix` blends from the old curve (0, for the NPCs' walk) to this one (1).
 */
export function swingEase(t: number, mix: number, lam: number): number {
  const old = smoother01(t)
  if (mix <= 0) return old
  const t2 = t * t
  const cubic = lam * t + (3 - 2 * lam) * t2 - (2 - lam) * t2 * t
  return old + (cubic - old) * mix
}

function makeFoot(): Foot {
  return { x: 0, z: 0, yaw: 0, lift: 0, pitch: 0, stepping: false, t: 0, dur: GAIT.swingIdle, sx: 0, sz: 0, spitch: 0, tx: 0, tz: 0, tyaw: 0, steps: 0, mix: 0, lam: 0, liftAt: -1e9 }
}

export function createPlanter(): Planter {
  return {
    feet: [makeFoot(), makeFoot()],
    moving: false,
    gait: 0,
    stance: [1, 1],
    distance: 0,
    steps: 0,
    lastStepper: -1,
    initialised: false,
    px: 0,
    pz: 0,
    swing: 0,
    run: 0,
    bounce: 0,
    air: false,
    airTime: 0,
    forced: 0,
    clock: 0,
    lifts: 0,
    liftsAtMove: 0,
    fast: false,
    params: createGaitParams(),
    landed: 0,
    lastLanded: -1,
    wishFor: 0,
    restFor: 0,
    restSteps: [0, 0],
    kick: false,
    turnAt: -1e9,
    waiting: false,
    opposing: false,
  }
}

/** Put both feet at rest under the body (spawn, teleport). */
export function resetPlanter(p: Planter, x: number, z: number, heading: number, scale = 1): void {
  const lx = Math.cos(heading)
  const lz = -Math.sin(heading)
  for (let i = 0; i < 2; i++) {
    const f = p.feet[i]
    const side = i === 0 ? 1 : -1
    const lat = side * GAIT.homeLat * scale
    f.x = x + lx * lat
    f.z = z + lz * lat
    f.yaw = heading + side * GAIT.toeOut
    f.lift = 0
    f.pitch = 0
    f.stepping = false
    f.t = 0
  }
  p.moving = false
  p.fast = false
  p.gait = 0
  p.swing = 0
  p.run = 0
  p.bounce = 0
  p.air = false
  p.airTime = 0
  p.stance[0] = 1
  p.stance[1] = 1
  // (a person who sits down is reset every frame: nothing has landed)
  p.landed = 0
  p.kick = false
  p.waiting = false
  p.opposing = false
  p.wishFor = 0
  p.restFor = 0
  p.restSteps[0] = 0
  p.restSteps[1] = 0
  p.px = x
  p.pz = z
  p.initialised = true
}

function f0Stepping(p: Planter): boolean {
  return p.feet[0].stepping || p.feet[1].stepping
}

function beginStep(f: Foot, dur: number, mix: number, lam: number): void {
  f.stepping = true
  f.t = 0
  f.dur = dur
  f.mix = mix
  f.lam = lam
  f.sx = f.x
  f.sz = f.z
  f.spitch = f.pitch
  f.tx = f.x
  f.tz = f.z
  f.tyaw = f.yaw
}

/**
 * What the body asks of the legs: the structural subset of `walkBody` (src/scene/player/state.ts) that the planner reads. `RigInput` has the same
 * fields, so the rig hands itself over.
 */
export interface PlanterIntent {
  /** The speed spring's acceleration (m/s^2, world). */
  ax: number
  az: number
  /** Heading rate, rad/s, positive = `atan2(dx, dz)` growing (a turn to the left). */
  turnRate: number
  /** The velocity the keys ask for (m/s); 0 with no key held. */
  wishX: number
  wishZ: number
  /** No key held, still coasting to a stop. */
  stopping: boolean
  /** Where the body will come to rest. */
  restX: number
  restZ: number
}

/**
 * The summaries every update ends with, for the arms, the torso and the pelvis: the stride phase, the stance weights, the flight and the bounce.
 * `aLeft` / `aRight` are how far each foot is ahead of the body along its direction of motion (the foot's own cycle), `gaitL` / `gaitR` along the
 * facing (the legs as they swing in space: the difference drives the arms), `flip` is -1 when the body backs up (the arms still swing against the legs).
 */
function finish(p: Planter, dt: number, gp: GaitParams, sl: number, sb: number, ref: number, run: number, aLeft: number, aRight: number, gaitL: number, gaitR: number, flip: number): void {
  p.gait = clamp((gaitL - gaitR) / (2 * ref), -1, 1)
  const stanceShare = 1 - gp.swingFrac
  let cosL = 0
  let cosR = 0
  for (let i = 0; i < 2; i++) {
    const f = p.feet[i]
    p.stance[i] = f.stepping ? 0.5 + 0.5 * Math.cos(2 * Math.PI * f.t) : 1
    // where this foot is in its own cycle, 0 at its touchdown: the stance first (by how far the body has gone over it), then the swing
    let phase: number
    if (f.stepping) phase = stanceShare + gp.swingFrac * f.t
    else phase = stanceShare * clamp(((i === 0 ? sl - aLeft : sl - aRight)) / Math.max(sl + sb, 1e-3), 0, 1)
    const c = Math.cos(2 * Math.PI * phase)
    if (i === 0) cosL = c
    else cosR = c
  }
  p.swing = clamp(0.5 * (cosL - cosR) * flip, -1, 1)

  // flight and bounce: both feet in the air is a run's flight phase; a runner sinks over the planted foot and rises in the flight
  const f0 = p.feet[0]
  const f1 = p.feet[1]
  p.air = f0.stepping && f1.stepping
  p.airTime = p.air ? p.airTime + dt : 0
  p.run = run
  let target = 0
  if (run > 0.001) {
    if (f0.stepping !== f1.stepping) {
      const a = f0.stepping ? aRight : aLeft
      const u = clamp((sl - a) / Math.max(sl + sb, 1e-3), 0, 1)
      target = -BOUNCE.dip * Math.sin(Math.PI * u)
    } else if (p.air) {
      // the foot that lifted last has the smaller progress; the flight ends when the other one lands
      const last = f0.t < f1.t ? f0 : f1
      const first = last === f0 ? f1 : f0
      const elapsed = last.t * last.dur
      const left = (1 - first.t) * first.dur
      target = BOUNCE.rise * Math.sin((Math.PI * elapsed) / Math.max(elapsed + left, 1e-4))
    }
    target *= run
  }
  p.bounce = damp(p.bounce, target, BOUNCE.follow, dt)
}

/**
 * How far the body goes along its motion in the next `tau` seconds: its acceleration `a` (m/s^2, along the motion) holds until it reaches the wished speed
 * `w` (or halts), then it goes on at that speed. The spring's own acceleration dies away, so this runs a little ahead of it; the landing spot is
 * re-predicted every frame, and the error is gone by the time the foot lands.
 */
function predictTravel(v: number, a: number, w: number, tau: number): number {
  let ta = tau
  if (a > 1e-3) {
    const r = (w - v) / a
    if (r < ta) ta = r > 0 ? r : 0
  } else if (a < -1e-3) {
    const r = v / -a
    if (r < ta) ta = r
  }
  const ve = v + a * ta
  return v * ta + 0.5 * a * ta * ta + (ve > 0 ? ve : 0) * (tau - ta)
}

/**
 * Advance the planter by `dt` seconds.
 * @param x,z      body position (the entity's, on the ground)
 * @param heading  body heading
 * @param vx,vz    body velocity, m/s (smoothed)
 * @param speed    body speed, m/s (smoothed)
 * @param scale    the person's size relative to the nominal body (strides and foot spacing scale with it)
 * @param intent   null for everybody that is measured (the NPCs, and the player before the player system is live); for the driven body the true
 *                 velocity is passed as vx, vz, speed and this carries what its keys ask for (see the header, "DRIVEN BODY")
 */
export function updatePlanter(p: Planter, dt: number, x: number, z: number, heading: number, vx: number, vz: number, speed: number, scale: number, intent: PlanterIntent | null = null): void {
  if (intent !== null) {
    updateDriven(p, dt, x, z, heading, vx, vz, speed, scale, intent)
    return
  }
  if (!p.initialised) resetPlanter(p, x, z, heading, scale)
  p.clock += dt
  p.landed = 0
  const moved = Math.sqrt((x - p.px) * (x - p.px) + (z - p.pz) * (z - p.pz))
  if (moved > GAIT.teleport) resetPlanter(p, x, z, heading, scale)
  else p.distance += moved
  p.px = x
  p.pz = z

  if (p.moving) {
    if (speed < GAIT.moveOff) p.moving = false
  } else if (speed > GAIT.moveOn) {
    p.moving = true
    p.liftsAtMove = p.lifts
  }
  const moving = p.moving
  const v = moving ? speed : 0
  const sh = Math.sin(heading)
  const ch = Math.cos(heading)
  // forward (fx, fz) and left (lx, lz) unit vectors on the ground
  const fx = sh
  const fz = ch
  const lx = ch
  const lz = -sh
  const gp = gaitParams(v, scale, p.params)
  const sl = gp.sl
  const sb = gp.sb
  const run = gp.run
  // the old planner used one half stride for both ends; for the walk of the NPCs sl === sb, so this is that number
  const S = (sl + sb) * 0.5
  const homeLat = GAIT.homeLat * scale
  // the brisk gait tolerates more sideways drift of a planted foot (a curving path swings the feet sideways by a handbreadth over a stance)
  const kb = briskBlend(v)
  const latTol = 0.16 * scale * (1 + 0.7 * kb)
  if (gp.gap > 0) p.fast = true
  const motion = clamp(speed / 1.2, 0, 1)
  // the leg's reach: the old planner's, which the old gait's longest stride (0.46 m) stays inside; the new gait's longest (0.55 m) fits inside it too
  const reach = GAIT.maxReach * scale

  // 1. advance swings. A foot moves a fraction of the way to its (moving) target each frame, so a target that
  //    changes mid-swing bends the path instead of making the foot jump.
  for (let i = 0; i < 2; i++) {
    const f = p.feet[i]
    if (!f.stepping) continue
    const side = i === 0 ? 1 : -1
    const e0 = swingEase(f.t, f.mix, f.lam)
    f.t = Math.min(1, f.t + dt / f.dur)
    const e1 = swingEase(f.t, f.mix, f.lam)
    const remaining = (1 - f.t) * f.dur
    if (moving) {
      f.tx = x + vx * remaining + fx * sl + lx * side * homeLat
      f.tz = z + vz * remaining + fz * sl + lz * side * homeLat
    } else {
      f.tx = x + lx * side * homeLat
      f.tz = z + lz * side * homeLat
    }
    f.tyaw = heading + side * GAIT.toeOut
    const k = e1 >= 1 || e0 >= 1 ? 1 : (e1 - e0) / (1 - e0)
    f.x += (f.tx - f.x) * k
    f.z += (f.tz - f.z) * k
    f.yaw += wrapPi(f.tyaw - f.yaw) * k
    const liftH = moving ? gp.lift : GAIT.liftIdle
    const arc = liftH * Math.sin(Math.PI * f.t)
    // toes go from where they were at lift-off to slightly up at touchdown (a runner lands flatter)
    const landPitch = 0.18 * motion * (1 - 0.75 * run)
    f.pitch = f.spitch + (landPitch - f.spitch) * smoothstep(0, 0.85, f.t)
    f.lift = arc + contactLift(f.pitch)
    if (f.t >= 1) {
      f.stepping = false
      f.x = f.tx
      f.z = f.tz
      f.yaw = f.tyaw
      f.steps++
      p.steps++
      p.landed++
      p.lastLanded = i
    }
  }

  // 2. planted feet: pitch from stance progress, then decide whether one has to step
  let worst = -1
  let worstRatio = 0
  let aLeft = 0
  let aRight = 0
  for (let i = 0; i < 2; i++) {
    const f = p.feet[i]
    const side = i === 0 ? 1 : -1
    const dx = f.x - x
    const dz = f.z - z
    const a = dx * fx + dz * fz
    const lat = dx * lx + dz * lz
    const b = lat - side * homeLat
    if (i === 0) aLeft = a
    else aRight = a
    if (f.stepping) continue
    const ps = a >= 0 ? a / Math.max(sl, 0.15 * scale) : a / Math.max(sb, 0.15 * scale)
    f.pitch = damp(f.pitch, stancePitch(ps, motion, run), 14 + 16 * kb + 24 * run, dt)
    // toe-off: in the last part of a runner's stance the heel peels off the ground and the ankle rises, which is what lets the trailing leg reach
    f.lift = contactLift(f.pitch) + (run > 0 ? 0.05 * run * smoothstep(0.75, 1.05, -a / sb) : 0)
    const yawErr = Math.abs(wrapPi(f.yaw - (heading + side * GAIT.toeOut)))
    let ratio: number
    if (moving) {
      // the new gait looks half a frame ahead (at 4 m/s a frame is 7 cm of the leg's reach); the old one never did
      const back = gp.gap > 0 ? -(a - 0.5 * (vx * fx + vz * fz) * dt) : -a
      ratio = Math.max(back / sb, Math.abs(b) / latTol, yawErr / 0.8)
    } else {
      ratio = Math.max(Math.sqrt(a * a + b * b) / (GAIT.idleStepDist * scale), yawErr / GAIT.idleStepYaw)
    }
    if (Math.sqrt(a * a + lat * lat) > reach) ratio = Math.max(ratio, 1.9)
    // the lock: a foot that has left the body a little behind is due once a step's time has passed since the other one lifted, even if it has not
    // quite reached its limit. The two feet then lift exactly half a cycle apart whatever rhythm they started in (a start from rest, a turn).
    if (gp.gap > 0 && ratio < 1 && -a >= 0.25 * sb && p.clock + 0.5 * dt - p.feet[1 - i].liftAt >= gp.gap) ratio = 1
    if (ratio > worstRatio) {
      worstRatio = ratio
      worst = i
    }
  }
  if (worst >= 0 && worstRatio >= 1) {
    const other = p.feet[1 - worst]
    // alternate: the other foot must be down (or, in a run, far enough through its swing: the flight phase), unless this one has really run out of leg
    const open = (!other.stepping || other.t >= gp.gate) && (gp.gap === 0 || p.clock - other.liftAt >= 0.85 * gp.gap)
    // the new gait does not let a foot trail more than a tenth past its limit for the sake of the other one's landing (the old one waited until
    // the leg could not reach at all, which is the lunge). A start from rest is the case: the body is away before the first swing is over.
    // (in the first two steps of a start to a run the foot is let go at its limit: the body is pulling away at full speed)
    const overdue = gp.gap > 0 && worstRatio >= (gp.run > 0 && p.lifts - p.liftsAtMove < 2 ? 1 : 1.1)
    if (open || overdue || worstRatio > (p.fast && !moving ? 2.6 : 1.8)) {
      if (!open && other.stepping && other.t < 0.9) p.forced++
      // the foot's world travel in this swing is what the body does meanwhile plus the way the foot moves relative to it
      let dur = moving ? gp.dur : GAIT.swingIdle
      // the first step of a start from rest is a quick one: the other foot is left behind by the body, and it must be able to follow at once
      if (moving && gp.gap > 0 && p.lifts === p.liftsAtMove) dur = clamp((0.9 * sb) / Math.max(v, 1), 0.2, dur)
      const bodyTravel = v * dur
      beginStep(p.feet[worst], dur, moving ? kb : 0, bodyTravel / (bodyTravel + sl + sb))
      p.feet[worst].liftAt = p.clock
      p.lifts++
      p.lastStepper = worst
    }
  }

  if (!moving && p.fast && worstRatio < 1 && !f0Stepping(p)) p.fast = false

  // 3. and 4. summaries for the rest of the body, flight and bounce
  finish(p, dt, gp, sl, sb, Math.max(S, 0.2 * scale), run, aLeft, aRight, aLeft, aRight, 1)
}

/**
 * The driven body's update (see the header). The same planter, planted feet and swings; what differs is what it is told: the true velocity, the
 * wish, the rest point, the turn rate. Every line that is not about those is the NPCs' planner above.
 */
function updateDriven(p: Planter, dt: number, x: number, z: number, heading: number, vx: number, vz: number, speed: number, scale: number, it: PlanterIntent): void {
  if (!p.initialised) resetPlanter(p, x, z, heading, scale)
  p.clock += dt
  p.landed = 0
  const moved = Math.sqrt((x - p.px) * (x - p.px) + (z - p.pz) * (z - p.pz))
  if (moved > GAIT.teleport) resetPlanter(p, x, z, heading, scale)
  else p.distance += moved
  p.px = x
  p.pz = z

  // the wish, and the direction the body is going: the velocity, or the wish while it is slow
  const wishMag = Math.sqrt(it.wishX * it.wishX + it.wishZ * it.wishZ)
  const hasWish = wishMag > DRIVEN.wishOn
  p.wishFor = hasWish ? p.wishFor + dt : 0
  const sh = Math.sin(heading)
  const ch = Math.cos(heading)
  // forward (fx, fz) and left (lx, lz) unit vectors on the ground; (sx, sz) is the direction of motion
  const fx = sh
  const fz = ch
  const lx = ch
  const lz = -sh
  let sx = fx
  let sz = fz
  if (speed > 0.25) {
    sx = vx / speed
    sz = vz / speed
  } else if (hasWish) {
    sx = it.wishX / wishMag
    sz = it.wishZ / wishMag
  }
  // walking begins with the keys, not with the measured speed; a key held against a wall is not walking
  const stalled = hasWish && p.wishFor > DRIVEN.stalled && speed < 0.1
  const wasMoving = p.moving
  const moving = hasWish ? !stalled : wasMoving && speed >= DRIVEN.settleSpeed
  p.moving = moving
  // going against the keys (backing up, then W; running, then S) is a stop and a start in one: the legs stop to where the body will turn round (the rest point is
  // where it would stop), and when it has turned round they start afresh
  const opposing = hasWish && speed > DRIVEN.settleSpeed && vx * it.wishX + vz * it.wishZ < 0
  const stopping = moving && (!hasWish || opposing)
  const reversed = moving && p.opposing && !opposing
  p.opposing = opposing
  if (reversed) {
    // a foot still in the air from the stride that was going the wrong way comes down soon: shorten what is left of its swing
    for (let i = 0; i < 2; i++) {
      const f = p.feet[i]
      const left = (1 - f.t) * f.dur
      if (f.stepping && left > DRIVEN.reverseSwing) {
        const done = f.t * f.dur
        f.dur = done + DRIVEN.reverseSwing
        f.t = done / f.dur
      }
    }
  }
  if ((moving && !wasMoving) || reversed) {
    p.liftsAtMove = p.lifts
    p.restSteps[0] = 0
    p.restSteps[1] = 0
    p.kick = !f0Stepping(p)
  }
  if (moving) p.restFor = 0
  else p.restFor += dt
  if (p.kick && (!hasWish || f0Stepping(p))) p.kick = false

  const v = moving ? speed : 0
  const gp = gaitParams(v, scale, p.params)
  // a stop closes the feet one at a time, never a hop: once the body is down to a walk the gate is shut (a runner's feet go on in the run's rhythm until then)
  if (stopping && speed < 2) gp.gate = 1
  const sl = gp.sl
  const sb = gp.sb
  const run = gp.run
  const S = (sl + sb) * 0.5
  const homeLat = GAIT.homeLat * scale
  const kb = briskBlend(v)
  const latTol = 0.16 * scale * (1 + 0.7 * kb)
  if (gp.gap > 0) p.fast = true
  const motion = clamp(speed / 1.2, 0, 1)
  const reach = GAIT.maxReach * scale
  const aS = it.ax * sx + it.az * sz
  const turning = Math.abs(it.turnRate) > DRIVEN.turning
  // swings begun since the body set off (1 once the first step is up): the steps of a start are shorter and sooner than the steady ones
  // (0 is a start that has no first step: the legs were in mid-stride when the body turned round, see `reversed`)
  const nStep = p.lifts - p.liftsAtMove
  const starting = moving && !stopping && nStep <= DRIVEN.startSwing.length
  const nTab = nStep < 1 ? 1 : nStep
  const startK = starting && nTab <= DRIVEN.startScale.length ? DRIVEN.startScale[nTab - 1] : 1
  const startGap = starting ? DRIVEN.startGap[nTab - 1] : 1

  // 1. advance swings, towards where the body will be (or its rest point) when the foot lands
  for (let i = 0; i < 2; i++) {
    const f = p.feet[i]
    if (!f.stepping) continue
    const side = i === 0 ? 1 : -1
    const e0 = swingEase(f.t, f.mix, f.lam)
    // a foot still in a long swing when the body is stopping hurries: it has to be down by the time the body is
    f.t = Math.min(1, f.t + (dt / f.dur) * ((stopping && (1 - f.t) * f.dur > DRIVEN.stopSwing) || (p.waiting && (stopping || starting)) ? DRIVEN.stopBoost : 1))
    const e1 = swingEase(f.t, f.mix, f.lam)
    const remaining = (1 - f.t) * f.dur
    // the heading the foot will meet at touchdown
    const hp = heading + clamp(it.turnRate * remaining, -0.8, 0.8)
    const ox = Math.cos(hp) * side * homeLat
    const oz = -Math.sin(hp) * side * homeLat
    if (stopping) {
      // the foot lands where the body's usual stride would put it, but never past the rest point: a foot planted at the rest point while the body is still half a
      // metre short of it would hold the leg out stretched (and sink the pelvis) until the body arrived
      const rx = it.restX - x
      const rz = it.restZ - z
      const rd = Math.sqrt(rx * rx + rz * rz)
      if (rd < 0.02) {
        f.tx = it.restX + ox
        f.tz = it.restZ + oz
      } else {
        const ahead = Math.min(predictTravel(speed, aS, 0, remaining) + sl, rd)
        f.tx = x + (rx / rd) * ahead + ox
        f.tz = z + (rz / rd) * ahead + oz
      }
    } else if (moving) {
      // the first step of a start is a short one
      const reachAhead = predictTravel(speed, aS, wishMag, remaining) + (nStep === 1 && i === p.lastStepper ? DRIVEN.firstStride * sl : sl)
      f.tx = x + sx * reachAhead + ox
      f.tz = z + sz * reachAhead + oz
    } else {
      f.tx = x + ox
      f.tz = z + oz
    }
    f.tyaw = hp + side * GAIT.toeOut
    const k = e1 >= 1 || e0 >= 1 ? 1 : (e1 - e0) / (1 - e0)
    f.x += (f.tx - f.x) * k
    f.z += (f.tz - f.z) * k
    f.yaw += wrapPi(f.tyaw - f.yaw) * k
    const liftH = stopping ? Math.max(GAIT.liftIdle, gp.lift * clamp(speed / 3, 0.5, 1)) : moving ? gp.lift : GAIT.liftIdle
    const arc = liftH * Math.sin(Math.PI * f.t)
    const landPitch = 0.18 * motion * (1 - 0.75 * run)
    f.pitch = f.spitch + (landPitch - f.spitch) * smoothstep(0, 0.85, f.t)
    f.lift = arc + contactLift(f.pitch)
    if (f.t >= 1) {
      f.stepping = false
      f.x = f.tx
      f.z = f.tz
      f.yaw = f.tyaw
      f.steps++
      p.steps++
      p.landed++
      p.lastLanded = i
      if (!moving) p.restSteps[i]++
    }
  }

  // 2. planted feet: pitch from stance progress, then decide whether one has to step
  let worst = -1
  let worstRatio = 0
  /** How urgent the worst foot's step is for the emergency rule: how far it is from its rest spot says which goes first at a stop, not that it cannot wait. */
  let worstForce = 0
  let worstYaw = false
  let ratio0 = 0
  let ratio1 = 0
  let yaw0 = false
  let yaw1 = false
  let aLeft = 0
  let aRight = 0
  let fLeft = 0
  let fRight = 0
  const turnRate = clamp(it.turnRate, -6, 6)
  p.waiting = false
  for (let i = 0; i < 2; i++) {
    const f = p.feet[i]
    const side = i === 0 ? 1 : -1
    const dx = f.x - x
    const dz = f.z - z
    // how far the foot is ahead of the body along its motion (`a`, the foot's own cycle) and along its facing (`af`, the legs as they swing in space)
    const a = dx * sx + dz * sz
    const af = dx * fx + dz * fz
    if (i === 0) {
      aLeft = a
      fLeft = af
    } else {
      aRight = a
      fRight = af
    }
    if (f.stepping) continue
    const ps = a >= 0 ? a / Math.max(sl, 0.15 * scale) : a / Math.max(sb, 0.15 * scale)
    f.pitch = damp(f.pitch, stancePitch(ps, motion, run), 14 + 16 * kb + 24 * run, dt)
    f.lift = contactLift(f.pitch) + (run > 0 ? 0.05 * run * smoothstep(0.75, 1.05, -a / sb) : 0)
    const yawNow = Math.abs(wrapPi(f.yaw - (heading + side * GAIT.toeOut)))
    let ratio: number
    let byYaw = false
    let backRatio = 0
    if (stopping) {
      // a foot far from its rest spot has to step to it; the farthest goes first
      const ex = f.x - (it.restX + lx * side * homeLat)
      const ez = f.z - (it.restZ + lz * side * homeLat)
      const rest = Math.sqrt(ex * ex + ez * ez) / (DRIVEN.restThreshold * scale)
      ratio = Math.max(rest, yawNow / 0.8)
      // ... but a foot that trails as far as it would on the move cannot wait for the other one (the run's toe-off), however near its rest spot
      backRatio = -(a - 0.5 * speed * dt) / (DRIVEN.stopTrail * scale)
    } else if (moving) {
      const back = gp.gap > 0 ? -(a - DRIVEN.lookAhead * speed * dt) : -a
      // the sideways drift of the foot from its home, across the motion
      const rx = lx * side * homeLat
      const rz = lz * side * homeLat
      const rs = rx * sx + rz * sz
      const bx = dx - a * sx - (rx - rs * sx)
      const bz = dz - a * sz - (rz - rs * sz)
      ratio = Math.max(back / (sb * startK), Math.sqrt(bx * bx + bz * bz) / latTol, yawNow / 0.8)
    } else {
      // standing: re-home a foot that is far from its spot (and once, if it is more than a step-up from where the body came to rest), and re-plant
      // one whose toes have been left pointing away by a turn: 0.45 rad, looking 0.15 s ahead at the turn rate; once the turn is over, 0.14 rad
      const yawErr = Math.abs(wrapPi(f.yaw - (heading + turnRate * DRIVEN.turnLead + side * GAIT.toeOut)))
      const settle = !turning && p.clock - p.turnAt < 2
      const yawRatio = yawErr / (settle ? DRIVEN.turnSettle : DRIVEN.turnReplant)
      const ex = f.x - (x + lx * side * homeLat)
      const ez = f.z - (z + lz * side * homeLat)
      const home = Math.sqrt(ex * ex + ez * ez)
      let posRatio = home / (GAIT.idleStepDist * scale)
      if (p.restFor < 1.5 && p.restSteps[i] < 1) posRatio = Math.max(posRatio, home / (DRIVEN.restThreshold * scale))
      ratio = Math.max(posRatio, yawRatio)
      byYaw = yawRatio >= 1 && yawRatio >= posRatio
    }
    let force = stopping ? backRatio : ratio
    if (Math.sqrt(dx * dx + dz * dz) > reach) {
      ratio = Math.max(ratio, 1.9)
      force = Math.max(force, 1.9)
    }
    // the lock (see the planner above)
    if (moving && !stopping && gp.gap > 0 && ratio < 1 && -a >= 0.25 * sb * startK && p.clock + 0.5 * dt - p.feet[1 - i].liftAt >= gp.gap * startGap) ratio = 1
    if (i === 0) {
      ratio0 = ratio
      yaw0 = byYaw
    } else {
      ratio1 = ratio
      yaw1 = byYaw
    }
    if (ratio > worstRatio) {
      worstRatio = ratio
      worstForce = force
      worst = i
      worstYaw = byYaw
    }
  }
  // turning on the spot: the foot on the turn side goes first (a left turn, +turnRate, starts with the left foot)
  if (worst >= 0 && worstYaw && turning) {
    const ts = it.turnRate > 0 ? 0 : 1
    if ((ts === 0 ? ratio0 : ratio1) >= 1 && (ts === 0 ? yaw0 : yaw1)) worst = ts
  }

  if (p.kick && !f0Stepping(p)) {
    // the first step of a start: up on the first frame the keys ask for it, quick, so a foot is down within 0.2 s and the body never outruns its legs
    const foot = p.lastStepper === 0 ? 1 : 0
    beginStep(p.feet[foot], DRIVEN.firstSwing, kb, 0)
    p.feet[foot].liftAt = p.clock
    p.lifts++
    p.lastStepper = foot
    p.kick = false
  } else if (worst >= 0 && worstRatio >= 1) {
    const other = p.feet[1 - worst]
    // the second of two feet that turn waits until the first is 60 % through; at a stop the feet go one at a time
    // (on the move the run's gate has a few per cent of give: a foot that is a hair short of it is not an emergency, which a tight curve at a run is, once a stride, otherwise)
    const gate = worstYaw && turning && !moving ? DRIVEN.turnGate : moving && !stopping && gp.gate < 1 ? gp.gate - 0.04 : gp.gate
    const open = (!other.stepping || other.t >= gate) && (gp.gap === 0 || stopping || p.clock - other.liftAt >= 0.85 * gp.gap * startGap)
    const overdue = stopping ? worstForce >= 1.1 : moving && (gp.gap > 0 || (starting && nStep === 0)) && worstRatio >= (gp.run > 0 && p.lifts - p.liftsAtMove < 2 ? 1 : 1.1)
    const limit = moving ? 1.8 : worstYaw && turning ? 3 : p.fast ? 2.6 : 1.8
    p.waiting = !open
    if (open || overdue || worstForce > limit) {
      if (!open && other.stepping && other.t < 0.9) p.forced++
      let dur: number
      if (stopping) dur = Math.min(gp.dur, DRIVEN.stopSwing)
      else if (moving) {
        dur = gp.dur
        // the steps after the kick are quick too: the other foot has been left behind by the body since the start
        if (nStep <= DRIVEN.startSwing.length) dur = Math.min(dur, DRIVEN.startSwing[nTab - 1])
      } else dur = worstYaw ? DRIVEN.turnSwing : GAIT.swingIdle
      // the foot sets off with the body's own speed (a stop from a run leaves the trailing foot half a metre back otherwise), but the body only has the rest of its stop to go
      let bodyTravel = moving ? v * dur : 0
      if (stopping) {
        const rx = it.restX - x
        const rz = it.restZ - z
        bodyTravel = Math.min(bodyTravel, Math.sqrt(rx * rx + rz * rz))
      }
      beginStep(p.feet[worst], dur, moving ? kb : 0, bodyTravel / (bodyTravel + sl + sb))
      p.feet[worst].liftAt = p.clock
      p.lifts++
      p.lastStepper = worst
      if (!moving && worstYaw) p.turnAt = p.clock
    }
  }

  if (!moving && p.fast && worstRatio < 1 && !f0Stepping(p)) p.fast = false

  // 3. and 4. summaries; backing up the arms still swing against the legs in space
  const flip = moving && speed > 0.25 ? clamp(2 * (sx * fx + sz * fz), -1, 1) : 1
  finish(p, dt, gp, sl, sb, Math.max(S, 0.2 * scale), run, aLeft, aRight, fLeft, fRight, flip)
}
