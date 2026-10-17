/**
 * Your order as the HUD reads it (the minimap's pod marker, the drawer card): the interaction system publishes the tracker's view
 * here at 4 Hz, only when it changed. The objective line itself goes through `useWalk.objective`.
 */
import { create } from 'zustand'
import type { YourOrderView } from './yourOrder'

export interface YourOrderState {
  view: YourOrderView | null
  set(view: YourOrderView | null): void
}

export const useYourOrder = create<YourOrderState>((set) => ({
  view: null,
  set: (view) => set({ view }),
}))
