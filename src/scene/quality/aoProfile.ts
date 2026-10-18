/**
 * The ambient-occlusion settings for each situation, as a fixed table (pure: no three.js, so it runs under vitest in node).
 * Effects.tsx writes the row into the N8AO pass's `configuration` through a ref whenever the player mode or the quality rung changes.
 *
 * Why only these knobs: `aoSamples` and `denoiseSamples` make n8ao rebuild its ShaderMaterial, which compiles a new program on the
 * next draw. That is exactly the hitch the warm-up exists to remove, and the ladder only steps down when the frame rate is
 * already struggling. `aoRadius`, `intensity` and `denoiseIterations` (a loop count in n8ao's JS, so one blur pass fewer) change
 * no shader. 'off' disables the pass (`pass.enabled = false`): the composer skips it, and nothing is remounted or recompiled.
 *
 *   full   the look as designed
 *   light  a smaller radius (the samples land closer together, which is kinder to the texture cache), a little less strength to
 *          match, and one denoise pass instead of two
 *   off    the pass is skipped
 */
import type { AoLevel } from './ladder'

/** AO radius (metres) and strength per player mode. Walk mode: at eye level under ceilings, the overview's wide AO darkens every joint. */
export const AO_OVERVIEW = { aoRadius: 1.4, intensity: 2.2 } as const
export const AO_WALK = { aoRadius: 0.8, intensity: 1.6 } as const

/** n8ao's default number of blur passes. */
export const DENOISE_FULL = 2
export const DENOISE_LIGHT = 1
const LIGHT_RADIUS = 0.6
const LIGHT_INTENSITY = 0.9

export interface AoSettings {
  /** False skips the pass entirely. */
  readonly enabled: boolean
  readonly aoRadius: number
  readonly intensity: number
  readonly denoiseIterations: number
}

function row(base: { aoRadius: number; intensity: number }, level: AoLevel): AoSettings {
  switch (level) {
    case 'light':
      return { enabled: true, aoRadius: base.aoRadius * LIGHT_RADIUS, intensity: base.intensity * LIGHT_INTENSITY, denoiseIterations: DENOISE_LIGHT }
    case 'off':
      return { enabled: false, aoRadius: base.aoRadius, intensity: base.intensity, denoiseIterations: DENOISE_FULL }
    default:
      return { enabled: true, aoRadius: base.aoRadius, intensity: base.intensity, denoiseIterations: DENOISE_FULL }
  }
}

const TABLE: Record<'overview' | 'walk', Record<AoLevel, AoSettings>> = {
  overview: { full: row(AO_OVERVIEW, 'full'), light: row(AO_OVERVIEW, 'light'), off: row(AO_OVERVIEW, 'off') },
  walk: { full: row(AO_WALK, 'full'), light: row(AO_WALK, 'light'), off: row(AO_WALK, 'off') },
}

/** The AO settings for a player mode and a quality level. Returns a shared row: do not modify it. Safe to call every frame. */
export function aoSettings(mode: string, level: AoLevel): AoSettings {
  return TABLE[mode === 'overview' ? 'overview' : 'walk'][level]
}
