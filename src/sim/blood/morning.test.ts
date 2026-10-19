/**
 * A whole simulated morning, 07:30 to 12:30, with the full hospital, checked as it runs: the draw centre keeps its promises
 * (docs/W4-DIAGNOSTICS.md, "Tests"). About a million fixed steps; under a minute.
 *
 * The lab is whatever the Simulation has: when it is the real one it completes the orders; `emulateLab` only adds a completion
 * for an order the lab has not completed, so a lab that is still a skeleton cannot hide a stuck patient.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import type { ErPatient } from '../er/patient'
import { Simulation } from '../Simulation'
import { emulateLab } from './testkit'

const DT = CONFIG.sim.step
const hour = (h: number) => (h - CONFIG.sim.startHour) * 3600
const SAMPLE_EVERY = 30

describe('a whole morning at the blood draw centre', () => {
  it('draws everybody, never double-books a robot or a chair, and every ER blood journey ends with the lab', () => {
    const sim = new Simulation(2026)
    const blood = sim.blood
    // a backstop only: the real lab completes an order in about 16-22 minutes; if it ever stalls, the stand-in completes it after 40-45
    const emu = emulateLab(sim, [40, 45])
    // when each order was first completed (the stand-in and the real lab may both report)
    const firstComplete = new Map<string, number>()
    const previous = sim.lab.onOrderComplete
    sim.lab.onOrderComplete = (o) => {
      if (!firstComplete.has(o.id)) firstComplete.set(o.id, sim.t)
      previous?.(o)
    }
    const problems: string[] = []
    const firstSeen = new Map<string, number>()
    interface ErTrack {
      p: ErPatient
      awaitingFrom: number | null
      awaitingTo: number | null
      decisionAt: number | null
      ticket: string | null
    }
    const er = new Map<string, ErTrack>()
    let maxQueue = 0
    let maxChairHolders = 0
    // the results lounge: discharge-bound ER blood patients wait for the lab in a hall chair, not in a bay
    const lounge = new Set<string>()
    const loungeBayFreed: string[] = []
    const end = hour(12.5)
    let steps = 0
    let simMs = 0

    while (sim.t < end) {
      const t0 = performance.now()
      for (let k = 0; k < SAMPLE_EVERY; k++) sim.step(DT)
      simMs += performance.now() - t0
      steps += SAMPLE_EVERY
      if (steps % 60 === 0) emu.tick()

      // no robot or ticket is ever double-booked
      const tickets = new Set<string>()
      const patients = new Set<string>()
      for (const s of blood.stations) {
        if (s.ticket !== null) {
          if (tickets.has(s.ticket) && problems.length < 20) problems.push(`${sim.t.toFixed(0)}s ticket ${s.ticket} is on two robots`)
          tickets.add(s.ticket)
        }
        if (s.patientId !== null) {
          if (patients.has(s.patientId) && problems.length < 20) problems.push(`${sim.t.toFixed(0)}s patient ${s.patientId} is on two robots`)
          patients.add(s.patientId)
        }
      }
      // one body per robot chair
      const holders = new Map<string, string>()
      for (const p of sim.people) {
        const id = p.entity.seated?.seatId
        if (!id || !id.startsWith('drawChair:robot:')) continue
        const other = holders.get(id)
        if (other && problems.length < 20) problems.push(`${sim.t.toFixed(0)}s chair ${id} holds ${other} and ${p.entity.id}`)
        holders.set(id, p.entity.id)
      }
      maxChairHolders = Math.max(maxChairHolders, holders.size)
      // no seat in the hospital is held by two bodies (the hall chairs of the lounge included)
      const seatedBy = new Map<string, string>()
      for (const p of sim.people) {
        const id = p.entity.seated?.seatId
        if (!id) continue
        const other = seatedBy.get(id)
        if (other && problems.length < 20) problems.push(`${sim.t.toFixed(0)}s seat ${id} holds ${other} and ${p.entity.id}`)
        seatedBy.set(id, p.entity.id)
      }
      maxQueue = Math.max(maxQueue, blood.queue.length)
      if (blood.nurse.maxActive > 1 && problems.length < 20) problems.push(`${sim.t.toFixed(0)}s the nurse handled two alerts at once`)

      for (const v of blood.outpatients) if (!firstSeen.has(v.id)) firstSeen.set(v.id, sim.t)
      for (const p of sim.world.patients.values()) {
        let tr = er.get(p.c.id)
        if (!tr && p.liveBlood) {
          tr = { p, awaitingFrom: null, awaitingTo: null, decisionAt: null, ticket: null }
          er.set(p.c.id, tr)
        }
        if (!tr) continue
        if (p.drawTicket) tr.ticket = p.drawTicket.id
        if (p.loungeActive) {
          lounge.add(p.c.id)
          // off the trolley: the bay is not theirs any more, and the lounge chair is where they are taken back to
          if (p.state.startsWith('tests') && (p.c.bay !== -1 || p.baySeat !== p.loungeSeat)) loungeBayFreed.push(`${p.c.name} ${p.state} bay ${p.c.bay}`)
        }
        if (p.state === 'tests.awaitingResults' && tr.awaitingFrom === null) tr.awaitingFrom = sim.t
        if (p.state !== 'tests.awaitingResults' && tr.awaitingFrom !== null && tr.awaitingTo === null) tr.awaitingTo = sim.t
        if (p.state === 'decision' && tr.decisionAt === null) tr.decisionAt = sim.t
      }
    }

    const records = blood.records
    const by1030 = records.filter((r) => r.doneAt <= hour(10.5))
    const peakP = records.filter((r) => r.cls === 'P' && r.readyAt >= hour(7.5) && r.readyAt <= hour(9.5))
    const peakMaxP = Math.max(...peakP.map((r) => r.waitedMin))
    const meanV = blood.meanWaitMin('V')
    const meanP = blood.meanWaitMin('P')
    const nurseShare = records.filter((r) => r.by === 'nurse').length / records.length
    const firstPass = records.filter((r) => r.by === 'robot' && r.attempt === 1).length / records.length
    const finished = [...er.values()].filter((e) => e.p.outcome !== null)
    const erDraws = records.filter((r) => r.kind === 'er')
    const stepUs = (simMs / steps) * 1000
    const longestNurseQueue = blood.nurse.queued
    console.log(
      `[W4 B] draws ${records.length} (by 10:30: ${by1030.length}), P mean wait ${meanP?.toFixed(1)} min, peak P max ${peakMaxP.toFixed(1)} min, V mean wait ${meanV?.toFixed(1)} min; ` +
        `nurse share ${(nurseShare * 100).toFixed(1)} %, robot first-pass ${(firstPass * 100).toFixed(1)} %, queue max ${maxQueue}, nurse alerts ${blood.nurse.alertsHandled} (trays ${blood.nurse.trays}, hand draws ${blood.nurse.handDraws}); ` +
        `ER blood patients ${er.size} (${lounge.size} waited in the lounge), finished ${finished.length}, ER draws ${erDraws.length}; outpatients ${blood.outpatientsSpawned} spawned, ${blood.outpatientsHome} home; step ${stepUs.toFixed(1)} µs`,
    )
    void longestNurseQueue
    for (const e of er.values()) {
      if (e.ticket === null) continue
      const t = blood.book.history.find((x) => x.id === e.ticket)!
      const o = sim.lab.orderById(t.orderId)!
      console.log(
        `[W4 B ER] ${e.p.c.name} ${e.ticket} ${o.panel} ordered ${o.orderedAt.toFixed(0)} drawn ${o.drawnAt?.toFixed(0)} received ${o.receivedAt?.toFixed(0)} complete ${firstComplete.get(o.id)?.toFixed(0)} | awaiting ${e.awaitingFrom?.toFixed(0)}-${e.awaitingTo?.toFixed(0)} decision ${e.decisionAt?.toFixed(0)} outcome ${e.p.outcome}`,
      )
    }

    expect(problems).toEqual([])
    expect(loungeBayFreed).toEqual([])
    expect(lounge.size).toBeGreaterThanOrEqual(1)
    for (const id of lounge) {
      const t = er.get(id)!
      // a lounge patient is a discharge: nobody who is admitted leaves their bay for the hall
      if (t.p.outcome !== null) expect(t.p.outcome, `${t.p.c.name}`).toBe('discharged')
    }
    expect(blood.stuckFixes).toBe(0)
    expect(blood.chairConflicts).toBe(0)
    expect(blood.nurse.stuckFixes).toBe(0)
    expect(blood.nurse.maxActive).toBe(1)
    // nothing stuck: every ticket issued in good time is done, every outpatient who came in good time went home
    const open = [...blood.book.open.values()].filter((e) => e.ticket.issuedAt < end - 40 * 60).map((e) => `${e.ticket.id} ${e.ticket.state}`)
    expect(open).toEqual([])
    const stillHere = blood.outpatients.filter((v) => (firstSeen.get(v.id) ?? end) < end - 40 * 60).map((v) => `${v.name} ${v.state}`)
    expect(stillHere).toEqual([])
    expect(blood.outpatientsHome).toBeGreaterThan(blood.outpatientsSpawned - 8)
    // the numbers the plan asked for
    expect(by1030.length).toBeGreaterThanOrEqual(60)
    expect(peakMaxP).toBeLessThanOrEqual(30)
    expect(meanV).not.toBeNull()
    expect(meanV!).toBeLessThanOrEqual(5)
    expect(nurseShare).toBeGreaterThan(0.01)
    expect(nurseShare).toBeLessThan(0.15)
    expect(maxChairHolders).toBeGreaterThanOrEqual(2)
    // every ER blood patient who came in good time was through the department (and was drawn) by 12:30
    expect(er.size).toBeGreaterThan(0)
    const stuck = [...er.values()].filter((e) => e.p.c.arrivedAt < end - 90 * 60 && e.p.outcome === null).map((e) => `${e.p.c.name} ${e.p.state}`)
    expect(stuck).toEqual([])
    for (const e of er.values()) {
      if (e.ticket === null) continue
      const t = blood.book.history.find((x) => x.id === e.ticket)!
      // a drawn patient's ticket is done; a patient still on the way at 12:30 may not be
      if (e.p.c.arrivedAt < end - 90 * 60) expect(t.state, `${e.p.c.name} ${e.ticket}`).toBe('done')
      // the results wait for the lab: they leave `awaitingResults` when the order completes (or at the fallback bound)
      if (e.awaitingFrom !== null && e.awaitingTo !== null) {
        const order = sim.lab.orderById(t.orderId)!
        const waited = e.awaitingTo - e.awaitingFrom
        const done = firstComplete.get(order.id)
        if (done !== undefined && done > e.awaitingFrom) {
          expect(e.awaitingTo, `${e.p.c.name} left before the lab finished`).toBeGreaterThanOrEqual(done - 0.6)
          expect(e.awaitingTo - done, `${e.p.c.name} waited on after the lab finished`).toBeLessThanOrEqual(2)
        } else expect(waited).toBeGreaterThanOrEqual(0)
      }
    }
    // the sim stays cheap with the draw centre in it
    expect(stepUs).toBeLessThanOrEqual(600)
  }, 900_000)
})
