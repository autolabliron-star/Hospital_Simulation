/**
 * Visitors: a party of one or two arrives at the entrance, walks to a ward patient's room, spends 10-30 minutes there
 * (the leader in the visitor chair if it is free, otherwise standing by the window or seated in the wing's lounge),
 * then about 40 % have a coffee in the café before they leave. The leader runs the party; the partner follows its phase.
 *
 *   arriving -> visit -> [cafe] -> exit
 *
 * L1: a visit is only ever to the patient who is in the bed now. If the patient has gone home (or the bed is empty) when the
 * party reaches the room, or while they sit there, the visit ends at once. A party flagged `collecting` is a family
 * that comes to take a patient home: it waits in the room until the patient is dressed (`release`), then walks out behind
 * them (or behind the porter pushing their wheelchair).
 */
import { ATRIUM, DEPARTURES, ROOMS, type RoomSpec } from '../places'
import { CONFIG } from '../config'
import type { PeopleContext } from '../people'
import type { Rng } from '../rng'
import type { PropKind, SeatSpec, Vec2 } from '../types'
import type { Walker } from '../walker'
import { Actor } from '../er/actor'
import { headingTo } from '../er/spots'
import type { World } from '../er/world'
import { ageWalkFactor, drawVisitorAge } from './age'
import type { VisitBook } from './visitBook'

export type PartyPhase = 'arriving' | 'visit' | 'cafe' | 'exit'

export type Place =
  | { kind: 'chair'; seat: SeatSpec }
  | { kind: 'lounge'; seat: SeatSpec }
  | { kind: 'window'; index: number; at: Vec2 }

/** A family come to take a patient home (L1). The discharge journey and the visitors talk through this. */
export interface Collecting {
  /** The family is in the room, waiting. */
  arrived: boolean
  /** The patient is dressed and ready: the family goes out behind them. */
  release: boolean
  /** Whom the family follows out: the patient, or the porter pushing their wheelchair. */
  escort: () => Actor | null
}

export interface Party {
  id: string
  room: RoomSpec
  patientName: string
  /** Set for a family collecting a patient (L1). */
  collecting?: Collecting
  /** The visit never happened: the patient was not in the bed when the party arrived. */
  noVisit?: boolean
  phase: PartyPhase
  visitStartedAt: number
  visitUntil: number
  visitMinutes: number
  cafeUntil: number
  cafeSeats: Map<string, SeatSpec>
  members: Visitor[]
}

type State = 'fade' | 'toPlace' | 'atPlace' | 'standing' | 'toCafe' | 'cafe' | 'toExit'

const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.id, r]))

export function roomOf(id: string): RoomSpec {
  return ROOM_BY_ID.get(id)!
}

export class Visitor extends Actor {
  private state: State = 'fade'
  private seen: PartyPhase = 'arriving'
  private next: 'cafe' | 'exit' = 'exit'
  private talkTimer = 0
  private heartTimer = 0
  private flowersTimer = 25
  private readonly isLeader: boolean
  /** A seeded adult age (visitors have none on file): it sets their pace. */
  readonly age: number

  constructor(
    readonly world: World,
    readonly book: VisitBook,
    readonly party: Party,
    id: string,
    name: string,
    readonly place: Place,
    at: Vec2,
    heading: number,
    walker: Walker,
    private readonly vrng: Rng,
    prop: PropKind,
  ) {
    super(id, 'visitor', name, at, heading, walker, 'everyday')
    this.isLeader = party.members.length === 0
    party.members.push(this)
    this.entity.prop = prop
    this.age = drawVisitorAge(vrng.fork('age'))
    this.cruise = CONFIG.visitors.walkSpeed * (0.92 + (this.entity.variant % 17) / 100) * ageWalkFactor(this.age)
    this.talkTimer = vrng.range(3, 9)
    this.heartTimer = vrng.range(90, 240)
  }

  think(dt: number, ctx: PeopleContext): void {
    const w = this.world
    const party = this.party
    switch (this.state) {
      case 'fade':
        if (this.visibleFully) {
          this.goToPlace()
          this.state = 'toPlace'
        }
        break
      case 'toPlace':
        if (this.done) {
          this.state = 'atPlace'
          if (this.isLeader) {
            party.phase = 'visit'
            party.visitStartedAt = w.t
            if (party.collecting) {
              // a family: wait for the patient to be dressed
              party.visitUntil = Infinity
              party.collecting.arrived = true
            } else if (!this.patientHere()) {
              // the patient went home (or the bed is empty): no visit
              party.noVisit = true
              party.visitUntil = w.t
            } else {
              party.visitUntil = w.t + this.vrng.between(CONFIG.visitors.visitSeconds)
              this.greetPatient(ctx)
            }
          }
        }
        break
      case 'atPlace':
        this.atPlace(dt, ctx)
        break
      case 'standing':
        if (this.done) this.leaveFor(this.next)
        break
      case 'toCafe':
        if (this.done) {
          this.entity.prop = 'coffee'
          this.state = 'cafe'
          if (this.isLeader) party.cafeUntil = w.t + this.vrng.between(CONFIG.visitors.cafeSeconds)
        }
        break
      case 'cafe':
        if (this.isLeader && w.t >= party.cafeUntil) party.phase = 'exit'
        if (party.phase === 'exit' && this.seen !== 'exit') this.begin('exit')
        break
      case 'toExit':
        if (this.done && !this.fadingOut) this.fadeOut()
        break
    }
  }

