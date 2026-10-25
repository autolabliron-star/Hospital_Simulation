/**
 * The shader chunks of the realistic light (W3), as plain strings the patches splice into three's stock MeshStandardMaterial shaders.
 * Every anchor is a stock `#include` that exists in three 0.186 (palettePatch.test.ts checks each against the real shader): the patch
 * only ever REPLACES `#include <x>` with `#include <x>` plus more, so it composes with every other patch (the instance-colour emissive of
 * `tintedGlow`, the crowd's pose texture, the fade) in either order.
 *
 * The one world position: `vLvPos`, the vertex's position in the world (the model matrix, and the instance matrix when instanced).
 */

/** Declarations, spliced after `#include <common>` in the vertex shader. */
export const VERT_PARS = /* glsl */ `
varying vec3 vLvPos;
`

/** After `#include <project_vertex>`: `transformed` is final there. */
export const VERT_MAIN = /* glsl */ `
{
	vec4 lvW = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		lvW = batchingMatrix * lvW;
	#endif
	#ifdef USE_INSTANCING
		lvW = instanceMatrix * lvW;
	#endif
	vLvPos = ( modelMatrix * lvW ).xyz;
}
`

/**
 * Step 2 of the realism pass: the bake-matched light on live objects (../bake/field.ts, ../bake/uniforms.ts). Declarations, part of FRAG_PARS.
 */
export const BAKE_PARS = /* glsl */ `
uniform highp sampler3D uBkField;
uniform vec4 uBkGeom;
uniform float uBkSplitY;
uniform float uBkOn;
uniform float uBkGain;
uniform float uBkSpec;
uniform float uBkKey;
uniform float uBkAo;
`

/** A slice of the field at its texel centre (7 slices per storey, 14 in all; `bkPage` is 0 or 7). */
const bkSlice = (i: number): string => `textureLod( uBkField, vec3( bkUv, ( bkPage + ${i}.5 ) / 14.0 ), 0.0 )`

/**
 * Where float `f` of a cell (coefficient i, channel c at f = 3 i + c; the weight at 27) lives in the field: texel f / 4, component f % 4
 * (../bake/field.ts packs it so). The GLSL below is generated from this rule, and a test holds it to the packing.
 */
export function bakeFloatAt(f: number): { texel: number; component: number } {
  return { texel: Math.floor(f / 4), component: f % 4 }
}

const COMPONENT = 'rgba'
/** `bkC[i] = vec3( ... );` for the nine coefficients, read from the texels bk0..bk6. */
const BAKE_UNPACK = Array.from({ length: 9 }, (_, i) => {
  const parts = [0, 1, 2].map((c) => {
    const at = bakeFloatAt(i * 3 + c)
    return `bk${at.texel}.${COMPONENT[at.component]}`
  })
  return `\t\tbkC[ ${i} ] = vec3( ${parts.join(', ')} );`
}).join('\n')

/**
 * Part of FRAG_LV, after the light volume's block (whose ambient occlusion it may reuse, `lvKeep`). Where the field's weight is above 0 (an
 * authored zone, `uBkOn` > 0: walking, the field built), the live light a surface got is replaced, by that weight, with the light the zone was
 * BAKED with:
 *   - the hemisphere, the ambient and the volume's panel and sky light (`irradiance`) go;
 *   - the environment's diffuse (`iblIrradiance`, the bound probe through the PMREM at the driver's intensity) becomes the zone's SH9 irradiance
 *     at this normal (three's own `shGetIrradianceAt`), at the bake's own scale, darkened a little by the volume's AO (`uBkAo`);
 *   - the direct lights (the sun) keep `uBkKey` of themselves;
 *   - the environment's specular takes the baked materials' own gain (`uBkSpec` = reflections.ts uReflGain).
 * The weight is read first (one fetch) and the other six slices only where it is not 0, so the plaza and the overview pay one fetch or nothing.
 */
