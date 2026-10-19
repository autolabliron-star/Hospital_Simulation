import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { SURGERY_UI } from '@/content/surgeryUi'
import { isWalkable } from '@/sim/nav/layout'
import { LIFTS, areaAt, type ShaftId } from '@/sim/places'
import { levelOf, type LevelId } from '@/sim/levels'
import type { Outfit } from '@/sim/types'
import {
  LIFT_FADE_IN_MS,
  LIFT_FADE_OUT_MS,
  LIFT_HOLD_MS,
  arriveInLobby,
  arrivalSpot,
  createLiftRide,
  headingOutOf,
  outfitOf,
  tripFrom,
  type ArriveEnv,
  type LiftRideDeps,
  type LiftRideState,
  type LiftTrip,
} from './liftFlow'

describe('the numbers of the ride', () => {
  it('are the brief: 400 ms in, about 700 ms held, 500 ms out', () => {
    expect(LIFT_FADE_OUT_MS).toBe(400)
    expect(LIFT_HOLD_MS).toBe(700)
    expect(LIFT_FADE_IN_MS).toBe(500)
  })
})

describe('what a ride is', () => {
  it('goes to the other level, and the cover names it with the copy', () => {
    expect(tripFrom('A', 1)).toEqual({ shaft: 'A', from: 1, to: 2, caption: 'Level 2 · Surgery' })
    expect(tripFrom('B', 2)).toEqual({ shaft: 'B', from: 2, to: 1, caption: 'Level 1 · Entrance and wards' })
    expect(tripFrom('A', 1).caption).toBe(SURGERY_UI.lift.coverTwo)
    expect(tripFrom('A', 2).caption).toBe(SURGERY_UI.lift.coverOne)
  })

  it('dresses you for the level: theatre scrubs on level 2, your coat on level 1', () => {
    expect(outfitOf(2)).toBe('theatre')
    expect(outfitOf(1)).toBe('role')
  })
})

describe('where you arrive', () => {
  const cases: [ShaftId, LevelId][] = [['A', 1], ['A', 2], ['B', 1], ['B', 2]]

  it('is the first walker spot of the lobby you ride to, in the right level, on ground you can stand on, inside the lobby', () => {
    for (const [shaft, from] of cases) {
      const to: LevelId = from === 1 ? 2 : 1
      const spot = arrivalSpot({ shaft, to })
      const walker = LIFTS[shaft][to].walkers[0]
      expect(spot.at, `${shaft}${from}`).toEqual({ x: walker.x, z: walker.z })
      expect(levelOf(spot.at.x), `${shaft}${from}`).toBe(to)
      expect(areaAt(spot.at.x, spot.at.z)?.id, `${shaft}${from}`).toBe(LIFTS[shaft][to].area)
      expect(isWalkable(spot.at.x, spot.at.z, 0.3), `${shaft}${from}`).toBe(true)
    }
  })

  it('faces out of the lobby: towards its door onto the corridor, away from the cars', () => {
    for (const shaft of ['A', 'B'] as const) {
      for (const level of [1, 2] as const) {
        const lobby = LIFTS[shaft][level]
        const w = lobby.walkers[0]
        const h = headingOutOf(lobby)
        const toDoor = { x: lobby.door.x - w.x, z: lobby.door.z - w.z }
        const len = Math.hypot(toDoor.x, toDoor.z)
        // heading is atan2(dx, dz): its direction (sin, cos) points at the door
        expect(Math.sin(h) * (toDoor.x / len) + Math.cos(h) * (toDoor.z / len), `${shaft}${level}`).toBeCloseTo(1, 9)
        // and the cars are behind you (they face the other way: `cars[0].heading` is "into the cars")
        const into = lobby.cars[0].heading
        expect(Math.sin(h) * Math.sin(into) + Math.cos(h) * Math.cos(into), `${shaft}${level}`).toBeLessThan(0.2)
      }
    }
  })

  it('puts you there, shows the ride and changes your clothes, for all four lobbies and both ways', () => {
    for (const [shaft, from] of cases) {
      const to: LevelId = from === 1 ? 2 : 1
      const calls: unknown[][] = []
      const env: ArriveEnv = {
        placePlayer: (x, z, h) => calls.push(['place', x, z, h]),
        rideCars: (s, f, t) => calls.push(['ride', s, f, t]),
        setOutfit: (o) => calls.push(['outfit', o]),
      }
      arriveInLobby(tripFrom(shaft, from), env)
      const spot = arrivalSpot({ shaft, to })
      expect(calls, `${shaft}${from}`).toEqual([['place', spot.at.x, spot.at.z, spot.heading], ['ride', shaft, from, to], ['outfit', to === 2 ? 'theatre' : 'role']])
    }
  })
})

/** Two painted frames at 60 Hz, as the harness's `frames` waits them. */
const TWO_FRAMES_MS = Math.round(2000 / 60)

