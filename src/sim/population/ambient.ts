/**
 * Ambient seated people (skill: "half-empty rooms look dead"): the manager tops the waiting seats, the café and the
 * benches up to a target fill that follows the clock (about 90 % of the lobby seats and 70 % of the café at the busy
 * hour), and people stay a while and leave. They give up a lobby seat the moment a patient or companion needs it.
 * They arrive by the main entrance like everyone else, except at the very start of the day, when the first ones are
 * already sitting (they fade in on their seats).
 *
 * L1: the targets follow the full-day tables `CONFIG.day.ambient` (a calmer lobby in the quiet hour, a thin crowd at night, the
 * café empty after `day.cafeHours`), and a start at another hour seeds the seats at that hour's level (`seedStart`).
 */
import { CONFIG } from '../config'
import { Actor } from '../er/actor'
import type { AmbientLike, World } from '../er/world'
import type { PeopleContext } from '../people'
import { ARRIVALS, ATRIUM, DEPARTURES } from '../places'
import type { Rng } from '../rng'
import { seatGroup, type SeatFilter } from '../seats'
import type { SeatSpec, Vec2 } from '../types'
import type { Walker } from '../walker'
import { ageWalkFactor, drawVisitorAge } from './age'
import { hourAt, levelAt, type Curve } from './schedule'

type State = 'fade' | 'toSeat' | 'seated' | 'standing' | 'toExit'

function seatMatches(seat: SeatSpec, f: SeatFilter): boolean {
  if (f.kind !== undefined && (typeof f.kind === 'string' ? seat.kind !== f.kind : !f.kind.includes(seat.kind))) return false
  if (f.area !== undefined && seat.area !== f.area) return false
  if (f.group !== undefined && seatGroup(seat) !== f.group) return false
  if (f.ids !== undefined && !f.ids.includes(seat.id)) return false
  return true
}

export class Ambient extends Actor {
  state: State = 'fade'
  /** The seat this person holds (claimed when they spawn, so nobody else takes it while they walk in). */
  readonly claimed: SeatSpec
  seatedAt = Infinity
  /** Set by the manager: told when this person has left the simulation. */
  onGone: ((a: Ambient) => void) | null = null
  private stayLeft: number

  constructor(
    readonly world: World,
    id: string,
    name: string,
    seat: SeatSpec,
    at: Vec2,
    heading: number,
    walker: Walker,
    stay: number,
    readonly groupId: string,
    /** A seeded adult age; it sets the pace. */
    readonly age: number = 45,
  ) {
    super(id, 'visitor', name, at, heading, walker, 'everyday')
    this.claimed = seat
    this.stayLeft = stay
    this.cruise = CONFIG.ambient.walkSpeed * (0.9 + (this.entity.variant % 21) / 100) * ageWalkFactor(age)
  }

  think(dt: number, _ctx: PeopleContext): void {
    switch (this.state) {
      case 'fade':
        if (this.visibleFully) {
          this.sitOn(this.claimed)
          this.state = 'toSeat'
        }
        break
      case 'toSeat':
        if (this.done) {
          this.state = 'seated'
          this.seatedAt = this.world.t
          if (this.groupId === 'cafe') this.entity.prop = 'coffee'
        }
        break
      case 'seated':
        this.stayLeft -= dt
        if (this.stayLeft <= 0) this.leaveNow()
        break
      case 'standing':
        if (this.done) {
          this.entity.prop = 'none'
          this.moveTo(DEPARTURES.entrance)
          this.state = 'toExit'
        }
        break
      case 'toExit':
        if (this.done && !this.fadingOut) this.fadeOut()
        break
    }
  }

  /** Give up the seat now (a patient needs it, or the stay is over) and leave by the entrance. */
  leaveNow(): void {
    if (this.state === 'standing' || this.state === 'toExit') return
    this.world.seats.release(this.claimed.id)
    if (this.seat) {
      this.state = 'standing'
      this.standUp()
    } else {
      this.entity.prop = 'none'
      this.moveTo(DEPARTURES.entrance)
      this.state = 'toExit'
    }
  }

  override onRemoved(world: World): void {
    world.seats.releaseBy(this.entity.id)
    world.releaseName(this.entity.name)
    this.onGone?.(this)
  }
}

interface Group {
  id: string
  filter: SeatFilter
  curve: Curve
  /** Where new ones head for when choosing the nearest seat. */
  near: Vec2
}

/**
 * The full-day table with the M3 level at the start of the default day (07:30) pinned. The L1 benches table is a little
 * higher at 07:30 than the M3 one was (15 % against 10 %), which would make the default morning a different day: a
 * different crowd, different medicine-story timings, and a latent porter-and-doctor stall in the M3 gate that only
 * some crowds hit. Pinning the one point keeps the default start exactly the M3 morning. The lobby and café tables agree
 * already, so this changes nothing for them.
 */
