/**
 * Presentation mode's floor reflections on the authored lobby (`?building=model`): the terrazzo reflects the LED slots, the glazing and the walls
 * softly, the way the Blender stills do (docs/screenshots/lobby-blender-*.jpg).
 *
 * How: the lobby's reflection probe (src/scene/lighting/env/lobbyProbe.ts, a Blender render of the lobby from PROBE, bound as `scene.environment`
 * while the camera is in the pilot region) is sampled with a BOX-PROJECTED (parallax-corrected) direction: the reflected ray is intersected with
 * the room's box and the probe is looked up toward that hit point from where the probe was rendered, so a reflection sits under the thing it
 * reflects wherever you stand (a plain probe is right only at the probe's own point and slides everywhere else). It is a patch of the baked look's
 * `onBeforeCompile` (./lightmaps.ts): one more varying (the world position), one function, the IBL radiance call swapped for it. Every baked
 * material carries it from the first compile (its own program cache key), so nothing compiles when it switches on: it is driven by UNIFORMS only.
 *
 *   uBoxMix     0 = the plain probe (today's picture, everywhere outside presentation), 1 = box-projected. Faded out over BOX_FADE metres
 *               outside the box (the spine's floor beyond the lobby's span is drawn by the same material).
 *   uReflGain   the environment's specular gain on the baked materials. The probe is in the bake's own units (both are radiance from the same
 *               Blender scene), so whenever a zone probe is bound (walking in its zone, and presenting) it is read at WALK_REFLECT.gain /
 *               scene.environmentIntensity (presenting: FLOOR_REFLECT.gain / ...), i.e. at its true brightness, whatever intensity the daylight
 *               driver gave the environment. Before realism step 2 this held only while presenting, and walking read the probe at ~0.26 of
 *               it: glossy baked kit (stainless, bed rails, satin floors) looked matte. 1 = unchanged (the overview, other environments).
 *               Live objects share this very uniform (src/scene/lighting/bake/uniforms.ts uBkSpec).
 *   uRoughScale the floors' roughness multiplier (FLOOR_REFLECT.roughnessScale in presentation, 1 otherwise; floors only, see FLOOR_REFLECT).
 *
 * `updateModelReflections` writes them once a frame (Effects.tsx, with presentation's blend): plain numbers, no allocation.
 */
import { Vector3, type Material } from 'three'

/** Where env_lobby.hdr was rendered from (tools/arch/bake.py: plan point (-53, 1.6, 0)). */
export const LOBBY_PROBE_POS = { x: -53, y: 1.6, z: 0 } as const

/**
 * The box the probe is projected onto: the lobby (x -62..-44, z -6..6, src/sim/places.ts) plus the stretch of the spine it opens onto (the
 * opening is the lobby's full 12 m width, so the probe sees the spine's east wall at x -40 through it), floor to ceiling (3 m).
 */
export const LOBBY_BOX = { x0: -62, x1: -40, y0: 0, y1: 3, z0: -6, z1: 6 } as const

/** Metres outside the box over which the projection fades back to the plain probe (no seam on the spine's floor at z = +/-6). */
export const BOX_FADE = 0.6

/**
 * TUNING KNOBS (presentation mode only):
 *   materials       the glTF material names that count as reflective floor (the lobby's and spine's terrazzo)
 *   gain            the probe's specular brightness on the baked materials, as a share of its true radiance (1 = physically matched to the bake).
 *                   Raise for more visible reflections (1.5 reads as freshly polished), lower for a duller floor.
 *   roughnessScale  multiplies the floor's own roughness (the ARM texture, about 0.2 on the terrazzo). Below 1 sharpens the reflections (0.7 gives
 *                   crisp LED lines), above 1 blurs them. Keep it in 0.6..1.3: lower is a mirror, not polished stone.
 */
export const FLOOR_REFLECT = { materials: ['Terrazzo'] as readonly string[], gain: 1.0, roughnessScale: 0.85 }

export const reflectionUniforms = {
  uBoxMin: { value: new Vector3(LOBBY_BOX.x0, LOBBY_BOX.y0, LOBBY_BOX.z0) },
  uBoxMax: { value: new Vector3(LOBBY_BOX.x1, LOBBY_BOX.y1, LOBBY_BOX.z1) },
  uProbePos: { value: new Vector3(LOBBY_PROBE_POS.x, LOBBY_PROBE_POS.y, LOBBY_PROBE_POS.z) },
  uBoxFade: { value: BOX_FADE },
  uBoxMix: { value: 0 },
  uReflGain: { value: 1 },
}
/** The floors' roughness multiplier, and the constant 1 every other baked material reads. */
export const floorRoughUniform = { value: 1 }
const unitRough = { value: 1 }

/**
 * (Zone rollout) the probe the box projection reads from: each zone with a probe (manifest.json) has its own eye and box; the bound probe is the
 * camera's zone's (src/scene/lighting/env/lobbyProbe.ts selects it and calls this when the zone changes). Every baked material shares these
 * uniforms, so a neighbouring zone seen through a door is read with the camera zone's box and fades back to the plain probe outside it
 * (BOX_FADE). Allocation-free.
 */
export function setReflectionBox(eye: { x: number; y: number; z: number }, box: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }): void {
  reflectionUniforms.uProbePos.value.set(eye.x, eye.y, eye.z)
  reflectionUniforms.uBoxMin.value.set(box.x0, box.y0, box.z0)
  reflectionUniforms.uBoxMax.value.set(box.x1, box.y1, box.z1)
}

