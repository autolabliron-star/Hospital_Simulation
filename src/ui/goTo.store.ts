/** Whether the "Go to…" menu is open. A store so the HUD button, the G key and the menu itself agree. */
import { create } from 'zustand'

export interface GoToState {
  open: boolean
  setOpen(open: boolean): void
  toggle(): void
}

export const useGoTo = create<GoToState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
