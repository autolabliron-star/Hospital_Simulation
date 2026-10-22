import { Box3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { Simulation } from '@/sim/Simulation'
import { ROOMS } from '@/sim/places'
import { buildCabinets, buildClosedHatches, cabinetLocalParts, CAB, drawerGeometry, hatchGeometry, SLOTS_PER_DRAWER, shellWithClosedHatches, TRAY_PACK_SIZE, TRAY_PACKS } from './cabinet'

describe('MedDrawer geometry', () => {
  it('the cabinet shell fills the 0.8 m gap and the section-cut height, no more', () => {
    const { shell, cap } = cabinetLocalParts()
    shell.computeBoundingBox()
    cap.computeBoundingBox()
    const box = new Box3().union(shell.boundingBox!).union(cap.boundingBox!)
    expect(box.max.x - box.min.x).toBeCloseTo(0.8, 6)
    expect(box.max.y).toBeCloseTo(1.3, 6)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect(box.min.z).toBeCloseTo(CAB.zRoom, 6)
    expect(box.max.z).toBeCloseTo(CAB.zCorr, 6)
  })

  it('merges all sixteen cabinets, one per room', () => {
    const { shell } = buildCabinets()
    const single = cabinetLocalParts().shell
    expect(shell.index!.count).toBe(single.index!.count * ROOMS.length)
  })

  it('the hatch fits the aperture and hangs from its hinge', () => {
    const g = hatchGeometry()
    g.computeBoundingBox()
    const b = g.boundingBox!
    expect(b.max.x - b.min.x).toBeLessThan(CAB.cavity.hx * 2)
    expect(b.max.y).toBeCloseTo(0, 6)
    expect(b.min.y).toBeCloseTo(-CAB.hatch.h, 6)
    // the hinge sits just under the cavity ceiling and the panel clears the cavity floor
    expect(CAB.hatch.hingeY).toBeLessThanOrEqual(CAB.cavity.y1)
    expect(CAB.hatch.hingeY - CAB.hatch.h).toBeGreaterThanOrEqual(CAB.cavity.y0)
  })

  it('the corridor hatches are drawn closed, one per cabinet, merged with the shell (they no longer open: the pods deliver through the chute)', () => {
    const closed = buildClosedHatches()
    const one = hatchGeometry()
    expect(closed.index!.count).toBe(one.index!.count * ROOMS.length)
    const shell = buildCabinets().shell
    const shellTris = shell.index!.count
    const merged = shellWithClosedHatches(shell)
    expect(merged.index!.count).toBe(shellTris + closed.index!.count)
  })

  it('the drawer front covers its opening and the tray packs lie inside the tray', () => {
    const g = drawerGeometry()
    g.computeBoundingBox()
    expect(CAB.drawer.w).toBeGreaterThan(CAB.drawerSlot.hx * 2 - 1e-9)
    expect(CAB.drawer.h).toBeGreaterThanOrEqual(CAB.drawerSlot.y1 - CAB.drawerSlot.y0 - 1e-9)
    const trayHalf = (CAB.drawer.w - 0.06) / 2 - 0.015
    expect(TRAY_PACKS).toHaveLength(SLOTS_PER_DRAWER)
    for (const p of TRAY_PACKS) {
      expect(Math.abs(p.x) + TRAY_PACK_SIZE.x / 2).toBeLessThanOrEqual(trayHalf + 1e-9)
      expect(p.z - TRAY_PACK_SIZE.z / 2).toBeGreaterThanOrEqual(CAB.drawer.t / 2)
      expect(p.z + TRAY_PACK_SIZE.z / 2).toBeLessThanOrEqual(CAB.drawer.t / 2 + CAB.drawer.tray)
      // resting on the tray floor
      expect(p.y - TRAY_PACK_SIZE.y / 2).toBeGreaterThanOrEqual(g.boundingBox!.min.y)
    }
  })
})

describe('what the drawers react to, in the real simulation', () => {
  it('a delivering pod (funnel and packs), a giving nurse and the loaded-to-empty change all happen for one presenter order', () => {
    const sim = new Simulation(11)
    const res = sim.prescribe('A3', [{ medId: 'paracetamol', qty: 1 }, { medId: 'furosemide', qty: 2 }])
    expect(res.ok).toBe(true)
    const drawer = sim.meds.drawers.get('A3')!
    let funnelSignal = false
    let giveSignal = false
    let lightOn = false
    let wasLoaded = false
    let emptiedAfterLoad = false
    const nurses = sim.people.filter((p) => p.entity.role === 'nurse').map((p) => p.entity)
    for (let step = 0; step < 60 * 420; step++) {
      sim.step(CONFIG.sim.step)
      // the exact signals DrawersLayer uses (a delivering pod folds the room's funnel out and runs its packs down the chute)
      for (const d of sim.meds.fleet.drivers) {
        if (d.pod.state === 'delivering' && sim.meds.jobOf(d.pod.id)?.roomId === 'A3') funnelSignal = true
      }
      for (const e of nurses) if (e.anim === 'give' && e.roomId === 'A3') giveSignal = true
      if (drawer.lightOn) lightOn = true
      if (drawer.state === 'loaded') wasLoaded = true
      if (wasLoaded && drawer.state === 'empty') emptiedAfterLoad = true
      if (emptiedAfterLoad) break
    }
    expect(funnelSignal).toBe(true)
    expect(lightOn).toBe(true)
    expect(giveSignal).toBe(true)
    expect(emptiedAfterLoad).toBe(true)
    // the drawer never held anything for another room (the layer paints tray packs from drawer.items)
    expect(sim.meds.drawers.get('A4')!.state).toBe('empty')
  })

  it('a drawer holds at most as many packs as the tray shows, for a normal order', () => {
    const sim = new Simulation(3)
    const items = [{ medId: 'paracetamol', qty: 1 }, { medId: 'omeprazole', qty: 1 }, { medId: 'amlodipine', qty: 1 }, { medId: 'cetirizine', qty: 1 }]
    const r = sim.prescribe('B2', items)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    let max = 0
    let maxAll = 0
    for (let step = 0; step < 60 * 400; step++) {
      sim.step(CONFIG.sim.step)
      const d = sim.meds.drawers.get('B2')!
      const packs = d.items.reduce((n, it) => n + it.qty, 0)
      maxAll = Math.max(maxAll, packs)
      // the drawer holds only this order's packs (Wave 1: the 08:00 dose wave puts the room's own scheduled order in the drawer at about
      // 2 min too, so the drawer may hold the two orders at once: that stacking is checked separately below)
      if (d.orderIds.length === 1 && d.orderIds[0] === r.order.id) max = Math.max(max, packs)
    }
    expect(max).toBe(4)
    expect(max).toBeLessThanOrEqual(SLOTS_PER_DRAWER)
    // a scheduled order may stack on top of it (4 + 1 packs measured): the tray still has a slot for every pack
    expect(maxAll).toBeGreaterThanOrEqual(max)
    expect(maxAll).toBeLessThanOrEqual(SLOTS_PER_DRAWER)
  })
})
