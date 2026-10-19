import { describe, expect, it } from 'vitest'
import { LAB } from '@/sim/places'
import raw from './labUi.json'
import { LAB_MODULE_IDS, LAB_UI, LAB_UI_FIELDS, LabUiSchema, durationText, fillLab } from './labUi'

const placeholders = (s: string): string[] => [...s.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1])

/** Every string of the copy with its dotted path. */
function strings(o: unknown, path = ''): [string, string][] {
  if (typeof o === 'string') return [[path, o]]
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}

describe('labUi.json', () => {
  it('parses against its schema, and rejects a missing line or an unknown key', () => {
    expect(LabUiSchema.safeParse(raw).success).toBe(true)
    const missing = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    delete missing.prompt.totem
    expect(LabUiSchema.safeParse(missing).success).toBe(false)
    const extra = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    extra.prompt.shout = 'Hey'
    expect(LabUiSchema.safeParse(extra).success).toBe(false)
  })

  it('uses only the placeholders its list allows, and every listed one', () => {
    for (const [path, text] of strings(LAB_UI)) {
      const listed = LAB_UI_FIELDS[path]
      if (listed) expect(new Set(placeholders(text)), path).toEqual(new Set(listed))
      else expect(placeholders(text), `${path} has an unlisted placeholder`).toEqual([])
    }
    for (const path of Object.keys(LAB_UI_FIELDS)) expect(strings(LAB_UI).some(([p]) => p === path), `${path} is listed but missing`).toBe(true)
  })

  it('names every lab module of the contract, and the panel says "Simulated"', () => {
    for (const m of LAB.modules) expect(LAB_MODULE_IDS as readonly string[], m.id).toContain(m.id)
    expect(LAB_UI.simulated).toMatch(/^Simulated/)
  })

  it('keeps every line short (the screens are 320 px wide), with no shouting except the labelled priority and screen titles', () => {
    for (const [path, text] of strings(LAB_UI)) {
      expect(text.length, path).toBeLessThanOrEqual(120)
      expect(text, path).not.toMatch(/!/)
    }
    for (const [path, text] of strings(LAB_UI.tiles)) if (!path.endsWith('title')) expect(text.length, path).toBeLessThanOrEqual(30)
  })

  it('fills templates and says durations plainly', () => {
    expect(fillLab('{n} min', { n: 4 })).toBe('4 min')
    expect(fillLab('{a} {b}', { a: 'x' })).toBe('x {b}')
    expect(durationText(2)).toBe(LAB_UI.units.justNow)
    expect(durationText(30)).toBe('30 s')
    expect(durationText(600)).toBe('10 min')
    expect(durationText(Number.NaN)).toBe(LAB_UI.units.none)
  })
})
