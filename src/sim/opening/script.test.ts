import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'

const SEED = 5

function showcase(seed = SEED): Simulation {
  return new Simulation(seed, { inFlight: true, opening: 'showcase' })
}

function openingOrders(sim: Simulation) {
  return [...sim.meds.orders.values()].filter((o) => o.source === 'sim')
}

describe('opening script (showcase)', () => {
  it('has MedVend picking and a pod out on the rail, and visitors in place, after the pre-roll', () => {
    const sim = showcase()
    sim.preRoll(CONFIG.opening.preRollSeconds)
    const orders = openingOrders(sim)
    expect(orders.length).toBe(CONFIG.opening.medsAt.length * 2)
    expect(new Set(orders.map((o) => o.ward))).toEqual(new Set(['A', 'B']))
    expect(new Set(orders.map((o) => o.roomId)).size).toBe(orders.length)
    for (const o of orders) expect(o.prescriberId).not.toBe('presenter')
    const picking = ['picking', 'enRoute'] as const
    const inPick = orders.some((o) => (picking as readonly string[]).includes(o.stage))
    const gantryBusy = (['A', 'B'] as const).some((w) => sim.meds.dispensers[w].gantry.state !== 'idle')
    expect(inPick || gantryBusy).toBe(true)
    expect(sim.meds.fleet.drivers.some((d) => d.pod.state !== 'charging')).toBe(true)
    const parties = sim.director!.parties
    expect(parties.length).toBeGreaterThan(0)
    // the bedside parties plus one party in each wing's lounge
    expect(parties.length).toBeLessThanOrEqual(CONFIG.opening.visitorParties + 2)
    const kinds = new Set(parties.flatMap((p) => p.members.map((m) => m.place.kind)))
    expect([...kinds].some((k) => k === 'chair' || k === 'window')).toBe(true)
    // S1: loungeA and quietB each have somebody in them at the opening
    for (const area of ['loungeA', 'quietB'] as const) {
      const seated = parties.flatMap((p) => p.members).some((m) => m.place.kind === 'lounge' && m.place.seat.area === area && !m.gone)
      expect(seated, area).toBe(true)
    }
  }, 60000)

  it('is deterministic', () => {
    const run = () => {
      const s = showcase(9)
      s.preRoll(CONFIG.opening.preRollSeconds)
      return JSON.stringify({
        o: openingOrders(s).map((o) => [o.roomId, o.stage, o.items]),
        v: s.director!.parties.map((p) => [p.room.id, p.members.map((m) => m.place.kind)]),
      })
    }
    expect(run()).toBe(run())
  }, 60000)

  it('every opening order is given and the visitors leave by 10:00', () => {
    const sim = showcase()
    sim.preRoll(CONFIG.opening.preRollSeconds)
    const orders = openingOrders(sim)
    const parties = [...sim.director!.parties]
    const members = parties.flatMap((p) => p.members)
    sim.preRoll(2.5 * 3600 - CONFIG.opening.preRollSeconds)
    for (const o of orders) expect(o.stage, o.id).toBe('given')
    expect(members.length).toBeGreaterThan(0)
    expect(members.every((m) => m.gone)).toBe(true)
  }, 240000)
})

describe('quiet start', () => {
  it('writes no opening orders and places no visitors', () => {
    const sim = new Simulation(SEED)
    sim.preRoll(60)
    // the doctors' own rounds may have written one by now, but nothing is scripted at the start
    expect([...sim.meds.orders.values()].some((o) => o.createdAt < 1)).toBe(false)
    expect(sim.director!.parties.length).toBe(0)
  }, 60000)
})
