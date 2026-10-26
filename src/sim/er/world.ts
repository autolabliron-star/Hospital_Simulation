/**
 * The services every M3 person shares: the event log, the seat registry, the ER board, the porters' board, the
 * check-in queues, the sim-time clock for the pathway machines and the list of who rides with whom. Created once by
 * the Simulation and handed to controllers through `PeopleContext.world`.
 */
import { PATIENTS } from '@/content/catalogue'
import { syntheticName } from '@/content/roster'
import type { EventLog } from '../events'
import type { BedBoard } from '../beds/board'
import type { Patient, Person } from '../people'
import { DEPARTURES, VEHICLE_AHEAD } from '../places'
import { VisitBook } from '../population/visitBook'
import type { Rng } from '../rng'
import type { SeatFilter, SeatRegistry } from '../seats'
import type { Walker } from '../walker'
import type { RoomId, SeatSpec, SimEvent, SimEventType, Vec2 } from '../types'
import type { ImagingDepartment } from '../imaging/department'
import type { Actor } from './actor'
import { BedsideBloods } from './bedside'
import { ErDepartment } from './department'
import type { ErPatient } from './patient'
import { PorterBoard } from './porterBoard'
import type { QueueLike } from './ports'
import { SimClock } from './simClock'
import type { DrawCentre } from '../blood'
import type { Lab } from '../lab'
import type { LiftBank } from '../lifts'
import type { Surgery } from '../surgery'
import type { CryoSuite } from '../cryoSuite'
import type { VitalsService } from '../vitals'

export interface WorldHooks {
  add(p: Person): void
  remove(p: Person): void
}

/** What the ambient-people manager offers the rest of the world: make room when a patient needs a seat. */
export interface AmbientLike {
  /** Ask one ambient person sitting in a matching seat to give it up and leave. True if one did. */
  evictOne(filter: SeatFilter): boolean
}

export interface RidePair {
  pusher: Actor
  rider: Actor
}

export type EventRefs = Omit<SimEvent, 'id' | 't' | 'type' | 'text'>

export class World {
  t = 0
  readonly clock = new SimClock()
  readonly er: ErDepartment
  readonly porters = new PorterBoard()
  /** The ER nurse's bedside bloods and their way to the lab (Wave 1). */
  readonly bedside = new BedsideBloods(this)
  /** ER patients by id (the department's cases hold the data; these hold the people). */
  readonly patients = new Map<string, ErPatient>()
  readonly pairs: RidePair[] = []
  /** Who is being served at the reception desk and the two kiosks right now. */
  readonly serverBusy = { reception: false, kiosk: [false, false] as boolean[] }
  ambient: AmbientLike | null = null
  /** The imaging department (scanners, bookings, outpatients), set by the Simulation; null in a bare world. */
  imaging: ImagingDepartment | null = null
  /** W4 smart diagnostics, set by the Simulation; null in a bare world (ER bloods then fall back to the M3 timers). */
  vitals: VitalsService | null = null
  blood: DrawCentre | null = null
  lab: Lab | null = null
  /** R2: the lifts and the robotic surgery suite on level 2, set by the Simulation; null in a bare world. */
  lifts: LiftBank | null = null
  surgery: Surgery | null = null
  /** R4: the CT-guided cryoablation suite on level 2, set by the Simulation; null in a bare world. */
  cryoSuite: CryoSuite | null = null
  /**
   * The bed board (L1): the lifecycle of the 16 ward beds and the bed manager's rules, set by the Simulation's BedFlow;
   * null in a bare world (the ER and the porters then behave as in M3: admitted patients go "to a ward upstairs").
   */
  beds: BedBoard | null = null
  /** Who visits which room (parties, window spots): shared by the director's visitors and the families collecting a patient. */
  readonly visits = new VisitBook()
  /** ER patients lying in their new ward bed, waiting for the bed flow to make them ward patients (drained every step). */
  readonly bedHandovers: ErPatient[] = []
  /** Porters standing at their base with nothing to do (linen runs only start when two are free). */
  readonly idlePorters = new Set<string>()
  /** True while one porter is on a linen run (only one at a time: two wide carts cannot pass in a corridor). */
  linenRun = false
  /** Paramedic crews on site (an ambulance waits for the last crew to leave). */
  crewsOnSite = 0
  private readonly names = new Set<string>()
  private readonly counters = new Map<string, number>()
  private bayPoll = 0

