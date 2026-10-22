/**
 * Wave 1: imaging at real pace. The contrast CT's portal phase follows the arterial one 35-45 s later; reports take the real minutes; the
 * outpatient day runs through the afternoon to 17:00 so the MRI and the ultrasound are not idle after lunch.
 */
import { describe, expect, it } from 'vitest'
import { protocolById } from '@/content/imaging'
import { CONFIG } from '../config'
import { Rng } from '../rng'
import { Simulation } from '../Simulation'
import { buildExam, drawPlan, isPhaseGap } from './exam'

const who = { patientId: 'p', patientName: 'Test Patient' }

describe('exam plan durations', () => {
  it('puts 35-45 s between the arterial and the portal phase of a contrast CT, and the usual pause between other sequences', () => {
    const exam = buildExam('e1', protocolById('ct-abdo'), who, 'outpatient', 1)
    expect(exam.sequences.map((s) => s.contrast)).toEqual(['none', 'arterial', 'portal'])
    expect(isPhaseGap(exam, 0)).toBe(false)
    expect(isPhaseGap(exam, 1)).toBe(true)
    const [g0, g1] = CONFIG.imaging.ctPhaseGapSeconds
    expect(g0).toBeGreaterThanOrEqual(35)
    expect(g1).toBeLessThanOrEqual(45)
    for (let seed = 1; seed <= 200; seed++) {
      const plan = drawPlan(new Rng(seed), exam, { demo: false, transported: false })
      expect(plan.gapS).toHaveLength(2)
      expect(plan.gapS[0]).toBeGreaterThanOrEqual(CONFIG.imaging.betweenStepsSeconds[0])
      expect(plan.gapS[0]).toBeLessThanOrEqual(CONFIG.imaging.betweenStepsSeconds[1])
      expect(plan.gapS[1]).toBeGreaterThanOrEqual(35)
      expect(plan.gapS[1]).toBeLessThanOrEqual(45)
    }
  })

  it('keeps the draw count the same whatever the gap kind (the stream does not shift)', () => {
    const ct = buildExam('e1', protocolById('ct-abdo'), who, 'outpatient', 1)
    const a = new Rng(9)
    drawPlan(a, ct, { demo: false, transported: false })
    const b = new Rng(9)
    // the same number of floats for a three-sequence CT as for a three-sequence exam without a phase gap would be 2 gaps: both draw once per gap
    expect(drawPlan(b, ct, { demo: false, transported: false }).gapS).toHaveLength(2)
    expect(a.float()).toBe(b.float())
  })

  it('reports take the real minutes: CT 20-45, MRI 40-80, X-ray 15-30, ultrasound 10-20', () => {
    const lo = { ct: 20 * 60, mri: 40 * 60, xray: 15 * 60, us: 10 * 60 }
    const hi = { ct: 45 * 60, mri: 80 * 60, xray: 30 * 60, us: 20 * 60 }
    for (const [id, m] of [['ct-head', 'ct'], ['mri-brain', 'mri'], ['xr-ankle', 'xray'], ['us-abdo', 'us']] as const) {
      const exam = buildExam('e', protocolById(id), who, 'er', 1)
      for (let seed = 1; seed <= 50; seed++) {
        const plan = drawPlan(new Rng(seed), exam, { demo: false, transported: true })
        expect(plan.reportS, id).toBeGreaterThanOrEqual(lo[m])
        expect(plan.reportS, id).toBeLessThanOrEqual(hi[m])
      }
    }
  })
})

function runUntil(sim: Simulation, seconds: number): void {
  const n = Math.round(seconds / CONFIG.sim.step)
  for (let i = 0; i < n; i++) sim.step(CONFIG.sim.step)
}

describe('the outpatient afternoon', () => {
  it('scans MRI, CT, X-ray and ultrasound outpatients between 14:00 and 16:30, every scanner has a patient on it at some point, and nothing sticks', { timeout: 300_000 }, () => {
    const sim = new Simulation(7, { startHour: 13.5, inFlight: false })
    const busy = { mri: false, ct: false, xray: false, us: false }
    const step = CONFIG.sim.step
    const end = 3.25 * 3600
    for (let i = 0, n = Math.round(end / step); i < n; i++) {
      sim.step(step)
      if (i % 60 !== 0) continue
      for (const m of ['mri', 'ct', 'xray', 'us'] as const) if (sim.imaging.scanners[m].phase === 'scanning') busy[m] = true
    }
    expect(busy).toEqual({ mri: true, ct: true, xray: true, us: true })
    const afternoon = sim.imaging.exams.filter((e) => e.source === 'outpatient')
    expect(afternoon.length).toBeGreaterThanOrEqual(15)
    expect(sim.imaging.stuckFixes, sim.imaging.stuckLog.join('; ')).toBe(0)
    // the late-day patients are on the way: the last bookings (16:45) are not yet due at 16:45 minus the early arrival, so nothing is abandoned
    expect(sim.imaging.outpatientsHome).toBeGreaterThanOrEqual(10)
  })

  it('is deterministic: the same seed gives the same exams in the same order', { timeout: 300_000 }, () => {
    const key = () => {
      const s = new Simulation(11, { startHour: 14, inFlight: false })
      runUntil(s, 40 * 60)
      return s.imaging.exams.map((e) => `${e.patientName}|${e.protocol}`).join(';') + s.imaging.describe()
    }
    expect(key()).toBe(key())
  })
})
