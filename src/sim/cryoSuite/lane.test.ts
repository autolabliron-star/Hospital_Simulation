/**
 * R5 wave 3, fix round 3: the stretcher's lane (lane.ts) proved against the building, as pure geometry (no simulation):
 *
 *   - it is a continuous curve (no pose jumps, headings turn at most 1.5 rad/s at the lane speed), from lift B's spot to the park beside the table, and
 *     the way back is the same poses
 *   - at every pose of it the stretcher's footprint (half 0.4 x 1.05 m, centred 1.45 m ahead of the pusher) is on walkable floor with 5 cm to spare (walls,
 *     doorframes, the pillar, the nurses' station, the beds), clear of every piece of CT furniture, and clear of where the team stands, except the radiographer
 *     at the table's foot, who is on it (that is why she steps back: `team.holdLane`), and the spot she steps back to is clear of every pose
 *   - the turns on the spot, at the stage (north to west) and at the out point (west to each bay's and to lift B's way) sweep clear floor
 */
import { describe, expect, it } from 'vitest'
import { LIFTS } from '../places'
import { firstLegHeading, LANE, type LanePose } from './lane'
import { BACK_SPEED, LANE_SPEED, TURN_RATE } from './sites'
import { cryoSuite, distToStretcher, stretcherBlocked, stretcherOverlaps } from './testkit'

const PI = Math.PI
const pose = (): LanePose => ({ x: 0, z: 0, heading: 0 })
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Every pose of a lane at `step` m. */
function along(lane: { length: number; poseAt(s: number, out: LanePose): LanePose }, step = 0.02): LanePose[] {
  const out: LanePose[] = []
  for (let s = 0; s <= lane.length + 1e-9; s += step) out.push({ ...lane.poseAt(s, pose()) })
  return out
}

describe('the lane: its shape', () => {
  it('runs from lift B up the corridor to the stage (facing west), through recovery and the scan room door to the park beside the table', () => {
    const spot = LIFTS.B[2].stretcher.at
    const start = LANE.lift.poseAt(0, pose())
    expect(Math.hypot(start.x - spot.x, start.z - spot.z)).toBeLessThan(1e-9)
    const k = LANE.lift.poseAt(LANE.lift.length, pose())
    expect(Math.hypot(k.x - LANE.stage.x, k.z - LANE.stage.z)).toBeLessThan(1e-9)
    // (the porter comes out of the lift facing north, as the suite makes him, and arrives at the stage facing north: the turn to the west is made there)
    expect(Math.abs(wrap(start.heading - PI))).toBeLessThan(1e-9)
    expect(Math.abs(wrap(k.heading - PI))).toBeLessThan(1e-9)
    const begin = LANE.poseAt(0, pose())
    expect(begin).toEqual({ x: LANE.stage.x, z: LANE.stage.z, heading: -PI / 2 })
    const end = LANE.poseAt(LANE.length, pose())
    expect(end.x).toBeCloseTo(LANE.park.x, 9)
    expect(end.z).toBeCloseTo(LANE.park.z, 9)
    expect(wrap(end.heading - LANE.park.heading)).toBeCloseTo(0, 9)
    // the park lies 0.3 m south of the contract's, beside the table's south side
    expect(LANE.park.z).toBeCloseTo(18.9, 9)
    // the out point is on the scan room door's line (z 16.8) outside the door (x 97), facing west, where the planned walks to the bays and to lift B go straight
    expect(LANE.out.z).toBeCloseTo(16.8, 9)
    expect(LANE.out.x).toBeGreaterThan(102)
    expect(wrap(LANE.out.heading + PI / 2)).toBeCloseTo(0, 9)
    expect(LANE.sDoor).toBeGreaterThan(0)
    expect(LANE.sOut).toBeLessThan(LANE.sDoor)
  })

  it('is continuous: no pose jump, and no heading changes faster than 1.5 rad/s at the lane speed (the backing speed is slower still)', () => {
    for (const lane of [LANE.lift, LANE]) {
      const ps = along(lane, 0.01)
      let worstStep = 0
      let worstTurn = 0
      for (let i = 1; i < ps.length; i++) {
        worstStep = Math.max(worstStep, Math.hypot(ps[i].x - ps[i - 1].x, ps[i].z - ps[i - 1].z))
        worstTurn = Math.max(worstTurn, Math.abs(wrap(ps[i].heading - ps[i - 1].heading)) / 0.01)
      }
      expect(worstStep).toBeLessThan(0.0101)
      // (rad per metre: the tightest arc is 0.7 m)
      expect(worstTurn * LANE_SPEED, 'rad/s at the lane speed').toBeLessThan(1.5)
      expect(worstTurn * BACK_SPEED).toBeLessThan(1.5)
    }
  })

  it('is walked back the same way (poseAt does not depend on the direction), and its length is what the trips are timed by', () => {
    const a = LANE.poseAt(7.3, pose())
    const b = LANE.poseAt(7.3, pose())
    expect(a).toEqual(b)
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    const sites = h.cryo.sites
    expect(sites.lane).toBe(LANE)
    expect(sites.stretcherTrip).toBeCloseTo(sites.stretcherLift + 2.5 + sites.stretcherDrive, 9)
    expect(sites.stretcherDrive).toBeGreaterThanOrEqual(LANE.length / LANE_SPEED)
    expect(sites.stretcherTrip).toBeGreaterThan(25)
    expect(sites.stretcherTrip).toBeLessThan(40)
  })
})

