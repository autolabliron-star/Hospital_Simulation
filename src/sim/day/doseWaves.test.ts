import { describe, expect, it } from 'vitest'
import { MEDICINES, patientInRoom } from '@/content/catalogue'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'
import type { LivingDay } from '../life'
import type { MedSystem, PrescribeInput } from '../meds/system'
import type { Order, RoomId, RoomStatus, SimEventType } from '../types'
import type { World } from '../er/world'
import { DoseWaves, LATE_SECONDS } from './doseWaves'
import { timeOfClockHour } from './roster'
import { hourT, run } from './testkit'

const T = (h: number) => timeOfClockHour(h)

/** A bare world for the wave: it records the events and the orders it is asked for. */
function harness(beds: Partial<Record<RoomId, RoomStatus['bed']>> = {}) {
  const orders: PrescribeInput[] = []
  const events: { type: SimEventType; text: string; actorId?: string }[] = []
  const rooms = new Map<RoomId, RoomStatus>()
  for (const w of ['A', 'B']) {
    for (let n = 1; n <= 8; n++) {
      const id = `${w}${n}`
      rooms.set(id, { roomId: id, bed: beds[id] ?? 'occupied', patientId: 'p', patientName: 'P', since: 0, meal: 'none', recline: 0, version: 0 })
    }
  }
  const meds = {
    prescribe: (i: PrescribeInput) => {
      orders.push(i)
      return { ok: true as const, order: { id: `o${orders.length}`, ...i } as unknown as Order }
    },
  } as unknown as MedSystem
  const world = { say: (type: SimEventType, text: string, refs: { actorId?: string } = {}) => events.push({ type, text, actorId: refs.actorId }) } as unknown as World
  const life = { rooms } as unknown as LivingDay
  return { orders, events, deps: { world, life, meds } }
}

describe('dose waves (unit)', () => {
  it('sends nothing before 11:30, then one wave 30 minutes before each dose hour', () => {
    const h = harness()
    const waves = new DoseWaves(h.deps, 0)
    const lead = CONFIG.doseWaves.leadSeconds
    expect(lead).toBe(1800)
    // the default morning: nothing, all the way up to 11:29:59
    for (let t = 0; t < T(11.5); t += 7.3) waves.step(t)
    expect(h.orders).toEqual([])
    expect(waves.fired).toHaveLength(0)
    waves.step(T(11.5))
    expect(waves.fired).toHaveLength(1)
    expect(waves.fired[0].doseAt).toBe(T(12))
    const afterNoon = h.orders.length
    // no second wave until 17:30, and none twice
    for (let t = T(11.5); t < T(17.5); t += 11) waves.step(t)
    expect(h.orders).toHaveLength(afterNoon)
    waves.step(T(17.5))
    expect(waves.fired).toHaveLength(2)
    expect(waves.fired[1].doseAt).toBe(T(18))
    waves.step(T(21.5))
    expect(waves.fired).toHaveLength(3)
    expect(waves.fired[2].doseAt).toBe(T(22))
    for (let t = T(21.5); t < T(30); t += 60) waves.step(t)
    expect(waves.fired).toHaveLength(3)
  })

  it('writes one schedule order per occupied room, by that ward\'s doctor, with the patient\'s usual medicines', () => {
    const h = harness({ A3: 'ready', B2: 'needsCleaning', B7: 'reserved', A5: 'dischargeSigned', A6: 'leaving', B1: 'cleaning' })
    const waves = new DoseWaves(h.deps, 0)
    waves.step(T(11.5))
    const rooms = h.orders.map((o) => o.roomId).sort()
    // occupied and dischargeSigned beds only
    expect(rooms).toEqual(['A1', 'A2', 'A4', 'A5', 'A7', 'A8', 'B3', 'B4', 'B5', 'B6', 'B8'])
    for (const o of h.orders) {
      expect(o.source).toBe('schedule')
      expect(o.doseAt).toBe(T(12))
      expect(o.prescriberId).toBe(o.roomId.startsWith('A') ? 'doc-A' : 'doc-B')
      expect(o.items.map((i) => i.medId)).toEqual(patientInRoom(o.roomId).usualMeds.slice(0, CONFIG.orders.maxItems))
      expect(o.items.every((i) => i.qty === 1)).toBe(true)
    }
  })

  it('announces the wave once per ward with the number of rooms', () => {
    const h = harness({ A1: 'needsCleaning' })
    new DoseWaves(h.deps, 0).step(T(11.5))
    expect(h.events.map((e) => e.type)).toEqual(['doseWave', 'doseWave'])
    expect(h.events[0].text).toBe('The 12:00 dose wave is on its way: 7 rooms.')
    expect(h.events[1].text).toBe('The 12:00 dose wave is on its way: 8 rooms.')
    expect(h.events.map((e) => e.actorId)).toEqual(['doc-A', 'doc-B'])
  })

  it('a start just after a dose hour still sends that wave, due now; a start long after skips it', () => {
    const late = harness()
    const w1 = new DoseWaves(late.deps, T(12) + 120)
    w1.step(T(12) + 120)
    expect(w1.fired).toHaveLength(1)
    expect(w1.fired[0].doseAt).toBe(T(12) + 120)
    const veryLate = harness()
    const w2 = new DoseWaves(veryLate.deps, T(12) + LATE_SECONDS + 60)
    w2.step(T(12) + LATE_SECONDS + 60)
    expect(w2.fired).toHaveLength(0)
    // the next one is still ahead
    w2.step(T(17.5))
    expect(w2.fired).toHaveLength(1)
    expect(w2.fired[0].hour).toBe(18)
    // a start at 07:30 or 11:00 has no wave before 11:30
    for (const t0 of [0, hourT(7), T(11)]) {
      const h = harness()
      const w = new DoseWaves(h.deps, t0)
      w.step(t0)
      w.step(T(11.4))
      expect(h.orders, `t0 ${t0}`).toEqual([])
    }
  })

  it('skips a room whose patient has no regular medicines, and takes the meds from the seam when it is replaced', () => {
    const h = harness()
    const waves = new DoseWaves(h.deps, 0)
    const five = MEDICINES.slice(0, 5).map((m) => m.id)
    waves.occupantMeds = (room) => (room === 'A1' ? null : room === 'A2' ? five : patientInRoom(room).usualMeds)
    waves.step(T(11.5))
    expect(h.orders.some((o) => o.roomId === 'A1')).toBe(false)
    // a pod carries at most four packs
    expect(h.orders.find((o) => o.roomId === 'A2')!.items.map((i) => i.medId)).toEqual(five.slice(0, CONFIG.orders.maxItems))
  })
})

