/**
 * R2: the lifts between level 1 and level 2 (agent S, src/sim/lifts/**). The interface is frozen in ports.ts.
 *
 *   gate.ts   the lobby gates: one stretcher party and CONFIG.lifts.lobbyWalkers walkers per lobby; both lobbies of a ride are reserved
 *             together, in the fixed order A1 < A2 < B1 < B2 (all or nothing), so nothing can deadlock
 *   trip.ts   `LiftTrip`: one party's ride (walk to the lobby, wait for a car, board, ride, appear at the same spots of the other level)
 *   here      `LiftBank`: the four cars (two per shaft), their doors and travel, the call queue, `claimFade`/`releaseFade`, `playerRide`
 *
 * Car cycle: idle -> opening (doorSeconds) -> open (dwell while people board or step out) -> closing (doorSeconds) -> moving
 * (travelSeconds per floor). A car carries one stretcher party, or up to walkersPerCar walkers of the same direction. The cars mutate
 * `state.cars` in place; `state.version` is bumped when a car changes phase, level or target (the doors and the travel animate every step).
 *
 * Everything here is deterministic (no randomness at all): the same calls give the same cars.
 */
import { CONFIG } from '../config'
import type { World } from '../er/world'
import type { LevelId } from '../levels'
import type { ShaftId } from '../places'
import type { Rng } from '../rng'
import type { LiftCarState, LiftsState } from '../types'
import { LobbyGate, lobbyKey, LOBBY_KEYS, type LobbyKey } from './gate'
import type { LiftsPort } from './ports'
import { LiftTrip, type TripHost, type TripSpec } from './trip'

export { LobbyGate, lobbyKey, lobbyName, LOBBY_KEYS, type LobbyKey } from './gate'
export { LiftTrip, carSpot, stretcherSpot, waitSpot, CLEAR_SECONDS, type TripPhase, type TripSpec } from './trip'

/** A car holds its doors open this long for a party that has been called but is still walking up (s). */
const MAX_CALL_WAIT = 25
/** A queued trip that has waited this long holds its place: later trips may not overtake it for the slots it needs (s). */
const AGING = 40

class Car {
  readonly s: LiftCarState
  /** Trips assigned to this car and not yet done (waiting, boarding, inside, arriving). */
  jobs: LiftTrip[] = []
  openedAt = 0
  /** Where the next walker boarding or stepping out stands in the row of car spots. */
  rank = 0

  constructor(s: LiftCarState) {
    this.s = s
  }

  get loaded(): boolean {
    for (const j of this.jobs) if (j.inside) return true
    return false
  }

  private persons(): number {
    let n = 0
    for (const j of this.jobs) n += j.walkerCount
    return n
  }

  /** May `trip` join (or take) this car now? */
  canTake(trip: LiftTrip): boolean {
    const s = this.s
    if (this.loaded) return false
    if (this.jobs.length === 0) {
      // an empty car that is closing has to finish and go idle first
      return s.phase !== 'closing'
    }
    const first = this.jobs[0]
    if (first.from !== trip.from || first.ghost || trip.ghost) return false
    if (first.stretcher || trip.stretcher) return false
    if (s.phase === 'closing') return false
    if (s.phase === 'moving' && s.target !== trip.from) return false
    return this.persons() + trip.walkerCount <= CONFIG.lifts.walkersPerCar
  }

  /** Lower is better: join a car already coming, then a free car where the party is, then one that has to travel. */
  score(trip: LiftTrip): number {
    const s = this.s
    if (this.jobs.length > 0) return 0
    if (s.level === trip.from) return s.phase === 'idle' ? 1 : s.phase === 'open' || s.phase === 'opening' ? 1.5 : 2
    return s.phase === 'idle' ? 3 : 4
  }
}

export class LiftBank implements LiftsPort, TripHost {
  readonly state: LiftsState
  readonly gates: LobbyGate[]
  readonly cars: Car[] = []
  /** Trips that are not yet released (queued, walking, riding, or holding their arrival slots). */
  readonly trips: LiftTrip[] = []
  /** Every trip ever made, in order (the tests read waits and times from here). */
  readonly history: LiftTrip[] = []
  t = 0
  /** Safety nets that fired (a bug if not zero) and what they were. */
  stuckFixes = 0
  readonly stuckLog: string[] = []
  private tripSeq = 0

  constructor(
    readonly world: World,
    readonly rng: Rng,
  ) {
    const cars: LiftCarState[] = []
    for (const shaft of ['A', 'B'] as const) {
      for (let i = 0; i < CONFIG.lifts.carsPerShaft; i++) {
        cars.push({ shaft, index: i as 0 | 1, level: 1, target: null, phase: 'idle', doors: 0, travel: 0 })
      }
    }
    this.state = { cars, version: 0 }
    for (const c of cars) this.cars.push(new Car(c))
    this.gates = LOBBY_KEYS.map((k) => new LobbyGate(k))
  }

