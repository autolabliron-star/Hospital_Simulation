/**
 * R2: where the surgery suite's people stand, sit and lie: the building's seats on level 2 (pre-op and recovery beds, the OR table, the consoles,
 * the lounge, the waiting chairs, the staff room) and the standing spots of the team, derived from the contract anchors (places.ts SURGERY,
 * PREOP, PACU, THEATRE_BASE).
 *
 * The scene layout agents export the seats (src/scene/rooms/surgery: B the pre-op, PACU, lounge, waiting and staff-room seats; O the table, the
 * consoles and the anaesthetist's stool), and they may arrive after this code does. Everything here therefore prefers the real seat (in the seat
 * registry: claimed there) and falls back to a synthetic seat made from the anchors (not in the registry: claimed here, which is safe because one
 * case is in the suite at a time). A standing spot is the first walkable candidate with 0.3 m clear of walls and furniture, so it adapts to
 * whatever the layout puts in the room. The OR's spots start from the contract's (SURGERY.staff, R2 polish: the table side, the waiting spots, the
 * cleaner's round, the drive's end), then try nearby points.
 */
import { isWalkable, nearestWalkable } from '../nav/layout'
import { l2 } from '../levels'
import { PACU, PREOP, SURGERY, THEATRE_BASE, type Spot } from '../places'
import type { SeatRegistry } from '../seats'
import type { SeatKind, SeatSpec, Vec2 } from '../types'
import { inDoorway, seatSpot } from '../er/spots'

const CLEAR = 0.3

/** A seat of the suite and whether the building's registry has it. */
export interface SeatRef {
  seat: SeatSpec
  real: boolean
}

function firstWalkable(cands: readonly Vec2[], margin = CLEAR): Vec2 {
  // (nobody is asked to stand in a doorway)
  for (const c of cands) if (isWalkable(c.x, c.z, margin) && !inDoorway(c.x, c.z)) return { x: c.x, z: c.z }
  for (const c of cands) if (isWalkable(c.x, c.z, margin)) return { x: c.x, z: c.z }
  const out = { x: 0, z: 0 }
  const c = cands[0]
  nearestWalkable(c.x, c.z, margin, out)
  return out
}

/** A standing spot: the first walkable of drawn-coordinate candidates [x, z] (level 2 `l2` applied), facing `heading`. */
function spotOf(heading: number, ...cands: [number, number][]): Spot {
  return { at: firstWalkable(cands.map(([x, z]) => ({ x: l2(x), z }))), heading }
}

/** The same, from candidate spots already in sim coordinates. */
function spotNear(base: Spot, ...extra: [number, number][]): Spot {
  return { at: firstWalkable([base.at, ...extra.map(([x, z]) => ({ x: l2(x), z }))]), heading: base.heading }
}

function headingTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

export interface TheatreSpots {
  /** Pre-op: the nurse's desk spot. */
  deskNurse: Spot
  /** Pre-op and the lounge: standing places when every waiting chair or recliner is taken. */
  waitStand: Spot[]
  loungeStand: Spot[]
  /** The OR. */
  tableSurgeon: Spot
  assistant: Spot
  assistantWait: Spot
  scrub: Spot
  scrubWait: Spot
  circulator: Spot
  anaesHead: Spot
  /** Behind the parked cart, and behind the cart at the dock. */
  drive: Spot
  driveEnd: Spot
  drape: Spot
  sink: [Spot, Spot]
  /** Where the cleaner works (one after the other) during a turnover. */
  clean: Spot[]
  /** Recovery. */
  pacuNurse: Spot
  /** The theatre staff's places when they have nothing to do: a ring round THEATRE_BASE, one per member of the team. */
  base: Spot[]
}

export class SurgerySites {
  readonly preop: SeatRef[]
  readonly pacu: SeatRef[]
  readonly table: SeatRef
  readonly surgeonConsole: SeatRef
  readonly anaesStool: SeatRef
  readonly spots: TheatreSpots
  /** Synthetic seats are claimed here (the registry does not know them). */
  private readonly owner = new Map<string, string>()

