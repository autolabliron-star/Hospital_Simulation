import { describe, expect, it } from 'vitest'
import json from './imagingUi.json'
import { IMAGING_UI, ImagingUiSchema, fillImaging } from './imagingUi'

describe('imaging screen copy', () => {
  it('parses, carries the disclaimer and an annotation for every ultrasound view', () => {
    expect(() => ImagingUiSchema.parse(json)).not.toThrow()
    expect(IMAGING_UI.disclaimer).toMatch(/simulated/i)
    expect(Object.keys(IMAGING_UI.us.views).sort()).toEqual(['bladder', 'breast', 'gallbladder', 'kidneyL', 'kidneyR', 'liver', 'pancreas', 'spleen'])
  })
  it('has the cryoablation readout and the device card (synthetic patient, the authorization stated)', () => {
    const t = IMAGING_UI.us.cryo
    expect(fillImaging(t.freeze, { n: 2 })).toBe('FREEZE 2')
    expect(t.thaw).toBe('THAW')
    expect(t.place).toBe('PROBE PLACEMENT')
    expect(fillImaging(t.temp, { c: '\u2212170' })).toMatch(/170 °C$/)
    expect(fillImaging(t.ice, { w: 35, d: 30 })).toContain('35 x 30 mm')
    const c = IMAGING_UI.cryoCard
    expect(c.title).toBe('ProSense cryoablation')
    expect(c.what).toMatch(/liquid nitrogen/)
    expect(c.status).toMatch(/FDA authorized October 2025/)
    expect(c.synthetic).toMatch(/synthetic/i)
    expect(() => ImagingUiSchema.parse({ ...json, cryoCard: { ...json.cryoCard, status: 'x'.repeat(200) } })).toThrow()
    expect(() => ImagingUiSchema.parse({ ...json, cryoCard: { ...json.cryoCard, what: 'a\nb' } })).toThrow()
  })
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fillImaging(IMAGING_UI.us.stored, { n: 2, total: 3 })).toBe('Stored 2/3')
    expect(fillImaging('{a} {b}', { a: 1 })).toBe('1 {b}')
  })
  it('rejects a multi-line or overlong line', () => {
    expect(() => ImagingUiSchema.parse({ ...json, institution: 'a\nb' })).toThrow()
    expect(() => ImagingUiSchema.parse({ ...json, disclaimer: 'x'.repeat(60) })).toThrow()
  })
})
