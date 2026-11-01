import { describe, expect, it } from 'vitest'
import { PROCEDURE_IDS, PROCEDURE_SCRIPTS } from './procedures'
import json from './watch.json'
import { fillWatch, WATCH, WATCH_PROCEDURE_IDS, WatchCopySchema } from './watch'

describe('watch copy (R5)', () => {
  it('parses', () => {
    expect(() => WatchCopySchema.parse(json)).not.toThrow()
  })

  it('names every procedure, and every procedure that has a script has its title and detail', () => {
    expect([...WATCH_PROCEDURE_IDS].sort()).toEqual([...PROCEDURE_IDS].sort())
    for (const id of Object.keys(PROCEDURE_SCRIPTS) as (keyof typeof WATCH.procedures)[]) {
      expect(WATCH.procedures[id].title.length, id).toBeGreaterThan(0)
      expect(WATCH.procedures[id].detail.length, id).toBeGreaterThan(0)
    }
  })

  it('says "theatre", never the capital abbreviation, and fills its templates', () => {
    const text = JSON.stringify(json)
    expect(text).not.toMatch(/\bOR\b/)
    expect(WATCH.rooms.or.toLowerCase()).toContain('theatre')
    expect(fillWatch(WATCH.overlay.step, { k: 7, n: 32, caption: 'Clips placed on duct and artery' })).toBe('Step 7 of 32: Clips placed on duct and artery')
    expect(fillWatch(WATCH.overlay.startsIn, { time: '4:12' })).toContain('4:12')
    expect(fillWatch('{a} {b}', { a: 1 })).toBe('1 {b}')
  })

  it('rejects a multi-line line, a missing procedure and an unknown key', () => {
    expect(() => WatchCopySchema.parse({ ...json, panel: { ...json.panel, button: 'a\nb' } })).toThrow()
    const { 'or-cholecystectomy': _gone, ...rest } = json.procedures
    expect(() => WatchCopySchema.parse({ ...json, procedures: rest })).toThrow()
    expect(() => WatchCopySchema.parse({ ...json, extra: 'x' })).toThrow()
  })
})
