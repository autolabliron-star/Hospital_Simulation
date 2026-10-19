// Ported from Waltz City (src/scene/actors/crowd/shaders.ts): the body materials and the dither/rim patches. New: the gear material (props and
// vehicles, one draw call each), the blob-shadow material with a per-instance fade, no sun-shadow depth materials (people do not cast).
// W1 "Close-up people": the vertex stage of the near bodies moves and tints the face features (iris, brows, mouth), hides the staff details a person
// does not wear, and tells the fragment stage what a vertex is made of (skin, hair, shoes, eyes, cloth) for a gentle roughness difference.
// W3 wave B: the realistic people's material (createAvatarMaterials): Waltz's skinned avatar body without its depth materials, plus the garment tint.
/**
 * Materials of the instanced crowd, the one place in the hospital that is allowed its own materials: the shared palette (materials.ts)
 * colours things per mesh or per instance, but a person is twenty rigid parts posed from a data texture and dressed from a per-person
 * palette, which a stock material cannot do. They are plain three.js standard materials (so lighting, the environment and the baked
 * building shadow behave like everything else) with the vertex stage patched to read each person's skeleton from the pose texture
 * instead of an instance matrix, plus a dither discard that cross-fades between the bodies without blending (no sorting, depth and
 * ambient occlusion stay correct).
 *
 * Per instance the vertex shader reads (see TEX in constants.ts): the root (position, heading), the LOD thresholds, the rim colour, the
 * matrix of the piece the vertex belongs to and the colour of the vertex's slot. `aRow` (instanced attribute) says which person;
 * `aPart` (per vertex) says which piece (or, for gear, which kind) and slot.
 *
 * A pixel is drawn when its screen-space noise value lies in [lo, hi) of its body (lod.ts).
 *
 * Programs compiled: body near, body far, props, vehicles, blob shadow, ring: six, once (the close-up details add no program: they are branches
 * of the near body's vertex stage on the vertex's own colour slot). The realistic people add one: every avatar body of every LOD shares it.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector2,
  Vector4,
  type DataTexture,
  type IUniform,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { BADGE_FRAME, BADGE_KIND, CAP_FRAME, CAP_KIND, FIXED_COLORS, FEATURE_FIRST, FX, P, PALETTE_SLOTS, RING_COLORS, SLOT, TEX, fixedSlot } from './constants'
import { TINT_MAX_GAIN, tintContrast, type AvatarEntry } from './avatars'
import { LIGHT_VOLUME_KEY, applyLightVolume } from '@/scene/lighting/volumeChunk'
import { FACE } from './face'
import { BADGE_TOP, GEAR_BIT } from './staff'

/** 0 high, 1 mid, 2 far: the dithered band of that body. */
export type BodyLod = 0 | 1 | 2

const FIXED_COUNT = FIXED_COLORS.length

/** A number as a GLSL float literal. */
const g = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(Number(n.toFixed(6))))
const F = (i: number): number => fixedSlot(i)
const pal = (slot: number): string => `texelFetch(uPose, ivec2(${TEX.palette + slot}, cRow), 0).rgb`

const PARS_VERT = /* glsl */ `
uniform sampler2D uPose;
uniform float uLod;
uniform vec3 uFixed[${FIXED_COUNT}];
attribute float aRow;
attribute vec2 aPart;
flat varying vec4 vCrowdLod;
varying vec3 vCrowdBase;
flat varying vec3 vCrowdRim;
flat varying float vCrowdMat;
`

/**
 * W1: the close-up features, run only for the fixed "feature" slots (constants.ts) of the near bodies. The head part's own frame, nominal metres.
 * `cFace` is the face texel (eye yaw, eye pitch, expression, blink), `cGear` the gear texel (badge kind, flag bits, spare, mouth open).
 * What a slot does:
 *   iris         slides over the white towards the gaze (and follows the slant of the skin), squashes with the blink
 *   sclera       squashes with the blink and darkens towards the lid colour
 *   brow         the person's hair colour, a little darker; lifts when happy, the inner end lifts when unwell
 *   mouth        the person's skin, darker and redder; corners up when happy, down when unwell; the lower edge drops while talking
 *   frame        the person's glasses colour, hidden if they wear none
 * The brows and the mouth melt into the skin, and the glasses disappear, with distance (FACE.fadeFrom..fadeTo): they are thinner than a pixel there.
 *   badge...     hidden where there is no badge; the player's is larger and gold with a dark band and a "Y"
 *   steth, dosimeter, bib   hidden unless the person wears one
 */
