/**
 * Test helpers for the health kiosks: a bare world, a pretend person who obeys the kiosk's calls, and a driver that steps only the kiosk service.
 * Used by the *.test.ts files in this folder; nothing imports it in the running app.
 */
import { newEntity } from '../person'
import type { Spot } from '../places'
import { Simulation } from '../Simulation'
import type { Entity, VitalsReading } from '../types'
import type { QueueAwareSubject } from './line'

export const DT = 0.05

/** A hospital with no population: kiosks, line and staff only (no director, so no walk-ups and no guide unless a test asks). */
export function bareSim(seed = 1, startHour?: number): Simulation {
  return new Simulation(seed, { population: false, ...(startHour === undefined ? {} : { startHour }) })
}

/** Step only the kiosk service (the hospital around it does not move): cheap, so sessions by the hundred take a moment. */
export function drive(sim: Simulation, seconds: number, each?: (t: number) => void, dt = DT): void {
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) {
    sim.t += dt
    sim.world.t = sim.t
    sim.vitals.step(sim.t, dt)
    sim.vitals.sync(1)
    each?.(sim.t)
  }
}

/** Somebody the kiosk calls: it walks (after `walkSeconds`) onto the platform, glides to the stool, and notes everything it was told. */
export class FakeSubject implements QueueAwareSubject {
  readonly entity: Entity
  readonly walker = { x: -56, z: 2 }
  done = true
  reading: VitalsReading | null = null
  readonly calls: { t: number; what: 'queued' | 'called' | 'sit' | 'done'; place?: number; index?: number }[] = []
  private arriveAt = Infinity
  private target: Spot | null = null

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly now: () => number,
    private readonly walkSeconds = 0,
  ) {
    this.entity = newEntity(id, 'visitor', name, { x: this.walker.x, z: this.walker.z }, 0, 'everyday')
  }

  kioskQueued(spot: Spot, place: number): void {
    this.calls.push({ t: this.now(), what: 'queued', place })
    this.walker.x = spot.at.x
    this.walker.z = spot.at.z
  }

  kioskCalled(index: number, stand: Spot): void {
    this.calls.push({ t: this.now(), what: 'called', index })
    this.go(stand)
  }

  kioskSit(seat: Spot): void {
    this.calls.push({ t: this.now(), what: 'sit' })
    this.walker.x = seat.at.x
    this.walker.z = seat.at.z
  }

  kioskDone(reading: VitalsReading): void {
    this.calls.push({ t: this.now(), what: 'done' })
    this.reading = reading
  }

  /** Call every step: a walking subject arrives when its time is up. */
  tick(t: number): void {
    if (!this.done && t >= this.arriveAt && this.target) {
      this.walker.x = this.target.at.x
      this.walker.z = this.target.at.z
      this.done = true
    }
  }

  private go(spot: Spot): void {
    if (this.walkSeconds <= 0) {
      this.walker.x = spot.at.x
      this.walker.z = spot.at.z
      this.done = true
      return
    }
    this.done = false
    this.target = spot
    this.arriveAt = this.now() + this.walkSeconds
  }

  /** The times of the calls of one kind. */
  times(what: 'queued' | 'called' | 'sit' | 'done'): number[] {
    return this.calls.filter((c) => c.what === what).map((c) => c.t)
  }
}
