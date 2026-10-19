/**
 * Test helpers for the lifts and the surgery suite (not imported by the sim): a small hospital that is only a World, the lifts, the surgery
 * suite and the people they add, stepped the way `Simulation.step` steps them. It is much cheaper than a full Simulation (no ER, no
 * pharmacy, no ambient crowd), so a whole day runs in a few seconds, and everything that happens is only what a test starts.
 */
import { EventLog } from '../events'
import { Actor } from '../er/actor'
import { World } from '../er/world'
import type { MedSystem } from '../meds/system'
import { Crowd } from '../nav/crowd'
import { makeQueue } from '../nav/queue'
import type { Person, PeopleContext } from '../person'
import { Rng } from '../rng'
import { defaultSeats, SeatRegistry } from '../seats'
import type { SeatSpec, Vec2 } from '../types'
import { makeWalker, type Walker } from '../walker'
import { Surgery } from '../surgery'
import { LiftBank } from './index'

export const DT = 1 / 60

export interface MiniOptions {
  /** Walkers share a Crowd (keep-right, avoidance, doors): default true. False: solo walkers, much cheaper. */
  crowd?: boolean
  /** The seat registry to use (default: the building's seats). */
  seats?: readonly SeatSpec[]
  /** Build the surgery suite too (default false: only the lifts). */
  surgery?: boolean
  /** The clock the world starts at (sim seconds since 07:30). */
  t0?: number
}

export class MiniHospital {
  readonly log = new EventLog()
  readonly world: World
  readonly lifts: LiftBank
  readonly surgery: Surgery | null
  readonly people: Person[] = []
  readonly crowd: Crowd | null
  readonly seats: SeatRegistry
  readonly rng: Rng
  readonly walkerFor: (id: string) => Walker
  t: number
  private readonly ctx: PeopleContext
  private readonly leaving: Person[] = []

  constructor(
    readonly seed: number,
    opts: MiniOptions = {},
  ) {
    this.rng = new Rng(seed)
    this.t = opts.t0 ?? 0
    this.crowd = opts.crowd === false ? null : new Crowd()
    const crowd = this.crowd
    this.walkerFor = (id: string): Walker => makeWalker(crowd ?? undefined, { id })
    this.seats = new SeatRegistry(opts.seats ?? defaultSeats())
    this.world = new World(
      this.log,
      this.seats,
      this.rng.fork('population'),
      { add: (p) => this.addPerson(p), remove: (p) => this.removePerson(p) },
      makeQueue('reception'),
      [makeQueue('kiosk0'), makeQueue('kiosk1')],
      new Map(),
      this.walkerFor,
    )
    this.world.t = this.t
    this.world.clock.advanceTo(this.t * 1000)
    this.lifts = new LiftBank(this.world, this.rng.fork('lifts'))
    this.world.lifts = this.lifts
    if (opts.surgery === true) {
      this.surgery = new Surgery(this.world, this.rng.fork('surgery'), this.walkerFor)
      this.world.surgery = this.surgery
    } else this.surgery = null
    this.ctx = { t: this.t, meds: null as unknown as MedSystem, rng: this.rng.fork('people'), world: this.world }
  }

  addPerson(p: Person): void {
    this.people.push(p)
    p.snapshot()
  }

  removePerson(p: Person): void {
    const i = this.people.indexOf(p)
    if (i < 0) return
    this.people.splice(i, 1)
    p.walker.remove()
    p.onRemoved(this.world)
  }

  personById(id: string): Person | null {
    for (const p of this.people) if (p.entity.id === id) return p
    return null
  }

  /** One fixed step, in the order of Simulation.step. */
  step(dt: number = DT): void {
    this.t += dt
    this.ctx.t = this.t
    this.crowd?.beginStep()
    this.world.step(this.t, dt)
    this.lifts.step(this.t, dt)
    this.surgery?.step(this.t, dt)
    const people = this.people
    for (let i = 0; i < people.length; i++) {
      const p = people[i]
      p.snapshot()
      p.update(dt, this.ctx)
      if (p.wantsTalkPose(this.t)) p.talkPose()
      p.stepFade(dt)
      if (p.gone) this.leaving.push(p)
    }
    this.world.placeRiders()
    if (this.leaving.length > 0) {
      for (const p of this.leaving) this.removePerson(p)
      this.leaving.length = 0
    }
  }

  /** Step for `seconds` of sim time at `dt`. */
  run(seconds: number, dt: number = DT, each?: () => void): void {
    const n = Math.round(seconds / dt)
    for (let i = 0; i < n; i++) {
      this.step(dt)
      each?.()
    }
  }

  /** Step until `done()` or `maxSeconds` have passed; true when `done()` came true. */
  runUntil(done: () => boolean, maxSeconds: number, dt: number = DT): boolean {
    const n = Math.round(maxSeconds / dt)
    for (let i = 0; i < n; i++) {
      if (done()) return true
      this.step(dt)
    }
    return done()
  }
}

/** A person with no behaviour of its own: tests command them. */
export class TestPerson extends Actor {
  think(): void {}
}

/** A standing test person at `at`. */
export function testPerson(h: MiniHospital, id: string, at: Vec2, heading = 0): TestPerson {
  const p = new TestPerson(id, 'visitor', id, at, heading, h.walkerFor(id), 'everyday')
  h.world.hooks.add(p)
  p.fadeIn()
  return p
}