const FEATURE_VERT = /* glsl */ `
vec4 cFace = texelFetch(uPose, ivec2(${TEX.face}, cRow), 0);
vec4 cGear = texelFetch(uPose, ivec2(${TEX.gear}, cRow), 0);
int cKind = int(cGear.x + 0.5);
int cFlags = int(cGear.y + 0.5);
// lines a few millimetres thick (brows, mouth, glasses frames) are under a pixel beyond about 8 m and would shimmer: they melt into the skin between ${g(FACE.fadeFrom)} and ${g(FACE.fadeTo)} m
float cFade = smoothstep(${g(FACE.fadeFrom)}, ${g(FACE.fadeTo)}, distance(cRoot.xyz + vec3(0.0, 1.6, 0.0), cameraPosition));
if (cSlot == ${F(FX.eye)}) {
  float cSide = cP.x < 0.0 ? -1.0 : 1.0;
  float cGx = clamp(cFace.x / ${g(FACE.gazeYaw)}, -1.0, 1.0) * ${g(FACE.gazeX)};
  float cGy = clamp(cFace.y / ${g(FACE.gazePitch)}, -1.0, 1.0) * ${g(FACE.gazeY)};
  cP.x += cGx;
  cP.y += cGy;
  cP.z -= ${g(FACE.eyeSlope)} * cSide * cGx;
  cP.y = ${g(FACE.eyeY)} + (cP.y - ${g(FACE.eyeY)}) * (1.0 - ${g(FACE.blinkClose)} * cFace.w);
  cMat = 4.0;
} else if (cSlot == ${F(FX.sclera)}) {
  cP.y = ${g(FACE.eyeY)} + (cP.y - ${g(FACE.eyeY)}) * (1.0 - ${g(FACE.blinkClose)} * cFace.w);
  cBase = mix(cBase, ${pal(SLOT.skin)} * vec3(0.5, 0.42, 0.42), cFace.w);
  cMat = 4.0;
} else if (cSlot == ${F(FX.brow)}) {
  float cT = clamp((abs(cP.x) - ${g(FACE.browIn)}) / ${g(FACE.browOut - FACE.browIn)}, 0.0, 1.0);
  float cDy = max(cFace.z, 0.0) * ${g(FACE.browLift)} + max(-cFace.z, 0.0) * (${g(FACE.browWorry)} * (1.0 - cT) - 0.0025 * cT);
  cP.y += cDy;
  cP.z += ${g(FACE.browSlope)} * cDy;
  cBase = mix(${pal(SLOT.hair)} * 0.74, ${pal(SLOT.skin)}, cFade);
  cMat = 2.0;
} else if (cSlot == ${F(FX.mouth)}) {
  float cU = cP.x / ${g(FACE.mouthHalf)};
  float cE = cFace.z;
  float cDy = (cE > 0.0 ? cE * ${g(FACE.smileLift)} : cE * ${g(FACE.frownDrop)}) * cU * cU;
  if (cP.y < ${g(FACE.mouthY - 0.0005)}) cDy -= cGear.w * ${g(FACE.mouthOpen)} * (1.0 - cU * cU);
  cP.x *= 1.0 + 0.08 * max(cE, 0.0) - 0.06 * max(-cE, 0.0);
  cP.y += cDy;
  cBase = mix(${pal(SLOT.skin)} * vec3(0.62, 0.4, 0.4), ${pal(SLOT.skin)}, cFade);
  cMat = 1.0;
} else if (cSlot == ${F(FX.frame)}) {
  cBase = ${pal(SLOT.glasses)};
  cHide = (cFlags & ${GEAR_BIT.glasses}) == 0 || cFade > 0.999;
} else if (cSlot >= ${F(FX.badgeCard)} && cSlot <= ${F(FX.badgeMark)}) {
  cHide = cKind == 0 || (cSlot == ${F(FX.badgeMark)} && cKind != 2) || (cSlot == ${F(FX.badgePhoto)} && cKind == 2);
  if (cKind == 2) {
    vec3 cAnchor = vec3(0.0, ${g(BADGE_TOP)}, 0.105);
    cP = cAnchor + (cP - cAnchor) * 1.35;
    if (cSlot == ${F(FX.badgeCard)}) cBase = ${pal(SLOT.badge)};
    else cBase = uFixed[${FX.youInk}];
  } else if (cSlot == ${F(FX.badgeBand)}) cBase = ${pal(SLOT.badge)};
} else if (cSlot == ${F(FX.stethTube)} || cSlot == ${F(FX.stethPiece)}) {
  cHide = (cFlags & ${GEAR_BIT.stethoscope}) == 0;
  if (cSlot == ${F(FX.stethPiece)}) cMat = 4.0;
} else if (cSlot == ${F(FX.dosimeter)}) {
  cHide = (cFlags & ${GEAR_BIT.dosimeter}) == 0;
} else if (cSlot == ${F(FX.bib)}) {
  cHide = (cFlags & ${GEAR_BIT.bib}) == 0;
  cBase = ${pal(SLOT.coat)};
}
`

