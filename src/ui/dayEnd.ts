/**
 * The end of the day (F-05). Every arrival table of the simulation is for one day: after the day's last clock hour (the limit a skip is
 * clamped to, `skipLimit()`, 23:30) there are no ER walk-ins, ambulances, visitors, dose waves or operations, and the hospital would just
 * drain. So when the running hospital reaches that limit the watcher runs the Jump flow to the next 07:00 behind the usual cover, with
 * "A new day" on it. Never a dead day 2.
 *
 * `createDayEnd` is plain logic with its dependencies injected (tested with fake timers); `startDayEnd` wires it to the real hospital and
 * the Jump store; `useDayEnd` is the hook App mounts once. It polls twice a second in real time: no per-frame work, no store writes.
 */
import { useEffect } from 'react'
import { sim, skipLimit } from '@/sim'
import { jumpWithCaption } from './jump.store'

/** The clock hour a new day starts at. */
export const NEW_DAY_HOUR = 7
/** The words on the cover. */
export const NEW_DAY_CAPTION = 'A new day'
/** Real milliseconds between two looks at the clock. */
export const DAY_END_POLL_MS = 500
/** Looks (about 15 s) before a new day that did not take is asked for again. */
export const RETRY_POLLS = 30

export interface DayEndDeps {
  /** Sim seconds now (src/sim `sim.t`). */
  now(): number
  /** The sim time the day ends at (`skipLimit()`). */
  limit(): number
  /** Start the Jump to the new day; false when the flow refuses (another jump, a lift ride): the watcher asks again at the next look. */
  newDay(): boolean
  /** Call `fn` every `ms` of real time; returns the stop function. */
  every(ms: number, fn: () => void): () => void
}

/** Start watching. Returns a function that stops it. */
export function createDayEnd(deps: DayEndDeps): () => void {
  // After a new day was started the old clock may still be read for a moment (the swap happens behind the cover): wait until the
  // clock is seen below the limit again before asking for the next one. If it stays over the limit (the rebuild failed and the old
  // hospital stayed) ask again after RETRY_POLLS looks, so the day is never left dead.
  let armed = true
  let waited = 0
  return deps.every(DAY_END_POLL_MS, () => {
    const over = deps.now() >= deps.limit()
    if (!over) {
      armed = true
      waited = 0
      return
    }
    if (!armed && ++waited >= RETRY_POLLS) {
      armed = true
      waited = 0
    }
    if (armed && deps.newDay()) {
      armed = false
      waited = 0
    }
  })
}

/** The real wiring: the running hospital, the Jump flow and the browser's timers. */
export function startDayEnd(): () => void {
  return createDayEnd({
    now: () => sim.t,
    limit: skipLimit,
    newDay: () => jumpWithCaption(NEW_DAY_HOUR, NEW_DAY_CAPTION),
    every: (ms, fn) => {
      const id = setInterval(fn, ms)
      return () => clearInterval(id)
    },
  })
}

/** Mount once in App. */
export function useDayEnd(): void {
  useEffect(() => startDayEnd(), [])
}
