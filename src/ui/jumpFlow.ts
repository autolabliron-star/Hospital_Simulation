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
 * A skip (S1) is the same dance going forward in time: `lapsing` (CONFIG.skip.lapseMs: a translucent veil over the still-running old
 * scene while the clock spins and the sky runs to the new hour) -> `swapping` (the veil is opaque; after two painted frames the hospital
 * runs forward headless (`advance`, mode 'live': same people, same selection, same generation) or is rebuilt at the target (`rebuildAt`,
 * mode 'rebuild': like a Jump, bumps the generation)) -> `fadingIn` (CONFIG.skip.fadeInMs) -> idle. `skipping` holds the request until idle.
 *
 * Nothing of the old or the half-built hospital can be seen: the rebuild only starts after the cover has had two painted
 * frames, and the cover only lifts after the new layers have drawn. `deps` makes the sequence testable with fake timers.
 */
import type { StateCreator } from 'zustand'
import { DAY_MOMENTS } from '@/content/day'
import { CONFIG } from '@/sim/config'
import { hourText } from './dayStats'
import type { SkipRequest } from './skip/types'

/** Real-time lengths (ms). The CSS transitions in jumpMenu.css use the same numbers. */
export const FADE_OUT_MS = 400
export const SETTLE_MS = 500
export const FADE_IN_MS = 500
/** S1: after a rebuilding skip the keyed layers have remounted and their people fade in over 0.35 s: wait this long before the veil lifts. */
export const SKIP_SETTLE_MS = 350

/** S1: a skip runs `lapsing` (the time-lapse veil over the old scene) instead of `fadingOut`. */
export type JumpPhase = 'idle' | 'fadingOut' | 'lapsing' | 'swapping' | 'fadingIn'

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
  /** S1: the skip in progress (the time-lapse cover reads it), or null. */
  skipping: SkipRequest | null
  /** S1: start a skip ahead. Returns false (and does nothing) while a jump or skip is running or during your lift ride. */
  skip(req: SkipRequest): boolean
}

export interface JumpDeps {
  /** Rebuild the hospital at `hour` and swap it in (src/sim jumpTo). May throw: the old hospital then stays. */
  rebuild(hour: number): void
  /** S1: run the same hospital forward (src/sim advanceBy), or rebuild it so the clock lands at `t` (src/sim skipRebuild). */
  advance?(seconds: number): void
  rebuildAt?(t: number): void
  /** The running hospital's generation (src/sim simGeneration). */
  generation(): number
  /** Right after the swap: drop UI state that points at people of the old hospital (selection, speech bubbles). */
  afterSwap?(): void
  /** S1: right after a live skip (the same hospital ran forward): drop only what no longer exists, keep the selection. */
  afterLiveSkip?(): void
  /** Run `fn` once `ms` of real time has passed. */
  after(ms: number, fn: () => void): void
  /** Run `fn` after `n` painted frames (with a timer as a safety net for hidden tabs). */
  frames(n: number, fn: () => void): void
  /** Report a failed rebuild. */
  onError?(error: unknown): void
  /** R2: something else owns the screen right now (your lift ride): the menu does not open and no jump starts. */
  busy?(): boolean
}

export function targetOf(hour: number): JumpTarget {
  const moment = DAY_MOMENTS.find((m) => m.hour === hour)
  return { hour, time: hourText(hour), label: moment?.label ?? '' }
}

export function createJumpState(deps: JumpDeps): StateCreator<JumpState> {
  return (set, get) => {
    const finish = (): void => set({ phase: 'idle', target: null, skipping: null })
    const fadeIn = (ms: number = FADE_IN_MS): void => {
      set({ phase: 'fadingIn' })
      deps.after(ms, finish)
    }
    // S1: the skip's swap. Runs with the veil opaque and painted.
    const skipSwap = (req: SkipRequest): void => {
      const fade = (): void => fadeIn(CONFIG.skip.fadeInMs)
      try {
        if (req.mode === 'live') {
          if (!deps.advance) throw new Error('skip: no advance dependency')
          deps.advance(Math.max(0, req.toT - req.fromT))
        } else {
          if (!deps.rebuildAt) throw new Error('skip: no rebuildAt dependency')
          deps.rebuildAt(req.toT)
        }
      } catch (error) {
        // nothing was swapped: the old hospital shows again
        deps.onError?.(error)
        fade()
        return
      }
      if (req.mode === 'live') {
        deps.afterLiveSkip?.()
        deps.frames(2, fade)
        return
      }
      deps.afterSwap?.()
      set({ generation: deps.generation() })
      deps.after(SKIP_SETTLE_MS, () => deps.frames(3, fade))
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
        if (open && (get().phase !== 'idle' || deps.busy?.())) return
        set({ open })
      },
      toggle: () => get().setOpen(!get().open),
      jump: (hour) => {
        if (get().phase !== 'idle' || deps.busy?.()) return false
        set({ open: false, phase: 'fadingOut', target: targetOf(hour) })
        deps.after(FADE_OUT_MS, () => deps.frames(2, () => swap(hour)))
        return true
      },
      skipping: null,
      skip: (req) => {
        if (get().phase !== 'idle' || deps.busy?.()) return false
        set({ open: false, phase: 'lapsing', target: null, skipping: req })
        deps.after(CONFIG.skip.lapseMs, () => {
          set({ phase: 'swapping' })
          deps.frames(2, () => skipSwap(req))
        })
        return true
      },
    }
  }
}
