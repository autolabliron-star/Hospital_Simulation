/**
 * Loads the authored pilot model: GLTFLoader + MeshoptDecoder + KTX2Loader, everything served from public/ (the basis transcoder in
 * public/basis, copied by `npm run copy-basis`; no CDN, no runtime downloads from other hosts). Lightmaps named in the nodes' extras are loaded
 * from beside the .glb. The result is registered with the warm-up (materials, textures, and a gate while loading).
 */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { Group, Material, Texture, WebGLRenderer } from 'three'
import { registerWarmGate, registerWarmSource } from '@/scene/warmup/registry'
import { MODEL_CLIP } from './clip'
import { applyLightmaps, lightmapNameOf } from './lightmaps'
import { markModelFailed, setModelStatus } from './modelStatus'

export const PILOT_MODEL_FILE = 'assets/building/pilot-lobby.glb'

/** The whole load (glb, meshopt, every lightmap transcoded) must finish within this, or the procedural building is used. */
export const MODEL_LOAD_TIMEOUT_MS = 20000

/** The two loaders `loadPilotModel` needs, as a seam: tests pass fakes, the page passes `makeLoaders`. */
export interface PilotLoaders {
  gltf: { loadAsync(url: string): Promise<{ scene: Group }> }
  ktx2: { loadAsync(url: string): Promise<Texture>; dispose(): void }
}

export interface LoadOptions {
  loaders?: PilotLoaders
  timeoutMs?: number
}

export interface PilotModel {
  scene: Group
  materials: Material[]
  textures: Texture[]
  dispose: () => void
}

/** The loaders for a renderer. The KTX2 transcoder path is under the site base. */
export function makeLoaders(renderer: WebGLRenderer, base: string): { gltf: GLTFLoader; ktx2: KTX2Loader } {
  const ktx2 = new KTX2Loader()
  ktx2.setTranscoderPath(`${base}basis/`)
  ktx2.detectSupport(renderer)
  const gltf = new GLTFLoader()
  gltf.setMeshoptDecoder(MeshoptDecoder)
  gltf.setKTX2Loader(ktx2)
  return { gltf, ktx2 }
}

export async function loadPilotModel(renderer: WebGLRenderer, base: string, opts: LoadOptions = {}): Promise<PilotModel> {
  const timeoutMs = opts.timeoutMs ?? MODEL_LOAD_TIMEOUT_MS
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = loadPilotModelNow(renderer, base, opts).then((m) => {
    if (timedOut) m.dispose() // too late: the procedural building is already back
    return m
  })
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error(`pilot model load timed out after ${timeoutMs} ms`))
    }, timeoutMs)
  })
  work.catch(() => undefined) // a failure after the deadline has already been reported by the deadline
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function loadPilotModelNow(renderer: WebGLRenderer, base: string, opts: LoadOptions): Promise<PilotModel> {
  const { gltf, ktx2 } = opts.loaders ?? makeLoaders(renderer, base)
  const url = `${base}${PILOT_MODEL_FILE}`
  const dir = url.slice(0, url.lastIndexOf('/') + 1)
  try {
    const data = await gltf.loadAsync(url)
    const scene = data.scene
    let meshes = 0
    const files = new Set<string>()
    scene.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++
      const f = lightmapNameOf(o)
      if (f) files.add(f)
    })
    if (meshes === 0) throw new Error('the pilot model holds no meshes')
    // every lightmap is needed: a baked surface is albedo x lightmap only, so a missing one would draw black. One failure fails the model.
    const names = [...files]
    const settled = await Promise.allSettled(names.map((f) => ktx2.loadAsync(dir + f)))
    const loaded = new Map<string, Texture>()
    const failed: string[] = []
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') loaded.set(names[i], r.value)
      else failed.push(`${names[i]} (${r.reason instanceof Error ? r.reason.message : String(r.reason)})`)
    })
    if (failed.length) {
      for (const t of loaded.values()) t.dispose()
      throw new Error(`lightmaps failed to load: ${failed.join(', ')}`)
    }
    const result = applyLightmaps(scene, (f) => loaded.get(f) ?? null)
    if (result.missing.length) throw new Error(`missing lightmaps: ${result.missing.join(', ')}`)
    const textures = new Set<Texture>(result.textures)
    for (const m of result.materials) for (const v of Object.values(m)) if (v && (v as Texture).isTexture) textures.add(v as Texture)
    scene.name = 'building-model'
    // the overview's cut (./clip.ts): set before the warm-up compiles, so moving the plane later recompiles nothing
    renderer.localClippingEnabled = true
    for (const m of result.materials) m.clippingPlanes = [MODEL_CLIP]
    scene.traverse((o) => {
      o.matrixAutoUpdate = false
      o.updateMatrix()
      o.castShadow = false // the baked sun shadow is for the cut-height procedural building; the baked light is in the lightmaps
      o.receiveShadow = false
    })
    return {
      scene,
      materials: result.materials,
      textures: [...textures],
      dispose: () => {
        scene.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose())
        for (const m of result.materials) m.dispose()
        for (const t of textures) t.dispose()
      },
    }
  } finally {
    ktx2.dispose() // the worker pool is not needed once everything is transcoded (or once the load has failed)
  }
}

let started: Promise<PilotModel | null> | null = null
let committed: Promise<void> | null = null
let resolveCommitted: (() => void) | null = null

/**
 * F-46: the warm-up gate must stay closed until React has COMMITTED the model into the scene, or the model's programs compile on the first
 * lobby frame instead of behind the loading screen. `BuildingModel` calls this from an effect after it mounted the model (or learned there is none).
 */
export function notifyModelCommitted(): void {
  resolveCommitted?.()
}

/**
 * Start the load once and hold the warm-up until the model is loaded AND mounted. Any failure (no .glb, a corrupt or missing lightmap, a KTX2
 * transcode error, a timeout) resolves null with ONE console warning and re-opens the procedural region (./modelStatus.ts), so the lobby never
 * loses its walls.
 */
export function ensurePilotModel(renderer: WebGLRenderer, base: string, opts: LoadOptions = {}): Promise<PilotModel | null> {
  if (started) return started
  setModelStatus('loading')
  started = loadPilotModel(renderer, base, opts).then(
    (m) => {
      registerWarmSource({ name: 'building-model', materials: () => m.materials, textures: () => m.textures })
      setModelStatus('ready')
      return m
    },
    (e) => {
      console.warn('pilot model failed to load; the procedural lobby is used instead', e)
      markModelFailed()
      return null
    },
  )
  committed = new Promise<void>((r) => {
    resolveCommitted = r
  })
  // the gate also has its own limit in the warm-up; a model that never mounts must not hold the presenter out
  registerWarmGate('building-model', started.then(() => committed))
  return started
}

/** For tests. */
export function resetPilotModelForTests(): void {
  started = null
  committed = null
  resolveCommitted = null
}
