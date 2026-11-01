/**
 * R5 "Watch step by step": the overlay's view model (pure: no sim singleton, no React). From the room's procedure view and the watch's slow state to
 * the plain strings the caption bar and the step list show: "Step 7 of 32: Clips placed on duct and artery", the step's one-line "why", every step
 * with done / current / upcoming, and the wait before a booked case ("The operation starts in 4:12"). The overlay polls it at 4 Hz.
 *
 * The step index in the view is FLAT (a repeated run of steps, one per cryo needle, is laid out once per repeat): the script step it plays comes from
 * the procedure engine's own layout (`caseSteps(...).stepOf`), so the captions stay right when the cryo scripts arrive. The da Vinci scripts have no
 * repeats (flat = script).
 */
import { scriptFor } from '@/content/procedures'
import { fillWatch, WATCH } from '@/content/watch'
import { caseSteps, compiledFor, type CaseSteps } from '@/sim/procedure'
import type { ProcedureId, ProcedureView } from '@/sim/types'
import type { WatchMode, WatchStatus } from '@/scene/watch/watch.store'

export type StepState = 'done' | 'current' | 'upcoming'

export interface StepRow {
  /** Stable key: the flat index. */
  key: number
  label: string
  state: StepState
}

export interface CaptionModel {
  status: WatchStatus
  /** "Step-by-step case" or "Live case". */
  badge: string
  /** The caption line. */
  title: string
  /** The why line ('' when there is none). */
  why: string
  /** "4:12" before a booked case; null otherwise. */
  startsIn: string | null
  /** The case is far enough off for a skip to be worth offering. */
  canSkip: boolean
  steps: StepRow[]
}

/** A wait shorter than this is not worth a skip (the skip's own lead is 20 s). */
export const MIN_SKIP_WAIT = 45

/** "m:ss" for a number of seconds (never negative). */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r < 10 ? '0' : ''}${r}`
}

const layouts = new Map<string, CaseSteps>()

/** A case's flat steps (watch timing; only the layout is used), cached per procedure and repeat count. */
function layoutOf(id: ProcedureId, repeatN: number): CaseSteps | null {
  const key = `${id}:${repeatN}`
  let l = layouts.get(key)
  if (l === undefined) {
    const cs = compiledFor(id)
    if (cs === undefined) return null
    l = caseSteps(cs, 'watch', null, repeatN)
    layouts.set(key, l)
  }
  return l
}

/** The script step a flat step plays (null when out of range or the procedure has no script). */
export function scriptStepOf(id: ProcedureId, flat: number, repeatN = 1): number | null {
  const l = layoutOf(id, repeatN)
  if (l === null || flat < 0 || flat >= l.flatCount) return null
  return l.stepOf[flat]
}

/** Every step of a case as a list row (the repeats numbered), with `current` (flat; -1: none yet, Infinity: all done) marked. */
export function stepRows(id: ProcedureId, current: number, repeatN = 1): StepRow[] {
  const script = scriptFor(id)
  const l = layoutOf(id, repeatN)
  if (script === undefined || l === null) return []
  const rows: StepRow[] = []
  for (let f = 0; f < l.flatCount; f++) {
    const step = script.steps[l.stepOf[f]]
    const k = l.kOf[f]
    const label = step.repeat === true && l.repeatN > 1 ? fillWatch(WATCH.overlay.stepRow, { caption: step.caption, k, n: l.repeatN }) : step.caption
    rows.push({ key: f, label, state: f < current ? 'done' : f === current ? 'current' : 'upcoming' })
  }
  return rows
}

/** What the caption needs of the procedure view. */
export type CaptionView = Pick<ProcedureView, 'procedureId' | 'stepIndex' | 'stepCount' | 'stepId' | 'repeat'>

export interface CaptionInput {
  status: WatchStatus
  mode: WatchMode | null
  /** The procedure asked for (watch mode), shown in the step list before the case starts. */
  procedureId: ProcedureId | null
  /** The room's view (its case may not be ours while we wait). */
  view: CaptionView | null
  /** When the booked case is wheeled in (sim seconds), or null; and the clock. */
  startsAt: number | null
  now: number
}

export function captionModel(i: CaptionInput): CaptionModel {
  const o = WATCH.overlay
  const badge = i.mode === 'follow' ? o.live : o.watchCase
  const v = i.view
  if (i.status === 'case' && v !== null && v.procedureId !== null) {
    const id = v.procedureId
    const repeatN = v.repeat?.n ?? 1
    const s = scriptStepOf(id, v.stepIndex, repeatN)
    const step = s === null ? undefined : scriptFor(id)?.steps[s]
    const caption = step?.caption ?? v.stepId
    const title =
      v.repeat !== null
        ? fillWatch(o.stepRepeat, { k: v.stepIndex + 1, n: v.stepCount, caption, r: v.repeat.k, m: v.repeat.n })
        : fillWatch(o.step, { k: v.stepIndex + 1, n: v.stepCount, caption })
    return { status: 'case', badge, title, why: step?.why ?? '', startsIn: null, canSkip: false, steps: stepRows(id, v.stepIndex, repeatN) }
  }
  const id = i.procedureId ?? v?.procedureId ?? null
  if (i.status === 'ended') {
    return { status: 'ended', badge, title: o.ended, why: o.endedWhy, startsIn: null, canSkip: false, steps: id === null ? [] : stepRows(id, Number.POSITIVE_INFINITY) }
  }
  const wait = i.startsAt === null ? null : i.startsAt - i.now
  const startsIn = wait === null ? null : mmss(wait)
  const title = wait === null ? o.waiting : wait > 0.5 ? fillWatch(o.startsIn, { time: startsIn! }) : o.startingNow
  return { status: 'waiting', badge, title, why: '', startsIn, canSkip: wait !== null && wait > MIN_SKIP_WAIT, steps: id === null ? [] : stepRows(id, -1) }
}
