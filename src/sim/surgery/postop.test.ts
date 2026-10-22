/**
 * Wave 1: post-op patients never walk out at full speed. Day cases leave the lounge in a wheelchair pushed by their family (the companion),
 * ride lift A down with it, and are wheeled to the entrance; the short walk from recovery to the lounge is at about half pace.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { timeAtHour } from '../population/schedule'
import { suite } from './testkit'

describe('post-op patients leave by wheelchair', () => {
  it('pushes every day case out in a wheelchair, never walking at full speed, and ends with nobody left', { timeout: 120_000 }, () => {
    let wheeled = 0
    let day = 0
    for (const seed of [11, 12, 13]) {
      const h = suite(seed)
      const s = h.surgery!
      const seen = new Set<string>()
      const end = timeAtHour(19.5)
      while (h.t < end) {
        h.step(0.1)
        for (const p of h.people) {
          const e = p.entity
          if (!e.id.endsWith('-patient')) continue
          // after the operation (recovery bed or later) a patient on foot is never faster than the slow post-op pace
          if (e.stage === 'pacu' || e.stage === 'phase2' || e.stage === 'leaving') {
            expect(e.speed, `${e.id} at ${h.t.toFixed(0)}s`).toBeLessThanOrEqual(CONFIG.er.walkSpeed * 0.6)
          }
          if (e.vehicle === 'wheelchair' && e.riding) seen.add(e.id)
        }
      }
      wheeled += seen.size
      day += s.plan.filter((c) => c.outcome === 'home').length
      expect(s.stuckLog, `seed ${seed}`).toEqual([])
      expect(h.people.length, `seed ${seed}`).toBe(0)
    }
    expect(day).toBeGreaterThan(0)
    expect(wheeled).toBe(day)
  })
})
