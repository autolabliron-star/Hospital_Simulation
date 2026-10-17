/**
 * The light of the day (L1), as a pure function of the clock hour. No three.js, no React, no sim: `lightAt(hour)` returns the sun's
 * colour and intensity, the fill, the environment, the sky tint, the window glass, how warm and dim the room panels are, the level
 * of the corridor night lights and how bright the bedside screens are. Continuous over 0 to 24 h (and over midnight), brightest at
 * noon and darkest in the small hours, and it equals `LIGHT_NOON` (what src/scene/Lighting.tsx always used) from about 08:00 to 16:30.
 *
 * The SUN DIRECTION is not here and never changes: the building's shadow is baked once, so only the sun's colour and intensity may
 * move. The driver (./driver.ts) applies these numbers at 1 Hz through uniforms and existing light and material properties only.
 *
 * Colours are sRGB floats (0 to 1), mixed in sRGB, converted by whoever applies them.
 */
import { CONFIG } from '@/sim/config'

export type Rgb = [number, number, number]

export function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Full-day values: the ones the lighting rig had before L1, so the default 07:30 to 17:00 look is unchanged. */
export const LIGHT_NOON = {
  sunColor: '#fff6ea',
  sunIntensity: 1.75,
  hemiIntensity: 0.75,
  envIntensity: 0.35,
  sky: '#e9eeed',
  glassColor: '#d6efec',
  glassOpacity: 0.2,
} as const

const SUN_GOLDEN = rgb('#ffbe84')
const SUN_MOON = rgb('#8aa4d6')
const SKY_DUSK = rgb('#efd8c6')
const SKY_NIGHT = rgb('#141b27')
const GLASS_NIGHT = rgb('#243448')
const SUN_DAY = rgb(LIGHT_NOON.sunColor)
const SKY_DAY = rgb(LIGHT_NOON.sky)
const GLASS_DAY = rgb(LIGHT_NOON.glassColor)

const NIGHT = { sun: 0.1, hemi: 0.22, env: 0.1, glassOpacity: 0.4 } as const

/** Every number the day decides. Flat, so the driver can lerp it field by field. */
export interface DayLight {
  hour: number
  /** 0 in full daylight, 1 in the dark (outdoors): handy for the HUD and the tests. */
  night: number
  sun: Rgb
  sunIntensity: number
  hemiIntensity: number
  envIntensity: number
  /** The colour behind the building (scene.background). */
  sky: Rgb
  glass: Rgb
  glassOpacity: number
  /** In-room panels: 0..1 toward warm white, and a multiplier on their emissive intensity. */
  panelWarmth: number
  panelDim: number
  /** Bedside lamps (warm glow): multiplier. */
  lampLevel: number
  /** Corridor night lights: 0 by day, up to 1 deep at night. */
  nightLights: number
  /** Bedside screens (and a little of the door tiles): multiplier, 1 by day. */
  screens: number
}

export function createDayLight(): DayLight {
  return {
    hour: 12,
    night: 0,
    sun: [1, 1, 1],
    sunIntensity: 0,
    hemiIntensity: 0,
    envIntensity: 0,
    sky: [1, 1, 1],
    glass: [1, 1, 1],
    glassOpacity: 0,
    panelWarmth: 0,
    panelDim: 1,
    lampLevel: 1,
    nightLights: 0,
    screens: 1,
  }
}

/** The numeric fields (everything but the colours and the hour), for lerping and for tests. */
export const SCALAR_KEYS = ['night', 'sunIntensity', 'hemiIntensity', 'envIntensity', 'glassOpacity', 'panelWarmth', 'panelDim', 'lampLevel', 'nightLights', 'screens'] as const
export const COLOR_KEYS = ['sun', 'sky', 'glass'] as const

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
/** 0 below `a`, 1 above `b`, a smooth S in between. */
export function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
/** A smooth bump: 1 at `centre`, 0 beyond `width` either side. */
function bump(x: number, centre: number, width: number): number {
  const d = Math.abs(x - centre) / width
  return d >= 1 ? 0 : 1 - smooth(0, 1, d)
}
/** Hours wrapped into [0, 24). */
export function wrap24(hour: number): number {
  const h = hour % 24
  return h < 0 ? h + 24 : h
}

function mixInto(out: Rgb, a: Rgb, b: Rgb, t: number): void {
  out[0] = lerp(a[0], b[0], t)
  out[1] = lerp(a[1], b[1], t)
  out[2] = lerp(a[2], b[2], t)
}

