/**
 * R2: one ride between level 1 and level 2 for one party (the `LiftTrip`). The people of a party are `Actor`s (a pusher with the vehicle
 * rider that follows it, and/or walkers). The lift bank steps the trip (`LiftBank.step`), the owner polls `phase` / `done` and, once the trip is
 * `done`, takes the party over again: they stand at the arrival spots of the other level's lobby, faded in.
 *
 *   queued     asking for room: the departure and arrival lobbies are reserved together (LiftBank.grant, gate.ts)
 *   toLobby    walking to the lobby's spots (the stretcher spot, or a walker spot per person)
 *   waiting    at the spots, a car called; waits for a car with its doors open
 *   boarding   walking the few steps to the car (walkers; a stretcher fades where it stands), then `fadeOut(true)`
 *   inCar      hidden in the car; the car is closing or has not left yet
 *   riding     the car moves; the party has been placed at the SAME spots of the other lobby, still hidden
 *   arriving   the doors open on the other level: `fadeIn()`
 *   done       visible at the arrival spots, free to walk on (the arrival slots are held for a moment so nobody lands on top of them)
 *   released   the arrival slots are free again
 *
 * The party is only ever hidden (`fadeOut(true)`) while it is in the car, never mid-walk: nobody pops. Heights stay flat; the other level is
 * a different strip of the flat sim (levels.ts).
 */
import type { Actor } from '../er/actor'
import type { LevelId } from '../levels'
import { LIFTS, type ShaftId, type Spot } from '../places'
import { lobbyKey, type LobbyKey } from './gate'

export type TripPhase = 'queued' | 'toLobby' | 'waiting' | 'boarding' | 'inCar' | 'riding' | 'arriving' | 'done' | 'released'

export interface TripSpec {
  /** Unique across the bank (a case id plus a suffix, a test's party number): it holds the lobby slots. */
  ownerId: string
  shaft: ShaftId
  from: LevelId
  to: LevelId
  /** The person pushing a stretcher or wheelchair; its `rider` rides along (placed by world.placeRiders). */
  pusher?: Actor | null
  /** Everyone who walks (they take one waiting-walker slot each). */
  walkers?: readonly Actor[]
  /** A display-only ride (the player's): no people, no lobby slots. */
  ghost?: boolean
}

/** What a trip needs from the bank. */
export interface TripHost {
  readonly t: number
  /** A safety net fired (a bug if it ever happens: tests assert zero). */
  stuck(msg: string): void
}

/** Seconds the arrival slots stay held after the party is visible (they step out of the car spots in this time). */
export const CLEAR_SECONDS = 2.5
/** A car is called once the whole party is this close to its spots (m): the car arrives about when they do. */
const CALL_AHEAD = 9
/** Safety nets (seconds): re-plan a walk that has not arrived, then give up and place the person. */
const LOBBY_REPLAN = 120
const LOBBY_GIVE_UP = 300
const BOARD_GIVE_UP = 25

const TAU = Math.PI * 2

/** Where walker number `slot` waits in a lobby. */
export function waitSpot(shaft: ShaftId, level: LevelId, slot: number): Spot {
  const l = LIFTS[shaft][level]
  const w = l.walkers[Math.min(slot, l.walkers.length - 1)]
  return { at: { x: w.x, z: w.z }, heading: l.stretcher.heading }
}

/** Where a stretcher party's pusher waits, boards and arrives. */
export function stretcherSpot(shaft: ShaftId, level: LevelId): Spot {
  return LIFTS[shaft][level].stretcher
}

/**
 * The spot in front of car `car` where the walker of rank `rank` (0, 1, 2 ...) steps to and fades out, or appears and fades in: the car spot
 * of the contract, then a second person beside it, then rows toward the lobby. `facing` out turns them to face the lobby (arrival).
 */
