import { describe, expect, it } from 'vitest'
import { doseHoursOf, MEDICINES, patientInRoom } from '@/content/catalogue'
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
  it('sends one wave 30 minutes before each dose hour that is still ahead at the 07:30 opening: 08, 12, 14, 18, 20 and 22', () => {
    const h = harness()
    const waves = new DoseWaves(h.deps, 0)
    const lead = CONFIG.doseWaves.leadSeconds
    expect(lead).toBe(1800)
    // 06:00 is a dose hour too (levothyroxine) but lies before the 07:30 opening, so a normal day never sends it
    expect(CONFIG.doseWaves.hours).toEqual([6, 8, 12, 14, 18, 20, 22])
    // the 08:00 wave goes out at the 07:30 opening itself
    waves.step(0)
    expect(waves.fired).toHaveLength(1)
    expect(waves.fired[0].doseAt).toBe(T(8))
    // nothing again until 11:30, and no wave twice
    for (let t = 1; t < T(11.5); t += 97) waves.step(t)
    expect(waves.fired).toHaveLength(1)
    const expected = [12, 14, 18, 20, 22]
    for (const hour of expected) {
      waves.step(T(hour) - lead - 1)
      expect(waves.fired.some((f) => f.hour === hour), `${hour} early`).toBe(false)
      waves.step(T(hour) - lead)
      expect(waves.fired.at(-1)!.hour).toBe(hour)
      expect(waves.fired.at(-1)!.doseAt).toBe(T(hour))
    }
    for (let t = T(21.5); t < T(30); t += 60) waves.step(t)
    expect(waves.fired).toHaveLength(6)
  })

  it('writes schedule orders only for the medicines due at the hour, by that ward\'s doctor, one or more per occupied room', () => {
    const h = harness({ A3: 'ready', B2: 'needsCleaning', B7: 'reserved', A5: 'dischargeSigned', A6: 'leaving', B1: 'cleaning' })
    const waves = new DoseWaves(h.deps, T(11.4))
    waves.step(T(11.5))
    const rooms = new Set(h.orders.map((o) => o.roomId))
    // occupied and dischargeSigned beds only, and only those with a medicine due at 12:00
    for (const id of rooms) expect(['A3', 'B2', 'B7', 'A6', 'B1']).not.toContain(id)
    for (const o of h.orders) {
      expect(o.source).toBe('schedule')
      expect(o.doseAt).toBe(T(12))
      expect(o.prescriberId).toBe(o.roomId.startsWith('A') ? 'doc-A' : 'doc-B')
      expect(o.items.length).toBeLessThanOrEqual(CONFIG.orders.maxItems)
      for (const i of o.items) expect(doseHoursOf(i.medId), `${o.roomId} ${i.medId}`).toContain(12)
      expect(o.items.every((i) => i.qty === 1)).toBe(true)
    }
    // A1 takes paracetamol at noon (08/12/18/22) but not amoxicillin (08/14/22)
    expect(h.orders.find((o) => o.roomId === 'A1')!.items.map((i) => i.medId)).toEqual(['paracetamol'])
    // A2 (furosemide, bisoprolol: once a day in the morning) has nothing due at noon
    expect(rooms.has('A2')).toBe(false)
  })

  it('the 08:00 wave carries the once-daily morning medicines and the 22:00 wave the night ones (statin, senna)', () => {
    const h = harness()
    const waves = new DoseWaves(h.deps, 0)
    waves.step(0)
    const morning = h.orders.filter((o) => o.doseAt === T(8))
    const med = (room: string) => morning.filter((o) => o.roomId === room).flatMap((o) => o.items.map((i) => i.medId))
    expect(med('A2')).toEqual(['furosemide', 'bisoprolol'])
    // levothyroxine is a 06:00 dose (before breakfast), so it is not on the 08:00 round
    expect(med('B1')).toEqual(['colecalciferol'])
    expect(morning.some((o) => o.items.some((i) => i.medId === 'atorvastatin'))).toBe(false)
    expect(morning.some((o) => o.items.some((i) => i.medId === 'senna'))).toBe(false)
    const h2 = harness()
    const w2 = new DoseWaves(h2.deps, T(21.4))
    w2.step(T(21.5))
    const meds = new Set(h2.orders.flatMap((o) => o.items.map((i) => i.medId)))
    expect(meds.has('atorvastatin')).toBe(true)
    expect(meds.has('senna')).toBe(true)
    expect(meds.has('furosemide')).toBe(false)
    expect(h2.orders.find((o) => o.roomId === 'A5')!.items.map((i) => i.medId)).toEqual(['atorvastatin'])
    expect(h2.orders.find((o) => o.roomId === 'B5')!.items.map((i) => i.medId)).toEqual(['paracetamol', 'senna'])
  })

  it('announces the wave once per ward with the number of rooms that have a dose due', () => {
    const h = harness({ A1: 'needsCleaning' })
    new DoseWaves(h.deps, 0).step(0)
    expect(h.events.map((e) => e.type)).toEqual(['doseWave', 'doseWave'])
    expect(h.events[0].text).toBe('The 08:00 dose wave is on its way: 7 rooms.')
    expect(h.events[1].text).toBe('The 08:00 dose wave is on its way: 8 rooms.')
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
    // the next one (14:00) is still ahead
    w2.step(T(13.5))
    expect(w2.fired).toHaveLength(1)
    expect(w2.fired[0].hour).toBe(14)
    // a start at 07:00 waits for 07:30
    const early = harness()
    const w = new DoseWaves(early.deps, hourT(7))
    w.step(hourT(7))
    expect(early.orders).toEqual([])
    w.step(0)
    expect(w.fired[0].hour).toBe(8)
  })

  it('splits a room\'s due medicines into several orders when there are more than a pod carries, and takes the meds from the seam', () => {
    const h = harness()
    const waves = new DoseWaves(h.deps, 0)
    // six medicines that are all due at 08:00
    const six = MEDICINES.filter((m) => doseHoursOf(m.id).includes(8)).slice(0, 6).map((m) => m.id)
    expect(six).toHaveLength(6)
    waves.occupantMeds = (room) => (room === 'A1' ? null : room === 'A2' ? six : patientInRoom(room).usualMeds)
    waves.step(0)
    expect(h.orders.some((o) => o.roomId === 'A1')).toBe(false)
    const a2 = h.orders.filter((o) => o.roomId === 'A2')
    expect(a2.map((o) => o.items.length)).toEqual([CONFIG.orders.maxItems, 6 - CONFIG.orders.maxItems])
    expect(a2.flatMap((o) => o.items.map((i) => i.medId))).toEqual(six)
  })
})

