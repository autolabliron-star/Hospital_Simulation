/**
 * W3 integration: the REAL walk-door bank + the REAL leaf blockers + the REAL pharmacist glass doors + the REAL BodyMover, run together
 * frame by frame in the order of the app. A3's doors and A1's body were built apart and never run together; `doors.test.ts` drives the body
 * against FAKE leaves forced open or shut, this file drives it against the leaves the doors really publish.
 *
 * One frame (`Rig.step`) is what the app does:
 *   FRAME_PRIORITY.doors (-11)  the doors sense you from last frame's `walkBody` (the velocity achieved, the wish) and your position as the
 *                               sim holds it (the end of last frame), step their openings by dt, and publish their leaves as blocker boxes
 *                               (WalkBuilding.tsx; PharmacistDoors.tsx for the glass doors; both sources registered together, as mounted).
 *                               The swing doors are double-acting: each leaf swings away from you (`bank.swing` goes to the blockers);
 *   FRAME_PRIORITY.player (-10) the body moves against those boxes (`BodyMover.step` collects them itself).
 * No NPCs unless a test sets `Rig.people`: the doors only ever see you.
 *
 * Every frame of every run is checked: the body is never closer than the body radius to any published leaf box, nor to any static solid.
 * "Crosses" means: 2 m past the wall line within (distance / v + 0.5 s), distance being the whole path from the start. Doors skipped, as in
 * `doors.test.ts`: the ambulance door (opens onto the bay) and the hub counters (no leaf); an approach line that furniture, a wall or the
 * edge of the floor blocks (a ward corridor is only 4 m deep, a patient room has its bed) is shortened (6, 5, 4, 3, 2.5, 2, 1.5, 1.2 or
 * 1 m) and skipped if none is clear. Every run starts at rest with every door shut and the body clear of every shut leaf: the worst
 * start there is. The console line of each case (run vitest with `--silent=false`) says what it measured: the slowest crossing over
 * distance / v, how much of that the doors cost against the same walk with no leaf anywhere, and the least clearance to a leaf.
 *
 * Run both control schemes (the default `easy`, and `?controls=classic`) wherever the way you steer does not matter to the claim.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { BLOCKER_STRIDE, clearBlockers, registerBlockers, type BlockerSource } from '@/scene/blockers'
import { getLayout } from '@/scene/building/layout'
import { buildWalkLayout } from '@/scene/building/layout/walk'
import type { WalkDoor } from '@/scene/building/layout/walk/types'
import { DoorBank, newLead, setLead, type PersonLike } from '@/scene/building/render/walk/doorBank'
import { leafBlockerCount, swingLeafWidth, writeLeafBlockers } from '@/scene/building/render/walk/doorMatrices'
import { CORE_BLOCKERS_PER_DOOR, CoreDoors, writeCoreBlockers, type CoreLead } from '@/scene/pharmacy/coreDoors'
import { OPENINGS } from '@/scene/pharmacy/layout'
import { CONFIG } from '@/sim/config'
import { DOORS, type DoorSpec } from '@/sim/places'
import { BodyMover } from './body'
import { blockerClearance, boxDistance, staticClearance } from './bodyTestKit'
import { angleDelta } from './chaseMath'
import { collisionStats, inRegion } from './collision'
import { TURN_RELEASE_SECONDS, type ControlScheme } from './scheme'

const R = CONFIG.player.bodyRadius
const WALK = CONFIG.player.walkSpeed
const RUN = CONFIG.player.hurrySpeed
const LEAD_SECONDS = CONFIG.player.doorLeadSeconds
const DEG = Math.PI / 180
const DTS = [1 / 30, 1 / 60, 1 / 144] as const
const SCHEMES: readonly ControlScheme[] = ['easy', 'classic']
/** Float slack on every distance claim. */
const EPS = 1e-4
const LONG = 240_000

afterEach(() => clearBlockers())

// ---------------------------------------------------------------------------------------------
// The rig: the app's doors and the app's body, one frame at a time
// ---------------------------------------------------------------------------------------------

const walkLayout = buildWalkLayout(getLayout())
const walkIndex = new Map(walkLayout.doors.map((d, i) => [d.id, i]))
const NOBODY: readonly PersonLike[] = []
const person = (x: number, z: number): PersonLike => ({ entity: { position: { x, z } } })

/** Every leaf of every door with every door shut: a start inside one of these is a body standing in a doorway whose door has not yet sensed it. */
const SHUT_LEAVES = ((): Float64Array => {
  const walkBoxes = new Float64Array(leafBlockerCount(walkLayout.doors) * BLOCKER_STRIDE)
  const coreBoxes = new Float64Array(OPENINGS.length * CORE_BLOCKERS_PER_DOOR * BLOCKER_STRIDE)
  const n = writeLeafBlockers(walkLayout.doors, new Float32Array(walkLayout.doors.length), walkBoxes)
  const m = writeCoreBlockers(OPENINGS, new Float32Array(OPENINGS.length), coreBoxes)
  return Float64Array.from([...walkBoxes.subarray(0, n * BLOCKER_STRIDE), ...coreBoxes.subarray(0, m * BLOCKER_STRIDE)])
})()

/** A start the doors have had no chance to open for: clear of every shut leaf by the body radius and a hand. */
function startFree(x: number, z: number): boolean {
  for (let o = 0; o < SHUT_LEAVES.length; o += BLOCKER_STRIDE) {
    if (boxDistance(x, z, SHUT_LEAVES[o], SHUT_LEAVES[o + 1], SHUT_LEAVES[o + 2], SHUT_LEAVES[o + 3], SHUT_LEAVES[o + 4], SHUT_LEAVES[o + 5]) < R + 0.1) return false
  }
  return true
}

