/**
 * The monitors against a REAL hospital: a Simulation warm-started at 10:30 (the recovery Jump moment) and run on for a while. The hub reads the real
 * ER department and the real surgery state through the same source the browser uses, finds patients on monitors (the OR, recovery, the ER), fills
 * them, and shows numbers inside the vitals' ranges. Read-only: the sim's own day is unchanged by watching it.
 */
import { describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/Simulation'
import { hashString, mixSeed, Rng } from '@/sim/rng'
import { profileFor } from '@/sim/vitals/model'
import { MonitorHub, type HubEnv } from './hub'
import type { ErView } from './occupancy'
import { realDefs, recCtx, recUploader } from './testkit'
import { baselineFrom, RANGES } from './vitals'

function envFor(sim: Simulation): HubEnv {
  const rng = new Rng(mixSeed(sim.seed, hashString('patient-monitors')))
  return {
    occupancy: { surgery: () => sim.surgery.state, er: (): ErView => sim.world.er },
    baseline: (id, name, reason) => baselineFrom(sim.vitals.profileIfDrawn(id) ?? profileFor(id, name, reason ? { reason } : {}, rng), hashString(id)),
    simT: () => sim.t,
    generation: () => 0,
    walker: () => null,
    focus: () => null,
    nowMs: () => 0,
  }
}

describe('the monitors on a real hospital day', () => {
  it('at 10:30 they find patients in theatre, recovery or pre-op, and in the ER, and show plausible numbers', { timeout: 120_000 }, () => {
    const sim = new Simulation(20261012, { startHour: 10.5 })
    const hub = new MonitorHub(realDefs(), envFor(sim), { sheet: recCtx().ctx })
    const up = recUploader()
    hub.attach(up)
    hub.warm()
    const seen = new Set<string>()
    // half an hour of the day, the pump looking every 10 sim seconds (the display clock moving half a second each time)
    for (let s = 0; s < 180; s++) {
      for (let k = 0; k < 600; k++) sim.step(1 / 60)
      hub.clock.advance(0.1, false)
      hub.clock.advance(0.1, false)
      hub.pump(Infinity)
      for (const m of hub.monitors) {
        for (const r of m.rows) {
          if (!r.live) continue
          seen.add(m.def.context)
          const n = r.numbers
          expect(n.name, m.def.id).not.toBe('')
          expect(n.hr, m.def.id).toBeGreaterThanOrEqual(RANGES.hr[0] - 8)
          expect(n.hr, m.def.id).toBeLessThanOrEqual(RANGES.hr[1] + 8)
          expect(n.spo2).toBeGreaterThanOrEqual(RANGES.spo2[0])
          expect(n.spo2).toBeLessThanOrEqual(100)
        }
      }
    }
    expect(seen.has('er')).toBe(true)
    expect(seen.has('or') || seen.has('pacu') || seen.has('preop')).toBe(true)
    for (const c of up.copies) {
      expect(c.dx + c.w).toBeLessThanOrEqual(hub.plan.width)
      expect(c.dy + c.h).toBeLessThanOrEqual(hub.plan.height)
    }
  })
})
