/**
 * The bed flow over a busy stretch of the morning (09:45 to 11:30): A1 and B5 go home, their rooms are cleaned and reused by
 * ER admissions, the bed manager boards patients, and the invariants of the whole hospital hold throughout. One run feeds every
 * check below.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { PATIENTS } from '@/content/catalogue'
import { fillDayTemplate } from '@/content/day'
import { CONFIG } from '../config'
import type { Simulation } from '../Simulation'
import { hourToT, makeSim, Recorder, runUntil } from './testkit'
import { watch, type Watch } from './invariants'

const START = 9.75
const END = 11.5

let sim: Simulation
let rec: Recorder
let w: Watch

beforeAll(() => {
  sim = makeSim(2026, START)
  rec = new Recorder(sim)
  const o = watch(sim)
  w = o.out
  runUntil(sim, hourToT(END), rec, o.sample)
}, 240_000)

describe('a planned discharge, step by step', () => {
  it('A1 and B5 are signed on rounds, get their take-home medicines, are collected by family and go home', () => {
    for (const [room, patient, name] of [['A1', 'pt-A1', 'Grace Adeyemi'], ['B5', 'pt-B5', 'Yusuf Demir']] as const) {
      const ev = rec.events.filter((e) => e.subjectId === patient || e.roomId === room)
      const signed = ev.find((e) => e.type === 'dischargeSigned' && e.subjectId === patient)
      const home = ev.find((e) => e.type === 'wentHome' && e.subjectId === patient)
      expect(signed, `${name} signed`).toBeDefined()
      expect(home, `${name} went home`).toBeDefined()
      expect(signed!.text).toBe(fillDayTemplate('dischargeSigned', { doctor: room[0] === 'A' ? 'Dr. Levi' : 'Dr. Okafor', patient: name, room }))
      expect(signed!.roomId).toBe(room)
      expect(home!.roomId).toBe(room)
      expect(home!.t).toBeGreaterThan(signed!.t)
      // the take-home medicines went out as a pod order with source 'discharge', and were given before the patient left
      const order = [...sim.meds.orders.values()].find((o) => o.source === 'discharge' && o.roomId === room && o.patientId === patient)
      expect(order, 'take-home order').toBeDefined()
      expect(order!.stage).toBe('given')
      expect(order!.stageAt.given!).toBeLessThan(home!.t)
      expect(order!.cancelledAt).toBeUndefined()
      // the family came to collect, and left with the patient
      const arrived = rec.events.find((e) => e.type === 'visitorArrived' && e.roomId === room && /collect/.test(e.text))
      const left = rec.events.find((e) => e.type === 'visitorLeft' && e.roomId === room && /left with/.test(e.text))
      expect(arrived, 'family arrived').toBeDefined()
      expect(left, 'family left with the patient').toBeDefined()
      expect(arrived!.t).toBeGreaterThan(signed!.t)
      expect(left!.t).toBeLessThanOrEqual(home!.t + 1)
      // gone for good: no entity, nobody in the bed
      expect(sim.entities.has(patient)).toBe(false)
    }
  })

  it('the bed goes through every stage in order, and the patient changes in the bathroom pod', () => {
    for (const room of ['A1', 'B5']) {
      // the bed's own lifecycle, whatever the door tile shows (a reservation covers 'cleaning' and 'ready' with teal)
      expect(w.lifecycle.get(room)!.slice(0, 6), room).toEqual(['occupied', 'dischargeSigned', 'leaving', 'needsCleaning', 'cleaning', 'ready'])
      const shown = w.stages.get(room)!
      expect(shown.slice(0, 4), room).toEqual(['occupied', 'dischargeSigned', 'leaving', 'needsCleaning'])
    }
    expect(w.sawHidden.has('pt-A1')).toBe(true)
    expect(w.sawHidden.has('pt-B5')).toBe(true)
    expect(w.sawCollectingFamily).toBe(true)
  })

  it('every planned discharge in the window ends with the patient gone home, once', () => {
    const planned = ['pt-A1', 'pt-B5']
    for (const id of planned) expect(rec.events.filter((e) => e.type === 'wentHome' && e.subjectId === id)).toHaveLength(1)
    expect(sim.beds.board.log.wentHome.map((x) => x.patientId).sort()).toEqual(planned)
  })

  it('the room is cleaned (roomCleaned) before anyone is put in it, and its planned patient does not come back', () => {
    const board = sim.beds.board
    expect(board.log.violations).toEqual([])
    for (const room of ['A1', 'B5']) {
      const home = board.log.wentHome.find((x) => x.roomId === room)!
      const cleaned = board.log.cleaned.find((x) => x.roomId === room)!
      expect(cleaned.t).toBeGreaterThan(home.t)
      const next = board.log.delivered.find((x) => x.roomId === room)
      if (next) expect(next.t).toBeGreaterThan(cleaned.t)
      expect(rec.events.find((e) => e.type === 'roomCleaned' && e.roomId === room)?.text).toBe(`Room ${room} is clean and ready.`)
    }
  })
})

describe('admissions into the freed beds', () => {
  it('every assigned bed receives its patient (no room is ever assigned twice at once)', () => {
    const board = sim.beds.board
    const { assigned, delivered } = board.log
    expect(assigned.length).toBeGreaterThanOrEqual(1)
    // this stretch of the morning has a patient who boards for a bed that is still being cleaned
    expect(assigned.some((a) => a.boarding)).toBe(true)
    for (const a of assigned) {
      const d = delivered.find((x) => x.roomId === a.roomId && x.patientId === a.caseId)
      // a patient assigned in the last 15 minutes may still be on the way
      if (a.t < sim.t - 15 * 60) expect(d, `${a.caseId} in ${a.roomId}`).toBeDefined()
      if (d) expect(d.t).toBeGreaterThan(a.t)
    }
    // two assignments to one room never overlap: the next comes after the previous patient arrived (or its reservation ended)
    for (const room of new Set(assigned.map((a) => a.roomId))) {
      const mine = assigned.filter((a) => a.roomId === room)
      for (let i = 1; i < mine.length; i++) {
        const prev = delivered.find((x) => x.roomId === room && x.patientId === mine[i - 1].caseId)
        if (prev) expect(mine[i].t).toBeGreaterThan(prev.t)
      }
    }
  })

  it('writes the bed manager\'s events with a room and a patient id, and the bedside check as admittedToWard', () => {
    for (const e of rec.of('bedAssigned')) {
      expect(e.roomId).toBeDefined()
      expect(e.subjectId).toMatch(/^er-/)
      expect(e.text).toMatch(/^Bed [AB]\d assigned to .+ \(ER bay \d\)\.$/)
    }
    for (const e of rec.of('patientBoarding')) {
      expect(e.roomId).toBeDefined()
      expect(e.subjectId).toBeDefined()
      expect(e.text).toMatch(/is boarding in ER bay \d until bed [AB]\d is ready\.$/)
    }
    const checked = rec.of('admittedToWard')
    expect(checked.length).toBeGreaterThanOrEqual(1)
    for (const e of checked) {
      expect(e.roomId).toBeDefined()
      expect(e.subjectId).toBeDefined()
      expect(e.actorId).toMatch(/^nurse-/)
      expect(e.text).toMatch(/^Nurse \S+ admitted .+ to [AB]\d\.$/)
    }
  })

  it('an admitted patient becomes a ward patient in the bed: same name, a gown, a ward record, no pop', () => {
    const board = sim.beds.board
    for (const d of board.log.delivered) {
      const rec = board.get(d.roomId)
      if (rec.record?.id !== d.patientId) continue // already gone home again
      const status = sim.life.rooms.get(d.roomId)!
      expect(status.patientId).toBe(d.patientId)
      expect(status.patientName).toBe(rec.record.name)
      expect(status.patientAge).toBe(rec.record.age)
      expect(status.patientReason).toBe(rec.record.reason)
      expect(status.dayOfStay).toBe(1)
      const e = sim.entities.get(d.patientId)!
      expect(e.role).toBe('patient')
      expect(e.name).toBe(rec.record.name)
      expect(e.outfit).toBe('gown')
      expect(e.seated?.seatId).toBe(`bed:${d.roomId}`)
      expect(e.fade ?? 1).toBe(1)
    }
  })

  it('the swap from ER patient to ward patient is invisible (the invariants watched it happen at least once)', () => {
    expect(w.swaps).toBeGreaterThanOrEqual(1)
    expect(w.problems.filter((p) => /ward patient/.test(p))).toEqual([])
  })

  it('boarding stays within its limits, and the patient is only taken to the room once the bed is ready', () => {
    expect(w.maxBoarding).toBeLessThanOrEqual(CONFIG.beds.boardingMaxBays)
    expect(w.longestBoarding).toBeLessThanOrEqual(CONFIG.beds.boardingMaxSeconds + 1)
    const board = sim.beds.board
    for (const e of rec.events.filter((x) => x.type === 'porterJob' && /to room [AB]\d\.$/.test(x.text))) {
      const room = e.roomId!
      const cleaned = board.log.cleaned.filter((c) => c.roomId === room && c.t <= e.t)
      // the room was clean when the porter set off (a ready bed that was never discharged today counts: none exist at 09:45)
      expect(cleaned.length, `${room} was cleaned before ${e.text}`).toBeGreaterThan(0)
    }
  })

  it('every ER patient who came in good time has reached a terminal state', () => {
    const er = sim.world.er
    const stuck = [...er.cases.values()].filter((c) => c.arrivedAt < sim.t - 90 * 60)
    expect(stuck.map((c) => `${c.name} ${c.state}`)).toEqual([])
    expect(er.finished.length).toBeGreaterThan(5)
    // anyone who was promised a bed has it, or the reservation ended
    const open = [...sim.beds.board.rooms.values()].filter((r) => r.reservation && sim.t - r.reservation.since > 40 * 60)
    expect(open.map((r) => r.roomId)).toEqual([])
  })
})

describe('visitors', () => {
  it('visit only the patient who is in the bed when they arrive: never an empty room, never the patient who went home', () => {
    const board = sim.beds.board
    const names = new Map<string, { from: number; to: number; name: string }[]>()
    for (const p of PATIENTS) {
      const home = board.log.wentHome.find((x) => x.patientId === p.id)
      const list = names.get(p.roomId) ?? []
      // the planned patient's bed is theirs until the doctor signs: visits stop when they get up to leave
      list.push({ from: -Infinity, to: home ? home.t : Infinity, name: p.name })
      names.set(p.roomId, list)
    }
    for (const d of board.log.delivered) {
      const list = names.get(d.roomId) ?? []
      list.push({ from: d.t, to: Infinity, name: d.patientName })
      names.set(d.roomId, list)
    }
    let regular = 0
    for (const e of rec.of('visitorArrived')) {
      const m = /arrived to visit (.+) in ([AB]\d)\.$/.exec(e.text)
      if (!m) continue
      regular++
      const ok = (names.get(m[2]) ?? []).some((o) => o.name === m[1] && e.t >= o.from && e.t <= o.to)
      expect(ok, e.text + ' at ' + e.t.toFixed(0)).toBe(true)
    }
    expect(regular).toBeGreaterThan(20)
    // a visitor may still arrive just as the patient leaves (a minute's walk), but it is rare
    expect(rec.events.filter((e) => e.type === 'visitorLeft' && /had gone home/.test(e.text)).length).toBeLessThanOrEqual(4)
  })
})

describe('medicines and rounds over the discharge and the admissions', () => {
  it('no rounds order goes to an empty room or a patient who has left, and nothing is cancelled in a normal flow', () => {
    for (const o of w.newOrders) {
      if (o.source === 'sim') expect(o.inBed, `${o.id} ${o.room}`).toBe(true)
    }
    const cancelled = [...sim.meds.orders.values()].filter((o) => o.cancelledAt !== undefined)
    expect(cancelled.map((o) => `${o.id} ${o.roomId} ${o.stage}`)).toEqual([])
    // new admissions are on the rounds: at least one order for an admitted patient
    const delivered = sim.beds.board.log.delivered.map((d) => d.patientId)
    expect(w.newOrders.some((o) => delivered.includes(o.patientId))).toBe(true)
  })

  it('the hospital invariants hold throughout (no standing in doorways, no double-booked seat, riders on the vehicle, drawers)', () => {
    expect(w.problems).toEqual([])
  })
})
