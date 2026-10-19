import { describe, expect, it } from 'vitest'
import { getLayout } from '@/scene/building/layout'
import type { Footprint } from '@/scene/building/layout/types'
import {
  ARRIVALS,
  ATRIUM,
  BANDS,
  COMMAND_SEATS,
  CORE,
  CORRIDOR_CENTER,
  DEPARTURES,
  DOCTORS_BASE,
  DOORS,
  LOBBY,
  NURSE_HUB,
  PHARMACY,
  ROOMS,
  WALL,
} from '../places'
import { l2, levelOf } from '../levels'
import { mulberry32 } from '../rng'
import type { Vec2 } from '../types'
import { PathFollower } from './follower'
import { nodeAnchor } from './ids'
import {
  CORRIDOR_CHAINS,
  NAV,
  NAV_WARNINGS,
  nearestNode,
  planRoute,
  roomNodeId,
  routeLength,
  tryPlanRoute,
} from './graph'
import {
  OBSTACLES,
  PHARMACIST_ZONES,
  WALK_ZONES,
  inRobotOnlyCore,
  isWalkable,
  nearestWalkable,
  segmentWalkable,
} from './layout'

// ---------------------------------------------------------------------------------------------
// Independent helpers (deliberately not reusing the code under test)
// ---------------------------------------------------------------------------------------------

/** Points along a polyline every `step` metres, including the vertices. */
function sample(path: readonly Vec2[], step = 0.05): Vec2[] {
  const out: Vec2[] = [path[0]]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step))
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n })
  }
  return out
}

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(px - ax - dx * t, pz - az - dz * t)
}

function inCorridorInterior(x: number, z: number): boolean {
  return x >= -39.95 && x <= 39.95 && Math.abs(z) > BANDS.innerWall + 0.05 && Math.abs(z) < BANDS.roomWall - 0.05
}

/** Corridor rule for a polyline: inside a corridor every segment is a perpendicular spur or on the centre line. */
function corridorRuleViolations(path: readonly Vec2[]): string[] {
  const bad: string[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1))
    let inside = false
    for (let k = 0; k <= n && !inside; k++) inside = inCorridorInterior(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n)
    if (!inside) continue
    const vertical = Math.abs(a.x - b.x) < 1e-6
    const onCentre = Math.abs(Math.abs(a.z) - CORRIDOR_CENTER) < 1e-6 && Math.abs(Math.abs(b.z) - CORRIDOR_CENTER) < 1e-6 && a.z * b.z > 0
    if (!vertical && !onCentre) bad.push(`(${a.x}, ${a.z}) -> (${b.x}, ${b.z})`)
  }
  return bad
}

function violatesCore(path: readonly Vec2[]): Vec2 | null {
  for (const p of sample(path, 0.05)) {
    const strictlyInCore = p.x > CORE.x0 + 0.01 && p.x < CORE.x1 - 0.01 && p.z > CORE.z0 + 0.01 && p.z < CORE.z1 - 0.01
    if (!strictlyInCore) continue
    const inPharmacistZone = Math.abs(p.x) <= 2 + 0.01 && Math.abs(p.z) >= 5.5 - 0.01
    if (!inPharmacistZone) return p
  }
  return null
}

/** First sample (every 5 cm) that is off walkable ground or inside a bed, with `margin` from walls and beds. Furniture is checked apart (below). */
function firstUnwalkable(path: readonly Vec2[], margin: number): Vec2 | null {
  for (const p of sample(path, 0.05)) if (!isWalkable(p.x, p.z, margin, -1)) return p
  return null
}

// --- furniture: an independent re-implementation of "keep `radius` from every footprint except the station you serve" ---

const FURNITURE: readonly Footprint[] = getLayout().footprints.filter((f) => !f.overhead && f.area !== 'outside')

function footprintGap(fp: Footprint, px: number, pz: number): number {
  if (fp.kind === 'circle') return Math.hypot(px - fp.x, pz - fp.z) - fp.hw
  const c = Math.cos(fp.rotationY)
  const s = Math.sin(fp.rotationY)
  const dx = px - fp.x
  const dz = pz - fp.z
  const qx = Math.abs(dx * c - dz * s) - fp.hw
  const qz = Math.abs(dx * s + dz * c) - fp.hd
  return qx <= 0 && qz <= 0 ? Math.max(qx, qz) : Math.hypot(Math.max(qx, 0), Math.max(qz, 0))
}

/**
 * Every place a body of the given radius, walking `path`, gets nearer than `radius` to a footprint. A footprint that
 * serves a station is skipped for the legs that pass within its `reach` of the station (a desk, a chair, a counter).
 */
function furnitureViolations(path: readonly Vec2[], radius: number): string[] {
  const bad: string[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const x0 = Math.min(a.x, b.x) - radius - 1
    const x1 = Math.max(a.x, b.x) + radius + 1
    const z0 = Math.min(a.z, b.z) - radius - 1
    const z1 = Math.max(a.z, b.z) + radius + 1
    for (const fp of FURNITURE) {
      const ext = Math.max(fp.hw, fp.hd)
      if (fp.x + ext < x0 || fp.x - ext > x1 || fp.z + ext < z0 || fp.z - ext > z1) continue
      const exempt = (fp.serves?.nodes ?? []).some((id) => {
        const n = NAV.node(id)
        return distToSeg(n.x, n.z, a.x, a.z, b.x, b.z) <= fp.serves!.reach
      })
      if (exempt) continue
      for (const p of sample([a, b], 0.05)) {
        if (footprintGap(fp, p.x, p.z) < radius - 1e-9) {
          bad.push(`${fp.id} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`)
          break
        }
      }
    }
  }
  return bad
}

