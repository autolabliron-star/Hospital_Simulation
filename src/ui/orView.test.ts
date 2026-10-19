import { describe, expect, it } from 'vitest'
import { THEATRE_STAFF } from '@/content/staff'
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import { clockText } from '@/sim/events'
import { timeAtHour } from '@/sim/population/schedule'
import { areaById } from '@/sim/places'
import type { CasePhase, RobotArmState, SurgeryBayState, SurgeryCaseView, SurgeryState, TheatreKpis } from '@/sim/types'
import { caseOfBay, insideRect, minutesSince, minutesText, NO_VALUE, OR_RECT, orView, percentText, teamOf, timelineSteps, TIMELINE_PHASES, type TeamInput } from './orView'

function arm(i: 0 | 1 | 2 | 3, o: Partial<RobotArmState> = {}): RobotArmState {
  return { index: i, instrument: '', port: null, drape: 0, engage: 0, force: 0, exchanges: 0, ...o }
}

function caseView(id: string, o: Partial<SurgeryCaseView> = {}): SurgeryCaseView {
  return { id, patientId: null, name: `Patient ${id}`, procedure: 'cholecystectomy', phase: 'scheduled', plannedIn: timeAtHour(9), wheelsIn: null, dockedAt: null, consoleStart: null, consoleEnd: null, wheelsOut: null, outcome: 'home', bay: null, ...o }
}

function surgeryState(o: { cases?: SurgeryCaseView[]; caseId?: string | null; phaseEnds?: number | null; phase?: CasePhase | 'idle' | 'turnover'; kpis?: Partial<TheatreKpis>; arms?: RobotArmState[]; robotPhase?: SurgeryState['robot']['phase']; bays?: SurgeryBayState[] } = {}): SurgeryState {
  const bays: SurgeryBayState[] = o.bays ?? [
    ...[0, 1, 2, 3].map((i): SurgeryBayState => ({ seatId: `surgeryBed:preop:${i}`, kind: 'preOp', patientId: null, since: 0, curtain: false })),
    ...[0, 1, 2].map((i): SurgeryBayState => ({ seatId: `surgeryBed:pacu:${i}`, kind: 'pacu', patientId: null, since: 0, curtain: false })),
  ]
  return {
    theatre: {
      caseId: o.caseId ?? null,
      phase: o.phase ?? 'idle',
      phaseSince: 0,
      phaseEnds: o.phaseEnds ?? null,
      lights: false,
      surgeonAtConsole: false,
      teachingInUse: false,
      cases: o.cases ?? [],
      kpis: { casesToday: 0, firstCaseOnTime: null, dockingMin: null, consoleMin: null, turnoverMin: null, pacuMin: null, utilisation: null, ...(o.kpis ?? {}) },
      version: 0,
    },
    robot: {
      phase: o.robotPhase ?? 'stowed',
      cart: { x: 0, z: 0, heading: 0 },
      boomYaw: 0,
      boomHeight: 1.74,
      boomExtend: 0,
      laser: false,
      arms: o.arms ?? [arm(0), arm(1), arm(2), arm(3)],
      motionSeed: 1,
      phaseSince: 0,
      version: 0,
    },
    bays,
    version: 0,
  }
}

const team = (inOr: boolean[] = []): TeamInput[] => THEATRE_STAFF.map((m, i) => ({ id: m.id, name: m.name, title: m.title, inOr: inOr[i] ?? false }))

