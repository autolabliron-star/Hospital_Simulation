/**
 * R5: the ultrasound room's screen as the watch overlay's picture-in-picture (src/ui/watch/Inset.tsx), and the rate it repaints at while somebody watches it.
 * Plain functions, no React, so the rules are tested in node; `<ImagingMachines />` (index.tsx) calls them.
 *
 * The live canvas of the ultrasound modality (`live.ts`) is the very picture the ProSense case's cart screen shows in 3D. While the overlay shows it
 * (`insetWanted.us`) or the watch camera is on the ultrasound room (the cart's screen is in the 3D picture), it repaints at the focused rate (4 Hz, CLAUDE.md's
 * rule for the focused imaging screen) instead of the background's 1 Hz; the screen's own quantisation keeps a scripted picture to 4 frames a REAL second.
 */
import type { ImagingModality } from '@/sim/types'
import { insetWanted, registerInsetSource } from '@/scene/registries/insetSources'
import type { WatchRoomId } from '@/scene/watch/rooms'
import { SCREEN_SIZE } from './images/screen'

/** Redraw periods in milliseconds: the focused screen's (4 Hz) and the others' (1 Hz). */
export const FOCUSED_INTERVAL_MS = 250
export const BACKGROUND_INTERVAL_MS = 1000

/** The part of a live screen the inset needs: its canvas and the count of its redraws. */
export interface InsetScreen {
  readonly canvas: unknown
  readonly paints: number
}

/** Register the ultrasound screen as the 'us' inset source (at mount); returns the function that removes it (at unmount). */
export function registerUsInset(screen: InsetScreen): () => void {
  return registerInsetSource({ id: 'us', canvas: screen.canvas, width: SCREEN_SIZE, height: SCREEN_SIZE, paints: () => screen.paints })
}

/**
 * How often modality `m`'s screen may redraw (ms): the focused rate for the room the panel is on, and for the ultrasound screen while its picture-in-picture
 * is on screen or the watch camera is on its room; the background rate otherwise. Reads two plain fields: allocation-free.
 */
export function screenInterval(m: ImagingModality, focused: ImagingModality | null, watchRoom: WatchRoomId | null): number {
  if (m === focused) return FOCUSED_INTERVAL_MS
  if (m === 'us' && (insetWanted.us || watchRoom === 'us')) return FOCUSED_INTERVAL_MS
  return BACKGROUND_INTERVAL_MS
}
