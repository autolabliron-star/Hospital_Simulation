// W1 "walk": the speed-dependent gait (gait.ts), the run and brisk-walk poses (pose.ts, rig.ts) and the way a person turns, in node: no GL.
//
// What these tests pin down:
//   - the NPCs (up to 1.4 m/s) walk exactly as they did before this change: the old planner is snapshotted below and compared frame by frame
//   - at every steady speed from 0.8 to 4.5 m/s the feet alternate, step lengths and cadences are human, no step is an emergency, planted feet never
//     slide, and above about 2.6 m/s there is a flight phase
//   - the pelvis stays within a few centimetres of where it should be (the old gait dropped it by 20 to 37 cm at 2 to 4 m/s)
//   - the arms swing in opposition to the legs, grow with speed and are never frozen; a run has bent elbows and a forward lean
//   - turning in place and on the move steps the feet round without leaving a foot behind
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { LEG_LENGTH, P, PART_COUNT, STAND_PELVIS } from './constants'
import { GAIT, SPEEDS, briskBlend, contactLift, createGaitParams, createPlanter, gaitParams, halfStride, runBlend, stancePitch, swingEase, swingTime, updatePlanter, type Planter } from './gait'
import { clamp, damp, smoother01, smoothstep, wrapPi } from './math'
import { lookFor } from './outfit'
import { U } from './pose'
import { createRig, makeInput, solveRig, type PersonRig, type RigInput } from './rig'
import { drive as kitDrive, type DFrame } from './playerDrive.testkit'

// ---------------------------------------------------------------------------------------------
// The old planner, as it was before the speed-dependent gait. Do not edit: it is the reference the NPCs are held to.
// ---------------------------------------------------------------------------------------------
interface OldFoot {
  x: number
  z: number
  yaw: number
  lift: number
  pitch: number
  stepping: boolean
  t: number
  dur: number
  spitch: number
  tx: number
  tz: number
  tyaw: number
  steps: number
}
interface OldPlanter {
  feet: [OldFoot, OldFoot]
  moving: boolean
  gait: number
  stance: [number, number]
  distance: number
  steps: number
  lastStepper: number
  initialised: boolean
  px: number
  pz: number
}
const oldFoot = (): OldFoot => ({ x: 0, z: 0, yaw: 0, lift: 0, pitch: 0, stepping: false, t: 0, dur: GAIT.swingIdle, spitch: 0, tx: 0, tz: 0, tyaw: 0, steps: 0 })
const createOldPlanter = (): OldPlanter => ({ feet: [oldFoot(), oldFoot()], moving: false, gait: 0, stance: [1, 1], distance: 0, steps: 0, lastStepper: -1, initialised: false, px: 0, pz: 0 })
function oldStancePitch(ps: number, motion: number): number {
  const heel = 0.18 * smoothstep(0.5, 1.0, ps)
  const toe = -0.65 * smoothstep(-0.35, -1.0, ps)
  return motion * (heel + toe)
}
function oldReset(p: OldPlanter, x: number, z: number, heading: number, scale = 1): void {
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
  p.gait = 0
  p.stance[0] = 1
  p.stance[1] = 1
  p.px = x
  p.pz = z
  p.initialised = true
}
function oldUpdate(p: OldPlanter, dt: number, x: number, z: number, heading: number, vx: number, vz: number, speed: number, scale: number): void {
  if (!p.initialised) oldReset(p, x, z, heading, scale)
  const moved = Math.sqrt((x - p.px) * (x - p.px) + (z - p.pz) * (z - p.pz))
  if (moved > GAIT.teleport) oldReset(p, x, z, heading, scale)
  else p.distance += moved
  p.px = x
  p.pz = z
  if (p.moving) {
    if (speed < GAIT.moveOff) p.moving = false
  } else if (speed > GAIT.moveOn) {
    p.moving = true
  }
  const moving = p.moving
  const v = moving ? speed : 0
  const sh = Math.sin(heading)
  const ch = Math.cos(heading)
  const fx = sh
  const fz = ch
  const lx = ch
  const lz = -sh
  const S = halfStride(v) * scale
  const homeLat = GAIT.homeLat * scale
  const motion = clamp(speed / 1.2, 0, 1)
  for (let i = 0; i < 2; i++) {
    const f = p.feet[i]
    if (!f.stepping) continue
    const side = i === 0 ? 1 : -1
    const e0 = smoother01(f.t)
    f.t = Math.min(1, f.t + dt / f.dur)
    const e1 = smoother01(f.t)
    const remaining = (1 - f.t) * f.dur
    if (moving) {
      f.tx = x + vx * remaining + fx * S + lx * side * homeLat
      f.tz = z + vz * remaining + fz * S + lz * side * homeLat
    } else {
      f.tx = x + lx * side * homeLat
      f.tz = z + lz * side * homeLat
    }
    f.tyaw = heading + side * GAIT.toeOut
    const k = e1 >= 1 || e0 >= 1 ? 1 : (e1 - e0) / (1 - e0)
    f.x += (f.tx - f.x) * k
    f.z += (f.tz - f.z) * k
    f.yaw += wrapPi(f.tyaw - f.yaw) * k
    const liftH = moving ? 0.03 + 0.045 * clamp(speed / 1.4, 0, 1.3) : GAIT.liftIdle
    const arc = liftH * Math.sin(Math.PI * f.t)
    const landPitch = 0.18 * motion
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
    const ps = a / Math.max(S, 0.15 * scale)
    f.pitch = damp(f.pitch, oldStancePitch(ps, motion), 14, dt)
    f.lift = contactLift(f.pitch)
    const yawErr = Math.abs(wrapPi(f.yaw - (heading + side * GAIT.toeOut)))
    let ratio: number
    if (moving) ratio = Math.max(-a / S, Math.abs(b) / (0.16 * scale), yawErr / 0.8)
    else ratio = Math.max(Math.sqrt(a * a + b * b) / (GAIT.idleStepDist * scale), yawErr / GAIT.idleStepYaw)
    if (Math.sqrt(a * a + lat * lat) > GAIT.maxReach * scale) ratio = Math.max(ratio, 1.9)
    if (ratio > worstRatio) {
      worstRatio = ratio
      worst = i
    }
  }
  if (worst >= 0 && worstRatio >= 1) {
    const other = p.feet[1 - worst]
    if (!other.stepping || worstRatio > 1.8) {
      const f = p.feet[worst]
      f.stepping = true
      f.t = 0
      f.dur = moving ? swingTime(v) : GAIT.swingIdle
      f.spitch = f.pitch
      f.tx = f.x
      f.tz = f.z
      f.tyaw = f.yaw
      p.lastStepper = worst
    }
  }
  const ref = Math.max(S, 0.2 * scale)
  p.gait = clamp((aLeft - aRight) / (2 * ref), -1, 1)
  for (let i = 0; i < 2; i++) {
    const f = p.feet[i]
    p.stance[i] = f.stepping ? 0.5 + 0.5 * Math.cos(2 * Math.PI * f.t) : 1
  }
}

