/**
 * R5: the step-by-step engine, part 2: which step is under the clock. PURE and allocation-free: nothing is stored between calls, so a warm
 * start, a Jump and a replay give the same step at the same time.
 *
 * A unit (a theatre phase, a CryoStep, an exam unit) has a time window [since, until) that the case's plan gives it. `stepAt` tiles that
 * window by step weight (`caseSteps`: real minutes in the living day, watch seconds in a watch case). A step that names a slot (da Vinci
 * docking and undocking) is laid inside the machine's own sub-window instead, which `SlotFn` gives, so the steps match the robot exactly;
 * the steps of one slot share its sub-window by weight. Past `until` the unit's last step stays, finished (progress 1); before `since`, the
 * first one, not begun (progress 0).
 */
import { DOCK_SPLIT, UNDOCK_SPLIT } from '../surgery/robot'
import type { CaseSteps, CompiledScript } from './script'

/** Where `stepAt` writes the step under the clock (reuse one). */
export interface StepCursor {
  /** The script step (index into `script.steps`) and the flat step (the script's steps with the repeat run played n times). */
  index: number
  flat: number
  /** The repeat being played, 1-based (1 for a step that does not repeat), and the unit's ordinal in `CompiledScript.units`. */
  k: number
  unit: number
  /** The step's window and how far through it the clock is, 0..1. */
  since: number
  until: number
  progress: number
}

export function newCursor(): StepCursor {
  return { index: -1, flat: -1, k: 1, unit: -1, since: 0, until: 0, progress: 0 }
}

/** A sub-window of a unit, written by a `SlotFn`. */
export interface SlotWindow {
  from: number
  to: number
}

/**
 * The window of a named slot inside a unit's window [since, until). Must write exactly `since` as the first slot's `from` and `until` as the
 * last slot's `to`, and each slot's `to` as the next one's `from`.
 */
export type SlotFn = (slot: string, since: number, until: number, out: SlotWindow) => void

/**
 * The da Vinci robot's slots (src/sim/surgery/robot.ts): the docking phase is deploying / driving / docking / targeting by DOCK_SPLIT, the
 * undocking phase undocking / returning by UNDOCK_SPLIT. The sums are made the way `segmentAt` makes them, so the boundaries are the same numbers.
 */
function davinciSlot(slot: string, since: number, until: number, out: SlotWindow): void {
  const d = until - since
  switch (slot) {
    case 'deploying':
      out.from = since
      out.to = since + d * DOCK_SPLIT[0]
      return
    case 'driving':
      out.from = since + d * DOCK_SPLIT[0]
      out.to = out.from + d * DOCK_SPLIT[1]
      return
    case 'docking':
      out.from = since + d * DOCK_SPLIT[0] + d * DOCK_SPLIT[1]
      out.to = out.from + d * DOCK_SPLIT[2]
      return
    case 'targeting':
      out.from = since + d * DOCK_SPLIT[0] + d * DOCK_SPLIT[1] + d * DOCK_SPLIT[2]
      out.to = until
      return
    case 'undocking':
      out.from = since
      out.to = since + d * UNDOCK_SPLIT[0]
      return
    case 'returning':
      out.from = since + d * UNDOCK_SPLIT[0]
      out.to = until
      return
    default:
      out.from = since
      out.to = until
  }
}

/** The da Vinci robot's slot function (see `davinciSlot`). */
export const davinciSlots: SlotFn = davinciSlot

/** `a + (b - a) * frac`, exactly `a` at 0 and exactly `b` at 1 (so neighbouring windows meet to the last bit). */
function lerpExact(a: number, b: number, frac: number): number {
  return frac <= 0 ? a : frac >= 1 ? b : a + (b - a) * frac
}

const SLOT: SlotWindow = { from: 0, to: 0 }

/**
 * The step under the clock in `unit`, whose window is [since, until), at time `t`: written into `out`. Returns false when the script has no
 * step in that unit (an optional unit), leaving `out` alone. `slots` lays the slotted steps of the unit into the machine's sub-windows
 * (`davinciSlots` for the robot); null tiles the whole unit by weight.
 */
export function stepAt(cs: CaseSteps, unit: string, since: number, until: number, t: number, slots: SlotFn | null, out: StepCursor): boolean {
  const u = cs.cs.unitIndex.get(unit)
  if (u === undefined) return false
  const first = cs.uFirst[u]
  const last = first + cs.uLen[u] - 1
  const script = cs.cs
  for (let f = first; f <= last; f++) {
    const slot = script.slotOf[cs.stepOf[f]]
    let from: number
    let to: number
    if (slot !== null && slots !== null) {
      slots(slot, since, until, SLOT)
      const total = cs.totalG[f]
      from = lerpExact(SLOT.from, SLOT.to, cs.cumG0[f] / total)
      to = lerpExact(SLOT.from, SLOT.to, cs.cumG1[f] / total)
    } else {
      const total = cs.totalU[u]
      from = lerpExact(since, until, cs.cumU0[f] / total)
      to = lerpExact(since, until, cs.cumU1[f] / total)
    }
    if (t < to || f === last) {
      out.index = cs.stepOf[f]
      out.flat = f
      out.k = cs.kOf[f]
      out.unit = u
      out.since = from
      out.until = to
      const span = to - from
      const p = span > 0 ? (t - from) / span : t >= to ? 1 : 0
      out.progress = p < 0 ? 0 : p > 1 ? 1 : p
      return true
    }
  }
  return false
}

/**
 * The seconds a watch case needs for `unit`: the sum of its steps' watch seconds (the repeat run counted `repeatN` times). The case sets the
 * unit's window to this, so the steps last exactly their watch seconds (a slotted unit's sub-windows are the machine's fixed fractions of it).
 */
export function watchUnitSeconds(cs: CompiledScript, unit: string, repeatN = 1): number {
  const u = cs.unitIndex.get(unit)
  if (u === undefined) return 0
  const reps = cs.repeatLen > 0 ? Math.max(1, Math.floor(repeatN)) : 1
  let total = 0
  for (let i = cs.unitFirst[u]; i < cs.unitFirst[u] + cs.unitLen[u]; i++) {
    const s = cs.script.steps[i]
    total += s.repeat === true ? s.watchSeconds * reps : s.watchSeconds
  }
  return total
}

/** The seconds a whole watch case takes in these units (every unit of the script), the repeat run counted `repeatN` times. */
export function watchTotalSeconds(cs: CompiledScript, repeatN = 1): number {
  let total = 0
  for (const unit of cs.units) total += watchUnitSeconds(cs, unit, repeatN)
  return total
}
