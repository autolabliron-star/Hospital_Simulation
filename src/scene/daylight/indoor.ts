/**
 * The indoor light preset (W1 walk mode): when you walk the hospital the building has ceilings, so the sun no longer pours in and the
 * rooms should feel lit from above. `indoor` is a 0..1 blend (0 the overview's daylight, 1 fully indoors) that the driver eases toward
 * 1 while the player is not in the overview. It scales three numbers the driver already writes, and nothing else:
 *
 *   sun          x 0.35   less direct light and softer shading: there is no roof for it to come through, and the baked shadow map (which holds
 *                         only the cut-height building) would otherwise paint sun patches into rooms that now have ceilings;
 *   hemisphere   x 1.5    the fill that lights floors and furniture from "above";
 *   environment  x 2.2    the soft reflected light on walls, ceilings and the underside of things.
 *
 * The windows keep their light: the glass tint and the sky colour are not touched. The sun's colour follows the hour as before (so a
 * golden evening still tints the little sun that is left), and every factor multiplies the light of the hour, so night stays night.
 * Uniforms and intensities only: no new lights, no `needsUpdate`, no defines, the sun's direction untouched (shadowBake.test.ts).
 *
 * The numbers are by reasoning, not by eye (no browser here): tune them in this one place. If AO feels heavy indoors, shrink its
 * radius in src/scene/Effects.tsx (see the change requests).
 */

/** The factors at full indoor blend. */
export const INDOOR = { sun: 0.35, hemi: 1.5, env: 2.2 } as const

/** Seconds the blend takes to follow the mode (an exponential follow, a touch quicker than the sky's 0.8). */
export const INDOOR_SECONDS = 0.6

/** The multiplier at blend `k` (0..1) for a factor at full indoor blend. */
export const indoorFactor = (full: number, k: number): number => 1 + (full - 1) * k

/** Walk geometry (and the indoor light) shows whenever the mode is not 'overview'. No player yet: the overview. */
export function indoorTarget(mode: string | undefined): 0 | 1 {
  return mode !== undefined && mode !== 'overview' ? 1 : 0
}
