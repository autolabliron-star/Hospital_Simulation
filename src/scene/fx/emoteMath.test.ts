import { describe, expect, it } from 'vitest'
import {
  CENTRE_LIFT,
  ICON,
  MAX_RANGE,
  POP_PEAK,
  POP_PEAK_AT,
  RANGE_FADE_START,
  emoteStackHeight,
  emoteWorldSize,
  fadeCurve,
  popScale,
  rangeFade,
  smoothstep01,
} from './emoteMath'

const STEPS = 1000
const samples = (f: (u: number) => number) => Array.from({ length: STEPS + 1 }, (_, i) => f(i / STEPS))

describe('pop curve (0 -> 1.1 -> 1)', () => {
  const s = samples(popScale)

  it('starts at 0, ends at 1, and overshoots to 1.1', () => {
    expect(popScale(0)).toBe(0)
    expect(popScale(-3)).toBe(0)
    expect(popScale(1)).toBe(1)
    expect(popScale(7)).toBe(1)
    expect(Math.max(...s)).toBeCloseTo(POP_PEAK, 6)
    expect(popScale(POP_PEAK_AT)).toBeCloseTo(1.1, 6)
  })

  it('rises monotonically to the peak, then falls monotonically to 1', () => {
    const peak = Math.round(POP_PEAK_AT * STEPS)
    for (let i = 1; i <= peak; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1])
    for (let i = peak + 1; i <= STEPS; i++) expect(s[i]).toBeLessThanOrEqual(s[i - 1])
  })

  it('has no jumps: the largest step between samples is small', () => {
    let worst = 0
    for (let i = 1; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - s[i - 1]))
    // 1.1 over 0.6 of the pop at a peak slope of 1.5x the average, with 1000 samples
    expect(worst).toBeLessThan(0.01)
  })

  it('is flat where it starts and ends, so it never kinks', () => {
    expect(popScale(0.001)).toBeLessThan(0.0001)
    expect(popScale(0.999) - 1).toBeLessThan(0.0001)
    expect(popScale(0.999)).toBeGreaterThanOrEqual(1)
  })
})

describe('fade curve', () => {
  const f = samples(fadeCurve)

  it('goes 0 -> 1 monotonically and smoothly', () => {
    expect(fadeCurve(0)).toBe(0)
    expect(fadeCurve(1)).toBe(1)
    expect(fadeCurve(-1)).toBe(0)
    expect(fadeCurve(2)).toBe(1)
    let worst = 0
    for (let i = 1; i < f.length; i++) {
      expect(f[i]).toBeGreaterThanOrEqual(f[i - 1])
      worst = Math.max(worst, f[i] - f[i - 1])
    }
    expect(worst).toBeLessThan(0.0025)
  })

  it('is the same ramp as smoothstep', () => {
    expect(fadeCurve(0.5)).toBe(smoothstep01(0.5))
    expect(fadeCurve(0.5)).toBeCloseTo(0.5)
  })
})

describe('distance behaviour', () => {
  it('never shrinks in the world as the camera moves away, and stays within its clamps', () => {
    let prev = 0
    for (let d = 0; d <= 200; d += 0.5) {
      const w = emoteWorldSize(d)
      expect(w).toBeGreaterThanOrEqual(prev)
      expect(w).toBeGreaterThanOrEqual(ICON.base * ICON.minScale - 1e-9)
      expect(w).toBeLessThanOrEqual(ICON.base * ICON.maxScale + 1e-9)
      prev = w
    }
  })

  it('is a natural size next to a person at mid range', () => {
    expect(emoteWorldSize(ICON.refDistance)).toBeCloseTo(ICON.base)
  })

  it('keeps its size on screen roughly constant: at the 110 m overview it is over half its mid-range angular size', () => {
    const angular = (d: number) => emoteWorldSize(d) / d
    expect(angular(110)).toBeGreaterThan(0.5 * angular(16))
    expect(angular(110)).toBeGreaterThan(0.015) // about 1 degree, ~20 px on a 1000 px tall screen at 35 degrees
    // up close the angular size is about the same as at mid range (within 2x), not 10x
    expect(angular(5)).toBeLessThan(2 * angular(16))
    expect(angular(5)).toBeGreaterThan(angular(16) * 0.8)
  })

  it('shows icons out to 140 m, fades them to nothing by 160 m, and monotonically', () => {
    expect(rangeFade(0)).toBe(1)
    expect(rangeFade(RANGE_FADE_START)).toBe(1)
    expect(rangeFade(MAX_RANGE)).toBe(0)
    expect(rangeFade(500)).toBe(0)
    let prev = 1
    for (let d = RANGE_FADE_START; d <= MAX_RANGE; d += 0.25) {
      const r = rangeFade(d)
      expect(r).toBeLessThanOrEqual(prev)
      prev = r
    }
    expect(MAX_RANGE).toBe(160)
  })

  it('lifts the quad so the badge, not the quad, sits on the anchor, and clears it for a speech bubble', () => {
    expect(CENTRE_LIFT).toBeCloseTo(0.4)
    expect(emoteStackHeight(16)).toBeGreaterThan(emoteWorldSize(16) * 0.75)
    expect(emoteStackHeight(110)).toBeGreaterThan(emoteStackHeight(16))
  })
})
