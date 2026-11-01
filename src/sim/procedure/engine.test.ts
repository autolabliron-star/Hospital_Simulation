/**
 * R5: the step-by-step engine's other parts: the patient's pose across steps, the instrument on each arm, who does what, the places and points,
 * and the published view.
 */
import { describe, expect, it } from 'vitest'
import { ENDOSCOPE_UI } from '@/content/endoscopeUi'
import { Rng } from '../rng'
import { SURGERY } from '../places'
import { EXCHANGE_SECONDS } from '../surgery/robot'
import type { PatientPoseView, ProcAnchor, ProcRole, ProcTarget, ProcedureView, Vec3 } from '../types'
import { ACTION_ANIM, animOf } from './actions'
import { armsAt, scriptedExchanges } from './arms'
import { emptyProcedureView } from './empty'
import { patientAt, patientStart, smooth01 } from './patient'
import { applyRoleViews, newRoleViews, roleLineOf } from './roles'
import { caseSteps, compileScript, compiledFor, midSeconds, type CaseSteps } from './script'
import { anchorSpot, focusPointInto, newTargetCtx, resolveTarget, setTable, tiltPointInto } from './targets'
import { davinciSlots, newCursor, stepAt, watchUnitSeconds, type StepCursor } from './timing'
import { clearView, fillView, type ViewCtx } from './view'
import { davinciWindows, synthCryo } from './testkit'

const cs = compiledFor('or-cholecystectomy')!
const script = cs.script
const NUMBERS = ['headTiltDeg', 'rollDeg', 'prep', 'drape'] as const

const cursorAt = (steps: CaseSteps, flat: number, progress: number): StepCursor => ({ index: steps.stepOf[flat], flat, k: steps.kOf[flat], unit: cs.unitOf[steps.stepOf[flat]], since: 0, until: 1, progress })
const blank = (): PatientPoseView => emptyProcedureView().patient

