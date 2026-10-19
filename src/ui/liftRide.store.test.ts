/**
 * The ride on the real wiring: the store, the live `sim` (its player and its lifts), the player system's `placePlayer` (a fake registered in its place), the ambience's
 * ding cue. Fake timers; no `requestAnimationFrame` in node, so the painted-frames wait falls back to its timer (120 ms a frame plus 200 ms).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liftDingCues } from '@/audio/ambience'
import { registerPlayer } from '@/scene/player/api'
import type { PlayerSystem } from '@/scene/player/system'
import { sim } from '@/sim'
import { LIFTS, PLAYER_SPAWN } from '@/sim/places'
import { LIFT_FADE_IN_MS, LIFT_FADE_OUT_MS, LIFT_HOLD_MS } from './liftFlow'
import { syncPlayerOutfit, useLiftRide } from './liftRide.store'

const FRAMES_FALLBACK_MS = 120 * 2 + 200

describe('your lift ride on the real sim', () => {
  const placed: number[][] = []

  beforeEach(() => {
    vi.useFakeTimers()
    placed.length = 0
    sim.addPlayer(PLAYER_SPAWN)
    const me = sim.player!
    me.x = LIFTS.A[1].stretcher.at.x
    me.z = LIFTS.A[1].stretcher.at.z
    sim.playerAvatar!.outfit = 'role'
    registerPlayer({
      placeAt: (x: number, z: number, heading?: number) => {
        placed.push([x, z, heading ?? NaN])
        // the real system moves the body; the sim's view of you follows it
        me.x = x
        me.z = z
      },
    } as unknown as PlayerSystem)
  })

  afterEach(() => {
    registerPlayer(null)
    useLiftRide.setState({ phase: 'idle', trip: null })
    sim.removePlayer()
    vi.useRealTimers()
  })

  it('covers, then puts you in the level-2 lobby in theatre scrubs, rings, shows a car, and lifts the cover', () => {
    const ding0 = liftDingCues()
    const trips0 = sim.lifts.history.length
    expect(useLiftRide.getState().ride('A', 1)).toBe(true)
    expect(useLiftRide.getState().phase).toBe('fadingOut')
    // nothing has moved while the cover comes in
    vi.advanceTimersByTime(LIFT_FADE_OUT_MS)
    expect(placed).toEqual([])
    expect(sim.playerAvatar!.outfit).toBe('role')
    expect(liftDingCues()).toBe(ding0)

    vi.advanceTimersByTime(FRAMES_FALLBACK_MS)
    expect(useLiftRide.getState().phase).toBe('holding')
    const w = LIFTS.A[2].walkers[0]
    expect(placed).toHaveLength(1)
    expect(placed[0][0]).toBe(w.x)
    expect(placed[0][1]).toBe(w.z)
    expect(Number.isFinite(placed[0][2])).toBe(true)
    expect(sim.playerAvatar!.outfit).toBe('theatre')
    expect(liftDingCues()).toBe(ding0 + 1)
    // a car shows the ride (the sim's ghost trip: nothing is reserved)
    expect(sim.lifts.history.length).toBe(trips0 + 1)
    const trip = sim.lifts.history[sim.lifts.history.length - 1]
    expect([trip.shaft, trip.from, trip.to, trip.ghost]).toEqual(['A', 1, 2, true])

    vi.advanceTimersByTime(LIFT_HOLD_MS)
    expect(useLiftRide.getState().phase).toBe('fadingIn')
    vi.advanceTimersByTime(LIFT_FADE_IN_MS)
    expect(useLiftRide.getState()).toMatchObject({ phase: 'idle', trip: null })
  })

  it('and back: the level-1 lobby, your coat again', () => {
    const me = sim.player!
    me.x = LIFTS.B[2].stretcher.at.x
    me.z = LIFTS.B[2].stretcher.at.z
    sim.playerAvatar!.outfit = 'theatre'
    useLiftRide.getState().ride('B', 2)
    vi.advanceTimersByTime(LIFT_FADE_OUT_MS + FRAMES_FALLBACK_MS)
    const w = LIFTS.B[1].walkers[0]
    expect(placed).toEqual([[w.x, w.z, expect.any(Number)]])
    expect(sim.playerAvatar!.outfit).toBe('role')
    const trip = sim.lifts.history[sim.lifts.history.length - 1]
    expect([trip.shaft, trip.from, trip.to]).toEqual(['B', 2, 1])
    vi.advanceTimersByTime(LIFT_HOLD_MS + LIFT_FADE_IN_MS)
    expect(useLiftRide.getState().phase).toBe('idle')
  })

  it('does not ride twice at once', () => {
    expect(useLiftRide.getState().ride('A', 1)).toBe(true)
    expect(useLiftRide.getState().ride('A', 1)).toBe(false)
    vi.advanceTimersByTime(LIFT_FADE_OUT_MS + FRAMES_FALLBACK_MS)
    expect(placed).toHaveLength(1)
  })
})

describe('your clothes follow your level (after a Jump makes a new you in your coat)', () => {
  beforeEach(() => {
    sim.addPlayer(PLAYER_SPAWN)
  })
  afterEach(() => {
    sim.removePlayer()
  })

  it('puts on theatre scrubs on level 2 and your coat on level 1, and leaves a right outfit alone', () => {
    const me = sim.player!
    const av = sim.playerAvatar!
    me.x = LIFTS.A[2].walkers[0].x
    me.z = LIFTS.A[2].walkers[0].z
    av.outfit = 'role'
    syncPlayerOutfit()
    expect(av.outfit).toBe('theatre')
    syncPlayerOutfit()
    expect(av.outfit).toBe('theatre')
    me.x = LIFTS.A[1].walkers[0].x
    me.z = LIFTS.A[1].walkers[0].z
    syncPlayerOutfit()
    expect(av.outfit).toBe('role')
  })

  it('does nothing when you are not in the hospital', () => {
    sim.removePlayer()
    expect(() => syncPlayerOutfit()).not.toThrow()
  })
})
