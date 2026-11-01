import { describe, expect, it } from 'vitest'
import { PROCEDURE_IDS, PROCEDURE_SCRIPTS } from './procedures'
import json from './watch.json'
import { fillWatch, overlayWords, panelWords, WATCH, WATCH_PROCEDURE_IDS, WatchCopySchema } from './watch'
import { GRAPHIC_WORDS, US_WORDS } from './procedures'

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

  it('has the CT suite\'s and the ultrasound room\'s own lines (R5 wave 3): UK words, non-graphic, one line each, with the team\'s hours to fill in', () => {
    for (const room of ['cryo', 'us'] as const) {
      const p = WATCH.panelRooms[room]
      const o = WATCH.overlayRooms[room]
      for (const [k, v] of [...Object.entries(p), ...Object.entries(o)]) {
        expect(v, `${room} ${k}`).not.toMatch(GRAPHIC_WORDS)
        expect(v, `${room} ${k}`).not.toMatch(US_WORDS)
        expect(v, `${room} ${k}`).not.toMatch(/[\r\n]/)
      }
      expect(p.noTeam).toContain('{from}')
      expect(p.noTeam).toContain('{to}')
      expect(o.startsIn).toContain('{time}')
      expect(fillWatch(p.noTeam, { from: '08:00', to: '17:30' })).not.toMatch(/[{}]/)
      expect(fillWatch(o.startsIn, { time: '4:12' })).toContain('4:12')
    }
    expect(WATCH.rooms.cryo).toMatch(/CT/)
    expect(WATCH.rooms.us).toMatch(/[Uu]ltrasound/)
  })

  it('gives a room the theatre\'s words where it has none of its own, and its own where it has', () => {
    expect(panelWords('or')).toBe(WATCH.panel)
    expect(overlayWords('or')).toBe(WATCH.overlay)
    for (const room of ['cryo', 'us'] as const) {
      const p = panelWords(room)
      expect(p.button).toBe(WATCH.panel.button) // the same button everywhere
      expect(p.watchCurrent).toBe(WATCH.panel.watchCurrent)
      expect(p.noScript).toBe(WATCH.panel.noScript)
      expect(p.pick).toBe(WATCH.panelRooms[room].pick)
      expect(p.noTeam).not.toBe(WATCH.panel.noTeam)
      expect(p.following).not.toBe(WATCH.panel.following)
      const o = overlayWords(room)
      expect(o.step).toBe(WATCH.overlay.step)
      expect(o.exit).toBe(WATCH.overlay.exit)
      expect(o.startsIn).toBe(WATCH.overlayRooms[room].startsIn)
      expect(o.startsIn).not.toBe(WATCH.overlay.startsIn)
    }
    // the ultrasound patient walks home: never "recovery"
    expect(WATCH.overlayRooms.us.endedWhy).not.toMatch(/recovery/)
  })

  it('rejects a room line that is missing or a room that is unknown', () => {
    const { cryo: _gone, ...onlyUs } = json.panelRooms
    expect(() => WatchCopySchema.parse({ ...json, panelRooms: onlyUs })).toThrow()
    expect(() => WatchCopySchema.parse({ ...json, overlayRooms: { ...json.overlayRooms, or: json.overlayRooms.us } })).toThrow()
    const { noTeam: _noTeam, ...rest } = json.panelRooms.us
    expect(() => WatchCopySchema.parse({ ...json, panelRooms: { ...json.panelRooms, us: rest } })).toThrow()
  })
})
