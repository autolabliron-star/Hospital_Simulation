/**
 * W4 lab: the seeded values of a result (agent L). Every number is synthetic and for display: nothing in the lab ever branches on a value
 * (no clinical decisions), so a generator that returns a constant leaves every event type and time unchanged.
 *
 * A value is N(mean, sd) from the content, drawn from a stream seeded by (lab seed, patient, test, analyte), plus the order panel's shift
 * (content `panelShifts`), clamped at 0 and rounded to the analyte's decimals.
 */
import { LAB_CATALOGUE, testById, type Analyte } from '@/content/lab'
import { gaussian, hashString, mixSeed, mulberry32 } from '../rng'
import type { LabValue } from '../types'

/** The raw draw for one analyte, before the panel's shift, the clamp and the rounding. */
export type ValueGenerator = (seed: number, patientId: string, testId: string, analyte: Analyte) => number

export const seededValue: ValueGenerator = (seed, patientId, testId, analyte) => {
  const r = mulberry32(mixSeed(seed, hashString(`${patientId}|${testId}|${analyte.id}`)))
  return gaussian(r, analyte.mean, analyte.sd)
}

/** A generator that returns the analyte's mean every time (used to prove that values never change the flow). */
export const constantValue: ValueGenerator = (_seed, _patientId, _testId, analyte) => analyte.mean

export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

/** The analyte values of one test for one order's patient. */
export function resultValues(gen: ValueGenerator, seed: number, patientId: string, panel: string, testId: string): LabValue[] {
  const shifts = LAB_CATALOGUE.panelShifts[panel]
  return testById(testId).analytes.map((a) => {
    const raw = gen(seed, patientId, testId, a) + (shifts?.[a.id] ?? 0)
    return { analyte: a.id, value: roundTo(Math.max(0, raw), a.decimals) }
  })
}
