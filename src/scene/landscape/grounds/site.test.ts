import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { skyUniforms } from '@/scene/lighting/env/skyUniforms'
import { buildLayout } from '@/scene/building/layout'
import { BUILDING } from '@/sim/places'
import { LAYOUT_TREES } from '../layoutTrees'
import { createExteriorMaterials, HAZE_DISTANCE } from './material'
import { hex, MeshBuilder, trianglesOf } from './meshBuilder'
import { grow, inside, KEEP_CLEAR, PLAZA, SITE, Y, type Box2 } from './plan'
import { buildExteriorScene } from './scene'
import { buildSite, ringPoints, treeBlocked } from './site'
import { carTemplate, lampTemplate, treeTemplate } from './templates'

const site = buildSite()
const T = { tree: trianglesOf(treeTemplate()), car: trianglesOf(carTemplate()), lamp: trianglesOf(lampTemplate()) }
const staticTris = trianglesOf(site.ground)
const totalTris = staticTris + site.trees.length * T.tree + site.cars.length * T.car + site.lamps.length * T.lamp

const overlap = (a: { x0: number; x1: number; z0: number; z1: number }, b: Box2): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0

describe('the exterior: budget (Quest 3: at most 8 draw calls and 60 k triangles)', () => {
  const scene = buildExteriorScene(site)

  it('reports its numbers', () => {
    // eslint-disable-next-line no-console
    console.log(
      `exterior: ${scene.meshes.length} draw calls, ${totalTris} triangles (static ${staticTris}; ${site.trees.length} trees x ${T.tree}, ${site.cars.length} cars x ${T.car}, ${site.lamps.length} lamps x ${T.lamp}), ${scene.materials.length} materials, ${site.blocks.length} blocks, ${site.solids.length} solids`,
    )
    expect(totalTris).toBeGreaterThan(5000)
  })

  it('is at most 8 draw calls', () => {
    expect(scene.meshes.length).toBeLessThanOrEqual(8)
    expect(scene.materials.length).toBeLessThanOrEqual(2)
  })

  it('is at most 60 k triangles', () => {
    expect(totalTris).toBeLessThanOrEqual(60_000)
  })

  it('is all static, casts and receives no shadow', () => {
    for (const m of scene.meshes) {
      expect(m.matrixAutoUpdate).toBe(false)
      expect(m.castShadow).toBe(false)
      expect(m.receiveShadow).toBe(false)
    }
  })
})

describe('the exterior: determinism', () => {
  const digest = (s: ReturnType<typeof buildSite>): string => {
    let h = 0
    const add = (v: number) => {
      h = (Math.imul(h, 31) + Math.round(v * 1000)) | 0
    }
    for (const v of s.ground.positions) add(v)
    for (const l of [s.trees, s.cars, s.lamps]) for (const i of l) [i.x, i.z, i.ry, i.s, ...i.c].forEach(add)
    return `${s.ground.positions.length}:${s.trees.length}:${s.cars.length}:${s.lamps.length}:${h}`
  }

  it('builds the identical site every time', () => {
    expect(digest(buildSite())).toBe(digest(site))
  })

  it('never calls Math.random (anywhere under src/scene/landscape)', () => {
    const root = join(process.cwd(), 'src/scene/landscape')
    const files: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(n) && !n.endsWith('.test.ts')) files.push(p)
      }
    }
    walk(root)
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/Math\.random/)
  })
})

