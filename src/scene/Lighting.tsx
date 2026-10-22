/**
 * Light for the architect's-model look, kept cheap enough that the demo never stutters:
 *   - three's built-in RoomEnvironment as the reflection/ambient environment (no HDRI download), and (W3) a second environment built the
 *     same way from the hospital's own things (src/scene/lighting/env): both rendered once into a 256 PMREM at mount, so the lit programs
 *     are the same either way; the daylight driver says which is bound (the hospital's while walking, `liveLook.hospitalEnv`) and this
 *     component swaps `scene.environment` between frames, no allocation, no recompile;
 *   - (presentation) with `?building=model`, a third environment: the lobby's baked HDR (src/scene/lighting/env/lobbyProbe.ts), PMREM'd once behind a
 *     warm gate and bound while the camera is in the pilot region (`liveLook.lobbyEnv`); a missing file changes nothing;
 *   - (W3) the light volume's bake starts here, behind the loading screen (a warm gate, src/scene/lighting/volume/texture.ts), and the
 *     textures of the realistic light are registered with the warm-up so they upload before the Enter button;
 *   - after a lost and restored WebGL context (a GPU reset, a display plugged in) the environments and the shadow map are rebuilt (F-44, glContext.ts);
 *   - a soft sky/ground hemisphere fill;
 *   - one sun whose shadow map is rendered ONCE for the static building (autoUpdate off), and again only
 *     when a layer calls `invalidateShadows()` (e.g. after it finished building its meshes). Moving things
 *     (pods, people) do not cast into it; they get soft blob shadows instead.
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { type DirectionalLight, type HemisphereLight, Object3D, PMREMGenerator, type Texture } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { watchContextRestore } from '@/scene/glContext'
import { LIGHT_NOON } from '@/scene/daylight/lightAt'
import { createCeilingTexture } from '@/scene/lighting/ceilingMap'
import { buildHospitalEnvironment, disposeEnvironment } from '@/scene/lighting/env/hospitalEnvironment'
import { loadLobbyEnvironment, lobbyProbe } from '@/scene/lighting/env/lobbyProbe'
import { createGradeLut } from '@/scene/lighting/grade'
import { liveLook } from '@/scene/lighting/liveLook'
import { ensureLightVolume } from '@/scene/lighting/volume/texture'
import { volumeTexture } from '@/scene/lighting/volume/uniforms'
import { BUILDING_MODEL_ON } from '@/scene/building/model/flags'
import { registerWarmGate, registerWarmSource } from '@/scene/warmup/registry'
import { BUILDING } from '@/sim/places'

/** Sun direction (high, from the south-south-east), and the shadow box around the whole building. */
const SUN = { x: 22, y: 72, z: 50 }
/**
 * The shadow box is in light space, where the footprint is rotated (azimuth ~24°) and its depth foreshortened
 * (elevation ~51°): the 126 × 64 m plinth (canopy, ambulance bay, trees) becomes about 135 × 90 m. Half extents with a margin.
 */
const HALF_W = 72
const HALF_D = 48
const CX = (BUILDING.x0 + BUILDING.x1) / 2
const CZ = (BUILDING.z0 + BUILDING.z1) / 2

let requestShadow: (() => void) | null = null

/**
 * The lights the daylight driver (src/scene/daylight) changes through, set while <Lighting /> is mounted. The driver only ever writes
 * `intensity` and `color` (and the scene's environment intensity and background colour): never a position or a shadow property,
 * so the sun direction stays fixed and the baked shadow map stays valid (a test in src/scene/daylight guards this).
 */
export const lightRig: { sun: DirectionalLight | null; hemi: HemisphereLight | null } = { sun: null, hemi: null }

/** Ask for the static shadow map to be re-rendered on the next frames (call after building static meshes). */
export function invalidateShadows(): void {
  requestShadow?.()
}

const setSun = (l: DirectionalLight | null): void => {
  lightRig.sun = l
}
const setHemi = (l: HemisphereLight | null): void => {
  lightRig.hemi = l
}

