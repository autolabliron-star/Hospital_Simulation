/**
 * Node tests of the ceiling rail (W2): it follows both circuits exactly, stays above the pods and under every ceiling, never goes
 * through a wall except the four robot-door gaps in the core's glass (where the pharmacy builder puts rail portals), is built from
 * well-formed merged geometry, and fits its budget. Pure data and plain three.js geometry: no browser.
 */
import type { BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { buildCorridorFurniture } from '@/scene/building/layout/walk/corridor'
import { buildSignage } from '@/scene/building/layout/walk/signage'
import type { WalkBox } from '@/scene/building/layout/walk/types'
import { buildUpperWalls } from '@/scene/building/layout/walk/upperWalls'
import { buildWallPieces } from '@/scene/building/layout/walls'
import { PORTAL } from '@/scene/pharmacy/layout'
import { CIRCUITS, pointAt, type Circuit, type PathPoint } from '@/sim/meds/circuit'
import { ROBOT, WALL, areaAt, ceilingHeight } from '@/sim/places'
import type { WardId } from '@/sim/types'
import { ROBOT_LIMITS, triangleCount } from './budget'
import { robotsBudget } from './manifest'
import { CEILING_RAIL, buildRail, hangerSpots, railSamples } from './rail'

const WARDS: WardId[] = ['A', 'B']
const HW = CEILING_RAIL.width / 2
const T = WALL.thickness
const EPS = 1e-6

/** The circuit sampled every `step` metres, starting `from` (a share of the length) round the loop. */
function footprint(c: Circuit, step: number, from = 0): { x: number; z: number; heading: number; s: number }[] {
  const out: { x: number; z: number; heading: number; s: number }[] = []
  const p: PathPoint = { x: 0, z: 0, heading: 0 }
  const n = Math.ceil(c.length / step)
  for (let i = 0; i < n; i++) {
    const s = ((i / n + from) % 1) * c.length
    pointAt(c, s, p)
    out.push({ x: p.x, z: p.z, heading: p.heading, s })
  }
  return out
}

/** Centre, left edge, right edge of the rail at a sample. */
function across(q: { x: number; z: number; heading: number }): [number, number][] {
  const nx = Math.cos(q.heading)
  const nz = -Math.sin(q.heading)
  return [
    [q.x, q.z],
    [q.x - nx * HW, q.z - nz * HW],
    [q.x + nx * HW, q.z + nz * HW],
  ]
}

describe('the rail follows the circuits', () => {
  it('samples at least 200 points along every circuit', () => {
    for (const w of WARDS) {
      expect(footprint(CIRCUITS[w], 0.1).length).toBeGreaterThanOrEqual(200)
      expect(railSamples(CIRCUITS[w]).length).toBeGreaterThanOrEqual(12)
    }
  })

  it('has a cross-section at the start of every segment and every few degrees round a turn', () => {
    for (const w of WARDS) {
      const c = CIRCUITS[w]
      const samples = railSamples(c)
      for (const g of c.segments) expect(samples.some((q) => Math.abs(q.s - g.s0) < 1e-9), `segment at s=${g.s0}`).toBe(true)
      for (let i = 0; i < samples.length; i++) {
        const next = samples[(i + 1) % samples.length]
        const ds = (next.s - samples[i].s + c.length) % c.length
        // straights are one span; arcs are cut at 5 degrees, so a span is never longer than that on the tightest turn... or a whole straight
        const g = c.segments.find((q) => samples[i].s >= q.s0 - 1e-9 && samples[i].s < q.s0 + q.len - 1e-9)!
        if (g.kind === 'arc') expect(ds / g.r).toBeLessThanOrEqual(CEILING_RAIL.arcStep + 1e-9)
      }
    }
  })
})

describe('rail clearance', () => {
  it('sits above the pod top and under the ceiling at every sample of both circuits, centre line and both edges', () => {
    const { y0, y1 } = CEILING_RAIL
    expect(y0).toBe(ROBOT.rail.undersideY)
    expect(y0).toBeGreaterThan(ROBOT.podTopY + 0.1) // room for the bogie and the neck
    expect(y0).toBeGreaterThan(2.25)
    expect(y1).toBeGreaterThan(y0)
    expect(y1).toBeLessThanOrEqual(ROBOT.rail.hangerTopY + EPS)
    let checked = 0
    for (const w of WARDS) {
      for (const q of footprint(CIRCUITS[w], 0.05)) {
        for (const [x, z] of across(q)) {
          const area = areaAt(x, z)
          expect(area, `(${x.toFixed(2)}, ${z.toFixed(2)}) is inside no area`).not.toBeNull()
          const ceiling = ceilingHeight(area!.id)
          expect(ceiling, `${area!.id} has no ceiling`).not.toBeNull()
          expect(y1, `rail top at (${x.toFixed(2)}, ${z.toFixed(2)}) in ${area!.id}`).toBeLessThanOrEqual(ceiling! + EPS)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(200 * 3 * 2)
  })

  it('never goes inside a wall box (cut walls, glass, the core perimeter, upper walls, lintels, frames, sign rods)', () => {
    const pieces = buildWallPieces()
    const walls = pieces.map((p) => {
      const a = p.a - (p.cutA ? 0 : T / 2)
      const b = p.b + (p.cutB ? 0 : T / 2)
      return p.alongX ? { x0: a, x1: b, z0: p.c - T / 2, z1: p.c + T / 2 } : { x0: p.c - T / 2, x1: p.c + T / 2, z0: a, z1: b }
    })
    const above: WalkBox[] = [...buildUpperWalls(pieces), ...buildCorridorFurniture(pieces), ...buildSignage(pieces).boxes].filter(
      (b) => b.y1 > CEILING_RAIL.y0 && b.y0 < CEILING_RAIL.y1,
    )
    expect(walls.length).toBeGreaterThan(20)
    // the check can see walls: a point in the middle of the room wall, and one in the core's glass away from the robot doors, are inside boxes
    const hit = (x: number, z: number): boolean => walls.some((r) => x > r.x0 + EPS && x < r.x1 - EPS && z > r.z0 + EPS && z < r.z1 - EPS)
    expect(hit(-20, -16)).toBe(true)
    expect(hit(3, -12)).toBe(true) // (the pharmacists' door is at x = 0)
    // W2: no floor gap at the old robot doors any more; the rail crosses the core's glass through the pharmacy's rail portals
    expect(hit(ROBOT.exitX, -12)).toBe(true)
    expect(above.length).toBeGreaterThan(10) // the upper walls reach the ceiling, so some do overlap the rail's height
    for (const w of WARDS) {
      for (const q of footprint(CIRCUITS[w], 0.02)) {
        for (const [x, z] of across(q)) {
          if (inPortal(x, z)) continue
          const wall = walls.find((r) => x > r.x0 + EPS && x < r.x1 - EPS && z > r.z0 + EPS && z < r.z1 - EPS)
          expect(wall, `ward ${w} rail at (${x.toFixed(3)}, ${z.toFixed(3)}) is inside a wall`).toBeUndefined()
          const box = above.find((b) => x > b.x0 + EPS && x < b.x1 - EPS && z > b.z0 + EPS && z < b.z1 - EPS)
          expect(box, `ward ${w} rail at (${x.toFixed(3)}, ${z.toFixed(3)}) is inside a ${box?.part}`).toBeUndefined()
        }
      }
    }
  })

  it('crosses a wall only through the four rail portals of the core (|z| = 12, x = exitX / entryX), and the portal clears it', () => {
    // every rail point inside a floor wall piece must be in a portal window; the portal (pharmacy) opens from PORTAL.y0
    // to the ceiling, and the rail and the pod body hang inside that height
    const pieces = buildWallPieces()
    const crossings = new Set<string>()
    for (const w of WARDS) {
      for (const q of footprint(CIRCUITS[w], 0.01, 0.5)) {
        const inside = pieces.some((p) => {
          const a = p.a - (p.cutA ? 0 : T / 2)
          const b = p.b + (p.cutB ? 0 : T / 2)
          return p.alongX ? q.x > a + EPS && q.x < b - EPS && Math.abs(q.z - p.c) < T / 2 - EPS : q.z > a + EPS && q.z < b - EPS && Math.abs(q.x - p.c) < T / 2 - EPS
        })
        if (!inside) continue
        expect(inPortal(q.x, q.z), `ward ${w} rail at (${q.x.toFixed(2)}, ${q.z.toFixed(2)}) crosses a wall outside a portal`).toBe(true)
        crossings.add(`${Math.sign(q.z)}:${Math.round(q.x)}`)
      }
    }
    expect([...crossings].sort()).toEqual(['-1:-8', '-1:8', '1:-8', '1:8'])
    expect(PORTAL.y0).toBeLessThanOrEqual(ROBOT.podBottomY)
    expect(PORTAL.y1).toBeGreaterThanOrEqual(ROBOT.rail.hangerTopY)
  })

  it('crosses the core wall (|z| = 12) exactly twice per ward: in at entryX and out at exitX', () => {
    for (const w of WARDS) {
      const sign = w === 'A' ? -1 : 1
      const hits: number[] = []
      let last = 0
      for (const q of footprint(CIRCUITS[w], 0.005, 0.5)) {
        const side = Math.abs(q.z - sign * 12) < 1e-9 ? 0 : Math.sign((q.z - sign * 12) * sign)
        if (side !== 0 && last !== 0 && side !== last) hits.push(Math.round(q.x))
        if (side !== 0) last = side
      }
      expect(hits.sort((a, b) => a - b)).toEqual([ROBOT.exitX, ROBOT.entryX])
    }
  })
})

/** Inside one of the four rail portal windows in the core's corridor walls (W2). */
function inPortal(x: number, z: number): boolean {
  return Math.abs(Math.abs(z) - 12) < 0.2 && (Math.abs(x - ROBOT.exitX) < PORTAL.width / 2 || Math.abs(x - ROBOT.entryX) < PORTAL.width / 2)
}

/** Every position of a geometry as [x, y, z] triples. */
function positions(g: BufferGeometry): Float32Array {
  return g.getAttribute('position').array as Float32Array
}

/** Distance from (x, z) to the densely sampled circuit. */
function makeDistance(c: Circuit): (x: number, z: number) => number {
  const pts = footprint(c, 0.02)
  return (x, z) => {
    let best = Infinity
    for (const q of pts) best = Math.min(best, Math.hypot(q.x - x, q.z - z))
    return best
  }
}

describe('rail geometry', () => {
  const rail = buildRail()

  it('sweeps its sections along the circuits: every body vertex is the beam half width (or the light half width) from the centre line', () => {
    const near = [makeDistance(CIRCUITS.A), makeDistance(CIRCUITS.B)]
    const p = positions(rail.body)
    const lw = CEILING_RAIL.lightWidth / 2
    for (let i = 0; i < p.length / 3; i += 5) {
      const d = Math.min(near[0](p[i * 3], p[i * 3 + 2]), near[1](p[i * 3], p[i * 3 + 2]))
      const ok = Math.abs(d - HW) < 0.012 || Math.abs(d - lw) < 0.012
      expect(ok, `vertex ${i} is ${d.toFixed(3)} m from the nearest circuit`).toBe(true)
    }
  })

  it('has its underside at rail.undersideY and its top at or under the ceiling plane (hangerTopY)', () => {
    const p = positions(rail.body)
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < p.length / 3; i++) {
      lo = Math.min(lo, p[i * 3 + 1])
      hi = Math.max(hi, p[i * 3 + 1])
    }
    expect(lo).toBeCloseTo(ROBOT.rail.undersideY, 5)
    expect(hi).toBeLessThanOrEqual(ROBOT.rail.hangerTopY + EPS)
    // nothing of the rail (beam, clamps, light lines) goes above the ceiling plane or under the beam
    for (const g of [rail.body, rail.collars, rail.light]) {
      const q = positions(g)
      for (let i = 0; i < q.length / 3; i++) {
        expect(q[i * 3 + 1]).toBeGreaterThanOrEqual(ROBOT.rail.undersideY - EPS)
        expect(q[i * 3 + 1]).toBeLessThanOrEqual(ROBOT.rail.hangerTopY + EPS)
      }
    }
  })

  it('puts a light line on the underside and another on the top, in the beam planes, 3 cm wide', () => {
    const p = positions(rail.light)
    const ys = new Set<number>()
    for (let i = 0; i < p.length / 3; i++) ys.add(Math.round(p[i * 3 + 1] * 1e5) / 1e5)
    expect([...ys].sort()).toEqual([CEILING_RAIL.y0, CEILING_RAIL.y1].map((y) => Math.round(y * 1e5) / 1e5).sort())
    expect(CEILING_RAIL.lightWidth).toBeLessThan(CEILING_RAIL.width)
  })

  it('hangs the rail about every 2 m on both circuits, evenly', () => {
    for (const w of WARDS) {
      const c = CIRCUITS[w]
      const spots = hangerSpots(c)
      expect(spots.length).toBe(Math.round(c.length / CEILING_RAIL.hangerEvery))
      for (let i = 0; i < spots.length; i++) {
        const gap = (spots[(i + 1) % spots.length].s - spots[i].s + c.length) % c.length
        expect(gap).toBeGreaterThan(1.5)
        expect(gap).toBeLessThan(2.5)
      }
    }
    // one clamp box per hanger: 24 vertices each
    expect(positions(rail.collars).length / 3 / 24).toBe(WARDS.reduce((n, w) => n + hangerSpots(CIRCUITS[w]).length, 0))
  })

  it('is wound so every triangle faces the way its normals point, with unit normals', () => {
    for (const [name, g] of Object.entries(rail)) {
      const pos = positions(g)
      const nrm = (g as BufferGeometry).getAttribute('normal').array as Float32Array
      const idx = (g as BufferGeometry).index!.array
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]]
        const u = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]]
        const v = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]]
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const dot = cross[0] * nrm[a * 3] + cross[1] * nrm[a * 3 + 1] + cross[2] * nrm[a * 3 + 2]
        expect(dot, `${name} triangle ${t / 3}`).toBeGreaterThanOrEqual(0)
      }
      for (let i = 0; i < nrm.length; i += 3) expect(Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2])).toBeCloseTo(1, 4)
    }
  })

  it('builds the same geometry every time', () => {
    const again = buildRail()
    for (const k of ['body', 'collars', 'light'] as const) expect(Array.from(positions(again[k]))).toEqual(Array.from(positions(rail[k])))
  })

  it('fits the budget: at most 4 draw calls and 30 k triangles for the whole rail', () => {
    const lines = robotsBudget().filter((l) => l.name.startsWith('rail.'))
    expect(lines.length).toBe(3)
    expect(lines.reduce((n, l) => n + l.drawCalls, 0)).toBeLessThanOrEqual(ROBOT_LIMITS.railDrawCalls)
    const tris = lines.reduce((n, l) => n + l.triangles, 0)
    console.log(`rail: ${lines.map((l) => `${l.name} ${Math.round(l.triangles)}`).join(', ')} = ${Math.round(tris)} triangles`)
    expect(tris).toBeLessThanOrEqual(ROBOT_LIMITS.railTriangles)
    expect(tris).toBe(triangleCount(rail.body) + triangleCount(rail.collars) + triangleCount(rail.light))
  })
})
