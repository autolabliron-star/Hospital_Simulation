/**
 * One zone of the authored building: its glb (geometry meshopt-compressed, material textures shared: ./sharedTextures.ts) and its own baked
 * lightmaps (KTX2 beside the glb). All or nothing, as the pilot: a baked surface without its lightmap would draw black, so one missing or
 * broken lightmap fails the zone, and a failed zone keeps its procedural cell (./cells.ts). Pure over its loaders, so node tests it.
 */
import { Box3, Matrix4, type BufferAttribute, type Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type Plane, type Texture } from 'three'
import { floorFootprints, type Footprint } from '@/scene/lighting/contact/footprints'
import { registerContactSource, shownInScene, type ContactBuffer } from '@/scene/lighting/contact/registry'
import { patchMaterialLook } from '@/scene/lighting/palettePatch'
import { LEVEL_Y } from '@/sim/levels'
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

/** A kit node's contact shadow (realism step 2): its floor footprints in the node's own frame. */
export interface KitShadow {
  node: Object3D
  footprints: Footprint[]
}

/** Kit kinds with no contact shadow: door leaves swing in their frames, a backrest rides its bed (the name before `:`, e.g. `door:A1`). */
const NO_SHADOW_KIT = /^(door|leaf|backrest|blind|curtain)/i
/** A kit node gets a shadow when its lowest point is this close to its storey's floor; what lies within KIT_BAND of the floor is its footprint. */
const KIT_FLOOR_GAP = 0.2
const KIT_BAND = 0.7
/** How dark under a piece of movable kit, and its penumbra (the bake's own contact shadows under the furniture, by eye of the lightmaps). */
export const KIT_SHADOW = { darkness: 0.45, pen: 0.3, radius: 0.08 } as const

/**
 * (Realism step 2) The live look for a kit node's material: a clone with no lightmap (the bake is only right where the kit stood when it was
 * baked) and the light-volume patch, which carries the bake field: the kit is lit by the zone's probe SH, like the people next to it. One clone
 * per source material (`cache`); not a MeshStandardMaterial: left as it is.
 */
function liveKitMaterial(m: Material, cache: Map<Material, Material>): Material {
  const hit = cache.get(m)
  if (hit) return hit
  if (!(m as MeshStandardMaterial).isMeshStandardMaterial) {
    cache.set(m, m)
    return m
  }
  const std = (m as MeshStandardMaterial).clone()
  std.lightMap = null
  patchMaterialLook(std, 'plain')
  cache.set(m, std)
  return std
}

const kitInv = new Matrix4()
const kitRel = new Matrix4()

/** The footprints of a kit node in its own frame, or null when it does not stand on its storey's floor (or is a kind with none). */
function kitFootprints(node: Object3D): Footprint[] | null {
  if (NO_SHADOW_KIT.test(node.name)) return null
  kitInv.copy(node.matrixWorld).invert()
  // every triangle of the node's meshes, in the node's frame (one list: a bed's frame and its castors are one piece)
  const tri: number[] = []
  let minY = Infinity
  node.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const pos = mesh.geometry.attributes.position as BufferAttribute | undefined
    if (!pos) return
    kitRel.multiplyMatrices(kitInv, mesh.matrixWorld)
    const e = kitRel.elements
    const w = mesh.matrixWorld.elements
    const index = mesh.geometry.index
    const n = index ? index.count : pos.count
    for (let i = 0; i < n; i++) {
      const v = index ? index.getX(i) : i
      const x = pos.getX(v)
      const y = pos.getY(v)
      const z = pos.getZ(v)
      tri.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14])
      minY = Math.min(minY, w[1] * x + w[5] * y + w[9] * z + w[13])
    }
  })
  if (tri.length < 9) return null
  const floor = minY > LEVEL_Y[2] - 1 ? LEVEL_Y[2] : LEVEL_Y[1]
  if (minY - floor > KIT_FLOOR_GAP) return null
  const ne = node.matrixWorld.elements
  const fps = floorFootprints(tri, null, null, { band: KIT_BAND, floorY: floor - ne[13], cell: 0.1, max: 6 })
  return fps.length ? fps : null
}

