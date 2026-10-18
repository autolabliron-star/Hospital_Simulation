/**
 * The indoor light preset (W1 walk mode, retuned in W3): when you walk the hospital the building has ceilings, so the sun no longer pours in
 * and the rooms should feel lit from above. `indoor` is a 0..1 blend (0 the overview's daylight, 1 fully indoors) that the driver eases toward
 * 1 while the player is not in the overview. It scales three numbers the driver already writes, and its other W3 jobs are in the look table
 * (src/scene/lighting/look.ts, which holds every number):
 *
 *   sun          x 0.3    less direct light and softer shading: there is no roof for it to come through, and the baked shadow map (which holds
 *                         only the cut-height building) would otherwise paint sun patches into rooms that now have ceilings. The plaza and the
 *                         atrium keep a sun, and the light volume gives them the sky light that makes up the rest;
 *   hemisphere   x 0.9    W1 raised it x1.5 to light floors and furniture "from above"; the baked light volume now brings the rooms' own bounce
 *                         (the ceiling panels, the windows, the AO), so the boost is gone and it sits a little under the overview's;
 *   environment  x 0.75   W1 raised it x2.2 for the soft reflected light on walls and ceilings; the hospital environment (a ceiling of light
 *                         panels, bound while walking) gives the same ambient overhead as RoomEnvironment does, and the driver scales its
 *                         intensity by HOSPITAL_ENV_MATCH (1.0, measured: look.ts) to keep the level continuous at the swap.
 *
 * The windows keep their light: the glass tint and the sky colour are not touched. The sun's colour follows the hour as before (so a
 * golden evening still tints the little sun that is left), and every factor multiplies the light of the hour, so night stays night.
 * Uniforms and intensities only: no new lights, no `needsUpdate`, no defines, the sun's direction untouched (shadowBake.test.ts).
 * `?look=model` brings the W1 preset (sun x0.35, hemisphere x1.5, environment x2.2) back for comparison (LOOK_MODEL_WALK).
 *
 * The numbers are by reasoning, not by eye (no browser in the build): tune them in the look table, in one place.
 */
import { LOOK_WALK } from '@/scene/lighting/look'

/** The factors at full indoor blend (the look table's walk row). */
export const INDOOR = { sun: LOOK_WALK.sun, hemi: LOOK_WALK.hemi, env: LOOK_WALK.env } as const

/** Seconds the blend takes to follow the mode (an exponential follow, a touch quicker than the sky's 0.8). */
export const INDOOR_SECONDS = 0.6

/** The multiplier at blend `k` (0..1) for a factor at full indoor blend. */
export const indoorFactor = (full: number, k: number): number => 1 + (full - 1) * k

/** Walk geometry (and the indoor light) shows whenever the mode is not 'overview'. No player yet: the overview. */
export function indoorTarget(mode: string | undefined): 0 | 1 {
  return mode !== undefined && mode !== 'overview' ? 1 : 0
}
