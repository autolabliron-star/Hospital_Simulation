import { describe, expect, it } from 'vitest'
import { SURGERY_UI } from '@/content/surgeryUi'
import { labelOf } from '@/scene/interact.store'
import { levelOf, type LevelId } from '@/sim/levels'
import { isWalkable } from '@/sim/nav/layout'
import { LIFTS, areaAt, type ShaftId } from '@/sim/places'
import { LIFT_RADIUS, buildLiftInteractables, liftId, liftLabel, type LiftHost } from './lift'
import { PRIORITY, priorityOf } from './picker'
import { REGISTRATION_RADIUS, buildWalkInteractables, type RegSim } from './registrations'
import type { WalkActions } from './actions'

function fakeHost() {
  const rides: [ShaftId, LevelId][] = []
  let busy = false
  const host: LiftHost = { ride: (s, f) => void rides.push([s, f]), busy: () => busy }
  return { host, rides, setBusy: (b: boolean) => void (busy = b) }
}

describe('the lift prompts', () => {
  const { host } = fakeHost()
  const items = buildLiftInteractables(host)
  const byId = new Map(items.map((i) => [i.id, i]))

  it('are four: shaft A and B on level 1 (the old ids) and level 2', () => {
    expect(items.map((i) => i.id).sort()).toEqual(['lift:A', 'lift:A:2', 'lift:B', 'lift:B:2'])
    expect(liftId('A', 1)).toBe('lift:A')
    expect(liftId('B', 2)).toBe('lift:B:2')
    expect(new Set(items.map((i) => i.id)).size).toBe(4)
  })

  it('stand in their own lobby, at the stretcher spot, in sim coordinates of the right level', () => {
    for (const shaft of ['A', 'B'] as const) {
      for (const level of [1, 2] as const) {
        const item = byId.get(liftId(shaft, level))!
        const lobby = LIFTS[shaft][level]
        expect(item.position, `${shaft}${level}`).toEqual({ x: lobby.stretcher.at.x, y: 0, z: lobby.stretcher.at.z })
        expect(levelOf(item.position.x), `${shaft}${level}`).toBe(level)
        expect(areaAt(item.position.x, item.position.z)?.id, `${shaft}${level}`).toBe(lobby.area)
        expect(isWalkable(item.position.x, item.position.z, 0.3), `${shaft}${level}`).toBe(true)
      }
    }
  })

  it('are doors with the old reach, ahead of people and seats', () => {
    for (const i of items) {
      expect(i.kind).toBe('door')
      expect(i.radius).toBe(LIFT_RADIUS)
      expect(priorityOf(i.kind, i.priority)).toBe(PRIORITY.door)
      expect(priorityOf(i.kind, i.priority)).toBeLessThan(PRIORITY.seat)
    }
    expect(REGISTRATION_RADIUS.lift).toBe(LIFT_RADIUS)
  })

  it('say where the lift goes: to Level 2 · Surgery from level 1, to Level 1 from level 2', () => {
    expect(labelOf(byId.get('lift:A')!, false)).toBe('Take the lift to Level 2 · Surgery')
    expect(labelOf(byId.get('lift:B')!, false)).toBe('Take the lift to Level 2 · Surgery')
    expect(labelOf(byId.get('lift:A:2')!, false)).toBe('Take the lift to Level 1')
    expect(labelOf(byId.get('lift:B:2')!, false)).toBe('Take the lift to Level 1')
    expect(liftLabel(1)).toBe(SURGERY_UI.lift.toTwo)
    expect(liftLabel(2)).toBe(SURGERY_UI.lift.toOne)
  })

  it('E starts the ride from that lobby: which shaft, and the level you are leaving', () => {
    const f = fakeHost()
    const built = buildLiftInteractables(f.host)
    const get = (id: string) => built.find((i) => i.id === id)!
    get('lift:A').onInteract()
    get('lift:B:2').onInteract()
    get('lift:B').onInteract()
    get('lift:A:2').onInteract()
    expect(f.rides).toEqual([['A', 1], ['B', 2], ['B', 1], ['A', 2]])
  })

  it('are locked while a ride runs, and say the same words (a second E starts nothing)', () => {
    const f = fakeHost()
    const built = buildLiftInteractables(f.host)
    const item = built.find((i) => i.id === 'lift:A')!
    expect(item.enabled!()).toBe(true)
    f.setBusy(true)
    expect(item.enabled!()).toBe(false)
    expect(labelOf(item, true)).toBe('Take the lift to Level 2 · Surgery')
    f.setBusy(false)
    expect(item.enabled!()).toBe(true)
  })

  it('no longer toast that the wards upstairs are closed', () => {
    const toasts: string[] = []
    const actions: WalkActions = { openRx: () => undefined, openPanel: () => undefined, openDrawer: () => undefined, toast: (t) => void toasts.push(t) }
    const sim: RegSim = { meds: { occupant: () => null } }
    const f = fakeHost()
    const all = buildWalkInteractables({ sim: () => sim, actions, lift: f.host })
    for (const i of all.filter((x) => x.id.startsWith('lift:'))) i.onInteract()
    expect(toasts).toEqual([])
    expect(f.rides.length).toBe(4)
  })
})
