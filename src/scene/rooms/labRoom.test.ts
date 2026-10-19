/**
 * The lab room, the clean-supply refit and the pneumatic tube, as data (node): everything stays inside its walls, the door's swing and the U's mouth
 * stay empty, the scientists' spots keep clear of the machines, the lab uses only materials the building already merges (0 extra draw calls),
 * the glass front, floor and labels are in place, and the pipe keeps its clearances from the ward-B pod rail.
 */
import { describe, expect, it } from 'vitest'
import { CIRCUITS, pointAt, type PathPoint } from '@/sim/meds/circuit'
import { AREAS, areaById, DOORS, LAB, PNEUMATIC, WALL } from '@/sim/places'
import { flightDuration, PNEUMATIC_PATHS } from '@/sim/pneumaticPath'
import { buildLayout } from '@/scene/building/layout'
import { buildWalkLayout } from '@/scene/building/layout/walk'
import { footprintDistance, LayoutBuilder } from '@/scene/building/layout/builder'
import { floorMaterial } from '@/scene/building/layout/shell'
import type { Footprint, Prim } from '@/scene/building/layout/types'
import { buildWallPieces } from '@/scene/building/layout/walls'
import { compileLayout, estimateBudget } from '@/scene/building/render/compile'
import { buildLabels } from '@/scene/wayfinding/labels'
import { BENCH_LEGS, HOUSINGS, RECEIVE, SCREENS, TOTEM } from '@/scene/lab/labDims'
import { buildLab } from './lab'
import { buildPneumatic, marksAlong, pneumaticElbows, pneumaticRuns, PIPE, WALL_CROSSINGS } from './pneumatic'

const layout = buildLayout()
const lab = areaById('lab').rect
const supply = areaById('supplyB').rect

function room(): LayoutBuilder {
  const b = new LayoutBuilder()
  buildLab(b)
  return b
}
function pipes(): LayoutBuilder {
  const b = new LayoutBuilder()
  buildPneumatic(b)
  return b
}

const extent = (fp: Footprint) => {
  if (fp.kind === 'circle') return { x0: fp.x - fp.hw, x1: fp.x + fp.hw, z0: fp.z - fp.hw, z1: fp.z + fp.hw }
  const c = Math.abs(Math.cos(fp.rotationY))
  const s = Math.abs(Math.sin(fp.rotationY))
  const ex = fp.hw * c + fp.hd * s
  const ez = fp.hw * s + fp.hd * c
  return { x0: fp.x - ex, x1: fp.x + ex, z0: fp.z - ez, z1: fp.z + ez }
}
const primExtent = (p: Prim) => {
  const [sx, sy, sz] = p.size
  const turned = Math.abs(Math.sin(p.rotationY)) > 0.5
  const hx = (turned ? sz : sx) / 2
  const hz = (turned ? sx : sz) / 2
  return { x0: p.position[0] - hx, x1: p.position[0] + hx, z0: p.position[2] - hz, z1: p.position[2] + hz, y0: p.position[1] - sy / 2, y1: p.position[1] + sy / 2 }
}

