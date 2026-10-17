import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { COLOR_KEYS, LIGHT_NOON, SCALAR_KEYS, copyDayLight, createDayLight, lerpDayLight, lightAt, maxDifference, rgb, wrap24, type DayLight } from './lightAt'

const luminance = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

describe('lightAt', () => {
  it('is finite everywhere, including hours outside 0 to 24', () => {
    for (let h = -30; h <= 60; h += 0.25) {
      const l = lightAt(h)
      for (const k of SCALAR_KEYS) expect(Number.isFinite(l[k]), `${k} at ${h}`).toBe(true)
      for (const k of COLOR_KEYS) for (const v of l[k]) expect(v >= 0 && v <= 1, `${k} at ${h}`).toBe(true)
    }
  })

  it('is continuous over the whole day and over midnight (no jumps, 0.01 h steps)', () => {
    // the steepest a value moves per 0.01 h; every ramp is at least 1 h long, so no field may move more than 3 % of its range
    const range: Record<string, number> = {}
    let prev = lightAt(0)
    const lo: Record<string, number> = {}
    const hi: Record<string, number> = {}
    for (let h = 0; h <= 24 + 1e-9; h += 0.01) {
      const l = lightAt(h)
      for (const k of SCALAR_KEYS) {
        lo[k] = Math.min(lo[k] ?? Infinity, l[k])
        hi[k] = Math.max(hi[k] ?? -Infinity, l[k])
        range[k] = hi[k] - lo[k]
      }
      for (const k of SCALAR_KEYS) expect(Math.abs(l[k] - prev[k]), `${k} jumps at ${h.toFixed(2)}`).toBeLessThan(Math.max(0.02, 0.03 * Math.max(1, hi[k])))
      for (const k of COLOR_KEYS) for (let i = 0; i < 3; i++) expect(Math.abs(l[k][i] - prev[k][i]), `${k}[${i}] jumps at ${h.toFixed(2)}`).toBeLessThan(0.03)
      prev = l
    }
  })

  it('wraps: 24 h is 0 h, and -1 h is 23 h', () => {
    expect(maxDifference(lightAt(24), lightAt(0))).toBeLessThan(1e-9)
    expect(maxDifference(lightAt(-1), lightAt(23))).toBeLessThan(1e-9)
    expect(maxDifference(lightAt(31.5), lightAt(7.5))).toBeLessThan(1e-9)
    expect(wrap24(-0.5)).toBeCloseTo(23.5)
  })

  it('is brightest in the middle of the day and darker at night', () => {
    const noon = lightAt(12)
    for (const h of [0, 1.5, 3, 4.5, 22.5, 23.5]) {
      const n = lightAt(h)
      expect(n.sunIntensity, `sun at ${h}`).toBeLessThan(noon.sunIntensity * 0.15)
      expect(n.hemiIntensity).toBeLessThan(noon.hemiIntensity * 0.4)
      expect(n.envIntensity).toBeLessThan(noon.envIntensity * 0.4)
      expect(luminance(n.sky)).toBeLessThan(luminance(noon.sky) * 0.25)
      expect(luminance(n.sun)).toBeLessThan(luminance(noon.sun))
      expect(n.glassOpacity).toBeGreaterThan(noon.glassOpacity)
      expect(luminance(n.glass)).toBeLessThan(luminance(noon.glass))
      expect(n.panelDim).toBeLessThan(noon.panelDim)
      expect(n.panelWarmth).toBeGreaterThan(noon.panelWarmth)
      expect(n.screens).toBeLessThan(noon.screens)
      expect(n.nightLights).toBeGreaterThan(0.6)
    }
    // the whole range: noon is the maximum of the sun, the small hours the minimum
    let maxSun = 0
    let maxAt = 0
    for (let h = 0; h < 24; h += 0.05) {
      const s = lightAt(h).sunIntensity
      if (s > maxSun) {
        maxSun = s
        maxAt = h
      }
    }
    expect(maxAt).toBeGreaterThan(7.5)
    expect(maxAt).toBeLessThan(17.6)
  })

  it('matches the lighting rig of the day (LIGHT_NOON) from morning to the middle of the afternoon', () => {
    for (const h of [8, 9.5, 12, 15, 16.5]) {
      const l = lightAt(h)
      expect(l.sunIntensity).toBeCloseTo(LIGHT_NOON.sunIntensity, 9)
      expect(l.hemiIntensity).toBeCloseTo(LIGHT_NOON.hemiIntensity, 9)
      expect(l.envIntensity).toBeCloseTo(LIGHT_NOON.envIntensity, 9)
      expect(l.glassOpacity).toBeCloseTo(LIGHT_NOON.glassOpacity, 9)
      expect(l.nightLights).toBe(0)
      expect(l.panelWarmth).toBeLessThan(0.2) // the quiet hour softens the rooms a little, daylight alone does not
    }
    const noon = lightAt(10)
    rgb(LIGHT_NOON.sunColor).forEach((v, i) => expect(noon.sun[i]).toBeCloseTo(v, 9))
    rgb(LIGHT_NOON.sky).forEach((v, i) => expect(noon.sky[i]).toBeCloseTo(v, 9))
    expect(noon.panelDim).toBe(1)
    expect(noon.screens).toBe(1)
  })

  it('the corridor night lights are off by day and on at night', () => {
    for (let h = 8; h <= 16.5; h += 0.25) expect(lightAt(h).nightLights).toBe(0)
    expect(lightAt(22.5).nightLights).toBeGreaterThan(0.9)
    expect(lightAt(2).nightLights).toBeGreaterThan(0.9)
    expect(lightAt(19).nightLights).toBeGreaterThan(0.02) // low lights come on at dusk
    expect(lightAt(19).nightLights).toBeLessThan(0.5)
  })

  it('golden light near the sunrise and sunset: warmer (redder) than noon', () => {
    const noon = lightAt(12).sun
    for (const h of [7, 18]) {
      const s = lightAt(h).sun
      expect(s[2] / s[0], `blue to red at ${h}`).toBeLessThan(noon[2] / noon[0])
    }
  })

  it('the rooms soften in the quiet hour and are at their night level in the night hours', () => {
    const [q0, q1] = CONFIG.day.quietHours
    const mid = lightAt((q0 + q1) / 2)
    expect(mid.panelDim).toBeLessThan(lightAt(11).panelDim)
    expect(lightAt(q1 + 0.5).panelDim).toBe(1)
    const [n0, n1] = CONFIG.day.nightHours
    for (const h of [n0 + 0.5, 23.5, 1, 3, n1 - 1]) expect(lightAt(h).panelDim, `at ${h}`).toBeLessThanOrEqual(0.62)
    expect(lightAt(n1 + 0.6).panelDim).toBeGreaterThan(0.85)
  })

  it('reuses the object it is given (the driver allocates nothing)', () => {
    const out = createDayLight()
    expect(lightAt(3, out)).toBe(out)
    const sun = out.sun
    lightAt(14, out)
    expect(out.sun).toBe(sun)
  })

  it('lerp and copy treat every field, the colours included', () => {
    const a = lightAt(3)
    const b = lightAt(12)
    const mid: DayLight = createDayLight()
    lerpDayLight(a, b, 0.5, mid)
    for (const k of SCALAR_KEYS) expect(mid[k]).toBeCloseTo((a[k] + b[k]) / 2, 9)
    for (const k of COLOR_KEYS) for (let i = 0; i < 3; i++) expect(mid[k][i]).toBeCloseTo((a[k][i] + b[k][i]) / 2, 9)
    const c = createDayLight()
    copyDayLight(b, c)
    expect(maxDifference(b, c)).toBe(0)
    expect(maxDifference(a, b)).toBeGreaterThan(0.5)
  })
})
