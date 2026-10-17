/**
 * The robot circuit of one ward: a single closed, one-way loop that every MedPod of that ward drives.
 * W2: the loop is the line of the ceiling rail the pods hang from (the pod body rides 2.30 m above the floor), so
 * it shares no floor space with people. Because pods only ever follow each other round one loop, they can never
 * meet head-on or merge, so deadlock is impossible by construction; the only rule needed is "keep a gap to the pod
 * ahead".
 *
 * Ward A, in path order (ward B is the same with z negated; see places.ts ROBOT):
 *   s=0  entry door (8,-12) ─ rank, southbound along x=8 (idle pods charge here, head at z=-4)
 *        ─ turn ─ dock lane westbound along z=-2, past dock ports at x=3 and x=-3 (MedVend north face)
 *        ─ turn ─ exit spur northbound along x=-8 ─ exit door (-8,-12)
 *        ─ turn ─ inner lane westbound along z=-12.7 to x=-27 ─ west U-turn
 *        ─ room lane eastbound along z=-15.3 past every drawer to x=27 ─ east U-turn
 *        ─ inner lane westbound to x=8.7 ─ turn ─ back to the entry door (s = length).
 *
 * Pure maths, no three.js: tested in node. `pointAt` writes into an output object (no allocation).
 */
import { BANDS, CORRIDOR_CENTER, PHARMACY, ROBOT, ROOMS, roomById, wardSign } from '../places'
import type { RoomId, Vec2, WardId } from '../types'

export type SegmentZone = 'core' | 'corridor'

interface LineSeg {
  kind: 'line'
  s0: number
  len: number
  zone: SegmentZone
  ax: number
  az: number
  bx: number
  bz: number
  /** Unit direction. */
  ux: number
  uz: number
}

interface ArcSeg {
  kind: 'arc'
  s0: number
  len: number
  zone: SegmentZone
  cx: number
  cz: number
  r: number
  /** Start angle; point(θ) = (cx + r cos θ, cz + r sin θ). */
  a0: number
  /** Signed sweep in radians (positive = θ increasing). */
  sweep: number
}

export type Segment = LineSeg | ArcSeg

export interface PathPoint {
  x: number
  z: number
  heading: number
}

export interface Circuit {
  ward: WardId
  length: number
  segments: Segment[]
  /** Idle pods queue so that the first one stops here. */
  rankHead: number
  /** Dock ports in path order (PHARMACY.docks[ward]). */
  docks: number[]
  /** The pod's stopping point at each room's drawer. */
  drawers: Map<RoomId, number>
  exitDoor: number
}

// ---------------------------------------------------------------------------------------------
// Construction (written in ward-A coordinates, mirrored for ward B)
// ---------------------------------------------------------------------------------------------

type Draft =
  | { kind: 'line'; ax: number; az: number; bx: number; bz: number; zone: SegmentZone }
  | { kind: 'arc'; cx: number; cz: number; r: number; a0: number; sweep: number; zone: SegmentZone }

const HALF_PI = Math.PI / 2

function wardADrafts(): Draft[] {
  const R = ROBOT
  const room = -(BANDS.roomWall - R.laneOffset) // -15.3
  const inner = -(BANDS.innerWall + R.laneOffset) // -12.7
  const mid = -CORRIDOR_CENTER // -14
  const door = -BANDS.innerWall // -12
  const dock = -R.dockLaneZ // -2
  const rt = R.coreTurnR
  const dt = R.doorTurnR
  const ux = R.uturnX
  const ur = Math.abs(room - mid)
  return [
    // rank + approach: from the entry door south along x = entryX
    { kind: 'line', ax: R.entryX, az: door, bx: R.entryX, bz: dock - rt, zone: 'core' },
    { kind: 'arc', cx: R.entryX - rt, cz: dock - rt, r: rt, a0: 0, sweep: HALF_PI, zone: 'core' },
    // dock lane westbound
    { kind: 'line', ax: R.entryX - rt, az: dock, bx: R.exitX + rt, bz: dock, zone: 'core' },
    { kind: 'arc', cx: R.exitX + rt, cz: dock - rt, r: rt, a0: HALF_PI, sweep: HALF_PI, zone: 'core' },
    // exit spur north to the robot door
    { kind: 'line', ax: R.exitX, az: dock - rt, bx: R.exitX, bz: door, zone: 'core' },
    { kind: 'arc', cx: R.exitX - dt, cz: door, r: dt, a0: 0, sweep: -HALF_PI, zone: 'corridor' },
    // inner lane westbound
    { kind: 'line', ax: R.exitX - dt, az: inner, bx: -ux, bz: inner, zone: 'corridor' },
    { kind: 'arc', cx: -ux, cz: mid, r: ur, a0: HALF_PI, sweep: Math.PI, zone: 'corridor' },
    // room lane eastbound, past every drawer
    { kind: 'line', ax: -ux, az: room, bx: ux, bz: room, zone: 'corridor' },
    { kind: 'arc', cx: ux, cz: mid, r: ur, a0: -HALF_PI, sweep: Math.PI, zone: 'corridor' },
    // inner lane westbound back to the entry door
    { kind: 'line', ax: ux, az: inner, bx: R.entryX + dt, bz: inner, zone: 'corridor' },
    { kind: 'arc', cx: R.entryX + dt, cz: door, r: dt, a0: -HALF_PI, sweep: -HALF_PI, zone: 'core' },
  ]
}

