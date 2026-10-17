/**
 * Which room the presenter is "inside". `null` is the overview. The room panel, the scan viewer and (later) the
 * machines and the sounds read it; only the room-focus helpers in `roomFocus.ts` write it, together with the camera flight.
 *
 * Pinned shape (other agents read it): `{ area: AreaId | null; setArea(a: AreaId | null): void }` and `modalityOfArea`.
 */
import { create } from 'zustand'
import type { AreaId } from '@/sim/places'
import type { ImagingModality } from '@/sim/types'

/** The scanner a scan room or its control room belongs to; `null` for every other area. */
export function modalityOfArea(area: AreaId | null | undefined): ImagingModality | null {
  switch (area) {
    case 'mri':
    case 'mriControl':
      return 'mri'
    case 'ct':
    case 'ctControl':
      return 'ct'
    case 'xray':
      return 'xray'
    case 'ultrasound':
      return 'us'
    default:
      return null
  }
}

export interface FocusState {
  area: AreaId | null
  setArea(a: AreaId | null): void
}

export const useFocus = create<FocusState>((set) => ({
  area: null,
  setArea: (area) => set({ area }),
}))
