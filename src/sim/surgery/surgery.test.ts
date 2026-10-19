/**
 * The robotic surgery day (R2), run in a MiniHospital (../lifts/testkit): the real world, lifts, seats, crowd and nav graph with only the suite's
 * people in it, so a whole day (and 50 of them) takes seconds. A full Simulation checks the same day with the rest of the hospital present
 * (also src/sim/population.integration.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { SURGERY_COPY } from '@/content/surgery'
import { THEATRE_STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import { clockText } from '../events'
import { l2, levelOf } from '../levels'
import { LIFTS, PACU, PREOP, SURGERY, THEATRE_BASE, VIEW_WINDOWS, type Spot } from '../places'
import { tryPlanRoute } from '../nav/graph'
import { timeAtHour } from '../population/schedule'
import { Simulation } from '../Simulation'
import type { CasePhase, RobotPhase, SimEvent, SurgeryCaseView } from '../types'
import type { Staffer } from './actors'
import { cartPath, cartPose, DOCK_SPLIT } from './robot'
import { ROOM_PHASES, type PlannedCase } from './plan'
import { SurgerySites } from './sites'
import { DT, MiniHospital, runToHour, seatsFor, suite, testPerson } from './testkit'
import { traceDay, type Trace } from './trace'

const SEEDS = Array.from({ length: 50 }, (_, i) => 5000 + i * 101)

type Mode = 'layout' | 'bare' | 'withOr'

interface Summary {
  seed: number
  mode: Mode
  plan: PlannedCase[]
  views: SurgeryCaseView[]
  stages: string[]
  stuck: string[]
  liftStuck: string[]
  problems: string[]
  stills: string[]
  peopleLeft: number
  events: SimEvent[]
  robot: Trace['robot']
  theatre: Trace['theatre']
  trips: { owner: string; from: number; to: number; waited: number; done: boolean }[]
  heldSeats: string[]
  bays: number
  kpis: SimulationKpis
  gatesFree: boolean
  robotEnd: RobotPhase
  theatreEnd: string
}

type SimulationKpis = Simulation['surgery']['state']['theatre']['kpis']

function summarise(seed: number, mode: Mode): Summary {
  const tr = traceDay(seed, { crowd: false, seats: mode })
  const h = tr.h
  const s = tr.surgery
  const held: string[] = []
  for (const seat of h.seats.all) if (levelOf(seat.x) === 2 && h.seats.occupant(seat.id) !== null) held.push(seat.id)
  return {
    seed,
    mode,
    plan: s.plan,
    views: s.cases.map((v) => ({ ...v })),
    stages: s.runs.map((c) => c.stage),
    stuck: s.stuckLog.slice(),
    liftStuck: h.lifts.stuckLog.slice(),
    problems: tr.problems,
    stills: tr.stills,
    peopleLeft: h.people.length,
    events: h.log.events.slice(),
    robot: tr.robot,
    theatre: tr.theatre,
    trips: h.lifts.history.map((t) => ({ owner: t.ownerId, from: t.from, to: t.to, waited: t.arrivedAt - t.requestedAt, done: t.done })),
    heldSeats: held,
    bays: s.state.bays.filter((b) => b.patientId !== null).length,
    kpis: { ...s.state.theatre.kpis },
    gatesFree: h.lifts.gates.every((g) => g.stretcherBy === null && g.freeWalkers === CONFIG.lifts.lobbyWalkers && g.landingBy.length === 0),
    robotEnd: s.state.robot.phase,
    theatreEnd: s.state.theatre.phase,
  }
}

let cache: Summary[] | null = null
function days(): Summary[] {
  if (cache === null) cache = SEEDS.map((seed, i) => summarise(seed, (['layout', 'bare', 'withOr'] as const)[i % 3]))
  return cache
}

const min = (s: number) => s / 60

describe('the robotic day, 50 seeds', () => {
  it('ends every case done (home or up to the ward) with nobody left, no safety net fired and nothing broken on the way', () => {
    for (const d of days()) {
      const where = `seed ${d.seed} (${d.mode} seats)`
      expect(d.stages, where).toEqual(d.plan.map(() => 'done'))
      expect(d.stuck, where).toEqual([])
      expect(d.liftStuck, where).toEqual([])
      expect(d.problems, where).toEqual([])
      expect(d.stills, where).toEqual([])
      // everybody has gone home: the patients, their companions and (by 19:30) the team
      expect(d.peopleLeft, where).toBe(0)
      expect(d.heldSeats, where).toEqual([])
      expect(d.bays, where).toBe(0)
      expect(d.gatesFree, where).toBe(true)
      expect(d.theatreEnd, where).toBe('idle')
      expect(d.robotEnd, where).toBe('stowed')
      for (const v of d.views) {
        expect(v.phase, `${where} ${v.id}`).toBe('done')
        for (const t of [v.wheelsIn, v.dockedAt, v.consoleStart, v.consoleEnd, v.wheelsOut]) expect(t, `${where} ${v.id}`).not.toBeNull()
      }
    }
  }, 300_000)

  it('keeps the room time and the console time inside their bands, and follows the plan to within a couple of minutes', () => {
    for (const d of days()) {
      d.views.forEach((v, k) => {
        const c = d.plan[k]
        const where = `seed ${d.seed} ${v.id} ${c.procedure}`
        const room = min(v.wheelsOut! - v.wheelsIn!)
        const con = min(v.consoleEnd! - v.consoleStart!)
        expect(room, where).toBeGreaterThanOrEqual(CONFIG.surgery.roomMinutes[c.procedure][0])
        expect(room, where).toBeLessThanOrEqual(CONFIG.surgery.roomMinutes[c.procedure][1])
        expect(con, where).toBeGreaterThanOrEqual(CONFIG.surgery.consoleMinutes[c.procedure][0])
        expect(con, where).toBeLessThanOrEqual(CONFIG.surgery.consoleMinutes[c.procedure][1])
        // the plan's own numbers, with a few seconds of walking
        expect(room, where).toBeCloseTo(min(c.roomSeconds), 0)
        expect(con, where).toBeCloseTo(min(c.consoleSeconds), 0)
        // the wheels-in is the plan's (a few seconds to a minute for the stretcher's last metres, never early)
        expect(v.wheelsIn!, where).toBeGreaterThanOrEqual(c.nominalIn - 1)
        expect(v.wheelsIn! - c.nominalIn, where).toBeLessThan(120)
        // docked at the end of the docking phase and the console phase starts then (the surgeon is at the console in time)
        expect(v.consoleStart! - v.dockedAt!, where).toBeLessThan(60)
        expect(v.dockedAt! - v.wheelsIn!, where).toBeGreaterThan(15 * 60)
      })
    }
  }, 300_000)

  it('walks the robot through its phases in order, case after case', () => {
    const next: Record<RobotPhase, RobotPhase[]> = {
      stowed: ['draping'],
      draping: ['draped'],
      draped: ['deploying'],
      deploying: ['driving'],
      driving: ['docking'],
      docking: ['targeting'],
      targeting: ['docked'],
      docked: ['undocking'],
      undocking: ['returning'],
      returning: ['cleaning'],
      cleaning: ['stowed', 'draping'],
    }
    for (const d of days()) {
      const kinds = d.robot.map((r) => r.kind)
      // (a phase that stays while the case changes is one entry per change; collapse repeats)
      const seq = kinds.filter((k, i) => i === 0 || k !== kinds[i - 1])
      expect(seq[0], `seed ${d.seed}`).toBe('stowed')
      for (let i = 1; i < seq.length; i++) expect(next[seq[i - 1]], `seed ${d.seed}: ${seq[i - 1]} then ${seq[i]}`).toContain(seq[i])
      // every case docks once: this many full cycles
      const docked = seq.filter((k) => k === 'docked').length
      expect(docked, `seed ${d.seed}`).toBe(d.plan.length)
      expect(seq.filter((k) => k === 'draping')).toHaveLength(d.plan.length)
      expect(seq[seq.length - 1]).toBe('stowed')
    }
  }, 300_000)

  it('logs each case once and in order: arrived, ready, in, docked, console, exchanges, undocked, out, recovery, and the turnover', () => {
    for (const d of days()) {
      const order = ['surgeryArrived', 'preOpReady', 'theatreIn', 'robotDocked', 'consoleStart', 'robotUndocked', 'theatreOut', 'pacuOut'] as const
      d.plan.forEach((c) => {
        const name = d.views.find((v) => v.id === c.id)!.name
        const mine = d.events.filter((e) => e.text.includes(name))
        let at = -1
        for (const type of order) {
          const ev = mine.filter((e) => e.type === type)
          // (the first case was already upstairs when the day began: its arrival is not news)
          const expected = type === 'surgeryArrived' && c.arriveAt < -300 ? 0 : 1
          expect(ev, `seed ${d.seed} ${c.id} ${type}`).toHaveLength(expected)
          if (ev.length === 0) continue
          expect(ev[0].t, `seed ${d.seed} ${c.id} ${type}`).toBeGreaterThanOrEqual(at)
          at = ev[0].t
        }
      })
      // the first case's arrival was before the day began (nothing logged); the others arrive upstairs by themselves
      expect(d.events.filter((e) => e.type === 'turnoverDone')).toHaveLength(d.plan.length)
      expect(d.events.filter((e) => e.type === 'instrumentExchange').length).toBe(d.plan.reduce((n, c) => n + c.exchanges.length, 0))
      // texts come from the copy and every placeholder is filled
      for (const e of d.events) expect(e.text, `seed ${d.seed} ${e.type}`).not.toMatch(/[{}]/)
    }
  }, 300_000)

  it('sends day cases home by lift A (walking, with their companion) and ward cases up by lift B (the stretcher), all served well inside 3 minutes', () => {
    for (const d of days()) {
      const trips = d.trips
      const up = trips.filter((t) => t.from === 1 && t.to === 2)
      const down = trips.filter((t) => t.from === 2 && t.to === 1)
      // every case after the first one rides up (the first arrived before 07:30), the day cases ride down
      expect(up.length, `seed ${d.seed}`).toBe(d.plan.length - (d.plan[0].arriveAt < -300 ? 1 : 0))
      expect(down.length, `seed ${d.seed}`).toBe(d.plan.filter((c) => c.outcome === 'home').length)
      for (const t of trips) {
        expect(t.done).toBe(true)
        expect(t.waited, `seed ${d.seed} ${t.owner}`).toBeLessThan(180)
      }
    }
  }, 300_000)

  it('ends with the KPIs of the day: cases, docking, console, turnover, recovery and utilisation', () => {
    for (const d of days()) {
      const k = d.kpis
      const last = d.plan[d.plan.length - 1]
      expect(k.casesToday, `seed ${d.seed}`).toBe(d.plan.length)
      expect(k.firstCaseOnTime, `seed ${d.seed}`).toBe(d.views[0].wheelsIn! - d.plan[0].plannedIn <= 300)
      expect(k.dockingMin).toBeCloseTo(min(last.phases.docking), 5)
      expect(k.consoleMin!).toBeCloseTo(min(d.views[d.views.length - 1].consoleEnd! - d.views[d.views.length - 1].consoleStart!), 5)
      expect(k.turnoverMin).toBeCloseTo(min(last.turnoverSeconds), 5)
      expect(k.pacuMin!).toBeGreaterThanOrEqual(CONFIG.surgery.pacuMinutes[0])
      expect(k.pacuMin!).toBeLessThanOrEqual(CONFIG.surgery.pacuMinutes[1] + 1)
      expect(k.utilisation!, `seed ${d.seed}`).toBeGreaterThan(0.4)
      expect(k.utilisation!, `seed ${d.seed}`).toBeLessThan(1)
    }
  }, 300_000)

  it('puts every theatre phase of every case on the theatre state, in order, with the lights on from induction to emergence only', () => {
    const rank = new Map<string, number>([['toTheatre', 0], ...ROOM_PHASES.map((p, i): [string, number] => [p, i + 1])])
    for (const d of days()) {
      for (const c of d.plan) {
        const mine = d.theatre.filter((x) => x.caseId === c.id).map((x) => x.phase)
        expect(mine, `seed ${d.seed} ${c.id}`).toEqual(['toTheatre', ...ROOM_PHASES])
        const rr = mine.map((p) => rank.get(p)!)
        expect(rr, `seed ${d.seed}`).toEqual([...rr].sort((a, b) => a - b))
      }
      // turnover and idle in between
      expect(d.theatre.some((x) => x.phase === 'turnover')).toBe(true)
    }
  }, 300_000)
})

describe('the robot and the cart', () => {
  it('drives the cart from park to dock along a clear path west of the table, turning on the spot at either end', () => {
    const path = cartPath(80)
    expect(path[0].x).toBeCloseTo(SURGERY.cart.park.at.x, 6)
    expect(path[0].z).toBeCloseTo(SURGERY.cart.park.at.z, 6)
    expect(path[0].heading).toBeCloseTo(SURGERY.cart.park.heading, 6)
    const end = path[path.length - 1]
    expect(end.x).toBeCloseTo(SURGERY.cart.dock.at.x, 6)
    expect(end.z).toBeCloseTo(SURGERY.cart.dock.at.z, 6)
    expect(end.heading).toBeCloseTo(SURGERY.cart.dock.heading, 6)
    // monotone toward the dock; never east of the dock (the table is further east) and never more than a cart's half-length from the wall
    let prev = 0
    for (const p of path) {
      const d = Math.hypot(p.x - path[0].x, p.z - path[0].z)
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = d
      expect(p.x).toBeLessThanOrEqual(SURGERY.cart.dock.at.x + 1e-9)
      expect(p.x).toBeGreaterThanOrEqual(l2(-53) + 0.9)
      // clear of the table (its west edge is at x = table - 0.275) by more than the cart's half-diagonal
      expect(Math.hypot(SURGERY.table.at.x - p.x, 0)).toBeGreaterThan(0.9 + 0.275)
    }
    // the same pose at the same k, allocation-free API
    const a = cartPose(0.5, { x: 0, z: 0, heading: 0 })
    const b = cartPose(0.5, { x: 9, z: 9, heading: 9 })
    expect(a).toEqual(b)
  })

  it('splits the docking phase into deploying, driving, docking and targeting, with the laser on only while driving and docking', () => {
    expect(DOCK_SPLIT.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9)
    const h = suite(2026, { crowd: false })
    const s = h.surgery!
    const seen = new Map<RobotPhase, { laser: boolean[]; engage: number[]; yaw: number[]; cart: number[] }>()
    // run through the first case's docking
    const c = s.plan[0]
    const until = c.nominalIn + c.phases.in + c.phases.induction + c.phases.positioning + c.phases.ports + c.phases.docking + 30
    while (h.t < until) {
      h.step(0.25)
      const r = s.state.robot
      const e = seen.get(r.phase) ?? { laser: [], engage: [], yaw: [], cart: [] }
      e.laser.push(r.laser)
      e.engage.push(r.arms[0].engage + r.arms[2].engage + r.arms[3].engage)
      e.yaw.push(r.boomYaw)
      e.cart.push(Math.hypot(r.cart.x - SURGERY.cart.park.at.x, r.cart.z - SURGERY.cart.park.at.z))
      seen.set(r.phase, e)
    }
    for (const k of ['deploying', 'driving', 'docking', 'targeting', 'docked'] as const) expect(seen.has(k), k).toBe(true)
    expect(seen.get('driving')!.laser.every(Boolean)).toBe(true)
    expect(seen.get('deploying')!.laser.some(Boolean)).toBe(false)
    expect(seen.get('targeting')!.laser.some(Boolean)).toBe(false)
    expect(seen.get('docked')!.laser.some(Boolean)).toBe(false)
    // the cart moves while driving and not before or after
    const cart = seen.get('driving')!.cart
    expect(cart[cart.length - 1] - cart[0]).toBeGreaterThan(2)
    expect(Math.max(...seen.get('deploying')!.cart)).toBeLessThan(1e-6)
    expect(Math.min(...seen.get('targeting')!.cart)).toBeGreaterThan(2.5)
    // the boom turns and the other three arms swing onto their ports while targeting, then stay
    const yaw = seen.get('targeting')!.yaw
    expect(yaw[yaw.length - 1]).toBeCloseTo(c.boomYaw, 1)
    expect(Math.abs(yaw[0])).toBeLessThan(0.05)
    const eng = seen.get('targeting')!.engage
    expect(eng[0]).toBeLessThan(0.2)
    expect(eng[eng.length - 1]).toBeGreaterThan(2.5)
    expect(Math.max(...(seen.get('docking')!.engage))).toBeLessThan(1e-6)
    // the arms' ports are the layout's
    const ports = SURGERY.ports[c.layout]
    s.state.robot.arms.forEach((a, i) => expect(a.port).toEqual(ports[i]))
    expect(c.layout).toBe(SURGERY_COPY.procedures[c.procedure].portLayout)
    // instruments are the procedure's copy (arm 1 holds the endoscope)
    expect(s.state.robot.arms[1].instrument).toBe('Endoscope 30°')
  })

  it('shows the instruments of the procedure and changes them at the bedside, with the arm withdrawing for a few seconds', () => {
    const h = suite(2026, { crowd: false })
    const s = h.surgery!
    const c = s.plan[0]
    const copy = SURGERY_COPY.procedures[c.procedure]
    while (s.cases[0].consoleStart === null) h.step(0.25)
    const start = s.cases[0].consoleStart!
    runToTime(h, start + 1)
    const arms = s.state.robot.arms
    expect(arms.map((a) => a.instrument)).toEqual(copy.instruments)
    const ex = c.exchanges[0]
    // just before the exchange the arm is engaged, in the middle it is withdrawn, then it holds the new instrument
    runToTime(h, start + ex.at - 3)
    expect(arms[ex.arm].engage).toBeCloseTo(1, 5)
    runToTime(h, start + ex.at + 6)
    expect(arms[ex.arm].engage).toBeLessThan(0.7)
    runToTime(h, start + ex.at + 20)
    expect(arms[ex.arm].instrument).toBe(ex.instrument)
    expect(arms[ex.arm].exchanges).toBe(1)
    expect(arms[ex.arm].engage).toBeCloseTo(1, 5)
    // force-feedback readings wander inside 0..1
    for (const a of arms) {
      expect(a.force).toBeGreaterThanOrEqual(0)
      expect(a.force).toBeLessThanOrEqual(1)
    }
  })
})

function runToTime(h: MiniHospital, t: number): void {
  while (h.t < t) h.step(0.25)
}

describe('the team and the patient', () => {
  it('dresses the OR team in theatre scrubs and the pre-op and recovery nurses, the porter and the cleaner in their roles', () => {
    const h = suite(2026, { crowd: false })
    expect(THEATRE_STAFF).toHaveLength(9)
    for (const m of THEATRE_STAFF) {
      const p = h.personById(m.id)
      expect(p, m.id).not.toBeNull()
      expect(p!.entity.outfit, m.id).toBe(['surgeon', 'assistant', 'anaesthetist', 'scrub', 'circulator'].includes(m.title) ? 'theatre' : 'role')
      expect(p!.entity.role).toBe(m.role)
      expect(levelOf(p!.walker.x)).toBe(2)
    }
  })

  it('has the surgeon on the console seat in anim console and the anaesthetist on the stool during the console phase', () => {
    for (const mode of ['layout', 'bare', 'withOr'] as const) {
      const h = suite(2026, { crowd: true, seats: mode })
      const s = h.surgery!
      const c = s.plan[0]
      const mid = c.nominalIn + c.phases.in + c.phases.induction + c.phases.positioning + c.phases.ports + c.phases.docking + c.phases.console / 2
      while (h.t < mid) h.step(1 / 30)
      expect(s.state.theatre.phase).toBe('console')
      expect(s.state.theatre.surgeonAtConsole).toBe(true)
      const surgeon = h.personById('or-surgeon')!
      expect(surgeon.entity.anim).toBe('console')
      expect(surgeon.entity.seated?.seatId).toBe('console:or:surgeon')
      const anaes = h.personById('or-anaes')!
      expect(anaes.entity.seated?.seatId).toBe('console:or:anaes')
      expect(anaes.entity.anim).toBe('sit')
      // the patient lies on the table, the assistant and scrub nurse stand by it, the circulator at her desk
      const patient = h.personById(`${c.id}-patient`)!
      expect(patient.entity.seated?.seatId).toBe('orTable:0')
      expect(patient.entity.outfit).toBe('gown')
      for (const id of ['or-assistant', 'or-scrub']) {
        const p = h.personById(id)!
        expect(Math.hypot(p.walker.x - SURGERY.table.at.x, p.walker.z - SURGERY.table.at.z), id).toBeLessThan(2.2)
      }
      // the console seat is held (the teaching console is left to you)
      expect(s.sites.occupant(s.sites.surgeonConsole)).toBe('or-surgeon')
      // setTeaching shows on the theatre state
      s.setTeaching(true)
      expect(s.state.theatre.teachingInUse).toBe(true)
      s.setTeaching(false)
      expect(s.state.theatre.teachingInUse).toBe(false)
    }
  }, 120_000)

  it('has the team on level 2 from teamFromHour and gone home after teamToHour', () => {
    const h = suite(2026, { crowd: false, hour: 6.5 })
    expect(h.people.filter((p) => p.entity.id.startsWith('or-'))).toHaveLength(0)
    runToHour(h, CONFIG.surgery.teamFromHour + 0.02, 0.5)
    const team = h.people.filter((p) => p.entity.id.startsWith('or-'))
    expect(team).toHaveLength(9)
    // they appear on level 2 (in the staff room, fading in where they stand) and go to their places there
    for (const p of team) expect(levelOf(p.walker.x)).toBe(2)
    runToHour(h, CONFIG.surgery.teamToHour + 0.5, 0.5)
    expect(h.people).toHaveLength(0)
  }, 120_000)

  it('turns the room over with the cleaner, and shows the pre-op visits with talk and tablet', () => {
    const h = suite(2026, { crowd: false })
    const s = h.surgery!
    const c = s.plan[0]
    const run = s.runs[0]
    const until = (stage: string, plus: number) => {
      while (run.stage !== stage) h.step(0.25)
      runToTime(h, h.t + plus)
    }
    // the pre-op nurse with the patient at the bay: tablet; the anaesthetist's visit, then the surgeon's: talk
    until('nurseCheck', 60)
    expect(h.personById('or-preop')!.entity.anim).toBe('tablet')
    expect(s.state.bays[0].patientId).toBe(`${c.id}-patient`)
    until('anaesVisit', 90)
    expect(h.personById('or-anaes')!.entity.anim).toBe('talk')
    until('surgeonVisit', 90)
    expect(h.personById('or-surgeon')!.entity.anim).toBe('talk')
    // turnover: the cleaner works in the OR
    while (s.state.theatre.phase !== 'turnover') h.step(0.25)
    runToTime(h, h.t + 5 * 60)
    expect(s.state.theatre.phase).toBe('turnover')
    const cleaner = h.personById('or-cleaner')!
    expect(cleaner.entity.anim).toBe('clean')
    expect(cleaner.walker.x - 150).toBeGreaterThan(-53)
    expect(cleaner.walker.z).toBeGreaterThan(2)
    expect(cleaner.walker.z).toBeLessThan(10)
  })
})

describe('the ward fade', () => {
  it('takes a ward patient up in lift B on the stretcher: the porter and the patient fade out in the lobby, and the porter is back 4-6 minutes later', () => {
    const h = suite(2026, { crowd: true })
    const s = h.surgery!
    const ward = s.runs.find((c) => c.plan.outcome === 'ward')!
    expect(ward).toBeDefined()
    // up to the moment the stretcher is in the lobby
    while (ward.stage !== 'wardFade') h.step(1 / 30)
    const porter = h.personById('or-porter') as Staffer
    const lobby = LIFTS.B[2].stretcher.at
    expect(Math.hypot(porter.walker.x - lobby.x, porter.walker.z - lobby.z)).toBeLessThan(0.3)
    expect(h.lifts.gates[3].stretcherBy).toBe('or-porter')
    const faded = h.t
    while ((ward.stage as string) !== 'done') h.step(1 / 30)
    expect(h.personById(`${ward.id}-patient`)).toBeNull()
    expect(porter.entity.fade).toBe(0)
    expect(porter.entity.vehicle).toBe('none')
    // the lobby is free again and the porter is away
    expect(h.lifts.gates[3].stretcherBy).toBeNull()
    while (porter.entity.fade === 0) h.step(1 / 30)
    const away = (h.t - faded) / 60
    expect(away).toBeGreaterThanOrEqual(4)
    expect(away).toBeLessThanOrEqual(6.3)
    // back at the lobby of level 2, then on to the staff room
    expect(levelOf(porter.walker.x)).toBe(2)
    runToTime(h, h.t + 120)
    expect(porter.engagedBy).toBeNull()
    expect(h.lifts.gates[3].stretcherBy).toBeNull()
    runToTime(h, h.t + 180)
    expect(porter.isAt('base')).toBe(true)
  }, 120_000)
})

describe('determinism', () => {
  it('replays the identical day: two mini hospitals with the same seed agree on every hour, and a different seed does not', () => {
    const snap = (h: MiniHospital) => {
      const s = h.surgery!
      const strip = <T extends { version?: number }>(o: T): Omit<T, 'version'> => {
        const { version: _v, ...rest } = o
        return rest
      }
      return JSON.stringify({
        robot: strip(s.state.robot),
        theatre: strip(s.state.theatre),
        lifts: h.lifts.state.cars,
        bays: s.state.bays,
        people: h.people.map((p) => [p.entity.id, +p.walker.x.toFixed(4), +p.walker.z.toFixed(4), p.entity.anim, p.entity.fade]),
        events: h.log.events.length,
      })
    }
    const run = (seed: number) => {
      const h = suite(seed, { crowd: true })
      const out: string[] = []
      for (let hour = 8; hour <= 20; hour++) {
        runToHour(h, hour, 1 / 30)
        out.push(snap(h))
      }
      return { out, events: JSON.stringify(h.log.events), cases: JSON.stringify(h.surgery!.cases) }
    }
    const a = run(7)
    const b = run(7)
    expect(a.out).toEqual(b.out)
    expect(a.events).toEqual(b.events)
    expect(a.cases).toEqual(b.cases)
    expect(run(8).events).not.toEqual(a.events)
  }, 300_000)

  it('replays the identical day in two Simulations, 07:30 to 20:00: same robot, theatre, lifts and event list', () => {
    const run = () => {
      const sim = new Simulation(2026, { population: false })
      sim.surgery.startDay(sim.t)
      const end = timeAtHour(20)
      const checkpoints: string[] = []
      let next = timeAtHour(9)
      while (sim.t < end) {
        sim.step(1 / 20)
        if (sim.t >= next) {
          next += 3600
          const strip = <T extends { version?: number }>(o: T) => {
            const { version: _v, ...rest } = o
            return rest
          }
          checkpoints.push(JSON.stringify({ robot: strip(sim.surgery.state.robot), theatre: strip(sim.surgery.state.theatre), lifts: sim.lifts.state.cars }))
        }
      }
      return { checkpoints, events: JSON.stringify(sim.log.events), stuck: [sim.surgery.stuckFixes, sim.lifts.stuckFixes], stages: sim.surgery.runs.map((c) => c.stage) }
    }
    const a = run()
    const b = run()
    expect(a.checkpoints).toEqual(b.checkpoints)
    expect(a.events).toEqual(b.events)
    expect(a.stuck).toEqual([0, 0])
    expect(b.stages).toEqual(a.stages)
    expect(a.stages.every((s) => s === 'done')).toBe(true)
  }, 300_000)
})

describe('warm starts', () => {
  it('place every case, the robot, the bays and the team consistently at every Jump moment, and the day then runs to its end', () => {
    for (const hour of CONFIG.day.moments) {
      for (const seed of [2026, 77]) {
        const where = `hour ${hour} seed ${seed}`
        const tr = traceDay(seed, { crowd: false, seats: hour % 2 === 0 ? 'bare' : 'layout', hour })
        const s = tr.surgery
        expect(tr.problems, where).toEqual([])
        expect(tr.stills, where).toEqual([])
        expect(s.stuckFixes, `${where} ${s.stuckLog.join('|')}`).toBe(0)
        expect(tr.h.lifts.stuckFixes, where).toBe(0)
        expect(s.runs.map((c) => c.stage), where).toEqual(s.plan.map(() => 'done'))
        expect(tr.h.people, where).toHaveLength(0)
        // the cases that began before the Jump kept their planned times
        s.runs.forEach((c) => {
          if (c.view.wheelsIn !== null && c.plan.nominalIn < timeAtHour(hour)) expect(Math.abs(c.view.wheelsIn - c.plan.nominalIn), where).toBeLessThan(1)
        })
      }
    }
  }, 300_000)

  it('start the state of the day from the plan: who is in the room, which bays are full, where the robot is and which KPIs are in', () => {
    const at = (hour: number) => suite(2026, { crowd: false, hour })
    // before the team's day: nobody, a stowed robot, an idle theatre
    const early = at(6.5)
    expect(early.people).toHaveLength(0)
    expect(early.surgery!.state.robot.phase).toBe('stowed')
    // 08:30: case 1 is in the room, the robot is draped waiting for the ports, the lights are on
    const mid = at(8.5)
    const ms = mid.surgery!.state
    expect(ms.theatre.caseId).toBe('sx-1')
    expect(ms.theatre.phase).toBe('ports')
    expect(ms.theatre.lights).toBe(true)
    expect(ms.robot.phase).toBe('draped')
    expect(mid.people.filter((p) => p.entity.id.startsWith('sx-1-')).map((p) => p.entity.id).sort()).toEqual(['sx-1-companion', 'sx-1-patient'])
    expect(mid.personById('sx-1-patient')!.entity.seated?.seatId).toBe('orTable:0')
    // 12:00: the second case is in recovery, the third in pre-op with the robot being draped, the first has gone home
    const noon = at(12)
    const ns = noon.surgery!
    expect(ns.runs.map((c) => c.stage)).toEqual(['done', 'pacu', 'ready'])
    expect(ns.state.theatre.cases.map((v) => v.phase)).toEqual(['done', 'pacu', 'preOp'])
    expect(ns.state.bays.filter((b) => b.patientId !== null).map((b) => b.seatId).sort()).toEqual(['surgeryBed:pacu:0', 'surgeryBed:preop:0'])
    expect(ns.state.robot.phase).toBe('draping')
    expect(ns.state.theatre.kpis.casesToday).toBe(2)
    expect(ns.state.theatre.kpis.dockingMin).not.toBeNull()
    // 19:00: all three cases are done, the team has gone, the theatre is idle
    const late = at(19)
    expect(late.people).toHaveLength(0)
    expect(late.surgery!.runs.every((c) => c.stage === 'done')).toBe(true)
    expect(late.surgery!.state.theatre.kpis.casesToday).toBe(3)
    expect(late.surgery!.state.robot.phase).toBe('stowed')
  })

  it('give the same plan whatever the hour: a Jump to 10:30 and a day run live agree on the times of the cases', () => {
    const live = suite(2026, { crowd: false })
    const jump = suite(2026, { crowd: false, hour: 10.5 })
    expect(JSON.stringify(jump.surgery!.plan)).toBe(JSON.stringify(live.surgery!.plan))
    live.run(0)
  })
})

describe('the suite in the level-2 world', () => {
  it('reaches every seat approach and anchor of level 2 from the entrance: the lift, then walking', () => {
    const h = suite(2026, { crowd: false })
    const sites = new SurgerySites(h.seats)
    const targets: { name: string; at: { x: number; z: number } }[] = []
    for (const seat of h.seats.all) if (levelOf(seat.x) === 2) targets.push({ name: seat.id, at: seat.approach })
    for (const ref of [...sites.preop, ...sites.pacu, sites.table, sites.surgeonConsole, sites.anaesStool]) targets.push({ name: ref.seat.id, at: ref.seat.approach })
    for (const [name, spot] of Object.entries(sites.spots)) {
      if (Array.isArray(spot)) spot.forEach((s, i) => targets.push({ name: `${name}${i}`, at: s.at }))
      else targets.push({ name, at: (spot as { at: { x: number; z: number } }).at })
    }
    for (const spot of [SURGERY.viewing, SURGERY.staff.circulator, SURGERY.staff.assistant, SURGERY.staff.scrub, SURGERY.staff.drape, SURGERY.staff.drive, SURGERY.scrubSink.spots[0], SURGERY.scrubSink.spots[1], PREOP.nurse, PACU.nurse, THEATRE_BASE]) targets.push({ name: 'anchor', at: spot.at })
    for (const b of PREOP.bays) targets.push({ name: 'preop bay', at: { x: b.at.x, z: b.at.z + 1.4 } })
    for (const b of PACU.bays) targets.push({ name: 'pacu bay', at: { x: b.at.x, z: b.at.z - 1.4 } })
    expect(targets.length).toBeGreaterThan(60)
    // level 1: the entrance to the lift lobby (the nav graph reaches every lobby spot)
    const entrance = { x: -60.8, z: 0 }
    for (const shaft of ['A', 'B'] as const) {
      const l = LIFTS[shaft][1]
      for (const spot of [l.stretcher.at, ...l.walkers, l.cars[0].at, l.cars[1].at]) expect(tryPlanRoute(entrance, spot), `${shaft}1 lobby`).not.toBeNull()
    }
    // level 2: from lift A's lobby (where the ride lands) to every target
    const from = LIFTS.A[2].cars[0].at
    const bad = targets.filter((t) => tryPlanRoute(from, t.at) === null).map((t) => t.name)
    expect(bad).toEqual([])
    // and walking: one person does the ride from the entrance, then walks to every target in turn
    const p = testPerson(h, 'walker', { x: -60.8, z: 0 })
    const trip = h.lifts.trip({ ownerId: 'walker-up', shaft: 'A', from: 1, to: 2, walkers: [p] })
    expect(h.runUntil(() => trip.done, 400, 0.1)).toBe(true)
    for (const t of targets) {
      p.moveTo(t.at)
      expect(h.runUntil(() => p.done, 200, 0.1), `walking to ${t.name} (${t.at.x.toFixed(1)}, ${t.at.z.toFixed(1)})`).toBe(true)
      expect(Math.hypot(p.x - t.at.x, p.z - t.at.z), t.name).toBeLessThan(0.05)
    }
    expect(h.lifts.stuckFixes).toBe(0)
    void VIEW_WINDOWS
  }, 300_000)

  it('is crowded only by its own people: a full day with the crowd on keeps nobody standing in a doorway and nobody off the floor', () => {
    for (const seed of [2026, 31]) {
      const tr = traceDay(seed, { crowd: true, dt: 1 / 30 })
      expect(tr.problems, `seed ${seed}`).toEqual([])
      expect(tr.stills, `seed ${seed}`).toEqual([])
      expect(tr.surgery.stuckFixes).toBe(0)
      expect(tr.h.lifts.stuckFixes).toBe(0)
      expect(tr.surgery.runs.every((c) => c.stage === 'done')).toBe(true)
      expect(tr.peak).toBeGreaterThanOrEqual(10)
      expect(tr.peak).toBeLessThanOrEqual(20)
      expect(tr.h.crowd!.blockedFallbacks).toBeLessThan(40)
    }
  }, 300_000)

  it('rides the lifts hidden: patient and companion are invisible in the car, and the first minute upstairs fades them in', () => {
    const h = suite(2026, { crowd: true })
    const s = h.surgery!
    // the second case rides up at about 08:45
    const c = s.runs[1]
    let rode = false
    let allHidden = true
    while (h.t < c.tl.upstairsBy + 120) {
      h.step(1 / 30)
      const trip = h.lifts.trips.find((t) => t.ownerId === `${c.id}:1to2`)
      if (trip && (trip.phase === 'inCar' || trip.phase === 'riding')) {
        rode = true
        for (const m of trip.members()) if ((m.entity.fade ?? 1) !== 0) allHidden = false
      }
    }
    expect(rode).toBe(true)
    expect(allHidden).toBe(true)
    expect(c.stage).toBe('waiting')
    expect(clockText(h.t)).toBeTruthy()
  }, 120_000)
})

describe('seats and the registry', () => {
  it('uses the building\'s seats when it has them and its own when it has not, with the same day either way', () => {
    const real = seatsFor('layout')
    const bare = seatsFor('bare')
    expect(bare.length).toBeLessThanOrEqual(real.length)
    const a = days().find((d) => d.mode === 'layout')!
    const b = days().find((d) => d.mode === 'bare')!
    expect(a.stages.every((x) => x === 'done')).toBe(true)
    expect(b.stages.every((x) => x === 'done')).toBe(true)
    const sitesBare = new SurgerySites(new MiniHospital(1, { crowd: false, seats: bare }).seats)
    expect(sitesBare.preop.every((r) => !r.real)).toBe(true)
    expect(sitesBare.table.real).toBe(false)
    // with the OR's own seats in the registry the suite claims them there (and they are held while used)
    const withOr = new SurgerySites(new MiniHospital(1, { crowd: false, seats: seatsFor('withOr') }).seats)
    expect([withOr.table.real, withOr.surgeonConsole.real, withOr.anaesStool.real]).toEqual([true, true, true])
    const sitesReal = new SurgerySites(new MiniHospital(1, { crowd: false, seats: real }).seats)
    // (the pre-op and recovery beds are the layout agent's; the table and consoles the OR agent's, which may not be in yet)
    expect(sitesReal.preop.every((r) => r.real) || sitesReal.preop.every((r) => !r.real)).toBe(true)
    for (const ref of [...sitesBare.preop, ...sitesBare.pacu, sitesBare.table, sitesBare.surgeonConsole, sitesBare.anaesStool]) {
      expect(ref.seat.approach, ref.seat.id).toBeDefined()
      expect(levelOf(ref.seat.x), ref.seat.id).toBe(2)
    }
    void DT
  })
})

describe('the OR team\'s standing spots', () => {
  it('start from the contract (SURGERY.staff): the table side, the waiting spots, the cleaner\'s round and the drive\'s end, facing its way', () => {
    const sites = new SurgerySites(new MiniHospital(1, { crowd: false, seats: seatsFor('layout') }).seats)
    const s = sites.spots
    const pairs: [string, Spot, Spot][] = [
      ['tableSurgeon', s.tableSurgeon, SURGERY.staff.tableSurgeon],
      ['assistantWait', s.assistantWait, SURGERY.staff.assistantWait],
      ['scrubWait', s.scrubWait, SURGERY.staff.scrubWait],
      ['driveEnd', s.driveEnd, SURGERY.staff.driveEnd],
      ...SURGERY.staff.clean.map((c, i): [string, Spot, Spot] => [`clean${i}`, s.clean[i], c]),
    ]
    expect(s.clean).toHaveLength(SURGERY.staff.clean.length)
    const exact: string[] = []
    for (const [name, got, want] of pairs) {
      expect(levelOf(want.at.x), name).toBe(2)
      expect(got.heading, name).toBe(want.heading)
      // the contract's spot, or (furniture over it) one of the points tried next, within a stride of it
      const d = Math.hypot(got.at.x - want.at.x, got.at.z - want.at.z)
      expect(d, name).toBeLessThan(0.6)
      if (d === 0) exact.push(name)
    }
    // eslint-disable-next-line no-console
    console.log(`OR spots taken as the contract has them: ${exact.join(', ')} (${exact.length} of ${pairs.length})`)
  })
})

describe('the case views', () => {
  it('keep the same objects (state.theatre.cases) and describe each case in the port\'s terms', () => {
    const h = suite(2026, { crowd: false })
    const s = h.surgery!
    const views = s.cases
    expect(views).toBe(s.state.theatre.cases)
    expect(views).toHaveLength(s.plan.length)
    views.forEach((v: SurgeryCaseView, i) => {
      expect(v.id).toBe(s.plan[i].id)
      expect(v.procedure).toBe(s.plan[i].procedure)
      expect(v.outcome).toBe(s.plan[i].outcome)
      expect(v.plannedIn).toBe(s.plan[i].plannedIn)
      expect(v.name.length).toBeGreaterThan(3)
    })
    const phase0: CasePhase = views[0].phase
    expect(['arrived', 'preOp']).toContain(phase0)
    h.run(60 * 60)
    expect(s.cases).toBe(views)
  })
})