const ENTRANCE: Vec2 = LOBBY.entrance

/**
 * Which free spots (0.3 m from walls, beds and furniture) can be walked to from the entrance? A flood fill on a 0.2 m
 * grid, independent of the nav graph and ignoring its corridor rule (so it is a superset of what routes reach).
 */
function reachableGrid(): (x: number, z: number) => boolean {
  const cs = 0.2
  const x0 = -63
  const z0 = -23
  const cols = Math.ceil(105 / cs)
  const rows = Math.ceil(46 / cs)
  const seen = new Uint8Array(cols * rows)
  const cellOf = (x: number, z: number) => Math.floor((z - z0) / cs) * cols + Math.floor((x - x0) / cs)
  const stack = [cellOf(ENTRANCE.x, ENTRANCE.z)]
  seen[stack[0]] = 1
  while (stack.length) {
    const c = stack.pop()!
    const r = Math.floor(c / cols)
    const q = c % cols
    for (const [dr, dq] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const rr = r + dr
      const qq = q + dq
      if (rr < 0 || rr >= rows || qq < 0 || qq >= cols) continue
      const n = rr * cols + qq
      if (seen[n] || !isWalkable(x0 + (qq + 0.5) * cs, z0 + (rr + 0.5) * cs, 0.3)) continue
      seen[n] = 1
      stack.push(n)
    }
  }
  return (x, z) => seen[cellOf(x, z)] === 1
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

describe('layout', () => {
  it('has no walkable ground in the robot-only core except the two pharmacist zones', () => {
    let leaks = 0
    let missing = 0
    for (let x = CORE.x0 + 0.3; x < CORE.x1; x += 0.5) {
      for (let z = CORE.z0 + 0.3; z < CORE.z1; z += 0.5) {
        const inZone = Math.abs(x) < 1.95 && Math.abs(z) > 5.55 && Math.abs(z) < 11.85
        const outside = !(Math.abs(x) <= 2.05 && Math.abs(z) >= 5.45)
        const w = isWalkable(x, z)
        if (inZone && !w) missing++
        if (outside && Math.abs(z) < 11.55 && w) leaks++
        // the helper agrees with the geometry
        if (inRobotOnlyCore(x, z)) expect(w, `(${x}, ${z})`).toBe(false)
      }
    }
    expect(leaks).toBe(0)
    expect(missing).toBe(0)
    // the pharmacist zone is x in [-2, 2], |z| in [5.5, 12]
    expect(PHARMACIST_ZONES).toHaveLength(2)
    for (const p of PHARMACIST_ZONES) {
      expect(p.rect.x0).toBe(-2)
      expect(p.rect.x1).toBe(2)
      expect(Math.min(Math.abs(p.rect.z0), Math.abs(p.rect.z1))).toBeCloseTo(5.5, 9)
      expect(Math.max(Math.abs(p.rect.z0), Math.abs(p.rect.z1))).toBeCloseTo(12 - WALL.thickness / 2, 9)
    }
  })

  it('keeps people off every robot path in the core: x = +-8, |z| = 2 and the MedVend island', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const z = 2 + t * 10
      for (const x of [-8, 8]) {
        expect(isWalkable(x, z)).toBe(false)
        expect(isWalkable(x, -z)).toBe(false)
      }
      const x = -8 + t * 16
      expect(isWalkable(x, 2)).toBe(false)
      expect(isWalkable(x, -2)).toBe(false)
    }
    for (let x = -6; x <= 6; x += 0.25) for (let z = -1.2; z <= 1.2; z += 0.2) expect(isWalkable(x, z)).toBe(false)
  })

  it('makes walls solid except at doors, and doors passable', () => {
    // corridor A -> room A1 along a stretch of wall that has no door
    expect(segmentWalkable(-21.5, -14, -21.5, -18)).toBe(false)
    // ... and through the door
    expect(segmentWalkable(-23.9, -14, -23.9, -18, 0.3)).toBe(true)
    // between two rooms
    expect(segmentWalkable(-22, -19, -18, -19)).toBe(false)
    // a wall point itself
    expect(isWalkable(-21.5, -16)).toBe(false)
    // the robot doors in the corridor/core wall are not for people
    expect(segmentWalkable(8, -14, 8, -10, 0)).toBe(false)
    expect(segmentWalkable(-8, -14, -8, -10, 0)).toBe(false)
    // every door is passable, both ways, with 0.3 m clearance (exterior doors, whose two sides are the same area,
    // only from the inside: the outside is not walkable)
    for (const d of DOORS) {
      const dir = d.wallAxis === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 }
      const a = { x: d.center.x - dir.x * 0.8, z: d.center.z - dir.z * 0.8 }
      const b = { x: d.center.x + dir.x * 0.8, z: d.center.z + dir.z * 0.8 }
      if (d.a === d.b) {
        expect(segmentWalkable(b.x, b.z, d.center.x, d.center.z, 0.3)).toBe(true)
        continue
      }
      expect(segmentWalkable(a.x, a.z, b.x, b.z, 0.3), `door ${d.id}`).toBe(true)
    }
  })

  it('treats beds as 1.0 x 2.1 m obstacles centred at room.bed', () => {
    expect(OBSTACLES).toHaveLength(ROOMS.length)
    for (const r of ROOMS) {
      expect(isWalkable(r.bed.x, r.bed.z)).toBe(false)
      expect(isWalkable(r.bed.x + 0.49, r.bed.z + 1.04)).toBe(false)
      expect(isWalkable(r.bed.x + 0.51, r.bed.z)).toBe(true)
      expect(isWalkable(r.bed.x, r.bed.z + 1.06)).toBe(true)
      expect(isWalkable(r.bed.x - 0.51, r.bed.z - 1.0)).toBe(true)
      // the margin grows the bed
      expect(isWalkable(r.bed.x + 0.7, r.bed.z, 0.3)).toBe(false)
      expect(isWalkable(r.bed.x + 0.85, r.bed.z, 0.3)).toBe(true)
    }
  })

  it('has walkable anchors for every place people stand, with 0.3 m clearance', () => {
    const spots: [string, Vec2][] = [
      ['entrance', LOBBY.entrance],
      ['reception', LOBBY.reception.at],
      ['cafe', ATRIUM.cafe.at],
      ['garden', ATRIUM.garden],
      ['doctorsBase', DOCTORS_BASE.at],
      ...LOBBY.kiosks.map((k, i): [string, Vec2] => [`kiosk${i}`, k]),
      ...COMMAND_SEATS.map((s, i): [string, Vec2] => [`seat${i}`, s.at]),
      ['deskA', PHARMACY.desk.A.spot],
      ['deskB', PHARMACY.desk.B.spot],
    ]
    for (const w of ['A', 'B'] as const) NURSE_HUB[w].forEach((s, i) => spots.push([`hub${w}${i}`, s.at]))
    for (const r of ROOMS) {
      spots.push([`${r.id}.doorOutside`, r.doorOutside], [`${r.id}.doorInside`, r.doorInside], [`${r.id}.bedside`, r.bedside])
      spots.push([`${r.id}.drawerSpot`, r.drawerSpot], [`${r.id}.chair`, r.chair])
    }
    for (const [name, p] of spots) expect(isWalkable(p.x, p.z, 0.3), name).toBe(true)
  })

  it('snaps stray points to walkable ground', () => {
    const out: Vec2 = { x: 0, z: 0 }
    let count = 0
    for (let x = -63; x <= 41; x += 1.7) {
      for (let z = -23; z <= 23; z += 1.7) {
        nearestWalkable(x, z, 0.3, out)
        expect(isWalkable(out.x, out.z, 0.3), `(${x}, ${z}) -> (${out.x}, ${out.z})`).toBe(true)
        if (isWalkable(x, z, 0.3)) expect(out).toEqual({ x, z })
        count++
      }
    }
    expect(count).toBeGreaterThan(1000)
    // a point in the middle of the core goes to a pharmacist zone, a point in a bed goes beside it
    nearestWalkable(0, 0, 0.3, out)
    expect(Math.abs(out.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(out.z)).toBeGreaterThanOrEqual(5.5)
    const bed = ROOMS[0].bed
    nearestWalkable(bed.x, bed.z, 0.3, out)
    expect(isWalkable(out.x, out.z, 0.3)).toBe(true)
  })

  it('has zones for every non-robot area and one bridge per door', () => {
    expect(WALK_ZONES.filter((z) => z.kind === 'door')).toHaveLength(DOORS.length)
    expect(WALK_ZONES.filter((z) => z.kind === 'pharmacist')).toHaveLength(2)
    expect(WALK_ZONES.some((z) => z.area === 'core' && z.kind === 'area')).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// The checkers themselves
// ---------------------------------------------------------------------------------------------

describe('rule checkers (they must be able to fail)', () => {
  it('flags a diagonal across a corridor, but not the centre line or a perpendicular spur', () => {
    expect(corridorRuleViolations([{ x: -10, z: -14 }, { x: 10, z: -14 }])).toEqual([])
    expect(corridorRuleViolations([{ x: -13.9, z: -14 }, { x: -13.9, z: -17 }])).toEqual([])
    expect(corridorRuleViolations([{ x: -10, z: -14 }, { x: -6, z: -15.2 }])).toHaveLength(1)
    expect(corridorRuleViolations([{ x: -10, z: -15.3 }, { x: 10, z: -15.3 }])).toHaveLength(1) // along the room side, off the centre line
    expect(corridorRuleViolations([{ x: 5, z: 13 }, { x: 5, z: 15 }, { x: 8, z: 15 }])).toHaveLength(1)
  })

  it('flags paths through the core, a wall or a bed', () => {
    expect(violatesCore([{ x: 5, z: -14 }, { x: 5, z: -8 }])).not.toBeNull()
    expect(violatesCore([{ x: 8, z: -11 }, { x: 8, z: 0 }])).not.toBeNull()
    expect(violatesCore([{ x: 0, z: -14 }, { x: 0, z: -7 }])).toBeNull()
    expect(firstUnwalkable([{ x: -21.5, z: -14 }, { x: -21.5, z: -18 }], 0)).not.toBeNull()
    const bed = ROOMS[0].bed
    expect(firstUnwalkable([{ x: bed.x - 1.5, z: bed.z }, { x: bed.x + 1.5, z: bed.z }], 0)).not.toBeNull()
    expect(firstUnwalkable([{ x: -23.9, z: -14 }, { x: -23.9, z: -17 }], 0.3)).toBeNull()
  })

  it('snaps a point on the room side of the corridor to a centre-line node by stepping across, never along or diagonally', () => {
    const n = nearestNode({ x: -5.2, z: -15.3 })
    expect(n.z).toBe(-CORRIDOR_CENTER)
    // the centre-line nodes around x = -5.2 are at -8 and -4: the closer one (by the path across then along) wins
    expect(n.x).toBe(-4)
  })
})

// ---------------------------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------------------------

describe('nav graph', () => {
  it('builds without warnings and has a sensible size', () => {
    expect(NAV_WARNINGS).toEqual([])
    expect(NAV.nodes.length).toBeGreaterThan(200)
    expect(NAV.edges.length).toBeGreaterThan(NAV.nodes.length)
    // eslint-disable-next-line no-console
    console.log(`nav graph: ${NAV.nodes.length} nodes, ${NAV.edges.length} edges`)
  })

  it('keeps every node on walkable ground with 0.3 m clearance and has unique ids', () => {
    for (const n of NAV.nodes) expect(isWalkable(n.x, n.z, 0.3), n.id).toBe(true)
    expect(new Set(NAV.nodes.map((n) => n.id)).size).toBe(NAV.nodes.length)
  })

  it('is one connected component per level, and no edge crosses between the levels (R2: only the lifts join them)', () => {
    for (const level of [1, 2] as const) {
      const nodes = NAV.nodes.filter((n) => levelOf(n.x) === level)
      expect(nodes.length).toBeGreaterThan(level === 1 ? 300 : 40)
      const seen = new Set<number>([nodes[0].index])
      const stack = [nodes[0].index]
      while (stack.length) {
        for (const l of NAV.adj[stack.pop()!]) {
          expect(levelOf(NAV.nodes[l.to].x)).toBe(level)
          if (!seen.has(l.to)) {
            seen.add(l.to)
            stack.push(l.to)
          }
        }
      }
      expect(seen.size, `level ${level}`).toBe(nodes.length)
    }
  })

  it('never plans a walked route between the levels (R2): no route, and planRoute leaves the walker where it is', () => {
    const down = { x: -42, z: -19 }
    const up = { x: l2(-42), z: -19 }
    expect(tryPlanRoute(down, up)).toBeNull()
    expect(planRoute(up, down)).toEqual([up])
    // within level 2 there is a route from the lift lobby to the OR door
    expect(tryPlanRoute(up, { x: l2(-47), z: 3.6 })).not.toBeNull()
  })

  it('has corridor centre-line nodes at |z| = 14 at every door x, every 4 m, plus the spine junction', () => {
    for (const w of ['A', 'B'] as const) {
      const sign = w === 'A' ? -1 : 1
      const chain = CORRIDOR_CHAINS[w]
      for (const e of chain) expect(NAV.nodes[e.index].z).toBe(sign * CORRIDOR_CENTER)
      for (const d of DOORS) {
        if (Math.sign(d.center.z) !== sign || Math.abs(Math.abs(d.center.z) - BANDS.roomWall) > 1e-9 && Math.abs(Math.abs(d.center.z) - BANDS.innerWall) > 1e-9) continue
        if (Math.abs(d.center.x) > 39) continue
        expect(chain.some((e) => Math.abs(e.x - d.center.x) < 0.05), `${w} door ${d.id}`).toBe(true)
      }
      // no gap larger than 4.1 m on the centre line anywhere (W2: the stretch across the former U-turns is ordinary corridor now),
      // and every neighbouring pair is linked
      const sorted = [...chain].sort((a, b) => a.x - b.x)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].x - sorted[i - 1].x).toBeLessThanOrEqual(4.1 + 1e-9)
        expect(NAV.adj[sorted[i - 1].index].some((l) => l.to === sorted[i].index), `${w} chain link at x = ${sorted[i].x}`).toBe(true)
      }
      expect(NAV.has(`spine:${sign * CORRIDOR_CENTER}`)).toBe(true)
    }
  })

  it('has the per-room chain doorOutside -> door -> doorInside -> bedside / drawerSpot / chair', () => {
    for (const r of ROOMS) {
      const out = NAV.node(roomNodeId(r.id, 'doorOutside'))
      expect(out.z).toBe((r.ward === 'A' ? -1 : 1) * CORRIDOR_CENTER)
      expect(NAV.node(roomNodeId(r.id, 'door'))).toMatchObject({ x: r.door.x, z: r.door.z })
      expect(NAV.node(roomNodeId(r.id, 'doorInside'))).toMatchObject({ x: r.doorInside.x, z: r.doorInside.z })
      expect(NAV.node(roomNodeId(r.id, 'bedside'))).toMatchObject({ x: r.bedside.x, z: r.bedside.z })
      expect(NAV.node(roomNodeId(r.id, 'drawerSpot'))).toMatchObject({ x: r.drawerSpot.x, z: r.drawerSpot.z })
      expect(NAV.node(roomNodeId(r.id, 'chair'))).toMatchObject({ x: r.chair.x, z: r.chair.z })
    }
  })

  it('has no edge that crosses a wall, a bed or the robot-only core', () => {
    for (const e of NAV.edges) {
      const a = NAV.nodes[e.a]
      const b = NAV.nodes[e.b]
      expect(firstUnwalkable([a, b], 0.3), `${a.id} -> ${b.id}`).toBeNull()
      expect(violatesCore([a, b]), `${a.id} -> ${b.id}`).toBeNull()
    }
  })

  it('has no edge through furniture: every edge keeps 0.3 m from every footprint except the one it serves', () => {
    for (const e of NAV.edges) {
      const a = NAV.nodes[e.a]
      const b = NAV.nodes[e.b]
      expect(furnitureViolations([a, b], 0.3), `${a.id} -> ${b.id}`).toEqual([])
    }
  })

  it('the furniture check can fail: an edge through the reception desk or a lobby seat row is caught', () => {
    expect(furnitureViolations([{ x: -23, z: -6 }, { x: -20.6, z: -6 }], 0.25).length).toBeGreaterThan(0) // through a command desk
    expect(furnitureViolations([{ x: -61, z: -5.3 }, { x: -57, z: -5.3 }], 0.25).length).toBeGreaterThan(0)
    expect(furnitureViolations([{ x: -61, z: 0 }, { x: -57, z: 0 }], 0.25)).toEqual([])
  })

  it('the station nodes a footprint serves are where nodeAnchor says (layout.ts resolves them without the graph)', () => {
    for (const fp of getLayout().footprints) {
      for (const id of fp.serves?.nodes ?? []) {
        const n = NAV.node(id)
        expect(nodeAnchor(id), id).toEqual({ x: n.x, z: n.z })
      }
    }
  })

  it('has arrival, departure and door nodes: arrivals, both outside doors and the lift lobbies', () => {
    const at = (id: string) => NAV.node(id)
    expect(at('arrival:entrance')).toMatchObject({ x: ARRIVALS.entrance.at.x, z: ARRIVALS.entrance.at.z })
    expect(at('arrival:ambulance')).toMatchObject({ x: ARRIVALS.ambulance.at.x, z: ARRIVALS.ambulance.at.z })
    expect(at('door:ambulance')).toMatchObject({ x: -62, z: 10.4 })
    DEPARTURES.lifts.forEach((p, i) => expect(at(`departure:lift:${i}`)).toMatchObject({ x: p.x, z: p.z }))
    expect(DEPARTURES.entrance).toEqual({ x: ARRIVALS.entrance.at.x, z: ARRIVALS.entrance.at.z })
  })

  it('has no diagonal edge across a corridor: only the centre line and perpendicular door spurs', () => {
    for (const e of NAV.edges) {
      const a = NAV.nodes[e.a]
      const b = NAV.nodes[e.b]
      expect(corridorRuleViolations([a, b]), `${a.id} -> ${b.id}`).toEqual([])
    }
  })

  it('has no lane rule (W2: the pods ride a ceiling rail): the centre line is unbroken past the former lane bands and U-turns', () => {
    // where the pods used to drive the floor (x = +-27 +- 1.3, the room and inner lanes at |z| = 15.3 and 12.7): people's
    // nodes and edges are there now, and the long way along the centre line is one straight run
    for (const w of ['A', 'B'] as const) {
      const sign = w === 'A' ? -1 : 1
      const nodes = CORRIDOR_CHAINS[w].filter((e) => Math.abs(Math.abs(e.x) - 27) < 3.5)
      expect(nodes.length, `${w}: nodes at the former U-turns`).toBeGreaterThanOrEqual(4)
      const route = planRoute({ x: -38, z: sign * CORRIDOR_CENTER }, { x: 35, z: sign * CORRIDOR_CENTER })
      expect(routeLength(route)).toBeCloseTo(73, 6)
      expect(route.every((p) => Math.abs(p.z - sign * CORRIDOR_CENTER) < 1e-9)).toBe(true)
    }
    // door spurs reach the room wall across the whole corridor width, through the former lane bands
    for (const r of ROOMS) {
      const sign = r.ward === 'A' ? -1 : 1
      const a = NAV.node(roomNodeId(r.id, 'doorOutside'))
      const d = NAV.node(roomNodeId(r.id, 'door'))
      expect(a.z).toBe(sign * CORRIDOR_CENTER)
      expect(Math.abs(d.z)).toBeCloseTo(BANDS.roomWall, 9)
      expect(NAV.adj[a.index].some((l) => l.to === d.index), `${r.id} door spur`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

interface Target {
  name: string
  at: Vec2
}

const TARGETS: Target[] = [
  ...ROOMS.flatMap((r): Target[] => [
    { name: `${r.id}.bedside`, at: r.bedside },
    { name: `${r.id}.drawerSpot`, at: r.drawerSpot },
    { name: `${r.id}.chair`, at: r.chair },
  ]),
  ...(['A', 'B'] as const).flatMap((w): Target[] => NURSE_HUB[w].map((s, i) => ({ name: `hub${w}${i}`, at: s.at }))),
  { name: 'deskA', at: PHARMACY.desk.A.spot },
  { name: 'deskB', at: PHARMACY.desk.B.spot },
  ...COMMAND_SEATS.map((s, i): Target => ({ name: `seat${i}`, at: s.at })),
  { name: 'cafe', at: ATRIUM.cafe.at },
  { name: 'garden', at: ATRIUM.garden },
  { name: 'doctorsBase', at: DOCTORS_BASE.at },
]

describe('planRoute from the entrance', () => {
  const routes = TARGETS.map((t) => ({ t, route: tryPlanRoute(ENTRANCE, t.at) }))

  it('reaches every required target, starts at `from` and ends exactly on `to`', () => {
    expect(TARGETS.length).toBe(16 * 3 + 6 + 2 + 4 + 3)
    for (const { t, route } of routes) {
      expect(route, t.name).not.toBeNull()
      const r = route!
      expect(r[0]).toEqual({ x: ENTRANCE.x, z: ENTRANCE.z })
      expect(r[r.length - 1].x, t.name).toBe(t.at.x)
      expect(r[r.length - 1].z, t.name).toBe(t.at.z)
      const direct = Math.hypot(t.at.x - ENTRANCE.x, t.at.z - ENTRANCE.z)
      expect(routeLength(r), t.name).toBeGreaterThanOrEqual(direct - 1e-9)
      expect(routeLength(r), t.name).toBeLessThan(direct * 2.2 + 30)
    }
  })

  it('is fully walkable: with 0.25 m clearance of every wall and bed, sampled every 5 cm', () => {
    for (const { t, route } of routes) {
      expect(firstUnwalkable(route!, 0.25), t.name).toBeNull()
      expect(firstUnwalkable(route!, 0), t.name).toBeNull()
      expect(furnitureViolations(route!, 0.25), t.name).toEqual([])
    }
  })

  it('never enters the robot-only core outside the pharmacist zones', () => {
    for (const { t, route } of routes) expect(violatesCore(route!), t.name).toBeNull()
  })

  it('enters the core only to reach a pharmacist desk, through its door', () => {
    for (const { t, route } of routes) {
      const inCore = sample(route!, 0.05).some((p) => Math.abs(p.x) < 11.9 && Math.abs(p.z) < 11.9)
      expect(inCore, t.name).toBe(t.name === 'deskA' || t.name === 'deskB')
    }
  })

  it('follows the corridor rule', () => {
    for (const { t, route } of routes) expect(corridorRuleViolations(route!), t.name).toEqual([])
  })

  it('walks the corridor centre line and only leaves it to reach a door', () => {
    const route = tryPlanRoute(ENTRANCE, ROOMS.find((r) => r.id === 'B6')!.bedside)!
    // every point in the corridor is on the centre line or on a perpendicular spur
    const inCorr = sample(route).filter((p) => inCorridorInterior(p.x, p.z))
    expect(inCorr.length).toBeGreaterThan(100)
    const door = ROOMS.find((r) => r.id === 'B6')!.door
    for (const p of inCorr) {
      const onCentre = Math.abs(p.z - CORRIDOR_CENTER) < 1e-9
      const onSpur = Math.abs(p.x - door.x) < 1e-9
      expect(onCentre || onSpur).toBe(true)
    }
  })

  it('is deterministic: the same call gives the same result', () => {
    for (const t of TARGETS.slice(0, 20)) {
      const a = planRoute(ENTRANCE, t.at)
      const b = planRoute(ENTRANCE, t.at)
      expect(a).toEqual(b)
    }
    const back = planRoute(DOCTORS_BASE.at, ROOMS[11].chair)
    expect(planRoute(DOCTORS_BASE.at, ROOMS[11].chair)).toEqual(back)
  })

  it('treats ward A and ward B the same (mirror images)', () => {
    for (const a of ROOMS.filter((r) => r.ward === 'A')) {
      const b = ROOMS.find((r) => r.ward === 'B' && r.number === a.number)!
      for (const part of ['bedside', 'drawerSpot', 'chair'] as const) {
        const la = routeLength(planRoute(ENTRANCE, a[part]))
        const lb = routeLength(planRoute(ENTRANCE, b[part]))
        expect(la).toBeCloseTo(lb, 6)
      }
    }
  })

  it('goes round the foot of the bed to the drawer spot, never through the bed', () => {
    for (const r of ROOMS) {
      const route = planRoute(r.doorInside, r.drawerSpot)
      expect(firstUnwalkable(route, 0.25), r.id).toBeNull()
      // the bed lies between the door and the drawer spot, so the way is longer than the straight line
      expect(routeLength(route), r.id).toBeGreaterThan(Math.hypot(r.drawerSpot.x - r.doorInside.x, r.drawerSpot.z - r.doorInside.z) + 1)
    }
  })
})

describe('planRoute between arbitrary points', () => {
  it('routes between random walkable points anywhere in the building, obeying every rule', () => {
    const rnd = mulberry32(20261012)
    const reach = reachableGrid()
    const pick = (): Vec2 => {
      for (;;) {
        const p = { x: -62 + rnd() * 102, z: -22 + rnd() * 44 }
        // a free spot a body can actually get to (not a sliver behind a counter that is walled in by furniture)
        if (isWalkable(p.x, p.z, 0.3) && reach(p.x, p.z)) return p
      }
    }
    for (let i = 0; i < 250; i++) {
      const a = pick()
      const b = pick()
      const route = tryPlanRoute(a, b)
      expect(route, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`).not.toBeNull()
      const r = route!
      expect(r[r.length - 1]).toEqual(b)
      expect(firstUnwalkable(r, 0.25), `${JSON.stringify(a)} -> ${JSON.stringify(b)}`).toBeNull()
      expect(furnitureViolations(r, 0.25), `${JSON.stringify(a)} -> ${JSON.stringify(b)}`).toEqual([])
      expect(violatesCore(r)).toBeNull()
      expect(corridorRuleViolations(r), `${JSON.stringify(a)} -> ${JSON.stringify(b)}`).toEqual([])
    }
  })

  it('snaps a point standing where the room lane used to be perpendicularly onto the centre line', () => {
    const from = { x: -5.3, z: -15.3 } // the former room lane of ward A
    const to = { x: 10.4, z: -12.7 } // the former inner lane
    const route = planRoute(from, to)
    expect(route[0]).toEqual(from)
    expect(route[1]).toEqual({ x: -5.3, z: -14 })
    expect(route[route.length - 2]).toEqual({ x: 10.4, z: -14 })
    expect(route[route.length - 1]).toEqual(to)
    expect(corridorRuleViolations(route)).toEqual([])
  })

  it('handles a start inside a bed, an unwalkable destination and identical endpoints', () => {
    const r = ROOMS[2]
    const out = tryPlanRoute(r.bed, r.chair)
    expect(out).not.toBeNull()
    expect(out![0]).toEqual({ x: r.bed.x, z: r.bed.z })
    const same = planRoute(r.chair, r.chair)
    expect(same).toEqual([{ x: r.chair.x, z: r.chair.z }])
    const toBed = planRoute(ENTRANCE, r.pillow)
    expect(toBed[toBed.length - 1]).toEqual({ x: r.pillow.x, z: r.pillow.z })
  })

  it('finds the nearest node', () => {
    const r = ROOMS[5]
    expect(nearestNode(r.bedside).id).toBe(roomNodeId(r.id, 'bedside'))
    expect(nearestNode(r.chair.x, r.chair.z).id).toBe(roomNodeId(r.id, 'chair'))
    // a point in the corridor snaps onto the centre line, not across it
    const n = nearestNode({ x: -5.2, z: -15.2 })
    expect(n.kind).toBe('corridor')
    expect(n.z).toBe(-CORRIDOR_CENTER)
  })

  it('routes between every pair of a mixed set of places (no dead ends)', () => {
    const picks = [0, 5, 10, 17, 22, 27, 31, 40, 47, 50, 54, 58, 62, 66, 70].map((i) => TARGETS[i % TARGETS.length])
    for (const a of picks) {
      for (const b of picks) {
        const route = tryPlanRoute(a.at, b.at)
        expect(route, `${a.name} -> ${b.name}`).not.toBeNull()
        expect(firstUnwalkable(route!, 0.25), `${a.name} -> ${b.name}`).toBeNull()
        expect(furnitureViolations(route!, 0.25), `${a.name} -> ${b.name}`).toEqual([])
        expect(violatesCore(route!)).toBeNull()
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// PathFollower
// ---------------------------------------------------------------------------------------------

const DT = 1 / 60

function runUntilArrived(f: PathFollower, cruise: number, maxSteps = 60 * 600): { steps: number; maxSpeed: number; maxAccel: number; maxTurn: number } {
  let steps = 0
  let maxSpeed = 0
  let maxAccel = 0
  let maxTurn = 0
  let prevV = f.speed
  let prevH = f.heading
  while (steps < maxSteps) {
    const s = f.step(DT, cruise)
    steps++
    maxSpeed = Math.max(maxSpeed, f.speed)
    // the final step snaps onto the waypoint and sets the speed to 0 (from a creep of <= 0.12 m/s): not an acceleration
    if (s !== 'arrived') maxAccel = Math.max(maxAccel, Math.abs(f.speed - prevV) / DT)
    let dh = f.heading - prevH
    dh = dh - Math.PI * 2 * Math.round(dh / (Math.PI * 2))
    maxTurn = Math.max(maxTurn, Math.abs(dh) / DT)
    prevV = f.speed
    prevH = f.heading
    if (s === 'arrived') break
  }
  return { steps, maxSpeed, maxAccel, maxTurn }
}

describe('PathFollower', () => {
  const path = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 8 },
    { x: 4, z: 8 },
  ]

  it('walks a path, snaps exactly onto the last waypoint and stops', () => {
    const f = new PathFollower(0, 0)
    f.setPath(path)
    const total = 10 + 8 + 6
    expect(f.remaining).toBeCloseTo(total, 9)
    const { steps, maxSpeed } = runUntilArrived(f, 1.3)
    expect(f.x).toBe(4)
    expect(f.z).toBe(8)
    expect(f.speed).toBe(0)
    expect(f.active).toBe(false)
    expect(f.step(DT, 1.3)).toBe('arrived')
    // it cruised at the commanded speed and took about total / speed seconds (plus soft start, corners and stop)
    expect(maxSpeed).toBeLessThanOrEqual(1.3 + 1e-9)
    expect(maxSpeed).toBeGreaterThan(1.2)
    expect(steps * DT).toBeGreaterThan(total / 1.3)
    expect(steps * DT).toBeLessThan(total / 1.3 + 6)
  })

  it('accelerates softly (about 1.5 m/s^2) and turns its heading at most about 6 rad/s', () => {
    const f = new PathFollower(0, 0, Math.PI) // starts facing away
    f.setPath(path)
    const { maxAccel, maxTurn } = runUntilArrived(f, 1.9)
    expect(maxAccel).toBeLessThanOrEqual(1.5 + 1e-6)
    expect(maxTurn).toBeLessThanOrEqual(6 + 1e-6)
    expect(maxTurn).toBeGreaterThan(1)
  })

  it('stays exactly on the polyline (no corner cutting)', () => {
    const f = new PathFollower(0, 0)
    f.setPath(path)
    let worst = 0
    for (let i = 0; i < 3000; i++) {
      const s = f.step(DT, 1.6)
      let d = Infinity
      for (let k = 1; k < path.length; k++) d = Math.min(d, distToSeg(f.x, f.z, path[k - 1].x, path[k - 1].z, path[k].x, path[k].z))
      worst = Math.max(worst, d)
      if (s === 'arrived') break
    }
    expect(worst).toBeLessThan(1e-9)
  })

  it('slows into the final waypoint: it can always stop at 1.5 m/s^2 before the end', () => {
    const f = new PathFollower(0, 0)
    f.setPath([{ x: 0, z: 10 }])
    let worst = 0
    let speedNearEnd = Infinity
    for (let i = 0; i < 3000; i++) {
      const s = f.step(DT, 1.3)
      if (s === 'arrived') break
      // (inside the last 5 cm a 0.12 m/s creep keeps it from crawling asymptotically; that is not a braking failure)
      if (f.remaining > 0.05) worst = Math.max(worst, f.speed - Math.sqrt(2 * 1.5 * f.remaining))
      if (f.remaining <= 0.3) speedNearEnd = Math.min(speedNearEnd, f.speed)
    }
    expect(worst).toBeLessThan(0.01)
    expect(speedNearEnd).toBeLessThan(0.9)
    expect(f.z).toBe(10)
  })

  it('faces the direction of travel (heading = atan2(dx, dz))', () => {
    const f = new PathFollower(0, 0, 0)
    f.setPath([{ x: 10, z: 0 }]) // due east
    for (let i = 0; i < 120; i++) f.step(DT, 1.3)
    expect(f.heading).toBeCloseTo(Math.PI / 2, 2)
    const g = new PathFollower(0, 0, 0)
    g.setPath([{ x: 0, z: -10 }]) // due north
    for (let i = 0; i < 120; i++) g.step(DT, 1.3)
    expect(Math.abs(Math.abs(g.heading) - Math.PI)).toBeLessThan(0.01)
  })

  it('accepts a route that starts at its own position and re-routes while moving', () => {
    const f = new PathFollower(5, 5)
    f.setPath([{ x: 5, z: 5 }, { x: 5, z: 5.01 }, { x: 5, z: 9 }])
    expect(f.remaining).toBeCloseTo(4, 9)
    for (let i = 0; i < 30; i++) f.step(DT, 1.3)
    const v = f.speed
    expect(v).toBeGreaterThan(0.5)
    f.setPath([{ x: f.x, z: f.z }, { x: 9, z: f.z }])
    expect(f.speed).toBe(v) // speed is kept: no jerk
    while (f.step(DT, 1.3) !== 'arrived') {
      /* walk */
    }
    expect(f.x).toBe(9)
  })

  it('arrives at once for an empty path, and when already on a one-point path', () => {
    const f = new PathFollower(3, 3)
    f.setPath([])
    expect(f.step(DT, 1.3)).toBe('arrived')
    f.setPath([{ x: 3, z: 3 }])
    expect(f.step(DT, 1.3)).toBe('arrived')
    expect(f.x).toBe(3)
  })

  it('follows a real planned route end to end and arrives exactly on target', () => {
    const target = ROOMS.find((r) => r.id === 'A7')!.drawerSpot
    const route = planRoute(ENTRANCE, target)
    const f = new PathFollower(ENTRANCE.x, ENTRANCE.z)
    f.setPath(route)
    const { steps } = runUntilArrived(f, 1.3, 60 * 600)
    expect(f.x).toBe(target.x)
    expect(f.z).toBe(target.z)
    expect(steps * DT).toBeGreaterThan(routeLength(route) / 1.3)
    expect(steps * DT).toBeLessThan(routeLength(route) / 1.3 + 15)
  })

  it('is never held in a doorway: a walker goes from the corridor through a room door without a single stop (no crossing zones)', () => {
    const room = ROOMS.find((r) => r.id === 'A3')!
    const route = planRoute(room.doorOutside, room.doorInside)
    const f = new PathFollower(room.doorOutside.x, room.doorOutside.z)
    f.setPath(route)
    let steps = 0
    let slowest = Infinity
    for (; steps < 60 * 60; steps++) {
      const st = f.step(DT, 1.3)
      if (st === 'arrived') break
      // (the first second is the soft start from rest: past it, the walker never drops below a walking pace until the stop)
      if (steps > 60 && f.remaining > 1) slowest = Math.min(slowest, f.speed)
    }
    expect(f.x).toBe(room.doorInside.x)
    expect(f.z).toBe(room.doorInside.z)
    expect(steps * DT).toBeLessThan(routeLength(route) / 1.3 + 3)
    expect(slowest).toBeGreaterThan(0.5)
  })

  it('does not allocate in step', () => {
    // A cheap structural guard: no `new`, no closures, no spreads, no array or object literals in the hot path.
    const src = PathFollower.prototype.step.toString() + PathFollower.prototype['advance' as keyof PathFollower].toString()
    expect(src).not.toMatch(/\bnew\b|=>|\.\.\.|\[\s*\]|=\s*\{/)
  })
})
