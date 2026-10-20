/**
 * The sweep: the three quads of a band tile it exactly at every cursor position, the label slot is never read past its end, the two sweep slots
 * alternate, and a column's display time follows the cursor (what the painter paints is what the screen will show there).
 */
import { describe, expect, it } from 'vitest'
import { GAP, LAYOUTS, SWEEP } from './layouts'
import { bandQuads, columnTime, entryOf, Q, sweepAt } from './sweep'

describe('the sweep quads', () => {
  it('tile each band exactly, in order, at every cursor position, for every layout', () => {
    const q = new Float32Array(9)
    for (const layout of Object.values(LAYOUTS)) {
      for (const b of layout.bands) {
        for (let c = -3; c <= b.w + 3; c += 0.37) {
          bandQuads(c, b.w, GAP, layout.labelW, q)
          expect(q[Q.newX0]).toBe(0)
          expect(q[Q.newX1]).toBeCloseTo(q[Q.gapX0], 6)
          expect(q[Q.gapX1]).toBeCloseTo(q[Q.oldX0], 6)
          expect(q[Q.oldX1]).toBe(b.w)
          for (const [a, z] of [
            [Q.newX0, Q.newX1],
            [Q.gapX0, Q.gapX1],
            [Q.oldX0, Q.oldX1],
          ]) {
            expect(q[z]).toBeGreaterThanOrEqual(q[a] - 1e-6)
            expect(q[a]).toBeGreaterThanOrEqual(-1e-6)
            expect(q[z]).toBeLessThanOrEqual(b.w + 1e-6)
          }
          // the gap is the erase bar, GAP wide until it reaches the band's end
          expect(q[Q.gapX1] - q[Q.gapX0]).toBeCloseTo(Math.min(GAP, b.w - Math.min(Math.max(c, 0), b.w)), 3)
          // the new quad shows its slot from column 0, the old one from the same column it is drawn at (the slots line up with the band)
          expect(q[Q.newU0]).toBe(0)
          expect(q[Q.oldU0]).toBeCloseTo(q[Q.oldX0], 6)
          // the label slot (labelW + GAP wide) is never read past its end
          expect(q[Q.gapU0] + (q[Q.gapX1] - q[Q.gapX0])).toBeLessThanOrEqual(layout.labelW + GAP + 1e-5)
          // over the label, the gap reads the label at the same column, so the label never flickers
          if (c >= 0 && c < layout.labelW) expect(q[Q.gapU0]).toBeCloseTo(c, 3)
        }
      }
    }
  })

  it('cross a band in one period and alternate the two slots, negative sweeps included', () => {
    const at = { k: 0, c: 0 }
    sweepAt(0, 0, SWEEP.fast, 256, at)
    expect(at).toEqual({ k: 0, c: 0 })
    sweepAt(SWEEP.fast * 0.5, 0, SWEEP.fast, 256, at)
    expect(at.c).toBeCloseTo(128, 6)
    sweepAt(SWEEP.fast * 2.25, 1, SWEEP.fast, 256, at)
    expect(at.k).toBe(2)
    expect(entryOf(0)).toBe(0)
    expect(entryOf(1)).toBe(1)
    expect(entryOf(2)).toBe(0)
    expect(entryOf(-1)).toBe(1)
    expect(entryOf(-2)).toBe(0)
    for (let k = -5; k < 5; k++) expect(entryOf(k)).not.toBe(entryOf(k + 1))
  })

  it('a slot column is painted with the display time at which the cursor reaches it', () => {
    const at = { k: 0, c: 0 }
    const phase = 3.7
    for (const t of [0.4, 10.2, 99.9, 1234.5]) {
      sweepAt(t, phase, SWEEP.slow, 224, at)
      expect(columnTime(at.k, at.c, phase, SWEEP.slow, 224)).toBeCloseTo(t, 6)
      // column 0 of the sweep is when it started, its last column one period later
      expect(columnTime(at.k, 224, phase, SWEEP.slow, 224) - columnTime(at.k, 0, phase, SWEEP.slow, 224)).toBeCloseTo(SWEEP.slow, 9)
    }
  })
})