describe('dose waves in the simulation', () => {
  it('the default morning opens with the 08:00 wave: orders for the once-daily morning medicines, pods busy from the start', () => {
    const sim = new Simulation(2026)
    run(sim, 2 * 60)
    // two minutes in, the pods are out on the rail
    expect(sim.meds.fleet.drivers.some((d) => d.pod.state !== 'charging')).toBe(true)
    run(sim, 8 * 60)
    const wave = [...sim.meds.orders.values()].filter((o) => o.source === 'schedule')
    expect(wave.length).toBeGreaterThanOrEqual(10)
    for (const o of wave) {
      expect(o.createdAt).toBeLessThan(5)
      expect(o.doseAt).toBe(T(8))
    }
    expect(sim.log.events.filter((e) => e.type === 'doseWave')).toHaveLength(2)
  }, 60_000)

  it('the 08:00 doses are given around 08:00, not before 07:55', () => {
    const sim = new Simulation(2026)
    run(sim, 50 * 60)
    const wave = [...sim.meds.orders.values()].filter((o) => o.source === 'schedule')
    for (const o of wave) {
      expect(o.stage, `${o.id} ${o.roomId}`).toBe('given')
      expect(o.stageAt.given!, o.id).toBeGreaterThan(T(8) - 90)
      expect(o.stageAt.given!, o.id).toBeLessThan(T(8) + 15 * 60)
    }
  }, 120_000)

  it('the midday wave goes out at 11:30 and every dose reaches the patient (a warm start at 11:25)', () => {
    const sim = new Simulation(7, { startHour: 11 + 25 / 60 })
    // the doses are due at 12:00: by 12:15 every one is in the patient
    run(sim, 50 * 60)
    const wave = [...sim.meds.orders.values()].filter((o) => o.source === 'schedule')
    // some patient has paracetamol or ibuprofen due at noon (the bed book may have sent somebody home already)
    expect(wave.length).toBeGreaterThanOrEqual(3)
    for (const o of wave) {
      expect(o.createdAt, o.id).toBeGreaterThanOrEqual(T(11.5) - 1)
      expect(o.createdAt, o.id).toBeLessThan(T(11.5) + 30)
      expect(o.doseAt, o.id).toBe(T(12))
      expect(o.stage, `${o.id} ${o.roomId}`).toBe('given')
    }
    const events = sim.log.events.filter((e) => e.type === 'doseWave')
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].t).toBeGreaterThanOrEqual(T(11.5) - 1)
    // the pods really carried them
    expect(sim.log.events.filter((e) => e.type === 'podDeparted' && e.t >= T(11.5)).length).toBeGreaterThanOrEqual(wave.length)
  }, 120_000)

  it('a Jump to 12:00 shows the wave in progress: the orders go out at once', () => {
    const sim = new Simulation(7, { startHour: 12 })
    run(sim, 60)
    expect([...sim.meds.orders.values()].filter((o) => o.source === 'schedule').length).toBeGreaterThanOrEqual(3)
    expect(sim.log.events.filter((e) => e.type === 'doseWave').length).toBeGreaterThanOrEqual(1)
  }, 60_000)
})
