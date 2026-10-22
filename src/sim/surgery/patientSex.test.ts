/**
 * F-21: the patient's name (and so the avatar's sex, which follows the first name) agrees with the procedure: a robotic hysterectomy is a woman,
 * a prostatectomy a man. Checked over 20 seeds and both openings, and the draw stays deterministic.
 */
import { describe, expect, it } from 'vitest'
import { presentationOf } from '@/content/roster'
import { suite } from './testkit'

const SEEDS = Array.from({ length: 20 }, (_, i) => 700 + i * 37)

function names(seed: number, opening: 'quiet' | 'showcase'): { procedure: string; name: string }[] {
  const h = suite(seed, { opening })
  return h.surgery!.cases.map((c) => ({ procedure: c.procedure, name: c.name }))
}

describe('a patient matches the procedure (F-21)', () => {
  for (const opening of ['quiet', 'showcase'] as const) {
    it(`every hysterectomy is a woman and every prostatectomy a man over 20 seeds (${opening} opening)`, () => {
      const seen = { hysterectomy: 0, prostatectomy: 0 }
      for (const seed of SEEDS) {
        for (const c of names(seed, opening)) {
          if (c.procedure === 'hysterectomy') {
            seen.hysterectomy++
            expect(presentationOf(c.name), `${seed} ${c.name}`).toBe('female')
          }
          if (c.procedure === 'prostatectomy') {
            seen.prostatectomy++
            expect(presentationOf(c.name), `${seed} ${c.name}`).toBe('male')
          }
        }
      }
      // the lists really contain both (the test is not vacuous)
      expect(seen.hysterectomy).toBeGreaterThan(0)
      expect(seen.prostatectomy).toBeGreaterThan(0)
    })
  }

  it('the day list has no repeated patient name', () => {
    for (const seed of SEEDS) {
      const list = names(seed, 'quiet').map((c) => c.name)
      expect(new Set(list).size, `${seed}`).toBe(list.length)
    }
  })

  it('the same seed gives the same names', () => {
    for (const seed of SEEDS.slice(0, 5)) expect(names(seed, 'quiet')).toEqual(names(seed, 'quiet'))
  })
})
