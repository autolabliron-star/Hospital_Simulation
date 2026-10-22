import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { buildWallPieces } from '../layout/walls'
import { buildLayout } from '../layout'
import { LayoutBuilder } from '../layout/builder'
import { buildFloors, buildWalls } from '../layout/shell'
import type { Prim } from '../layout/types'
import { parseBuildingFlag } from './flags'
import { applyLightmaps, hasBakedLook } from './lightmaps'
import { checkModelAgainstPlan } from './checkModelAgainstPlan'
import { hidesPrim, hidesWalkPart, inPilotRegion } from './region'

describe('?building flag', () => {
  it('is procedural unless building=model', () => {
    expect(parseBuildingFlag('')).toBe('procedural')
    expect(parseBuildingFlag('?building=model')).toBe('model')
    expect(parseBuildingFlag('?seed=3&building=model&probe=1')).toBe('model')
    expect(parseBuildingFlag('?building=procedural')).toBe('procedural')
    expect(parseBuildingFlag('?building=MODEL')).toBe('procedural')
  })
})

describe('pilot region filters', () => {
  const layout = buildLayout()
  const hidden = (p: Prim) => hidesPrim(p.mat, p.position[0], p.position[2])
  const near = (p: Prim, x: number, z: number, r: number) => Math.hypot(p.position[0] - x, p.position[2] - z) <= r

  it('hide nothing outside the region, and the region test itself', () => {
    expect(inPilotRegion(-50, 0)).toBe(true)
    expect(inPilotRegion(-20, 0)).toBe(false)
    expect(layout.prims.filter((p) => hidden(p) && p.position[0] > -22)).toEqual([])
  })

  it('hide the architecture the model draws: covered floors, walls, glazing and jambs', () => {
    const lobbyFloor = layout.prims.find((p) => p.shape === 'plane' && p.position[1] <= 0.01 && near(p, -53, 0, 0.01))
    expect(lobbyFloor && hidden(lobbyFloor)).toBe(true)
    // the north lobby wall (z = -6, x -62..-51) and its cap
    const wall = layout.prims.filter((p) => (p.mat === 'wall' || p.mat === 'wallCap') && Math.abs(p.position[2] + 6) < 0.01 && p.position[0] < -51)
    expect(wall.length).toBeGreaterThan(0)
    for (const p of wall) expect(hidden(p)).toBe(true)
    // the west façade's mullions and glass, even the ones south of the region's edge (the piece's centre is inside, so the model draws it whole)
    const facade = layout.prims.filter((p) => (p.mat === 'frame' || p.mat === 'glass') && Math.abs(p.position[0] + 62) < 0.01)
    expect(facade.length).toBeGreaterThan(4)
    for (const p of facade.filter((p) => p.position[2] > -22 && p.position[2] < 9.2)) expect(hidden(p), `${p.mat} z ${p.position[2]}`).toBe(true)
    // the triage door's jambs
    const jambs = layout.prims.filter((p) => p.mat === 'frame' && Math.abs(p.position[2] + 6) < 0.01 && Math.abs(Math.abs(p.position[0] + 50) - 1) < 0.01)
    expect(jambs.length).toBe(2)
    for (const p of jambs) expect(hidden(p)).toBe(true)
  })

  it('keep furniture that only shares an architecture material (triage dividers and desk panel, imaging glass and supply doors)', () => {
    const shellKeys = (() => {
      const b = new LayoutBuilder()
      buildFloors(b)
      buildWalls(b)
      return new Set(b.prims.map((p) => `${p.mat}|${p.position.join(',')}`))
    })()
    const furniture = layout.prims.filter(
      (p) => (p.mat === 'wallMint' || p.mat === 'glass' || p.mat === 'wall') && inPilotRegion(p.position[0], p.position[2]) && !shellKeys.has(`${p.mat}|${p.position.join(',')}`),
    )
    expect(furniture.length).toBeGreaterThan(5)
    expect(furniture.filter((p) => hidden(p) && !near(p, -52, -3, 1.7))).toEqual([])
  })

  it('hide the designed lobby furniture, keep the kiosks, screens and everyone\'s seats', () => {
    const lobby = layout.footprints.filter((f) => f.area === 'lobby')
    const fp = (id: string) => {
      const f = lobby.find((x) => x.id === id)
      if (!f) throw new Error(id)
      return f
    }
    const inside = (p: Prim, id: string, pad: number) => {
      const f = fp(id)
      const dx = p.position[0] - f.x
      const dz = p.position[2] - f.z
      const c = Math.cos(f.rotationY)
      const s = Math.sin(f.rotationY)
      const lx = dx * c - dz * s
      const lz = dx * s + dz * c
      return Math.abs(lx) <= f.hw + pad && Math.abs(lz) <= f.hd + pad
    }
    for (const id of ['lobby:seatsN1', 'lobby:seatsN2', 'lobby:seatsS1', 'lobby:seatsS2']) {
      const prims = layout.prims.filter((p) => inside(p, id, 0.1) && p.position[1] < 1)
      expect(prims.length, id).toBeGreaterThan(5)
      for (const p of prims) expect(hidden(p), `${id} ${p.mat}`).toBe(true)
    }
    const desk = layout.prims.filter((p) => inside(p, 'lobby:reception', 0.1) && ['whitePlastic', 'woodOak', 'wallMint', 'glowTeal'].includes(p.mat))
    expect(desk.length).toBeGreaterThan(4)
    for (const p of desk) expect(hidden(p)).toBe(true)
    // screens and their bezels stay on the designed desk; kiosks (self check-in and health) stay whole
    for (const p of layout.prims.filter((p) => inside(p, 'lobby:reception', 0.1) && (p.mat === 'screen' || p.shape === 'quad'))) expect(hidden(p)).toBe(false)
    for (const id of ['lobby:kiosk0', 'lobby:kiosk1', 'health:tower:0', 'health:tower:1'])
      for (const p of layout.prims.filter((p) => inside(p, id, 0.05))) expect(hidden(p), `${id} ${p.mat}`).toBe(false)
    // the seats are sim data: never touched by the model
    expect(layout.seats.filter((s) => s.area === 'lobby' && s.kind === 'waiting').length).toBe(14)
  })

  it('walk mode: ceilings of covered areas and frames on covered lines go, sign plates and outside parts stay', () => {
    expect(hidesWalkPart('ceiling', -53, 0)).toBe(true) // lobby
    expect(hidesWalkPart('ceiling', -53, -20)).toBe(true) // triage (its centre is in the region)
    expect(hidesWalkPart('ceiling', 0, -14)).toBe(false) // corridor A: centre outside
    expect(hidesWalkPart('frame', -51, -6)).toBe(true) // the triage door's jamb line
    expect(hidesWalkPart('frame', -51, -6 + 0.14)).toBe(false) // a plate on the wall face
    expect(hidesWalkPart('wall', -20, 0)).toBe(false)
    expect(hidesWalkPart('glass', -62, -20)).toBe(true) // the façade piece z -22..-1.5 is the model's whole
  })
})

