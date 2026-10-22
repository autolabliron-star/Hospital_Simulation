/**
 * The zone rollout's filters (./zones.ts, ./region.ts, ./cells.ts): the same ownership rule as the pipeline, every procedural architecture prim
 * of a loaded zone in that zone's cell and none outside, the walk parts too, the furniture a zone replaces, and a failed zone giving back
 * exactly its own region.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Group, Mesh } from 'three'
import { AREAS } from '@/sim/places'
import { LEVEL2_DX, levelOf } from '@/sim/levels'
import { zoneOf as pipelineZoneOf } from '../../../../tools/arch/export-plan'
import { getLayout } from '../layout'
import { LayoutBuilder } from '../layout/builder'
import { buildFloors, buildWalls } from '../layout/shell'
import { buildWalkLayout } from '../layout/walk'
import { compileLayout } from '../render/compile'
import { bindCellsUnder, cellOfName, resetCells, setCellReplaced } from './cells'
import { furnitureKeys, getCoverage, primCell, setCoverage, walkPartCell, zoneCoverage } from './region'
import { ZONES, ZONE_IDS, drawnX, neighboursOf, zoneAtDrawn, zoneAtSim, zoneOfArea, zoneUnderLevel2 } from './zones'

const shellPrims = () => {
  const b = new LayoutBuilder()
  buildFloors(b)
  buildWalls(b)
  return b.prims
}
const all = () => ZONE_IDS.map((id) => ({ id, replaces: null }))

afterEach(() => {
  setCoverage(null)
  resetCells()
})

describe('zones.json, the contract', () => {
  it('lists every area of the plan exactly once', () => {
    for (const a of AREAS) expect(ZONES.filter((z) => z.areas.includes(a.id)).length, a.id).toBe(1)
    for (const z of ZONES) for (const a of z.areas) expect(AREAS.some((x) => x.id === a), `${z.id}: ${a}`).toBe(true)
  })

  it('owns points the way the pipeline does (tools/arch/export-plan.ts zoneOf), borders to the first listed', () => {
    for (const level of [1, 2] as const)
      for (let x = -66; x <= 44; x += 1.5)
        for (let z = -24; z <= 24; z += 1.5) expect(zoneAtDrawn(level, x, z), `${level} ${x} ${z}`).toBe(pipelineZoneOf(level, x, z))
    expect(zoneAtDrawn(1, -40, 0)).toBe('lobby') // the spine's east wall line: lobby is listed before imaging
  })

  it('maps level 2 from the sim strip to the drawn frame', () => {
    expect(drawnX(-50)).toBe(-50)
    expect(drawnX(-50 + LEVEL2_DX)).toBe(-50)
    expect(zoneAtSim(-50 + LEVEL2_DX, 0)).toBe('theatres')
    expect(zoneAtSim(-50, 0)).toBe('lobby')
  })

  it('knows its neighbours and which zones hide under the level-2 slab', () => {
    expect(neighboursOf('lobby')).toEqual(expect.arrayContaining(['er', 'imaging', 'wardA', 'wardB']))
    expect(neighboursOf('lobby')).not.toContain('theatres')
    expect(neighboursOf('atrium')).not.toContain('lobby')
    expect(ZONES.filter(zoneUnderLevel2).map((z) => z.id).sort()).toEqual(['er', 'lobby'])
  })
})

describe('zone coverage of the procedural shell', () => {
  it('puts every shell prim (floors, walls, caps, glazing, frames, jambs; both levels) of a listed zone in its cell', () => {
    setCoverage(zoneCoverage(all()))
    const prims = shellPrims()
    const loose = prims.filter((p) => primCell(p.mat, p.position[0], p.position[2]) === null)
    // only the room doors' parked leaves (overview-only furniture, off the wall line) are not architecture
    expect(loose.filter((p) => !(p.mat === 'wallMint' || p.mat === 'frame'))).toEqual([])
    expect(loose.length).toBeLessThan(40)
    const cells = new Set(prims.map((p) => primCell(p.mat, p.position[0], p.position[2])))
    for (const id of ZONE_IDS) expect(cells.has(id), id).toBe(true)
  })

  it('gives each floor to the zone listing its area', () => {
    setCoverage(zoneCoverage(all()))
    for (const p of shellPrims().filter((p) => p.shape === 'plane' && p.position[1] <= 0.01)) {
      const [x, , z] = p.position
      const area = AREAS.filter((a) => levelOf(a.rect.x0) === levelOf(x) && x >= a.rect.x0 && x <= a.rect.x1 && z >= a.rect.z0 && z <= a.rect.z1).sort(
        (a, b) => (a.rect.x1 - a.rect.x0) * (a.rect.z1 - a.rect.z0) - (b.rect.x1 - b.rect.x0) * (b.rect.z1 - b.rect.z0),
      )[0]
      if (!area) continue
      expect(primCell(p.mat, x, z), `${area.id}`).toBe(zoneOfArea(area.id))
    }
  })

  it('hides nothing outside the listed zones: a manifest of lobby and imaging leaves the wards, core, atrium, ER and theatres alone', () => {
    setCoverage(zoneCoverage([{ id: 'lobby', replaces: null }, { id: 'imaging', replaces: null }]))
    const prims = shellPrims()
    const cells = prims.map((p) => primCell(p.mat, p.position[0], p.position[2]))
    expect(new Set(cells)).toEqual(new Set(['lobby', 'imaging', null]))
    for (let i = 0; i < prims.length; i++) {
      if (cells[i] === null) continue
      const [x, , z] = prims[i].position
      // a prim of a cell lies in or on the border of its zone (doors and glazing spans by their centre; a long piece may run past)
      expect(levelOf(x), `${prims[i].mat} ${x} ${z}`).toBe(1)
      expect(x).toBeLessThanOrEqual(-21.9)
    }
    // the ward rooms keep their floors and walls
    const wardFloor = prims.find((p) => p.shape === 'plane' && p.position[1] <= 0.01 && p.position[2] < -12 && p.position[0] > 0)
    expect(wardFloor && primCell(wardFloor.mat, wardFloor.position[0], wardFloor.position[2])).toBeNull()
  })

  it('splits the outer glazing at its partitions: each span to the zone of its centre', () => {
    setCoverage(zoneCoverage(all()))
    // the north façade (z = -22) runs past ER, the spine, ward A: its mullions go to the zone they stand in
    const facade = shellPrims().filter((p) => (p.mat === 'glass' || p.mat === 'frame') && Math.abs(p.position[2] + 22) < 0.01 && levelOf(p.position[0]) === 1)
    expect(facade.length).toBeGreaterThan(10)
    const owners = new Set(facade.map((p) => primCell(p.mat, p.position[0], p.position[2])))
    expect(owners.has('er')).toBe(true)
    expect(owners.has('wardA')).toBe(true)
    for (const p of facade.filter((p) => p.position[0] > -38 && p.position[0] < 38)) expect(primCell(p.mat, p.position[0], p.position[2])).toBe('wardA')
  })

  it('walk mode: ceilings by area, upper walls and frames by line, signs off the line stay', () => {
    setCoverage(zoneCoverage(all()))
    expect(walkPartCell('ceiling', -53, 0)).toBe('lobby')
    expect(walkPartCell('ceiling', 0, -14)).toBe('wardA')
    expect(walkPartCell('ceiling', 0, 0)).toBe('core')
    expect(walkPartCell('ceiling', -50 + LEVEL2_DX, 0)).toBe('theatres')
    expect(walkPartCell('frame', -51, -6 + 0.14)).toBeNull()
    const walk = buildWalkLayout(getLayout())
    const loose = walk.boxes.filter((b) => walkPartCell(b.mat, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) === null)
    // upper walls, lintels and glazing all lie on wall or door lines, so every one is some zone's; signs, plates, handrails and guards stay
    expect(loose.filter((b) => ['upperWall', 'drawerFill', 'lintel', 'doorFrame', 'glazing', 'glazingFrame'].includes(b.part))).toEqual([])
    expect(loose.length).toBeGreaterThan(0)
  })

  it('compiles each listed zone into meshes of its own, and the rest as before', () => {
    const layout = getLayout()
    const plain = compileLayout(layout, 1)
    setCoverage(zoneCoverage([{ id: 'imaging', replaces: null }]))
    const split = compileLayout(layout, 1, (p) => primCell(p.mat, p.position[0], p.position[2]))
    const cellKeys = split.merged.filter((m) => cellOfName(m.key) === 'imaging')
    expect(cellKeys.length).toBeGreaterThan(2)
    const tris = (c: typeof plain) => c.merged.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : 0), 0)
    expect(tris(split)).toBe(tris(plain)) // nothing lost, nothing doubled
    for (const m of [...plain.merged, ...split.merged]) m.geometry.dispose()
  })
})

describe('furniture a zone replaces', () => {
  it('the lobby default: the designed desk, seat rows, planters; never the kiosks or screens', () => {
    setCoverage(zoneCoverage([{ id: 'lobby', replaces: null }]))
    const layout = getLayout()
    const seats = layout.footprints.find((f) => f.id === 'lobby:seatsN1')!
    const near = layout.prims.filter((p) => Math.hypot(p.position[0] - seats.x, p.position[2] - seats.z) < 0.5 && p.position[1] < 1)
    expect(near.some((p) => primCell(p.mat, p.position[0], p.position[2]) === 'lobby')).toBe(true)
    for (const p of layout.prims.filter((p) => p.shape === 'quad' || p.mat === 'screen')) expect(primCell(p.mat, p.position[0], p.position[2])).toBeNull()
    const kiosk = layout.footprints.find((f) => f.id === 'lobby:kiosk0')!
    for (const p of layout.prims.filter((p) => Math.hypot(p.position[0] - kiosk.x, p.position[2] - kiosk.z) < 0.2)) expect(primCell(p.mat, p.position[0], p.position[2])).toBeNull()
  })

  it('an explicit list replaces only what it names; footprint families by prefix; unknown keys are reported', () => {
    const unknown: string[] = []
    setCoverage(zoneCoverage([{ id: 'lobby', replaces: [] }, { id: 'er', replaces: ['footprint:lobby:seatsS*', 'nonsense'] }], unknown))
    expect(unknown).toEqual(['nonsense'])
    const layout = getLayout()
    const s1 = layout.footprints.find((f) => f.id === 'lobby:seatsS1')!
    const inS1 = layout.prims.filter((p) => Math.abs(p.position[0] - s1.x) < 0.3 && Math.abs(p.position[2] - s1.z) < 0.3 && p.position[1] < 1)
    expect(inS1.some((p) => primCell(p.mat, p.position[0], p.position[2]) === 'er')).toBe(true)
    const desk = layout.footprints.find((f) => f.id === 'lobby:reception')!
    const r = Math.max(desk.hw, desk.hd)
    const inDesk = layout.prims.filter((p) => Math.abs(p.position[0] - desk.x) < r && Math.abs(p.position[2] - desk.z) < r && p.position[1] < 1.2 && p.shape !== 'plane')
    expect(inDesk.length).toBeGreaterThan(0)
    for (const p of inDesk) expect(primCell(p.mat, p.position[0], p.position[2])).toBeNull() // lobby: replaces nothing
    expect(furnitureKeys(['footprint:no-such-thing*'], unknown).size).toBe(0)
  })
})

describe('a failed zone releases only its own region', () => {
  it('cells hide when their zone is drawn and the failed one stays', () => {
    setCoverage(zoneCoverage([{ id: 'lobby', replaces: null }, { id: 'imaging', replaces: null }, { id: 'wardA', replaces: null }]))
    expect(getCoverage()?.cells).toEqual(['lobby', 'imaging', 'wardA'])
    const compiled = compileLayout(getLayout(), 1, (p) => primCell(p.mat, p.position[0], p.position[2]))
    const root = new Group()
    for (const m of compiled.merged) root.add(Object.assign(new Mesh(m.geometry), { name: m.key }))
    bindCellsUnder(root)
    const of = (cell: string | null) => root.children.filter((o) => cellOfName(o.name) === cell)
    expect(root.children.every((o) => o.visible)).toBe(true) // everything procedural until a zone is drawn
    setCellReplaced('lobby', true)
    setCellReplaced('wardA', true)
    // imaging failed: never replaced
    expect(of('lobby').every((o) => !o.visible)).toBe(true)
    expect(of('wardA').every((o) => !o.visible)).toBe(true)
    expect(of('imaging').length).toBeGreaterThan(0)
    expect(of('imaging').every((o) => o.visible)).toBe(true)
    expect(of(null).every((o) => o.visible)).toBe(true)
    for (const m of compiled.merged) m.geometry.dispose()
  })
})
