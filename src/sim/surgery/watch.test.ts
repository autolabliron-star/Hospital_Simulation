/**
 * R5: "Watch step by step" in the robotic theatre (src/sim/surgery/watch.ts): a compressed gallbladder removal booked in front of the day's
 * list. Its steps last their watch seconds; the day then runs to its end with the later cases moved back, the robot's segments in order and
 * recovery never double-booked; the port answers 'started', 'queued', 'following', 'busy' and 'noTeam' as documented; and it is deterministic
 * (a warm start drops it and gives the plan back).
 */
import { describe, expect, it } from 'vitest'
import { compiledFor } from '../procedure'
import { CONFIG } from '../config'
import { timeAtHour } from '../population/schedule'
import { Simulation } from '../Simulation'
import type { RobotPhase, SurgeryProcedure } from '../types'
import type { Surgery } from './index'
import { MiniHospital, runToHour, suite } from './testkit'
import { WatchCase, watchDrapeWindow, watchPhasesOf } from './watch'

const cs = compiledFor('or-cholecystectomy')!
const DT = 0.1

const NEXT: Record<RobotPhase, RobotPhase[]> = {
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

interface WatchRun {
  h: MiniHospital
  s: Surgery
  w: WatchCase
  /** Per flat step of the watch case: how long the view showed it. */
  lasted: number[]
  problems: string[]
  robot: RobotPhase[]
  maxDrapeJump: number
}

/** Start a watch at `hour` on a quiet day and run the day out (07:00 start so the team is in). */
function watchDay(seed: number, hour: number, opts: { at?: (s: Surgery) => number; crowd?: boolean; procedure?: SurgeryProcedure } = {}): WatchRun & { result: string } {
  const h = suite(seed, { crowd: opts.crowd ?? false, hour: 7 })
  const s = h.surgery!
  const at = opts.at?.(s) ?? timeAtHour(hour)
  while (h.t < at) h.step(DT)
  const result = s.startWatch(opts.procedure ?? 'cholecystectomy')
  const w = s.runs.find((c) => c instanceof WatchCase) as WatchCase
  const problems: string[] = []
  const note = (rule: string, text: string) => {
    if (problems.filter((p) => p.startsWith(rule)).length < 3) problems.push(`${rule}: ${(h.t / 3600 + 7.5).toFixed(3)}h ${text}`)
  }
  const v = s.state.procedure
  const lasted: number[] = []
  let since = -1
  let flat = -1
  const robot: RobotPhase[] = [s.state.robot.phase]
  let drape = s.state.robot.arms.map((a) => a.drape)
  let maxDrapeJump = 0
  let nextCheck = h.t
  const end = timeAtHour(19.5)
  while (h.t < end) {
    h.step(DT)
    const r = s.state.robot
    if (r.phase !== robot[robot.length - 1]) robot.push(r.phase)
    for (let i = 0; i < 4; i++) maxDrapeJump = Math.max(maxDrapeJump, Math.abs(r.arms[i].drape - drape[i]))
    drape = r.arms.map((a) => a.drape)
    // the watch case's steps, as the view shows them
    const showing = v.caseId === w?.id ? v.stepIndex : -1
    if (showing !== flat) {
      if (flat >= 0) lasted[flat] = h.t - since
      flat = showing
      since = h.t
    }
    if (h.t >= nextCheck) {
      nextCheck += 5
      // the robot's day in order: each case's drape after the one before has undocked
      const times = s.robotTimes(h.t)
      for (let k = 1; k < times.length; k++) if (times[k].drapeStart < times[k - 1].undockEnd - 1e-6) note('segments', `${s.runs[k].id} drapes before ${s.runs[k - 1].id} undocks`)
      // recovery: one patient per bay
      const inPacu = s.runs.filter((c) => c.stage === 'pacu').map((c) => c.pacu)
      if (new Set(inPacu).size !== inPacu.length) note('pacu', `bays ${inPacu.join(',')}`)
      const held = s.state.bays.filter((b) => b.kind === 'pacu' && b.patientId !== null).map((b) => b.patientId)
      if (new Set(held).size !== held.length) note('pacu', `patients ${held.join(',')}`)
      if (s.runs.filter((c) => c.inRoom).length > 1) note('room', 'two cases in the room')
      const th = s.state.theatre
      if (th.phase === 'console' && r.phase !== 'docked') note('console', `console phase with the robot ${r.phase}`)
      if ((r.phase === 'deploying' || r.phase === 'driving' || r.phase === 'docking' || r.phase === 'targeting') && th.phase !== 'docking') note('robot', `${r.phase} in ${th.phase}`)
      if ((r.phase === 'undocking' || r.phase === 'returning') && th.phase !== 'undocking') note('robot', `${r.phase} in ${th.phase}`)
      if (th.surgeonAtConsole && th.phase !== 'console') note('console', `surgeon at the console in ${th.phase}`)
    }
    if (s.runs.every((c) => c.stage === 'done') && h.t > timeAtHour(18.6)) break
  }
  return { h, s, w, lasted, problems, robot, maxDrapeJump, result }
}

describe('a watch case at 07:05 on a quiet day', () => {
  const runs = [2026, 77, 31].map((seed) => ({ seed, ...watchDay(seed, 7 + 5 / 60) }))

  it('starts now and lasts the script\'s watch seconds step by step (the robot\'s slots aside, a few seconds either way), under 16 minutes in the room', () => {
    for (const r of runs) {
      const where = `seed ${r.seed}`
      expect(r.result, where).toBe('started')
      expect(r.w, where).toBeInstanceOf(WatchCase)
      expect(r.w.view.watch, where).toBe(true)
      const steps = cs.script.steps
      expect(r.lasted.length, where).toBe(steps.length)
      steps.forEach((step, i) => {
        const d = r.lasted[i]
        expect(d, `${where} ${step.id}`).toBeGreaterThan(step.watchSeconds - 3)
        expect(d, `${where} ${step.id}`).toBeLessThan(step.watchSeconds + 15)
      })
      // nearly every step to within 3 s (an overrun only where the room waits for a person: the surgeon to sit, the stretcher)
      expect(r.lasted.filter((d, i) => Math.abs(d - steps[i].watchSeconds) > 3).length, where).toBeLessThanOrEqual(2)
      const room = r.w.view.wheelsOut! - r.w.view.wheelsIn!
      expect(room, where).toBeLessThanOrEqual(960)
      const phases = watchPhasesOf('cholecystectomy')!
      expect(room, where).toBeGreaterThanOrEqual(Object.values(phases).reduce((n, x) => n + x, 0) - 1)
      // wheeled in within a minute of the button (the robot drapes for 45 s first)
      expect(r.w.view.wheelsIn! - timeAtHour(7 + 5 / 60), where).toBeLessThan(60)
    }
  })

  it('then runs the day out: every case done, nothing stuck, the robot in order, recovery never double-booked, the KPIs the list\'s', () => {
    for (const r of runs) {
      const where = `seed ${r.seed}`
      expect(r.s.runs.map((c) => c.stage), where).toEqual(r.s.runs.map(() => 'done'))
      expect(r.s.stuckLog, where).toEqual([])
      expect(r.h.lifts.stuckLog, where).toEqual([])
      expect(r.problems, where).toEqual([])
      expect(r.h.people, where).toHaveLength(0)
      for (let i = 1; i < r.robot.length; i++) expect(NEXT[r.robot[i - 1]], `${where} ${r.robot[i - 1]} then ${r.robot[i]}`).toContain(r.robot[i])
      // one more full robot cycle than the list
      expect(r.robot.filter((k) => k === 'docked').length, where).toBe(r.s.plan.length + 1)
      // the list's KPIs leave the watch case out
      expect(r.s.state.theatre.kpis.casesToday, where).toBe(r.s.plan.length)
      // the day's cases came in no earlier than the watch case's wheels-out plus its turnover
      const next = r.s.runs[r.s.runs.indexOf(r.w) + 1]
      expect(next.view.wheelsIn!, where).toBeGreaterThanOrEqual(r.w.view.wheelsOut! + r.w.plan.turnoverSeconds - 1)
    }
  })
})

describe.each(['hysterectomy', 'prostatectomy'] as const)('a watch case of the %s at 07:05 on a quiet day', (procedure) => {
  const script = compiledFor(`or-${procedure}`)!
  const runs = [2026, 77].map((seed) => ({ seed, ...watchDay(seed, 7 + 5 / 60, { procedure }) }))

  it('starts now and lasts the script\'s watch seconds step by step, under 16 minutes in the room, and runs through the pelvic table pose', () => {
    for (const r of runs) {
      const where = `${procedure} seed ${r.seed}`
      expect(r.result, where).toBe('started')
      expect(r.w, where).toBeInstanceOf(WatchCase)
      expect(r.w.view.watch, where).toBe(true)
      expect(r.w.plan.procedure, where).toBe(procedure)
      const steps = script.script.steps
      expect(r.lasted.length, where).toBe(steps.length)
      steps.forEach((step, i) => {
        const d = r.lasted[i]
        expect(d, `${where} ${step.id}`).toBeGreaterThan(step.watchSeconds - 3)
        expect(d, `${where} ${step.id}`).toBeLessThan(step.watchSeconds + 15)
      })
      expect(r.lasted.filter((d, i) => Math.abs(d - steps[i].watchSeconds) > 3).length, where).toBeLessThanOrEqual(2)
      const room = r.w.view.wheelsOut! - r.w.view.wheelsIn!
      expect(room, where).toBeLessThanOrEqual(960)
      expect(room, where).toBeGreaterThanOrEqual(Object.values(watchPhasesOf(procedure)!).reduce((n, x) => n + x, 0) - 1)
      expect(r.w.view.wheelsIn! - timeAtHour(7 + 5 / 60), where).toBeLessThan(60)
    }
  })

  it('then runs the day out: every case done, nothing stuck, the robot in order, recovery never double-booked', () => {
    for (const r of runs) {
      const where = `${procedure} seed ${r.seed}`
      expect(r.s.runs.map((c) => c.stage), where).toEqual(r.s.runs.map(() => 'done'))
      expect(r.s.stuckLog, where).toEqual([])
      expect(r.h.lifts.stuckLog, where).toEqual([])
      expect(r.problems, where).toEqual([])
      expect(r.h.people, where).toHaveLength(0)
      for (let i = 1; i < r.robot.length; i++) expect(NEXT[r.robot[i - 1]], `${where} ${r.robot[i - 1]} then ${r.robot[i]}`).toContain(r.robot[i])
      expect(r.robot.filter((k) => k === 'docked').length, where).toBe(r.s.plan.length + 1)
      expect(r.s.state.theatre.kpis.casesToday, where).toBe(r.s.plan.length)
      const next = r.s.runs[r.s.runs.indexOf(r.w) + 1]
      expect(next.view.wheelsIn!, where).toBeGreaterThanOrEqual(r.w.view.wheelsOut! + r.w.plan.turnoverSeconds - 1)
    }
  })

  it('shows the patient in the pose the script gives: lithotomy and tucked arms before the cart drives in, head down while it is docked, level again when it has gone, a catheter in', () => {
    // a fresh run, sampling the pose as each step begins
    const h = suite(2026, { crowd: false, hour: 7 })
    const s = h.surgery!
    while (h.t < timeAtHour(7 + 5 / 60)) h.step(DT)
    expect(s.startWatch(procedure)).toBe('started')
    const pose = s.state.procedure
    const seen: Record<string, { position: string; tilt: number; arms: string; catheter: boolean; manipulator: boolean }> = {}
    const target = script.script.steps
    let last = ''
    while (h.t < timeAtHour(19) && !(pose.procedureId === `or-${procedure}` && pose.stepId === 'wheelsOut')) {
      h.step(DT)
      if (pose.procedureId === `or-${procedure}` && pose.stepId !== last) {
        last = pose.stepId
        seen[pose.stepId] = { position: pose.patient.position, tilt: pose.patient.headTiltDeg, arms: pose.patient.arms, catheter: pose.patient.catheter, manipulator: pose.patient.manipulator }
      }
    }
    const first = (id: string) => seen[id]
    expect(target.length).toBeGreaterThan(30)
    expect(first('driveCart').position).toBe('lithotomy')
    expect(first('driveCart').arms).toBe('tucked')
    expect(first('driveCart').catheter).toBe(true)
    expect(first('driveCart').tilt).toBeLessThan(-15)
    expect(first('driveCart').manipulator).toBe(procedure === 'hysterectomy')
    expect(first('closePorts').tilt).toBe(0)
    expect(first('closePorts').catheter).toBe(true)
    expect(first('closePorts').manipulator).toBe(false)
    expect(first('wakeUp').position).toBe('supine')
  }, 120_000)
})

describe('a watch case with the crowd on', () => {
  it('runs the same: started, its steps on time, the day done, nothing stuck', () => {
    const r = watchDay(2026, 7 + 5 / 60, { crowd: true })
    expect(r.result).toBe('started')
    cs.script.steps.forEach((step, i) => expect(Math.abs(r.lasted[i] - step.watchSeconds), step.id).toBeLessThan(15))
    expect(r.s.runs.every((c) => c.stage === 'done')).toBe(true)
    expect(r.s.stuckLog).toEqual([])
    expect(r.problems).toEqual([])
  }, 300_000)
})

describe('a watch case pushes the list back', () => {
  it('moves the first case (whose patient is already in pre-op) and the ones after it, and the day still completes', () => {
    for (const seed of [2026, 5]) {
      const r = watchDay(seed, 7 + 40 / 60)
      const where = `seed ${seed}`
      expect(r.result, where).toBe('started')
      const i = r.s.runs.indexOf(r.w)
      expect(i, where).toBe(0)
      const b = r.s.runs[1]
      expect(b.shift, where).toBeGreaterThan(5 * 60)
      expect(b.nominalIn, where).toBeGreaterThanOrEqual(r.w.view.wheelsOut! + r.w.plan.turnoverSeconds - 1)
      expect(b.view.wheelsIn! - b.plan.nominalIn, where).toBeGreaterThan(5 * 60)
      for (let k = 2; k < r.s.runs.length; k++) {
        const c = r.s.runs[k]
        const prev = r.s.runs[k - 1]
        expect(c.view.wheelsIn!, `${where} ${c.id}`).toBeGreaterThanOrEqual(prev.view.wheelsOut! + prev.plan.turnoverSeconds - 1)
      }
      expect(r.s.runs.every((c) => c.stage === 'done'), where).toBe(true)
      expect(r.s.stuckLog, where).toEqual([])
      expect(r.problems, where).toEqual([])
    }
  }, 120_000)

  it('takes over a drape under way for the first case, without the drapes jumping', () => {
    const r = watchDay(2026, 0, { at: (s) => (s.runs[0].tl.drapeStart + s.runs[0].tl.drapeEnd) / 2 })
    expect(r.result).toBe('started')
    expect(r.robot.slice(0, 3)).toEqual(['draping', 'draped', 'deploying'])
    expect(r.maxDrapeJump).toBeLessThan(0.02)
    expect(r.problems).toEqual([])
    expect(r.s.runs.every((c) => c.stage === 'done')).toBe(true)
  }, 120_000)
})

describe('what "Watch step by step" answers', () => {
  it('following at the 07:30 showcase (a case at the console); with fromStart, queued for one turnover after it leaves, then busy', () => {
    // (a full showcase list may have no room for one more case before the team goes home: 'noTeam', and the next seed is tried)
    let h: MiniHospital | null = null
    for (const seed of [2026, 7, 42, 1000, 5101, 9999]) {
      const x = suite(seed, { crowd: false, opening: 'showcase' })
      const sx = x.surgery!
      expect(sx.state.theatre.phase, `seed ${seed}`).toBe('console')
      expect(sx.startWatch('cholecystectomy'), `seed ${seed}`).toBe('following')
      expect(sx.watchStartsAt).toBeNull()
      expect(sx.runs.some((c) => c instanceof WatchCase)).toBe(false)
      const r = sx.startWatch('cholecystectomy', { fromStart: true })
      expect(['queued', 'noTeam'], `seed ${seed}`).toContain(r)
      if (r === 'queued') {
        h = x
        break
      }
      expect(sx.watchStartsAt).toBeNull()
    }
    expect(h).not.toBeNull()
    const hh = h as unknown as MiniHospital
    const s = hh.surgery!
    const projected = s.watchStartsAt!
    expect(projected).toBeGreaterThan(hh.t)
    expect(s.startWatch('cholecystectomy')).toBe('busy')
    expect(s.startWatch('cholecystectomy', { fromStart: true })).toBe('busy')
    const inRoom = s.runs.find((c) => c.inRoom)!
    while (inRoom.leftRoomAt === null) hh.step(DT)
    hh.step(DT)
    const w = s.runs.find((c) => c instanceof WatchCase)!
    expect(w.arriveAt).toBe(inRoom.leftRoomAt + inRoom.plan.turnoverSeconds)
    expect(s.watchStartsAt).toBe(w.arriveAt)
    expect(Math.abs(projected - w.arriveAt)).toBeLessThan(120)
    expect(s.runs.indexOf(w)).toBe(s.runs.indexOf(inRoom) + 1)
    expect(s.cases[s.runs.indexOf(w)]).toBe(w.view)
    while (w.stage === 'scheduled') hh.step(DT)
    expect(s.watchStartsAt).toBeNull()
    expect(hh.t).toBeGreaterThanOrEqual(w.arriveAt)
    expect(s.startWatch('cholecystectomy')).toBe('busy')
    runToHour(hh, 19.5, 0.2)
    expect(s.runs.every((c) => c.stage === 'done')).toBe(true)
    expect(s.stuckLog).toEqual([])
  }, 120_000)

  it('queued during a turnover, for its exact end', () => {
    const h = suite(77, { crowd: false })
    const s = h.surgery!
    while (s.state.theatre.phase !== 'turnover') h.step(DT)
    h.run(300)
    const out = s.runs.find((c) => c.leftRoomAt !== null)!
    expect(s.startWatch('cholecystectomy')).toBe('queued')
    const w = s.runs.find((c) => c instanceof WatchCase)!
    expect(w.arriveAt).toBe(out.leftRoomAt! + out.plan.turnoverSeconds)
    expect(s.watchStartsAt).toBe(w.arriveAt)
    expect(s.startWatch('cholecystectomy')).toBe('busy')
    while (w.view.wheelsIn === null) h.step(DT)
    expect(w.view.wheelsIn).toBeGreaterThanOrEqual(w.arriveAt)
    expect(w.view.wheelsIn! - w.arriveAt).toBeLessThan(60)
  }, 120_000)

  it('noTeam: before the day has started, before the team is in, and too late in the day', () => {
    const bare = new MiniHospital(1, { crowd: false, surgery: true, t0: 0 })
    expect(bare.surgery!.startWatch('cholecystectomy')).toBe('noTeam')
    const early = suite(2026, { crowd: false, hour: 6.5 })
    expect(early.surgery!.startWatch('cholecystectomy')).toBe('noTeam')
    const late = suite(2026, { crowd: false, hour: CONFIG.surgery.teamToHour - 0.3 })
    expect(late.surgery!.startWatch('cholecystectomy')).toBe('noTeam')
    expect(late.surgery!.watchStartsAt).toBeNull()
  })
})

describe('the drape window', () => {
  it('keeps a finished drape, finishes one under way at the watch pace from where it is, and otherwise drapes from the start', () => {
    const D = CONFIG.surgery.watch.drapeSeconds
    expect(watchDrapeWindow({ kind: 'stowed', since: 0, until: 100, caseIndex: 0 }, 0, 50, 60)).toEqual({ at: 60, seconds: D })
    expect(watchDrapeWindow({ kind: 'draped', since: 40, until: 100, caseIndex: 1 }, 1, 50, 50)).toEqual({ at: 40 - D, seconds: D })
    const w = watchDrapeWindow({ kind: 'draping', since: 0, until: 300, caseIndex: 1 }, 1, 100, 100)
    expect((100 - w.at) / w.seconds).toBeCloseTo(100 / 300, 9)
    expect(w.at + w.seconds).toBeCloseTo(100 + (2 / 3) * D, 9)
    // (the segment of another case: not taken over)
    expect(watchDrapeWindow({ kind: 'draping', since: 0, until: 300, caseIndex: 2 }, 1, 100, 100)).toEqual({ at: 100, seconds: D })
  })
})

describe('determinism', () => {
  it('two Simulations with the same seed and the same watch agree on the theatre, the robot, the view and every event', () => {
    const run = () => {
      const sim = new Simulation(2026, { population: false })
      sim.surgery.startDay(sim.t)
      const out: string[] = []
      const strip = <T extends { version?: number }>(o: T) => {
        const { version: _v, ...rest } = o
        return rest
      }
      while (sim.t < timeAtHour(7.6)) sim.step(1 / 20)
      const result = sim.surgery.startWatch('cholecystectomy')
      let next = sim.t + 120
      while (sim.t < timeAtHour(10)) {
        sim.step(1 / 20)
        if (sim.t >= next) {
          next += 120
          const { roles, patient, ...view } = strip(sim.surgery.state.procedure)
          out.push(JSON.stringify({ robot: strip(sim.surgery.state.robot), theatre: strip(sim.surgery.state.theatre), view, roles, patient }))
        }
      }
      return { result, out, events: JSON.stringify(sim.log.events), stuck: sim.surgery.stuckFixes }
    }
    const a = run()
    const b = run()
    expect(a.result).toBe('started')
    expect(a.out).toEqual(b.out)
    expect(a.events).toEqual(b.events)
    expect(a.stuck).toBe(0)
  }, 300_000)

  it('a warm start after a watch drops it and gives the day\'s plan back, unmoved', () => {
    const h = suite(2026, { crowd: false, hour: 7.6 })
    const s = h.surgery!
    const plan = JSON.stringify(s.plan)
    expect(s.startWatch('cholecystectomy')).toBe('started')
    h.run(600)
    expect(s.runs.some((c) => c.isWatch)).toBe(true)
    expect(s.state.procedure.watch).toBe(true)
    s.warmStart(8.5)
    expect(s.runs.some((c) => c.isWatch)).toBe(false)
    expect(s.cases.some((v) => v.watch === true)).toBe(false)
    expect(s.runs.every((c) => c.shift === 0)).toBe(true)
    expect(s.watchStartsAt).toBeNull()
    expect(JSON.stringify(s.plan)).toBe(plan)
    // the same as a fresh day warmed to the same hour
    const fresh = suite(2026, { crowd: false, hour: 8.5 })
    const strip = <T extends { version?: number }>(o: T) => {
      const { version: _v, ...rest } = o
      return rest
    }
    expect(JSON.stringify(s.cases)).toBe(JSON.stringify(fresh.surgery!.cases))
    expect(JSON.stringify(strip(s.state.robot))).toBe(JSON.stringify(strip(fresh.surgery!.state.robot)))
    const { roles: ra, ...va } = strip(s.state.procedure)
    const { roles: rb, ...vb } = strip(fresh.surgery!.state.procedure)
    expect(JSON.stringify([va, ra])).toBe(JSON.stringify([vb, rb]))
  }, 120_000)
})