class Rig {
  readonly bank = new DoorBank(walkLayout.doors)
  readonly core = new CoreDoors(OPENINGS)
  readonly walkSrc: BlockerSource = { name: 'walk doors', count: 0, data: new Float64Array(leafBlockerCount(walkLayout.doors) * BLOCKER_STRIDE) }
  readonly coreSrc: BlockerSource = { name: 'pharmacist doors', count: 0, data: new Float64Array(OPENINGS.length * CORE_BLOCKERS_PER_DOOR * BLOCKER_STRIDE) }
  readonly body: BodyMover
  /** Frames stepped, and seconds. */
  time = 0
  /** The people of the sim the doors sense (nobody unless a test puts somebody there). */
  people: readonly PersonLike[] = NOBODY
  private readonly lead = newLead()
  private readonly coreLead: CoreLead = { vx: 0, vz: 0, seconds: 0 }
  private readonly you = { x: 0, z: 0 }
  private readonly off: (() => void)[]

  /** `doors` false is the baseline: the same body with no leaf anywhere (every doorway as open as a doorway can be). */
  constructor(
    scheme: ControlScheme,
    x: number,
    z: number,
    heading: number,
    private readonly doors = true,
  ) {
    this.body = new BodyMover(scheme)
    this.body.place(x, z, heading)
    this.off = doors ? [registerBlockers(this.walkSrc), registerBlockers(this.coreSrc)] : []
  }

  dispose(): void {
    for (const f of this.off) f()
    this.walkSrc.count = 0
    this.coreSrc.count = 0
  }

  /**
   * One frame. `sense` false is a door logic that never sees you (the player is not passed to the door update, no lead): the doors only
   * ever see the (absent) crowd, so they stay as they are, and the leaves are the only thing between you and the doorway.
   */
  step(dt: number, forward: number, right: number, hurry: boolean, facing: number, sense = true): void {
    const b = this.body
    const st = b.state
    // FRAME_PRIORITY.doors: last frame's walkBody and last frame's position (`sim.movePlayer` at the end of the player's frame)
    this.you.x = b.x
    this.you.z = b.z
    setLead(this.lead, st.vx, st.vz, st.wishX, st.wishZ, LEAD_SECONDS)
    // PharmacistDoors.tsx writes the same lead by hand
    const cl = this.coreLead
    const useWish = st.wishX * st.wishX + st.wishZ * st.wishZ > st.vx * st.vx + st.vz * st.vz
    cl.vx = useWish ? st.wishX : st.vx
    cl.vz = useWish ? st.wishZ : st.vz
    cl.seconds = LEAD_SECONDS
    // (the sim is running at speed 1: the doors step in the frame's own seconds, clamped to 0.1 s)
    const step = Math.min(dt, 0.1)
    if (this.doors) {
      this.bank.update(step, this.people, sense ? this.you : null, sense ? this.lead : null)
      this.walkSrc.count = writeLeafBlockers(walkLayout.doors, this.bank.shown, this.walkSrc.data, this.bank.swing)
      this.core.update(step, NOBODY, sense ? this.you : null, sense ? cl : null)
      this.coreSrc.count = writeCoreBlockers(OPENINGS, this.core.shown, this.coreSrc.data)
    }
    // FRAME_PRIORITY.player: the body moves against what was just published
    b.step(dt, forward, right, hurry, facing)
    this.time += dt
  }

  /** The distance from the body's centre to the nearest published leaf box (both sources), of the frame just stepped. */
  leafDistance(): number {
    const b = this.body
    if (!this.doors) return Infinity
    return Math.min(blockerClearance(this.walkSrc, b.x, b.z), blockerClearance(this.coreSrc, b.x, b.z))
  }

  /** How open a door is, 0..1 (the eased opening that the leaves are written from). */
  openness(door: DoorSpec): number {
    const i = walkIndex.get(door.id)
    if (i !== undefined) return this.bank.shown[i]
    const j = OPENINGS.findIndex((o) => `pharmacist${o.ward}` === door.id)
    return j >= 0 ? this.core.shown[j] : NaN
  }
}

// ---------------------------------------------------------------------------------------------
// Approaches
// ---------------------------------------------------------------------------------------------

interface Approach {
  door: DoorSpec
  /** The unit direction of travel through the door at 0 degrees of approach. */
  nx: number
  nz: number
  dir: 1 | -1
  /** A swing door: its leaf swings away from you, into the side this approach walks towards (the doors are double-acting). */
  towardLeaf: boolean
}

const doorSpec = (id: string): DoorSpec => DOORS.find((d) => d.id === id)!
/** The walk doors that are doorways you pass (the ambulance door opens onto the bay; the hub counters have no leaf and no walk door). */
const WALK_DOORS: DoorSpec[] = walkLayout.doors.filter((d) => d.id !== 'ambulance').map((d) => doorSpec(d.id))
const SWING_DOORS: DoorSpec[] = WALK_DOORS.filter((d) => d.kind === 'swing')
const PHARMACIST_DOORS: DoorSpec[] = ['pharmacistA', 'pharmacistB'].map(doorSpec)

function approachesOf(doors: readonly DoorSpec[]): Approach[] {
  const out: Approach[] = []
  for (const door of doors) {
    const wd: WalkDoor | undefined = walkLayout.doors[walkIndex.get(door.id) ?? -1]
    for (const dir of [1, -1] as const) {
      const nx = door.wallAxis === 'z' ? dir : 0
      const nz = door.wallAxis === 'x' ? dir : 0
      out.push({ door, dir, nx, nz, towardLeaf: wd !== undefined && wd.kind === 'swing' })
    }
  }
  return out
}

