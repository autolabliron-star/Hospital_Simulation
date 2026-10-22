/**
 * The `area:<areaId>` replaces key (./region.ts): a zone whose design replaces a whole interior hides every procedural prim whose centre lies in
 * that area's rect (except what is always kept and the shell, which follows the zone rule), and the layout trees standing in it, while the zone's
 * model is drawn; a zone that failed to load keeps all of it. Also the manifest check, and the core zone's procedural floor.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Group, InstancedMesh, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { areaById } from '@/sim/places'
import { LEVEL2_DX, levelOf } from '@/sim/levels'
import { buildDrawCentre } from '@/scene/rooms/bloodDraw'
import { bindCoreFloor } from '@/scene/pharmacy/coreFloor'
import { getLayout } from '../layout'
import { LayoutBuilder } from '../layout/builder'
import { buildWalkLayout, walkLayoutOfLevel } from '../layout/walk'
import { packAtlas } from '../render/walk/signAtlas'
import { compileWalk } from '../render/walk/walkGeometry'
import { compileLayout, estimateBudget } from '../render/compile'
import { bindCellsUnder, cellOfName, cellReplaced, registerCellObjects, resetCells, setCellReplaced } from './cells'
import { parseManifest } from './manifest'
import { manifestZone } from './fixtures.testutil'
import { hidesWalkPart as hidesWalkPartFor } from './region'
import { furnitureKeys, setCoverage, treeCell, primCell, walkPartCell, zoneCoverage } from './region'
import { ZONES, ZONE_IDS, drawnX, parseRectKey, zoneDef } from './zones'

afterEach(() => {
  setCoverage(null)
  resetCells()
})

const rectOf = (id: string) => ZONES.find((z) => z.id === id)!.rects[0]
const atrium = areaById('atrium').rect
const inAtrium = (x: number, z: number) => x >= atrium.x0 && x <= atrium.x1 && z >= atrium.z0 && z <= atrium.z1
const kept = (p: { shape: string; mat: string; position: [number, number, number] }) =>
  p.shape === 'quad' || p.mat === 'screen' || (p.mat === 'metalDark' && p.position[1] > 1.0)
const everyZone = (areaZone = 'atrium') => ZONE_IDS.map((id) => ({ id, replaces: id === areaZone ? ['area:atrium'] : null }))

describe('replaces key area:<id>', () => {
  it('hides the prims whose centre is in the area rect, never the kept ones, never what is outside', () => {
    const unknown: string[] = []
    setCoverage(zoneCoverage([{ id: 'atrium', replaces: ['area:atrium'] }], unknown))
    expect(unknown).toEqual([])
    const prims = getLayout().prims
    const inside = prims.filter((p) => inAtrium(p.position[0], p.position[2]) && !kept(p))
    expect(inside.length).toBeGreaterThan(100) // beds, the pool, benches, the cafe, bistro furniture
    const hidden = inside.filter((p) => primCell(p.mat, p.position[0], p.position[2]) === 'atrium')
    // everything in the rect that is not shell goes; (a shell prim keeps the zone rule, which gives it to the atrium too or to nobody)
    const furniture = inside.filter((p) => p.shape !== 'plane' || p.position[1] > 0.01)
    expect(hidden.length).toBeGreaterThan(furniture.length * 0.8)
    // the cafe counter and a bench are in it
    expect(prims.some((p) => p.mat === 'woodOak' && inAtrium(p.position[0], p.position[2]) && primCell(p.mat, p.position[0], p.position[2]) === 'atrium')).toBe(true)
    // kept: screens, bezels (the menu display), quads stay procedural
    for (const p of prims.filter((p) => inAtrium(p.position[0], p.position[2]) && kept(p))) expect(primCell(p.mat, p.position[0], p.position[2]), `${p.mat} ${p.shape}`).toBeNull()
    // outside the rect nothing is the atrium's furniture (a wall or floor on the border is the shell rule's, not this key's)
    const keys = furnitureKeys(['area:atrium'])
    for (const p of prims.filter((p) => !inAtrium(p.position[0], p.position[2]))) expect(keys.has(`${p.mat}|${p.position[0].toFixed(3)}|${p.position[2].toFixed(3)}`)).toBe(false)
  })

  it('does not touch the shell rule: floors and walls are owned as before', () => {
    const without = zoneCoverage(everyZone('none'))
    const withKey = zoneCoverage(everyZone())
    // the only prims whose cell changes are furniture, and only to the atrium
    let changed = 0
    for (const p of getLayout().prims) {
      const a = without.cellOfPrim(p.mat, p.position[0], p.position[2])
      const b = withKey.cellOfPrim(p.mat, p.position[0], p.position[2])
      if (a === b) continue
      changed++
      expect(a).toBeNull()
      expect(b).toBe('atrium')
      expect(inAtrium(p.position[0], p.position[2])).toBe(true)
    }
    expect(changed).toBeGreaterThan(100)
  })

  it('reports an unknown area; the manifest drops it with a warning', () => {
    const unknown: string[] = []
    expect(furnitureKeys(['area:nowhere'], unknown).size).toBe(0)
    expect(unknown).toEqual(['area:nowhere'])
    const m = {
      version: 1,
      zones: [
        manifestZone('lobby', 1, rectOf('lobby')),
        manifestZone('atrium', 1, rectOf('atrium'), { replaces: ['footprint:atrium:*', 'area:atrium', 'area:nowhere'] }),
      ],
      materials: { files: [], mb: 0 },
    }
    const r = parseManifest(m)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.manifest.zones.find((z) => z.id === 'atrium')?.replaces).toEqual(['footprint:atrium:*', 'area:atrium'])
    expect(r.warnings.join('\n')).toMatch(/atrium: replaces names areas that do not exist.*area:nowhere/)
  })

  it('the shipped manifest lists area:atrium and nothing is reported unknown', () => {
    const json = JSON.parse(readFileSync(join(process.cwd(), 'public/assets/building/manifest.json'), 'utf8'))
    const r = parseManifest(json)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const zones = r.manifest.zones.map((z) => ({ id: z.id, replaces: z.replaces }))
    expect(zones.find((z) => z.id === 'atrium')?.replaces).toContain('area:atrium')
    const unknown: string[] = []
    zoneCoverage(zones, unknown)
    expect(unknown).toEqual([])
    expect(r.warnings.join('\n')).not.toMatch(/area/)
  })

  it('the atrium cell is hidden while the zone is drawn; a failed zone keeps all of it', () => {
    setCoverage(zoneCoverage([{ id: 'lobby', replaces: null }, { id: 'atrium', replaces: ['area:atrium'] }]))
    const compiled = compileLayout(getLayout(), 1, (p) => primCell(p.mat, p.position[0], p.position[2]), treeCell)
    const root = new Group()
    for (const m of compiled.merged) root.add(Object.assign(new Mesh(m.geometry), { name: m.key }))
    bindCellsUnder(root)
    const of = (cell: string) => root.children.filter((o) => cellOfName(o.name) === cell)
    expect(of('atrium').length).toBeGreaterThan(3)
    // failed (never drawn): everything stays
    expect(root.children.every((o) => o.visible)).toBe(true)
    setCellReplaced('lobby', true)
    expect(of('atrium').every((o) => o.visible)).toBe(true)
    // drawn
    setCellReplaced('atrium', true)
    expect(of('atrium').every((o) => !o.visible)).toBe(true)
    expect(of('lobby').every((o) => !o.visible)).toBe(true)
    // the zone goes away (runtime dispose): back
    setCellReplaced('atrium', false)
    expect(of('atrium').every((o) => o.visible)).toBe(true)
    for (const m of compiled.merged) m.geometry.dispose()
  })
})

describe('the atrium trees', () => {
  const cellsOf = (replaces: string[] | null) => {
    setCoverage(zoneCoverage([{ id: 'lobby', replaces: null }, { id: 'atrium', replaces }]))
    return compileLayout(getLayout(), 1, (p) => primCell(p.mat, p.position[0], p.position[2]), treeCell)
  }

  it('are their own instanced meshes while the atrium lists area:atrium; the rest of the trees are untouched', () => {
    const plain = compileLayout(getLayout(), 1)
    const total = plain.instanced.find((i) => i.key === 'tree-trunks')!.count
    const inRect = getLayout().trees.filter((t) => inAtrium(t.x, t.z))
    expect(inRect).toHaveLength(6)
    const c = cellsOf(['area:atrium'])
    const mine = c.instanced.find((i) => i.key === 'tree-trunks|cell=atrium')!
    const rest = c.instanced.find((i) => i.key === 'tree-trunks')!
    expect(mine.count).toBe(6)
    expect(rest.count).toBe(total - 6)
    expect(c.instanced.find((i) => i.key === 'tree-canopies|cell=atrium')!.count).toBe(30)
    expect(c.instanced.find((i) => i.key === 'tree-canopies')!.count).toBe((total - 6) * 5)
    // the other trees keep their arrangement (seeded by the layout index): the same matrices as before, in order
    const before = plain.instanced.find((i) => i.key === 'tree-canopies')!
    const layoutTrees = getLayout().trees
    const restIdx = layoutTrees.map((t, i) => (inAtrium(t.x, t.z) ? -1 : i)).filter((i) => i >= 0)
    const rc = c.instanced.find((i) => i.key === 'tree-canopies')!
    restIdx.forEach((li, k) => expect(Array.from(rc.matrices.subarray(k * 80, k * 80 + 16))).toEqual(Array.from(before.matrices.subarray(li * 80, li * 80 + 16))))
    const cellsOnly = compileLayout(getLayout(), 1, (p) => primCell(p.mat, p.position[0], p.position[2]))
    expect(estimateBudget(c).drawCalls).toBe(estimateBudget(cellsOnly).drawCalls + 2) // two meshes more, hidden while the zone is drawn
  })

  it('toggle with the zone: drawn hides them, a failed zone (never drawn) keeps them', () => {
    const c = cellsOf(['area:atrium'])
    const root = new Group()
    for (const spec of c.instanced.filter((i) => i.key.startsWith('tree-'))) root.add(Object.assign(new InstancedMesh(spec.geometry, new MeshBasicMaterial(), spec.count), { name: spec.key }))
    bindCellsUnder(root)
    const mine = root.children.filter((o) => cellOfName(o.name) === 'atrium')
    const rest = root.children.filter((o) => cellOfName(o.name) === null)
    expect(mine).toHaveLength(2)
    expect(rest).toHaveLength(2)
    expect(root.children.every((o) => o.visible)).toBe(true) // loading or failed
    setCellReplaced('atrium', true)
    expect(mine.every((o) => !o.visible)).toBe(true)
    expect(rest.every((o) => o.visible)).toBe(true)
    setCellReplaced('atrium', false)
    expect(mine.every((o) => o.visible)).toBe(true)
  })

  it('stay in the shared meshes when the atrium zone does not list area:atrium, or is not in the manifest', () => {
    for (const replaces of [null, ['footprint:atrium:*']]) {
      const c = cellsOf(replaces)
      expect(c.instanced.some((i) => i.key.includes('|cell=') && i.key.startsWith('tree-'))).toBe(false)
    }
    setCoverage(zoneCoverage([{ id: 'lobby', replaces: null }]))
    expect(compileLayout(getLayout(), 1, undefined, treeCell).instanced.some((i) => i.key.includes('tree-trunks|cell'))).toBe(false)
    setCoverage(null)
    expect(treeCell(23.2, -7.7)).toBeNull()
  })
})

describe('the core zone floor', () => {
  it('hides while the core zone is drawn and shows again when it is not; a failed zone keeps it', () => {
    const floor = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial())
    const off = bindCoreFloor(floor)
    expect(floor.visible).toBe(true) // not loaded yet / failed
    setCellReplaced('lobby', true)
    expect(floor.visible).toBe(true) // another zone
    setCellReplaced('core', true)
    expect(floor.visible).toBe(false)
    setCellReplaced('core', false)
    expect(floor.visible).toBe(true)
    setCellReplaced('core', true)
    off() // unmounted: no longer driven
    setCellReplaced('core', false)
    expect(floor.visible).toBe(false)
  })

  it('takes the state at once when mounted after the zone is drawn (the zone streamed first)', () => {
    setCellReplaced('core', true)
    const floor = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial())
    bindCoreFloor(floor)
    expect(floor.visible).toBe(false)
    expect(cellReplaced('core')).toBe(true)
  })

  it('CoreStatic binds exactly its floor mesh, once, in an effect (no per-frame work)', () => {
    const src = readFileSync(join(process.cwd(), 'src/scene/pharmacy/CoreStatic.tsx'), 'utf8')
    expect(src).toMatch(/<mesh ref=\{floor\}[^>]*geometry=\{g\.floor\}/)
    expect(src).toMatch(/useEffect\(\(\) => \(floor\.current \? bindCoreFloor\(floor\.current\) : undefined\), \[\]\)/)
    expect(src).not.toMatch(/useFrame/)
  })
})

describe('registerCellObjects keeps the test fixtures honest', () => {
  it('a registered object follows its cell', () => {
    const o = new Mesh()
    const off = registerCellObjects('atrium', [o])
    setCellReplaced('atrium', true)
    expect(o.visible).toBe(false)
    off()
  })
})

describe('replaces key rect:<x0>,<x1>,<z0>,<z1>', () => {
  /** The blood-draw centre's footprint-less pieces (curtains, rail): its prims' extent, from the builder. */
  const draw = () => {
    const b = new LayoutBuilder()
    buildDrawCentre(b)
    return b.prims
  }
  const keyOf = (p: { mat: string; position: [number, number, number] }) => `${p.mat}|${p.position[0].toFixed(3)}|${p.position[2].toFixed(3)}`

  it('parses four numbers with x0 < x1 and z0 < z1, and nothing else', () => {
    expect(parseRectKey('rect:-30,-20,2,8')).toEqual({ x0: -30, x1: -20, z0: 2, z1: 8 })
    expect(parseRectKey('rect:-30.5, -20 ,2,8.25')).toEqual({ x0: -30.5, x1: -20, z0: 2, z1: 8.25 })
    for (const bad of ['rect:', 'rect:1,2,3', 'rect:1,2,3,4,5', 'rect:2,1,3,4', 'rect:1,2,4,3', 'rect:a,b,c,d', 'rect:1,2,3,', 'area:x', 'footprint:rect:1,2,3,4'])
      expect(parseRectKey(bad), bad).toBeNull()
  })

  it('hides the non-kept prims whose centre is in the rect; the kept ones, and everything outside, stay', () => {
    const prims = getLayout().prims
    const rect = { x0: -31, x1: -26, z0: 3, z1: 10 }
    const key = `rect:${rect.x0},${rect.x1},${rect.z0},${rect.z1}`
    const unknown: string[] = []
    setCoverage(zoneCoverage([{ id: 'imaging', replaces: [key] }], unknown))
    expect(unknown).toEqual([])
    const inRect = (p: { position: [number, number, number] }) => levelOf(p.position[0]) === 1 && p.position[0] >= rect.x0 && p.position[0] <= rect.x1 && p.position[2] >= rect.z0 && p.position[2] <= rect.z1
    const inside = prims.filter(inRect)
    const hidden = inside.filter((p) => primCell(p.mat, p.position[0], p.position[2]) === 'imaging')
    expect(hidden.length).toBeGreaterThan(10)
    // kept: screens and bezels
    for (const p of inside.filter(kept)) expect(primCell(p.mat, p.position[0], p.position[2]), `${p.mat} ${p.shape}`).toBeNull()
    // the key never reaches outside the rect
    const keys = furnitureKeys([key])
    for (const p of prims.filter((p) => !inRect(p))) expect(keys.has(keyOf(p)), keyOf(p)).toBe(false)
    // what the key adds to the zone's cell is never kept and always in the rect (the shell keeps its own rule)
    const without = zoneCoverage([{ id: 'imaging', replaces: [] }])
    let added = 0
    for (const p of prims) {
      if (without.cellOfPrim(p.mat, p.position[0], p.position[2]) === primCell(p.mat, p.position[0], p.position[2])) continue
      added++
      expect(inRect(p) && !kept(p)).toBe(true)
    }
    expect(added).toBeGreaterThan(10)
  })

  it('can take the blood-draw cubicle curtains and rail (no footprint) by the rect round them', () => {
    const prims = draw().filter((p) => !kept(p) && !(p.shape === 'plane' && p.position[1] <= 0.01))
    const xs = prims.map((p) => p.position[0])
    const zs = prims.map((p) => p.position[2])
    const key = `rect:${Math.min(...xs) - 0.01},${Math.max(...xs) + 0.01},${Math.min(...zs) - 0.01},${Math.max(...zs) + 0.01}`
    setCoverage(zoneCoverage([{ id: 'imaging', replaces: [key] }]))
    const hidden = prims.filter((p) => primCell(p.mat, p.position[0], p.position[2]) === 'imaging')
    expect(hidden.length).toBeGreaterThan(prims.length * 0.9)
  })

  it('is in drawn metres on the zone\'s level: a level-2 zone takes level-2 prims, never level 1 under the same x', () => {
    const rect = { x0: -62, x1: -40, z0: -12, z1: 12 }
    setCoverage(zoneCoverage([{ id: 'theatres', replaces: [`rect:${rect.x0},${rect.x1},${rect.z0},${rect.z1}`] }]))
    const prims = getLayout().prims
    const l2 = prims.filter((p) => levelOf(p.position[0]) === 2 && !kept(p) && drawnX(p.position[0]) >= rect.x0 && drawnX(p.position[0]) <= rect.x1 && Math.abs(p.position[2]) <= 12)
    expect(l2.filter((p) => primCell(p.mat, p.position[0], p.position[2]) === 'theatres').length).toBeGreaterThan(10)
    const l1 = prims.filter((p) => levelOf(p.position[0]) === 1 && p.position[0] >= rect.x0 && p.position[0] <= rect.x1)
    expect(l1.length).toBeGreaterThan(10)
    for (const p of l1) expect(primCell(p.mat, p.position[0], p.position[2])).not.toBe('theatres')
    expect(LEVEL2_DX).toBeGreaterThan(0)
  })

  it('reports a malformed rect; the manifest drops it with a warning', () => {
    const unknown: string[] = []
    expect(furnitureKeys(['rect:3,2,1,0'], unknown).size).toBe(0)
    expect(unknown).toEqual(['rect:3,2,1,0'])
    const r = parseManifest({
      version: 1,
      zones: [manifestZone('imaging', 1, rectOf('imaging'), { replaces: ['rect:-31,-26,3,10', 'rect:-26,-31,3,10', 'rect:1,2'] })],
      materials: { files: [], mb: 0 },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.manifest.zones[0].replaces).toEqual(['rect:-31,-26,3,10'])
    expect(r.warnings.join('\n')).toMatch(/imaging: replaces has malformed rects.*rect:-26,-31,3,10.*rect:1,2/)
  })

  it('a failed zone keeps the prims: the cell is drawn until the zone is, then hidden', () => {
    setCoverage(zoneCoverage([{ id: 'imaging', replaces: ['rect:-31,-26,3,10'] }]))
    const compiled = compileLayout(getLayout(), 1, (p) => primCell(p.mat, p.position[0], p.position[2]))
    const root = new Group()
    for (const m of compiled.merged) root.add(Object.assign(new Mesh(m.geometry), { name: m.key }))
    bindCellsUnder(root)
    const mine = root.children.filter((o) => cellOfName(o.name) === 'imaging')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((o) => o.visible)).toBe(true) // failed or loading
    setCellReplaced('imaging', true)
    expect(mine.every((o) => !o.visible)).toBe(true)
    for (const m of compiled.merged) m.geometry.dispose()
  })
})

