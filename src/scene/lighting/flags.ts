/**
 * W3 debug flags for the realistic light, read once from the URL. All of them change uniforms and which environment is bound, never a shader
 * variant, so flipping one needs a reload, not a recompile, and the program count is the same with every flag.
 *
 *   ?look=model   the architect's-model light in walk mode too: the M5 indoor preset (sun x0.35, hemisphere x1.5, environment x2.2), no light
 *                 volume, no grade, no vignette, no reflections, RoomEnvironment. The A/B against the new look.
 *   ?lv=0         no light volume (the volume fetch is skipped in the shader: this is also how its GPU cost is measured)
 *   ?refl=0       no ceiling-panel reflection on the floors
 *   ?env=room     keep RoomEnvironment as the one environment in walk mode (the fallback if the swap at the Tab flight ever pops)
 *
 * Pure (a string in, a record out) so the tests run in node.
 */
export interface LightingFlags {
  /** `?look=model` */
  model: boolean
  /** False with `?lv=0`. */
  volume: boolean
  /** False with `?refl=0`. */
  reflect: boolean
  /** True with `?env=room`. */
  roomEnv: boolean
}

export function parseLightingFlags(search: string): LightingFlags {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    params = new URLSearchParams()
  }
  return {
    model: params.get('look') === 'model',
    volume: params.get('lv') !== '0',
    reflect: params.get('refl') !== '0',
    roomEnv: params.get('env') === 'room',
  }
}

/** The flags of this page (all default in node). */
export const LIGHTING_FLAGS: Readonly<LightingFlags> = parseLightingFlags(typeof window === 'undefined' ? '' : window.location.search)