const goldenSun: Rgb = [0, 0, 0]
const dayEdgeSky: Rgb = [0, 0, 0]

/**
 * The light at a clock hour. Pass `out` to reuse an object (the driver does; nothing is allocated then).
 *   dawn 06:00 to 07:45, full day to 17:30, dusk until 19:30, dark after that;
 *   a golden tint near the horizon (about 06:45 and 18:15); room lights soften in the quiet hour and again, warm and dim, from
 *   21:00 so that they are at their night level by 22:30 and stay so until 05:30 to 06:30.
 */
export function lightAt(hour: number, out: DayLight = createDayLight()): DayLight {
  const h = wrap24(hour)
  const day = smooth(6.0, 7.75, h) * (1 - smooth(17.5, 19.5, h))
  const dusk = 1 - day
  const warm = clamp01(bump(h, 6.9, 1.1) + bump(h, 18.4, 1.3))
  // the circadian "night mode" of the rooms: in by 22:30, out by 06:30 (CONFIG.day.nightHours), a continuous ramp over midnight
  const deep = h < 12 ? 1 - smooth(5.5, 6.5, h) : smooth(21.0, 22.5, h)
  const [q0, q1] = CONFIG.day.quietHours
  const quiet = smooth(q0 - 0.25, q0, h) * (1 - smooth(q1, q1 + 0.25, h))

  out.hour = h
  out.night = dusk
  // sun: golden near the horizon, white-warm at noon, a dim blue moon after dark
  mixInto(goldenSun, SUN_DAY, SUN_GOLDEN, warm * 0.85)
  mixInto(out.sun, SUN_MOON, goldenSun, day)
  out.sunIntensity = lerp(NIGHT.sun, LIGHT_NOON.sunIntensity, day) * (1 - 0.12 * warm * day)
  out.hemiIntensity = lerp(NIGHT.hemi, LIGHT_NOON.hemiIntensity, day)
  out.envIntensity = lerp(NIGHT.env, LIGHT_NOON.envIntensity, day)
  // the sky behind the model: pale by day, peach at the edges of the day, deep blue-grey at night
  mixInto(dayEdgeSky, SKY_DAY, SKY_DUSK, warm * 0.7)
  mixInto(out.sky, SKY_NIGHT, dayEdgeSky, day)
  // the window glass: a clear mint by day, a dark blue sheet at night
  mixInto(out.glass, GLASS_NIGHT, GLASS_DAY, day)
  out.glassOpacity = lerp(NIGHT.glassOpacity, LIGHT_NOON.glassOpacity, day)
  out.panelWarmth = clamp01(0.3 * dusk + 0.5 * deep + 0.15 * quiet)
  out.panelDim = Math.max(0.3, 1 - 0.12 * dusk - 0.4 * deep - 0.22 * quiet)
  out.lampLevel = 1 - 0.3 * deep
  out.nightLights = clamp01(0.3 * dusk * dusk + 0.7 * deep)
  out.screens = 1 - 0.15 * dusk - 0.4 * deep
  return out
}

/** Copy `from` into `to` (every field; the colours element by element). */
export function copyDayLight(from: DayLight, to: DayLight): void {
  to.hour = from.hour
  for (const k of SCALAR_KEYS) to[k] = from[k]
  for (const k of COLOR_KEYS) {
    to[k][0] = from[k][0]
    to[k][1] = from[k][1]
    to[k][2] = from[k][2]
  }
}

/** `out = a + (b - a) * t`, field by field. `out` may be `a`. */
export function lerpDayLight(a: DayLight, b: DayLight, t: number, out: DayLight): void {
  out.hour = b.hour
  for (const k of SCALAR_KEYS) out[k] = lerp(a[k], b[k], t)
  for (const k of COLOR_KEYS) mixInto(out[k], a[k], b[k], t)
}

/** The largest difference between two lights in any field (the driver stops writing when it is tiny). */
export function maxDifference(a: DayLight, b: DayLight): number {
  let m = 0
  for (const k of SCALAR_KEYS) m = Math.max(m, Math.abs(a[k] - b[k]))
  for (const k of COLOR_KEYS) for (let i = 0; i < 3; i++) m = Math.max(m, Math.abs(a[k][i] - b[k][i]))
  return m
}
