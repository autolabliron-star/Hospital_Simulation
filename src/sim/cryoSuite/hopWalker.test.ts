/**
 * R5 wave 3, the re-check of the hop walker (hop.ts): what wrapping a person's crowd walker must not lose, and what a short hop must look for.
 *
 *   courtesy   the cryo team's walkers are `HopWalker`s, and the courtesy sidestep (src/sim/reactions.ts) is asked of the crowd walker a walker is or wraps:
 *              the four staff still step aside for you as every other person does
 *   bodies     a hop is taken only when nobody is in the way: not the team's own people only, but every body of the crowd (a visitor, the porter, the
 *              discs of a stretcher, you); the hopper's own discs are not in its way
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { CrowdWalker } from '../nav/crowd'
import type { Spot } from '../places'
import { Simulation } from '../Simulation'
import type { Vec2 } from '../types'
import { HopWalker, hopRoute } from './hop'
import { cryoSuite } from './testkit'

const spot = (x: number, z: number, heading = 0): Spot => ({ at: { x, z }, heading })

describe('the hop walker is still a crowd walker to the people who ask it to step aside', () => {
  it('says which crowd walker it wraps, and none for a solo walker', () => {
    const crowd = cryoSuite(7, { crowd: true, hour: 9 })
    const inner = crowd.walkerFor('wrapped')
    expect(inner).toBeInstanceOf(CrowdWalker)
    expect(new HopWalker(inner, () => false).crowdWalker).toBe(inner)
    const solo = cryoSuite(7, { crowd: false, hour: 9 }).walkerFor('solo')
    expect(solo).not.toBeInstanceOf(CrowdWalker)
    expect(new HopWalker(solo, () => false).crowdWalker).toBeNull()
  })

  it('steps aside for you: a walker wrapped in a hop walker is given the courtesy sidestep, as the unwrapped ones are', () => {
    // ward A's corridor at 16:00, as src/sim/reactions.test.ts: you stand on its centre line, and everybody's walker is wrapped (a hop walker that never hops
    // passes every call to the crowd walker); the first of them who makes way is the proof, and the seeds are tried in turn
    let sidestepped: string | null = null
    for (const seed of [3, 7, 11, 2026]) {
      const sim = new Simulation(seed, { startHour: 16 })
      for (const p of sim.people) if (p.walker instanceof CrowdWalker) p.walker = new HopWalker(p.walker, () => false)
      sim.addPlayer(spot(-4.7, -14, Math.PI / 2))
      sim.movePlayer(-4.7, -14, Math.PI / 2, 0)
      for (let i = 0; i < Math.ceil(600 / CONFIG.sim.step) && sidestepped === null; i++) {
        sim.step(CONFIG.sim.step)
        for (const p of sim.people) {
          const w = p.walker
          if (w instanceof HopWalker && w.crowdWalker !== null && w.crowdWalker.courtesy !== 0) {
            sidestepped = `${p.entity.id} (seed ${seed})`
            break
          }
        }
      }
      if (sidestepped !== null) break
    }
    expect(sidestepped, 'nobody who was wrapped ever stepped aside').not.toBeNull()
  }, 300_000)
})

describe('a hop looks for every body of the crowd', () => {
  const fake = cryoSuite(7, { crowd: true, hour: 9 })
  const at = (name: string, k = 0): Vec2 => fake.cryo.sites.anchor(name as never, k).at
  // the nurse's two places at the table's south side: a clear straight hop of 0.6 m
  const from = at('ctSideSouth', 0)
  const to = at('ctSideSouth', 1)
  const mid = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 }
  const hopper = fake.walkerFor('hopper') as CrowdWalker
  const hw = new HopWalker(hopper, () => false)
  hw.allow = true

  /** Does a hop from `from` to `to` begin (and is the walker back at its start, not hopping, for the next try)? */
  const hops = (): boolean => {
    hw.place(from.x, from.z, 0)
    hw.goTo(to)
    const hopping = hw.isHopping
    hw.place(from.x, from.z, 0)
    return hopping
  }

  it('the route is walkable, so only a body can stop the hop', () => {
    expect(hopRoute(from, to)).toHaveLength(2)
    expect(hops()).toBe(true)
  })

  it('a person of the crowd who is not on the team (a visitor, the player) beside the route stops it, and gone from beside it does not', () => {
    const body = fake.walkerFor('visitor')
    body.place(mid.x, mid.z + 0.3, 0)
    expect(hops()).toBe(false)
    expect(hopper.bodyNear(from.x, from.z, to.x, to.z, 0.05)).toBe(true)
    body.place(mid.x, mid.z + 0.9, 0)
    expect(hops()).toBe(true)
    expect(hopper.bodyNear(from.x, from.z, to.x, to.z, 0.05)).toBe(false)
    // (in the line itself, past either end: the route's ends are as much a part of it as its middle)
    body.place(to.x + 0.3, to.z, 0)
    expect(hops()).toBe(false)
    body.place(to.x + 0.9, to.z, 0)
    expect(hops()).toBe(true)
    body.remove()
    expect(hops()).toBe(true)
  })

  it('the discs of a pushed stretcher stop it, though the pusher stands well clear; the hopper\'s own discs do not', () => {
    const pusher = fake.walkerFor('porter') as CrowdWalker
    // (the pusher 1.6 m to the side of the route, facing it, with the stretcher out in front: its discs cross the route)
    pusher.place(mid.x, mid.z + 1.6, Math.PI)
    expect(hops()).toBe(true)
    pusher.setFootprint({ ahead: 0.7, halfWidth: 0.4, halfLength: 0.9 })
    expect(hops()).toBe(false)
    pusher.setFootprint(null)
    expect(hops()).toBe(true)
    pusher.remove()
    // the hopper carrying a stretcher itself is not stopped by it
    hopper.setFootprint({ ahead: 0.7, halfWidth: 0.4, halfLength: 0.9 })
    hopper.place(from.x, from.z, Math.PI / 2)
    expect(hops()).toBe(true)
    hopper.setFootprint(null)
  })

  it('a team member of the hop walker\'s own predicate still stops it', () => {
    const team = new HopWalker(fake.walkerFor('predicate') as CrowdWalker, () => true)
    team.allow = true
    team.place(from.x, from.z, 0)
    team.goTo(to)
    expect(team.isHopping).toBe(false)
  })

  it('a walker with no crowd (a solo walker) is stopped only by the team\'s predicate', () => {
    const solo = cryoSuite(7, { crowd: false, hour: 9 }).walkerFor('solo')
    const alone = new HopWalker(solo, () => false)
    alone.allow = true
    solo.place(from.x, from.z, 0)
    alone.goTo(to)
    expect(alone.isHopping).toBe(true)
  })
})