const label = (a: Approach): string => `${a.door.id} ${a.dir > 0 ? '+' : '-'}${a.door.wallAxis === 'z' ? 'x' : 'z'}`

/** The signed distance of (x, z) past the door's wall line along the direction of travel (negative before it). */
const alongOf = (a: Approach, x: number, z: number): number => (x - a.door.center.x) * a.nx + (z - a.door.center.z) * a.nz

/** The start of a straight approach `dist` m before the door's centre, `angle` radians off its normal; the goal is 2 m beyond the wall line. */
function line(a: Approach, angle: number, dist: number): { sx: number; sz: number; facing: number; length: number } {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const ux = a.nx * c - a.nz * s
  const uz = a.nz * c + a.nx * s
  return { sx: a.door.center.x - ux * dist, sz: a.door.center.z - uz * dist, facing: Math.atan2(ux, uz), length: (dist + 2) / c }
}

/** Is the straight segment from (x0, z0) to (x1, z1) clear of every static solid by the body radius (a 1 cm margin) and on the floor? */
function segmentClear(x0: number, z0: number, x1: number, z1: number): boolean {
  const len = Math.hypot(x1 - x0, z1 - z0)
  for (let d = 0; d <= len + 1e-9; d += 0.05) {
    const x = x0 + ((x1 - x0) * d) / len
    const z = z0 + ((z1 - z0) * d) / len
    if (staticClearance(x, z).d < R + 0.01 || !inRegion(x, z)) return false
  }
  return true
}

function clearLine(a: Approach, angle: number, dist: number): boolean {
  const l = line(a, angle, dist)
  return startFree(l.sx, l.sz) && segmentClear(l.sx, l.sz, l.sx + Math.sin(l.facing) * l.length, l.sz + Math.cos(l.facing) * l.length)
}

/** The longest clear approach out of `options` (metres before the door's centre), or 0. */
function approachDistance(a: Approach, angle: number, options: readonly number[] = [6, 5, 4, 3, 2.5, 2, 1.5, 1.2, 1]): number {
  for (const d of options) if (clearLine(a, angle, d)) return d
  return 0
}

// ---------------------------------------------------------------------------------------------
// Watching a run
// ---------------------------------------------------------------------------------------------

interface Track {
  /** Seconds when the body first got `goal` m past the wall line, or -1. */
  crossedAt: number
  /** The least distance from the body's centre to any leaf box, and to any static solid, over every frame. */
  minLeaf: number
  minStatic: number
  /** The furthest the body got along the direction of travel (m past the wall line, negative before it). */
  furthest: number
  /** How open the door was when the body's front edge first reached the wall line (NaN: it never did). */
  openAtWall: number
  /** The first frame on which the body overlapped a leaf box or a static solid, described; null if none. */
  bad: string | null
}

function newTrack(): Track {
  return { crossedAt: -1, minLeaf: Infinity, minStatic: Infinity, furthest: -Infinity, openAtWall: NaN, bad: null }
}

/** Look at the frame just stepped. */
function watch(tr: Track, rig: Rig, a: Approach, goal = 2): void {
  const m = rig.body
  const along = alongOf(a, m.x, m.z)
  const s = staticClearance(m.x, m.z)
  const leaf = rig.leafDistance()
  if (leaf < tr.minLeaf) tr.minLeaf = leaf
  if (s.d < tr.minStatic) tr.minStatic = s.d
  if (along > tr.furthest) tr.furthest = along
  if (tr.bad === null && (s.d < R - EPS || leaf < R - EPS)) {
    const at = `t=${rig.time.toFixed(3)} at (${m.x.toFixed(3)}, ${m.z.toFixed(3)}), ${along.toFixed(3)} m past the wall line, door ${(rig.openness(a.door) * 100).toFixed(0)} % open`
    tr.bad = s.d < R - EPS ? `${at}: inside static ${s.id} by ${((R - s.d) * 100).toFixed(2)} cm` : `${at}: inside a leaf box by ${((R - leaf) * 100).toFixed(2)} cm`
  }
  if (Number.isNaN(tr.openAtWall) && along >= -R) tr.openAtWall = rig.openness(a.door)
  if (tr.crossedAt < 0 && along >= goal) tr.crossedAt = rig.time
}

/** The time a crossing may take over distance / v (start-up of the body's speed spring, the door, a leaf in the way). */
const ALLOWANCE = 0.5

/** What a case adds up: the numbers the report wants and the failures. */
class Stats {
  runs = 0
  skipped = 0
  /** The most any crossing took over distance / v (seconds), and the most it took over the same walk with no leaf anywhere. */
  slowestOver = -Infinity
  slowestOverAt = ''
  worstDelay = -Infinity
  worstDelayAt = ''
  tightestGap = Infinity
  tightestGapAt = ''
  leastOpen = Infinity
  leastOpenAt = ''
  readonly bad: string[] = []
  readonly stalls: string[] = []

  /**
   * `budget` is the seconds a crossing may take (distance / v + `ALLOWANCE`); -1: this run is not about crossing. `baseline` is the seconds
   * the same walk took with no leaf anywhere (NaN: not measured).
   */
  add(name: string, tr: Track, budget: number, baseline = NaN): void {
    this.runs++
    if (tr.bad !== null) this.bad.push(`${name}: ${tr.bad}`)
    if (budget >= 0) {
      if (tr.crossedAt < 0) this.stalls.push(`${name}: never got 2 m past the wall line (furthest ${tr.furthest.toFixed(3)} m)`)
      else {
        const over = tr.crossedAt - (budget - ALLOWANCE)
        if (over > this.slowestOver) {
          this.slowestOver = over
          this.slowestOverAt = name
        }
        if (over > ALLOWANCE) this.stalls.push(`${name}: crossed in ${tr.crossedAt.toFixed(3)} s, ${(over - ALLOWANCE).toFixed(3)} s over the budget of ${budget.toFixed(3)} s`)
        const delay = tr.crossedAt - baseline
        if (delay > this.worstDelay) {
          this.worstDelay = delay
          this.worstDelayAt = name
        }
      }
    }
    const gap = tr.minLeaf - R
    if (gap < this.tightestGap) {
      this.tightestGap = gap
      this.tightestGapAt = name
    }
    if (!Number.isNaN(tr.openAtWall) && tr.openAtWall < this.leastOpen) {
      this.leastOpen = tr.openAtWall
      this.leastOpenAt = name
    }
  }

