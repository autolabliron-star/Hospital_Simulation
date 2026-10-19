/**
 * Your lift ride as a small state machine (R2; zustand state creator, no React, no sim singleton). E in a lift lobby (src/scene/interact/lift.ts) calls
 * `ride(shaft, from)`; the screen covers, you are put in the other level's lobby behind the cover, and it lifts again. The Jump cover's sequence, shorter:
 *
 *   idle -> fadingOut   the cover comes in (LIFT_FADE_OUT_MS, 400 ms)
 *        -> holding     the cover is opaque and has been painted: `arrive` (you are placed in the other lobby, a car shows the ride, you change
 *                       into theatre scrubs on level 2 and back into your coat on level 1) and the soft ding; the caption names the level
 *                       (LIFT_HOLD_MS, about 700 ms)
 *        -> fadingIn    the cover lifts (LIFT_FADE_IN_MS, 500 ms)
 *        -> idle
 *
 * Nothing of the move can be seen: it only happens after the cover has had two painted frames. `deps` makes the sequence testable with fake timers;
 * `arriveInLobby` (the move itself) takes its effects through `ArriveEnv`, so it is tested with fakes too. The CSS transitions in liftCover.css use the same numbers.
 */
import type { StateCreator } from 'zustand'
import { SURGERY_UI } from '@/content/surgeryUi'
import type { LevelId } from '@/sim/levels'
import { LIFTS, type LiftLobbyAnchors, type ShaftId, type Spot } from '@/sim/places'
import type { Outfit } from '@/sim/types'
import { otherLevel } from './levelSwitchModel'

/** Real-time lengths (ms). */
export const LIFT_FADE_OUT_MS = 400
export const LIFT_HOLD_MS = 700
export const LIFT_FADE_IN_MS = 500

export type LiftPhase = 'idle' | 'fadingOut' | 'holding' | 'fadingIn'

/** One ride: the shaft, the level you leave, the level you reach and the caption the cover shows. */
export interface LiftTrip {
  shaft: ShaftId
  from: LevelId
  to: LevelId
  /** "Level 2 · Surgery" or "Level 1 · Entrance and wards". */
  caption: string
}

export interface LiftRideState {
  phase: LiftPhase
  trip: LiftTrip | null
  /** Start a ride from `from` in `shaft`'s lobby. Returns false (and does nothing) while another ride is running. */
  ride(shaft: ShaftId, from: LevelId): boolean
}

export interface LiftRideDeps {
  /** Behind the opaque cover: put you in the other lobby, show the ride, change your clothes (`arriveInLobby`). May throw: the ride then ends where it stands. */
  arrive(trip: LiftTrip): void
  /** The soft ding (it respects the mute: src/audio/ambience.ts `cueLiftDing`). */
  ding(): void
  /** Run `fn` once `ms` of real time has passed. */
  after(ms: number, fn: () => void): void
  /** Run `fn` after `n` painted frames (with a timer as a safety net for hidden tabs). */
  frames(n: number, fn: () => void): void
  onError?(error: unknown): void
}

/** The ride from `from` in `shaft`: where it goes and what the cover says. */
export function tripFrom(shaft: ShaftId, from: LevelId): LiftTrip {
  const to = otherLevel(from)
  return { shaft, from, to, caption: to === 2 ? SURGERY_UI.lift.coverTwo : SURGERY_UI.lift.coverOne }
}

/** The clothes of a level: theatre scrubs on level 2, your coat ('role') on level 1. */
export function outfitOf(level: LevelId): Outfit {
  return level === 2 ? 'theatre' : 'role'
}

/** Which way you face when you step out of a lobby: from the first walker spot towards the lobby's door (onto the corridor). */
export function headingOutOf(lobby: LiftLobbyAnchors): number {
  const w = lobby.walkers[0]
  return Math.atan2(lobby.door.x - w.x, lobby.door.z - w.z)
}

/** The first walker spot of the lobby you arrive in, where `arriveInLobby` puts you (sim coordinates). */
export function arrivalSpot(trip: Pick<LiftTrip, 'shaft' | 'to'>): Spot {
  const lobby = LIFTS[trip.shaft][trip.to]
  return { at: { x: lobby.walkers[0].x, z: lobby.walkers[0].z }, heading: headingOutOf(lobby) }
}

/** What the move itself does to the world. The real ones come from the player system and the sim (liftRide.store.ts). */
export interface ArriveEnv {
  placePlayer(x: number, z: number, heading: number): void
  /** `sim.lifts.playerRide`: a car shows the ride, for show. */
  rideCars(shaft: ShaftId, from: LevelId, to: LevelId): void
  /** Your avatar's clothes (the player entity, id 'player'). */
  setOutfit(outfit: Outfit): void
}

/** The move, behind the cover: in the other lobby at its first walker spot facing out, a car shown for the ride, the clothes of that level. */
export function arriveInLobby(trip: LiftTrip, env: ArriveEnv): void {
  const spot = arrivalSpot(trip)
  env.placePlayer(spot.at.x, spot.at.z, spot.heading)
  env.rideCars(trip.shaft, trip.from, trip.to)
  env.setOutfit(outfitOf(trip.to))
}

export function createLiftRide(deps: LiftRideDeps): StateCreator<LiftRideState> {
  return (set, get) => {
    const finish = (): void => set({ phase: 'idle', trip: null })
    const fadeIn = (): void => {
      set({ phase: 'fadingIn' })
      deps.after(LIFT_FADE_IN_MS, finish)
    }
    const hold = (trip: LiftTrip): void => {
      try {
        deps.arrive(trip)
        deps.ding()
      } catch (error) {
        // you stay where you were: show it again
        deps.onError?.(error)
        fadeIn()
        return
      }
      set({ phase: 'holding' })
      deps.after(LIFT_HOLD_MS, fadeIn)
    }

    return {
      phase: 'idle',
      trip: null,
      ride: (shaft, from) => {
        if (get().phase !== 'idle') return false
        const trip = tripFrom(shaft, from)
        set({ phase: 'fadingOut', trip })
        deps.after(LIFT_FADE_OUT_MS, () => deps.frames(2, () => hold(trip)))
        return true
      },
    }
  }
}
