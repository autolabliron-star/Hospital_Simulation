/**
 * F-27 in the real hospital: a priority 1-2 stroke walk-in has the CT ordered by the nurse right after the care step, before any doctor has
 * seen them, and a chest pain has exactly one ECG (at triage, or at the bay). Node test on the whole Simulation.
 */
import { describe, expect, it, vi } from 'vitest'
import { ER_REASONS } from '@/content/roster'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'
import type { SimEvent } from '../types'
import type { ErPatient } from './patient'

vi.setConfig({ testTimeout: 240_000 })

const DT = CONFIG.sim.step
const STROKE = 'Sudden weakness down one side'
const CHEST = 'Chest pain spreading to arm'

function spawn(sim: Simulation, reason: string): ErPatient {
  const dir = sim.director as unknown as { pickReason: () => (typeof ER_REASONS)[number]; spawnWalkIn: () => ErPatient | null }
  const r = ER_REASONS.find((x) => x.text === reason)!
  const original = dir.pickReason
  dir.pickReason = () => r
  try {
    const p = dir.spawnWalkIn()
    if (p === null) throw new Error('the ER is full')
    return p
  } finally {
    dir.pickReason = original
  }
}

describe('F-27 early CT and ECG in the whole hospital', () => {
  it('orders the stroke CT within minutes of the bay, before the doctor; one ECG for the chest pain', () => {
    const sim = new Simulation(7, {})
    expect(sim.director).toBeTruthy()
    const stroke = spawn(sim, STROKE)
    const chest = spawn(sim, CHEST)
    const t0 = sim.t
    const seen = (p: ErPatient, pred: (e: SimEvent) => boolean): SimEvent[] => sim.log.events.filter((e) => e.subjectId === p.c.id && pred(e))
    let ctOrder: SimEvent | undefined
    for (let i = 0; i < 40 * 60 * 60 && ctOrder === undefined; i++) {
      sim.step(DT)
      ctOrder = seen(stroke, (e) => e.type === 'testsOrdered' && /CT/.test(e.text) && /asked for/.test(e.text))[0]
    }
    expect(ctOrder, 'the nurse asked for the CT').toBeDefined()
    // within 15 minutes of arriving: the wait for a bay, the wheelchair, then the care step (3-6 min x 1.4)
    expect(ctOrder!.t - t0).toBeLessThan(15 * 60)
    // ... and before any doctor saw the patient
    expect(seen(stroke, (e) => e.type === 'seenByDoctor' && e.t <= ctOrder!.t)).toHaveLength(0)
    expect(stroke.c.doctorId).toBeNull()
    // the chest pain: a single ECG line in the first 20 minutes (triage/waiting area or the care step), never two
    for (let i = 0; i < 20 * 60 * 60 && sim.t - t0 < 20 * 60; i++) sim.step(DT)
    const ecgLines = seen(chest, (e) => e.type === 'testsOrdered' && /ECG/.test(e.text))
    expect(ecgLines).toHaveLength(1)
    expect(ecgLines[0].t - t0).toBeLessThan(12 * 60)
  })
})
