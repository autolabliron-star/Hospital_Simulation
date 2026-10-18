import { LUT3DEffect, BlendFunction } from 'postprocessing'
import { DataUtils, HalfFloatType, LinearFilter, SRGBColorSpace } from 'three'
import { describe, expect, it } from 'vitest'
import { GRADE_LUT_SIZE, buildGradeLutData, createGradeLut, gradeColor, sCurve, sampleGradeLut, tintWeight } from './grade'

const SIZE = GRADE_LUT_SIZE
const half = DataUtils.fromHalfFloat

/** Decoded lattice value at (r, g, b, channel). */
function node(data: Uint16Array, r: number, g: number, b: number, ch: number): number {
  return half(data[(r + g * SIZE + b * SIZE * SIZE) * 4 + ch])
}

describe('the colour grade', () => {
  it('strength 0 is the identity, exactly', () => {
    const out = [0, 0, 0]
    for (const [r, g, b] of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.9], [0.73, 0.1, 0.4], [0.5, 0.5, 0.5], [0.99, 0.01, 0.5]]) {
      gradeColor(r, g, b, out, 0)
      expect(out).toEqual([r, g, b])
    }
  })

  it('a lattice built at strength 0 is the neutral lattice (to half-float precision)', () => {
    const data = buildGradeLutData(SIZE, 0)
    for (let i = 0; i < SIZE; i++) {
      const v = i / (SIZE - 1)
      expect(node(data, i, 0, 0, 0)).toBeCloseTo(v, 3)
      expect(node(data, 0, i, 0, 1)).toBeCloseTo(v, 3)
      expect(node(data, 0, 0, i, 2)).toBeCloseTo(v, 3)
      expect(node(data, i, i, i, 0)).toBeCloseTo(v, 3)
      expect(node(data, i, i, i, 2)).toBeCloseTo(v, 3)
    }
  })

  it('maps black to black and white to white', () => {
    const out = [9, 9, 9]
    gradeColor(0, 0, 0, out)
    expect(out).toEqual([0, 0, 0])
    gradeColor(1, 1, 1, out)
    expect(out[0]).toBeCloseTo(1, 12)
    expect(out[1]).toBeCloseTo(1, 12)
    expect(out[2]).toBeCloseTo(1, 12)
  })

  it('keeps greys neutral: exactly at mid-grey, within a hair elsewhere, warm above and cool below', () => {
    const out = [0, 0, 0]
    gradeColor(0.5, 0.5, 0.5, out)
    expect(Math.abs(out[0] - out[2])).toBeLessThan(1e-9)
    expect(Math.abs(out[1] - out[2])).toBeLessThan(1e-9)
    for (let v = 0; v <= 1.0001; v += 0.05) {
      gradeColor(v, v, v, out)
      expect(Math.abs(out[0] - out[2]), `grey ${v.toFixed(2)}`).toBeLessThan(0.03)
    }
    gradeColor(0.8, 0.8, 0.8, out)
    expect(out[0]).toBeGreaterThan(out[2]) // warm highlights
    gradeColor(0.2, 0.2, 0.2, out)
    expect(out[2]).toBeGreaterThan(out[0]) // cool shadows
  })

  it('has a gentle S-curve: monotonic, darker toe, brighter shoulder, black and white fixed', () => {
    expect(sCurve(0)).toBe(0)
    expect(sCurve(1)).toBeCloseTo(1, 12)
    expect(sCurve(0.25)).toBeLessThan(0.25)
    expect(sCurve(0.75)).toBeGreaterThan(0.75)
    expect(Math.abs(sCurve(0.5) - 0.5)).toBeLessThan(1e-12)
    let last = -1
    for (let y = 0; y <= 1.0001; y += 0.01) {
      const v = sCurve(Math.min(1, y))
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
    // gentle: nowhere does it move a value by more than 0.06
    for (let y = 0; y <= 1; y += 0.01) expect(Math.abs(sCurve(y) - y)).toBeLessThan(0.06)
  })

  it('the split tone is zero at black, mid-grey and white', () => {
    expect(tintWeight(0)).toBeCloseTo(0, 12)
    expect(tintWeight(0.5)).toBeCloseTo(0, 12)
    expect(tintWeight(1)).toBeCloseTo(0, 12)
    expect(tintWeight(0.8)).toBeGreaterThan(0)
    expect(tintWeight(0.2)).toBeLessThan(0)
  })

  it('every output channel rises with its own input channel, everywhere on the lattice', () => {
    const data = buildGradeLutData()
    const EPS = 1e-4
    for (let a = 0; a < SIZE; a += 3) {
      for (let b = 0; b < SIZE; b += 3) {
        let lr = -1
        let lg = -1
        let lb = -1
        for (let i = 0; i < SIZE; i++) {
          const vr = node(data, i, a, b, 0)
          const vg = node(data, a, i, b, 1)
          const vb = node(data, a, b, i, 2)
          expect(vr, `red along r (g=${a}, b=${b}) at ${i}`).toBeGreaterThanOrEqual(lr - EPS)
          expect(vg, `green along g (r=${a}, b=${b}) at ${i}`).toBeGreaterThanOrEqual(lg - EPS)
          expect(vb, `blue along b (r=${a}, g=${b}) at ${i}`).toBeGreaterThanOrEqual(lb - EPS)
          lr = vr
          lg = vg
          lb = vb
        }
      }
    }
  })

  it('stays within 0..1 and changes no colour by more than a few per cent', () => {
    const data = buildGradeLutData()
    const s = 1 / (SIZE - 1)
    let worst = 0
    for (let b = 0; b < SIZE; b++) {
      for (let g = 0; g < SIZE; g++) {
        for (let r = 0; r < SIZE; r++) {
          for (let ch = 0; ch < 3; ch++) {
            const v = node(data, r, g, b, ch)
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThanOrEqual(1.001)
            worst = Math.max(worst, Math.abs(v - [r, g, b][ch] * s))
          }
        }
      }
    }
    expect(worst).toBeLessThan(0.08)
    expect(worst).toBeGreaterThan(0.01) // and it is not a no-op
  })

  it('a trilinear read (what the GPU does) at a lattice node returns the node', () => {
    const data = buildGradeLutData()
    const out = [0, 0, 0]
    sampleGradeLut(data, SIZE, 10 / (SIZE - 1), 20 / (SIZE - 1), 5 / (SIZE - 1), out)
    expect(out[0]).toBeCloseTo(node(data, 10, 20, 5, 0), 6)
    expect(out[1]).toBeCloseTo(node(data, 10, 20, 5, 1), 6)
    expect(out[2]).toBeCloseTo(node(data, 10, 20, 5, 2), 6)
    sampleGradeLut(data, SIZE, 1, 1, 1, out)
    expect(out[0]).toBeCloseTo(1, 2)
  })

  it('makes one shared 32 cubed half-float 3D texture, linear filtered', () => {
    const t = createGradeLut()
    expect(createGradeLut()).toBe(t)
    expect(t.image.width).toBe(SIZE)
    expect(t.image.height).toBe(SIZE)
    expect(t.image.depth).toBe(SIZE)
    expect(t.type).toBe(HalfFloatType)
    expect(t.minFilter).toBe(LinearFilter)
    expect(t.magFilter).toBe(LinearFilter)
    expect((t.image.data as Uint16Array).length).toBe(SIZE * SIZE * SIZE * 4)
  })

  it('works with postprocessing\'s LUT3DEffect: a 3D, high-precision lattice with an sRGB input, and a grey ramp lands on the lattice exactly', () => {
    const lut = createGradeLut()
    const effect = new LUT3DEffect(lut, { blendFunction: BlendFunction.NORMAL })
    expect(effect.inputColorSpace).toBe(SRGBColorSpace) // the pass converts the tone-mapped linear colour to sRGB before it, as the lattice is graded
    expect(effect.defines.get('LUT_3D')).toBe('1')
    expect(Number(effect.defines.get('LUT_SIZE'))).toBe(SIZE)
    expect(effect.defines.has('LUT_PRECISION_HIGH')).toBe(true)
    expect(effect.tetrahedralInterpolation).toBe(false)
    expect(effect.blendMode.blendFunction).toBe(BlendFunction.NORMAL)
    // the shader samples `scale * c + offset` of a 3D texture: texel position = coordinate * size - 0.5, which for a grey ramp is c * (size - 1),
    // exactly the lattice node (no half-texel shift), so an identity lattice returns the ramp
    const scale = effect.uniforms.get('scale')!.value as { x: number; y: number; z: number }
    const offset = effect.uniforms.get('offset')!.value as { x: number; y: number; z: number }
    const neutral = buildGradeLutData(SIZE, 0)
    const out = [0, 0, 0]
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const v = Math.min(1, c)
      const texel = (scale.x * v + offset.x) * SIZE - 0.5
      expect(texel).toBeCloseTo(v * (SIZE - 1), 9)
      sampleGradeLut(neutral, SIZE, v, v, v, out)
      expect(out[0]).toBeCloseTo(v, 2)
      expect(out[1]).toBeCloseTo(v, 2)
      expect(out[2]).toBeCloseTo(v, 2)
    }
    // NORMAL blends by opacity: 0 leaves the picture alone, 1 is the grade
    expect(effect.blendMode.opacity.value).toBe(1)
  })
})
