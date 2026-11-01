/**
 * R5 wave 3: the ProSense cryoablation as two scripted procedures in the ultrasound room: the scripts (research steps, patient rules, picture
 * stages), the places (every spot walkable and in reach), the protocols, the watch API's five answers, and the no-allocation / no-hard-coded-copy
 * source checks. The full cases over 30 seeds are in prosense.watch.test.ts and prosense.day.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROTOCOLS, protocolById } from '@/content/imaging'
import { OPTIONAL_UNITS, PROCEDURE_META, ROLES_BY_MACHINE, UNITS } from '@/content/procedures'
import { IMAGING_STAFF, staffName } from '@/content/staff'
import { CONFIG } from '../config'
import { inDoorway } from '../er/spots'
import { tryPlanRoute, routeLength } from '../nav/graph'
import { isWalkable } from '../nav/layout'
import { IMAGING } from '../places'
import { anchorSpot, compiledFor, resolveTarget, newTargetCtx } from '../procedure'
import { usAnchorSpot, usFocusInto, usTargetInto, newUsTargetCtx } from '../procedure/usPlaces'
import { Rng } from '../rng'
import { Simulation } from '../Simulation'
import type { ProcAnchor, ProcedureId, ProcTarget } from '../types'
import { MODALITIES } from '../types'
import { cryoCaseFor, cryoCaseForWatch, cryoSequences, cryoWatchSequences, iceSize, SEQUENCE_UNITS, stepOf } from './exam'
import { DEMO_PROCEDURES } from './department'
import { isScripted, procedureIdOf } from './prosense'

const DT = CONFIG.sim.step
const IDS: ProcedureId[] = ['us-breastCancer', 'us-fibroadenoma']
const US_TARGETS: ProcTarget[] = ['breast', 'usFace', 'usScreen', 'prosenseScreen']
const ANCHORS: ProcAnchor[] = ['usDoctor', 'usConsole', 'usHead', 'usDoor']
const cs = (id: ProcedureId) => compiledFor(id)!

describe('the ProSense scripts', () => {
  it.each(IDS)('%s: 20-40 steps, a watch total of 600-900 s, the units of the ultrasound room in order, the two roles on every step', (id) => {
    const c = cs(id)
    expect(c.machine).toBe('prosense')
    expect(c.roles).toEqual(['breastRadiologist', 'sonographer'])
    expect(ROLES_BY_MACHINE.prosense).toEqual(['breastRadiologist', 'sonographer'])
    expect(c.n).toBeGreaterThanOrEqual(20)
    expect(c.n).toBeLessThanOrEqual(40)
    const total = c.script.steps.reduce((t, s) => t + s.watchSeconds, 0)
    expect(total).toBeGreaterThanOrEqual(600)
    expect(total).toBeLessThanOrEqual(900)
    // units in order; the optional ones (the probe moved) only where the procedure has them
    const order = UNITS.prosense
    let last = -1
    for (const s of c.script.steps) {
      const u = order.indexOf(s.unit)
      expect(u, `${s.id} in ${s.unit}`).toBeGreaterThanOrEqual(last)
      last = u
      expect(Object.keys(s.roles).sort(), s.id).toEqual(['breastRadiologist', 'sonographer'])
    }
    expect(OPTIONAL_UNITS.prosense).toEqual(['relocate', 'freeze3'])
    const used = new Set(c.script.steps.map((s) => s.unit))
    for (const u of order) if (!OPTIONAL_UNITS.prosense.includes(u)) expect(used.has(u), `unit ${u}`).toBe(true)
    expect(used.has('relocate')).toBe(id === 'us-fibroadenoma')
    expect(used.has('freeze3')).toBe(id === 'us-fibroadenoma')
    // every sequence of the exam has its unit
    expect(SEQUENCE_UNITS).toEqual(['place', 'freeze1', 'thaw', 'freeze2', 'relocate', 'freeze3'])
  })

  it('the cancer has 24 steps over 662 s, the fibroadenoma 26 over 736 s with the probe move (and 23 steps, 648 s, without it): the gown change and the thaws are in', () => {
    expect(cs('us-breastCancer').n).toBe(24)
    expect(cs('us-breastCancer').script.steps.reduce((t, s) => t + s.watchSeconds, 0)).toBe(662)
    const f = cs('us-fibroadenoma')
    expect(f.n).toBe(26)
    expect(f.script.steps.reduce((t, s) => t + s.watchSeconds, 0)).toBe(736)
    const plain = f.script.steps.filter((s) => s.unit !== 'relocate' && s.unit !== 'freeze3')
    expect(plain).toHaveLength(23)
    expect(plain.reduce((t, s) => t + s.watchSeconds, 0)).toBe(648)
  })

  it.each(IDS)('%s: hands, places and looks the room can show: only ultrasound targets, the transducer in her left hand, the right tool of the action', (id) => {
    const c = cs(id)
    const right: Record<string, readonly string[]> = {
      injectLocal: ['syringe'],
      injectSaline: ['salineSyringe'],
      skinNick: ['scalpel'],
      markSkin: ['marker'],
      insertProbe: ['cryoProbe'],
      scanProbe: ['none', 'cryoProbe', 'mouse'],
    }
    for (const s of c.script.steps) {
      for (const role of ['breastRadiologist', 'sonographer'] as const) {
        const line = s.roles[role]!
        expect(ANCHORS, `${s.id} ${role} at`).toContain(line.at)
        if (line.look !== undefined) expect(US_TARGETS, `${s.id} ${role} look`).toContain(line.look)
        if (line.work !== undefined) expect(US_TARGETS, `${s.id} ${role} work`).toContain(line.work)
        // the radiologist works at the treated side and the sonographer never takes her place
        if (role === 'breastRadiologist' && line.do in right) {
          expect(line.left, `${s.id}: the transducer`).toBe('usTransducer')
          expect(right[line.do], `${s.id}: the right hand`).toContain(line.right ?? 'none')
          expect(line.at, s.id).toBe('usDoctor')
        }
      }
    }
  })

  it.each(IDS)('%s: the patient lies supine and awake with the treated arm up, is marked, nicked and dressed in that order, and the drape comes off at the dressing', (id) => {
    const c = cs(id)
    const idx = (step: string) => c.script.steps.findIndex((s) => s.id === step)
    const pose = (step: string) => c.poseAfter[idx(step)]
    for (let i = 0; i < c.n; i++) {
      expect(c.poseAfter[i].position).toBe('supine')
      expect(c.poseAfter[i].awareness).toBe('awake')
      expect(c.poseAfter[i].airway).toBe('none')
      expect(c.poseAfter[i].catheter).toBe(false)
    }
    expect(c.script.start.arms).toBe('out')
    expect(c.script.anaesthesia).toBe('local')
    expect(pose('patientArrives').arms).toBe('out')
    expect(pose('lieDown').arms).toBe('oneUp')
    // rolled slightly toward the other side: the treated (left) side lifted (the OR's roll lifts the patient's right when positive)
    expect(pose('lieDown').rollDeg).toBeLessThan(0)
    expect(pose('lieDown').rollDeg).toBeGreaterThanOrEqual(-12)
    for (const step of ['surveyMarks', 'prepSkin', 'drape', 'timeOut', 'localAnaesthetic', 'probeIn', 'saline', 'freeze1', 'freeze2', 'probeOut', 'dressing']) expect(pose(step).arms, step).toBe('oneUp')
    expect(pose('signOut').arms).toBe('out')
    expect(pose('signOut').rollDeg).toBe(0)
    // marks: marked at the survey, a nick at the first cut, dressed after the probe is out
    expect([pose('lieDown').marks, pose('surveyMarks').marks, pose('localAnaesthetic').marks, pose('skinNick').marks, pose('probeOut').marks, pose('dressing').marks]).toEqual(['none', 'marked', 'marked', 'needles', 'needles', 'dressed'])
    // clean skin before the drape, the drape before the first needle, and off at the dressing
    expect(pose('prepSkin').prep).toBe(1)
    expect(pose('drape').drape).toBe(1)
    expect(pose('timeOut').drape).toBe(1)
    expect(pose('localAnaesthetic').drape).toBe(1)
    expect(pose('dressing').drape).toBe(0)
    expect(idx('surveyMarks')).toBeLessThan(idx('prepSkin'))
  })

  it.each(IDS)('%s: WHO-style Time Out before the first needle and Sign Out last; 3 to 6 event lines; the picture has a stage from the survey on', (id) => {
    const steps = cs(id).script.steps
    const idx = (step: string) => steps.findIndex((s) => s.id === step)
    expect(steps[idx('timeOut')].checklist).toBe('timeOut')
    expect(steps[idx('signOut')].checklist).toBe('signOut')
    expect(idx('timeOut')).toBeLessThan(idx('localAnaesthetic'))
    expect(idx('signOut')).toBeGreaterThan(idx('dressing'))
    expect(steps.filter((s) => s.checklist === 'signIn')).toEqual([])
    const events = steps.filter((s) => s.event !== undefined)
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(events.length).toBeLessThanOrEqual(6)
    expect(events.map((s) => s.event).join(' ')).toMatch(/local anaesthetic/)
    expect(events.map((s) => s.event).join(' ')).toMatch(/dressing/)
    const c = cs(id)
    for (let i = idx('surveyMarks'); i < c.n; i++) expect(c.scopeAt[i], steps[i].id).not.toBeNull()
    for (const i of [0, 1, 2, 3]) expect(c.scopeAt[i]).toBeNull()
    const scopes = new Set(steps.map((s) => s.scope).filter(Boolean))
    for (const k of ['survey', 'local', 'probeIn', 'saline', 'freeze1', 'thaw', 'freeze2', 'probeOut']) expect(scopes.has(k), k).toBe(true)
    if (id === 'us-breastCancer') for (const k of ['measure35', 'measure40']) expect(scopes.has(k), k).toBe(true)
    else for (const k of ['lumpCheck', 'relocate', 'freeze3']) expect(scopes.has(k), k).toBe(true)
  })

  it('the sources are the research ones: ICE3 and the FDA order for the cancer, the fibroadenoma series for the benign lump', () => {
    expect(cs('us-breastCancer').script.refs).toEqual(expect.arrayContaining(['procedures:31', 'procedures:32']))
    expect(cs('us-fibroadenoma').script.refs).toEqual(expect.arrayContaining(['procedures:35']))
    expect(PROCEDURE_META['us-breastCancer']).toEqual({ machine: 'prosense', key: 'us-cryo-breast' })
    expect(PROCEDURE_META['us-fibroadenoma']).toEqual({ machine: 'prosense', key: 'us-cryo-fibroadenoma' })
    expect(procedureIdOf('us-cryo-breast')).toBe('us-breastCancer')
    expect(procedureIdOf('us-cryo-fibroadenoma')).toBe('us-fibroadenoma')
    expect(procedureIdOf('us-abdo')).toBeUndefined()
    expect(isScripted('us-cryo-breast') && isScripted('us-cryo-fibroadenoma')).toBe(true)
    expect(isScripted('mri-brain')).toBe(false)
  })
})

describe('the places of the ProSense room', () => {
  const US = IMAGING.us
  const P = US.procedure!

  it('has the places only on the ultrasound room, the treated side being the left (west)', () => {
    for (const m of MODALITIES) expect(IMAGING[m].procedure !== undefined, m).toBe(m === 'us')
    expect(P.side).toBe('left')
    expect(newUsTargetCtx().side).toBe('left')
    const t = US.table
    const left = usTargetInto('breast', { side: 'left' }, { x: 0, y: 0, z: 0 })
    const right = usTargetInto('breast', { side: 'right' }, { x: 0, y: 0, z: 0 })
    // the head is south (+z) of the body centre, her left is west
    expect(left.x).toBeLessThan(t.in.x)
    expect(right.x).toBeGreaterThan(t.in.x)
    expect(left.z).toBeGreaterThan(t.in.z)
    expect(left.z).toBe(right.z)
    expect(left.y).toBeGreaterThan(t.height)
    expect(left.y).toBeLessThan(t.height + 0.4)
    // the radiologist's side is the treated side
    expect(P.doctor.at.x).toBeLessThan(t.in.x)
  })

  it('every spot is walkable, out of the doorways, and no two people stand closer than 0.6 m (the sonographer passes the syringes from 0.74 m)', () => {
    for (const a of ANCHORS) {
      const s = usAnchorSpot(a as 'usDoctor')
      expect(anchorSpot(a), a).toBe(s)
      expect(isWalkable(s.at.x, s.at.z, 0.3), `${a} walkable`).toBe(true)
      expect(inDoorway(s.at.x, s.at.z), `${a} in a doorway`).toBe(false)
      expect(Math.abs(s.heading), a).toBeLessThanOrEqual(Math.PI + 1e-9)
    }
    for (let i = 0; i < ANCHORS.length; i++) {
      for (let j = i + 1; j < ANCHORS.length; j++) {
        const a = usAnchorSpot(ANCHORS[i] as 'usDoctor').at
        const b = usAnchorSpot(ANCHORS[j] as 'usDoctor').at
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${ANCHORS[i]} / ${ANCHORS[j]}`).toBeGreaterThanOrEqual(0.6)
      }
    }
    // inside the room, between the walls
    const room = { x0: -34, x1: -28, z0: 2, z1: 12 }
    for (const a of ANCHORS) {
      const s = usAnchorSpot(a as 'usDoctor').at
      expect(s.x).toBeGreaterThan(room.x0)
      expect(s.x).toBeLessThan(room.x1)
      expect(s.z).toBeGreaterThan(room.z0)
      expect(s.z).toBeLessThan(room.z1)
    }
  })

  it('the radiologist\'s corner (where she waits out of sight between cases) is walkable, in the room, and clear of the couch, the cart and every spot of the case', () => {
    const park = P.park.at
    expect(isWalkable(park.x, park.z, 0.3)).toBe(true)
    expect(inDoorway(park.x, park.z)).toBe(false)
    expect(park.x).toBeGreaterThan(-34)
    expect(park.x).toBeLessThan(-28)
    expect(park.z).toBeGreaterThan(2)
    expect(park.z).toBeLessThan(12)
    for (const a of ANCHORS) {
      const s = usAnchorSpot(a as 'usDoctor').at
      expect(Math.hypot(s.x - park.x, s.z - park.z), `park / ${a}`).toBeGreaterThan(1.5)
    }
    expect(Math.hypot(park.x - US.table.in.x, park.z - US.table.in.z)).toBeGreaterThan(2)
    expect(Math.hypot(park.x - US.machine.x, park.z - US.machine.z)).toBeGreaterThan(1)
  })

  it('every spot is reachable on a planned route from the imaging hall and from every other spot, a short walk (the radiologist comes in through the hall)', () => {
    const hall = { x: -33.4, z: 0.9 }
    for (const a of ANCHORS) {
      const s = usAnchorSpot(a as 'usDoctor').at
      const route = tryPlanRoute(hall, s)
      expect(route, `hall -> ${a}`).not.toBeNull()
      expect(routeLength(route!), `hall -> ${a}`).toBeLessThan(16)
      for (const b of ANCHORS) {
        if (a === b) continue
        const other = tryPlanRoute(s, usAnchorSpot(b as 'usDoctor').at)
        expect(other, `${a} -> ${b}`).not.toBeNull()
        expect(routeLength(other!), `${a} -> ${b}`).toBeLessThan(12)
      }
    }
  })

  it('the radiologist and the sonographer reach the breast from where they stand, and each faces what she works at', () => {
    const breast = usTargetInto('breast', newUsTargetCtx(), { x: 0, y: 0, z: 0 })
    for (const [a, reach] of [['usDoctor', 0.8], ['usHead', 0.95]] as const) {
      const s = usAnchorSpot(a)
      expect(Math.hypot(s.at.x - breast.x, s.at.z - breast.z), a).toBeLessThanOrEqual(reach)
      // facing the breast to within 40 degrees
      const want = Math.atan2(breast.x - s.at.x, breast.z - s.at.z)
      let d = Math.abs(s.heading - want) % (2 * Math.PI)
      if (d > Math.PI) d = 2 * Math.PI - d
      expect(d, `${a} faces the breast`).toBeLessThan(0.7)
    }
    // the console spot faces the console's screen, within reach, and the screen is where the baked console stands (tools/arch/zones/imaging.py CRYO)
    const con = usAnchorSpot('usConsole')
    const screen = usTargetInto('prosenseScreen', newUsTargetCtx(), { x: 0, y: 0, z: 0 })
    expect(Math.hypot(con.at.x - screen.x, con.at.z - screen.z)).toBeLessThanOrEqual(0.6)
    expect(P.prosense.at).toEqual({ x: -33.45, z: 10.5 })
    expect(Math.abs(screen.x - -33.45)).toBeLessThan(0.3)
    expect(screen.y).toBeGreaterThan(0.9)
    const us = usTargetInto('usScreen', newUsTargetCtx(), { x: 0, y: 0, z: 0 })
    expect(Math.hypot(us.x - US.machine.x, us.z - US.machine.z)).toBeLessThan(0.01)
    // the foci
    expect(usFocusInto('breast', newUsTargetCtx(), { x: 0, y: 0, z: 0 })).toEqual(breast)
    expect(usFocusInto('usScreen', newUsTargetCtx(), { x: 0, y: 0, z: 0 })).toEqual(us)
    // the engine resolves them too
    const ctx = newTargetCtx()
    expect(resolveTarget('breast', ctx, { x: 0, y: 0, z: 0 })).toEqual(breast)
    expect(resolveTarget('usFace', ctx, { x: 0, y: 0, z: 0 }).z).toBeGreaterThan(US.table.in.z)
  })
})

describe('the protocols', () => {
  it('has the breast cancer (7-4-7 minutes in the day, the console programme 9-8-9) and the fibroadenoma, both procedures of the ultrasound only', () => {
    expect(protocolById('us-cryo-breast').sequences.map(stepOf)).toEqual(['place', 'freeze', 'thaw', 'freeze'])
    expect(protocolById('us-cryo-fibroadenoma').sequences.map(stepOf)).toEqual(['place', 'freeze', 'thaw', 'freeze'])
    expect(protocolById('us-cryo-fibroadenoma').name).toMatch(/fibroadenoma/)
    expect(CONFIG.imaging.cryo.programmes['us-cryo-breast'].minutes).toEqual([9, 8, 9])
    expect(CONFIG.imaging.cryo.programmes['us-cryo-breast'].maxFreezeMinutes).toBe(12)
    expect(CONFIG.imaging.cryo.targetsMm).toEqual([35, 40])
    expect(DEMO_PROCEDURES.us).toEqual(['us-cryo-breast', 'us-cryo-fibroadenoma'])
    expect(Object.keys(PROTOCOLS).filter((id) => id.startsWith('us-cryo-')).sort()).toEqual(['us-cryo-breast', 'us-cryo-fibroadenoma'])
  })

  it('the ages: 70-82 for the cancer (the FDA indication), a younger woman for a fibroadenoma', () => {
    expect(CONFIG.imaging.cryoAges['us-cryo-breast']).toEqual([70, 82])
    const [lo, hi] = CONFIG.imaging.cryoAges['us-cryo-fibroadenoma']
    expect(lo).toBeGreaterThanOrEqual(18)
    expect(hi).toBeLessThan(50)
  })

  it('the ice ball meets the targets: 35 mm or more after the first freeze and 40 mm or more after the second', () => {
    const c = CONFIG.imaging.cryo
    const w = (d: number) => 2 * c.iceRadiusMm * c.iceElongation * d
    const seqs = protocolById('us-cryo-breast').sequences
    expect(w(iceSize(seqs, 1, 1))).toBeGreaterThanOrEqual(c.targetsMm[0])
    expect(w(iceSize(seqs, 3, 1))).toBeGreaterThanOrEqual(c.targetsMm[1])
    expect(w(iceSize(seqs, 1, 1))).toBeLessThan(c.targetsMm[1])
  })

  it('a fibroadenoma\'s lump (seeded from a NEW fork) picks 6-6-6 or 8-8-8 and whether the probe is moved; the same seed gives the same case', () => {
    const seen = new Set<string>()
    let moved = 0
    for (let seed = 1; seed <= 200; seed++) {
      const a = cryoCaseFor('us-cryo-fibroadenoma', new Rng(seed))
      const b = cryoCaseFor('us-cryo-fibroadenoma', new Rng(seed))
      expect(a).toEqual(b)
      expect(a.lumpMm).toBeGreaterThanOrEqual(CONFIG.imaging.cryo.fibroadenoma.lumpMm[0])
      expect(a.lumpMm).toBeLessThanOrEqual(CONFIG.imaging.cryo.fibroadenoma.lumpMm[1])
      expect(a.minutes).toEqual(a.lumpMm <= 20 ? [6, 6, 6] : [8, 8, 8])
      expect(a.relocate).toBe(a.lumpMm > CONFIG.imaging.cryo.fibroadenoma.relocateOverMm)
      seen.add(a.minutes.join('-'))
      if (a.relocate) moved++
    }
    expect([...seen].sort()).toEqual(['6-6-6', '8-8-8'])
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThan(200)
    // the cancer draws nothing: a fixed case
    const rng = new Rng(9)
    const before = rng.float()
    const r2 = new Rng(9)
    expect(cryoCaseFor('us-cryo-breast', r2)).toEqual({ protocolId: 'us-cryo-breast', lumpMm: 12, minutes: [9, 8, 9], relocate: false })
    expect(r2.float()).toBe(before)
    // the sequences: the cancer's own; a fibroadenoma's from its programme, with a second placement and a third freeze when the probe is moved
    const fibro = protocolById('us-cryo-fibroadenoma')
    const small = cryoCaseFor('us-cryo-fibroadenoma', new Rng(1))
    const plain = { ...small, relocate: false }
    const moveCase = { ...small, relocate: true }
    expect(cryoSequences(fibro, plain).map(stepOf)).toEqual(['place', 'freeze', 'thaw', 'freeze'])
    expect(cryoSequences(fibro, moveCase).map(stepOf)).toEqual(['place', 'freeze', 'thaw', 'freeze', 'place', 'freeze'])
    expect(cryoSequences(protocolById('us-cryo-breast'), cryoCaseForWatch('us-cryo-breast')).map((s) => s.seconds)).toEqual(protocolById('us-cryo-breast').sequences.map((s) => s.seconds))
    // a watch case: the console's clinical seconds on the freezes and thaws
    const watch = cryoWatchSequences(protocolById('us-cryo-breast'), cryoCaseForWatch('us-cryo-breast'), () => 100)
    expect(watch.map((s) => s.seconds)).toEqual([100, 540, 480, 540])
    expect(cryoCaseForWatch('us-cryo-fibroadenoma').relocate).toBe(true)
    expect(cryoCaseForWatch('us-cryo-breast').relocate).toBe(false)
  })

  it('the radiologist is a synthetic doctor in the imaging post on office hours, resolved by name and not on the day rota', () => {
    expect(IMAGING_STAFF).toHaveLength(1)
    const m = IMAGING_STAFF[0]
    expect([m.role, m.post, m.shift]).toEqual(['doctor', 'imaging', 'office'])
    expect(staffName(m.id)).toBe(m.name)
    expect(m.name).toMatch(/^Dr\. \S+$/)
  })
})

describe('"Watch step by step" in the ultrasound room: started, queued, following, busy, noTeam', () => {
  const sim = () => new Simulation(7, { startHour: 10, inFlight: false })
  const run = (s: Simulation, seconds: number) => {
    for (let i = 0, n = Math.round(seconds / DT); i < n; i++) s.step(DT)
  }

  it('started in a free room (and busy for a second press), the watch case begins at once and watchStartsAt says so', { timeout: 120_000 }, () => {
    const s = sim()
    run(s, 1)
    expect(s.imaging.watchStartsAt).toBeNull()
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('started')
    expect(s.imaging.watchStartsAt).toBeCloseTo(s.t, 3)
    expect(s.imaging.startWatch('us-cryo-fibroadenoma')).toBe('busy')
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('busy')
    run(s, 12)
    const sc = s.imaging.machines.us
    expect(sc.session?.booking.watch).toBe(true)
    expect(sc.state.procedure.procedureId).toBe('us-breastCancer')
    expect(sc.state.procedure.watch).toBe(true)
    expect(s.imaging.watchStartsAt).toBeNull() // begun: null, like the theatre's
    // a watch case's patient appears in the hall as the console check ends, not at the press
    expect(s.people.filter((p) => p.entity.id.startsWith('demo'))).toHaveLength(0)
    run(s, 12)
    expect(s.people.filter((p) => p.entity.id.startsWith('demo'))).toHaveLength(1)
    // and the radiologist is on her way
    expect(s.imaging.radiologist).not.toBeNull()
    expect(s.imaging.radiologist!.entity.name).toBe(IMAGING_STAFF[0].name)
  })

  it('the button path keeps working: startDemoScan(us, protocol, { watch: true }) answers true for started and queued, false for busy and a wrong protocol', { timeout: 120_000 }, () => {
    const s = sim()
    expect(s.imaging.startDemoScan('us', 'us-cryo-fibroadenoma', { watch: true })).toBe(true)
    expect(s.imaging.startDemoScan('us', 'us-cryo-breast', { watch: true })).toBe(false) // busy
    expect(s.imaging.startDemoScan('us', 'mri-brain', { watch: true })).toBe(false)
    expect(s.imaging.startDemoScan('us', undefined, { watch: true })).toBe(false)
    expect(s.imaging.startDemoScan('mri', 'us-cryo-breast', { watch: true })).toBe(false)
    expect(s.imaging.startWatch('mri-brain')).toBe('noTeam')
    expect(s.imaging.startWatch('no-such-protocol')).toBe('noTeam')
    // the plain demo button, with no options, is the demo it always was
    const t = sim()
    expect(t.imaging.startDemoScan('us', 'us-cryo-fibroadenoma')).toBe(true)
    expect(t.imaging.bookings.filter((b) => b.kind === 'demo' && b.watch === true)).toHaveLength(0)
  })

  it('queued behind a scan in the room (and, with fromStart, behind a ProSense case), following a ProSense case otherwise; its patient waits for the room', { timeout: 300_000 }, () => {
    const s = sim()
    expect(s.imaging.startDemoScan('us')).toBe(true) // the usual ultrasound demo: an abdominal scan
    run(s, 20)
    expect(s.imaging.machines.us.session).not.toBeNull()
    expect(isScripted(s.imaging.machines.us.session!.booking.protocolId)).toBe(false)
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('queued')
    const at = s.imaging.watchStartsAt!
    expect(at).toBeGreaterThan(s.t)
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('busy')
    // the scan finishes, the watch case takes the room next (ahead of the day's outpatients) and begins no earlier than the scan's end
    for (let i = 0; i < Math.round(1500 / DT) && s.imaging.machines.us.state.procedure.procedureId === null; i++) s.step(DT)
    expect(s.imaging.machines.us.state.procedure.procedureId).toBe('us-breastCancer')
    expect(s.imaging.machines.us.session!.booking.watch).toBe(true)
    expect(s.imaging.watchStartsAt).toBeNull() // begun: null, like the theatre's
    expect(s.imaging.stuckFixes, s.imaging.stuckLog.join('; ')).toBe(0)

    // following: a ProSense case in the room is the one to watch (nothing is booked); fromStart waits for it instead
    const f = sim()
    expect(f.imaging.startDemoScan('us', 'us-cryo-fibroadenoma')).toBe(true)
    run(f, 20)
    expect(isScripted(f.imaging.machines.us.session!.booking.protocolId)).toBe(true)
    expect(f.imaging.startWatch('us-cryo-breast')).toBe('following')
    expect(f.imaging.watchStartsAt).toBeNull()
    expect(f.imaging.bookings.filter((b) => b.watch === true)).toHaveLength(0)
    expect(f.imaging.startWatch('us-cryo-breast', { fromStart: true })).toBe('queued')
    expect(f.imaging.watchStartsAt!).toBeGreaterThan(f.t)
  })

  it('the radiologist stays in the simulation between cases, out of sight in her corner, and is the same person for the next case', { timeout: 300_000 }, () => {
    // (after the morning's booked cryoablation, so no other case is waiting for the room)
    const s = new Simulation(7, { startHour: 11.25, inFlight: false })
    const t0 = s.t
    run(s, 1)
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('started')
    let first: string | null = null
    for (let i = 0; i < Math.round(1000 / DT); i++) {
      s.step(DT)
      if (first === null && s.imaging.radiologist !== null) first = s.imaging.radiologist.entity.id
      if (first !== null && s.imaging.machines.us.session === null && s.imaging.machines.us.state.procedure.procedureId === null && s.t > t0 + 100) break
    }
    expect(first).toBe(IMAGING_STAFF[0].id)
    run(s, 60)
    // out of sight in her corner (still in the simulation, hidden): not "in the room", the same one person
    expect(s.imaging.radiologist).toBeNull()
    const people = s.people.filter((p) => p.entity.id === IMAGING_STAFF[0].id)
    expect(people).toHaveLength(1)
    expect(people[0].hidden).toBe(true)
    const park = IMAGING.us.procedure!.park.at
    expect(Math.hypot(people[0].walker.x - park.x, people[0].walker.z - park.z)).toBeLessThan(0.3)
    // the next case brings her back (the same person, fading in at the hall door)
    expect(s.imaging.startWatch('us-cryo-fibroadenoma')).toBe('started')
    run(s, 4)
    expect(s.imaging.radiologist).toBe(people[0])
    expect(s.people.filter((p) => p.entity.id === IMAGING_STAFF[0].id)).toHaveLength(1)
    expect(people[0].hidden).toBe(false)
    expect(s.imaging.stuckFixes, s.imaging.stuckLog.join('; ')).toBe(0)
  })

  it('noTeam when nobody is on duty in the ultrasound room (the sonographer and the radiologist keep office hours); a watch case waiting when she goes home is dropped', { timeout: 120_000 }, () => {
    const late = new Simulation(7, { startHour: 19, inFlight: false })
    expect(late.imaging.hasOperator('us')).toBe(false)
    expect(late.imaging.startWatch('us-cryo-breast')).toBe('noTeam')
    expect(late.imaging.startWatch('us-cryo-fibroadenoma')).toBe('noTeam')
    expect(late.imaging.startDemoScan('us', 'us-cryo-breast', { watch: true })).toBe(false)
    expect(late.imaging.bookings.filter((b) => b.watch === true)).toHaveLength(0)
    expect(late.imaging.radiologist).toBeNull()
    const s = sim()
    expect(s.imaging.startDemoScan('us')).toBe(true)
    run(s, 15)
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('queued')
    s.imaging.machines.us.setOperator(null)
    run(s, 2)
    expect(s.imaging.watchStartsAt).toBeNull()
    expect(s.imaging.bookings.filter((b) => b.watch === true)).toHaveLength(0)
    expect(s.imaging.queues.us.waiting.filter((b) => b.watch === true)).toHaveLength(0)
  })
})

describe('the room stays as it was for every scan', () => {
  it('no scanner publishes a procedure view during an ordinary morning of scans and the other modalities\' demos', { timeout: 300_000 }, () => {
    const s = new Simulation(11, { startHour: 11.25, inFlight: false })
    for (const m of ['mri', 'ct', 'xray', 'us'] as const) expect(s.imaging.startDemoScan(m)).toBe(true)
    let ran = 0
    for (let i = 0, n = Math.round(900 / DT); i < n; i++) {
      s.step(DT)
      for (const m of MODALITIES) {
        expect(s.imaging.scanners[m].procedure.procedureId, m).toBeNull()
        expect(s.imaging.scanners[m].procedure.roles).toHaveLength(0)
      }
      if (s.imaging.machines.us.session !== null) ran++
    }
    expect(ran).toBeGreaterThan(0)
    expect(s.imaging.radiologist).toBeNull()
    expect(s.imaging.stuckFixes, s.imaging.stuckLog.join('; ')).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// source checks (like src/sim/procedure/noAllocations.test.ts)
// ---------------------------------------------------------------------------------------------

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The body of the method or function called `name` (the first `name(` followed by a body). */
function bodyOf(src: string, name: string): string {
  const m = new RegExp(`(?:function\\s+|\\s)${name}\\s*\\(`, 'm').exec(src)
  if (!m) throw new Error(`no ${name}`)
  let i = m.index + m[0].length
  let depth = 1
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') depth--
  }
  const open = src.indexOf('{', i)
  let braces = 0
  let end = open
  for (; end < src.length; end++) {
    if (src[end] === '{') braces++
    else if (src[end] === '}' && --braces === 0) break
  }
  return src.slice(open, end + 1)
}