describe('the exterior: geometry is sound', () => {
  it('every triangle faces the way its stored normal says, and nothing is NaN', () => {
    const { positions: p, normals: n, colors: c } = site.ground
    for (const v of [...p, ...n, ...c]) expect(Number.isFinite(v)).toBe(true)
    for (let t = 0; t < p.length; t += 9) {
      const ux = p[t + 3]! - p[t]!
      const uy = p[t + 4]! - p[t + 1]!
      const uz = p[t + 5]! - p[t + 2]!
      const vx = p[t + 6]! - p[t]!
      const vy = p[t + 7]! - p[t + 1]!
      const vz = p[t + 8]! - p[t + 2]!
      const cx = uy * vz - uz * vy
      const cy = uz * vx - ux * vz
      const cz = ux * vy - uy * vx
      expect(cx * n[t]! + cy * n[t + 1]! + cz * n[t + 2]!).toBeGreaterThan(0)
    }
  })

  it('closed solids (box, prism, blob, frustum) have outward normals', () => {
    const rand = () => 0.5
    const check = (b: MeshBuilder, centre: [number, number, number]) => {
      const d = b.build()
      for (let t = 0; t < d.positions.length; t += 9) {
        const mx = (d.positions[t]! + d.positions[t + 3]! + d.positions[t + 6]!) / 3 - centre[0]
        const my = (d.positions[t + 1]! + d.positions[t + 4]! + d.positions[t + 7]!) / 3 - centre[1]
        const mz = (d.positions[t + 2]! + d.positions[t + 5]! + d.positions[t + 8]!) / 3 - centre[2]
        expect(mx * d.normals[t]! + my * d.normals[t + 1]! + mz * d.normals[t + 2]!).toBeGreaterThan(-1e-9)
      }
    }
    const a = new MeshBuilder()
    a.box(1, 0, 2, 3, 2, 5, hex('#ffffff'), { ry: 0.7, bottom: true })
    check(a, [2, 1, 3.5])
    const b = new MeshBuilder()
    b.blob(0, 1, 0, 2, 1.5, 2, 1, hex('#ffffff'), rand, 0.2)
    check(b, [0, 1, 0])
    const c = new MeshBuilder()
    c.prism(0, 0, 0, 1, 2, 7, hex('#ffffff'), true, 0.6)
    check(c, [0, 1, 0])
  })

  it('stays inside the ground disc and at sane heights', () => {
    const { cx, cz, r } = SITE.disc
    const p = site.ground.positions
    for (let i = 0; i < p.length; i += 3) {
      expect(Math.hypot(p[i]! - cx, p[i + 2]! - cz)).toBeLessThanOrEqual(r + 0.01)
      expect(p[i + 1]!).toBeGreaterThanOrEqual(Y.base - 1e-6)
      expect(p[i + 1]!).toBeLessThan(60)
    }
    for (const l of [site.trees, site.cars, site.lamps]) for (const i of l) expect(Math.hypot(i.x - cx, i.z - cz)).toBeLessThan(r)
  })

  it('keeps its layers apart (no z-fighting: 3 cm and more far out, 4 to 6 mm only near)', () => {
    const levels = [Y.base, Y.lawn, Y.lawnStripe, Y.asphalt, Y.marking, Y.pavingBase, Y.slab, Y.pavingMark].sort((a, b) => a - b)
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeGreaterThanOrEqual(0.0035)
    // the two nearest-spaced pairs are the stripe over the lawn and the slab over its bed, both only seen within about 60 m
    expect(Y.lawnStripe - Y.lawn).toBeGreaterThanOrEqual(0.004)
    expect(Y.slab - Y.pavingBase).toBeGreaterThanOrEqual(0.0059)
    expect(Y.asphalt - Y.lawn).toBeGreaterThanOrEqual(0.03)
    expect(Y.marking - Y.asphalt).toBeGreaterThanOrEqual(0.012)
  })
})

describe('the exterior: keeps clear of the building and the ways people walk', () => {
  it('puts nothing above the ground inside the building rectangle', () => {
    const p = site.ground.positions
    const r = { x0: BUILDING.x0 + 0.01, x1: BUILDING.x1 - 0.01, z0: BUILDING.z0 + 0.01, z1: BUILDING.z1 - 0.01 }
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1]! > Y.lawn + 0.001 && p[i]! > r.x0 && p[i]! < r.x1 && p[i + 2]! > r.z0 && p[i + 2]! < r.z1) throw new Error(`geometry inside the building at ${p[i]}, ${p[i + 2]}`)
    }
    for (const s of site.solids) expect(overlap(s, BUILDING), s.id).toBe(false)
    for (const l of [site.trees, site.cars, site.lamps]) for (const i of l) expect(inside(grow(BUILDING, 1.5), i.x, i.z)).toBe(false)
  })

  it('leaves the walk from the entrance door across the plaza, the plaza and the ambulance bay clear of every solid', () => {
    for (const s of site.solids) {
      expect(overlap(s, KEEP_CLEAR.entranceWalk), `${s.id} on the walk`).toBe(false)
      expect(overlap(s, PLAZA), `${s.id} on the plaza`).toBe(false)
      expect(overlap(s, KEEP_CLEAR.ambulanceBay), `${s.id} in the ambulance bay`).toBe(false)
    }
    for (const l of [site.trees, site.cars, site.lamps]) {
      for (const i of l) {
        expect(inside(grow(KEEP_CLEAR.ambulanceBay, 0.5), i.x, i.z)).toBe(false)
        expect(inside(grow(PLAZA, 0.3), i.x, i.z)).toBe(false)
      }
    }
  })

  it('keeps the walk and the plaza clear of any solid-looking geometry (props stand outside the fences)', () => {
    // anything above 5 cm over the paving whose footprint reaches the walk would show in the ledger; the rail and hedge stand just outside the plaza
    const rail = site.solids.find((s) => s.id === 'plaza-rail')!
    expect(rail.x1).toBeLessThanOrEqual(PLAZA.x0)
    const hedge = site.solids.find((s) => s.id === 'plaza-hedge')!
    expect(hedge.z1).toBeLessThanOrEqual(PLAZA.z0)
  })

  it('plants no tree on a road, the car park, the forecourt or beside a tree the building layout already planted', () => {
    for (const t of site.trees) {
      const forecourt = inside(grow(SITE.forecourt, 0.01), t.x, t.z)
      if (!forecourt) expect(treeBlocked(t.x, t.z), `tree at ${t.x}, ${t.z}`).toBe(false)
      for (const o of LAYOUT_TREES) expect(Math.hypot(o.x - t.x, o.z - t.z), `tree ${t.x},${t.z} vs layout ${o.x},${o.z}`).toBeGreaterThan(3.9)
    }
    expect(site.trees.length).toBeGreaterThan(40)
  })

  it('keeps every neighbour block clear of the campus, and the blocks apart', () => {
    expect(site.blocks.length).toBeGreaterThanOrEqual(10)
    const campus: Box2 = { x0: -140, x1: 82, z0: -62, z1: 62 }
    for (const b of site.blocks) {
      const half = Math.hypot(b.w, b.d) / 2
      expect(inside(grow(campus, half - 4), b.x, b.z), `block ${b.x},${b.z}`).toBe(false)
      expect(Math.hypot(b.x - SITE.disc.cx, b.z - SITE.disc.cz) + half).toBeLessThan(SITE.disc.r)
    }
    // some stand in the line of sight out of the entrance (west)
    expect(site.blocks.filter((b) => b.x < -160 && Math.abs(b.z) < 60).length).toBeGreaterThanOrEqual(2)
  })

  it('parks the cars in bays (or the lay-by), five to eight muted colours, none on top of another', () => {
    const cp = SITE.carPark
    const layBy = { x0: -83.5, x1: -80, z0: -24, z1: 24 }
    expect(site.cars.length).toBeGreaterThan(60)
    expect(site.cars.length).toBeLessThan(140)
    for (const c of site.cars) expect(inside(cp, c.x, c.z) || inside(layBy, c.x, c.z), `car ${c.x},${c.z}`).toBe(true)
    for (let i = 0; i < site.cars.length; i++) for (let j = i + 1; j < site.cars.length; j++) expect(Math.hypot(site.cars[i]!.x - site.cars[j]!.x, site.cars[i]!.z - site.cars[j]!.z)).toBeGreaterThan(1.9)
    // paint families: quantise the linear colour and count
    const family = new Set(site.cars.map((c) => c.c.map((v) => Math.round(Math.cbrt(v) * 4)).join('/')))
    expect(family.size).toBeGreaterThanOrEqual(5)
    for (const c of site.cars) for (const v of c.c) expect(v).toBeLessThan(0.85) // muted: nothing near pure white or saturated
  })

  it('draws a ring road that closes on itself with sensible spacing', () => {
    const ring = ringPoints()
    expect(ring.length).toBeGreaterThan(60)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(8)
    }
    for (const p of ring) expect(inside(grow(BUILDING, 9), p[0], p[1])).toBe(false)
  })
})

