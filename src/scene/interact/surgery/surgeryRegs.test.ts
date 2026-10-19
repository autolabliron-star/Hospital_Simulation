/**
 * The surgery suite's E interactions in node: the teaching console (free to sit at, or you are in it; nothing when somebody else is), the viewing window, the pre-op
 * desk and the recovery island each open their own panel; the prompts are the copy's without its key cap; and they are registered with the rest.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { SURGERY_UI } from '@/content/surgeryUi'
import { labelOf, useInteract } from '@/scene/interact.store'
import { OR_APPROACH } from '@/scene/surgery/dims'
import { PACU, PREOP, SURGERY, areaById, type AreaId } from '@/sim/places'
import type { WalkActions } from '../actions'
import { registerWalkInteractables } from '../registrations'
import { bare, buildSurgeryInteractables, SURGERY_REGISTRATION_RADIUS, type TeachRegEnv } from './surgeryRegs'
import { type TeachingLike } from './teaching'

function host() {
  const opened: AreaId[] = []
  const actions: WalkActions = { openRx: () => {}, openPanel: (a) => void opened.push(a), openDrawer: () => {}, toast: () => {} }
  return { opened, host: { sim: () => ({ meds: { occupant: () => null } }), actions } }
}

function env(...given: [] | [string | null | undefined]): { env: TeachRegEnv; presses: number[]; set(o: string | null | undefined): void } {
  const presses: number[] = []
  let who: string | null | undefined = given.length === 0 ? null : given[0]
  const controller: TeachingLike = { press: () => void presses.push(1), active: false }
  return { env: { occupant: () => who, controller: () => controller }, presses, set: (o) => void (who = o) }
}

describe('the surgery interactions', () => {
  it('has four stations, each its own prompt and priority 1', () => {
    const { host: h } = host()
    const items = buildSurgeryInteractables(h, env().env)
    expect(items.map((i) => i.id)).toEqual(['or:teach', 'or:window', 'preop:desk', 'pacu:island'])
    for (const i of items) {
      expect(i.kind).toBe('station')
      expect(i.priority).toBe(1)
    }
  })

  it('puts each where it is used: beside the console chairs, at the viewing window, at the admissions desk, at the recovery island', () => {
    const { host: h } = host()
    const [teach, win, desk, pacu] = buildSurgeryInteractables(h, env().env)
    expect(teach.position).toEqual({ x: OR_APPROACH.consoles.x, y: 0, z: OR_APPROACH.consoles.z })
    expect(win.position).toEqual({ x: SURGERY.viewing.at.x, y: 0, z: SURGERY.viewing.at.z })
    expect(desk.position).toEqual({ x: PREOP.desk.at.x, y: 0, z: PREOP.desk.at.z })
    expect(pacu.position.x).toBe(PACU.island.at.x)
    expect(pacu.position.z).toBeGreaterThan(PACU.island.at.z)
    expect(teach.radius).toBe(SURGERY_REGISTRATION_RADIUS.teach)
    // each prompt is inside the room it belongs to
    const inside = (id: AreaId, p: { x: number; z: number }): boolean => {
      const r = areaById(id).rect
      return p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1
    }
    expect(inside('l2Or', teach.position)).toBe(true)
    expect(inside('l2Corridor', win.position)).toBe(true)
    expect(inside('l2PreOp', desk.position)).toBe(true)
    expect(inside('l2Pacu', pacu.position)).toBe(true)
  })

  it('says the copy\'s words without the key cap (the prompt line adds its own)', () => {
    const { host: h } = host()
    const [teach, win, desk, pacu] = buildSurgeryInteractables(h, env().env)
    expect(labelOf(teach, false)).toBe('Sit at the teaching console')
    expect(labelOf(win, false)).toBe('Watch the OR through the window')
    expect(labelOf(desk, false)).toBe('Open the pre-op desk')
    expect(labelOf(pacu, false)).toBe('Open the recovery island')
    for (const s of [SURGERY_UI.console.prompt, SURGERY_UI.prompts.viewingWindow, SURGERY_UI.prompts.preOpDesk, SURGERY_UI.prompts.pacuIsland]) expect(bare(s).startsWith('E')).toBe(false)
    expect(bare('E · Do it')).toBe('Do it')
    expect(bare('Already bare')).toBe('Already bare')
  })

  it('opens the OR, pre-op and recovery panels with no camera flight (the walk-mode action)', () => {
    const { host: h, opened } = host()
    const [teach, win, desk, pacu] = buildSurgeryInteractables(h, env().env)
    win.onInteract()
    desk.onInteract()
    pacu.onInteract()
    expect(opened).toEqual(['l2Or', 'l2PreOp', 'l2Pacu'])
    expect(teach).toBeDefined()
  })

  it('lets you sit at the teaching console when it is free or you are in it, and hands E to the session', () => {
    const { host: h } = host()
    const e = env(null)
    const teach = buildSurgeryInteractables(h, e.env)[0]
    expect(teach.enabled!()).toBe(true)
    e.set('player')
    expect(teach.enabled!()).toBe(true)
    e.set('surgeon-1')
    expect(teach.enabled!()).toBe(false)
    // somebody else's seat: no locked label either, so the prompt is simply not offered
    expect(teach.lockedLabel).toBeUndefined()
    e.set(null)
    teach.onInteract()
    expect(e.presses).toEqual([1])
  })

  it('has no console to sit at in a host without a seat registry (a test\'s), and does nothing without a controller', () => {
    const { host: h } = host()
    const none = env(undefined)
    const teach = buildSurgeryInteractables(h, none.env)[0]
    expect(teach.enabled!()).toBe(false)
    const noController: TeachRegEnv = { occupant: () => null, controller: () => null }
    expect(() => buildSurgeryInteractables(h, noController)[0].onInteract()).not.toThrow()
  })

  it('is registered with the rest of the walk interactables, and taken out again with them', () => {
    useInteract.setState({ items: new Map() })
    const { host: h } = host()
    const undo = registerWalkInteractables(h)
    for (const id of ['or:teach', 'or:window', 'preop:desk', 'pacu:island']) expect(useInteract.getState().items.has(id), id).toBe(true)
    undo()
    expect(useInteract.getState().items.size).toBe(0)
  })
})

beforeEach(() => {
  useInteract.setState({ items: new Map() })
})
