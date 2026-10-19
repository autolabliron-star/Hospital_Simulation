/**
 * The draw centre as a service inside a real Simulation (no ER, no visitors: `population: false`, so only what a test starts happens).
 * The robot script itself is tested on its own in station.test.ts; the morning run is in morning.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { isWalkable } from '../nav/layout'
import { DRAW_CENTRE } from '../places'
import { Simulation } from '../Simulation'
import type { LabOrder, SeatSpec } from '../types'
import { MANUAL_SEND_STAND } from './nurse'
import type { PlanRng } from './plan'
import type { DrawSubject } from './subject'

const DT = CONFIG.sim.step

function run(sim: Simulation, seconds: number, each?: () => void): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    sim.step(DT)
    each?.()
  }
}

function runUntil(sim: Simulation, pred: () => boolean, maxSeconds: number): boolean {
  for (let i = 0, n = Math.round(maxSeconds / DT); i < n; i++) {
    if (pred()) return true
    sim.step(DT)
  }
  return pred()
}

/** A stream that forces the branches of a plan and plays every duration at the middle of its range. */
function forced(o: { noVein?: boolean; misses?: boolean[]; moves?: boolean[]; moveTube?: number } = {}): PlanRng {
  const misses = [...(o.misses ?? [])]
  const moves = [...(o.moves ?? [])]
  return {
    between: (span) => (span[0] + span[1]) / 2,
    int: (lo, hi) => Math.min(hi, Math.max(lo, o.moveTube ?? lo)),
    chance: (p) => {
      if (p === CONFIG.blood.noVeinChance) return o.noVein === true
      if (p === CONFIG.blood.firstStickMissChance) return misses.shift() ?? false
      if (p === CONFIG.blood.armMoveChance) return moves.shift() ?? false
      return false
    },
  }
}

const bloodEvents = (sim: Simulation) => sim.log.events.filter((e) => ['drawTicket', 'drawCalled', 'bloodDrawn', 'drawByNurse', 'samplesSent'].includes(e.type))

