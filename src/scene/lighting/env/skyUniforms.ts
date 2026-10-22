/**
 * The sky dome's uniforms (src/scene/lighting/env/SkyDome.tsx): one object per uniform, shared with the dome's shader, written by the daylight
 * driver when the hour or the indoor blend changes (a few numbers, only on change, never a recompile).
 *
 *   uSky     the hour's sky colour (linear; the driver's `l.sky`: pale by day, peach at the edges of the day, deep blue-grey at night)
 *   uDay     1 in full daylight .. 0 in the dark (`1 - l.night`)
 *   uBlend   the indoor blend, 0 (the overview: the dome is not even drawn, the flat background colour shows) .. 1 (walking): how far the
 *            flat sky colour has become the gradient
 *
 * The day gradient's two ends are SCENE-LINEAR values chosen so that, through AgX at the walk exposure (1.05 x 1.25, look.ts), they land on a clear
 * mid-blue overhead (display sRGB about 0.47, 0.66, 0.91) and a pale hazy blue at the horizon (0.78, 0.85, 0.92). They were solved numerically with
 * three's AgX (AgX desaturates anything bright, so a bright sky needs a strongly blue linear colour), and they are deliberately only about 1.05 in
 * luminance at the horizon, so the bloom (threshold 1.0) barely touches the sky seen through a window. Change them here and nowhere else.
 */
import { Color } from 'three'
import type { Uni } from '../volume/uniforms'

/** Scene-linear day colours of the gradient: straight up, and at the horizon. */
export const SKY_ZENITH_DAY: readonly [number, number, number] = [0.041, 0.212, 1.339]
export const SKY_HORIZON_DAY: readonly [number, number, number] = [0.59, 1.081, 2.152]

const u = <T>(value: T): Uni<T> => ({ value })

export const skyUniforms = {
  uSky: u(new Color('#e9eeed')),
  uDay: u(1),
  uBlend: u(0),
  uZenith: u(new Color(SKY_ZENITH_DAY[0], SKY_ZENITH_DAY[1], SKY_ZENITH_DAY[2])),
  uHorizon: u(new Color(SKY_HORIZON_DAY[0], SKY_HORIZON_DAY[1], SKY_HORIZON_DAY[2])),
}
