/**
 * R3 live patient monitors: the sweep, as pure arithmetic. A band's trace is drawn left to right by a cursor that crosses the band in one period
 * (layouts.ts SWEEP) and wraps; sweep k covers display times [k T - phase, (k + 1) T - phase]. Nothing is uploaded per frame: each band is THREE quads
 * whose positions and UVs move with the cursor over prepainted slots in the atlas:
 *
 *   new   [0, c)          slot k (entry k & 1): the trace drawn so far this sweep
 *   gap   [c, c + GAP)    the label slot: blank, with the band's label where the label is, so the erase bar never wipes the label
 *   old   [c + GAP, w)    slot k - 1 (the other entry): last sweep's trace, about to be erased
 *
 * The three always tile the band exactly (the tests check every cursor position). Allocation-free.
 */
export interface SweepAt {
  /** Sweep number (may be negative near t = 0) and the cursor (face pixels from the band's left edge, 0..w). */
  k: number
  c: number
}

export function sweepAt(t: number, phase: number, period: number, w: number, out: SweepAt): SweepAt {
  const s = (t + phase) / period
  const k = Math.floor(s)
  out.k = k
  out.c = (s - k) * w
  return out
}

/** The display time of column `x` of sweep `k`'s slot. */
export function columnTime(k: number, x: number, phase: number, period: number, w: number): number {
  return (k + x / w) * period - phase
}

/** Which of the band's two sweep slots holds sweep `k` (0 or 1; negative sweeps alternate the same way). */
export function entryOf(k: number): 0 | 1 {
  return (k & 1) as 0 | 1
}

/** Offsets of the quads in `bandQuads`' output: per quad its left and right edge (face px from the band's left) and the u of its left edge in its slot. */
export const Q = { newX0: 0, newX1: 1, newU0: 2, gapX0: 3, gapX1: 4, gapU0: 5, oldX0: 6, oldX1: 7, oldU0: 8 } as const

/**
 * The three quads of a band `w` wide at cursor `c`, written into `out` (9 numbers, see `Q`). The gap's u runs in the label slot (`labelW + gap` wide):
 * over the label while the bar crosses it, then over the blank strip after it.
 */
export function bandQuads(c: number, w: number, gap: number, labelW: number, out: Float32Array): Float32Array {
  const cc = c < 0 ? 0 : c > w ? w : c
  const g1 = cc + gap < w ? cc + gap : w
  out[Q.newX0] = 0
  out[Q.newX1] = cc
  out[Q.newU0] = 0
  out[Q.gapX0] = cc
  out[Q.gapX1] = g1
  out[Q.gapU0] = cc < labelW ? cc : labelW
  out[Q.oldX0] = g1
  out[Q.oldX1] = w
  out[Q.oldU0] = g1
  return out
}
