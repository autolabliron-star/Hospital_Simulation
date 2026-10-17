/**
 * M3 gate (docs/M3-BEHAVIOURS.md, "Determinism and tests"): one whole simulated morning, 07:30 to 12:30, with the
 * full population, checked as it runs. About a million fixed steps; the sim itself costs tens of microseconds a step,
 * so this takes well under a minute.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { DOORS, VEHICLE_AHEAD } from './places'
import { Simulation } from './Simulation'

const DT = CONFIG.sim.step
const hour = (h: number) => (h - CONFIG.sim.startHour) * 3600
/** Invariants are sampled every half second of sim time. */
const SAMPLE_EVERY = 30

interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** Every doorway as a small rectangle in the wall opening (exterior doors included). */
const DOORWAYS: { id: string; r: Rect }[] = DOORS.filter((d) => d.kind !== 'opening').map((d) => {
  const half = d.width / 2
  const r =
    d.wallAxis === 'x'
      ? { x0: d.center.x - half, x1: d.center.x + half, z0: d.center.z - 0.35, z1: d.center.z + 0.35 }
      : { x0: d.center.x - 0.35, x1: d.center.x + 0.35, z0: d.center.z - half, z1: d.center.z + half }
  return { id: `door:${d.id}`, r }
})

const inside = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1

describe('a whole morning with the full population (M3 gate)', () => {
  it('keeps every promise of the behaviours brief', () => {
    const sim = new Simulation(2026)
    const stillIn = new Map<string, number>()
    const problems: string[] = []
    let at1030: { people: number; lobby: { taken: number; total: number }; byRole: Record<string, number> } | null = null
    let simMs = 0
    let steps = 0

    const end = hour(12.5)
    while (sim.t < end) {
      const t0 = performance.now()
      for (let k = 0; k < SAMPLE_EVERY; k++) sim.step(DT)
      simMs += performance.now() - t0
      steps += SAMPLE_EVERY

      // nobody stands still inside a doorway for more than 2 s
      const sample = SAMPLE_EVERY * DT
      for (const p of sim.people) {
        if (!p.mobile || p.entity.seated || p.entity.riding) continue
        const w = p.walker
        const zone = w.speed < 0.05 ? DOORWAYS.find((z) => inside(z.r, w.x, w.z)) : undefined
        const key = p.entity.id
        if (!zone) {
          stillIn.delete(key)
          continue
        }
        const held = (stillIn.get(key) ?? 0) + sample
        stillIn.set(key, held)
        if (held > 2 + 1e-9 && problems.length < 20) problems.push(`${sim.t.toFixed(0)}s ${p.entity.name} (${p.entity.role}) still in ${zone.id} for ${held.toFixed(1)} s`)
      }

      // no seat is ever held by two people
      const seatedBy = new Map<string, string>()
      for (const p of sim.people) {
        const id = p.entity.seated?.seatId
        if (!id) continue
        const other = seatedBy.get(id)
        if (other && problems.length < 20) problems.push(`${sim.t.toFixed(0)}s seat ${id} holds ${other} and ${p.entity.id}`)
        seatedBy.set(id, p.entity.id)
      }

      // riders sit on the vehicle, in front of whoever pushes them (once on board: getting on and off is a short slide)
      for (const { pusher, rider } of sim.world.pairs) {
        const kind = rider.entity.vehicle ?? 'none'
        if (kind === 'none' || rider.mode !== 'ride') continue
        const pw = pusher.walker
        const ahead = VEHICLE_AHEAD[kind]
        const ex = pw.x + Math.sin(pw.heading) * ahead
        const ez = pw.z + Math.cos(pw.heading) * ahead
        const off = Math.hypot(rider.walker.x - ex, rider.walker.z - ez)
        if (off > 0.3 && problems.length < 20) problems.push(`${sim.t.toFixed(0)}s ${rider.entity.name} is ${off.toFixed(2)} m off ${pusher.entity.name}'s ${kind}`)
      }

      if (!at1030 && sim.t >= hour(10.5)) {
        const byRole: Record<string, number> = {}
        for (const e of sim.entities.values()) byRole[e.role] = (byRole[e.role] ?? 0) + 1
        at1030 = { people: sim.entities.size, lobby: sim.seats.occupancy({ kind: 'waiting', area: 'lobby' }), byRole }
      }
    }

    const er = sim.world.er
    const outcomes = { discharged: 0, admitted: 0, lwbs: 0 }
    for (const f of er.finished) outcomes[f.outcome]++
    const los = er.finished
      .filter((f) => f.outcome !== 'lwbs')
      .map((f) => (f.endedAt - f.arrivedAt) / 60)
      .sort((a, b) => a - b)
    const stepUs = (simMs / steps) * 1000
    console.log(
      `[M3] 10:30 population ${at1030?.people} ${JSON.stringify(at1030?.byRole)}; lobby ${at1030?.lobby.taken}/${at1030?.lobby.total}; ` +
        `ER finished ${er.finished.length} ${JSON.stringify(outcomes)}, median stay ${los[Math.floor(los.length / 2)]?.toFixed(0)} min; ` +
        `longest wait for cleaning ${er.maxCleanWait.toFixed(0)} s; step ${stepUs.toFixed(1)} µs`,
    )

    expect(problems).toEqual([])
    // the busy hour
    expect(at1030).not.toBeNull()
    expect(at1030!.people).toBeGreaterThanOrEqual(80)
    expect(at1030!.people).toBeLessThanOrEqual(130)
    expect(at1030!.lobby.taken / at1030!.lobby.total).toBeGreaterThanOrEqual(0.8)
    // everyone who came to the ER in good time is through it by 12:30 (discharged, admitted or gave up)
    const stuck = [...er.cases.values()].filter((c) => c.arrivedAt < end - 90 * 60)
    expect(stuck.map((c) => `${c.name} ${c.state} since ${(c.arrivedAt / 60).toFixed(0)} min`)).toEqual([])
    expect(er.finished.length).toBeGreaterThan(40)
    expect(outcomes.lwbs).toBeLessThanOrEqual(Math.ceil(er.finished.length / 10))
    // bays are cleaned promptly
    expect(er.maxCleanWait).toBeLessThanOrEqual(5 * 60)
    // the sim stays cheap with everyone in it
    expect(stepUs).toBeLessThanOrEqual(600)
    // and the medicine story still runs: the doctors prescribe and the nurses give
    const orders = [...sim.meds.orders.values()]
    expect(orders.length).toBeGreaterThan(20)
    expect(orders.filter((o) => o.createdAt < end - 25 * 60 && o.stage !== 'given')).toEqual([])
  }, 600_000)
})
