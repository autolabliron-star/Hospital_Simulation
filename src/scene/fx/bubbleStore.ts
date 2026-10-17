/**
 * The speech-bubble store: what people are saying right now. Anything can call `useBubbles.getState().say(...)`
 * (the M4 barks, the tour, a test) without importing a scene component.
 *
 * Rules, all enforced here so the renderer stays dumb:
 *  - at most `MAX_BUBBLES` (12) at once; when a 13th arrives the one that would expire soonest makes room;
 *  - one bubble per person: a new line replaces that person's old one;
 *  - the same text is not repeated for the same person within `REPEAT_WINDOW_SECONDS` (60 s);
 *  - a bubble disappears when its `until` passes (`prune`, called about four times a second by the renderer).
 *
 * Time is real seconds (`performance.now() / 1000`), not sim time: a line stays readable while the sim is paused or
 * running at 4x. Every method takes an optional `now` so tests need no clock.
 */
import { create } from 'zustand'

export const MAX_BUBBLES = 12
export const REPEAT_WINDOW_SECONDS = 60
/** The most text a bubble holds; longer lines are cut with an ellipsis. */
export const MAX_TEXT_LENGTH = 140
/** How many "who said what" records are kept for the no-repeat rule before the old ones are swept out. */
const MEMORY_LIMIT = 512

export interface Bubble {
  /** Grows with every accepted `say`; React key and stacking order. */
  id: number
  entityId: string
  text: string
  /** Clock seconds when it was said, and when it expires. */
  born: number
  until: number
}

export interface BubbleState {
  bubbles: Bubble[]
  /**
   * Show `text` over this person for `seconds`. Returns false when the line was dropped (empty, or the same person
   * said the same thing less than 60 s ago).
   */
  say: (entityId: string, text: string, seconds: number, now?: number) => boolean
  /** Remove expired bubbles. Returns true when something was removed. */
  prune: (now?: number) => boolean
  /** Remove one person's bubble, or all of them. */
  clear: (entityId?: string) => void
}

export const bubbleClock = (): number => performance.now() / 1000

/** A store with its own memory and clock. The app uses `useBubbles`; tests make their own. */
export function createBubbleStore(clock: () => number = bubbleClock) {
  /** "entity\ntext" -> the clock time it was last said. */
  const said = new Map<string, number>()
  let nextId = 1

  function sweep(now: number): void {
    if (said.size < MEMORY_LIMIT) return
    for (const [key, t] of said) if (now - t >= REPEAT_WINDOW_SECONDS) said.delete(key)
  }

  return create<BubbleState>()((set, get) => ({
    bubbles: [],

    say(entityId, rawText, seconds, now = clock()) {
      let text = rawText.trim().replace(/\s+/g, ' ')
      if (text === '' || !(seconds > 0) || !Number.isFinite(seconds)) return false
      if (text.length > MAX_TEXT_LENGTH) text = `${text.slice(0, MAX_TEXT_LENGTH - 1).trimEnd()}…`
      const key = `${entityId}\n${text}`
      const last = said.get(key)
      if (last !== undefined && now - last < REPEAT_WINDOW_SECONDS) return false
      sweep(now)
      said.set(key, now)

      const next = get().bubbles.filter((b) => b.until > now && b.entityId !== entityId)
      next.push({ id: nextId++, entityId, text, born: now, until: now + seconds })
      while (next.length > MAX_BUBBLES) {
        // make room by dropping the bubble that would expire first (never the one just added, the last entry)
        let victim = 0
        for (let i = 1; i < next.length - 1; i++) if (next[i].until < next[victim].until) victim = i
        next.splice(victim, 1)
      }
      set({ bubbles: next })
      return true
    },

    prune(now = clock()) {
      const before = get().bubbles
      const live = before.filter((b) => b.until > now)
      if (live.length === before.length) return false
      set({ bubbles: live })
      return true
    },

    clear(entityId) {
      const before = get().bubbles
      const live = entityId === undefined ? [] : before.filter((b) => b.entityId !== entityId)
      if (live.length !== before.length) set({ bubbles: live })
    },
  }))
}

/** The one store of the running hospital. */
export const useBubbles = createBubbleStore()

/** Shorthand for `useBubbles.getState().say(...)`. */
export function say(entityId: string, text: string, seconds: number): boolean {
  return useBubbles.getState().say(entityId, text, seconds)
}