  report(title: string): string {
    const over = this.slowestOver === -Infinity ? 'n/a' : `${this.slowestOver.toFixed(3)} s over dist/v (${this.slowestOverAt}; the budget allows ${ALLOWANCE} s)`
    const delay = this.worstDelay === -Infinity ? '' : `; the doors cost at most ${this.worstDelay.toFixed(3)} s against the same walk with no leaves (${this.worstDelayAt})`
    const gap = this.tightestGap === Infinity ? 'n/a' : `${(this.tightestGap * 100).toFixed(2)} cm (${this.tightestGapAt})`
    const open = this.leastOpen === Infinity ? 'n/a' : `${(this.leastOpen * 100).toFixed(0)} % (${this.leastOpenAt})`
    return `${title}: ${this.runs} runs, ${this.skipped} approaches skipped; slowest crossing ${over}${delay}; minimum leaf clearance (body edge to leaf box) ${gap}; least open at the wall line ${open}`
  }

  expectClean(): void {
    expect(this.bad.slice(0, 8), `${this.bad.length} runs overlapped a leaf or a solid`).toEqual([])
    expect(this.stalls.slice(0, 8), `${this.stalls.length} runs stalled`).toEqual([])
  }
}

const speedName = (hurry: boolean): string => (hurry ? `run ${RUN}` : `walk ${WALK}`)
const runName = (a: Approach, scheme: ControlScheme, hurry: boolean, dt: number, extra = ''): string => `${label(a)} ${scheme} ${speedName(hurry)} dt ${dt.toFixed(4)}${extra}`

/** A straight walk at the door from `dist` m, `angle` off its normal, from rest, door shut; until it is 2 m past the wall line (or the budget plus a second ran out). */
function crossStraight(a: Approach, scheme: ControlScheme, dist: number, hurry: boolean, dt: number, angle = 0, doors = true): { tr: Track; budget: number } {
  const l = line(a, angle, dist)
  const rig = new Rig(scheme, l.sx, l.sz, l.facing, doors)
  try {
    const budget = l.length / (hurry ? RUN : WALK) + ALLOWANCE
    const tr = newTrack()
    for (let i = 0, n = Math.ceil((budget + 1) / dt); i < n && tr.crossedAt < 0; i++) {
      rig.step(dt, 1, 0, hurry, l.facing)
      watch(tr, rig, a)
    }
    return { tr, budget }
  } finally {
    rig.dispose()
  }
}

/**
 * Does a straight walk at `angle` off the normal of this approach START on the hinge side of its swing door and head for the other jamb?
 * (false for an auto door.) That is the walk an open leaf standing between you and the opening traps: the pocket between leaf and wall.
 */
function fromHingeSide(a: Approach, angle: number): boolean {
  const wd = walkLayout.doors[walkIndex.get(a.door.id) ?? -1]
  if (wd === undefined || wd.kind !== 'swing') return false
  const lateral = (a.nx * Math.cos(angle) - a.nz * Math.sin(angle)) * wd.along.x + (a.nz * Math.cos(angle) + a.nx * Math.sin(angle)) * wd.along.z
  return lateral * wd.hinge < 0
}

/**
 * Run `crossStraight` over every approach, both speeds, every frame rate in `dts` and scheme; a Stats, the starts used, and how many of
 * the runs were at a swing door and started on its hinge side, heading for the other jamb (the walk an open leaf would trap).
 */
function sweepStraight(
  doors: readonly DoorSpec[],
  angles: readonly number[],
  schemes: readonly ControlScheme[] = SCHEMES,
  dts: readonly number[] = DTS,
): { stats: Stats; dists: Map<number, number>; hingeRuns: number } {
  const stats = new Stats()
  const dists = new Map<number, number>()
  let hingeRuns = 0
  for (const a of approachesOf(doors)) {
    for (const angle of angles) {
      const dist = approachDistance(a, angle)
      if (dist === 0) {
        stats.skipped++
        continue
      }
      dists.set(dist, (dists.get(dist) ?? 0) + 1)
      for (const scheme of schemes) {
        for (const hurry of [false, true]) {
          for (const dt of dts) {
            const { tr, budget } = crossStraight(a, scheme, dist, hurry, dt, angle)
            const name = runName(a, scheme, hurry, dt, ` angle ${(angle / DEG).toFixed(0)} from ${dist} m`)
            stats.add(name, tr, budget, crossStraight(a, scheme, dist, hurry, dt, angle, false).tr.crossedAt)
            if (fromHingeSide(a, angle)) hingeRuns++
          }
        }
      }
    }
  }
  return { stats, dists, hingeRuns }
}

const distSummary = (dists: Map<number, number>): string =>
  [...dists.entries()]
    .sort((p, q) => q[0] - p[0])
    .map(([d, n]) => `${d} m: ${n}`)
    .join(', ')

// ---------------------------------------------------------------------------------------------
// 1. Every walk door, both sides, walk and run
// ---------------------------------------------------------------------------------------------

