/**
 * The teaching-console card's HUD, as a pure view model: from `SurgeryState` and the sim clock to plain strings and numbers (JSON-serialisable, so `usePoll`
 * can diff it). The card (ConsoleCard.tsx) polls it at 4 Hz; the picture itself is the canvas's (consoleCard.canvas.ts) at 12 Hz. All the words are
 * src/content/surgeryUi.ts's and surgery.ts's. Everything shown is synthetic and display-only: the card reads, it never decides.
 */
import { SURGERY_COPY } from '@/content/surgery'
import { fillSurgery, SURGERY_UI } from '@/content/surgeryUi'
import { cameraLive } from '@/scene/surgery/liveEndoscope'
import { clockText, consoleSeconds, currentCase, nextCase, stopwatch } from '@/scene/surgery/tiles'
import { CONFIG } from '@/sim/config'
import type { SurgeryState } from '@/sim/types'

export interface ConsoleArmView {
  label: string
  /** The instrument fitted, or ''. */
  instrument: string
  /** The force-feedback reading, 0..100 (a bar). */
  force: number
  /** The arm is engaged on its port (so its force reading means something). */
  engaged: boolean
}

export interface ConsoleHud {
  /** "Teaching console · view only · Simulated". */
  title: string
  procedureLabel: string
  /** The procedure's name, or '' when no case is in the theatre. */
  procedure: string
  phaseLabel: string
  phase: string
  clockLabel: string
  /** `M:SS` since the console phase began, or '–'. */
  clock: string
  armsLabel: string
  forceLabel: string
  arms: ConsoleArmView[]
  /** The endoscope camera is live (docked): the view is the picture; otherwise the standby screen, with `standby` under it. */
  live: boolean
  /** The standby line ("The robot is not docked yet. Next: ..."), or null while live. */
  standby: string | null
  /** "Insufflation 12 mmHg" while live, else null. */
  insufflation: string | null
  leave: string
}

/** What the card shows of the theatre now. `now` is sim seconds. */
export function consoleHud(s: SurgeryState, now: number): ConsoleHud {
  const k = currentCase(s)
  const live = cameraLive(s.robot)
  const sec = consoleSeconds(s, now)
  const nxt = nextCase(s)
  const standby = live
    ? null
    : nxt
      ? fillSurgery(SURGERY_UI.console.standby, { procedure: SURGERY_COPY.procedures[nxt.procedure].short, time: clockText(nxt.plannedIn) })
      : SURGERY_UI.console.standbyNone
  return {
    title: `${SURGERY_UI.console.title} · ${SURGERY_UI.console.subtitle}`,
    procedureLabel: SURGERY_UI.console.procedure,
    procedure: k ? SURGERY_COPY.procedures[k.procedure].name : '',
    phaseLabel: SURGERY_UI.console.phase,
    phase: SURGERY_COPY.phases[s.theatre.phase],
    clockLabel: SURGERY_UI.console.clock,
    clock: sec === null ? '–' : stopwatch(sec),
    armsLabel: SURGERY_UI.console.arms,
    forceLabel: SURGERY_UI.console.force,
    arms: s.robot.arms.map((a) => ({
      label: fillSurgery(SURGERY_UI.console.arm, { arm: a.index + 1 }),
      instrument: a.instrument,
      force: Math.round(Math.max(0, Math.min(1, a.force)) * 100),
      engaged: a.engage >= 0.999,
    })),
    live,
    standby,
    insufflation: live ? `${SURGERY_UI.console.insufflation} ${CONFIG.surgery.insufflationMmHg} ${SURGERY_UI.console.mmHg}` : null,
    leave: SURGERY_UI.console.leave,
  }
}