describe('the OR panel view', () => {
  it('says "Simulated" and the room, and with an empty list shows no rows, no current case, a stowed robot with four idle arms and no numbers yet', () => {
    const v = orView(surgeryState(), 0, team())
    expect(v.tag).toBe(SURGERY_UI.panel.tag)
    expect(v.tag).toBe('Simulated')
    expect(v.note).toBe(SURGERY_UI.panel.note)
    expect(v.room).toBe(SURGERY_UI.panel.room)
    expect(v.cases).toEqual([])
    expect(v.current).toBeNull()
    expect(v.robot.phase).toBe(SURGERY_COPY.robotPhases.stowed)
    expect(v.robot.arms.map((a) => a.label)).toEqual(['Arm 1', 'Arm 2', 'Arm 3', 'Arm 4'])
    expect(v.robot.arms.map((a) => a.instrument)).toEqual([NO_VALUE, NO_VALUE, NO_VALUE, NO_VALUE])
    expect(v.kpis.map((k) => k.id)).toEqual(['firstOnTime', 'docking', 'console', 'turnover', 'recovery', 'utilisation'])
    expect(v.kpis.map((k) => k.value)).toEqual([SURGERY_UI.panel.kpiValue.notYet, NO_VALUE, NO_VALUE, NO_VALUE, NO_VALUE, NO_VALUE])
    expect(v.kpis.map((k) => k.label)).toEqual(Object.values(SURGERY_UI.panel.kpi))
  })

  it('lists every case with the patient, the procedure, the planned wheels-in as a clock and the phase label', () => {
    const cases = [caseView('c1', { name: 'Ana Costa', plannedIn: timeAtHour(8.5), phase: 'console' }), caseView('c2', { name: 'Ben Okoye', procedure: 'hysterectomy', plannedIn: timeAtHour(11.25), phase: 'scheduled' }), caseView('c3', { procedure: 'prostatectomy', plannedIn: timeAtHour(14 + 5 / 60) })]
    const v = orView(surgeryState({ cases }), 0, team())
    expect(v.cases.map((c) => c.patient)).toEqual(['Ana Costa', 'Ben Okoye', 'Patient c3'])
    expect(v.cases.map((c) => c.procedure)).toEqual([SURGERY_COPY.procedures.cholecystectomy.name, SURGERY_COPY.procedures.hysterectomy.name, SURGERY_COPY.procedures.prostatectomy.name])
    expect(v.cases.map((c) => c.time)).toEqual(['08:30', '11:15', '14:05'])
    expect(v.cases.map((c) => c.phase)).toEqual([SURGERY_COPY.phases.console, SURGERY_COPY.phases.scheduled, SURGERY_COPY.phases.scheduled])
    for (const c of v.cases) expect(c.time).toBe(clockText(cases.find((x) => x.id === c.id)!.plannedIn))
  })

  it('highlights the case that is in the room, and only that one', () => {
    const cases = [caseView('c1', { phase: 'done' }), caseView('c2', { phase: 'ports' }), caseView('c3')]
    const v = orView(surgeryState({ cases, caseId: 'c2', phase: 'ports' }), 0, team())
    expect(v.cases.map((c) => c.current)).toEqual([false, true, false])
    expect(orView(surgeryState({ cases, caseId: null }), 0, team()).cases.some((c) => c.current)).toBe(false)
  })

  it('says where the patient goes next only once they are out of the OR', () => {
    const phases: CasePhase[] = ['scheduled', 'arrived', 'preOp', 'toTheatre', 'in', 'induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence', 'out', 'pacu', 'phase2', 'leaving', 'done']
    const known: CasePhase[] = ['out', 'pacu', 'phase2', 'leaving', 'done']
    for (const phase of phases) {
      const home = orView(surgeryState({ cases: [caseView('h', { phase, outcome: 'home' })] }), 0, team()).cases[0]
      const ward = orView(surgeryState({ cases: [caseView('w', { phase, outcome: 'ward' })] }), 0, team()).cases[0]
      if (known.includes(phase)) {
        expect(home.outcome, phase).toBe(SURGERY_COPY.outcomes.home)
        expect(ward.outcome, phase).toBe(SURGERY_COPY.outcomes.ward)
      } else {
        expect(home.outcome, phase).toBeNull()
        expect(ward.outcome, phase).toBeNull()
      }
    }
  })

  it('has no current case when the theatre has none, or its id is not on the list', () => {
    expect(orView(surgeryState({ cases: [caseView('c1')], caseId: null }), 0, team()).current).toBeNull()
    expect(orView(surgeryState({ cases: [caseView('c1')], caseId: 'ghost' }), 0, team()).current).toBeNull()
  })
})

