/**
 * R5: the step-by-step engine, part 4: the instrument on each robot arm. The script's console steps change an arm's instrument when the step
 * begins (`arms`), which replaces the day plan's random exchanges at runtime (the plan keeps drawing them: its hash must not move).
 *
 * An exchange is the robot's own 12-second withdrawal (`EXCHANGE_SECONDS`, robot.ts): the arm backs out, the bedside assistant changes the
 * tool, and the new one is in at the middle of the withdrawal. The script's change lands at the step's start, so the withdrawal begins half an
 * exchange earlier (never before the console starts: a change on the very first step lands half an exchange in). Both `armsAt` (what is on
 * the arms at a time) and `scriptedExchanges` (the list the robot context and the event feed use) come from the same times.
 */
import { EXCHANGE_SECONDS } from '../surgery/robot'
import type { CaseSteps } from './script'

/** The same shape as the day plan's `PlannedExchange` (src/sim/surgery/plan.ts): seconds into the console phase, the arm, the new instrument. */
export interface ScriptedExchange {
  at: number
  arm: 0 | 2 | 3
  instrument: string
}

/** When (seconds into the console phase) the withdrawal for a change that lands `startOffset` seconds in begins. */
function withdrawAt(startOffset: number): number {
  const at = startOffset - EXCHANGE_SECONDS / 2
  return at < 0 ? 0 : at
}

/** Seconds from the start of a unit's window (`span` long) to where flat step `f` of unit `u` begins. */
function startOffset(cs: CaseSteps, f: number, u: number, span: number): number {
  const frac = cs.cumU0[f] / cs.totalU[u]
  return frac <= 0 ? 0 : span * frac
}

/**
 * The instrument on each arm at time `t`, given the console window [since, until): written into `out` (length 4, by arm index; index 1 is the
 * endoscope). Before the console starts, and for a script without a robot, the arms hold the script's `robotArms`.
 */
export function armsAt(cs: CaseSteps, since: number, until: number, t: number, out: string[]): void {
  const base = cs.cs.baseArms
  for (let i = 0; i < 4; i++) out[i] = base[i] ?? ''
  const u = cs.cs.unitIndex.get('console')
  if (u === undefined) return
  const span = until - since
  const changes = cs.cs.armChanges
  for (let c = 0; c < changes.length; c++) {
    const ch = changes[c]
    const f = cs.flatOfStep[ch.step]
    const swap = since + withdrawAt(startOffset(cs, f, u, span)) + EXCHANGE_SECONDS / 2
    if (t >= swap) out[ch.arm] = ch.instrument
  }
}

/**
 * The scripted exchanges of a console phase `consoleSeconds` long, in time order: `at` is seconds into the console phase, where the robot's
 * withdrawal begins (the new tool is in `EXCHANGE_SECONDS / 2` later). Allocates the list: call it once per case.
 */
export function scriptedExchanges(cs: CaseSteps, consoleSeconds: number): ScriptedExchange[] {
  const out: ScriptedExchange[] = []
  const u = cs.cs.unitIndex.get('console')
  if (u === undefined) return out
  for (const ch of cs.cs.armChanges) {
    const f = cs.flatOfStep[ch.step]
    out.push({ at: withdrawAt(startOffset(cs, f, u, consoleSeconds)), arm: ch.arm, instrument: ch.instrument })
  }
  return out
}
