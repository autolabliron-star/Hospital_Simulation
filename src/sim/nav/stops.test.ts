/**
 * Stop-and-go (2026-10-26): people stop where a real person would (a desk, a seat, a queue, somebody in the way, a door to take turns at) and
 * not otherwise. Measured on the seeded hospital at 10:00 for five minutes with stopsMeter.testkit.ts (which also says what the categories mean).
 *
 * Before (commit 2a9d8c2): 0.54 unintended stops and slow-downs per walker-minute at 10:00 (0.37 at 07:30, 0.66 at 14:00), mostly a walker slowing
 * to a crawl at a corner while its heading swung round. After: corners are walked along the curve at the body's pace (follower.ts `onCurve`,
 * crowd.ts CORNER_R 0.9 m, pushers 0.6 m): 0.37 at 10:00 (0.29 at 07:30, 0.24 at 14:00). What is left is mostly pushers with a cart on a
 * busy corner. (An earlier "2.9 stops a minute" counted every frame the body's speed dipped, including glides onto seats and standing up.)
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { buildSimulation } from '../index'
import { measureStops } from './stopsMeter.testkit'

describe('stop-and-go on a seeded morning', () => {
  it('stops only where a person would: well under one unintended stop or slow-down per walker-minute', { timeout: 600_000 }, () => {
    const sim = buildSimulation(CONFIG.sim.worldSeed, 10, 0, 'showcase')
    const r = measureStops(sim, 300, CONFIG.sim.step)
    expect(r.walkingMinutes).toBeGreaterThan(30)
    expect(r.unintendedPerMinute).toBeLessThan(0.45)
    // nobody stops dead to swing round at a corner, or between two legs of one walk
    expect(r.stops.turn).toBe(0)
    expect(r.stops.corner).toBe(0)
    expect(r.stops.chain).toBeLessThanOrEqual(1)
  })
})