/** Write the kit's shadows (allocation-free; the zone's scene must be drawn). */
export function writeKitShadows(scene: Object3D, kit: readonly KitShadow[], buf: ContactBuffer): void {
  if (!shownInScene(scene)) return
  for (let i = 0; i < kit.length; i++) {
    const k = kit[i]
    if (!k.node.visible) continue
    const e = k.node.matrixWorld.elements
    const heading = Math.atan2(e[8], e[10])
    for (let j = 0; j < k.footprints.length; j++) {
      const f = k.footprints[j]
      buf.add(
        e[0] * f.cx + e[8] * f.cz + e[12],
        e[1] * f.cx + e[5] * f.y + e[9] * f.cz + e[13],
        e[2] * f.cx + e[10] * f.cz + e[14],
        heading,
        f.halfX,
        f.halfZ,
        Math.min(KIT_SHADOW.radius, f.halfX, f.halfZ),
        KIT_SHADOW.pen,
        KIT_SHADOW.darkness,
      )
    }
  }
}

/** Is `o` a kit node, or under one? (A kit node is `extras.kitNode`: beds, backrests, doors another layer moves.) */
function underKit(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if ((p.userData as { kitNode?: unknown }).kitNode) return true
  return false
}

/**
 * What every authored scene gets once loaded (the zones, their skeletons, the pilot): lightmaps on channel 1 and the baked look, the clipping
 * plane (set before the warm-up compiles, so moving it later recompiles nothing), static matrices, no shadows (the light is baked).
 * `resolve` returns the texture of a lightmap file (null: missing). Returns the materials, the lightmaps used, and the files that were missing.
 *
 * (Realism step 2) The movable kit (`extras.kitNode` and everything under it) is NOT baked-looked: it would carry its rest pose's light wherever
 * it goes. Its materials are live clones lit by the bake field like the people (`liveKitMaterial`), and each kit node that stands on the floor
 * gets contact-shadow footprints (`kit`; loadZone registers them with the contact-shadow layer).
 */
export function prepareZoneScene(
  scene: Group,
  resolve: (file: string) => Texture | null,
  clip: Plane,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): { materials: Material[]; lightmaps: Texture[]; missing: string[]; meshes: Mesh[]; kit: KitShadow[] } {
  // kit nodes (`extras.kitNode`: beds, backrests, doors a later wave moves) keep live matrices, with everything under them; the rest is static
  const live = new Set<Object3D>()
  const kitNodes: Object3D[] = []
  scene.traverse((o) => {
    if ((o.userData as { kitNode?: unknown }).kitNode) {
      kitNodes.push(o)
      o.traverse((c) => live.add(c))
    }
  })
  const kitCache = new Map<Material, Material>()
  for (const o of live) {
    const mesh = o as Mesh
    if (!mesh.isMesh) continue
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => liveKitMaterial(m, kitCache)) : liveKitMaterial(mesh.material, kitCache)
  }
  const result = applyLightmaps(scene, resolve, (o) => live.has(o))
  for (const m of result.materials) m.clippingPlanes = [clip]
  scene.position.set(offset.x, offset.y, 0)
  const meshes: Mesh[] = []
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
  const kit: KitShadow[] = []
  for (const node of kitNodes) {
    // a kit node inside another kit node is drawn with its parent's shadow
    if (node.parent && underKit(node.parent)) continue
    const footprints = kitFootprints(node)
    if (footprints) kit.push({ node, footprints })
  }
  return { materials: result.materials, lightmaps: result.textures, missing: result.missing, meshes, kit }
}

/** Bytes of a geometry's attributes and index. */
export function geometryBytes(mesh: Mesh): number {
  const g = mesh.geometry
  let n = g.index ? g.index.array.byteLength : 0
  for (const a of Object.values(g.attributes)) n += (a as { array: ArrayLike<number> & { byteLength: number } }).array.byteLength
  return n
}

/** The distinct lightmap files the scene's nodes name (the movable kit's are not used: it is lit live). */
export function lightmapFiles(scene: Group): string[] {
  const files = new Set<string>()
  scene.traverse((o) => {
    const f = lightmapNameOf(o)
    if (f && !underKit(o)) files.add(f)
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
  // realism step 2: the movable kit's soft contact shadows, drawn while this zone is (the layer in src/scene/lighting/contact)
  const kit = prep.kit
  const unregisterKit = kit.length > 0 ? registerContactSource({ name: `zone-kit:${zone.id}`, write: (buf) => writeKitShadows(scene, kit, buf) }) : null
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
      unregisterKit?.()
      disposeGeometry()
      for (const m of prep.materials) m.dispose()
      for (const t of prep.lightmaps) t.dispose()
    },
  }
}
