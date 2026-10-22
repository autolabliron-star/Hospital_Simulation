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

export const PILOT_MODEL_FILE = 'assets/building/pilot-lobby.glb'

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

export async function loadPilotModel(renderer: WebGLRenderer, base: string): Promise<PilotModel> {
  const { gltf, ktx2 } = makeLoaders(renderer, base)
  const url = `${base}${PILOT_MODEL_FILE}`
  const dir = url.slice(0, url.lastIndexOf('/') + 1)
  const data = await gltf.loadAsync(url)
  const scene = data.scene
  const files = new Set<string>()
  scene.traverse((o) => {
    const f = lightmapNameOf(o)
    if (f) files.add(f)
  })
  const loaded = new Map<string, Texture>()
  await Promise.all([...files].map(async (f) => loaded.set(f, await ktx2.loadAsync(dir + f))))
  const result = applyLightmaps(scene, (f) => loaded.get(f) ?? null)
  if (result.missing.length) console.warn('pilot model: missing lightmaps', result.missing)
  ktx2.dispose() // the worker pool is not needed once everything is transcoded
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
}

let started: Promise<PilotModel | null> | null = null

/** Start the load once and hold the warm-up until it is done. A failed load (no .glb yet) resolves null: the procedural building has been hidden, so say so. */
export function ensurePilotModel(renderer: WebGLRenderer, base: string): Promise<PilotModel | null> {
  if (started) return started
  started = loadPilotModel(renderer, base).then(
    (m) => {
      registerWarmSource({ name: 'building-model', materials: () => m.materials, textures: () => m.textures })
      return m
    },
    (e) => {
      console.warn('pilot model failed to load; the pilot region stays empty', e)
      return null
    },
  )
  registerWarmGate('building-model', started)
  return started
}
