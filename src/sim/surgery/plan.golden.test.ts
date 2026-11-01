/**
 * R5 guard: the seeded day plans stay byte-identical while the step-by-step procedures land (docs/R5-PROCEDURES.md). The procedure scripts
 * only ever draw on new forks and never touch `surgery.json` instruments or exchanges (`drawExchanges` reads them), so these hashes, taken
 * before R5, must never move. If one does, a new draw went into an existing stream: put it on a fork instead.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Rng } from '../rng'
import { planDay } from './plan'

const sha = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex')

/** sha1 of JSON.stringify(planDay(new Rng(seed), opening)) before R5. */
const BEFORE_R5: Record<'quiet' | 'showcase', Record<number, string>> = {
  quiet: {
    1: 'e519c930657e7056ab1b555c84035adad8eeff8a',
    7: 'e1f3b2fa08c3e338aec1a9261f3425915a5e6f4c',
    42: '5b105ceac8a4d3aa31bef32c4536411ec7acfba7',
    1000: '5d4b78b7f94a43b1951bf5b4e5e9bd5d3dbceea0',
    5101: 'd9dfa371c8ff1d237609813d2cc077112d2297a5',
    9999: 'ac35ae61499246f9af2a908907ef583627082960',
    31337: '378dddf286ab640f97e10416b5d9c308d31ae4f7',
    123456: 'bae869d3486ae5088db3616a8050b5e939163a5f',
  },
  showcase: {
    1: '7ff441b8910e6502df144ff94a25c586feaf3a15',
    7: '7e13612fb68c109d6765288e85350a824cd297c2',
    42: '3cb807ed422ad639d443eb1c12850abb1ad07ebc',
    1000: 'a20cc37bc4126ed7089ef3f395d90a239514617d',
    5101: 'f14addd9e1dfe522c42e9d3c8eb64954af2dc3fe',
    9999: 'c5f54267770aed6741e7cbd5a2393d98df8b5e97',
    31337: 'c9fde015ea9475177950aa64e9be3231ea945c49',
    123456: '904a315bf201f3cf3c16ea005f6299b631b89048',
  },
}

describe('planDay golden (R5)', () => {
  for (const opening of ['quiet', 'showcase'] as const) {
    it(`${opening}: byte-identical to the plan before R5`, () => {
      for (const [seed, hash] of Object.entries(BEFORE_R5[opening])) {
        expect(sha(planDay(new Rng(Number(seed)), opening)), `seed ${seed}`).toBe(hash)
      }
    })
  }
})
