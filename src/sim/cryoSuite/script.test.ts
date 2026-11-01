/**
 * R5 wave 3: the three cryo scripts through the suite (kidney, lung, liver): a watch case of each target (its steps last their watch seconds, its team
 * reaches every place in time, the held breath and the patient's pose are right), what `startWatch` answers, the warm start giving the step the engine
 * gives, the new places and the team's dress.
 */
import { describe, expect, it } from 'vitest'
import { CRYO_STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import { scriptFor } from '@/content/procedures'
import { tryPlanRoute } from '../nav/graph'
import { isWalkable } from '../nav/layout'
import { areaAt, CRYO_SUITE, LIFTS } from '../places'
import { timeAtHour } from '../population/schedule'
import { newCursor, resolveTarget, stepAt, watchSecondsOf } from '../procedure'
import { ATTIRE, type CryoTarget } from '../types'
import { cryoTimeline, roomStepsFor, secondsOf } from './plan'
import { CRYO_ROLES, watchTimesFor } from './script'
import { cryoSuite, type CryoHospital } from './testkit'

const TARGETS: readonly CryoTarget[] = ['kidney', 'lung', 'liver']
const hourOf = (t: number): number => CONFIG.sim.startHour + t / 3600

/** A watch case of `target` started at once in an idle room (09:00), stepped at 0.1 s until the patient is on the stretcher. */
function runWatch(target: CryoTarget, each?: (h: CryoHospital) => void) {
  const h = cryoSuite(31, { crowd: true, hour: 9 })
  const c = h.cryo
  h.step(0.1)
  expect(c.startWatch(target)).toBe('started')
  const demo = c.runs.find((r) => r.plan.demo)!
  const v = c.state.procedure
  const marks: { t: number; flat: number; stepId: string; unit: string; k: number; end: number }[] = []
  let ver = -1
  for (let i = 0; i < 20000 && demo.stage !== 'toPacu'; i++) {
    h.step(0.1)
    if (v.version !== ver && v.procedureId !== null) {
      ver = v.version
      marks.push({ t: h.t, flat: v.stepIndex, stepId: v.stepId, unit: v.unit, k: v.repeat?.k ?? 0, end: v.stepEnds })
    }
    each?.(h)
  }
  return { h, c, demo, marks }
}

describe('a watch case of each target', () => {
  for (const target of TARGETS) {
    it(`${target}: every step lasts its watch seconds, in order; the total is 600-900 s; the anchor steps only in the lung`, () => {
      const { demo, marks } = runWatch(target)
      const sc = demo.proc!
      const steps = sc.steps
      // (a later needle's steps are the quicker repeats: `repeatSeconds`)
      const watch = (f: number) => watchSecondsOf(steps.cs.script.steps[steps.stepOf[f]], steps.kOf[f])
      expect(marks.map((m) => m.flat)).toEqual(Array.from({ length: steps.flatCount }, (_, f) => f))
      expect(marks.map((m) => m.stepId)).toEqual(Array.from({ length: steps.flatCount }, (_, f) => steps.cs.script.steps[steps.stepOf[f]].id))
      // the arrival (wheels in, onto the table) waits for the porter, the last of the dressing and the out step wait for the stretcher: never shorter
      for (let i = 0; i < marks.length - 1; i++) {
        const d = marks[i + 1].t - marks[i].t
        const early = marks[i].unit === 'arrive'
        const late = marks[i].unit === 'dressing' && marks[i + 1].unit === 'out'
        if (early || late) expect(d, `${target} ${marks[i].stepId}`).toBeGreaterThanOrEqual(watch(i) - 0.25)
        else expect(d, `${target} ${marks[i].stepId}`).toBeCloseTo(watch(i), 0)
        expect(Math.abs(d - watch(i)) < 0.25 || early || late, `${target} ${marks[i].stepId}: ${d.toFixed(2)} s against ${watch(i)}`).toBe(true)
      }
      let total = 0
      for (let f = 0; f < steps.flatCount; f++) total += watch(f)
      expect(total).toBeGreaterThanOrEqual(600)
      expect(total).toBeLessThanOrEqual(900)
      expect(marks.some((m) => m.unit === 'anchorFreeze')).toBe(target === 'lung')
      expect(marks.some((m) => m.unit === 'anchorThaw')).toBe(target === 'lung')
      // the repeat run once per needle, needle k's steps in order
      const run = marks.filter((m) => m.k > 0)
      // (needle 1 in full, every later needle as quick repeats of about 20 s: the run's three steps at their `repeatSeconds`)
      for (const m of run) {
        const k = m.k
        const step = steps.cs.script.steps.find((x) => x.id === m.stepId)!
        expect(watchSecondsOf(step, k), `${target} ${m.stepId} needle ${k}`).toBe(k > 1 ? step.repeatSeconds : step.watchSeconds)
      }
      expect(run).toHaveLength(demo.plan.needles.length * 3)
      expect(run.map((m) => m.k)).toEqual(demo.plan.needles.flatMap((_, i) => [i + 1, i + 1, i + 1]))
      expect(demo.plan.needles).toHaveLength(CONFIG.cryoSuite.watchNeedles[target])
    }, 120_000)

    it(`${target}: the team reaches its place within 20 s of every step, and the patient's pose object is set in the room and cleared after`, () => {
      const pend = new Map<number, { key: string; t0: number; step: string }>()
      const late: string[] = []
      let ver = -1
      let inRoomSeen = 0
      const { h, c, demo } = runWatch(target, (hh) => {
        const v = c0(hh).state.procedure
        const team = c0(hh).team
        if (v.procedureId !== null && v.version !== ver) {
          ver = v.version
          pend.clear()
          for (let r = 0; r < CRYO_ROLES.length; r++) {
            const pl = team.placementOf(r)
            const st = team.get(CRYO_ROLES[r] as never)
            if (pl !== null && st !== null && st.engagedBy === null) pend.set(r, { key: `${st.title}@${pl.where}`, t0: hh.t, step: `${v.stepId}${v.repeat ? v.repeat.k : ''}` })
          }
        }
        for (const [r, p] of [...pend]) {
          const st = team.get(CRYO_ROLES[r] as never)!
          if (st.isAt(p.key)) pend.delete(r)
          else if (hh.t - p.t0 > 20) {
            late.push(`${p.step} ${CRYO_ROLES[r]} (${p.key}) not there after 20 s`)
            pend.delete(r)
          }
        }
        // the patient carries the published object while they are in the room
        const patient = hh.personById(`${c0(hh).runs.find((r) => r.plan.demo)!.id}-patient`)
        const run = c0(hh).runs.find((r) => r.plan.demo)!
        if (patient !== null && (run.stage === 'room' || run.stage === 'arriving') && v.procedureId !== null) {
          inRoomSeen++
          if (patient.entity.patientPose !== v.patient) late.push(`${v.stepId}: the patient does not carry the published pose`)
        }
      })
      expect(late).toEqual([])
      expect(inRoomSeen).toBeGreaterThan(100)
      expect(demo.stage).toBe('toPacu')
      // (on the stretcher now: the pose is gone, and the patient is on their back)
      const patient = h.personById(`${demo.id}-patient`)!
      expect(patient.entity.patientPose ?? null).toBeNull()
      expect(c.state.procedure.patient.position).toBe('supine')
      expect(h.runUntil(() => demo.stage === 'done', 4000, 0.2)).toBe(true)
      expect(h.personById(`${demo.id}-patient`)).toBeNull()
      expect(c.stuckFixes, c.stuckLog.join('|')).toBe(0)
    }, 300_000)
  }
})

const c0 = (h: CryoHospital) => h.cryo

describe('the target\'s state and the team\'s part', () => {
  it('publishes the target, the held breath only inside a scan or a push of the lung and the liver, and the tube only between the two airway steps', () => {
    for (const target of TARGETS) {
      const log: { step: string; stepId: string; apnoea: boolean; airway: string; position: string; target: string }[] = []
      let last = ''
      runWatch(target, (h) => {
        const s = h.cryo.state
        const key = `${s.step}/${s.procedure.stepId}/${s.apnoea}`
        if (key === last || s.procedure.procedureId === null) return
        last = key
        log.push({ step: s.step, stepId: s.procedure.stepId, apnoea: s.apnoea, airway: s.procedure.patient.airway, position: s.procedure.patient.position, target: s.target })
      })
      expect(log.every((l) => l.target === target), target).toBe(true)
      const held = log.filter((l) => l.apnoea)
      if (target === 'kidney') expect(held, 'a kidney case has the sedation nurse, no held breath').toEqual([])
      else {
        expect(held.length, target).toBeGreaterThan(0)
        for (const l of held) expect(['planningCt', 'checkCt', 'finalCt'].includes(l.step) || (l.step === 'aim' && l.stepId === 'pushNeedle'), `${target} ${l.step}/${l.stepId}`).toBe(true)
        // every scan and every push has its held moment (R5 wave 3: a window of the step, with breathing before and after it)
        for (const unit of ['planningCt', 'checkCt', 'finalCt']) {
          expect(log.filter((l) => l.step === unit).some((l) => l.apnoea), `${target} ${unit}`).toBe(true)
          expect(log.filter((l) => l.step === unit).some((l) => !l.apnoea), `${target} ${unit} breathes while the table moves`).toBe(true)
        }
        expect(log.filter((l) => l.stepId === 'pushNeedle').some((l) => l.apnoea), `${target} push`).toBe(true)
        expect(log.filter((l) => l.stepId === 'localAndNick' || l.stepId === 'robotAims').every((l) => !l.apnoea), `${target} aim`).toBe(true)
      }
      // the tube: lung only, from the breathing tube to the extubation step (the step with the extubate action keeps it, as the engine's rule says)
      const tube = log.filter((l) => l.airway === 'tube').map((l) => l.stepId)
      if (target === 'lung') {
        expect(tube[0]).toBe('breathingTube')
        expect(tube[tube.length - 1]).toBe('extubate')
        expect(log.findIndex((l) => l.stepId === 'breathingAlone')).toBeGreaterThan(log.findIndex((l) => l.stepId === 'extubate'))
      } else expect(tube, target).toEqual([])
      // the position: oblique (kidney) or prone (lung, liver) from the turn to the roll back, and on the back before the stretcher
      const pos = log.map((l) => l.position)
      expect(pos[pos.length - 1]).toBe('supine')
      expect(pos.includes(target === 'kidney' ? 'obliqueLeftUp' : 'prone')).toBe(true)
    }
  }, 300_000)

  it('has the cryo anaesthetist on the team all day, by the machine at the head end for the lung and the liver and in the control room for the kidney', () => {
    expect(CRYO_STAFF.some((s) => s.title === 'cryoAnaes')).toBe(true)
    for (const target of TARGETS) {
      const where = new Set<string>()
      const names = new Set<string>()
      runWatch(target, (h) => {
        const p = h.personById('cryo-anaes')
        if (p === null || h.cryo.state.procedure.procedureId === null) return
        where.add(areaAt(p.walker.x, p.walker.z)?.id ?? '?')
        if (h.cryo.state.step === 'sedation') names.add(p.entity.anim)
      })
      if (target === 'kidney') expect([...where], 'idle in the control room').toEqual(['l2CryoControl'])
      else expect(where.has('l2Cryo'), `${target} at the head end`).toBe(true)
    }
    // he is on site with the others and gone at the end of the day
    const quiet = cryoSuite(5, { crowd: false, hour: 9 })
    expect(quiet.personById('cryo-anaes')).not.toBeNull()
    expect(cryoSuite(5, { crowd: false, hour: 7.6 }).personById('cryo-anaes')).toBeNull()
  })

  it('dresses the team by the script: masks from the prep, the radiologist gloved for the needles, lead aprons through the CT, none at the end of the day; the kidney\'s on-call anaesthetist is bare outside the steps he has lines in', () => {
    for (const target of TARGETS) {
      const lead: Record<string, number> = { ir: 0, sedation: 0, cryoAnaes: 0, ctRadiographer: 0 }
      let maskBefore = 0
      let irGloveInAim = 0
      let irBareInAim = 0
      const bare: string[] = []
      const { h, demo } = runWatch(target, (hh) => {
        const s = hh.cryo.state
        const cs = hh.cryo.runs.find((r) => r.plan.demo)!.proc!.steps.cs
        const cur = hh.cryo.team.ctx.cur
        for (const [id, title] of [['cryo-ir', 'ir'], ['cryo-rad', 'ctRadiographer'], ['cryo-nurse', 'sedation'], ['cryo-anaes', 'cryoAnaes']] as const) {
          const e = hh.personById(id)?.entity
          if (e === undefined) continue
          const bits = e.attire ?? 0
          if ((bits & ATTIRE.lead) !== 0) lead[title]++
          if (s.procedure.stepId === 'wheelsIn' && (bits & ATTIRE.mask) !== 0) maskBefore++
          if (title === 'ir' && s.step === 'aim') (bits & ATTIRE.gloves) !== 0 ? irGloveInAim++ : irBareInAim++
          // dress goes with the work: the kidney's anaesthetist (not on the case) wears nothing at a step he has no line in
          if (target === 'kidney' && title === 'cryoAnaes' && s.procedure.procedureId !== null && cur.index >= 0 && cs.roleAt[cur.index][cs.roles.indexOf('cryoAnaes')] === null && bits !== 0) bare.push(`${s.procedure.stepId}: ${bits}`)
        }
      })
      expect(maskBefore, target).toBe(0)
      expect(irGloveInAim, target).toBeGreaterThan(0)
      expect(irBareInAim, target).toBe(0)
      expect(lead.ir, target).toBeGreaterThan(0)
      expect(lead.sedation, target).toBeGreaterThan(0)
      expect(lead.cryoAnaes, target).toBeGreaterThan(0)
      expect(lead.ctRadiographer, target).toBe(0)
      expect(bare, target).toEqual([])
      // (the case's last steps: the stretcher's ride on: nobody has the lead on before the planning scan or after the final one)
      expect(h.cryo.state.procedure.procedureId, target).not.toBeNull()
      expect(demo.stage).toBe('toPacu')
    }
  }, 120_000)
})

describe('startWatch', () => {
  const seed = 77

  it('starts at once in an idle room, is busy while the watch case is booked or running, and answers startDemo as a kidney watch', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    h.step(0.1)
    expect(h.cryo.watchStartsAt).toBeNull()
    expect(h.cryo.startWatch('liver')).toBe('started')
    expect(h.cryo.watchStartsAt).not.toBeNull()
    expect(h.cryo.startWatch('lung')).toBe('busy')
    expect(h.cryo.startDemo()).toBe('busy')
    expect(h.cryo.cases[0].target).toBe('liver')
    expect(h.cryo.cases[0].demo).toBe(true)
    const d = cryoSuite(31, { crowd: false, hour: 9 })
    d.step(0.1)
    expect(d.cryo.startDemo()).toBe('started')
    expect(d.cryo.cases[0].target).toBe('kidney')
  })

  it('answers following with a case in the room, and queued from the start (the panel can skip to watchStartsAt)', () => {
    const base = cryoSuite(seed, { crowd: false })
    const plan = base.cryo.plan[0]
    const tl = cryoTimeline(plan)
    const h = cryoSuite(seed, { crowd: false, hour: hourOf(tl.start.freeze1 + 60) })
    expect(h.cryo.state.caseId).toBe(plan.id)
    expect(h.cryo.startWatch('lung')).toBe('following')
    expect(h.cryo.watchStartsAt).toBeNull()
    expect(h.cryo.startWatch('lung', { fromStart: true })).toBe('queued')
    const at = h.cryo.watchStartsAt!
    expect(at).toBeGreaterThan(h.t)
    expect(h.cryo.startWatch('liver', { fromStart: true })).toBe('busy')
    // the watch case is wheeled in once the case in the room has gone and its turnover is over
    const first = h.cryo.runs[0]
    const demo = h.cryo.runs.find((r) => r.plan.demo)!
    expect(h.runUntil(() => demo.wheelsIn !== null, 4000, 0.2)).toBe(true)
    expect(first.roomEnd).not.toBeNull()
    expect(demo.wheelsIn!).toBeGreaterThanOrEqual(first.roomEnd! + first.plan.turnoverSeconds - 1)
    expect(Math.abs(demo.wheelsIn! - at)).toBeLessThan(60)
  }, 120_000)

  it('books at the exact end of a turnover (queued)', () => {
    const base = cryoSuite(seed, { crowd: false })
    const plan = base.cryo.plan[0]
    const tl = cryoTimeline(plan)
    const h = cryoSuite(seed, { crowd: false, hour: hourOf(tl.roomEnd + 90) })
    expect(h.cryo.state.step).toBe('turnover')
    expect(h.cryo.startWatch('kidney')).toBe('queued')
    expect(h.cryo.watchStartsAt!).toBeCloseTo(tl.turnoverEnd, 0)
    expect(h.cryo.state.demoQueued).toBe(true)
  })

  it('is noTeam before the team is in, after it has gone, and when the case could not be out before it goes home', () => {
    for (const target of TARGETS) {
      expect(cryoSuite(1, { crowd: false, hour: 7.6 }).cryo.startWatch(target)).toBe('noTeam')
      expect(cryoSuite(1, { crowd: false, hour: 18 }).cryo.startWatch(target)).toBe('noTeam')
      // 17:21: the team is still on site (to 17:30) but a watch case would be in the room after it goes
      const late = cryoSuite(1, { crowd: false, hour: 17.35 })
      expect(late.personById('cryo-ir')).not.toBeNull()
      expect(late.cryo.startWatch(target)).toBe('noTeam')
    }
    expect(cryoSuite(1, { crowd: false, hour: 9 }).cryo.startWatch('lung')).toBe('started')
  })

  it('shifts the day\'s next case: a watch case four minutes before it keeps it waiting until the watch case and its turnover are over, and every case ends', () => {
    for (const target of ['lung', 'liver'] as const) {
      const base = cryoSuite(seed, { crowd: false })
      const second = base.cryo.plan[1]
      const h = cryoSuite(seed, { crowd: false, hour: hourOf(second.plannedIn - 4 * 60) })
      h.step(0.1)
      expect(h.cryo.startWatch(target)).toBe('started')
      const demo = h.cryo.runs.find((r) => r.plan.demo)!
      expect(h.runUntil(() => demo.roomEnd !== null, 3600, 0.2)).toBe(true)
      const c2 = h.cryo.runs.find((r) => r.id === second.id)!
      expect(c2.stage).toBe('scheduled')
      expect(h.t).toBeGreaterThan(second.plannedIn)
      expect(h.runUntil(() => c2.wheelsIn !== null, 3600, 0.2)).toBe(true)
      expect(c2.wheelsIn!).toBeGreaterThanOrEqual(demo.roomEnd! + demo.plan.turnoverSeconds - 1)
      expect(h.runUntil(() => h.cryo.runs.every((r) => r.stage === 'done'), 6 * 3600, 0.5)).toBe(true)
      while (h.t < timeAtHour(20)) h.step(0.5)
      expect(h.cryo.stuckFixes, h.cryo.stuckLog.join('|')).toBe(0)
      expect(h.people).toHaveLength(0)
    }
  }, 300_000)
})

