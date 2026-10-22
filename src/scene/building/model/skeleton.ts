/**
 * Programs for zones that stream in AFTER Enter must still be compiled BEFORE it (CLAUDE.md: nothing compiles in front of the audience).
 * Their materials are not loaded yet, so the warm-up compiles PROXIES: for every zone, its glb's JSON (the first chunk, fetched with a Range
 * request, a few kB) is turned into a skeleton glb, the same nodes, meshes, extras and materials with every primitive reduced to one float
 * triangle with the same attribute names and every texture replaced by a 1 x 1 stand-in. GLTFLoader builds the skeleton's materials through
 * the very same code path as the real zone's (material clones for vertex colours, uv channels, instancing), and `prepareZoneScene` gives them
 * the same lightmap channel, baked look and clipping, so every program key a zone will ask for exists before Enter. The skeleton scene is
 * mounted hidden: the warm-up reveals and compiles it on its own geometry (and the materials are registered as well). Texture IDENTITY does
 * not enter a program key, only presence and uv channel, so the stand-ins are enough.
 */
import { DataTexture, RGBAFormat, type Group, type Material, type Texture } from 'three'
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

export type GltfJson = Record<string, unknown> & {
  asset?: unknown
  nodes?: Record<string, unknown>[]
  meshes?: { primitives?: Record<string, unknown>[]; [k: string]: unknown }[]
  accessors?: { type?: string; [k: string]: unknown }[]
  materials?: Record<string, unknown>[]
  textures?: Record<string, unknown>[]
  samplers?: unknown[]
  scenes?: unknown[]
  scene?: number
  extensionsUsed?: string[]
  extensionsRequired?: string[]
}

/** The JSON chunk of a GLB, or null when the buffer is not a GLB or does not hold the whole chunk. */
export function readGlbJson(buf: ArrayBuffer): { json: GltfJson; jsonEnd: number } | null {
  if (buf.byteLength < 20) return null
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== GLB_MAGIC) return null
  const len = dv.getUint32(12, true)
  if (dv.getUint32(16, true) !== CHUNK_JSON) return null
  if (buf.byteLength < 20 + len) return null
  const text = new TextDecoder().decode(new Uint8Array(buf, 20, len))
  return { json: JSON.parse(text) as GltfJson, jsonEnd: 20 + len }
}

/** The JSON chunk's length from a GLB's first 20 bytes, or null. */
export function glbJsonLength(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 20) return null
  const dv = new DataView(buf)
  return dv.getUint32(0, true) === GLB_MAGIC && dv.getUint32(16, true) === CHUNK_JSON ? dv.getUint32(12, true) : null
}

export type FetchBytes = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>

const FIRST_RANGE = 256 * 1024

/**
 * A zone glb's JSON. Asks for the first 256 kB; a server that ignores Range sends the whole file, which is kept (`whole`) so the zone is not
 * downloaded twice. Throws on any failure (the zone then simply has no proxies: its programs compile behind `compileAsync` when it streams).
 */
