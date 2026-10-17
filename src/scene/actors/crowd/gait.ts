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
 * Advance the planter by `dt` seconds.
 * @param x,z      body position (the entity's, on the ground)
 * @param heading  body heading
 * @param vx,vz    body velocity, m/s (smoothed)
 * @param speed    body speed, m/s (smoothed)
 * @param scale    the person's size relative to the nominal body (strides and foot spacing scale with it)
 */
export function updatePlanter(p: Planter, dt: number, x: number, z: number, heading: number, vx: number, vz: number, speed: number, scale: number): void {
  if (!p.initialised) resetPlanter(p, x, z, heading, scale)
  p.clock += dt
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

  // 3. summaries for the rest of the body
  const ref = Math.max(S, 0.2 * scale)
  p.gait = clamp((aLeft - aRight) / (2 * ref), -1, 1)
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
  p.swing = clamp(0.5 * (cosL - cosR), -1, 1)

  // 4. flight and bounce: both feet in the air is a run's flight phase; a runner sinks over the planted foot and rises in the flight
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
