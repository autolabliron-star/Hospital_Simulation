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
 *   lung         R5 wave 3: the short first freeze and its thaw (anchorFreeze, anchorThaw) come first: a small ice ball (CONFIG.cryoSuite.anchorIce) that
 *                shrinks a little (anchorThawKeep); the first freeze then grows from what is left
 *   needlesOut   one needle after the other comes out (inserted 1..0)
 *
 * `tablePos > 0` only in a scan step, and the robot is 'stowed' then: it never aims or holds aligned with the table in.
 */
import { CONFIG } from '../config'
import type { CaseSteps, CompiledScript } from '../procedure'
import type { CryoNeedleState, CryoStep, CryoSuiteState } from '../types'
import { aimOffset, SCAN_STEPS, secondsOf, targetOf, type PlannedCryoCase, type RoomStep } from './plan'
import { targetSettings, type StepKey } from './targets'

/** The ice lost in the active thaw (a share of full size). */
export const ACTIVE_THAW_LOSS = 0.06
/** The ice ball's short axis against its long one. */
export const ICE_SHORT = 0.8
/** The aiming part of a needle's window (s; the scene's arm travels 12 s and settles 6 s), at most 60 % of a (demo) window. */
export const AIM_SECONDS = 18
/** The robot's retract after the needle is in (s; the scene's retract), at most 35 % of what is left of the window. */
export const RETRACT_SECONDS = 6

/**
 * A script's needle push: the needle is moving from 5 % to 80 % of the push step (`needleClockInto`), and in by 80 %. That is the kidney's clock, and a
 * watch case's; a lung or liver needle in the living day is advanced only inside the held breath (`needleClockInto`: the window `pushHoldInto` gives).
 */
export const PUSH_IN0 = 0.05
export const PUSH_IN1 = 0.8
/** The share of the push step the ventilator stays paused after the needle is in (the held breath ends a little after it). */
const PUSH_HOLD_AFTER = 0.04
/**
 * A lung or liver needle in the living day is advanced inside the held breath, with this long (s) of the breath held before it starts and after it is in
 * (at most a tenth of the window each, so a short window keeps its margins): the ventilator is paused before the needle moves and breathing resumes after.
 */
export const NEEDLE_HOLD_MARGIN = 2

/** Where a CT scan's table moves in and out: the edge of the scan step (s), at most 20 % of it (`applyRoom`'s table travel). */
export const SCAN_EDGE_SECONDS = 15
export function scanEdge(d: number): number {
  return Math.min(SCAN_EDGE_SECONDS, 0.2 * d)
}

/** A held breath's window: [from, to) seconds from the start of the step (or scan unit) it lies in. Written in place (one scratch object, reused). */
export interface HoldWindow {
  from: number
  to: number
}

export function newHoldWindow(): HoldWindow {
  return { from: 0, to: 0 }
}

/** The anaesthetist's place in a script's `roleAt` (the order of `CRYO_ROLES`: ir, ctRadiographer, sedation, cryoAnaes). */
const ANAES_ROLE = 3

/** Does the anaesthetist's line at script step `step` ask for the held breath (`holdBreath`: each scan and each needle push of the lung and the liver)? */
export function holdsBreathAt(cs: CompiledScript, step: number): boolean {
  const line = cs.roleAt[step][ANAES_ROLE]
  return line !== null && !line.held && line.action === 'holdBreath'
}

/** The longest the breath is held (s): `CONFIG.cryoSuite.apnoeaSeconds` in the living day; null for a watch case (its compressed steps are held whole). */
export function apnoeaCap(plan: PlannedCryoCase): number | null {
  return plan.demo ? null : CONFIG.cryoSuite.apnoeaSeconds
}

/** The held breath of the push whose clock `needleClockInto` is making (one scratch object, reused). */
const NEEDLE_HOLD: HoldWindow = newHoldWindow()

/**
 * The held breath (apnoea) of a needle push of the lung's and the liver's cases: the anaesthetist pauses the ventilator on the radiologist's call as the
 * push begins and breathing resumes once the needle is in, so it covers the push step (`len` seconds) up to just after the needle is in. In the living day
 * the push step lasts about 80 s, the needle going in over most of it: the held breath is then at most `cap` seconds (CONFIG.cryoSuite.apnoeaSeconds),
 * centred on the needle's travel. `cap` null (a watch case's compressed step): the whole push part. Allocation-free.
 */
