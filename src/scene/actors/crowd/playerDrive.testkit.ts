// W3 "Real": a test kit, not shipped (nothing but tests imports it). It drives the crowd rig the way the player system drives the player's body:
//   - the speed follows a critically damped spring on the speed MAGNITUDE (CONFIG.player.startSeconds / stopSeconds / shiftSeconds: seconds to 95 %,
//     smoothTime = seconds / 2.37), so the acceleration is smooth and starts at 0; the direction is the body's own (it never walks crabwise),
//   - the heading turns towards the wished one with CONFIG.player.turnSeconds (or at a fixed rate for a turn on the spot), eased in over 0.07 s,
//   - and what the keys ask for, the acceleration, the turn rate and the rest point are handed to the rig exactly as `walkBody` carries them.
// `driven: false` hands the rig what the crowd model measures for an NPC instead (the velocity smoothed over 0.1 s, no intent): the old behaviour.
import { CONFIG } from '@/sim/config'
import { P, PART_COUNT } from './constants'
import { GAIT } from './gait'
import { clamp, damp, smoothDamp, wrapPi } from './math'
import { lookFor, type Look } from './outfit'
import { STAND_HEAD_CENTRE } from './constants'
import { U } from './pose'
import { aimHead, createRig, makeInput, solveRig, type PersonRig, type RigInput } from './rig'

export const PLAYER_LOOK: Look = lookFor({ id: 'player', role: 'doctor', variant: 0 })

export interface Script {
  /** The speed the keys ask for (m/s, never negative; 0 is no key held). */
  speed: (t: number) => number
  /** The compass direction the keys ask to travel in (atan2(dx, dz)). */
  dir: (t: number) => number
  /** Travel backwards, facing the way the body already faces (the easy scheme's S key). */
  back?: (t: number) => boolean
  /** Travel at this angle to the facing (a strafe: -pi/2 is to the right) without turning to face the way it goes (the heading is `face`'s, or what it was). */
  strafe?: (t: number) => number
  /** The heading the body is turned to while no key is held (a turn on the spot). Absent: it keeps its heading. */
  face?: (t: number) => number
  /** The fastest the heading may turn (rad/s). 20 when absent, which is as fast as the player system lets it go. */
  turnMax?: number
}

export interface DriveOptions {
  dt?: number
  /** Hand the rig the true body and the intent (the player) or the measured velocity (everybody else). */
  driven?: boolean
  /** Seconds of standing still before the script starts (the rig settles; script time starts at 0 after it). */
  lead?: number
  scale?: number
}

export interface Strike {
  t: number
  foot: number
  /** Where the foot came down (world) and where the body was. */
  fx: number
  fz: number
  bx: number
  bz: number
  speed: number
}

export interface Lift {
  t: number
  foot: number
  /** How far the foot's yaw was from the body's heading when it lifted (radians). */
  yawErr: number
}

export interface DFrame {
  t: number
  x: number
  z: number
  heading: number
  speed: number
  ax: number
  az: number
  turnRate: number
  wishSpeed: number
  stopping: boolean
  pelvisY: number
  /** Forward lean (+ forward) and bank (+ towards the body's left, the way a left turn goes) of the chest and the head, radians. */
  chestLean: number
  chestBank: number
  headLean: number
  headBank: number
  /** Where each planted foot is drawn against where the planner put it (metres), and the largest of them. */
  reachErr: number
  bothAir: boolean
  stepping: [boolean, boolean]
  /** The feet's distance from the spot the body leaves them at rest (their home under the body, world), and each foot's yaw error against the heading. */
  footHome: [number, number]
  footYawErr: [number, number]
  run: number
  brisk: number
  /** Emergency steps so far (the planter's `forced`). */
  forced: number
  /** How far each foot is ahead of the body along its FACING (the legs as they swing in space), and the arms' swing (the pose angles, + forward). */
  footAhead: [number, number]
  armL: number
  armR: number
}

export interface DriveResult {
  rig: PersonRig
  frames: DFrame[]
  strikes: Strike[]
  lifts: Lift[]
  forced: number
  finite: boolean
  /** The part matrices of the last frame. */
  out: Float32Array
  /** The body at the end. */
  x: number
  z: number
  heading: number
}

const MAT = 12

