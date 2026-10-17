/**
 * `MAT.tintedGlow` is meant to be tinted per instance ("tint comes from the instance"), but in three the emissive
 * term is NOT multiplied by the instance/vertex colour, so a white emissive washes every tint out to white. This
 * patches the shared material once (idempotent, flagged in `userData`) so the emissive follows the instance colour.
 * Colours above 1 are fine and make the light bloom: the status lights use about 1.3 to 2 x their STATUS colour.
 *
 * Imported for its side effect by every layer that draws status lights (pods, drawers, docks, desks), before the
 * first render compiles the material. Change request: move this into src/scene/materials.ts.
 */
import { MAT } from '@/scene/materials'

export const EMISSIVE_LINE = 'vec3 totalEmissiveRadiance = emissive;'
const TARGET = EMISSIVE_LINE
const PATCH = `${TARGET}
	#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
		totalEmissiveRadiance *= vColor.rgb;
	#endif`

export function ensureTintedGlow(): void {
  const m = MAT.tintedGlow
  if (m.userData.emissiveTint === true) return
  m.userData.emissiveTint = true
  const previous = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    previous.call(m, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(TARGET, PATCH)
  }
  m.customProgramCacheKey = () => 'tintedGlow:emissive-tint'
  m.needsUpdate = true
}

ensureTintedGlow()
