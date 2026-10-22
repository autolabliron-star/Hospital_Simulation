import { describe, expect, it } from 'vitest'
import { patientInRoom } from '@/content/catalogue'
import { SURGERY_UI } from '@/content/surgeryUi'
import { levelOf } from '@/sim/levels'
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

describe('Go to… menu words (F-33): from content, in UK English', () => {
  it('takes the group titles and fixed rows from goTo.json, and says "centre" and "theatre"', () => {
    const groups = buildGoToGroups()
    expect(groups.map((g) => g.title)).toEqual(['Imaging', 'Blood & lab', SURGERY_UI.goTo.group, 'Ward A', 'Ward B', 'Pharmacy core', 'Emergency', 'Triage', 'Entrance', 'Atrium & café', 'Command centre', 'Nurse hubs'])
    const command = groups.find((g) => g.id === 'command')!
    expect(command.items).toEqual([{ area: 'command', label: 'Command centre', detail: 'Every pod, room and order, live' }])
    expect(flattenItems(groups).map((i) => `${i.label} ${i.detail}`).join(' ')).not.toMatch(/center|\bOR\b/)
    expect(flattenItems(filterGoToGroups(groups, 'command centre')).map((i) => i.area)).toContain('command')
    expect(flattenItems(filterGoToGroups(groups, 'theatre')).map((i) => i.area)).toContain('l2Or')
  })
})

describe('Go to… menu: Level 2 · Surgery (R2)', () => {
  const l2Map = AREAS.filter((a) => a.mapLabel && levelOf(a.rect.x0) === 2).map((a) => a.id)

  it('has a "Level 2 · Surgery" group, titled from the copy, with every level-2 area the map names, once', () => {
    const group = buildGoToGroups().find((g) => g.id === 'level2')!
    expect(group.title).toBe('Level 2 · Surgery')
    expect(group.title).toBe(SURGERY_UI.goTo.group)
    expect(l2Map).toEqual(['l2PreOp', 'l2Sterile', 'l2Or', 'l2Pacu', 'l2Lounge'])
    expect(group.items.map((i) => i.area)).toEqual(l2Map)
    expect(group.items.every((i) => i.label.length > 0 && i.detail.length > 0)).toBe(true)
  })

  it('names the robotic OR and recovery for what they are', () => {
    const items = buildGoToGroups().find((g) => g.id === 'level2')!.items
    expect(items.find((i) => i.area === 'l2Or')).toMatchObject({ label: 'Robotic theatre', detail: 'da Vinci 5 surgical system' })
    expect(items.find((i) => i.area === 'l2Pacu')!.label).toBe('Recovery')
  })

  it('lists no level-2 area anywhere else, and no ground-floor area in the group', () => {
    const groups = buildGoToGroups()
    for (const g of groups) {
      for (const i of g.items) expect(levelOf(AREAS.find((a) => a.id === i.area)!.rect.x0) === 2, `${g.id}/${i.area}`).toBe(g.id === 'level2')
    }
  })

  it('is part of "every area exactly once": every level-2 map area is a menu area, and the menu has no duplicates', () => {
    const areas = flattenItems(buildGoToGroups()).map((i) => i.area)
    expect(new Set(areas).size).toBe(areas.length)
    for (const id of l2Map) expect(menuAreaIds(), id).toContain(id)
    for (const id of menuAreaIds()) expect(areas, id).toContain(id)
  })

  it('is found by typing "surgery", "level 2" or "robotic", and by the room names', () => {
    const find = (q: string) => flattenItems(filterGoToGroups(buildGoToGroups(), q)).map((i) => i.area)
    expect(find('surgery')).toEqual(expect.arrayContaining(l2Map))
    expect(find('level 2')).toEqual(expect.arrayContaining(l2Map))
    expect(find('robotic')).toContain('l2Or')
    expect(find('recovery')).toContain('l2Pacu')
    expect(find('pre-op')).toContain('l2PreOp')
  })

  it('keeps the ground-floor groups and their order (Imaging, Blood & lab, then the new group, then the wards)', () => {
    const ids = buildGoToGroups().map((g) => g.id)
    expect(ids.slice(0, 4)).toEqual(['imaging', 'bloodLab', 'level2', 'wardA'])
  })
})