describe('the lab room', () => {
  const b = room()

  it('is built: a bench, a dozen machines, the receive station, the totem and the review desk, each with a footprint', () => {
    const ids = b.footprints.map((f) => f.id)
    for (const id of ['lab:bench:west', 'lab:bench:south', 'lab:bench:east', 'lab:cfg0', 'lab:cfg1', 'lab:decap', 'lab:haem', 'lab:chem', 'lab:immuno', 'lab:coag', 'lab:recap', 'lab:archive', 'lab:receive', 'lab:totem', 'lab:desk', 'lab:bin']) {
      expect(ids, id).toContain(id)
    }
    expect(b.prims.length).toBeGreaterThan(100)
    expect(b.footprints.every((f) => f.area === 'lab')).toBe(true)
  })

  it('keeps every footprint and every prim inside the lab\'s walls', () => {
    const m = 0.1 - 1e-6
    for (const f of b.footprints) {
      const e = extent(f)
      expect(e.x0, f.id).toBeGreaterThanOrEqual(lab.x0 + m)
      expect(e.x1, f.id).toBeLessThanOrEqual(lab.x1 - m)
      expect(e.z0, f.id).toBeGreaterThanOrEqual(lab.z0 + m)
      expect(e.z1, f.id).toBeLessThanOrEqual(lab.z1 - m)
    }
    for (const p of b.prims) {
      const e = primExtent(p)
      const label = `${p.mat} ${p.shape} at (${p.position.map((v) => v.toFixed(2)).join(', ')})`
      expect(e.x0, label).toBeGreaterThanOrEqual(lab.x0 + 0.1 - 1e-6)
      expect(e.x1, label).toBeLessThanOrEqual(lab.x1 - 0.1 + 1e-6)
      expect(e.z0, label).toBeGreaterThanOrEqual(lab.z0 + 0.1 - 1e-6)
      expect(e.z1, label).toBeLessThanOrEqual(lab.z1 - 0.1 + 1e-6)
      expect(e.y0, label).toBeGreaterThanOrEqual(-1e-6)
      expect(e.y1, label).toBeLessThanOrEqual(WALL.height)
    }
  })

  it('lets the door swing 85 degrees clear of every footprint, hinged on the WEST side (the east side is a 0.5 m pocket the leaf would sweep you into)', () => {
    const wd = buildWalkLayout(layout).doors.find((d) => d.id === 'lab')!
    expect(wd.hinge).toBe(-1)
    expect((wd.maxAngle * 180) / Math.PI).toBeCloseTo(85, 6)
    const door = DOORS.find((d) => d.id === 'lab')!
    const hx = door.center.x - (door.width / 2 - 0.015)
    // nothing of the lab (or anything else) within the west-hinged leaf's quarter disc, on either side of the wall
    for (const f of layout.footprints) {
      for (let a = 0; a <= 85; a += 5) {
        const th = (a * Math.PI) / 180
        for (let t = 0.1; t <= door.width - 0.03; t += 0.1) {
          for (const side of [1, -1]) {
            const x = hx + Math.cos(th) * t
            const z = door.center.z + side * Math.sin(th) * t
            expect(footprintDistance(f, x, z) >= 0.04, `${f.id} is in the door's swing`).toBe(true)
          }
        }
      }
    }
    // and the east-hinged leaf WOULD hit the bin by the door, which is why the hinge is on the west
    const bin = layout.footprints.find((f) => f.id === 'lab:bin')!
    const eastHinge = door.center.x + (door.width / 2 - 0.015)
    let hit = false
    for (let t = 0.1; t <= door.width - 0.03; t += 0.05) hit ||= footprintDistance(bin, eastHinge - Math.cos((85 * Math.PI) / 180) * t, door.center.z + Math.sin((85 * Math.PI) / 180) * t) < 0.04
    expect(hit).toBe(true)
  })

  it('leaves a way in: a 1 m strip from the door down to the U\'s mouth is free', () => {
    for (const f of b.footprints) {
      const e = extent(f)
      expect(e.x0 < -26.5 && e.x1 > -27.5 && e.z0 < 18.2 && e.z1 > 16.1, `${f.id} blocks the way in`).toBe(false)
    }
  })

  it('keeps the scientists\' spots, the terminal spot and the way in clear of every machine (0.6 m from a housing, 0.35 m from any footprint)', () => {
    const spots = [LAB.terminal.at, LAB.tech[0].at, LAB.tech[1].at]
    for (const s of spots) {
      for (const h of HOUSINGS) {
        const dx = Math.max(h.x0 - s.x, 0, s.x - h.x1)
        const dz = Math.max(h.z0 - s.z, 0, s.z - h.z1)
        expect(Math.hypot(dx, dz), `(${s.x}, ${s.z}) to ${h.id}`).toBeGreaterThanOrEqual(0.6)
      }
      for (const f of layout.footprints) expect(footprintDistance(f, s.x, s.z), `(${s.x}, ${s.z}) to ${f.id}`).toBeGreaterThanOrEqual(0.35)
      for (const l of BENCH_LEGS) {
        const dx = Math.max(l.x0 - s.x, 0, s.x - l.x1)
        const dz = Math.max(l.z0 - s.z, 0, s.z - l.z1)
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(0.6)
      }
    }
    // the corridor spot you look in from
    for (const f of layout.footprints) expect(footprintDistance(f, LAB.viewpoint.x, LAB.viewpoint.z), f.id).toBeGreaterThanOrEqual(0.35)
  })

  it('uses only materials and shadow flags the building already merges: no new draw call', () => {
    // the merged meshes the building had before W4 (material|cast|receive): every lab and pipe prim must land in one of these
    const existing = new Set(['whitePlastic|01', 'frame|01', 'metalDark|01', 'rubber|01', 'screen|00', 'glass|00', 'glowTeal|00'])
    for (const builder of [b, pipes()]) {
      for (const p of builder.prims) {
        if (p.color !== undefined) {
          // coloured instances: the building's tinted boxes (cast 0, receive 1)
          expect(p.mat, 'a coloured prim').toBe('tinted')
          expect(p.shape).toBe('box')
          expect(p.castShadow).toBe(false)
          expect(p.receiveShadow).toBe(true)
          continue
        }
        expect(existing.has(`${p.mat}|${p.castShadow ? 1 : 0}${p.receiveShadow ? 1 : 0}`), `${p.mat} cast ${p.castShadow} receive ${p.receiveShadow}`).toBe(true)
      }
    }
  })

  it('adds little geometry: the lab and the pipe together stay under 40 k triangles', () => {
    const both = new LayoutBuilder()
    buildLab(both)
    buildPneumatic(both)
    const budget = estimateBudget(compileLayout(both.finish()))
    // eslint-disable-next-line no-console
    console.log(`lab + pneumatic prims: ${both.prims.length} prims, ${budget.triangles} triangles, ${budget.drawCalls} draw calls on their own`)
    expect(budget.triangles).toBeLessThan(40_000)
  })

  it('has a glass front onto corridor B (the door stays), a clean floor, and its screens face the right way', () => {
    const pieces = buildWallPieces()
    const front = pieces.filter((p) => p.alongX && p.c === 16 && p.a >= lab.x0 - 1e-6 && p.b <= lab.x1 + 1e-6)
    expect(front.length).toBeGreaterThan(0)
    expect(front.every((p) => p.cls === 'glassFull')).toBe(true)
    const door = DOORS.find((d) => d.id === 'lab')!
    for (const p of front) expect(p.a >= door.center.x + door.width / 2 - 1e-6 || p.b <= door.center.x - door.width / 2 + 1e-6, 'a front piece covers the door').toBe(true)
    expect(floorMaterial(AREAS.find((a) => a.id === 'lab')!)).toBe('floorBlue')
    // each screen's normal (heading = atan2(dx, dz)) points to where it is read from
    const normal = (h: number) => ({ x: Math.sin(h), z: Math.cos(h) })
    const toward = (s: keyof typeof SCREENS, x: number, z: number): number => {
      const a = SCREENS[s]
      const n = normal(a.heading)
      const dx = x - a.at.x
      const dz = z - a.at.z
      return (n.x * dx + n.z * dz) / Math.hypot(dx, dz)
    }
    expect(toward('labStatus', LAB.viewpoint.x, LAB.viewpoint.z)).toBeGreaterThan(0.95) // the totem is read from the corridor
    for (const s of ['centrifuge', 'labReceive', 'archive'] as const) expect(toward(s, -28, 19), s).toBeGreaterThan(0.5) // the others from inside the U
    for (const s of Object.values(SCREENS)) {
      expect(s.at.x).toBeGreaterThan(lab.x0)
      expect(s.at.x).toBeLessThan(lab.x1)
      expect(s.at.z).toBeGreaterThan(lab.z0)
      expect(s.at.z).toBeLessThan(lab.z1)
      expect(s.w / s.h).toBeCloseTo(1.6, 1) // the atlas tile's aspect
    }
    expect(TOTEM.x).toBe(LAB.statusTotem.x)
    expect(RECEIVE.x0).toBeLessThan(LAB.receive.x)
    expect(RECEIVE.x1).toBeGreaterThan(LAB.receive.x)
  })

  it('has a LAB floor label inside the lab, and CLEAN SUPPLY west of x -31', () => {
    const lb = new LayoutBuilder()
    buildLabels(lb)
    const labLabel = lb.labels.find((l) => l.text === 'LAB')!
    expect(labLabel).toBeDefined()
    expect(labLabel.x).toBeGreaterThan(lab.x0 + 1)
    expect(labLabel.x).toBeLessThan(lab.x1 - 1)
    expect(labLabel.z).toBeGreaterThan(lab.z0)
    expect(labLabel.z).toBeLessThan(lab.z1)
    const cs = lb.labels.find((l) => l.text === 'CLEAN SUPPLY')!
    expect(cs.x + cs.maxWidth / 2).toBeLessThan(supply.x1)
    expect(cs.x - cs.maxWidth / 2).toBeGreaterThan(supply.x0)
  })
})

