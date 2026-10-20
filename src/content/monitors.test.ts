import { describe, expect, it } from 'vitest'
import raw from './monitors.json'
import { ALARM_WORDS, fillMonitor, monitorFields, MONITORS } from './monitors'

/** Every string in the file, with its path. */
function strings(o: unknown, path = ''): [string, string][] {
  if (typeof o === 'string') return [[path, o]]
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
}

describe('monitors.json', () => {
  it('is the file that was parsed', () => {
    expect(MONITORS).toEqual(raw)
  })

  it('says "Simulated" and names every wave and parameter the monitors draw', () => {
    expect(MONITORS.simulated).toBe('Simulated')
    expect(Object.keys(MONITORS.waves).sort()).toEqual(['art', 'co2', 'ecg', 'ecgV', 'pleth', 'resp'])
    expect(MONITORS.params.spo2).toContain('SpO')
  })

  it('never shows an alarm or a judgement of a value', () => {
    for (const [path, text] of strings(MONITORS)) expect(text, path).not.toMatch(ALARM_WORDS)
    expect('HR high').toMatch(ALARM_WORDS)
    expect('Alarm off').toMatch(ALARM_WORDS)
  })

  it('templates use only their own placeholders and fill completely', () => {
    const values = { n: 3, time: '10:45' }
    for (const [path, allowed] of Object.entries(monitorFields())) {
      const text = strings(MONITORS).find(([p]) => p === path)?.[1]
      expect(text, path).toBeDefined()
      const used = [...text!.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      for (const u of used) expect(allowed, `${path} uses {${u}}`).toContain(u)
      expect(fillMonitor(text!, values), path).not.toMatch(/[{}]/)
    }
    expect(fillMonitor(MONITORS.beds.er, { n: 4 })).toBe('ER 4')
    expect(() => fillMonitor(MONITORS.beds.er, {})).toThrow()
  })
})