describe('walk-mode rails, brackets and guards take the nearest wall line within 0.2 m', () => {
  const walk = buildWalkLayout(getLayout())
  const standoff = walk.boxes.filter((b) => b.part === 'rail' || b.part === 'railBracket' || b.part === 'guard')
  const centre = (b: { x0: number; x1: number; z0: number; z1: number }): [number, number] => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]

  it('every rail, bracket and guard of a listed zone gets its cell (none did before)', () => {
    expect(standoff.length).toBeGreaterThan(100)
    setCoverage(zoneCoverage(ZONE_IDS.map((id) => ({ id, replaces: null }))))
    for (const b of standoff) {
      const [x, z] = centre(b)
      expect(walkPartCell(b.mat, x, z), `${b.part} without a kind`).toBeNull() // off the line: no cell by the old rule
      expect(walkPartCell(b.mat, x, z, b.part), `${b.part} ${x.toFixed(2)} ${z.toFixed(2)}`).not.toBeNull()
    }
  })

  it('a rail takes the cell of a zone on its own level, and other parts keep the old rule', () => {
    setCoverage(zoneCoverage(ZONE_IDS.map((id) => ({ id, replaces: null }))))
    for (const b of standoff) {
      const [x, z] = centre(b)
      const cell = walkPartCell(b.mat, x, z, b.part)!
      expect(zoneDef(cell)?.level, `${b.part} ${x.toFixed(2)} ${z.toFixed(2)}`).toBe(levelOf(x))
    }
    // a sign body or plate (any other part) is not given a cell however near a wall it is
    expect(walkPartCell('wall', -51, -6 + 0.14, 'signBody')).toBeNull()
    expect(walkPartCell('frame', -51, -6 + 0.14, 'plateBody')).toBeNull()
    // too far from any line (more than 0.2 m): none
    expect(walkPartCell('frame', -53, 0.5, 'rail')).toBeNull()
  })

  it('a zone that is not listed keeps its rails (and a failed zone: the cell is simply never hidden)', () => {
    setCoverage(zoneCoverage([{ id: 'lobby', replaces: null }]))
    const cells = new Set(standoff.map((b) => walkPartCell(b.mat, ...centre(b), b.part)))
    expect(cells.has('lobby')).toBe(true)
    expect([...cells].every((c) => c === null || c === 'lobby')).toBe(true)
    // zone drawn: hidden; zone failed: kept
    const lobbyRail = standoff.find((b) => walkPartCell(b.mat, ...centre(b), b.part) === 'lobby')
    expect(lobbyRail).toBeDefined()
    if (lobbyRail) {
      const [x, z] = centre(lobbyRail)
      expect(hidesWalkPartFor(lobbyRail.mat, x, z, lobbyRail.part)).toBe(false)
      setCellReplaced('lobby', true)
      expect(hidesWalkPartFor(lobbyRail.mat, x, z, lobbyRail.part)).toBe(true)
    }
  })

  it('compileWalk passes the part to the hook: the zone cell meshes take the rails, the shared part keeps the rest', () => {
    setCoverage(zoneCoverage(ZONE_IDS.map((id) => ({ id, replaces: null }))))
    const atlas = packAtlas(walk.tiles)
    const layout = walkLayoutOfLevel(walk, 1)
    // the box and ceiling triangles only (the signs and the doors are the same in every compile)
    const frameTris = (hide?: Parameters<typeof compileWalk>[2]) => {
      const c = compileWalk(layout, atlas, hide)
      let n = 0
      for (const g of [...c.chunks.flatMap((ch) => [ch.wall, ch.frame, ch.ceiling]), c.glass]) n += g?.index ? g.index.count / 3 : 0
      return n
    }
    const all = frameTris()
    const withoutParts = frameTris((mat, x, z) => walkPartCell(mat, x, z) !== null)
    const withParts = frameTris((mat, x, z, part) => walkPartCell(mat, x, z, part) !== null)
    expect(withParts).toBeLessThan(withoutParts)
    expect(withoutParts).toBeLessThan(all)
    // the cell meshes of one zone and the shared part together are the whole: nothing is lost or doubled
    const ids = ZONE_IDS
    const cellSum = ids.reduce((n, id) => n + frameTris((mat, x, z, part) => walkPartCell(mat, x, z, part) !== id), 0)
    expect(cellSum + withParts).toBe(all)
  })
})
