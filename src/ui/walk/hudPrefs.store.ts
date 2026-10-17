/** H: the clean screen. Hides the whole HUD, in the overview and in walk mode (see visibility.ts). */
import { create } from 'zustand'

export interface HudPrefsState {
  hidden: boolean
  setHidden(hidden: boolean): void
  toggle(): void
}

export const useHudPrefs = create<HudPrefsState>((set) => ({
  hidden: false,
  setHidden: (hidden) => set({ hidden }),
  toggle: () => set((s) => ({ hidden: !s.hidden })),
}))