/** Forward lean of a part about the X axis seen from the root (radians, + forward). */
export function leanOf(out: Float32Array, part: number): number {
  const b = part * MAT
  return Math.atan2(out[b + 9], out[b + 5])
}

/** Bank of a part about the Z axis seen from the root (radians, + towards the character's left, +X). */
export function bankOf(out: Float32Array, part: number): number {
  const b = part * MAT
  return Math.atan2(out[b + 1], out[b + 5])
}

/** Metres the body needs to stop from speed `s` with acceleration `a` on a critically damped spring of rate `w` (1 / seconds). */
export function stopDistance(s: number, a: number, w: number): number {
  const d = (2 * s) / w + a / (w * w)
  // signed like the speed, never past rest
  return s >= 0 ? Math.max(0, d) : Math.min(0, d)
}

export function drive(script: Script, seconds: number, opts: DriveOptions = {}): DriveResult {
  const dt = opts.dt ?? 1 / 60
  const driven = opts.driven ?? true
  const lead = opts.lead ?? 1
  const scale = PLAYER_LOOK.scale
  const rig = createRig(PLAYER_LOOK)
  const inp: RigInput = makeInput()
  const out = new Float32Array(PART_COUNT * MAT)
  const cfg = CONFIG.player
  const frames: DFrame[] = []
  const strikes: Strike[] = []
  const lifts: Lift[] = []
  const vel = { v: 0 }
  let x = 0
  let z = 0
  let heading = 0
  let s = 0
  let acc = 0
  let turnRate = 0
  let strafeNow = 0
  let mx = 0
  let mz = 0
  let finite = true
  const pl = rig.planter
  const prevSteps = [0, 0]
  const prevStepping = [false, false]
  const total = Math.round((lead + seconds) / dt)
  for (let i = 0; i < total; i++) {
    const tAbs = i * dt
    const t = tAbs - lead
    const live = t >= 0
    const W = live ? script.speed(t) : 0
    const back = live && !!script.back && script.back(t)
    // the heading the body is turned to: the wished direction when a key is held (not backing up), the scripted one otherwise
    const strafe = live && script.strafe ? script.strafe(t) : null
    let target = heading
    if (live) {
      if (W > 0 && !back && strafe === null) target = script.dir(t)
      else if (script.face) target = script.face(t)
    }
    const err = wrapPi(target - heading)
    const wantRate = clamp(err / cfg.turnSeconds, -(script.turnMax ?? 20), script.turnMax ?? 20)
    turnRate += (wantRate - turnRate) * (1 - Math.exp(-dt / 0.07))
    if (Math.abs(err) < 1e-4 && Math.abs(turnRate) < 1e-3) turnRate = 0
    heading = wrapPi(heading + turnRate * dt)
    // the speed: ONE signed speed along the facing (W forward, S backing up) on a critically damped spring, its own seconds for a start, a stop and a change of
    // gait or of direction: a body going backwards that is asked forwards slows through zero first, like the player system's
    const wishV = back ? -W : W
    const secs = wishV === 0 ? cfg.stopSeconds : Math.abs(s) < 0.5 ? cfg.startSeconds : cfg.shiftSeconds
    s = smoothDamp(s, wishV, vel, secs / 2.37, 1e9, dt)
    acc = vel.v
    if (wishV === 0 && Math.abs(s) < 0.03) {
      s = 0
      vel.v = 0
      acc = 0
    }
    // the direction of travel: the facing, or the strafe's angle off it (it stays while coasting to a stop)
    if (strafe !== null) strafeNow = strafe
    else if (live && W > 0) strafeNow = 0
    const dx = Math.sin(heading + strafeNow)
    const dz = Math.cos(heading + strafeNow)
    const vx = dx * s
    const vz = dz * s
    x += vx * dt
    z += vz * dt
    // what the crowd model would measure (an NPC): the real velocity smoothed over 0.1 s
    mx = damp(mx, vx, 10, dt)
    mz = damp(mz, vz, 10, dt)
    let ms = Math.hypot(mx, mz)
    if (ms < 0.02) {
      mx = 0
      mz = 0
      ms = 0
    }
    const speed = Math.hypot(vx, vz)
    // where it would come to rest if you let go now (the player system's `restDistance`: always the stop spring's, whatever the keys ask for)
    const w = (2 * 2.37) / cfg.stopSeconds
    inp.dt = dt
    inp.time = tAbs
    inp.x = x
    inp.z = z
    inp.heading = heading
    if (driven) {
      inp.vx = vx
      inp.vz = vz
      inp.speed = speed < 0.02 ? 0 : speed
      inp.driven = true
      inp.ax = dx * acc
      inp.az = dz * acc
      inp.turnRate = turnRate
      // what the keys ask for: the speed they ask for along the body's heading (the easy scheme), backwards when backing up
      inp.wishX = dx * wishV
      inp.wishZ = dz * wishV
      inp.stopping = W === 0 && speed > 0.03
      const d = speed > 0.05 ? stopDistance(s, acc, w) : 0
      inp.restX = x + dx * d
      inp.restZ = z + dz * d
    } else {
      inp.vx = mx
      inp.vz = mz
      inp.speed = ms
      inp.driven = false
    }
    // the crowd model aims the head (the look-at, and for the driven body the lead into a turn) before it solves the rig
    aimHead(rig, dt, inp, STAND_HEAD_CENTRE * scale)
    solveRig(rig, inp, out, 0)
    for (let k = 0; k < PART_COUNT * MAT; k++) if (!Number.isFinite(out[k])) finite = false
    // events
    for (let k = 0; k < 2; k++) {
      const f = pl.feet[k]
      if (f.steps > prevSteps[k]) strikes.push({ t, foot: k, fx: f.x, fz: f.z, bx: x, bz: z, speed })
      if (f.stepping && !prevStepping[k]) lifts.push({ t, foot: k, yawErr: Math.abs(wrapPi(f.yaw - (heading + (k === 0 ? 1 : -1) * GAIT.toeOut))) })
      prevSteps[k] = f.steps
      prevStepping[k] = f.stepping
    }
    if (!live) continue
    // what was drawn
    const c = Math.cos(heading)
    const sn = Math.sin(heading)
    let reachErr = 0
    for (const [part, foot] of [
      [P.footL, pl.feet[0]],
      [P.footR, pl.feet[1]],
    ] as const) {
      if (foot.stepping) continue
      const lx = out[part * MAT + 3]
      const lz = out[part * MAT + 11]
      reachErr = Math.max(reachErr, Math.hypot(x + c * lx + sn * lz - foot.x, z - sn * lx + c * lz - foot.z))
    }
    const home = (k: number): number => {
      const side = k === 0 ? 1 : -1
      const f = pl.feet[k]
      return Math.hypot(f.x - (x + c * side * GAIT.homeLat * scale), f.z - (z - sn * side * GAIT.homeLat * scale))
    }
    frames.push({
      t,
      x,
      z,
      heading,
      speed,
      ax: inp.ax,
      az: inp.az,
      turnRate,
      wishSpeed: W,
      stopping: inp.stopping,
      pelvisY: out[P.pelvis * MAT + 7],
      chestLean: leanOf(out, P.chest),
      chestBank: bankOf(out, P.chest),
      headLean: leanOf(out, P.head),
      headBank: bankOf(out, P.head),
      reachErr,
      bothAir: pl.feet[0].stepping && pl.feet[1].stepping,
      stepping: [pl.feet[0].stepping, pl.feet[1].stepping],
      footHome: [home(0), home(1)],
      footYawErr: [Math.abs(wrapPi(pl.feet[0].yaw - (heading + GAIT.toeOut))), Math.abs(wrapPi(pl.feet[1].yaw - (heading - GAIT.toeOut)))],
      run: rig.run,
      brisk: rig.brisk,
      forced: pl.forced,
      footAhead: [(pl.feet[0].x - x) * sn + (pl.feet[0].z - z) * c, (pl.feet[1].x - x) * sn + (pl.feet[1].z - z) * c],
      armL: rig.up[U.lPitch],
      armR: rig.up[U.rPitch],
    })
  }
  return { rig, frames, strikes, lifts, forced: pl.forced, finite, out, x, z, heading }
}

/** The pelvis height of a person standing still (the rig, settled). */
export function standingPelvis(): number {
  const rig = createRig(PLAYER_LOOK)
  const out = new Float32Array(PART_COUNT * MAT)
  const inp = makeInput()
  for (let i = 0; i < 30; i++) solveRig(rig, inp, out, 0)
  return out[P.pelvis * MAT + 7]
}
