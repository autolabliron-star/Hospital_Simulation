/**
 * A booked outpatient (or the presenter's demo patient): arrives at the entrance a little before the appointment, checks in
 * at a kiosk or the reception desk like everyone else, sits in the imaging hall until the radiographer comes out to call
 * them, is scanned (the scanner's session drives them from there), and goes home by the entrance. After an MRI they change
 * back out of the gown first.
 *
 *   fade -> queueing -> serving -> toHall -> waiting -> scan -> afterScan -> [changeBack] -> toExit
 *
 * The demo patient skips check-in: they appear in the hall in front of the scanner's door and wait there.
 */
import { CONFIG } from '../config'
import { clockText } from '../events'
import { Actor } from '../er/actor'
import type { QueueLike } from '../er/ports'
import type { World } from '../er/world'
import type { PeopleContext } from '../people'
import { DEPARTURES } from '../places'
import type { Rng } from '../rng'
import type { ScannerState, SeatSpec, Vec2 } from '../types'
import type { Walker } from '../walker'
import { ageWalkFactor, drawVisitorAge } from '../population/age'
import type { Booking, ScanSubject } from './booking'
import type { CubiclePool, ImagingSites, ScannerSites } from './sites'

type State = 'fade' | 'queueing' | 'serving' | 'toHall' | 'waiting' | 'scan' | 'afterScan' | 'changeBack' | 'changing' | 'toExit' | 'gone'
type QueueKey = 'reception' | 'kiosk0' | 'kiosk1'

export interface OutpatientServices {
  world: World
  sites: ImagingSites
  cubicles: CubiclePool
  /** Hall standing spots in use (the hall's chairs are full). */
  standing: Set<number>
  /** Told once the person has left the simulation. */
  gone(o: Outpatient): void
}

export class Outpatient extends Actor implements ScanSubject {
  readonly transported = false
  state: State = 'fade'
  private queue: QueueLike | null = null
  private queueKey: QueueKey = 'kiosk0'
  private queueIdx = -2
  private timer = 0
  private retry = 0
  private standIdx = -1
  private serving = false
  /** Sim time they were released from the table (for tests). */
  releasedAt = -1
  /** True once they have started the walk out. */
  home = false
  private cubicleOutfit = false

  constructor(
    private readonly svc: OutpatientServices,
    readonly booking: Booking,
    id: string,
    name: string,
    at: Vec2,
    heading: number,
    walker: Walker,
    private readonly orng: Rng,
    private readonly demo: boolean,
    /** The person's age (content outpatients); the demo and placed patients get a seeded adult age. */
    readonly age: number = drawVisitorAge(orng.fork('age')),
  ) {
    super(id, 'patient', name, at, heading, walker, 'everyday')
    this.entity.mood = 'neutral'
    this.cruise = CONFIG.er.walkSpeed * (0.9 + (this.entity.variant % 20) / 100) * ageWalkFactor(age)
  }

  get actor(): Actor {
    return this
  }
  get id(): string {
    return this.entity.id
  }
  get name(): string {
    return this.entity.name
  }

  // --- the scanner's side ------------------------------------------------------------------------------------

  scanAssigned(_sites: ScannerSites, _state: ScannerState): void {
    this.state = 'scan'
    this.entity.emote = 'none'
    this.entity.mood = 'neutral'
  }

  scanCalled(): void {
    this.state = 'scan'
    this.entity.emote = 'none'
    this.entity.mood = 'neutral'
    this.releaseHall()
  }

  scanRequestReturn(): void {}
  scanFinished(): void {}
  reportReady(): void {}

  scanReleased(): void {
    this.releasedAt = this.svc.world.t
    this.state = 'afterScan'
    this.entity.mood = 'happy'
    this.showEmote('check', this.svc.world.t, 8)
    if (this.seat) this.standUp()
  }

  /**
   * S1 in-flight warm: this person is already on the scanner's table (the scanner placed them); their state machine is in the
   * scanner-owned state, so after the exam they get off, change back and leave like any outpatient.
   */
  warmOnTable(): void {
    this.state = 'scan'
    this.booking.ready = true
    this.entity.mood = 'neutral'
    this.entity.emote = 'none'
  }

