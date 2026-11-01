/**
 * R5 "Watch step by step": the slow state of a watch for the React UI (src/ui/watch), and the few plain fields the scene reads every frame.
 *
 *   useWatch     zustand, written by the director only when something it shows changes (a phase, a shot, an inset, a dip to black): a few times a
 *                minute, never per frame. The caption and the step list are read from the sim at 4 Hz by the overlay itself.
 *   watchLive    plain fields for the frame callbacks (the endoscope's repaint rate): no store read, no allocation.
 *   the session  the director registers itself here while <WatchCamera /> is mounted, so the UI (the room panel's button, the overlay, the probe)
 *                starts and stops a watch without importing the scene.
 */
import { create } from 'zustand'
import type { InsetId } from '@/scene/registries/insetSources'
import type { ProcedureId } from '@/sim/types'
import type { WatchRoomId } from './rooms'

/** off: no watch. entering: waiting for your flight down into walk mode. live: the watch camera holds the lens. leaving: handing back. */
export type WatchPhase = 'off' | 'entering' | 'live' | 'leaving'
/** watch: the booked step-by-step case. follow: the case already in the room, from its current step. */
export type WatchMode = 'watch' | 'follow'
/** waiting: our case has not been wheeled in yet. case: it is in the room. ended: it has left (the camera hands back shortly). */
export type WatchStatus = 'waiting' | 'case' | 'ended'
/** off, or free look: by dragging (the director takes over after a pause or at the next step) or held by the button. */
export type FreeLook = 'off' | 'drag' | 'held'

export interface WatchUiState {
  phase: WatchPhase
  room: WatchRoomId | null
  mode: WatchMode | null
  /** The procedure asked for (watch mode), or null while following whatever is in the room. */
  procedureId: ProcedureId | null
  status: WatchStatus
  shotId: string | null
  inset: InsetId | null
  insetBig: boolean
  free: FreeLook
  /** Bumped at the start of every dip to black: the overlay replays its 0.5 s fade on each new value. */
  dip: number
  /** A skip to the watch case's start is running (ours: the generation change it may cause is expected). */
  skipping: boolean
  set(patch: Partial<Omit<WatchUiState, 'set'>>): void
}

export const WATCH_IDLE: Omit<WatchUiState, 'set' | 'dip'> = {
  phase: 'off',
  room: null,
  mode: null,
  procedureId: null,
  status: 'waiting',
  shotId: null,
  inset: null,
  insetBig: false,
  free: 'off',
  skipping: false,
}

export const useWatch = create<WatchUiState>((set) => ({
  ...WATCH_IDLE,
  dip: 0,
  set: (patch) => set(patch),
}))

/** Is a watch on (any phase but off)? For the hotkeys and the HUD. */
export const watchingNow = (s: Pick<WatchUiState, 'phase'>): boolean => s.phase !== 'off'

/** Read by frame callbacks: the room being watched while the watch camera holds (or is about to hold) the lens. */
export const watchLive: { room: WatchRoomId | null } = { room: null }

// ---------------------------------------------------------------------------------------------
// The session (the director, registered by <WatchCamera />)
// ---------------------------------------------------------------------------------------------

export interface WatchRequest {
  room: WatchRoomId
  mode: WatchMode
  procedureId: ProcedureId | null
}

/** What the UI may ask of the director. */
export interface WatchSession {
  /** Start watching (or switch what is watched). False when the camera cannot be taken (no player, another lease). */
  begin(req: WatchRequest): boolean
  /** Stop: hand the camera back (dolly back, or fly out to the overview you came from). */
  end(): void
  /** A skip of ours is about to run: its generation change (a rebuild) is expected and does not end the watch. */
  expectGeneration(): void
  /** Free look held by the button (true), or given back to the director (false). */
  holdFreeLook(on: boolean): void
  /** For the probe (`?probe=1`): the director's state and the camera's sim pose (allocates: never per frame). */
  debug(): { phase: WatchPhase; status: WatchStatus; shotId: string | null; free: FreeLook; moving: boolean; eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number }
}

let session: WatchSession | null = null

export function registerWatchSession(s: WatchSession | null): void {
  session = s
}

export function watchSession(): WatchSession | null {
  return session
}
