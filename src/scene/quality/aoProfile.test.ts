import { describe, expect, it } from 'vitest'
import { AO_OVERVIEW, AO_WALK, DENOISE_FULL, DENOISE_LIGHT, aoSettings } from './aoProfile'
import { QUALITY_STEPS } from './ladder'

describe('the AO table', () => {
  it('keeps the designed look at full: the overview and walk numbers Effects.tsx always used', () => {
    expect(AO_OVERVIEW).toEqual({ aoRadius: 1.4, intensity: 2.2 })
    expect(AO_WALK).toEqual({ aoRadius: 0.8, intensity: 1.6 })
    expect(aoSettings('overview', 'full')).toEqual({ enabled: true, aoRadius: 1.4, intensity: 2.2, denoiseIterations: DENOISE_FULL })
    expect(aoSettings('walk', 'full')).toEqual({ enabled: true, aoRadius: 0.8, intensity: 1.6, denoiseIterations: DENOISE_FULL })
  })

  it('treats any mode but the overview as walking, as before', () => {
    expect(aoSettings('walk', 'full')).toBe(aoSettings('anything-else', 'full'))
    expect(aoSettings('overview', 'full')).not.toBe(aoSettings('walk', 'full'))
  })

  it('makes light cheaper without a shader change: a smaller radius and one denoise pass fewer', () => {
    for (const mode of ['overview', 'walk']) {
      const full = aoSettings(mode, 'full')
      const light = aoSettings(mode, 'light')
      expect(light.enabled).toBe(true)
      expect(light.aoRadius).toBeLessThan(full.aoRadius)
      expect(light.intensity).toBeLessThanOrEqual(full.intensity)
      expect(light.denoiseIterations).toBe(DENOISE_LIGHT)
      expect(light.denoiseIterations).toBeLessThan(DENOISE_FULL)
    }
  })

  it('turns AO off by disabling the pass, not by emptying it', () => {
    for (const mode of ['overview', 'walk']) {
      expect(aoSettings(mode, 'off').enabled).toBe(false)
      expect(aoSettings(mode, 'full').enabled).toBe(true)
    }
  })

  it('has a row for every rung of the ladder, in both modes', () => {
    for (const step of QUALITY_STEPS) {
      for (const mode of ['overview', 'walk']) {
        const row = aoSettings(mode, step.ao)
        expect(row.aoRadius).toBeGreaterThan(0)
        expect(row.intensity).toBeGreaterThan(0)
        expect(row.denoiseIterations).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('returns shared rows, so a frame can read it without allocating', () => {
    expect(aoSettings('walk', 'light')).toBe(aoSettings('walk', 'light'))
  })
})
