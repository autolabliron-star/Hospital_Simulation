/**
 * R5: the robotic theatre plays its procedure scripts (src/sim/surgery/script.ts, src/sim/procedure) in the living day, over 50 seeds: every
 * scripted case walks its steps in order, each step in the theatre phase it belongs to; the published view, the robot's arms, the bedside
 * exchanges, the WHO checklist and the team's places, actions and attire all follow the step under the clock. Cases without a script keep the
 * R2 behaviour (an empty view).
 */
import { describe, expect, it } from 'vitest'
import { SURGERY_COPY } from '@/content/surgery'
import { armsAt, compiledFor, newTargetCtx, roleLineOf, setTable } from '../procedure'
import { ATTIRE, type ProcAction, type SimEvent, type SurgeryProcedure } from '../types'
import type { Staffer } from './actors'
import { attireTable, caseScriptFor, OR_ROLES, placeRoles, roleIndexOf, workPointInto, type Placement } from './script'
import { SurgerySites } from './sites'
import { MiniHospital, seatsFor } from './testkit'
import { SURGERY } from '../places'
import { isWalkable } from '../nav/layout'
import { cartPose } from './robot'
import { suite } from './testkit'
import { Rng } from '../rng'
import { planDay } from './plan'
import { timeAtHour } from '../population/schedule'

/** (`R5_SEEDS=6` runs a quick pass while writing a script; the default is the full 50.) */
const SEEDS = Array.from({ length: Number(process.env.R5_SEEDS ?? 50) }, (_, i) => 9100 + i * 37)
const DT = 0.2
/** A role must be at its step's spot, doing the step's action, this long after the step began. */
const REACH = 20

interface CaseLog {
  id: string
  name: string
  procedure: SurgeryProcedure
  scripted: boolean
  /** Flat steps in the order the view showed them, and the sim time each was first shown. */
  flats: number[]
  starts: number[]
  flatCount: number
  exchangesPlanned: number
}

interface DaySummary {
  seed: number
  cases: CaseLog[]
  /** Broken rules (the first few of each). */
  problems: string[]
  /** How many role-at-anchor checks ran, and how many view samples. */
  reachChecks: number
  samples: number
  events: SimEvent[]
  stuck: string[]
  done: boolean
}

