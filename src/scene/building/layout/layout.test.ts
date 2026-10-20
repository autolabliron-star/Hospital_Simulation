/**
 * Node tests of the building layout (pure data, no DOM): furniture keeps clear of people's routes and the robot lanes,
 * no wall covers a door or a MedDrawer gap (W2: the robot doors are gone, the pods cross into the core near the ceiling), the layout is deterministic and stays inside its walls, and the
 * draw-call and triangle estimate is inside the M2 budget.
 */
import { describe, expect, it } from 'vitest'
import { NAV } from '@/sim/nav/graph'
import { CIRCUITS, pointAt, type PathPoint } from '@/sim/meds/circuit'
import { AREAS, BUILDING, CORE, DOORS, ROBOT, ROOMS, areaById, wardSign } from '@/sim/places'
import { WAYFINDING } from '@/scene/materials'
import { L2_BRANCHES, L2_LANES, wayfindingSegments, LINE_WIDTH } from '@/scene/wayfinding/lines'
import { areaAt } from '@/sim/places'
import { levelOf } from '@/sim/levels'
import { buildLayout } from './index'
import { compileLayout, estimateBudget } from '../render/compile'
import { DRAWER_GAP, buildWallPieces } from './walls'
import type { Footprint, Prim } from './types'

const layout = buildLayout()

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/** Distance from a point to a footprint (0 inside it). */
function distPoint(fp: Footprint, px: number, pz: number): number {
  if (fp.kind === 'circle') return Math.max(0, Math.hypot(px - fp.x, pz - fp.z) - fp.hw)
  const c = Math.cos(fp.rotationY)
  const s = Math.sin(fp.rotationY)
  const dx = px - fp.x
  const dz = pz - fp.z
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.hypot(Math.max(0, Math.abs(lx) - fp.hw), Math.max(0, Math.abs(lz) - fp.hd))
}

function distPointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

/** Distance from a footprint to a segment: sampled finely (steps of 2 cm), which is exact enough for 1 cm tolerances. */
function distSegment(fp: Footprint, ax: number, az: number, bx: number, bz: number): number {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(1, Math.ceil(len / 0.02))
  let best = Infinity
  for (let i = 0; i <= n; i++) {
    const t = i / n
    best = Math.min(best, distPoint(fp, ax + (bx - ax) * t, az + (bz - az) * t))
    if (best === 0) return 0
  }
  return best
}

/** Corner points of a footprint (circles: 8 points on the rim), for the inside-the-walls test. */
function extent(fp: Footprint): { x0: number; x1: number; z0: number; z1: number } {
  if (fp.kind === 'circle') return { x0: fp.x - fp.hw, x1: fp.x + fp.hw, z0: fp.z - fp.hw, z1: fp.z + fp.hw }
  const c = Math.abs(Math.cos(fp.rotationY))
  const s = Math.abs(Math.sin(fp.rotationY))
  const ex = fp.hw * c + fp.hd * s
  const ez = fp.hw * s + fp.hd * c
  return { x0: fp.x - ex, x1: fp.x + ex, z0: fp.z - ez, z1: fp.z + ez }
}

// ---------------------------------------------------------------------------------------------
// Keep clear of people's routes
// ---------------------------------------------------------------------------------------------

const ROUTE_CLEARANCE = 0.35
const LANE_CLEARANCE = 0.45
/** The most a station's exemption may reach: a desk, a counter or a bed is the destination of the nodes within this. */
const MAX_EXEMPT_REACH = 2.5

