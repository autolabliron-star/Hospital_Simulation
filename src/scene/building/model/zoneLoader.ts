/**
 * One zone of the authored building: its glb (geometry meshopt-compressed, material textures shared: ./sharedTextures.ts) and its own baked
 * lightmaps (KTX2 beside the glb). All or nothing, as the pilot: a baked surface without its lightmap would draw black, so one missing or
 * broken lightmap fails the zone, and a failed zone keeps its procedural cell (./cells.ts). Pure over its loaders, so node tests it.
 */
import { Box3, type Group, type Material, type Mesh, type Object3D, type Plane, type Texture } from 'three'
import { applyLightmaps, lightmapNameOf } from './lightmaps'
import { lightmapUrl, normalizeUrl, type ManifestZone } from './manifest'

/** One zone's whole load (glb, meshopt, every lightmap transcoded) must finish within this, or the zone keeps its procedural cell. */
export const ZONE_LOAD_TIMEOUT_MS = 30000

export interface ZoneLoaders {
  /** Parse a glb already in memory (`path` is the glb's directory URL, for its external images). */
  parse(buffer: ArrayBuffer, path: string): Promise<{ scene: Group }>
  /** Fetch a glb's bytes. */
  fetch(url: string): Promise<ArrayBuffer>
  /** A zone's own lightmap (never shared: every zone bakes its own). */
  lightmap(url: string): Promise<Texture>
}

export interface ZoneModel {
  id: string
  scene: Group
  /** The zone's kit nodes by name (`extras.kitNode`, e.g. `bed:A1`): movable parts another layer may drive. */
  nodes: Map<string, Object3D>
  meshes: Mesh[]
  materials: Material[]
  /** The zone's own lightmaps (the shared material textures belong to SharedTextures). */
  lightmaps: Texture[]
  /** World box of what was loaded (for the log; culling uses the manifest's bounds). */
  box: Box3
  /** Bytes of vertex and index data (the upload budget). */
  bytes: number
  dispose(): void
}

/**
 * What every authored scene gets once loaded (the zones, their skeletons, the pilot): lightmaps on channel 1 and the baked look, the clipping
 * plane (set before the warm-up compiles, so moving it later recompiles nothing), static matrices, no shadows (the light is baked).
 * `resolve` returns the texture of a lightmap file (null: missing). Returns the materials, the lightmaps used, and the files that were missing.
 */
export function prepareZoneScene(
  scene: Group,
  resolve: (file: string) => Texture | null,
  clip: Plane,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): { materials: Material[]; lightmaps: Texture[]; missing: string[]; meshes: Mesh[] } {
  const result = applyLightmaps(scene, resolve)
  for (const m of result.materials) m.clippingPlanes = [clip]
  scene.position.set(offset.x, offset.y, 0)
  const meshes: Mesh[] = []
  // kit nodes (`extras.kitNode`: beds, backrests, doors a later wave moves) keep live matrices, with everything under them; the rest is static
  const live = new Set<Object3D>()
  scene.traverse((o) => {
    if ((o.userData as { kitNode?: unknown }).kitNode) o.traverse((c) => live.add(c))
  })
  scene.traverse((o) => {
    o.matrixAutoUpdate = live.has(o)
    o.updateMatrix()
    o.castShadow = false
    o.receiveShadow = false
    const mesh = o as Mesh
    if (mesh.isMesh) {
      meshes.push(mesh)
      mesh.geometry.computeBoundingSphere() // now, not on the first frame it is culled
      mesh.geometry.computeBoundingBox()
    }
  })
  scene.updateMatrixWorld(true)
  return { materials: result.materials, lightmaps: result.textures, missing: result.missing, meshes }
}

/** Bytes of a geometry's attributes and index. */
export function geometryBytes(mesh: Mesh): number {
  const g = mesh.geometry
  let n = g.index ? g.index.array.byteLength : 0
  for (const a of Object.values(g.attributes)) n += (a as { array: ArrayLike<number> & { byteLength: number } }).array.byteLength
  return n
}

/** The distinct lightmap files the scene's nodes name. */
export function lightmapFiles(scene: Group): string[] {
  const files = new Set<string>()
  scene.traverse((o) => {
    const f = lightmapNameOf(o)
    if (f) files.add(f)
  })
  return [...files]
}

export interface LoadZoneOptions {
  base: string
  clip: Plane
  /** The glb's bytes if they are already here (a server that ignored the Range request for the proxies sent the whole file). */
  prefetched?: ArrayBuffer | null
  timeoutMs?: number
}

/** Load and prepare one zone. Rejects on any failure; nothing leaks (the parsed scene and the loaded lightmaps are disposed). */
export async function loadZone(zone: ManifestZone, loaders: ZoneLoaders, opts: LoadZoneOptions): Promise<ZoneModel> {
  const timeoutMs = opts.timeoutMs ?? ZONE_LOAD_TIMEOUT_MS
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = loadZoneNow(zone, loaders, opts).then((m) => {
    if (timedOut) m.dispose()
    return m
  })
  work.catch(() => undefined)
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error(`zone ${zone.id}: load timed out after ${timeoutMs} ms`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function loadZoneNow(zone: ManifestZone, loaders: ZoneLoaders, opts: LoadZoneOptions): Promise<ZoneModel> {
  const url = normalizeUrl(`${opts.base}assets/building/${zone.glb}`)
  const dir = url.slice(0, url.lastIndexOf('/') + 1)
  const bytes = opts.prefetched ?? (await loaders.fetch(url))
  const { scene } = await loaders.parse(bytes, dir)
  const disposeGeometry = (): void => scene.traverse((o) => (o as Partial<Mesh>).geometry?.dispose())
  let meshCount = 0
  scene.traverse((o) => {
    if ((o as Partial<Mesh>).isMesh) meshCount++
  })
  if (meshCount === 0) {
    disposeGeometry()
    throw new Error(`zone ${zone.id}: the glb holds no meshes`)
  }
  const files = lightmapFiles(scene)
  const settled = await Promise.allSettled(files.map((f) => loaders.lightmap(lightmapUrl(opts.base, zone, f))))
  const loaded = new Map<string, Texture>()
  const failed: string[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') loaded.set(files[i], r.value)
    else failed.push(`${files[i]} (${r.reason instanceof Error ? r.reason.message : String(r.reason)})`)
  })
  if (failed.length) {
    for (const t of loaded.values()) t.dispose()
    disposeGeometry()
    throw new Error(`zone ${zone.id}: lightmaps failed to load: ${failed.join(', ')}`)
  }
  const prep = prepareZoneScene(scene, (f) => loaded.get(f) ?? null, opts.clip, zone.mountOffset)
  if (prep.missing.length) {
    for (const t of loaded.values()) t.dispose()
    disposeGeometry()
    throw new Error(`zone ${zone.id}: missing lightmaps: ${prep.missing.join(', ')}`)
  }
  scene.name = `building-zone-${zone.id}`
  scene.userData.zone = zone.id
  let total = 0
  for (const m of prep.meshes) total += geometryBytes(m)
  const box = new Box3().setFromObject(scene)
  const nodes = new Map<string, Object3D>()
  scene.traverse((o) => {
    if ((o.userData as { kitNode?: unknown }).kitNode && o.name) nodes.set(o.name, o)
  })
  return {
    id: zone.id,
    scene,
    nodes,
    meshes: prep.meshes,
    materials: prep.materials,
    lightmaps: prep.lightmaps,
    box,
    bytes: total,
    dispose: () => {
      disposeGeometry()
      for (const m of prep.materials) m.dispose()
      for (const t of prep.lightmaps) t.dispose()
    },
  }
}