  private atPlace(dt: number, ctx: PeopleContext): void {
    const w = this.world
    const party = this.party
    if (this.place.kind === 'window') {
      this.talkTimer -= dt
      if (this.talkTimer <= 0) {
        this.talkTimer = this.vrng.range(5, 12)
        this.entity.anim = this.entity.anim === 'talk' ? 'idle' : 'talk'
      }
    }
    if (this.isLeader) {
      if (this.entity.prop === 'flowers') {
        this.flowersTimer -= dt
        if (this.flowersTimer <= 0) this.entity.prop = 'none'
      }
      this.heartTimer -= dt
      if (this.heartTimer <= 0) {
        this.heartTimer = this.vrng.range(120, 300)
        this.greetPatient(ctx)
      }
      if (party.phase === 'visit') {
        const c = party.collecting
        if (c) {
          if (c.release) this.endCollecting()
        } else if (w.t >= party.visitUntil || !this.patientHere()) this.endVisit()
      }
    }
    if (party.phase !== 'visit' && party.phase !== 'arriving' && this.seen !== party.phase) this.begin(party.phase)
  }

  private greetPatient(ctx: PeopleContext): void {
    if (this.place.kind === 'lounge') return
    this.world.wardPatients.get(this.party.room.id)?.visited(ctx)
  }

  private goToPlace(): void {
    const room = this.party.room
    const p = this.place
    if (p.kind === 'window') this.moveTo(p.at, { face: headingTo(p.at, room.bed), leader: this.isLeader ? undefined : this.party.members[0] })
    else this.sitOn(p.seat, { leader: this.isLeader ? undefined : this.party.members[0] })
  }

  /** Is the patient this party came for the one lying in the bed now? */
  private patientHere(): boolean {
    const p = this.world.wardPatients.get(this.party.room.id)
    return p !== undefined && p.entity.name === this.party.patientName
  }

  /** The patient is dressed and ready: the family goes out behind them. */
  private endCollecting(): void {
    const party = this.party
    party.visitMinutes = Math.max(1, Math.round((this.world.t - party.visitStartedAt) / 60))
    party.phase = 'exit'
  }

  /** The leader decides what comes after the visit: a coffee (if two cafe seats are free) or home. */
  private endVisit(): void {
    const w = this.world
    const party = this.party
    party.visitMinutes = Math.max(1, Math.round((w.t - party.visitStartedAt) / 60))
    this.book.endParty(party.room.id)
    const alive = party.members.filter((m) => !m.gone)
    if (!party.noVisit && this.vrng.chance(CONFIG.visitors.cafeChance) && w.seats.free({ kind: 'cafe' }).length >= alive.length) {
      let near: Vec2 = ATRIUM.cafe.at
      let ok = true
      for (const m of alive) {
        const seat = w.seats.claim(m.entity.id, { kind: 'cafe' }, near)
        if (!seat) {
          ok = false
          break
        }
        party.cafeSeats.set(m.entity.id, seat)
        near = { x: seat.x, z: seat.z }
      }
      if (ok) {
        party.phase = 'cafe'
        return
      }
      for (const m of alive) w.seats.releaseBy(m.entity.id)
      party.cafeSeats.clear()
    }
    party.phase = 'exit'
  }

  /** Stand up from wherever they are, then go to the café or the exit. */
  private begin(phase: 'cafe' | 'exit'): void {
    this.seen = phase
    this.next = phase
    if (this.place.kind === 'window') this.book.releaseWindow(this.party.room.id, this.entity.id)
    if (phase === 'exit') {
      // a seat at the bedside, in the lounge or in the café is free the moment they get up
      this.world.seats.releaseBy(this.entity.id)
      if (this.isLeader) {
        const p = this.party
        const text = p.collecting
          ? `${this.entity.name} left with ${p.patientName}.`
          : p.noVisit
            ? `${this.entity.name} found ${p.patientName} had gone home and left.`
            : `${this.entity.name} left after a ${p.visitMinutes} min visit.`
        this.world.say('visitorLeft', text, { subjectId: this.entity.id, roomId: p.room.id })
      }
    } else if (this.place.kind !== 'window') {
      // keep the café seat (claimed already), drop the chair or lounge seat
      const keep = this.party.cafeSeats.get(this.entity.id)
      if (this.seat && this.seat !== keep) this.world.seats.release(this.seat.id)
    }
    if (this.seat) {
      this.state = 'standing'
      this.standUp()
    } else {
      this.leaveFor(phase)
    }
  }

  private leaveFor(phase: 'cafe' | 'exit'): void {
    if (phase === 'cafe') {
      const seat = this.party.cafeSeats.get(this.entity.id)
      if (!seat) {
        this.leaveFor('exit')
        return
      }
      this.sitOn(seat)
      this.state = 'toCafe'
    } else {
      this.entity.prop = this.entity.prop === 'coffee' ? 'none' : this.entity.prop
      // a family walks out behind the patient (or the porter with their wheelchair)
      const escort = this.party.collecting?.escort() ?? null
      this.moveTo(DEPARTURES.entrance, escort ? { leader: escort } : {})
      this.state = 'toExit'
    }
  }

  override onRemoved(world: World): void {
    world.seats.releaseBy(this.entity.id)
    this.book.releaseWindow(this.party.room.id, this.entity.id)
    world.releaseName(this.entity.name)
  }
}
