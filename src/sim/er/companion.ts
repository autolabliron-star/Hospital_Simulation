/**
 * A companion: about a third of walk-in patients bring someone. They arrive together, wait beside the patient (a
 * seat next to theirs), stand at the bay while the patient is treated, and leave with them. The companion reads the
 * patient's pathway state each step and picks one simple behaviour: follow, sit beside, stand at the bay, or leave.
 */
import type { PeopleContext } from '../people'
import { DEPARTURES } from '../places'
import type { Rng } from '../rng'
import type { Vec2 } from '../types'
import { isWalkable } from '../nav/layout'
import type { Walker } from '../walker'
import { Actor } from './actor'
import type { ErPatient } from './patient'
import { inDoorway, seatSpot } from './spots'
import type { World } from './world'

export class Companion extends Actor {
  private leaveStage: 'none' | 'standing' | 'walking' | 'fading' = 'none'
  private exit: Vec2 = DEPARTURES.entrance
  private followAt = 0
  private seatTries = 0
  private standing: Vec2 | null = null

  constructor(
    readonly world: World,
    readonly patient: ErPatient,
    id: string,
    name: string,
    at: Vec2,
    heading: number,
    walker: Walker,
    rng: Rng,
  ) {
    super(id, 'visitor', name, at, heading, walker, 'everyday')
    this.entity.variant = (this.entity.variant + rng.int(0, 400)) % 1000
    this.entity.mood = 'neutral'
    this.cruise = patient.cruise
    patient.companion = this
  }

  think(dt: number, _ctx: PeopleContext): void {
    if (this.leaveStage !== 'none') {
      this.thinkLeave()
      return
    }
    const p = this.patient
    // The patient is going home or upstairs: go with them.
    if (p.isLeaving) {
      this.startLeaving(p.exitSpot)
      return
    }
    const s = p.state
    if (s === 'arriving' || s.startsWith('checkIn')) {
      this.follow(dt, 1.7)
      return
    }
    if (s.startsWith('triage')) return // the patient is in the triage hall: wait here (seated, or standing where we are)
    if (s === 'waitingTriage' || s === 'waitingDoctor') {
      this.waitBeside(dt)
      return
    }
    if (s === 'inBay.walking') {
      // wait where they are until the nurse has come for the patient, then go straight to the bay
      if (p.beingEscorted) {
        this.releaseSeat()
        this.standAtBay()
      } else this.waitBeside(dt)
      return
    }
    if (s.startsWith('inBay') || s.startsWith('tests') || s === 'decision' || s === 'admittedOut.waitingPorter') {
      this.releaseSeat()
      this.standAtBay()
      return
    }
    this.follow(dt, 1.7)
  }

  /** Walk after the patient when they are more than `gap` metres away (re-planned at most every 0.6 s). */
  private follow(dt: number, gap: number): void {
    this.followAt += dt
    if (this.followAt < 0.6) return
    this.followAt = 0
    if (this.seat) return
    const p = this.patient
    if (Math.hypot(p.walker.x - this.walker.x, p.walker.z - this.walker.z) <= gap) return
    const h = p.walker.heading
    const behind = { x: p.walker.x - Math.sin(h) * 1.0 + Math.cos(h) * 0.6, z: p.walker.z - Math.cos(h) * 1.0 - Math.sin(h) * 0.6 }
    // never aim at a wall, a doorway or the middle of a bed: stand where the patient stands if the spot behind is no good
    this.moveTo(isWalkable(behind.x, behind.z, 0.35) && !inDoorway(behind.x, behind.z) ? behind : { x: p.walker.x, z: p.walker.z })
  }

  /** While the patient waits (seated or not): sit in a seat next to theirs if one is free, else stand close. */
  private waitBeside(dt: number): void {
    const p = this.patient
    if (this.seat) return
    if (p.waitSeat && this.done) {
      this.seatTries += dt
      if (this.seatTries >= 1) {
        this.seatTries = 0
        const group = p.state === 'waitingTriage' ? 'triage' : 'er'
        // W4 fix: not seated, so any claim still held is stale (a seat walked away from): give it back before taking another,
        // or a companion collects several seats and a lobby that looks full empties at once when the party leaves
        this.world.seats.releaseBy(this.entity.id)
        const seat = this.world.claimWaitingSeat(this.entity.id, group, { x: p.waitSeat.x, z: p.waitSeat.z })
        if (seat) {
          this.sitOn(seat)
          return
        }
      }
    }
    this.follow(dt, 2.2)
  }

  private releaseSeat(): void {
    if (!this.seat) {
      this.dropClaim()
      return
    }
    this.world.seats.release(this.seat.id, this.entity.id)
    this.standUp()
  }

  /**
   * Give up a seat that is claimed but not reached yet (still walking or sliding onto it): the walk or slide must stop
   * too, or it would end on a seat somebody else holds by then.
   */
  private dropClaim(): void {
    const held = this.world.seats.seatOf(this.entity.id)
    if (!held) return
    this.world.seats.release(held.id)
    this.moveTo({ x: this.walker.x, z: this.walker.z })
  }

  /** Stand just outside the patient's bay, out of the way of the doctor and nurse. */
  private standAtBay(): void {
    const bay = this.patient.baySeat
    if (!bay || !this.done) return
    const spot = seatSpot(bay, 'companion')
    if (this.standing && Math.hypot(this.standing.x - spot.x, this.standing.z - spot.z) < 0.05) return
    this.standing = spot
    this.moveTo(spot, { face: Math.atan2(bay.x - spot.x, bay.z - spot.z) })
  }

  private startLeaving(exit: Vec2): void {
    this.exit = exit
    if (this.seat) {
      this.world.seats.release(this.seat.id, this.entity.id)
      this.leaveStage = 'standing'
      this.standUp()
    } else {
      this.world.seats.releaseBy(this.entity.id)
      this.leaveStage = 'walking'
      this.moveTo(exit)
    }
  }

  private thinkLeave(): void {
    if (this.leaveStage === 'standing' && this.done) {
      this.leaveStage = 'walking'
      this.moveTo(this.exit)
    } else if (this.leaveStage === 'walking' && this.done) {
      this.leaveStage = 'fading'
      this.fadeOut()
    }
  }

  override onRemoved(world: World): void {
    world.seats.releaseBy(this.entity.id)
    world.releaseName(this.entity.name)
    if (this.patient.companion === this) this.patient.companion = null
  }
}