  /**
   * S1 in-flight warm: this person has already checked in and sits in the imaging hall waiting for their scanner (a chair if
   * one is free, else a standing spot). Returns false if the hall has no place at all.
   */
  warmWaiting(): boolean {
    const w = this.svc.world
    const seat = w.seats.claim(this.id, { kind: 'waiting', area: 'imagingHall' }, this.pos)
    if (seat) this.placeOnSeat(seat)
    else {
      const spots = this.svc.sites.hallStand
      let i = 0
      while (i < spots.length && this.svc.standing.has(i)) i++
      if (i >= spots.length) return false
      this.standIdx = i
      this.svc.standing.add(i)
      this.placeAt(spots[i].x, spots[i].z, Math.PI)
    }
    this.state = 'waiting'
    this.booking.ready = true
    this.entity.mood = 'waiting'
    this.showEmote('hourglass', w.t)
    return true
  }

  // --- the person ------------------------------------------------------------------------------------------

  think(dt: number, _ctx: PeopleContext): void {
    const w = this.svc.world
    switch (this.state) {
      case 'fade':
        if (!this.visibleFully) break
        if (this.demo) {
          // the demo patient has no check-in: they stand in the hall until the radiographer comes
          this.state = 'waiting'
          this.entity.mood = 'waiting'
          break
        }
        w.say('outpatientArrived', `${this.name} arrived for their ${this.booking.protocolName} (booked ${clockText(this.booking.apptAt)}).`, { subjectId: this.id })
        this.entity.mood = 'waiting'
        this.showEmote('question', w.t)
        this.joinQueue()
        this.state = 'queueing'
        break
      case 'queueing':
        this.thinkQueue(dt)
        break
      case 'serving':
        this.timer -= dt
        if (this.timer <= 0) {
          this.leaveQueue()
          w.say('checkedIn', `${this.name} checked in for the ${this.booking.protocolName}.`, { subjectId: this.id })
          this.entity.mood = 'waiting'
          this.showEmote('hourglass', w.t)
          this.seekHall()
          this.state = 'toHall'
        }
        break
      case 'toHall':
        if (this.done) {
          this.state = 'waiting'
          this.booking.ready = true
        }
        break
      case 'waiting':
        // a standing patient keeps looking for a chair
        if (this.seat === null && this.done) {
          this.retry += dt
          if (this.retry >= 2) {
            this.retry = 0
            this.trySeat()
          }
        }
        break
      case 'scan':
        break
      case 'afterScan':
        if (this.done) {
          if (this.entity.outfit === 'gown') this.toCubicle()
          else this.leaveNow()
        }
        break
      case 'changeBack': {
        const c = this.svc.cubicles.claim(this.id)
        if (!c) break
        this.moveTo(c.at, { face: c.heading })
        this.state = 'changing'
        this.timer = this.orng.between(CONFIG.imaging.changeBackSeconds)
        this.cubicleOutfit = false
        break
      }
      case 'changing':
        if (!this.done) break
        this.timer -= dt
        if (this.timer <= 0 && !this.cubicleOutfit) {
          this.cubicleOutfit = true
          this.entity.outfit = 'everyday'
          this.svc.cubicles.release(this.id)
          this.leaveNow()
        }
        break
      case 'toExit':
        if (this.done && !this.fadingOut) {
          this.state = 'gone'
          this.fadeOut()
        }
        break
      case 'gone':
        break
    }
  }

  private toCubicle(): void {
    this.state = 'changeBack'
  }

  private leaveNow(): void {
    this.home = true
    this.cruise = Math.max(this.cruise, CONFIG.er.walkSpeed * ageWalkFactor(this.age))
    this.showEmote('none', this.svc.world.t)
    this.moveTo(DEPARTURES.entrance)
    this.state = 'toExit'
  }

  // --- check-in (the same lines as the ER patients use) ---------------------------------------------------------

