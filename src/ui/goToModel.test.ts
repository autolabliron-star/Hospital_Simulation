import { describe, expect, it } from 'vitest'
import { patientInRoom } from '@/content/catalogue'
import type { RoomId, RoomStatus } from '@/sim/types'
import { buildGoToGroups } from './goToModel'

function wardDetail(groups: ReturnType<typeof buildGoToGroups>, room: string): string | undefined {
  for (const g of groups) for (const i of g.items) if (i.area === `room:${room}`) return i.detail
  return undefined
}

describe('Go to… menu model', () => {
  it('names ward rooms after the static roster when there is no live bed board', () => {
    expect(wardDetail(buildGoToGroups(), 'A1')).toBe(patientInRoom('A1').name)
  })

  it('names ward rooms after the live occupant, and labels an empty bed by its state', () => {
    const rooms = new Map<RoomId, RoomStatus>([
      ['A1', { roomId: 'A1', bed: 'occupied', patientId: 'er-7', patientName: 'Leo Park', since: 0, meal: 'none', recline: 0, version: 1 }],
      ['A2', { roomId: 'A2', bed: 'ready', patientId: null, patientName: null, since: 0, meal: 'none', recline: 0, version: 1 }],
    ])
    const groups = buildGoToGroups(rooms)
    expect(wardDetail(groups, 'A1')).toBe('Leo Park')
    const empty = wardDetail(groups, 'A2')
    expect(empty).toBeTruthy()
    expect(empty).not.toBe(patientInRoom('A2').name)
  })
})
