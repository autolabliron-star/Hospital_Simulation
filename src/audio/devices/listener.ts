/**
 * Where the device sounds are heard from (pure): you, while you walk (ears at head height), or the middle of the room the overview camera has flown
 * into; nobody otherwise (the whole-hospital overview is silent, like the scanners and the ambience). Written into `out`, so the engine's 20 Hz
 * tick allocates nothing for it.
 *
 * R2, two levels: every sound source is in SIM coordinates (level 2 lies in its own strip of the flat sim, x 88..110, with y floor-relative on both levels), so the
 * listener is in sim coordinates too: your body (`sim.player`, which the player system keeps in the sim) or the middle of the focused room's sim rectangle. Never the
 * three.js camera: that one is DRAWN, 150 m west and 4.2 m up on level 2, and a listener there would hear level 1's machines through the floor. The two levels are 48 m
 * apart in the sim at the nearest (the engine's reach, `FAR`, is 16 m), so each level hears only itself.
 */
import { areaById, type AreaId } from '@/sim/places'
import type { PlayerMode, Vec3 } from '@/sim/types'

export interface ListenerPlayer {
  x: number
  z: number
  mode: PlayerMode
}

/** Ear height of a standing doctor, and a camera hovering over a focused room. */
export const EAR_Y = 1.6
export const ROOM_Y = 1.5

export function listenerAt(player: ListenerPlayer | null, focus: AreaId | null, out: Vec3): Vec3 | null {
  if (player && (player.mode === 'walk' || player.mode === 'toWalk')) {
    out.x = player.x
    out.y = EAR_Y
    out.z = player.z
    return out
  }
  if (focus) {
    const r = areaById(focus).rect
    out.x = (r.x0 + r.x1) / 2
    out.y = ROOM_Y
    out.z = (r.z0 + r.z1) / 2
    return out
  }
  return null
}
