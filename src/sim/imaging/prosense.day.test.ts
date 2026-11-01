/**
 * R5 wave 3: both ProSense procedures in the living day (the presenter's demo, real windows, the script's steps sharing each window by the middle of
 * their real minutes) over 30 seeds, and the day's booked cryoablation (op-19, 10:15) through the same step engine.
 */
import { describe, expect, it } from 'vitest'
import { OUTPATIENTS } from '@/content/imaging'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'
import { DT, expectCase, expectDayWeights, runCase, type CaseTrace } from './prosense.testkit'

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)

describe.each(['us-cryo-breast', 'us-cryo-fibroadenoma'])('%s in the living day', (protocol) => {
  it('runs to completion over 30 seeds: every step in order, tiling its unit, both people in place', { timeout: 1_800_000 }, () => {
    const traces: CaseTrace[] = []
    for (const seed of SEEDS) {
      const c = runCase(seed, protocol, false)
      traces.push(c)
      expectCase(c)
      expectDayWeights(c)
    }
    expect(traces).toHaveLength(30)
    // the case varies with the seed: a fibroadenoma's programme and probe move are drawn
    if (protocol === 'us-cryo-fibroadenoma') {
      expect(traces.some((c) => c.relocate)).toBe(true)
      expect(traces.some((c) => !c.relocate)).toBe(true)
    }
  })
})

describe('the booked cryoablation (op-19) runs through the step engine', () => {
  it('is a scripted case with the radiologist: every step in order, the patient posed on the couch, and she goes home', { timeout: 600_000 }, () => {
    const o = OUTPATIENTS.find((x) => x.protocol === 'us-cryo-breast')!
    const sim = new Simulation(7, { startHour: 9.75, inFlight: false })
    const view = sim.imaging.machines.us.state.procedure
    const ids: string[] = []
    let posed = 0
    let last = -1
    for (let i = 0, n = Math.round((60 * 60) / DT); i < n; i++) {
      sim.step(DT)
      if (view.procedureId !== null && view.stepIndex !== last) {
        last = view.stepIndex
        ids.push(view.stepId)
        expect(view.watch).toBe(false)
        expect(view.procedureId).toBe('us-breastCancer')
      }
      const p = sim.imaging.outpatients.find((x) => x.id === o.id)
      if (p && view.procedureId !== null && p.entity.patientPose === view.patient) posed++
      if (ids.length > 0 && view.procedureId === null && sim.imaging.machines.us.session === null) break
    }
    expect(ids).toHaveLength(24)
    expect(ids[0]).toBe('consoleCheck')
    expect(ids.at(-1)).toBe('walkOut')
    expect(posed).toBeGreaterThan(60 * 60)
    expect(sim.imaging.stuckFixes, sim.imaging.stuckLog.join('; ')).toBe(0)
    expect(CONFIG.imaging.cryo.checkSeconds).toBeGreaterThan(0)
  })
})
