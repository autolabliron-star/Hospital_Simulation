/**
 * R4: where the cryoablation suite's people lie, sit and stand. The seats are the building's (src/scene/rooms/surgery/cryoRoom.ts: the CT table
 * `scanTable:cryo` and the two control seats), with a synthetic fallback made from the contract anchors (places.ts CRYO_SUITE) when a layout lacks
 * them; the recovery bays are the surgery suite's (`SurgerySites.pacu`, shared so a bay is never claimed twice). A standing spot is the contract's
 * when it is walkable and out of a doorway, else the first nearby point that is.
 */
import { inDoorway } from '../er/spots'
import type { TableRef } from '../er/actor'
import { isWalkable, nearestWalkable } from '../nav/layout'
import { CRYO_SUITE, DOORS, type Spot } from '../places'
import { LANE, PoseLane, type StretcherLane } from './lane'
import { cryoAnchorSlots, type CryoAnchor } from '../procedure/cryoPlaces'
import type { SeatRegistry } from '../seats'
import type { SeatSpec, Vec2 } from '../types'
import type { SeatRef, SurgerySites } from '../surgery/sites'

const CLEAR = 0.3

function firstWalkable(cands: readonly Vec2[]): Vec2 {
  for (const c of cands) if (isWalkable(c.x, c.z, CLEAR) && !inDoorway(c.x, c.z)) return { x: c.x, z: c.z }
  for (const c of cands) if (isWalkable(c.x, c.z, CLEAR)) return { x: c.x, z: c.z }
  const out = { x: 0, z: 0 }
  nearestWalkable(cands[0].x, cands[0].z, CLEAR, out)
  return out
}

/** The contract's spot, or the first of a few nearby points (0.3 m and 0.6 m round it) that is walkable. */
function near(base: Spot): Spot {
  const c: Vec2[] = [base.at]
  for (const r of [0.3, 0.6]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) c.push({ x: base.at.x + dx * r, z: base.at.z + dz * r })
  return { at: firstWalkable(c), heading: base.heading }
}

export interface CryoSpots {
  insert: Spot
  atConsole: Spot
  sedation: Spot
  assist: Spot
  /**
   * The stretcher's park beside the table (the lane's end, `lane.ts`: the contract's park moved `PARK_SOUTH` m south, so the stretcher clears the nurse at the
   * table's south side). `stretcherStage` is where the lane begins, just inside recovery's door (the porter walks there from lift B and is driven on from it),
   * `stretcherOut` the point on the door's line outside the scan room's door where a stretcher is backed to and where the nurse, with no porter free, takes one.
   * `makeWay` is where the radiographer steps back to (north of the door's line, clear of the lane) while a stretcher is on the lane.
   */
  stretcherPark: Spot
  stretcherStage: Spot
  stretcherOut: Spot
  makeWay: Spot
  clean: Spot[]
  base: Spot[]
  /** R5 wave 3: the anaesthetist's place at the head, the two table sides (slots: the first person takes the first) and the control room's glass. */
  anaesHead: Spot
  sideSouth: Spot[]
  sideNorth: Spot[]
  controlStand: Spot[]
}

/** The radiographer's place while a stretcher is on the lane: this far (m) west and north of the door's centre (the lane's door line lies on z 16.8; the stretcher is 0.8 m wide). */
const WAY_WEST = 2.1
const WAY_NORTH = 1.0
/** The stretcher's drive along the lane: its speed (m/s, the lane's walk and the backing out), and what the start, the eased stops and the radiographer's step back add to a trip (s). */
export const LANE_SPEED = 1.0
export const BACK_SPEED = 0.8
export const TURN_RATE = 1.0
/** The turn at the stage (north to west, about 1.7 rad at `TURN_RATE`, eased at both ends) takes about this long (s). */
export const STAGE_TURN = 2.5
/** The hall lane begins this far (m) east of the out point (the bay east of it is reached by backing) and is this long (m). */
export const HALL_EAST = 2.4
const HALL_LENGTH = 8
/** What the start of a walk adds (s), and what the eased stops, the radiographer's step back and a short wait for somebody add to the drive along the lane (s). */
export const LEAD_IN = 2
export const LANE_SLACK = 3