/** Reads the person's row, places the vertex. Defines cN (normal in the person's frame), cWorldPos and the varyings. */
const BODY_VERT = /* glsl */ `
int cRow = int(aRow + 0.5);
vec4 cRoot = texelFetch(uPose, ivec2(${TEX.root}, cRow), 0);
vec4 cLod = texelFetch(uPose, ivec2(${TEX.lod}, cRow), 0);
float cLo = uLod < 0.5 ? 0.0 : (uLod < 1.5 ? cLod.x : cLod.y);
float cHi = uLod < 0.5 ? cLod.x : (uLod < 1.5 ? cLod.y : cLod.z);
vCrowdLod = vec4(cLo, cHi, cLod.w, 0.0);
vCrowdRim = texelFetch(uPose, ivec2(${TEX.rim}, cRow), 0).rgb;
int cSlot = int(aPart.y + 0.5);
vec3 cBase = cSlot < ${PALETTE_SLOTS} ? texelFetch(uPose, ivec2(${TEX.palette} + cSlot, cRow), 0).rgb : uFixed[cSlot - ${PALETTE_SLOTS}];
float cSn = sin(cRoot.w);
float cCs = cos(cRoot.w);
bool cHide = false;
#ifdef CROWD_FAR
  float cMat = -1.0;
  vec4 cSize = texelFetch(uPose, ivec2(${TEX.size}, cRow), 0);
  vec3 cPos = position * vec3(cSize.y, cSize.x, cSize.y);
  vec3 cNrm = normal;
#else
  // what the vertex is made of, for the fragment stage: 0 cloth, 1 skin, 2 hair, 3 shoes, 4 eyes and polished metal
  float cMat = cSlot == ${SLOT.skin} ? 1.0 : (cSlot == ${SLOT.hair} ? 2.0 : (cSlot == ${SLOT.shoes} ? 3.0 : 0.0));
  vec3 cP = position;
  if (cSlot == ${F(FX.eye)} || cSlot >= ${FEATURE_FIRST}) {
${FEATURE_VERT}
  }
  int cCol = ${TEX.parts} + int(aPart.x + 0.5) * 3;
  vec4 cM0 = texelFetch(uPose, ivec2(cCol, cRow), 0);
  vec4 cM1 = texelFetch(uPose, ivec2(cCol + 1, cRow), 0);
  vec4 cM2 = texelFetch(uPose, ivec2(cCol + 2, cRow), 0);
  vec3 cPos = vec3(dot(cM0.xyz, cP) + cM0.w, dot(cM1.xyz, cP) + cM1.w, dot(cM2.xyz, cP) + cM2.w);
  vec3 cNrm = vec3(dot(cross(cM1.xyz, cM2.xyz), normal), dot(cross(cM2.xyz, cM0.xyz), normal), dot(cross(cM0.xyz, cM1.xyz), normal));
  cNrm = cNrm / (length(cNrm) + 1e-9);
#endif
vCrowdBase = cBase;
vCrowdMat = cMat;
vec3 cWorldPos = vec3(cCs * cPos.x + cSn * cPos.z, cPos.y, -cSn * cPos.x + cCs * cPos.z) + cRoot.xyz;
vec3 cWorldNrm = vec3(cCs * cNrm.x + cSn * cNrm.z, cNrm.y, -cSn * cNrm.x + cCs * cNrm.z);
`