describe('patientAt', () => {
  const steps = caseSteps(cs, 'watch', null)

  it('is continuous across steps: the end of a step is the start of the next, in every number', () => {
    const a = blank()
    const b = blank()
    for (let f = 0; f + 1 < steps.flatCount; f++) {
      patientAt(steps, cursorAt(steps, f, 1), a)
      patientAt(steps, cursorAt(steps, f + 1, 0), b)
      for (const k of NUMBERS) expect(b[k], `${script.steps[f].id} ${k}`).toBe(a[k])
    }
    patientAt(steps, cursorAt(steps, 0, 0), a)
    for (const k of NUMBERS) expect(a[k]).toBe(script.start[k])
  })

  it('switches the enums when a step begins and eases the numbers over it', () => {
    const at = (id: string, p: number) => patientAt(steps, cursorAt(steps, script.steps.findIndex((s) => s.id === id), p), blank())
    expect(at('tubeIn', 0).airway).toBe('tube')
    expect(at('anaesthetic', 0).awareness).toBe('asleep')
    expect(at('anaesthetic', 0).airway).toBe('oxygenMask')
    expect(at('moveAcross', 1).awareness).toBe('awake')
    expect(at('padAndWarm', 0).arms).toBe('tucked')
    expect(at('timeOut', 0).marks).toBe('marked')
    expect(at('firstPort', 0).marks).toBe('ports')
    expect(at('prepAndDrape', 0).prep).toBe(0)
    expect(at('prepAndDrape', 0.5).prep).toBeCloseTo(0.5, 9)
    expect(at('prepAndDrape', 1).prep).toBe(1)
    expect(at('prepAndDrape', 1).drape).toBe(1)
    expect(at('tiltTable', 0.5).headTiltDeg).toBeCloseTo(7.5, 9)
    expect(at('tiltTable', 1).headTiltDeg).toBe(15)
    expect(at('tiltTable', 1).rollDeg).toBe(12)
    // the table stays tipped through the docked console, and is flat again when the cart has gone
    expect(at('placeClips', 0.5).headTiltDeg).toBe(15)
    expect(at('releaseArms', 1).headTiltDeg).toBe(15)
    expect(at('cartAway', 0.5).headTiltDeg).toBeCloseTo(7.5, 9)
    expect(at('cartAway', 1).headTiltDeg).toBe(0)
    expect(at('closePorts', 0).rollDeg).toBe(0)
    expect(at('signOut', 0).marks).toBe('closed')
    expect(at('wakeUp', 0).marks).toBe('dressed')
    expect(at('wakeUp', 0).airway).toBe('tube')
    expect(at('wakeUp', 1).drape).toBe(0)
    expect(at('wheelsOut', 0).airway).toBe('oxygenMask')
    // monotone through a ramp
    let prev = -1
    for (let p = 0; p <= 1; p += 0.05) {
      const v = at('prepAndDrape', p).drape
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(smooth01(0.5)).toBe(0.5)
  })

  it('writes into the object it is given and returns it', () => {
    const out = blank()
    expect(patientAt(steps, cursorAt(steps, 3, 0.4), out)).toBe(out)
    const start = patientStart(steps, blank())
    expect(start).toEqual(script.start)
  })

  it('holds the whole case through to the end with the patient dressed, awake enough for recovery and breathing through a mask', () => {
    const out = blank()
    patientAt(steps, cursorAt(steps, steps.flatCount - 1, 1), out)
    expect(out.drape).toBe(0)
    expect(out.marks).toBe('dressed')
    expect(out.airway).toBe('oxygenMask')
    expect(out.headTiltDeg).toBe(0)
  })
})

describe('armsAt and scriptedExchanges', () => {
  it('holds the script\'s arms before the console, changes arm 3 (index 2) at each console step that says so, and never touches the endoscope', () => {
    for (const mode of ['live', 'watch'] as const) {
      const steps = caseSteps(cs, mode, mode === 'live' ? new Rng(3).fork('script') : null)
      const w = davinciWindows(3).find((x) => x.unit === 'console')!
      const out = ['', '', '', '']
      armsAt(steps, w.since, w.until, w.since - 100, out)
      expect(out).toEqual([...script.robotArms!])
      const seen: string[] = []
      for (let t = w.since; t <= w.until + 5; t += 1) {
        armsAt(steps, w.since, w.until, t, out)
        expect(out[1]).toBe('Endoscope 30°')
        expect(out[0]).toBe(script.robotArms![0])
        expect(out[3]).toBe(script.robotArms![3])
        if (seen[seen.length - 1] !== out[2]) seen.push(out[2])
      }
      expect(seen).toEqual(['Hook electrode', 'Monopolar curved scissors', 'Hook electrode'])
      armsAt(steps, w.since, w.until, w.until + 1000, out)
      expect(out[2]).toBe('Hook electrode')
      for (const name of out) expect(ENDOSCOPE_UI.instruments[name]).toBeDefined()
    }
  })

  it('lists the changes in time order, each landing at its step\'s start, never overlapping on one arm', () => {
    for (const seed of [1, 2, 3, 4]) {
      const steps = caseSteps(cs, 'live', new Rng(seed).fork('script'))
      const w = davinciWindows(seed).find((x) => x.unit === 'console')!
      const span = w.until - w.since
      const list = scriptedExchanges(steps, span)
      expect(list.map((e) => e.instrument)).toEqual(['Monopolar curved scissors', 'Hook electrode'])
      expect(list.map((e) => e.arm)).toEqual([2, 2])
      const cur = newCursor()
      list.forEach((e, i) => {
        expect(e.at).toBeGreaterThanOrEqual(0)
        if (i > 0) expect(e.at - list[i - 1].at).toBeGreaterThanOrEqual(EXCHANGE_SECONDS)
        // the new instrument is in half an exchange after `at`: exactly at the start of its step
        const landed = w.since + e.at + EXCHANGE_SECONDS / 2
        stepAt(steps, 'console', w.since, w.until, landed + 0.001, null, cur)
        expect(script.steps[cur.index].arms?.['2']).toBe(e.instrument)
        const out = ['', '', '', '']
        armsAt(steps, w.since, w.until, landed - 0.01, out)
        expect(out[2]).not.toBe(e.instrument)
        armsAt(steps, w.since, w.until, landed + 0.01, out)
        expect(out[2]).toBe(e.instrument)
      })
    }
  })

  it('keeps the exchanges a withdrawal apart in a watch case too, and the arms still end on the hook', () => {
    const steps = caseSteps(cs, 'watch', null)
    const span = watchUnitSeconds(cs, 'console')
    const list = scriptedExchanges(steps, span)
    expect(list).toHaveLength(2)
    expect(list[1].at - list[0].at).toBeGreaterThanOrEqual(EXCHANGE_SECONDS)
    const out = ['', '', '', '']
    armsAt(steps, 0, span, span + 100, out)
    expect(out[2]).toBe('Hook electrode')
    armsAt(steps, 0, span, list[0].at + EXCHANGE_SECONDS / 2 + 0.01, out)
    expect(out[2]).toBe('Monopolar curved scissors')
  })

  it('has a script without a console unit keep its base arms', () => {
    const syn = compileScript(synthCryo())
    const steps = caseSteps(syn, 'watch', null)
    const out = ['x', 'x', 'x', 'x']
    armsAt(steps, 0, 100, 50, out)
    expect(out).toEqual(['', '', '', ''])
    expect(scriptedExchanges(steps, 100)).toEqual([])
  })
})

describe('roles', () => {
  it('gives a role either a line at every step of a unit or none in the whole unit (the routine takes over), each at a valid anchor', () => {
    const lineless: string[] = []
    for (const unit of cs.units) {
      const u = cs.unitIndex.get(unit)!
      for (let r = 0; r < cs.roles.length; r++) {
        const lines = Array.from({ length: cs.unitLen[u] }, (_, j) => cs.roleAt[cs.unitFirst[u] + j][r])
        const some = lines.filter((l) => l !== null).length
        expect(some === 0 || some === lines.length, `${unit} ${cs.roles[r]}`).toBe(true)
        if (some === 0) lineless.push(`${unit}:${cs.roles[r]}`)
        for (const line of lines) if (line !== null) expect(anchorSpot(line.anchor).at.x).toBeTypeOf('number')
      }
    }
    // the research document puts nobody but the anaesthetic team and the circulator in the room during induction: the others follow their routine
    expect(lineless).toEqual(['induction:surgeon', 'induction:assistant'])
  })

  it('holds a role in place for a step without a line of its own, and leaves it to the routine when it has none in the unit', () => {
    const syn = compileScript(synthCryo())
    const stepIdx = (id: string) => syn.script.steps.findIndex((s) => s.id === id)
    // 'sedation' has a line at 'needleIn' only in the aim unit: held at its anchor, idle, for the other aim steps
    const held = roleLineOf(syn, stepIdx('aimGuide'), 'sedation')!
    expect(held.held).toBe(true)
    expect(held.action).toBe('idle')
    expect(held.anchor).toBe('scrub')
    expect(roleLineOf(syn, stepIdx('needleIn'), 'sedation')!.held).toBe(false)
    // no line at all in a unit: null, the routine takes over
    expect(roleLineOf(syn, stepIdx('freeze'), 'sedation')).toBeNull()
    expect(roleLineOf(syn, stepIdx('out'), 'sedation')).toBeNull()
    // a role that is not in the machine
    expect(roleLineOf(syn, 0, 'surgeon')).toBeNull()
    // the views mirror it
    const views = newRoleViews('cryoCt')
    expect(views.map((v) => v.role)).toEqual(['ir', 'ctRadiographer', 'sedation', 'cryoAnaes'])
    applyRoleViews(views, syn, stepIdx('freeze'))
    expect(views.find((v) => v.role === 'sedation')!.anchor).toBeNull()
    expect(views.find((v) => v.role === 'ir')!.anchor).toBe('tableSurgeon')
  })

  it('has a fallback anim for every action', () => {
    for (const [action, anim] of Object.entries(ACTION_ANIM)) expect(anim, action).toBeTypeOf('string')
    expect(animOf('scrubHands')).toBe('clean')
    expect(animOf('operateConsole')).toBe('console')
  })
})

describe('targets', () => {
  const v = (): Vec3 => ({ x: 0, y: 0, z: 0 })
  const ANCHORS: ProcAnchor[] = ['tableSurgeon', 'assistant', 'assistantWait', 'scrub', 'scrubWait', 'circulator', 'anaesHead', 'anaesStool', 'drive', 'driveEnd', 'drape', 'sink0', 'sink1', 'surgeonConsole', 'tableWest', 'tableWestHead', 'tableFoot', 'scrubBackTable', 'anaesLeft', 'circulatorCount']
  const TARGETS: ProcTarget[] = ['patientFace', 'patientChest', 'abdomen', 'pelvis', 'perineum', 'port0', 'port1', 'port2', 'port3', 'assistantPort', 'visionMonitor', 'anaesMonitor', 'mayo', 'backTable', 'robotCart', 'consoleViewer', 'sink', 'patient']

  it('resolves every anchor to a spot of the room and every target to a point', () => {
    const ctx = newTargetCtx('oblique')
    for (const a of ANCHORS) {
      const s = anchorSpot(a)
      expect(Number.isFinite(s.at.x) && Number.isFinite(s.at.z) && Number.isFinite(s.heading), a).toBe(true)
    }
    for (const t of TARGETS) {
      const p = resolveTarget(t, ctx, v())
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), t).toBe(true)
      expect(p.y, t).toBeGreaterThan(0.5)
      expect(p.y, t).toBeLessThan(2)
    }
    expect(anchorSpot('surgeonConsole')).toBe(SURGERY.consoles.surgeon.seat)
    expect(anchorSpot('sink1')).toBe(SURGERY.scrubSink.spots[1])
  })

  it('puts the patient on the table head north and the ports where the layout draws them', () => {
    const ctx = newTargetCtx('oblique')
    const t = SURGERY.table
    const face = resolveTarget('patientFace', ctx, v())
    const abd = resolveTarget('abdomen', ctx, v())
    const per = resolveTarget('perineum', ctx, v())
    expect(face.z).toBeLessThan(abd.z)
    expect(abd.z).toBeLessThan(per.z)
    expect(Math.abs(abd.x - t.at.x)).toBeLessThan(0.05)
    expect(abd.y).toBeGreaterThan(t.height)
    expect(abd.y).toBeCloseTo(SURGERY.ports.oblique[0].y, 9)
    for (const layout of ['oblique', 'transverse'] as const) {
      const c = newTargetCtx(layout)
      for (const i of [0, 1, 2, 3] as const) {
        const p = resolveTarget(`port${i}` as ProcTarget, c, v())
        const src = SURGERY.ports[layout][i]
        expect(p.x).toBeCloseTo(src.x, 9)
        expect(p.y).toBeCloseTo(src.y, 9)
        expect(p.z).toBeCloseTo(src.z, 9)
      }
    }
    // the assistant port is on the patient's left (east), where the assistant stands
    expect(resolveTarget('assistantPort', ctx, v()).x).toBeGreaterThan(t.at.x)
  })

  it('moves the patient\'s points with the table: head up raises the head, right side up raises the west', () => {
    const flat = newTargetCtx('oblique')
    const tipped = newTargetCtx('oblique')
    setTable(tipped, 15, 12)
    const dFace = resolveTarget('patientFace', tipped, v()).y - resolveTarget('patientFace', flat, v()).y
    const dFeet = resolveTarget('perineum', tipped, v()).y - resolveTarget('perineum', flat, v()).y
    expect(dFace).toBeGreaterThan(0.15)
    expect(dFeet).toBeLessThan(dFace)
    const rolled = newTargetCtx('oblique')
    setTable(rolled, 0, 20)
    const west = rolled
    const base = tiltPointInto(newTargetCtx(), SURGERY.table.at.x - 0.25, 1, SURGERY.table.at.z, v())
    const lifted = tiltPointInto(west, SURGERY.table.at.x - 0.25, 1, SURGERY.table.at.z, v())
    expect(lifted.y).toBeGreaterThan(base.y)
    const east = tiltPointInto(west, SURGERY.table.at.x + 0.25, 1, SURGERY.table.at.z, v())
    expect(east.y).toBeLessThan(base.y)
  })

  it('keeps every point the same distance from the pivot when it tips (a rigid turn), and is the identity when level', () => {
    const ctx = newTargetCtx('oblique')
    const pivot = { x: SURGERY.table.at.x, y: SURGERY.tablePivot.y, z: SURGERY.table.at.z + SURGERY.tablePivot.dz }
    const rng = new Rng(5)
    for (let i = 0; i < 50; i++) {
      setTable(ctx, rng.range(-30, 30), rng.range(-20, 20))
      const p = { x: pivot.x + rng.range(-0.6, 0.6), y: rng.range(0.7, 1.3), z: pivot.z + rng.range(-1.2, 1.2) }
      const q = tiltPointInto(ctx, p.x, p.y, p.z, v())
      const d = (a: Vec3) => Math.hypot(a.x - pivot.x, a.y - pivot.y, a.z - pivot.z)
      expect(d(q)).toBeCloseTo(d(p), 9)
    }
    setTable(ctx, 0, 0)
    const p = tiltPointInto(ctx, -49, 1.1, 6, v())
    expect(p).toEqual({ x: -49, y: 1.1, z: 6 })
    // (and a level table with the ports: exactly where the layout draws them)
    const port = resolveTarget('port2', ctx, v())
    expect(port).toEqual(SURGERY.ports.oblique[2])
  })

  it('follows the cart by reference', () => {
    const ctx = newTargetCtx()
    const cart = { x: 1, z: 2, heading: 0 }
    ctx.cart = cart
    expect(resolveTarget('robotCart', ctx, v())).toMatchObject({ x: 1, z: 2 })
    cart.x = 5
    expect(resolveTarget('robotCart', ctx, v()).x).toBe(5)
  })

  it('reaches every worked-at point of the gallbladder script from its anchor (the cart\'s steering handle aside)', () => {
    const ctx = newTargetCtx('oblique')
    setTable(ctx, 15, 12)
    const worst: string[] = []
    script.steps.forEach((s, i) => {
      cs.roles.forEach((role, r) => {
        const line = cs.roleAt[i][r]
        if (line === null || line.work === null || line.work === 'robotCart') return
        const a = anchorSpot(line.anchor).at
        const w = resolveTarget(line.work, ctx, v())
        const d = Math.hypot(a.x - w.x, a.z - w.z)
        if (d > 1.1) worst.push(`${s.id} ${role} ${line.anchor} -> ${line.work}: ${d.toFixed(2)} m`)
      })
    })
    expect(worst).toEqual([])
  })

  it('has a focus point for every focus of the machines', () => {
    const ctx = newTargetCtx()
    for (const f of ['room', 'head', 'abdomen', 'pelvis', 'legs', 'ports', 'robotCart', 'console', 'endoscope', 'mayo', 'backTable', 'sink', 'stretcher', 'ctTable', 'ctGantry', 'needle', 'iceBall', 'cryoConsole', 'controlRoom', 'usScreen', 'breast'] as const) {
      const p = focusPointInto(f, ctx, v())
      expect(Number.isFinite(p.x + p.y + p.z), f).toBe(true)
    }
  })
})

