import { describe, expect, it } from 'vitest'
import json from './imagingUi.json'
import { IMAGING_UI, ImagingUiSchema, cryoKindOf, fillImaging } from './imagingUi'

describe('imaging screen copy', () => {
  it('parses, carries the disclaimer and an annotation for every ultrasound view', () => {
    expect(() => ImagingUiSchema.parse(json)).not.toThrow()
    expect(IMAGING_UI.disclaimer).toMatch(/simulated/i)
    expect(Object.keys(IMAGING_UI.us.views).sort()).toEqual(['bladder', 'breast', 'gallbladder', 'kidneyL', 'kidneyR', 'liver', 'pancreas', 'spleen'])
  })
  it('has the cryoablation readout and the device card (synthetic patient, the authorisation stated)', () => {
    const t = IMAGING_UI.us.cryo
    expect(fillImaging(t.freeze, { n: 2 })).toBe('FREEZE 2')
    expect(t.thaw).toBe('THAW')
    expect(t.place).toBe('PROBE PLACEMENT')
    expect(fillImaging(t.temp, { c: '\u2212170' })).toMatch(/170 °C$/)
    expect(fillImaging(t.ice, { w: 35, d: 30 })).toContain('35 x 30 mm')
    const c = IMAGING_UI.cryoCard
    expect(c.title).toBe('ProSense cryoablation')
    expect(c.breastCancer.what).toMatch(/liquid nitrogen/)
    expect(c.breastCancer.status).toMatch(/FDA authorised October 2025/)
    expect(c.synthetic).toMatch(/synthetic/i)
    expect(() => ImagingUiSchema.parse({ ...json, cryoCard: { ...json.cryoCard, breastCancer: { ...json.cryoCard.breastCancer, status: 'x'.repeat(200) } } })).toThrow()
    expect(() => ImagingUiSchema.parse({ ...json, cryoCard: { ...json.cryoCard, fibroadenoma: { ...json.cryoCard.fibroadenoma, what: 'a\nb' } } })).toThrow()
    const { fibroadenoma: _gone, ...noFibro } = json.cryoCard
    expect(() => ImagingUiSchema.parse({ ...json, cryoCard: noFibro })).toThrow()
  })
  it('has a card per case (R5 fix K6): the benign fibroadenoma\'s is not the breast cancer\'s (no cancer, no tumour, no 70-and-over authorisation)', () => {
    const c = IMAGING_UI.cryoCard
    const f = c.fibroadenoma
    const b = c.breastCancer
    expect(f.what).toMatch(/benign lump/i)
    expect(f.what).toMatch(/liquid nitrogen/)
    expect(f.status).toMatch(/IceCure states/)
    expect(f.status).toMatch(/fibroadenomas?/)
    for (const [k, v] of Object.entries(f)) {
      expect(v, `fibroadenoma ${k}`).not.toMatch(/cancer|tumou?r|malignan|\b70\b|endocrine|hormone/i)
      expect(v, `fibroadenoma ${k}`).not.toMatch(/anesth|\bcolor\b|\bcenter/i)
    }
    expect(b.what).toMatch(/tumour/)
    expect(b.status).toMatch(/breast cancer/)
    expect(f.what).not.toBe(b.what)
    expect(f.status).not.toBe(b.status)
    // the card follows the exam's protocol
    expect(cryoKindOf('Ultrasound-guided cryoablation of a fibroadenoma, left breast (ProSense)')).toBe('fibroadenoma')
    expect(cryoKindOf('Ultrasound-guided cryoablation, left breast (ProSense)')).toBe('breastCancer')
    expect(cryoKindOf(null)).toBe('breastCancer')
  })
  it('has the words of every stage of the scripted ProSense case (R5 wave 3): non-graphic, UK, one short line each', () => {
    const t = IMAGING_UI.us.cryo
    expect(t.survey).toBe('SURVEY')
    expect(fillImaging(t.lump, { d: 12 })).toBe('Lump 12 mm')
    expect(t.local).toMatch(/ANAESTHETIC/)
    expect(t.saline).toMatch(/SALINE/)
    expect(fillImaging(t.programmeLine, { a: 9, b: 8, c: 9 })).toBe('9-8-9 min')
    expect(fillImaging(t.measureLine, { w: 36, t: 35 })).toBe('Ice ball 36 mm (target 35+)')
    // the lump check says what the picture shows, for both cases (R5 fix K4)
    expect(t.lumpCovered).toBe('LUMP COVERED')
    expect(t.lumpOutside).toMatch(/PART OF THE LUMP OUTSIDE/)
    expect(t.lumpOutside).toMatch(/MOVE PROBE/)
    expect(t.probeOut).toBe('PROBE OUT')
    expect(t.relocate).toBe('PROBE MOVED')
    for (const [k, v] of Object.entries(t)) {
      expect(v.length, k).toBeLessThanOrEqual(48)
      expect(v, k).not.toMatch(/\b(blood|bleed\w*|wounds?|incisions?|gore)\b/i)
      expect(v, k).not.toMatch(/anesth|\bcolor\b|\bcenter/i)
    }
    expect(() => ImagingUiSchema.parse({ ...json, us: { ...json.us, cryo: { ...json.us.cryo, survey: 'x'.repeat(60) } } })).toThrow()
    const { survey: _gone, ...rest } = json.us.cryo
    expect(() => ImagingUiSchema.parse({ ...json, us: { ...json.us, cryo: rest } })).toThrow()
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
