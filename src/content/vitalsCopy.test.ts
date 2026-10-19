import { describe, expect, it } from 'vitest'
import raw from './vitalsCopy.json'
import { JUDGEMENT_WORDS, VITALS_COPY, placeholdersOf, renderLine, type HealthCheckLine } from './vitalsCopy'

const LINES = Object.keys(VITALS_COPY.healthCheck) as HealthCheckLine[]

describe('vitalsCopy.json', () => {
  it('has every line the kiosks say', () => {
    expect(LINES.sort()).toEqual(['early', 'earlyWithBp', 'er', 'guide', 'player', 'walkUp'])
  })

  it('is the file that was parsed', () => {
    expect(VITALS_COPY).toEqual(raw)
  })

  it('renders each line with its own placeholders and nothing left over', () => {
    const values = { name: 'Maya Cohen', guide: 'Nurse Ingrid', kiosk: 2, sys: 126, dia: 79, spo2: 97, bmi: 24.8 }
    for (const line of LINES) {
      const text = renderLine(line, values)
      expect(text, line).not.toMatch(/[{}]/)
      expect(text.length, line).toBeLessThanOrEqual(130)
      expect(text, line).toMatch(/\.$/)
    }
  })

  it('says exactly what the brief asks for an ER walk-in', () => {
    expect(renderLine('er', { name: 'Ana Silva', sys: 124, dia: 78, spo2: 98 })).toBe('Ana Silva finished a health check: BP 124/78, SpO₂ 98%, sent to triage.')
  })

  it('states values only: no judgement words, no dashes', () => {
    for (const line of LINES) {
      const text = VITALS_COPY.healthCheck[line]
      expect(text, line).not.toMatch(JUDGEMENT_WORDS)
      expect(text, line).not.toMatch(/[—–]/)
    }
  })

  it('every placeholder a line uses is allowed for it', () => {
    for (const line of LINES) {
      const used = [...VITALS_COPY.healthCheck[line].matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      for (const key of used) expect(placeholdersOf(line), `${line} {${key}}`).toContain(key)
    }
  })

  it('a missing value is a loud error, not a silent "undefined"', () => {
    expect(() => renderLine('er', { name: 'Ana Silva' })).toThrow(/needs \{sys\}/)
  })
})
