import { describe, expect, it } from 'vitest'
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import { timeAtHour } from '@/sim/population/schedule'
import type { SurgeryBayState, SurgeryCaseView, SurgeryState } from '@/sim/types'
import { NO_VALUE } from './orView'
import { preOpView } from './preOpView'

function caseView(id: string, o: Partial<SurgeryCaseView> = {}): SurgeryCaseView {
  return { id, patientId: null, name: `Patient ${id}`, procedure: 'cholecystectomy', phase: 'preOp', plannedIn: timeAtHour(9), wheelsIn: null, dockedAt: null, consoleStart: null, consoleEnd: null, wheelsOut: null, outcome: 'home', bay: null, ...o }
}

function stateOf(cases: SurgeryCaseView[], preOp: Partial<SurgeryBayState>[] = [], pacu: Partial<SurgeryBayState>[] = []): SurgeryState {
  const bays: SurgeryBayState[] = [
    ...[0, 1, 2, 3].map((i): SurgeryBayState => ({ seatId: `surgeryBed:preop:${i}`, kind: 'preOp', patientId: null, since: 0, curtain: false, ...(preOp[i] ?? {}) })),
    ...[0, 1, 2].map((i): SurgeryBayState => ({ seatId: `surgeryBed:pacu:${i}`, kind: 'pacu', patientId: null, since: 0, curtain: false, ...(pacu[i] ?? {}) })),
  ]
  return {
    theatre: { caseId: null, phase: 'idle', phaseSince: 0, phaseEnds: null, lights: false, surgeonAtConsole: false, teachingInUse: false, cases, kpis: { casesToday: 0, firstCaseOnTime: null, dockingMin: null, consoleMin: null, turnoverMin: null, pacuMin: null, utilisation: null }, version: 0 },
    robot: { phase: 'stowed', cart: { x: 0, z: 0, heading: 0 }, boomYaw: 0, boomHeight: 1.74, boomExtend: 0, laser: false, arms: [], motionSeed: 1, phaseSince: 0, version: 0 },
    bays,
    version: 0,
  }
}

describe('the pre-op panel view', () => {
  it('says "Simulated" and the title, shows the four pre-op bays and says nobody is there when they are all free', () => {
    const v = preOpView(stateOf([]), 0)
    expect(v.tag).toBe('Simulated')
    expect(v.title).toBe(SURGERY_UI.panel.preOp.title)
    expect(v.empty).toBe(SURGERY_UI.panel.preOp.empty)
    expect(v.bays.map((b) => b.label)).toEqual(['Bay 1', 'Bay 2', 'Bay 3', 'Bay 4'])
    for (const b of v.bays) {
      expect(b.occupied).toBe(false)
      expect(b.patient).toBeNull()
      expect(b.procedure).toBeNull()
      expect(b.time).toBeNull()
      expect(b.since).toBeNull()
      expect(b.curtain).toBe(false)
    }
  })

  it('shows only the pre-op bays, never the recovery ones, even when recovery is full', () => {
    const v = preOpView(stateOf([caseView('c1', { patientId: 'p-1' })], [], [{ patientId: 'p-1' }]), 600)
    expect(v.bays).toHaveLength(4)
    expect(v.empty).toBe(SURGERY_UI.panel.preOp.empty)
  })

  it('shows each patient with the short procedure name, the planned wheels-in, the minutes since they came in and the curtain', () => {
    const cases = [
      caseView('c1', { patientId: 'p-1', name: 'Ana Costa', procedure: 'cholecystectomy', plannedIn: timeAtHour(9.5) }),
      caseView('c2', { patientId: 'p-2', name: 'Ben Okoye', procedure: 'prostatectomy', plannedIn: timeAtHour(13.25) }),
    ]
    const v = preOpView(stateOf(cases, [{ patientId: 'p-1', since: 100, curtain: true }, {}, { patientId: 'p-2', since: 100 - 1800 }]), 100 + 5 * 60 + 1)
    expect(v.empty).toBeNull()
    expect(v.bays[0]).toMatchObject({ n: 1, occupied: true, patient: 'Ana Costa', procedure: SURGERY_COPY.procedures.cholecystectomy.short, time: '09:30', since: '5 min', curtain: true })
    expect(v.bays[1]).toMatchObject({ n: 2, occupied: false, patient: null, curtain: false })
    expect(v.bays[2]).toMatchObject({ n: 3, occupied: true, patient: 'Ben Okoye', procedure: SURGERY_COPY.procedures.prostatectomy.short, time: '13:15', since: '35 min', curtain: false })
  })

  it('a curtain can be drawn round a free bay', () => {
    expect(preOpView(stateOf([], [{ curtain: true }]), 0).bays[0]).toMatchObject({ occupied: false, curtain: true })
  })

  it('a patient who is not on the list shows as unknown, with no procedure or time', () => {
    const v = preOpView(stateOf([], [{ patientId: 'stranger', since: 0 }]), 120)
    expect(v.bays[0]).toMatchObject({ occupied: true, patient: NO_VALUE, procedure: null, time: null, since: '2 min' })
  })

  it('is plain data: a JSON round trip changes nothing', () => {
    const v = preOpView(stateOf([caseView('c1', { patientId: 'p-1' })], [{ patientId: 'p-1', since: 10, curtain: true }]), 400)
    expect(JSON.parse(JSON.stringify(v))).toEqual(v)
  })
})
