/**
 * The authored building, zone by zone (public/assets/building/manifest.json; ./runtime.ts says what loads when). Mounted by
 * src/scene/building/index.tsx when the source is `zones`. One group (`building-zones`) holds every mounted zone; one frame callback, after the
 * camera has moved, sets the clip planes, culls the zones (./culling.ts) and, while a zone streams, takes one upload step. Navigation,
 * collision and picking stay with src/sim/places.ts; the materials are the model's own (baked lightmaps, never patchMaterialLook).
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Camera, Group, WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { probeEnabled } from '@/app/DevProbe'
import { sim } from '@/sim'
import { levelView } from '@/scene/levels/levelView'
import { registerWarmGate, registerWarmSource } from '@/scene/warmup/registry'
import { useWarmup } from '@/scene/warmup/warmup.store'
import { BUILDING_VISIBILITY_PRIORITY } from '../render/levelVisibility'
import { isWalkMode } from '../render/walk/modeSwitch'
import { updateModelClips } from './clip'
import { frustumOf } from './culling'
import type { BuildingManifest } from './manifest'
import { invalidateShadows } from '@/scene/Lighting'
import { ZoneRuntime, priorityZones, subscribeZoneCommits, zoneCommits } from './runtime'
import { SharedTextures } from './sharedTextures'
import { fetchGlbJson, skeletonTexturePlugin } from './skeleton'
import { notifyBuildingCommitted } from './source'

/** Where you start when the player is not in the sim yet: the entrance plaza (the walk spawn), so the lobby and its neighbours load first. */
const SPAWN = { x: -66, z: 0 }

/** Transcoder workers for the zones (the Quest has few cores to spare). */
const KTX2_WORKERS = 2
const MESHOPT_WORKERS = 2

function makeRuntime(gl: WebGLRenderer, base: string, manifest: BuildingManifest): ZoneRuntime {
  const makeKtx2 = (): KTX2Loader => {
    const k = new KTX2Loader()
    k.setTranscoderPath(`${base}basis/`)
    k.setWorkerLimit(KTX2_WORKERS)
    k.detectSupport(gl)
    return k
  }
  let ktx2: KTX2Loader | null = makeKtx2()
  const transcoder = (): KTX2Loader => (ktx2 ??= makeKtx2())
  const shared = new SharedTextures({ loadAsync: (url) => transcoder().loadAsync(url) })
  if (typeof Worker !== 'undefined') MeshoptDecoder.useWorkers(MESHOPT_WORKERS) // decode off the main thread while you walk
  const gltf = new GLTFLoader()
  gltf.setMeshoptDecoder(MeshoptDecoder)
  gltf.setKTX2Loader(transcoder())
  gltf.register(shared.plugin())
  const skeleton = new GLTFLoader()
  skeleton.register(skeletonTexturePlugin())
  gl.localClippingEnabled = true // the overview's cut (./clip.ts), on before the warm-up compiles
  return new ZoneRuntime({
    base,
    manifest,
    shared,
    loaders: {
      parse: (buffer, path) => gltf.parseAsync(buffer, path) as Promise<{ scene: Group }>,
      fetch: async (url) => {
        const r = await fetch(url)
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
        return r.arrayBuffer()
      },
      lightmap: (url) => transcoder().loadAsync(url),
    },
    fetchJson: (url) => fetchGlbJson(url),
    parseSkeleton: (buffer) => skeleton.parseAsync(buffer, '') as Promise<{ scene: Group }>,
    onIdle: () => {
      // everything has loaded: free the transcoder's worker pool (a later load would make a new one)
      ktx2?.dispose()
      ktx2 = null
    },
  })
}

/**
 * One runtime per page (the building is static across Jumps), shared by a remount: React's StrictMode runs the effects twice, and a release
 * followed at once by an acquire must not throw the loaded zones away.
 */
let live: { runtime: ZoneRuntime; gl: WebGLRenderer; manifest: BuildingManifest; users: number } | null = null

function runtimeFor(gl: WebGLRenderer, manifest: BuildingManifest): ZoneRuntime {
  if (live && (live.gl !== gl || live.manifest !== manifest || live.runtime.disposedAlready)) live = null
  live ??= { runtime: makeRuntime(gl, import.meta.env.BASE_URL, manifest), gl, manifest, users: 0 }
  return live.runtime
}

function releaseRuntime(runtime: ZoneRuntime): void {
  if (!live || live.runtime !== runtime) return
  live.users--
  setTimeout(() => {
    if (live && live.runtime === runtime && live.users <= 0) {
      runtime.dispose()
      live = null
    }
  }, 0)
}

export function ZonesModel({ manifest }: { manifest: BuildingManifest }) {
  const gl = useThree((s) => s.gl)
  const runtime = useMemo(() => runtimeFor(gl, manifest), [gl, manifest])
  // a zone swapped in: its procedural furniture is hidden, so the baked sun shadow is redone once (an effect, never frame code)
  const committed = useSyncExternalStore(subscribeZoneCommits, zoneCommits)
  useEffect(() => {
    if (committed > 0) invalidateShadows()
  }, [committed])

  useEffect(() => {
    if (live?.runtime === runtime) live.users++
    const offSource = registerWarmSource({ name: 'building-zones', materials: () => runtime.warmMaterials(), textures: () => runtime.warmTextures() })
    const p = sim.player
    const start = p ? { x: p.x, z: p.z } : SPAWN
    const work = runtime.preload(priorityZones(manifest, start.x, start.z))
    const offGate = registerWarmGate('building-zones', work)
    notifyBuildingCommitted()
    // after Enter the rest streams in
    const go = (): void => {
      if (useWarmup.getState().entered) void work.then(() => runtime.startStreaming())
    }
    go()
    const offWarm = useWarmup.subscribe(go)
    // ?probe=1: which zones draw their full model and which their overview proxy this frame (the draw-call checks)
    const w = window as unknown as { __hospitalZones?: unknown }
    if (probeEnabled)
      w.__hospitalZones = {
        drawn: () => runtime.drawnCounts(),
        zones: () => runtime.slots.map((s) => ({ id: s.zone.id, state: s.state, proxy: s.far !== null, full: s.entry.drawFull, far: s.entry.drawFar })),
      }
    return () => {
      if (probeEnabled) delete w.__hospitalZones
      offWarm()
      offGate()
      offSource()
      releaseRuntime(runtime)
    }
  }, [runtime, manifest])

  useFrame((state) => {
    updateModelClips(isWalkMode(sim.player?.mode))
    const xr = state.gl.xr
    const cam: Camera = xr.isPresenting ? xr.getCamera() : state.camera
    if (!xr.isPresenting) cam.updateMatrixWorld()
    const e = cam.matrixWorld.elements
    runtime.setView(isWalkMode(sim.player?.mode), levelView.shown, levelView.overview, e[12], e[13], e[14])
    runtime.cull(frustumOf(cam))
    runtime.uploadStep(state.gl, state.scene, state.camera)
  }, BUILDING_VISIBILITY_PRIORITY)

  return <primitive object={runtime.root} />
}