describe('the clean-supply room after the refit', () => {
  const stuff = layout.footprints.filter((f) => f.area === 'supplyB')

  it('is still furnished (shelves, carts, a bench) and all of it is inside x < -31', () => {
    expect(stuff.length).toBeGreaterThanOrEqual(6)
    for (const f of stuff) {
      const e = extent(f)
      expect(e.x1, f.id).toBeLessThanOrEqual(supply.x1 - 0.1 + 1e-6)
      expect(e.x0, f.id).toBeGreaterThanOrEqual(supply.x0 + 0.1 - 1e-6)
      expect(e.z0, f.id).toBeGreaterThanOrEqual(supply.z0 + 0.1 - 1e-6)
      expect(e.z1, f.id).toBeLessThanOrEqual(supply.z1 - 0.1 + 1e-6)
    }
    // nothing of the supply room's furniture is in the lab
    for (const f of layout.footprints) if (f.id.startsWith('supply:')) expect(extent(f).x1, f.id).toBeLessThan(-31)
  })

  it('keeps the door\'s swing free (x -33 +- 0.6, z 16..17.3)', () => {
    for (const f of stuff) {
      const e = extent(f)
      expect(e.x0 < -32.35 && e.x1 > -33.65 && e.z0 < 17.3, `${f.id} is in the door's swing`).toBe(false)
    }
  })
})