function runDay(seed: number, mode: 'layout' | 'bare' | 'withOr'): DaySummary {
  const h = suite(seed, { crowd: false, seats: mode })
  const s = h.surgery!
  const v = s.state.procedure
  const problems: string[] = []
  const note = (rule: string, text: string) => {
    if (problems.filter((p) => p.startsWith(rule)).length < 3) problems.push(`${rule}: ${(h.t / 3600 + 7.5).toFixed(3)}h ${text}`)
  }
  const cases: CaseLog[] = s.runs.map((c) => ({
    id: c.id,
    name: c.patientName,
    procedure: c.plan.procedure,
    scripted: c.proc !== null,
    flats: [],
    starts: [],
    flatCount: c.proc?.steps.flatCount ?? 0,
    exchangesPlanned: c.proc?.exchanges.length ?? c.plan.exchanges.length,
  }))
  const team = new Map<string, Staffer>()
  const arms = ['', '', '', '']
  let reachChecks = 0
  let samples = 0
  let pendingCheck: { at: number; flat: number; caseId: string } | null = null
  const end = timeAtHour(19.5)
  while (h.t < end) {
    h.step(DT)
    if (team.size === 0) for (const st of s.team.staffers) if (roleIndexOf(st.title) >= 0) team.set(st.title, st)
    // nobody acts while walking
    for (const st of s.team.staffers) {
      if (st.entity.act != null && !(st.done && st.mode === 'static')) note('walking', `${st.title} has act ${st.entity.act.action} while ${st.mode}`)
    }
    const active = s.runs.find((c) => c.inRoom) ?? null
    if (active === null || active.proc === null) {
      if (v.procedureId !== null) note('empty', `the view shows ${v.caseId} with ${active?.id ?? 'nobody'} in the room`)
      continue
    }
    samples++
    const sc = active.proc
    const log = cases.find((c) => c.id === active.id)!
    if (v.caseId !== active.id) note('case', `view ${v.caseId} for ${active.id}`)
    // the step's unit is the theatre phase now
    if (v.unit !== s.state.theatre.phase) note('unit', `${active.id} step ${v.stepId} of unit ${v.unit} in phase ${s.state.theatre.phase}`)
    if (log.flats[log.flats.length - 1] !== v.stepIndex) {
      log.flats.push(v.stepIndex)
      log.starts.push(h.t)
      pendingCheck = { at: h.t + REACH, flat: v.stepIndex, caseId: active.id }
      if (v.stepEnds - v.stepSince < REACH + 3) pendingCheck = null
    }
    // the patient wears the view's pose
    if (active.patient !== null && active.patient.entity.patientPose !== v.patient) note('pose', `${active.id} patient pose is not the view's`)
    // the arms hold the script's instruments at every moment
    const r = s.state.robot
    const start = active.view.consoleStart
    if (start !== null && (r.phase === 'docked' || r.phase === 'undocking' || r.phase === 'returning')) {
      armsAt(sc.steps, start, start + active.plan.phases.console, h.t, arms)
      for (let i = 0; i < 4; i++) if (r.arms[i].instrument !== '' && r.arms[i].instrument !== arms[i]) note('arms', `${active.id} arm ${i} ${r.arms[i].instrument} instead of ${arms[i]}`)
    }
    // the roles are at their spots, doing the step's action, REACH seconds in
    if (pendingCheck !== null && h.t >= pendingCheck.at && pendingCheck.caseId === active.id && pendingCheck.flat === v.stepIndex) {
      pendingCheck = null
      const step = sc.steps.stepOf[v.stepIndex]
      for (const role of OR_ROLES) {
        const line = roleLineOf(sc.steps.cs, step, role)
        if (line === null) continue
        const st = [...team.values()].find((x) => OR_ROLES[roleIndexOf(x.title)] === role)!
        reachChecks++
        const act = st.entity.act
        const seat = line.anchor === 'surgeonConsole' ? 'console:or:surgeon' : line.anchor === 'anaesStool' ? 'console:or:anaes' : null
        const placed = s.team.placementOf(roleIndexOf(st.title))
        const spot = placed?.at ?? s.sites.anchor(line.anchor).at
        const there = seat !== null ? st.entity.seated?.seatId === seat : Math.hypot(st.walker.x - spot.x, st.walker.z - spot.z) < 0.05
        if (!there || act == null || act.action !== (line.action as ProcAction)) {
          note('reach', `${active.id} ${v.stepId}: ${role} ${there ? 'at' : 'not at'} ${line.anchor}, act ${act?.action ?? 'none'} (wants ${line.action})`)
        }
        // the renderer's placement: the work point 0.35-0.95 m away, the person facing it within 30 degrees, the eyes on it
        if (seat === null && act?.work != null) {
          const w = act.work
          const d = Math.hypot(w.x - st.walker.x, w.z - st.walker.z)
          const turn = Math.atan2(w.x - st.walker.x, w.z - st.walker.z) - st.walker.heading
          const off = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))
          if (d < 0.35 || d > 0.95 || off > Math.PI / 6) note('work', `${active.id} ${v.stepId}: ${role} works ${d.toFixed(2)} m away, ${((off * 180) / Math.PI).toFixed(0)} deg off`)
          const look = st.entity.lookAt
          if (look == null || Math.hypot(look.x - w.x, look.y - w.y, look.z - w.z) > 1e-6) note('look', `${active.id} ${v.stepId}: ${role} looks away from the work`)
        }
        if ((st.entity.attire ?? 0) !== sc.attire[step * OR_ROLES.length + roleIndexOf(st.title)]) note('attire', `${active.id} ${v.stepId}: ${role} attire ${st.entity.attire}`)
      }
    }
    if (s.runs.every((c) => c.stage === 'done')) break
  }
  return { seed, cases, problems, reachChecks, samples, events: h.log.events.slice(), stuck: s.stuckLog.slice(), done: s.runs.every((c) => c.stage === 'done') }
}