export async function fetchGlbJson(url: string, fetcher: FetchBytes = (u, i) => fetch(u, i)): Promise<{ json: GltfJson; whole: ArrayBuffer | null }> {
  const res = await fetcher(url, { headers: { Range: `bytes=0-${FIRST_RANGE - 1}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = await res.arrayBuffer()
  const whole = res.status === 200 ? buf : null
  const first = readGlbJson(buf)
  if (first) return { json: first.json, whole }
  const len = glbJsonLength(buf)
  if (len === null) throw new Error(`${url} is not a GLB`)
  const res2 = await fetcher(url, { headers: { Range: `bytes=0-${20 + len - 1}` } })
  if (!res2.ok) throw new Error(`HTTP ${res2.status} for ${url}`)
  const again = readGlbJson(await res2.arrayBuffer())
  if (!again) throw new Error(`${url}: the JSON chunk did not arrive whole`)
  return { json: again.json, whole: null }
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
/** Extensions the skeleton cannot or need not carry (its geometry is plain floats). */
const DROPPED = new Set(['EXT_meshopt_compression', 'KHR_meshopt_compression', 'KHR_mesh_quantization', 'KHR_draco_mesh_compression'])

/**
 * The skeleton GLB of a zone's JSON: nodes, meshes, materials, extras as they are; every primitive one non-indexed float triangle with the
 * same attribute names; every texture a KHR_texture_basisu image the stub plugin answers; no animations, skins or cameras.
 */
export function skeletonGlb(src: GltfJson): ArrayBuffer {
  const accessors: Record<string, unknown>[] = []
  const views: Record<string, unknown>[] = []
  const chunks: Float32Array[] = []
  let offset = 0
  const byType = new Map<string, number>()
  const stub = (type: string, count: number): number => {
    const key = `${type}:${count}`
    const known = byType.get(key)
    if (known !== undefined) return known
    const n = COMPONENTS[type] ?? 3
    const data = new Float32Array(n * count)
    if (type === 'VEC3') data.set([0, 0, 0, 1, 0, 0, 0, 0, 1].slice(0, data.length))
    if (type === 'MAT4') for (let i = 0; i < count; i++) for (const d of [0, 5, 10, 15]) data[i * 16 + d] = 1
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength })
    const acc: Record<string, unknown> = { bufferView: views.length - 1, componentType: 5126, count, type }
    if (type === 'VEC3') Object.assign(acc, { min: [0, 0, 0], max: [1, 0, 1] })
    accessors.push(acc)
    chunks.push(data)
    offset += data.byteLength
    byType.set(key, accessors.length - 1)
    return accessors.length - 1
  }
  const typeOf = (i: unknown): string => (typeof i === 'number' ? (src.accessors?.[i]?.type ?? 'VEC3') : 'VEC3')

  const meshes = (src.meshes ?? []).map((m) => ({
    ...m,
    primitives: (m.primitives ?? []).map((p) => {
      const attributes: Record<string, number> = {}
      for (const [name, acc] of Object.entries((p.attributes as Record<string, unknown>) ?? {})) attributes[name] = stub(typeOf(acc), 3)
      const out: Record<string, unknown> = { attributes, mode: 4 }
      if (p.material !== undefined) out.material = p.material
      if (p.extras !== undefined) out.extras = p.extras
      return out
    }),
  }))
  const nodes = (src.nodes ?? []).map((n) => {
    const out: Record<string, unknown> = { ...n }
    delete out.skin
    delete out.camera
    delete out.weights
    const ext = n.extensions as Record<string, { attributes?: Record<string, unknown> }> | undefined
    const inst = ext?.EXT_mesh_gpu_instancing
    if (inst?.attributes) {
      const attributes: Record<string, number> = {}
      for (const [name, acc] of Object.entries(inst.attributes)) attributes[name] = stub(typeOf(acc), 1)
      out.extensions = { ...ext, EXT_mesh_gpu_instancing: { ...inst, attributes } }
    }
    return out
  })
  const textures = (src.textures ?? []).map((t) => ({ ...(t.sampler !== undefined ? { sampler: t.sampler } : {}), extensions: { KHR_texture_basisu: { source: 0 } } }))
  const used = new Set((src.extensionsUsed ?? []).filter((e) => !DROPPED.has(e)))
  if (textures.length) used.add('KHR_texture_basisu')
  const json: GltfJson = {
    asset: { version: '2.0', generator: 'hospital zone skeleton' },
    scene: src.scene ?? 0,
    scenes: src.scenes ?? [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: src.materials ?? [],
    textures,
    images: textures.length ? [{ uri: 'stub.ktx2' }] : [],
    samplers: src.samplers ?? [],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
    extensionsUsed: [...used],
    extensionsRequired: (src.extensionsRequired ?? []).filter((e) => !DROPPED.has(e)),
  }
  if (!json.textures?.length) delete json.textures
  if (!(json.images as unknown[]).length) delete json.images
  if (!json.samplers?.length) delete json.samplers
  if (!json.extensionsUsed?.length) delete json.extensionsUsed
  if (!json.extensionsRequired?.length) delete json.extensionsRequired
  if (!accessors.length) {
    delete json.accessors
    delete json.bufferViews
    delete json.buffers
  }

  // pack: header, JSON chunk (space padded), BIN chunk (zero padded)
  const enc = new TextEncoder().encode(JSON.stringify(json))
  const jsonLen = Math.ceil(enc.length / 4) * 4
  const binLen = Math.ceil(offset / 4) * 4
  const total = 12 + 8 + jsonLen + (binLen ? 8 + binLen : 0)
  const out = new ArrayBuffer(total)
  const dv = new DataView(out)
  const bytes = new Uint8Array(out)
  dv.setUint32(0, GLB_MAGIC, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonLen, true)
  dv.setUint32(16, CHUNK_JSON, true)
  bytes.set(enc, 20)
  for (let i = 20 + enc.length; i < 20 + jsonLen; i++) bytes[i] = 0x20
  if (binLen) {
    const at = 20 + jsonLen
    dv.setUint32(at, binLen, true)
    dv.setUint32(at + 4, CHUNK_BIN, true)
    let o = at + 8
    for (const c of chunks) {
      bytes.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), o)
      o += c.byteLength
    }
  }
  return out
}

const makeStub = (name: string): Texture => {
  const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat)
  t.name = name
  t.needsUpdate = true
  return t
}

let stubTexture: Texture | null = null
let stubLightmap: Texture | null = null
/** The 1 x 1 stand-in every skeleton material texture is a clone of (never changed itself, so every clone starts on uv channel 0). */
export function skeletonStubTexture(): Texture {
  return (stubTexture ??= makeStub('zone-skeleton-stub'))
}
/** The stand-in lightmap of every skeleton (applyLightmaps puts it on channel 1: a texture of its own, or the material stubs would follow). */
export function skeletonLightmapStub(): Texture {
  return (stubLightmap ??= makeStub('zone-skeleton-lightmap'))
}

/** The GLTFLoader plugin that answers every skeleton texture with the stand-in (a clone, as GLTFLoader would hand out). */
export function skeletonTexturePlugin(): (parser: GLTFParser) => GLTFLoaderPlugin {
  return () => ({ name: 'KHR_texture_basisu', loadTexture: () => Promise.resolve(skeletonStubTexture().clone()) })
}

/** Every distinct material under a scene. */
export function materialsOf(root: Group): Material[] {
  const out = new Set<Material>()
  root.traverse((o) => {
    const m = (o as { material?: Material | Material[] }).material
    if (!m) return
    for (const x of Array.isArray(m) ? m : [m]) out.add(x)
  })
  return [...out]
}
