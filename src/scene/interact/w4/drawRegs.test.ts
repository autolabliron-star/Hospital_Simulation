import { beforeEach, describe, expect, it, vi } from 'vitest'

const takePlayerTicket = vi.fn(() => 'P042')
vi.mock('@/sim', () => ({ sim: { blood: { takePlayerTicket: () => takePlayerTicket() } } }))

import { DRAW_UI } from '@/content/drawUi'
import { labelOf, type Interactable } from '@/scene/interact.store'
import { takeTicketFlashRequests } from '@/scene/drawCentre/flash'
import { isWalkable } from '@/sim/nav/layout'
import { DRAW_CENTRE, areaAt } from '@/sim/places'
import type { WalkActions } from '../actions'
import { PRIORITY, priorityOf } from '../picker'
import { buildWalkInteractables, type RegSim } from '../registrations'
import { DRAW_REGISTRATION_RADIUS, buildDrawInteractables, checkInPromptPoint, robotPromptPoint, sendPromptPoint } from './drawRegs'

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

const sim = (): RegSim => ({ meds: { occupant: () => null } })

function build() {
  const { calls, actions } = fakeActions()
  const items = buildDrawInteractables({ sim, actions })
  const byId = new Map(items.map((i) => [i.id, i]))
  return { calls, actions, items, byId }
}

const get = (byId: Map<string, Interactable>, id: string): Interactable => {
  const i = byId.get(id)
  if (!i) throw new Error(`no interactable ${id}`)
  return i
}

beforeEach(() => {
  takePlayerTicket.mockClear()
  takeTicketFlashRequests()
})

describe('what is registered', () => {
  it('has one console per robot, the check-in kiosk and the send station, with unique ids that clash with nothing else', () => {
    const { items, byId } = build()
    expect(items.length).toBe(DRAW_CENTRE.robots.length + 2)
    for (let i = 0; i < 3; i++) expect(get(byId, `draw:robot:${i}`).kind).toBe('console')
    expect(get(byId, 'draw:checkin').kind).toBe('station')
    expect(get(byId, 'draw:send').kind).toBe('station')
    const others = buildWalkInteractables({ sim, actions: fakeActions().actions })
    const all = [...others, ...items].map((i) => i.id)
    expect(new Set(all).size).toBe(all.length)
  })

  it('outranks people and seats, like every other console and station', () => {
    const { items } = build()
    for (const i of items) {
      expect(priorityOf(i.kind, i.priority), i.id).toBe(PRIORITY[i.kind])
      expect(priorityOf(i.kind, i.priority), `${i.id} outranks people and seats`).toBeLessThan(PRIORITY.seat)
    }
  })

  it('puts each prompt inside the draw centre, where the thing is', () => {
    const { byId } = build()
    for (let i = 0; i < 3; i++) {
      const p = get(byId, `draw:robot:${i}`).position
      expect(areaAt(p.x, p.z)?.id, `robot ${i}`).toBe('diagnostics')
      expect(p.x).toBeCloseTo(DRAW_CENTRE.robots[i].cabinet.x, 6)
      expect(p).toEqual(robotPromptPoint(i))
      // within the radius of where the chair is, so a presenter-sized walk up to the chair triggers it
      expect(Math.hypot(p.x - DRAW_CENTRE.robots[i].chair.at.x, p.z - DRAW_CENTRE.robots[i].chair.at.z)).toBeLessThan(DRAW_REGISTRATION_RADIUS.robot)
    }
    const k = get(byId, 'draw:checkin').position
    expect(areaAt(k.x, k.z)?.id).toBe('diagnostics')
    expect(isWalkable(k.x, k.z)).toBe(true)
    expect(k).toEqual(checkInPromptPoint())
    const s = get(byId, 'draw:send').position
    expect(areaAt(s.x, s.z)?.id).toBe('diagnostics')
    expect(isWalkable(s.x, s.z)).toBe(true)
    expect(s).toEqual(sendPromptPoint())
  })

  it('words the prompts from the content', () => {
    const { byId } = build()
    expect(labelOf(get(byId, 'draw:robot:1'), false)).toBe('Look at Robot 2')
    expect(labelOf(get(byId, 'draw:checkin'), false)).toBe(DRAW_UI.prompt.checkIn)
    expect(labelOf(get(byId, 'draw:send'), false)).toBe(DRAW_UI.prompt.send)
  })
})

describe('what E does', () => {
  it('a robot and the send station open the room panel on the draw centre', () => {
    const { calls, byId } = build()
    get(byId, 'draw:robot:0').onInteract()
    get(byId, 'draw:robot:2').onInteract()
    get(byId, 'draw:send').onInteract()
    expect(calls).toEqual(['panel:diagnostics', 'panel:diagnostics', 'panel:diagnostics'])
    expect(takePlayerTicket).not.toHaveBeenCalled()
  })

  it('the check-in kiosk takes a number for you and a toast tells you which, and the ticket slot glows', () => {
    const { calls, byId } = build()
    get(byId, 'draw:checkin').onInteract()
    expect(takePlayerTicket).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['toast:Your number is P042. Please wait to be called.'])
    expect(takeTicketFlashRequests()).toBe(1)
    expect(takeTicketFlashRequests()).toBe(0)
  })
})