export function Lighting() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  // the sun's target must live in the scene so its world matrix (and so the shadow box) follows it
  const [target] = useState(() => new Object3D())
  // the environments, once built (the overview's RoomEnvironment, the hospital's, and with ?building=model the lobby's baked probe)
  const envs = useRef<{ room: Texture | null; hospital: Texture | null; lobby: Texture | null }>({ room: null, hospital: null, lobby: null })
  // F-44: counts the WebGL context restores. A restored context has lost the environments (they only lived on the GPU), so the effects below
  // that build them depend on it and run again; the static shadow map is asked for afresh too.
  const [restores, setRestores] = useState(0)
  useEffect(
    () =>
      watchContextRestore(gl.domElement, () => {
        setRestores((n) => n + 1)
        requestShadow?.()
      }),
    [gl],
  )

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const room = pmrem.fromScene(new RoomEnvironment(), 0.04)
    const hospitalScene = buildHospitalEnvironment()
    const hospital = pmrem.fromScene(hospitalScene, 0.04)
    disposeEnvironment(hospitalScene)
    pmrem.dispose()
    envs.current = { room: room.texture, hospital: hospital.texture, lobby: envs.current.lobby }
    scene.environment = liveLook.hospitalEnv ? hospital.texture : room.texture
    scene.environmentIntensity = LIGHT_NOON.envIntensity
    return () => {
      envs.current = { room: null, hospital: null, lobby: envs.current.lobby }
      scene.environment = null
      room.dispose()
      hospital.dispose()
    }
  }, [gl, scene, restores])

  // the lobby's reflection probe (?building=model): loaded and PMREM'd behind the loading screen; nothing happens if the file is not there
  useEffect(() => {
    if (!BUILDING_MODEL_ON) return
    let alive = true
    let target: { texture: Texture; dispose(): void } | null = null
    const work = loadLobbyEnvironment(gl, import.meta.env.BASE_URL).then((t) => {
      if (!t) return
      if (!alive) {
        t.dispose()
        return
      }
      target = t
      envs.current.lobby = t.texture
      lobbyProbe.ready = true
    })
    const unregister = registerWarmGate('lobby-env', work)
    return () => {
      alive = false
      unregister()
      lobbyProbe.ready = false
      envs.current.lobby = null
      target?.dispose()
    }
  }, [gl, restores])

  // the realistic light's textures upload behind the loading screen, and the light volume bakes there too (a warm gate: the warm-up waits)
  useEffect(() => {
    void ensureLightVolume()
    return registerWarmSource({
      name: 'lighting',
      textures: () => {
        const list: Texture[] = [volumeTexture, createCeilingTexture(), createGradeLut()]
        if (envs.current.room) list.push(envs.current.room)
        if (envs.current.hospital) list.push(envs.current.hospital)
        if (envs.current.lobby) list.push(envs.current.lobby)
        return list
      },
    })
  }, [])

  // swap the bound environment when the daylight driver says so (the walk look's, past half way through the Tab flight); the driver already wrote
  // the intensity for the environment it chose, in its own frame callback just before this one
  useFrame(() => {
    const e = envs.current
    const want = liveLook.lobbyEnv && e.lobby ? e.lobby : liveLook.hospitalEnv ? e.hospital : e.room
    if (want && scene.environment !== want) scene.environment = want
  }, FRAME_PRIORITY.sim + 3)

  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    let frames = 0
    let raf = 0
    // re-render the shadow map for a few frames so meshes mounted a little later are caught too
    const pump = () => {
      gl.shadowMap.needsUpdate = true
      if (++frames < 4) raf = requestAnimationFrame(pump)
    }
    requestShadow = () => {
      frames = 0
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(pump)
    }
    requestShadow()
    // late mounts (fonts, canvases) settle within a second or two
    const late = window.setTimeout(() => requestShadow?.(), 1500)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(late)
      requestShadow = null
    }
  }, [gl])

  return (
    <>
      <hemisphereLight ref={setHemi} args={['#f4fbff', '#d9d3c8', LIGHT_NOON.hemiIntensity]} />
      <primitive object={target} position={[CX, 0, CZ]} />
      <directionalLight
        position={[CX + SUN.x, SUN.y, CZ + SUN.z]}
        target={target}
        ref={setSun}
        intensity={LIGHT_NOON.sunIntensity}
        color={LIGHT_NOON.sunColor}
        castShadow
        shadow-mapSize={[4096, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-radius={3}
        shadow-camera-left={-HALF_W}
        shadow-camera-right={HALF_W}
        shadow-camera-top={HALF_D}
        shadow-camera-bottom={-HALF_D}
        shadow-camera-near={10}
        shadow-camera-far={220}
      />
    </>
  )
}
