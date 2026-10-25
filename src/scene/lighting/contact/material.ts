/**
 * Soft contact shadows (realism step 2): the darkening a floor gets right under something that stands on it, the way the Cycles bake darkens
 * the floor under the benches and the reception desk. Live things (people, beds and wheelchairs, the meal bots, the imaging machines, the
 * authored building's movable kit) do not cast into the baked light, so without this they float.
 *
 * One material and one program for all of them (the crowd's blobs, the meal bots' and the generic layer in ./ContactShadows.tsx): a flat quad on
 * the floor whose alpha is an analytic soft shape, no texture. Per instance:
 *   aShape (vec4)   the footprint's half extents along the quad's own x and z, its corner radius, and the penumbra width, all in METRES
 *                   (the shape is measured in metres in the instance's frame, whatever the quad's scale, so a stretched quad does not stretch
 *                   the penumbra);
 *   aFade (float)   the strength (presence x darkness), times the material's `uContactDark`.
 * The alpha is 1 inside the footprint and falls to 0 one penumbra outside it with a squared smoothstep (a long soft tail, like an AO falloff),
 * drawn black with normal blending: the floor's linear radiance is multiplied by (1 - alpha), so the shadow is as dark in the bright lobby as in
 * a dim ward, which is what an occlusion does.
 */
import { MeshBasicMaterial, type WebGLProgramParametersWithUniforms } from 'three'

/** The one program every contact shadow shares. */
export const CONTACT_PROGRAM_KEY = 'contact-shadow-v1'

export const CONTACT_VERTEX_PARS = /* glsl */ `
attribute float aFade;
attribute vec4 aShape;
varying float vCsFade;
varying vec4 vCsShape;
varying vec2 vCsLocal;
`

export const CONTACT_VERTEX_MAIN = /* glsl */ `
vCsFade = aFade;
vCsShape = aShape;
{
	vec2 csScale = vec2( 1.0 );
	#ifdef USE_INSTANCING
		csScale = vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
	#endif
	vCsLocal = position.xz * csScale;
}
`

export const CONTACT_FRAGMENT_PARS = /* glsl */ `
uniform float uContactDark;
varying float vCsFade;
varying vec4 vCsShape;
varying vec2 vCsLocal;
`

/** Rounded-box signed distance in metres (negative inside), then the soft profile. */
export const CONTACT_FRAGMENT_MAIN = /* glsl */ `
{
	vec2 csQ = abs( vCsLocal ) - vCsShape.xy + vCsShape.z;
	float csD = length( max( csQ, 0.0 ) ) + min( max( csQ.x, csQ.y ), 0.0 ) - vCsShape.z;
	float csA = 1.0 - smoothstep( -0.35 * vCsShape.w, vCsShape.w, csD );
	diffuseColor.a *= csA * csA * vCsFade * uContactDark;
}
`

/** The CPU twin of the fragment's profile (for tests and tuning): alpha before the fade at signed distance `d` (m) for penumbra `pen`. */
export function contactProfile(d: number, pen: number): number {
  const e0 = -0.35 * pen
  const t = Math.min(1, Math.max(0, (d - e0) / (pen - e0)))
  const a = 1 - t * t * (3 - 2 * t)
  return a * a
}

export function patchContactShader(shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader' | 'uniforms'>, dark: { value: number }): void {
  shader.uniforms.uContactDark = dark
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${CONTACT_VERTEX_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CONTACT_VERTEX_MAIN}`)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${CONTACT_FRAGMENT_PARS}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${CONTACT_FRAGMENT_MAIN}`)
}

/**
 * A contact-shadow material. `darkness` multiplies every instance's `aFade` (the crowd writes presence there, the layer writes each shadow's own
 * darkness and uses 1). Its geometry must carry `aFade` (float) and `aShape` (vec4), instanced or per vertex.
 */
export function createContactShadowMaterial(darkness = 1): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  })
  m.name = 'contact-shadow'
  const dark = { value: darkness }
  m.userData.contactDark = dark
  m.onBeforeCompile = (shader) => patchContactShader(shader, dark)
  m.customProgramCacheKey = () => CONTACT_PROGRAM_KEY
  return m
}
