/**
 * R4: the CT cryoablation suite panel's view model (src/ui/CryoSuiteBody.tsx), pure: from the suite's state (and the last answer of the "Start a
 * cryoablation now" button) to plain strings and numbers, so `usePoll` can compare it and the render test can feed it hand-made state. All the words
 * come from src/content/cryoSuite.ts; "Simulated" is the tag.
 */
import { CRYO_SUITE_COPY, fillCryo } from '@/content/cryoSuite'
import { clockText } from '@/sim/events'
import type { CryoDemoResult } from '@/sim/cryoSuite/ports'
import { CRYO_STEPS, type CryoCaseView, type CryoStep, type CryoSuiteState } from '@/sim/types'

/** The steps of a case, in order, for the stepper (not the room's `idle`). */
export const STEPPER_STEPS: readonly CryoStep[] = CRYO_STEPS.filter((s) => s !== 'idle')

export type StepState = 'done' | 'current' | 'todo'

export interface StepRow {
  step: CryoStep
  label: string
  state: StepState
}

export type NeedleRowState = 'planned' | 'aiming' | 'aligned' | 'in' | 'out'

export interface NeedleRow {
  n: number
  label: string
  state: NeedleRowState
  /** "Aligned 1.2 mm" once aligned; null before. */
  aligned: string | null
  /** The tip temperature ("-138 °C"). */
  temp: string
  active: boolean
  /** 0..100: how far in. */
  insertedPct: number
}

export interface ListRow {
  id: string
  time: string
  patient: string
  step: string
  current: boolean
  demo: boolean
}

export interface StartButton {
  label: string
  disabled: boolean
  /** A line under the button (booked next, the team's hours), or null. */
  note: string | null
}

export interface CryoSuiteView {
  tag: string
  title: string
  /** The room's step now, as words. */
  step: string
  stepKey: CryoStep
  patient: string | null
  steps: StepRow[]
  needles: NeedleRow[]
  /** "Needle 2 of 4" while one is being worked on, else null. */
  needleNow: string | null
  console: { argon: boolean; heater: boolean; timer: string; margin: string; ice: string | null; coldest: string | null }
  labels: { tip: string; margin: string; ice: string; timer: string; list: string; planning: string; live: string; argon: string; heater: string }
  list: ListRow[]
  empty: string | null
  start: StartButton
  card: { title: string; robot: string; console: string; honesty: string }
}

const FREEZE_OR_THAW: ReadonlySet<CryoStep> = new Set<CryoStep>(['freeze1', 'thaw', 'freeze2', 'activeThaw'])

export function tempText(c: number): string {
  return `${Math.round(c)} °C`
}

function timerText(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function stepLabel(step: CryoCaseView['step']): string {
  if (step === 'scheduled') return CRYO_SUITE_COPY.listStates.booked
  if (step === 'pacu') return CRYO_SUITE_COPY.listStates.pacu
  if (step === 'done') return CRYO_SUITE_COPY.listStates.done
  return CRYO_SUITE_COPY.steps[step]
}

/** The stepper: the steps before the room's step are done, its step current, the rest to come (all to come while the room is idle). */
export function stepRows(step: CryoStep): StepRow[] {
  const at = STEPPER_STEPS.indexOf(step)
  return STEPPER_STEPS.map((s, i) => ({ step: s, label: CRYO_SUITE_COPY.steps[s], state: at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo' }))
}

function needleRows(s: CryoSuiteState): NeedleRow[] {
  const p = CRYO_SUITE_COPY.panel
  const working = s.robot.needle
  return s.needles.map((n): NeedleRow => {
    const isCur = n.index === working && s.robot.phase !== 'stowed'
    const pastAim = STEPPER_STEPS.indexOf(s.step) > STEPPER_STEPS.indexOf('aim')
    const out = s.step === 'needlesOut' || STEPPER_STEPS.indexOf(s.step) > STEPPER_STEPS.indexOf('needlesOut')
    const state: NeedleRowState =
      n.inserted > 0.999 && !out ? 'in' : out && n.inserted < 0.001 ? 'out' : isCur && s.robot.phase === 'aligned' ? 'aligned' : isCur && s.robot.phase === 'aiming' ? 'aiming' : n.inserted > 0.001 ? 'in' : 'planned'
    const aligned = state === 'planned' || state === 'aiming' ? (pastAim && n.errorMm > 0 ? fillCryo(p.aligned, { err: n.errorMm.toFixed(1) }) : null) : fillCryo(p.aligned, { err: n.errorMm.toFixed(1) })
    return {
      n: n.index + 1,
      label: fillCryo(p.needle, { k: n.index + 1, n: s.needles.length }),
      state,
      aligned,
      temp: tempText(n.tempC),
      active: n.active,
      insertedPct: Math.round(Math.max(0, Math.min(1, n.inserted)) * 100),
    }
  })
}

/** The button: start now when the room is free, book next while a case is in, nothing while a demo is already booked or running; the last answer's note. */
export function startButton(s: CryoSuiteState, last: CryoDemoResult | null): StartButton {
  const p = CRYO_SUITE_COPY.panel
  const roomBusy = s.caseId !== null && s.step !== 'idle'
  const label = roomBusy ? p.startNext : p.start
  const disabled = s.demoQueued || (s.demo && roomBusy)
  const note = s.demoQueued || last === 'queued' ? p.queued : last === 'noTeam' ? p.noTeam : null
  return { label, disabled, note }
}

export function cryoSuiteView(s: CryoSuiteState, last: CryoDemoResult | null = null): CryoSuiteView {
  const p = CRYO_SUITE_COPY.panel
  const current = s.caseId === null ? null : (s.cases.find((c) => c.id === s.caseId) ?? null)
  const timed = FREEZE_OR_THAW.has(s.step)
  let coldest: number | null = null
  for (const n of s.needles) if (n.active && (coldest === null || n.tempC < coldest)) coldest = n.tempC
  const working = s.needle >= 0 ? s.needle : s.robot.phase !== 'stowed' ? s.robot.needle : -1
  return {
    tag: p.tag,
    title: p.title,
    step: CRYO_SUITE_COPY.steps[s.step],
    stepKey: s.step,
    patient: current ? current.name : null,
    steps: stepRows(s.step),
    needles: needleRows(s),
    needleNow: working >= 0 && s.needles.length > 0 ? fillCryo(p.needle, { k: working + 1, n: s.needles.length }) : null,
    console: {
      argon: s.argon,
      heater: s.heater,
      timer: timed ? timerText(s.timer) : '--:--',
      margin: tempText(s.marginC),
      ice: s.ice > 0.005 && s.iceMm.long > 0 ? `${s.iceMm.long} × ${s.iceMm.short} mm` : null,
      coldest: coldest === null ? null : tempText(coldest),
    },
    labels: { tip: p.tip, margin: p.margin, ice: p.ice, timer: p.timer, list: p.list, planning: p.planning, live: p.live, argon: p.argon, heater: p.heater },
    list: s.cases.map((c) => ({ id: c.id, time: clockText(c.wheelsIn ?? c.plannedIn), patient: c.name, step: stepLabel(c.step), current: c.id === s.caseId, demo: c.demo })),
    empty: s.cases.length === 0 ? p.empty : null,
    start: startButton(s, last),
    card: { ...CRYO_SUITE_COPY.card },
  }
}
