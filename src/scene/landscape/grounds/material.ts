/**
 * The exterior's two materials (both vertex-coloured, so one shader program serves the whole exterior) and the haze that hides the
 * horizon.
 *
 * Haze: no `scene.fog` (it is a define of every lit material and would recompile the building). Instead the exterior materials mix their
 * final colour toward the SKY's colour at the horizon with an exponential-squared falloff of the distance to the eye. The target is computed
 * exactly like the sky dome's horizon pixel (src/scene/lighting/env/SkyDome.tsx, from the same shared `skyUniforms`), so the ground, the far
 * blocks and the sky meet seamlessly at every hour (blue by day, peach at dusk, deep blue-grey at night) with no per-frame work.
 * The distance is `length(vViewPosition)`, which MeshStandardMaterial's fragment shader already has.
 */
import { MeshStandardMaterial } from 'three'
import { skyUniforms } from '@/scene/lighting/env/skyUniforms'

/** 1 / the distance (m) at which the haze is 63 %. 250 m (the ground's rim) is about 98 % hazed from the plaza. */
export const HAZE_DISTANCE = 108

const DECLARE = /* glsl */ `
uniform vec3 uHzSky;
uniform vec3 uHzHorizon;
uniform float uHzDay;
uniform float uHzBlend;
uniform float uHzInvDist;
`

const MIX = /* glsl */ `
{
  float hzD = length( vViewPosition ) * uHzInvDist;
  float hz = 1.0 - exp( - hzD * hzD );
  vec3 hzCol = mix( uHzSky, mix( uHzSky * 1.12, uHzHorizon, uHzDay ), uHzBlend );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, hzCol, hz );
}
`

const KEY = 'exterior:haze'

function hazy(m: MeshStandardMaterial): MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHzSky = skyUniforms.uSky
    shader.uniforms.uHzHorizon = skyUniforms.uHorizon
    shader.uniforms.uHzDay = skyUniforms.uDay
    shader.uniforms.uHzBlend = skyUniforms.uBlend
    shader.uniforms.uHzInvDist = { value: 1 / HAZE_DISTANCE }
    shader.fragmentShader = DECLARE + shader.fragmentShader.replace('#include <fog_fragment>', `#include <fog_fragment>\n${MIX}`)
  }
  m.customProgramCacheKey = () => KEY
  return m
}

export interface ExteriorMaterials {
  /** Ground, paving, props, trees, lamps, neighbours: matte. */
  matte: MeshStandardMaterial
  /** Car paint and glass: a touch of gloss, so the environment shows in it. */
  gloss: MeshStandardMaterial
}

export function createExteriorMaterials(): ExteriorMaterials {
  return {
    matte: hazy(new MeshStandardMaterial({ name: 'exterior-matte', vertexColors: true, roughness: 0.92, metalness: 0 })),
    gloss: hazy(new MeshStandardMaterial({ name: 'exterior-gloss', vertexColors: true, roughness: 0.34, metalness: 0.12 })),
  }
}
