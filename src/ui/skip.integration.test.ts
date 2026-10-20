/**
 * S1 Skip against the running hospital (src/sim advanceBy / skipRebuild): a short skip runs the same hospital forward (the
 * same people, nothing rebuilt), a long one is a forward Jump that lands on the target time, and the surgery case under way
 * is still the same case (id, name, procedure) on the other side, a milestone further on.
 */
import { describe, expect, it } from 'vitest'
import { advanceBy, loop, sim, simGeneration, skipRebuild } from '@/sim'
import { CONFIG } from '@/sim/config'

describe('skip ahead', () => {
  it('a short skip runs the same hospital forward', () => {
    const before = sim
    const gen = simGeneration
    const ids = [...sim.entities.keys()].filter((id) => id.startsWith('doc-') || id.startsWith('nurse-'))
    const t0 = sim.t
    advanceBy(120)
    expect(sim).toBe(before)
    expect(simGeneration).toBe(gen)
    expect(sim.t).toBeCloseTo(t0 + 120, 3)
    for (const id of ids) expect(sim.entities.has(id), id).toBe(true)
    expect(loop.sim).toBe(sim)
  }, 60000)

  it('a long skip lands on the target time, with the same case at the console further on', () => {
    const theatre = () => sim.surgery.state.theatre
    const caseNow = theatre().cases.find((c) => c.id === theatre().caseId)
    expect(caseNow, 'a case is in the room at the opening').toBeTruthy()
    const gen = simGeneration
    const target = sim.t + 40 * 60
    skipRebuild(target)
    expect(simGeneration).toBe(gen + 1)
    expect(Math.abs(sim.t - target)).toBeLessThanOrEqual(1)
    const same = theatre().cases.find((c) => c.id === caseNow!.id)!
    expect(same.name).toBe(caseNow!.name)
    expect(same.procedure).toBe(caseNow!.procedure)
    expect(sim.opening).toBe('showcase')
  }, 120000)

  it('never skips past the end of the day', () => {
    skipRebuild((CONFIG.day.endHour - CONFIG.sim.startHour) * 3600 + 7200)
    expect(sim.t).toBeLessThanOrEqual((CONFIG.day.endHour - CONFIG.sim.startHour) * 3600 + 1)
  }, 120000)
})
