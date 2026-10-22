/**
 * The page's tone mapper when `TONE_MAP` is 'agx' (look.ts): ONE effect in the composer's merged pass (it replaces postprocessing's
 * ToneMappingEffect, so no extra pass or draw) that carries both AgX images and blends them with a uniform:
 *
 *   agxMix 0   three's `AgXToneMapping` at `renderer.toneMappingExposure`: exactly the picture the game always had (walk and overview);
 *   agxMix 1   Blender's AgX (view "AgX", look "AgX - Base Contrast": the look of the review stills), a 33^3 LUT sampled from Blender itself
 *              (./agxBlenderLut.ts), at `toneMappingExposure x agxGain` (look.ts PRESENT_EXPOSURE: the stills' +1.2 EV).
 *
 * Presentation mode (C) moves `agxMix` 0 -> 1 over PRESENT_LOOK.seconds (Effects.tsx); in between both are computed and mixed, at the ends only
 * one (a branch on a uniform: every pixel takes the same way). The shader is fixed for the page: toggling C changes two floats, never a define.
 *
 * The LUT is indexed by a log2 shaper of the scene-linear value (AGX_LUT_LOG2_MIN..MAX, texel centres) and holds display (sRGB-encoded) code
 * values; they are decoded back to linear here so the composer's own output encoding (and the grade and vignette after this) see linear light,
 * as they do after three's AgX.
 */
import { Effect, BlendFunction } from 'postprocessing'
import { ClampToEdgeWrapping, Data3DTexture, LinearFilter, NoColorSpace, RGBAFormat, Uniform, UnsignedByteType } from 'three'
import { AGX_LUT_LOG2_MAX, AGX_LUT_LOG2_MIN, AGX_LUT_SIZE, agxLutRgba } from './agxBlenderLut'

/** GLSL float literal. */
const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`)

/** The effect's fragment shader (exported for tests). */
export const PRESENT_TONE_FRAGMENT = `#include <tonemapping_pars_fragment>
uniform sampler3D agxLut;
uniform float agxMix;
uniform float agxGain;

vec3 agxBlender( vec3 color ) {
	vec3 l = log2( max( color, vec3( 1e-10 ) ) );
	vec3 s = clamp( ( l - ${f(AGX_LUT_LOG2_MIN)} ) / ${f(AGX_LUT_LOG2_MAX - AGX_LUT_LOG2_MIN)}, 0.0, 1.0 );
	vec3 d = texture( agxLut, s * ${f((AGX_LUT_SIZE - 1) / AGX_LUT_SIZE)} + ${f(0.5 / AGX_LUT_SIZE)} ).rgb;
	return sRGBTransferEOTF( vec4( d, 1.0 ) ).rgb;
}

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
	vec3 c = inputColor.rgb;
	vec3 o;
	if ( agxMix <= 0.0 ) {
		o = AgXToneMapping( c );
	} else if ( agxMix >= 1.0 ) {
		o = agxBlender( c * ( toneMappingExposure * agxGain ) );
	} else {
		o = mix( AgXToneMapping( c ), agxBlender( c * ( toneMappingExposure * agxGain ) ), agxMix );
	}
	outputColor = vec4( o, inputColor.a );
}
`

/** The LUT as a 3D texture (RGBA8, trilinear, clamped; raw values: the shader decodes them). */
export function createAgxLutTexture(): Data3DTexture {
  const t = new Data3DTexture(agxLutRgba(), AGX_LUT_SIZE, AGX_LUT_SIZE, AGX_LUT_SIZE)
  t.name = 'agx-blender-lut'
  t.format = RGBAFormat
  t.type = UnsignedByteType
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  t.wrapS = ClampToEdgeWrapping
  t.wrapT = ClampToEdgeWrapping
  t.wrapR = ClampToEdgeWrapping
  t.generateMipmaps = false
  t.unpackAlignment = 1
  t.colorSpace = NoColorSpace
  t.needsUpdate = true
  return t
}

export class PresentToneMappingEffect extends Effect {
  readonly lut: Data3DTexture
  /** 0 = three's AgX, 1 = Blender's (written by Effects.tsx). */
  readonly mix: Uniform<number>
  /** The exposure multiplier of the Blender image over the renderer's exposure. */
  readonly gain: Uniform<number>

  constructor(gain = 1) {
    const lut = createAgxLutTexture()
    const mix = new Uniform(0)
    const g = new Uniform(gain)
    super('PresentToneMappingEffect', PRESENT_TONE_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['agxLut', new Uniform(lut)],
        ['agxMix', mix],
        ['agxGain', g],
      ]),
    })
    this.lut = lut
    this.mix = mix
    this.gain = g
  }

  override dispose(): void {
    this.lut.dispose()
    super.dispose()
  }
}