describe('the sequence, with fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function harness(over: Partial<LiftRideDeps> = {}) {
    const log: string[] = []
    let store!: StoreApi<LiftRideState>
    const deps: LiftRideDeps = {
      arrive: (trip: LiftTrip) => log.push(`arrive:${trip.shaft}:${trip.from}>${trip.to}@${store.getState().phase}`),
      ding: () => log.push('ding'),
      after: (ms, fn) => void setTimeout(fn, ms),
      // two painted frames at 60 Hz
      frames: (n, fn) => void setTimeout(fn, Math.round((n * 1000) / 60)),
      onError: () => log.push('error'),
      ...over,
    }
    store = createStore<LiftRideState>(createLiftRide(deps))
    return { store, log }
  }

  it('starts idle with no trip', () => {
    const { store } = harness()
    expect(store.getState()).toMatchObject({ phase: 'idle', trip: null })
  })

  it('covers over 400 ms, moves you behind the opaque cover with a ding, holds about 700 ms, lifts over 500 ms, and ends idle', () => {
    const { store, log } = harness()
    expect(store.getState().ride('A', 1)).toBe(true)
    expect(store.getState().phase).toBe('fadingOut')
    expect(store.getState().trip).toMatchObject({ shaft: 'A', from: 1, to: 2, caption: 'Level 2 · Surgery' })
    expect(log).toEqual([])

    // the cover is still coming in: nothing has moved
    vi.advanceTimersByTime(LIFT_FADE_OUT_MS - 1)
    expect(store.getState().phase).toBe('fadingOut')
    expect(log).toEqual([])
    // it is opaque, then painted for two frames, and only then do you move (with the cover still up: the phase is fadingOut)
    vi.advanceTimersByTime(1)
    expect(log).toEqual([])
    vi.advanceTimersByTime(TWO_FRAMES_MS - 1)
    expect(log).toEqual([])
    vi.advanceTimersByTime(1)
    expect(log).toEqual(['arrive:A:1>2@fadingOut', 'ding'])
    expect(store.getState().phase).toBe('holding')

    // the hold: about 700 ms from the move
    vi.advanceTimersByTime(LIFT_HOLD_MS - 1)
    expect(store.getState().phase).toBe('holding')
    vi.advanceTimersByTime(1)
    expect(store.getState().phase).toBe('fadingIn')
    expect(store.getState().trip).not.toBeNull() // the caption stays while the cover lifts

    vi.advanceTimersByTime(LIFT_FADE_IN_MS - 1)
    expect(store.getState().phase).toBe('fadingIn')
    vi.advanceTimersByTime(1)
    expect(store.getState()).toMatchObject({ phase: 'idle', trip: null })
    expect(log).toEqual(['arrive:A:1>2@fadingOut', 'ding'])
    // nothing is left waiting
    expect(vi.getTimerCount()).toBe(0)
  })

  it('takes under two seconds end to end', () => {
    const { store } = harness()
    store.getState().ride('B', 2)
    let ms = 0
    while (store.getState().phase !== 'idle' && ms < 5000) {
      vi.advanceTimersByTime(1)
      ms++
    }
    expect(ms).toBeGreaterThan(LIFT_FADE_OUT_MS + LIFT_HOLD_MS + LIFT_FADE_IN_MS)
    expect(ms).toBeLessThan(2000)
  })

  it('does not start a second ride while one runs, and can ride again after', () => {
    const { store, log } = harness()
    expect(store.getState().ride('A', 1)).toBe(true)
    expect(store.getState().ride('A', 1)).toBe(false)
    vi.advanceTimersByTime(LIFT_FADE_OUT_MS + 50)
    expect(store.getState().ride('B', 1)).toBe(false) // holding
    vi.advanceTimersByTime(LIFT_HOLD_MS)
    expect(store.getState().ride('B', 1)).toBe(false) // fading in
    vi.advanceTimersByTime(LIFT_FADE_IN_MS)
    expect(store.getState().phase).toBe('idle')
    expect(log.filter((l) => l.startsWith('arrive'))).toHaveLength(1)
    expect(store.getState().ride('B', 2)).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(log.filter((l) => l.startsWith('arrive'))).toEqual(['arrive:A:1>2@fadingOut', 'arrive:B:2>1@fadingOut'])
  })

  it('if the move fails, the cover lifts again where you are (no ding, no stuck screen)', () => {
    const { store, log } = harness({
      arrive: () => {
        throw new Error('boom')
      },
    })
    store.getState().ride('A', 1)
    vi.advanceTimersByTime(LIFT_FADE_OUT_MS + 50)
    expect(log).toEqual(['error'])
    expect(store.getState().phase).toBe('fadingIn')
    vi.advanceTimersByTime(LIFT_FADE_IN_MS)
    expect(store.getState()).toMatchObject({ phase: 'idle', trip: null })
  })

  it('fills the move into the right places: the lobby spot, the cars and the clothes', () => {
    const calls: unknown[][] = []
    const env: ArriveEnv = {
      placePlayer: (x, z, h) => calls.push(['place', x, z, h]),
      rideCars: (s, f, t) => calls.push(['ride', s, f, t]),
      setOutfit: (o: Outfit) => calls.push(['outfit', o]),
    }
    const { store } = harness({ arrive: (trip) => arriveInLobby(trip, env) })
    store.getState().ride('B', 1)
    vi.advanceTimersByTime(2000)
    const spot = arrivalSpot({ shaft: 'B', to: 2 })
    expect(calls).toEqual([['place', spot.at.x, spot.at.z, spot.heading], ['ride', 'B', 1, 2], ['outfit', 'theatre']])
    expect(levelOf(spot.at.x)).toBe(2)
  })
})