  constructor(readonly seats: SeatRegistry) {
    this.preop = PREOP.bays.map((b, i) => this.resolve(`surgeryBed:preop:${i}`, () => bedSeat(`surgeryBed:preop:${i}`, 'l2PreOp', b, 0.8, 1.4)))
    this.pacu = PACU.bays.map((b, i) => this.resolve(`surgeryBed:pacu:${i}`, () => bedSeat(`surgeryBed:pacu:${i}`, 'l2Pacu', b, 0.8, 1.4)))
    this.table = this.resolve('orTable:0', () => ({
      id: 'orTable:0',
      kind: 'orTable',
      area: 'l2Or',
      x: SURGERY.table.at.x,
      z: SURGERY.table.at.z,
      heading: SURGERY.table.heading,
      pose: 'lie',
      height: SURGERY.table.height,
      approach: { x: SURGERY.table.approach.x, z: SURGERY.table.approach.z },
    }))
    const sc = SURGERY.consoles.surgeon.seat
    this.surgeonConsole = this.resolve('console:or:surgeon', () => ({
      id: 'console:or:surgeon',
      kind: 'console',
      area: 'l2Or',
      x: sc.at.x,
      z: sc.at.z,
      heading: sc.heading,
      pose: 'sit',
      height: 0.5,
      approach: firstWalkable([
        { x: sc.at.x - 0.1, z: sc.at.z + 0.95 },
        { x: sc.at.x - 0.5, z: sc.at.z + 0.95 },
        { x: sc.at.x - 0.1, z: sc.at.z - 0.95 },
        { x: sc.at.x - 0.8, z: sc.at.z },
      ]),
    }))
    const st = SURGERY.anaesthesia.stool
    this.anaesStool = this.resolve('console:or:anaes', () => ({
      id: 'console:or:anaes',
      kind: 'console',
      area: 'l2Or',
      x: st.at.x,
      z: st.at.z,
      heading: st.heading,
      pose: 'sit',
      height: 0.55,
      approach: firstWalkable([
        { x: st.at.x + 0.8, z: st.at.z + 0.2 },
        { x: st.at.x + 0.6, z: st.at.z + 0.7 },
        { x: st.at.x + 0.9, z: st.at.z - 0.4 },
        { x: st.at.x - 0.4, z: st.at.z + 0.8 },
      ]),
    }))
    this.spots = this.buildSpots()
  }

  private resolve(id: string, make: () => SeatSpec): SeatRef {
    const real = this.seats.all.find((s) => s.id === id)
    return real ? { seat: real, real: true } : { seat: make(), real: false }
  }

  // --- claiming ---------------------------------------------------------------------------------------------------

  /** Claim a seat of the suite for `who`; false when somebody else holds it. */
  claim(ref: SeatRef, who: string): boolean {
    if (ref.real) {
      const held = this.seats.occupant(ref.seat.id)
      if (held === who) return true
      return this.seats.claimId(ref.seat.id, who)
    }
    const held = this.owner.get(ref.seat.id)
    if (held !== undefined && held !== who) return false
    this.owner.set(ref.seat.id, who)
    return true
  }

  release(ref: SeatRef, who: string): void {
    if (ref.real) this.seats.release(ref.seat.id, who)
    else if (this.owner.get(ref.seat.id) === who) this.owner.delete(ref.seat.id)
  }

  occupant(ref: SeatRef): string | null {
    return ref.real ? this.seats.occupant(ref.seat.id) : (this.owner.get(ref.seat.id) ?? null)
  }

  /** Release everything `who` holds (synthetic seats; the registry's own `releaseBy` covers the real ones). */
  releaseAll(who: string): void {
    for (const [id, o] of this.owner) if (o === who) this.owner.delete(id)
    this.seats.releaseBy(who)
  }

  /** A free pre-op bed (the lowest index), or null. */
  freePreop(): number {
    for (let i = 0; i < this.preop.length; i++) if (this.occupant(this.preop[i]) === null) return i
    return -1
  }

  freePacu(): number {
    for (let i = 0; i < this.pacu.length; i++) if (this.occupant(this.pacu[i]) === null) return i
    return -1
  }

  /** The lounge's seats are the building's: a free one nearest `near`, or null (then they stand: `spots.loungeStand`). */
  claimLounge(who: string, near: Vec2): SeatSpec | null {
    return this.seats.claim(who, { kind: 'lounge', area: 'l2Lounge' }, near)
  }

  claimWaiting(who: string, near: Vec2): SeatSpec | null {
    return this.seats.claim(who, { kind: 'waiting', area: 'l2PreOp' }, near)
  }

  claimStaffRoom(who: string, near: Vec2): SeatSpec | null {
    return this.seats.claim(who, { kind: 'lounge', area: 'l2Staff' }, near)
  }

  // --- spots ------------------------------------------------------------------------------------------------------

