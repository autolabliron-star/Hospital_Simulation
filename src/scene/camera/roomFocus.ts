/**
 * Entering and leaving a room: the one place that sets the focus store and flies the camera together, so the room
 * panel and the camera always agree. Click, the "Go to…" menu and Esc all go through here.
 */
import { useOverviewLevel } from '@/scene/levels/levelView'
import type { LevelId } from '@/sim/levels'
import type { AreaId } from '@/sim/places'
import { areaLevel, currentView, flyTo, isWalkMode, overview, presetFor, withPanelShift } from './cameraApi'
import { useFocus } from './focus.store'

/** Room panel width used before the stylesheet is read (matches `--rp-w` in roomPanel.css). */
export const PANEL_WIDTH_FALLBACK_PX = 392
/** Gap between the panel and the window edge, plus the breathing space between the panel and the shot. */
const PANEL_GAPS_PX = 16 + 12

/** The panel's share of the window width, for framing a shot beside it. */
export function panelFraction(viewportWidthPx: number, panelWidthPx: number): number {
  if (!(viewportWidthPx > 0)) return 0
  const px = Math.min(panelWidthPx, Math.max(0, viewportWidthPx - 32))
  return Math.max(0, Math.min(0.5, (px + PANEL_GAPS_PX) / viewportWidthPx))
}

/** The panel width from the stylesheet variable, so CSS stays the one place that sets it. */
function panelWidthPx(): number {
  if (typeof document === 'undefined') return PANEL_WIDTH_FALLBACK_PX
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--rp-w')
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : PANEL_WIDTH_FALLBACK_PX
}

/** Show `level` in the overview (a no-op when it is shown already). */
function showLevel(level: LevelId): void {
  const store = useOverviewLevel.getState()
  if (store.level !== level) store.set(level)
}

/**
 * Open the panel for `area` and fly the camera in beside it. Choosing the room you are in again re-frames it.
 * R2: the overview switches to the area's level first (level 2 for the surgery suite, level 1 for every ground-floor area, the ones under the
 * slab included), so the room is on screen when the camera gets there; a flight out of walk mode lands in the level that is set by then.
 */
export function focusRoom(area: AreaId): void {
  showLevel(areaLevel(area))
  useFocus.getState().setArea(area)
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth
  const view = currentView(panelFraction(width, panelWidthPx()))
  flyTo(withPanelShift(presetFor(area, view), view))
}

/**
 * The overview's Level switch (the HUD control, the L key). A room panel that is open on the other level goes with the room it showed: the
 * panel closes and the camera flies back to the overview, which is where the Level switch is.
 */
export function chooseLevel(level: LevelId): void {
  showLevel(level)
  const area = useFocus.getState().area
  if (area !== null && areaLevel(area) !== level) unfocus()
}

/** Close the panel and fly back to the overview. */
export function unfocus(): void {
  useFocus.getState().setArea(null)
  // walking (W1): closing a room panel opened with E leaves you where you are
  if (!isWalkMode()) overview()
}
