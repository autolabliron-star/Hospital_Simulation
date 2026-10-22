/**
 * The shipped building (public/assets/building/manifest.json and its zones), when the pipeline has written one: it parses with no warning, every
 * file it names is there, every lightmap a glb's nodes name is beside the glb, every external image is a shared material file of the manifest,
 * and the skeleton of each zone gives the warm-up exactly the program keys the real zone will ask for.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Texture, type Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { MODEL_CLIP, clipOfLevel } from './clip'
import { prepareFarScene } from './farModel'
import { meshKeys, programKey } from './fixtures.testutil'
import { lightmapNameOf } from './lightmaps'
import { normalizeUrl, parseManifestText } from './manifest'
import { readGlbJson, skeletonGlb, skeletonLightmapStub, skeletonTexturePlugin } from './skeleton'
import { prepareZoneScene } from './zoneLoader'

const DIR = join(process.cwd(), 'public/assets/building')
const FILE = join(DIR, 'manifest.json')
const present = existsSync(FILE)
if (!present) console.info('SKIP: public/assets/building/manifest.json is not there yet (the zone pipeline writes it); the pilot path is used')

const read = (rel: string): ArrayBuffer => {
  const b = readFileSync(join(DIR, rel))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const stubTextures = () => ({ name: 'KHR_texture_basisu', loadTexture: () => Promise.resolve(new Texture()) })

describe.skipIf(!present)('the shipped manifest', () => {
  const parsed = present ? parseManifestText(readFileSync(FILE, 'utf8')) : null

  it('parses with no warning, and every file it names is there', () => {
    expect(parsed?.ok, parsed && !parsed.ok ? parsed.error : '').toBe(true)
    if (!parsed?.ok) return
    expect(parsed.warnings).toEqual([])
    const m = parsed.manifest
    for (const f of m.materials.files) expect(existsSync(join(DIR, f)), f).toBe(true)
    for (const z of m.zones) {
      expect(existsSync(join(DIR, z.glb)), z.glb).toBe(true)
      for (const f of z.lightmaps) expect(existsSync(join(DIR, f)), f).toBe(true)
      if (z.probe) expect(existsSync(join(DIR, z.probe.hdr)), z.probe.hdr).toBe(true)
      if (z.proxy) expect(existsSync(join(DIR, z.proxy.glb)), z.proxy.glb).toBe(true)
    }
  })

  it('every overview proxy loads into one mesh with the one shared unlit program', async () => {
    if (!parsed?.ok) return
    const keys = new Set<string>()
    for (const z of parsed.manifest.zones) {
      if (!z.proxy) continue
      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      loader.register(stubTextures)
      const { scene } = (await loader.parseAsync(read(z.proxy.glb), '')) as unknown as { scene: Group }
      const far = prepareFarScene(z.id, scene, clipOfLevel(z.level), z.proxy.scale, z.mountOffset)
      expect(far.material.color.r, z.id).toBeGreaterThanOrEqual(1)
      far.mesh.geometry.computeBoundingBox()
      const b = far.mesh.geometry.boundingBox!.clone().applyMatrix4(far.mesh.matrixWorld)
      // the proxy sits where the zone does (its bounds, a little slack for the quantization)
      expect(b.min.x, z.id).toBeGreaterThan(z.bounds.x0 - 1)
      expect(b.max.x, z.id).toBeLessThan(z.bounds.x1 + 1)
      expect(b.min.y, z.id).toBeGreaterThan(z.bounds.y0 - 1)
      keys.add(programKey(far.material, far.mesh))
    }
    expect(keys.size).toBeLessThanOrEqual(1)
  })

  it('every zone glb names only lightmaps beside it and shared images the manifest lists', () => {
    if (!parsed?.ok) return
    const shared = new Set(parsed.manifest.materials.files.map((f) => normalizeUrl(`/assets/building/${f}`)))
    for (const z of parsed.manifest.zones) {
      const json = readGlbJson(read(z.glb))!.json
      const dir = `/assets/building/${z.glb.slice(0, z.glb.lastIndexOf('/') + 1)}`
      for (const img of (json.images as { uri?: string }[] | undefined) ?? []) {
        if (!img.uri) continue
        expect(shared.has(normalizeUrl(dir + img.uri)), `${z.id}: ${img.uri}`).toBe(true)
      }
      for (const n of json.nodes ?? []) {
        const lm = (n.extras as { lightmap?: string } | undefined)?.lightmap
        if (lm) expect(existsSync(join(DIR, z.glb.slice(0, z.glb.lastIndexOf('/') + 1), lm)), `${z.id}: ${lm}`).toBe(true)
      }
    }
  })

  it('the skeleton of every zone has the program keys of the zone itself', async () => {
    if (!parsed?.ok) return
    for (const z of parsed.manifest.zones) {
      const real = new GLTFLoader()
      real.setMeshoptDecoder(MeshoptDecoder)
      real.register(stubTextures)
      const buf = read(z.glb)
      const a = (await real.parseAsync(buf, '')) as unknown as { scene: Group }
      const lm = new Texture()
      prepareZoneScene(a.scene, () => lm, MODEL_CLIP)
      const sk = new GLTFLoader()
      sk.register(skeletonTexturePlugin())
      const b = (await sk.parseAsync(skeletonGlb(readGlbJson(buf)!.json), '')) as unknown as { scene: Group }
      prepareZoneScene(b.scene, () => skeletonLightmapStub(), MODEL_CLIP)
      const ka = meshKeys(a.scene)
      expect(ka.size, z.id).toBeGreaterThan(0)
      // a mesh name can repeat (a kit node's child `<name>#mesh`): compare the sets of keys per name
      expect(meshKeys(b.scene)).toEqual(ka)
      let lit = 0
      a.scene.traverse((o) => {
        if (lightmapNameOf(o)) lit++
      })
      expect(lit, z.id).toBeGreaterThan(0)
    }
  })
})
