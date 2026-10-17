import { describe, expect, it } from 'vitest'
import { MEDICINES, PATIENTS } from '@/content/catalogue'
import { CONFIG } from '../config'
import { EventLog } from '../events'
import { ROBOT, ROOM_IDS } from '../places'
import { Rng } from '../rng'
import type { WardId } from '../types'
import { drawerS, forward } from './circuit'
import { MedSystem } from './system'

const DT = CONFIG.sim.step
const SPACING = ROBOT.podSize.l + CONFIG.pods.minGap
const names = { name: (id: string) => `Staff ${id}` }

/** Headless harness: the pipeline without walking people (nurses "give" as soon as a drawer is due). */
function makeWorld() {
  const log = new EventLog()
  const meds = new MedSystem(log, names)
  let t = 0
  const violations: string[] = []
  const step = (opts: { autoGive?: boolean } = {}) => {
    t += DT
    meds.step(DT, t)
    // invariants, every step
    for (const w of ['A', 'B'] as WardId[]) {
      const ring = meds.fleet.byWard[w]
      for (let i = 0; i < ring.length; i++) {
        const d = ring[i]
        const leader = ring[(i + 1) % ring.length]
        const gap = forward(d.circuit, d.pod.s, leader.pod.s)
        if (gap < SPACING - 1e-6) violations.push(`t=${t.toFixed(2)} ${d.pod.id} too close to ${leader.pod.id}: ${gap.toFixed(3)}`)
        // a pod never waits for a person (W2: it rides a ceiling rail above everybody)
        // the type no longer allows 'person' (W2); this stays as a runtime guard
        if (String(d.pod.waitingFor) === 'person') violations.push(`t=${t.toFixed(2)} ${d.pod.id} waits for a person`)
      }
    }
    for (const dr of meds.drawers.values()) {
      for (const id of dr.orderIds) {
        if (meds.orders.get(id)!.roomId !== dr.roomId) violations.push(`drawer ${dr.roomId} holds ${id}`)
      }
    }
    if (opts.autoGive) {
      for (const w of ['A', 'B'] as WardId[]) {
        for (const dr of meds.dueDrawers(w)) {
          meds.claim(dr.roomId, `nurse-${w}`)
          meds.give(dr.roomId, `nurse-${w}`)
        }
      }
    }
  }
  return { log, meds, violations, step, now: () => t }
}

function runFor(world: ReturnType<typeof makeWorld>, seconds: number, opts?: { autoGive?: boolean }) {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) world.step(opts)
}

