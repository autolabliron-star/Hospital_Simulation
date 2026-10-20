/**
 * Who is on each monitor, from a fake world: the OR table from wheels-in to wheels-out, the PACU and pre-op bays by seat, the ER bay while the
 * patient lies on the trolley (not while away for tests), triage only while the nurse assesses.
 */
import { describe, expect, it } from 'vitest'
import { caseView, dockedRobot, surgeryState, theatre } from '@/scene/surgery/testkit'
import type { CasePhase } from '@/sim/types'
import { newOccupant, occupantOf, ON_TABLE, type OccupancySource } from './occupancy'
import { erCase, fakeEr } from './testkit'

function src(o: Partial<OccupancySource> = {}): OccupancySource {
  return { surgery: () => null, er: () => null, ...o }
}

describe('occupancy', () => {
  it('the OR monitor shows the patient on the table from wheels-in to wheels-out, with the docking and the console times', () => {
    for (const phase of ['scheduled', 'preOp', 'toTheatre', 'in', 'console', 'emergence', 'out', 'pacu'] as CasePhase[]) {
      const st = surgeryState({
        theatre: theatre(phase, { cases: [caseView('c1', { patientId: 'p1', name: 'Ana Costa', procedure: 'prostatectomy', wheelsIn: 500, dockedAt: 900, consoleEnd: 5000 })] }),
        robot: dockedRobot('transverse'),
      })
      const o = newOccupant()
      const on = occupantOf(src({ surgery: () => st }), 'or', 'orTable:0', o)
      expect(on, phase).toBe(ON_TABLE.has(phase))
      if (on) {
        expect(o).toMatchObject({ id: 'p1', name: 'Ana Costa', context: 'or', since: 500, phase, procedure: 'prostatectomy', dockedAt: 900, insufflationEnd: 5000 })
      }
    }
    const idle = surgeryState()
    expect(occupantOf(src({ surgery: () => idle }), 'or', 'orTable:0', newOccupant())).toBe(false)
  })

  it('a PACU or pre-op monitor shows the patient in its own bay, named from the day list', () => {
    const st = surgeryState({ theatre: theatre('console', { cases: [caseView('c1', { patientId: 'p1', name: 'Ana Costa' }), caseView('c2', { patientId: 'p2', name: 'Bo Lindqvist', procedure: 'hysterectomy' })] }) })
    const pacu1 = st.bays.find((b) => b.kind === 'pacu' && b.seatId === 'surgeryBed:pacu:1')!
    pacu1.patientId = 'p2'
    pacu1.since = 777
    const pre0 = st.bays.find((b) => b.kind === 'preOp' && b.seatId === 'surgeryBed:preop:0')!
    pre0.patientId = 'p1'
    const s = src({ surgery: () => st })
    const o = newOccupant()
    expect(occupantOf(s, 'pacu', 'surgeryBed:pacu:1', o)).toBe(true)
    expect(o).toMatchObject({ id: 'p2', name: 'Bo Lindqvist', context: 'pacu', since: 777, procedure: 'hysterectomy' })
    expect(occupantOf(s, 'pacu', 'surgeryBed:pacu:0', o)).toBe(false)
    expect(occupantOf(s, 'preop', 'surgeryBed:preop:0', o)).toBe(true)
    expect(o).toMatchObject({ id: 'p1', context: 'preop' })
    // a bay seat of the other kind never matches
    expect(occupantOf(s, 'pacu', 'surgeryBed:preop:0', o)).toBe(false)
  })

  it('an ER monitor shows the case holding its bay while lying on the trolley, with the acuity, not while away for tests', () => {
    const er = fakeEr()
    er.bays[2].caseId = 'e1'
    er.cases.set('e1', erCase('e1', 2, { acuity: 2, reason: 'Chest pain', trolleyAt: 321 }))
    const s = src({ er: () => er })
    const o = newOccupant()
    expect(occupantOf(s, 'er', 'erBay:bay:2', o)).toBe(true)
    expect(o).toMatchObject({ id: 'e1', name: 'Patient e1', context: 'er', since: 321, acuity: 2, reason: 'Chest pain' })
    expect(occupantOf(s, 'er', 'erBay:bay:1', o)).toBe(false)
    er.cases.get('e1')!.state = 'tests.testing'
    expect(occupantOf(s, 'er', 'erBay:bay:2', o)).toBe(false)
    er.cases.get('e1')!.state = 'inBay.exam'
    er.cases.get('e1')!.onTrolley = false
    expect(occupantOf(s, 'er', 'erBay:bay:2', o)).toBe(false)
  })

  it('a triage monitor is connected only while the nurse assesses (a spot check)', () => {
    const er = fakeEr()
    er.triageBays[1].caseId = 't1'
    er.cases.set('t1', erCase('t1', -1, { state: 'triage.walking', triageBay: 1 }))
    const s = src({ er: () => er })
    const o = newOccupant()
    expect(occupantOf(s, 'triage', 'triageBay:bay:1', o)).toBe(false)
    er.cases.get('t1')!.state = 'triage.assessing'
    expect(occupantOf(s, 'triage', 'triageBay:bay:1', o)).toBe(true)
    expect(o.context).toBe('triage')
    expect(Number.isNaN(o.since)).toBe(true)
    expect(occupantOf(s, 'triage', 'triageBay:bay:0', o)).toBe(false)
  })

  it('reads nothing when the world has no ER or no surgery', () => {
    const o = newOccupant()
    for (const ctx of ['or', 'pacu', 'preop', 'er', 'triage'] as const) expect(occupantOf(src(), ctx, 'x', o)).toBe(false)
  })
})
