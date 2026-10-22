/**
 * Test fixtures for the zone runtime (imported by tests only): small zone glbs built in memory, shaped like the pipeline's (one node per mesh,
 * `extras.lightmap` on the node, KHR_texture_basisu textures whose images are shared files `../../materials/<name>.ktx2`), and manifests.
 */
import { CompressedTexture, Texture, RGBA_ASTC_4x4_Format, type Group, type Material, type Mesh, type MeshStandardMaterial } from 'three'
import type { GltfJson } from './skeleton'

export interface FixtureMesh {
  name: string
  material: number
  lightmap?: string
  colors?: boolean
}

/** A GLB from a JSON object and its binary chunk. */
export function glbFrom(json: object, bin: Uint8Array): ArrayBuffer {
  const enc = new TextEncoder().encode(JSON.stringify(json))
  const jl = Math.ceil(enc.length / 4) * 4
  const bl = Math.ceil(bin.length / 4) * 4
  const total = 20 + jl + (bl ? 8 + bl : 0)
  const out = new ArrayBuffer(total)
  const dv = new DataView(out)
  const u8 = new Uint8Array(out)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jl, true)
  dv.setUint32(16, 0x4e4f534a, true)
  u8.set(enc, 20)
  for (let i = 20 + enc.length; i < 20 + jl; i++) u8[i] = 0x20
  if (bl) {
    dv.setUint32(20 + jl, bl, true)
    dv.setUint32(24 + jl, 0x004e4942, true)
    u8.set(bin, 28 + jl)
  }
  return out
}

/** The materials of a typical zone: a textured, normal-mapped, ARM floor; a plain wall; an emissive LED (no lightmap); a glass (blend). */
export const FIXTURE_MATERIALS = [
  {
    name: 'Terrazzo',
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 2 } },
    normalTexture: { index: 1, scale: 0.35 },
    occlusionTexture: { index: 2 },
  },
  { name: 'WallPaint', pbrMetallicRoughness: { baseColorTexture: { index: 3 }, roughnessFactor: 0.8 }, normalTexture: { index: 1 } },
  { name: 'LEDLine', emissiveFactor: [1, 1, 1], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 22 } } },
  { name: 'Glass', alphaMode: 'BLEND', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.2] } },
]
export const FIXTURE_IMAGES = ['Terrazzo_diff', 'Terrazzo_nor', 'Terrazzo_arm', 'Plaster_diff']

/** A zone glb: one node per mesh (one primitive), each named lightmap in the node's extras. */
export function zoneGlb(meshes: FixtureMesh[], opts: { origin?: [number, number, number] } = {}): ArrayBuffer {
  const [ox, oy, oz] = opts.origin ?? [0, 0, 0]
  const parts: Float32Array[] = []
  const views: object[] = []
  const accessors: object[] = []
  let offset = 0
  const add = (data: Float32Array, type: string, minmax = false): number => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength })
    const n = { VEC2: 2, VEC3: 3, VEC4: 4 }[type] ?? 3
    const acc: Record<string, unknown> = { bufferView: views.length - 1, componentType: 5126, count: data.length / n, type }
    if (minmax) {
      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < data.length; i += 3)
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], data[i + k])
          max[k] = Math.max(max[k], data[i + k])
        }
      Object.assign(acc, { min, max })
    }
    accessors.push(acc)
    parts.push(data)
    offset += data.byteLength
    return accessors.length - 1
  }
  const nodes = meshes.map((m, i) => ({ name: m.name, mesh: i, ...(m.lightmap ? { extras: { lightmap: m.lightmap } } : {}) }))
  const gltfMeshes = meshes.map((m, i) => {
    const x = ox + i * 2
    const attributes: Record<string, number> = {
      POSITION: add(new Float32Array([x, oy, oz, x + 1, oy, oz, x, oy + 1, oz]), 'VEC3', true),
      NORMAL: add(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 'VEC3'),
      TEXCOORD_0: add(new Float32Array([0, 0, 1, 0, 0, 1]), 'VEC2'),
      TEXCOORD_1: add(new Float32Array([0, 0, 1, 0, 0, 1]), 'VEC2'),
    }
    if (m.colors) attributes.COLOR_0 = add(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 'VEC3')
    return { name: m.name, primitives: [{ attributes, material: m.material }] }
  })
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    materials: FIXTURE_MATERIALS,
    textures: FIXTURE_IMAGES.map((_, i) => ({ sampler: 0, extensions: { KHR_texture_basisu: { source: i } } })),
    images: FIXTURE_IMAGES.map((n) => ({ uri: `../../materials/${n}.ktx2`, mimeType: 'image/ktx2' })),
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
    extensionsUsed: ['KHR_texture_basisu', 'KHR_materials_emissive_strength'],
    extensionsRequired: ['KHR_texture_basisu'],
  }
  const bin = new Uint8Array(offset)
  let o = 0
  for (const p of parts) {
    bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o)
    o += p.byteLength
  }
  return glbFrom(json, bin)
}

