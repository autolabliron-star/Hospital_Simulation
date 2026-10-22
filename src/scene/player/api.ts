/**
 * The small surface other systems may call on the player (the interaction builder: sit down, stand at a bedside; the
 * integration pass; `?probe=1` scripted checks). The system registers itself here while `<Player />` is mounted.
 * Reading where you are is `sim.player` (the live binding) or `walkCam`; this is only for MOVING you.
 */
import type { PlayerMode } from '@/sim/types'
import type { PlayerSnapshot, PlayerSystem } from './system'

let current: PlayerSystem | null = null

export function registerPlayer(system: PlayerSystem | null): void {
  current = system
}

/** Put you down at (x, z) (on the nearest walkable spot), facing `heading` if given. The camera keeps its view. */
export function placePlayer(x: number, z: number, heading?: number): void {
  current?.placeAt(x, z, heading)
}

/** Turn the camera to look along `yaw` (compass radians) at `pitch` (elevation above the pivot; omit for the default). */
export function lookPlayerCamera(yaw: number, pitch?: number): void {
  current?.chase.setLook(yaw, pitch)
}

/** Where you are, for scripted checks. Null when the player is not mounted. */
export function playerSnapshot(): PlayerSnapshot | null {
  return current ? current.snapshot() : null
}

/** The phase of the walk <-> overview hand-over, or null when the player is not mounted. */
export function playerPhase(): PlayerMode | null {
  return current ? current.mode : null
}

/** Presentation mode (src/ui/present): glide to the next shot, turning the mode on if it is off. Does nothing when the player is not mounted. */
export function presentGlide(): void {
  current?.presentGlide()
}

/** Presentation mode: cut to shot `i` (turning the mode on if it is off) on the next frame you walk. */
export function presentCut(i: number): void {
  current?.presentCut(i)
}

/** Presentation mode as the system sees it (for the probe and tests), or null when the player is not mounted. */
export function presentState(): { presenting: boolean; gliding: boolean; shot: number } | null {
  return current ? current.presentState : null
}
