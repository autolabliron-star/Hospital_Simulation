/**
 * The teaching-console card (R2): the stylised endoscope view and the console's HUD. Where it comes from decides who opens and closes the teaching flag
 * (`sim.surgery.setTeaching`): `seat` is YOU sitting at the teaching console (the session in src/scene/interact/surgery/teaching.ts opens it, sets the flag
 * and closes it again when you stand up), `panel` is the OR panel's "Watch the endoscope view" (the card itself sets the flag while it is open, and the
 * card is drawn inside the panel, no seat needed).
 */
import { create } from 'zustand'

export type ConsoleSource = 'seat' | 'panel'

export interface ConsoleCardState {
  open: boolean
  source: ConsoleSource
  show(source: ConsoleSource): void
  /** Open it from `source`, or close it when it is already open from there. */
  toggle(source: ConsoleSource): void
  close(): void
}

export const useConsoleCard = create<ConsoleCardState>((set, get) => ({
  open: false,
  source: 'seat',
  show: (source) => set({ open: true, source }),
  toggle: (source) => {
    const s = get()
    if (s.open && s.source === source) set({ open: false })
    else set({ open: true, source })
  },
  close: () => set({ open: false }),
}))
