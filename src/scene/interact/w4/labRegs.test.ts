import { describe, expect, it } from 'vitest'
import { labelOf } from '@/scene/interact.store'
import { LAB_UI } from '@/content/labUi'
import { LAB } from '@/sim/places'
import type { AreaId } from '@/sim/places'
import type { WalkActions } from '../actions'
import { buildLabInteractables, LAB_REGISTRATION_RADIUS } from './labRegs'

function host() {
  const opened: AreaId[] = []
  const actions: WalkActions = { openRx: () => {}, openPanel: (a) => void opened.push(a), openDrawer: () => {}, toast: () => {} }
  return { opened, host: { sim: () => ({ meds: { occupant: () => null } }), actions } }
}

describe('the lab interactions', () => {
  it('has a viewpoint in the corridor and a totem in the lab, each a station with its own prompt', () => {
    const { host: h } = host()
    const items = buildLabInteractables(h)
    expect(items.map((i) => i.id)).toEqual(['lab:viewpoint', 'lab:totem'])
    const [view, totem] = items
    expect(view.position).toEqual({ x: LAB.viewpoint.x, y: 0, z: LAB.viewpoint.z })
    expect(totem.position).toEqual({ x: LAB.statusTotem.x, y: 0, z: LAB.statusTotem.z })
    expect(labelOf(view, false)).toBe(LAB_UI.prompt.viewpoint)
    expect(labelOf(totem, false)).toBe(LAB_UI.prompt.totem)
    for (const i of items) expect(i.kind).toBe('station')
    expect(view.radius).toBe(LAB_REGISTRATION_RADIUS.viewpoint)
  })

  it('both open the lab panel, with no camera flight (the walk-mode action)', () => {
    const { host: h, opened } = host()
    for (const i of buildLabInteractables(h)) i.onInteract()
    expect(opened).toEqual(['lab', 'lab'])
  })

  it('puts the viewpoint in corridor B, 0.6 m off the lab\'s glass front, and the totem inside', () => {
    expect(LAB.viewpoint.z).toBeLessThan(16)
    expect(LAB.viewpoint.z).toBeGreaterThan(14.5)
    expect(LAB.statusTotem.z).toBeGreaterThan(16)
    expect(LAB.statusTotem.z).toBeLessThan(17)
  })
})