  private buildSpots(): TheatreSpots {
    const sink0 = SURGERY.scrubSink.spots[0]
    const sink1 = SURGERY.scrubSink.spots[1]
    const baseRing: Spot[] = []
    const ring: [number, number][] = [
      [0, 0],
      [1.2, 0.2],
      [-1.2, 0.2],
      [0.6, 1.3],
      [-0.6, 1.3],
      [1.6, -1.1],
      [-1.6, -1.1],
      [0, -1.6],
      [2.3, 1.2],
      [-2.3, 1.2],
      [0, 2.3],
      [2.4, -0.6],
    ]
    for (const [dx, dz] of ring) {
      const at = firstWalkable([
        { x: THEATRE_BASE.at.x + dx, z: THEATRE_BASE.at.z + dz },
        { x: THEATRE_BASE.at.x + dx * 0.6, z: THEATRE_BASE.at.z + dz * 0.6 },
        { x: THEATRE_BASE.at.x + dx * 1.3, z: THEATRE_BASE.at.z + dz * 1.3 },
      ])
      baseRing.push({ at, heading: THEATRE_BASE.heading + dx * 0.2 })
    }
    return {
      deskNurse: spotNear(PREOP.nurse, [-46.6, -14.4], [-47.2, -15]),
      waitStand: [
        spotOf(Math.PI, [-52.2, -12.4]),
        spotOf(Math.PI, [-53.4, -12.4]),
        spotOf(Math.PI, [-54.6, -12.4]),
        spotOf(Math.PI, [-51.0, -12.4]),
        spotOf(Math.PI, [-55.8, -12.4]),
        spotOf(Math.PI, [-52.8, -13.4]),
      ],
      // R4: the lounge is now drawn z 2..10 (the cryoablation suite took its south half)
      loungeStand: [spotOf(0, [-58.2, 5.0]), spotOf(0, [-57.0, 5.0]), spotOf(0, [-58.2, 6.4]), spotOf(0, [-58.2, 7.8]), spotOf(0, [-56.8, 8.4]), spotOf(0, [-57.0, 4.2])],
      tableSurgeon: spotNear(SURGERY.staff.tableSurgeon, [-48.0, 5.2], [-47.9, 5.7], [-47.6, 4.9]),
      assistant: spotNear(SURGERY.staff.assistant, [-48.0, 6.2], [-47.8, 6.0]),
      assistantWait: spotNear(SURGERY.staff.assistantWait, [-46.8, 5.2], [-47.3, 5.5], [-46.4, 4.8]),
      scrub: spotNear(SURGERY.staff.scrub, [-48.0, 7.2], [-47.8, 7.6]),
      scrubWait: spotNear(SURGERY.staff.scrubWait, [-46.6, 8.4], [-47.4, 8.8], [-46.3, 7.6]),
      circulator: spotNear(SURGERY.staff.circulator, [-45.4, 2.9], [-46.0, 2.9]),
      anaesHead: spotNear(SURGERY.anaesthesia.stand, [-49.2, 4.4], [-49.6, 4.3]),
      drive: spotNear(SURGERY.staff.drive, [-52.4, 8.9], [-52.3, 8.7]),
      driveEnd: spotNear(SURGERY.staff.driveEnd, [-52.35, 5.5], [-52.4, 6.4]),
      drape: spotNear(SURGERY.staff.drape, [-51.8, 7.4], [-51.5, 7.5]),
      sink: [spotNear(sink0, [-50.0, 1.0]), spotNear(sink1, [-48.8, 1.0])],
      clean: [
        spotNear(SURGERY.staff.clean[0], [-47.9, 5.0], [-47.4, 5.4]),
        spotNear(SURGERY.staff.clean[1], [-47.8, 6.4], [-47.2, 6.8]),
        spotNear(SURGERY.staff.clean[2], [-47.0, 8.6], [-47.8, 8.8]),
        spotNear(SURGERY.staff.clean[3], [-50.4, 7.0], [-50.8, 7.0]),
      ],
      pacuNurse: spotNear(PACU.nurse, [-48.5, 16.8], [-49.5, 16.4]),
      base: baseRing,
    }
  }

  /** Where the pre-op nurse stands beside bay `i`'s bed (her side), and the doctors' side. */
  nurseSide(ref: SeatRef): Spot {
    const at = seatSpot(ref.seat, 'nurse')
    return { at, heading: headingTo(at, ref.seat) }
  }

  doctorSide(ref: SeatRef): Spot {
    const at = seatSpot(ref.seat, 'doctor')
    return { at, heading: headingTo(at, ref.seat) }
  }

  companionSide(ref: SeatRef): Spot {
    const at = seatSpot(ref.seat, 'companion')
    return { at, heading: headingTo(at, ref.seat) }
  }

  /** The foot of a bed: where the patient walks to before getting on it, and where the porter parks the stretcher. */
  bedFoot(ref: SeatRef): Spot {
    return { at: ref.seat.approach, heading: headingTo(ref.seat.approach, ref.seat) }
  }
}

/** A trolley bed in a bay (a synthetic seat when the layout has none): its foot end, where people stand, is `foot` metres toward the room. */
function bedSeat(id: string, area: string, bay: Spot, height: number, foot: number): SeatSpec {
  const kind: SeatKind = 'surgeryBed'
  const at = bay.at
  // the bays stand against the outer wall: north bays (pre-op) have their foot to the south, south bays (recovery) to the north
  const dz = at.z < 0 ? foot : -foot
  return {
    id,
    kind,
    area,
    x: at.x,
    z: at.z,
    heading: bay.heading,
    pose: 'lie',
    height,
    approach: firstWalkable([
      { x: at.x, z: at.z + dz },
      { x: at.x, z: at.z + dz * 1.3 },
    ]),
  }
}
