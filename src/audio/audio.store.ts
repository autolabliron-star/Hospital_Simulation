/**
 * Sound settings shared by the UI and the (later) scanner sounds.
 *
 * Pinned shape: `{ muted: boolean; unlocked: boolean; setMuted(b); unlock() }`.
 *   - `unlocked` turns true on the first pointer or key event anywhere on the page (the browser only lets audio start
 *     after a user gesture), so a sound engine can wait for it before creating or resuming its AudioContext.
 *   - `muted` is remembered between visits (best effort: storage can be unavailable).
 */
import { create } from 'zustand'

const STORAGE_KEY = 'ideal-hospital.muted'

function readMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeMuted(muted: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, muted ? '1' : '0')
  } catch {
    // storage is optional
  }
}

export interface AudioState {
  muted: boolean
  unlocked: boolean
  setMuted(b: boolean): void
  unlock(): void
}

export const useAudio = create<AudioState>((set) => ({
  muted: readMuted(),
  unlocked: false,
  setMuted: (muted) => {
    writeMuted(muted)
    set({ muted })
  },
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