describe('the phase timeline', () => {
  it('has the ten in-room phases in order, labelled from the copy', () => {
    expect([...TIMELINE_PHASES]).toEqual(['in', 'induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence', 'out'])
    const steps = timelineSteps('in')
    expect(steps.map((s) => s.phase)).toEqual([...TIMELINE_PHASES])
    expect(steps.map((s) => s.label)).toEqual(TIMELINE_PHASES.map((p) => SURGERY_COPY.phases[p]))
  })

  it('marks the steps before the current phase done, the phase current and the rest upcoming', () => {
    const steps = timelineSteps('ports')
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
    for (const phase of TIMELINE_PHASES) {
      const s = timelineSteps(phase)
      expect(s.filter((x) => x.state === 'current').map((x) => x.phase)).toEqual([phase])
    }
  })

  it('a case not yet in the room is all upcoming; one that is out and in recovery is all done', () => {
    for (const phase of ['scheduled', 'arrived', 'preOp', 'toTheatre'] as const) expect(timelineSteps(phase).every((s) => s.state === 'upcoming'), phase).toBe(true)
    for (const phase of ['pacu', 'phase2', 'leaving', 'done'] as const) expect(timelineSteps(phase).every((s) => s.state === 'done'), phase).toBe(true)
  })

  it('shows the case in the room with its phase and the minutes left in it (rounded up, never negative)', () => {
    const cases = [caseView('c1', { name: 'Ana Costa', phase: 'console', procedure: 'hysterectomy' })]
    const at = (phaseEnds: number | null, t: number) => orView(surgeryState({ cases, caseId: 'c1', phase: 'console', phaseEnds }), t, team()).current!
    const cur = at(1000 + 12 * 60 - 20, 1000)
    expect(cur.patient).toBe('Ana Costa')
    expect(cur.procedure).toBe(SURGERY_COPY.procedures.hysterectomy.name)
    expect(cur.phase).toBe(SURGERY_COPY.phases.console)
    expect(cur.timeLeft).toBe('12 min')
    expect(cur.steps.find((s) => s.state === 'current')!.phase).toBe('console')
    expect(at(1000 + 60, 1000).timeLeft).toBe('1 min')
    expect(at(900, 1000).timeLeft).toBe('0 min')
    expect(at(null, 1000).timeLeft).toBeNull()
  })

  it('has no time left for a case that is not in the room yet', () => {
    const cases = [caseView('c1', { phase: 'toTheatre' })]
    const cur = orView(surgeryState({ cases, caseId: 'c1', phase: 'toTheatre', phaseEnds: 5000 }), 0, team()).current!
    expect(cur.timeLeft).toBeNull()
    expect(cur.steps.every((s) => s.state === 'upcoming')).toBe(true)
  })
})

describe('the robot and its arms', () => {
  it('shows the robot phase label and each arm: label, instrument, engage as a percent, force as a bar, the drape', () => {
    const arms = [
      arm(0, { instrument: 'Fenestrated bipolar forceps', engage: 1, force: 0.42, drape: 1 }),
      arm(1, { instrument: 'Endoscope 30°', engage: 0.456, force: 0, drape: 1 }),
      arm(2, { instrument: 'Monopolar curved scissors', engage: 0.5, force: 1.4, drape: 0.2 }),
      arm(3, { instrument: '', engage: -0.1, force: -2, drape: 0 }),
    ]
    const v = orView(surgeryState({ arms, robotPhase: 'targeting' }), 0, team())
    expect(v.robot.phase).toBe(SURGERY_COPY.robotPhases.targeting)
    expect(v.robot.arms.map((a) => a.label)).toEqual(['Arm 1', 'Arm 2', 'Arm 3', 'Arm 4'])
    expect(v.robot.arms.map((a) => a.instrument)).toEqual(['Fenestrated bipolar forceps', 'Endoscope 30°', 'Monopolar curved scissors', NO_VALUE])
    expect(v.robot.arms.map((a) => a.engage)).toEqual(['100%', '46%', '50%', '0%'])
    expect(v.robot.arms.map((a) => a.engagePct)).toEqual([100, 46, 50, 0])
    expect(v.robot.arms.map((a) => a.forcePct)).toEqual([42, 0, 100, 0]) // clamped to 0..1
    expect(v.robot.arms.map((a) => a.drape)).toEqual([true, true, false, false])
    expect(v.robot.arms.map((a) => a.endoscope)).toEqual([false, true, false, false])
  })

  it('every robot phase has a label', () => {
    for (const phase of Object.keys(SURGERY_COPY.robotPhases) as (keyof typeof SURGERY_COPY.robotPhases)[]) {
      expect(orView(surgeryState({ robotPhase: phase }), 0, team()).robot.phase).toBe(SURGERY_COPY.robotPhases[phase])
    }
  })
})

