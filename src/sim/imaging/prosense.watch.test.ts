/**
 * R5 wave 3: both ProSense procedures in "Watch step by step" mode over 30 seeds: every case runs to the end, every script step in order for exactly
 * its watch seconds, both people at their anchors, the patient carrying the view's pose while she lies on the couch, the radiologist leaving.
 */
import { describe, expect, it } from 'vitest'
import { expectCase, expectWatchLengths, runCase, type CaseTrace } from './prosense.testkit'

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)

describe.each(['us-cryo-breast', 'us-cryo-fibroadenoma'])('%s in watch mode', (protocol) => {
  const traces: CaseTrace[] = []
  it('runs to completion over 30 seeds, each step for its watch seconds', { timeout: 900_000 }, () => {
    for (const seed of SEEDS) {
      const c = runCase(seed, protocol, true)
      traces.push(c)
      expectCase(c)
      expectWatchLengths(c)
    }
    expect(traces).toHaveLength(30)
  })

  it('is deterministic: the same seed gives the same case, and every watch case of the fibroadenoma shows the probe move', { timeout: 300_000 }, () => {
    const a = runCase(5, protocol, true)
    const b = runCase(5, protocol, true)
    expect(a.name).toBe(b.name)
    expect(a.steps.map((s) => [s.id, s.at, s.ends])).toEqual(b.steps.map((s) => [s.id, s.at, s.ends]))
    expect(a.lines).toEqual(b.lines)
    expect(a.relocate).toBe(protocol === 'us-cryo-fibroadenoma')
    expect(a.steps.some((s) => s.id === 'relocate')).toBe(protocol === 'us-cryo-fibroadenoma')
  })
})
