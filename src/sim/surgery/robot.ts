/**
 * R2: the da Vinci 5's finite-state machine, as pure functions. Given which segment of its day the robot is in (`RobotSegment`: a phase, when
 * it began and when it ends) and the time, `applyRobot` writes the whole `RobotState` the scene draws: the cart's pose on its drive from park
 * to dock, the boom (yaw, height, reach), the laser crosshair, and each arm's drape, port, instrument, engagement and force reading. Nothing is
 * stored between calls, so a warm start and a replay give exactly the same robot at the same time.
 *
 *   stowed -> draping (before wheels-in) -> draped -> deploying -> driving -> docking -> targeting -> docked -> undocking -> returning
 *   -> cleaning (turnover) -> [draping again for the next case | stowed]
 *
 * The docking phase of the theatre (5-8 min) is split into deploying / driving / docking / targeting by `DOCK_SPLIT`; the undocking phase into
 * undocking / returning by `UNDOCK_SPLIT`. Boundaries match: every number a segment ends with is the one the next begins with.
 */
import { SURGERY, type PortLayout } from '../places'
import type { RobotArmState, RobotPhase, RobotState } from '../types'

/** Fractions of the theatre's docking phase: deploying, driving, docking the endoscope arm, targeting. */
export const DOCK_SPLIT = [0.12, 0.3, 0.23, 0.35] as const
/** Fractions of the undocking phase: the arms undock, then the cart drives back to park. */
export const UNDOCK_SPLIT = [0.55, 0.45] as const
/** Seconds the drapes take to come off in the cleaning segment (staggered over the four arms). */
export const DRAPE_OFF_SECONDS = 240

const H_STOW = SURGERY.cart.size.stowedHeight
const H_TOP = SURGERY.cart.size.maxHeight
const H_UP = 2.2
const H_DOCK = 2.4
const H_TARGET = 2.3

export interface CartPose {
  x: number
  z: number
  heading: number
}

const PARK = SURGERY.cart.park
const DOCK = SURGERY.cart.dock
const DRIVE_HEADING = Math.atan2(DOCK.at.x - PARK.at.x, DOCK.at.z - PARK.at.z)
const TAU = Math.PI * 2

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Smooth start and stop. */
export function ease(k: number): number {
  const u = clamp01(k)
  return u * u * (3 - 2 * u)
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  else if (d < -Math.PI) d += TAU
  return a + d * k
}

/**
 * The patient cart on its way from its parking spot (k = 0) to the dock beside the table (k = 1): it turns on the spot toward the dock, drives
 * straight along the west side of the room (a clear line: x <= the dock's x, and well south-west of the table), then turns to face east, toward
 * the table, for the docking. The same path runs backwards (k from 1 to 0) when it returns. Allocation-free; `out` may be reused.
 */
export function cartPose(k: number, out: CartPose): CartPose {
  const u = clamp01(k)
  if (u < 0.25) {
    out.x = PARK.at.x
    out.z = PARK.at.z
    out.heading = lerpAngle(PARK.heading, DRIVE_HEADING, ease(u / 0.25))
  } else if (u < 0.75) {
    const s = ease((u - 0.25) / 0.5)
    out.x = lerp(PARK.at.x, DOCK.at.x, s)
    out.z = lerp(PARK.at.z, DOCK.at.z, s)
    out.heading = DRIVE_HEADING
  } else {
    out.x = DOCK.at.x
    out.z = DOCK.at.z
    out.heading = lerpAngle(DRIVE_HEADING, DOCK.heading, ease((u - 0.75) / 0.25))
  }
  return out
}

/** The cart's drive path as a polyline of poses (k = 0..1), for tests and the scene's clearance checks. */
export function cartPath(steps = 40): CartPose[] {
  const out: CartPose[] = []
  for (let i = 0; i <= steps; i++) out.push(cartPose(i / steps, { x: 0, z: 0, heading: 0 }))
  return out
}

