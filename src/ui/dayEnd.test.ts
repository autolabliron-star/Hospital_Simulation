/**
 * F-05: the end of the day. The watcher (dayEnd.ts) is tested with fake timers against a hand-set clock, against the real Jump store
 * (the caption "A new day" on the cover) and against a full Simulation running from 22:30 past the 23:30 limit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG } from '@/sim/config'
import { Simulation } from '@/sim/Simulation'
import { jumpTo, sim, simGeneration, skipLimit } from '@/sim'
import { createDayEnd, DAY_END_POLL_MS, NEW_DAY_CAPTION, NEW_DAY_HOUR, RETRY_POLLS } from './dayEnd'
import { jumpWithCaption, useJump } from './jump.store'

afterEach(() => vi.useRealTimers())

const timers = (): { every: (ms: number, fn: () => void) => () => void } => ({
  every: (ms, fn) => {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
})

describe('the day-end watcher', () => {
  it('does nothing before the limit, asks for a new day once at the limit, and again only after the clock came back below it', () => {
    vi.useFakeTimers()
    let now = 100
    let calls = 0
    const stop = createDayEnd({ now: () => now, limit: () => 1000, newDay: () => (calls++, true), ...timers() })
    vi.advanceTimersByTime(10 * DAY_END_POLL_MS)
    expect(calls).toBe(0)
    now = 1000
    vi.advanceTimersByTime(DAY_END_POLL_MS)
    expect(calls).toBe(1)
    // the swap has not happened yet: the clock is still over the limit for a few looks, and nobody asks again
    vi.advanceTimersByTime(5 * DAY_END_POLL_MS)
    expect(calls).toBe(1)
    // the new hospital is at 07:00
    now = 30
    vi.advanceTimersByTime(DAY_END_POLL_MS)
    now = 1200
    vi.advanceTimersByTime(DAY_END_POLL_MS)
    expect(calls).toBe(2)
    stop()
    now = 30
    vi.advanceTimersByTime(DAY_END_POLL_MS)
    now = 5000
    vi.advanceTimersByTime(20 * DAY_END_POLL_MS)
    expect(calls).toBe(2)
  })

  it('keeps asking while the flow refuses (a lift ride, another jump)', () => {
    vi.useFakeTimers()
    let calls = 0
    let ok = false
    createDayEnd({ now: () => 2000, limit: () => 1000, newDay: () => (calls++, ok), ...timers() })
    vi.advanceTimersByTime(4 * DAY_END_POLL_MS)
    expect(calls).toBe(4)
    ok = true
    vi.advanceTimersByTime(DAY_END_POLL_MS)
    expect(calls).toBe(5)
    vi.advanceTimersByTime(3 * DAY_END_POLL_MS)
    expect(calls).toBe(5)
  })

  it('asks again after a while when the new day did not take (the old hospital stayed)', () => {
    vi.useFakeTimers()
    let calls = 0
    createDayEnd({ now: () => 2000, limit: () => 1000, newDay: () => (calls++, true), ...timers() })
    vi.advanceTimersByTime((RETRY_POLLS + 2) * DAY_END_POLL_MS)
    expect(calls).toBe(2)
  })

  it('jumps the real hospital to 07:00 with "A new day" on the cover', () => {
    vi.useFakeTimers()
    const before = simGeneration
    expect(jumpWithCaption(NEW_DAY_HOUR, NEW_DAY_CAPTION)).toBe(true)
    expect(useJump.getState().phase).toBe('fadingOut')
    expect(useJump.getState().target).toMatchObject({ hour: NEW_DAY_HOUR, time: '07:00', label: NEW_DAY_CAPTION })
    expect(jumpWithCaption(10, 'nope')).toBe(false) // one at a time
    vi.advanceTimersByTime(5000)
    expect(useJump.getState()).toMatchObject({ phase: 'idle', target: null, generation: before + 1 })
    expect(sim.life.startHour).toBe(NEW_DAY_HOUR)
    expect(sim.t).toBeLessThan(skipLimit())
    jumpTo(NEW_DAY_HOUR) // leave the shared hospital as a test of the next file expects a fresh one
  })
})

describe('a full Simulation across the end of the day', () => {
  it('runs from 22:30 to 23:40 without a throw, and the watcher fires at 23:30', { timeout: 600_000 }, () => {
    vi.useFakeTimers()
    const day = new Simulation(2026, { startHour: 22.5, inFlight: false })
    const fired: number[] = []
    const stop = createDayEnd({
      now: () => day.t,
      limit: skipLimit,
      newDay: () => {
        fired.push(day.t)
        return true
      },
      ...timers(),
    })
    const step = CONFIG.sim.step
    const end = skipLimit() + 10 * 60
    expect(day.t).toBeLessThan(skipLimit())
    let sinceLook = 0
    while (day.t < end) {
      day.step(step)
      sinceLook += step
      if (sinceLook >= DAY_END_POLL_MS / 1000) {
        sinceLook = 0
        vi.advanceTimersByTime(DAY_END_POLL_MS)
      }
    }
    stop()
    expect(fired.length).toBeGreaterThanOrEqual(1)
    expect(fired[0]).toBeGreaterThanOrEqual(skipLimit())
    expect(fired[0]).toBeLessThan(skipLimit() + 2)
  })
})