  // --- the frozen port -----------------------------------------------------------------------------------------------

  /**
   * Hold a lobby's stretcher slot for a fade ("admitted to a ward upstairs", a MealBot's run). True when it is (now) the owner's. A lobby where a
   * ride has reserved landing room is not given away until that ride has stepped out, and nobody lands in a lobby while a fade holds it.
   */
  claimFade(shaft: ShaftId, level: LevelId, ownerId: string): boolean {
    return this.gates[lobbyKey(shaft, level)].takeFade(ownerId)
  }

  releaseFade(ownerId: string): void {
    for (const g of this.gates) if (g.fadeBy === ownerId) g.release(ownerId)
  }

  /** The player rode: a free car shows the ride (opens, closes, travels, opens on the other level). Nothing is reserved. */
  playerRide(shaft: ShaftId, from: LevelId, to: LevelId): void {
    if (from === to) return
    let car: Car | null = null
    for (const c of this.cars) {
      if (c.s.shaft !== shaft || c.jobs.length > 0) continue
      if (c.s.phase !== 'idle' && c.s.phase !== 'open') continue
      if (car === null || (c.s.level === from && car.s.level !== from)) car = c
    }
    if (car === null) return
    const trip = this.trip({ ownerId: `player:${this.tripSeq}`, shaft, from, to, ghost: true })
    trip.car = car.s.index
    car.jobs.push(trip)
  }

  // --- trips ------------------------------------------------------------------------------------------------------------

  /** Ask for a ride. The returned trip is stepped by the bank; poll `trip.phase` / `trip.done`. */
  trip(spec: TripSpec): LiftTrip {
    if (spec.from === spec.to) throw new Error(`A lift trip must change level (${spec.ownerId})`)
    if (this.trips.some((t) => t.ownerId === spec.ownerId)) throw new Error(`Duplicate lift trip ${spec.ownerId}`)
    const trip = new LiftTrip(this.tripSeq++, spec, this.t)
    this.trips.push(trip)
    this.history.push(trip)
    return trip
  }

  stuck(msg: string): void {
    this.stuckFixes++
    if (this.stuckLog.length < 40) this.stuckLog.push(`${this.t.toFixed(0)}s ${msg}`)
  }

  // --- the step ------------------------------------------------------------------------------------------------------------

  step(t: number, dt: number): void {
    this.t = t
    this.grant(t)
    for (let i = 0; i < this.trips.length; i++) this.trips[i].step(dt, this)
    this.assign()
    for (const car of this.cars) this.stepCar(car, dt)
    for (let i = this.trips.length - 1; i >= 0; i--) {
      const trip = this.trips[i]
      if (trip.phase !== 'released') continue
      this.gates[trip.toKey].release(trip.ownerId)
      this.gates[trip.fromKey].release(trip.ownerId)
      this.trips.splice(i, 1)
    }
  }

  sync(_alpha: number): void {}

  /** Cars at rest on level 1, nothing in flight (a Jump rebuilds the sim; trips of the new sim start from nothing). */
  warmStart(_hour: number): void {
    for (const car of this.cars) {
      const s = car.s
      s.level = 1
      s.target = null
      s.phase = 'idle'
      s.doors = 0
      s.travel = 0
      car.jobs = []
    }
    this.state.version++
  }

  /**
   * Reserve both lobbies of every queued trip, oldest first. All or nothing, the lower-numbered lobby first (gate.ts): a trip keeps neither
   * lobby unless it gets both, so none waits for one lobby while holding another. A trip that has waited longer than AGING seconds also holds
   * its place for the resource it wants in each lobby, so a later trip cannot overtake it for that slot (no starvation); younger trips that
   * cannot be served yet do not hold anybody back.
   */
  private grant(t: number): void {
    let blocked: Set<number> | null = null
    for (const trip of this.trips) {
      if (trip.phase !== 'queued') continue
      if (trip.ghost) {
        trip.start(t)
        continue
      }
      const needS = trip.stretcher
      const nW = trip.walkerCount
      const a = this.gates[trip.fromKey]
      const b = this.gates[trip.toKey]
      const clash = (key: LobbyKey): boolean => blocked !== null && ((needS && blocked.has(key * 2 + 1)) || (nW > 0 && blocked.has(key * 2)))
      if (a.fits(needS, nW) && b.fitsLanding(needS, nW) && !clash(trip.fromKey) && !clash(trip.toKey)) {
        // (both are taken in this one step, the lower-numbered lobby first: all or nothing)
        if (trip.fromKey < trip.toKey) {
          trip.fromSlots = a.take(trip.ownerId, needS, nW)
          b.takeLanding(trip.ownerId, needS, nW)
        } else {
          b.takeLanding(trip.ownerId, needS, nW)
          trip.fromSlots = a.take(trip.ownerId, needS, nW)
        }
        trip.start(t)
      } else if (t - trip.requestedAt > AGING) {
        blocked ??= new Set<number>()
        for (const key of [trip.fromKey, trip.toKey]) {
          if (needS) blocked.add(key * 2 + 1)
          if (nW > 0) blocked.add(key * 2)
        }
      }
    }
  }

