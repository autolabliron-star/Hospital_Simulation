/**
 * Corridor night lights (L1): low, warm floor-level strips along the inner wall of both ward corridors and along both edges of the
 * main corridor (the spine), the way a ward looks at night. They are plain emissive geometry (no real lights): one merged mesh, one
 * draw call, hidden (not drawn at all) by day and dimmed to a level by `lightAt(hour).nightLights`.
 * The spots avoid every doorway in the corridor's inner wall, so no strip lies in a door. (W2: the pods ride a ceiling rail, so
 * there are no robot lanes or crossing zones on the floor any more.)
 */
import { BoxGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BANDS, DOORS, areaById } from '@/sim/places'
import type { WardId } from '@/sim/types'

export interface NightLightSpot {
  x: number
  z: number
  /** The strip runs along x (in the ward corridors) or along z (in the spine). */
  alongX: boolean
}

export const NIGHT_LIGHT = { length: 0.6, width: 0.12, height: 0.012, pitch: 3.0, y: 0.02 } as const

/** Distance from the inner wall's face to the middle of a strip. */
const FROM_INNER_WALL = 0.2

/** Clear of every door in the inner wall of that corridor (|z| = BANDS.innerWall). */
function clearOfInnerDoors(x: number, sign: number): boolean {
  const half = NIGHT_LIGHT.length / 2 + 0.3
  return DOORS.every((d) => d.wallAxis !== 'x' || Math.abs(d.center.z - sign * BANDS.innerWall) > 0.01 || Math.abs(x - d.center.x) > d.width / 2 + half)
}

export function nightLightSpots(): NightLightSpot[] {
  const spots: NightLightSpot[] = []
  for (const w of ['A', 'B'] as WardId[]) {
    const sign = w === 'A' ? -1 : 1
    const z = sign * (BANDS.innerWall + 0.1 + FROM_INNER_WALL)
    for (let x = -37.5; x <= 37.5; x += NIGHT_LIGHT.pitch) {
      if (clearOfInnerDoors(x, sign)) spots.push({ x, z, alongX: true })
    }
  }
  // the spine: both edges, between the two lift lobbies
  const spine = areaById('spine').rect
  for (let z = -13.5; z <= 13.5; z += NIGHT_LIGHT.pitch) {
    for (const x of [spine.x0 + 0.25, spine.x1 - 0.25]) spots.push({ x, z, alongX: false })
  }
  return spots
}

/** All strips merged into one geometry. */
export function nightLightsGeometry(): BufferGeometry {
  const parts = nightLightSpots().map((s) => {
    const g = s.alongX ? new BoxGeometry(NIGHT_LIGHT.length, NIGHT_LIGHT.height, NIGHT_LIGHT.width) : new BoxGeometry(NIGHT_LIGHT.width, NIGHT_LIGHT.height, NIGHT_LIGHT.length)
    return g.translate(s.x, NIGHT_LIGHT.y, s.z)
  })
  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error('night lights: could not merge')
  return merged
}
