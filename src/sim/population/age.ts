/**
 * Walking that fits the person (Wave 1): a pace factor by age from CONFIG.people.ageWalkFactor (piecewise linear between the
 * [age, factor] points; flat before the first and after the last). An 88-year-old walks at about 0.7 of a young adult's pace.
 * Pure and allocation-free; the people created by population code (visitors, outpatients, ER patients) multiply their cruise speed by it.
 */
import { CONFIG } from '../config'
import type { Rng } from '../rng'

/** Speed factor 0..1 for somebody of this age. */
export function ageWalkFactor(age: number): number {
  const t = CONFIG.people.ageWalkFactor
  const n = t.length
  if (n === 0) return 1
  if (age <= t[0][0]) return t[0][1]
  if (age >= t[n - 1][0]) return t[n - 1][1]
  for (let i = 1; i < n; i++) {
    const [a1, f1] = t[i]
    if (age <= a1) {
      const [a0, f0] = t[i - 1]
      return a1 === a0 ? f1 : f0 + ((f1 - f0) * (age - a0)) / (a1 - a0)
    }
  }
  return t[n - 1][1]
}

/** A seeded adult age for somebody the content gives none (a visitor): mostly 25-70, some older. Draw from a fork so no stream shifts. */
export function drawVisitorAge(rng: Rng): number {
  return Math.round(rng.clampedGaussian(52, 17, 20, 89))
}