describe('MedSystem pipeline', () => {
  it('takes one presenter order from prescription to the drawer to given', () => {
    const w = makeWorld()
    const res = w.meds.prescribe({ roomId: 'A3', items: [{ medId: 'paracetamol', qty: 1 }, { medId: 'omeprazole', qty: 1 }], prescriberId: 'doc-1', source: 'presenter' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const order = res.order
    runFor(w, 240)
    expect(order.stage).toBe('inDrawer')
    const drawer = w.meds.drawers.get('A3')!
    expect(drawer.state).toBe('loaded')
    expect(drawer.items.map((i) => i.medId)).toEqual(['paracetamol', 'omeprazole'])
    expect(drawer.lightOn).toBe(true) // presenter orders are due at once
    // the pod went home
    const pod = w.meds.fleet.driverOf(order.podId!).pod
    runFor(w, 200)
    expect(pod.state).toBe('charging')
    expect(pod.compartments.every((c) => c === null)).toBe(true)
    // the nurse gives it
    expect(w.meds.dueDrawers('A').map((d) => d.roomId)).toEqual(['A3'])
    w.meds.claim('A3', 'nurse-1')
    expect(w.meds.give('A3', 'nurse-1')).toBe(2)
    expect(order.stage).toBe('given')
    const types = w.log.events.map((e) => e.type)
    for (const t of ['orderCreated', 'orderVerified', 'podAssigned', 'podDocked', 'itemPicked', 'podDeparted', 'podArrived', 'drawerLoaded', 'podReturned', 'nurseNotified', 'medsGiven'] as const) {
      expect(types, t).toContain(t)
    }
    // stages were reached in order
    const s = order.stageAt
    expect(s.prescribed! <= s.verified! && s.verified! <= s.picking! && s.picking! <= s.enRoute! && s.enRoute! <= s.inDrawer! && s.inDrawer! <= s.given!).toBe(true)
    expect(w.violations).toEqual([])
  })

  it('rejects bad orders with a reason', () => {
    const w = makeWorld()
    expect(w.meds.prescribe({ roomId: 'Z9', items: [{ medId: 'paracetamol', qty: 1 }], prescriberId: 'x', source: 'sim' }).ok).toBe(false)
    expect(w.meds.prescribe({ roomId: 'A1', items: [], prescriberId: 'x', source: 'sim' }).ok).toBe(false)
    expect(w.meds.prescribe({ roomId: 'A1', items: [{ medId: 'unicorn', qty: 1 }], prescriberId: 'x', source: 'sim' }).ok).toBe(false)
    const five = MEDICINES.slice(0, 5).map((m) => ({ medId: m.id, qty: 1 }))
    expect(w.meds.prescribe({ roomId: 'A1', items: five, prescriberId: 'x', source: 'sim' }).ok).toBe(false)
  })

  it('delivers a busy morning (40 orders, both wards) with no collision, no pod waiting for a person and nothing stuck', () => {
    const w = makeWorld()
    const rng = new Rng(7)
    const orders: string[] = []
    const n = 40
    let k = 0
    for (let i = 0; i < 30 * 60 / DT && (k < n || [...w.meds.orders.values()].some((o) => o.stage !== 'given')); i++) {
      if (k < n && i % Math.round(25 / DT) === 0) {
        const room = ROOM_IDS[rng.int(0, ROOM_IDS.length - 1)]
        const patient = PATIENTS.find((p) => p.roomId === room)!
        const count = rng.int(1, Math.min(3, patient.usualMeds.length))
        const items = patient.usualMeds.slice(0, count).map((medId) => ({ medId, qty: 1 }))
        const r = w.meds.prescribe({ roomId: room, items, prescriberId: 'doc', source: 'sim', doseAt: w.now() })
        expect(r.ok).toBe(true)
        if (r.ok) orders.push(r.order.id)
        k++
      }
      w.step({ autoGive: true })
    }
    expect(w.violations.slice(0, 5)).toEqual([])
    for (const id of orders) expect(w.meds.orders.get(id)!.stage, id).toBe('given')
    // everything is home and charging afterwards
    runFor(w, 240, { autoGive: true })
    for (const d of w.meds.fleet.drivers) expect(d.pod.state, d.pod.id).toBe('charging')
    // every pack was picked once
    const picks = w.log.events.filter((e) => e.type === 'itemPicked').length
    const packs = orders.reduce((a, id) => a + w.meds.orders.get(id)!.items.length, 0)
    expect(picks).toBe(packs)
  })

  it('never waits for anybody on the way: a loaded pod runs at cruise speed from the exit to its drawer', () => {
    const w = makeWorld()
    const res = w.meds.prescribe({ roomId: 'A5', items: [{ medId: 'metformin', qty: 1 }], prescriberId: 'doc', source: 'presenter' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const order = res.order
    const stop = drawerS('A5')
    const cruise = CONFIG.pods.corridorSpeed - 1e-6
    let atCruise = false
    let slowest = Infinity
    let enRouteSteps = 0
    let delivered = -1
    for (let i = 0; i < 200 / DT; i++) {
      w.step()
      const d = w.meds.fleet.drivers.find((x) => x.pod.orderId)
      if (!d) continue
      if (d.pod.state === 'enRoute') {
        enRouteSteps++
        // once it is at cruise speed in the corridor and further than its braking distance from the drawer (v^2 / 2a = 0.6 m,
        // plus a margin), nothing may slow it: not the doorways of the rooms it passes, not the U-turns
        if (d.pod.speed >= cruise) atCruise = true
        if (atCruise && forward(d.circuit, d.pod.s, stop) > 1) slowest = Math.min(slowest, d.pod.speed)
        expect(d.pod.waitingFor).toBeNull()
      }
      if (delivered < 0 && order.stage === 'inDrawer') delivered = w.now()
    }
    expect(enRouteSteps).toBeGreaterThan(0)
    expect(atCruise).toBe(true)
    expect(slowest).toBeGreaterThanOrEqual(cruise)
    expect(delivered).toBeGreaterThan(0)
    expect(w.violations).toEqual([])
  })

  it('replays identically with the same inputs (deterministic event log)', () => {
    const run = () => {
      const w = makeWorld()
      const rng = new Rng(42)
      for (let i = 0; i < 12 * 60 / DT; i++) {
        if (i % Math.round(40 / DT) === 0) {
          const room = ROOM_IDS[rng.int(0, ROOM_IDS.length - 1)]
          w.meds.prescribe({ roomId: room, items: [{ medId: 'paracetamol', qty: 1 }], prescriberId: 'doc', source: 'sim', doseAt: w.now() })
        }
        w.step({ autoGive: true })
      }
      return w.log.events.map((e) => `${e.t.toFixed(4)} ${e.type} ${e.text}`)
    }
    const a = run()
    const b = run()
    expect(a.length).toBeGreaterThan(50)
    expect(b).toEqual(a)
  })
})
