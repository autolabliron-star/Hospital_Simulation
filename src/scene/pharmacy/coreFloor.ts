/**
 * The procedural core floor and the authored core zone: `CoreStatic`'s floor plane (y = 0) z-fights with the authored terrazzo of the `core`
 * zone, so it is hidden while that zone's model is drawn. The flag is the zone's cell (building/model/cells.ts): flipped once, in the call that
 * mounts the zone, and never per frame. A zone that fails to load never flips it, so the procedural floor stays.
 */
import type { Object3D } from 'three'
import { registerCellObjects } from '@/scene/building/model/cells'

/** The zone (tools/arch/zones.json) whose authored floor replaces the procedural one. */
export const CORE_ZONE = 'core'

/** Tie the floor mesh to the core zone's drawn state (it takes the current state at once). Returns the function that unties it. */
export const bindCoreFloor = (floor: Object3D): (() => void) => registerCellObjects(CORE_ZONE, [floor])