/** The most people the scripts put at one anchor (the slots past an anchor's own are made by `extraSlot`). */
const MAX_SLOTS = 4
/** How far (m) the spare slots of an anchor lie from its last spot. */
const SPARE = 0.75

/** Every CT anchor of the scripts. */
const ANCHORS: readonly CryoAnchor[] = ['ctInsert', 'ctConsole', 'ctHeadSouth', 'ctAnaesHead', 'ctFoot', 'ctSideSouth', 'ctSideNorth', 'ctControlScan', 'ctControlPlan', 'ctControlStand']

export const CRYO_SEAT_IDS = { table: 'scanTable:cryo', ct: 'console:cryo:ct', robot: 'console:cryo:robot' } as const

export class CryoSites {
  readonly table: SeatRef
  readonly ctConsole: SeatRef
  readonly robotStation: SeatRef
  readonly spots: CryoSpots
  /**
   * The seconds a porter pushing a stretcher takes from lift B's stretcher spot to the park: the drive up the corridor to the lane's stage (`stretcherLift`), the
   * turn there (`STAGE_TURN`) and the drive along the lane (`stretcherDrive`); `stretcherTrip` is their sum.
   */
  readonly stretcherTrip: number
  readonly stretcherLift: number
  readonly stretcherDrive: number
  /** The stretcher's lane into the scan room (lane.ts). */
  readonly lane: StretcherLane
  /**
   * The ways to the recovery bays from the lane's out point (fix round 3): the hall lane, straight west along the scan room door's line from `HALL_EAST` m east of
   * the out point (forwards to the bays west of it, backwards to the bay east of it), and a bay lane, straight south from the door's line to each bay's foot. The
   * stretcher is turned from west to south on the spot between them: it arrives at the bay pointing along the bed.
   */
  readonly hallLane: PoseLane
  readonly bayLanes: PoseLane[]
  /** R5 wave 3: every CT anchor's places, walkable (`anchor(a, slot)`). */
  private readonly slots = new Map<CryoAnchor, Spot[]>()
  /** The CT table the patient rides (its `state` is the suite's: tablePos). */
  readonly tableRef: TableRef
  private readonly owner = new Map<string, string>()