describe('fillView', () => {
  const steps = caseSteps(cs, 'watch', null)
  const ctxOf = (): ViewCtx => ({ caseId: 'case-1', watch: true, entityIds: {}, targets: newTargetCtx('oblique') })

  it('fills the empty view in place, bumps the version only on a step change and says so', () => {
    const view: ProcedureView = emptyProcedureView()
    const patient = view.patient
    const vc = ctxOf()
    const cur = newCursor()
    const w = davinciWindows(1)
    let changes = 0
    let lastIndex = -2
    let v = view.version
    for (const win of w) {
      const slots = win.unit === 'docking' || win.unit === 'undocking' ? davinciSlots : null
      for (let j = 0; j < 300; j++) {
        stepAt(steps, win.unit, win.since, win.until, win.since + ((win.until - win.since) * (j + 0.5)) / 300, slots, cur)
        const changed = fillView(view, steps, cur, vc)
        if (changed) {
          changes++
          expect(view.version).toBe(v + 1)
          v = view.version
        } else expect(view.version).toBe(v)
        expect(changed).toBe(cur.flat !== lastIndex)
        lastIndex = cur.flat
        expect(view.stepIndex).toBe(cur.flat)
        expect(view.stepId).toBe(script.steps[cur.index].id)
        expect(view.progress).toBe(cur.progress)
        expect(view.stepSince).toBe(cur.since)
        expect(view.stepEnds).toBe(cur.until)
        expect(view.patient).toBe(patient)
      }
    }
    expect(changes).toBe(script.steps.length)
    expect(view.stepCount).toBe(script.steps.length)
    expect(view.procedureId).toBe('or-cholecystectomy')
    expect(view.caseId).toBe('case-1')
    expect(view.watch).toBe(true)
    expect(view.roles.map((r) => r.role)).toEqual(['surgeon', 'assistant', 'scrub', 'circulator', 'anaesthetist'])
    expect(view.repeat).toBeNull()
  })

  it('carries the step\'s focus, scope, roles and the patient\'s eased pose', () => {
    const view = emptyProcedureView()
    const vc = ctxOf()
    vc.entityIds = { surgeon: 'or-surgeon', anaesthetist: 'or-anaesthetist' }
    const f = script.steps.findIndex((s) => s.id === 'placeClips')
    const cur = cursorAt(steps, f, 0.5)
    fillView(view, steps, cur, vc)
    expect(view.focus).toBe('endoscope')
    expect(view.scope).toBe('clipping')
    expect(view.unit).toBe('console')
    const surgeon = view.roles.find((r) => r.role === 'surgeon')!
    expect(surgeon).toMatchObject({ entityId: 'or-surgeon', action: 'operateConsole', anchor: 'surgeonConsole' })
    expect(view.roles.find((r) => r.role === 'scrub')!.entityId).toBeNull()
    expect(view.patient.headTiltDeg).toBe(15)
    expect(view.patient.airway).toBe('tube')
    expect(view.focusAt.y).toBeGreaterThan(0.5)
    // the scope key is carried forward through steps that do not set one
    const prev = script.steps.findIndex((s) => s.id === 'cartAway')
    fillView(view, steps, cursorAt(steps, prev, 0), vc)
    expect(view.scope).toBe('finalCheck')
    // the entity ids follow the room without a step change
    vc.entityIds = { surgeon: 'or-surgeon-2' }
    const v = view.version
    expect(fillView(view, steps, cursorAt(steps, prev, 0.3), vc)).toBe(false)
    expect(view.roles.find((r) => r.role === 'surgeon')!.entityId).toBe('or-surgeon-2')
    expect(view.version).toBe(v)
  })

  it('marks a repeated step with its k of n, and a new case or a new repeat is a step change', () => {
    const syn = compileScript(synthCryo())
    const rs = caseSteps(syn, 'watch', null, 3)
    const view = emptyProcedureView()
    const vc: ViewCtx = { caseId: 'c1', watch: false, entityIds: {}, targets: newTargetCtx() }
    const cur = newCursor()
    const total = rs.totalU[syn.unitIndex.get('aim')!]
    const seen: string[] = []
    for (let j = 0; j < 400; j++) {
      stepAt(rs, 'aim', 0, total, (total * (j + 0.5)) / 400, null, cur)
      if (fillView(view, rs, cur, vc)) seen.push(`${view.stepId}:${view.repeat ? `${view.repeat.k}/${view.repeat.n}` : '-'}`)
    }
    expect(seen).toEqual(['aimGuide:1/3', 'needleIn:1/3', 'aimGuide:2/3', 'needleIn:2/3', 'aimGuide:3/3', 'needleIn:3/3', 'aimDone:-'])
    expect(view.stepCount).toBe(12)
    // another case with the same step is still a change
    vc.caseId = 'c2'
    expect(fillView(view, rs, cur, vc)).toBe(true)
  })

  it('clears to the empty view, once', () => {
    const view = emptyProcedureView()
    const vc = ctxOf()
    fillView(view, steps, cursorAt(steps, 5, 0.5), vc)
    const v = view.version
    expect(clearView(view)).toBe(true)
    expect(view.version).toBe(v + 1)
    expect(view.procedureId).toBeNull()
    expect(view.stepIndex).toBe(-1)
    expect(view.patient).toEqual(emptyProcedureView().patient)
    expect(view.roles.every((r) => r.anchor === null && r.entityId === null)).toBe(true)
    expect(clearView(view)).toBe(false)
    expect(view.version).toBe(v + 1)
    // and a new case fills it again
    expect(fillView(view, steps, cursorAt(steps, 0, 0), vc)).toBe(true)
    expect(view.roles).toHaveLength(5)
    expect(view.roles.length).toBe(cs.roles.length)
    const role: ProcRole = 'surgeon'
    expect(view.roles[0].role).toBe(role)
  })
})

