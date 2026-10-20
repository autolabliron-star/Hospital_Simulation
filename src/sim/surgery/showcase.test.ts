/**
 * S1: the showcase day, run for real. A MiniHospital (../lifts/testkit) runs whole days cheaply from any Jump hour; a few full Simulations
 * check the opening as the app builds it (`opening: 'showcase'`, then the 50 s hidden pre-roll) and one whole showcase day with everybody else in.
 */
import { describe, expect, it } from 'vitest'
import { buildLayout } from '@/scene/building/layout'
import { footprintDistance } from '@/scene/building/layout/builder'
import { CONFIG } from '../config'
import { levelOf } from '../levels'
import { isWalkable } from '../nav/layout'
import { tryPlanRoute } from '../nav/graph'
import { SURGERY, THEATRE_BASE, areaById } from '../places'
import { timeAtHour } from '../population/schedule'
import { Simulation } from '../Simulation'
import { timelineOf } from './plan'
import { suite } from './testkit'
import { traceDay, type Trace } from './trace'

const SC = CONFIG.surgery.showcase
const PREOP_BAYS = 4
const PACU_BAYS = 3
const SEEDS = [2, 17, 101, 2026, 4242, 7001, 8128, 9001, 31415, 65537]
const MOMENTS = [CONFIG.day.startHour, ...CONFIG.day.moments]

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

function expectCleanDay(tr: Trace, where: string): void {
  const s = tr.surgery
  expect(s.runs.map((c) => c.stage), where).toEqual(s.plan.map(() => 'done'))
  expect(s.stuckFixes, `${where} ${s.stuckLog.join(' | ')}`).toBe(0)
  expect(s.stuckLog, where).toEqual([])
  expect(tr.h.lifts.stuckLog, where).toEqual([])
  expect(tr.problems, where).toEqual([])
  expect(tr.stills, where).toEqual([])
  expect(tr.h.people.length, where).toBe(0)
  expect(s.state.bays.filter((b) => b.patientId !== null).length, where).toBe(0)
  expect(s.state.theatre.phase, where).toBe('idle')
  expect(s.state.robot.phase, where).toBe('stowed')
}

describe('the sterile supply spots (SURGERY.sterile.spots)', () => {
  const spots = SURGERY.sterile.spots
  const layout = buildLayout()
  const rect = areaById('l2Sterile').rect
  const upper = layout.footprints.filter((f) => levelOf(f.x) === 2)
  const bedApproaches = layout.seats.filter((x) => x.kind === 'surgeryBed').map((x) => x.approach)

  it('are inside the sterile room, walkable, clear of its racks and reachable from the theatre base and the other spots', () => {
    expect(spots.length).toBeGreaterThanOrEqual(2)
    expect(bedApproaches.length).toBe(PREOP_BAYS + PACU_BAYS)
    for (const [i, s] of spots.entries()) {
      expect(s.at.x, `spot ${i}`).toBeGreaterThan(rect.x0 + 0.4)
      expect(s.at.x, `spot ${i}`).toBeLessThan(rect.x1 - 0.4)
      expect(s.at.z, `spot ${i}`).toBeGreaterThan(rect.z0 + 0.4)
      expect(s.at.z, `spot ${i}`).toBeLessThan(rect.z1 - 0.4)
      expect(isWalkable(s.at.x, s.at.z, 0.3), `spot ${i} walkable`).toBe(true)
      let nearest = { id: '', d: Infinity }
      for (const f of upper) {
        const d = footprintDistance(f, s.at.x, s.at.z)
        if (d < nearest.d) nearest = { id: f.id, d }
      }
      expect(nearest.d, `spot ${i} next to ${nearest.id}`).toBeGreaterThan(0.4)
      const route = tryPlanRoute(THEATRE_BASE.at, s.at)
      expect(route, `route base to spot ${i}`).not.toBeNull()
      for (const [j, o] of spots.entries()) if (j !== i) expect(tryPlanRoute(s.at, o.at), `route ${i} to ${j}`).not.toBeNull()
      // from the pre-op bays and the recovery bays too (the porter's runs start there)
      for (const b of bedApproaches) expect(tryPlanRoute(s.at, b), `route spot ${i} to a bed's foot`).not.toBeNull()
    }
  })

  it('face the racks they work at (within a metre and a half)', () => {
    for (const s of spots) {
      const reach = { x: s.at.x + Math.sin(s.heading) * 1.2, z: s.at.z + Math.cos(s.heading) * 1.2 }
      expect(upper.some((f) => footprintDistance(f, reach.x, reach.z) < 0.3), `a rack in front of (${s.at.x.toFixed(1)}, ${s.at.z.toFixed(1)})`).toBe(true)
    }
  })
})

