/**
 * The bedside tablet (the PrescribePanel in src/ui/rx): whether it is open, which room it starts on and which tab it shows. A store so the
 * P key, the Prescribe pill and the bedside E in walk mode all open the same panel. `request` counts openings, so the panel is
 * rebuilt (keyed on it) each time and starts on the room it was asked for.
 *
 * The tablet has two tabs: Prescribe (the order) and Record (the patient record, src/ui/rx/record). The bedside E (a room) always opens on Record
 * first (the doctor reads before prescribing); the P key and the Prescribe pill (no room) open on Prescribe. The tab picked in the tablet is kept
 * only until it is closed: every opening starts on its own default again.
 */
import { create } from 'zustand'
import { useHudPrefs } from './hudPrefs.store'
import { releasePointer } from './pointer'

export type RxTab = 'prescribe' | 'record'

export interface RxState {
  open: boolean
  /** The room the panel starts on, or null for the first room. */
  roomId: string | null
  request: number
  /** The tab shown (within one opening only: every opening resets it). */
  tab: RxTab
  /** Open the tablet for a room (the bedside E). It starts on `tab`, by default Record for a room and Prescribe for none. The clean screen (H) comes back: an invisible panel would hold your input. */
  openFor(roomId: string | null, tab?: RxTab): void
  close(): void
  toggle(): void
  setTab(tab: RxTab): void
}

/** The tab an opening starts on: Record at a bedside (read first), Prescribe when opened without a room (P, the pill). */
export const defaultTab = (roomId: string | null): RxTab => (roomId === null ? 'prescribe' : 'record')

export const useRx = create<RxState>((set, get) => ({
  open: false,
  roomId: null,
  request: 0,
  tab: 'prescribe',
  openFor: (roomId, tab) => {
    useHudPrefs.getState().setHidden(false)
    releasePointer()
    set({ open: true, roomId, request: get().request + 1, tab: tab ?? defaultTab(roomId) })
  },
  close: () => set({ open: false }),
  toggle: () => (get().open ? get().close() : get().openFor(null)),
  setTab: (tab) => set({ tab }),
}))
