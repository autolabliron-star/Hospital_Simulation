/**
 * The two halves of the building that swap when you press Tab (W1): the architect's cut (overview only: the parked sliding leaves of
 * the patient rooms) and the walk-mode building (upper walls, ceilings, signs, door leaves). A tiny registry between the two
 * components, so neither imports the other. Switching is `visible` only: nothing is rebuilt, nothing recompiles.
 */
import type { Object3D } from 'three'

export const modeSwitch: { overview: Object3D | null; walk: Object3D | null } = { overview: null, walk: null }

/** Walk geometry shows whenever the mode is not 'overview' (the flights between the two included). No player yet: the overview. */
export function isWalkMode(mode: string | undefined): boolean {
  return mode !== undefined && mode !== 'overview'
}