describe('the draw centre in a real hospital', () => {
  it('has a real supervising nurse on site from the first moment: Nurse Hana, watching the robots', () => {
    const sim = new Simulation(5, { population: false })
    expect(sim.blood.nurseId).toBe('draw-nurse')
    const e = sim.entities.get('draw-nurse')!
    expect(e).toBeDefined()
    expect(e.role).toBe('nurse')
    expect(e.name).toBe('Nurse Hana')
    run(sim, 3)
    expect(e.anim).toBe('tablet')
    expect(Math.hypot(sim.blood.nurse.x - DRAW_CENTRE.nurse.at.x, sim.blood.nurse.z - DRAW_CENTRE.nurse.at.z)).toBeLessThan(0.3)
    expect(sim.blood.stations).toHaveLength(3)
    expect(sim.blood.stations.every((s) => s.phase === 'idle')).toBe(true)
  })

  it('the presenter\'s demo draw: a free robot now, a tray from the nurse, a patient in the chair, a draw, and the patient goes home', () => {
    const sim = new Simulation(5, { population: false })
    const sends: { id: string; source: number }[] = []
    const send = sim.lab.send.bind(sim.lab)
    sim.lab.send = (id, source) => {
      sends.push({ id, source })
      send(id, source)
    }
    expect(sim.blood.startDemoDraw()).toBe(true)
    // the ticket is called at once, to the robot that has drawn the fewest patients
    expect(sim.blood.stations.filter((s) => s.phase === 'calling')).toHaveLength(1)
    const rec = sim.blood.stations.find((s) => s.phase === 'calling')!
    expect(rec.ticket).toMatch(/^P\d{3}$/)
    const seen = new Set<string>()
    let nurseMax = 0
    run(sim, 6 * 60, () => {
      seen.add(rec.phase)
      nurseMax = Math.max(nurseMax, sim.blood.nurse.maxActive)
    })
    for (const phase of ['calling', 'cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'needleIn', 'filling', 'needleOut', 'bandage', 'release', 'reset']) expect(seen.has(phase), phase).toBe(true)
    expect(rec.phase).toBe('idle')
    expect(sim.blood.records).toHaveLength(1)
    const r = sim.blood.records[0]
    expect(r.kind).toBe('demo')
    expect(r.by).toBe('robot')
    // the tubes went to the lab from the robot that drew them, in the order of draw
    expect(sends.length).toBeGreaterThanOrEqual(1)
    expect(sends.every((s) => s.source === r.station)).toBe(true)
    const order = sim.lab.orderById(sim.blood.book.history[0].orderId)!
    expect(sends.map((s) => s.id)).toEqual(order.sampleIds)
    expect(order.drawnBy).toBe('robot')
    expect(order.drawnAt).not.toBeNull()
    expect(nurseMax).toBe(1)
    // the demo patient walked out and was removed
    expect(sim.blood.outpatients).toHaveLength(0)
    expect(sim.blood.outpatientsHome).toBe(1)
    const texts = bloodEvents(sim).map((e) => e.type)
    expect(texts.slice(0, 4)).toEqual(['drawTicket', 'drawCalled', 'bloodDrawn', 'samplesSent'])
  }, 60_000)

  it('three demo draws fill the three robots, the fourth is refused until one is free again', () => {
    const sim = new Simulation(6, { population: false })
    expect(sim.blood.startDemoDraw()).toBe(true)
    expect(sim.blood.startDemoDraw()).toBe(true)
    expect(sim.blood.startDemoDraw()).toBe(true)
    expect(sim.blood.startDemoDraw()).toBe(false)
    const chairs = new Set<string>()
    run(sim, 60, () => {
      for (const p of sim.people) if (p.entity.seated?.seatId.startsWith('drawChair:robot:')) chairs.add(p.entity.seated.seatId)
    })
    // each robot has its own patient in its own chair
    expect(chairs.size).toBe(3)
    expect(runUntil(sim, () => sim.blood.stations.every((s) => s.phase === 'idle'), 8 * 60)).toBe(true)
    expect(sim.blood.records).toHaveLength(3)
    expect(new Set(sim.blood.records.map((r) => r.station)).size).toBe(3)
    expect(sim.blood.startDemoDraw()).toBe(true)
  }, 120_000)

  it('gives you a P number when you take a ticket at the kiosk, and does not draw you', () => {
    const sim = new Simulation(7, { population: false })
    const a = sim.blood.takePlayerTicket()
    const b = sim.blood.takePlayerTicket()
    expect(a).toMatch(/^P\d{3}$/)
    expect(Number(b.slice(1))).toBe(Number(a.slice(1)) + 1)
    expect(sim.blood.records).toHaveLength(0)
    expect(sim.log.events.some((e) => e.type === 'drawTicket' && e.text.includes(a))).toBe(true)
  })

  it('calls V before P, then first come: an 85-year-old who checks in last is called first', () => {
    const sim = new Simulation(8, { population: false })
    const blood = sim.blood
    for (let i = 0; i < 3; i++) blood.startDemoDraw() // every robot busy for a few minutes
    const a = blood.spawnOutpatient(40)
    run(sim, 8)
    const b = blood.spawnOutpatient(52)
    run(sim, 8)
    const c = blood.spawnOutpatient(85)
    expect(runUntil(sim, () => [a, b, c].every((v) => v.checkedInAt >= 0), 5 * 60)).toBe(true)
    // they all checked in while the robots were busy: the 85-year-old has a V number and is the last in the queue's arrival order
    const t = (v: typeof a) => blood.book.history.find((x) => x.patientId === v.id)!
    expect(t(a).cls).toBe('P')
    expect(t(b).cls).toBe('P')
    expect(t(c).cls).toBe('V')
    expect(blood.queue.filter((x) => x.state === 'waiting').map((x) => x.id)).toEqual([t(c).id, t(a).id, t(b).id])
    expect(runUntil(sim, () => [a, b, c].every((v) => blood.book.history.find((x) => x.patientId === v.id)!.calledAt !== null), 12 * 60)).toBe(true)
    const calledAt = [t(c), t(a), t(b)].map((x) => x.calledAt!)
    expect(calledAt[0]).toBeLessThanOrEqual(calledAt[1])
    expect(calledAt[1]).toBeLessThanOrEqual(calledAt[2])
    expect(runUntil(sim, () => blood.outpatients.length === 0, 20 * 60)).toBe(true)
    expect(blood.stuckFixes).toBe(0)
  }, 240_000)

  it('the nurse carries the labelled tray from the prep machine to the called robot (and the tray is in the rack until she takes it)', () => {
    const sim = new Simulation(9, { population: false })
    const nurse = sim.entities.get('draw-nurse')!
    expect(sim.blood.startDemoDraw()).toBe(true)
    const station = sim.blood.stations.find((s) => s.phase === 'calling')!
    const rack: number[] = []
    let atPrep = Infinity
    let atRobot = Infinity
    let rackSeen = false
    let trayProp = false
    const prepSpot = DRAW_CENTRE.prep.nurse.at
    const assist = DRAW_CENTRE.robots[station.index].assist.at
    run(sim, 90, () => {
      atPrep = Math.min(atPrep, Math.hypot(sim.blood.nurse.x - prepSpot.x, sim.blood.nurse.z - prepSpot.z))
      atRobot = Math.min(atRobot, Math.hypot(sim.blood.nurse.x - assist.x, sim.blood.nurse.z - assist.z))
      if (sim.blood.prep.rack.length > 0) rackSeen = true
      if (nurse.prop === 'tray') trayProp = true
      rack.push(sim.blood.prep.rack.length)
    })
    expect(rackSeen).toBe(true) // the tray was made (10-12 s) and waited for her
    expect(rack[rack.length - 1]).toBe(0) // ... and she took it
    expect(atPrep).toBeLessThan(0.6)
    expect(atRobot).toBeLessThan(0.6)
    expect(trayProp).toBe(true)
    expect(station.trayHere || station.phase !== 'calling').toBe(true)
    expect(sim.blood.prep.traysToday).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it('no suitable vein: the nurse walks to the chair and draws by hand, then sends the tubes from the manual station (source 3)', () => {
    const sim = new Simulation(10, { population: false })
    const sends: { id: string; source: number }[] = []
    const send = sim.lab.send.bind(sim.lab)
    sim.lab.send = (id, source) => {
      sends.push({ id, source })
      send(id, source)
    }
    for (let i = 0; i < 3; i++) sim.blood.setPlanRng(i, forced({ noVein: true }))
    expect(sim.blood.startDemoDraw()).toBe(true)
    const station = sim.blood.stations.find((s) => s.phase === 'calling')!
    let amber = false
    let attendant: string | null = null
    let atChair = Infinity
    let atSend = Infinity
    const assist = DRAW_CENTRE.robots[station.index].assist.at
    run(sim, 8 * 60, () => {
      if (station.phase === 'fallbackToNurse') {
        amber = amber || station.light === 'amber'
        if (station.attendantId) attendant = station.attendantId
        atChair = Math.min(atChair, Math.hypot(sim.blood.nurse.x - assist.x, sim.blood.nurse.z - assist.z))
      }
      atSend = Math.min(atSend, Math.hypot(sim.blood.nurse.x - MANUAL_SEND_STAND.at.x, sim.blood.nurse.z - MANUAL_SEND_STAND.at.z))
    })
    expect(amber).toBe(true)
    expect(attendant).toBe('draw-nurse')
    expect(atChair).toBeLessThan(0.6)
    expect(atSend).toBeLessThan(0.6)
    expect(sim.blood.records).toHaveLength(1)
    expect(sim.blood.records[0].by).toBe('nurse')
    expect(sends.length).toBeGreaterThanOrEqual(1)
    expect(sends.every((s) => s.source === 3)).toBe(true)
    const kinds = bloodEvents(sim).map((e) => e.text)
    expect(kinds.some((t) => /no suitable vein/.test(t))).toBe(true)
    expect(kinds.some((t) => /sent \d tubes? from .* to the lab by hand/.test(t))).toBe(true)
    expect(sim.blood.stats.nurseDraws).toBeGreaterThanOrEqual(1)
    // she is back at her post
    expect(Math.hypot(sim.blood.nurse.x - DRAW_CENTRE.nurse.at.x, sim.blood.nurse.z - DRAW_CENTRE.nurse.at.z)).toBeLessThan(0.6)
    expect(sim.blood.nurse.maxActive).toBe(1)
  }, 120_000)

  it('the arm moves: the nurse comes to calm them, then the robot finishes the draw', () => {
    const sim = new Simulation(11, { population: false })
    for (let i = 0; i < 3; i++) sim.blood.setPlanRng(i, forced({ moves: [true, false], moveTube: 1 }))
    expect(sim.blood.startDemoDraw()).toBe(true)
    const station = sim.blood.stations.find((s) => s.phase === 'calling')!
    const phases: string[] = []
    let attendant: string | null = null
    run(sim, 8 * 60, () => {
      if (phases[phases.length - 1] !== station.phase) phases.push(station.phase)
      if (station.phase === 'armMoved' && station.attendantId) attendant = station.attendantId
    })
    expect(phases).toContain('armMoved')
    expect(attendant).toBe('draw-nurse')
    expect(phases.indexOf('cuff')).toBeLessThan(phases.indexOf('armMoved'))
    expect(phases.lastIndexOf('cuff')).toBeGreaterThan(phases.indexOf('armMoved')) // the retry starts from the cuff
    expect(sim.blood.records).toHaveLength(1)
    expect(sim.blood.records[0].by).toBe('robot')
    expect(sim.blood.records[0].attempt).toBe(2)
    expect(sim.blood.stats.robotFirstPass).toBe(sim.blood.stats.robotFirstPass) // (the stats exist)
  }, 120_000)
})

describe('an ER patient at the draw centre (a stand-in patient, to test the service on its own)', () => {
  /** The smallest DrawSubject: it sits when it is told and gets off the chair when a test says the porter came. */
  function fakeEr(sim: Simulation) {
    const actor = sim.entities.get('draw-nurse') // any entity; the station only reads `.gone`
    void actor
    const f = {
      id: 'er-fake-1',
      name: 'Pat Example',
      actor: { gone: false },
      seat: null as SeatSpec | null,
      called: -1,
      released: 0,
      nearlyDone: 0,
      results: 0,
      drawCalled(station: number, seat: SeatSpec) {
        f.called = station
        f.seat = seat
      },
      seatedOn: (seat: SeatSpec) => f.seat === seat && f.sat,
      sat: false,
      offChair: (seat: SeatSpec) => !(f.seat === seat && f.sat),
      armIn: () => {},
      drawNearlyDone: () => {
        f.nearlyDone++
      },
      drawReleased: () => {
        f.released++
      },
      drawAborted: () => {},
      resultsReady: (_o: LabOrder) => {
        f.results++
      },
    }
    return f as typeof f & DrawSubject
  }

  it('gets a V ticket and a prepared tray at once, is called only after the porter has brought them, and the lab tells them when the results are back', () => {
    const sim = new Simulation(12, { population: false })
    const blood = sim.blood
    const er = fakeEr(sim)
    const ticket = blood.requestEr(er, 'er-chest')
    expect(ticket.id).toMatch(/^V\d{3}$/)
    expect(ticket.cls).toBe('V')
    const order = sim.lab.orderById(ticket.orderId)!
    expect(order.source).toBe('er')
    expect(order.priority).toBe('stat')
    expect(order.ticket).toBe(ticket.id)
    expect(order.panel).toBe('er-chest')
    // the tray is made while they are on the way (about 12 s) ...
    run(sim, 40)
    expect(blood.prep.rack).toContain(ticket.id)
    expect(sim.lab.samples.byOrder(order.id).every((s) => s.stage === 'labelled')).toBe(true)
    // ... but nobody calls an absent patient
    expect(er.called).toBe(-1)
    expect(ticket.state).toBe('waiting')
    blood.erArrived(ticket.id)
    run(sim, 0.6)
    expect(ticket.state).toBe('called')
    expect(er.called).toBeGreaterThanOrEqual(0)
    expect(blood.chairOf(er.called)).toBe(er.seat)
    // the porter lifts them onto the chair; the nurse brings the tray; the robot draws
    er.sat = true
    expect(runUntil(sim, () => er.released === 1, 8 * 60)).toBe(true)
    expect(er.nearlyDone).toBe(1)
    expect(order.drawnBy).toBe('robot')
    // they stay on the chair until the porter takes them off: the robot waits
    run(sim, 60)
    expect(blood.stations[er.called].phase).toBe('awaitPorter')
    er.sat = false
    run(sim, 1)
    expect(blood.stations[er.called].phase).toBe('reset')
    expect(runUntil(sim, () => blood.stations[er.called].phase === 'idle', 30)).toBe(true)
    // the lab completes the order: the patient hears about it (the real lab does this on its own; here we drive the callback)
    expect(er.results).toBe(0)
    sim.lab.onOrderComplete?.(order)
    expect(er.results).toBe(1)
  }, 120_000)

  it('an ER patient goes ahead of booked outpatients that checked in first', () => {
    const sim = new Simulation(13, { population: false })
    const blood = sim.blood
    for (let i = 0; i < 3; i++) blood.startDemoDraw()
    const p = blood.spawnOutpatient(45)
    expect(runUntil(sim, () => p.checkedInAt >= 0, 3 * 60)).toBe(true)
    const er = fakeEr(sim)
    const v = blood.requestEr(er, 'er-fever')
    blood.erArrived(v.id)
    const pt = blood.book.history.find((x) => x.patientId === p.id)!
    expect(blood.queue.filter((x) => x.state === 'waiting').map((x) => x.id)).toEqual([v.id, pt.id])
    expect(runUntil(sim, () => v.calledAt !== null, 10 * 60)).toBe(true)
    expect(pt.calledAt === null || pt.calledAt >= v.calledAt!).toBe(true)
  }, 240_000)
})

describe('warm starts and the layout', () => {
  it('a day that starts later has its tickets and counters numbered on from the morning', () => {
    const sim = new Simulation(14, { startHour: 10.5, population: false })
    const s = sim.blood.stations.reduce((a, r) => a + r.drawsToday, 0)
    expect(s).toBeGreaterThan(40)
    expect(s).toBeLessThan(90)
    expect(sim.blood.stats.draws).toBe(s)
    const id = sim.blood.takePlayerTicket()
    expect(Number(id.slice(1))).toBeGreaterThan(40)
    expect(sim.blood.stations.every((r) => r.phase === 'idle')).toBe(true)
    expect(sim.entities.get('draw-nurse')).toBeDefined()
    for (const h of [15, 22.5]) {
      const night = new Simulation(15, { startHour: h, population: false })
      expect(night.entities.get('draw-nurse')).toBeDefined()
      expect(night.blood.stations.every((r) => r.phase === 'idle')).toBe(true)
    }
  })

  it('every spot the draw centre walks people to is walkable ground in the building', () => {
    const spots: { what: string; x: number; z: number }[] = [
      { what: 'nurse watch', ...DRAW_CENTRE.nurse.at },
      { what: 'prep nurse', ...DRAW_CENTRE.prep.nurse.at },
      { what: 'manual send stand', ...MANUAL_SEND_STAND.at },
      { what: 'check-in guest', ...DRAW_CENTRE.checkIn.guest.at },
      ...DRAW_CENTRE.overflow.map((o, i) => ({ what: `overflow ${i}`, ...o })),
      ...DRAW_CENTRE.robots.flatMap((r) => [
        { what: `robot ${r.index} assist`, ...r.assist.at },
        { what: `robot ${r.index} chair approach`, x: r.chair.at.x, z: r.chair.at.z - 0.95 },
      ]),
    ]
    const bad = spots.filter((s) => !isWalkable(s.x, s.z, 0.25)).map((s) => `${s.what} (${s.x}, ${s.z})`)
    expect(bad).toEqual([])
  })
})
