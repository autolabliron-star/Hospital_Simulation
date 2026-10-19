import { describe, expect, it } from 'vitest'
import raw from './kioskUi.json'
import { FIELD_KEYS, KIOSK_UI, KioskUiSchema, PHASES, UI_FIELDS, fillUi, formatValue, inRange, stepOf } from './kioskUi'

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])

/** Every string of the copy with its dotted path. */
function strings(o: unknown, path = ''): [string, string][] {
  if (typeof o === 'string') return [[path, o]]
  if (Array.isArray(o)) return []
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}

describe('kioskUi.json', () => {
  it('parses, and covers every kiosk phase and every card field', () => {
    expect(Object.keys(KIOSK_UI.steps).sort()).toEqual([...PHASES].sort())
    expect(Object.keys(KIOSK_UI.fields).sort()).toEqual([...FIELD_KEYS].sort())
    for (const p of PHASES) {
      expect(stepOf(p).title.length).toBeGreaterThan(0)
      expect(stepOf(p).hint.length).toBeGreaterThan(0)
    }
  })

  it('rejects a missing phase, an unknown key, an empty line and a range that is not low < high', () => {
    expect(KioskUiSchema.safeParse(raw).success).toBe(true)
    const missing = structuredClone(raw) as unknown as { steps: Record<string, unknown> }
    delete missing.steps.bp
    expect(KioskUiSchema.safeParse(missing).success).toBe(false)
    const extra = structuredClone(raw) as unknown as Record<string, unknown>
    extra.shout = 'Hey'
    expect(KioskUiSchema.safeParse(extra).success).toBe(false)
    const empty = structuredClone(raw) as unknown as { footer: string }
    empty.footer = ''
    expect(KioskUiSchema.safeParse(empty).success).toBe(false)
    const flipped = structuredClone(raw) as unknown as { ranges: { sys: [number, number] } }
    flipped.ranges.sys = [140, 90]
    expect(KioskUiSchema.safeParse(flipped).success).toBe(false)
    const multi = structuredClone(raw) as unknown as { disclaimer: string }
    multi.disclaimer = 'two\nlines'
    expect(KioskUiSchema.safeParse(multi).success).toBe(false)
  })

  it('uses only the placeholders its list allows, and every listed one', () => {
    const all = strings(KIOSK_UI)
    for (const [path, value] of all) {
      const used = new Set(placeholders(value))
      const allowed = UI_FIELDS[path]
      if (allowed) expect(used, path).toEqual(new Set(allowed))
      else expect([...used], `${path} has an unlisted placeholder`).toEqual([])
    }
  })

  it('every template fills, and a missing value throws', () => {
    for (const [path, allowed] of Object.entries(UI_FIELDS)) {
      const template = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], KIOSK_UI) as string
      const values = Object.fromEntries(allowed.map((k) => [k, 7]))
      expect(placeholders(fillUi(template, values)), path).toEqual([])
      if (allowed.length > 0) expect(() => fillUi(template, {}), path).toThrow()
    }
  })

  it('copy is short, one line, kind, never a judgement of a value, and says Simulated', () => {
    for (const [path, value] of strings(KIOSK_UI)) {
      expect(value.length, path).toBeLessThanOrEqual(70)
      expect(value, path).not.toMatch(/[!]/)
      expect(value, path).not.toMatch(/\b(normal|abnormal|high|low|elevated|healthy|unhealthy|good|bad|risk\w*|danger\w*|concern\w*|diagnos\w*|hypertens\w*|obese|overweight|worrying|alarming)\b/i)
    }
    expect(KIOSK_UI.footer).toBe('Simulated')
    expect(KIOSK_UI.card.sent).toMatch(/Simulated/)
    expect(KIOSK_UI.triageScreen.footer).toMatch(/Simulated/)
    expect(KIOSK_UI.disclaimer).toMatch(/Simulated/)
  })

  it('writes values with each field\'s decimals, and a dash while a value is not measured', () => {
    expect(formatValue('weight', 71.43)).toBe('71.4')
    expect(formatValue('height', 172.4)).toBe('172')
    expect(formatValue('bmi', null)).toBe(KIOSK_UI.pending)
    expect(formatValue('temp', undefined)).toBe(KIOSK_UI.pending)
    expect(formatValue('spo2', Number.NaN)).toBe(KIOSK_UI.pending)
  })

  it('"usual range" is a style test on content ranges: unmeasured values are never styled', () => {
    expect(inRange('sys', 124)).toBe(true)
    expect(inRange('sys', 150)).toBe(false)
    expect(inRange('spo2', 97)).toBe(true)
    expect(inRange('spo2', 91)).toBe(false)
    expect(inRange('temp', null)).toBe(true)
    for (const [lo, hi] of Object.values(KIOSK_UI.ranges)) expect(lo).toBeLessThan(hi)
  })
})
