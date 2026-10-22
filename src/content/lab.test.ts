/**
 * The lab catalogue (content/lab.json via content/lab.ts): the clinical sanity of the numbers (F-34) and the file-named error on bad content.
 */
import { describe, expect, it } from 'vitest'
import raw from './lab.json'
import { LAB_CATALOGUE } from './lab'

/** A deep copy of the real file, to break one field at a time. */
const copy = () => structuredClone(raw) as unknown as {
  tests: Record<string, { analytes: { id: string; low: number; high: number; mean: number; sd: number }[] }>
  vitalsBaselines: { spo2: [number, number]; sys: [number, number]; dia: [number, number] }[]
}

/** Re-parse a broken copy the way the loader does, through the exported catalogue's own schema (a fresh import with the bad data). */
async function loadWith(mutate: (d: ReturnType<typeof copy>) => void): Promise<unknown> {
  const { vi } = await import('vitest')
  const bad = copy()
  mutate(bad)
  vi.resetModules()
  vi.doMock('./lab.json', () => ({ default: bad }))
  try {
    return await import('./lab')
  } finally {
    vi.doUnmock('./lab.json')
    vi.resetModules()
  }
}

describe('lab.json sanity', () => {
  it('every analyte has low < mean < high and an sd that fits its range', () => {
    for (const [testId, t] of Object.entries(LAB_CATALOGUE.tests)) {
      for (const a of t.analytes) {
        expect(a.low, `${testId} ${a.id}`).toBeLessThan(a.high)
        expect(a.mean, `${testId} ${a.id}`).toBeGreaterThan(a.low)
        expect(a.mean, `${testId} ${a.id}`).toBeLessThan(a.high)
        expect(a.sd * 2, `${testId} ${a.id}`).toBeLessThanOrEqual(a.high - a.low)
      }
    }
  })

  it('the vitals baselines are possible: SpO2 at most 100, diastolic below systolic, sorted by age', () => {
    const list = LAB_CATALOGUE.vitalsBaselines
    list.forEach((b, i) => {
      expect(b.spo2[0], `baseline ${i}`).toBeLessThanOrEqual(100)
      expect(b.spo2[0] + 2 * b.spo2[1], `baseline ${i}`).toBeLessThanOrEqual(101)
      expect(b.dia[0], `baseline ${i}`).toBeLessThan(b.sys[0])
      if (i > 0) expect(b.maxAge, `baseline ${i}`).toBeGreaterThan(list[i - 1].maxAge)
    })
  })

  it('bad content throws with the file named, and a clinical nonsense value is rejected', async () => {
    await expect(loadWith((d) => (d.tests.cbc.analytes[0].mean = 99))).rejects.toThrow(/src\/content\/lab\.json is invalid/)
    await expect(loadWith((d) => (d.tests.cbc.analytes[1].low = 200))).rejects.toThrow(/low 200 must be below high/)
    await expect(loadWith((d) => (d.vitalsBaselines[0].spo2 = [101, 1]))).rejects.toThrow(/SpO2 101 is above 100/)
    await expect(loadWith((d) => delete (d as { tests?: unknown }).tests)).rejects.toThrow(/src\/content\/lab\.json is invalid/)
  })
})
