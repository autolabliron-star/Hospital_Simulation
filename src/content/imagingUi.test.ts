import { describe, expect, it } from 'vitest'
import json from './imagingUi.json'
import { IMAGING_UI, ImagingUiSchema, fillImaging } from './imagingUi'

describe('imaging screen copy', () => {
  it('parses, carries the disclaimer and an annotation for every ultrasound view', () => {
    expect(() => ImagingUiSchema.parse(json)).not.toThrow()
    expect(IMAGING_UI.disclaimer).toMatch(/simulated/i)
    expect(Object.keys(IMAGING_UI.us.views).sort()).toEqual(['bladder', 'gallbladder', 'kidneyL', 'kidneyR', 'liver', 'pancreas', 'spleen'])
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