  /** Give each waiting trip a car. */
  private assign(): void {
    for (const trip of this.trips) {
      if (!trip.callable || trip.car >= 0) continue
      let best: Car | null = null
      let bestScore = Infinity
      for (const car of this.cars) {
        if (car.s.shaft !== trip.shaft || !car.canTake(trip)) continue
        const sc = car.score(trip)
        if (sc < bestScore) {
          best = car
          bestScore = sc
        }
      }
      if (best !== null) {
        trip.car = best.s.index
        best.jobs.push(trip)
      }
    }
  }

  private setPhase(s: LiftCarState, phase: LiftCarState['phase']): void {
    if (s.phase === phase) return
    s.phase = phase
    this.state.version++
  }

  private stepCar(car: Car, dt: number): void {
    const s = car.s
    const t = this.t
    // trips that are over leave the car's list
    if (car.jobs.length > 0 && car.jobs.some((j) => j.done)) car.jobs = car.jobs.filter((j) => !j.done)
    switch (s.phase) {
      case 'idle': {
        if (car.jobs.length === 0) break
        const first = car.jobs[0]
        if (s.level === first.from) {
          car.openedAt = t
          car.rank = 0
          this.setPhase(s, 'opening')
        } else {
          s.target = first.from
          s.travel = 0
          this.setPhase(s, 'moving')
        }
        break
      }
      case 'moving': {
        s.travel += dt / CONFIG.lifts.travelSeconds
        if (s.travel >= 1) {
          s.travel = 0
          s.level = (s.target ?? s.level) as LevelId
          s.target = null
          car.openedAt = t
          car.rank = 0
          this.setPhase(s, 'opening')
        }
        break
      }
      case 'opening': {
        s.doors = Math.min(1, s.doors + dt / CONFIG.lifts.doorSeconds)
        // the party that rode appears as the doors open
        for (const j of car.jobs) if (j.phase === 'riding' && j.to === s.level && s.doors >= 0.4) j.arrive(t)
        if (s.doors >= 1) {
          car.openedAt = t
          this.setPhase(s, 'open')
        }
        break
      }
      case 'open': {
        s.doors = 1
        let pending = false
        for (const j of car.jobs) {
          if (j.phase === 'riding' && j.to === s.level) j.arrive(t)
          if (j.phase === 'waiting' && j.from === s.level && j.car === s.index) {
            j.beginBoarding(s.index, car.rank, t)
            car.rank += j.walkerCount
          }
          if ((j.phase === 'boarding' || j.phase === 'waiting' || j.phase === 'toLobby') && j.from === s.level) pending = true
          if (j.phase === 'arriving') pending = true
        }
        // a party still walking up when the doors have been open a long time drops its call and calls again nearer
        if (pending && t - car.openedAt > MAX_CALL_WAIT) {
          let dropped = false
          for (const j of car.jobs) {
            if (j.phase === 'toLobby' && j.from === s.level) {
              j.dropCall(t)
              dropped = true
            }
          }
          if (dropped) car.jobs = car.jobs.filter((j) => j.car === s.index)
          pending = car.jobs.some((j) => (j.phase === 'boarding' || j.phase === 'waiting') && j.from === s.level) || car.jobs.some((j) => j.phase === 'arriving')
        }
        // somebody is still stepping in or out: the doors stay open (a boarding party has its own time limit, trip.ts)
        if (pending) break
        let last = car.openedAt
        for (const j of car.jobs) if (j.lastEventAt > last) last = j.lastEventAt
        if (t - last >= CONFIG.lifts.dwellSeconds) this.setPhase(s, 'closing')
        break
      }
      case 'closing': {
        s.doors = Math.max(0, s.doors - dt / CONFIG.lifts.doorSeconds)
        if (s.doors <= 0) {
          let rank = 0
          let to: LevelId | null = null
          for (const j of car.jobs) {
            if (j.phase !== 'inCar') continue
            j.depart(rank, t)
            rank += j.walkerCount
            to = j.to
          }
          if (to !== null) {
            s.target = to
            s.travel = 0
            this.setPhase(s, 'moving')
          } else this.setPhase(s, 'idle')
        }
        break
      }
    }
  }

  // --- numbers for the tests and the panels ------------------------------------------------------------------------------------

  /** Trips that reached their destination, and the longest time from asking to arriving (s). */
  get served(): number {
    let n = 0
    for (const t of this.history) if (!t.ghost && !Number.isNaN(t.arrivedAt)) n++
    return n
  }

  get longestWait(): number {
    let m = 0
    for (const t of this.history) if (!t.ghost && !Number.isNaN(t.arrivedAt)) m = Math.max(m, t.arrivedAt - t.requestedAt)
    return m
  }
}
