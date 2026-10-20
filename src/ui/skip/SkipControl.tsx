/**
 * S1 Smart skip, the HUD side: reading the sim into a SkipView (a few times a second, never per frame), running a skip through
 * `useJump.getState().skip` (the flow is jumpFlow.ts), and the skip row of the title card (+15 min, +1 h, and the context button).
 * The model is skipModel.ts (pure and tested); the walk-mode chip is SkipChip.tsx. The keys (`]`, Shift+`]`) are handled by the HUD's
 * hotkeys through `skipByKey`.
 */
import { SKIP, fillSkip } from '@/content/skip'
import { useFocus } from '@/scene/camera/focus.store'
import { useOverviewLevel } from '@/scene/levels/levelView'
import { useWalk } from '@/scene/player/state'
import { sim, skipLimit } from '@/sim'
import { areaAt } from '@/sim/places'
import { MODALITIES } from '@/sim/types'
import { usePoll } from '../usePoll'
import { useJump } from '../jump.store'
import { caseTimes, keyTarget, requestFor, rowModel, skipTargets, type SkipRowModel, type SkipView } from './skipModel'
import type { SkipTarget } from './types'
import './skip.css'

/** The snapshot of the sim and the screen the targets are built from. Allocates; call it from a poll or an event, never from a frame. */
export function readSkipView(): SkipView {
  const walking = useWalk.getState().mode === 'walk'
  const p = sim.player
  const nowT = sim.t
  const scanners: SkipView['scanners'] = {}
  for (const m of MODALITIES) {
    const s = sim.imaging.scanners[m]
    scanners[m] = { phase: s.phase, remaining: s.remaining }
  }
  return {
    nowT,
    limitT: skipLimit(),
    playerArea: walking && p ? (areaAt(p.x, p.z)?.id ?? null) : null,
    overviewLevel: walking ? null : useOverviewLevel.getState().level,
    panelArea: useFocus.getState().area,
    cases: sim.surgery.runs.map((c) => caseTimes(c.tl, c.starts, c.pacuInAt, nowT)),
    scanners,
  }
}

/** The skip buttons right now. */
export function currentTargets(): SkipTarget[] {
  return skipTargets(readSkipView())
}

/** Start a skip to `target` from the clock as it is now. False when the flow refuses (a jump or a lift ride is under way). */
function start(target: SkipTarget | null | undefined): boolean {
  if (!target) return false
  const { phase, skip } = useJump.getState()
  if (phase !== 'idle') return false
  return skip(requestFor(target, sim.t))
}

/** A press of `]` (plain: +15 min) or Shift+`]` (the context milestone, else +1 h). */
export function skipByKey(shift: boolean): boolean {
  return start(keyTarget(currentTargets(), shift))
}

/** A click on a button: the target is found again by its label, so it is the clock of now, not of the last poll. */
export function skipByLabel(label: string): boolean {
  return start(currentTargets().find((t) => t.label === label))
}

const readRow = (): SkipRowModel => rowModel(currentTargets())

/** The row's labels, refreshed at about 4 Hz (it re-renders only when a label changes). */
export function useSkipRow(): SkipRowModel {
  return usePoll(readRow)
}

/** True while a jump or skip is running: the buttons rest. */
export function useSkipBusy(): boolean {
  return useJump((s) => s.phase) !== 'idle'
}

/** The tooltip of a step button: its key when it has one (] for the first, Shift+] for the longest when no context button takes it). */
function stepTitle(label: string, key: string | null): string {
  return key ? fillSkip(SKIP.stepTitle, { label, key }) : fillSkip(SKIP.stepTitleNoKey, { label })
}

export interface SkipRowViewProps {
  model: SkipRowModel
  busy: boolean
  onSkip(label: string): void
}

/** The markup, with its state as props (so it renders in node). */
export function SkipRowView({ model, busy, onSkip }: SkipRowViewProps) {
  return (
    <div className="hud-skip" role="group" aria-label={SKIP.group}>
      <div className="hud-skip__row">
        <span className="hud-skip__tag">{SKIP.group}</span>
        {model.steps.map((s, i) => (
          <button
            key={s.label}
            type="button"
            className="hud-skip__btn"
            disabled={busy}
            title={busy ? SKIP.busyTitle : stepTitle(s.label, i === 0 ? SKIP.keys.step : i === model.steps.length - 1 && !model.context ? SKIP.keys.milestone : null)}
            onClick={(e) => {
              onSkip(s.label)
              e.currentTarget.blur()
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {model.context && (
        <button
          type="button"
          className="hud-skip__ctx"
          data-kind={model.context.kind}
          disabled={busy}
          title={busy ? SKIP.busyTitle : fillSkip(SKIP.chipTitle, { label: model.context.label, key: SKIP.keys.milestone })}
          onClick={(e) => {
            onSkip(model.context!.label)
            e.currentTarget.blur()
          }}
        >
          <span className="hud-skip__ctx-label">{model.context.label}</span>
          <kbd className="hud-kbd">{SKIP.keys.milestone}</kbd>
        </button>
      )}
    </div>
  )
}

/** The skip row of the title card. */
export function SkipRow() {
  const model = useSkipRow()
  const busy = useSkipBusy()
  return <SkipRowView model={model} busy={busy} onSkip={skipByLabel} />
}