function mirror(d: Draft): Draft {
  if (d.kind === 'line') return { ...d, az: -d.az, bz: -d.bz }
  return { ...d, cz: -d.cz, a0: -d.a0, sweep: -d.sweep }
}

function finish(drafts: Draft[]): { segments: Segment[]; length: number } {
  const segments: Segment[] = []
  let s = 0
  for (const d of drafts) {
    if (d.kind === 'line') {
      const len = Math.hypot(d.bx - d.ax, d.bz - d.az)
      segments.push({ ...d, s0: s, len, ux: (d.bx - d.ax) / len, uz: (d.bz - d.az) / len })
      s += len
    } else {
      const len = Math.abs(d.sweep) * d.r
      segments.push({ ...d, s0: s, len })
      s += len
    }
  }
  return { segments, length: s }
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

/** Wrap an arc length into [0, length). */
export function wrapS(c: Circuit, s: number): number {
  const L = c.length
  return ((s % L) + L) % L
}

/** Distance travelled going forward from a to b (0 ≤ result < length). */
export function forward(c: Circuit, a: number, b: number): number {
  return wrapS(c, b - a)
}

export function segmentAt(c: Circuit, s: number): Segment {
  const t = wrapS(c, s)
  const segs = c.segments
  // ~12 segments: a linear scan is cheaper than anything clever
  for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].s0) return segs[i]
  return segs[0]
}

/** Position and heading at arc length s, written into `out`. */
export function pointAt(c: Circuit, s: number, out: PathPoint): PathPoint {
  const t = wrapS(c, s)
  const g = segmentAt(c, t)
  const u = t - g.s0
  if (g.kind === 'line') {
    out.x = g.ax + g.ux * u
    out.z = g.az + g.uz * u
    out.heading = Math.atan2(g.ux, g.uz)
  } else {
    const dir = g.sweep >= 0 ? 1 : -1
    const th = g.a0 + (dir * u) / g.r
    out.x = g.cx + g.r * Math.cos(th)
    out.z = g.cz + g.r * Math.sin(th)
    // tangent of θ ↦ (cos θ, sin θ) is (−sin θ, cos θ); reversed when θ decreases
    out.heading = Math.atan2(-Math.sin(th) * dir, Math.cos(th) * dir)
  }
  return out
}

/** Arc length of the point on the circuit nearest to (x, z), searched on the segments of one zone kind. */
export function nearestS(c: Circuit, x: number, z: number, step = 0.05): number {
  const p: PathPoint = { x: 0, z: 0, heading: 0 }
  let best = 0
  let bestD = Infinity
  for (let s = 0; s < c.length; s += step) {
    pointAt(c, s, p)
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

// ---------------------------------------------------------------------------------------------
// Build both circuits once
// ---------------------------------------------------------------------------------------------

function buildCircuit(w: WardId): Circuit {
  const drafts = w === 'A' ? wardADrafts() : wardADrafts().map(mirror)
  const { segments, length } = finish(drafts)
  const c: Circuit = { ward: w, length, segments, rankHead: 0, docks: [], drawers: new Map(), exitDoor: 0 }
  const sign = wardSign(w)
  const first = segments[0] as LineSeg
  // rank head: on the first (rank) line where |z| = rankHeadZ
  c.rankHead = Math.abs(first.az - sign * ROBOT.rankHeadZ)
  c.docks = PHARMACY.docks[w].map((d: Vec2) => nearestS(c, d.x, d.z))
  for (const r of ROOMS) if (r.ward === w) c.drawers.set(r.id, nearestS(c, r.podDock.x, r.podDock.z))
  c.exitDoor = nearestS(c, ROBOT.exitX, sign * BANDS.innerWall)
  return c
}

export const CIRCUITS: Record<WardId, Circuit> = { A: buildCircuit('A'), B: buildCircuit('B') }

export function drawerS(roomId: RoomId): number {
  const room = roomById(roomId)
  const s = CIRCUITS[room.ward].drawers.get(roomId)
  if (s === undefined) throw new Error(`No drawer stop for ${roomId}`)
  return s
}