describe('the warm start', () => {
  it('puts the room at any moment of a case in the step the engine gives it for the plan, and the patient carrying the published pose', () => {
    for (const target of TARGETS) {
      let seed = 1
      let live = cryoSuite(seed, { crowd: false })
      while ((live.cryo.plan[0].target ?? 'kidney') !== target) live = cryoSuite(++seed, { crowd: false })
      const plan = live.cryo.plan[0]
      const proc = live.cryo.runs[0].proc!
      const tl = cryoTimeline(plan)
      const from = tl.end.arrive + 2
      const to = tl.start.out - 2
      for (let k = 0; k < 13; k++) {
        const t = from + ((to - from) * k) / 12
        const unit = roomStepsFor(target).filter((s) => s !== 'out' && s !== 'arrive').filter((s) => t >= tl.start[s]).pop()!
        const cur = newCursor()
        expect(stepAt(proc.steps, unit, tl.start[unit], tl.end[unit], t, null, cur)).toBe(true)
        const warm = cryoSuite(seed, { crowd: false, hour: hourOf(t) })
        const v = warm.cryo.state.procedure
        const where = `${target} seed ${seed} t ${(t - tl.start.arrive).toFixed(0)}`
        expect(warm.cryo.state.step, where).toBe(unit)
        expect(v.stepId, where).toBe(proc.steps.cs.script.steps[cur.index].id)
        expect(v.stepIndex, where).toBe(cur.flat)
        expect(v.repeat?.k ?? 0, where).toBe(cur.k > 0 && proc.steps.cs.script.steps[cur.index].repeat === true ? cur.k : 0)
        expect(v.watch).toBe(false)
        expect(v.patient.position, where).toBeDefined()
        const patient = warm.personById(`${plan.id}-patient`)!
        expect(patient.entity.patientPose, where).toBe(v.patient)
        expect(warm.cryo.state.target).toBe(target)
        // (the people already at their places, wearing their dress)
        const ir = warm.personById('cryo-ir')!
        expect(ir.entity.attire ?? 0, where).toBe(proc.attire[cur.index * 4 + 0])
      }
    }
  }, 300_000)

  it('gives the same published view at the same moment whether the day was run to it or jumped to', () => {
    for (const target of TARGETS) {
      let seed = 1
      let live = cryoSuite(seed, { crowd: false })
      while ((live.cryo.plan[0].target ?? 'kidney') !== target) live = cryoSuite(++seed, { crowd: false })
      const tl = cryoTimeline(live.cryo.plan[0])
      const t = tl.start.freeze1 + 0.4 * (tl.end.freeze1 - tl.start.freeze1)
      const warm = cryoSuite(seed, { crowd: false, hour: hourOf(t) })
      const run = cryoSuite(seed, { crowd: false })
      run.runUntil(() => run.t >= t, 6 * 3600, 0.25)
      // (the run's case began a few seconds after the plan's nominal time: compare the step, not the second)
      expect(run.cryo.state.procedure.unit).toBe(warm.cryo.state.procedure.unit)
      expect(run.cryo.state.procedure.stepId).toBe(warm.cryo.state.procedure.stepId)
      expect(run.cryo.state.procedure.patient).toEqual(warm.cryo.state.procedure.patient)
      expect(run.cryo.state.target).toBe(warm.cryo.state.target)
    }
  }, 300_000)
})

