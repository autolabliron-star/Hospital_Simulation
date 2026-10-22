/**
 * The presenter's notice: one short sentence at the top of the screen ("Sound off. Press M to turn it on.") for a few seconds, drawn by
 * PresenterOverlay outside the hideable HUD, so it shows in the clean screen and in presentation mode too. Real-time seconds. A new notice
 * replaces the old one. (The walk toast, src/ui/walk/toast.store.ts, is a walk-mode piece of the HUD and hides with it.)
 */
import { create } from 'zustand'

export const NOTICE_MS = 3000

export interface NoticeState {
  /** Grows with every notice: the React key, so the same words shown twice restart the fade. */
  id: number
  text: string | null
  show(text: string, ms?: number): void
  clear(): void
}

let timer: ReturnType<typeof setTimeout> | undefined

export const useNotice = create<NoticeState>((set, get) => ({
  id: 0,
  text: null,
  show: (text, ms = NOTICE_MS) => {
    if (timer !== undefined) clearTimeout(timer)
    const id = get().id + 1
    set({ id, text })
    timer = setTimeout(() => {
      timer = undefined
      if (get().id === id) set({ text: null })
    }, ms)
  },
  clear: () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    set({ text: null })
  },
}))

/** Shorthand for `useNotice.getState().show(...)`. */
export function showNotice(text: string, ms?: number): void {
  useNotice.getState().show(text, ms)
}
