/**
 * Paramedics: an ambulance arrives every 12-20 minutes with a patient lying on a stretcher. The lead paramedic pushes
 * it from the ambulance door straight to a free ER bay (waiting at a hold spot if every bay is taken, and an acuity 1-2
 * arrival takes the next bay before anyone waiting); the second walks beside. They lift the patient onto the trolley,
 * hand over to an ER nurse (a short talk), then take the empty stretcher back out and fade away at the ambulance door.
 *
 *   arriving -> toHold -> holding -> toBay -> unloading -> handover -> leaving
 */
import type { StaffMember } from '@/content/staff'
import type { PeopleContext } from '../people'
import { ARRIVALS } from '../places'
import type { Walker } from '../walker'
import { Actor } from './actor'
import type { ErPatient } from './patient'
import { AMBULANCE_HOLD, headingTo, seatSpot } from './spots'
import type { World } from './world'

type State = 'arriving' | 'toHold' | 'holding' | 'toBay' | 'unloading' | 'handover' | 'leaving'

/** A handover that no nurse comes to is closed after this long (the crew must not wait for ever). */
const HANDOVER_PATIENCE = 300

export class Paramedic extends Actor {
  private state: State = 'arriving'
  private timer = 0
  private readonly crew: { lead: Paramedic | null; leaving: boolean }

  constructor(
    readonly world: World,
    readonly staff: StaffMember,
    walker: Walker,
    crew: { lead: Paramedic | null; leaving: boolean },
    private readonly patient: ErPatient,
    readonly isLead: boolean,
    at: { x: number; z: number },
  ) {
    super(staff.id, 'paramedic', staff.name, at, ARRIVALS.ambulance.heading, walker, 'role')
    this.crew = crew
    if (isLead) {
      crew.lead = this
      this.setVehicle('stretcher')
      this.walkAnim = 'push'
      this.idleAnim = 'push'
      this.cruise = 1.05
    } else {
      this.cruise = 1.15
    }
  }

  think(dt: number, _ctx: PeopleContext): void {
    if (this.isLead) this.thinkLead(dt)
    else this.thinkSecond()
  }

  private thinkLead(dt: number): void {
    const p = this.patient
    const c = p.c
    switch (this.state) {
      case 'arriving':
        // the patient's own arrival (after the fade-in) puts them in the queue for a bay
        if (this.visibleFully && p.state !== 'arriving') {
          this.moveTo(c.bay >= 0 ? seatSpot(p.baySeat!, 'foot') : AMBULANCE_HOLD.at, { face: c.bay >= 0 ? headingTo(p.baySeat!.approach, p.baySeat!) : AMBULANCE_HOLD.heading })
          this.state = c.bay >= 0 ? 'toBay' : 'toHold'
        }
        break
      case 'toHold':
        if (c.bay >= 0) this.goToBay()
        else if (this.done) this.state = 'holding'
        break
      case 'holding':
        if (c.bay >= 0) this.goToBay()
        break
      case 'toBay':
        if (this.done) {
          this.entity.anim = 'give'
          p.unloadToTrolley()
          this.timer = 0
          this.state = 'unloading'
        }
        break
      case 'unloading':
        if ((p.state.startsWith('inBay') && p.state !== 'inBay.walking') || p.state.startsWith('tests') || p.state === 'decision') {
          this.entity.anim = 'idle'
          this.timer = 0
          this.state = 'handover'
        }
        break
      case 'handover':
        this.timer += dt
        this.entity.anim = c.handover === 'doing' ? 'talk' : 'idle'
        if (c.handover === 'done' || this.timer > HANDOVER_PATIENCE) {
          c.handover = 'done'
          this.startLeaving()
        }
        break
      case 'leaving':
        if (this.done && !this.fadingOut) this.fadeOut()
        break
    }
  }

  private goToBay(): void {
    const seat = this.patient.baySeat!
    this.moveTo(seat.approach, { face: headingTo(seat.approach, seat) })
    this.state = 'toBay'
  }

  private startLeaving(): void {
    this.crew.leaving = true
    this.entity.anim = 'push'
    this.moveTo(ARRIVALS.ambulance.at)
    this.state = 'leaving'
  }

  private thinkSecond(): void {
    const lead = this.crew.lead
    if (!lead) return
    const p = this.patient
    if (this.crew.leaving) {
      if (this.state !== 'leaving') {
        this.state = 'leaving'
        this.moveTo(ARRIVALS.ambulance.at, { leader: lead })
      } else if (this.done && !this.fadingOut) {
        this.fadeOut()
      }
      return
    }
    // follow the stretcher; at the bay, stand just outside it
    switch (this.state) {
      case 'arriving':
        if (this.visibleFully && p.state !== 'arriving') {
          this.moveTo({ x: AMBULANCE_HOLD.at.x - 0.9, z: AMBULANCE_HOLD.at.z + 0.7 }, { leader: lead })
          this.state = 'toHold'
        }
        break
      case 'toHold':
        if (p.c.bay >= 0) {
          this.moveTo(seatSpot(p.baySeat!, 'companion'), { leader: lead })
          this.state = 'toBay'
        }
        break
      default:
        break
    }
  }

  override onRemoved(world: World): void {
    if (this.isLead) world.crewsOnSite = Math.max(0, world.crewsOnSite - 1)
  }
}
