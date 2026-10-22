import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { Simulation } from '@/sim/Simulation'
import type { Drawer } from '@/sim/types'
import type { YourOrderView } from '@/scene/interact/yourOrder'
import { readDrawer, type DrawerSource } from './drawerModel'

const drawer = (over: Partial<Drawer> = {}): Drawer => ({ roomId: 'A3', state: 'empty', orderIds: [], items: [], lightOn: false, ...over })

function source(d: Drawer | undefined, patient: string | null = 'Grace Adeyemi'): DrawerSource {
  return {
    meds: {
      drawers: new Map(d ? [[d.roomId, d]] : []),
      occupant: () => (patient ? { id: 'p', name: patient } : null),
    },
  }
}

const mine = (stage: YourOrderView['stage'], roomId = 'A3'): YourOrderView => ({ orderId: 'ord-1', roomId, ward: 'A', stage, podId: 'A1', text: '' })

describe('the drawer card', () => {
  it('says an empty drawer is empty, and shows nothing locked', () => {
    const v = readDrawer(source(drawer()), 'A3', null)
    expect(v).toMatchObject({ roomId: 'A3', title: 'A3 medicine drawer', loaded: false, dueNow: false, locked: null, items: [], yours: false })
  })

  it('lists what is inside and whose wristband it is locked to', () => {
    const v = readDrawer(
      source(drawer({ state: 'loaded', orderIds: ['ord-1'], items: [{ medId: 'salbutamol', qty: 2 }, { medId: 'paracetamol', qty: 1 }], lightOn: true })),
      'A3',
      null,
    )
    expect(v.loaded).toBe(true)
    expect(v.dueNow).toBe(true)
    expect(v.locked).toBe("Locked to Grace Adeyemi's wristband.")
    expect(v.items.map((i) => [i.name, i.qty])).toEqual([['Salbutamol', 2], ['Paracetamol', 1]])
    for (const i of v.items) {
      expect(i.strength.length).toBeGreaterThan(0)
      expect(i.color).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('says nothing about a wristband when nobody lies in the bed', () => {
    const v = readDrawer(source(drawer({ state: 'loaded', items: [{ medId: 'salbutamol', qty: 1 }] }), null), 'A3', null)
    expect(v.loaded).toBe(true)
    expect(v.locked).toBeNull()
  })

  it('knows when your order is on its way here, and only then', () => {
    for (const stage of ['prescribed', 'verified', 'picking', 'enRoute'] as const) expect(readDrawer(source(drawer()), 'A3', mine(stage)).yours, stage).toBe(true)
    for (const stage of ['inDrawer', 'given', 'cancelled'] as const) expect(readDrawer(source(drawer()), 'A3', mine(stage)).yours, stage).toBe(false)
    expect(readDrawer(source(drawer()), 'A3', mine('enRoute', 'B6')).yours).toBe(false)
  })

  it('survives a room it has no drawer for', () => {
    expect(readDrawer(source(undefined), 'A3', null).loaded).toBe(false)
  })

  it('reads a real hospital: your order shows in the drawer once the pod has loaded it', () => {
    const sim = new Simulation(99)
    const DT = CONFIG.sim.step
    for (let i = 0; i < 30 * 60; i++) sim.step(DT)
    const room = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].find((r) => sim.meds.occupant(r) !== null)!
    const res = sim.prescribe(room, [{ medId: 'salbutamol', qty: 1 }])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(readDrawer(sim, room, null).loaded).toBe(false)
    // the drawer also takes the room's scheduled doses, so the first load is not necessarily ours: wait until OUR order is in it
    let ours = false
    for (let i = 0; i < 4 * 60 * 60 && !ours; i++) {
      sim.step(DT)
      ours = sim.meds.drawers.get(room)?.orderIds.includes(res.order.id) ?? false
    }
    expect(ours).toBe(true)
    const v = readDrawer(sim, room, null)
    expect(v.loaded).toBe(true)
    expect(v.items.map((i) => i.name)).toContain('Salbutamol')
    expect(v.locked).toContain(sim.meds.occupant(room)!.name)
  }, 120_000)
})
