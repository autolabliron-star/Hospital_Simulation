/**
 * R4: the cryoablation suite's day, in a CryoHospital (./testkit: a MiniHospital with the surgery suite's recovery bays and the cryo suite), and
 * once in a full Simulation with the surgery day running beside it (the recovery bays are shared).
 */
import { describe, expect, it } from 'vitest'
import { CRYO_STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import { ACTION_ANIM } from '../procedure'
import { clockText } from '../events'
import { levelOf } from '../levels'
import { tryPlanRoute } from '../nav/graph'
import { areaAt, areaById, CRYO_SUITE, LIFTS, type Spot } from '../places'
import { timeAtHour } from '../population/schedule'
import { defaultSeats, SeatRegistry } from '../seats'
import { Simulation } from '../Simulation'
import { SurgerySites } from '../surgery/sites'
import { testPerson } from '../lifts/testkit'
import type { CryoStep, SimEvent } from '../types'
import { CryoSites } from './sites'
import { cryoTimeline, roomStepsFor, secondsOf, targetOf, type PlannedCryoCase } from './plan'
import { cryoSuite, runCryoDay, type CryoHospital, type CryoTrace } from './testkit'

const SEEDS = Array.from({ length: 50 }, (_, i) => 3100 + i * 53)

/** The room's step the nominal timeline has at t. */
function nominalStep(plan: readonly PlannedCryoCase[], t: number): CryoStep {
  for (const p of plan) {
    const tl = cryoTimeline(p)
    if (t < p.nominalIn || t >= tl.roomEnd) continue
    for (const s of roomStepsFor(targetOf(p))) if (t >= tl.start[s] && t < tl.end[s]) return s
  }
  for (const p of plan) {
    const tl = cryoTimeline(p)
    if (t >= tl.roomEnd && t < tl.turnoverEnd) return 'turnover'
  }
  return 'idle'
}

const runUntilHour = (h: CryoHospital, hour: number, dt = 0.1) => {
  const end = timeAtHour(hour)
  while (h.t < end) h.step(dt)
}

const cryoEvents = (events: readonly SimEvent[]) => events.filter((e) => e.type.startsWith('cryo'))

let cache: { seed: number; tr: CryoTrace }[] | null = null
function days(): { seed: number; tr: CryoTrace }[] {
  if (cache === null) cache = SEEDS.map((seed, i) => ({ seed, tr: runCryoDay(seed, { crowd: false, dt: 0.1, seats: i % 2 === 0 ? 'layout' : 'bare' }) }))
  return cache
}

describe('the cryoablation day, 50 seeds', () => {
  it('ends every case done (up to the ward again) with nobody left, no safety net fired and no rule broken', () => {
    for (const { seed, tr } of days()) {
      const c = tr.h.cryo
      const where = `seed ${seed}`
      expect(c.runs.map((r) => r.stage), where).toEqual(c.plan.map(() => 'done'))
      expect(c.stuckLog, where).toEqual([])
      expect(c.stuckFixes, where).toBe(0)
      expect(tr.h.lifts.stuckFixes, where).toBe(0)
      expect(tr.problems, where).toEqual([])
      expect(tr.stills, where).toEqual([])
      expect(tr.h.people.map((p) => p.entity.id), where).toEqual([])
      expect(c.state.step, where).toBe('idle')
      expect(c.state.robot.phase, where).toBe('stowed')
      expect(c.state.needles, where).toEqual([])
      expect(tr.h.surgery!.state.bays.every((b) => b.patientId === null && (b.guestName ?? null) === null), where).toBe(true)
      expect(tr.h.lifts.gates.every((g) => g.stretcherBy === null && g.fadeBy === null), where).toBe(true)
      for (const seat of tr.h.seats.all) if (levelOf(seat.x) === 2) expect(tr.h.seats.occupant(seat.id), `${where} ${seat.id}`).toBeNull()
      for (const v of c.cases) {
        expect(v.step, `${where} ${v.id}`).toBe('done')
        expect(v.wheelsIn, `${where} ${v.id}`).not.toBeNull()
        expect(v.wheelsOut, `${where} ${v.id}`).not.toBeNull()
      }
    }
  }, 300_000)

  it('walks every case through the steps in order, on the plan\'s clock (within a few seconds)', () => {
    for (const { seed, tr } of days()) {
      const c = tr.h.cryo
      for (const run of c.runs) {
        const seen = tr.steps.filter((s) => s.caseId === run.id)
        expect(
          seen.map((s) => s.step),
          `seed ${seed} ${run.id}`,
        ).toEqual(roomStepsFor(targetOf(run.plan)).slice())
        const tl = cryoTimeline(run.plan)
        for (const s of seen) expect(Math.abs(s.t - tl.start[s.step as keyof typeof tl.start]), `seed ${seed} ${run.id} ${s.step}`).toBeLessThan(5)
        // then the turnover, then idle
        const after = tr.steps[tr.steps.indexOf(seen[seen.length - 1]) + 1]
        expect(after.step, `seed ${seed} ${run.id}`).toBe('turnover')
        expect(Math.abs(after.t - tl.roomEnd), `seed ${seed} ${run.id}`).toBeLessThan(5)
      }
    }
  }, 300_000)

  it('logs each case once and in order: arrived, planned, every needle, its freezes (the lung\'s three), done', () => {
    for (const { seed, tr } of days()) {
      for (const run of tr.h.cryo.runs) {
        const mine = cryoEvents(tr.h.log.events).filter((e) => e.subjectId === `${run.id}-patient`)
        const n = run.plan.needles.length
        expect(
          mine.map((e) => e.type),
          `seed ${seed} ${run.id}`,
        ).toEqual(['cryoArrived', 'cryoPlanned', ...Array.from({ length: n }, () => 'cryoNeedle'), ...Array.from({ length: targetOf(run.plan) === 'lung' ? 3 : 2 }, () => 'cryoFreeze'), 'cryoDone'])
        for (const e of mine) expect(e.text).not.toMatch(/[{}]/)
        expect(mine[2 + n - 1].text).toContain(`${n} of ${n}`)
        const freezes = mine.filter((e) => e.type === 'cryoFreeze').map((e) => e.text)
        freezes.forEach((text, i) => expect(text, `${run.id} freeze ${i + 1}`).toContain(`Freeze ${i + 1} of ${freezes.length}`))
      }
    }
  }, 300_000)
})

describe('the scripted day, 50 seeds', () => {
  it('plays every script step of every case in order (kidney, lung and liver all drawn), with the pose, the held breath and the tube right and nobody carrying a stale pose', () => {
    const kinds = new Set<string>()
    for (const { seed, tr } of days()) {
      expect(tr.problems, `seed ${seed}`).toEqual([])
      for (const run of tr.h.cryo.runs) {
        const target = targetOf(run.plan)
        kinds.add(target)
        const sc = run.proc!
        const marks = tr.script.filter((m) => m.caseId === run.id)
        const n = sc.steps.flatCount
        const where = `seed ${seed} ${run.id} (${target})`
        expect(marks.map((m) => m.flat), where).toEqual(Array.from({ length: n }, (_, f) => f))
        expect(marks.map((m) => m.stepId), where).toEqual(Array.from({ length: n }, (_, f) => sc.steps.cs.script.steps[sc.steps.stepOf[f]].id))
        expect(marks.every((m) => !m.watch), where).toBe(true)
        // the repeat run once per needle (the view names the repeat only when there is more than one needle)
        const repeating = new Set(sc.steps.cs.script.steps.filter((x) => x.repeat === true).map((x) => x.id))
        expect(marks.filter((m) => repeating.has(m.stepId)), where).toHaveLength(run.plan.needles.length * sc.steps.cs.repeatLen)
        if (run.plan.needles.length > 1) expect(marks.filter((m) => m.k > 0).map((m) => m.k), where).toEqual(run.plan.needles.flatMap((_, i) => Array.from({ length: sc.steps.cs.repeatLen }, () => i + 1)))
        // the tube only from the breathing tube to the extubation step (lung)
        const tube = marks.filter((m) => m.airway === 'tube').map((m) => m.stepId)
        if (target === 'lung') {
          expect(tube[0], where).toBe('breathingTube')
          expect(tube[tube.length - 1], where).toBe('extubate')
        } else expect(tube, where).toEqual([])
        // the held breath: never for the kidney; for the others a few seconds of every scan and every push (R5 wave 3: judged as each step ends, runCryoDay)
        expect(tr.heldCases.includes(run.id), where).toBe(target !== 'kidney')
        // on the back at the end
        expect(marks[marks.length - 1].position, where).toBe('supine')
        // the lines the script says: its events and its three WHO pauses, once each, in order
        const mine = tr.h.log.events.filter((e) => e.subjectId === `${run.id}-patient`)
        const steps = sc.steps.cs.script.steps
        const said = mine.filter((e) => e.type === 'procedureStep').map((e) => e.text)
        expect(said, where).toEqual(Array.from({ length: n }, (_, f) => steps[sc.steps.stepOf[f]].event).filter((e): e is string => e !== undefined).map((e) => `${run.name}: ${e}`))
        expect(mine.filter((e) => e.type === 'whoSignIn' || e.type === 'whoTimeOut' || e.type === 'whoSignOut').map((e) => e.type), where).toEqual(['whoSignIn', 'whoTimeOut', 'whoSignOut'])
      }
    }
    expect([...kinds].sort()).toEqual(['kidney', 'liver', 'lung'])
  }, 300_000)
})

describe('the room\'s state', () => {
  it('keeps the robot stowed with the table in, a needle in only once aligned and until the needles come out, and the ice growing in a freeze', () => {
    // (runCryoDay checks these every step: here at 1/30 s and with the crowd on)
    for (const seed of [2026, 41]) {
      const tr = runCryoDay(seed, { crowd: true, dt: 1 / 30, until: 19 })
      expect(tr.problems, `seed ${seed}`).toEqual([])
      expect(tr.stills, `seed ${seed}`).toEqual([])
      const scans = tr.steps.filter((s) => s.step === 'planningCt' || s.step === 'checkCt' || s.step === 'finalCt')
      expect(scans.length).toBe(6)
    }
  }, 300_000)

  it('carries the patient on the CT table: lying on scanTable:cryo, moved in and out with tablePos', () => {
    const h = cryoSuite(2026, { crowd: false, hour: 9.5 })
    const c = h.cryo
    const run = c.runs[0]
    const tl = cryoTimeline(run.plan)
    while (h.t < tl.start.planningCt + run.plan.steps.planningCt / 2) h.step(0.1)
    const p = h.personById(`${run.id}-patient`)!
    expect(p.entity.seated?.seatId).toBe('scanTable:cryo')
    expect(c.state.tablePos).toBe(1)
    expect(c.state.rotor).toBe(1)
    const ref = c.sites.tableRef
    expect(p.walker.x).toBeCloseTo(ref.in.x, 3)
    while (h.t < tl.start.planning + 5) h.step(0.1)
    expect(c.state.tablePos).toBe(0)
    expect(p.walker.x).toBeCloseTo(ref.out.x, 3)
    expect(c.state.robot.phase).toBe('deploying')
    // the team where the step wants them: the radiographer at the CT console, the radiologist at the robot station, the nurse at the head end
    expect(h.personById('cryo-rad')!.entity.seated?.seatId).toBe('console:cryo:ct')
    expect(h.personById('cryo-ir')!.entity.seated?.seatId).toBe('console:cryo:robot')
    // (the nurse comes round from the control room's glass to the head end, where the script has her watch the patient)
    expect(h.runUntil(() => h.personById('cryo-nurse')!.entity.anim === ACTION_ANIM.watchMonitor, 120, 0.1)).toBe(true)
    expect(h.personById('cryo-ir')!.entity.outfit).toBe('theatre')
    expect(h.personById('cryo-rad')!.entity.outfit).toBe('role')
  }, 120_000)
})

describe('determinism', () => {
  it('replays the identical day for 3 seeds (07:30 to 20:00, crowd on), and another seed differs', () => {
    const snap = (h: CryoHospital) => {
      const { version: _v, ...rest } = h.cryo.state
      return JSON.stringify({
        state: rest,
        bays: h.surgery!.state.bays,
        lifts: h.lifts.state.cars,
        people: h.people.map((p) => [p.entity.id, +p.walker.x.toFixed(4), +p.walker.z.toFixed(4), p.entity.anim, p.entity.fade]),
      })
    }
    // (the first seed with the crowd on, the others without: cheaper, and the crowd is deterministic on its own)
    const run = (seed: number, crowd: boolean) => {
      const h = cryoSuite(seed, { crowd })
      const out: string[] = []
      for (let hour = 8; hour <= 20; hour++) {
        runUntilHour(h, hour, crowd ? 1 / 20 : 0.1)
        out.push(snap(h))
      }
      return { out, events: JSON.stringify(h.log.events) }
    }
    for (const [seed, crowd] of [
      [7, true],
      [2026, false],
      [515, false],
    ] as const) {
      const a = run(seed, crowd)
      const b = run(seed, crowd)
      expect(a.out, `seed ${seed}`).toEqual(b.out)
      expect(a.events, `seed ${seed}`).toEqual(b.events)
      if (seed === 2026) expect(run(2027, false).events).not.toEqual(a.events)
    }
  }, 300_000)
})

describe('warm starts', () => {
  it('place the room at every Jump moment as the plan has it, and the day then runs to its end', () => {
    for (const hour of CONFIG.day.moments) {
      for (const seed of [2026, 77]) {
        const where = `hour ${hour} seed ${seed}`
        const tr = runCryoDay(seed, { crowd: false, dt: 0.1, hour, seats: hour % 2 === 0 ? 'bare' : 'layout', until: Math.max(20, hour + 0.5) })
        const c = tr.h.cryo
        const t = timeAtHour(hour)
        expect(tr.steps[0].step, where).toBe(nominalStep(c.plan, t))
        expect(tr.problems, where).toEqual([])
        expect(tr.stills, where).toEqual([])
        expect(c.stuckFixes, `${where} ${c.stuckLog.join('|')}`).toBe(0)
        expect(c.runs.map((r) => r.stage), where).toEqual(c.plan.map(() => 'done'))
        expect(tr.h.people, where).toHaveLength(0)
        // the cases begun before the Jump kept their nominal times
        for (const r of c.runs) if (r.plan.nominalIn < t) expect(r.view.wheelsIn, where).toBe(r.plan.nominalIn)
      }
    }
  }, 300_000)

  it('start mid-case from the plan: the patient on the table, the needles in, the ice and the team in place', () => {
    const live = cryoSuite(2026, { crowd: false })
    const run = live.cryo.runs[0]
    const tl = cryoTimeline(run.plan)
    const hour = CONFIG.sim.startHour + (tl.start.freeze2 + 60) / 3600
    const h = cryoSuite(2026, { crowd: false, hour })
    const s = h.cryo.state
    expect(s.step).toBe('freeze2')
    expect(s.caseId).toBe(run.id)
    expect(s.argon).toBe(true)
    expect(s.needles.every((n) => n.inserted === 1 && n.active && n.errorMm > 0)).toBe(true)
    expect(s.ice).toBeGreaterThan(CONFIG.cryoSuite.firstFreezeSize * CONFIG.cryoSuite.thawKeep)
    expect(s.timer).toBeCloseTo(60, 0)
    expect(h.personById(`${run.id}-patient`)!.entity.seated?.seatId).toBe('scanTable:cryo')
    expect(h.personById('cryo-ir')!.walker.x).toBeCloseTo(h.cryo.sites.spots.atConsole.at.x, 1)
    // and in recovery a little later: a guest of the surgery suite's PACU, the highest bay first
    const later = cryoSuite(2026, { crowd: false, hour: CONFIG.sim.startHour + (tl.pacuIn + 300) / 3600 })
    const bay = later.surgery!.state.bays.find((b) => b.patientId === `${run.id}-patient`)
    expect(bay?.seatId).toBe('surgeryBed:pacu:2')
    expect(bay?.guestName).toBe(run.name)
    expect(later.cryo.state.step).toBe('turnover')
  })
})

describe('the presenter\'s demo', () => {
  it('has the team on site from 08:00 on a quiet day, and from the first second of the showcase (both rooms at work)', () => {
    const quiet = cryoSuite(1, { crowd: false, hour: 7.6 })
    expect(quiet.people).toHaveLength(0)
    const show = cryoSuite(1, { crowd: false, hour: 7.5, opening: 'showcase' })
    const where = show.people.map((p) => areaAt(p.walker.x, p.walker.z)?.id)
    expect(where).toContain('l2Cryo')
    expect(where).toContain('l2CryoControl')
    expect(show.cryo.startDemo()).toBe('started')
  })

  it('is noTeam before the team is on site and after it has gone', () => {
    expect(cryoSuite(1, { crowd: false, hour: 7.6 }).cryo.startDemo()).toBe('noTeam')
    expect(cryoSuite(1, { crowd: false, hour: 18 }).cryo.startDemo()).toBe('noTeam')
  })

  it('starts at once in an idle room (wheeled out of lift B within demoArrivalSeconds), is busy while it runs, and every case still ends', () => {
    const h = cryoSuite(31, { crowd: true, hour: 9 })
    const c = h.cryo
    h.step(0.1)
    expect(c.startDemo()).toBe('started')
    expect(c.startDemo()).toBe('busy')
    expect(c.cases[0].demo).toBe(true)
    h.run(CONFIG.cryoSuite.demoArrivalSeconds, 1 / 30)
    expect(c.state.step).toBe('arrive')
    expect(c.state.demo).toBe(true)
    const porter = h.personById(CRYO_STAFF.find((s) => s.title === 'wardPorter')!.id)!
    expect(porter.entity.fade).toBeGreaterThan(0.5)
    const demo = c.runs.find((r) => r.plan.demo)!
    // the whole procedure takes the script's watch seconds (600-900 s), the arrival and the stretcher's ride on top
    const watch = roomStepsFor(targetOf(demo.plan)).reduce((a, s) => a + secondsOf(demo.plan, s), 0)
    expect(watch).toBeGreaterThanOrEqual(600)
    expect(watch).toBeLessThanOrEqual(900)
    expect(h.runUntil(() => demo.roomEnd !== null, watch + 300, 1 / 30)).toBe(true)
    expect(c.startDemo()).toBe('queued')
    runUntilHour(h, 20, 0.1)
    expect(c.runs.map((r) => r.stage)).toEqual(c.runs.map(() => 'done'))
    expect(c.stuckFixes).toBe(0)
    expect(h.people).toHaveLength(0)
  }, 120_000)

  it('is queued while a case is in the room and goes to the front of the list: before a case already waiting', () => {
    const base = cryoSuite(77, { crowd: false })
    const second = base.cryo.runs[1].plan
    // 8 min before case 2 a demo starts (about 11-12 min in the room): while it is in the room, case 2 comes due and waits
    const h = cryoSuite(77, { crowd: false, hour: CONFIG.sim.startHour + (second.plannedIn - 8 * 60) / 3600 })
    const c = h.cryo
    h.step(0.1)
    expect(c.startDemo()).toBe('started')
    const d1 = c.runs.find((r) => r.id === 'cryo-demo-1')!
    expect(h.runUntil(() => d1.roomEnd !== null, 3600, 0.1)).toBe(true)
    const c2 = c.runs[1]
    expect(c2.stage).toBe('scheduled')
    expect(h.t).toBeGreaterThan(second.plannedIn)
    // in the turnover a second demo is booked: it goes before case 2
    expect(c.state.step).toBe('turnover')
    expect(c.startDemo()).toBe('queued')
    expect(c.state.demoQueued).toBe(true)
    const d2 = c.runs.find((r) => r.id === 'cryo-demo-2')!
    expect(c.cases.map((v) => v.id).indexOf(d2.id)).toBeLessThan(c.cases.map((v) => v.id).indexOf(c2.id))
    runUntilHour(h, 20, 0.1)
    expect(d2.wheelsIn).not.toBeNull()
    expect(c2.wheelsIn!).toBeGreaterThan(d2.wheelsIn!)
    expect(d2.wheelsIn!).toBeGreaterThanOrEqual(d1.roomEnd! + d1.plan.turnoverSeconds)
    expect(c.runs.every((r) => r.stage === 'done')).toBe(true)
    expect(c.stuckFixes).toBe(0)
  }, 120_000)
})

describe('recovery shared with the surgery suite', () => {
  it('never puts two patients in one PACU bay: a full Simulation 07:00 to 20:00 with both days and two demos', () => {
    const sim = new Simulation(2026, { population: false, startHour: 7 })
    sim.surgery.startDay(sim.t)
    sim.cryoSuite.startDay(sim.t)
    const end = timeAtHour(20)
    const bad: string[] = []
    const demos: string[] = []
    let next = sim.t
    while (sim.t < end) {
      sim.step(1 / 20)
      if (demos.length === 0 && sim.t >= timeAtHour(11.5)) demos.push(sim.cryoSuite.startDemo())
      if (demos.length === 1 && sim.t >= timeAtHour(12.5)) demos.push(sim.cryoSuite.startDemo())
      if (sim.t < next) continue
      next += 1
      const onBed = new Map<string, string[]>()
      for (const e of sim.entities.values()) {
        const id = e.seated?.seatId
        if (id?.startsWith('surgeryBed:pacu:')) onBed.set(id, [...(onBed.get(id) ?? []), e.id])
      }
      for (const [id, who] of onBed) if (who.length > 1 && bad.length < 10) bad.push(`${clockText(sim.t)} ${id}: ${who.join(', ')}`)
      for (const b of sim.surgery.state.bays) {
        if (b.kind !== 'pacu') continue
        const who = onBed.get(b.seatId) ?? []
        if (who.length === 1 && b.patientId !== null && b.patientId !== who[0] && bad.length < 10) bad.push(`${clockText(sim.t)} ${b.seatId} shows ${b.patientId}, ${who[0]} lies there`)
        if (b.guestName && !b.patientId?.startsWith('cryo') && bad.length < 10) bad.push(`${clockText(sim.t)} ${b.seatId} guest ${b.guestName} for ${b.patientId}`)
      }
    }
    expect(bad).toEqual([])
    // (11:30 and 12:30: the room is idle both times)
    expect(demos).toEqual(['started', 'started'])
    expect(sim.surgery.runs.every((r) => r.stage === 'done')).toBe(true)
    expect(sim.cryoSuite.runs.every((r) => r.stage === 'done')).toBe(true)
    expect([sim.surgery.stuckFixes, sim.cryoSuite.stuckFixes, sim.lifts.stuckFixes]).toEqual([0, 0, 0])
    expect(sim.cryoSuite.runs.filter((r) => r.plan.demo).length).toBe(demos.filter((d) => d === 'started' || d === 'queued').length)
  }, 300_000)

  it('runs both days beside each other in a mini hospital with the crowd on: nobody still in a level-2 doorway, every case done', () => {
    for (const seed of [2026, 31]) {
      const tr = runCryoDay(seed, { crowd: true, dt: 1 / 20, surgeryDay: true })
      expect(tr.problems, `seed ${seed}`).toEqual([])
      expect(tr.stills, `seed ${seed}`).toEqual([])
      expect([tr.h.cryo.stuckFixes, tr.h.surgery!.stuckFixes, tr.h.lifts.stuckFixes], `seed ${seed}`).toEqual([0, 0, 0])
      expect(tr.h.cryo.runs.every((r) => r.stage === 'done')).toBe(true)
      expect(tr.h.surgery!.runs.every((r) => r.stage === 'done')).toBe(true)
    }
  }, 300_000)
})

describe('the suite in the level-2 world', () => {
  it('reaches every CRYO_SUITE spot and seat approach from lift B\'s lobby, by route and on foot', () => {
    const h = cryoSuite(2026, { crowd: false, hour: 7.6 })
    const sites = h.cryo.sites
    const targets: { name: string; at: { x: number; z: number } }[] = []
    const add = (name: string, s: Spot) => targets.push({ name, at: s.at })
    for (const [k, v] of Object.entries(CRYO_SUITE.staff)) {
      if (Array.isArray(v)) v.forEach((s, i) => add(`staff.${k}${i}`, s))
      else add(`staff.${k}`, v as Spot)
    }
    add('viewing', CRYO_SUITE.viewing)
    for (const [k, v] of Object.entries(sites.spots)) {
      if (Array.isArray(v)) v.forEach((s, i) => add(`spots.${k}${i}`, s))
      else add(`spots.${k}`, v as Spot)
    }
    for (const ref of [sites.table, sites.ctConsole, sites.robotStation, ...sites.recovery.pacu]) targets.push({ name: ref.seat.id, at: ref.seat.approach })
    for (const seat of h.seats.all) if (/cryo/.test(seat.id)) targets.push({ name: seat.id, at: seat.approach })
    const from = LIFTS.B[2].stretcher.at
    expect(targets.filter((t) => tryPlanRoute(from, t.at) === null).map((t) => t.name)).toEqual([])
    const p = testPerson(h, 'walker', LIFTS.B[2].walkers[0])
    h.run(1, 0.1)
    for (const t of targets) {
      p.moveTo(t.at)
      expect(h.runUntil(() => p.done, 200, 0.1), `walking to ${t.name}`).toBe(true)
      expect(Math.hypot(p.x - t.at.x, p.z - t.at.z), t.name).toBeLessThan(0.05)
    }
  }, 120_000)

  it('uses the building\'s seats when it has them, and synthetic ones from the anchors when it has not', () => {
    const layout = new CryoSites(new SeatRegistry(defaultSeats()), new SurgerySites(new SeatRegistry(defaultSeats())), { tablePos: 0 })
    const bare = new CryoSites(new SeatRegistry(defaultSeats().filter((s) => !/cryo/.test(s.id))), new SurgerySites(new SeatRegistry(defaultSeats())), { tablePos: 0 })
    for (const sites of [layout, bare]) {
      expect(sites.table.seat.id).toBe('scanTable:cryo')
      expect(sites.table.seat.pose).toBe('lie')
      expect(sites.table.seat.heading).toBeCloseTo(CRYO_SUITE.ct.table.heading, 6)
      expect(sites.tableRef.in.x - sites.tableRef.out.x).toBeCloseTo(CRYO_SUITE.ct.table.in.x - CRYO_SUITE.ct.table.out.x, 6)
      expect(sites.ctConsole.seat.id).toBe('console:cryo:ct')
      expect(sites.robotStation.seat.id).toBe('console:cryo:robot')
    }
    expect(layout.table.real).toBe(true)
    expect(bare.table.real).toBe(false)
  })

  it('keeps the family lounge\'s standing spots inside the new, smaller lounge', () => {
    const sites = new SurgerySites(new SeatRegistry(defaultSeats()))
    const r = areaById('l2Lounge').rect
    for (const s of sites.spots.loungeStand) {
      expect(s.at.x).toBeGreaterThan(r.x0)
      expect(s.at.x).toBeLessThan(r.x1)
      expect(s.at.z).toBeGreaterThan(r.z0)
      expect(s.at.z).toBeLessThan(r.z1)
    }
  })
})
