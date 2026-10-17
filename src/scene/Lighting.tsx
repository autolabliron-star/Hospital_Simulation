/**
 * Light for the architect's-model look, kept cheap enough that the demo never stutters:
 *   - three's built-in RoomEnvironment as the reflection/ambient environment (no HDRI download);
 *   - a soft sky/ground hemisphere fill;
 *   - one sun whose shadow map is rendered ONCE for the static building (autoUpdate off), and again only
 *     when a layer calls `invalidateShadows()` (e.g. after it finished building its meshes). Moving things
 *     (pods, people) do not cast into it; they get soft blob shadows instead.
 */
import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { type DirectionalLight, type HemisphereLight, Object3D, PMREMGenerator } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { LIGHT_NOON } from '@/scene/daylight/lightAt'
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

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = LIGHT_NOON.envIntensity
    pmrem.dispose()
    return () => {
      scene.environment = null
      env.dispose()
    }
  }, [gl, scene])

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
