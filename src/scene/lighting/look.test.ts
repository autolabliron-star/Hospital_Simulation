import { describe, expect, it } from 'vitest'
import { parseLightingFlags } from './flags'
import {
  ENV_SWAP_AT,
  ENV_SWAP_BAND,
  FLOOR_WALK_ROUGHNESS,
  HOSPITAL_ENV_MATCH,
  LOOK_KEYS,
  LOOK_MODEL_WALK,
  LOOK_OVERVIEW,
  LOOK_WALK,
  VIGNETTE_DARKNESS,
  VIGNETTE_OFFSET,
  createLook,
  lookAt,
  vignetteFactor,
} from './look'

describe('the look table', () => {
  it('blend 0 is exactly today: every factor 1, every W3 addition 0', () => {
    const out = lookAt(0, false, createLook())
    expect(out).toEqual({
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
    })
    expect(lookAt(0, true, createLook())).toEqual(out) // ?look=model starts from the same overview
  })

  it('blend 1 is the walk row, exactly', () => {
    expect(lookAt(1, false, createLook())).toEqual(LOOK_WALK)
    expect(lookAt(1, true, createLook())).toEqual(LOOK_MODEL_WALK)
  })

  it('?look=model is the M5 walk preset and nothing of W3', () => {
    expect(LOOK_MODEL_WALK.sun).toBe(0.35)
    expect(LOOK_MODEL_WALK.hemi).toBe(1.5)
    expect(LOOK_MODEL_WALK.env).toBe(2.2)
    for (const k of LOOK_KEYS) {
      if (k === 'sun' || k === 'hemi' || k === 'env') continue
      expect(LOOK_MODEL_WALK[k], k).toBe(LOOK_OVERVIEW[k])
    }
  })

  it('the walk row brings the old indoor boosts down now that the light volume lights the rooms', () => {
    expect(LOOK_WALK.hemi).toBeLessThan(LOOK_MODEL_WALK.hemi)
    expect(LOOK_WALK.env).toBeLessThan(LOOK_MODEL_WALK.env)
    expect(LOOK_WALK.sun).toBeLessThanOrEqual(LOOK_MODEL_WALK.sun)
    expect(LOOK_WALK.sun).toBeGreaterThan(0.2) // the plaza and the atrium keep a sun
  })

  it('blends linearly and monotonically between the rows', () => {
    const a = createLook()
    const b = createLook()
    for (const key of LOOK_KEYS) {
      let last = lookAt(0, false, a)[key]
      for (let k = 0.1; k <= 1.0001; k += 0.1) {
        const v = lookAt(Math.min(1, k), false, b)[key]
        const towards = Math.sign(LOOK_WALK[key] - LOOK_OVERVIEW[key])
        expect((v - last) * towards, `${key} at ${k.toFixed(1)}`).toBeGreaterThanOrEqual(-1e-12)
        last = v
      }
    }
    expect(lookAt(0.5, false, a).sun).toBeCloseTo((1 + LOOK_WALK.sun) / 2, 12)
  })

  it('writes into the object it is given and returns it (no allocation per frame)', () => {
    const out = createLook()
    expect(lookAt(0.3, false, out)).toBe(out)
  })

  it('a blend outside 0..1 clamps to the rows', () => {
    expect(lookAt(-2, false, createLook())).toEqual(LOOK_OVERVIEW)
    expect(lookAt(3, false, createLook())).toEqual(LOOK_WALK)
  })

  it('every floor has a walk roughness in the glossy range and every one is a real number', () => {
    for (const [key, r] of Object.entries(FLOOR_WALK_ROUGHNESS)) {
      expect(key.startsWith('floor'), key).toBe(true)
      expect(r).toBeGreaterThan(0.2)
      expect(r).toBeLessThan(0.6)
    }
  })

  it('keeps the environment level continuous at the swap, with a band for hysteresis', () => {
    expect(ENV_SWAP_AT).toBeGreaterThan(0.3)
    expect(ENV_SWAP_AT).toBeLessThan(0.7)
    expect(ENV_SWAP_BAND).toBeLessThan(0.1)
    expect(HOSPITAL_ENV_MATCH).toBeGreaterThan(0.85)
    expect(HOSPITAL_ENV_MATCH).toBeLessThan(1.2)
  })

  it('the vignette is the identity at darkness 0 and only darkens the corners at full blend', () => {
    for (let d = 0; d <= 0.7072; d += 0.01) expect(vignetteFactor(d, 0)).toBe(1)
    // the middle of an edge (d = 0.5) is untouched, the corner (d = 0.707) is about three quarters
    expect(vignetteFactor(0.5, VIGNETTE_DARKNESS)).toBe(1)
    const corner = vignetteFactor(Math.SQRT1_2, VIGNETTE_DARKNESS)
    expect(corner).toBeGreaterThan(0.68)
    expect(corner).toBeLessThan(0.82)
    expect(vignetteFactor(Math.SQRT1_2, 0, VIGNETTE_OFFSET)).toBe(1)
    // and it only ever falls with distance
    let last = 1
    for (let d = 0; d <= 0.7072; d += 0.01) {
      const v = vignetteFactor(d, VIGNETTE_DARKNESS)
      expect(v).toBeLessThanOrEqual(last + 1e-12)
      last = v
    }
  })
})

describe('the debug flags', () => {
  it('default to the new look with everything on', () => {
    expect(parseLightingFlags('')).toEqual({ model: false, volume: true, reflect: true, roomEnv: false, bakeLight: true })
  })

  it('read ?look=model, ?lv=0, ?refl=0 and ?env=room', () => {
    expect(parseLightingFlags('?look=model').model).toBe(true)
    expect(parseLightingFlags('?seed=3&lv=0&probe=1').volume).toBe(false)
    expect(parseLightingFlags('?refl=0').reflect).toBe(false)
    expect(parseLightingFlags('?env=room').roomEnv).toBe(true)
  })

  it('ignores other values', () => {
    expect(parseLightingFlags('?look=fancy&lv=1&refl=1&env=hospital')).toEqual({ model: false, volume: true, reflect: true, roomEnv: false, bakeLight: true })
  })
})

describe('the tone mapper constant (presentation / AgX)', () => {
  it('compensates AgX with a modest exposure scale, 1 for Neutral, and keeps the rows as they were', async () => {
    const { TONE_MAP, TONE_EXPOSURE_SCALE, LOOK_OVERVIEW: overview } = await import('./look')
    expect(['agx', 'neutral']).toContain(TONE_MAP)
    expect(TONE_EXPOSURE_SCALE).toBe(TONE_MAP === 'agx' ? 1.25 : 1)
    // the look rows themselves are untouched: the overview is still exposure 1 before the scale
    expect(overview.exposure).toBe(1)
  })
  it('presentation mode: gentler bloom with a threshold of at least 1, a lighter vignette, no grade', async () => {
    const { BLOOM, PRESENT_LOOK } = await import('./look')
    expect(PRESENT_LOOK.bloomThreshold).toBeGreaterThanOrEqual(1)
    expect(PRESENT_LOOK.bloomIntensity).toBeLessThan(BLOOM.intensity)
    expect(PRESENT_LOOK.bloomIntensity).toBeCloseTo(0.2, 6)
    expect(PRESENT_LOOK.vignette).toBeLessThan(1)
    expect(PRESENT_LOOK.grade).toBe(0)
  })
})
