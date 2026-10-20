/**
 * W4 health kiosks: walk-up visitors. People from outside who come in to have their vitals checked: they enter at the entrance in everyday clothes,
 * stand in the kiosk line, take a full session and leave by the entrance.
 *
 *   fade -> (joined the line, told where to stand, called, kiosk session) -> toExit -> gone
 *
 * The line and the kiosk drive them through the `KioskSubject` callbacks (and `kioskQueued`, so they know where to stand in the line); the controller
 * itself only joins the line when it has faded in, and walks out when it is done.
 *
 * The rate is CONFIG.vitals.walkUpsPerHour PER KIOSK (research: a station sees 20-60 sessions a day; the table integrates to about 35 a day for one),
 * so the hospital's arrivals are the table times the number of kiosks. Arrivals are a seeded Poisson process (the same thinning the ER's arrivals use).
 */
import { CONFIG } from '../config'
import { Actor } from '../er/actor'
import type { World } from '../er/world'
import type { PeopleContext } from '../people'
import { ArrivalProcess } from '../population/schedule'
import { ARRIVALS, DEPARTURES, HEALTH_KIOSKS, type Spot } from '../places'
import type { Rng } from '../rng'
import type { VitalsReading } from '../types'
import type { Walker } from '../walker'
import type { QueueAwareSubject } from './line'

type State = 'fade' | 'waiting' | 'toExit' | 'gone'

/** What a walk-up needs of the kiosk service. */
export interface WalkUpHost {
  /** Join the line for a full session. False when there is no room. */
  offer(subject: QueueAwareSubject, kind: 'full'): boolean
  /** Leave the line or the kiosk (the person is leaving the simulation). */
  abort(personId: string): void
  /** Told once the person has left the simulation. */
  walkUpGone(w: WalkUp): void
}

export class WalkUp extends Actor implements QueueAwareSubject {
  state: State = 'fade'
  /** Sim time they arrived, and when they started walking out (-1 until then); for the tests. */
  readonly arrivedAt: number
  leftAt = -1
  /** The reading they went home with (partial or not), if any. */
  reading: VitalsReading | null = null
  /** The stool they were last sent to (null once they are called back to the platform): the in-flight warm-up snaps them onto it. */
  private stool: Spot | null = null

  constructor(
    private readonly host: WalkUpHost,
    private readonly world: World,
    id: string,
    name: string,
    at: { x: number; z: number },
    heading: number,
    walker: Walker,
  ) {
    super(id, 'visitor', name, at, heading, walker, 'everyday')
    this.crowdWalker = world.walkerFor
    this.arrivedAt = world.t
    this.cruise = CONFIG.visitors.walkSpeed * (0.92 + (this.entity.variant % 17) / 100)
  }

  get id(): string {
    return this.entity.id
  }
  get name(): string {
    return this.entity.name
  }

  think(_dt: number, _ctx: PeopleContext): void {
    switch (this.state) {
      case 'fade':
        if (!this.visibleFully) break
        if (this.host.offer(this, 'full')) {
          this.state = 'waiting'
          this.entity.mood = 'waiting'
        } else this.leave()
        break
      case 'toExit':
        if (this.done && !this.fadingOut) {
          this.state = 'gone'
          this.fadeOut()
        }
        break
      default:
        break
    }
  }

  // --- the kiosk's side ------------------------------------------------------------------------------------

  kioskQueued(spot: Spot, place: number): void {
    if (this.state !== 'waiting') return
    this.entity.mood = 'waiting'
    this.showEmote(place > 0 ? 'hourglass' : 'none', this.world.t)
    this.moveTo(spot.at, { face: spot.heading })
  }

  kioskCalled(_index: number, stand: Spot): void {
    if (this.state !== 'waiting') return
    this.entity.mood = 'neutral'
    this.showEmote('none', this.world.t)
    this.stool = null
    this.goTo(stand, 0.9)
  }

  kioskForced(stand: Spot): void {
    if (this.state !== 'waiting') return
    this.slideTo(stand.at.x, stand.at.z, stand.heading, 0.9, 'stand')
  }

  kioskSit(seat: Spot): void {
    if (this.state !== 'waiting') return
    this.stool = seat
    this.slideTo(seat.at.x, seat.at.z, seat.heading, 1.2, 'stand')
  }

