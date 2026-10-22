/**
 * A zone's OVERVIEW PROXY ("far model"): one mesh, one material, one texture (tools/arch/proxy.mjs), drawn instead of the zone's full model in
 * the overview and when the zone is far from the walking camera (./culling.ts decides; ./runtime.ts loads every proxy before Enter).
 *
 * The atlas holds the final shaded colour (albedo x ambient occlusion x lightmap, already lit), divided by `proxyScale` so the 8-bit sRGB
 * texels keep headroom for sunlit floors. So the material is a plain MeshBasicMaterial (unlit) whose colour is that scale: every proxy of
 * every zone and both storeys share ONE program (map on uv 0, one clipping plane, fog, tone mapping), compiled by the warm-up, and switching
 * between a zone's proxy and its full model only flips `visible`. The overview's 1.3 m cut is the same plane the full model uses (./clip.ts).
 * Pure over its loaders, so node tests it.
 */
import { FrontSide, MeshBasicMaterial, type Group, type Material, type Mesh, type Object3D, type Plane, type Texture } from 'three'
import { normalizeUrl, type ManifestZone } from './manifest'
import type { ZoneLoaders } from './zoneLoader'

export const FAR_LOAD_TIMEOUT_MS = 20000

export interface FarModel {
  id: string
  scene: Group
  mesh: Mesh
  material: MeshBasicMaterial
  /** The atlas (a proxy without one is refused at load). */
  texture: Texture
  dispose(): void
}

/** The node extras' `proxyScale` (GLTFLoader puts them on userData), else the manifest's, else 1. */
export function farScaleOf(o: Object3D, fallback: number | null): number {
  const v = (o.userData as { proxyScale?: unknown } | undefined)?.proxyScale
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  return fallback !== null && fallback > 0 ? fallback : 1
}

/**
 * Turn a loaded proxy scene into the far model: exactly one mesh with a textured material (else it throws: the zone then draws its full model
 * everywhere), its material replaced by the shared-program unlit one, the clipping plane, static matrices, no shadows, hidden until culled in.
 */
export function prepareFarScene(id: string, scene: Group, clip: Plane, scale: number | null, offset: { x: number; y: number } = { x: 0, y: 0 }): FarModel {
  const meshes: Mesh[] = []
  scene.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh)
  })
  if (meshes.length !== 1) throw new Error(`zone ${id}: the overview proxy must hold one mesh, not ${meshes.length}`)
  const mesh = meshes[0]
  const loaded = mesh.material as Material | Material[]
  if (Array.isArray(loaded)) throw new Error(`zone ${id}: the overview proxy must have one material`)
  const map = (loaded as MeshBasicMaterial).map ?? null
  if (!map) throw new Error(`zone ${id}: the overview proxy has no atlas`)
  const material = new MeshBasicMaterial({ map, side: FrontSide })
  material.name = `proxy:${id}`
  material.color.setScalar(farScaleOf(mesh, scale))
  material.clippingPlanes = [clip]
  loaded.dispose()
  mesh.material = material
  mesh.name = `building-proxy-${id}`
  scene.name = `building-zone-proxy-${id}`
  scene.userData.zone = id
  scene.position.set(offset.x, offset.y, 0)
  scene.traverse((o) => {
    o.matrixAutoUpdate = false
    o.updateMatrix()
    o.castShadow = false
    o.receiveShadow = false
  })
  mesh.geometry.computeBoundingSphere()
  mesh.geometry.computeBoundingBox()
  scene.updateMatrixWorld(true)
  scene.visible = false
  return {
    id,
    scene,
    mesh,
    material,
    texture: map,
    dispose: () => {
      mesh.geometry.dispose()
      material.dispose()
      map.dispose()
    },
  }
}

export interface LoadFarOptions {
  base: string
  clip: Plane
  timeoutMs?: number
}

/** Load a zone's overview proxy (the zone must have one). Rejects on any failure, leaking nothing. */
export async function loadFarModel(zone: ManifestZone, loaders: Pick<ZoneLoaders, 'fetch' | 'parse'>, opts: LoadFarOptions): Promise<FarModel> {
  const proxy = zone.proxy
  if (!proxy) throw new Error(`zone ${zone.id}: no overview proxy`)
  const timeoutMs = opts.timeoutMs ?? FAR_LOAD_TIMEOUT_MS
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = (async () => {
    const url = normalizeUrl(`${opts.base}assets/building/${proxy.glb}`)
    const { scene } = await loaders.parse(await loaders.fetch(url), url.slice(0, url.lastIndexOf('/') + 1))
    try {
      return prepareFarScene(zone.id, scene, opts.clip, proxy.scale, zone.mountOffset)
    } catch (e) {
      scene.traverse((o) => {
        const m = o as Partial<Mesh>
        m.geometry?.dispose()
        const mats = m.material === undefined ? [] : Array.isArray(m.material) ? m.material : [m.material]
        for (const mat of mats) {
          ;(mat as MeshBasicMaterial).map?.dispose()
          mat.dispose()
        }
      })
      throw e
    }
  })().then((m) => {
    if (timedOut) m.dispose()
    return m
  })
  work.catch(() => undefined)
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error(`zone ${zone.id}: overview proxy load timed out after ${timeoutMs} ms`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}
