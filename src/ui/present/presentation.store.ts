/**
 * Presentation mode: the architectural-walkthrough way of viewing the world. First person at eye level, slow and smooth, no HUD, no avatar,
 * no game UI, a photographic look. The camera, the body, the glide between shots and the look all read ONE flag from here.
 *
 *   `?view=present`   starts with the mode on (once in walk mode: the app starts walking), cut to the first shot
 *   C                 toggles it (the key is handled in ./PresentationControls.tsx)
 *   N                 glides to the next shot (./shots.ts), looping
 *
 * (`?present=1`, src/app/power.ts, is something else: 60 fps on battery and no pause on blur. Presentation mode turns that on while it is active.)
 *
 * Slow state, set by a key press, read with `presentActive()` inside frame callbacks (no allocation, no subscription).
 */
import { create } from 'zustand'

/** The presenter's keys. Neither is in the sim's KeyMap (C and N were free). */
export const PRESENT_KEY = 'KeyC'
export const PRESENT_NEXT_KEY = 'KeyN'

/** `?view=present`. Pure, so node can test it (the pattern of `parseBuildingFlag`). Anything else is off. */
export function presentViewFromSearch(search: string): boolean {
  try {
    return new URLSearchParams(search).get('view') === 'present'
  } catch {
    return false
  }
}

/** This page's URL choice, read once (off in node). */
export const PRESENT_VIEW_URL: boolean = presentViewFromSearch(typeof window === 'undefined' ? '' : window.location.search)

export interface PresentationState {
  on: boolean
  setOn(on: boolean): void
  toggle(): void
}

export const usePresentation = create<PresentationState>((set) => ({
  on: PRESENT_VIEW_URL,
  setOn: (on) => set({ on }),
  toggle: () => set((s) => ({ on: !s.on })),
}))

/** Is presentation mode in effect right now? Pure read of the store, safe inside `useFrame`. */
export function presentActive(): boolean {
  return usePresentation.getState().on
}
