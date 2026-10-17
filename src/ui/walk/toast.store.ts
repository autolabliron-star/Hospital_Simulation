/**
 * The walk-mode toast: one short sentence ("The wards upstairs aren't open in this demo.") that shows for a few seconds and
 * fades. Real-time seconds, not sim time. A new toast replaces the old one. The words come from src/content/walk.json.
 */
import { create } from 'zustand'

export const TOAST_MS = 3200

export interface ToastState {
  /** Grows with every toast: the React key, so the same words shown twice restart the fade. */
  id: number
  text: string | null
  show(text: string, ms?: number): void
  clear(): void
}

let timer: ReturnType<typeof setTimeout> | undefined

export const useToast = create<ToastState>((set, get) => ({
  id: 0,
  text: null,
  show: (text, ms = TOAST_MS) => {
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

/** Shorthand for `useToast.getState().show(...)`. */
export function showToast(text: string, ms?: number): void {
  useToast.getState().show(text, ms)
}
