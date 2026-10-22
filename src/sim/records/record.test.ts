/**
 * The patient record on a running hospital (09:30 to 12:30): every patient type gets a valid record, the same seed gives the same records, and
 * building records never changes the sim (a twin run without the tablet ends in exactly the same state).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { hourToT, makeSim, runUntil } from '../beds/testkit'
import { CONFIG } from '../config'
import type { Simulation } from '../Simulation'
import { ENTRY_KINDS, buildRecord, recordForRoom, subjectById, type PatientRecordData } from './record'

const START = 9.5
const END = 12.5
const CHUNK = 10 * 60

let withTablet: Simulation
let without: Simulation
let builds = 0

/** What a record must always be. */
function expectValid(r: PatientRecordData): void {
  expect(r.subject.name.length).toBeGreaterThan(0)
  expect(r.history.mrn).toMatch(/^SYN-\d{3}-\d{4}$/)
  expect(r.arrivedAt).toBeLessThanOrEqual(r.now)
  for (let i = 0; i < r.entries.length; i++) {
    const e = r.entries[i]
    expect(ENTRY_KINDS).toContain(e.kind)
    expect(e.at).toBeLessThanOrEqual(r.now)
    expect(e.text, e.text).not.toMatch(/[{}]|undefined|NaN/)
    if (i > 0) expect(e.at).toBeLessThanOrEqual(r.entries[i - 1].at)
  }
  for (const o of r.obs) expect(o.at).toBeLessThanOrEqual(r.now)
  expect(r.problems.length).toBeGreaterThan(0)
  expect(r.plan.length).toBeGreaterThan(0)
  for (const t of [...r.pending, ...r.plan, ...r.problems]) expect(t).not.toMatch(/[{}]/)
}

/** The state a record could touch, as one string. */
function fingerprint(sim: Simulation): string {
  return JSON.stringify({
    t: sim.t,
    events: sim.log.events,
    orders: [...sim.meds.orders.values()],
    queries: sim.meds.openQueries(),
    rooms: [...sim.life.rooms.values()],
    lab: [...sim.life.rooms.keys()].map((r) => sim.lab.ordersFor(sim.life.rooms.get(r)!.patientId ?? '')),
    exams: sim.imaging.exams.length,
    people: sim.people.map((p) => [p.entity.id, p.entity.position.x, p.entity.position.z]),
  })
}

function roomsWithPatients(sim: Simulation): string[] {
  return [...sim.life.rooms.values()].filter((r) => recordForRoom(sim, r.roomId) !== null).map((r) => r.roomId)
}

beforeAll(() => {
  withTablet = makeSim(2026, START)
  without = makeSim(2026, START)
  const end = hourToT(END)
  while (withTablet.t < end) {
    const next = Math.min(end, withTablet.t + CHUNK)
    runUntil(withTablet, next)
    runUntil(without, next)
    // the tablet open on every bed (and on every ER patient) in between
    for (const roomId of withTablet.life.rooms.keys()) {
      recordForRoom(withTablet, roomId)
      builds++
    }
    for (const id of withTablet.world.patients.keys()) {
      const s = subjectById(withTablet, id)
      if (s) buildRecord(withTablet, s)
    }
  }
}, 900_000)

describe('the record adapter', () => {
  it('never changes the sim: the run with the tablet open ends exactly like the run without it', () => {
    expect(builds).toBeGreaterThan(100)
    expect(fingerprint(withTablet)).toBe(fingerprint(without))
  })

  it('is deterministic: the same seed gives the same record for every bed', () => {
    for (const roomId of withTablet.life.rooms.keys()) {
      expect(JSON.stringify(recordForRoom(withTablet, roomId))).toBe(JSON.stringify(recordForRoom(without, roomId)))
    }
  })

  it('gives every occupied ward bed a valid record', () => {
    const rooms = roomsWithPatients(withTablet)
    expect(rooms.length).toBeGreaterThan(10)
    for (const roomId of rooms) expectValid(recordForRoom(withTablet, roomId)!)
  })

  it('tells the stay so far of a catalogue inpatient: arrival, triage, tests, the ward, rounds, observations and doses', () => {
    const b3 = recordForRoom(withTablet, 'B3')!
    expect(b3.subject.name).toBe('Ingrid Solberg')
    expect(b3.stay.id).toBe('heart-failure')
    const daysBack = Math.floor(b3.arrivedAt / 86400)
    expect(daysBack).toBe(-7)
    const kinds = new Set(b3.entries.map((e) => e.kind))
    for (const k of ENTRY_KINDS) expect(kinds.has(k), k).toBe(true)
    expect(b3.entries.some((e) => /^Arrived at the ER/.test(e.text))).toBe(true)
    expect(b3.entries.some((e) => /^Triage category 3/.test(e.text))).toBe(true)
    expect(b3.entries.some((e) => /^Ward round \(Dr\. Okafor\)/.test(e.text))).toBe(true)
    expect(b3.entries.some((e) => /^08:00 medicines given: Furosemide 40 mg, Bisoprolol 2.5 mg/.test(e.text))).toBe(true)
    expect(b3.obs.length).toBeGreaterThan(10)
    expect(b3.meds.map((m) => m.medId)).toEqual(expect.arrayContaining(['furosemide', 'bisoprolol']))
  })

  it('gives a patient admitted from the ER during the run their live ER story', () => {
    const admitted = [...withTablet.life.rooms.values()]
      .map((r) => recordForRoom(withTablet, r.roomId))
      .filter((r): r is PatientRecordData => r !== null && !r.subject.id.startsWith('pt-'))
    expect(admitted.length).toBeGreaterThan(0)
    for (const r of admitted) {
      expectValid(r)
      expect(r.wardAt).not.toBeNull()
      expect(r.entries.some((e) => e.kind === 'movement' && /arrived at the ER|admitted/i.test(e.text))).toBe(true)
    }
  })

  it('gives an ER patient, a surgery patient and an outpatient a valid record too', () => {
    const er = [...withTablet.world.patients.keys()][0]
    if (er) expectValid(buildRecord(withTablet, subjectById(withTablet, er)!))
    const sx = withTablet.surgery.state.theatre.cases.find((c) => c.patientId !== null)
    expect(sx).toBeDefined()
    const sxRecord = buildRecord(withTablet, subjectById(withTablet, sx!.patientId!)!)
    expectValid(sxRecord)
    expect(sxRecord.subject.kind).toBe('surgery')
    const op = withTablet.imaging.outpatients[0]
    if (op) {
      const r = buildRecord(withTablet, subjectById(withTablet, op.entity.id)!)
      expectValid(r)
      expect(r.subject.kind).toBe('outpatient')
    }
  })

  it('shows your amoxicillin for A2 as an allergy query, held, in the timeline and the alerts', () => {
    const before = recordForRoom(withTablet, 'A2')!
    expect(before.history.allergies[0].agent).toBe('Penicillin')
    const r = withTablet.prescribe('A2', [{ medId: 'amoxicillin', qty: 1 }])
    expect(r.ok && r.query?.reasons[0].kind).toBe('allergy')
    for (let i = 0; i < 600; i++) withTablet.step(CONFIG.sim.step)
    const after = recordForRoom(withTablet, 'A2')!
    expect(after.entries.some((e) => e.flag === 'allergy' && /ALLERGY/.test(e.text))).toBe(true)
    expect(after.alerts.some((a) => a.kind === 'query' && a.allergy)).toBe(true)
    expect(after.meds.find((m) => m.medId === 'amoxicillin')?.next.kind).toBe('held')
    if (r.ok) expect(r.order.stage).toBe('prescribed')
  })
})