const FLAGGED: [RegExp, string][] = [
  [/\bnew\s+[A-Za-z]/, 'new'],
  [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
  [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
  [/\.\.\./, 'spread'],
  [/=>/, 'closure'],
  [/\.(map|filter|reduce|slice|concat|splice|forEach|some|find)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

describe('the ProSense per-tick paths allocate nothing', () => {
  const read = (f: string) => code(readFileSync(join(process.cwd(), 'src/sim/imaging', f), 'utf8'))
  const PATHS: Record<string, string[]> = {
    'prosense.ts': ['update', 'pose', 'unpose', 'point', 'poseTheDoctorAndSonographer', 'poseOne', 'windowOver', 'iceMelt', 'arriveCursor', 'place', 'markChange'],
    'overlay.ts': ['show', 'clear', 'shown'],
    'procedureDoctor.ts': ['think', 'leavesIn'],
    'exam.ts': ['iceSize', 'runSeconds', 'scanningSeconds'],
  }
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = read(file)
      const offenders: string[] = []
      for (const name of names) {
        const body = bodyOf(src, name)
        expect(body.length, `${file} ${name}: the scan found its body`).toBeGreaterThan(5)
        body.split('\n').forEach((line, i) => {
          for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`${file} ${name}+${i}: ${what}: ${line.trim()}`)
        })
      }
      expect(offenders).toEqual([])
    })
  }
})

describe('the copy moved out of scanner.ts', () => {
  it('no log line of the scanner is written in the sim: every say() takes its text from scanLines', () => {
    const src = readFileSync(join(process.cwd(), 'src/sim/imaging/scanner.ts'), 'utf8')
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    // every `say(type, text, ...)` call's text is a call to this.text(...), never a literal
    for (const m of stripped.matchAll(/this\.say\('(\w+)',\s*([^\n]*)/g)) expect(m[2].startsWith('this.text(') || m[2].startsWith('s.cryo ? this.cryoLine('), `say ${m[1]}: ${m[2]}`).toBe(true)
    // and no English sentence is left in a string (the stuck-step diagnostics are dev strings, not copy)
    const literals = [...stripped.matchAll(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0].slice(1, -1))
    const strings = literals.filter((t) => /\s\S+\s\S+\s/.test(t) && !/stuck|radiographer|^\.\.?\//.test(t))
    expect(strings).toEqual([])
  })
})
