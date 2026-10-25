/**
 * What is on the glass, as one pure function (W1 walk-in). The overview keeps today's HUD; walk mode is quiet, like a game:
 *
 *   overview   the title card with the clock and speed, the KPI card, the Prescribe pill, the event line and the order rail
 *   walk       a small clock, the minimap, the interact prompt, the objective line, the key hint and the realism pill (both fade after a
 *              few seconds; the keys keep working), a toast, the drawer card (no KPI card, no order rail, no event line, no title card).
 *              Step 3: every piece stays, smaller and more see-through, so the picture dominates (walk.css)
 *   H          hides everything, in both modes
 *
 * The flights between the two (`toWalk`, `toOverview`) show the HUD of where you are going, so nothing flashes at the hand-over.
 * The prescribing tablet itself is not in this list: it is open or closed by the Prescribe pill, P or the bedside, and H hides it too.
 */
import type { PlayerMode } from '@/sim/types'

export type HudKind = 'walk' | 'overview'

export function hudKind(mode: PlayerMode): HudKind {
  return mode === 'walk' || mode === 'toWalk' ? 'walk' : 'overview'
}

export interface HudParts {
  titleCard: boolean
  walkClock: boolean
  kpiCard: boolean
  rxPill: boolean
  eventLine: boolean
  orderRail: boolean
  minimap: boolean
  prompt: boolean
  objective: boolean
  hint: boolean
  toast: boolean
  drawerCard: boolean
}

const NONE: HudParts = {
  titleCard: false,
  walkClock: false,
  kpiCard: false,
  rxPill: false,
  eventLine: false,
  orderRail: false,
  minimap: false,
  prompt: false,
  objective: false,
  hint: false,
  toast: false,
  drawerCard: false,
}

const OVERVIEW: HudParts = { ...NONE, titleCard: true, kpiCard: true, rxPill: true, eventLine: true, orderRail: true }
const WALK: HudParts = { ...NONE, walkClock: true, minimap: true, prompt: true, objective: true, hint: true, toast: true, drawerCard: true }

export function hudVisibility(mode: PlayerMode, hidden: boolean): HudParts {
  if (hidden) return NONE
  return hudKind(mode) === 'walk' ? WALK : OVERVIEW
}
