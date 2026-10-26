/**
 * R4: what the suite looks like at time t, as a PURE function of the case's plan and the step it is in (when that step began and ends). The
 * live run and a warm start both call it, so a Jump shows exactly what a run to that time shows. Written into the state in place
 * (allocation-free): the CT table, rotor, lasers and scan; the robot; every needle; the ice; the temperatures; the console's flags and timer.
 *
 *   scans        planningCt, checkCt, finalCt: the table slides in (lasers on), the rotor scans (scan 0..1), the table slides out
 *   planning     the robot deploys its arm
 *   aim          per needle: the robot aims (18 s), holds aligned while the needle is pushed through the guide (inserted 0..1), retracts
 *   freezes      argon on: the tips fall toward tipMinC, the ice grows (never shrinking within a freeze) to firstFreezeSize, then to 1
 *   thaw         passive: the tips warm a little, the ice shrinks to x thawKeep; activeThaw: the heater, the ice a little smaller again
 *   needlesOut   one needle after the other comes out (inserted 1..0)
 *
 * `tablePos > 0` only in a scan step, and the robot is 'stowed' then: it never aims or holds aligned with the table in.
 */
import { CONFIG } from '../config'
import type { CryoNeedleState, CryoStep, CryoSuiteState } from '../types'
import { aimOffset, SCAN_STEPS, type PlannedCryoCase, type RoomStep } from './plan'

/** The ice lost in the active thaw (a share of full size). */
export const ACTIVE_THAW_LOSS = 0.06
/** The ice ball's short axis against its long one. */
export const ICE_SHORT = 0.8
/** The aiming part of a needle's window (s; the scene's arm travels 12 s and settles 6 s), at most 60 % of a (demo) window. */
export const AIM_SECONDS = 18
/** The robot's retract after the needle is in (s; the scene's retract), at most 35 % of what is left of the window. */
export const RETRACT_SECONDS = 6

/** A needle's aim window of `w` seconds: aiming [0, aim), aligned [aim, alignedEnd), retracting [alignedEnd, w); pushed in from in0 to in1. */
export interface AimSplit {
  aim: number
  in0: number
  in1: number
  alignedEnd: number
}

/** Split a needle's window (written into `out`: allocation-free). */
export function aimSplit(w: number, out: AimSplit): AimSplit {
  const aim = Math.min(AIM_SECONDS, 0.6 * w)
  const alignedEnd = w - Math.min(RETRACT_SECONDS, 0.35 * (w - aim))
  out.aim = aim
  out.alignedEnd = alignedEnd
  out.in0 = aim + 0.1 * (alignedEnd - aim)
  out.in1 = aim + 0.85 * (alignedEnd - aim)
  return out
}

/** Seconds into the aim step when needle k is fully in. */
export function needleInAt(plan: PlannedCryoCase, k: number): number {
  return aimOffset(plan, k) + aimSplit(plan.aimSeconds[k], SPLIT).in1
}

const SPLIT: AimSplit = { aim: 0, in0: 0, in1: 0, alignedEnd: 0 }
/** Body and room temperature (deg C), the passive-thaw plateau and the active-thaw target of the tips. */
export const BODY_C = 37
export const ROOM_C = 22
export const PASSIVE_C = -20
export const ACTIVE_C = 30
/** Time constants of the tips (s): falling in a freeze, rising in the passive thaw. */
export const FREEZE_TAU = 35
export const THAW_TAU = 120

function clamp01(k: number): number {
  return k < 0 ? 0 : k > 1 ? 1 : k
}

function smooth(k: number): number {
  const c = clamp01(k)
  return c * c * (3 - 2 * c)
}

/** A saturating 0..1 curve (fast at first): the ice's growth in a freeze. */
function grow(u: number): number {
  const c = clamp01(u)
  return (1 - Math.exp(-3 * c)) / (1 - Math.exp(-3))
}

