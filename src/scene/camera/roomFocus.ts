/**
 * Entering and leaving a room: the one place that sets the focus store and flies the camera together, so the room
 * panel and the camera always agree. Click, the "Go to…" menu and Esc all go through here.
 */
import type { AreaId } from '@/sim/places'
import { currentView, flyTo, isWalkMode, overview, presetFor, withPanelShift } from './cameraApi'
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

/** Open the panel for `area` and fly the camera in beside it. Choosing the room you are in again re-frames it. */
export function focusRoom(area: AreaId): void {
  useFocus.getState().setArea(area)
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth
  const view = currentView(panelFraction(width, panelWidthPx()))
  flyTo(withPanelShift(presetFor(area, view), view))
}

/** Close the panel and fly back to the overview. */
export function unfocus(): void {
  useFocus.getState().setArea(null)
  // walking (W1): closing a room panel opened with E leaves you where you are
  if (!isWalkMode()) overview()
}
