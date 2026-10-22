/**
 * The level-2 rooms around the OR, as data (node): everything stays inside its walls and 0.35 m from the nav routes, the doors' fronts and the contract's
 * spots stay empty, every seat is there with a walkable approach that the lifts can reach, the floors are in place, and level 2 fits its own budget
 * (<= 25 draw calls, <= 150 k triangles) without touching level 1's (<= 90 draw calls, <= 500 k triangles). The pattern of labRoom.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { buildLayout } from '@/scene/building/layout'
import { LayoutBuilder, UNRESOLVED_SEATS, footprintDistance } from '@/scene/building/layout/builder'
import { floorMaterial } from '@/scene/building/layout/shell'
import type { Footprint, Prim } from '@/scene/building/layout/types'
import { buildWalkLayout } from '@/scene/building/layout/walk'
import { sweepIsClear } from '@/scene/building/layout/walk/doors'
import { buildWallPieces } from '@/scene/building/layout/walls'
import { compileLayout, estimateBudget } from '@/scene/building/render/compile'
import { MAT } from '@/scene/materials'
import { buildLevel2Labels } from '@/scene/wayfinding/labels'
import { NAV, NAV_WARNINGS, tryPlanRoute } from '@/sim/nav/graph'
import { isWalkable } from '@/sim/nav/layout'
import { LEVEL2_DX, LEVEL2_STRIP, l2, levelOf } from '@/sim/levels'
import { AREAS, DOORS, LIFTS, PACU, PREOP, SURGERY, THEATRE_BASE, VIEW_WINDOWS, WALL, areaById, type Area } from '@/sim/places'
import { BED_TOP, SLAB } from './shell'

const layout = buildLayout()
const walk = buildWalkLayout(layout)
const upperAreas = AREAS.filter((a) => levelOf((a.rect.x0 + a.rect.x1) / 2) === 2)
const upperPrims = layout.prims.filter((p) => levelOf(p.position[0]) === 2)
const upperFootprints = layout.footprints.filter((f) => levelOf(f.x) === 2)
const upperSeats = layout.seats.filter((s) => levelOf(s.x) === 2)

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
const nearest = (x: number, z: number): { id: string; d: number } => {
  let best = { id: '', d: Infinity }
  for (const f of upperFootprints) {
    if (f.overhead) continue // walked under (rails, rug markers): never an obstacle for a spot on the floor
    const d = footprintDistance(f, x, z)
    if (d < best.d) best = { id: f.id, d }
  }
  return best
}

describe('the level-2 rooms are built', () => {
  it('has furniture in every room that has any, each piece with a footprint', () => {
    const ids = upperFootprints.map((f) => f.id)
    for (const id of [
      'l2:preop:bed0:trolley', 'l2:preop:bed3:trolley', 'l2:preop:desk', 'l2:preop:waiting', 'l2:preop:div0:curtain',
      'l2:pacu:bed0:trolley', 'l2:pacu:bed2:trolley', 'l2:pacu:island', 'l2:pacu:bed1:monitor', 'l2:pacu:div0:curtain',
      'l2:lounge:recliner0', 'l2:lounge:recliner3', 'l2:lounge:sofa0', 'l2:lounge:sofa1', 'l2:lounge:table0',
      'l2:staff:sofa', 'l2:staff:meeting', 'l2:staff:lockers', 'l2:staff:kitchen',
      'l2:sterile:rackW', 'l2:sterile:rackE', 'l2:hall:scrub', 'l2:corridor:bench0',
    ]) {
      expect(ids, id).toContain(id)
    }
    expect(upperPrims.length).toBeGreaterThan(400)
    expect(NAV_WARNINGS).toEqual([])
    expect(UNRESOLVED_SEATS).toEqual([])
  })

  it('the pre-op has four bays with their curtain tracks, monitors and IV poles, the PACU three, in the contract\'s places', () => {
    for (const [i, spot] of PREOP.bays.entries()) {
      const bed = upperFootprints.find((f) => f.id === `l2:preop:bed${i}:trolley`)!
      expect(bed.x).toBeCloseTo(spot.at.x, 6)
      expect(bed.z).toBeCloseTo(spot.at.z, 6)
      expect(upperFootprints.some((f) => f.id === `l2:preop:bed${i}:monitor`)).toBe(true)
      expect(upperFootprints.some((f) => f.id === `l2:preop:bed${i}:iv`)).toBe(true)
    }
    for (const [i, spot] of PACU.bays.entries()) {
      const bed = upperFootprints.find((f) => f.id === `l2:pacu:bed${i}:trolley`)!
      expect(bed.x).toBeCloseTo(spot.at.x, 6)
      expect(bed.z).toBeCloseTo(spot.at.z, 6)
      expect(upperFootprints.some((f) => f.id === `l2:pacu:bed${i}:monitor`)).toBe(true)
    }
    const island = upperFootprints.find((f) => f.id === 'l2:pacu:island')!
    expect(island.x).toBeCloseTo(PACU.island.at.x, 6)
    expect(island.z).toBeCloseTo(PACU.island.at.z, 6)
    // curtain tracks: rails over the front of both rows, at head height of a standing nurse
    const rails = upperPrims.filter((p) => p.mat === 'frame' && p.size[1] < 0.05 && p.size[0] > 5 && Math.abs(p.position[1] - 2.1 - 0.0) < 0.05)
    expect(rails.length).toBe(2)
  })

  it('the scrub sink is the contract\'s trough: 2.0 x 0.6 at SURGERY.scrubSink, with knee levers under it', () => {
    const sink = upperFootprints.find((f) => f.id === 'l2:hall:scrub')!
    const s = SURGERY.scrubSink
    expect(sink.x).toBeCloseTo(s.at.x, 6)
    expect(sink.z).toBeCloseTo(s.at.z, 6)
    expect(sink.hw * 2).toBeCloseTo(s.w, 6)
    expect(sink.hd * 2).toBeCloseTo(s.d, 6)
    // two knee levers hang below the trough (dark bars under the basin's 0.82 m underside)
    const levers = upperPrims.filter((p) => p.mat === 'metalDark' && p.size[1] === 0.4 && Math.abs(p.position[0] - s.at.x) < 0.6 && p.position[1] + p.size[1] / 2 < 0.82)
    expect(levers).toHaveLength(2)
  })

  it('has the lift car fronts in both level-2 lobbies, as level 1 has them, at drawn x -42.9 and -41.1 on the outer wall', () => {
    for (const [shaft, sign] of [['A', -1], ['B', 1]] as const) {
      const lobby = areaById(shaft === 'A' ? 'l2LiftA' : 'l2LiftB').rect
      for (const u of [-42.9, -41.1]) {
        const car = upperPrims.find((p) => p.mat === 'frame' && Math.abs(p.position[0] - l2(u)) < 1e-6 && Math.abs(p.size[0] - 1.3) < 1e-6 && Math.sign(p.position[2]) === sign)
        expect(car, `car at ${u} of ${shaft}`).toBeDefined()
        expect(Math.abs(Math.abs(car!.position[2]) - 21.86)).toBeLessThan(1e-6)
        expect(car!.position[2]).toBeGreaterThan(lobby.z0)
        expect(car!.position[2]).toBeLessThan(lobby.z1)
      }
    }
    // the lift spots of the contract (walkers, stretcher, riders) stay empty
    for (const shaft of ['A', 'B'] as const) {
      const lobby = LIFTS[shaft][2]
      for (const p of [...lobby.walkers, lobby.stretcher.at, lobby.cars[0].at, lobby.cars[1].at]) expect(nearest(p.x, p.z).d, `${shaft} lobby spot`).toBeGreaterThan(0.3)
    }
  })
})

describe('everything is inside its walls', () => {
  it('keeps every footprint half a wall inside its area', () => {
    const m = 0.1 - 1e-6
    for (const f of upperFootprints) {
      const r = areaById(f.area as Area['id']).rect
      const e = extent(f)
      expect(e.x0, f.id).toBeGreaterThanOrEqual(r.x0 + m)
      expect(e.x1, f.id).toBeLessThanOrEqual(r.x1 - m)
      expect(e.z0, f.id).toBeGreaterThanOrEqual(r.z0 + m)
      expect(e.z1, f.id).toBeLessThanOrEqual(r.z1 - m)
    }
  })

  it('keeps every prim inside the level-2 strip (the floor slab a hair proud of it) and under the ceiling, and on or above the floor except the slab', () => {
    const grow = SLAB.proud + 1e-6
    for (const p of upperPrims) {
      const e = primExtent(p)
      const label = `${p.mat} ${p.shape} at (${p.position.map((v) => v.toFixed(2)).join(', ')})`
      expect(e.x0, label).toBeGreaterThanOrEqual(LEVEL2_STRIP.x0 - grow)
      expect(e.x1, label).toBeLessThanOrEqual(LEVEL2_STRIP.x1 + grow)
      expect(e.z0, label).toBeGreaterThanOrEqual(LEVEL2_STRIP.z0 - grow)
      expect(e.z1, label).toBeLessThanOrEqual(LEVEL2_STRIP.z1 + grow)
      expect(e.y1, label).toBeLessThanOrEqual(WALL.height + 1e-6)
      if (!(p.mat === 'wallCap' && p.size[1] > 1)) expect(e.y0, label).toBeGreaterThanOrEqual(-0.07)
    }
    // the slab: one box under the whole footprint, its top just under the floor
    const slab = upperPrims.filter((p) => p.mat === 'wallCap' && p.size[1] > 1)
    expect(slab).toHaveLength(1)
    expect(slab[0].position[1] + slab[0].size[1] / 2).toBeLessThanOrEqual(0)
    expect(slab[0].size[1]).toBeCloseTo(SLAB.thickness, 9)
  })

  it('never casts into the baked sun shadow: not one level-2 prim has castShadow', () => {
    for (const p of upperPrims) expect(p.castShadow, `${p.mat} at (${p.position.map((v) => v.toFixed(1)).join(', ')})`).toBe(false)
  })

  it('uses only palette materials, colour only on tinted ones, and a short list of them (so the storey merges into about a dozen meshes)', () => {
    const mats = new Set(upperPrims.map((p) => p.mat))
    for (const m of mats) expect(MAT[m], m).toBeDefined()
    for (const p of upperPrims) if (p.color !== undefined) expect(['tinted', 'tintedGlow']).toContain(p.mat)
    expect(mats.size).toBeLessThanOrEqual(20)
  })
})

describe('the doors and the contract\'s spots stay clear', () => {
  const upperDoors = DOORS.filter((d) => d.id.startsWith('l2'))

  it('nothing stands in front of any level-2 door: a 1.3 m square on each side of the opening is free of footprints', () => {
    expect(upperDoors).toHaveLength(9)
    for (const d of upperDoors) {
      const alongX = d.wallAxis === 'x'
      const half = Math.min(d.width / 2, 1.0)
      for (const side of [-1, 1]) {
        for (let t = -half; t <= half + 1e-9; t += 0.25) {
          for (let m = 0.4; m <= 1.3; m += 0.3) {
            const x = alongX ? d.center.x + t : d.center.x + side * m
            const z = alongX ? d.center.z + side * m : d.center.z + t
            const near = nearest(x, z)
            expect(near.d, `${d.id}: ${near.id} is ${near.d.toFixed(2)} m from the doorway at side ${side}, ${m} m out`).toBeGreaterThanOrEqual(0.3 - 1e-9)
          }
        }
      }
    }
  })

  it('the theatre staff door swings 85 degrees both ways clear of every footprint', () => {
    const d = walk.doors.find((q) => q.id === 'l2Staff')!
    expect(d.kind).toBe('swing')
    expect((d.maxAngle * 180) / Math.PI).toBeCloseTo(85, 6)
    const hx = d.x + d.hinge * d.along.x * (d.width / 2)
    const hz = d.z + d.hinge * d.along.z * (d.width / 2)
    expect(sweepIsClear(hx, hz, d.along, d.hinge, d.into, d.width - 0.04, d.maxAngle, layout.footprints)).toBe(true)
    expect(sweepIsClear(hx, hz, d.along, d.hinge, { x: -d.into.x, z: -d.into.z }, d.width - 0.04, d.maxAngle, layout.footprints)).toBe(true)
  })

  it('every contract spot a person stands at is walkable and 0.3 m or more from every footprint', () => {
    const spots: [string, { x: number; z: number }][] = [
      ['preop nurse', PREOP.nurse.at],
      ['preop desk', PREOP.desk.at],
      ['pacu nurse', PACU.nurse.at],
      ['theatre base', THEATRE_BASE.at],
      ['scrub 0', SURGERY.scrubSink.spots[0].at],
      ['scrub 1', SURGERY.scrubSink.spots[1].at],
      ['viewing', SURGERY.viewing.at],
    ]
    for (const [name, p] of spots) {
      expect(nearest(p.x, p.z).d, `${name} is ${nearest(p.x, p.z).id}`).toBeGreaterThanOrEqual(0.3 - 1e-9)
      expect(isWalkable(p.x, p.z, 0.3), name).toBe(true)
    }
    // and the nurse and the guest at the admissions desk face each other across it: 1.0 m apart, the counter between them
    const desk = upperFootprints.find((f) => f.id === 'l2:preop:desk')!
    expect(desk.x).toBeGreaterThan(PREOP.nurse.at.x)
    expect(desk.x).toBeLessThan(PREOP.desk.at.x)
  })
})

describe('the seats', () => {
  const byPrefix = (p: string) => upperSeats.filter((s) => s.id.startsWith(p))

  it('has the pre-op and PACU trolleys (lying, head against the outer wall, mattress at 0.8 m), waiting chairs, recliners, sofas and benches', () => {
    expect(byPrefix('surgeryBed:preop:')).toHaveLength(4)
    expect(byPrefix('surgeryBed:pacu:')).toHaveLength(3)
    for (const s of [...byPrefix('surgeryBed:preop:'), ...byPrefix('surgeryBed:pacu:')]) {
      expect(s.kind, s.id).toBe('surgeryBed')
      expect(s.pose, s.id).toBe('lie')
      expect(s.height, s.id).toBe(BED_TOP)
      expect(BED_TOP).toBeCloseTo(0.8, 9)
    }
    // the heading runs from the head to the feet: pre-op heads north (heading 0 faces +z, south), PACU heads south (heading pi)
    for (const s of byPrefix('surgeryBed:preop:')) expect(Math.cos(s.heading), s.id).toBeCloseTo(1, 9)
    for (const s of byPrefix('surgeryBed:pacu:')) expect(Math.cos(s.heading), s.id).toBeCloseTo(-1, 9)
    // the contract's bay positions
    PREOP.bays.forEach((b, i) => {
      const s = upperSeats.find((q) => q.id === `surgeryBed:preop:${i}`)!
      expect([s.x, s.z]).toEqual([b.at.x, b.at.z])
    })
    PACU.bays.forEach((b, i) => {
      const s = upperSeats.find((q) => q.id === `surgeryBed:pacu:${i}`)!
      expect([s.x, s.z]).toEqual([b.at.x, b.at.z])
    })
    const waiting = upperSeats.filter((s) => s.kind === 'waiting')
    expect(waiting.length).toBeGreaterThanOrEqual(4)
    for (const s of waiting) {
      expect(s.area).toBe('l2PreOp')
      expect(s.z, s.id).toBeGreaterThan(-10.9)
      expect(s.z, s.id).toBeLessThan(-10.3) // along the south wall, z about -10.6
    }
    const lounge = upperSeats.filter((s) => s.kind === 'lounge' && s.area === 'l2Lounge')
    expect(lounge.length).toBeGreaterThanOrEqual(8) // 4 recliners and the sofas
    expect(byPrefix('lounge:l2Lounge:recliner:')).toHaveLength(4)
    const staff = upperSeats.filter((s) => s.kind === 'lounge' && s.area === 'l2Staff')
    expect(staff.length).toBeGreaterThanOrEqual(2)
    expect(byPrefix('lounge:l2Staff:sofa:').length).toBeGreaterThanOrEqual(2)
  })

  it('every seat\'s area is the area it stands in, and its approach is a walkable spot of that room, 0.4 m or more from every footprint', () => {
    for (const s of upperSeats) {
      const a = areaById(s.area as Area['id'])
      expect(s.x, s.id).toBeGreaterThan(a.rect.x0)
      expect(s.x, s.id).toBeLessThan(a.rect.x1)
      expect(s.z, s.id).toBeGreaterThan(a.rect.z0)
      expect(s.z, s.id).toBeLessThan(a.rect.z1)
      const p = s.approach
      expect(p.x, `${s.id} approach`).toBeGreaterThan(a.rect.x0 + 0.5)
      expect(p.x, `${s.id} approach`).toBeLessThan(a.rect.x1 - 0.5)
      expect(p.z, `${s.id} approach`).toBeGreaterThan(a.rect.z0 + 0.5)
      expect(p.z, `${s.id} approach`).toBeLessThan(a.rect.z1 - 0.5)
      // not inside a footprint of another piece (the seat's own furniture may be near: the builder keeps 0.4 from all of them)
      expect(nearest(p.x, p.z).d, `${s.id} approach is ${nearest(p.x, p.z).id}`).toBeGreaterThanOrEqual(0.4 - 1e-9)
      expect(isWalkable(p.x, p.z, 0.3), `${s.id} approach walkable`).toBe(true)
    }
  })

  it('every approach can be reached on foot from the level-2 lift lobby (a walk, not a lift trip), and the nav has a node at it', () => {
    const from = LIFTS.A[2].walkers[0]
    for (const s of upperSeats) {
      expect(NAV.has(`seat:${s.id}`) || NAV.nodes.some((n) => Math.hypot(n.x - s.approach.x, n.z - s.approach.z) < 1e-6), `${s.id} has a nav node`).toBe(true)
      expect(tryPlanRoute(from, s.approach), `${s.id} is reachable from the lift lobby`).not.toBeNull()
    }
  })
})

describe('the floors, the walls and the labels of level 2', () => {
  it('every level-2 area has its floor, in a clean tone on the theatre side and a warmer one in the lounge', () => {
    const floors = upperPrims.filter((p) => p.shape === 'plane' && p.position[1] === 0)
    for (const a of upperAreas) {
      const cx = (a.rect.x0 + a.rect.x1) / 2
      const cz = (a.rect.z0 + a.rect.z1) / 2
      const f = floors.find((p) => Math.abs(p.position[0] - cx) < 1e-6 && Math.abs(p.position[2] - cz) < 1e-6 && Math.abs(p.size[0] - (a.rect.x1 - a.rect.x0)) < 1e-6 && Math.abs(p.size[2] - (a.rect.z1 - a.rect.z0)) < 1e-6)
      expect(f, a.id).toBeDefined()
      expect(f!.mat, a.id).toBe(floorMaterial(a))
    }
    const mat = (id: string) => floorMaterial(areaById(id as Area['id']))
    expect(mat('l2Or')).toBe('floorBlue')
    expect(mat('l2Sterile')).toBe('floorBlue')
    expect(mat('l2Hall')).toBe('floorBlue')
    expect(mat('l2Lounge')).toBe('floorOak')
    expect(mat('l2PreOp')).toBe('floorMint')
    expect(mat('l2Pacu')).toBe('floorMint')
    // every floor is a patched palette floor, so the light volume's reflection finds it
    for (const a of upperAreas) expect(['floorBlue', 'floorMint', 'floorOak', 'floorTerrazzo']).toContain(floorMaterial(a))
  })

  it('the outer walls of pre-op, lounge, recovery, the theatre staff room and the theatre corridor are window walls; the OR\'s viewing window is glass in a solid wall', () => {
    const pieces = buildWallPieces().filter((p) => levelOf(p.alongX ? (p.a + p.b) / 2 : p.c) === 2)
    // the outline test compares a level-2 wall against the level-2 strip, not against the building
    expect(pieces.length).toBeGreaterThanOrEqual(30)
    for (const p of pieces) expect(p.outline, `${p.alongX ? 'z' : 'x'} = ${p.c}`).toBe(p.alongX ? p.c === -22 || p.c === 22 : p.c === l2(-62) || p.c === l2(-40))
    expect(pieces.filter((p) => p.outline).length).toBeGreaterThan(8)
    const glassCut = pieces.filter((p) => p.cls === 'glassCut')
    const covers = (x: number, z: number): boolean => glassCut.some((p) => (p.alongX ? Math.abs(p.c - z) < 1e-6 && x > p.a && x < p.b : Math.abs(p.c - x) < 1e-6 && z > p.a && z < p.b))
    expect(covers(l2(-57), -22)).toBe(true) // pre-op, north
    expect(covers(l2(-62), 12)).toBe(true) // lounge, west
    expect(covers(l2(-57), 22)).toBe(true) // lounge, south
    expect(covers(l2(-48.5), 22)).toBe(true) // recovery, south
    expect(covers(l2(-62), -6)).toBe(true) // theatre staff room, west
    expect(covers(l2(-40), 0)).toBe(true) // theatre corridor, east
    expect(covers(l2(-62), 0)).toBe(false) // the hall's west end is solid
    // the viewing window: glassFull between z 2.8 and 5.8 on the OR's east wall, solid on either side of it
    const w = VIEW_WINDOWS[0]
    const line = pieces.filter((p) => !p.alongX && Math.abs(p.c - w.c) < 1e-6 && p.b > 2 && p.a < 10)
    const glass = line.filter((p) => p.cls === 'glassFull')
    expect(glass).toHaveLength(1)
    expect(glass[0].a).toBeCloseTo(w.a, 9)
    expect(glass[0].b).toBeCloseTo(w.b, 9)
    expect(line.filter((p) => p.cls === 'solid').length).toBeGreaterThanOrEqual(2)
  })

  it('has the floor labels of the rooms, each inside its room', () => {
    const b = new LayoutBuilder()
    buildLevel2Labels(b)
    expect(b.labels.length).toBeGreaterThanOrEqual(6)
    for (const l of b.labels) {
      expect(levelOf(l.x), l.text).toBe(2)
      const a = upperAreas.find((q) => l.x > q.rect.x0 && l.x < q.rect.x1 && l.z > q.rect.z0 && l.z < q.rect.z1)
      expect(a, l.text).toBeDefined()
    }
    expect(b.labels.map((l) => l.text)).toEqual(expect.arrayContaining(['ROBOTIC OR', 'RECOVERY', 'FAMILY LOUNGE']))
    // and the building's own label list carries them, apart from level 1's
    expect(layout.labels.filter((l) => levelOf(l.x) === 2).length).toBe(b.labels.length)
    expect(layout.labels.filter((l) => levelOf(l.x) === 1).length).toBeGreaterThan(30)
  })
})

describe('budgets: level 2 on its own, level 1 untouched', () => {
  const l1 = compileLayout(layout, 1)
  const l2c = compileLayout(layout, 2)
  const b1 = estimateBudget(l1)
  const b2 = estimateBudget(l2c)

  it('reports the estimate', () => {
    // eslint-disable-next-line no-console
    console.log(`level 2: ${b2.drawCalls} draw calls (${b2.mergedMeshes} merged + ${b2.instancedMeshes} instanced + ${b2.extraMeshes} screens/labels), ${b2.triangles} triangles; level 1: ${b1.drawCalls} draw calls, ${b1.triangles} triangles`)
    expect(b2.drawCalls).toBeGreaterThan(5)
  })

  it('level 2 adds at most 25 draw calls and 150 k triangles', () => {
    expect(b2.drawCalls).toBeLessThanOrEqual(25)
    expect(b2.triangles).toBeLessThanOrEqual(150_000)
  })

  it('level 1 is unchanged: buildLayout({ level2: false }) is within 90 draw calls and 500 k triangles, and compiles to the same meshes as level 1 of the full layout', () => {
    const alone = estimateBudget(compileLayout(buildLayout({ level2: false })))
    expect(alone.drawCalls).toBeLessThanOrEqual(90)
    expect(alone.triangles).toBeLessThanOrEqual(500_000)
    expect(b1).toEqual(alone)
    // the level-2 labels are not in level 1's label count
    expect(b1.drawCalls).toBe(alone.drawCalls)
  })

  it('level 2 merges per material only (it never casts: no cast flag in a mesh key), and none of its meshes casts or is a tree or the command wall', () => {
    for (const m of l2c.merged) expect(m.castShadow, m.key).toBe(false)
    for (const i of l2c.instanced) expect(i.castShadow, i.key).toBe(false)
    expect(l2c.commandWall).toBeNull()
    const keys = l2c.merged.map((m) => m.key)
    expect(new Set(keys.map((k) => k.split('|')[0])).size).toBe(l2c.merged.length) // one mesh per material
    expect(l2c.instanced.some((i) => i.key.startsWith('tree'))).toBe(false)
  })

  it('splits walk-only prims into their own meshes, shown only while walking (the OR\'s booms)', () => {
    const b = new LayoutBuilder()
    const f = b.at(LEVEL2_DX, 0)
    f.box(-50, 0, 5, 1, 1, 1, 'whitePlastic', { cast: false })
    f.box(-50, 2.4, 5, 0.3, 0.3, 2, 'metalDark', { cast: false, walkOnly: true })
    f.box(-48, 0, 5, 1, 1, 1, 'metalDark', { cast: false, overviewOnly: true })
    const compiled = compileLayout(b.finish(), 2)
    expect(compiled.merged.filter((m) => m.walkOnly)).toHaveLength(1)
    expect(compiled.merged.find((m) => m.walkOnly)!.mat).toBe('metalDark')
    expect(compiled.merged.filter((m) => m.overviewOnly)).toHaveLength(1)
    expect(compiled.merged.filter((m) => !m.walkOnly && !m.overviewOnly)).toHaveLength(1)
    // a level-1 compile of it holds nothing
    expect(compileLayout(b.finish(), 1).merged).toHaveLength(0)
  })

  it('compiles deterministically', () => {
    expect(estimateBudget(compileLayout(buildLayout(), 2))).toEqual(b2)
  })
})
