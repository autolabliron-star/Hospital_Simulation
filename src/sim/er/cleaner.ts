/**
 * Cleaner: cleans an ER bay the moment it needs it (40-60 s with the cart, then the 'ER bay N is clean and ready'
 * event), and otherwise patrols a slow loop - lobby, spine, both corridors, atrium - stopping to mop for 10-20 s at a
 * few spots. The stops are chosen outside every doorway (checked in tests).
 *
 * L1: after the ER bays, a ward room whose patient has gone home (a room-clean job from the bed board): the cleaner
 * pushes the cart into the room, cleans beside the bed for 6-9 minutes (the porter brings fresh linen meanwhile) and the
 * bed is ready. One cleaner at a time takes a room, so the other is always free for an ER bay.
 */
import { erLine } from '@/content/erEvents'
import type { StaffMember } from '@/content/staff'
import { CONFIG } from '../config'
import { bedsideSpot } from '../beds/spots'
import type { PeopleContext } from '../person'
import type { Rng } from '../rng'
import type { RoomId } from '../types'
import type { Walker } from '../walker'
import { Actor } from './actor'
import type { ErBay } from './department'
import { PATROL, seatSpot } from './spots'
import type { World } from './world'

type State = 'patrol' | 'gap' | 'mopping' | 'toBay' | 'cleaning' | 'toRoom' | 'roomCleaning'

export class Cleaner extends Actor {
  private state: State = 'gap'
  private stop: number
  private timer: number
  private cleanFor = 0
  private bay: ErBay | null = null
  private room: RoomId | null = null

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
    this.cruise = 0.95
  }

  think(dt: number, _ctx: PeopleContext): void {
    if (this.state !== 'toBay' && this.state !== 'cleaning' && this.state !== 'toRoom' && this.state !== 'roomCleaning' && this.due(dt)) {
      const bay = this.world.er.claimClean(this.staff.id)
      if (bay) {
        this.bay = bay
        this.moveTo(seatSpot(bay.seat, 'foot'), { face: Math.atan2(bay.seat.x - bay.seat.approach.x, bay.seat.z - bay.seat.approach.z) })
        this.state = 'toBay'
        return
      }
      // no ER bay waits: a ward room that needs cleaning (a 30-60 minute job, so the second cleaner takes one only while the ER is quiet:
      // a bay must never wait half an hour for a cleaner)
      const job = this.index === 0 || this.world.er.freeBays >= 3 ? this.world.beds?.claimClean(this.staff.id, this.world.t) : undefined
      if (job) {
        this.room = job.roomId
        this.cleanFor = job.seconds
        const s = bedsideSpot(job.roomId)
        this.moveTo(s.at, { face: s.heading })
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
          if (PATROL[this.stop].mop && this.srng.chance(0.75)) {
            this.entity.anim = 'clean'
            this.timer = this.srng.between(CONFIG.staffLife.mopSeconds)
            this.state = 'mopping'
          } else {
            this.timer = this.srng.between(CONFIG.staffLife.idleGapSeconds)
            this.state = 'gap'
          }
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
          this.world.say('bayCleaned', erLine('cleaner.bayCleaned', { bay: bay.index + 1 }), { actorId: this.staff.id })
          this.bay = null
          this.entity.anim = 'idle'
          this.timer = 1
          this.state = 'gap'
        }
        break
    }
  }
}
