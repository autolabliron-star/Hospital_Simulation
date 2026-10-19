import { describe, expect, it } from 'vitest'
import type { DrawPhase } from '@/sim/types'
import drawJson from './drawUi.json'
import { DRAW_FIELDS, DRAW_UI, DrawUiSchema, fillDraw, phaseText } from './drawUi'

const placeholders = (s: string): string[] => [...s.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1])

const PHASES: DrawPhase[] = [
  'idle',
  'calling',
  'cardScan',
  'armIn',
  'cuff',
  'sanitise',
  'veinScan',
  'needleIn',
  'filling',
  'needleOut',
  'bandage',
  'release',
  'awaitPorter',
  'armMoved',
  'fallbackToNurse',
  'reset',
]

function strings(o: unknown, out: string[] = []): string[] {
  if (typeof o === 'string') out.push(o)
  else if (o && typeof o === 'object') Object.values(o).forEach((v) => strings(v, out))
  return out
}

describe('drawUi.json', () => {
  it('parses against its schema', () => {
    expect(DrawUiSchema.safeParse(drawJson).success).toBe(true)
  })

  it('rejects a missing line, a missing phase and an unknown key', () => {
    const copy = structuredClone(drawJson) as unknown as Record<string, Record<string, unknown>>
    delete copy.toast.ticket
    expect(DrawUiSchema.safeParse(copy).success).toBe(false)
    const noPhase = structuredClone(drawJson) as unknown as Record<string, Record<string, unknown>>
    delete noPhase.phase.veinScan
    expect(DrawUiSchema.safeParse(noPhase).success).toBe(false)
    const extra = structuredClone(drawJson) as unknown as Record<string, Record<string, unknown>>
    extra.prompt.shout = 'Hey'
    expect(DrawUiSchema.safeParse(extra).success).toBe(false)
    const multiline = structuredClone(drawJson) as unknown as Record<string, Record<string, unknown>>
    multiline.prompt.robot = 'two\nlines'
    expect(DrawUiSchema.safeParse(multiline).success).toBe(false)
  })

  it('uses exactly the placeholders its field list allows', () => {
    const sections = DRAW_UI as unknown as Record<string, Record<string, string>>
    for (const [section, keys] of Object.entries(DRAW_FIELDS)) {
      for (const [key, allowed] of Object.entries(keys as Record<string, readonly string[]>)) {
        expect(new Set(placeholders(sections[section][key])), `${section}.${key}`).toEqual(new Set(allowed))
      }
    }
  })

  it('has no placeholder in a line that is not listed as having them', () => {
    const sections = DRAW_UI as unknown as Record<string, Record<string, unknown>>
    for (const [section, lines] of Object.entries(sections)) {
      if (typeof lines !== 'object') continue
      for (const [key, value] of Object.entries(lines)) {
        if (typeof value !== 'string') continue
        const listed = (DRAW_FIELDS as unknown as Record<string, Record<string, readonly string[]> | undefined>)[section]?.[key]
        if (!listed) expect(placeholders(value), `${section}.${key}`).toEqual([])
      }
    }
  })

  it('keeps every line short and calm: one line, no shouting', () => {
    for (const s of strings(DRAW_UI)) {
      expect(s.length, s).toBeLessThanOrEqual(60)
      expect(s, s).not.toMatch(/!/)
      expect(s, s).toBe(s.trim())
    }
  })

  it('says it is simulated', () => {
    expect(DRAW_UI.disclaimer).toBe('Simulated, not real patient data')
  })

  it('has words for every phase, and filling names its tube', () => {
    for (const p of PHASES) {
      const t = phaseText(p, 1, 4)
      expect(t.length, p).toBeGreaterThan(2)
      expect(t, p).not.toMatch(/[{}]/)
    }
    expect(phaseText('filling', 1, 4)).toBe('Filling tube 2 of 4')
  })

  it('fills templates and leaves an unknown placeholder visible for the tests to catch', () => {
    expect(fillDraw(DRAW_UI.toast.ticket, { ticket: 'P023' })).toContain('P023')
    expect(fillDraw(DRAW_UI.panel.callLine, { ticket: 'V004', robot: 2 })).toBe('V004 → Robot 2')
    expect(fillDraw('{a} and {b}', { a: 1 })).toBe('1 and {b}')
    expect(fillDraw(DRAW_UI.speech.call, { ticket: 'P 0 2 3', robot: 3 })).toBe('Number P 0 2 3, please go to robot 3')
  })
})
