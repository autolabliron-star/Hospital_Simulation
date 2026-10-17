/**
 * The night cleaner (L1): while the building is quiet she deep-cleans the public areas. The same patrol as the day
 * cleaners (lobby, spine, both corridors, atrium: er/spots.ts PATROL), but she mops at every stop, for twice as long, and
 * pushes her cart slowly. An ER bay that needs cleaning still comes first, exactly as for the day cleaners (same board,
 * same `bayCleaned` event).
 *
 * After the ER bays she takes a ward room that needs cleaning (the bed board's room-clean job), like the day cleaners
 * (see Cleaner in er/cleaner.ts); discharges are planned for the day, so this rarely happens at night.
 */
import type { StaffMember } from '@/content/staff'
import { CONFIG } from '../config'
import { bedsideSpot } from '../beds/spots'
import type { PeopleContext } from '../person'
import type { Rng } from '../rng'
import type { RoomId } from '../types'
import type { Walker } from '../walker'
import { Actor } from '../er/actor'
import type { ErBay } from '../er/department'
import { PATROL, seatSpot } from '../er/spots'
import type { World } from '../er/world'

/** She mops this many times as long as a day cleaner does. */
export const DEEP_MOP_FACTOR = 2

type State = 'patrol' | 'gap' | 'mopping' | 'toBay' | 'cleaning' | 'toRoom' | 'roomCleaning'

export class DeepCleaner extends Actor {
  private state: State = 'gap'
  private stop: number
  private timer: number
  private bay: ErBay | null = null
  private room: RoomId | null = null
  private cleanFor = 0
  /** Set by the day rhythm when her shift is ending: no new bay, wait to hand over. */
  retiring = false

  constructor(
    readonly world: World,
    readonly staff: StaffMember,
    readonly index: number,
    walker: Walker,
    private readonly srng: Rng,
  ) {
    super(staff.id, 'cleaner', staff.name, PATROL[index * 5].at, 0, walker, 'role')
    this.stop = index * 5
    this.timer = srng.between(CONFIG.staffLife.idleGapSeconds)
    this.setVehicle('cleaningCart')
    this.walkAnim = 'push'
    this.idleAnim = 'idle'
    this.cruise = 0.85
  }

  /** Not on an ER bay or a ward room: she may be taken off duty (mopping a hall is easy to stop). */
  get atRest(): boolean {
    return !this.working
  }

  private get working(): boolean {
    return this.state === 'toBay' || this.state === 'cleaning' || this.state === 'toRoom' || this.state === 'roomCleaning'
  }

  think(dt: number, _ctx: PeopleContext): void {
    if (!this.working && !this.retiring && this.due(dt)) {
      const bay = this.world.er.claimClean(this.staff.id)
      if (bay) {
        this.bay = bay
        this.moveTo(seatSpot(bay.seat, 'foot'), { face: Math.atan2(bay.seat.x - bay.seat.approach.x, bay.seat.z - bay.seat.approach.z) })
        this.state = 'toBay'
        return
      }
      // no ER bay waits: a ward room that needs cleaning (L1 bed flow), exactly as for the day cleaners
      const job = this.world.beds?.claimClean(this.staff.id, this.world.t)
      if (job) {
        this.room = job.roomId
        this.cleanFor = job.seconds
        const spot = bedsideSpot(job.roomId)
        this.moveTo(spot.at, { face: spot.heading })
        this.state = 'toRoom'
        return
      }
    }
    switch (this.state) {
      case 'gap':
        this.timer -= dt
        if (this.timer <= 0) {
          this.stop = (this.stop + 1) % PATROL.length
          this.moveTo(PATROL[this.stop].at)
          this.state = 'patrol'
        }
        break
      case 'patrol':
        if (this.done) {
          // a deep clean: every stop is mopped, for longer
          this.entity.anim = 'clean'
          this.timer = this.srng.between(CONFIG.staffLife.mopSeconds) * DEEP_MOP_FACTOR
          this.state = 'mopping'
        }
        break
      case 'mopping':
        this.entity.anim = 'clean'
        this.timer -= dt
        if (this.timer <= 0) {
          this.entity.anim = 'idle'
          this.timer = 1
          this.state = 'gap'
        }
        break
      case 'toRoom':
        if (this.done) {
          this.entity.anim = 'clean'
          this.timer = this.cleanFor
          this.world.beds?.cleanStarted(this.room!, this.world.t)
          this.state = 'roomCleaning'
        }
        break
      case 'roomCleaning':
        this.entity.anim = 'clean'
        this.timer -= dt
        if (this.timer <= 0) {
          this.world.beds?.cleanFinished(this.room!, this.world.t)
          this.room = null
          this.entity.anim = 'idle'
          this.timer = 1
          this.state = 'gap'
        }
        break
      case 'toBay':
        if (this.done) {
          this.entity.anim = 'clean'
          this.timer = this.srng.between(CONFIG.er.cleanSeconds)
          this.state = 'cleaning'
        }
        break
      case 'cleaning':
        this.entity.anim = 'clean'
        this.timer -= dt
        if (this.timer <= 0) {
          const bay = this.bay!
          this.world.er.finishClean(bay, this.world.t)
          this.world.say('bayCleaned', `ER bay ${bay.index + 1} is clean and ready.`, { actorId: this.staff.id })
          this.bay = null
          this.entity.anim = 'idle'
          this.timer = 1
          this.state = 'gap'
        }
        break
    }
  }
}