describe('lightmap wiring', () => {
  function scene(): { root: Group; a: Mesh; b: Mesh; c: Mesh } {
    const root = new Group()
    const shared = new MeshStandardMaterial()
    const mk = (file: string | null, mat: MeshStandardMaterial) => {
      const m = new Mesh(new BoxGeometry(1, 1, 1), mat)
      if (file) m.userData.lightmap = file
      root.add(m)
      return m
    }
    return { root, a: mk('a.ktx2', shared), b: mk('b.ktx2', shared), c: mk(null, new MeshStandardMaterial()) }
  }
  it('sets lightMap on channel 1 and clones only on conflict', () => {
    const { root, a, b, c } = scene()
    const texs = new Map<string, Texture>([['a.ktx2', new Texture()], ['b.ktx2', new Texture()]])
    const r = applyLightmaps(root, (f) => texs.get(f) ?? null)
    expect((a.material as MeshStandardMaterial).lightMap).toBe(texs.get('a.ktx2'))
    expect((b.material as MeshStandardMaterial).lightMap).toBe(texs.get('b.ktx2'))
    expect(a.material).not.toBe(b.material)
    expect(texs.get('a.ktx2')?.channel).toBe(1)
    expect((c.material as MeshStandardMaterial).lightMap).toBeNull()
    expect(hasBakedLook(a.material as MeshStandardMaterial)).toBe(true)
    expect(hasBakedLook(b.material as MeshStandardMaterial)).toBe(true) // the clone is patched too
    expect(hasBakedLook(c.material as MeshStandardMaterial)).toBe(false)
    expect(r.materials).toHaveLength(3)
    expect(r.textures).toHaveLength(2)
    expect(r.missing).toEqual([])
  })
  it('reports a lightmap that did not load and leaves the material alone', () => {
    const { root, a } = scene()
    const r = applyLightmaps(root, () => null)
    expect(r.missing).toEqual(['a.ktx2', 'b.ktx2'])
    expect((a.material as MeshStandardMaterial).lightMap).toBeNull()
  })
})

const regionPieces = () =>
  buildWallPieces().filter((p) => {
    if (p.cls !== 'solid') return false
    const [x0, x1, z0, z1] = p.alongX ? [p.a, p.b, p.c, p.c] : [p.c, p.c, p.a, p.b]
    return inPilotRegion(x0, z0) && inPilotRegion(x1, z1)
  })