/** Is this a reflective floor material (FLOOR_REFLECT.materials, by its glTF name; a clone keeps the name)? */
/**
 * TUNING KNOB (realism step 2): the probe's specular brightness on the baked materials while WALKING in a zone with a bound probe, as a share of
 * its true radiance (1 = physically matched to the bake, as presentation's FLOOR_REFLECT.gain). Highlight check (node, the shipped probes
 * blurred like a roughness 0.2..0.4 PMREM): the LED lines peak at 3.2 (lobby, sigma 0.1 rad) / 1.5 (0.2 rad) radiance; a dielectric floor reflects
 * 4 % of that face-on (0.13) and at most ~0.3..0.5 of it at grazing (~1..1.5), stainless ~0.8 (~2.5): through AgX at the walk exposure 1.31
 * that is 0.85..0.93 display, a soft highlight, not a clipped one (AgX and the Blender LUT both roll off). Lower it if the floors glare.
 */
export const WALK_REFLECT = { gain: 1.0 } as const

export function isReflectiveFloor(m: Material): boolean {
  return FLOOR_REFLECT.materials.includes(m.name)
}

/**
 * Presentation's blend `present` (0..1), whether a zone probe is the bound environment, and the environment intensity the daylight driver
 * set: the uniforms for this frame. The box projection and the floors' roughness follow presentation; the gain is physical whenever a zone
 * probe is bound (WALK_REFLECT walking, FLOOR_REFLECT presenting). Allocation-free.
 */
export function updateModelReflections(present: number, lobbyBound: boolean, envIntensity: number): void {
  const k = lobbyBound ? present : 0
  reflectionUniforms.uBoxMix.value = k
  const env = Math.max(envIntensity, 1e-3)
  reflectionUniforms.uReflGain.value = lobbyBound ? (WALK_REFLECT.gain + (FLOOR_REFLECT.gain - WALK_REFLECT.gain) * k) / env : 1
  floorRoughUniform.value = 1 + (FLOOR_REFLECT.roughnessScale - 1) * k
}

// ------------------------------------------------------------------------------------------------------------------------------------------
// The shader patch (three r186 chunk names; reflections.test.ts holds the chunks to the text it replaces)
// ------------------------------------------------------------------------------------------------------------------------------------------

export const BOX_VERTEX_PARS = `#include <common>
varying vec3 vBoxWorldPos;`
export const BOX_VERTEX = `#include <worldpos_vertex>
vBoxWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`

export const BOX_FRAGMENT_PARS = `#include <envmap_physical_pars_fragment>
varying vec3 vBoxWorldPos;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uProbePos;
uniform float uBoxFade;
uniform float uBoxMix;
uniform float uReflGain;
uniform float uRoughScale;
#ifdef USE_ENVMAP
vec3 getIBLRadianceBox( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
	#ifdef ENVMAP_TYPE_CUBE_UV
		vec3 reflectVec = reflect( - viewDir, normal );
		reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
		reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
		if ( uBoxMix > 0.0 ) {
			vec3 p = vBoxWorldPos;
			vec3 outside3 = max( uBoxMin - p, p - uBoxMax );
			float outside = max( max( outside3.x, outside3.y ), outside3.z );
			float k = uBoxMix * ( 1.0 - smoothstep( 0.0, uBoxFade, outside ) );
			if ( k > 0.0 ) {
				// a component of exactly 0 would make 0 x inf = NaN on a face of the box: nudge it
				vec3 inv = 1.0 / mix( reflectVec, vec3( 1e-5 ), vec3( lessThan( abs( reflectVec ), vec3( 1e-5 ) ) ) );
				vec3 far3 = max( ( uBoxMax - p ) * inv, ( uBoxMin - p ) * inv );
				float t = max( min( min( far3.x, far3.y ), far3.z ), 0.0 );
				vec3 boxed = normalize( p + reflectVec * t - uProbePos );
				reflectVec = normalize( mix( reflectVec, boxed, k ) );
			}
		}
		vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
		return envMapColor.rgb * envMapIntensity * uReflGain;
	#else
		return vec3( 0.0 );
	#endif
}
#endif`

export const ROUGHNESS_FRAGMENT = `#include <roughnessmap_fragment>
roughnessFactor = clamp( roughnessFactor * uRoughScale, 0.0, 1.0 );`

/** The radiance call in three's `lights_fragment_maps` that the patch swaps (the clearcoat call after it is left alone). */
export const IBL_RADIANCE_CALL = 'vec3 iblRadiance = getIBLRadiance('
export const IBL_RADIANCE_BOX_CALL = 'vec3 iblRadiance = getIBLRadianceBox('

interface PatchableShader {
  uniforms: Record<string, unknown>
  vertexShader: string
  fragmentShader: string
}

/** Add the box projection to a standard material's shader (the caller swaps the radiance call inside its copy of `lights_fragment_maps`). */
export function patchBoxProjection(shader: PatchableShader, floor: boolean): void {
  Object.assign(shader.uniforms, reflectionUniforms)
  shader.uniforms.uRoughScale = floor ? floorRoughUniform : unitRough
  shader.vertexShader = shader.vertexShader.replace('#include <common>', BOX_VERTEX_PARS).replace('#include <worldpos_vertex>', BOX_VERTEX)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <envmap_physical_pars_fragment>', BOX_FRAGMENT_PARS)
    .replace('#include <roughnessmap_fragment>', ROUGHNESS_FRAGMENT)
}