/** The ice (0..1) at the start of each step and while it runs (u: 0..1 through the step). */
export function iceAt(step: CryoStep, u: number): number {
  const { firstFreezeSize: f1, thawKeep } = CONFIG.cryoSuite
  switch (step) {
    case 'freeze1':
      return f1 * grow(u)
    case 'thaw':
      return f1 * (1 - (1 - thawKeep) * smooth(u))
    case 'freeze2': {
      const a = f1 * thawKeep
      return a + (1 - a) * grow(u)
    }
    case 'activeThaw':
      return 1 - ACTIVE_THAW_LOSS * smooth(u)
    case 'needlesOut':
    case 'finalCt':
    case 'dressing':
    case 'out':
      return 1 - ACTIVE_THAW_LOSS
    default:
      return 0
  }
}

/** The tip temperature of a needle that is in, `s` seconds into `step` (lasting `d`), before its own offset. */
function tipAt(step: RoomStep, s: number, plan: PlannedCryoCase): number {
  const min = CONFIG.cryoSuite.tipMinC
  const thawEnd = min + (PASSIVE_C - min) * (1 - Math.exp(-plan.steps.thaw / THAW_TAU))
  switch (step) {
    case 'freeze1':
      return min + (BODY_C - min) * Math.exp(-s / FREEZE_TAU)
    case 'thaw':
      return min + (PASSIVE_C - min) * (1 - Math.exp(-s / THAW_TAU))
    case 'freeze2':
      return min + (thawEnd - min) * Math.exp(-s / FREEZE_TAU)
    case 'activeThaw':
      return min + (ACTIVE_C - min) * smooth(s / Math.max(1, plan.steps.activeThaw))
    case 'needlesOut':
    case 'finalCt':
    case 'dressing':
    case 'out':
      return ACTIVE_C
    default:
      return BODY_C
  }
}

/** Make `s.needles` hold one entry per planned needle (only when the case changes: allocation-free otherwise). */
export function ensureNeedles(s: CryoSuiteState, plan: PlannedCryoCase | null): void {
  const want = plan === null ? 0 : plan.needles.length
  if (s.needles.length === want && (plan === null || s.needles.every((n, i) => n.entry === plan.needles[i].entry))) return
  s.needles.length = 0
  if (plan === null) return
  plan.needles.forEach((p, i) => {
    const n: CryoNeedleState = { index: i, entry: p.entry, tip: p.tip, dz: p.dz, inserted: 0, errorMm: 0, active: false, tempC: ROOM_C }
    s.needles.push(n)
  })
}

const FREEZE_SET: ReadonlySet<string> = new Set(['freeze1', 'thaw', 'freeze2', 'activeThaw'])
const AFTER_AIM: ReadonlySet<string> = new Set(['checkCt', 'freeze1', 'thaw', 'freeze2', 'activeThaw'])
const AFTER_OUT: ReadonlySet<string> = new Set(['finalCt', 'dressing', 'out'])

/**
 * Write the room's look for `plan` in `step` (began `since`) at time t. `plan` null: an empty room (idle or turnover). Returns true when a
 * discrete thing changed (the step, the needle worked on, the robot's phase, the console's gas, a needle's active flag or its error shown):
 * the caller bumps `version` then. The continuous values (table, rotor, scan, ice, temperatures, timer) change without a bump.
 */