describe('the numbers', () => {
  it('reads the KPIs: on time or late, minutes, percent', () => {
    const k = (kpis: Partial<TheatreKpis>) => orView(surgeryState({ kpis }), 0, team()).kpis.map((x) => x.value)
    expect(k({ firstCaseOnTime: true, dockingMin: 7.6, consoleMin: 22.4, turnoverMin: 20, pacuMin: 45, utilisation: 0.634 })).toEqual([SURGERY_UI.panel.kpiValue.yes, '8 min', '22 min', '20 min', '45 min', '63%'])
    expect(k({ firstCaseOnTime: false })[0]).toBe(SURGERY_UI.panel.kpiValue.no)
    expect(k({ firstCaseOnTime: null })[0]).toBe(SURGERY_UI.panel.kpiValue.notYet)
    expect(k({ utilisation: 0 })[5]).toBe('0%')
    expect(k({ utilisation: 1.2 })[5]).toBe('100%')
  })

  it('formats minutes, percent and elapsed minutes from the copy', () => {
    expect(minutesText(12.4)).toBe('12 min')
    expect(percentText(0.5)).toBe('50%')
    expect(minutesSince(100, 100 + 59)).toBe(0)
    expect(minutesSince(100, 100 + 61)).toBe(1)
    expect(minutesSince(500, 100)).toBe(0)
  })
})

describe('the team', () => {
  it('lists the nine theatre staff by name and post and marks who is inside the OR', () => {
    const rect = areaById('l2Or').rect
    expect(OR_RECT).toEqual(rect)
    const inside = { position: { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 } }
    const outside = { position: { x: rect.x0 - 5, z: rect.z0 + 1 } }
    const people = new Map<string, { position: { x: number; z: number } }>([
      ['or-surgeon', inside],
      ['or-anaes', inside],
      ['or-scrub', outside],
    ])
    const t = teamOf(people)
    expect(t).toHaveLength(9)
    expect(t.map((m) => m.name)).toEqual(THEATRE_STAFF.map((m) => m.name))
    expect(t.map((m) => m.title)).toEqual(THEATRE_STAFF.map((m) => m.title))
    expect(t.filter((m) => m.inOr).map((m) => m.id)).toEqual(['or-surgeon', 'or-anaes'])
    // a person who is not in the hospital at all is outside
    expect(t.find((m) => m.id === 'or-porter')!.inOr).toBe(false)
  })

  it('the rectangle counts its edges as inside', () => {
    const r = { x0: 0, x1: 2, z0: 0, z1: 2 }
    expect(insideRect(0, 0, r)).toBe(true)
    expect(insideRect(2, 2, r)).toBe(true)
    expect(insideRect(2.01, 1, r)).toBe(false)
    expect(insideRect(1, -0.01, r)).toBe(false)
  })

  it('passes the team through the view as it was given', () => {
    const v = orView(surgeryState(), 0, team([true, false, true]))
    expect(v.team.map((m) => m.inOr)).toEqual([true, false, true, false, false, false, false, false, false])
    expect(v.team.map((m) => m.name)).toEqual(THEATRE_STAFF.map((m) => m.name))
  })
})

describe('a bay and its case', () => {
  it('finds the case by the patient in the bay, or by the bay seat the case names; an empty bay has none', () => {
    const cases = [caseView('c1', { patientId: 'p-1' }), caseView('c2', { patientId: null, bay: 'surgeryBed:pacu:1' })]
    const bay = (patientId: string | null, seatId = 'surgeryBed:pacu:0'): SurgeryBayState => ({ seatId, kind: 'pacu', patientId, since: 0, curtain: false })
    expect(caseOfBay(cases, bay('p-1'))!.id).toBe('c1')
    expect(caseOfBay(cases, bay('p-9', 'surgeryBed:pacu:1'))!.id).toBe('c2')
    expect(caseOfBay(cases, bay('p-9'))).toBeNull()
    expect(caseOfBay(cases, bay(null, 'surgeryBed:pacu:1'))).toBeNull()
  })
})

describe('the view is plain data', () => {
  it('survives a JSON round trip unchanged, so usePoll can diff it, and is the same twice for the same state', () => {
    const cases = [caseView('c1', { phase: 'docking', name: 'Ana Costa' })]
    const arms = [arm(0, { instrument: 'Large needle driver', engage: 0.3, force: 0.2, drape: 1 }), arm(1), arm(2), arm(3)]
    const s = surgeryState({ cases, caseId: 'c1', phase: 'docking', phaseEnds: 4000, arms, kpis: { firstCaseOnTime: true, dockingMin: 7, utilisation: 0.5 } })
    const v = orView(s, 100, team([true]))
    expect(JSON.parse(JSON.stringify(v))).toEqual(v)
    expect(JSON.stringify(orView(s, 100, team([true])))).toBe(JSON.stringify(v))
  })
})