describe('the showcase opening at 07:30 (full Simulation, 50 s of pre-roll)', () => {
  it('has the theatre in console with the surgeon seated, PACU and pre-op occupied and the porter at the sterile supply, for ten seeds', () => {
    for (const seed of SEEDS) {
      const sim = new Simulation(seed, { opening: 'showcase' })
      sim.preRoll(50)
      const s = sim.surgery
      const th = s.state.theatre
      const where = `seed ${seed}`
      expect(th.phase, where).toBe('console')
      expect(th.caseId, where).toBe('sx-2')
      expect(th.surgeonAtConsole, where).toBe(true)
      expect(s.state.robot.phase, where).toBe('docked')
      const c1 = s.runs[1]
      const elapsed = (sim.t - c1.view.consoleStart!) / 60
      expect(elapsed, where).toBeGreaterThan(SC.consoleElapsedMinutes[0] - 0.01)
      expect(elapsed, where).toBeLessThan(SC.consoleElapsedMinutes[1] + 1.2)
      expect(s.runs[0].stage, where).toBe('pacu')
      expect(s.state.bays.filter((b) => b.kind === 'pacu' && b.patientId !== null).length, where).toBe(1)
      expect(s.state.bays.filter((b) => b.kind === 'preOp' && b.patientId !== null).length, where).toBe(1)
      expect(['gown', 'nurseCheck', 'settled'], where).toContain(s.runs[2].stage)
      // the porter is at one of the sterile spots (nobody has asked for a stretcher yet)
      const porter = s.team.get('porter')
      expect(Math.min(...SURGERY.sterile.spots.map((p) => dist(porter, p.at))), where).toBeLessThan(0.6)
      expect(s.stuckFixes, where).toBe(0)
    }
  })

  it('is the same list at every Jump hour: planDay is a pure function of the seed, whatever the start', () => {
    const base = new Simulation(7, { opening: 'showcase' })
    const json = JSON.stringify(base.surgery.plan)
    for (const h of [7.75, 10.5, 15]) expect(JSON.stringify(new Simulation(7, { opening: 'showcase', startHour: h }).surgery.plan), `hour ${h}`).toBe(json)
    expect(base.surgery.plan[1].procedure).toBe(SC.atConsole)
  })
})