export function pushHoldInto(len: number, cap: number | null, out: HoldWindow): HoldWindow {
  const to = Math.min(len, (PUSH_IN1 + PUSH_HOLD_AFTER) * len)
  out.from = 0
  out.to = to
  if (cap !== null && to > cap) {
    const mid = 0.5 * (PUSH_IN0 + PUSH_IN1) * len
    out.from = Math.max(0, Math.min(to - cap, mid - 0.5 * cap))
    out.to = out.from + cap
  }
  return out
}

/**
 * The held breath of a CT scan (the unit's window of `d` seconds): only while the table is in and the sweep runs (the scene's `scan` between 0 and 1),
 * at most `cap` seconds of it, centred on the sweep (the scan sweeps for most of a live scan's minutes: the ventilator is paused for a few seconds of
 * it). `cap` null (a watch case): the whole sweep. Breathing goes on while the table moves in and out. Allocation-free.
 */
export function scanHoldInto(d: number, cap: number | null, out: HoldWindow): HoldWindow {
  const edge = scanEdge(d)
  out.from = edge
  out.to = d - edge
  if (cap !== null && out.to - out.from > cap) {
    out.from = 0.5 * d - 0.5 * cap
    out.to = out.from + cap
  }
  return out
}

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

/** One needle's window in the aim step (seconds into the step): where it starts, how long it is, and the robot's and the needle's moments inside it. */
export interface NeedleClock extends AimSplit {
  /** The window's start (seconds into the aim step) and its length. */
  a: number
  w: number
}

export function newNeedleClock(): NeedleClock {
  return { a: 0, w: 0, aim: 0, in0: 0, in1: 0, alignedEnd: 0 }
}

/**
 * Needle `i`'s window in the aim step [since, until). With a script (R5: a scripted case's `CaseSteps`) it is the script's own run for that needle:
 * the robot aims during the run's first step, holds aligned through the next ones, the needle is pushed in during the run's last step and the robot
 * steps back at its end, so the caption, the people's poses and the machine agree to the second (live and watch). Without one (R4's unscripted case, the
 * scene's fixtures) it is the plan's own `aimSeconds` split by `aimSplit`. Written into `out`: allocation-free.
 */
export function needleClockInto(plan: PlannedCryoCase, steps: CaseSteps | null, i: number, since: number, until: number, out: NeedleClock): NeedleClock {
  if (steps !== null && steps.cs.repeatLen >= 2 && i < steps.repeatN) {
    const cs = steps.cs
    const u = cs.unitIndex.get('aim')
    if (u !== undefined && steps.totalU[u] > 0) {
      const span = (until - since) / steps.totalU[u]
      const f0 = steps.flatOfStep[cs.repeatFrom] + i * cs.repeatLen
      const last = f0 + cs.repeatLen - 1
      const t0 = since + steps.cumU0[f0] * span
      const tAim = since + steps.cumU0[f0 + 1] * span
      const tPush = since + steps.cumU0[last] * span
      const t1 = since + steps.cumU1[last] * span
      const push = t1 - tPush
      out.a = t0 - since
      out.w = t1 - t0
      out.aim = tAim - t0
      out.in0 = tPush - t0 + PUSH_IN0 * push
      out.in1 = tPush - t0 + PUSH_IN1 * push
      out.alignedEnd = out.w - Math.min(RETRACT_SECONDS, 0.3 * push)
      // the needle is advanced during the held breath, never while the patient breathes: a lung or liver push of the living day (whose breath is held
      // for a capped window of the step) moves its needle inside that window; a watch case's window is the whole push part (the clock above is in it),
      // and the kidney's push holds no breath
      const cap = apnoeaCap(plan)
      if (cap !== null && holdsBreathAt(cs, steps.stepOf[last])) {
        const w = pushHoldInto(push, cap, NEEDLE_HOLD)
        const m = Math.min(NEEDLE_HOLD_MARGIN, 0.1 * (w.to - w.from))
        out.in0 = tPush - t0 + w.from + m
        out.in1 = tPush - t0 + w.to - m
      }
      return out
    }
  }
  out.a = aimOffset(plan, i)
  out.w = plan.aimSeconds[i]
  aimSplit(out.w, out)
  return out
}

/** Seconds into the aim step when needle k is fully in (the script's clock when `steps` is given). */
export function needleInAt(plan: PlannedCryoCase, k: number, steps: CaseSteps | null = null, since = 0, until = 0): number {
  if (steps === null) return aimOffset(plan, k) + aimSplit(plan.aimSeconds[k], SPLIT).in1
  const c = needleClockInto(plan, steps, k, since, until, CLOCK)
  return c.a + c.in1
}