export const BAKE_MAIN = /* glsl */ `
if ( uBkOn > 0.0 ) {
	vec2 bkUv = ( vLvPos.xz - uBkGeom.xy ) * uBkGeom.zw;
	float bkPage = vLvPos.y > uBkSplitY ? 7.0 : 0.0;
	vec4 bk6 = ${bkSlice(6)};
	float bkW = clamp( bk6.${COMPONENT[bakeFloatAt(27).component]}, 0.0, 1.0 ) * uBkOn;
	if ( bkW > 0.002 ) {
		vec4 bk0 = ${bkSlice(0)};
		vec4 bk1 = ${bkSlice(1)};
		vec4 bk2 = ${bkSlice(2)};
		vec4 bk3 = ${bkSlice(3)};
		vec4 bk4 = ${bkSlice(4)};
		vec4 bk5 = ${bkSlice(5)};
		vec3 bkC[ 9 ];
${BAKE_UNPACK}
		vec3 bkN = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		vec3 bkE = max( shGetIrradianceAt( bkN, bkC ), vec3( 0.0 ) ) * ( uBkOn * uBkGain * mix( 1.0, lvKeep, uBkAo ) );
		irradiance *= 1.0 - bkW;
		iblIrradiance = iblIrradiance * ( 1.0 - bkW ) + bkE;
		reflectedLight.directDiffuse *= 1.0 - bkW * ( 1.0 - uBkKey );
		reflectedLight.directSpecular *= 1.0 - bkW * ( 1.0 - uBkKey );
		#if defined( RE_IndirectSpecular )
			radiance *= mix( 1.0, uBkSpec, bkW );
		#endif
	}
}
`

/** Declarations, spliced after `#include <common>` in the fragment shader. `highp` is explicit: a sampler3D defaults to lowp. */
export const FRAG_PARS = /* glsl */ `
varying vec3 vLvPos;
uniform highp sampler3D uLvTex;
uniform vec3 uLvOrigin;
uniform vec3 uLvSize;
uniform float uLvOn;
uniform float uLvIndoor;
uniform float uLvAo;
uniform vec3 uLvPanel;
uniform vec3 uLvSky;
${BAKE_PARS}`

/**
 * After `#include <lights_fragment_maps>`, where `irradiance` (hemisphere light), `iblIrradiance` and `radiance` (the environment, diffuse and
 * specular) are complete and not yet used. One fetch of the volume, 0.2 m in front of the surface so a wall's lit side reads its own room.
 *
 * The AO darkens the ambient light that was already there (hemisphere, environment); the panels' and the sky's light is added after it, unoccluded:
 * that light comes from the ceiling and the glazing, which a corner's walls do not hide.
 *
 * Outside the volume (the plaza, the grounds, a point above the storey) the sample fades out over half a metre to "open sky": no panels, no AO,
 * the sky term at full, which is what keeps the open air as bright as the overview while the walk look turns the sun and environment down.
 * R2: the band between the storeys (3.05 to 4.2 m) reads as open sky the same way. The overview (uLvOn = 0) skips all of it.
 */
export const FRAG_LV = /* glsl */ `
#if defined( RE_IndirectDiffuse )
float lvKeep = 1.0;
if ( uLvOn > 0.5 ) {
	vec3 lvN = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
	vec3 lvUvw = ( vLvPos + lvN * 0.2 - uLvOrigin ) / uLvSize;
	float lvOut = max( max( -lvUvw.x, lvUvw.x - 1.0 ) * uLvSize.x, max( -lvUvw.z, lvUvw.z - 1.0 ) * uLvSize.z );
	lvOut = max( lvOut, ( lvUvw.y - 1.0 ) * uLvSize.y );
	float lvIn = 1.0 - smoothstep( 0.0, 0.5, lvOut );
	// R2: the slab between the storeys (above level 1's ceilings and under level 2's floor: the roof cap, the floor plate's edge) is open air, not a blend of
	// the rooms the layers on either side of it hold
	float lvY = vLvPos.y + lvN.y * 0.2;
	lvIn *= 1.0 - smoothstep( 3.05, 3.25, lvY ) * ( 1.0 - smoothstep( 4.0, 4.2, lvY ) );
	// the texture is (x across, z down the rows, y up the layers): swizzle the world (x, y, z) into it
	vec4 lvS = mix( vec4( 0.0, 1.0, 1.0, 1.0 ), texture( uLvTex, lvUvw.xzy ), lvIn );
	float lvOcc = mix( 1.0, mix( lvS.a, lvS.b, uLvIndoor ), uLvAo );
	irradiance = irradiance * lvOcc + uLvIndoor * ( lvS.r * uLvPanel + lvS.g * uLvSky );
	iblIrradiance *= lvOcc;
	#if defined( RE_IndirectSpecular )
		radiance *= lvOcc;
	#endif
	lvKeep = lvOcc;
}
${BAKE_MAIN}
#endif
`