/** One arm's force-feedback reading 0..1: a smooth, seeded wander (display only). */
export function forceAt(seed: number, t: number, arm: number): number {
  const a = ((seed >>> 0) * 0.000123 + arm * 1.7) % TAU
  const b = ((seed >>> 0) * 0.000071 + arm * 2.9) % TAU
  const v = 0.38 + 0.24 * Math.sin(0.61 * t + a) + 0.14 * Math.sin(1.73 * t + b) + 0.06 * Math.sin(4.1 * t + a * 2)
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export interface RobotSegment {
  kind: RobotPhase
  /** When this phase began, and when it is due to end (sim seconds; `until` is Infinity for an open-ended one). */
  since: number
  until: number
  /** The case (its index in today's list) the phase belongs to. */
  caseIndex: number
}

/** The times that place a case on the robot's day (realised once known, projected otherwise). */
export interface RobotCaseTimes {
  caseIndex: number
  drapeStart: number
  drapeEnd: number
  /** The theatre's docking phase. */
  dockStart: number
  dockEnd: number
  /** The undocking phase, and the moment its arms are undocked and the cart starts back. */
  undockStart: number
  retStart: number
  undockEnd: number
  /** The end of the turnover that follows. */
  cleanEnd: number
}

/**
 * Which segment of the robot's day `t` falls in. `times` lists the cases in order. Between cases the robot cleans (drapes off) until the
 * turnover ends or the next drape begins, then rests stowed until it is draped for the next case.
 */
export function segmentAt(t: number, times: readonly RobotCaseTimes[]): RobotSegment {
  const tail = (k: number): RobotSegment => {
    const c = times[k]
    const nextDrape = k + 1 < times.length ? times[k + 1].drapeStart : Infinity
    const stop = Math.min(c.cleanEnd, nextDrape)
    if (t < stop) return { kind: 'cleaning', since: c.undockEnd, until: stop, caseIndex: k }
    return { kind: 'stowed', since: stop, until: nextDrape, caseIndex: k }
  }
  for (let k = 0; k < times.length; k++) {
    const c = times[k]
    if (t < c.drapeStart) return k === 0 ? { kind: 'stowed', since: -Infinity, until: c.drapeStart, caseIndex: 0 } : tail(k - 1)
    if (t < c.drapeEnd) return { kind: 'draping', since: c.drapeStart, until: c.drapeEnd, caseIndex: k }
    if (t < c.dockStart) return { kind: 'draped', since: c.drapeEnd, until: c.dockStart, caseIndex: k }
    if (t < c.dockEnd) {
      const d = c.dockEnd - c.dockStart
      let at = c.dockStart
      const kinds = ['deploying', 'driving', 'docking', 'targeting'] as const
      for (let i = 0; i < 4; i++) {
        const end = i === 3 ? c.dockEnd : at + d * DOCK_SPLIT[i]
        if (t < end) return { kind: kinds[i], since: at, until: end, caseIndex: k }
        at = end
      }
    }
    if (t < c.undockStart) return { kind: 'docked', since: c.dockEnd, until: c.undockStart, caseIndex: k }
    if (t < c.retStart) return { kind: 'undocking', since: c.undockStart, until: c.retStart, caseIndex: k }
    if (t < c.undockEnd) return { kind: 'returning', since: c.retStart, until: c.undockEnd, caseIndex: k }
    // between this case's undocking and the next case's drape: cleaning, then stowed (decided by `tail`, which needs the next case's drape)
    if (k + 1 >= times.length || t < times[k + 1].drapeStart) return tail(k)
  }
  return tail(times.length - 1)
}

/** What `applyRobot` needs besides the segment. */
export interface RobotContext {
  t: number
  layout: PortLayout
  /** The four instrument names by arm index (the procedure's copy). */
  instruments: readonly string[]
  /** The boom's final yaw for this case (rad). */
  boomYaw: number
  motionSeed: number
  /** When the console phase began (the exchanges' clock), or null. */
  consoleStart: number | null
  /** The planned exchanges (seconds into the console phase): the arm withdraws for a short while at each. */
  exchanges: readonly { at: number; arm: number }[]
}

/** Seconds the arm that is changing an instrument spends withdrawn. */
export const EXCHANGE_SECONDS = 12

function stowArms(arms: RobotArmState[], drape: number): void {
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i]
    a.drape = drape
    a.engage = 0
    a.port = null
    a.force = 0
  }
}

function stowBoom(r: RobotState): void {
  r.boomYaw = 0
  r.boomHeight = H_STOW
  r.boomExtend = 0
  r.laser = false
}