  constructor(
    readonly log: EventLog,
    readonly seats: SeatRegistry,
    readonly rng: Rng,
    readonly hooks: WorldHooks,
    readonly reception: QueueLike,
    readonly kiosks: QueueLike[],
    /** The patient lying in each occupied ward bed; the bed board keeps it up to date (rooms of empty beds are absent). */
    readonly wardPatients: Map<RoomId, Patient>,
    /** Makes a walker for a person (a member of the hospital's crowd). */
    readonly walkerFor: (id: string) => Walker,
  ) {
    this.er = new ErDepartment(seats)
    for (const p of PATIENTS) this.names.add(p.name)
  }

  /** Advance the shared machinery one step (call before the people update). */
  step(t: number, dt: number): void {
    this.t = t
    this.clock.advanceTo(t * 1000)
    this.er.trackCleaning(t)
    this.bayPoll += dt
    if (this.bayPoll >= 0.25) {
      this.bayPoll = 0
      for (const c of this.er.assignBays(t)) this.patients.get(c.id)?.bayAssigned()
    }
  }

  /** S1: true while a warm start places work already under way (nothing it does is news). */
  quiet = false

  say(type: SimEventType, text: string, refs: EventRefs = {}): void {
    if (this.quiet) return
    this.log.push(this.t, type, text, refs)
  }

  /** Sequential ids per prefix: 'er-1', 'er-2', ... */
  id(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, n)
    return `${prefix}-${n}`
  }

  /** A fictional name nobody on site has right now. */
  uniqueName(rng: Rng): string {
    for (let i = 0; i < 12; i++) {
      const n = syntheticName(rng)
      if (!this.names.has(n)) {
        this.names.add(n)
        return n
      }
    }
    const n = syntheticName(rng)
    this.names.add(n)
    return n
  }

  releaseName(name: string): void {
    this.names.delete(name)
  }

  /** Mark a name as taken (a synthetic ward patient from the bed book). */
  claimName(name: string): void {
    this.names.add(name)
  }

  /**
   * A waiting-room seat. `group` is the row family the person prefers ('triage': north rows, by the triage door; 'er':
   * south rows, by the ER door). If the lobby is full, an ambient person gives up a seat: patients and their
   * companions come before people just resting.
   */
  claimWaitingSeat(id: string, group: 'triage' | 'er', near?: Vec2): SeatSpec | null {
    const lobby: SeatFilter = { kind: 'waiting', area: 'lobby' }
    const take = () => this.seats.claim(id, { ...lobby, group }, near) ?? this.seats.claim(id, lobby, near)
    const seat = take()
    if (seat) return seat
    if (this.ambient && (this.ambient.evictOne({ ...lobby, group }) || this.ambient.evictOne(lobby))) return take()
    return null
  }

  /** The lift standing spot nearest to a point. */
  liftFor(p: Vec2): Vec2 {
    let best = DEPARTURES.lifts[0]
    for (const l of DEPARTURES.lifts) if (Math.hypot(l.x - p.x, l.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = l
    return best
  }

  // --- riders --------------------------------------------------------------------------------------

  attach(pusher: Actor, rider: Actor): void {
    pusher.rider = rider
    this.pairs.push({ pusher, rider })
  }

  detach(rider: Actor): void {
    const i = this.pairs.findIndex((p) => p.rider === rider)
    if (i < 0) return
    this.pairs[i].pusher.rider = null
    this.pairs.splice(i, 1)
  }

  /**
   * Put every rider in 'ride' mode ahead of the person pushing (VEHICLE_AHEAD: 0.8 m for a wheelchair, 1.45 m for a
   * stretcher, the offsets the crowd renderer draws at), facing the way the pusher faces. Allocation-free.
   */
  placeRiders(): void {
    for (let i = 0; i < this.pairs.length; i++) {
      const { pusher, rider } = this.pairs[i]
      if (rider.mode !== 'ride') continue
      const ahead = VEHICLE_AHEAD[rider.entity.vehicle ?? 'none']
      const h = pusher.walker.heading
      rider.walker.place(pusher.walker.x + Math.sin(h) * ahead, pusher.walker.z + Math.cos(h) * ahead, h)
    }
  }
}