describe('walk doors with their real leaves: you walk through every auto and swing door', () => {
  it('the doors under test are the whole walk layout minus the ambulance door', () => {
    expect(WALK_DOORS.length).toBe(walkLayout.doors.length - 1)
    expect(WALK_DOORS.map((d) => d.id)).toContain('entrance')
    expect(SWING_DOORS.length).toBeGreaterThanOrEqual(20)
    expect(WALK_DOORS.every((d) => d.kind === 'auto' || d.kind === 'swing')).toBe(true)
  })

  it(
    'crosses 2 m past the wall line within distance / v + 0.5 s from 6 m (or the longest clear start), never inside a leaf box nor a solid, at 2.0 and 4.2 m/s and 30, 60 and 144 frames a second',
    () => {
      collisionStats.backstopFallbacks = 0
      const { stats, dists } = sweepStraight(WALK_DOORS, [0])
      expect(stats.runs).toBeGreaterThan(300)
      stats.expectClean()
      expect(collisionStats.backstopFallbacks).toBe(0)
      // eslint-disable-next-line no-console
      console.log(`${stats.report('case 1, walk doors straight on (both schemes)')}; starts: ${distSummary(dists)}`)
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------------------------
// 2. The pharmacist glass doors; and doors that do not sense you hold the body
// ---------------------------------------------------------------------------------------------

describe('pharmacist glass doors with their real leaves', () => {
  it('open for you alone (no NPCs) and let the body through without touching a leaf, from the corridor and back out of the zone', () => {
    collisionStats.backstopFallbacks = 0
    const { stats, dists } = sweepStraight(PHARMACIST_DOORS, [0])
    expect(stats.runs).toBeGreaterThan(0)
    stats.expectClean()
    expect(collisionStats.backstopFallbacks).toBe(0)
    // eslint-disable-next-line no-console
    console.log(`${stats.report('case 2, pharmacist doors straight on (both schemes)')}; starts: ${distSummary(dists)}`)
  }, LONG)

  it('the way into the pharmacist zone from the corridor has a clear start of 2.5 m or more (that approach is run above, never skipped)', () => {
    const intoZone = approachesOf(PHARMACIST_DOORS).filter((a) => (a.door.id === 'pharmacistA' ? a.dir === 1 : a.dir === -1))
    expect(intoZone.length).toBe(2)
    for (const a of intoZone) {
      const dist = approachDistance(a, 0)
      expect(dist, `${label(a)}: no clear approach from the corridor`).toBeGreaterThanOrEqual(2.5)
    }
  })

  it('doors that never sense you stay shut and their leaves hold the body: it never crosses a wall line, never enters a leaf, and does touch one', () => {
    collisionStats.backstopFallbacks = 0
    const stats = new Stats()
    let engaged = 0
    for (const a of approachesOf([...WALK_DOORS, ...PHARMACIST_DOORS])) {
      const dist = approachDistance(a, 0, [4, 3.5, 3, 2.7])
      if (dist === 0) {
        stats.skipped++
        continue
      }
      const l = line(a, 0, dist)
      for (const scheme of SCHEMES) {
        for (const hurry of [false, true]) {
          for (const dt of DTS) {
            const rig = new Rig(scheme, l.sx, l.sz, l.facing)
            try {
              const tr = newTrack()
              // a player standing still `dist` m away senses nothing in range: the door stays shut
              for (let i = 0, n = Math.round(2 / dt); i < n; i++) {
                rig.step(dt, 0, 0, false, l.facing)
                watch(tr, rig, a)
              }
              const name = runName(a, scheme, hurry, dt, ` from ${dist} m`)
              if (rig.openness(a.door) !== 0) stats.bad.push(`${name}: the door opened for a player standing ${dist} m away (${rig.openness(a.door)})`)
              // now pushed at the shut door with the door logic not seeing the player
              for (let i = 0, n = Math.ceil((l.length / (hurry ? RUN : WALK) + 1.5) / dt); i < n; i++) {
                rig.step(dt, 1, 0, hurry, l.facing, false)
                watch(tr, rig, a)
              }
              if (rig.openness(a.door) !== 0) stats.bad.push(`${name}: the door opened though it never sensed the player (${rig.openness(a.door)})`)
              if (tr.furthest >= 0) stats.bad.push(`${name}: crossed a shut door (${tr.furthest.toFixed(3)} m past the wall line)`)
              if (tr.minLeaf - R <= 0.05) engaged++
              else stats.bad.push(`${name}: stopped ${((tr.minLeaf - R) * 100).toFixed(1)} cm short of the leaf: something else held it`)
              stats.add(name, tr, -1)
            } finally {
              rig.dispose()
            }
          }
        }
      }
    }
    expect(stats.runs).toBeGreaterThan(300)
    stats.expectClean()
    expect(engaged).toBe(stats.runs)
    expect(collisionStats.backstopFallbacks).toBe(0)
    // eslint-disable-next-line no-console
    console.log(stats.report('case 2b, shut doors that sense nothing (both schemes)'))
  }, LONG)
})

// ---------------------------------------------------------------------------------------------
// 3. A swing door closes behind you, and you walk back through it
// ---------------------------------------------------------------------------------------------

/** One frame of an easy-scheme turn towards `target`: the key (right +1, left -1) that gets the heading there, 0 once it is as good as there. */
function turnKey(rig: Rig, target: number): number {
  const rem = angleDelta(rig.body.heading, target)
  const rate = rig.body.turn.rate // positive turns left (heading growing)
  // the release lag still turns the heading by rate * tau: let go that much before the target
  const ahead = rem * rate > 0 ? Math.abs(rate) * TURN_RELEASE_SECONDS : 0
  if (Math.abs(rem) <= ahead + 0.02) return 0
  return rem > 0 ? -1 : 1
}

/**
 * How deep past the wall line you stop: 1 m past the leaf's sweep (a double-acting leaf swings away from you, into the side you walk
 * to; that is also past the 1.6 m sensing radius).
 */
function stopDepth(a: Approach): number {
  const wd = walkLayout.doors[walkIndex.get(a.door.id)!]
  return swingLeafWidth(wd) * Math.sin(wd.maxAngle) + 1.0
}

describe('a swing door closing behind you', () => {
  it(
    'walk through, stop 1 m past the leaf sweep, wait 3 s (the door shuts), turn round and walk back through: no overlap on any frame, no stall either way',
    () => {
      collisionStats.backstopFallbacks = 0
      const out = new Stats()
      const back = new Stats()
      let closed = 0
      for (const a of approachesOf(SWING_DOORS)) {
        const depth = stopDepth(a)
        const start = [3, 2.5, 2, 1.5].find((d) => {
          const l = line(a, 0, d)
          return startFree(l.sx, l.sz) && segmentClear(l.sx, l.sz, a.door.center.x + a.nx * depth, a.door.center.z + a.nz * depth)
        })
        const goalX = a.door.center.x - a.nx * 2.2
        const goalZ = a.door.center.z - a.nz * 2.2
        if (start === undefined || !segmentClear(a.door.center.x + a.nx * depth, a.door.center.z + a.nz * depth, goalX, goalZ)) {
          out.skipped++
          back.skipped++
          continue
        }
        const l = line(a, 0, start)
        const reverse: Approach = { door: a.door, dir: (a.dir === 1 ? -1 : 1) as 1 | -1, nx: -a.nx, nz: -a.nz, towardLeaf: true }
        const headingBack = Math.atan2(-a.nx, -a.nz)
        for (const scheme of SCHEMES) {
          for (const hurry of [false, true]) {
            const v = hurry ? RUN : WALK
            for (const dt of DTS) {
              const rig = new Rig(scheme, l.sx, l.sz, l.facing)
              const name = runName(a, scheme, hurry, dt, ` from ${start} m to ${depth.toFixed(2)} m`)
              try {
                // ---- out: walk through and stop `depth` past the wall line
                const t1 = newTrack()
                const budget1 = (start + 2) / v + 0.5
                let released = false
                for (let i = 0, n = Math.ceil((start + depth) / v / dt) + Math.ceil(4 / dt); i < n; i++) {
                  const st = rig.body.state
                  if (!released && alongOf(a, st.restX, st.restZ) >= depth) released = true
                  rig.step(dt, released ? 0 : 1, 0, hurry, l.facing)
                  watch(t1, rig, a)
                  if (released && rig.body.speed === 0) break
                }
                const stoppedAt = alongOf(a, rig.body.x, rig.body.z)
                if (stoppedAt < depth - 0.1) out.bad.push(`${name}: stopped ${stoppedAt.toFixed(2)} m past the wall line, short of the ${depth.toFixed(2)} m it was meant to reach`)
                // ---- wait 3 s: the door closes behind you
                for (let i = 0, n = Math.round(3 / dt); i < n; i++) {
                  rig.step(dt, 0, 0, false, l.facing)
                  watch(t1, rig, a)
                }
                out.add(name, t1, budget1)
                if (rig.openness(a.door) === 0) closed++
                else out.bad.push(`${name}: the door was still ${(rig.openness(a.door) * 100).toFixed(0)} % open after 3 s with you ${alongOf(a, rig.body.x, rig.body.z).toFixed(2)} m past it`)
                // ---- turn round (you do it standing; the last degree is your aim) and walk back through
                const t2 = newTrack()
                if (scheme === 'easy') {
                  for (let i = 0; i < Math.ceil(3 / dt) && (Math.abs(angleDelta(rig.body.heading, headingBack)) > 0.02 || rig.body.turn.rate !== 0); i++) {
                    rig.step(dt, 0, turnKey(rig, headingBack), false, headingBack)
                    watch(t2, rig, reverse)
                  }
                  rig.body.heading = headingBack
                }
                const along0 = alongOf(a, rig.body.x, rig.body.z)
                const budget2 = (along0 + 2) / v + 0.5
                const t0 = rig.time
                for (let i = 0, n = Math.ceil((budget2 + 1) / dt); i < n && t2.crossedAt < 0; i++) {
                  rig.step(dt, 1, 0, hurry, headingBack)
                  watch(t2, rig, reverse)
                }
                // the walk back is timed from the moment the key goes down
                if (t2.crossedAt >= 0) t2.crossedAt -= t0
                back.add(name, t2, budget2)
              } finally {
                rig.dispose()
              }
            }
          }
        }
      }
      expect(out.runs).toBeGreaterThan(100)
      out.expectClean()
      back.expectClean()
      expect(closed).toBe(out.runs)
      expect(collisionStats.backstopFallbacks).toBe(0)
      // eslint-disable-next-line no-console
      console.log(`${out.report('case 3 out (swing doors, through and stop)')}\n${back.report('case 3 back (after 3 s, turned round)')}; doors shut after the wait: ${closed}/${out.runs}`)
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------------------------
// 4. Turning into a door at the last moment
// ---------------------------------------------------------------------------------------------

const TURN_RUN_IN = 5
const TURN_OFFSETS = [0.4, 0.8, 1.2, 1.6, 2.0]

/** The unit direction along the wall of a door, +1 or -1. */
const parallel = (a: Approach, s: 1 | -1): { x: number; z: number } => ({ x: a.door.wallAxis === 'x' ? s : 0, z: a.door.wallAxis === 'z' ? s : 0 })

/**
 * Run along the wall 1.5 m off it, at the run, and turn 90 degrees into the door when the body is `off` m short of the door's centre line:
 * the easy scheme presses A or D (the real turn rate, 200 degrees a second while running); the classic scheme cuts the camera round.
 */
function turnInto(a: Approach, s: 1 | -1, scheme: ControlScheme, off: number, dt: number, doors = true): { tr: Track; budget: number } {
  const q = parallel(a, s)
  const c = a.door.center
  const lat = 1.5
  const sx = c.x - a.nx * lat - q.x * (off + TURN_RUN_IN)
  const sz = c.z - a.nz * lat - q.z * (off + TURN_RUN_IN)
  const headingQ = Math.atan2(q.x, q.z)
  const headingN = Math.atan2(a.nx, a.nz)
  const rig = new Rig(scheme, sx, sz, headingQ, doors)
  const tr = newTrack()
  // the path: the run-in, a quarter circle of radius v / omega, and what is left of the 1.5 m, then 2 m past the wall line
  const radius = RUN / (200 * DEG)
  const budget = (TURN_RUN_IN + off + (Math.PI / 2) * radius + Math.max(0, lat - radius) + 2) / RUN + ALLOWANCE
  try {
    let turning = false
    for (let i = 0, n = Math.ceil((budget + 1.5) / dt); i < n && tr.crossedAt < 0; i++) {
      const par = (rig.body.x - c.x) * q.x + (rig.body.z - c.z) * q.z
      if (par >= -off) turning = true
      if (scheme === 'easy') rig.step(dt, 1, turning ? turnKey(rig, headingN) : 0, true, 0)
      else rig.step(dt, 1, 0, true, turning ? headingN : headingQ)
      watch(tr, rig, a)
    }
    return { tr, budget }
  } finally {
    rig.dispose()
  }
}

describe('turning into a door at the last moment', () => {
  it(
    'running along the wall 1.5 m off and turning 90 degrees into the door (easy: A or D at the real turn rate; classic: the camera cut round) never overlaps a leaf box or a solid, and some turn point gets through each door',
    () => {
      collisionStats.backstopFallbacks = 0
      const stats = new Stats()
      // the stall check is "some turn point gets through": per approach, scheme and frame rate, the turn points that crossed
      const crossings = new Map<string, number>()
      let tried = 0
      for (const a of approachesOf(WALK_DOORS)) {
        // the run-in line (5 m, 1.5 m off the wall) and the doorway beyond the wall line must be clear, else there is no honest turn to make
        const throughOk = segmentClear(a.door.center.x - a.nx * 1.0, a.door.center.z - a.nz * 1.0, a.door.center.x + a.nx * 2.2, a.door.center.z + a.nz * 2.2)
        for (const s of [1, -1] as const) {
          const q = parallel(a, s)
          const lat = 1.5
          const x0 = a.door.center.x - a.nx * lat - q.x * (2.0 + TURN_RUN_IN)
          const z0 = a.door.center.z - a.nz * lat - q.z * (2.0 + TURN_RUN_IN)
          const x1 = a.door.center.x - a.nx * lat + q.x * 0.5
          const z1 = a.door.center.z - a.nz * lat + q.z * 0.5
          if (!throughOk || !startFree(x0, z0) || !segmentClear(x0, z0, x1, z1)) {
            stats.skipped++
            continue
          }
          for (const scheme of SCHEMES) {
            for (const dt of DTS) {
              const key = `${label(a)} along ${s > 0 ? '+' : '-'} ${scheme} dt ${dt.toFixed(4)}`
              crossings.set(key, 0)
              for (const off of TURN_OFFSETS) {
                tried++
                const { tr, budget } = turnInto(a, s, scheme, off, dt)
                const name = `${key} turn ${off} m short`
                // a body that did not line up with the opening hits a jamb and is held there: that is no stall (the check below is the stall check)
                const aimed = tr.crossedAt >= 0
                stats.add(name, tr, aimed ? budget : -1, aimed ? turnInto(a, s, scheme, off, dt, false).tr.crossedAt : NaN)
                if (aimed) crossings.set(key, crossings.get(key)! + 1)
              }
            }
          }
        }
      }
      const never = [...crossings.entries()].filter(([, n]) => n === 0).map(([k]) => k)
      expect(tried).toBeGreaterThan(100)
      stats.expectClean()
      expect(never.slice(0, 8), `${never.length} (approach, scheme, frame rate) triples where no turn point got through`).toEqual([])
      expect(collisionStats.backstopFallbacks).toBe(0)
      // eslint-disable-next-line no-console
      console.log(`${stats.report('case 4a, turning in at the last moment')}; ${tried} turns tried`)
    },
    LONG,
  )

  it(
    'a straight diagonal at 45 degrees to either side crosses every door, both ways and toward either hinge side, in distance / v + 0.5 s without touching a leaf box or a solid (the swing doors are double-acting: no leaf ever holds you)',
    () => {
      collisionStats.backstopFallbacks = 0
      const { stats, dists, hingeRuns } = sweepStraight(WALK_DOORS, [45 * DEG, -45 * DEG])
      expect(stats.runs).toBeGreaterThan(100)
      // the runs that used to be held by an open leaf (a swing door, the hinge side) are in the sweep, and they all cross
      expect(hingeRuns).toBeGreaterThan(200)
      stats.expectClean()
      expect(collisionStats.backstopFallbacks).toBe(0)
      // eslint-disable-next-line no-console
      console.log(`${stats.report('case 4b, 45 degree diagonals (both schemes)')}; starts: ${distSummary(dists)}; runs at a swing door starting on its hinge side: ${hingeRuns}`)
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------------------------
// 5. 20 frames a second
// ---------------------------------------------------------------------------------------------

/**
 * A 20 Hz frame (dt 1/20) moves a swing leaf's tip up to 16 cm and the body up to 21 cm at a run. Cases 1 and 4b again at that rate:
 * the claim is the same (never more than `EPS` inside a leaf box or a solid, across within distance / v + 0.5 s).
 */
const SLOW_DTS = [1 / 20] as const

describe('the same at 20 frames a second', () => {
  it(
    'case 1 at dt 1/20: every walk door straight on, both schemes, walk and run: across, never inside a leaf box nor a solid',
    () => {
      collisionStats.backstopFallbacks = 0
      const { stats, dists } = sweepStraight(WALK_DOORS, [0], SCHEMES, SLOW_DTS)
      expect(stats.runs).toBeGreaterThan(100)
      stats.expectClean()
      expect(collisionStats.backstopFallbacks).toBe(0)
      // eslint-disable-next-line no-console
      console.log(`${stats.report('case 1 at 20 Hz, walk doors straight on (both schemes)')}; starts: ${distSummary(dists)}`)
    },
    LONG,
  )

  it(
    'case 4b at dt 1/20: 45 degree diagonals to either side of every door, both ways: across, never inside a leaf box nor a solid',
    () => {
      collisionStats.backstopFallbacks = 0
      const { stats, dists, hingeRuns } = sweepStraight(WALK_DOORS, [45 * DEG, -45 * DEG], SCHEMES, SLOW_DTS)
      expect(stats.runs).toBeGreaterThan(30)
      expect(hingeRuns).toBeGreaterThan(60)
      stats.expectClean()
      expect(collisionStats.backstopFallbacks).toBe(0)
      // eslint-disable-next-line no-console
      console.log(`${stats.report('case 4b at 20 Hz, 45 degree diagonals (both schemes)')}; starts: ${distSummary(dists)}; runs at a swing door starting on its hinge side: ${hingeRuns}`)
    },
    LONG,
  )
})

// ---------------------------------------------------------------------------------------------
// 6. A leaf swinging into a body that stands in its arc
// ---------------------------------------------------------------------------------------------

describe('a swing leaf sweeping into a body standing in its arc', () => {
  it(
    'somebody opens the door from one side while you stand, unseen by the door, in the arc on the other: the leaf swings away from the opener and pushes you out of its way (never left inside it)',
    () => {
      collisionStats.backstopFallbacks = 0
      const bad: string[] = []
      let probes = 0
      const byDt = new Map<number, { n: number; swept: number; worst: number; worstAt: string; final: number }>()
      for (const door of SWING_DOORS) {
        const wd = walkLayout.doors[walkIndex.get(door.id)!]
        for (const s of [1, -1] as const) {
          // the opener is on side `s` of the wall, you are on the other side (-s), where the leaf swings
          const opener = person(door.center.x + wd.into.x * s * 1.2, door.center.z + wd.into.z * s * 1.2)
          for (const m of [0.45, 0.7, 1.0]) {
            for (const lateral of [-0.5, -0.25, 0, 0.25, 0.5]) {
              const x = door.center.x - wd.into.x * s * m + wd.along.x * lateral
              const z = door.center.z - wd.into.z * s * m + wd.along.z * lateral
              if (!startFree(x, z) || staticClearance(x, z).d < R + 0.05) continue
              for (const dt of [1 / 20, 1 / 30, 1 / 60, 1 / 144]) {
                const rig = new Rig('easy', x, z, 0)
                rig.people = [opener]
                try {
                  const tr = newTrack()
                  for (let i = 0, n = Math.round(1.5 / dt); i < n; i++) {
                    rig.step(dt, 0, 0, false, 0, false)
                    watch(tr, rig, { door, dir: 1, nx: 0, nz: 0, towardLeaf: true })
                  }
                  const name = `${door.id} opener on side ${s}, you ${m} m out at ${lateral} m along, dt ${dt.toFixed(4)}`
                  probes++
                  const rec = byDt.get(dt) ?? { n: 0, swept: 0, worst: -Infinity, worstAt: '', final: -Infinity }
                  byDt.set(dt, rec)
                  rec.n++
                  const swing = rig.bank.swing[walkIndex.get(door.id)!]
                  if (swing !== -s) bad.push(`${name}: the leaf swung ${swing} (the way of the opener, not away from it)`)
                  const inside = R - tr.minLeaf
                  if (inside > 0.001) rec.swept++
                  if (inside > rec.worst) {
                    rec.worst = inside
                    rec.worstAt = name
                  }
                  // after 1.5 s the leaf has long been wide open: the body must be clear of it (the push is rate limited, so a body
                  // is only ever inside a leaf for the few frames it takes to get out of its way)
                  const end = R - rig.leafDistance()
                  rec.final = Math.max(rec.final, end)
                  if (end > EPS) bad.push(`${name}: still inside the open leaf by ${(end * 100).toFixed(2)} cm after 1.5 s`)
                } finally {
                  rig.dispose()
                }
              }
            }
          }
        }
      }
      expect(probes).toBeGreaterThan(200)
      expect(bad.slice(0, 8), `${bad.length} probes`).toEqual([])
      expect(collisionStats.backstopFallbacks).toBe(0)
      const lines = [...byDt.entries()]
        .sort((p, q) => q[0] - p[0])
        .map(([dt, r]) => `dt ${dt.toFixed(4)}: ${r.swept}/${r.n} swept >1 mm in, worst ${(r.worst * 100).toFixed(2)} cm (${r.worstAt}), left inside after 1.5 s ${(Math.max(r.final, 0) * 100).toFixed(3)} cm`)
      // eslint-disable-next-line no-console
      console.log(`case 6, a leaf sweeping into a body in its arc (the transient is the solver's rate-limited push):\n${lines.join('\n')}`)
    },
    LONG,
  )
})
