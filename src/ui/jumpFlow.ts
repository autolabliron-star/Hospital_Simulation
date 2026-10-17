/**
 * The Jump flow as a small state machine (zustand state creator, no React, no sim import): menu open or closed, and the four
 * phases of a jump:
 *
 *   idle -> fadingOut   the screen fades to the cover (FADE_OUT_MS)
 *        -> swapping    the cover is opaque and has been painted: rebuild the hospital (it pre-rolls about 60 sim s,
 *                       synchronously), then the keyed layers remount on the new `generation`
 *        -> fadingIn    after SETTLE_MS (people fade in over 0.35 s, so nobody is half drawn) and a few frames
 *        -> idle        FADE_IN_MS later
 *
 * Nothing of the old or the half-built hospital can be seen: the rebuild only starts after the cover has had two painted
 * frames, and the cover only lifts after the new layers have drawn. `deps` makes the sequence testable with fake timers.
 */
import type { StateCreator } from 'zustand'
import { DAY_MOMENTS } from '@/content/day'
import { hourText } from './dayStats'

/** Real-time lengths (ms). The CSS transitions in jumpMenu.css use the same numbers. */
export const FADE_OUT_MS = 400
export const SETTLE_MS = 500
export const FADE_IN_MS = 500

export type JumpPhase = 'idle' | 'fadingOut' | 'swapping' | 'fadingIn'

export interface JumpTarget {
  hour: number
  /** "10:30". */
  time: string
  /** The moment's label from day.json ("Discharges"); empty for an hour that is not a listed moment. */
  label: string
}

export interface JumpState {
  /** The menu is open. */
  open: boolean
  phase: JumpPhase
  target: JumpTarget | null
  /** Mirrors `simGeneration`: the keyed scene layers remount when it changes. */
  generation: number
  setOpen(open: boolean): void
  toggle(): void
  /** Start a jump to a clock hour. Returns false (and does nothing) while another jump is running. */
  jump(hour: number): boolean
}

export interface JumpDeps {
  /** Rebuild the hospital at `hour` and swap it in (src/sim jumpTo). May throw: the old hospital then stays. */
  rebuild(hour: number): void
  /** The running hospital's generation (src/sim simGeneration). */
  generation(): number
  /** Right after the swap: drop UI state that points at people of the old hospital (selection, speech bubbles). */
  afterSwap?(): void
  /** Run `fn` once `ms` of real time has passed. */
  after(ms: number, fn: () => void): void
  /** Run `fn` after `n` painted frames (with a timer as a safety net for hidden tabs). */
  frames(n: number, fn: () => void): void
  /** Report a failed rebuild. */
  onError?(error: unknown): void
}

export function targetOf(hour: number): JumpTarget {
  const moment = DAY_MOMENTS.find((m) => m.hour === hour)
  return { hour, time: hourText(hour), label: moment?.label ?? '' }
}

export function createJumpState(deps: JumpDeps): StateCreator<JumpState> {
  return (set, get) => {
    const finish = (): void => set({ phase: 'idle', target: null })
    const fadeIn = (): void => {
      set({ phase: 'fadingIn' })
      deps.after(FADE_IN_MS, finish)
    }
    const swap = (hour: number): void => {
      try {
        deps.rebuild(hour)
      } catch (error) {
        // the old hospital is untouched (the rebuild builds first and swaps last): show it again
        deps.onError?.(error)
        fadeIn()
        return
      }
      deps.afterSwap?.()
      set({ phase: 'swapping', generation: deps.generation() })
      deps.after(SETTLE_MS, () => deps.frames(3, fadeIn))
    }

    return {
      open: false,
      phase: 'idle',
      target: null,
      generation: deps.generation(),
      setOpen: (open) => {
        if (open && get().phase !== 'idle') return
        set({ open })
      },
      toggle: () => get().setOpen(!get().open),
      jump: (hour) => {
        if (get().phase !== 'idle') return false
        set({ open: false, phase: 'fadingOut', target: targetOf(hour) })
        deps.after(FADE_OUT_MS, () => deps.frames(2, () => swap(hour)))
        return true
      },
    }
  }
}