/** A stand-in model: one 0.2 m thick box per solid plan wall, 2.8 m high, all in one mesh. */
function syntheticModel(offset = 0): Group {
  const parts: BoxGeometry[] = []
  for (const p of regionPieces()) {
    const len = p.b - p.a
    const g = p.alongX ? new BoxGeometry(len, 2.8, 0.2) : new BoxGeometry(0.2, 2.8, len)
    const mid = (p.a + p.b) / 2
    g.translate(p.alongX ? mid : p.c + offset, 1.4, p.alongX ? p.c + offset : mid)
    parts.push(g)
  }
  const pos: number[] = []
  const idx: number[] = []
  for (const g of parts) {
    const base = pos.length / 3
    for (const v of Array.from(g.getAttribute('position').array)) pos.push(v)
    for (const i of Array.from(g.index?.array ?? [])) idx.push(base + i)
  }
  const geom = new BoxGeometry(0, 0, 0)
  geom.setAttribute('position', new BufferAttribute(Float32Array.from(pos), 3))
  geom.setIndex(idx)
  const root = new Group()
  root.add(new Mesh(geom, new MeshStandardMaterial()))
  return root
}

describe('checkModelAgainstPlan', () => {
  it('the pilot region has solid walls to check', () => {
    expect(regionPieces().length).toBeGreaterThan(3)
  })
  it('accepts a model built from the plan', () => {
    const r = checkModelAgainstPlan(syntheticModel(), buildWallPieces())
    expect(r.checked).toBeGreaterThan(3)
    expect(r.mismatches).toEqual([])
  })
  it('rejects a wall 5 cm off the plan line, accepts 1 cm', () => {
    expect(checkModelAgainstPlan(syntheticModel(0.05), buildWallPieces()).mismatches.length).toBeGreaterThan(0)
    expect(checkModelAgainstPlan(syntheticModel(0.01), buildWallPieces()).mismatches).toEqual([])
  })
  it('flags a missing wall', () => {
    const r = checkModelAgainstPlan(new Group(), buildWallPieces())
    expect(r.mismatches.length).toBe(r.checked)
  })
})

const GLB = join(process.cwd(), 'public/assets/building/pilot-lobby.glb')
describe('the authored pilot-lobby.glb', () => {
  const present = existsSync(GLB)
  if (!present) console.info('SKIP: public/assets/building/pilot-lobby.glb is not there yet (Blender output); the model-vs-plan check runs once it lands')
  it.skipIf(!present)('matches the plan within 2 cm', async () => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    // textures are KTX2: node cannot transcode them and the check only needs geometry
    loader.register(() => ({ name: 'KHR_texture_basisu', loadTexture: () => Promise.resolve(new Texture()) }))
    const buf = readFileSync(GLB)
    const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
    const r = checkModelAgainstPlan(gltf.scene, buildWallPieces())
    expect(r.checked).toBeGreaterThan(0)
    expect(r.mismatches.map((m) => m.reason)).toEqual([])
  })
  it.skipIf(!present)('keeps the lightmap UVs (TEXCOORD_1) on every lightmapped mesh', async () => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.register(() => ({ name: 'KHR_texture_basisu', loadTexture: () => Promise.resolve(new Texture()) }))
    const buf = readFileSync(GLB)
    const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
    const without: string[] = []
    let lit = 0
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh || typeof mesh.userData.lightmap !== 'string') return
      lit++
      if (!mesh.geometry.getAttribute('uv1')) without.push(mesh.name)
    })
    expect(lit).toBeGreaterThan(0)
    expect(without).toEqual([])
  })
  it.skipIf(!present)('winds every triangle the way its normals face (single-sided materials are culled at runtime)', async () => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.register(() => ({ name: 'KHR_texture_basisu', loadTexture: () => Promise.resolve(new Texture()) }))
    const buf = readFileSync(GLB)
    const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
    const bad: string[] = []
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const pos = mesh.geometry.getAttribute('position')
      const nor = mesh.geometry.getAttribute('normal')
      const idx = mesh.geometry.getIndex()
      if (!pos || !nor || !idx) return
      let wrong = 0
      const n = idx.count / 3
      for (let t = 0; t < n; t++) {
        const [a, b, c] = [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)]
        const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a)
        const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a)
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
        const nx = nor.getX(a) + nor.getX(b) + nor.getX(c), ny = nor.getY(a) + nor.getY(b) + nor.getY(c), nz = nor.getZ(a) + nor.getZ(b) + nor.getZ(c)
        if (fx * nx + fy * ny + fz * nz < 0) wrong++
      }
      if (wrong > n * 0.01) bad.push(`${mesh.name}: ${wrong}/${n}`)
    })
    expect(bad).toEqual([])
  })
})
