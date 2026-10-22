/**
 * The sky: one sphere, one draw call, drawn FIRST and only while you walk (the overview keeps the flat background colour, the dome is not even
 * visible there). Outside the glazing the picture reads as daylight sky (a gradient, pale and hazy at the horizon, clear blue overhead) instead of
 * the flat grey-green of `scene.background`, and it follows the hour: the daylight driver writes the hour's sky colour and how much of it is day into
 * `skyUniforms` (skyUniforms.ts), so dusk is peach and the night a deep blue-grey.
 *
 * The vertex shader drops the camera's translation (`mat3(viewMatrix)`) and puts the sphere at the far plane (`xyww`), so the dome is always
 * centred on you and behind everything, whatever the near and far planes are; depth test and write are off, so it costs a clear and a pass of
 * cheap fragments and never touches the depth buffer (the AO pass sees sky as far). `frustumCulled` is off: the sphere's bounds mean nothing.
 *
 * No fog (scene.fog is a define of every lit material: switching it on would recompile the whole building for a haze that is already in the gradient).
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BackSide, type Mesh, ShaderMaterial, SphereGeometry } from 'three'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { skyUniforms } from './skyUniforms'

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uDay;
uniform float uBlend;
varying vec3 vDir;
void main() {
  float h = clamp(normalize(vDir).y, 0.0, 1.0);
  // quick to leave the haze, slow to reach the zenith
  float k = pow(h, 0.55);
  vec3 day = mix(uHorizon, uZenith, k);
  // at night (and the edges of the day) the sky is the hour's colour, a little lighter at the horizon than overhead
  vec3 hour = mix(uSky * 1.12, uSky * 0.7, k);
  vec3 grad = mix(hour, day, uDay);
  gl_FragColor = vec4(mix(uSky, grad, uBlend), 1.0);
}
`

/** Draws before everything else (opaque objects sort by render order first). */
export const SKY_RENDER_ORDER = -1000

export function SkyDome() {
  const assets = useMemo(() => {
    const geometry = new SphereGeometry(1, 32, 16)
    const material = new ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
    return { geometry, material }
  }, [])

  // shown while the indoor blend is above nothing (the driver writes it on change; this reads a number, allocates nothing)
  const mesh = useRef<Mesh>(null)
  useFrame(() => {
    const m = mesh.current
    if (m) m.visible = skyUniforms.uBlend.value > 0.001
  }, FRAME_PRIORITY.sim + 4)

  return <mesh ref={mesh} name="sky-dome" geometry={assets.geometry} material={assets.material} frustumCulled={false} renderOrder={SKY_RENDER_ORDER} visible={false} />
}
