/**
 * Who is on post right now: the live controller of every rostered ER and support staff member, by staff id, for one
 * World. `createErStaff` (population/staffing.ts) fills it when the hospital is built; the day rhythm keeps it in step
 * when people change shift. A registry, not an import between features: the shift code never needs the Simulation.
 */
import type { Person } from '../people'
import type { World } from '../er/world'

export type StaffRegistry = Map<string, Person>

const REGISTRIES = new WeakMap<World, StaffRegistry>()

/** The registry of a world (created empty on first use). */
export function staffRegistry(world: World): StaffRegistry {
  let r = REGISTRIES.get(world)
  if (r === undefined) {
    r = new Map()
    REGISTRIES.set(world, r)
  }
  return r
}
