/**
 * F-06: the presenter's "Start a scan now" with nobody on duty. MRI and ultrasound staff go home at 18:00; a demo scan booked then
 * used to walk a patient to the hall and park them there forever (the scanner is never free without an operator).
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'

const DT = CONFIG.sim.step
const run = (sim: Simulation, seconds: number): void => {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) sim.step(DT)
}
const demoPeople = (sim: Simulation): string[] => sim.people.filter((p) => p.entity.id.startsWith('demo')).map((p) => p.entity.id)

describe('start a demo scan with and without an operator', () => {
  it('refuses at 19:00 on the MRI and the ultrasound, books nobody and spawns nobody', { timeout: 120_000 }, () => {
    const sim = new Simulation(7, { startHour: 19, inFlight: false })
    for (const m of ['mri', 'us'] as const) {
      expect(sim.imaging.hasOperator(m), `${m} operator at 19:00`).toBe(false)
      const waiting = sim.imaging.queues[m].length
      expect(sim.imaging.startDemoScan(m)).toBe(false)
      expect(sim.imaging.queues[m].length).toBe(waiting)
    }
    run(sim, CONFIG.imaging.demoArrivalSeconds + 30)
    expect(demoPeople(sim)).toEqual([])
    expect(sim.imaging.scanners.mri.phase).toBe('idle')
    expect(sim.imaging.stuckFixes).toBe(0)
  })

  it('still scans on the CT and the X-ray at 19:00 (their radiographers stay for the ER)', { timeout: 120_000 }, () => {
    const sim = new Simulation(7, { startHour: 19, inFlight: false })
    expect(sim.imaging.hasOperator('xray')).toBe(true)
    expect(sim.imaging.startDemoScan('xray')).toBe(true)
    run(sim, CONFIG.imaging.demoArrivalSeconds + 2)
    expect(demoPeople(sim).length).toBe(1)
  })

  it('books as before in the day, with the operator at work', { timeout: 120_000 }, () => {
    const sim = new Simulation(7, { startHour: 10, inFlight: false })
    expect(sim.imaging.hasOperator('mri')).toBe(true)
    expect(sim.imaging.startDemoScan('mri')).toBe(true)
    run(sim, CONFIG.imaging.demoArrivalSeconds + 2)
    expect(demoPeople(sim).length).toBe(1)
  })

  it('cancels a demo whose operator went off shift before the patient appeared', { timeout: 120_000 }, () => {
    const sim = new Simulation(7, { startHour: 10, inFlight: false })
    expect(sim.imaging.startDemoScan('mri')).toBe(true)
    // the sonographer / radiographer leaves in the few seconds before the patient shows up
    sim.imaging.machines.mri.setOperator(null)
    run(sim, CONFIG.imaging.demoArrivalSeconds + 2)
    expect(demoPeople(sim)).toEqual([])
    expect(sim.imaging.queues.mri.length).toBe(0)
  })
})

describe('F-14: the X-ray "stuck in gap" safety net', () => {
  it('does not fire in a morning with ER traffic and back-to-back demo X-rays: the radiographer walks back to the booth by herself', { timeout: 600_000 }, () => {
    const sim = new Simulation(2026, { startHour: 8 })
    let exams = 0
    for (let i = 0, n = Math.round((4 * 3600) / DT); i < n; i++) {
      sim.step(DT)
      // keep the X-ray busy: a demo X-ray every ten minutes
      if (i % Math.round(600 / DT) === 0) sim.imaging.startDemoScan('xray')
      if (i % 600 === 0) exams = sim.imaging.exams.filter((e) => e.modality === 'xray').length
    }
    expect(exams).toBeGreaterThan(3)
    expect(sim.imaging.stuckLog.filter((l) => /xray stuck in gap/.test(l))).toEqual([])
    expect(sim.imaging.stuckLog).toEqual([])
  })
})