export function carSpot(shaft: ShaftId, level: LevelId, car: number, rank: number, facing: 'in' | 'out'): Spot {
  const l = LIFTS[shaft][level]
  const c = l.cars[car === 0 ? 0 : 1]
  const s = shaft === 'A' ? -1 : 1
  const side = car === 0 ? 1 : -1
  const col = rank % 2
  const row = Math.floor(rank / 2)
  const heading = facing === 'in' ? c.heading : c.heading + Math.PI
  return { at: { x: c.at.x + side * 0.45 * col, z: c.at.z - s * 0.55 * row }, heading }
}

function wrap(a: number): number {
  return a - TAU * Math.round(a / TAU)
}

export class LiftTrip {
  phase: TripPhase = 'queued'
  readonly pusher: Actor | null
  readonly walkers: readonly Actor[]
  readonly ghost: boolean
  readonly shaft: ShaftId
  readonly from: LevelId
  readonly to: LevelId
  readonly ownerId: string
  readonly fromKey: LobbyKey
  readonly toKey: LobbyKey
  /** The waiting-walker slots held at the departure lobby (set by the bank when it grants the reservation). */
  fromSlots: number[] = []
  /** The car taking the party (0 or 1), or -1 until one is assigned. */
  car = -1
  readonly requestedAt: number
  grantedAt = Number.NaN
  calledAt = Number.NaN
  boardedAt = Number.NaN
  arrivedAt = Number.NaN
  /** The sim time of the last thing that happened (a car keeps its doors open this long after it). */
  lastEventAt: number
  /** The party is close to its lobby spots (or there): a car is called for it while it walks the last metres. */
  calling = false
  /** A car that gave up waiting for the party drops its call; it may call again from this time. */
  callAfter = 0
  /** The sim time the arrival slots may be freed. */
  clearAt = Infinity

  private phaseSince: number
  private moved: boolean[]
  private rank0 = 0

  constructor(
    readonly id: number,
    spec: TripSpec,
    now: number,
  ) {
    this.ownerId = spec.ownerId
    this.shaft = spec.shaft
    this.from = spec.from
    this.to = spec.to
    this.pusher = spec.pusher ?? null
    this.walkers = spec.walkers ?? []
    this.ghost = spec.ghost === true
    this.fromKey = lobbyKey(spec.shaft, spec.from)
    this.toKey = lobbyKey(spec.shaft, spec.to)
    this.requestedAt = now
    this.lastEventAt = now
    this.phaseSince = now
    this.moved = this.walkers.map(() => false)
  }

  /** Does the party include a stretcher or wheelchair (a lobby's one stretcher slot)? */
  get stretcher(): boolean {
    return this.pusher !== null
  }

  /** How many waiting-walker slots it takes. */
  get walkerCount(): number {
    return this.walkers.length
  }

  /** Everyone physically in the party, pusher first. */
  members(): Actor[] {
    const out: Actor[] = []
    if (this.pusher !== null) out.push(this.pusher)
    for (const w of this.walkers) out.push(w)
    return out
  }

  /** The trip is over for its owner: the party stands visible at the arrival lobby. */
  get done(): boolean {
    return this.phase === 'done' || this.phase === 'released'
  }

  /** Hidden in the car (boarded, riding or about to appear). */
  get inside(): boolean {
    return this.phase === 'inCar' || this.phase === 'riding' || this.phase === 'arriving'
  }

  private enter(phase: TripPhase, t: number): void {
    this.phase = phase
    this.phaseSince = t
    this.lastEventAt = t
  }

  /** The bank granted both lobbies: start walking to the spots. */
  start(t: number): void {
    this.grantedAt = t
    this.enter('toLobby', t)
    if (this.ghost) {
      this.calledAt = t
      this.enter('waiting', t)
      return
    }
    if (this.pusher !== null) {
      const s = stretcherSpot(this.shaft, this.from)
      this.pusher.moveTo(s.at, { face: s.heading })
    }
    for (let i = 0; i < this.walkers.length; i++) this.sendWalker(i)
  }

