/**
 * WP-4 (F-22, F-26) in the running hospital: the morning's ward-round additions are only the safe symptomatic list, and the ER nurse's
 * "observations and a cannula" line keeps the cannula for patients who need one (bloods, a scan, or priority 1-3).
 */
import { describe, expect, it } from 'vitest'
import { ROUND_ADDS } from '@/content/roundAdds'
import { Simulation } from './Simulation'
import { CONFIG } from './config'
import { timeOfClockHour } from './day/roster'

const DT = CONFIG.sim.step
const SEEDS = [2026, 11]

describe('a morning in the hospital (F-22, F-26)', () => {
  it('adds only safe medicines on the round, and gives a cannula only to those who need one', () => {
    let roundAdds = 0
    let cannulas = 0
    let noCannula = 0
    for (const seed of SEEDS) {
      const sim = new Simulation(seed)
      const until = timeOfClockHour(11.2)
      let last = 0
      while (sim.t < until) {
        for (let k = 0; k < 60; k++) sim.step(DT)
        for (const e of sim.log.since(last)) {
          last = e.id
          if (e.type !== 'testsOrdered' || !e.subjectId || !/is taking observations/.test(e.text)) continue
          const p = sim.world.patients.get(e.subjectId)
          if (!p) continue
          const wants = p.needsBloods || p.needsImaging || p.c.acuity <= 3
          const has = /cannula/.test(e.text)
          expect(has, `${e.text} (priority ${p.c.acuity}, ${p.c.reason})`).toBe(wants)
          if (has) cannulas++
          else noCannula++
        }
      }
      for (const o of sim.meds.orders.values()) {
        if (o.source !== 'sim') continue
        roundAdds++
        for (const item of o.items) expect(ROUND_ADDS, `${seed}: ${item.medId}`).toContain(item.medId)
      }
    }
    expect(roundAdds).toBeGreaterThan(0)
    expect(cannulas + noCannula).toBeGreaterThan(0)
  }, 600_000)
})
