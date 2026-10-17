/**
 * The prescribing tablet (the PrescribePanel in src/ui/Hud.tsx): whether it is open, and which room it starts on. A store so the
 * P key, the Prescribe pill and the bedside E in walk mode all open the same panel. `request` counts openings, so the panel is
 * rebuilt (keyed on it) each time and starts on the room it was asked for.
 */
import { create } from 'zustand'
import { useHudPrefs } from './hudPrefs.store'
import { releasePointer } from './pointer'

export interface RxState {
  open: boolean
  /** The room the panel starts on, or null for the first room. */
  roomId: string | null
  request: number
  /** Open the tablet for a room (the bedside E). The clean screen (H) comes back: an invisible panel would hold your input. */
  openFor(roomId: string | null): void
  close(): void
  toggle(): void
}

export const useRx = create<RxState>((set, get) => ({
  open: false,
  roomId: null,
  request: 0,
  openFor: (roomId) => {
    useHudPrefs.getState().setHidden(false)
    releasePointer()
    set({ open: true, roomId, request: get().request + 1 })
  },
  close: () => set({ open: false }),
  toggle: () => (get().open ? get().close() : get().openFor(null)),
}))
