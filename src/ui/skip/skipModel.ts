/**
 * S1 Smart skip, the targets as data (pure: no sim singleton, no React). `skipTargets(view, ctx)` says which skip buttons exist right now:
 *
 *   always         +15 min and +1 h (CONFIG.skip.steps), each clamped to the end of the day and left out once the day is over
 *   operating room the next milestone of the da Vinci day, landing a lead before it: docking, console, undocking, wheels-out, PACU
 *                  discharge, the next patient's wheels-in. "In the OR" is: you stand on Level 2, the overview shows Level 2, or the
 *                  room panel is on a Level 2 room
 *   scanner room   "skip to scan end", only when the scan is short enough to run live (a longer one would rebuild the hospital and lose
 *                  the picture you are watching)
 *
 * `requestFor` turns a target into the flow's SkipRequest (live up to CONFIG.skip.liveMaxSeconds, a rebuild beyond). The HUD builds the
 * `SkipView` snapshot from the sim and the UI stores (SkipControl.tsx); everything here is tested in node.
 */
import { CONFIG } from '@/sim/config'
import { clockText } from '@/sim/events'
import { hourAt } from '@/sim/population/schedule'
import { fillSkip, MILESTONE_KINDS, SKIP, type MilestoneKind } from '@/content/skip'
import type { SkipRequest, SkipTarget } from './types'

export { MILESTONE_KINDS, type MilestoneKind }

/** The sim times (seconds since the start of the day) of one case's milestones. */
export type CaseTimes = Record<MilestoneKind, number>

/** What the skip model needs of the sim and the screen, as plain data. */
export interface SkipView {
  /** The clock now, and the latest time a skip may reach (the end of the day). */
  nowT: number
  limitT: number
  /** The area you stand in while walking (an AreaId), or null in the overview. */
  playerArea: string | null
  /** The level the overview shows, or null while walking. */
  overviewLevel: 1 | 2 | null
  /** The area the room panel is on, or null. */
  panelArea: string | null
  /** The cases of the robotic day (realised times where they are known). */
  cases: readonly CaseTimes[]
  /** The four scanners, by modality. */
  scanners: Partial<Record<'mri' | 'ct' | 'xray' | 'us', { phase: string; remaining: number }>>
}

export interface SkipCtx {
  steps: readonly number[]
  liveMaxSeconds: number
  leadSeconds: number
  clock(t: number): string
  hour(t: number): number
}

export const DEFAULT_SKIP_CTX: SkipCtx = {
  steps: CONFIG.skip.steps,
  liveMaxSeconds: CONFIG.skip.liveMaxSeconds,
  leadSeconds: CONFIG.skip.milestoneLeadSeconds,
  clock: clockText,
  hour: hourAt,
}

/** A skip shorter than this is not offered (the clock would barely move). */
export const MIN_SKIP_SECONDS = 5

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

const isL2 = (area: string | null): boolean => area !== null && area.startsWith('l2')

/** Are you in, or looking at, the operating theatre level? */
export function orContext(view: SkipView): boolean {
  return isL2(view.playerArea) || view.overviewLevel === 2 || isL2(view.panelArea)
}

const SCANNER_OF_AREA: Readonly<Record<string, 'mri' | 'ct' | 'xray' | 'us'>> = {
  mri: 'mri',
  mriControl: 'mri',
  ct: 'ct',
  ctControl: 'ct',
  xray: 'xray',
  ultrasound: 'us',
}

