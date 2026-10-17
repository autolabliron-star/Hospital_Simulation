/**
 * The day rhythm as a whole: every Jump moment replays the same day, the hospital has the right number of people at the
 * busy afternoon and evening hours, and the night is a night (the café closed and empty, visitors gone, the night cleaner on
 * her deep-clean patrol). Short windows from warm starts; the long shift changes are in shifts.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { areaAt } from '../places'
import { Simulation } from '../Simulation'
import { DeepCleaner } from './deepCleaner'
import { ShiftActor } from './shiftActor'
import { run, logOf, partyVisitors } from './testkit'

function snapshot(sim: Simulation): string[] {
  return [...sim.entities.values()].map((e) => `${e.id} ${e.position.x.toFixed(3)} ${e.position.z.toFixed(3)} ${e.anim} ${(e.fade ?? 1).toFixed(2)}`)
}

const inRoom = (x: number, z: number): boolean => areaAt(x, z)?.kind === 'room'

describe('a Jump replays the identical day', () => {
  for (const hour of CONFIG.day.moments) {
    it(`(seed, ${hour}) gives the same event log and the same people, hidden pre-roll included`, () => {
      const a = new Simulation(11, { startHour: hour })
      const b = new Simulation(11, { startHour: hour })
      a.preRoll(CONFIG.day.jumpPreRollSeconds)
      b.preRoll(CONFIG.day.jumpPreRollSeconds)
      run(a, 90)
      run(b, 90)
      expect(logOf(a).length).toBeGreaterThan(0)
      expect(logOf(b)).toEqual(logOf(a))
      expect(snapshot(b)).toEqual(snapshot(a))
      expect(a.t).toBeCloseTo((hour - CONFIG.sim.startHour) * 3600 + CONFIG.day.jumpPreRollSeconds + 90, 3)
    }, 60_000)
  }

  it('another seed gives another day', () => {
    const a = new Simulation(11, { startHour: 15 })
    const b = new Simulation(12, { startHour: 15 })
    run(a, 120)
    run(b, 120)
    expect(logOf(b)).not.toEqual(logOf(a))
  }, 60_000)
})

describe('the default 07:30 start is the M3 morning, untouched', () => {
  it('nobody changes shift before 18:00 and the staff stand as built', () => {
    const sim = new Simulation(42)
    const before = [...sim.entities.keys()].filter((id) => !id.startsWith('amb-')).sort()
    run(sim, 5 * 60)
    expect(sim.people.some((p) => p instanceof ShiftActor)).toBe(false)
    expect(sim.day.shifts.runs.filter((r) => r.state === 'running')).toEqual([])
    // the office-hours imaging team is already at its consoles (as in M3): its 08:00 arrival is skipped
    expect(sim.day.shifts.runs.find((r) => r.change.key === 'rad-MRI@8')?.state).toBe('done')
    for (const id of ['rad-MRI', 'rad-CT', 'doc-ER1', 'porter-1', 'cleaner-2', 'nurse-T1']) expect(before).toContain(id)
    for (const id of ['porter-N', 'cleaner-N']) expect(sim.entities.has(id)).toBe(false)
  }, 60_000)
})

describe('the busy hours have a sensible crowd', () => {
  // 16 inpatients + about 25 staff + the ER pathway (5-15 patients and companions) + visitors (rate x 24 min) + ambient people
  // in the lobby, café and garden. Measured over seeds 1-3: 15:00 81-92, 19:00 69-74, 22:30 42-48, and 10:30 89-96 (M3's gate: 80-130).
  it('at 15:00, the start of the visiting peak: about 85 people, visitors already at the bedsides', () => {
    const sim = new Simulation(3, { startHour: 15 })
    sim.preRoll(CONFIG.day.jumpPreRollSeconds)
    const visitors = partyVisitors(sim)
    expect(visitors.length).toBeGreaterThanOrEqual(10)
    expect(visitors.length).toBeLessThanOrEqual(CONFIG.visitors.maxOnSite)
    // already mid-visit: most are inside their patient's room (the rest are walking in or having a coffee)
    expect(visitors.filter((p) => inRoom(p.walker.x, p.walker.z)).length).toBeGreaterThanOrEqual(Math.floor(visitors.length / 2))
    run(sim, 8 * 60)
    expect(sim.entities.size).toBeGreaterThanOrEqual(65)
    expect(sim.entities.size).toBeLessThanOrEqual(125)
    const lobby = sim.seats.occupancy({ kind: 'waiting', area: 'lobby' })
    expect(lobby.taken / lobby.total).toBeGreaterThanOrEqual(0.6)
  }, 60_000)

  it('at 19:00, the evening ER peak and the last of the visiting: about 70 people', () => {
    const sim = new Simulation(3, { startHour: 19 })
    sim.preRoll(CONFIG.day.jumpPreRollSeconds)
    run(sim, 8 * 60)
    expect(sim.entities.size).toBeGreaterThanOrEqual(55)
    expect(sim.entities.size).toBeLessThanOrEqual(110)
    expect(sim.world.er.cases.size).toBeGreaterThanOrEqual(4)
    expect(partyVisitors(sim).length).toBeGreaterThan(5)
  }, 60_000)

  it('the quiet hour (13:30) is calmer than the afternoon (15:00): a third of the visitors', () => {
    const quiet = partyVisitors(new Simulation(5, { startHour: 13.5 })).length
    const busy = partyVisitors(new Simulation(5, { startHour: 15 })).length
    expect(busy).toBeGreaterThanOrEqual(10)
    expect(quiet).toBeLessThan(busy / 2)
  }, 60_000)

  it('the ambient seats start at the hour\'s level: full at noon, thin at night', () => {
    const level = (h: number) => {
      const s = new Simulation(5, { startHour: h })
      const o = s.seats.occupancy({ kind: 'waiting', area: 'lobby' })
      return o.taken / o.total
    }
    expect(level(12)).toBeGreaterThanOrEqual(0.7)
    expect(level(10.5)).toBeGreaterThanOrEqual(0.8)
    expect(level(22.5)).toBeLessThanOrEqual(0.6)
    expect(level(7)).toBeLessThanOrEqual(0.5)
  }, 60_000)
})

describe('the night', () => {
  it('at 22:30 the café is closed and empty, the visitors are gone but for a companion a ward, and the night cleaner deep-cleans', () => {
    const sim = new Simulation(3, { startHour: 22.5 })
    sim.preRoll(CONFIG.day.jumpPreRollSeconds)
    run(sim, 8 * 60)
    // the café: nobody sits there and every seat is held by the closed sign
    const inCafe = [...sim.entities.values()].filter((e) => e.seated?.seatId.startsWith('cafe:'))
    expect(inCafe).toEqual([])
    for (const seat of sim.seats.all.filter((s) => s.kind === 'cafe')) expect(sim.seats.occupant(seat.id), seat.id).toBe('closed:cafe')
    // visitors: at most one companion per ward, sitting at the bedside
    const visitors = partyVisitors(sim)
    expect(visitors.length).toBeLessThanOrEqual(2 * CONFIG.day.overnightCompanionsPerWard)
    const wards = visitors.map((p) => (p.walker.z < 0 ? 'A' : 'B'))
    expect(new Set(wards).size).toBe(wards.length)
    for (const p of visitors) expect(inRoom(p.walker.x, p.walker.z), p.entity.name).toBe(true)
    // the ER runs at night rates with a night footing
    expect(sim.people.filter((p) => p.entity.role === 'porter')).toHaveLength(2)
    const cleaners = sim.people.filter((p) => p.entity.role === 'cleaner')
    expect(cleaners).toHaveLength(1)
    expect(cleaners[0]).toBeInstanceOf(DeepCleaner)
    expect(sim.entities.size).toBeGreaterThanOrEqual(35)
    expect(sim.entities.size).toBeLessThanOrEqual(65)
  }, 60_000)

  it('the night cleaner mops every stop of her patrol, longer than a day cleaner does', () => {
    const sim = new Simulation(3, { startHour: 23 })
    const cleaner = sim.people.find((p) => p.entity.id === 'cleaner-N')!
    let mops = 0
    let mopping = 0
    let longest = 0
    let was = false
    for (let i = 0; i < 25 * 60 * 60; i++) {
      sim.step(CONFIG.sim.step)
      const on = cleaner.entity.anim === 'clean' && cleaner.walker.speed < 0.05
      if (on) mopping += CONFIG.sim.step
      else {
        if (was) longest = Math.max(longest, mopping)
        if (was) mops++
        mopping = 0
      }
      was = on
    }
    expect(mops).toBeGreaterThanOrEqual(3)
    // a day cleaner mops 10-20 s; her mops are twice as long (an ER bay clean, 40-60 s, is also 'clean')
    expect(longest).toBeGreaterThanOrEqual(CONFIG.staffLife.mopSeconds[1])
  }, 60_000)

  it('visiting ends: the visitors go, a solo companion a ward stays, the café closes at 20:00 and nobody is left in it', () => {
    const sim = new Simulation(3, { startHour: 19.75 })
    run(sim, 40 * 60)
    // 20:30 has passed
    expect(partyVisitors(sim).length).toBeLessThanOrEqual(2 * CONFIG.day.overnightCompanionsPerWard)
    expect([...sim.entities.values()].filter((e) => e.seated?.seatId.startsWith('cafe:'))).toEqual([])
    for (const seat of sim.seats.all.filter((s) => s.kind === 'cafe')) expect(sim.seats.occupant(seat.id), seat.id).toBe('closed:cafe')
    // nobody was told to leave without a goodbye: the farewells were written
    expect(sim.log.events.filter((e) => e.type === 'visitorLeft').length).toBeGreaterThanOrEqual(3)
  }, 60_000)

  it('the café is closed before 07:00 and opens on the hour', () => {
    const sim = new Simulation(3, { startHour: 6 + 58 / 60 })
    const cafeSeats = sim.seats.all.filter((s) => s.kind === 'cafe')
    expect(cafeSeats.length).toBeGreaterThan(0)
    for (const s of cafeSeats) expect(sim.seats.occupant(s.id), s.id).toBe('closed:cafe')
    run(sim, 3 * 60)
    for (const s of cafeSeats) expect(sim.seats.occupant(s.id) === 'closed:cafe', s.id).toBe(false)
  }, 60_000)
})
