/**
 * Helpers for the bed-flow node tests: a Simulation wired the way the orchestrator wires it (the Director asks the bed flow who
 * lies in a room), a runner that samples invariants every half second, and an event recorder (the log keeps only the last 2000).
 */
import { CONFIG } from '../config'
import type { SimEvent } from '../types'
import { Simulation } from '../Simulation'

export const DT = CONFIG.sim.step
/** Invariants are sampled every half second of sim time. */
export const SAMPLE_EVERY = 30

export function hourToT(h: number): number {
  return (h - CONFIG.sim.startHour) * 3600
}

export function makeSim(seed: number, startHour?: number): Simulation {
  const sim = new Simulation(seed, startHour === undefined ? {} : { startHour })
  if (sim.director) sim.director.occupantName = (room) => sim.beds.occupantName(room)
  return sim
}

/** Keeps every event the log shows, in order, however long the run. */
export class Recorder {
  readonly events: SimEvent[] = []
  private lastId = 0

  constructor(private readonly sim: Simulation) {}

  feed(): void {
    const fresh = this.sim.log.since(this.lastId)
    if (fresh.length === 0) return
    for (const e of fresh) this.events.push(e)
    this.lastId = fresh[fresh.length - 1].id
  }

  of(type: SimEvent['type']): SimEvent[] {
    return this.events.filter((e) => e.type === type)
  }
}

/** Run until sim time `until`, calling `sample` every half second (after the step) and feeding the recorder. */
export function runUntil(sim: Simulation, until: number, rec?: Recorder, sample?: () => void): void {
  while (sim.t < until) {
    for (let k = 0; k < SAMPLE_EVERY; k++) sim.step(DT)
    rec?.feed()
    sample?.()
  }
}
