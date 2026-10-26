/**
 * R4: where the cryoablation suite's people lie, sit and stand. The seats are the building's (src/scene/rooms/surgery/cryoRoom.ts: the CT table
 * `scanTable:cryo` and the two control seats), with a synthetic fallback made from the contract anchors (places.ts CRYO_SUITE) when a layout lacks
 * them; the recovery bays are the surgery suite's (`SurgerySites.pacu`, shared so a bay is never claimed twice). A standing spot is the contract's
 * when it is walkable and out of a doorway, else the first nearby point that is.
 */
import { inDoorway } from '../er/spots'
import type { TableRef } from '../er/actor'
import { isWalkable, nearestWalkable } from '../nav/layout'
import { CRYO_SUITE, type Spot } from '../places'
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
  stretcherPark: Spot
  clean: Spot[]
  base: Spot[]
}

export const CRYO_SEAT_IDS = { table: 'scanTable:cryo', ct: 'console:cryo:ct', robot: 'console:cryo:robot' } as const

export class CryoSites {
  readonly table: SeatRef
  readonly ctConsole: SeatRef
  readonly robotStation: SeatRef
  readonly spots: CryoSpots
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
    this.spots = {
      insert: near(st.insert),
      atConsole: near(st.atConsole),
      sedation: near(st.sedation),
      assist: near(st.assist),
      stretcherPark: near(st.stretcherPark),
      clean: st.clean.map(near),
      base: st.base.map(near),
    }
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