  constructor(
    readonly seats: SeatRegistry,
    /** The recovery bays (the surgery suite's sites). */
    readonly recovery: SurgerySites,
    tableState: { tablePos: number },
  ) {
    const t = CRYO_SUITE.ct.table
    this.table = this.resolve(CRYO_SEAT_IDS.table, () => ({
      id: CRYO_SEAT_IDS.table,
      kind: 'scanTable',
      area: 'l2Cryo',
      x: t.out.x,
      z: t.out.z,
      heading: t.heading,
      pose: 'lie',
      height: t.height,
      approach: firstWalkable([{ x: t.out.x + 1.5, z: t.out.z }, { x: t.out.x + 1.8, z: t.out.z }]),
    }))
    const console = (id: string, s: Spot): SeatSpec => ({
      id,
      kind: 'console',
      area: 'l2CryoControl',
      x: s.at.x,
      z: s.at.z,
      heading: s.heading,
      pose: 'sit',
      height: 0.5,
      approach: firstWalkable([
        { x: s.at.x, z: s.at.z - 0.5 },
        { x: s.at.x + 0.7, z: s.at.z },
        { x: s.at.x - 0.7, z: s.at.z },
      ]),
    })
    this.ctConsole = this.resolve(CRYO_SEAT_IDS.ct, () => console(CRYO_SEAT_IDS.ct, CRYO_SUITE.seats.ctConsole))
    this.robotStation = this.resolve(CRYO_SEAT_IDS.robot, () => console(CRYO_SEAT_IDS.robot, CRYO_SUITE.seats.robotStation))
    // the table carries the patient from where the seat lies (the `out` end) by the contract's travel
    const seat = this.table.seat
    this.tableRef = {
      out: { x: seat.x, z: seat.z },
      in: { x: seat.x + (t.in.x - t.out.x), z: seat.z + (t.in.z - t.out.z) },
      heading: seat.heading,
      state: tableState,
    }
    const st = CRYO_SUITE.staff
    const door = DOORS.find((d) => d.id === 'l2Cryo')!
    const lane = LANE
    this.lane = lane
    this.spots = {
      insert: near(st.insert),
      atConsole: near(st.atConsole),
      sedation: near(st.sedation),
      assist: near(st.assist),
      stretcherPark: { at: { x: lane.park.x, z: lane.park.z }, heading: lane.park.heading },
      stretcherStage: { at: { x: lane.stage.x, z: lane.stage.z }, heading: lane.stage.heading },
      stretcherOut: { at: { x: lane.out.x, z: lane.out.z }, heading: lane.out.heading },
      makeWay: near({ at: { x: door.center.x - WAY_WEST, z: door.center.z - WAY_NORTH }, heading: 0 }),
      clean: st.clean.map(near),
      base: st.base.map(near),
      anaesHead: near(st.anaesHead),
      sideSouth: st.sideSouth.map(near),
      sideNorth: st.sideNorth.map(near),
      controlStand: st.controlStand.map(near),
    }
    for (const anchor of ANCHORS) this.slots.set(anchor, this.buildSlots(anchor))
    // the porter's trip with the stretcher: driven up the corridor from lift B to the stage, turned there (slowly), and driven along the lane to the park, at the
    // lane speed, and what the start, the eased stops and the radiographer's step back add
    this.hallLane = new PoseLane({ x: lane.out.x + HALL_EAST, z: lane.out.z, heading: -Math.PI / 2 }, [{ len: HALL_LENGTH, k: 0 }])
    this.bayLanes = recovery.pacu.map((ref) => {
      const foot = recovery.bedFoot(ref)
      return new PoseLane({ x: foot.at.x, z: lane.out.z, heading: 0 }, [{ len: foot.at.z - lane.out.z, k: 0 }])
    })
    this.stretcherLift = lane.lift.length / LANE_SPEED + LEAD_IN
    this.stretcherDrive = lane.length / LANE_SPEED + LANE_SLACK
    this.stretcherTrip = this.stretcherLift + STAGE_TURN + this.stretcherDrive
  }

  private buildSlots(anchor: CryoAnchor): Spot[] {
    const own = cryoAnchorSlots(anchor)
    // (a control seat's place is the seat's approach: the person sits on the seat itself, `ctConsole` and `robotStation`)
    const base = anchor === 'ctControlScan' ? [{ at: this.ctConsole.seat.approach, heading: this.ctConsole.seat.heading }] : anchor === 'ctControlPlan' ? [{ at: this.robotStation.seat.approach, heading: this.robotStation.seat.heading }] : own.map(near)
    const out = base.slice()
    // spare slots beside the last one: east, west, then along the other axis (the first that is walkable)
    const last = out[out.length - 1]
    for (let k = out.length; k < MAX_SLOTS; k++) {
      const r = SPARE * (k - out.length + 1)
      out.push({ at: firstWalkable([{ x: last.at.x + r, z: last.at.z }, { x: last.at.x - r, z: last.at.z }, { x: last.at.x, z: last.at.z + r }, { x: last.at.x, z: last.at.z - r }, last.at]), heading: last.heading })
    }
    return out
  }

  /** The place of the `slot`-th (0-based) person at CT anchor `anchor`: its own spots first, then spares beside the last one. */
  anchor(anchor: CryoAnchor, slot: number): Spot {
    const list = this.slots.get(anchor)!
    return list[Math.min(slot, list.length - 1)]
  }

  private resolve(id: string, make: () => SeatSpec): SeatRef {
    const real = this.seats.all.find((s) => s.id === id)
    return real ? { seat: real, real: true } : { seat: make(), real: false }
  }

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

  /** Release every seat of the suite `who` holds (the recovery bay too). */
  releaseAll(who: string): void {
    for (const [id, o] of this.owner) if (o === who) this.owner.delete(id)
    this.seats.releaseBy(who)
    this.recovery.releaseAll(who)
  }

  /** A free recovery bay, the highest index first (surgery takes the lowest), or -1. */
  freePacu(): number {
    const pacu = this.recovery.pacu
    for (let i = pacu.length - 1; i >= 0; i--) if (this.recovery.occupant(pacu[i]) === null) return i
    return -1
  }
}