  kioskDone(reading: VitalsReading): void {
    this.reading = reading
    this.entity.mood = 'happy'
    this.showEmote('check', this.world.t, 5)
    this.leave()
  }

  /** S1 in-flight warm: whoever was sent to the stool is already sitting on it (no glide left to play). */
  settleOnStool(): void {
    if (this.stool === null) return
    this.placeAt(this.stool.at.x, this.stool.at.z, this.stool.heading)
  }

  /** A short step (the stool to the platform) glides; a longer one walks. Somebody already on the spot stays put (no glide to nowhere). */
  private goTo(spot: Spot, glideWithin: number): void {
    const away = Math.hypot(this.x - spot.at.x, this.z - spot.at.z)
    if (away < 0.05 && this.mode === 'static') {
      this.entity.heading = spot.heading
      return
    }
    if (Math.hypot(this.x - spot.at.x, this.z - spot.at.z) < glideWithin && this.mode === 'static') this.slideTo(spot.at.x, spot.at.z, spot.heading, 1.0, 'stand')
    else this.moveTo(spot.at, { face: spot.heading })
  }

  leave(): void {
    if (this.state === 'toExit' || this.state === 'gone') return
    this.state = 'toExit'
    this.leftAt = this.world.t
    this.cruise = Math.max(this.cruise, CONFIG.er.walkSpeed)
    this.moveTo(DEPARTURES.entrance)
  }

  override onRemoved(world: World): void {
    this.host.abort(this.entity.id)
    world.seats.releaseBy(this.entity.id)
    world.releaseName(this.entity.name)
    this.host.walkUpGone(this)
  }
}

/** The walk-up arrivals: a seeded Poisson process of the config table times the number of kiosks. */
export class WalkUpSpawner {
  private process: ArrivalProcess | null = null
  private nextAt = Infinity
  /** Arrivals that found the line full (or the hospital's walk-up cap reached) and walked on. */
  skipped = 0
  spawned = 0

  constructor(
    private readonly world: World,
    private readonly rng: Rng,
    private readonly walkerFor: (id: string) => Walker,
    private readonly add: (w: WalkUp) => void,
    private readonly host: WalkUpHost,
    /** Is there room for another walk-up now? */
    private readonly room: () => boolean,
  ) {}

  /** Start the clock at sim time `t0` (the first step of a run, or of a warm start). */
  start(t0: number): void {
    const curve = CONFIG.vitals.walkUpsPerHour.map(([h, v]) => [h, v * HEALTH_KIOSKS.length] as const)
    this.process = new ArrivalProcess(this.rng.fork('arrivals'), curve, t0)
    this.nextAt = this.process.next()
  }

  get started(): boolean {
    return this.process !== null
  }

  step(t: number): void {
    const p = this.process
    if (p === null) return
    while (t >= this.nextAt) {
      this.spawn()
      this.nextAt = p.next()
    }
  }

  /**
   * S1 in-flight warm: a visitor already standing on `spot` (a kiosk platform), fully visible, who has joined the line. The next dispatch calls them
   * at once, and as they are on the platform the session starts on the spot. Null when the line has no room.
   */
  spawnAt(spot: Spot, rng: Rng = this.rng): WalkUp | null {
    const w = this.world
    const id = w.id('hk')
    const name = w.uniqueName(rng)
    const person = new WalkUp(this.host, w, id, name, { x: spot.at.x, z: spot.at.z }, spot.heading, this.walkerFor(id))
    this.add(person)
    this.spawned++
    if (!this.host.offer(person, 'full')) {
      person.leave()
      return null
    }
    person.state = 'waiting'
    return person
  }

  private spawn(): void {
    if (!this.room()) {
      this.skipped++
      return
    }
    const w = this.world
    const id = w.id('hk')
    const name = w.uniqueName(this.rng)
    const at = { x: ARRIVALS.entrance.at.x, z: ARRIVALS.entrance.at.z + this.rng.range(-0.8, 0.8) }
    const person = new WalkUp(this.host, w, id, name, at, ARRIVALS.entrance.heading, this.walkerFor(id))
    person.fadeIn()
    this.add(person)
    this.spawned++
  }
}
