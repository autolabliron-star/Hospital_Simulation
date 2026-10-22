/** F-19: a person who leaves while another one updates (a shift swap) must not make the next person skip their step. */
import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { Simulation } from './Simulation'

describe('the people loop of a step', () => {
  it('updates everybody once, also the one after somebody who removes themselves, and never a person removed earlier in the step', () => {
    const sim = new Simulation(3, { startHour: 10, inFlight: false })
    const [a, b, c, d] = [sim.people[4], sim.people[5], sim.people[7], sim.people[8]]
    const counts = new Map<unknown, number>()
    for (const p of [a, b, c, d]) {
      const orig = p.update.bind(p)
      counts.set(p, 0)
      p.update = (dt, ctx) => {
        counts.set(p, counts.get(p)! + 1)
        orig(dt, ctx)
        if (p === a) {
          sim.removePerson(a) // leaves in the middle of the loop
          sim.removePerson(c) // and takes somebody further down with them
        }
      }
    }
    sim.step(CONFIG.sim.step)
    expect(counts.get(a)).toBe(1)
    expect(counts.get(b), 'the person right after the one who left').toBe(1)
    expect(counts.get(c), 'removed earlier in this step').toBe(0)
    expect(counts.get(d)).toBe(1)
    expect(sim.people).not.toContain(a)
    expect(sim.people).not.toContain(c)
    expect(sim.entities.get(a.entity.id)).toBeUndefined()
  })
})