/** Floors: declarations (after `#include <common>` in the fragment shader). R2: two pages of the ceiling map, level 1's and level 2's. */
export const FLOOR_PARS = /* glsl */ `
uniform float uLvReflect;
uniform vec3 uLvPanelRad;
uniform highp sampler2D uLvCeil;
uniform vec4 uLvCeilGeom;
uniform float uLvCeilY;
uniform float uLvCeilTexels;
uniform highp sampler2D uLvCeil2;
uniform vec4 uLvCeilGeom2;
uniform float uLvCeilY2;
`

/**
 * Floors: after `#include <lights_fragment_maps>` (and so after the volume's block, whichever order the patches ran in: the volume's chunk is
 * inserted right after the include, in front of this one). The view ray is reflected off the floor, hits the ceiling plane, and reads the
 * ceiling map's panel mask at a mip level that grows with the distance of the hit and the roughness: the reflection of the panels is sharp
 * close by and a soft glow far down a corridor. The Fresnel is the material's own: the radiance goes where the environment's goes, into
 * `radiance`, which `RE_IndirectSpecular` weighs by the specular BRDF (F0 0.04, rising at grazing angles).
 */
export const FLOOR_MAIN = /* glsl */ `
#if defined( RE_IndirectSpecular )
if ( uLvReflect > 0.001 ) {
	vec3 lvFV = normalize( vLvPos - cameraPosition );
	vec3 lvFN = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
	vec3 lvFR = reflect( lvFV, lvFN );
	if ( lvFR.y > 0.02 ) {
		// R2: a floor above 3.9 m is level 2's: its ceiling plane and its page of the ceiling map
		bool lvUp = vLvPos.y > 3.9;
		float lvCy = lvUp ? uLvCeilY2 : uLvCeilY;
		vec4 lvCg = lvUp ? uLvCeilGeom2 : uLvCeilGeom;
		float lvFT = ( lvCy - vLvPos.y ) / lvFR.y;
		vec2 lvFUv = ( vLvPos.xz + lvFR.xz * lvFT - lvCg.xy ) * lvCg.zw;
		if ( lvFUv.x > 0.0 && lvFUv.x < 1.0 && lvFUv.y > 0.0 && lvFUv.y < 1.0 ) {
			float lvFRough = material.roughness * material.roughness;
			float lvFLod = log2( max( 1.0, lvFT * ( 0.03 + 1.2 * lvFRough ) * uLvCeilTexels ) );
			float lvFMask = lvUp ? textureLod( uLvCeil2, lvFUv, lvFLod ).r : textureLod( uLvCeil, lvFUv, lvFLod ).r;
			radiance += uLvPanelRad * ( lvFMask * uLvReflect );
		}
	}
}
#endif
`

/** Glass: declaration (after `#include <common>` in the fragment shader). */
export const GLASS_PARS = /* glsl */ `
uniform float uLvGlass;
`

/** Glass: before `#include <opaque_fragment>`: the sheet gets more opaque (and so more reflective) the more grazing the view. */
export const GLASS_MAIN = /* glsl */ `
{
	float lvGF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 4.0 );
	diffuseColor.a = mix( diffuseColor.a, 1.0, saturate( lvGF * uLvGlass ) );
}
`