/** The scanner whose room (or control room) you stand in or have open, if any. The room panel wins over where you stand. */
export function scannerContext(view: SkipView): 'mri' | 'ct' | 'xray' | 'us' | null {
  for (const a of [view.panelArea, view.playerArea]) {
    if (a !== null && a in SCANNER_OF_AREA) return SCANNER_OF_AREA[a]
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Case times
// ---------------------------------------------------------------------------------------------

/** The slice of a plan timeline (plan.ts `Timeline`) the milestones come from. */
export interface TimelineSlice {
  phaseStart: { docking: number; console: number; undocking: number; in: number }
  outAt: number
  pacuIn: number
  pacuOut: number
}

/**
 * One case's milestone times. `startsIn` is the realised start of each room phase that has begun (SurgeryCase.starts) and `pacuInAt` the
 * realised PACU arrival: a case that has run a little late shifts everything after its last known point by that much, so the lead
 * lands in front of the event as it will really happen.
 */
export function caseTimes(
  tl: TimelineSlice,
  starts: Partial<Record<'in' | 'docking' | 'console' | 'undocking', number>>,
  pacuInAt: number | null,
  nowT: number,
): CaseTimes {
  // the drift of the latest realised point that is not in the future
  let drift = 0
  let at = -Infinity
  const points: [number, number | undefined][] = [
    [tl.phaseStart.in, starts.in],
    [tl.phaseStart.docking, starts.docking],
    [tl.phaseStart.console, starts.console],
    [tl.phaseStart.undocking, starts.undocking],
    [tl.pacuIn, pacuInAt ?? undefined],
  ]
  for (const [planned, real] of points) {
    if (real !== undefined && real <= nowT && real >= at) {
      at = real
      drift = real - planned
    }
  }
  return {
    docking: tl.phaseStart.docking + drift,
    console: tl.phaseStart.console + drift,
    undocking: tl.phaseStart.undocking + drift,
    wheelsOut: tl.outAt + drift,
    pacuDischarge: tl.pacuOut + drift,
    nextWheelsIn: tl.phaseStart.in + drift,
  }
}

/**
 * The next upcoming milestone over all cases: the one whose landing time (event minus the lead) is soonest and still ahead. A case's own
 * "next patient" time is its wheels-in; a case already in the room has that behind it, so it never shows twice.
 */
export function nextMilestone(view: SkipView, ctx: SkipCtx): { kind: MilestoneKind; eventT: number; toT: number } | null {
  let best: { kind: MilestoneKind; eventT: number; toT: number } | null = null
  for (const c of view.cases) {
    for (const kind of MILESTONE_KINDS) {
      const eventT = c[kind]
      const toT = eventT - ctx.leadSeconds
      if (toT < view.nowT + MIN_SKIP_SECONDS || toT > view.limitT) continue
      if (best === null || toT < best.toT) best = { kind, eventT, toT }
    }
  }
  return best
}

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

/** "+15 min", "+1 h": the label of a plain step. */
export function stepLabel(seconds: number): string {
  return seconds % 3600 === 0 ? fillSkip(SKIP.stepHours, { n: seconds / 3600 }) : fillSkip(SKIP.stepMinutes, { n: Math.round(seconds / 60) })
}

/** The skip buttons right now: the plain steps first, then the context target(s). */
export function skipTargets(view: SkipView, ctx: SkipCtx = DEFAULT_SKIP_CTX): SkipTarget[] {
  const out: SkipTarget[] = []
  let last = -Infinity
  for (const s of ctx.steps) {
    const toT = Math.min(view.nowT + s, view.limitT)
    // past the end of the day, or a second step that clamps to the same place as the one before it
    if (toT - view.nowT < MIN_SKIP_SECONDS || toT <= last) continue
    last = toT
    out.push({ kind: 'step', toT, label: stepLabel(s), caption: '' })
  }
  if (orContext(view)) {
    const m = nextMilestone(view, ctx)
    if (m) {
      const copy = SKIP.milestones[m.kind]
      out.push({
        kind: 'surgery',
        toT: m.toT,
        label: fillSkip(SKIP.milestoneLabel, { name: copy.name, time: ctx.clock(m.eventT) }),
        caption: copy.caption,
      })
    }
  }
  const modality = scannerContext(view)
  if (modality !== null) {
    const s = view.scanners[modality]
    if (s && s.phase !== 'idle' && s.remaining >= MIN_SKIP_SECONDS && s.remaining <= ctx.liveMaxSeconds) {
      const toT = Math.min(view.nowT + s.remaining, view.limitT)
      if (toT - view.nowT >= MIN_SKIP_SECONDS) out.push({ kind: 'scan', toT, label: SKIP.scan.label, caption: SKIP.scan.caption })
    }
  }
  return out
}

/** The context target (a milestone or a scan end), if there is one. */
export function contextTarget(targets: readonly SkipTarget[]): SkipTarget | null {
  return targets.find((t) => t.kind !== 'step') ?? null
}

/** What a press of `]` (plain) or Shift+`]` picks: the first step, or the context target, or else the longest step. */
export function keyTarget(targets: readonly SkipTarget[], shift: boolean): SkipTarget | null {
  if (!shift) return targets.find((t) => t.kind === 'step') ?? null
  const ctxT = contextTarget(targets)
  if (ctxT) return ctxT
  const steps = targets.filter((t) => t.kind === 'step')
  return steps.at(-1) ?? null
}

/** The flow's request for a target: live when it is close enough to run the same hospital forward, else a rebuild. */
export function requestFor(target: SkipTarget, nowT: number, ctx: SkipCtx = DEFAULT_SKIP_CTX): SkipRequest {
  return {
    fromT: nowT,
    toT: target.toT,
    fromHour: ctx.hour(nowT),
    toHour: ctx.hour(target.toT),
    caption: target.caption,
    mode: target.toT - nowT <= ctx.liveMaxSeconds ? 'live' : 'rebuild',
  }
}

/** What the row shows, without the times (so it only changes when a label does, and the poll costs no re-render). */
export interface SkipRowModel {
  steps: readonly { label: string }[]
  context: { label: string; kind: 'surgery' | 'scan' } | null
}

export function rowModel(targets: readonly SkipTarget[]): SkipRowModel {
  const c = contextTarget(targets)
  return {
    steps: targets.filter((t) => t.kind === 'step').map((t) => ({ label: t.label })),
    context: c && c.kind !== 'step' ? { label: c.label, kind: c.kind } : null,
  }
}
