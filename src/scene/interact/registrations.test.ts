import { beforeEach, describe, expect, it } from 'vitest'
import { useInteract, labelOf, type Interactable } from '@/scene/interact.store'
import { isWalkable } from '@/sim/nav/layout'
import { COMMAND_WALL, IMAGING, LIFTS, LOBBY, ROOMS, areaAt, roomById } from '@/sim/places'
import type { WalkActions } from './actions'
import type { LiftHost } from './lift'
import { REGISTRATION_RADIUS, bedsidePoint, buildWalkInteractables, commandPoints, drawerPoint, registerWalkInteractables, type RegSim } from './registrations'
import { PRIORITY, priorityOf } from './picker'

/** Who lies where: A3 has Grace, A4 is an empty bed. */
function fakeSim(): RegSim {
  const patients = new Map([['A3', { id: 'p-a3', name: 'Grace Adeyemi' }]])
  return { meds: { occupant: (id) => patients.get(id) ?? null } }
}

function fakeActions() {
  const calls: string[] = []
  const actions: WalkActions = {
    openRx: (r) => calls.push(`rx:${r}`),
    openPanel: (a) => calls.push(`panel:${a}`),
    openDrawer: (r) => calls.push(`drawer:${r}`),
    toast: (t) => calls.push(`toast:${t}`),
  }
  return { calls, actions }
}

/** The lift prompts' ride, recorded in `calls` too. */
function fakeLift(calls: string[]): LiftHost {
  return { ride: (shaft, from) => calls.push(`ride:${shaft}:${from}`), busy: () => false }
}

function build() {
  const { calls, actions } = fakeActions()
  const items = buildWalkInteractables({ sim: fakeSim, actions, lift: fakeLift(calls) })
  const byId = new Map(items.map((i) => [i.id, i]))
  return { calls, items, byId }
}

const get = (byId: Map<string, Interactable>, id: string): Interactable => {
  const i = byId.get(id)
  if (!i) throw new Error(`no interactable ${id}`)
  return i
}

describe('what is registered', () => {
  const { items, byId } = build()

  it('has a bedside and a drawer for each ward room, a console per scanner, the command wall, the kiosks and the lifts', () => {
    expect(ROOMS.length).toBe(16)
    for (const r of ROOMS) {
      expect(byId.has(`bedside:${r.id}`), r.id).toBe(true)
      expect(byId.has(`drawer:${r.id}`), r.id).toBe(true)
    }
    for (const m of ['mri', 'ct', 'xray', 'us']) expect(byId.has(`console:${m}`), m).toBe(true)
    expect(items.filter((i) => i.id.startsWith('command:')).length).toBe(commandPoints().length)
    expect(items.filter((i) => i.id.startsWith('kiosk:')).length).toBe(LOBBY.kiosks.length)
    // R2: the four lift lobbies (shaft A and B, level 1 and level 2)
    expect(['lift:A', 'lift:B', 'lift:A:2', 'lift:B:2'].every((id) => byId.has(id))).toBe(true)
    expect(items.length).toBe(16 * 2 + 4 + commandPoints().length + LOBBY.kiosks.length + 4)
  })

  it('has unique ids and the contract kinds and priorities', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    expect(get(byId, 'bedside:A3').kind).toBe('bedside')
    expect(get(byId, 'drawer:A3').kind).toBe('drawer')
    expect(get(byId, 'console:mri').kind).toBe('console')
    for (const i of items) expect(priorityOf(i.kind, i.priority), i.id).toBe(PRIORITY[i.kind])
    for (const i of items) expect(priorityOf(i.kind, i.priority), `${i.id} outranks people and seats`).toBeLessThan(PRIORITY.seat)
  })

  it('puts each prompt where the thing is', () => {
    for (const r of ROOMS) {
      const bed = get(byId, `bedside:${r.id}`).position
      expect(areaAt(bed.x, bed.z)?.id, `bedside ${r.id}`).toBe(`room:${r.id}`)
      const drawer = get(byId, `drawer:${r.id}`).position
      expect(areaAt(drawer.x, drawer.z)?.id, `drawer ${r.id}`).toBe(r.ward === 'A' ? 'corridorA' : 'corridorB')
    }
    for (const m of ['mri', 'ct', 'xray', 'us'] as const) {
      const p = get(byId, `console:${m}`).position
      expect(areaAt(p.x, p.z)?.id, m).toBe(IMAGING[m].controlArea)
    }
    for (const p of commandPoints()) {
      expect(areaAt(p.x, p.z)?.id).toBe('command')
      expect(p.x).toBeGreaterThan(COMMAND_WALL.x)
      expect(p.z).toBeGreaterThan(COMMAND_WALL.z0)
      expect(p.z).toBeLessThan(COMMAND_WALL.z1)
    }
    for (const k of LOBBY.kiosks) expect(areaAt(k.x, k.z)?.id).toBe('lobby')
    expect(areaAt(get(byId, 'lift:A').position.x, get(byId, 'lift:A').position.z)?.id).toBe('liftA')
    expect(areaAt(get(byId, 'lift:B').position.x, get(byId, 'lift:B').position.z)?.id).toBe('liftB')
    expect(areaAt(get(byId, 'lift:A:2').position.x, get(byId, 'lift:A:2').position.z)?.id).toBe(LIFTS.A[2].area)
    expect(areaAt(get(byId, 'lift:B:2').position.x, get(byId, 'lift:B:2').position.z)?.id).toBe(LIFTS.B[2].area)
  })

  it('can be reached: somewhere within reach of every prompt is ground you can stand on', () => {
    const missing: string[] = []
    for (const i of items) {
      const radius = (i.radius ?? 2) * 0.9
      let found = false
      for (let dx = -radius; dx <= radius && !found; dx += 0.2) {
        for (let dz = -radius; dz <= radius && !found; dz += 0.2) {
          if (Math.hypot(dx, dz) <= radius && isWalkable(i.position.x + dx, i.position.z + dz, 0.3)) found = true
        }
      }
      if (!found) missing.push(i.id)
    }
    expect(missing).toEqual([])
  })
})