/** A KTX2-like texture (what the transcoder hands back). */
export function fakeKtx2(name: string): Texture {
  const t = new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4, RGBA_ASTC_4x4_Format)
  t.name = name
  return t
}

/** A manifest zone entry for a contract zone, with its zones.json rects as bounds (y 0..3, or 4.2..7.2 on level 2). */
export function manifestZone(id: string, level: 1 | 2, rect: { x0: number; x1: number; z0: number; z1: number }, extra: Record<string, unknown> = {}) {
  const y0 = level === 2 ? 4.2 : 0
  return {
    id,
    level,
    glb: `zones/${id}/${id}.glb`,
    lightmaps: ['lm_Terrazzo.ktx2', 'lm_WallPaint.ktx2'],
    bounds: { x0: rect.x0, x1: rect.x1, z0: rect.z0, z1: rect.z1, y0, y1: y0 + 3.2 },
    draws: 4,
    tris: 4,
    lightmapMB: 1,
    ...extra,
  }
}

/** What a material's program depends on (three r186 WebGLPrograms parameters that a material and its textures decide). */
export function programKey(m: Material, mesh?: Mesh): string {
  const s = m as MeshStandardMaterial
  const ch = (t: Texture | null | undefined) => (t ? `uv${t.channel}` : '-')
  return [
    m.type,
    `map:${ch(s.map)}`,
    `nor:${ch(s.normalMap)}`,
    `rough:${ch(s.roughnessMap)}`,
    `metal:${ch(s.metalnessMap)}`,
    `ao:${ch(s.aoMap)}`,
    `emi:${ch(s.emissiveMap)}`,
    `alpha:${ch(s.alphaMap)}`,
    `light:${ch(s.lightMap)}`,
    `vc:${m.vertexColors}`,
    `vcA:${m.vertexColors && mesh?.geometry.getAttribute('color')?.itemSize === 4}`,
    `tr:${m.transparent}`,
    `side:${m.side}`,
    `at:${m.alphaTest > 0}`,
    `flat:${s.flatShading}`,
    `clip:${m.clippingPlanes?.length ?? 0}`,
    `key:${m.customProgramCacheKey()}`,
    `tan:${!!mesh?.geometry.getAttribute('tangent')}`,
  ].join('|')
}

export const meshKeys = (root: Group): Map<string, string> => {
  const out = new Map<string, string>()
  root.traverse((o) => {
    const mesh = o as Mesh
    if (mesh.isMesh) out.set(mesh.name, programKey(mesh.material as Material, mesh))
  })
  return out
}

export type { GltfJson }


/**
 * An overview proxy glb shaped like tools/arch/proxy.mjs's: one node (extras `proxyScale`), one mesh, one primitive (POSITION, TEXCOORD_0),
 * one KHR_materials_unlit material whose base colour is a KHR_texture_basisu image (here an external `atlas.ktx2`, so node's loaders fake it;
 * the shipped proxies embed it).
 */
export function proxyGlb(origin: [number, number, number] = [0, 0, 0], scale = 1.5): ArrayBuffer {
  const [x, y, z] = origin
  const pos = new Float32Array([x, y, z, x + 4, y, z, x, y, z + 4])
  const uv = new Float32Array([0, 0, 1, 0, 0, 1])
  const bin = new Uint8Array(pos.byteLength + uv.byteLength)
  bin.set(new Uint8Array(pos.buffer), 0)
  bin.set(new Uint8Array(uv.buffer), pos.byteLength)
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'proxy', mesh: 0, extras: { proxyScale: scale } }],
    meshes: [{ name: 'proxy', primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ name: 'proxy', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 }, extensions: { KHR_materials_unlit: {} } }],
    textures: [{ sampler: 0, extensions: { KHR_texture_basisu: { source: 0 } } }],
    images: [{ uri: 'atlas.ktx2', mimeType: 'image/ktx2' }],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [x, y, z], max: [x + 4, y, z + 4] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: uv.byteLength },
    ],
    buffers: [{ byteLength: bin.byteLength }],
    extensionsUsed: ['KHR_texture_basisu', 'KHR_materials_unlit'],
    extensionsRequired: ['KHR_texture_basisu'],
  }
  return glbFrom(json, bin)
}
