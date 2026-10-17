import { describe, expect, it } from 'vitest'
import { BANDS, CORRIDOR_CENTER, DOORS, HANDOVER, MEALBOT_SIZE, MEAL_STOPS, ROOMS, STAFF_ROOM, areaAt } from './places'

describe('L1 places', () => {
  it('meal stops keep the parked bot out of every doorway and off the walking line (no lane band or crossing zone any more)', () => {
    expect(MEAL_STOPS).toHaveLength(8)
    for (const stop of MEAL_STOPS) {
      // the bot parks heading east: length along x, width along z
      const box = { x0: stop.at.x - MEALBOT_SIZE.l / 2, x1: stop.at.x + MEALBOT_SIZE.l / 2, z0: Math.abs(stop.at.z) - MEALBOT_SIZE.w / 2, z1: Math.abs(stop.at.z) + MEALBOT_SIZE.w / 2 }
      for (const d of DOORS) {
        if (d.kind === 'opening') continue
        // the doorway: the opening along the wall, 0.35 m deep either side of it (|z| for the ward corridors, as the box is)
        const half = d.width / 2
        const r =
          d.wallAxis === 'x'
            ? { x0: d.center.x - half, x1: d.center.x + half, z0: Math.abs(d.center.z) - 0.35, z1: Math.abs(d.center.z) + 0.35 }
            : { x0: d.center.x - 0.35, x1: d.center.x + 0.35, z0: Math.abs(d.center.z) - half, z1: Math.abs(d.center.z) + half }
        const overlap = box.x0 < r.x1 && r.x0 < box.x1 && box.z0 < r.z1 && r.z0 < box.z1
        expect(overlap, `${stop.id} overlaps the doorway ${d.id}`).toBe(false)
      }
      // on the room side of the walking line, inside the corridor (and clear of the room wall)
      expect(box.z0).toBeGreaterThan(CORRIDOR_CENTER)
      expect(box.z1).toBeLessThan(BANDS.roomWall)
      expect(areaAt(stop.at.x, stop.at.z)?.id).toBe(stop.ward === 'A' ? 'corridorA' : 'corridorB')
    }
  })

  it('handover spots are inside their own room', () => {
    for (const r of ROOMS) for (const s of HANDOVER[r.id]) expect(areaAt(s.at.x, s.at.z)?.id).toBe(`room:${r.id}`)
  })

  it('lockers are in the staff room', () => {
    for (const s of STAFF_ROOM.lockers) expect(areaAt(s.at.x, s.at.z)?.id).toBe('staffA')
  })
})
