import { describe, expect, it } from 'vitest'
import { BloodCopySchema, BLOOD_EVENT_FIELDS, BLOOD_EVENT_KEYS, BLOOD_EVENT_TEMPLATES, BLOOD_EVENT_TYPE, bloodText, DRAW_PHASE_LABELS, PREP_PHASE_LABELS, tubeWord } from './bloodCopy'
import bloodJson from './bloodCopy.json'
import { PLACEHOLDER } from './schema'

const SAMPLE: Record<string, string | number> = {
  name: 'Ana Silva',
  ticket: 'P023',
  robot: 2,
  tubes: 4,
  tubeWord: 'tubes',
  attempt: 2,
  nurse: 'Nurse Hana',
  porter: 'Porter Ines',
  bay: 3,
}

describe('bloodCopy.json', () => {
  it('parses against BloodCopySchema', () => {
    expect(BloodCopySchema.safeParse(bloodJson).success).toBe(true)
  })

  it('has a line for every event key, and no others', () => {
    expect(Object.keys(bloodJson.events).sort()).toEqual([...BLOOD_EVENT_KEYS].sort())
  })

  it('only uses the placeholders its line allows, and every line fills completely', () => {
    for (const key of BLOOD_EVENT_KEYS) {
      for (const [, field] of BLOOD_EVENT_TEMPLATES[key].matchAll(PLACEHOLDER)) {
        expect((BLOOD_EVENT_FIELDS[key] as readonly string[]).includes(field), `${key} {${field}}`).toBe(true)
      }
      const text = bloodText(key, SAMPLE)
      expect(text, key).not.toMatch(/[{}]/)
      expect(text.endsWith('.'), key).toBe(true)
    }
  })

  it('keeps the contract wording of the call line and the first-attempt line', () => {
    expect(bloodText('drawCalled', { ticket: 'V004', robot: 1 })).toBe('Now calling V004 to robot 1.')
    expect(bloodText('bloodDrawn', { robot: 2, tubes: 4, tubeWord: 'tubes', name: 'Ana Silva' })).toBe('Robot 2 drew 4 tubes from Ana Silva, first attempt.')
  })

  it('throws on a missing or foreign field', () => {
    expect(() => bloodText('drawCalled', { ticket: 'P001' })).toThrow(/robot/)
    expect(() => bloodText('playerTicket', { ticket: 'P001', extra: 1 })).not.toThrow()
  })

  it('maps every line to a real event type', () => {
    for (const key of BLOOD_EVENT_KEYS) expect(typeof BLOOD_EVENT_TYPE[key]).toBe('string')
    const types = new Set(Object.values(BLOOD_EVENT_TYPE))
    for (const t of ['drawTicket', 'drawCalled', 'bloodDrawn', 'drawByNurse', 'samplesSent']) expect(types.has(t as never), t).toBe(true)
  })

  it('has a label for every robot phase and every prep phase', () => {
    expect(Object.keys(DRAW_PHASE_LABELS)).toHaveLength(16)
    expect(Object.keys(PREP_PHASE_LABELS)).toHaveLength(4)
    expect(new Set(Object.values(DRAW_PHASE_LABELS)).size).toBe(16)
  })

  it('says "tube" for one and "tubes" for the rest', () => {
    expect(tubeWord(1)).toBe('tube')
    expect(tubeWord(3)).toBe('tubes')
    expect(bloodText('samplesSent', { robot: 0, tubes: 1, tubeWord: tubeWord(1), name: 'Ana Silva' })).toBe('Robot 0 sent 1 tube from Ana Silva to the lab.')
  })

  it('is synthetic and plain: no real names and no graphic words', () => {
    const all = JSON.stringify(bloodJson)
    expect(all).not.toMatch(/\b(bleed\w*|gore|gory|wound\w*|stab\w*)\b/i)
  })
})
