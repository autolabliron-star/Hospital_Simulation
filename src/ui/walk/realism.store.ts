/**
 * R: realism mode (Wave 2). Walk mode shows a hospital, not a game: no emote icons, no speech bubbles, the teal glow panels toned
 * down and the ceiling sensor disc a plain white one. The floor wayfinding lines stay.
 *
 * One preference per view: ON in walk mode by default, OFF in the overview (which keeps today's look). The key (R) flips the
 * preference of the view you are in. "Walking" is the same test the rest of the scene uses: any mode but the overview.
 * Slow state, read with getState() in frame callbacks (no allocation), never written per frame.
 */
import { create } from 'zustand'
import type { PlayerMode } from '@/sim/types'
import { presentActive } from '../present/presentation.store'

export interface RealismState {
  /** Realism mode in walk mode (default on). */
  walk: boolean
  /** Realism mode in the overview (default off: today's look). */
  overview: boolean
  /** Flip the preference of the view `mode` belongs to. */
  toggle(mode: PlayerMode | undefined): void
}

export const isWalking = (mode: PlayerMode | undefined): boolean => mode !== undefined && mode !== 'overview'

export const useRealism = create<RealismState>((set) => ({
  walk: true,
  overview: false,
  toggle: (mode) => set((s) => (isWalking(mode) ? { walk: !s.walk } : { overview: !s.overview })),
}))

/** Is realism mode in effect for this player mode? Pure read of the store, safe inside `useFrame`. */
export function realismActive(mode: PlayerMode | undefined): boolean {
  const s = useRealism.getState()
  // presentation mode (C) is always realistic: no emote icons, no speech bubbles, the toned glow, whatever R chose
  return isWalking(mode) ? s.walk || presentActive() : s.overview
}

/** Teal glow panels at this fraction of their usual emissive intensity while realism is on. */
export const REALISM_GLOW = 0.4

/** The presenter's key (KeyMap in the sim contract is not touched: R was free). */
export const REALISM_KEY = 'KeyR'
