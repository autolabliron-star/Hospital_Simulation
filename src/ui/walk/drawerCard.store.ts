/**
 * The MedDrawer card (walk mode, E at a drawer): which room's drawer is open. The card reads the drawer live, so you can stand
 * there and watch a pod load it. It is not modal: it closes when you walk away, press E or Esc, or press its close button.
 */
import { create } from 'zustand'

export interface DrawerCardState {
  roomId: string | null
  show(roomId: string): void
  close(): void
}

export const useDrawerCard = create<DrawerCardState>((set) => ({
  roomId: null,
  show: (roomId) => set({ roomId }),
  close: () => set({ roomId: null }),
}))