const CLOCK: NeedleClock = newNeedleClock()
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

/**
 * The ice (0..1) at the start of each step and while it runs (u: 0..1 through the step). `anchored`: the lung's triple freeze, whose short first
 * freeze and thaw leave a little ice for the first freeze to grow from.
 */
export function iceAt(step: CryoStep, u: number, anchored = false): number {
  const { firstFreezeSize: f1, thawKeep, anchorIce, anchorThawKeep } = CONFIG.cryoSuite
  switch (step) {
    case 'anchorFreeze':
      return anchorIce * grow(u)
    case 'anchorThaw':
      return anchorIce * (1 - (1 - anchorThawKeep) * smooth(u))
    case 'freeze1': {
      const a = anchored ? anchorIce * anchorThawKeep : 0
      return a + (f1 - a) * grow(u)
    }
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
    case 'anchorFreeze':
      return min + (BODY_C - min) * Math.exp(-s / FREEZE_TAU)
    case 'anchorThaw':
      return min + (PASSIVE_C - min) * (1 - Math.exp(-s / THAW_TAU))
    case 'freeze1': {
      // (the lung's first freeze begins from where the anchor thaw left the tips)
      const a = secondsOf(plan, 'anchorThaw')
      const from = a > 0 ? min + (PASSIVE_C - min) * (1 - Math.exp(-a / THAW_TAU)) : BODY_C
      return min + (from - min) * Math.exp(-s / FREEZE_TAU)
    }
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

const FREEZE_SET: ReadonlySet<string> = new Set(['anchorFreeze', 'anchorThaw', 'freeze1', 'thaw', 'freeze2', 'activeThaw'])
const AFTER_AIM: ReadonlySet<string> = new Set(['checkCt', 'anchorFreeze', 'anchorThaw', 'freeze1', 'thaw', 'freeze2', 'activeThaw'])
const AFTER_OUT: ReadonlySet<string> = new Set(['finalCt', 'dressing', 'out'])

/**
 * Write the room's look for `plan` in `step` (began `since`) at time t. `plan` null: an empty room (idle or turnover). Returns true when a
 * discrete thing changed (the step, the needle worked on, the robot's phase, the console's gas, a needle's active flag or its error shown):
 * the caller bumps `version` then. The continuous values (table, rotor, scan, ice, temperatures, timer) change without a bump.
 */
export function applyRoom(s: CryoSuiteState, plan: PlannedCryoCase | null, step: CryoStep, since: number, until: number | null, t: number, script: CaseSteps | null = null): boolean {
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
  const d = room !== null && plan !== null ? secondsOf(plan, room) : 1
  // --- the CT ---
  let tablePos = 0
  let rotor = 0
  let lasers = false
  let scan = 0
  if (room !== null && SCAN_STEPS.has(room)) {
    const edge = scanEdge(d)
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
      const { a, w, aim, in0, in1, alignedEnd } = needleClockInto(plan, script, i, since, until ?? since + d, CLOCK)
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
  const ice = plan === null ? 0 : iceAt(step, u, plan.target === 'lung')
  s.ice = ice
  const full = plan?.iceMm ?? 0
  s.iceMm.long = Math.round(ice * full * 10) / 10
  s.iceMm.short = Math.round(ice * full * ICE_SHORT * 10) / 10
  const { marginMinC } = CONFIG.cryoSuite
  s.marginC = room !== null && FREEZE_SET.has(room) ? Math.round((BODY_C + (marginMinC - BODY_C) * ice) * 10) / 10 : BODY_C
  const argon = room === 'anchorFreeze' || room === 'freeze1' || room === 'freeze2'
  const heater = room === 'activeThaw'
  if (s.argon !== argon || s.heater !== heater) {
    s.argon = argon
    s.heater = heater
    changed = true
  }
  // (a watch case's console runs the clinical programme's clock: the freeze's own minutes spread over the seconds it takes on screen)
  const clinical = plan !== null && plan.demo && room !== null && FREEZE_SET.has(room) && d > 0 ? targetSettings(targetOf(plan)).minutes(room as StepKey) : null
  const timerScale = clinical !== null ? ((clinical[0] + clinical[1]) * 30) / d : 1
  s.timer = room !== null && FREEZE_SET.has(room) ? Math.max(0, el) * timerScale : 0
  s.tumourMm = plan?.tumourMm ?? 0
  s.imageSeed = plan?.imageSeed ?? 0
  return changed
}
