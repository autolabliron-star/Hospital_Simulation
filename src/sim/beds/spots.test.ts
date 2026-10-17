import { describe, expect, it } from 'vitest'
import { inDoorway } from '../er/spots'
import { isWalkable } from '../nav/layout'
import { areaAt, ROOMS } from '../places'
import { bathroomSpot, bedsideSpot, chairSpot, familyFallbackSpot, linenSpot, porterSpot } from './spots'

const CLEAR = 0.3

describe('bed-flow spots inside a ward room', () => {
  for (const room of ROOMS) {
    it(`${room.id}: every spot is inside the room, on walkable ground, and out of the doorway`, () => {
      const spots = {
        bedside: bedsideSpot(room.id).at,
        porter: porterSpot(room.id).at,
        linen: linenSpot(room.id).at,
        chair: chairSpot(room.id),
        bathroom: bathroomSpot(room.id).at,
        family: familyFallbackSpot(room.id),
      }
      for (const [name, p] of Object.entries(spots)) {
        expect(areaAt(p.x, p.z)?.id, `${name} area`).toBe(`room:${room.id}`)
        expect(isWalkable(p.x, p.z, CLEAR), `${name} walkable`).toBe(true)
        expect(inDoorway(p.x, p.z), `${name} doorway`).toBe(false)
      }
    })
  }

  it('a stretcher or wheelchair at the porter spot lies along the bed, not on it', () => {
    for (const room of ROOMS) {
      const s = porterSpot(room.id)
      const ahead = { x: s.at.x + Math.sin(s.heading) * 1.45, z: s.at.z + Math.cos(s.heading) * 1.45 }
      // the stretcher centre is a little west of the bed centre, level with it, so the patient slides sideways onto the bed
      expect(Math.abs(ahead.z - room.bed.z)).toBeLessThan(0.3)
      expect(room.bed.x - ahead.x).toBeGreaterThan(0.8)
      expect(room.bed.x - ahead.x).toBeLessThan(1.2)
    }
  })
})
