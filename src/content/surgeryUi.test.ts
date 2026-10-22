import { describe, expect, it } from 'vitest'
import raw from './surgeryUi.json'
import { SURGERY_UI, SURGERY_UI_FIELDS, SurgeryUiSchema, fillSurgery } from './surgeryUi'

const placeholders = (s: string): string[] => [...s.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1])

/** Every string of the copy with its dotted path. */
function strings(o: unknown, path = ''): [string, string][] {
  if (typeof o === 'string') return [[path, o]]
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}

describe('surgeryUi.json', () => {
  it('parses against its schema, and rejects a missing line or an unknown key', () => {
    expect(SurgeryUiSchema.safeParse(raw).success).toBe(true)
    const missing = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    delete missing.console.leave
    expect(SurgeryUiSchema.safeParse(missing).success).toBe(false)
    const extra = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    extra.prompts.shout = 'Hey'
    expect(SurgeryUiSchema.safeParse(extra).success).toBe(false)
    const graphic = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    graphic.console.leave = 'Watch the incision'
    expect(SurgeryUiSchema.safeParse(graphic).success).toBe(false)
  })

  it('every string is non-empty, one line, short enough for the screens, and has no exclamation mark', () => {
    for (const [path, text] of strings(SURGERY_UI)) {
      expect(text.length, path).toBeGreaterThan(0)
      expect(text.length, path).toBeLessThanOrEqual(120)
      expect(text, path).not.toMatch(/[\r\n]/)
      expect(text, path).not.toMatch(/!/)
    }
  })

  it('uses exactly the placeholders its field list allows, and every listed line exists', () => {
    for (const [path, text] of strings(SURGERY_UI)) {
      const listed = (SURGERY_UI_FIELDS as Record<string, readonly string[]>)[path]
      if (listed) expect(new Set(placeholders(text)), path).toEqual(new Set(listed))
      else expect(placeholders(text), `${path} has an unlisted placeholder`).toEqual([])
    }
    for (const path of Object.keys(SURGERY_UI_FIELDS)) {
      expect(strings(SURGERY_UI).some(([p]) => p === path), `${path} is listed but missing`).toBe(true)
    }
  })

  it('shows "Simulated" on the teaching console and on the panels', () => {
    expect(SURGERY_UI.console.subtitle).toMatch(/Simulated/)
    expect(SURGERY_UI.panel.tag).toBe('Simulated')
    expect(SURGERY_UI.panel.note).toMatch(/^Simulated/)
  })

  it('keeps the screens non-graphic: no blood or incision anywhere', () => {
    for (const [path, text] of strings(SURGERY_UI)) {
      expect(text, path).not.toMatch(/blood/i)
      expect(text, path).not.toMatch(/incision/i)
    }
  })

  it('names no brand on the screens', () => {
    for (const [path, text] of strings(SURGERY_UI)) expect(text, path).not.toMatch(/vinci/i)
  })

  it('has the level, lift and go-to words the contract names', () => {
    expect(SURGERY_UI.level.one).toBe('Level 1')
    expect(SURGERY_UI.level.two).toBe('Level 2 · Surgery')
    expect(SURGERY_UI.lift.toTwo).toBe('Take the lift to Level 2 · Surgery')
    expect(SURGERY_UI.lift.toOne).toBe('Take the lift to Level 1')
    expect(SURGERY_UI.lift.coverTwo).toBe('Level 2 · Surgery')
    expect(SURGERY_UI.lift.coverOne).toBe('Level 1 · Entrance and wards')
    expect(SURGERY_UI.goTo.group).toBe('Level 2 · Surgery')
  })

  it('has the console prompt, the viewing window, the pre-op desk and the PACU island', () => {
    expect(SURGERY_UI.console.prompt).toBe('E · Sit at the teaching console')
    expect(SURGERY_UI.console.subtitle).toBe('view only · Simulated')
    expect(SURGERY_UI.console.leave).toBe('E, Esc or a move key to stand up')
    expect(SURGERY_UI.prompts.viewingWindow).toBe('E · Watch the theatre through the window')
    expect(SURGERY_UI.prompts.preOpDesk).toMatch(/^E · /)
    expect(SURGERY_UI.prompts.pacuIsland).toMatch(/^E · /)
    expect(SURGERY_UI.panel.watch).toBe('Watch the endoscope view')
  })

  it('fills the standby line and the arm label, and reads plainly', () => {
    expect(fillSurgery(SURGERY_UI.console.standby, { procedure: 'Gallbladder', time: '10:30' })).toBe('The robot is not docked yet. Next: Gallbladder at 10:30.')
    expect(fillSurgery(SURGERY_UI.console.arm, { arm: 2 })).toBe('Arm 2')
    expect(fillSurgery(SURGERY_UI.panel.kpiValue.minutes, { n: 9 })).toBe('9 min')
    expect(fillSurgery(SURGERY_UI.panel.kpiValue.percent, { n: 64 })).toBe('64%')
    expect(fillSurgery('{a} {b}', { a: 'x' })).toBe('x {b}')
  })
})
