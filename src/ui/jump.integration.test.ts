/**
 * A Jump against the real glue (src/sim/index.ts, SimLoop, world.store) and the real Jump store: two hospitals are built from
 * the same seed, one is swapped for the other, and everything that reads "the running sim" must follow. Fake timers stand in
 * for the fade; the rebuild itself (about 60 sim s of pre-roll) really runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSimulation, jumpTo, loop, sim, simGeneration } from '@/sim'
import { CONFIG } from '@/sim/config'
import { clockText } from '@/sim/events'
import { useWorld } from '@/sim/world.store'
import { dayStatsTracker } from './dayStats'
import { useJump } from './jump.store'

const logOf = (s: { log: { events: { t: number; type: string; text: string }[] } }): string[] => s.log.events.map((e) => `${e.t.toFixed(2)} ${e.type} ${e.text}`)

describe('swapping the running hospital', () => {
  afterEach(() => vi.useRealTimers())

  it('jumpTo rebuilds at the hour with the same seed and swaps every live reference', () => {
    const old = sim
    const generation = simGeneration
    const seed = old.seed
    jumpTo(12)
    expect(sim).not.toBe(old)
    expect(sim.seed).toBe(seed)
    expect(sim.life.startHour).toBe(12)
    expect(simGeneration).toBe(generation + 1)
    expect(loop.sim).toBe(sim)
    // the pre-roll ran behind the cover: the clock is at 12:00 or a minute past, and the HUD store already shows it
    expect(sim.t).toBeGreaterThanOrEqual((12 - CONFIG.sim.startHour) * 3600 + CONFIG.day.jumpPreRollSeconds - 0.1)
    expect(clockText(sim.t)).toMatch(/^12:0[01]$/)
    expect(useWorld.getState().clock).toBe(clockText(sim.t))
    // renderers that read `sim.entities` and `rosterVersion` see a different roster
    expect(sim.entities).not.toBe(old.entities)
    expect(sim.rosterVersion).toBeGreaterThan(old.rosterVersion)
  })

  it('the same seed and hour give the same hospital, however often you jump', () => {
    jumpTo(15)
    const first = logOf(sim)
    jumpTo(7)
    jumpTo(15)
    expect(logOf(sim)).toEqual(first)
    expect(logOf(sim)).toEqual(logOf(buildSimulation(sim.seed, 15)))
  })

  it('the Jump store runs the whole fade around a real rebuild, and ends on the new generation', () => {
    vi.useFakeTimers()
    const before = simGeneration
    const store = useJump.getState()
    expect(store.jump(10.5)).toBe(true)
    expect(useJump.getState().phase).toBe('fadingOut')
    expect(simGeneration).toBe(before) // nothing is rebuilt until the cover is up
    expect(useJump.getState().jump(19)).toBe(false) // a second jump during the first is ignored

    vi.advanceTimersByTime(5000)
    expect(useJump.getState()).toMatchObject({ phase: 'idle', target: null, open: false, generation: before + 1 })
    expect(simGeneration).toBe(before + 1)
    expect(sim.life.startHour).toBe(10.5)
    expect(useWorld.getState().clock).toMatch(/^10:3[01]$/)
  })

  it('the day stats start again on the new hospital, not from the old log', () => {
    jumpTo(7.75)
    const before = sim
    before.step(1 / 60)
    const a = dayStatsTracker.read(before)
    expect(a.mealsServed).toBe(before.log.events.filter((e) => e.type === 'mealServed').length)
    jumpTo(18)
    const b = dayStatsTracker.read(sim)
    expect(b.mealsServed).toBe(sim.log.events.filter((e) => e.type === 'mealServed').length)
    expect(b.mealsOnTime).toBeLessThanOrEqual(b.mealsServed)
    expect(b.bedsTotal).toBe(16)
    expect(b.bedsOccupied + b.bedsReady + b.bedsReserved + b.bedsToClean).toBe(16)
  })

  // A new hospital's log numbers its events from 1 again; publishWorld starts over when `sim` changes.
  it('the HUD event store follows the new hospital after a Jump', () => {
    jumpTo(9)
    for (let i = 0; i < 600; i++) sim.step(1 / 60) // ten sim seconds of new events
    loop.publishNow()
    const shown = useWorld.getState().events
    const newest = sim.log.events.at(-1)!
    expect(shown.at(-1)?.id).toBe(newest.id)
    expect(shown.at(-1)?.text).toBe(newest.text)
  })
})
