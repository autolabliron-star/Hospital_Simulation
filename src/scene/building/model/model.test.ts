import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { buildWallPieces } from '../layout/walls'
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
  it('hide architecture inside, nothing outside, never furniture', () => {
    expect(inPilotRegion(-50, 0)).toBe(true)
    expect(inPilotRegion(-20, 0)).toBe(false)
    expect(hidesPrim('floorTerrazzo', -50, 0)).toBe(true)
    expect(hidesPrim('wall', -50, 0)).toBe(true)
    expect(hidesPrim('wall', -20, 0)).toBe(false)
    expect(hidesPrim('whitePlastic', -50, 0)).toBe(false)
    expect(hidesWalkPart('ceiling', -50, 0)).toBe(true)
    expect(hidesWalkPart('frame', -50, 0)).toBe(false)
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
})