let cache: DaySummary[] | null = null
function days(): DaySummary[] {
  if (cache === null) cache = SEEDS.map((seed, i) => runDay(seed, (['layout', 'bare', 'withOr'] as const)[i % 3]))
  return cache
}

describe('the living day plays the procedure scripts, 50 seeds', () => {
  it('runs every case to its end with nothing stuck and no rule broken: the view, the unit, the pose, the arms, nobody acting on the move', () => {
    let scripted = 0
    const byProcedure: Record<string, number> = {}
    const broken: string[] = []
    for (const d of days()) {
      expect(d.done, `seed ${d.seed}`).toBe(true)
      expect(d.stuck, `seed ${d.seed}`).toEqual([])
      for (const p of d.problems) broken.push(`seed ${d.seed} ${p}`)
      for (const c of d.cases) {
        if (!c.scripted) continue
        scripted++
        byProcedure[c.procedure] = (byProcedure[c.procedure] ?? 0) + 1
      }
    }
    expect(broken).toEqual([])
    // (most templates have a gallbladder removal or two; the pelvic operations come up in the longer days)
    expect(scripted).toBeGreaterThan(Math.round(SEEDS.length * 1.0))
    if (SEEDS.length >= 50) for (const p of ['cholecystectomy', 'hysterectomy', 'prostatectomy']) expect(byProcedure[p] ?? 0, p).toBeGreaterThan(5)
  }, 600_000)

  it('visits every step of each scripted case once, in order, 0..N-1; an unscripted case shows no steps', () => {
    for (const d of days()) {
      for (const c of d.cases) {
        const where = `seed ${d.seed} ${c.id}`
        if (!c.scripted) {
          expect(c.flats, where).toEqual([])
          continue
        }
        expect(c.flats, where).toEqual(Array.from({ length: c.flatCount }, (_, i) => i))
      }
    }
  }, 600_000)

  it('has every role at its step\'s spot, doing the step\'s action and dressed for it, 20 s into each step', () => {
    let checks = 0
    for (const d of days()) checks += d.reachChecks
    // (5 roles, about 25 steps longer than 23 s per case)
    expect(checks).toBeGreaterThan(SEEDS.length * 5 * 15)
  }, 600_000)

  it('logs the script\'s exchanges (not the plan\'s), its event lines, and the WHO checklist where the script puts it, once each, in order', () => {
    for (const d of days()) {
      for (const c of d.cases) {
        const where = `seed ${d.seed} ${c.id}`
        const mine = d.events.filter((e) => e.text.startsWith(`${c.name}:`))
        if (!c.scripted) {
          expect(mine.filter((e) => e.type === 'procedureStep'), where).toEqual([])
          continue
        }
        const cs = compiledFor(`or-${c.procedure}`)!
        const lines = cs.script.steps.filter((s) => s.event !== undefined).map((s) => s.event!)
        expect(mine.filter((e) => e.type === 'procedureStep').map((e) => e.text), where).toEqual(lines.map((l) => `${c.name}: ${l}`))
        const who = mine.filter((e) => e.type === 'whoSignIn' || e.type === 'whoTimeOut' || e.type === 'whoSignOut')
        expect(who.map((e) => e.type), where).toEqual(['whoSignIn', 'whoTimeOut', 'whoSignOut'])
        expect(who.map((e) => e.text), where).toEqual(['signIn', 'timeOut', 'signOut'].map((k) => `${c.name}: ${SURGERY_COPY.checklist[k as 'signIn']}`))
        // each said as the step that carries it begins (and its event line, when it has one, at the same moment)
        for (const e of who) {
          const key = e.type === 'whoSignIn' ? 'signIn' : e.type === 'whoTimeOut' ? 'timeOut' : 'signOut'
          const i = cs.script.steps.findIndex((s) => s.checklist === key)
          expect(e.t, `${where} ${key}`).toBe(c.starts[c.flats.indexOf(i)])
          const step = cs.script.steps[i]
          if (step.event !== undefined) expect(mine.find((x) => x.text === `${c.name}: ${step.event}`)!.t, where).toBe(e.t)
        }
        // and every event line as its step begins
        cs.script.steps.forEach((step, i) => {
          if (step.event !== undefined) expect(mine.find((x) => x.text === `${c.name}: ${step.event}`)!.t, `${where} ${step.id}`).toBe(c.starts[c.flats.indexOf(i)])
        })
      }
      const exchanges = d.events.filter((e) => e.type === 'instrumentExchange').length
      expect(exchanges, `seed ${d.seed}`).toBe(d.cases.reduce((n, c) => n + c.exchangesPlanned, 0))
    }
  }, 600_000)
})

