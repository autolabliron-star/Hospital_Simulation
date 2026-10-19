import { describe, expect, it } from 'vitest'
import raw from './labCopy.json'
import { LAB_COPY, LAB_COPY_FIELDS, LabCopySchema, labLine, type LabCopyKey } from './labCopy'

describe('labCopy.json (the lab\'s event lines)', () => {
  it('parses against its schema and has every line', () => {
    expect(LabCopySchema.safeParse(raw).success).toBe(true)
    expect(Object.keys(LAB_COPY).sort()).toEqual(Object.keys(LAB_COPY_FIELDS).sort())
  })

  it('every line uses exactly its placeholders, and filling leaves no brace behind', () => {
    for (const key of Object.keys(LAB_COPY_FIELDS) as LabCopyKey[]) {
      const fields = Object.fromEntries(LAB_COPY_FIELDS[key].map((f) => [f, f === 'min' ? 7 : 'Ana Costa']))
      const text = labLine(key, fields)
      expect(text).not.toMatch(/[{}]/)
      expect(text.length).toBeGreaterThan(8)
      expect(text).toMatch(/[.]$/)
    }
  })

  it('the two lines the contract names read as specified', () => {
    expect(labLine('samplesReceived', { ticket: 'P023' })).toBe("Lab received P023's samples.")
    expect(labLine('labResults', { name: 'Ana Costa', min: 31 })).toBe('Results ready for Ana Costa, 31 min after the draw.')
  })

  it('rejects a line with a wrong placeholder', () => {
    expect(LabCopySchema.safeParse({ ...raw, labResults: 'Results ready for {who}.' }).success).toBe(false)
    expect(LabCopySchema.safeParse({ ...raw, demoReceived: 'Lab got {name}.' }).success).toBe(false)
  })

  it('keeps clear of graphic words', () => {
    for (const text of Object.values(LAB_COPY)) expect(text).not.toMatch(/\b(bleed\w*|gore|wounds?)\b/i)
  })
})