describe('the pneumatic tube', () => {
  const runs = pneumaticRuns()
  const trunk = runs.filter((r) => r.kind === 'trunk' || r.kind === 'drop')

  it('follows the contract\'s trunk exactly, with a riser for each of the four sources', () => {
    expect(trunk.length).toBe(PNEUMATIC.trunk.length - 1)
    trunk.forEach((r, i) => {
      expect(r.a).toEqual(PNEUMATIC.trunk[i])
      expect(r.b).toEqual(PNEUMATIC.trunk[i + 1])
    })
    const risers = runs.filter((r) => r.kind === 'riser')
    expect(risers.length).toBe(4)
    risers.forEach((r, i) => {
      expect(r.a).toEqual(PNEUMATIC.sources[i])
      expect(r.b.y).toBe(PNEUMATIC.y)
      // the riser tops out ON the trunk's first leg (z of the first point), at its own x, which the leg spans
      expect(r.b.z).toBe(PNEUMATIC.trunk[0].z)
      expect(r.b.x).toBeLessThanOrEqual(PNEUMATIC.trunk[0].x + 1e-9)
      expect(r.b.x).toBeGreaterThanOrEqual(PNEUMATIC.trunk[1].x - 1e-9)
    })
  })

  it('runs overhead between 2.75 and 2.95 m, with its corridor crossing at x <= -28.75', () => {
    for (const r of trunk.filter((q) => q.kind === 'trunk')) {
      expect(r.a.y).toBeGreaterThanOrEqual(2.75)
      expect(r.a.y).toBeLessThanOrEqual(2.95)
      expect(r.b.y).toBeGreaterThanOrEqual(2.75)
      expect(r.b.y).toBeLessThanOrEqual(2.95)
    }
    // the leg that crosses corridor B (z 12..16)
    const crossing = trunk.filter((r) => Math.min(r.a.z, r.b.z) <= 12.2 && Math.max(r.a.z, r.b.z) >= 15.8)
    expect(crossing.length).toBe(1)
    expect(crossing[0].a.x).toBeLessThanOrEqual(-28.75)
    expect(crossing[0].b.x).toBeLessThanOrEqual(-28.75)
  })

  it('keeps at least 0.45 m in plan from every sample of the ward-B pod rail, and clear of its hangers\' height band only where it must', () => {
    const rail: { x: number; z: number }[] = []
    const q: PathPoint = { x: 0, z: 0, heading: 0 }
    const c = CIRCUITS.B
    for (let s = 0; s < c.length; s += 0.02) {
      pointAt(c, s, q)
      rail.push({ x: q.x, z: q.z })
    }
    let least = Infinity
    let at = ''
    for (const r of runs) {
      const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z)
      const n = Math.max(1, Math.ceil(len / 0.02))
      for (let i = 0; i <= n; i++) {
        const x = r.a.x + ((r.b.x - r.a.x) * i) / n
        const z = r.a.z + ((r.b.z - r.a.z) * i) / n
        for (const s of rail) {
          const d = Math.hypot(s.x - x, s.z - z)
          if (d < least) {
            least = d
            at = `${r.kind} (${x.toFixed(2)}, ${z.toFixed(2)})`
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`pneumatic route: closest approach to the ward-B rail ${least.toFixed(3)} m at ${at}`)
    expect(least).toBeGreaterThanOrEqual(0.45)
  })

  it('draws every run as a clear pipe 6.3 cm across, collars either side of both walls, elbows at the corners, clamps with hangers', () => {
    const b = pipes()
    const glass = b.prims.filter((p) => p.mat === 'glass')
    expect(glass.length).toBe(runs.length)
    for (const p of glass) expect(Math.min(p.size[0], p.size[2])).toBeCloseTo(PIPE.od, 6)
    // each pipe's axis centre is on its run's midpoint (a horizontal pipe's centre is its axis: `cyl` takes the bottom, the builder corrects it)
    for (const r of runs) {
      const mid = [(r.a.x + r.b.x) / 2, (r.a.y + r.b.y) / 2, (r.a.z + r.b.z) / 2]
      expect(glass.some((p) => Math.hypot(p.position[0] - mid[0], p.position[1] - mid[1], p.position[2] - mid[2]) < 1e-6), `${r.kind} ${JSON.stringify(r.a)}`).toBe(true)
    }
    // collars: a pair per wall, centred on the pipe, either side of the wall faces
    for (const w of WALL_CROSSINGS) {
      const collars = b.prims.filter((p) => p.mat === 'frame' && p.shape === 'cylinder' && Math.abs(p.size[0] - PIPE.collarDia) < 1e-6 && Math.abs(p.position[0] - w.x) < 1e-6 && Math.abs(p.position[2] - w.wallZ) < 0.2)
      expect(collars.length, w.id).toBe(2)
      const zs = collars.map((p) => p.position[2]).sort((x, y) => x - y)
      expect(zs[0]).toBeLessThan(w.wallZ - WALL.thickness / 2)
      expect(zs[1]).toBeGreaterThan(w.wallZ + WALL.thickness / 2)
    }
    expect(pneumaticElbows().length).toBe(PNEUMATIC.trunk.length - 1)
    // hangers: thin rods from the clamps to the ceiling
    const rods = b.prims.filter((p) => p.mat === 'metalDark' && p.shape === 'cylinder' && Math.abs(p.size[0] - 0.012) < 1e-6 && p.size[1] < 0.2)
    expect(rods.length).toBeGreaterThanOrEqual(8)
    for (const r of rods) expect(r.position[1] + r.size[1] / 2).toBeCloseTo(WALL.height, 6)
  })

  it('has clamps about every 1.2 m along each horizontal leg, never on a collar', () => {
    const marks = marksAlong(5.38, 1.2, 0.6, 0.3)
    expect(marks.length).toBe(4)
    marks.forEach((d, i) => expect(d).toBeCloseTo(0.6 + 1.2 * i, 9))
    for (const r of trunk.filter((q) => q.kind === 'trunk')) {
      const len = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y, r.b.z - r.a.z)
      const marks = marksAlong(len, PIPE.clampEvery, 0.6, 0.3)
      for (let i = 1; i < marks.length; i++) expect(marks[i] - marks[i - 1]).toBeCloseTo(1.2, 9)
    }
  })

  it('has flights the sim can time: each source\'s path starts at its riser bottom and ends at the receive hood\'s drop, in 0.9 to 2.5 s', () => {
    PNEUMATIC_PATHS.forEach((path, i) => {
      expect(path.pts[0]).toEqual(PNEUMATIC.sources[i])
      expect(path.pts[path.pts.length - 1]).toEqual(PNEUMATIC.trunk[PNEUMATIC.trunk.length - 1])
      const t = flightDuration(path.length)
      expect(t).toBeGreaterThan(0.9)
      expect(t).toBeLessThan(2.5)
    })
    // the drop ends inside the receive station's hood
    const end = PNEUMATIC.trunk[PNEUMATIC.trunk.length - 1]
    expect(end.x).toBeGreaterThan(RECEIVE.x0)
    expect(end.x).toBeLessThan(RECEIVE.x1)
    expect(end.z).toBeGreaterThan(RECEIVE.z0)
    expect(end.z).toBeLessThan(RECEIVE.z1)
    expect(end.y).toBeLessThan(RECEIVE.hoodTop)
  })
})