  private queueOf(key: QueueKey): QueueLike {
    const w = this.svc.world
    return key === 'reception' ? w.reception : w.kiosks[key === 'kiosk0' ? 0 : 1]
  }

  private joinQueue(): void {
    const w = this.svc.world
    const k0 = w.kiosks[0].members.length
    const k1 = w.kiosks[1].members.length
    const kiosk: QueueKey = k1 < k0 ? 'kiosk1' : 'kiosk0'
    const other: QueueKey = kiosk === 'kiosk0' ? 'kiosk1' : 'kiosk0'
    const order: QueueKey[] = this.orng.chance(CONFIG.er.kioskShare) ? [kiosk, other, 'reception'] : ['reception', kiosk, other]
    for (const key of order) {
      const q = this.queueOf(key)
      const idx = q.join(this.id)
      if (idx >= 0) {
        this.queue = q
        this.queueKey = key
        this.queueIdx = idx
        const spot = q.spotFor(idx)
        this.moveTo(spot.at, { face: spot.heading })
        return
      }
    }
    this.queue = null
  }

  private leaveQueue(): void {
    if (!this.queue) return
    this.queue.leave(this.id)
    this.setServerBusy(false)
    this.queue = null
  }

  private setServerBusy(on: boolean): void {
    const s = this.svc.world.serverBusy
    this.serving = on
    if (this.queueKey === 'reception') s.reception = on
    else s.kiosk[this.queueKey === 'kiosk0' ? 0 : 1] = on
  }

  private serverBusy(): boolean {
    const s = this.svc.world.serverBusy
    return this.queueKey === 'reception' ? s.reception : s.kiosk[this.queueKey === 'kiosk0' ? 0 : 1]
  }

  private thinkQueue(dt: number): void {
    const q = this.queue
    if (!q) {
      this.retry += dt
      if (this.retry >= 1) {
        this.retry = 0
        this.joinQueue()
      }
      return
    }
    const idx = q.indexOf(this.id)
    if (idx < 0) return
    if (idx !== this.queueIdx) {
      this.queueIdx = idx
      const spot = q.spotFor(idx)
      this.moveTo(spot.at, { face: spot.heading })
      return
    }
    if (idx === 0 && this.done && !this.serverBusy()) {
      this.setServerBusy(true)
      this.timer = this.orng.between(CONFIG.er.checkInSeconds)
      this.state = 'serving'
    }
  }

  // --- the imaging hall ------------------------------------------------------------------------------------------

  private seekHall(): void {
    const w = this.svc.world
    const seat = w.seats.claim(this.id, { kind: 'waiting', area: 'imagingHall' }, this.pos)
    if (seat) {
      this.sitOn(seat)
      return
    }
    this.standInHall()
  }

  private standInHall(): void {
    const spots = this.svc.sites.hallStand
    if (spots.length === 0) {
      this.moveTo({ x: this.x, z: this.z })
      return
    }
    if (this.standIdx < 0) {
      for (let i = 0; i < spots.length; i++) {
        if (!this.svc.standing.has(i)) {
          this.standIdx = i
          this.svc.standing.add(i)
          break
        }
      }
      if (this.standIdx < 0) {
        this.standIdx = 0
      }
    }
    this.moveTo(spots[this.standIdx], { face: Math.PI })
  }

  /** A chair came free while we stand: take it. */
  private trySeat(): void {
    const seat: SeatSpec | null = this.svc.world.seats.claim(this.id, { kind: 'waiting', area: 'imagingHall' }, this.pos)
    if (!seat) return
    this.releaseHall()
    this.sitOn(seat)
    this.state = 'toHall'
  }

  private releaseHall(): void {
    if (this.standIdx >= 0) {
      this.svc.standing.delete(this.standIdx)
      this.standIdx = -1
    }
  }

  override onRemoved(world: World): void {
    this.releaseHall()
    if (this.serving) this.setServerBusy(false)
    if (this.queue) this.queue.leave(this.id)
    world.seats.releaseBy(this.id)
    this.svc.cubicles.release(this.id)
    world.releaseName(this.name)
    this.svc.gone(this)
  }
}