// ---------------------------------------------------------------------------------------------
// R5 wave 2: the two pelvic scripts through the engine
// ---------------------------------------------------------------------------------------------

describe.each(['or-hysterectomy', 'or-prostatectomy'] as const)('the engine on %s', (id) => {
  const pcs = compiledFor(id)!
  const pscript = pcs.script
  const stepIndex = (stepId: string) => pscript.steps.findIndex((s) => s.id === stepId)

  it('holds the script\'s arms until the console, walks them through every change in order, and never touches the endoscope', () => {
    for (const mode of ['live', 'watch'] as const) {
      const steps = caseSteps(pcs, mode, mode === 'live' ? new Rng(5).fork('script') : null)
      const w = davinciWindows(5).find((x) => x.unit === 'console')!
      const out = ['', '', '', '']
      armsAt(steps, w.since, w.until, w.since - 100, out)
      expect(out).toEqual([...pscript.robotArms!])
      const want = [...pscript.robotArms!]
      for (let t = w.since; t <= w.until + 5; t += 0.5) {
        armsAt(steps, w.since, w.until, t, out)
        expect(out[1]).toBe('Endoscope 30°')
        // an arm only ever holds the base instrument or one the script gave it
        for (const arm of [0, 2, 3]) expect([want[arm], ...pscript.steps.flatMap((s) => (s.arms?.[String(arm) as '0'] !== undefined ? [s.arms[String(arm) as '0']!] : []))]).toContain(out[arm])
      }
      armsAt(steps, w.since, w.until, w.until + 1000, out)
      // what the last change of each arm left on it
      for (const arm of ['0', '2'] as const) {
        const last = [...pscript.steps].reverse().find((s) => s.arms?.[arm] !== undefined)
        expect(out[Number(arm)], `arm ${arm}`).toBe(last?.arms?.[arm] ?? want[Number(arm)])
      }
      // one planned exchange per changed arm, in time order, each inside the console window
      const planned = scriptedExchanges(steps, w.until - w.since)
      expect(planned).toHaveLength(pcs.armChanges.length)
      for (let i = 1; i < planned.length; i++) expect(planned[i].at).toBeGreaterThanOrEqual(planned[i - 1].at)
      for (const e of planned) {
        expect(e.at).toBeGreaterThanOrEqual(0)
        expect(e.at).toBeLessThan(w.until - w.since)
        expect(ENDOSCOPE_UI.instruments[e.instrument]).toBeDefined()
      }
    }
  })

  it('shows lithotomy from the step that lays the legs up, eases the head-down tilt over its step, holds it while docked and brings it back with the cart', () => {
    const steps = caseSteps(pcs, 'watch', null)
    const at = (stepId: string, p: number) => patientAt(steps, cursorAt(steps, stepIndex(stepId), p), blank())
    const up = pscript.steps.find((s) => s.patient?.position === 'lithotomy')!
    expect(at(up.id, 0).position).toBe('lithotomy')
    expect(at(up.id, 0).arms).toBe('tucked')
    expect(at(pscript.steps[stepIndex(up.id) - 1].id, 1).position).toBe('supine')
    const tilt = pscript.steps.find((s) => s.patient?.headTiltDeg !== undefined && s.patient.headTiltDeg < 0)!
    const target = tilt.patient!.headTiltDeg!
    expect(at(tilt.id, 0).headTiltDeg).toBe(0)
    expect(at(tilt.id, 0.5).headTiltDeg).toBeCloseTo(target / 2, 9)
    expect(at(tilt.id, 1).headTiltDeg).toBe(target)
    expect(at('driveCart', 0).headTiltDeg).toBe(target)
    expect(at('releaseArms', 1).headTiltDeg).toBe(target)
    expect(at('cartAway', 0.5).headTiltDeg).toBeCloseTo(target / 2, 9)
    expect(at('cartAway', 1).headTiltDeg).toBe(0)
    // the legs come down as the patient wakes, with the catheter still in
    expect(at('wakeUp', 0).position).toBe('supine')
    expect(at('wakeUp', 1).catheter).toBe(true)
    expect(at('wheelsOut', 1).airway).toBe('oxygenMask')
  })

  it('lays out as a watch case in exactly the script\'s watch seconds, and as a living case with the same steps and a seeded jitter', () => {
    const watch = caseSteps(pcs, 'watch', null)
    expect(watch.flatCount).toBe(pscript.steps.length)
    expect(watchUnitSeconds(pcs, 'console')).toBe(pscript.steps.filter((s) => s.unit === 'console').reduce((n, s) => n + s.watchSeconds, 0))
    expect(Array.from(watch.weight)).toEqual(pscript.steps.map((s) => s.watchSeconds))
    const a = caseSteps(pcs, 'live', new Rng(8).fork('script'))
    const b = caseSteps(pcs, 'live', new Rng(8).fork('script'))
    expect(Array.from(a.weight)).toEqual(Array.from(b.weight))
    expect(a.flatCount).toBe(watch.flatCount)
    a.weight.forEach((x, i) => expect(Math.abs(x / midSeconds(pscript.steps[i]) - 1), pscript.steps[i].id).toBeLessThanOrEqual(0.1500001))
  })

  it('puts every console step in the console window, the docking steps in the robot\'s slots, and gives each role a line wherever it works', () => {
    const steps = caseSteps(pcs, 'watch', null)
    const cursor = newCursor()
    const w = davinciWindows(2)
    for (const win of w) {
      const seconds = watchUnitSeconds(pcs, win.unit)
      const until = win.since + seconds
      const seen: string[] = []
      for (let t = win.since; t < until; t += 0.5) {
        if (stepAt(steps, win.unit, win.since, until, t, davinciSlots, cursor)) {
          const id = pscript.steps[cursor.index].id
          if (seen[seen.length - 1] !== id) seen.push(id)
          // (each step lasts its watch seconds in the unit's own window; a docking slot is the robot's fixed fraction of it)
          if (pscript.steps[cursor.index].slot === undefined) expect(cursor.until - cursor.since).toBeCloseTo(pscript.steps[cursor.index].watchSeconds, 6)
        }
      }
      expect(seen, win.unit).toEqual(pscript.steps.filter((s) => s.unit === win.unit).map((s) => s.id))
    }
  })
})