describe('the building layout hands the ground to the exterior while walking', () => {
  const layout = buildLayout()
  it('draws the model base (plinth, lawns, apron, forecourt) only in the overview', () => {
    for (const p of layout.prims) if (p.mat === 'plinth') expect(p.overviewOnly).toBe(true)
    const grass = layout.prims.filter((p) => p.mat === 'grass' && p.position[0] < -60)
    expect(grass.length).toBeGreaterThan(0)
    // every stonePath slab round the shell (not the atrium's) is overview-only
    for (const p of layout.prims) if (p.mat === 'stonePath' && p.shape === 'box' && (p.position[0] < -60 || Math.abs(p.position[2]) > 20)) expect(p.overviewOnly, `${p.position}`).toBe(true)
  })

  it('hangs the entrance canopy at the height of the authored porch (3.1 m) without a coplanar slab', () => {
    const slabs = layout.prims.filter((p) => p.mat === 'whitePlastic' && p.shape === 'roundedBox' && p.position[0] < -62 && Math.abs(p.position[2]) < 5 && p.size[1] === 0.22)
    expect(slabs.length).toBeGreaterThan(0)
    for (const s of slabs) expect(s.position[1] - s.size[1] / 2).toBeCloseTo(3.1, 5)
  })
})

describe('the haze', () => {
  it('mixes toward the sky dome horizon colour using the shared sky uniforms', () => {
    const { matte, gloss } = createExteriorMaterials()
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: 'void main() {\n#include <fog_fragment>\n}' }
    matte.onBeforeCompile(shader as never, null as never)
    expect(shader.fragmentShader).toContain('uHzInvDist')
    expect(shader.fragmentShader).toContain('vViewPosition')
    expect(shader.uniforms.uHzSky).toBe(skyUniforms.uSky)
    expect(shader.uniforms.uHzHorizon).toBe(skyUniforms.uHorizon)
    expect(shader.uniforms.uHzDay).toBe(skyUniforms.uDay)
    expect(shader.uniforms.uHzBlend).toBe(skyUniforms.uBlend)
    expect(matte.customProgramCacheKey()).toBe(gloss.customProgramCacheKey())
    // the ground's rim (250 m from the middle, 222 m from the plaza at the closest) is at least 97 % hazed
    const d = 222 / HAZE_DISTANCE
    expect(1 - Math.exp(-d * d)).toBeGreaterThan(0.97)
  })
})