describe('furniture keeps clear of people routes', () => {
  const solid = layout.footprints.filter((f) => !f.overhead)

  it('has footprints to check', () => {
    expect(solid.length).toBeGreaterThan(200)
  })

  it('exemptions name real nav nodes and stay small', () => {
    for (const f of layout.footprints) {
      if (!f.serves) continue
      expect(f.serves.reach, f.id).toBeLessThanOrEqual(MAX_EXEMPT_REACH)
      for (const id of f.serves.nodes) expect(NAV.has(id), `${f.id} serves unknown node ${id}`).toBe(true)
    }
    // exemptions are for seats, stations and desks only: a short, explicit list
    const served = layout.footprints.filter((f) => f.serves)
    expect(served.length).toBeLessThanOrEqual(40)
  })

  /** Everything within 0.35 m of the footprint, ignoring what it serves. */
  function clearanceViolations(fp: Footprint): string[] {
    const out: string[] = []
    const exempt = (fp.serves?.nodes ?? []).map((id) => NAV.node(id))
    const reach = fp.serves?.reach ?? 0
    const nearExempt = (x: number, z: number) => exempt.some((n) => Math.hypot(n.x - x, n.z - z) <= reach)
    const nearExemptSegment = (ax: number, az: number, bx: number, bz: number) => exempt.some((n) => distPointSegment(n.x, n.z, ax, az, bx, bz) <= reach)
    const e = extent(fp)
    for (const n of NAV.nodes) {
      if (n.x < e.x0 - 1 || n.x > e.x1 + 1 || n.z < e.z0 - 1 || n.z > e.z1 + 1) continue
      if (nearExempt(n.x, n.z)) continue
      const d = distPoint(fp, n.x, n.z)
      if (d < ROUTE_CLEARANCE - 1e-9) out.push(`${fp.id}: node ${n.id} is ${d.toFixed(2)} m away`)
    }
    for (const edge of NAV.edges) {
      const a = NAV.nodes[edge.a]
      const b = NAV.nodes[edge.b]
      if (Math.max(a.x, b.x) < e.x0 - 1 || Math.min(a.x, b.x) > e.x1 + 1 || Math.max(a.z, b.z) < e.z0 - 1 || Math.min(a.z, b.z) > e.z1 + 1) continue
      if (nearExemptSegment(a.x, a.z, b.x, b.z)) continue
      const d = distSegment(fp, a.x, a.z, b.x, b.z)
      if (d < ROUTE_CLEARANCE - 1e-9) out.push(`${fp.id}: edge ${a.id} -> ${b.id} is ${d.toFixed(2)} m away`)
    }
    return out
  }

  it('every footprint keeps >= 0.35 m from every nav edge and node (except what it serves)', () => {
    const offenders = solid.flatMap(clearanceViolations)
    expect(offenders).toEqual([])
  })

  it('the check itself works: a desk dropped on the corridor centre line or a door spur is caught', () => {
    const onCorridor: Footprint = { id: 'probe:corridor', area: 'corridorA', kind: 'rect', x: -14, z: -14, hw: 0.5, hd: 0.3, rotationY: 0 }
    expect(clearanceViolations(onCorridor).length).toBeGreaterThan(0)
    const r = ROOMS[0]
    const onSpur: Footprint = { id: 'probe:door', area: `room:${r.id}`, kind: 'circle', x: r.doorInside.x, z: r.doorInside.z, hw: 0.3, hd: 0.3, rotationY: 0 }
    expect(clearanceViolations(onSpur).length).toBeGreaterThan(0)
    // and a spot in a pocket between routes is clean
    const free: Footprint = { id: 'probe:free', area: `room:${r.id}`, kind: 'circle', x: r.rect.x0 + 0.3, z: r.rect.z0 + 3, hw: 0.2, hd: 0.2, rotationY: 0 }
    expect(clearanceViolations(free)).toEqual([])
  })

  it('the seat-like footprints sit exactly on their nodes (visitor chairs, command seats)', () => {
    for (const r of ROOMS) {
      const chair = layout.footprints.find((f) => f.id === `${r.id}:chair`)
      expect(chair, r.id).toBeDefined()
      expect(Math.hypot(chair!.x - r.chair.x, chair!.z - r.chair.z)).toBeLessThan(1e-6)
      const bed = layout.footprints.find((f) => f.id === `${r.id}:bed`)
      expect(bed, r.id).toBeDefined()
      expect(Math.hypot(bed!.x - r.bed.x, bed!.z - r.bed.z)).toBeLessThan(1e-6)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Keep clear of robot lanes
// ---------------------------------------------------------------------------------------------

/** Sample every robot lane centre line (both circuits) finely. */
function laneSamples(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  const p: PathPoint = { x: 0, z: 0, heading: 0 }
  for (const w of ['A', 'B'] as const) {
    const c = CIRCUITS[w]
    for (let s = 0; s < c.length; s += 0.05) {
      pointAt(c, s, p)
      out.push({ x: p.x, z: p.z })
    }
  }
  return out
}

describe('furniture keeps clear of the robot lanes', () => {
  const samples = laneSamples()
  it('every footprint is >= 0.45 m from every circuit centre line', () => {
    const offenders: string[] = []
    for (const fp of layout.footprints) {
      const e = extent(fp)
      let worst = Infinity
      for (const s of samples) {
        if (s.x < e.x0 - LANE_CLEARANCE || s.x > e.x1 + LANE_CLEARANCE || s.z < e.z0 - LANE_CLEARANCE || s.z > e.z1 + LANE_CLEARANCE) continue
        worst = Math.min(worst, distPoint(fp, s.x, s.z))
      }
      if (worst < LANE_CLEARANCE) offenders.push(`${fp.id}: ${worst.toFixed(2)} m from a lane`)
    }
    expect(offenders).toEqual([])
  })

  it('wall-mounted door leaves and rails also stay off the lane centre lines', () => {
    // the sliding leaves are the only building parts in the corridor: they sit on the wall face
    const leaves = layout.prims.filter((p) => p.mat === 'wallMint' && p.size[0] > 1 && p.size[1] > 1 && p.size[2] < 0.05)
    expect(leaves.length).toBe(ROOMS.length)
    for (const p of leaves) {
      const z0 = p.position[2] - p.size[2] / 2
      const z1 = p.position[2] + p.size[2] / 2
      for (const s of samples) {
        if (s.x < p.position[0] - p.size[0] / 2 - 0.5 || s.x > p.position[0] + p.size[0] / 2 + 0.5) continue
        const dz = Math.max(z0 - s.z, s.z - z1, 0)
        expect(dz).toBeGreaterThanOrEqual(LANE_CLEARANCE - 1e-9)
      }
    }
  })

  it('wayfinding lines never lie on a lane', () => {
    const segs = wayfindingSegments()
    const offenders: string[] = []
    for (const g of segs) {
      const len = Math.hypot(g.x1 - g.x0, g.z1 - g.z0)
      const n = Math.max(1, Math.ceil(len / 0.1))
      for (let i = 0; i <= n; i++) {
        const x = g.x0 + ((g.x1 - g.x0) * i) / n
        const z = g.z0 + ((g.z1 - g.z0) * i) / n
        for (const s of samples) {
          if (Math.abs(s.x - x) > 0.6 || Math.abs(s.z - z) > 0.6) continue
          if (Math.hypot(s.x - x, s.z - z) < LANE_CLEARANCE + LINE_WIDTH / 2) offenders.push(`${g.color} at (${x.toFixed(1)}, ${z.toFixed(1)})`)
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([])
    // all five colours are present
    for (const color of Object.values(WAYFINDING)) expect(segs.some((s) => s.color === color)).toBe(true)
  })
})

describe('level 2 floor lines', () => {
  it('run the theatre corridor from lift door to lift door and turn off into pre-op, the family lounge and recovery, on the level-2 floor', () => {
    expect(L2_LANES.length).toBe(3)
    for (const d of [...L2_LANES, ...L2_BRANCHES]) for (const [x] of d.pts) expect(levelOf(x), `${d.color} at ${x}`).toBe(2)
    for (const d of L2_LANES) {
      expect(areaAt(d.pts[0][0], d.pts[0][1])?.id).toBe('l2Corridor')
      expect(areaAt(d.pts[1][0], d.pts[1][1])?.id).toBe('l2Corridor')
      expect(Math.abs(d.pts[1][1] - d.pts[0][1])).toBeGreaterThan(30)
    }
    const into = L2_BRANCHES.map((d) => areaAt(...d.pts[d.pts.length - 1])?.id)
    expect(into).toEqual(['l2PreOp', 'l2Lounge', 'l2Pacu'])
    // every point of every line is on a walkable level-2 floor (no wall crossed except at a door: the areas along the way are the corridor, the hall and the room)
    for (const d of [...L2_LANES, ...L2_BRANCHES]) {
      for (let i = 0; i + 1 < d.pts.length; i++) {
        const [ax, az] = d.pts[i]
        const [bx, bz] = d.pts[i + 1]
        for (let t = 0; t <= 1; t += 0.02) {
          const a = areaAt(ax + (bx - ax) * t, az + (bz - az) * t)?.id
          expect(['l2Corridor', 'l2Hall', 'l2PreOp', 'l2Lounge', 'l2Pacu']).toContain(a)
        }
      }
    }
    // and they are in the building's layout (drawn like level 1's)
    const segs = wayfindingSegments()
    for (const c of [WAYFINDING.preOp, WAYFINDING.lounge, WAYFINDING.recovery]) expect(segs.filter((g) => g.color === c && levelOf(g.x0) === 2).length).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Doors and drawer gaps stay open (W2: no robot doors at floor level)
// ---------------------------------------------------------------------------------------------

describe('no door is blocked', () => {
  const pieces = buildWallPieces()
  const T = 0.1

  const covered = (x: number, z: number): string | null => {
    for (const p of pieces) {
      const along = p.alongX ? x : z
      const across = p.alongX ? z : x
      if (Math.abs(across - p.c) <= T - 1e-6 && along > p.a + 1e-6 && along < p.b - 1e-6) return `${p.cls} piece on ${p.alongX ? 'z' : 'x'}=${p.c} [${p.a}, ${p.b}]`
    }
    return null
  }

  it('no wall piece covers a door centre, or points along the opening', () => {
    for (const d of DOORS) {
      const h = d.width / 2 - 0.25 // stay clear of the perpendicular walls the opening runs into
      for (const t of [-h, -h / 2, 0, h / 2, h]) {
        const x = d.wallAxis === 'x' ? d.center.x + t : d.center.x
        const z = d.wallAxis === 'x' ? d.center.z : d.center.z + t
        expect(covered(x, z), `${d.id} at ${t}`).toBeNull()
      }
    }
  })

  it('(W2) the core walls have no floor-level robot doors: the pods pass through rail portals near the ceiling', () => {
    // the core perimeter is the pharmacy builder's glass ('skip' class): no gap is cut where the robot doors used to be
    for (const sign of [-1, 1]) {
      for (const x of [ROBOT.exitX, ROBOT.entryX]) expect(covered(x, sign * 12), `old robot door ${x}, ${sign * 12}`).not.toBeNull()
    }
  })

  it('every MedDrawer gap (0.8 m) is open in the room wall', () => {
    for (const r of ROOMS) {
      for (const t of [-DRAWER_GAP / 2 + 0.02, 0, DRAWER_GAP / 2 - 0.02]) expect(covered(r.drawer.x + t, r.drawer.z), `${r.id} drawer ${t}`).toBeNull()
    }
  })

  it('no wall, glass or frame prim sits in a door or drawer opening', () => {
    // (R2: the floor slab level 2 stands on lies wholly below its floor, under every doorway: it is not a wall in the way)
    const wallish = (p: Prim) => (p.mat === 'wall' || p.mat === 'wallCap' || p.mat === 'glass') && p.position[1] + p.size[1] / 2 > 0
    const probes: { id: string; x: number; z: number }[] = []
    for (const d of DOORS) probes.push({ id: d.id, x: d.center.x, z: d.center.z })
    for (const r of ROOMS) probes.push({ id: `${r.id}:drawer`, x: r.drawer.x, z: r.drawer.z })
    for (const q of probes) {
      for (const p of layout.prims) {
        if (!wallish(p) || p.size[1] < 0.3) continue
        const hit = Math.abs(p.position[0] - q.x) < p.size[0] / 2 && Math.abs(p.position[2] - q.z) < p.size[2] / 2
        expect(hit, `${q.id} is covered by a ${p.mat} prim`).toBe(false)
      }
    }
  })

  it('the pharmacy core perimeter is left to S2 (no wall of ours on it)', () => {
    for (const p of pieces) {
      if (p.cls === 'skip') continue
      const onCoreEdge = p.alongX
        ? (p.c === CORE.z0 || p.c === CORE.z1) && p.a < CORE.x1 - 0.01 && p.b > CORE.x0 + 0.01 && Math.min(p.b, CORE.x1) - Math.max(p.a, CORE.x0) > 0.1
        : (p.c === CORE.x0 || p.c === CORE.x1) && p.a < CORE.z1 - 0.01 && p.b > CORE.z0 + 0.01 && Math.min(p.b, CORE.z1) - Math.max(p.a, CORE.z0) > 0.1
      expect(onCoreEdge, `${p.cls} piece on the core perimeter`).toBe(false)
    }
    // and no floor of ours inside the core
    const floors = layout.prims.filter((p) => p.shape === 'plane' && p.position[1] === 0)
    for (const p of floors) {
      const inside = p.position[0] > CORE.x0 && p.position[0] < CORE.x1 && p.position[2] > CORE.z0 && p.position[2] < CORE.z1
      expect(inside).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Determinism, mirroring and walls
// ---------------------------------------------------------------------------------------------

describe('layout structure', () => {
  it('is deterministic: building twice gives identical output', () => {
    expect(JSON.stringify(buildLayout())).toBe(JSON.stringify(buildLayout()))
  })

  it('furniture stays inside its area rect (half a wall in)', () => {
    const offenders: string[] = []
    for (const fp of layout.footprints) {
      if (fp.area === 'outside') {
        // the grounds: outside the building, and never inside it
        continue
      }
      const r = areaById(fp.area).rect
      const e = extent(fp)
      const m = 0.1 - 1e-6
      if (e.x0 < r.x0 + m || e.x1 > r.x1 - m || e.z0 < r.z0 + m || e.z1 > r.z1 - m) offenders.push(`${fp.id} (${fp.area}) sticks out of its walls`)
    }
    expect(offenders).toEqual([])
  })

  it('outdoor footprints are outside the building outline', () => {
    for (const fp of layout.footprints.filter((f) => f.area === 'outside')) {
      const e = extent(fp)
      const inside = e.x0 > BUILDING.x0 && e.x1 < BUILDING.x1 && e.z0 > BUILDING.z0 && e.z1 < BUILDING.z1
      expect(inside, fp.id).toBe(false)
    }
  })

  it('ward B rooms are ward A rooms mirrored in z (same prims, mirrored positions)', () => {
    const roomPrims = (id: string): Prim[] => {
      const r = ROOMS.find((q) => q.id === id)!
      const { x0, x1, z0, z1 } = r.rect
      return layout.prims.filter((p) => p.position[0] > x0 && p.position[0] < x1 && p.position[2] > z0 && p.position[2] < z1 && p.shape !== 'plane' && p.position[1] < 3)
    }
    for (let n = 1; n <= 8; n++) {
      const a = roomPrims(`A${n}`)
      const b = roomPrims(`B${n}`)
      expect(b.length, `room ${n}`).toBe(a.length)
      // same multiset of (mat, shape, mirrored z offset from the corridor wall, x, y)
      const keyA = a.map((p) => `${p.mat}|${p.shape}|${p.position[0].toFixed(3)}|${p.position[1].toFixed(3)}|${(-p.position[2] - 16).toFixed(3)}`).sort()
      const keyB = b.map((p) => `${p.mat}|${p.shape}|${p.position[0].toFixed(3)}|${p.position[1].toFixed(3)}|${(p.position[2] - 16).toFixed(3)}`).sort()
      expect(keyB).toEqual(keyA)
    }
  })

  it('beds face the window like the contract says (heading matches bedHeading)', () => {
    for (const r of ROOMS) {
      // the bed's head board (woodOak, 0.78 tall) is on the corridor side of the bed centre
      const head = layout.prims.find((p) => p.mat === 'woodOak' && p.shape === 'roundedBox' && Math.abs(p.size[1] - 0.78) < 1e-9 && Math.abs(p.position[0] - r.bed.x) < 1e-6)
      expect(head, r.id).toBeDefined()
      const towardCorridor = -wardSign(r.ward) * (head!.position[2] - r.bed.z)
      expect(towardCorridor, r.id).toBeGreaterThan(0.5)
    }
  })

  it('covers every area with a floor except the pharmacy core', () => {
    const floors = layout.prims.filter((p) => p.shape === 'plane' && p.position[1] === 0)
    for (const a of AREAS) {
      if (a.id === 'core') continue
      const cx = (a.rect.x0 + a.rect.x1) / 2
      const cz = (a.rect.z0 + a.rect.z1) / 2
      const w = a.rect.x1 - a.rect.x0
      const d = a.rect.z1 - a.rect.z0
      expect(
        floors.some((p) => Math.abs(p.position[0] - cx) < 1e-6 && Math.abs(p.position[2] - cz) < 1e-6 && Math.abs(p.size[0] - w) < 1e-6 && Math.abs(p.size[2] - d) < 1e-6),
        a.id,
      ).toBe(true)
    }
  })

  it('uses only palette materials, and colour only on tinted ones', () => {
    for (const p of layout.prims) if (p.color !== undefined) expect(['tinted', 'tintedGlow']).toContain(p.mat)
  })

  it('glass partitions are full height, solid walls are at the cut', () => {
    const pieces = buildWallPieces()
    expect(pieces.some((p) => p.cls === 'glassFull')).toBe(true)
    expect(pieces.some((p) => p.cls === 'glassCut')).toBe(true)
    const walls = layout.prims.filter((p) => p.mat === 'wall')
    for (const w of walls) expect(w.position[1] + w.size[1] / 2).toBeLessThanOrEqual(1.3 + 1e-9)
  })
})

// ---------------------------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------------------------

describe('draw-call and triangle budget (M2 brief: <= 90 draw calls, <= 500 k triangles)', () => {
  const compiled = compileLayout(layout)
  const budget = estimateBudget(compiled)

  it('reports the estimate', () => {
    // eslint-disable-next-line no-console
    console.log(
      `building budget: ${budget.drawCalls} draw calls (${budget.mergedMeshes} merged + ${budget.instancedMeshes} instanced + ${budget.extraMeshes} screens/wall/labels), ${budget.triangles} triangles, ${layout.prims.length} prims`,
    )
    expect(budget.drawCalls).toBeGreaterThan(5)
  })

  it('is within 90 draw calls', () => {
    expect(budget.drawCalls).toBeLessThanOrEqual(90)
  })

  it('is within 500 k triangles', () => {
    expect(budget.triangles).toBeLessThanOrEqual(500_000)
  })

  it('compiles deterministically', () => {
    const again = estimateBudget(compileLayout(buildLayout()))
    expect(again).toEqual(budget)
  })
})
