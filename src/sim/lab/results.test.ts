import { describe, expect, it } from 'vitest'
import { LAB_CATALOGUE, testById } from '@/content/lab'
import { constantValue, resultValues, roundTo, seededValue } from './results'

describe('seeded result values', () => {
  it('are a pure function of (seed, patient, test, analyte): the same inputs give the same numbers, other inputs give other numbers', () => {
    const a = resultValues(seededValue, 42, 'p1', 'op-annual', 'cbc')
    expect(resultValues(seededValue, 42, 'p1', 'op-annual', 'cbc')).toEqual(a)
    expect(resultValues(seededValue, 43, 'p1', 'op-annual', 'cbc')).not.toEqual(a)
    expect(resultValues(seededValue, 42, 'p2', 'op-annual', 'cbc')).not.toEqual(a)
    expect(a.map((v) => v.analyte)).toEqual(testById('cbc').analytes.map((x) => x.id))
  })

  it('are never negative, are rounded to the analyte\'s decimals, and follow N(mean, sd)', () => {
    for (const [id, test] of Object.entries(LAB_CATALOGUE.tests)) {
      const sums = new Map<string, number[]>()
      for (let p = 0; p < 600; p++)
        for (const v of resultValues(seededValue, 9, `pat${p}`, 'ward-routine', id)) {
          const a = test.analytes.find((x) => x.id === v.analyte)!
          expect(v.value).toBeGreaterThanOrEqual(0)
          expect(roundTo(v.value, a.decimals)).toBe(v.value)
          ;(sums.get(v.analyte) ?? sums.set(v.analyte, []).get(v.analyte)!).push(v.value)
        }
      for (const a of test.analytes) {
        const xs = sums.get(a.id)!
        const mean = xs.reduce((s, x) => s + x, 0) / xs.length
        // 600 draws: the mean is within 0.2 sd of the content's (clamping at 0 lifts the skewed ones, like CRP, a little)
        const clampedLow = a.mean - 2 * a.sd < 0 ? 0.15 * a.sd : 0
        expect(Math.abs(mean - a.mean), `${id}.${a.id}`).toBeLessThan(a.sd * 0.2 + clampedLow)
      }
    }
  })

  it('shift with the order panel (display only), and a constant generator returns the content mean', () => {
    const avg = (panel: string, analyte: string, test: string) => {
      let s = 0
      for (let p = 0; p < 400; p++) s += resultValues(seededValue, 3, `x${p}`, panel, test).find((v) => v.analyte === analyte)!.value
      return s / 400
    }
    // er-fever shifts CRP by +30 and white cells by +4
    expect(avg('er-fever', 'crp', 'crp') - avg('er-urine', 'crp', 'crp')).toBeGreaterThan(30 - 15 - 3)
    expect(avg('er-fever', 'crp', 'crp') - avg('er-faint', 'crp', 'crp')).toBeGreaterThan(30 - 1.5)
    expect(avg('er-fever', 'crp', 'crp') - avg('er-faint', 'crp', 'crp')).toBeLessThan(30 + 1.5)
    expect(avg('er-fever', 'wbc', 'cbc') - avg('er-faint', 'wbc', 'cbc')).toBeGreaterThan(4 - 0.4)
    expect(avg('er-fever', 'wbc', 'cbc') - avg('er-faint', 'wbc', 'cbc')).toBeLessThan(4 + 0.4)
    const c = resultValues(constantValue, 1, 'p', 'op-annual', 'cbc')
    expect(c).toEqual(testById('cbc').analytes.map((a) => ({ analyte: a.id, value: roundTo(a.mean, a.decimals) })))
  })
})
