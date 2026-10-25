/**
 * `?probe=1`: `window.__hospitalBakeLight`, to check the bake-matched light in the browser (realism step 2):
 *
 *   state()          { ready, sources, owned, uniforms: { on, gain, spec, key, ao } }
 *   at(x, y, z)      the field at a drawn point: { weight, up, down, side } (what a white surface facing that way reflects, E / PI, luminance;
 *                    compare `up` with the floor's lightmap brightness there), or null before the field is built
 *   force(v | null)  pin `uBkOn` to v (0 = the old live light on people, 1 = the bake's) for an A/B without a reload; null gives it back to the
 *                    daylight driver (it rewrites on its next change)
 */
import { CELL_FLOATS, sampleBakeField } from './field'
import { shDigest, SH_FLOATS } from './sh'
import { bakeState, bakeUniforms } from './uniforms'

const sample = new Float32Array(CELL_FLOATS)
const coeffs = new Float32Array(SH_FLOATS)

/** The field's light at a drawn point (premultiplied coefficients divided back by the weight). */
export function bakeLightAt(x: number, y: number, z: number): { weight: number; up: number; down: number; side: number } | null {
  const field = bakeState.field
  if (!field) return null
  sampleBakeField(field, x, y, z, sample)
  const w = sample[SH_FLOATS]
  if (!(w > 1e-4)) return { weight: 0, up: 0, down: 0, side: 0 }
  for (let k = 0; k < SH_FLOATS; k++) coeffs[k] = sample[k] / w
  const d = shDigest(coeffs)
  const r = (v: number): number => Math.round(v * 1000) / 1000
  return { weight: r(w), up: r(d.up), down: r(d.down), side: r(d.side) }
}

export function installBakeProbe(): () => void {
  if (typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('probe')) return () => undefined
  const w = window as unknown as Record<string, unknown>
  w.__hospitalBakeLight = {
    state: () => ({
      ready: bakeState.ready,
      sources: [...bakeState.sources],
      owned: [...bakeState.owned],
      forced: bakeState.force,
      uniforms: {
        on: bakeUniforms.uBkOn.value,
        gain: bakeUniforms.uBkGain.value,
        spec: bakeUniforms.uBkSpec.value,
        key: bakeUniforms.uBkKey.value,
        ao: bakeUniforms.uBkAo.value,
      },
    }),
    at: bakeLightAt,
    force: (v: number | null) => {
      bakeState.force = v === null ? null : Math.min(1, Math.max(0, v))
      if (bakeState.force !== null) bakeUniforms.uBkOn.value = bakeState.force
      return bakeState.force
    },
  }
  return () => {
    delete w.__hospitalBakeLight
  }
}
