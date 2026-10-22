/**
 * The look table (W3): every number that makes the walk-mode light different from the overview's, in one pure place. The daylight driver
 * blends two rows with the indoor blend it already has (0 in the overview, 1 while walking, eased over INDOOR_SECONDS), so Tab crossfades
 * the whole look and nothing recompiles: every field below ends up in a uniform, a light intensity, a blend opacity or a tone-mapping exposure.
 *
 *   LOOK_OVERVIEW   blend 0: EXACTLY today's values (every factor 1, every addition 0). look.test.ts holds it to that.
 *   LOOK_WALK       blend 1: the realistic indoor look.
 *   LOOK_MODEL_WALK `?look=model`: the M5 walk preset (the light of the hour x0.35 / x1.5 / x2.2) with none of the W3 additions: the A/B.
 *
 * The numbers were chosen by reasoning, not by eye (no browser in the build). The irradiance an up-facing surface gets at noon: the overview
 * has about 3.7 (hemisphere 0.75 + environment 0.35 x 5.3 + sun 1.05 on average). The walk look keeps the open air (the atrium, the plaza) within
 * about 10 % of that (hemisphere 0.68 + environment 1.4 + sky through the volume 1.0 + the sun that is left 0.3) and the rooms a little under
 * it: about 3.2 on a floor (hemisphere 0.65 + environment 1.3 + ceiling panels 0.85 + sun 0.4), about 2.3 on a wall (hemisphere 0.6 + environment
 * 0.9 + panels 0.65 + sun 0.15), which tone-maps (Neutral) to a bright, not blown-out, white. Tune them here and nowhere else.
 */

/** One row of the table. Factors multiply the light of the hour; the rest are strengths in [0, ~1.5]. */
export interface Look {
  /** Multiplier on the sun's, the hemisphere's and the environment's intensity (the light of the hour is the base). */
  sun: number
  hemi: number
  env: number
  /** `renderer.toneMappingExposure`: read by the post-processing tone mapper (the canvas itself is flat). */
  exposure: number
  /** Light volume: irradiance added under the ceiling panels (through their colour), by the windows and the open sky, and how strongly its AO darkens the indirect light. */
  panelGain: number
  skyGain: number
  ao: number
  /** Ceiling-panel reflection on the floors (0 = none). */
  reflect: number
  /** 0..1: how far the floors' roughness is toward FLOOR_WALK_ROUGHNESS. */
  floorRough: number
  /** Glass opacity gained at grazing angles (0 = none). */
  glass: number
  /** The colour grade's blend opacity (0 = the LUT is the identity) and the vignette's darkness. */
  grade: number
  vignette: number
}

export const LOOK_KEYS = ['sun', 'hemi', 'env', 'exposure', 'panelGain', 'skyGain', 'ao', 'reflect', 'floorRough', 'glass', 'grade', 'vignette'] as const

export const LOOK_OVERVIEW: Readonly<Look> = {
  sun: 1,
  hemi: 1,
  env: 1,
  exposure: 1,
  panelGain: 0,
  skyGain: 0,
  ao: 0,
  reflect: 0,
  floorRough: 0,
  glass: 0,
  grade: 0,
  vignette: 0,
}

export const LOOK_WALK: Readonly<Look> = {
  // the sun is blocked by the ceilings (the baked shadow only holds the cut-height walls) but is the outdoor cue on the plaza and in the atrium
  sun: 0.3,
  // a little under the overview's: the light volume now brings the room's own bounce, so the old x1.5 boost goes
  hemi: 0.9,
  // below 1 on purpose: the W1 boost of x2.2 is gone, and the hospital environment (bound while walking) lights a room's floor and ceiling about
  // as much as RoomEnvironment does (see HOSPITAL_ENV_MATCH), so 0.75 keeps the ambient well under the overview's, the panels bringing the rest
  env: 0.75,
  exposure: 1.05,
  panelGain: 1.3,
  skyGain: 1.2,
  ao: 1,
  reflect: 1.5,
  floorRough: 1,
  glass: 1,
  grade: 1,
  vignette: 1,
}

/** `?look=model`: the walk-in preset of M5 and nothing of W3 (also what `INDOOR` in ../daylight/indoor.ts always said). */
export const LOOK_MODEL_WALK: Readonly<Look> = { ...LOOK_OVERVIEW, sun: 0.35, hemi: 1.5, env: 2.2 }

/**
 * The environment bound while walking (hospitalEnvironment.ts) against RoomEnvironment, at the same intensity. Measured with a cosine-weighted
 * Monte Carlo of both scenes' geometry from the origin (the irradiance a surface facing each way gets from the environment):
 *
 *   facing    up     down    +x     -x     +z     -z    mean
 *   Room     5.19    1.72   2.69   2.14   5.25   2.05   3.18
 *   Hospital 5.29    1.32   3.34   3.43   3.32   2.52   3.20
 *
 * The hospital's is the same overhead and on average (a floor, a ceiling, the tops of things look the same), more from the sides and less from
 * the glass side's +z and from below: so the ambient is continuous at the swap, and this multiplier on its intensity is 1. It stays a named
 * number so a future change to the room (a brighter panel grid) is a one-line match; hospitalEnvironment.test.ts keeps the estimate honest.
 */