/** Write the robot's whole state for time `ctx.t` in segment `seg`. Allocation-free. */
export function applyRobot(r: RobotState, seg: RobotSegment, ctx: RobotContext): void {
  const arms = r.arms
  const ports = SURGERY.ports[ctx.layout]
  const u = seg.until > seg.since && Number.isFinite(seg.since) && Number.isFinite(seg.until) ? clamp01((ctx.t - seg.since) / (seg.until - seg.since)) : 0
  r.motionSeed = ctx.motionSeed
  switch (seg.kind) {
    case 'stowed':
      cartPose(0, r.cart)
      stowBoom(r)
      stowArms(arms, 0)
      for (const a of arms) a.instrument = ''
      break
    case 'draping': {
      cartPose(0, r.cart)
      stowBoom(r)
      stowArms(arms, 0)
      for (let i = 0; i < 4; i++) {
        arms[i].drape = clamp01((u - i * 0.2) / 0.4)
        arms[i].instrument = ''
      }
      break
    }
    case 'draped':
      cartPose(0, r.cart)
      stowBoom(r)
      stowArms(arms, 1)
      for (const a of arms) a.instrument = ''
      break
    case 'deploying': {
      cartPose(0, r.cart)
      stowArms(arms, 1)
      r.boomYaw = 0
      r.boomHeight = lerp(H_STOW, H_UP, ease(u))
      r.boomExtend = lerp(0, 0.35, ease(u))
      r.laser = false
      break
    }
    case 'driving': {
      cartPose(u, r.cart)
      stowArms(arms, 1)
      r.boomYaw = 0
      r.boomHeight = lerp(H_UP, H_TOP, ease(u))
      r.boomExtend = 0.35
      r.laser = true
      break
    }
    case 'docking': {
      cartPose(1, r.cart)
      stowArms(arms, 1)
      // the endoscope arm (index 1) docks first, onto its port
      const e = ease(u)
      arms[1].port = ports[1]
      arms[1].engage = e
      arms[1].instrument = ctx.instruments[1] ?? ''
      r.boomYaw = 0
      r.boomHeight = lerp(H_TOP, H_DOCK, e)
      r.boomExtend = lerp(0.35, 0.8, e)
      r.laser = u < 0.7
      break
    }
    case 'targeting': {
      cartPose(1, r.cart)
      r.laser = false
      r.boomYaw = ctx.boomYaw * ease(u / 0.7)
      r.boomHeight = lerp(H_DOCK, H_TARGET, ease(u))
      r.boomExtend = lerp(0.8, 1, ease(u))
      // the other three arms swing onto their ports one after the other
      let j = 0
      for (let i = 0; i < 4; i++) {
        const a = arms[i]
        a.drape = 1
        a.force = 0
        if (i === 1) {
          a.engage = 1
          a.port = ports[1]
          a.instrument = ctx.instruments[1] ?? ''
          continue
        }
        const k = ease((u - j * 0.18) / 0.45)
        j++
        a.engage = k
        a.port = k > 0 ? ports[i] : null
        a.instrument = ctx.instruments[i] ?? ''
      }
      break
    }
    case 'docked': {
      cartPose(1, r.cart)
      r.laser = false
      r.boomYaw = ctx.boomYaw
      r.boomHeight = H_TARGET
      r.boomExtend = 1
      for (let i = 0; i < 4; i++) {
        const a = arms[i]
        a.drape = 1
        a.port = ports[i]
        a.engage = 1
        a.force = forceAt(ctx.motionSeed, ctx.t, i)
        if (a.instrument === '') a.instrument = ctx.instruments[i] ?? ''
      }
      // an arm withdraws for a few seconds while the bedside assistant changes its instrument
      if (ctx.consoleStart !== null) {
        const since = ctx.t - ctx.consoleStart
        for (const ex of ctx.exchanges) {
          const k = (since - ex.at) / EXCHANGE_SECONDS
          if (k > 0 && k < 1) {
            const a = arms[ex.arm]
            a.engage = 1 - 0.45 * Math.sin(Math.PI * k)
            a.force *= 0.3
          }
        }
      }
      break
    }
    case 'undocking': {
      cartPose(1, r.cart)
      r.laser = false
      r.boomYaw = ctx.boomYaw * (1 - ease((u - 0.4) / 0.6))
      r.boomHeight = lerp(H_TARGET, H_TOP, ease(u))
      r.boomExtend = lerp(1, 0.6, ease(u))
      const starts = [0.3, 0.5, 0.15, 0]
      for (let i = 0; i < 4; i++) {
        const a = arms[i]
        a.drape = 1
        a.force = 0
        a.engage = 1 - ease((u - starts[i]) / 0.35)
        a.port = a.engage > 0 ? ports[i] : null
        if (a.instrument === '') a.instrument = ctx.instruments[i] ?? ''
      }
      break
    }
    case 'returning': {
      cartPose(1 - u, r.cart)
      stowArms(arms, 1)
      r.boomYaw = 0
      r.boomHeight = lerp(H_TOP, H_STOW, ease(u))
      r.boomExtend = lerp(0.6, 0, ease(u))
      r.laser = false
      break
    }
    case 'cleaning': {
      cartPose(0, r.cart)
      stowBoom(r)
      stowArms(arms, 1)
      const since = ctx.t - seg.since
      for (let i = 0; i < 4; i++) {
        arms[i].drape = 1 - clamp01((since / DRAPE_OFF_SECONDS - i * 0.2) / 0.4)
        arms[i].instrument = ''
      }
      break
    }
  }
}
