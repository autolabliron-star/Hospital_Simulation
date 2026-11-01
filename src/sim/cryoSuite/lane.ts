/**
 * R5 wave 3, fix round 3: the stretcher's lane into and out of the CT room.
 *
 * The room has one door, in its east wall, on the line z = 16.8, and the CT table lies 2.9 m inside it (its foot end at x 94.1, z 17.15..17.65) with the
 * stretcher's park beside the table's south side. A stretcher is 2.1 m long and is pushed from its rear end, so it cannot be turned round in the gap
 * between the table's foot and the wall (a point turn sweeps a 2.5 m circle: across the table, the radiographer, or the wall), and it cannot leave the
 * park forwards. It goes in along a fixed curve and comes out the way it went in, backwards (the pusher walking back, the stretcher following), which
 * is what porters do in a tight room.
 *
 * The way in, from lift B (`StretcherLane`: the pusher's pose, x east, z south, heading 0 facing south, -pi/2 facing west):
 *
 *   lift   straight from lift B's stretcher spot up the corridor to the `stage` (`StretcherLane.lift`), the stretcher ahead of the pusher
 *   stage  the corridor, 2.8 m east of recovery's door on its line: the stretcher is turned on the spot, slowly (`HopWalker.armTurn`), from north to west,
 *          sweeping the open corridor (turning it at the door's corner pokes its far end into the wall and the pillar beside the door)
 *   0      straight west through recovery's door along its line (z 12.5)
 *   1      a left-hand arc (radius `LANE_RE`): the stretcher swings from west to south, in the open hall
 *   2      straight south down the hall's east side (x 104.6)
 *   3      a right-hand arc (radius `LANE_RA`) onto the scan room door's line, now facing west
 *   4      straight west along the door's line (z 16.8) to the door
 *   5      a left-hand arc (radius `LANE_R1`) just inside the door: the stretcher swings south, away from the table's foot
 *   6      a right-hand arc back to facing west: the stretcher lies beside the table, its pusher at `park`
 *
 * The radii are chosen so that along the whole way the stretcher's footprint (places.ts VEHICLE_HALF, centred VEHICLE_AHEAD ahead) clears the table by
 * about 27 cm, the nurse at the table's south side by 17 cm, and every wall by at least 10 cm, and so that every heading change is slow (the tightest arc turns
 * at about 1.3 rad/s at the lane speed). Only the radiographer's place at the table's foot (94.6, 17.4) is on the lane: she steps back while a stretcher is on it
 * (team.ts `holdLane`).
 *
 * The way out is the way in backwards, as far as the corridor: the pusher walks back along the lane to the stage (the stretcher trailing him), turns the
 * stretcher on the spot to the corridor's line and backs down it to lift B. A stretcher carrying a patient to a recovery bay is backed only to the out point
 * (`StretcherLane.out`, on the room door's line 6 m outside it), turned there to the way the crowd's walk takes it, and the crowd takes it from there. (A forward
 * way out of the hall through recovery's door that never leaves the stretcher over a bed does not exist: between the nurses' station, the pillar and the east
 * wall there is no room to turn a 2.5 m stretcher.)
 *
 * `poseAt` is pure and allocation-free; `HopWalker.armLane` (hop.ts) drives a person along a lane, forwards or backwards. `lane.test.ts` proves the
 * clearances against the building's footprints.
 */
import { tryPlanRoute } from '../nav/graph'
import { CRYO_SUITE, DOORS, LIFTS } from '../places'
import type { Vec2 } from '../types'

/** One pose of a pusher on a lane. */
export interface LanePose {
  x: number
  z: number
  heading: number
}

/** How far (m) the stretcher's park lies south of the contract's `CRYO_SUITE.staff.stretcherPark`: the park's footprint then clears the nurse at the table's south side. */
export const PARK_SOUTH = 0.3
/** The radii (m) of the lane's arcs: in recovery's hall, onto the door's line, away from the table's foot (the arc back beside the table takes what the park's depth leaves). */
export const LANE_RE = 1.0
export const LANE_RA = 1.0
export const LANE_R1 = 0.7
/**
 * Where on the door's line (m east of the scan room's door) the out point lies: the stretcher is backed to it and the people take it from there. It lies east
 * of the recovery hall's pillar-free middle, so the planned walk from it to the bays and to lift B goes straight and not by the beds' foot nodes.
 */
export const OUT_EAST = 6.0
/** The radius (m) of the S-bend that takes the stretcher across the corridor from the lift's door to the stage. */
const LIFT_BEND = 5
/** The lane's stage lies this far (m) outside recovery's door (east of it, in the corridor), on the door's line. */
const STAGE_OUT = 2.8

const HALF_PI = Math.PI / 2

/** One piece of a lane: `len` metres at curvature `k` (1/m; 0 straight, positive turns the heading up (a left turn), negative down). */
interface Piece {
  len: number
  k: number
}

/** A pusher's route as straight pieces and circular arcs from a start pose. */
export class PoseLane {
  readonly length: number
  private readonly pieces: readonly Piece[]
  private readonly cum: Float64Array
  /** The pose at the start of each piece. */
  private readonly sx: Float64Array
  private readonly sz: Float64Array
  private readonly sh: Float64Array

  constructor(start: LanePose, pieces: readonly Piece[]) {
    this.pieces = pieces
    const n = pieces.length
    this.cum = new Float64Array(n + 1)
    this.sx = new Float64Array(n)
    this.sz = new Float64Array(n)
    this.sh = new Float64Array(n)
    let x = start.x
    let z = start.z
    let h = start.heading
    const tmp: LanePose = { x: 0, z: 0, heading: 0 }
    for (let i = 0; i < n; i++) {
      this.sx[i] = x
      this.sz[i] = z
      this.sh[i] = h
      this.cum[i + 1] = this.cum[i] + pieces[i].len
      advance(x, z, h, pieces[i], pieces[i].len, tmp)
      x = tmp.x
      z = tmp.z
      h = tmp.heading
    }
    this.length = this.cum[n]
  }