export const HOSPITAL_ENV_MATCH = 1.0
/**
 * The same multiplier for the lobby reflection probe (`?building=model`, src/scene/lighting/env/lobbyProbe.ts): bound while the camera is in the
 * pilot region. 1 until the baked HDR is judged on screen (it is a Blender render of the lobby, so its brightness is the lobby's own).
 */
export const LOBBY_ENV_MATCH = 1.0
export const ENV_SWAP_AT = 0.5
/** Hysteresis (blend units) so a flight reversed at the middle never flickers between the environments. */
export const ENV_SWAP_BAND = 0.04

/** The walk-mode roughness of every floor material (the base values stay in materials.ts). Floors only: the reflection reads it. */
export const FLOOR_WALK_ROUGHNESS: Readonly<Record<string, number>> = {
  floorOak: 0.45,
  floorTerrazzo: 0.3,
  floorMint: 0.32,
  floorCore: 0.26,
  floorSlate: 0.4,
  floorBlue: 0.32,
}

/**
 * The tone mapper. AgX (the Blender look: a soft shoulder, desaturated highlights, lifted shadows) for the whole app, behind this ONE constant so
 * it can be reverted to Khronos PBR Neutral ('neutral') by changing it: Effects.tsx picks the mode, the daylight driver multiplies every look's
 * exposure by `TONE_EXPOSURE_SCALE`, and nothing else knows. The mode is fixed for the page (it is a define of the one tone-mapping pass), so
 * nothing recompiles at runtime, including when presentation mode (C) is toggled.
 *
 * The scale is the AgX exposure that keeps the picture as bright as Neutral's was (today's look rows stay as they are, so the overview is still
 * exposure 1 x the scale). Worked out by evaluating both operators of three 0.186 on grey ramps (display sRGB, Neutral at its walk exposure 1.05
 * against AgX at 1.05 x 1.25 = 1.31):
 *
 *   scene linear     0.18    0.30    0.50    0.80    1.00
 *   Neutral          0.42    0.56    0.73    0.90    0.95
 *   AgX x1.25        0.55    0.64    0.72    0.79    0.82
 *
 * Mid-tones and the usual lit surfaces (0.3 to 0.6) land within 0.04; shadows are a little lighter and whites a little lower and softer: that is
 * the AgX look, not a mistake. A bare AgX at exposure 1 is 12 % darker through the middle and visibly grey, which is why the scale exists.
 */
export const TONE_MAP: 'agx' | 'neutral' = 'agx'
export const TONE_EXPOSURE_SCALE = TONE_MAP === 'agx' ? 1.25 : 1

/**
 * The bloom: today's numbers, and presentation mode's (C): gentler (intensity 0.2) and with a higher threshold (1.35), so only real emissive lights
 * glow and the bright sky seen through the glazing does not. Both are uniforms on the one bloom pass; the blend runs over `PRESENT_LOOK.seconds`.
 */
export const BLOOM = { intensity: 0.45, threshold: 1.0 } as const

/**
 * Presentation mode's look, blended in over `seconds` (Effects.tsx writes uniforms only: never a define, never a recompile):
 *   grade       the colour-grade LUT's opacity is multiplied by this (0: off, the picture is what the tone mapper makes it)
 *   vignette    the vignette's darkness is multiplied by this (a light vignette: 0.12 of darkness at full walk look)
 *   bloom       intensity and threshold, above
 */
export const PRESENT_LOOK = { grade: 0, vignette: 0.5, bloomIntensity: 0.2, bloomThreshold: 1.35, seconds: 0.6 } as const

/** The vignette's offset (constant; only the darkness moves). With darkness 0 the vignette is exactly the identity at any offset up to 1. */
export const VIGNETTE_OFFSET = 0.5
/** Darkness at full walk blend: the corners of the picture reach about 0.74 of their brightness, the middle of every edge is untouched (look.test.ts). */
export const VIGNETTE_DARKNESS = 0.25

const lerp = (a: number, b: number, k: number): number => (k >= 1 ? b : k <= 0 ? a : a + (b - a) * k)

/** The look at indoor blend `blend` (0..1), written into `out` (no allocation). `model` blends toward the M5 walk row instead. */
export function lookAt(blend: number, model: boolean, out: Look): Look {
  const to = model ? LOOK_MODEL_WALK : LOOK_WALK
  for (const key of LOOK_KEYS) out[key] = lerp(LOOK_OVERVIEW[key], to[key], blend)
  return out
}

export function createLook(): Look {
  return { ...LOOK_OVERVIEW }
}

/** The vignette's multiplier at normalised distance `d` from the centre (0.707 is a corner), a copy of postprocessing's DEFAULT technique. */
export function vignetteFactor(d: number, darkness: number, offset: number = VIGNETTE_OFFSET): number {
  const x = d * (darkness + offset)
  const e0 = 0.8
  const e1 = offset * 0.799
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * The ceiling panels' colour (the emissive colour of the walk ceiling in src/scene/building/render/walk/walkMaterials.ts) and the warm white
 * their light drifts toward as the rooms settle for the night (the daylight's `panelWarmth`, here scaled by PANEL_WARMTH).
 */
export const PANEL_COLOR = '#fff1d9'
export const PANEL_NIGHT_COLOR = '#ffc886'
export const PANEL_WARMTH = 0.5
/** The sky term never falls below this (moonlight through the windows): its level is `max(SKY_MIN, 1 - night)`. */
export const SKY_MIN = 0.06
