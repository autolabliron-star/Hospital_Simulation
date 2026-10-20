/**
 * S1: the draw centre's in-flight warm. With `inFlight: true` the showcase opens on robots that are already drawing: CONFIG.opening.drawChairs
 * outpatients in the chairs, the needle in or a tube filling, the nurse at her post, the tray already there. Everything then finishes normally.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'

const DT = CONFIG.sim.step
const SEED = 11
const open = (seed: number, startHour?: number) => new Simulation(seed, { inFlight: true, opening: 'showcase', startHour })
const AT_WORK = ['needleIn', 'filling']

function run(sim: Simulation, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) sim.step(DT)
}

describe('draw centre in-flight warm', () => {
  it('at the 07:30 opening the robots are at the needle or filling, patients seated, nurse present', () => {
    const sim = open(SEED)
    const placed = sim.blood.outpatients.slice()
    expect(placed).toHaveLength(CONFIG.opening.drawChairs)
    expect(sim.log.events.filter((e) => e.type.startsWith('draw') || e.type.startsWith('blood') || e.type === 'samplesSent')).toHaveLength(0)
    sim.preRoll(CONFIG.opening.preRollSeconds)
    const busy = sim.blood.stations.filter((s) => AT_WORK.includes(s.phase))
    expect(busy.length).toBeGreaterThanOrEqual(2)
    expect(busy.length).toBe(CONFIG.opening.drawChairs)
    for (const s of busy) {
      expect(s.trayHere).toBe(true)
      expect(s.patientId).not.toBeNull()
    }
    // each placed patient sits in the chair of their robot with the arm in the cradle
    for (const p of placed) {
      expect(p.seat?.kind).toBe('drawChair')
      expect(p.entity.anim).toBe('armIn')
    }
    expect(new Set(busy.map((s) => `${s.phase}${s.tube}`)).size).toBeGreaterThanOrEqual(2)
    expect(sim.blood.nurse.onSite).toBe(true)
    expect(sim.blood.nurse.stuckFixes).toBe(0)
    expect(sim.blood.stuckFixes).toBe(0)
  }, 120_000)

  it('holds for other seeds and hours (07:30 pre-roll 50 s, Jumps 60 s)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const a = open(seed)
      a.preRoll(CONFIG.opening.preRollSeconds)
      expect(a.blood.stations.filter((s) => AT_WORK.includes(s.phase)).length, `seed ${seed}`).toBe(CONFIG.opening.drawChairs)
    }
    for (const hour of [7, 8.25, 12, 16.5]) {
      const a = open(SEED, hour)
      a.preRoll(CONFIG.day.jumpPreRollSeconds)
      expect(a.blood.stations.filter((s) => AT_WORK.includes(s.phase)).length, `hour ${hour}`).toBe(CONFIG.opening.drawChairs)
    }
  }, 240_000)

  it('is deterministic', () => {
    const fp = (seed: number) => {
      const sim = open(seed)
      sim.preRoll(CONFIG.opening.preRollSeconds)
      return JSON.stringify([
        sim.blood.stations.map((s) => [s.phase, s.ticket, s.patientName, s.tube, Math.round(s.phaseTime * 100), s.tubes]),
        sim.blood.outpatients.map((p) => [p.id, p.name, p.age, p.panel]),
        sim.blood.book.history.map((t) => [t.id, t.issuedAt, t.calledAt]),
      ])
    }
    expect(fp(SEED)).toBe(fp(SEED))
    expect(fp(SEED + 1)).not.toBe(fp(SEED))
  }, 120_000)

  it('a Jump lands at the needle too, and nothing is placed outside the opening hours', () => {
    const sim = open(SEED, 9)
    sim.preRoll(CONFIG.day.jumpPreRollSeconds)
    expect(sim.blood.stations.filter((s) => AT_WORK.includes(s.phase)).length).toBeGreaterThanOrEqual(2)
    const early = open(SEED, 6)
    expect(early.blood.outpatients).toHaveLength(0)
    expect(early.blood.stations.every((s) => s.phase === 'idle')).toBe(true)
  }, 120_000)

  it('every placed draw finishes, the patients leave and the tubes reach the lab', () => {
    const sim = open(SEED)
    const placed = sim.blood.outpatients.slice()
    sim.preRoll(CONFIG.opening.preRollSeconds)
    run(sim, 30 * 60)
    const records = sim.blood.records
    const tickets = new Set(sim.blood.book.history.slice(0, CONFIG.opening.drawChairs).map((t) => t.id))
    for (const id of tickets) {
      const r = records.find((x) => x.ticket === id)
      expect(r, id).toBeDefined()
      expect(r!.by).toBe('robot')
      const order = sim.lab.orderById(sim.blood.book.history.find((t) => t.id === id)!.orderId)!
      expect(order.drawnAt).not.toBeNull()
      for (const sid of order.sampleIds) {
        expect(['received', 'onTrack', 'centrifuge', 'decap', 'analysing', 'recap', 'archived']).toContain(sim.lab.samples.get(sid)!.stage)
      }
    }
    for (const p of placed) {
      expect(p.home).toBe(true)
      expect(sim.blood.outpatients.includes(p)).toBe(false)
    }
    expect(sim.blood.stuckFixes).toBe(0)
    expect(sim.blood.nurse.stuckFixes).toBe(0)
    expect(sim.blood.chairConflicts).toBe(0)
  }, 300_000)

  it('without inFlight the robots start idle, as before', () => {
    const sim = new Simulation(SEED)
    sim.preRoll(10)
    expect(sim.blood.stations.every((s) => s.phase === 'idle')).toBe(true)
    expect(sim.blood.outpatients).toHaveLength(0)
  }, 60_000)
})