const PARS_FRAG = /* glsl */ `
flat varying vec4 vCrowdLod;
varying vec3 vCrowdBase;
flat varying vec3 vCrowdRim;
`

/** The near bodies' fragment stage also knows what a vertex is made of (flat per vertex; see BODY_VERT). */
const PARS_FRAG_BODY = /* glsl */ `
flat varying float vCrowdMat;
`

/**
 * A gentle difference of material with no extra draw and no extra program: matte cloth, a little softer skin, hair with a faint sheen, shoes,
 * and wet eyes (and the doctor's metal chest piece), which is what puts a highlight in a pupil at 1 m. The far figure keeps the stock value.
 */
const ROUGH_FRAG = /* glsl */ `
if (vCrowdMat > -0.5) {
  float cR = 0.86;
  if (vCrowdMat > 3.5) cR = 0.2;
  else if (vCrowdMat > 2.5) cR = 0.46;
  else if (vCrowdMat > 1.5) cR = 0.5;
  else if (vCrowdMat > 0.5) cR = 0.62;
  roughnessFactor = cR;
}
`

const DITHER_FRAG = /* glsl */ `
{
  float cNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (cNoise < vCrowdLod.x || cNoise >= vCrowdLod.y) discard;
}
`

const RIM_FRAG = /* glsl */ `
{
  float cFres = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += vCrowdRim * vCrowdLod.z * (0.025 + 0.75 * cFres * cFres * cFres);
  // skin glows a little warm where it turns away from the eye: the cheap stand-in for light travelling through it
  if (vCrowdMat > 0.5 && vCrowdMat < 1.5) totalEmissiveRadiance += vCrowdBase * vec3(0.9, 0.38, 0.28) * 0.12 * cFres * cFres;
}
`

// ---------------------------------------------------------------------------------------------
// Gear: props and vehicles
// ---------------------------------------------------------------------------------------------

const GEAR_PARS_VERT = /* glsl */ `
uniform sampler2D uPose;
uniform vec3 uFixed[${FIXED_COUNT}];
attribute float aRow;
attribute float aKind;
attribute float aOff;
attribute vec2 aPart;
flat varying vec4 vCrowdLod;
varying vec3 vCrowdBase;
flat varying vec3 vCrowdRim;
`

