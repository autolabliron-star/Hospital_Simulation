import { beforeEach, describe, expect, it } from 'vitest'
import { ROOMS } from '@/sim/places'
import { RECLINE_MAX, clearReclineShown, reclineAngle, reclineOfEntity, reclineShown, roomIndex, setReclineShown } from './bedPose'

describe('bed recline registry', () => {
  beforeEach(() => clearReclineShown())

  it('nothing drives it by default: the seat pose decides (recline = fully raised, anything else flat)', () => {
    expect(reclineShown('A3')).toBe(-1)
    expect(reclineOfEntity({ seated: { seatId: 'bed:A3', pose: 'recline' } })).toBe(1)
    expect(reclineOfEntity({ seated: { seatId: 'bed:A3', pose: 'lie' } })).toBe(0)
    expect(reclineOfEntity({})).toBe(0)
    expect(reclineOfEntity({ seated: { seatId: 'waiting:lobby:1', pose: 'sit' } })).toBe(0)
  })

  it('a patient in a bed follows the backrest that is drawn, even once the pose has gone back to lie', () => {
    setReclineShown(roomIndex('B2'), 0.4)
    expect(reclineShown('B2')).toBeCloseTo(0.4)
    expect(reclineOfEntity({ seated: { seatId: 'bed:B2', pose: 'recline' } })).toBeCloseTo(0.4)
    expect(reclineOfEntity({ seated: { seatId: 'bed:B2', pose: 'lie' } })).toBeCloseTo(0.4)
    // other rooms are untouched, and so are ER trolleys and chairs
    expect(reclineOfEntity({ seated: { seatId: 'bed:B3', pose: 'recline' } })).toBe(1)
    expect(reclineOfEntity({ seated: { seatId: 'bay:er1', pose: 'lie' } })).toBe(0)
  })

  it('has a slot for every ward room, and forgets everything when cleared', () => {
    for (const r of ROOMS) expect(roomIndex(r.id)).toBeGreaterThanOrEqual(0)
    expect(roomIndex('Z9')).toBe(-1)
    setReclineShown(0, 1)
    clearReclineShown()
    expect(reclineShown(ROOMS[0].id)).toBe(-1)
    setReclineShown(99, 1) // out of range: ignored
  })

  it('the angle is 45 degrees at full recline, clamped', () => {
    expect(RECLINE_MAX).toBeCloseTo(Math.PI / 4)
    expect(reclineAngle(1)).toBeCloseTo(RECLINE_MAX)
    expect(reclineAngle(0.5)).toBeCloseTo(RECLINE_MAX / 2)
    expect(reclineAngle(-1)).toBe(0)
    expect(reclineAngle(3)).toBeCloseTo(RECLINE_MAX)
  })
})
