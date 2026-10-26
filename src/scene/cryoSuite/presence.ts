/** R4: is somebody looking at the cryoablation suite (the presenter's focus on it, or you on level 2 inside it)? The screens repaint faster then. */
import type { AreaId } from '@/sim/places'
import { areaById } from '@/sim/places'

const SUITE = { x0: areaById('l2CryoControl').rect.x0, x1: areaById('l2Cryo').rect.x1, z0: areaById('l2CryoControl').rect.z0, z1: areaById('l2Cryo').rect.z1 }

export interface Here {
  x: number
  z: number
}

export function playerInSuite(p: Here | null): boolean {
  return p !== null && p.x > SUITE.x0 && p.x < SUITE.x1 && p.z > SUITE.z0 && p.z < SUITE.z1
}

/** `shown` is `levelView.shown`. */
export function lookingAtSuite(focus: AreaId | null, player: Here | null, shown: 1 | 2): boolean {
  return focus === 'l2Cryo' || focus === 'l2CryoControl' || (shown === 2 && playerInSuite(player))
}