/** Props ride the carrier's prop frame; vehicles sit `aOff` metres in front of the pusher's root. */
const GEAR_VERT = /* glsl */ `
int gRow = int(aRow + 0.5);
vec4 gRoot = texelFetch(uPose, ivec2(${TEX.root}, gRow), 0);
vec4 gLod = texelFetch(uPose, ivec2(${TEX.lod}, gRow), 0);
// the carrier's presence: the dither shows [0, presence)
vCrowdLod = vec4(0.0, gLod.z, 0.0, 0.0);
vCrowdRim = vec3(0.0);
int gSlot = int(aPart.y + 0.5);
vCrowdBase = gSlot < ${PALETTE_SLOTS} ? texelFetch(uPose, ivec2(${TEX.palette} + gSlot, gRow), 0).rgb : uFixed[gSlot - ${PALETTE_SLOTS}];
float gSn = sin(gRoot.w);
float gCs = cos(gRoot.w);
#ifdef GEAR_PROP
  // W3 wave B: the player's "You" badge rides its own frame (pinned on the realistic coat), every held item the prop frame. R2: an avatar's theatre cap
  // rides the cap frame (fitted on the skull)
  int gCol = ${TEX.parts} + (aKind > ${g(CAP_KIND - 0.5)} ? ${CAP_FRAME} : aKind > ${g(BADGE_KIND - 0.5)} ? ${BADGE_FRAME} : ${P.prop}) * 3;
  vec4 gM0 = texelFetch(uPose, ivec2(gCol, gRow), 0);
  vec4 gM1 = texelFetch(uPose, ivec2(gCol + 1, gRow), 0);
  vec4 gM2 = texelFetch(uPose, ivec2(gCol + 2, gRow), 0);
  vec3 gPos = vec3(dot(gM0.xyz, position) + gM0.w, dot(gM1.xyz, position) + gM1.w, dot(gM2.xyz, position) + gM2.w);
  vec3 gNrm = vec3(dot(cross(gM1.xyz, gM2.xyz), normal), dot(cross(gM2.xyz, gM0.xyz), normal), dot(cross(gM0.xyz, gM1.xyz), normal));
  gNrm = gNrm / (length(gNrm) + 1e-9);
#else
  vec3 gPos = position + vec3(0.0, 0.0, aOff);
  vec3 gNrm = normal;
#endif
vec3 gWorldPos = vec3(gCs * gPos.x + gSn * gPos.z, gPos.y, -gSn * gPos.x + gCs * gPos.z) + gRoot.xyz;
vec3 gWorldNrm = vec3(gCs * gNrm.x + gSn * gNrm.z, gNrm.y, -gSn * gNrm.x + gCs * gNrm.z);
`

function patchBody(shader: WebGLProgramParametersWithUniforms, lod: BodyLod, pose: DataTexture, fixed: Color[]): void {
  shader.uniforms.uPose = { value: pose } as IUniform
  shader.uniforms.uLod = { value: lod } as IUniform
  shader.uniforms.uFixed = { value: fixed } as IUniform
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${PARS_VERT}`)
    .replace('#include <beginnormal_vertex>', `${BODY_VERT}\nvec3 objectNormal = normalize(cWorldNrm + vec3(0.0, 1e-8, 0.0));`)
    .replace('#include <begin_vertex>', 'vec3 transformed = cWorldPos;')
    // the details a person does not wear are collapsed out of view (near bodies only; the far figure has none)
    .replace('#include <project_vertex>', '#include <project_vertex>\nif (cHide) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${PARS_FRAG}${PARS_FRAG_BODY}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${DITHER_FRAG}`)
    .replace('#include <color_fragment>', 'diffuseColor.rgb *= vCrowdBase;')
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH_FRAG}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${RIM_FRAG}`)
}

function patchGear(shader: WebGLProgramParametersWithUniforms, pose: DataTexture, fixed: Color[]): void {
  shader.uniforms.uPose = { value: pose } as IUniform
  shader.uniforms.uFixed = { value: fixed } as IUniform
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${GEAR_PARS_VERT}`)
    .replace('#include <beginnormal_vertex>', `${GEAR_VERT}\nvec3 objectNormal = normalize(gWorldNrm + vec3(0.0, 1e-8, 0.0));`)
    .replace('#include <begin_vertex>', 'vec3 transformed = gWorldPos;')
    // every kind of one draw shares the vertex buffer: collapse the vertices of the kinds this instance is not
    .replace('#include <project_vertex>', '#include <project_vertex>\nif (abs(aPart.x - aKind) > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${PARS_FRAG}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${DITHER_FRAG}`)
    .replace('#include <color_fragment>', 'diffuseColor.rgb *= vCrowdBase;')
}

// ---------------------------------------------------------------------------------------------
// Realistic people (W3 wave B): linear-blend skinning from the same pose rows, a textured atlas, garment tints
// ---------------------------------------------------------------------------------------------

const AVATAR_PARS_VERT = /* glsl */ `
uniform sampler2D uPose;
uniform float uLod;
attribute float aRow;
attribute vec4 aJoints;
attribute vec4 aWeights;
flat varying vec4 vCrowdLod;
flat varying vec3 vCrowdRim;
flat varying vec2 vCrowdTint;
flat varying vec3 vCrowdTop;
flat varying vec3 vCrowdBottom;
`

