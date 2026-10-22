/**
 * The overview proxy step (tools/arch/proxy.mjs): the pure pieces (atlas packing, small-part culling, the rasteriser, the encoding scale), a
 * whole proxy built from a small synthetic zone (one primitive, one unlit material, a texture, the colour the runtime would have drawn), and
 * the shipped proxies of public/assets/building/manifest.json (one draw each, within the triangle cap, an embedded KTX2 atlas).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { PROXY, buildProxyDoc, colourScale, dilateTile, dropSmallParts, encodeProxy, linearToSrgb8, packSquares, rasterTile, srgbToLinear, tileSizes } from './proxy.mjs'

const ROOT = process.cwd()

describe('the atlas layout', () => {
  it('packs power-of-two squares whose areas fill the atlas exactly, without overlap', () => {
    const sides = [512, 256, 256, 256, 128, 128, 128, 128, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64]
    const at = packSquares(sides, 1024)!
    expect(at).not.toBeNull()
    const used = new Uint8Array(1024 * 1024)
    sides.forEach((s, i) => {
      const { x, y } = at[i]
      expect(x + s).toBeLessThanOrEqual(1024)
      expect(y + s).toBeLessThanOrEqual(1024)
      for (let yy = y; yy < y + s; yy += 16) for (let xx = x; xx < x + s; xx += 16) used[yy * 1024 + xx]++
    })
    expect(used.reduce((m, v) => Math.max(m, v), 0)).toBe(1)
    expect(packSquares([1024, 16], 1024)).toBeNull()
  })

  it('sizes tiles by surface area, keeps them in bounds, and fills the atlas', () => {
    const { sides, atlas } = tileSizes([2000, 500, 10, 0], PROXY)
    expect(atlas).toBeGreaterThanOrEqual(PROXY.minAtlas)
    expect(atlas).toBeLessThanOrEqual(PROXY.maxAtlas)
    for (const s of sides) {
      expect(Math.log2(s) % 1).toBe(0)
      expect(s).toBeGreaterThanOrEqual(PROXY.minTile)
    }
    expect(sides[0]).toBeGreaterThanOrEqual(sides[1])
    expect(sides[0] ** 2 / 2000).toBeGreaterThanOrEqual(PROXY.texelsPerM2 * 0.5) // the big surfaces are never starved
    expect(sides.reduce((a, s) => a + s * s, 0)).toBeLessThanOrEqual(atlas * atlas)
    expect(packSquares(sides, atlas)).not.toBeNull()
    // far too much surface for the largest atlas: the largest tiles are halved until it fits
    const big = tileSizes([1e6, 1e6, 1e6, 1e6, 1e6], PROXY)
    expect(big.atlas).toBe(PROXY.maxAtlas)
    expect(packSquares(big.sides, big.atlas)).not.toBeNull()
  })
})

describe('detail', () => {
  it('drops connected parts smaller than minPart, whatever their UV seams', () => {
    // a 2 m quad, and a 0.1 m quad split at a "seam" (duplicated vertices at the same positions)
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0, 5, 0, 0, 5.1, 0, 0, 5.1, 0.1, 0, 5, 0, 0, 5.1, 0.1, 0, 5, 0.1, 0])
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 7, 8, 9])
    expect([...dropSmallParts(positions, indices, 0.3)]).toEqual([0, 1, 2, 0, 2, 3])
    expect(dropSmallParts(positions, indices, 0.05).length).toBe(12)
  })
})

describe('the rasteriser', () => {
  it('covers the texels of a triangle, dilates the gutter, and fills the rest of the tile with its mean', () => {
    const atlas = 32
    const rgb = new Float32Array(atlas * atlas * 3)
    const cov = new Uint8Array(atlas * atlas)
    const tile = { x: 16, y: 0, s: 16, pad: 2 }
    // the lower-left half of the tile's inner square, shaded red
    rasterTile(rgb, cov, atlas, tile, new Float32Array([0, 0, 1, 1, 0, 1]), new Uint32Array([0, 1, 2]), (_a, _b, _c, _w0, _w1, _w2, out) => {
      out[0] = 1
      out[1] = 0
      out[2] = 0
    })
    const at = (x: number, y: number) => y * atlas + x
    expect(cov[at(17, 14)]).toBe(0) // the pad, before dilation
    expect(cov[at(19, 12)]).toBe(1) // inside
    expect(cov[at(29, 3)]).toBe(0) // the other half
    dilateTile(rgb, cov, atlas, tile, 2)
    expect(cov[at(17, 14)]).toBe(1)
    for (let y = 0; y < 16; y++) for (let x = 16; x < 32; x++) expect(cov[at(x, y)]).toBeGreaterThan(0)
    for (let x = 0; x < 16; x++) expect(cov[at(x, 0)]).toBe(0) // never outside the tile
    expect(rgb[at(29, 3) * 3]).toBeCloseTo(1)
  })

  it('the encoding scale keeps headroom for bright texels and is never below 1', () => {
    const rgb = new Float32Array(3000).fill(0.3)
    const cov = new Uint8Array(1000).fill(1)
    expect(colourScale(rgb, cov)).toBe(1)
    for (let i = 0; i < 900; i++) rgb[i * 3] = 2.5
    expect(colourScale(rgb, cov)).toBeCloseTo(2.5)
    expect(linearToSrgb8(srgbToLinear(200))).toBe(200)
  })
})

describe('a proxy from a small zone', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'proxy-test-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  async function zone(): Promise<Document> {
    const doc = new Document()
    const buf = doc.createBuffer()
    const acc = (type: 'VEC2' | 'VEC3' | 'SCALAR', a: Float32Array | Uint32Array) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf)
    // a 4 x 3 m wall (lightmapped) and, in the same primitive, a 0.1 m knob
    const wall = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array([0, 0, 0, 4, 0, 0, 4, 3, 0, 0, 3, 0, 1, 1, 0.1, 1.1, 1, 0.1, 1.1, 1.1, 0.1])))
      .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(14)))
      .setAttribute('TEXCOORD_1', acc('VEC2', new Float32Array([0, 1, 1, 1, 1, 0, 0, 0, 0.5, 0.5, 0.55, 0.5, 0.55, 0.45])))
      .setIndices(acc('SCALAR', new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6])))
      .setMaterial(doc.createMaterial('WallPaint').setBaseColorFactor([0.5, 0.5, 0.5, 1]).setMetallicFactor(0))
    const led = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array([0, 2.9, 0.5, 1, 2.9, 0.5, 1, 2.9, 1.5])))
      .setIndices(acc('SCALAR', new Uint32Array([0, 1, 2])))
      .setMaterial(doc.createMaterial('LEDLine').setEmissiveFactor([1, 0.9, 0.8]))
    const glass = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array([0, 0, 2, 4, 0, 2, 4, 3, 2])))
      .setIndices(acc('SCALAR', new Uint32Array([0, 1, 2])))
      .setMaterial(doc.createMaterial('Glass').setAlphaMode('BLEND'))
    const scene = doc.createScene()
    scene.addChild(doc.createNode('arch_WallPaint').setMesh(doc.createMesh().addPrimitive(wall)).setExtras({ lightmap: 'lm_WallPaint.png', lightmapScale: 2 }))
    scene.addChild(doc.createNode('arch_LEDLine').setMesh(doc.createMesh().addPrimitive(led)))
    scene.addChild(doc.createNode('arch_Glass').setMesh(doc.createMesh().addPrimitive(glass)))
    // the lightmap: sRGB 128 everywhere
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .png()
      .toFile(path.join(tmp, 'lm_WallPaint.png'))
    return doc
  }

  it('is one primitive with one unlit material and a texture, holding the colour the runtime draws', async () => {
    await MeshoptDecoder.ready
    const built = await buildProxyDoc(await zone(), tmp)
    expect(built.stats.droppedSmall).toBe(1) // the knob
    expect(built.stats.glass).toBe(1)
    expect(built.tris).toBe(2 + 1) // the wall (a quad cannot simplify) and the LED
    // the wall's tile: albedo 0.5 x lightmap (sRGB 128 -> linear) x lightmapScale 2, in the middle of the wall's UVs
    const { size, rgb, cov } = built.atlas
    const lm = srgbToLinear(128)
    let hits = 0
    for (let i = 0; i < size * size; i++) if (cov[i] === 1 && Math.abs(rgb[i * 3] - 0.5 * lm * 2) < 0.01) hits++
    expect(hits).toBeGreaterThan(100)
    expect(built.scale).toBe(1)

    const png = await sharp(Buffer.alloc(16 * 16 * 3, 128), { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer()
    const glb = await encodeProxy(new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder }), built, new Uint8Array(png), 'image/png')
    const back = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(glb)
    const meshes = back.getRoot().listMeshes()
    expect(meshes).toHaveLength(1)
    expect(meshes[0].listPrimitives()).toHaveLength(1)
    expect(back.getRoot().listMaterials()).toHaveLength(1)
    const mat = back.getRoot().listMaterials()[0]
    expect(mat.getExtension('KHR_materials_unlit')).not.toBeNull()
    expect(mat.getBaseColorTexture()).not.toBeNull()
    const node = back.getRoot().listNodes().find((n) => n.getMesh())!
    expect(node.getExtras().proxyScale).toBe(1)
    expect(meshes[0].listPrimitives()[0].listSemantics().sort()).toEqual(['POSITION', 'TEXCOORD_0'])
  })
})

// --- the shipped proxies -------------------------------------------------------------------------------------------------------------------------
const MANIFEST = path.join(ROOT, 'public/assets/building/manifest.json')
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null
const withProxy = (manifest?.zones ?? []).filter((z: { proxy?: unknown }) => z.proxy)

function glbJson(file: string) {
  const b = readFileSync(file)
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'))
}

describe.skipIf(!withProxy.length)('the shipped overview proxies', () => {
  it('each is one draw, within the triangle cap, with an embedded KTX2 atlas', () => {
    const missing = manifest.zones.filter((z: { proxy?: unknown }) => !z.proxy).map((z: { id: string }) => z.id)
    if (missing.length) console.info(`zones without an overview proxy yet (drawn in full everywhere): ${missing.join(', ')}`)
    for (const z of withProxy) {
      const file = path.join(ROOT, 'public/assets/building', z.proxy.glb)
      expect(existsSync(file), z.proxy.glb).toBe(true)
      const j = glbJson(file)
      expect(j.meshes, z.id).toHaveLength(1)
      expect(j.meshes[0].primitives, z.id).toHaveLength(1)
      expect(j.materials, z.id).toHaveLength(1)
      expect(j.materials[0].extensions?.KHR_materials_unlit, z.id).toBeDefined()
      const tex = j.textures[j.materials[0].pbrMetallicRoughness.baseColorTexture.index]
      const img = j.images[tex.extensions.KHR_texture_basisu.source]
      expect(img.mimeType).toBe('image/ktx2')
      expect(img.bufferView, z.id).toBeTypeOf('number') // embedded: the proxy is one file
      const prim = j.meshes[0].primitives[0]
      const tris = j.accessors[prim.indices].count / 3
      expect(tris, z.id).toBe(z.proxy.tris)
      expect(tris, z.id).toBeLessThanOrEqual(PROXY.trisCap)
      const node = j.nodes.find((n: { mesh?: number }) => n.mesh === 0)
      expect(node.extras.proxyScale, z.id).toBeGreaterThanOrEqual(1)
      expect(z.proxy.mb, z.id).toBeLessThanOrEqual(5.4) // 2048 x 2048 at most
    }
  })
})