// ---------------------------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------------------------
interface Steady {
  /** Mean distance between one touchdown and the next (the other foot's), metres, and steps per second. */
  step: number
  stepMin: number
  stepMax: number
  cadence: number
  /** Touchdown spots relative to the body along its heading, and the extremes the feet reach in front of and behind it. */
  landing: number
  ahead: number
  behind: number
  split: number
  /** Share of the time both feet are in the air, and the mean length of such a flight. */
  airShare: number
  flight: number
  /** Footfalls that began while the other foot still had more than a tenth of its swing to go, after settling. */
  forced: number
  alternates: boolean
  /** Largest move of a foot that stayed planted from one frame to the next. */
  slide: number
}

/** A body walking straight along +Z at a constant `speed`; the first `settle` seconds are thrown away. */
function steady(speed: number, opts: { dt?: number; settle?: number; seconds?: number; scale?: number } = {}): Steady {
  const dt = opts.dt ?? 1 / 60
  const settle = opts.settle ?? 6
  const seconds = opts.seconds ?? 10
  const scale = opts.scale ?? 1
  const p = createPlanter()
  let z = 0
  updatePlanter(p, dt, 0, 0, 0, 0, 0, 0, scale)
  const stepped = [false, false]
  const prev = [
    { x: 0, z: 0, stepping: false },
    { x: 0, z: 0, stepping: false },
  ]
  const touch: { t: number; foot: number; z: number }[] = []
  const landing: number[] = []
  const flights: number[] = []
  let air = 0
  let n = 0
  let flightStart = -1
  let ahead = -9
  let behind = 9
  let split = 0
  let slide = 0
  let forcedAtSettle = 0
  let forcedAtEnd = 0
  const frames = Math.round((settle + seconds) / dt)
  const settleFrame = Math.round(settle / dt)
  for (let k = 0; k < frames; k++) {
    z += speed * dt
    updatePlanter(p, dt, 0, z, 0, 0, speed, speed, scale)
    const t = (k + 1) * dt
    if (k === settleFrame) forcedAtSettle = p.forced
    forcedAtEnd = p.forced
    for (let i = 0; i < 2; i++) {
      const f = p.feet[i]
      if (stepped[i] && !f.stepping && k > settleFrame) {
        touch.push({ t, foot: i, z: f.z })
        landing.push(f.z - z)
      }
      if (!prev[i].stepping && !f.stepping && k > settleFrame) slide = Math.max(slide, Math.hypot(f.x - prev[i].x, f.z - prev[i].z))
      prev[i] = { x: f.x, z: f.z, stepping: f.stepping }
      stepped[i] = f.stepping
    }
    if (k > settleFrame) {
      n++
      const both = p.feet[0].stepping && p.feet[1].stepping
      if (both) air++
      if (both && flightStart < 0) flightStart = t
      if (!both && flightStart >= 0) {
        flights.push(t - flightStart)
        flightStart = -1
      }
      for (const f of p.feet) {
        ahead = Math.max(ahead, f.z - z)
        behind = Math.min(behind, f.z - z)
      }
      split = Math.max(split, Math.abs(p.feet[0].z - p.feet[1].z))
    }
  }
  const steps: number[] = []
  const gaps: number[] = []
  for (let i = 1; i < touch.length; i++) {
    steps.push(touch[i].z - touch[i - 1].z)
    gaps.push(touch[i].t - touch[i - 1].t)
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
  return {
    step: mean(steps),
    stepMin: Math.min(...steps),
    stepMax: Math.max(...steps),
    cadence: 1 / mean(gaps),
    landing: mean(landing),
    ahead,
    behind,
    split,
    airShare: air / n,
    flight: flights.length ? mean(flights) : 0,
    forced: forcedAtEnd - forcedAtSettle,
    alternates: touch.every((x, i) => i === 0 || x.foot !== touch[i - 1].foot),
    slide,
  }
}

const LOOK = lookFor({ id: 'player', role: 'doctor', variant: 0 })
const STAND_Y = (() => {
  const r = createRig(LOOK)
  const out = new Float32Array(PART_COUNT * 12)
  const inp = makeInput()
  for (let i = 0; i < 30; i++) solveRig(r, inp, out, 0)
  return out[P.pelvis * 12 + 7]
})()

interface Frame {
  t: number
  pelvisY: number
  lean: number
  lPitch: number
  rPitch: number
  lElbow: number
  rElbow: number
  /** Where each planted foot is drawn against where the planner put it, and how far each foot is ahead of the body along its heading. */
  reachErr: number
  aL: number
  aR: number
  bothAir: boolean
  /** The torso seen from the side: pelvis to neck lean, and the lean of the line from each PLANTED ankle to the head centre (radians, + forward). */
  trunkLean: number
  ankleLean: number[]
  /** Knee heights (the shin's origin) and how far each knee is ahead of its hip; the stretch of a planted leg (hip to ankle over leg length) while its foot is under the hip. */
  kneeLy: number
  kneeRy: number
  kneeLz: number
  kneeRz: number
  stretch: number
  /** The middle of each hand, in the root frame (z forward). */
  handLz: number
  handRz: number
  skirtTilt: number
  skirtDepth: number
  skirtLen: number
}

/** The part's local Y axis seen from the person's root frame: forward lean (radians) of a part about the X axis. */
function lean(out: Float32Array, part: number): number {
  const b = part * 12
  return Math.atan2(out[b + 9], out[b + 5])
}

/** Run the rig for `seconds` with the body moving along +Z at `speed` (or standing still when 0) and return the frames after `settle`. */
function rigRun(speed: number, opts: { seconds?: number; settle?: number; dt?: number } = {}): { frames: Frame[]; rig: PersonRig } {
  const dt = opts.dt ?? 1 / 60
  const seconds = opts.seconds ?? 12
  const settle = opts.settle ?? 6
  const rig = createRig(LOOK)
  const inp = makeInput()
  const out = new Float32Array(PART_COUNT * 12)
  const frames: Frame[] = []
  let z = 0
  for (let i = 0; i < seconds / dt; i++) {
    z += speed * dt
    inp.dt = dt
    inp.time = i * dt
    inp.z = z
    inp.vz = speed
    inp.speed = speed
    solveRig(rig, inp, out, 0)
    if (i * dt < settle) continue
    frames.push(frameOf(rig, out, i * dt, z, 0))
  }
  return { frames, rig }
}

function frameOf(rig: PersonRig, out: Float32Array, t: number, z: number, heading: number): Frame {
  const pl = rig.planter
  let reachErr = 0
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  for (const [part, foot] of [
    [P.footL, pl.feet[0]],
    [P.footR, pl.feet[1]],
  ] as const) {
    if (foot.stepping) continue
    const lx = out[part * 12 + 3]
    const lz = out[part * 12 + 11]
    // the person is at x = 0 here (a straight walk along Z); the world foot is at (lx, z + lz) rotated by the heading
    reachErr = Math.max(reachErr, Math.hypot(c * lx + s * lz - foot.x, z - s * lx + c * lz - foot.z))
  }
  const sk = P.skirt * 12
  const pe = P.pelvis * 12
  const he = P.head * 12
  // the head centre: the neck joint and 0.18 m along the head's own up axis
  const headY = out[he + 7] + 0.18 * out[he + 5]
  const headZ = out[he + 11] + 0.18 * out[he + 9]
  const ankleLean: number[] = []
  let stretch = NaN
  const legLen = LEG_LENGTH * LOOK.scale
  for (const [foot, thigh, planter] of [
    [P.footL, P.thighL, pl.feet[0]],
    [P.footR, P.thighR, pl.feet[1]],
  ] as const) {
    if (planter.stepping) continue
    ankleLean.push(Math.atan2(headZ - out[foot * 12 + 11], headY - out[foot * 12 + 7]))
    const dz = out[foot * 12 + 11] - out[thigh * 12 + 11]
    if (Math.abs(dz) < 0.06) stretch = Math.hypot(out[foot * 12 + 3] - out[thigh * 12 + 3], out[foot * 12 + 7] - out[thigh * 12 + 7], dz) / legLen
  }
  const hand = (part: number) => out[part * 12 + 11] - 0.085 * out[part * 12 + 9]
  return {
    t,
    pelvisY: out[pe + 7],
    trunkLean: Math.atan2(out[he + 11] - out[pe + 11], out[he + 7] - out[pe + 7]),
    ankleLean,
    kneeLy: out[P.shinL * 12 + 7],
    kneeRy: out[P.shinR * 12 + 7],
    kneeLz: out[P.shinL * 12 + 11] - out[P.thighL * 12 + 11],
    kneeRz: out[P.shinR * 12 + 11] - out[P.thighR * 12 + 11],
    stretch,
    handLz: hand(P.handL),
    handRz: hand(P.handR),
    lean: lean(out, P.chest) + lean(out, P.pelvis) * 0,
    lPitch: rig.up[U.lPitch],
    rPitch: rig.up[U.rPitch],
    lElbow: rig.up[U.lElbow],
    rElbow: rig.up[U.rElbow],
    reachErr,
    aL: pl.feet[0].z - z,
    aR: pl.feet[1].z - z,
    bothAir: pl.feet[0].stepping && pl.feet[1].stepping,
    // the skirt's tilt against the pelvis: the angle between their local Y axes (in the YZ plane), its depth (Z) and its length (Y) against the pelvis's
    skirtTilt: Math.abs(lean(out, P.skirt) - lean(out, P.pelvis)),
    skirtDepth: Math.hypot(out[sk + 2], out[sk + 6], out[sk + 10]) / Math.hypot(out[pe + 2], out[pe + 6], out[pe + 10]),
    skirtLen: Math.hypot(out[sk + 1], out[sk + 5], out[sk + 9]) / Math.hypot(out[pe + 1], out[pe + 5], out[pe + 9]),
  }
}

const range = (xs: number[]) => ({ min: Math.min(...xs), max: Math.max(...xs), p2p: Math.max(...xs) - Math.min(...xs), mean: xs.reduce((s, x) => s + x, 0) / xs.length })
function corr(a: number[], b: number[]): number {
  const ma = range(a).mean
  const mb = range(b).mean
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < a.length; i++) {
    sxy += (a[i] - ma) * (b[i] - mb)
    sxx += (a[i] - ma) ** 2
    syy += (b[i] - mb) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

const SPEEDS_TESTED = [0.8, 1.2, 1.5, 2.0, 2.6, 3.2, 4.2, 4.5]

// ---------------------------------------------------------------------------------------------
// The numbers behind the gait
// ---------------------------------------------------------------------------------------------
describe('gait parameters', () => {
  it('are the old walk, number for number, up to 1.4 m/s (every NPC), at any size', () => {
    const gp = createGaitParams()
    for (let i = 0; i <= 70; i++) {
      const v = Math.min(i * 0.02, SPEEDS.walk)
      for (const scale of [0.94, 1, 1.06]) {
        gaitParams(v, scale, gp)
        expect(gp.sl).toBe(halfStride(v) * scale)
        expect(gp.sb).toBe(halfStride(v) * scale)
        expect(gp.dur).toBe(swingTime(v))
        expect(gp.lift).toBe(0.03 + 0.045 * clamp(v / 1.4, 0, 1.3))
        expect(gp.gate).toBe(1)
        expect(gp.gap).toBe(0)
        expect(gp.run).toBe(0)
      }
    }
  })

  it('make a foot cycle that fits: a step takes at least as long as a swing wherever the gate is shut, and the stance, swing and cadence add up', () => {
    const gp = createGaitParams()
    for (let v = 0.3; v <= 6; v += 0.05) {
      gaitParams(v, 1, gp)
      const cycle = (gp.sl + gp.sb) / v + gp.dur
      if (v > SPEEDS.walk) expect(Math.abs(cycle - 2 / gp.cadence)).toBeLessThan(1e-9)
      // the feet can alternate: the next foot lifts once the last one is `gate` of the way through its swing, which is no later than half a cycle
      if (v <= 1.9 || v > SPEEDS.walk) expect(gp.gate * gp.dur).toBeLessThanOrEqual(cycle / 2 + 1e-9)
      expect(gp.gate).toBeGreaterThan(0.5)
      expect(gp.gate).toBeLessThanOrEqual(1)
    }
  })

  it('change smoothly with speed: no jump anywhere between a stand and 6 m/s', () => {
    const a = createGaitParams()
    const b = createGaitParams()
    for (let v = 0; v < 6; v += 0.01) {
      gaitParams(v, 1, a)
      gaitParams(v + 0.01, 1, b)
      expect(Math.abs(b.sl - a.sl)).toBeLessThan(0.02)
      expect(Math.abs(b.sb - a.sb)).toBeLessThan(0.02)
      expect(Math.abs(b.dur - a.dur)).toBeLessThan(0.02)
      expect(Math.abs(b.cadence - a.cadence)).toBeLessThan(0.1)
      expect(Math.abs(b.run - a.run)).toBeLessThan(0.05)
    }
  })

  it('blend from a walk to a run between 2.2 and 2.8 m/s, and a run has a flight phase (a swing longer than a step) from about 2.4 m/s', () => {
    expect(runBlend(SPEEDS.runFrom)).toBe(0)
    expect(runBlend(SPEEDS.runTo)).toBe(1)
    expect(runBlend(1.9)).toBe(0)
    expect(briskBlend(1.4)).toBe(0)
    expect(briskBlend(2.0)).toBe(1)
    let last = -1
    for (let v = 2.2; v <= 2.8; v += 0.02) {
      expect(runBlend(v)).toBeGreaterThanOrEqual(last)
      last = runBlend(v)
    }
    const gp = createGaitParams()
    let lastFlight = -1
    for (let v = 1.5; v <= 5.5; v += 0.1) {
      gaitParams(v, 1, gp)
      const flight = gp.dur - 1 / gp.cadence
      if (v <= 2.2) expect(flight).toBeLessThanOrEqual(1e-9)
      if (v >= 2.6) expect(flight).toBeGreaterThan(0.03)
      expect(flight).toBeLessThan(0.14)
      // it grows through the blend (the flight share saturates above 4 m/s while the step gets shorter, so it levels off)
      if (v <= 3.6) expect(flight).toBeGreaterThanOrEqual(lastFlight - 1e-9)
      lastFlight = flight
    }
  })

  it('scale strides and foot spacing with the size of the person but not the cadence', () => {
    const a = createGaitParams()
    const b = createGaitParams()
    gaitParams(2, 1, a)
    gaitParams(2, 1.06, b)
    expect(b.sl).toBeCloseTo(a.sl * 1.06, 9)
    expect(b.sb).toBeCloseTo(a.sb * 1.06, 9)
    expect(b.dur).toBe(a.dur)
  })
})

describe('swing easing', () => {
  it('is the old smootherstep for the NPCs, and starts with the body speed and stops dead (no speed over the ground at touchdown) for the new gait', () => {
    for (let t = 0; t <= 1; t += 0.05) expect(swingEase(t, 0, 0.7)).toBe(smoother01(t))
    for (const lam of [0, 0.3, 0.6, 1]) {
      expect(swingEase(0, 1, lam)).toBe(0)
      expect(swingEase(1, 1, lam)).toBeCloseTo(1, 12)
      let last = -1
      for (let t = 0; t <= 1; t += 0.01) {
        const e = swingEase(t, 1, lam)
        expect(e).toBeGreaterThanOrEqual(last - 1e-12)
        last = e
      }
      // slope at the start is `lam`, at the end zero
      expect((swingEase(0.0001, 1, lam) - swingEase(0, 1, lam)) / 0.0001).toBeCloseTo(lam, 2)
      expect((swingEase(1, 1, lam) - swingEase(0.9999, 1, lam)) / 0.0001).toBeCloseTo(0, 2)
    }
  })

  it('stancePitch is the old curve at a walk and lands flatter and pushes off further at a run', () => {
    for (const ps of [-1.2, -0.8, -0.4, 0, 0.6, 1]) expect(stancePitch(ps, 1)).toBe(oldStancePitch(ps, 1))
    expect(stancePitch(1, 1, 1)).toBeLessThan(stancePitch(1, 1, 0))
    expect(stancePitch(-1, 1, 1)).toBeLessThan(stancePitch(-1, 1, 0))
  })
})

// ---------------------------------------------------------------------------------------------
// The NPCs do not change
// ---------------------------------------------------------------------------------------------
describe('NPC walking is unchanged', () => {
  /** Drive both planners with the same body: stand, start, stroll, turn, slow, stop, start again, with every frame rate and size. */
  function compare(dt: number, scale: number, peak: number): number {
    const a = createPlanter()
    const b = createOldPlanter()
    let x = 0
    let z = 0
    let heading = 0.4
    let v = 0
    let worst = 0
    for (let i = 0; i * dt < 40; i++) {
      const t = i * dt
      const target = t < 2 ? 0 : t < 12 ? peak : t < 18 ? peak * 0.45 : t < 22 ? 0 : t < 32 ? peak * 0.9 : peak * 0.6
      v += (target - v) * Math.min(1, dt * 6)
      if (v < 0.01) v = 0
      if (t > 8 && t < 9) heading += 2.2 * dt
      if (t > 25 && t < 25.5) heading -= 3.1 * dt
      x += Math.sin(heading) * v * dt
      z += Math.cos(heading) * v * dt
      const vx = Math.sin(heading) * v
      const vz = Math.cos(heading) * v
      updatePlanter(a, dt, x, z, heading, vx, vz, v, scale)
      oldUpdate(b, dt, x, z, heading, vx, vz, v, scale)
      for (let k = 0; k < 2; k++) {
        const f = a.feet[k]
        const g = b.feet[k]
        expect(f.stepping).toBe(g.stepping)
        worst = Math.max(worst, Math.abs(f.x - g.x), Math.abs(f.z - g.z), Math.abs(f.yaw - g.yaw), Math.abs(f.lift - g.lift), Math.abs(f.pitch - g.pitch), Math.abs(f.t - g.t), Math.abs(f.dur - g.dur))
      }
      worst = Math.max(worst, Math.abs(a.gait - b.gait), Math.abs(a.stance[0] - b.stance[0]), Math.abs(a.stance[1] - b.stance[1]))
      expect(a.steps).toBe(b.steps)
      expect(a.moving).toBe(b.moving)
    }
    return worst
  }

  it('matches the old planner frame by frame at the NPC speeds (1.0 to 1.4 m/s), at 30, 60 and 144 fps, for small and tall people', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) for (const scale of [0.94, 1.06]) for (const peak of [1.0, 1.3, 1.4]) expect(compare(dt, scale, peak)).toBeLessThan(1e-9)
  })

  it('leaves the rig in the NPC walk: no run, no brisk-walk pose, whatever the sim called the animation', () => {
    const { rig, frames } = rigRun(1.3)
    expect(rig.run).toBe(0)
    expect(rig.brisk).toBe(0)
    // the same bob as before (see crowd.test.ts: a few centimetres, not a bounce)
    expect(range(frames.map((f) => f.pelvisY)).p2p).toBeGreaterThan(0.02)
    expect(range(frames.map((f) => f.pelvisY)).p2p).toBeLessThan(0.11)
    // the white coat hangs from the pelvis as it always did
    const stand = rigRun(0, { seconds: 2, settle: 1 }).frames[0]
    for (const f of frames) {
      expect(f.skirtTilt).toBeLessThan(1e-6)
      expect(f.skirtDepth).toBeCloseTo(stand.skirtDepth, 5)
      expect(f.skirtLen).toBeCloseTo(stand.skirtLen, 5)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Steady speeds
// ---------------------------------------------------------------------------------------------
describe('the footfalls at a steady speed', () => {
  const byV = new Map<number, Steady>()
  for (const v of SPEEDS_TESTED) byV.set(v, steady(v))

  it('alternate, never slide, and are never an emergency step (the old planner lunged above 1.9 m/s)', () => {
    for (const v of SPEEDS_TESTED) {
      const s = byV.get(v)!
      expect(s.alternates, `alternates at ${v}`).toBe(true)
      expect(s.slide, `slide at ${v}`).toBe(0)
      expect(s.forced, `forced steps at ${v}`).toBe(0)
    }
  })

  it('are human in step length and cadence: 0.65 to 0.9 m and 1.9 to 2.6 steps/s as a brisk walk, 0.9 to 1.6 m and 2.6 to 3.6 steps/s as a run', () => {
    for (const v of SPEEDS_TESTED) {
      const s = byV.get(v)!
      // a step is the distance between two touchdowns: the speed is the step length times the cadence
      expect(s.step * s.cadence, `v = step x cadence at ${v}`).toBeGreaterThan(v * 0.97)
      expect(s.step * s.cadence).toBeLessThan(v * 1.03)
      if (v < 1) {
        expect(s.step).toBeGreaterThan(0.35)
        expect(s.step).toBeLessThan(0.6)
        expect(s.cadence).toBeGreaterThan(1.6)
        expect(s.cadence).toBeLessThan(2.1)
      } else if (v <= 2.2) {
        expect(s.step, `step at ${v}`).toBeGreaterThan(0.6)
        expect(s.step, `step at ${v}`).toBeLessThan(0.9)
        expect(s.cadence, `cadence at ${v}`).toBeGreaterThan(1.9)
        expect(s.cadence, `cadence at ${v}`).toBeLessThan(2.6)
      } else {
        expect(s.step, `step at ${v}`).toBeGreaterThan(0.9)
        expect(s.step, `step at ${v}`).toBeLessThan(1.6)
        expect(s.cadence, `cadence at ${v}`).toBeGreaterThan(2.6)
        expect(s.cadence, `cadence at ${v}`).toBeLessThan(3.6)
      }
    }
    // the run on Shift (4.2 m/s): about 1.25 m steps at 3.2 to 3.5 steps/s
    const run = byV.get(4.2)!
    expect(run.step).toBeGreaterThan(1.1)
    expect(run.step).toBeLessThan(1.45)
    expect(run.cadence).toBeGreaterThan(3.2)
    expect(run.cadence).toBeLessThan(3.5)
    // the step is the same every time: no short step then a long one
    for (const v of SPEEDS_TESTED) {
      const s = byV.get(v)!
      // (a frame is 7 cm of a run at 60 fps: a step takes 17 or 18 of them)
      expect(s.stepMax - s.stepMin, `uneven steps at ${v}`).toBeLessThan(v < 1.4 ? 0.3 : 0.1)
    }
  })

  it('grow in step length and in cadence with the speed', () => {
    let step = 0
    let cadence = 0
    for (const v of SPEEDS_TESTED) {
      const s = byV.get(v)!
      expect(s.step).toBeGreaterThan(step)
      expect(s.cadence).toBeGreaterThanOrEqual(cadence - 0.05)
      step = s.step
      cadence = s.cadence
    }
  })

  it('have no flight phase in a walk and a measurable one in a run (both feet in the air, briefly)', () => {
    for (const v of [0.8, 1.2, 1.5, 2.0]) expect(byV.get(v)!.airShare, `air at ${v}`).toBe(0)
    let last = 0
    for (const v of [2.6, 3.2, 4.2, 4.5]) {
      const s = byV.get(v)!
      expect(s.airShare, `air at ${v}`).toBeGreaterThan(0.1)
      expect(s.airShare).toBeLessThan(0.6)
      expect(s.flight, `flight at ${v}`).toBeGreaterThan(0.04)
      expect(s.flight).toBeLessThan(0.2)
      expect(s.flight).toBeGreaterThanOrEqual(last - 0.02)
      last = s.flight
    }
  })

  it('land under the body, never far in front (a run lands 0.3 m ahead), and never split wider than a stride (the old gait split to 1.2 to 1.5 m)', () => {
    for (const v of SPEEDS_TESTED) {
      const s = byV.get(v)!
      if (v >= 2.6) expect(s.landing, `landing at ${v}`).toBeLessThan(0.34)
      else if (v > 1.4) expect(s.landing, `landing at ${v}`).toBeLessThan(0.42)
      expect(s.ahead, `ahead at ${v}`).toBeLessThan(0.58)
      expect(s.behind, `behind at ${v}`).toBeGreaterThan(-0.58)
      expect(s.split, `split at ${v}`).toBeLessThan(1.0)
    }
  })

  it('do not depend on the frame rate or on the size of the person', () => {
    for (const v of [2.0, 4.2]) {
      const ref = byV.get(v)!
      for (const dt of [1 / 30, 1 / 120, 1 / 144]) {
        const s = steady(v, { dt })
        expect(s.forced, `forced at ${v} / ${dt}`).toBe(0)
        expect(s.alternates).toBe(true)
        expect(s.slide).toBe(0)
        expect(Math.abs(s.step - ref.step) / ref.step, `step at ${v} / ${dt}`).toBeLessThan(0.12)
      }
      for (const scale of [0.94, 1.06]) {
        const s = steady(v, { scale })
        expect(s.forced).toBe(0)
        expect(s.alternates).toBe(true)
        expect(s.slide).toBe(0)
      }
    }
  })

  it('stay finite and without emergencies even at the sim running 4x (5.2 m/s) and at 6 m/s', () => {
    for (const v of [5.2, 6]) {
      const s = steady(v)
      expect(s.alternates).toBe(true)
      expect(s.slide).toBe(0)
      expect(s.forced).toBe(0)
      expect(Number.isFinite(s.step)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The body above the feet
// ---------------------------------------------------------------------------------------------
describe('the pelvis and the legs', () => {
  const runs = new Map<number, Frame[]>()
  for (const v of [0, ...SPEEDS_TESTED]) runs.set(v, rigRun(v).frames)

  it('keep the pelvis within a few centimetres at a steady speed (the old gait dropped it by 20 to 37 cm at 2 to 4 m/s)', () => {
    expect(STAND_Y).toBeGreaterThan(0.9)
    for (const v of SPEEDS_TESTED) {
      const y = range(runs.get(v)!.map((f) => f.pelvisY))
      expect(STAND_Y - y.min, `lowest at ${v}`).toBeLessThan(v >= 2.6 ? 0.1 : 0.1)
      expect(y.p2p, `bob at ${v}`).toBeLessThan(v <= 1.5 ? 0.09 : 0.06)
    }
    // a brisk walk bobs 3 to 5 cm, a run about 5 cm
    expect(range(runs.get(2.0)!.map((f) => f.pelvisY)).p2p).toBeLessThan(0.045)
    expect(range(runs.get(4.2)!.map((f) => f.pelvisY)).p2p).toBeLessThan(0.065)
  })

  it('sit a little lower at a brisk walk (bent knees), keep the legs long at a run, and bounce with the stride', () => {
    const mean = (v: number) => range(runs.get(v)!.map((f) => f.pelvisY)).mean
    expect(mean(1.2)).toBeLessThan(STAND_Y)
    expect(mean(2.0)).toBeLessThan(mean(1.2) - 0.015)
    // a run is not a crouch: on average at most 3 cm below standing, bobbing 3.5 to 6.5 cm
    expect(STAND_Y - mean(4.2), 'run height').toBeLessThan(0.03)
    expect(range(runs.get(4.2)!.map((f) => f.pelvisY)).p2p).toBeGreaterThan(0.035)
    // the bounce: the pelvis rises while both feet are in the air and sinks over a planted foot
    const f = runs.get(4.2)!
    const air = f.filter((x) => x.bothAir).map((x) => x.pelvisY)
    const down = f.filter((x) => !x.bothAir).map((x) => x.pelvisY)
    expect(air.length).toBeGreaterThan(20)
    // the highest point of the stride is in the flight
    expect(Math.max(...air)).toBeGreaterThanOrEqual(Math.max(...down) - 0.001)
  })

  it('always reach: the planted foot is drawn exactly where the planner put it', () => {
    for (const v of SPEEDS_TESTED) expect(Math.max(...runs.get(v)!.map((f) => f.reachErr)), `reach at ${v}`).toBeLessThan(0.02)
  })

  it('lean the torso forward at a run (the pelvis to neck line and the line from the planted ankle to the head) and a little more the faster they go', () => {
    const trunk = (v: number) => (range(runs.get(v)!.map((f) => f.trunkLean)).mean * 180) / Math.PI
    const ankle = (v: number) => {
      const xs = runs.get(v)!.flatMap((f) => f.ankleLean)
      return (range(xs).mean * 180) / Math.PI
    }
    expect(trunk(1.2)).toBeLessThan(10)
    expect(trunk(4.2)).toBeGreaterThan(10)
    expect(trunk(4.2)).toBeLessThan(18)
    expect(ankle(4.2), 'ankle line at 4.2').toBeGreaterThan(8)
    expect(ankle(4.2)).toBeLessThan(12)
    expect(ankle(3.2), 'ankle line at 3.2').toBeGreaterThan(8)
    expect(ankle(3.2)).toBeLessThan(12)
    // the blend: between a stroll and a run the lean grows steadily
    expect(trunk(2.0)).toBeLessThan(trunk(2.6) + 0.01)
    expect(trunk(2.6)).toBeLessThan(trunk(3.2) + 0.01)
    expect(trunk(2.0)).toBeLessThan(trunk(4.2) - 4)
  })

  it('let the white coat follow the legs instead of hanging like a stiff dress, subtly: it tips and opens a little, and rides up a little at a run', () => {
    for (const v of [2.0, 4.2]) {
      const f = runs.get(v)!
      const tilt = range(f.map((x) => x.skirtTilt))
      expect(tilt.max, `tilt at ${v}`).toBeGreaterThan(0.01)
      expect(tilt.max, `tilt at ${v}`).toBeLessThan(0.14)
      expect(Math.max(...f.map((x) => x.skirtDepth))).toBeLessThan(1.35)
      expect(Math.max(...f.map((x) => x.skirtDepth))).toBeGreaterThan(1.05)
    }
    const run = runs.get(4.2)!
    const stand = runs.get(0)!
    expect(range(run.map((x) => x.skirtLen)).mean).toBeLessThan(range(stand.map((x) => x.skirtLen)).mean * 0.98)
    expect(range(run.map((x) => x.skirtLen)).mean).toBeGreaterThan(range(stand.map((x) => x.skirtLen)).mean * 0.9)
    // standing, the coat hangs straight
    for (const x of stand) expect(x.skirtTilt).toBeLessThan(1e-6)
  })
})

describe('the arms', () => {
  const runs = new Map<number, Frame[]>()
  for (const v of [0.8, 1.2, 1.5, 2.0, 2.6, 3.2, 4.2]) runs.set(v, rigRun(v).frames)
  const swing = (v: number) => range(runs.get(v)!.map((f) => f.lPitch)).p2p

  it('swing in opposition to the legs: the left arm goes back as the left foot comes forward, and the two arms swing against each other', () => {
    for (const v of [0.8, 1.2, 1.5, 2.0, 2.6, 3.2, 4.2]) {
      const f = runs.get(v)!
      // forward (+) = left foot ahead of the right
      const legs = f.map((x) => x.aL - x.aR)
      expect(corr(f.map((x) => x.lPitch), legs), `left arm and legs at ${v}`).toBeLessThan(-0.45)
      expect(corr(f.map((x) => x.rPitch), legs), `right arm and legs at ${v}`).toBeGreaterThan(0.45)
      expect(corr(f.map((x) => x.lPitch), f.map((x) => x.rPitch)), `arms against each other at ${v}`).toBeLessThan(-0.9)
    }
  })

  it('swing wider the faster they go', () => {
    let last = 0
    for (const v of [0.8, 1.2, 2.0, 4.2]) {
      expect(swing(v), `swing at ${v}`).toBeGreaterThan(last + 0.04)
      last = swing(v)
    }
    expect(swing(4.2)).toBeGreaterThan(swing(1.2) * 1.2)
  })

  it('are never stuck: every arm swings behind and ahead of the body in each stride, and does not freeze at the ends of the swing', () => {
    for (const v of [1.5, 2.0, 2.6, 3.2, 4.2]) {
      for (const key of ['lPitch', 'rPitch'] as const) {
        const xs = runs.get(v)!.map((f) => f[key])
        const r = range(xs)
        expect(r.min, `${key} back at ${v}`).toBeLessThan(-0.2)
        expect(r.max, `${key} ahead at ${v}`).toBeGreaterThan(0.3)
        let frozen = 0
        for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - xs[i - 1]) < 0.0015) frozen++
        if (v >= 2.0) expect(frozen / xs.length, `${key} frozen at ${v}`).toBeLessThan(0.1)
      }
    }
  })

  it('bend the elbow a little in a walk (never the forearm held out in front) and to about a right angle in a run', () => {
    // (the NPCs' stroll keeps its old, slightly more bent elbow; the player's brisk walk does not close it past 46 degrees)
    const walk = range(runs.get(2.0)!.flatMap((f) => [f.lElbow, f.rElbow]))
    expect(walk.max).toBeLessThan(0.8)
    expect(walk.min).toBeGreaterThan(0.2)
    const run = range(runs.get(4.2)!.flatMap((f) => [f.lElbow, f.rElbow]))
    expect(run.min).toBeGreaterThan(1.05)
    expect(run.max).toBeLessThan(1.95)
    expect(run.mean).toBeGreaterThan(1.3)
    expect(run.mean).toBeLessThan(1.7)
    // the blend: through 2.2 to 2.8 m/s the elbows close gradually
    let last = 0
    for (const v of [2.0, 2.6, 3.2]) {
      const m = range(runs.get(v)!.flatMap((f) => [f.lElbow, f.rElbow])).mean
      expect(m).toBeGreaterThan(last)
      last = m
    }
  })

  it('belong to the measured speed: anybody going fast runs, whatever the animation says', () => {
    const rig = createRig(lookFor({ id: 'ped-17', role: 'nurse', variant: 3 }))
    const inp = makeInput()
    const out = new Float32Array(PART_COUNT * 12)
    inp.mode = 'relaxed'
    let z = 0
    for (let i = 0; i < 300; i++) {
      z += 4 / 60
      inp.z = z
      inp.vz = 4
      inp.speed = 4
      inp.time = i / 60
      solveRig(rig, inp, out, 0)
    }
    expect(rig.run).toBeGreaterThan(0.99)
    expect(rig.brisk).toBeGreaterThan(0.99)
    expect(rig.ctx.run).toBeGreaterThan(0.99)
  })
})

// ---------------------------------------------------------------------------------------------
// The run (4.2 m/s on Shift): the tuning targets
// ---------------------------------------------------------------------------------------------
describe('the run reads as a run, not as a crouch', () => {
  const runs = new Map<number, Frame[]>()
  for (const v of [3.2, 4.2, 4.5]) runs.set(v, rigRun(v).frames)
  const steadyRun = steady(4.2)

  it('has a short flight (about a third of a step, a cadence of 3.2 to 3.5 steps/s), lands under the hips and is never in double support', () => {
    expect(steadyRun.airShare).toBeGreaterThan(0.28)
    expect(steadyRun.airShare).toBeLessThan(0.37)
    expect(steadyRun.cadence).toBeGreaterThan(3.2)
    expect(steadyRun.cadence).toBeLessThan(3.5)
    expect(steadyRun.landing).toBeGreaterThan(0.2)
    expect(steadyRun.landing).toBeLessThan(0.3)
    expect(steadyRun.forced).toBe(0)
    for (const v of [3.2, 4.2, 4.5]) {
      const f = runs.get(v)!
      // both feet on the ground at once: the wide-stance squat
      let both = 0
      for (const x of f) if (x.ankleLean.length === 2) both++
      expect(both, `double support at ${v}`).toBe(0)
    }
    // at 3.2 the flight is shorter still
    expect(steady(3.2).airShare).toBeLessThan(steadyRun.airShare)
  })

  it('keeps the pelvis within 3 cm of standing on average, bobbing 3.5 to 6.5 cm, and never sinks more than 8 cm', () => {
    for (const v of [3.2, 4.2, 4.5]) {
      const y = range(runs.get(v)!.map((f) => f.pelvisY))
      expect(STAND_Y - y.mean, `mean at ${v}`).toBeLessThan(0.03)
      expect(y.p2p, `bob at ${v}`).toBeLessThan(0.065)
      expect(STAND_Y - y.min, `lowest at ${v}`).toBeLessThan(0.08)
    }
    expect(range(runs.get(4.2)!.map((f) => f.pelvisY)).p2p).toBeGreaterThan(0.035)
  })

  it('has the stance leg nearly straight at mid-stance, not squatting', () => {
    for (const v of [3.2, 4.2, 4.5]) {
      const st = runs.get(v)!.map((f) => f.stretch).filter((x) => !Number.isNaN(x))
      expect(st.length).toBeGreaterThan(20)
      expect(Math.min(...st), `stretch at ${v}`).toBeGreaterThan(0.94)
    }
  })

  it('drives the swing knee forward and up toward the hip, and never has both knees up together (sitting in the air)', () => {
    for (const v of [3.2, 4.2, 4.5]) {
      const f = runs.get(v)!
      const knee = Math.max(...f.map((x) => Math.max(x.kneeLy, x.kneeRy)))
      expect(knee, `knee drive at ${v}`).toBeGreaterThan(0.62)
      expect(Math.max(...f.map((x) => Math.max(x.kneeLz, x.kneeRz))), `knee forward at ${v}`).toBeGreaterThan(0.3)
      // the pelvis is at 0.9 m, a knee at 0.6 m is a thigh lifted 45 degrees: never both at once
      let both = 0
      for (const x of f) if (x.kneeLy > 0.6 && x.kneeRy > 0.6) both++
      expect(both, `both knees up at ${v}`).toBe(0)
      // and the trailing leg is never folded up under the body while the other one lands: while both feet are in the air one knee is below 0.55
      for (const x of f) if (x.bothAir) expect(Math.min(x.kneeLy, x.kneeRy)).toBeLessThan(0.55)
    }
  })

  it('pumps the arms front and back with the elbows about a right angle: one hand clearly behind the body while the other is far ahead', () => {
    for (const v of [3.2, 4.2, 4.5]) {
      const f = runs.get(v)!
      const l = f.map((x) => x.handLz)
      const r = f.map((x) => x.handRz)
      expect(range(l).p2p, `left hand travel at ${v}`).toBeGreaterThan(0.45)
      expect(range(r).p2p).toBeGreaterThan(0.45)
      expect(range(l).min, `left hand behind the body at ${v}`).toBeLessThan(0.02)
      expect(range(r).min).toBeLessThan(0.02)
      expect(corr(l, r)).toBeLessThan(-0.9)
      // both forearms are never far forward together
      for (let i = 0; i < f.length; i++) expect(Math.min(l[i], r[i]), `both hands ahead at ${v}`).toBeLessThan(0.3)
      // when one hand is at the front of its swing the other is behind the hips
      const lMax = Math.max(...l)
      const rMax = Math.max(...r)
      for (let i = 0; i < f.length; i++) {
        if (l[i] > lMax - 0.03) expect(r[i]).toBeLessThan(0.1)
        if (r[i] > rMax - 0.03) expect(l[i]).toBeLessThan(0.1)
      }
      const e = range(f.flatMap((x) => [x.lElbow, x.rElbow]))
      expect(e.min).toBeGreaterThan(1.05)
      expect(e.max).toBeLessThan(1.95)
      expect(e.mean).toBeGreaterThan(1.3)
      expect(e.mean).toBeLessThan(1.7)
    }
  })

  it('is the same walk as before at 2 m/s: the run changes nothing below the blend (2.2 m/s)', () => {
    const w = rigRun(2.0).frames
    // a brisk walk bobs about 2 cm, sits about 4.5 cm lower than standing, has the elbow under 46 degrees and no flight
    expect(range(w.map((x) => x.pelvisY)).p2p).toBeLessThan(0.035)
    expect(STAND_Y - range(w.map((x) => x.pelvisY)).mean).toBeGreaterThan(0.03)
    expect(STAND_Y - range(w.map((x) => x.pelvisY)).mean).toBeLessThan(0.07)
    expect(w.some((x) => x.bothAir)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// Starting, stopping, turning
// ---------------------------------------------------------------------------------------------
interface Path {
  /** Wanted ground speed and the heading of the walk, as functions of time. */
  speed: (t: number) => number
  dir: (t: number) => number
}
interface PathResult {
  minPelvis: number
  maxReach: number
  /** How far each planted foot ends up from pointing along the body, at the end of the path (radians). */
  maxYawGap: number
  forced: number
  bothAirAfterStop: number
  finite: boolean
  rig: PersonRig
  heading: number
  frames: DFrame[]
}
/**
 * A person driven the way the player system drives the player (playerDrive.testkit.ts): the speed follows a critically damped spring
 * (CONFIG.player.startSeconds / stopSeconds / shiftSeconds), the body turns to face its way with the configured turn time, and the rig is handed the
 * true velocity and the intent (what the keys ask for, the acceleration, the turn rate, the rest point), like `walkBody` carries them.
 */
function drive(path: Path, seconds: number, dt = 1 / 60): PathResult {
  const r = kitDrive({ speed: path.speed, dir: path.dir }, seconds, { dt, driven: true })
  const fr = r.frames
  let bothAirAfterStop = 0
  for (const f of fr) if (f.wishSpeed === 0 && f.speed < 0.05 && f.bothAir) bothAirAfterStop++
  let maxYawGap = 0
  for (let k = 0; k < 2; k++) maxYawGap = Math.max(maxYawGap, Math.abs(wrapPi(r.rig.planter.feet[k].yaw - r.heading - (k === 0 ? 1 : -1) * GAIT.toeOut)))
  return {
    minPelvis: Math.min(...fr.map((f) => f.pelvisY)),
    maxReach: Math.max(...fr.map((f) => f.reachErr)),
    maxYawGap,
    forced: r.forced,
    bothAirAfterStop,
    finite: r.finite,
    rig: r.rig,
    heading: r.heading,
    frames: fr,
  }
}

describe('turning', () => {
  it('takes about a tenth of a second more than it did, so the body does not snap round: a turn time of 0.12 to 0.15 s', () => {
    expect(CONFIG.player.turnSeconds).toBeGreaterThanOrEqual(0.12)
    expect(CONFIG.player.turnSeconds).toBeLessThanOrEqual(0.15)
  })

  it('in place, for a body that is measured (the NPCs): the feet step round to the new heading, nothing is left twisted, and the pelvis does not sink', () => {
    for (const angle of [0.4, Math.PI / 2, Math.PI, -2.5]) {
      const rig = createRig(LOOK)
      const inp = makeInput()
      const out = new Float32Array(PART_COUNT * 12)
      let heading = 0
      let minPelvis = 9
      let maxReach = 0
      let finite = true
      const dt = 1 / 60
      for (let i = 0; i < 60 * 3; i++) {
        const t = i * dt
        // the body turns to face a new way with the configured turn time (no faster than 20 rad/s), as the player system does
        if (t > 0.5) heading = wrapPi(heading + clamp(wrapPi(angle - heading) * (1 - Math.exp(-dt / CONFIG.player.turnSeconds)), -20 * dt, 20 * dt))
        inp.dt = dt
        inp.time = t
        inp.heading = heading
        solveRig(rig, inp, out, 0)
        for (let k = 0; k < PART_COUNT * 12; k++) if (!Number.isFinite(out[k])) finite = false
        const f = frameOf(rig, out, t, 0, heading)
        minPelvis = Math.min(minPelvis, f.pelvisY)
        maxReach = Math.max(maxReach, f.reachErr)
      }
      const feet = rig.planter.feet
      expect(finite).toBe(true)
      expect(maxReach, `reach turning ${angle}`).toBeLessThan(0.02)
      expect(STAND_Y - minPelvis, `sink turning ${angle}`).toBeLessThan(0.03)
      expect(feet[0].stepping || feet[1].stepping).toBe(false)
      // a turn too small to be worth a step leaves the feet where they are (they re-home from 0.7 rad); a bigger one steps both round
      for (let k = 0; k < 2; k++) expect(Math.abs(wrapPi(feet[k].yaw - heading - (k === 0 ? 1 : -1) * GAIT.toeOut)), `foot ${k} after ${angle}`).toBeLessThan(Math.abs(angle) > 1 ? 0.3 : GAIT.idleStepYaw + 0.01)
      // a small turn is taken on the spot, a large one is stepped
      if (Math.abs(angle) > 1) expect(rig.planter.steps).toBeGreaterThanOrEqual(2)
      else expect(rig.planter.steps).toBe(0)
    }
  })

  it('on the move: a 90 degree turn at a brisk walk and at a run keeps the feet under the body and the pelvis up', () => {
    for (const [v, drop] of [
      [CONFIG.player.walkSpeed, 0.1],
      [CONFIG.player.hurrySpeed, 0.15],
    ] as const) {
      for (const sign of [1, -1]) {
        const r = drive({ speed: () => v, dir: (t) => (t < 3 ? 0 : (sign * Math.PI) / 2) }, 6)
        expect(r.finite).toBe(true)
        expect(r.maxReach, `reach in a turn at ${v}`).toBeLessThan(0.03)
        expect(STAND_Y - r.minPelvis, `sink in a turn at ${v}`).toBeLessThan(drop + 0.04)
        // no emergency step in the turn
        expect(r.forced, `emergencies in a turn at ${v}`).toBeLessThanOrEqual(1)
        // after the turn the steady stride is back: the lunge is gone
        const after = r.frames.filter((f) => f.t > 4.5)
        expect(range(after.map((f) => f.pelvisY)).p2p).toBeLessThan(0.07)
      }
    }
  })

  it('on the move: a steady curve (the camera orbiting while you walk) needs no emergency steps', () => {
    for (const [v, rate] of [
      [CONFIG.player.walkSpeed, 0.7],
      [CONFIG.player.hurrySpeed, 1.2],
    ] as const) {
      const r = drive({ speed: () => v, dir: (t) => t * rate }, 10)
      expect(r.finite).toBe(true)
      // the first step is up on the first frame and every one after it is in time: none is an emergency
      expect(r.forced, `forced on a curve at ${v}`).toBe(0)
      expect(r.maxReach).toBeLessThan(0.03)
      expect(STAND_Y - r.minPelvis).toBeLessThan(0.12)
    }
  })
})

describe('starting and stopping', () => {
  it('starting from rest at a walk or a run does not lunge: no emergency step, the pelvis stays within a few cm of a steady stride, the legs always reach', () => {
    for (const v of [CONFIG.player.walkSpeed, CONFIG.player.hurrySpeed]) {
      const r = drive({ speed: () => v, dir: () => 0 }, 6)
      expect(r.finite).toBe(true)
      expect(r.maxReach).toBeLessThan(0.02)
      // (a steady stride bottoms out about 6.5 cm below standing at a walk and 4 cm at a run: see playerGait.test.ts for the start against that)
      expect(STAND_Y - r.minPelvis, `start dip at ${v}`).toBeLessThan(v > 3 ? 0.09 : 0.08)
      expect(r.forced, `emergency steps starting at ${v}`).toBe(0)
      // and settles at once: the stride after the first second is the steady one
      const steady = r.frames.filter((f) => f.t > 3)
      expect(range(steady.map((f) => f.pelvisY)).p2p).toBeLessThan(0.065)
    }
  })

  it('stopping from a walk or a run closes the feet one at a time, with no hop', () => {
    for (const v of [CONFIG.player.walkSpeed, CONFIG.player.hurrySpeed]) {
      const r = drive({ speed: (t) => (t > 1 && t < 4 ? v : 0), dir: () => 0 }, 8)
      expect(r.finite).toBe(true)
      expect(r.bothAirAfterStop, `hop after a stop from ${v}`).toBe(0)
      expect(r.maxReach).toBeLessThan(0.02)
      // both feet end up beside each other
      const [a, b] = r.rig.planter.feet
      expect(a.stepping || b.stepping).toBe(false)
      expect(Math.abs(a.z - b.z)).toBeLessThan(0.12)
    }
  })

  it('walking to a run and back never breaks the stride', () => {
    const r = drive({ speed: (t) => (t % 4 < 2 ? CONFIG.player.walkSpeed : CONFIG.player.hurrySpeed), dir: () => 0 }, 20)
    expect(r.finite).toBe(true)
    expect(r.maxReach).toBeLessThan(0.02)
    expect(STAND_Y - r.minPelvis).toBeLessThan(0.12)
    expect(r.forced).toBeLessThanOrEqual(1)
  })
})

describe('the contract', () => {
  it('has the player walk briskly and run on Shift', () => {
    expect(CONFIG.player.walkSpeed).toBe(2.0)
    expect(CONFIG.player.hurrySpeed).toBe(4.2)
  })

  it('keeps the standing pelvis where the rig puts it', () => {
    expect(STAND_Y).toBeCloseTo(STAND_PELVIS * LOOK.scale, 1)
  })
})

// the type of a planter is part of the contract with the rig: a field removed would break the arms and the pelvis
describe('the planter exposes what the rig needs', () => {
  it('has the stride phase, the run blend, the bounce and the flight', () => {
    const p: Planter = createPlanter()
    updatePlanter(p, 1 / 60, 0, 0, 0, 0, 0, 0, 1)
    for (const k of ['swing', 'run', 'bounce', 'air', 'airTime', 'forced', 'params'] as const) expect(p).toHaveProperty(k)
    const inp: RigInput = makeInput()
    expect(inp.speed).toBe(0)
  })
})
