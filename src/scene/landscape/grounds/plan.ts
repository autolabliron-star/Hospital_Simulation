/**
 * The site plan of the real-place exterior, as constants and tiny pure helpers (no three.js). Everything the building does not own:
 * the ground to the horizon, the entrance forecourt, the drop-off lay-by, the ring road, the car park, the neighbours.
 *
 * Coordinates are the sim's: metres, x east, z south, y up; the west façade is x = -62 and the entrance door is (-62, 0).
 *
 * Heights (layers a long way out are at least 1.2 cm apart; the two finest, the mown stripe and the paving slab over its bed at 4 and 6 mm,
 * only exist within about 60 m of the plaza, where the 24-bit depth buffer resolves 0.2 mm):
 *   BASE     the far meadow (a disc to the horizon)           -0.200
 *   LAWN     the mown campus lawn                              -0.170
 *   ASPHALT  roads and the car park                            -0.140   (kerb faces stand 12.8 cm above it)
 *   PAVING   the forecourt and the apron round the shell       -0.021 base, slabs at -0.015
 * The building's own floors are at 0, so the door threshold is a 1.5 cm step down, like a real one. The authored lobby's own paving
 * (tools/arch/shell.py `paving`, with `?building=model`) tops out at -0.010, 5 mm above the slabs here, so it simply wins where the two overlap.
 */
import { BUILDING, PLAYER_PLAZA } from '@/sim/places'

export const Y = {
  base: -0.2,
  lawn: -0.17,
  lawnStripe: -0.166,
  asphalt: -0.14,
  marking: -0.128,
  pavingBase: -0.021,
  slab: -0.015,
  pavingMark: -0.006,
} as const

export interface Box2 {
  x0: number
  x1: number
  z0: number
  z1: number
}

export const SITE = {
  /** The ground disc: centre and radius (m). The haze has swallowed it long before the rim. */
  disc: { cx: -40, cz: 0, r: 250 },
  /** West forecourt: paving from the façade to the kerb of the lay-by. */
  forecourt: { x0: -80.05, x1: -62, z0: -24.4, z1: 24.4 } as Box2,
  /** The apron round the shell: 2.4 m of paving on the north, south and east sides. */
  apronNorth: { x0: -62, x1: 42.4, z0: -24.4, z1: -22 } as Box2,
  apronSouth: { x0: -62, x1: 42.4, z0: 22, z1: 24.4 } as Box2,
  apronEast: { x0: 40, x1: 42.4, z0: -22, z1: 22 } as Box2,
  /** The drop-off lay-by (a widening of the ring road's west leg) and its kerb line. */
  layBy: { kerbX: -80.2, roadEdgeX: -83, taperZ: 18, endZ: 24 },
  /** The ring road: a rounded rectangle, 9 m wide, centreline below. */
  ring: { x0: -87.5, x1: 66, z0: -44, z1: 44, width: 9, corner: 14 },
  /** The car park west of the ring road (visible straight out of the entrance). */
  carPark: { x0: -132.5, x1: -99.5, z0: -53, z1: 53 } as Box2,
} as const

/** What no prop may stand in. */
export const KEEP_CLEAR = {
  /** The building: nothing of ours is above the ground inside it. */
  building: BUILDING as Box2,
  /** The ambulance bay (the layout's pad, its ambulance and its canopy). */
  ambulanceBay: { x0: -76.2, x1: -61.8, z0: 6.2, z1: 21.8 } as Box2,
  /** From the entrance door west across the plaza to its edge (the player's fences), the way people and you walk. */
  entranceWalk: { x0: PLAYER_PLAZA.x0, x1: -62, z0: -2.2, z1: 2.2 } as Box2,
} as const

/** The plaza the player walks on (its west, north and south edges are fences in the collision). */
export const PLAZA: Box2 = PLAYER_PLAZA

export const overlaps = (a: Box2, b: Box2): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0

export const inside = (b: Box2, x: number, z: number): boolean => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1

export const grow = (b: Box2, m: number): Box2 => ({ x0: b.x0 - m, x1: b.x1 + m, z0: b.z0 - m, z1: b.z1 + m })
