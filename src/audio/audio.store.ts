/**
 * Sound settings shared by the UI and the (later) scanner sounds.
 *
 * Pinned shape: `{ muted: boolean; unlocked: boolean; setMuted(b); unlock() }`.
 *   - `unlocked` turns true on the first pointer or key event anywhere on the page (the browser only lets audio start
 *     after a user gesture), so a sound engine can wait for it before creating or resuming its AudioContext.
 *   - `muted` is NOT remembered between visits: a fresh page load always starts with sound on, so a muted test session cannot silently mute the
 *     demo (F-03). `?mute=1` starts muted on purpose. The M key toggles it (Hud.tsx, `toggleMute`) and shows the state in a notice.
 */
import { create } from 'zustand'

/** Start muted only when the URL says so (`?mute=1`). Pure, so node can test it. */
export function mutedFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get('mute') === '1'
  } catch {
    return false
  }
}

export interface AudioState {
  muted: boolean
  unlocked: boolean
  setMuted(b: boolean): void
  unlock(): void
}

export const useAudio = create<AudioState>((set) => ({
  muted: mutedFromSearch(typeof window === 'undefined' ? '' : window.location.search),
  unlocked: false,
  setMuted: (muted) => set({ muted }),
  unlock: () => set((s) => (s.unlocked ? s : { unlocked: true })),
}))

/** The first pointer or key event unlocks audio. Idempotent; runs once when this module loads in a browser. */
let installed = false
export function installAudioUnlock(target: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined = typeof window === 'undefined' ? undefined : window): void {
  if (installed || !target) return
  installed = true
  const events = ['pointerdown', 'pointerup', 'keydown'] as const
  const unlock = () => {
    useAudio.getState().unlock()
    for (const e of events) target.removeEventListener(e, unlock, true)
  }
  for (const e of events) target.addEventListener(e, unlock, true)
}

installAudioUnlock()

/** Flip the mute state and return the new one (true: now muted). */
export function toggleMute(): boolean {
  const muted = !useAudio.getState().muted
  useAudio.getState().setMuted(muted)
  return muted
}
