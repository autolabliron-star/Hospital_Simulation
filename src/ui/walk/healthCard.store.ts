/**
 * Your health card (walk mode, E at a health kiosk): which kiosk's session the card follows. The card fills in live while your session runs, then stays as
 * the printed report. Like the MedDrawer card it is not modal: it closes when you walk away, press E at the kiosk or Esc, or press its close button.
 */
import { create } from 'zustand'

export interface HealthCardState {
  open: boolean
  /** The kiosk (0, 1) whose session the card shows. */
  kiosk: number
  show(kiosk: number): void
  close(): void
}

export const useHealthCard = create<HealthCardState>((set) => ({
  open: false,
  kiosk: 0,
  show: (kiosk) => set({ open: true, kiosk }),
  close: () => set({ open: false }),
}))
