import { describe, expect, it } from 'vitest'
import { AREAS, DOORS, SIGNS } from '@/sim/places'
import { allSigns } from '@/scene/wayfinding/signsL2'
import signsJson from './signs.json'
import { MAX_DETAIL, MAX_LABEL, MAX_TITLE, ROOM_PLATE_CAPTION, SIGNS_CONTENT, SIGN_ACCENTS, SignsSchema, destinationCopy, doorPlateCopy, signTitle } from './signs'

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(signsJson)) as Record<string, unknown>

describe('wayfinding copy (src/content/signs.json)', () => {
  it('parses with its own schema', () => {
    expect(SignsSchema.safeParse(signsJson).success).toBe(true)
    expect(Object.keys(SIGNS_CONTENT.destinations).length).toBeGreaterThan(8)
    expect(ROOM_PLATE_CAPTION).toBe('Room')
  })

  it('has words for every place a hanging sign points to and a title for every sign', () => {
    for (const s of allSigns(SIGNS)) {
      expect(signTitle(s.id), `title of ${s.id}`).toBeDefined()
      for (const p of s.points) expect(destinationCopy(p), `${s.id} points to ${p}`).toBeDefined()
    }
  })

  it('only names areas, signs and doors that exist', () => {
    const areaIds = new Set<string>(AREAS.map((a) => a.id))
    for (const id of Object.keys(SIGNS_CONTENT.destinations)) expect(areaIds.has(id), `destination ${id}`).toBe(true)
    const signIds = new Set(allSigns(SIGNS).map((s) => s.id))
    for (const id of Object.keys(SIGNS_CONTENT.signs)) expect(signIds.has(id), `sign ${id}`).toBe(true)
    const doorIds = new Set(DOORS.map((d) => d.id))
    for (const id of Object.keys(SIGNS_CONTENT.plates.doors)) expect(doorIds.has(id), `door ${id}`).toBe(true)
  })

  it('every word fits its sign and carries no stray spaces or placeholder text', () => {
    const all: string[] = []
    for (const d of Object.values(SIGNS_CONTENT.destinations)) {
      expect(d.label.length).toBeLessThanOrEqual(MAX_LABEL)
      expect(d.detail?.length ?? 0).toBeLessThanOrEqual(MAX_DETAIL)
      expect(SIGN_ACCENTS).toContain(d.accent)
      all.push(d.label, ...(d.detail ? [d.detail] : []))
    }
    for (const s of Object.values(SIGNS_CONTENT.signs)) {
      expect(s.title.length).toBeLessThanOrEqual(MAX_TITLE)
      all.push(s.title)
    }
    for (const p of Object.values(SIGNS_CONTENT.plates.doors)) all.push(p.label, ...(p.sub ? [p.sub] : []))
    all.push(ROOM_PLATE_CAPTION)
    for (const text of all) {
      expect(text, text).toBe(text.trim())
      expect(text, text).not.toMatch(/TEMPLATE|\{|\}/)
    }
  })

  it('the lookups return undefined for an unknown key (and never a prototype property)', () => {
    expect(destinationCopy('nowhere')).toBeUndefined()
    expect(destinationCopy('constructor')).toBeUndefined()
    expect(signTitle('toString')).toBeUndefined()
    expect(doorPlateCopy('__proto__')).toBeUndefined()
    expect(doorPlateCopy('staffA')?.label).toBe('Staff room')
  })

  it('the schema rejects bad content: a label that is too long, an unknown accent, an empty word, an extra field', () => {
    const tooLong = clone()
    ;(tooLong.destinations as Record<string, { label: string }>).lobby.label = 'x'.repeat(MAX_LABEL + 1)
    expect(SignsSchema.safeParse(tooLong).success).toBe(false)
    const accent = clone()
    ;(accent.destinations as Record<string, { accent: string }>).lobby.accent = 'rainbow'
    expect(SignsSchema.safeParse(accent).success).toBe(false)
    const empty = clone()
    ;(empty.signs as Record<string, { title: string }>)['lobby-east'].title = ''
    expect(SignsSchema.safeParse(empty).success).toBe(false)
    const extra = clone()
    ;(extra.plates as Record<string, unknown>).stickers = {}
    expect(SignsSchema.safeParse(extra).success).toBe(false)
  })
})