describe('the showcase day, mini hospital', () => {
  it('runs 07:30 to the end of the day for four seeds: every case done, nothing stuck, nothing broken', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const tr = traceDay(seed, { crowd: false, opening: 'showcase', dt: 0.2 })
      expectCleanDay(tr, `seed ${seed}`)
      // the early case went home and the next one lay in a bay without a stuck visit
      expect(tr.surgery.runs[0].plan.outcome).toBe('home')
      expect(tr.surgery.plan.length).toBeGreaterThanOrEqual(4)
    }
  }, 600_000)

  it.each(MOMENTS)('places a Jump at %s h consistently and finishes the day (two seeds)', (hour) => {
    for (const seed of [SEEDS[4], SEEDS[5]]) {
      const tr = traceDay(seed, { crowd: false, opening: 'showcase', hour, dt: 0.25 })
      expectCleanDay(tr, `seed ${seed} from ${hour}`)
    }
  }, 600_000)

  it('has the theatre team there from 06:30 (the early case is draped before) and not before the early case needs them', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const tr = traceDay(seed, { crowd: false, opening: 'showcase', hour: CONFIG.day.startHour, until: CONFIG.day.startHour + 0.01 })
      const s = tr.surgery
      expect(s.team.present, `seed ${seed}`).toBe(true)
      expect(s.teamFrom, `seed ${seed}`).toBeLessThan(CONFIG.day.startHour)
      expect(s.teamFrom).toBeLessThan(CONFIG.surgery.teamFromHour)
      const first = Math.min(...s.plan.map((p) => timelineOf(p).drapeStart))
      expect(timeAtHour(s.teamFrom)).toBeLessThan(first)
    }
    // the quiet day keeps 07:00
    const quiet = traceDay(5, { crowd: false, hour: 7.2, until: 7.21 })
    expect(quiet.surgery.teamFrom).toBe(CONFIG.surgery.teamFromHour)
  })

  it('has the early next patient lie in the bay, settled, until the console case has left the room, then be seen (case 2 stages)', () => {
    for (const seed of [31415, 8128, 2]) {
      const h = suite(seed, { crowd: false, opening: 'showcase' })
      const s = h.surgery!
      const c2 = s.runs[2]
      const tl = timelineOf(s.plan[2])
      const seen: string[] = []
      let settledUntil = 0
      let leftAt = Infinity
      const end = timeAtHour(11)
      while (h.t < end) {
        h.step(0.25)
        if (seen[seen.length - 1] !== c2.stage) seen.push(c2.stage)
        if (c2.stage === 'settled') settledUntil = h.t
        if (s.runs[1].leftRoomAt !== null && leftAt === Infinity) leftAt = s.runs[1].leftRoomAt
      }
      const where = `seed ${seed}: ${seen.join(' > ')}`
      // (the pre-roll is not needed here: it is on a bed at 07:30)
      expect(seen.slice(0, 3), where).toContain('settled')
      expect(seen.indexOf('settled'), where).toBeLessThan(seen.indexOf('anaesVisit'))
      expect(seen.indexOf('anaesVisit'), where).toBeLessThan(seen.indexOf('surgeonVisit'))
      expect(seen.indexOf('surgeonVisit'), where).toBeLessThan(seen.indexOf('ready'))
      expect(settledUntil, where).toBeGreaterThan(timeAtHour(8))
      expect(settledUntil, where).toBeLessThanOrEqual(tl.visitsAt + 1)
      expect(s.stuckFixes, where).toBe(0)
    }
  }, 120_000)

  it('sends the idle porter round all the sterile supply spots', () => {
    const tr = traceDay(2026, { crowd: false, opening: 'showcase', dt: 0.25, until: 7.5 + 0.2 })
    const porter = tr.surgery.team.get('porter')
    expect(porter).toBeDefined()
    // sample the porter minute by minute for another stretch of the quiet morning (nobody needs a stretcher before 08:00)
    const h = tr.h
    const visited = new Set<number>()
    const end = h.t + 600
    while (h.t < end) {
      h.step(0.25)
      SURGERY.sterile.spots.forEach((p, i) => {
        if (dist(porter, p.at) < 0.35) visited.add(i)
      })
    }
    expect(visited.size).toBe(SURGERY.sterile.spots.length)
  })
})

describe('the showcase day, full Simulation', () => {
  it('runs one whole day 07:30 to 20:00 with the rest of the hospital in: all cases done, nothing stuck', () => {
    const sim = new Simulation(2026, { opening: 'showcase', inFlight: true })
    sim.preRoll(50)
    const end = timeAtHour(20)
    while (sim.t < end) sim.step(1 / 20)
    const s = sim.surgery
    expect(s.runs.map((c) => c.stage)).toEqual(s.plan.map(() => 'done'))
    expect(s.stuckFixes, s.stuckLog.join(' | ')).toBe(0)
    expect(sim.lifts.stuckFixes).toBe(0)
    expect(s.state.theatre.kpis.casesToday).toBe(s.plan.length)
  }, 900_000)

  it('places a Jump to 06:30 (the earliest) and finishes the surgical day with nothing stuck', () => {
    for (const hour of [CONFIG.day.startHour]) {
      const sim = new Simulation(4242, { opening: 'showcase', inFlight: true, startHour: hour })
      sim.preRoll(50)
      const s = sim.surgery
      const end = timeAtHour(20)
      while (sim.t < end && !s.runs.every((c) => c.stage === 'done')) sim.step(1 / 20)
      expect(s.runs.map((c) => c.stage), `from ${hour}`).toEqual(s.plan.map(() => 'done'))
      expect(s.stuckFixes, `from ${hour}: ${s.stuckLog.join(' | ')}`).toBe(0)
      expect(sim.lifts.stuckFixes, `from ${hour}`).toBe(0)
    }
  }, 900_000)
})