/** A planned case of `procedure` (the first one any of a few seeded days has). */
function planOf(procedure: SurgeryProcedure) {
  for (const seed of [4, 5, 6, 7, 8, 9, 10, 11]) {
    const p = planDay(new Rng(seed), 'quiet').find((x) => x.procedure === procedure)
    if (p !== undefined) return p
  }
  throw new Error(`no planned ${procedure} case in the sampled days`)
}

describe.each(['cholecystectomy', 'hysterectomy', 'prostatectomy'] as const)('the case script of the %s', (procedure) => {
  const cs = compiledFor(`or-${procedure}`)!
  const plan = planOf(procedure)

  it('places every role at every step within reach of its work point (0.35-0.95 m), on walkable floor, apart from the others, the table tipped or not', () => {
    const sites = new SurgerySites(new MiniHospital(1, { crowd: false, seats: seatsFor('layout') }).seats)
    const ctx = newTargetCtx(plan.layout)
    const placed: (Placement | null)[] = OR_ROLES.map(() => null)
    const cart = { x: SURGERY.cart.park.at.x, z: SURGERY.cart.park.at.z, heading: SURGERY.cart.park.heading }
    const bad: string[] = []
    cs.script.steps.forEach((step, i) => {
      placeRoles(cs, i, (a) => sites.anchor(a), plan.layout, placed)
      for (let r = 0; r < OR_ROLES.length; r++) {
        const p = placed[r]
        if (p === null) continue
        if (p.slide !== 0) {
          if (!isWalkable(p.at.x, p.at.z, 0.3)) bad.push(`${step.id} ${OR_ROLES[r]} slid off the floor`)
          for (let o = 0; o < OR_ROLES.length; o++) {
            const q = placed[o]
            if (o !== r && q !== null && Math.hypot(q.at.x - p.at.x, q.at.z - p.at.z) < 0.6 - 1e-9) bad.push(`${step.id} ${OR_ROLES[r]} slid next to ${OR_ROLES[o]}`)
          }
        }
        const line = roleLineOf(cs, i, OR_ROLES[r])!
        if (line.work === null || line.anchor === 'surgeonConsole' || line.anchor === 'anaesStool') continue
        // at the start of the step and at its end (the tilt eases over a step; the enums, the position among them, switch as it begins), and for the
        // cart parked, half-way and docked
        const before = i > 0 ? cs.poseAfter[i - 1] : cs.script.start
        const poses = [{ ...cs.poseAfter[i], headTiltDeg: before.headTiltDeg, rollDeg: before.rollDeg }, cs.poseAfter[i]]
        for (const pose of poses) {
          setTable(ctx, pose.headTiltDeg, pose.rollDeg, pose.position)
          for (const k of [0, 0.5, 1]) {
            cartPose(k, cart)
            const w = workPointInto(line.work, p.at, p.heading, ctx, cart, { x: 0, y: 0, z: 0 })
            const d = Math.hypot(w.x - p.at.x, w.z - p.at.z)
            if (d < 0.35 || d > 0.95) bad.push(`${step.id} ${OR_ROLES[r]} ${line.action} at ${p.where}: ${line.work} ${d.toFixed(2)} m`)
            if (w.y < 0.85 || w.y > 1.4) bad.push(`${step.id} ${OR_ROLES[r]}: ${line.work} at ${w.y.toFixed(2)} m high`)
          }
        }
      }
    })
    expect(bad).toEqual([])
  })

  it('is made for a scripted procedure only, on its own fork (the case\'s stream is not drawn from), and the same for the same stream', () => {
    const a = caseScriptFor(plan, new Rng(11))!
    const b = caseScriptFor(plan, new Rng(11))!
    const c = caseScriptFor(plan, new Rng(12))!
    expect(Array.from(a.steps.weight)).toEqual(Array.from(b.steps.weight))
    expect(Array.from(a.steps.weight)).not.toEqual(Array.from(c.steps.weight))
    const rng = new Rng(11)
    const first = new Rng(11).float()
    caseScriptFor(plan, rng)
    expect(rng.float()).toBe(first)
    expect(a.arms0).toEqual(cs.script.robotArms)
    expect(a.exchanges.length).toBe(cs.armChanges.length)
    for (const e of a.exchanges) expect(e.at).toBeLessThan(plan.phases.console)
  })

  it('dresses the theatre: everyone masked; the scrubbed three gowned and gloved once at the table, the surgeon not at the console; gowns off after the drapes', () => {
    const sc = caseScriptFor(plan, new Rng(1))!
    const table = attireTable(sc.steps)
    expect(table).toEqual(sc.attire)
    const R = OR_ROLES.length
    const gowned = (i: number, r: number) => (table[i * R + r] & ATTIRE.gown) !== 0 && (table[i * R + r] & ATTIRE.gloves) !== 0
    let drapesOff = cs.n
    cs.script.steps.forEach((s, i) => {
      if (drapesOff === cs.n && Object.values(s.roles).some((l) => l?.do === 'removeDrapes')) drapesOff = i + 1
    })
    cs.script.steps.forEach((s, i) => {
      for (let r = 0; r < R; r++) {
        expect(table[i * R + r] & ATTIRE.mask, `${s.id} ${OR_ROLES[r]}`).toBe(ATTIRE.mask)
        expect(table[i * R + r] & ATTIRE.lead, `${s.id} ${OR_ROLES[r]}`).toBe(0)
      }
      // the circulator and the anaesthetist never gown
      expect(gowned(i, 3) || gowned(i, 4), s.id).toBe(false)
      // nobody gowned after the drapes are off
      if (i >= drapesOff) for (let r = 0; r < R; r++) expect(gowned(i, r), `${s.id} ${OR_ROLES[r]}`).toBe(false)
      // the scrubbed three: gowned whenever they work the sterile field, never while scrubbing; the surgeon never at the console
      for (const r of [0, 1, 2]) {
        const line = s.roles[OR_ROLES[r]]
        if (line === undefined) continue
        if (line.do === 'scrubHands') expect(gowned(i, r), `${s.id} ${OR_ROLES[r]}`).toBe(false)
        if (line.at === 'surgeonConsole') expect(gowned(i, r), `${s.id} ${OR_ROLES[r]}`).toBe(false)
        if (i < drapesOff && ['skinPrep', 'drapePatient', 'insertTrocar', 'closeFascia', 'closeSkin', 'passInstrument', 'fitInstrument', 'dockArm'].includes(line.do)) {
          expect(gowned(i, r), `${s.id} ${OR_ROLES[r]} ${line.do}`).toBe(true)
        }
      }
    })
  })
})