  private sendWalker(i: number): void {
    const w = this.walkers[i]
    const slot = this.fromSlots[i] ?? i
    const s = waitSpot(this.shaft, this.from, slot)
    if (w.seat !== null) {
      // a person on a seat stands up first (Actor.standUp), then walks
      w.standUp()
      this.moved[i] = false
      return
    }
    if (w.mode === 'slide') {
      // getting up or down right now: walk once they are on their feet
      this.moved[i] = false
      return
    }
    w.moveTo(s.at, { face: s.heading })
    this.moved[i] = true
  }

  private static settled(a: Actor): boolean {
    return a.done && a.mode === 'static' && a.seat === null
  }

  private everyoneAtSpots(): boolean {
    if (this.pusher !== null && !LiftTrip.settled(this.pusher)) return false
    for (let i = 0; i < this.walkers.length; i++) {
      if (!this.moved[i] || !LiftTrip.settled(this.walkers[i])) return false
    }
    return true
  }

  /** Is the whole party within `m` metres of its lobby spots? */
  private near(m: number): boolean {
    if (this.pusher !== null) {
      const s = stretcherSpot(this.shaft, this.from).at
      if (Math.hypot(this.pusher.x - s.x, this.pusher.z - s.z) > m) return false
    }
    for (let i = 0; i < this.walkers.length; i++) {
      const s = waitSpot(this.shaft, this.from, this.fromSlots[i] ?? i).at
      if (Math.hypot(this.walkers[i].x - s.x, this.walkers[i].z - s.z) > m) return false
    }
    return true
  }

  /** May the bank give this trip a car? (Waiting at the spots, or walking the last metres.) */
  get callable(): boolean {
    return this.phase === 'waiting' || (this.phase === 'toLobby' && this.calling)
  }

  /** The car dropped its call (the party was too slow): wait at the spots, call again later. */
  dropCall(t: number): void {
    this.car = -1
    this.calling = false
    this.callAfter = t + 8
  }

  /** The car at the departure level has its doors open: board (the bank calls this for a waiting trip it assigned to `car`). */
  beginBoarding(car: number, rank0: number, t: number): void {
    this.car = car
    this.rank0 = rank0
    this.enter('boarding', t)
    if (this.ghost) return
    for (let i = 0; i < this.walkers.length; i++) {
      const s = carSpot(this.shaft, this.from, car, rank0 + i, 'in')
      this.walkers[i].moveTo(s.at, { face: s.heading })
    }
    // a stretcher fades where it stands: its pusher is already at the stretcher spot, in front of the doors
    if (this.pusher !== null) {
      this.pusher.fadeOut(true)
      this.pusher.rider?.fadeOut(true)
    }
  }

  /** Placed at the other lobby, hidden: the car left. `rank0` is where this trip's walkers stand in the arrival row. */
  depart(rank0: number, t: number): void {
    this.enter('riding', t)
    if (this.ghost) return
    const out = this.shaftArrival()
    if (this.pusher !== null) this.pusher.placeAt(out.stretcher.at.x, out.stretcher.at.z, out.stretcher.heading)
    for (let i = 0; i < this.walkers.length; i++) {
      const s = carSpot(this.shaft, this.to, this.car, rank0 + i, 'out')
      this.walkers[i].placeAt(s.at.x, s.at.z, s.heading)
    }
  }

  private shaftArrival(): { stretcher: Spot } {
    const s = stretcherSpot(this.shaft, this.to)
    return { stretcher: { at: s.at, heading: wrap(s.heading + Math.PI) } }
  }

  /** The doors opened on the arrival level: appear. */
  arrive(t: number): void {
    this.enter('arriving', t)
    for (const m of this.members()) m.fadeIn()
    this.pusher?.rider?.fadeIn()
  }

