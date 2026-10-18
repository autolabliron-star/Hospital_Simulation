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
`

/**
 * After `#include <lights_fragment_maps>`, where `irradiance` (hemisphere light), `iblIrradiance` and `radiance` (the environment, diffuse and
 * specular) are complete and not yet used. One fetch of the volume, 0.2 m in front of the surface so a wall's lit side reads its own room.
 *
 * The AO darkens the ambient light that was already there (hemisphere, environment); the panels' and the sky's light is added after it, unoccluded:
 * that light comes from the ceiling and the glazing, which a corner's walls do not hide.
 *
 * Outside the volume (the plaza, the grounds, a point above the storey) the sample fades out over half a metre to "open sky": no panels, no AO,
 * the sky term at full, which is what keeps the open air as bright as the overview while the walk look turns the sun and environment down.
 * The overview (uLvOn = 0) skips all of it.
 */
export const FRAG_LV = /* glsl */ `
#if defined( RE_IndirectDiffuse )
if ( uLvOn > 0.5 ) {
	vec3 lvN = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
	vec3 lvUvw = ( vLvPos + lvN * 0.2 - uLvOrigin ) / uLvSize;
	float lvOut = max( max( -lvUvw.x, lvUvw.x - 1.0 ) * uLvSize.x, max( -lvUvw.z, lvUvw.z - 1.0 ) * uLvSize.z );
	lvOut = max( lvOut, ( lvUvw.y - 1.0 ) * uLvSize.y );
	float lvIn = 1.0 - smoothstep( 0.0, 0.5, lvOut );
	// the texture is (x across, z down the rows, y up the layers): swizzle the world (x, y, z) into it
	vec4 lvS = mix( vec4( 0.0, 1.0, 1.0, 1.0 ), texture( uLvTex, lvUvw.xzy ), lvIn );
	float lvOcc = mix( 1.0, mix( lvS.a, lvS.b, uLvIndoor ), uLvAo );
	irradiance = irradiance * lvOcc + uLvIndoor * ( lvS.r * uLvPanel + lvS.g * uLvSky );
	iblIrradiance *= lvOcc;
	#if defined( RE_IndirectSpecular )
		radiance *= lvOcc;
	#endif
}
#endif
`

/** Floors: declarations (after `#include <common>` in the fragment shader). */
export const FLOOR_PARS = /* glsl */ `
uniform float uLvReflect;
uniform vec3 uLvPanelRad;
uniform highp sampler2D uLvCeil;
uniform vec4 uLvCeilGeom;
uniform float uLvCeilY;
uniform float uLvCeilTexels;
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
		float lvFT = ( uLvCeilY - vLvPos.y ) / lvFR.y;
		vec2 lvFUv = ( vLvPos.xz + lvFR.xz * lvFT - uLvCeilGeom.xy ) * uLvCeilGeom.zw;
		if ( lvFUv.x > 0.0 && lvFUv.x < 1.0 && lvFUv.y > 0.0 && lvFUv.y < 1.0 ) {
			float lvFRough = material.roughness * material.roughness;
			float lvFLod = log2( max( 1.0, lvFT * ( 0.03 + 1.2 * lvFRough ) * uLvCeilTexels ) );
			float lvFMask = textureLod( uLvCeil, lvFUv, lvFLod ).r;
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
