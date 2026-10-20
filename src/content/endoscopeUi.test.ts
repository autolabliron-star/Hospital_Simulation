import { describe, expect, it } from 'vitest'
import { SURGERY_COPY } from './surgery'
import raw from './endoscopeUi.json'
import { ENDOSCOPE_UI, EndoscopeUiSchema, LOOK_IDS, SHORT_MAX } from './endoscopeUi'

/** Every string of the copy with its dotted path. */
function strings(o: unknown, path = ''): [string, string][] {
  if (typeof o === 'string') return [[path, o]]
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}

describe('endoscopeUi.json', () => {
  it('parses against its schema, and rejects a missing line, an unknown key, an unknown look and graphic words', () => {
    expect(EndoscopeUiSchema.safeParse(raw).success).toBe(true)
    const missing = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    delete missing.hud.simulated
    expect(EndoscopeUiSchema.safeParse(missing).success).toBe(false)
    const extra = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    extra.hud.shout = 'Hey'
    expect(EndoscopeUiSchema.safeParse(extra).success).toBe(false)
    const badLook = structuredClone(raw) as unknown as { instruments: Record<string, { look: string }> }
    badLook.instruments['Hook electrode'].look = 'laser'
    expect(EndoscopeUiSchema.safeParse(badLook).success).toBe(false)
    const graphic = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    graphic.hud.exchanging = 'Bleeding'
    expect(EndoscopeUiSchema.safeParse(graphic).success).toBe(false)
  })

  it('maps every instrument of every procedure, the exchanged ones too, to a look and a short chip label', () => {
    const names = new Set<string>()
    for (const p of Object.values(SURGERY_COPY.procedures)) for (const n of [...p.instruments, ...p.exchanges]) names.add(n)
    expect(names.size).toBeGreaterThanOrEqual(8)
    for (const n of names) {
      const m = ENDOSCOPE_UI.instruments[n]
      expect(m, `"${n}" has no look`).toBeDefined()
      expect(LOOK_IDS).toContain(m.look)
      expect(m.short.length, n).toBeLessThanOrEqual(SHORT_MAX)
    }
    // the camera arm's instrument is the endoscope, which is never drawn in its own picture
    expect(ENDOSCOPE_UI.instruments['Endoscope 30°'].look).toBe('endoscope')
    // and no mapped name is stale
    for (const n of Object.keys(ENDOSCOPE_UI.instruments)) expect(names.has(n), `"${n}" is not an instrument any procedure uses`).toBe(true)
  })

  it('says "Simulated" and "30°" in the picture, and every string is one short, non-graphic line', () => {
    expect(ENDOSCOPE_UI.hud.simulated).toBe('Simulated')
    expect(ENDOSCOPE_UI.hud.camera).toBe('30°')
    for (const [path, text] of strings(ENDOSCOPE_UI)) {
      expect(text.length, path).toBeLessThanOrEqual(40)
      expect(text, path).not.toMatch(/[\r\n!]/)
      expect(text, path).not.toMatch(/blood|incision|bleed/i)
    }
  })
})