  step(dt: number, host: TripHost): void {
    const t = host.t
    switch (this.phase) {
      case 'queued':
      case 'waiting':
      case 'inCar':
      case 'riding':
      case 'released':
        break
      case 'toLobby': {
        const waited = t - this.grantedAt
        if (this.pusher === null && this.walkers.length === 0) {
          this.calledAt = t
          this.enter('waiting', t)
          break
        }
        // people who had to stand up first start walking once they are on their feet
        for (let i = 0; i < this.walkers.length; i++) {
          const w = this.walkers[i]
          if (!this.moved[i] && w.done && w.seat === null && w.mode === 'static') {
            const s = waitSpot(this.shaft, this.from, this.fromSlots[i] ?? i)
            w.moveTo(s.at, { face: s.heading })
            this.moved[i] = true
          }
        }
        if (!this.calling && t >= this.callAfter && this.near(CALL_AHEAD)) {
          this.calling = true
          if (Number.isNaN(this.calledAt)) this.calledAt = t
        }
        if (this.everyoneAtSpots()) {
          if (Number.isNaN(this.calledAt)) this.calledAt = t
          this.calling = true
          this.enter('waiting', t)
        } else if (waited > LOBBY_GIVE_UP) {
          host.stuck(`${this.ownerId}: not at the ${this.shaft}${this.from} lobby after ${waited.toFixed(0)} s`)
          this.placeAtSpots()
          if (Number.isNaN(this.calledAt)) this.calledAt = t
          this.calling = true
          this.enter('waiting', t)
        } else if (waited > LOBBY_REPLAN && waited - dt <= LOBBY_REPLAN) {
          if (this.pusher !== null && !this.pusher.done) {
            const s = stretcherSpot(this.shaft, this.from)
            this.pusher.moveTo(s.at, { face: s.heading })
          }
          for (let i = 0; i < this.walkers.length; i++) {
            const w = this.walkers[i]
            if (this.moved[i] && !w.done) {
              const s = waitSpot(this.shaft, this.from, this.fromSlots[i] ?? i)
              w.moveTo(s.at, { face: s.heading })
            }
          }
        }
        break
      }
      case 'boarding': {
        if (this.ghost) {
          this.boarded(t)
          break
        }
        let all = true
        for (const w of this.walkers) {
          if (w.hidden) continue
          all = false
          if (!w.fadingOut && w.done && w.mode === 'static') w.fadeOut(true)
        }
        const p = this.pusher
        if (p !== null) {
          if (!p.hidden) all = false
          if (p.rider !== null && !p.rider.hidden) all = false
        }
        if (all) this.boarded(t)
        else if (t - this.phaseSince > BOARD_GIVE_UP) {
          host.stuck(`${this.ownerId}: did not board within ${BOARD_GIVE_UP} s`)
          for (const w of this.walkers) {
            const i = this.walkers.indexOf(w)
            const s = carSpot(this.shaft, this.from, this.car, this.rank0 + i, 'in')
            w.placeAt(s.at.x, s.at.z, s.heading)
            w.fadeOut(true)
          }
          this.phaseSince = t
        }
        break
      }
      case 'arriving': {
        if (this.ghost) {
          this.finish(t)
          break
        }
        let all = true
        for (const m of this.members()) if (!m.visibleFully) all = false
        if (this.pusher?.rider != null && !this.pusher.rider.visibleFully) all = false
        if (all) this.finish(t)
        break
      }
      case 'done':
        if (t >= this.clearAt) this.phase = 'released'
        break
    }
  }

  private boarded(t: number): void {
    this.boardedAt = t
    this.enter('inCar', t)
  }

  private finish(t: number): void {
    this.arrivedAt = t
    this.clearAt = t + CLEAR_SECONDS
    this.enter('done', t)
  }

  /** A safety net: put everyone at their waiting spots. */
  private placeAtSpots(): void {
    if (this.pusher !== null) {
      const s = stretcherSpot(this.shaft, this.from)
      this.pusher.placeAt(s.at.x, s.at.z, s.heading)
    }
    for (let i = 0; i < this.walkers.length; i++) {
      const s = waitSpot(this.shaft, this.from, this.fromSlots[i] ?? i)
      this.walkers[i].placeAt(s.at.x, s.at.z, s.heading)
      this.moved[i] = true
    }
  }

  /** How long the party has been waiting for its ride since it asked (seconds). */
  waitedSeconds(t: number): number {
    return (Number.isNaN(this.arrivedAt) ? t : this.arrivedAt) - this.requestedAt
  }
}