/** One influence: add weight w of part j's row (already M_p * B_p^-1, see avatars.ts applyBinds) to the blend. */
const influence = (c: string): string => /* glsl */ `
  if (aWeights.${c} > 0.0) {
    int cCol = ${TEX.parts} + int(aJoints.${c} + 0.5) * 3;
    cR0 += aWeights.${c} * texelFetch(uPose, ivec2(cCol, cRow), 0);
    cR1 += aWeights.${c} * texelFetch(uPose, ivec2(cCol + 1, cRow), 0);
    cR2 += aWeights.${c} * texelFetch(uPose, ivec2(cCol + 2, cRow), 0);
  }`

/**
 * Same contract as BODY_VERT (cWorldPos, cWorldNrm, the LOD band and the rim), with 4-weight skinning instead of one rigid part; plus the person's
 * tint: which garments take a colour (the bits in TEX.size.z, avatars.ts TINT) and the colours (the palette's top and trousers slots).
 */
const AVATAR_VERT = /* glsl */ `
int cRow = int(aRow + 0.5);
vec4 cRoot = texelFetch(uPose, ivec2(${TEX.root}, cRow), 0);
vec4 cLod = texelFetch(uPose, ivec2(${TEX.lod}, cRow), 0);
float cLo = uLod < 0.5 ? 0.0 : (uLod < 1.5 ? cLod.x : cLod.y);
float cHi = uLod < 0.5 ? cLod.x : (uLod < 1.5 ? cLod.y : cLod.z);
vCrowdLod = vec4(cLo, cHi, cLod.w, 0.0);
vCrowdRim = texelFetch(uPose, ivec2(${TEX.rim}, cRow), 0).rgb;
float cTintBits = texelFetch(uPose, ivec2(${TEX.size}, cRow), 0).z;
vCrowdTint = vec2(mod(cTintBits + 0.5, 2.0) > 1.0 ? 1.0 : 0.0, cTintBits > 1.5 ? 1.0 : 0.0);
vCrowdTop = texelFetch(uPose, ivec2(${TEX.palette + SLOT.top}, cRow), 0).rgb;
vCrowdBottom = texelFetch(uPose, ivec2(${TEX.palette + SLOT.pants}, cRow), 0).rgb;
vec4 cR0 = vec4(0.0);
vec4 cR1 = vec4(0.0);
vec4 cR2 = vec4(0.0);
${influence('x')}
${influence('y')}
${influence('z')}
${influence('w')}
vec3 cPos = vec3(dot(cR0.xyz, position) + cR0.w, dot(cR1.xyz, position) + cR1.w, dot(cR2.xyz, position) + cR2.w);
vec3 cNrm = vec3(dot(cross(cR1.xyz, cR2.xyz), normal), dot(cross(cR2.xyz, cR0.xyz), normal), dot(cross(cR0.xyz, cR1.xyz), normal));
cNrm = cNrm / (length(cNrm) + 1e-9);
float cSn = sin(cRoot.w);
float cCs = cos(cRoot.w);
vec3 cWorldPos = vec3(cCs * cPos.x + cSn * cPos.z, cPos.y, -cSn * cPos.x + cCs * cPos.z) + cRoot.xyz;
vec3 cWorldNrm = vec3(cCs * cNrm.x + cSn * cNrm.z, cNrm.y, -cSn * cNrm.x + cCs * cNrm.z);
`

const AVATAR_PARS_FRAG = /* glsl */ `
uniform vec4 uHair;
uniform vec2 uTintRef;
uniform vec2 uTintExp;
flat varying vec4 vCrowdLod;
flat varying vec3 vCrowdRim;
flat varying vec2 vCrowdTint;
flat varying vec3 vCrowdTop;
flat varying vec3 vCrowdBottom;
`

/**
 * The atlas alpha (tools/people-lib.ts MASK): in the hair region (uHair: u0, v0, u1, v1) it is the opacity of the hair cards, cut at 0.5 (the only
 * alpha test); everywhere else it is the garment mask, 255 untinted, 170 the top garment, 85 the bottom one. A tinted garment takes the person's
 * colour at its own shading: colour x (luminance / the avatar's reference luminance) ^ contrast, at most ${TINT_MAX_GAIN}x the colour.
 */
