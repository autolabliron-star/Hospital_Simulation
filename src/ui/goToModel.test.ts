import { describe, expect, it } from 'vitest'
import { patientInRoom } from '@/content/catalogue'
import type { RoomId, RoomStatus } from '@/sim/types'
import { AREAS } from '@/sim/places'
import { buildGoToGroups, filterGoToGroups, flattenItems, menuAreaIds } from './goToModel'

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

  it('has a "Blood & lab" group with the blood draw centre and the lab, and keeps them out of Imaging', () => {
    const groups = buildGoToGroups()
    const blood = groups.find((g) => g.id === 'bloodLab')!
    expect(blood.title).toBe('Blood & lab')
    expect(blood.items.map((i) => i.area)).toEqual(['diagnostics', 'lab'])
    expect(blood.items.map((i) => i.label)).toEqual(['Blood draw centre', 'Lab'])
    expect(blood.items.every((i) => i.detail.length > 0)).toBe(true)
    const imaging = groups.find((g) => g.id === 'imaging')!
    expect(imaging.items.map((i) => i.area)).not.toContain('diagnostics')
    expect(imaging.items.map((i) => i.area)).toEqual(['mri', 'ct', 'xray', 'ultrasound', 'imagingHall'])
    // it sits right after Imaging
    expect(groups.findIndex((g) => g.id === 'bloodLab')).toBe(groups.findIndex((g) => g.id === 'imaging') + 1)
  })

  it('lists every area that is on the minimap or a patient room exactly once (the lab included)', () => {
    const items = flattenItems(buildGoToGroups())
    const areas = items.map((i) => i.area)
    expect(new Set(areas).size).toBe(areas.length)
    for (const id of menuAreaIds()) expect(areas, id).toContain(id)
    expect(menuAreaIds()).toContain('lab')
    expect(AREAS.find((a) => a.id === 'lab')!.mapLabel).toBe(true)
  })

  it('finds the lab by typing "lab", and the draw centre by "blood"', () => {
    expect(flattenItems(filterGoToGroups(buildGoToGroups(), 'lab')).map((i) => i.area)).toContain('lab')
    const blood = flattenItems(filterGoToGroups(buildGoToGroups(), 'blood')).map((i) => i.area)
    expect(blood).toContain('diagnostics')
  })
})
