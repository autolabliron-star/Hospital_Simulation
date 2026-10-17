/**
 * The radiographers and the sonographer. Each one belongs to one scanner and, while an exam runs, the scanner's session
 * drives her (`goTo`, `goToStation`, `anim`); between exams she sits at the console (MRI, CT), stands at the booth
 * (X-ray) or sits on her stool (ultrasound).
 *
 * She stands up before she walks: a seated person is slid off the seat first (Actor.standUp), so nobody pops.
 */
import type { StaffMember } from '@/content/staff'
import type { PeopleContext } from '../people'
import type { Rng } from '../rng'
import type { ImagingModality, Vec2 } from '../types'
import type { Walker } from '../walker'
import { Actor } from '../er/actor'
import type { World } from '../er/world'
import { dist, type ScannerSites } from './sites'

/** Staff id -> the scanner they run. */
export const OPERATOR_MODALITY: Readonly<Record<string, ImagingModality>> = {
  'rad-MRI': 'mri',
  'rad-CT': 'ct',
  'rad-XR': 'xray',
  'sono-1': 'us',
}

interface Pending {
  spot: Vec2
  face: number | null
  leader: Actor | null
}

export class ImagingOperator extends Actor {
  /** True while a scanner session is driving her. */
  working = false
  private pending: Pending | null = null
  private toStation = false
  private readonly baseCruise: number

  constructor(
    readonly world: World,
    readonly staff: StaffMember,
    readonly modality: ImagingModality,
    readonly sites: ScannerSites,
    walker: Walker,
    readonly srng: Rng,
  ) {
    super(staff.id, staff.role, staff.name, sites.station.at, sites.station.heading, walker, 'role')
    this.baseCruise = this.cruise
    const seat = sites.station.seat
    if (seat) {
      this.placeOnSeat(seat)
      world.seats.claimId(seat.id, staff.id)
      this.entity.anim = 'tablet'
    } else {
      this.placeAt(sites.station.at.x, sites.station.at.z, sites.station.heading)
      this.entity.anim = 'tablet'
    }
  }

  /** The presenter's demo patient is in a hurry to be scanned: walk briskly while that exam lasts. */
  hurry(on: boolean): void {
    this.cruise = on ? Math.max(this.baseCruise, 1.65) : this.baseCruise
  }

  /** Walk to a spot (standing up first if she is sitting). */
  goTo(spot: Vec2, o: { face?: number | null; leader?: Actor | null } = {}): void {
    this.toStation = false
    const face = o.face ?? null
    if (this.seat) {
      this.pending = { spot: { x: spot.x, z: spot.z }, face, leader: o.leader ?? null }
      this.standUp()
      return
    }
    this.pending = null
    this.moveTo(spot, { face, leader: o.leader ?? null })
  }

  /** Back to the console, the booth or the stool. */
  goToStation(): void {
    const st = this.sites.station
    if (this.isAtStation() || (this.toStation && !this.done)) return
    this.toStation = true
    this.pending = null
    if (st.seat) {
      if (this.seat === st.seat) return
      if (this.seat) {
        // sitting somewhere else (cannot happen today): stand and come back
        this.pending = { spot: st.at, face: null, leader: null }
        this.standUp()
        return
      }
      this.sitOn(st.seat)
    } else {
      this.moveTo(st.at, { face: st.heading })
    }
  }

  isAtStation(): boolean {
    const st = this.sites.station
    if (st.seat) return this.seat === st.seat && this.done && this.mode === 'static'
    return this.done && this.mode === 'static' && dist(this.pos, st.at) < 0.5
  }

  think(_dt: number, _ctx: PeopleContext): void {
    if (this.pending && this.mode === 'static' && this.done) {
      const p = this.pending
      this.pending = null
      if (this.toStation) {
        this.sitOn(this.sites.station.seat!)
      } else this.moveTo(p.spot, { face: p.face, leader: p.leader })
      return
    }
    if (this.working) return
    if (this.mode !== 'static' || !this.done) return
    if (!this.isAtStation()) {
      this.goToStation()
      return
    }
    this.entity.anim = 'tablet'
  }
}
