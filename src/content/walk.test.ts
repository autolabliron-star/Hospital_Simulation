import { describe, expect, it } from 'vitest'
import walkJson from './walk.json'
import { DEFAULT_KEYMAP } from '@/sim/types'
import { WALK, WALK_FIELDS, WalkSchema, fillWalk, keyLabel } from './walk'

/** Every {placeholder} in a string. */
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1])
}

describe('walk.json', () => {
  it('parses against WalkSchema', () => {
    expect(WalkSchema.safeParse(walkJson).success).toBe(true)
  })

  it('rejects a missing line and an unknown key', () => {
    const copy = structuredClone(walkJson) as unknown as Record<string, Record<string, unknown>>
    delete copy.toast.lift
    expect(WalkSchema.safeParse(copy).success).toBe(false)
    const extra = structuredClone(walkJson) as unknown as Record<string, Record<string, unknown>>
    extra.prompt.shout = 'Hey'
    expect(WalkSchema.safeParse(extra).success).toBe(false)
  })

  it('the key hint keeps its four first keys and adds C (walkthrough) and N (next shot), every action a real key', () => {
    expect(WALK.hint.slice(0, 4).map((h) => [h.action, h.label])).toEqual([
      ['walk', 'Overview'],
      ['firstPerson', 'First person'],
      ['interact', 'Use'],
      ['shoulderSwap', 'Shoulder'],
    ])
    expect(WALK.hint.slice(4).map((h) => keyLabel(DEFAULT_KEYMAP[h.action]))).toEqual(['C', 'N'])
    for (const h of WALK.hint) expect(DEFAULT_KEYMAP[h.action], h.action).toBeTruthy()
    expect(new Set(WALK.hint.map((h) => h.action)).size).toBe(WALK.hint.length)
  })

  it('uses only the placeholders its field list allows, and every listed one', () => {
    const sections = WALK as unknown as Record<string, Record<string, string>>
    for (const [section, keys] of Object.entries(WALK_FIELDS)) {
      for (const [key, allowed] of Object.entries(keys as Record<string, readonly string[]>)) {
        const used = placeholders(sections[section][key])
        expect(new Set(used), `${section}.${key}`).toEqual(new Set(allowed))
      }
    }
  })

  it('has no placeholder in a line that is not listed as having them', () => {
    const sections = WALK as unknown as Record<string, Record<string, unknown>>
    for (const [section, lines] of Object.entries(sections)) {
      if (!Array.isArray(lines) && typeof lines === 'object') {
        for (const [key, value] of Object.entries(lines)) {
          if (typeof value !== 'string') continue
          const listed = (WALK_FIELDS as unknown as Record<string, Record<string, readonly string[]> | undefined>)[section]?.[key]
          if (!listed) expect(placeholders(value), `${section}.${key} has an unlisted placeholder`).toEqual([])
        }
      }
    }
  })

  it('keeps the HUD copy short and kind: one line, no shouting', () => {
    const all: string[] = []
    const walkTexts = (o: unknown): void => {
      if (typeof o === 'string') all.push(o)
      else if (Array.isArray(o)) o.forEach(walkTexts)
      else if (o && typeof o === 'object') Object.values(o).forEach(walkTexts)
    }
    walkTexts(WALK)
    for (const s of all) {
      expect(s.length, s).toBeLessThanOrEqual(90)
      expect(s, s).not.toMatch(/!/)
    }
  })

  it('fills a template and leaves an unknown placeholder visible', () => {
    expect(fillWalk(WALK.prompt.prescribe, { patient: 'Grace Adeyemi' })).toBe('Tablet for Grace Adeyemi')
    expect(fillWalk(WALK.objective.enRoute, { pod: 'A1', room: 'A3', eta: 'about 2 min' })).toBe('Pod A1 is bringing your order to A3: about 2 min')
    expect(fillWalk('Hello {who}', {})).toBe('Hello {who}')
  })
})

describe('keyLabel', () => {
  it('says what a key cap says', () => {
    expect(keyLabel('KeyE')).toBe('E')
    expect(keyLabel('Tab')).toBe('Tab')
    expect(keyLabel('Escape')).toBe('Esc')
    expect(keyLabel('ShiftLeft')).toBe('Shift')
    expect(keyLabel('Digit4')).toBe('4')
  })
})