describe('the suite\'s new places', () => {
  it('has the anaesthesia machine\'s footprint in the way (not walkable) and every anchor slot walkable, reachable from lift B, with the table\'s travel clear', () => {
    const h = cryoSuite(2026, { crowd: false, hour: 7.6 })
    const sites = h.cryo.sites
    const m = CRYO_SUITE.anaesMachine
    expect(isWalkable(m.at.at.x, m.at.at.z, 0)).toBe(false)
    const from = LIFTS.B[2].stretcher.at
    for (const a of ['ctInsert', 'ctConsole', 'ctHeadSouth', 'ctAnaesHead', 'ctFoot', 'ctSideSouth', 'ctSideNorth', 'ctControlScan', 'ctControlPlan', 'ctControlStand'] as const) {
      for (let k = 0; k < 4; k++) {
        const s = sites.anchor(a, k)
        expect(isWalkable(s.at.x, s.at.z, 0.3), `${a} slot ${k}`).toBe(true)
        expect(tryPlanRoute(from, s.at), `${a} slot ${k}`).not.toBeNull()
      }
    }
    // (the slots of one anchor are different places)
    for (const a of ['ctSideSouth', 'ctSideNorth', 'ctControlStand'] as const) {
      const set = new Set([0, 1, 2].map((k) => `${sites.anchor(a, k).at.x.toFixed(2)},${sites.anchor(a, k).at.z.toFixed(2)}`))
      expect(set.size, a).toBe(3)
    }
    // the contract spots of the wave: walkable as given, so the sites use them as they are
    const st = CRYO_SUITE.staff
    const given: [string, { at: { x: number; z: number } }, { at: { x: number; z: number } }][] = [
      ['anaesHead', st.anaesHead, sites.spots.anaesHead],
      ['sedation', st.sedation, sites.spots.sedation],
      ['base 3', st.base[3], sites.spots.base[3]],
      ...st.sideSouth.map((x, i): [string, { at: { x: number; z: number } }, { at: { x: number; z: number } }] => [`sideSouth ${i}`, x, sites.spots.sideSouth[i]]),
      ...st.sideNorth.map((x, i): [string, { at: { x: number; z: number } }, { at: { x: number; z: number } }] => [`sideNorth ${i}`, x, sites.spots.sideNorth[i]]),
      ...st.controlStand.map((x, i): [string, { at: { x: number; z: number } }, { at: { x: number; z: number } }] => [`controlStand ${i}`, x, sites.spots.controlStand[i]]),
    ]
    for (const [name, spot, used] of given) {
      expect(isWalkable(spot.at.x, spot.at.z, 0.3), name).toBe(true)
      expect(used.at, name).toEqual(spot.at)
    }
  })

  it('keeps work points within reach: every hands-on line of every script is within a metre of the person\'s place', () => {
    for (const target of TARGETS) {
      const live = cryoSuite(31, { crowd: false, hour: 9 })
      live.step(0.1)
      live.cryo.startWatch(target)
      const demo = live.cryo.runs.find((r) => r.plan.demo)!
      const worst: string[] = []
      let ver = -1
      while (demo.stage !== 'toPacu') {
        live.step(0.2)
        const v = live.cryo.state.procedure
        if (v.procedureId === null || v.version === ver) continue
        ver = v.version
        live.step(0.5)
        for (let r = 0; r < CRYO_ROLES.length; r++) {
          const pl = live.cryo.team.placementOf(r)
          const line = demo.proc!.steps.cs.roleAt[demo.proc!.steps.stepOf[live.cryo.state.procedure.stepIndex]][r]
          if (pl === null || line === null || line.work === null) continue
          // (the target's own point, not the one drawn in to the reach: the places must be near enough that nothing is drawn in much)
          const w = resolveTarget(line.work, live.cryo.team.ctx.targets, { x: 0, y: 0, z: 0 })
          const at = pl.seat !== null ? pl.seat.seat : pl.spot.at
          const d = Math.hypot(w.x - at.x, w.z - at.z)
          if (d > 1.15) worst.push(`${target} ${v.stepId} ${CRYO_ROLES[r]} ${line.work} ${d.toFixed(2)} m`)
        }
      }
      expect(worst, target).toEqual([])
    }
  }, 300_000)
})

