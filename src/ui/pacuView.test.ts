import { describe, expect, it } from 'vitest'
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import type { SurgeryBayState, SurgeryCaseView, SurgeryState } from '@/sim/types'
import { NO_VALUE } from './orView'
import { pacuView } from './pacuView'

function caseView(id: string, o: Partial<SurgeryCaseView> = {}): SurgeryCaseView {
  return { id, patientId: null, name: `Patient ${id}`, procedure: 'cholecystectomy', phase: 'pacu', plannedIn: 0, wheelsIn: null, dockedAt: null, consoleStart: null, consoleEnd: null, wheelsOut: null, outcome: 'home', bay: null, ...o }
}

/** A surgery state with four pre-op and three recovery bays (as the sim builds them), `bays` overriding some of them by seat id. */
function stateOf(cases: SurgeryCaseView[], pacu: Partial<SurgeryBayState>[] = [], preOp: Partial<SurgeryBayState>[] = []): SurgeryState {
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

describe('the recovery panel view', () => {
  it('says "Simulated" and the title, shows the three recovery bays and says nobody is in recovery when they are all free', () => {
    const v = pacuView(stateOf([]), 0)
    expect(v.tag).toBe('Simulated')
    expect(v.title).toBe(SURGERY_UI.panel.pacu.title)
    expect(v.empty).toBe(SURGERY_UI.panel.pacu.empty)
    expect(v.bays.map((b) => b.label)).toEqual(['Bay 1', 'Bay 2', 'Bay 3'])
    expect(v.bays.map((b) => b.n)).toEqual([1, 2, 3])
    for (const b of v.bays) {
      expect(b.occupied).toBe(false)
      expect(b.patient).toBeNull()
      expect(b.since).toBeNull()
      expect(b.outcome).toBeNull()
    }
  })

  it('shows only the recovery bays, never the pre-op ones, even when pre-op bays are full', () => {
    const v = pacuView(stateOf([caseView('c1', { patientId: 'p-1' })], [], [{ patientId: 'p-1', since: 0 }]), 600)
    expect(v.bays).toHaveLength(3)
    expect(v.empty).toBe(SURGERY_UI.panel.pacu.empty)
  })

  it('shows the patient in a bay with the minutes since they came in and where they go next', () => {
    const cases = [caseView('c1', { patientId: 'p-1', name: 'Ana Costa', outcome: 'home' }), caseView('c2', { patientId: 'p-2', name: 'Ben Okoye', outcome: 'ward' })]
    const v = pacuView(stateOf(cases, [{ patientId: 'p-1', since: 1000 }, {}, { patientId: 'p-2', since: 1000 - 600 }]), 1000 + 12 * 60 + 30)
    expect(v.empty).toBeNull()
    expect(v.bays[0]).toMatchObject({ n: 1, label: 'Bay 1', occupied: true, patient: 'Ana Costa', since: '12 min', outcome: SURGERY_COPY.outcomes.home })
    expect(v.bays[1]).toMatchObject({ n: 2, occupied: false, patient: null, since: null, outcome: null })
    expect(v.bays[2]).toMatchObject({ n: 3, occupied: true, patient: 'Ben Okoye', since: '22 min', outcome: SURGERY_COPY.outcomes.ward })
  })

  it('a patient who is not on the list shows as unknown and has no outcome; minutes never go negative', () => {
    const v = pacuView(stateOf([], [{ patientId: 'stranger', since: 5000 }]), 100)
    expect(v.bays[0].occupied).toBe(true)
    expect(v.bays[0].patient).toBe(NO_VALUE)
    expect(v.bays[0].outcome).toBeNull()
    expect(v.bays[0].since).toBe('0 min')
  })

  it('finds the patient by the bay seat the case names when the bay has only an entity id', () => {
    const v = pacuView(stateOf([caseView('c1', { patientId: null, name: 'Cy Dalton', bay: 'surgeryBed:pacu:1' })], [{}, { patientId: 'p-x', since: 0 }]), 60)
    expect(v.bays[1].patient).toBe('Cy Dalton')
  })

  it('is plain data: a JSON round trip changes nothing', () => {
    const v = pacuView(stateOf([caseView('c1', { patientId: 'p-1' })], [{ patientId: 'p-1', since: 10 }]), 400)
    expect(JSON.parse(JSON.stringify(v))).toEqual(v)
  })
})
