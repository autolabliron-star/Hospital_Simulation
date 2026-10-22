/**
 * The afternoon from a warm start at 14:15 to 17:45: B2 walks out with family, A8 leaves by porter wheelchair, rooms
 * discharged earlier are already clean or re-occupied, and the hospital's invariants hold. One run feeds every check.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import type { Simulation } from '../Simulation'
import { hourToT, makeSim, Recorder, runUntil } from './testkit'
import { watch, type Watch } from './invariants'

const START = 14.25
const END = 17.75

let sim: Simulation
let rec: Recorder
let w: Watch
let managerTablet = false
/** The room status right after the warm start, before any step. */
let atStart: Map<string, { bed: string; patientId: string | null; since: number }>
let sawPusher = false

beforeAll(() => {
  sim = makeSim(79, START)
  atStart = new Map([...sim.life.rooms].map(([id, r]) => [id, { bed: r.bed, patientId: r.patientId, since: r.since }]))
  rec = new Recorder(sim)
  const o = watch(sim)
  w = o.out
  const a8 = () => sim.entities.get('pt-A8')
  runUntil(sim, hourToT(END), rec, () => {
    o.sample()
    if (sim.entities.get('coord-1')?.anim === 'tablet') managerTablet = true
    const e = a8()
    if (e?.riding && e.vehicle === 'wheelchair') {
      const pair = sim.world.pairs.find((p) => p.rider.entity.id === 'pt-A8')
      if (pair && pair.pusher.entity.role === 'porter' && pair.pusher.entity.anim === 'push') sawPusher = true
    }
  })
}, 900_000)

describe('the warm start at 14:15', () => {
  it('has the morning\'s discharged rooms cleaned or re-occupied, and the two still to come in bed', () => {
    for (const room of ['A1', 'B5', 'B4', 'A6']) {
      const r = atStart.get(room)!
      expect(['needsCleaning', 'ready', 'occupied'], room).toContain(r.bed)
      // a re-occupied room has a synthetic admission, never the planned patient
      if (r.bed === 'occupied') expect(r.patientId).toMatch(/^pt-w-/)
    }
    // B2 (planned 14:45) was signed at 13:45 and waits for the family; A8 (15:30) is signed at 14:30
    expect(atStart.get('B2')).toMatchObject({ bed: 'dischargeSigned', patientId: 'pt-B2' })
    expect(atStart.get('A8')).toMatchObject({ bed: 'occupied', patientId: 'pt-A8' })
    for (const room of ['A2', 'A3', 'B1', 'B8']) expect(atStart.get(room)!.bed).toBe('occupied')
  })
})

describe('B2 walks out, A8 leaves by wheelchair', () => {
  it('both end with wentHome, each once, and the planned patients are gone', () => {
    for (const [id, room] of [['pt-B2', 'B2'], ['pt-A8', 'A8']]) {
      const home = rec.events.filter((e) => e.type === 'wentHome' && e.subjectId === id)
      expect(home, id).toHaveLength(1)
      expect(home[0].roomId).toBe(room)
      // (B2 was already signed at the warm start, which writes no event)
      if (id === 'pt-A8') expect(rec.events.some((e) => e.type === 'dischargeSigned' && e.subjectId === id)).toBe(true)
      expect(sim.entities.has(id)).toBe(false)
    }
  })

  it('A8 (leavesBy wheelchair) rides a porter\'s wheelchair; B2 (walk) does not', () => {
    expect(w.sawWheelchairRider.has('pt-A8')).toBe(true)
    expect(w.sawWheelchairRider.has('pt-B2')).toBe(false)
    expect(sawPusher).toBe(true)
  })

  it('each family came to collect and left with the patient, behind the patient or the porter', () => {
    for (const room of ['B2', 'A8']) {
      const arrived = rec.events.find((e) => e.type === 'visitorArrived' && e.roomId === room && /collect/.test(e.text))
      const left = rec.events.find((e) => e.type === 'visitorLeft' && e.roomId === room && /left with/.test(e.text))
      expect(arrived, room).toBeDefined()
      expect(left, room).toBeDefined()
    }
  })

  it('their beds are cleaned (roomCleaned) and every bed that was assigned got its patient', () => {
    const board = sim.beds.board
    expect(board.log.violations).toEqual([])
    for (const room of ['B2', 'A8']) {
      const home = board.log.wentHome.find((x) => x.roomId === room)!
      expect(board.log.cleaned.find((x) => x.roomId === room && x.t > home.t), `${room} cleaned`).toBeDefined()
    }
    for (const a of board.log.assigned) {
      if (a.t < sim.t - 15 * 60) expect(board.log.delivered.some((d) => d.roomId === a.roomId && d.patientId === a.caseId), `${a.caseId} in ${a.roomId}`).toBe(true)
    }
  })
})

describe('the rest of the hospital while beds turn over', () => {
  it('the coordinator who is the bed manager works the tablet when a bed is assigned', () => {
    expect(sim.beds.board.log.assigned.length).toBeGreaterThan(0)
    expect(managerTablet).toBe(true)
  })

  it('boarding stays within its limits and every ER patient who came in good time reached a terminal state', () => {
    expect(w.maxBoarding).toBeLessThanOrEqual(CONFIG.beds.boardingMaxBays)
    expect(w.longestBoarding).toBeLessThanOrEqual(CONFIG.beds.boardingMaxSeconds + 1)
    const stuck = [...sim.world.er.cases.values()].filter((c) => c.arrivedAt < sim.t - 4 * 3600)
    expect(stuck.map((c) => `${c.name} ${c.state}`)).toEqual([])
  })

  it('no rounds order goes to an empty room or a departed patient, and nothing is cancelled in a normal flow', () => {
    for (const o of w.newOrders) if (o.source === 'sim') expect(o.inBed, `${o.id} ${o.room}`).toBe(true)
    expect([...sim.meds.orders.values()].filter((o) => o.cancelledAt !== undefined).map((o) => o.id)).toEqual([])
  })

  it('the invariants hold throughout (doorways, seats, riders, drawers)', () => {
    expect(w.problems).toEqual([])
  })
})
