/**
 * R4: the cryo suite's E interactions in node: two stations (the control room's glass, recovery outside the scan room's door), each opening the
 * suite's panel with the copy's prompt, on walkable floor of the right room, and registered with the rest.
 */
import { describe, expect, it } from 'vitest'
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import { labelOf, useInteract } from '@/scene/interact.store'
import { isWalkable } from '@/sim/nav/layout'
import { CRYO_SUITE, areaAt, type AreaId } from '@/sim/places'
import type { WalkActions } from '../actions'
import { registerWalkInteractables } from '../registrations'
import { cryoSuiteRegs } from './cryoRegs'

function host() {
  const opened: AreaId[] = []
  const actions: WalkActions = { openRx: () => {}, openPanel: (a) => void opened.push(a), openDrawer: () => {}, toast: () => {} }
  return { opened, host: { sim: () => ({ meds: { occupant: () => null } }), actions } }
}

describe('the cryo suite interactions', () => {
  it('two stations, priority 1, the copy\'s prompt, both opening the suite\'s panel', () => {
    const { opened, host: h } = host()
    const items = cryoSuiteRegs(h)
    expect(items.map((i) => i.id)).toEqual(['cryo:glass', 'cryo:door'])
    for (const i of items) {
      expect(i.kind).toBe('station')
      expect(i.priority).toBe(1)
      expect(labelOf(i, false)).toBe(CRYO_SUITE_COPY.prompts.glass)
      i.onInteract()
    }
    expect(opened).toEqual(['l2Cryo', 'l2Cryo'])
  })

  it('stand on walkable floor: the glass in the control room at the viewing spot, the door station in recovery', () => {
    const { host: h } = host()
    const [glass, door] = cryoSuiteRegs(h)
    expect([glass.position.x, glass.position.z]).toEqual([CRYO_SUITE.viewing.at.x, CRYO_SUITE.viewing.at.z])
    expect(areaAt(glass.position.x, glass.position.z)?.id).toBe('l2CryoControl')
    expect(areaAt(door.position.x, door.position.z)?.id).toBe('l2Pacu')
    for (const i of [glass, door]) expect(isWalkable(i.position.x, i.position.z, 0.3), i.id).toBe(true)
  })

  it('are registered with the rest of the walk interactables', () => {
    const { host: h } = host()
    const off = registerWalkInteractables(h)
    const ids = [...useInteract.getState().items.keys()]
    off()
    expect(ids).toEqual(expect.arrayContaining(['cryo:glass', 'cryo:door']))
  })
})