describe('dose waves in the simulation', () => {
  it('the default morning has no wave at all', () => {
    const sim = new Simulation(2026)
    run(sim, 10 * 60)
    expect([...sim.meds.orders.values()].filter((o) => o.source === 'schedule')).toEqual([])
    expect(sim.log.events.filter((e) => e.type === 'doseWave')).toEqual([])
  }, 60_000)

  it('the midday wave goes out at 11:30 and every dose reaches the patient (a warm start at 11:25)', () => {
    const sim = new Simulation(7, { startHour: 11 + 25 / 60 })
    // the doses are due at 12:00: by 12:10 every one is in the patient
    run(sim, 45 * 60)
    const wave = [...sim.meds.orders.values()].filter((o) => o.source === 'schedule')
    // every occupied room (the bed book may have sent somebody home already) has its order, and nothing came earlier
    const occupied = [...sim.life.rooms.values()].filter((r) => r.bed === 'occupied' || r.bed === 'dischargeSigned').length
    expect(wave.length).toBeGreaterThanOrEqual(10)
    expect(wave.length).toBeLessThanOrEqual(16)
    expect(occupied).toBeGreaterThan(0)
    for (const o of wave) {
      expect(o.createdAt, o.id).toBeGreaterThanOrEqual(T(11.5) - 1)
      expect(o.createdAt, o.id).toBeLessThan(T(11.5) + 30)
      expect(o.doseAt, o.id).toBe(T(12))
      expect(o.stage, `${o.id} ${o.roomId}`).toBe('given')
    }
    const events = sim.log.events.filter((e) => e.type === 'doseWave')
    expect(events).toHaveLength(2)
    expect(events[0].t).toBeGreaterThanOrEqual(T(11.5) - 1)
    // the pods really carried them
    expect(sim.log.events.filter((e) => e.type === 'podDeparted' && e.t >= T(11.5)).length).toBeGreaterThanOrEqual(wave.length)
  }, 120_000)

  it('a Jump to 12:00 shows the wave in progress: the orders go out at once', () => {
    const sim = new Simulation(7, { startHour: 12 })
    run(sim, 60)
    expect([...sim.meds.orders.values()].filter((o) => o.source === 'schedule').length).toBeGreaterThanOrEqual(10)
    expect(sim.log.events.filter((e) => e.type === 'doseWave')).toHaveLength(2)
  }, 60_000)
})
