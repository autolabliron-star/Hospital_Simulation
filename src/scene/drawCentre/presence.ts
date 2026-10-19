/**
 * Is anybody "in" the draw centre? The presenter has focused the room (the room panel is open on `diagnostics`), or you, walking, stand inside
 * its walls. Then the robots' screens repaint at 10 Hz and the queue call is spoken; elsewhere they idle at 2 Hz and stay silent. Pure, and it
 * allocates nothing, so the per-frame layer and the 4 Hz announcer can both call it.
 */
import { areaById, type AreaId } from '@/sim/places'

const R = areaById('diagnostics').rect

/** The part of the player the check reads (`sim.player`, or null before it exists). */
export interface Here {
  x: number
  z: number
}

export function playerInDrawCentre(p: Here | null): boolean {
  return p !== null && p.x > R.x0 && p.x < R.x1 && p.z > R.z0 && p.z < R.z1
}

export function inDrawCentre(focus: AreaId | null, player: Here | null): boolean {
  return focus === 'diagnostics' || playerInDrawCentre(player)
}
