import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import erEventsJson from './erEvents.json'
import { ER_EVENTS, ER_LINE_FIELDS, ErEventsSchema, erLine, joinCareItems, type ErLineKey } from './erEvents'

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
const KEYS = Object.keys(ER_LINE_FIELDS) as ErLineKey[]
const textOf = (key: ErLineKey): string => {
  const [section, name] = key.split('.')
  return (ER_EVENTS as unknown as Record<string, Record<string, string>>)[section][name]
}

describe('erEvents.json (F-33: the ER event lines live in content)', () => {
  it('parses, and rejects a wrong or a missing placeholder and an extra line', () => {
    expect(ErEventsSchema.safeParse(erEventsJson).success).toBe(true)
    const wrong = structuredClone(erEventsJson) as unknown as Record<string, Record<string, string>>
    wrong.patient.discharged = '{patient} was discharged home after {minutes} min in {room}.'
    expect(ErEventsSchema.safeParse(wrong).success).toBe(false)
    const missing = structuredClone(erEventsJson) as unknown as Record<string, Record<string, string>>
    missing.patient.discharged = '{patient} was discharged home.'
    expect(ErEventsSchema.safeParse(missing).success).toBe(false)
    const extra = structuredClone(erEventsJson) as unknown as Record<string, Record<string, string>>
    extra.cleaner.somethingElse = 'x'
    expect(ErEventsSchema.safeParse(extra).success).toBe(false)
  })

  it('uses exactly the placeholders each line lists, one line each, no stray braces', () => {
    for (const key of KEYS) {
      const text = textOf(key)
      expect([...new Set(placeholders(text))].sort(), key).toEqual([...ER_LINE_FIELDS[key]].sort())
      expect(text, key).not.toMatch(/[\r\n]/)
      expect(text.replace(/\{\w+\}/g, ''), key).not.toMatch(/[{}]/)
      expect(text, key).toMatch(/[.]$/)
    }
  })

  it('fills a line and throws when a value is missing', () => {
    expect(erLine('patient.discharged', { patient: 'Ana Costa', minutes: 42 })).toBe('Ana Costa was discharged home after 42 min.')
    expect(erLine('cleaner.bayCleaned', { bay: 3 })).toBe('ER bay 3 is clean and ready.')
    expect(() => erLine('patient.discharged', { patient: 'Ana Costa' } as never)).toThrow(/minutes/)
  })

  it('joins the care items the UK way, with no comma before the "and"', () => {
    expect(joinCareItems(['observations'])).toBe('observations')
    expect(joinCareItems(['observations', 'a cannula'])).toBe('observations and a cannula')
    expect(joinCareItems(['observations', 'a cannula', 'an ECG', 'bloods'])).toBe('observations, a cannula, an ECG and bloods')
  })

  it('says the early scan and the triage ECG for what they are', () => {
    expect(erLine('patient.scanOrderedEarly', { nurse: 'Nurse Bianca', scan: 'CT head', patient: 'Ana Costa', priority: 2 })).toMatch(/straight away.*does not wait for the doctor/)
    expect(erLine('patient.triageEcg', { patient: 'Ana Costa' })).toMatch(/ECG.*triage/)
  })

  it('leaves no event sentence in the ER sources: every say() of patient.ts, porter.ts and cleaner.ts takes its text from content', () => {
    const dir = fileURLToPath(new URL('../sim/er/', import.meta.url))
    for (const f of ['patient.ts', 'porter.ts', 'cleaner.ts']) {
      const src = readFileSync(`${dir}${f}`, 'utf8')
      // a say('type', `...` | '...' | "...") with a literal as its text
      expect(src.match(/\.say\(\s*'\w+',\s*[`'"]/g), f).toBeNull()
    }
  })
})
