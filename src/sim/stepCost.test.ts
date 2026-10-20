/**
 * S1 step cost: the sim must stay cheap per 1/60 s step so 30× (30 steps/frame) fits the frame budget.
 * Plan target ~150 µs/step on an idle machine; the asserted bound is generous because other agents load the box.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { Simulation } from './Simulation'

const STEPS = 1200
const BOUND_US = 400

function usPerStep(sim: Simulation): number {
  // Warm the JIT with a short run, then time.
  for (let i = 0; i < 120; i++) sim.step(CONFIG.sim.step)
  const t0 = performance.now()
  for (let i = 0; i < STEPS; i++) sim.step(CONFIG.sim.step)
  return ((performance.now() - t0) * 1000) / STEPS
}

describe('sim step cost', () => {
  it('showcase opening at 07:30', () => {
    const sim = new Simulation(CONFIG.sim.worldSeed, { inFlight: true, opening: 'showcase' })
    sim.preRoll(50)
    const us = usPerStep(sim)
    console.log(`[stepCost] showcase 07:30: ${us.toFixed(1)} µs/step`)
    expect(us).toBeLessThan(BOUND_US)
  }, 30_000)

  it('showcase at a 10:30 start', () => {
    const sim = new Simulation(CONFIG.sim.worldSeed, { inFlight: true, opening: 'showcase', startHour: 10.5 })
    sim.preRoll(60)
    const us = usPerStep(sim)
    console.log(`[stepCost] showcase 10:30: ${us.toFixed(1)} µs/step`)
    expect(us).toBeLessThan(BOUND_US)
  }, 30_000)
})