const AVATAR_TINT_FRAG = /* glsl */ `
{
  float cMask = diffuseColor.a;
  if (vMapUv.x >= uHair.x && vMapUv.x <= uHair.z && vMapUv.y >= uHair.y && vMapUv.y <= uHair.w) {
    if (cMask < 0.5) discard;
  } else {
    float cLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float cTop = vCrowdTint.x * clamp(1.0 - abs(cMask - 0.6667) * 6.0, 0.0, 1.0);
    float cBottom = vCrowdTint.y * clamp(1.0 - abs(cMask - 0.3333) * 6.0, 0.0, 1.0);
    if (cTop > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vCrowdTop * min(pow(cLum / uTintRef.x, uTintExp.x), ${g(TINT_MAX_GAIN)}), cTop);
    if (cBottom > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vCrowdBottom * min(pow(cLum / uTintRef.y, uTintExp.y), ${g(TINT_MAX_GAIN)}), cBottom);
  }
  diffuseColor.a = 1.0;
}
`

/** The rim of the emphasis states (selected, followed, hovered), as on the procedural bodies. */
const AVATAR_RIM_FRAG = /* glsl */ `
{
  float cFres = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += vCrowdRim * vCrowdLod.z * (0.025 + 0.75 * cFres * cFres * cFres);
}
`

/** The per-material uniforms of one avatar body: which LOD band it draws, where its hair is, its garments' tint references. */
export interface AvatarUniforms {
  uLod: IUniform<number>
  uHair: IUniform<Vector4>
  uTintRef: IUniform<Vector2>
  uTintExp: IUniform<Vector2>
}

function patchAvatarBody(shader: WebGLProgramParametersWithUniforms, pose: DataTexture, u: AvatarUniforms): void {
  shader.uniforms.uPose = { value: pose } as IUniform
  shader.uniforms.uLod = u.uLod
  shader.uniforms.uHair = u.uHair
  shader.uniforms.uTintRef = u.uTintRef
  shader.uniforms.uTintExp = u.uTintExp
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${AVATAR_PARS_VERT}`)
    .replace('#include <beginnormal_vertex>', `${AVATAR_VERT}\nvec3 objectNormal = normalize(cWorldNrm + vec3(0.0, 1e-8, 0.0));`)
    .replace('#include <begin_vertex>', 'vec3 transformed = cWorldPos;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${AVATAR_PARS_FRAG}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${DITHER_FRAG}`)
    .replace('#include <map_fragment>', `#include <map_fragment>\n${AVATAR_TINT_FRAG}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${AVATAR_RIM_FRAG}`)
}

/** The one program every avatar body of every LOD shares (the light volume's key composed in). */
export const AVATAR_PROGRAM_KEY = `hospital-crowd-avatar-v1+${LIGHT_VOLUME_KEY}`

/** The uniform values of an avatar: its hair rectangle as (u0, v0, u1, v1) (nothing when it has no hair cards), its tint references. */
export function avatarUniformValues(entry: Pick<AvatarEntry, 'atlas' | 'tintRef'>): { hair: [number, number, number, number]; ref: [number, number]; exp: [number, number] } {
  const h = entry.atlas.hair
  const hair: [number, number, number, number] = h ? [h[0], h[1], h[0] + h[2], h[1] + h[3]] : [2, 2, -2, -2]
  const ref: [number, number] = [Math.max(entry.tintRef.top, 1e-3), Math.max(entry.tintRef.bottom, 1e-3)]
  return { hair, ref, exp: [tintContrast(entry.tintRef.top), tintContrast(entry.tintRef.bottom)] }
}

/**
 * The near, mid and far body materials of one avatar: its atlas on a standard material whose vertex stage skins the person from the pose texture.
 * Every avatar shares one program (AVATAR_PROGRAM_KEY; the LOD band, the hair rectangle and the tint references are uniforms). No depth or shadow
 * materials: people do not cast (their blob shadows stay). Not alpha tested as a material: the hair region's cut is in the shader.
 */
