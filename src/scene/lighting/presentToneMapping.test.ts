/** Presentation's tone mapper: Blender's AgX LUT (sampled from Blender 4.5) and the exposure that matches the review stills. */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AGX_LUT_LOG2_MAX, AGX_LUT_LOG2_MIN, AGX_LUT_SIZE, agxBlenderDisplay, agxLutBytes, agxLutRgba, agxShaper } from './agxBlenderLut'
import { LOOK_WALK, PRESENT_EXPOSURE, PRESENT_LOOK, TONE_EXPOSURE_SCALE, presentExposureGain } from './look'
import { PRESENT_TONE_FRAGMENT, PresentToneMappingEffect } from './presentToneMapping'

/**
 * Reference points: scene-linear Rec.709 in, Blender's own display output (view AgX, look "AgX - Base Contrast", exposure 0, sRGB display),
 * sampled directly through Blender 4.5.14 (not through the LUT): the grey ramp and three colours.
 */
const BLENDER_GREYS: [number, number][] = [
  [0.002813, 0.0163],
  [0.01125, 0.0805],
  [0.045, 0.2126],
  [0.09, 0.3205],
  [0.18, 0.4614],
  [0.36, 0.6055],
  [0.72, 0.7243],
  [1.44, 0.8162],
  [2.88, 0.8864],
  [5.76, 0.9404],
]
const BLENDER_COLOURS: [[number, number, number], [number, number, number]][] = [
  [
    [0.18, 0.009, 0.009],
    [0.443, 0.0685, 0.0262],
  ],
  [
    [0.18, 0.108, 0.036],
    [0.458, 0.3454, 0.1802],
  ],
  [
    [0.036, 0.09, 0.18],
    [0.1834, 0.3358, 0.4604],
  ],
]

describe("Blender's AgX LUT", () => {
  it('is the table that was sampled (33^3 RGB bytes, hash recorded in the module)', () => {
    const bytes = agxLutBytes()
    expect(bytes.length).toBe(AGX_LUT_SIZE ** 3 * 3)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('977c9162ee8cb647dc405d5ed67705230f6b77fd01b8c150694aee68a4bfbf42')
    const rgba = agxLutRgba()
    expect(rgba.length).toBe(AGX_LUT_SIZE ** 3 * 4)
    expect(rgba[3]).toBe(255)
  })

  it('spans AgX from its black floor (0.18 x 2^-10) to white (0.18 x 2^8.5)', () => {
    expect(AGX_LUT_LOG2_MIN).toBeCloseTo(-12.47393, 4) // the same floor as three's and Blender's AgX
    expect(agxShaper(0)).toBe(0)
    expect(agxShaper(0.18)).toBeCloseTo(10 / 18.5, 9)
    expect(agxShaper(1e6)).toBe(1)
    const out: [number, number, number] = [0, 0, 0]
    expect(agxBlenderDisplay(0, 0, 0, out)[0]).toBeLessThan(0.002)
    expect(agxBlenderDisplay(0.18 * 2 ** 8.5, 0.18 * 2 ** 8.5, 0.18 * 2 ** 8.5, out)[0]).toBeGreaterThan(0.995)
    expect(AGX_LUT_LOG2_MAX - AGX_LUT_LOG2_MIN).toBeCloseTo(18.5, 9)
  })

  it('reproduces Blender on greys within half an 8-bit step or so', () => {
    const out: [number, number, number] = [0, 0, 0]
    for (const [x, want] of BLENDER_GREYS) {
      agxBlenderDisplay(x, x, x, out)
      for (const c of out) expect(Math.abs(c - want)).toBeLessThan(0.006)
    }
  })

  it('reproduces Blender on saturated colours (the purity three loses)', () => {
    const out: [number, number, number] = [0, 0, 0]
    for (const [[r, g, b], want] of BLENDER_COLOURS) {
      agxBlenderDisplay(r, g, b, out)
      for (let i = 0; i < 3; i++) expect(Math.abs(out[i] - want[i])).toBeLessThan(0.012)
    }
  })

  it('is monotonic on a grey ramp', () => {
    const out: [number, number, number] = [0, 0, 0]
    let last = -1
    for (let s = -11; s <= 9; s += 0.05) {
      const x = 0.18 * 2 ** s
      const v = agxBlenderDisplay(x, x, x, out)[1]
      expect(v).toBeGreaterThanOrEqual(last - 1e-9)
      last = v
    }
  })
})

describe('the presentation exposure', () => {
  it("is the stills' +1.2 EV over the bake's radiance", () => {
    expect(PRESENT_EXPOSURE).toBeCloseTo(2 ** 1.2, 1)
    expect(presentExposureGain() * LOOK_WALK.exposure * TONE_EXPOSURE_SCALE).toBeCloseTo(PRESENT_EXPOSURE, 9)
    expect(PRESENT_LOOK.agx).toBe(1)
  })

  it('puts a mid-grey surface and a lit white wall where the stills have them', () => {
    const out: [number, number, number] = [0, 0, 0]
    const grey = agxBlenderDisplay(0.18 * PRESENT_EXPOSURE, 0.18 * PRESENT_EXPOSURE, 0.18 * PRESENT_EXPOSURE, out)[0]
    expect(grey).toBeGreaterThan(0.6)
    expect(grey).toBeLessThan(0.66)
    const white = agxBlenderDisplay(0.7 * PRESENT_EXPOSURE, 0.7 * PRESENT_EXPOSURE, 0.7 * PRESENT_EXPOSURE, out)[0]
    expect(white).toBeGreaterThan(0.8)
    expect(white).toBeLessThan(0.87)
  })
})

describe('the tone-mapping effect', () => {
  it('blends by uniforms only: the shader holds both images and no define switches them', () => {
    const e = new PresentToneMappingEffect(presentExposureGain())
    expect(e.mix.value).toBe(0)
    expect(e.gain.value).toBeCloseTo(presentExposureGain(), 9)
    expect(e.uniforms.get('agxLut')?.value).toBe(e.lut)
    expect(e.uniforms.get('agxMix')).toBe(e.mix)
    expect(e.defines.size).toBe(0)
    expect(e.lut.image.width).toBe(AGX_LUT_SIZE)
    expect(e.lut.image.depth).toBe(AGX_LUT_SIZE)
    expect(PRESENT_TONE_FRAGMENT).toContain('#include <tonemapping_pars_fragment>')
    expect(PRESENT_TONE_FRAGMENT).toContain('AgXToneMapping( c )')
    expect(PRESENT_TONE_FRAGMENT).toContain('sRGBTransferEOTF')
    expect(PRESENT_TONE_FRAGMENT).toContain('void mainImage')
    // texel centres of a 33 grid
    expect(PRESENT_TONE_FRAGMENT).toContain(`${32 / 33}`)
  })
})