export function applyRoom(s: CryoSuiteState, plan: PlannedCryoCase | null, step: CryoStep, since: number, until: number | null, t: number): boolean {
  let changed = false
  if (s.step !== step || s.stepSince !== since || s.stepEnds !== until) {
    s.step = step
    s.stepSince = since
    s.stepEnds = until
    changed = true
  }
  ensureNeedles(s, plan)
  const el = t - since
  const room = plan !== null ? (step as RoomStep) : null
  const d = room !== null && plan !== null ? plan.steps[room] : 1
  // --- the CT ---
  let tablePos = 0
  let rotor = 0
  let lasers = false
  let scan = 0
  if (room !== null && SCAN_STEPS.has(room)) {
    const edge = Math.min(15, 0.2 * d)
    if (el < edge) {
      tablePos = smooth(el / edge)
      rotor = clamp01(el / edge)
      lasers = true
    } else if (el < d - edge) {
      tablePos = 1
      rotor = 1
      scan = clamp01((el - edge) / Math.max(1e-6, d - 2 * edge))
    } else {
      tablePos = 1 - smooth((el - (d - edge)) / edge)
      rotor = clamp01((d - el) / edge)
      scan = 1
    }
  }
  s.tablePos = tablePos
  s.rotor = rotor
  if (s.lasers !== lasers) s.lasers = lasers
  s.scan = scan
  // --- the robot and the needles ---
  let phase: CryoSuiteState['robot']['phase'] = 'stowed'
  let robotNeedle = -1
  let robotSince = since
  let needle = -1
  const n = s.needles.length
  if (plan !== null && room === 'planning') phase = 'deploying'
  for (let i = 0; i < n; i++) {
    const nd = s.needles[i]
    let inserted = 0
    let aligned = false
    if (plan !== null && room === 'aim') {
      const a = aimOffset(plan, i)
      const w = plan.aimSeconds[i]
      const { aim, in0, in1, alignedEnd } = aimSplit(w, SPLIT)
      const k = el - a
      if (k >= w) {
        inserted = 1
        aligned = true
      } else if (k >= 0) {
        needle = i
        robotNeedle = i
        aligned = k >= aim
        if (k < aim) {
          phase = 'aiming'
          robotSince = since + a
        } else if (k < alignedEnd) {
          phase = 'aligned'
          robotSince = since + a + aim
        } else {
          phase = 'retracting'
          robotSince = since + a + alignedEnd
        }
        inserted = k <= in0 ? 0 : k >= in1 ? 1 : smooth((k - in0) / (in1 - in0))
      }
    } else if (plan !== null && room !== null && AFTER_AIM.has(room)) {
      inserted = 1
      aligned = true
    } else if (plan !== null && room === 'needlesOut') {
      const slice = d / Math.max(1, n)
      const k = el - i * slice
      aligned = true
      if (k < 0) inserted = 1
      else if (k < slice) {
        needle = i
        inserted = 1 - smooth(k / slice)
      }
    } else if (plan !== null && room !== null && AFTER_OUT.has(room)) aligned = true
    nd.inserted = inserted
    const err = aligned && plan !== null ? plan.needles[i].errorMm : 0
    if (nd.errorMm !== err) {
      nd.errorMm = err
      changed = true
    }
    const active = inserted > 0 && room !== null && FREEZE_SET.has(room)
    if (nd.active !== active) {
      nd.active = active
      changed = true
    }
    nd.tempC = plan === null ? ROOM_C : inserted > 0 && room !== null ? Math.round((tipAt(room, el, plan) + (active ? plan.needles[i].tipOffsetC : 0)) * 10) / 10 : ROOM_C
  }
  const r = s.robot
  if (r.phase !== phase || r.needle !== robotNeedle) {
    r.phase = phase
    r.needle = robotNeedle
    r.since = robotSince
    changed = true
  }
  r.motionSeed = plan?.motionSeed ?? 0
  if (s.needle !== needle) {
    s.needle = needle
    changed = true
  }
  // --- the ice and the console ---
  const u = d > 0 ? clamp01(el / d) : 1
  const ice = plan === null ? 0 : iceAt(step, u)
  s.ice = ice
  const full = plan?.iceMm ?? 0
  s.iceMm.long = Math.round(ice * full * 10) / 10
  s.iceMm.short = Math.round(ice * full * ICE_SHORT * 10) / 10
  const { marginMinC } = CONFIG.cryoSuite
  s.marginC = room !== null && FREEZE_SET.has(room) ? Math.round((BODY_C + (marginMinC - BODY_C) * ice) * 10) / 10 : BODY_C
  const argon = room === 'freeze1' || room === 'freeze2'
  const heater = room === 'activeThaw'
  if (s.argon !== argon || s.heater !== heater) {
    s.argon = argon
    s.heater = heater
    changed = true
  }
  s.timer = room !== null && FREEZE_SET.has(room) ? Math.max(0, el) : 0
  s.tumourMm = plan?.tumourMm ?? 0
  s.imageSeed = plan?.imageSeed ?? 0
  return changed
}