export function createAvatarMaterials(pose: DataTexture, atlas: Texture, entry: Pick<AvatarEntry, 'id' | 'atlas' | 'tintRef'>): [MeshStandardMaterial, MeshStandardMaterial, MeshStandardMaterial] {
  const v = avatarUniformValues(entry)
  return [0, 1, 2].map((lod) => {
    const m = new MeshStandardMaterial({ map: atlas, side: DoubleSide, roughness: 0.72, metalness: 0 })
    m.name = `crowd-avatar-${entry.id}-${lod}`
    const u: AvatarUniforms = {
      uLod: { value: lod },
      uHair: { value: new Vector4(...v.hair) },
      uTintRef: { value: new Vector2(...v.ref) },
      uTintExp: { value: new Vector2(...v.exp) },
    }
    m.userData.avatarUniforms = u
    // W3: the baked light volume, applied last
    m.onBeforeCompile = (sh) => {
      patchAvatarBody(sh, pose, u)
      applyLightVolume(sh)
    }
    m.customProgramCacheKey = () => AVATAR_PROGRAM_KEY
    return m
  }) as [MeshStandardMaterial, MeshStandardMaterial, MeshStandardMaterial]
}

export interface CrowdMaterials {
  /** Index by BodyLod. */
  body: [MeshStandardMaterial, MeshStandardMaterial, MeshStandardMaterial]
  props: MeshStandardMaterial
  vehicles: MeshStandardMaterial
  /** The soft ground blob under every person and vehicle, with a per-instance `aFade`. */
  blob: MeshBasicMaterial
  ring: MeshBasicMaterial
  dispose(): void
}

function fixedColors(): Color[] {
  return FIXED_COLORS.map((hex) => new Color(hex))
}

export function createBlobTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(14, 34, 34, 0.55)')
  g.addColorStop(0.5, 'rgba(14, 34, 34, 0.26)')
  g.addColorStop(1, 'rgba(14, 34, 34, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  return map
}

export function createCrowdMaterials(pose: DataTexture): CrowdMaterials {
  const fixed = fixedColors()
  const body = [0, 1, 2].map((i) => {
    const m = new MeshStandardMaterial({ roughness: 0.78, metalness: 0 })
    if (i === 2) m.defines = { CROWD_FAR: '' }
    // W3: the baked light volume (src/scene/lighting), applied last
    m.onBeforeCompile = (s) => {
      patchBody(s, i as BodyLod, pose, fixed)
      applyLightVolume(s)
    }
    m.customProgramCacheKey = () => `hospital-crowd-body-${i === 2 ? 'far' : 'near'}-v2+${LIGHT_VOLUME_KEY}`
    return m
  }) as CrowdMaterials['body']

  const props = new MeshStandardMaterial({ roughness: 0.62, metalness: 0 })
  props.defines = { GEAR_PROP: '' }
  props.onBeforeCompile = (s) => {
    patchGear(s, pose, fixed)
    applyLightVolume(s)
  }
  props.customProgramCacheKey = () => `hospital-crowd-props-v1+${LIGHT_VOLUME_KEY}`

  const vehicles = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 })
  vehicles.onBeforeCompile = (s) => {
    patchGear(s, pose, fixed)
    applyLightVolume(s)
  }
  vehicles.customProgramCacheKey = () => `hospital-crowd-vehicles-v1+${LIGHT_VOLUME_KEY}`

  const map = createBlobTexture()
  const blob = new MeshBasicMaterial({
    map,
    color: new Color('#ffffff'),
    transparent: true,
    opacity: map ? 1 : 0.18,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  blob.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vFade;')
  }
  blob.customProgramCacheKey = () => 'hospital-crowd-blob-v1'

  const ring = new MeshBasicMaterial({ color: new Color(RING_COLORS.selected), transparent: true, opacity: 0.7, depthWrite: false, depthTest: false, toneMapped: false, side: DoubleSide, fog: false })

  return {
    body,
    props,
    vehicles,
    blob,
    ring,
    dispose() {
      for (const m of body) m.dispose()
      props.dispose()
      vehicles.dispose()
      blob.map?.dispose()
      blob.dispose()
      ring.dispose()
    },
  }
}
