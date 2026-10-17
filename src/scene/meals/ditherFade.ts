/**
 * Fading an instanced mesh in and out without ever popping and without transparency (no sorting, no extra draw calls): the
 * MealBot fades in at the service lift and out again, like people do (the crowd dithers too).
 *
 * `fadeMaterial` patches a material (a CLONE: never a shared palette material, whose program every other mesh uses) so that
 *   - mode 'dither': a pixel is discarded when a fixed screen-space noise value is above the instance's fade (0 to 1), a
 *     screen-door fade that stays solid, lit and shadow-free;
 *   - mode 'alpha': the instance's fade multiplies the alpha (for the soft blob shadow, which is transparent already).
 * The fade comes from a per-instance attribute `aFade`. The patch only touches the shader source, once, in `onBeforeCompile`.
 */
import type { Material, WebGLProgramParametersWithUniforms } from 'three'

export const FADE_ATTRIBUTE = 'aFade'

export type FadeMode = 'dither' | 'alpha'

/** Interleaved gradient noise in [0, 1): cheap, no texture, no arrays. */
const NOISE = 'fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) )'

export function patchFadeShader(shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader'>, mode: FadeMode): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute float ${FADE_ATTRIBUTE};\nvarying float vFade;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n\tvFade = ${FADE_ATTRIBUTE};`)
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;')
  if (mode === 'dither') {
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `void main() {\n\tif ( vFade <= ${NOISE} ) discard;`)
  } else {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= vFade;')
  }
}

/** Patch `material` (once) so it reads `aFade`. `key` names the program variant (it must differ from every other patch). */
export function fadeMaterial<M extends Material>(material: M, mode: FadeMode, key: string): M {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    patchFadeShader(shader, mode)
  }
  material.customProgramCacheKey = () => `${key}:${mode}`
  return material
}

const EMISSIVE_LINE = 'vec3 totalEmissiveRadiance = emissive;'

/**
 * In three the emissive term is not multiplied by the instance colour, so a white emissive washes every tint out. Patch a CLONE of
 * `MAT.tintedGlow` so its glow follows the instance colour (colours above 1 bloom): the same hook the shared material has.
 */
export function emissiveFollowsInstanceColor<M extends Material>(material: M): M {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(
      EMISSIVE_LINE,
      `${EMISSIVE_LINE}\n\t#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\n\t\ttotalEmissiveRadiance *= vColor.rgb;\n\t#endif`,
    )
  }
  return material
}
