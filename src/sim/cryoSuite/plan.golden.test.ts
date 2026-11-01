/**
 * R5 guard: a kidney case's seeded plan stays byte-identical while lung and liver targets land (docs/R5-PROCEDURES.md). New draws (the
 * target, the freeze protocol) go on new forks, and `needlePaths` keeps its draw order, so these hashes, taken before R5, must never move
 * for a kidney case. The day list itself changes by design once it draws lung and liver cases: its golden holds for a kidney-only day.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Rng } from '../rng'
import { planCase, planCryoDay } from './plan'

const sha = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex')

/** sha1 of JSON.stringify(planCase(new Rng(seed), 'g', 0, 36000, false)) before R5 (a live kidney case). */
const KIDNEY_CASE: Record<number, string> = {
  1: '37ac345bcb842aa87a908358c87cd244e0d3f8be',
  7: 'ef8704c85d9d9c78cded19617126c0a14ebeef8b',
  42: '4a2269ad0eda2d42978f95f32c02e216047e6148',
  1000: '28f772c65c4957b3edc7b12bdc47730f05fa0475',
  5101: 'deb6aa6079acb8e75cd0ac8484dfbfed1149f995',
  9999: '41b8a0c39f77dcf828870b02157a1fc65cc233e3',
  31337: '5efdd1abaac1068cad7c50c809ee18579814ab26',
  123456: '9d88e1347cedad81087256e78636964ce8e6ecab',
}

/** sha1 of JSON.stringify(planCryoDay(new Rng(seed))) before R5 (every case a kidney). */
const KIDNEY_DAY: Record<number, string> = {
  1: 'dcec96d8ff2f7bab48ae1dcec5e0256f6f9f2acd',
  7: 'e6775b0ba034b5298382b3a7adfa98baad3c3081',
  42: '51817be1f140ae16912124c739669de0b337a378',
  1000: '34705748bb48ed64d4458395f9cd8c9e968e05e9',
  5101: '64042ec9b259e7a0fb6c61cc32ef70b635cdbb46',
  9999: 'ac1c362cb02db672c1f65a9531d1e6c923d893c0',
  31337: '55c2cdd62bb7f36f9c6464d6192ced025efcac5b',
  123456: '66be396a984182498c354bfcf55f114ad4ae5324',
}

describe('cryo plan golden (R5)', () => {
  it('a live kidney case is byte-identical to before R5', () => {
    for (const [seed, hash] of Object.entries(KIDNEY_CASE)) {
      expect(sha(planCase(new Rng(Number(seed)), 'g', 0, 36000, false)), `seed ${seed}`).toBe(hash)
    }
  })

  it('a kidney-only day is byte-identical to before R5', () => {
    for (const [seed, hash] of Object.entries(KIDNEY_DAY)) {
      expect(sha(planCryoDay(new Rng(Number(seed)))), `seed ${seed}`).toBe(hash)
    }
  })
})
