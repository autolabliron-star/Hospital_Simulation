import { describe, expect, it } from 'vitest'
import { Rng } from '@/sim/rng'
import { profileFor, readingAt } from '@/sim/vitals/model'
import { ER_VITALS, ErVitalsSchema, erVitalsShiftFor } from './erVitals'
import erVitalsJson from './erVitals.json'
import { AMBULANCE_REASONS, ER_REASONS } from './roster'

const ALL = [...ER_REASONS, ...AMBULANCE_REASONS].map((r) => r.text)
const AGES = [25, 50, 78]
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

/** Mean of a profile field over many seeded people of one reason (the same ids with and without the reason, so only the shift differs). */
function meanDelta(reason: string, field: 'sys' | 'dia' | 'pulse' | 'spo2' | 'tempC', age: number): number {
  const d: number[] = []
  for (let i = 0; i < 60; i++) {
    const id = `er-${i}`
    const base = profileFor(id, 'Test Person', { age }, new Rng(9))
    const sick = profileFor(id, 'Test Person', { age, reason }, new Rng(9))
    d.push(sick[field] - base[field])
  }
  return mean(d)
}

describe('erVitals.json (F-24)', () => {
  it('parses, and every ER and ambulance reason has an entry', () => {
    expect(ErVitalsSchema.safeParse(erVitalsJson).success).toBe(true)
    for (const reason of ALL) expect(reason in ER_VITALS, reason).toBe(true)
    expect(erVitalsShiftFor('Not a reason')).toBeNull()
  })

  it('rejects an unknown field and a SpO2 that goes up', () => {
    expect(ErVitalsSchema.safeParse({ shifts: { x: { heartRate: 5 } } }).success).toBe(false)
    expect(ErVitalsSchema.safeParse({ shifts: { x: { spo2: 3 } } }).success).toBe(false)
  })

  it('breathlessness and asthma lower SpO2 and raise the pulse', () => {
    for (const reason of ['Severe difficulty breathing', 'Breathless and struggling to speak', 'Asthma getting worse, wheezing']) {
      for (const age of AGES) {
        expect(meanDelta(reason, 'spo2', age), `${reason} ${age}`).toBeLessThan(-2)
        expect(meanDelta(reason, 'pulse', age), `${reason} ${age}`).toBeGreaterThan(10)
      }
    }
  })

  it('a fever raises the temperature', () => {
    for (const reason of ['High fever since yesterday', 'Cough and fever for a week']) {
      for (const age of AGES) expect(meanDelta(reason, 'tempC', age), reason).toBeGreaterThan(0.8)
    }
  })

  it('a collapse and an allergic reaction lower the blood pressure and raise the pulse; a stroke raises the pressure', () => {
    for (const reason of ['Collapsed, not fully conscious', 'Collapsed at home, slow to respond', 'Allergic reaction, face swollen']) {
      expect(meanDelta(reason, 'sys', 50), reason).toBeLessThan(-8)
      expect(meanDelta(reason, 'pulse', 50), reason).toBeGreaterThan(10)
    }
    expect(meanDelta('Sudden weakness down one side', 'sys', 50)).toBeGreaterThan(15)
  })

  it('a chest pain, a fit and a confusion do not leave the vitals at baseline', () => {
    expect(meanDelta('Chest pain at rest, sweating', 'pulse', 50)).toBeGreaterThan(5)
    expect(meanDelta('Fit that has now stopped', 'pulse', 50)).toBeGreaterThan(5)
    expect(meanDelta('Confused and very drowsy today', 'spo2', 50)).toBeLessThan(0)
  })

  it('SpO2 is never above 100, in the profile or in any device reading, for every reason, age and seed', () => {
    for (const reason of ALL) {
      for (const age of AGES) {
        for (let i = 0; i < 25; i++) {
          const rng = new Rng(100 + i)
          const p = profileFor(`x-${i}`, 'Test Person', { age, reason }, rng)
          expect(p.spo2, reason).toBeLessThanOrEqual(100)
          for (const source of ['triage', 'kiosk'] as const) {
            const rd = readingAt(p, source, new Rng(200 + i))
            expect(rd.spo2!, `${reason} ${source}`).toBeLessThanOrEqual(100)
            expect(rd.spo2!, `${reason} ${source}`).toBeGreaterThanOrEqual(80)
          }
        }
      }
    }
  })

  it('a triage reading of a very sick patient is not normal-looking: breathless, SpO2 clearly below 94 on average', () => {
    const spo2: number[] = []
    for (let i = 0; i < 40; i++) {
      const p = profileFor(`b-${i}`, 'Test Person', { age: 60, reason: 'Breathless and struggling to speak' }, new Rng(i))
      spo2.push(readingAt(p, 'triage', new Rng(i + 1)).spo2!)
    }
    expect(mean(spo2)).toBeLessThan(92)
  })
})
