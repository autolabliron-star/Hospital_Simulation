/**
 * The monitors' slow numbers: inside plausible adult ranges in every context, for many patients and all day; the context effects the brief asks for
 * (the CO2 rising once the robot is docked, recovery settling, the acuity in the ER, the white coat at triage); the NIBP schedule; determinism.
 */
import { describe, expect, it } from 'vitest'
import type { CasePhase } from '@/sim/types'
import { baselineOf } from './testkit'
import { insufflationRise, newNibp, newSituation, newVitals, nibpAt, nibpInterval, NIBP_FIRST, RANGES, vitalsAt, wander, type MonitorContext, type Situation } from './vitals'

const CONTEXTS: MonitorContext[] = ['or', 'pacu', 'preop', 'er', 'triage']
const PHASES: CasePhase[] = ['in', 'induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence', 'out']

function sit(context: MonitorContext, o: Partial<Situation> = {}): Situation {
  return { ...newSituation(context), since: 1000, ...o }
}

describe('the vitals behind a monitor', () => {
  it('stay inside plausible adult ranges in every context, phase and acuity, all day', () => {
    const v = newVitals()
    for (let p = 0; p < 40; p++) {
      const b = baselineOf(`p${p}`, p + 1)
      for (const ctx of CONTEXTS) {
        const variants: Partial<Situation>[] =
          ctx === 'or' ? PHASES.map((phase) => ({ phase, procedure: 'prostatectomy', dockedAt: 2000, insufflationEnd: 9000 })) : ctx === 'er' ? [1, 2, 3, 4, 5].map((acuity) => ({ acuity })) : [{}]
        for (const o of variants) {
          const s = sit(ctx, o)
          for (let t = 1000; t < 1000 + 6 * 3600; t += 397) {
            vitalsAt(b, s, t, v)
            for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
              expect(v[key], `${ctx} ${JSON.stringify(o)} ${key}`).toBeGreaterThanOrEqual(RANGES[key][0])
              expect(v[key], `${ctx} ${key}`).toBeLessThanOrEqual(RANGES[key][1])
            }
            expect(v.sys - v.dia).toBeGreaterThanOrEqual(20)
            expect(v.iFrac).toBeGreaterThan(0.2)
            expect(v.iFrac).toBeLessThan(0.5)
          }
        }
      }
    }
  })

  it('in theatre: on the ventilator while anaesthetised, CO2 sampled, an arterial line only for the prostatectomy', () => {
    const b = baselineOf('or1')
    const v = newVitals()
    vitalsAt(b, sit('or', { phase: 'console', procedure: 'prostatectomy' }), 3000, v)
    expect(v.ventilated).toBe(true)
    expect(v.co2).toBe(true)
    expect(v.art).toBe(true)
    expect(v.spo2).toBeGreaterThanOrEqual(98)
    vitalsAt(b, sit('or', { phase: 'console', procedure: 'cholecystectomy' }), 3000, v)
    expect(v.art).toBe(false)
    vitalsAt(b, sit('or', { phase: 'in', procedure: 'cholecystectomy' }), 3000, v)
    expect(v.ventilated).toBe(false)
    vitalsAt(b, sit('pacu'), 3000, v)
    expect(v.co2).toBe(false)
    expect(v.ventilated).toBe(false)
  })

  it('the end-tidal CO2 climbs once the robot is docked, and eases off after the console', () => {
    const s = sit('or', { phase: 'console', procedure: 'hysterectomy', dockedAt: 2000, insufflationEnd: 2000 + 3600 })
    expect(insufflationRise(s, 1900)).toBe(0)
    expect(insufflationRise(s, 2000 + 300)).toBeGreaterThan(1.5)
    expect(insufflationRise(s, 2000 + 1800)).toBeGreaterThan(5)
    expect(insufflationRise(s, 2000 + 3600 + 1800)).toBeLessThan(insufflationRise(s, 2000 + 3600))
    // averaged over patients (the wander is ±0.8), docked runs well above undocked
    let undocked = 0
    let docked = 0
    for (let p = 0; p < 30; p++) {
      const b = baselineOf(`co2-${p}`, p + 3)
      const v = newVitals()
      undocked += vitalsAt(b, sit('or', { phase: 'console', procedure: 'hysterectomy', dockedAt: null }), 4000, v).etco2
      docked += vitalsAt(b, sit('or', { phase: 'console', procedure: 'hysterectomy', dockedAt: 2000 }), 4000, v).etco2
    }
    expect(docked / 30 - undocked / 30).toBeGreaterThan(4)
  })

  it('recovery settles: the heart and the breathing slow, the SpO2 and the temperature come up over the first hour', () => {
    let hr0 = 0
    let hr1 = 0
    let s0 = 0
    let s1 = 0
    let t0 = 0
    let t1 = 0
    for (let p = 0; p < 30; p++) {
      const b = baselineOf(`pacu-${p}`, p + 5)
      const s = sit('pacu', { since: 1000 })
      const a = vitalsAt(b, s, 1060, newVitals())
      const z = vitalsAt(b, s, 1000 + 3600, newVitals())
      hr0 += a.hr
      hr1 += z.hr
      s0 += a.spo2
      s1 += z.spo2
      t0 += a.temp
      t1 += z.temp
    }
    expect(hr1).toBeLessThan(hr0)
    expect(s1).toBeGreaterThan(s0)
    expect(t1).toBeGreaterThan(t0)
  })

  it('in the ER the most urgent patients run faster and breathe faster; triage adds the white coat', () => {
    let fast = 0
    let calm = 0
    let rrFast = 0
    let rrCalm = 0
    for (let p = 0; p < 30; p++) {
      const b = baselineOf(`er-${p}`, p + 9)
      const a = vitalsAt(b, sit('er', { acuity: 1 }), 1100, newVitals())
      const z = vitalsAt(b, sit('er', { acuity: 5 }), 1100, newVitals())
      fast += a.hr
      calm += z.hr
      rrFast += a.rr
      rrCalm += z.rr
      const tri = vitalsAt(b, sit('triage'), 1100, newVitals())
      const pre = vitalsAt(b, sit('preop'), 1100, newVitals())
      expect(tri.sys).toBeCloseTo(Math.max(RANGES.sys[0], Math.min(RANGES.sys[1], pre.sys - 4)), 0)
    }
    expect(fast - calm).toBeGreaterThan(30 * 15)
    expect(rrFast).toBeGreaterThan(rrCalm)
  })

  it('takes the cuff reading on its schedule: 5 min in theatre, 15 in recovery, 30 in pre-op, by acuity in the ER, once at triage', () => {
    expect(nibpInterval(sit('or'))).toBe(300)
    expect(nibpInterval(sit('pacu'))).toBe(900)
    expect(nibpInterval(sit('preop'))).toBe(1800)
    expect(nibpInterval(sit('er', { acuity: 2 }))).toBe(900)
    expect(nibpInterval(sit('er', { acuity: 4 }))).toBe(1800)
    expect(nibpInterval(sit('triage'))).toBe(Infinity)
    const b = baselineOf('cuff')
    const s = sit('pacu', { since: 1000 })
    const r = newNibp()
    expect(nibpAt(b, s, 1000 + NIBP_FIRST - 1, r).has).toBe(false)
    nibpAt(b, s, 1000 + NIBP_FIRST + 10, r)
    expect(r.has).toBe(true)
    expect(r.n).toBe(0)
    expect(r.at).toBe(1000 + NIBP_FIRST)
    const first = { ...r }
    // the reading holds until the next one is due
    expect(nibpAt(b, s, 1000 + NIBP_FIRST + 899, r)).toMatchObject({ n: 0, sys: first.sys, dia: first.dia })
    expect(nibpAt(b, s, 1000 + NIBP_FIRST + 900, r).n).toBe(1)
    expect(r.map).toBe(Math.round(r.dia + (r.sys - r.dia) / 3))
    // triage: one reading, whatever the time
    const tri = sit('triage', { since: 1000 })
    expect(nibpAt(b, tri, 1000 + 4 * 3600, r)).toMatchObject({ has: true, n: 0, at: 1000 + NIBP_FIRST })
  })

  it('is deterministic: the same patient, situation and time give the same numbers', () => {
    const b = baselineOf('same')
    const s = sit('er', { acuity: 2 })
    expect(vitalsAt(b, s, 5000, newVitals())).toEqual(vitalsAt(b, s, 5000, newVitals()))
    expect(wander(3, 1, 100, 60)).toBe(wander(3, 1, 100, 60))
    for (let t = 0; t < 1000; t += 7) {
      expect(Math.abs(wander(5, 2, t, 60))).toBeLessThanOrEqual(1)
    }
  })
})