function pinnedAtStart(day: Curve, m3: Curve): Curve {
  const h = CONFIG.sim.startHour
  const want = levelAt(m3, h)
  if (Math.abs(levelAt(day, h) - want) < 1e-9) return day
  return [...day.filter((p) => p[0] < h), [h, want] as const, ...day.filter((p) => p[0] > h)]
}

const GROUPS: Group[] = [
  { id: 'lobby', filter: { kind: 'waiting', area: 'lobby' }, curve: pinnedAtStart(CONFIG.day.ambient.lobby, CONFIG.ambient.lobby), near: ARRIVALS.entrance.at },
  { id: 'cafe', filter: { kind: 'cafe' }, curve: pinnedAtStart(CONFIG.day.ambient.cafe, CONFIG.ambient.cafe), near: ATRIUM.cafe.at },
  { id: 'benches', filter: { kind: 'bench' }, curve: pinnedAtStart(CONFIG.day.ambient.benches, CONFIG.ambient.benches), near: ATRIUM.garden },
]

export class AmbientManager implements AmbientLike {
  readonly people: Ambient[] = []
  private timer = 0

  constructor(
    private readonly world: World,
    private readonly rng: Rng,
    private readonly walkerFor: (id: string) => Walker,
    private readonly add: (a: Ambient) => void,
  ) {}

  /** Fill the seats to the morning's level at once (the first moments of the day). */
  seedStart(): void {
    for (const g of GROUPS) {
      const target = this.target(g, this.world.t)
      for (let guard = 0; guard < 40; guard++) {
        if (this.world.seats.occupancy(g.filter).taken >= target) break
        if (!this.spawn(g, true)) break
      }
    }
  }

  step(t: number, dt: number): void {
    this.timer += dt
    if (this.timer < CONFIG.ambient.topUpSeconds) return
    this.timer = 0
    for (const g of GROUPS) {
      const { taken } = this.world.seats.occupancy(g.filter)
      const target = this.target(g, t)
      if (taken < target) this.spawn(g, false)
      else if (taken > target + 1) this.trim(g)
    }
  }

  private target(g: Group, t: number): number {
    const { total } = this.world.seats.occupancy(g.filter)
    return Math.round(total * levelAt(g.curve, hourAt(t)))
  }

  private spawn(g: Group, seated: boolean): boolean {
    const w = this.world
    const id = w.id('amb')
    const seat = w.seats.claim(id, g.filter, g.near)
    if (!seat) return false
    const name = w.uniqueName(this.rng)
    const stay = this.rng.between(CONFIG.ambient.staySeconds) * (seated ? this.rng.range(0.1, 1) : 1)
    const at = seated
      ? { x: seat.x, z: seat.z }
      : { x: ARRIVALS.entrance.at.x, z: ARRIVALS.entrance.at.z + this.rng.range(-0.9, 0.9) }
    const a = new Ambient(w, id, name, seat, at, seated ? seat.heading : ARRIVALS.entrance.heading, this.walkerFor(id), stay, g.id, drawVisitorAge(this.rng.fork(`${id}:age`)))
    if (seated) {
      a.placeOnSeat(seat)
      a.state = 'seated'
      a.seatedAt = w.t
      if (g.id === 'cafe') a.entity.prop = 'coffee'
    }
    a.fadeIn()
    a.onGone = (x) => this.forget(x)
    this.people.push(a)
    this.add(a)
    return true
  }

  /** The person who has sat longest in this group leaves (the seats are over target, e.g. in the afternoon). */
  private trim(g: Group): void {
    let best: Ambient | null = null
    for (const a of this.people) {
      if (a.state !== 'seated' || !seatMatches(a.claimed, g.filter)) continue
      if (best === null || a.seatedAt < best.seatedAt) best = a
    }
    best?.leaveNow()
  }

  evictOne(filter: SeatFilter): boolean {
    let best: Ambient | null = null
    for (const a of this.people) {
      if ((a.state !== 'seated' && a.state !== 'toSeat') || !seatMatches(a.claimed, filter)) continue
      // prefer somebody already sitting; among those, the one who has sat longest
      const rank = a.state === 'seated' ? a.seatedAt : Infinity
      const bestRank = best === null ? Infinity : best.state === 'seated' ? best.seatedAt : Infinity
      if (best === null || rank < bestRank) best = a
    }
    if (!best) return false
    best.leaveNow()
    return true
  }

  /** Called when an ambient person is removed from the simulation. */
  forget(a: Ambient): void {
    const i = this.people.indexOf(a)
    if (i >= 0) this.people.splice(i, 1)
  }

}