describe('the bedside', () => {
  it('says who you would prescribe for, and what it does is open the tablet on that room', () => {
    const { byId, calls } = build()
    const bed = get(byId, 'bedside:A3')
    expect(bed.enabled!()).toBe(true)
    expect(labelOf(bed, false)).toBe('Tablet for Grace Adeyemi')
    bed.onInteract()
    expect(calls).toEqual(['rx:A3'])
  })

  it('is locked, and says why, when nobody lies in the bed', () => {
    const { byId } = build()
    const bed = get(byId, 'bedside:A4')
    expect(bed.enabled!()).toBe(false)
    expect(labelOf(bed, true)).toBe('A4 has no patient right now')
  })

  it('follows the bed board: a patient who arrives is picked up without re-registering', () => {
    const patients = new Map<string, { id: string; name: string }>()
    const sim: RegSim = { meds: { occupant: (id) => patients.get(id) ?? null } }
    const items = buildWalkInteractables({ sim: () => sim, actions: fakeActions().actions })
    const bed = items.find((i) => i.id === 'bedside:B6')!
    expect(bed.enabled!()).toBe(false)
    patients.set('B6', { id: 'p', name: 'Tomás Rivera' })
    expect(bed.enabled!()).toBe(true)
    expect(labelOf(bed, false)).toBe('Tablet for Tomás Rivera')
  })

  it('is measured from the bed, a short step inside the door', () => {
    const r = roomById('A3')
    const p = bedsidePoint(r)
    expect(p).toEqual({ x: r.bed.x, y: 0, z: r.bed.z })
    // from just inside the door the bed is a step or two away
    expect(Math.hypot(p.x - r.doorInside.x, p.z - r.doorInside.z)).toBeLessThan(REGISTRATION_RADIUS.bedside + 0.5)
  })
})

describe('the other places', () => {
  it('a drawer opens its card, a console opens its room panel, the command wall opens the command center', () => {
    const { byId, calls } = build()
    get(byId, 'drawer:B6').onInteract()
    get(byId, 'console:mri').onInteract()
    get(byId, 'console:xray').onInteract()
    get(byId, 'command:2').onInteract()
    expect(calls).toEqual(['drawer:B6', 'panel:mriControl', 'panel:xray', 'panel:command'])
    expect(labelOf(get(byId, 'drawer:B6'), false)).toBe("See what is in B6's drawer")
    expect(labelOf(get(byId, 'console:mri'), false)).toBe('Open the MRI console')
    expect(labelOf(get(byId, 'console:us'), false)).toBe('Open the ultrasound console')
  })

  it('a kiosk only shows a short message, and a lift takes you to the other level (R2: lift.test.ts has the lobbies)', () => {
    const { byId, calls } = build()
    get(byId, 'kiosk:0').onInteract()
    get(byId, 'lift:A').onInteract()
    get(byId, 'lift:B:2').onInteract()
    expect(calls.length).toBe(3)
    expect(calls[0].startsWith('toast:')).toBe(true)
    expect(calls.slice(1)).toEqual(['ride:A:1', 'ride:B:2'])
    expect(labelOf(get(byId, 'lift:A'), false)).toBe('Take the lift to Level 2 · Surgery')
    expect(labelOf(get(byId, 'lift:A:2'), false)).toBe('Take the lift to Level 1')
  })

  it('measures the drawer from the corridor side of its wall', () => {
    for (const r of ROOMS) {
      const p = drawerPoint(r)
      const corridorCentre = r.doorOutside.z
      // between the wall point and the corridor centre line
      expect(Math.abs(p.z - corridorCentre)).toBeLessThan(Math.abs(r.drawer.z - corridorCentre))
      expect(p.x).toBe(r.drawer.x)
    }
  })
})

describe('registering in the registry', () => {
  beforeEach(() => {
    useInteract.setState({ items: new Map() })
  })

  it('puts every item in the registry and takes them all out again', () => {
    const undo = registerWalkInteractables({ sim: fakeSim, actions: fakeActions().actions })
    const n = useInteract.getState().items.size
    expect(n).toBeGreaterThan(40)
    expect(useInteract.getState().items.has('bedside:A3')).toBe(true)
    undo()
    expect(useInteract.getState().items.size).toBe(0)
  })
})