  /** The arc length at which piece `i` begins. */
  startOf(i: number): number {
    return this.cum[i]
  }

  /** The pusher's pose `s` metres along the lane (clamped to [0, length]), written to `out`. Allocation-free. */
  poseAt(s: number, out: LanePose): LanePose {
    if (s < 0) s = 0
    else if (s > this.length) s = this.length
    let i = this.pieces.length - 1
    while (i > 0 && s < this.cum[i]) i--
    return advance(this.sx[i], this.sz[i], this.sh[i], this.pieces[i], s - this.cum[i], out)
  }
}

/** The pose `d` metres into `piece` from (x, z, h), written to `out`. */
function advance(x: number, z: number, h: number, piece: Piece, d: number, out: LanePose): LanePose {
  const k = piece.k
  if (k === 0) {
    out.x = x + Math.sin(h) * d
    out.z = z + Math.cos(h) * d
    out.heading = h
  } else {
    const ph = h + k * d
    out.x = x + (Math.cos(h) - Math.cos(ph)) / k
    out.z = z + (Math.sin(ph) - Math.sin(h)) / k
    out.heading = ph
  }
  return out
}

/** The lane into the CT room (see the header). */
export class StretcherLane extends PoseLane {
  /** Where the lane begins (the pusher facing west in the corridor, on recovery's door's line) and where it ends beside the table. */
  readonly stage: LanePose
  readonly park: LanePose
  /** The way from lift B's stretcher spot to the stage (north up the corridor, an S-bend east; it ends at the stage's position, still facing north). */
  readonly lift: PoseLane
  /** The point outside the CT room's door the stretcher is backed to (facing west), and the lane's pose at the room's door. */
  readonly out: LanePose
  readonly door: LanePose
  /** Arc lengths (m) of: the scan room's door (where the stretcher's footprint begins to swing inside the room) and the out point. */
  readonly sDoor: number
  readonly sOut: number
  readonly radii: { re: number; ra: number; r1: number; r2: number }

  constructor() {
    const cryoDoor = DOORS.find((d) => d.id === 'l2Cryo')!
    const pacuDoor = DOORS.find((d) => d.id === 'l2Pacu')!
    const park = CRYO_SUITE.staff.stretcherPark.at
    const zD = cryoDoor.center.z
    const zP = park.z + PARK_SOUTH
    const re = LANE_RE
    const ra = LANE_RA
    const r1 = LANE_R1
    const r2 = zP - zD - r1
    const xD = park.x + r1 + r2
    const xK = pacuDoor.center.x + STAGE_OUT
    const zE = pacuDoor.center.z
    const xE = pacuDoor.center.x - 0.4
    const xS = xE - re
    const xA = xS - ra
    const zA = zD - ra
    const stage = { x: xK, z: zE, heading: -HALF_PI }
    super(stage, [
      { len: xK - xE, k: 0 },
      { len: re * HALF_PI, k: 1 / re },
      { len: zA - (zE + re), k: 0 },
      { len: ra * HALF_PI, k: -1 / ra },
      { len: xA - xD, k: 0 },
      { len: r1 * HALF_PI, k: 1 / r1 },
      { len: r2 * HALF_PI, k: -1 / r2 },
    ])
    this.radii = { re, ra, r1, r2 }
    this.stage = stage
    this.park = { x: park.x, z: zP, heading: -HALF_PI }
    this.door = { x: xD, z: zD, heading: -HALF_PI }
    this.sDoor = this.startOf(5)
    this.sOut = this.startOf(4) + (xA - (cryoDoor.center.x + OUT_EAST))
    this.out = this.poseAt(this.sOut, { x: 0, z: 0, heading: 0 })
    // the corridor: from lift B's stretcher spot (the porter appears there facing north) straight north through the lift's door, then a gentle S-bend east
    // (radius `LIFT_BEND`) onto the stage, still facing north (a straight run across the corridor to the stage would put the stretcher's corner into the lift
    // door's frame)
    const spot = LIFTS.B[2].stretcher.at
    const shift = stage.x - spot.x
    const th = Math.acos(1 - shift / (2 * LIFT_BEND))
    const run = spot.z - stage.z - 2 * LIFT_BEND * Math.sin(th)
    this.lift = new PoseLane({ x: spot.x, z: spot.z, heading: Math.PI }, [
      { len: run, k: 0 },
      { len: LIFT_BEND * th, k: -1 / LIFT_BEND },
      { len: LIFT_BEND * th, k: 1 / LIFT_BEND },
    ])
  }
}

/** The lane (built once: it only reads the contract's places). */
export const LANE = new StretcherLane()

/**
 * The heading of the first leg (at least 0.3 m long) of the planned walk from `from` to `to`: the way the stretcher must point when the crowd takes it from
 * the lane's out point, so it is turned to it slowly there and not swung at the walker's turn rate. `fallback` when there is no route.
 */
export function firstLegHeading(from: Vec2, to: Vec2, fallback: number): number {
  const route = tryPlanRoute(from, to)
  if (route === null) return fallback
  for (let i = 1; i < route.length; i++) {
    const dx = route[i].x - from.x
    const dz = route[i].z - from.z
    if (Math.hypot(dx, dz) >= 0.3) return Math.atan2(dx, dz)
  }
  return fallback
}
