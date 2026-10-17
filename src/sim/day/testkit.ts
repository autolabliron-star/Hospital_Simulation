/**
 * Helpers shared by the day-rhythm tests (not a test file itself): doorway rectangles, stepping a simulation, and a few
 * readers. The same definition of "in a doorway" as the M3 gate.
 */
import { CONFIG } from '../config'
import { DOORS } from '../places'
import type { Person } from '../people'
import type { Simulation } from '../Simulation'

export const DT = CONFIG.sim.step

export interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** Every doorway as a small rectangle in the wall opening (exterior doors included). */
export const DOORWAYS: { id: string; r: Rect }[] = DOORS.filter((d) => d.kind !== 'opening').map((d) => {
  const half = d.width / 2
  const r =
    d.wallAxis === 'x'
      ? { x0: d.center.x - half, x1: d.center.x + half, z0: d.center.z - 0.35, z1: d.center.z + 0.35 }
      : { x0: d.center.x - 0.35, x1: d.center.x + 0.35, z0: d.center.z - half, z1: d.center.z + half }
  return { id: `door:${d.id}`, r }
})

export const inside = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1

/** Sim time of a clock hour. */
export const hourT = (h: number): number => (h - CONFIG.sim.startHour) * 3600

export function run(sim: Simulation, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) sim.step(DT)
}

export function personOf(sim: Simulation, id: string): Person | undefined {
  return sim.people.find((p) => p.entity.id === id)
}

export function logOf(sim: Simulation): string[] {
  return sim.log.events.map((e) => `${e.t.toFixed(2)} ${e.type} ${e.text}`)
}

/** Party visitors (they come to see a ward patient), not the ambient people sitting in the lobby, the café or the garden. */
export function partyVisitors(sim: Simulation): Person[] {
  return sim.people.filter((p) => p.entity.id.startsWith('vis-'))
}