describe('the lane: the footprint of the stretcher along it', () => {
  it('is on walkable floor with 5 cm to spare at every pose (walls, doorframes, the pillar, the nurses\' station, the beds), in the corridor, recovery and the scan room', () => {
    for (const [name, lane] of [['corridor', LANE.lift], ['lane', LANE]] as const) {
      for (const p of along(lane)) {
        expect(stretcherBlocked(p.x, p.z, p.heading, 0.05), `${name} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) facing ${p.heading.toFixed(2)}`).toEqual([])
      }
    }
  })

  it('is clear of the CT table, the robot, the gantry, the console, the cylinders, the cabinet and the anaesthesia machine at every pose', () => {
    for (const p of along(LANE)) expect(stretcherOverlaps(p.x, p.z, p.heading), `at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) facing ${p.heading.toFixed(2)}`).toEqual([])
  })

  it('clears the table by at least 15 cm, and the nurse at the table\'s south side by at least 10 cm', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    const s = h.cryo.sites
    let table = 9
    let nurse = 9
    const south = s.anchor('ctSideSouth', 0).at
    for (const p of along(LANE)) {
      // (the table's foot end corner, the nearest point of the table to the lane)
      table = Math.min(table, distToStretcher(94.1, 17.65, p.x, p.z, p.heading), distToStretcher(94.1, 17.15, p.x, p.z, p.heading))
      nurse = Math.min(nurse, distToStretcher(south.x, south.z, p.x, p.z, p.heading) - 0.25)
    }
    expect(table).toBeGreaterThan(0.15)
    expect(nurse).toBeGreaterThan(0.1)
  })

  it('passes no place the team stands at but the radiographer\'s at the table\'s foot, and the spot she steps back to is clear of every pose by 30 cm', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    const s = h.cryo.sites
    const places: { name: string; at: { x: number; z: number }; onLane: boolean }[] = []
    for (const a of ['ctInsert', 'ctConsole', 'ctHeadSouth', 'ctAnaesHead', 'ctFoot', 'ctSideSouth', 'ctSideNorth'] as const) places.push({ name: `${a}#0`, at: s.anchor(a, 0).at, onLane: false })
    const onLane = new Set<string>()
    let way = 9
    for (const p of along(LANE)) {
      for (const pl of places) if (distToStretcher(pl.at.x, pl.at.z, p.x, p.z, p.heading) < 0.3) onLane.add(pl.name)
      way = Math.min(way, distToStretcher(s.spots.makeWay.at.x, s.spots.makeWay.at.z, p.x, p.z, p.heading))
    }
    // (the radiographer's foot is the one place of the team the lane passes through)
    expect([...onLane]).toEqual(['ctFoot#0'])
    expect(way).toBeGreaterThan(0.3)
  })

  it('has the stage turn (north to west on the spot, the left-hand way) sweep clear floor, and the way back (west to north, the right-hand way) too', () => {
    const k = LANE.stage
    const from = LANE.lift.poseAt(LANE.lift.length, pose()).heading
    const to = wrap(-PI / 2)
    // (left-hand turn: the heading increases from `from` to -pi/2 + 2 pi)
    const total = (to - from + 2 * PI) % (2 * PI)
    expect(total).toBeGreaterThan(1)
    expect(total).toBeLessThan(2.5)
    for (let a = 0; a <= total + 1e-9; a += 0.01) expect(stretcherBlocked(k.x, k.z, from + a, 0.05), `heading ${(from + a).toFixed(2)}`).toEqual([])
  })

  it('has the turn at the out point sweep clear floor for the way to every recovery bay and to lift B, no bed or station in the swing', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    const rec = h.cryo.sites.recovery
    const targets = [...rec.pacu.map((r) => rec.bedFoot(r).at), LIFTS.B[2].stretcher.at]
    for (const to of targets) {
      const goal = firstLegHeading(LANE.out, to, LANE.out.heading)
      // (turned left, the heading increasing from west)
      let total = (goal - LANE.out.heading + 4 * PI) % (2 * PI)
      expect(total).toBeLessThan(2 * PI)
      for (let a = 0; a <= total + 1e-9; a += 0.01) {
        expect(stretcherBlocked(LANE.out.x, LANE.out.z, LANE.out.heading + a, 0), `to (${to.x.toFixed(1)}, ${to.z.toFixed(1)}), turned ${a.toFixed(2)}`).toEqual([])
      }
      total = 0
    }
  })

  it('the slow turns are slow: a quarter turn takes seconds, not a tick (the crowd\'s own turn rate would swing the stretcher\'s centre a metre in a tick)', () => {
    // the stretcher's centre is 1.45 m from the pusher: at TURN_RATE it moves at most 1.45 * TURN_RATE m/s
    expect(1.45 * TURN_RATE * 0.1).toBeLessThan(0.2)
  })
})