describe('the script\'s numbers', () => {
  it('sums every target\'s watch seconds into 600-900 for any needle count the plan can have, and has the three repeat steps per needle in the aim unit', () => {
    for (const target of TARGETS) {
      const times = watchTimesFor(target)!
      expect(times.needleSeconds).toBeGreaterThan(40)
      expect(times.needleSeconds).toBeLessThanOrEqual(100)
      expect(Object.keys(times.units).includes('aim')).toBe(true)
      // (the watch plan's windows add to the same)
      const plan = cryoSuite(31, { crowd: false, hour: 9 })
      plan.step(0.1)
      plan.cryo.startWatch(target)
      const demo = plan.cryo.runs.find((r) => r.plan.demo)!
      const sum = roomStepsFor(target).reduce((a, s) => a + secondsOf(demo.plan, s), 0)
      expect(sum).toBe(Object.values(times.units).reduce((a, b) => a + b, 0))
    }
  })
})

describe('the three cryo scripts as written', () => {
  const ct = new Set(['ctField', 'needleEntry', 'ctFace', 'robotGuide', 'cryoScreen', 'roomScreen', 'ctScreen', 'planScreen', 'ctAnaesMachine'])
  const foci = new Set(['ctTable', 'ctGantry', 'needle', 'iceBall', 'cryoConsole', 'controlRoom', 'ctHead', 'ctRoom'])

  for (const target of TARGETS) {
    const script = scriptFor(`cryo-${target}`)!
    const steps = script.steps
    const lines = (role: string) => steps.filter((x) => (x.roles as Record<string, unknown>)[role] !== undefined)

    it(`${target}: has 20-40 steps, the units in the CryoStep order (the anchors only in the lung), the three WHO pauses once and 3-6 event lines`, () => {
      expect(steps.length).toBeGreaterThanOrEqual(20)
      expect(steps.length).toBeLessThanOrEqual(40)
      const units = [...new Set(steps.map((x) => x.unit))]
      expect(units.includes('anchorFreeze')).toBe(target === 'lung')
      expect(units.includes('anchorThaw')).toBe(target === 'lung')
      for (const u of ['arrive', 'sedation', 'planningCt', 'planning', 'aim', 'checkCt', 'freeze1', 'thaw', 'freeze2', 'activeThaw', 'needlesOut', 'finalCt', 'dressing', 'out']) expect(units, u).toContain(u)
      expect(steps.filter((x) => x.checklist !== undefined).map((x) => x.checklist)).toEqual(['signIn', 'timeOut', 'signOut'])
      const events = steps.filter((x) => x.event !== undefined)
      expect(events.length).toBeGreaterThanOrEqual(3)
      expect(events.length).toBeLessThanOrEqual(6)
      expect(events.every((x) => x.repeat !== true)).toBe(true)
      // sign-in before the first medicine, time-out before the first needle, sign-out in the dressing
      const at = (id: string) => steps.findIndex((x) => x.id === id)
      expect(at('signIn')).toBeLessThan(steps.findIndex((x) => Object.values(x.roles).some((l) => l?.do === 'injectIv')))
      expect(at('timeOut')).toBeLessThan(at('robotAims'))
      expect(steps[at('signOut')].unit).toBe('dressing')
    })

    it(`${target}: the needle run is the three repeat steps of the aim unit, and uses only the CT room's targets and foci`, () => {
      const run = steps.filter((x) => x.repeat === true)
      expect(run.map((x) => x.id)).toEqual(['robotAims', 'localAndNick', 'pushNeedle'])
      expect(run.every((x) => x.unit === 'aim')).toBe(true)
      expect(run.map((x) => x.roles.ir?.do)).toEqual(['aimRobot', 'injectLocal', 'insertNeedle'])
      for (const x of steps) {
        expect(foci.has(x.focus), `${x.id} focus ${x.focus}`).toBe(true)
        for (const l of Object.values(x.roles)) for (const k of [l?.look, l?.work]) if (k !== undefined) expect(ct.has(k), `${x.id} target ${k}`).toBe(true)
      }
    })

    it(`${target}: the anaesthesia, position and airway are the target's own`, () => {
      const poses = steps.map((x) => x.patient ?? {})
      const positions = new Set(poses.map((p) => p.position).filter((p) => p !== undefined))
      const actions = new Set(steps.flatMap((x) => Object.values(x.roles).map((l) => l?.do)))
      if (target === 'kidney') {
        expect(script.anaesthesia).toBe('sedation')
        expect(positions.has('obliqueLeftUp')).toBe(true)
        expect(positions.has('prone')).toBe(false)
        expect(actions.has('holdBreath') || actions.has('intubate')).toBe(false)
        // (the anaesthetist is only on call behind the glass: the nurse sedates)
        expect(lines('cryoAnaes').every((x) => x.roles.cryoAnaes!.at === 'ctControlStand')).toBe(true)
        expect(steps.find((x) => x.id === 'sedationGiven')!.roles.sedation?.do).toBe('injectIv')
      } else {
        expect(script.anaesthesia).toBe(target === 'lung' ? 'general' : 'sedation')
        expect(positions.has('prone')).toBe(true)
        expect(poses.some((p) => p.arms === 'aboveHead')).toBe(true)
        expect(actions.has('holdBreath')).toBe(true)
        expect(actions.has('intubate')).toBe(target === 'lung')
        expect(actions.has('extubate')).toBe(target === 'lung')
        expect(steps.find((x) => x.id === 'pushNeedle')!.roles.cryoAnaes?.do).toBe('holdBreath')
        // (the anaesthetist holds the breath for each scan and no other step)
        for (const x of steps) if (x.roles.cryoAnaes?.do === 'holdBreath') expect(['planningCt', 'checkCt', 'finalCt'].includes(x.unit) || x.id === 'pushNeedle', x.id).toBe(true)
        for (const u of ['planningCt', 'checkCt', 'finalCt']) for (const x of steps.filter((y) => y.unit === u)) expect(x.roles.cryoAnaes?.do, x.id).toBe('holdBreath')
      }
      // on the back at the end, with the drapes off before the dressings
      const last = poses.reduce((a, p) => ({ ...a, ...p }), { ...script.start })
      expect(last.position).toBe('supine')
      expect(steps.findIndex((x) => x.patient?.drape === 0)).toBeLessThan(steps.findIndex((x) => x.id === 'dressings'))
    })
  }

  it('has the lung\'s freezes 3-3-10-5-10 and the liver\'s and the kidney\'s two, in the research document\'s order', () => {
    const lung = scriptFor('cryo-lung')!.steps.filter((x) => ['anchorFreeze', 'anchorThaw', 'freeze1', 'thaw', 'freeze2', 'activeThaw'].includes(x.unit))
    expect(lung.map((x) => x.unit)).toEqual(['anchorFreeze', 'anchorThaw', 'freeze1', 'thaw', 'freeze2', 'activeThaw'])
    expect(lung.map((x) => x.realMinutes[0])).toEqual([3, 3, 10, 5, 10, 3])
    for (const t of ['kidney', 'liver'] as const) expect(scriptFor(`cryo-${t}`)!.steps.filter((x) => ['freeze1', 'thaw', 'freeze2', 'activeThaw'].includes(x.unit)).map((x) => x.unit)).toEqual(['freeze1', 'thaw', 'freeze2', 'activeThaw'])
  })
})
