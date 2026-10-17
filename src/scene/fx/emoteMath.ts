/**
 * The numbers behind the emote icons: the pop and fade curves, how big an icon is at a given distance from
 * the camera, and when it is out of range. All pure, so they are unit tested without a browser.
 */

/** Seconds for an icon to pop in (scale 0 -> 1.1 -> 1). */
export const POP_SECONDS = 0.25
/** Overshoot of the pop. */
export const POP_PEAK = 1.1
/** Fraction of the pop at which the overshoot peaks. */
export const POP_PEAK_AT = 0.6
/** Seconds for the icon's opacity to rise when it appears, and to fall when it clears. */
export const FADE_IN_SECONDS = 0.12
export const FADE_OUT_SECONDS = 0.22

/** Smooth 0..1 ramp with zero slope at both ends (so curves built from it have no kinks). */
export function smoothstep01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x
  return t * t * (3 - 2 * t)
}

/**
 * Scale of an icon `u` (0..1) of the way through its pop-in: rises smoothly to POP_PEAK at POP_PEAK_AT, then eases
 * back to 1. Continuous, flat at both ends and the peak, and rising then falling only once.
 */
export function popScale(u: number): number {
  if (!(u > 0)) return 0
  if (u >= 1) return 1
  if (u < POP_PEAK_AT) return POP_PEAK * smoothstep01(u / POP_PEAK_AT)
  return POP_PEAK + (1 - POP_PEAK) * smoothstep01((u - POP_PEAK_AT) / (1 - POP_PEAK_AT))
}

/** Opacity for a fade `level` (0 = gone, 1 = fully shown): the eased shape of both the fade in and the fade out. */
export function fadeCurve(level: number): number {
  return smoothstep01(level)
}

// ---------------------------------------------------------------------------------------------
// Distance behaviour
// ---------------------------------------------------------------------------------------------

/** Icons are hidden beyond this distance from the camera (metres), after a fade over the last 20 m. */
export const MAX_RANGE = 160
export const RANGE_FADE_START = 140

/**
 * Size of the quad in metres at distance `d` from the camera. The icon grows with distance as d^EXPONENT, a bit less
 * than linearly, so on screen it shrinks only slowly (about 2x from 6 m to the 110 m overview) instead of vanishing,
 * and it stays a natural size next to a person at mid range. Clamped, so up close it never swells over the person
 * and from far away it never becomes a billboard bigger than a room.
 */
export const ICON = {
  /** Quad size at REF_DISTANCE (the badge itself fills 75 % of the quad). */
  base: 0.5,
  refDistance: 16,
  exponent: 0.85,
  minScale: 0.4,
  maxScale: 4,
} as const

export function emoteWorldSize(d: number): number {
  const k = Math.pow(Math.max(d, 0) / ICON.refDistance, ICON.exponent)
  return ICON.base * (k < ICON.minScale ? ICON.minScale : k > ICON.maxScale ? ICON.maxScale : k)
}

/** 1 within RANGE_FADE_START, falling smoothly to 0 at MAX_RANGE. */
export function rangeFade(d: number): number {
  if (d <= RANGE_FADE_START) return 1
  if (d >= MAX_RANGE) return 0
  return 1 - smoothstep01((d - RANGE_FADE_START) / (MAX_RANGE - RANGE_FADE_START))
}

/** Where the quad centre sits above the anchor, as a fraction of the quad size (puts the badge's bottom on the anchor). */
export const CENTRE_LIFT = 0.4
/** Top of the badge above the anchor, as a fraction of the quad size. */
export const BADGE_TOP = 0.78

/** How far above the anchor a speech bubble must start so it clears the emote badge shown at distance `d`. */
export function emoteStackHeight(d: number): number {
  return emoteWorldSize(d) * BADGE_TOP + 0.06
}
