import { describe, expect, it } from 'vitest'
import {
  BARKS,
  GREET_ROLE_LIST,
  MAX_BARK_WORDS,
  MIN_LINES,
  TALK_FIELDS,
  TALK_KEYS,
  barkEvent,
  fillBark,
  greetLines,
  helloFor,
  placeholdersOf,
  talkLines,
  timeOfDay,
  urgentTalkKey,
  greetsBack,
  wordCount,
} from './barks'
import { PATIENTS } from './catalogue'
import { OUTPATIENTS } from './imaging'
import { FIRST_NAMES, LAST_NAMES, normaliseName } from './roster'
import { HOSTS, NIGHT_STAFF, STAFF } from './staff'

/** Every line of the file, with where it is. */
function allLines(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = []
  for (const role of GREET_ROLE_LIST) BARKS.greetings[role].forEach((text, i) => out.push({ where: `greetings.${role}[${i}]`, text }))
  for (const key of TALK_KEYS) BARKS.talk[key].forEach((text, i) => out.push({ where: `talk.${key}[${i}]`, text }))
  out.push({ where: 'events.talkedTo', text: BARKS.events.talkedTo })
  return out
}

describe('barks.json (W1: what people say to you)', () => {
  it('has a list for every role and every situation, each with at least two lines', () => {
    for (const role of GREET_ROLE_LIST) expect(BARKS.greetings[role].length, role).toBeGreaterThanOrEqual(MIN_LINES)
    for (const key of TALK_KEYS) expect(talkLines(key).length, key).toBeGreaterThanOrEqual(MIN_LINES)
    expect(Object.keys(BARKS.talk).sort()).toEqual([...TALK_KEYS].sort())
  })

  it('keeps every bubble short and plain', () => {
    for (const { where, text } of allLines()) {
      expect(wordCount(text), where).toBeLessThanOrEqual(MAX_BARK_WORDS)
      expect(text, where).toBe(text.trim())
    }
  })

  it('only uses placeholders the situation can fill, and fills them all', () => {
    for (const key of TALK_KEYS) {
      const allowed: readonly string[] = TALK_FIELDS[key]
      const fields = Object.fromEntries(allowed.map((f) => [f, f === 'minutes' || f === 'ready' ? 3 : `<${f}>`]))
      for (const line of talkLines(key)) {
        for (const name of placeholdersOf(line)) expect(allowed, `${key}: ${line}`).toContain(name)
        expect(fillBark(line, fields), `${key}: ${line}`).not.toMatch(/[{}]/)
      }
    }
    for (const role of GREET_ROLE_LIST) {
      for (const line of greetLines(role)) expect(fillBark(line, { hello: 'Morning' }), line).not.toMatch(/[{}]/)
    }
  })

  it('throws, rather than show a stray {placeholder}, when a value is missing', () => {
    expect(() => fillBark('Room {room} is ready.', {})).toThrow(/room/)
    expect(fillBark('No fields here.')).toBe('No fields here.')
  })

  it('says what the plan says: the talk line', () => {
    expect(barkEvent('talkedTo', { name: 'Maya' })).toBe('You spoke with Maya.')
  })

  it('names nobody: names only ever arrive through placeholders', () => {
    const names = new Set<string>()
    const words = (n: string) => n.split(/[\s.]+/).filter(Boolean).map(normaliseName)
    for (const s of [...STAFF, ...NIGHT_STAFF, ...HOSTS]) words(s.name).forEach((w) => w.length > 3 && names.add(w))
    for (const n of [...PATIENTS.map((p) => p.name), ...OUTPATIENTS.map((o) => o.name)]) words(n).forEach((w) => names.add(w))
    for (const n of [...FIRST_NAMES, ...LAST_NAMES]) names.add(normaliseName(n))
    // role words ("Doctor", "Nurse") are not names
    for (const role of ['doctor', 'nurse', 'pharmacist', 'porter', 'cleaner', 'receptionist', 'coordinator', 'paramedic', 'host']) names.delete(role)
    for (const { where, text } of allLines()) {
      for (const w of text.replace(/\{\w+\}/g, '').split(/[^\p{L}]+/u).map(normaliseName)) {
        if (w.length > 0) expect(names.has(w), `${where}: "${w}"`).toBe(false)
      }
    }
  })

  it('gives no medical advice, doses or diagnoses', () => {
    const bad = /\b(mg|ml|dosage|diagnos\w*|cure[sd]?|symptoms?|you should|you must|you need to|stop taking|start taking|side effects?)\b/i
    for (const { where, text } of allLines()) expect(text, where).not.toMatch(bad)
  })

  it('greets by the time of day', () => {
    expect(timeOfDay(7.5)).toBe('morning')
    expect(timeOfDay(12)).toBe('afternoon')
    expect(timeOfDay(18)).toBe('evening')
    expect(timeOfDay(23)).toBe('night')
    expect(helloFor(8)).toBe('Morning')
    expect(helloFor(23)).toBe('Hello')
  })

  it('priority 1-2 patients are never cheerful: urgent variants by acuity, and they do not greet back', () => {
    // the cheerful lines of the ordinary situations
    const cheerful = /\b(kind|comfortable|lovely|wonderful|great|happy|fine|nicely|thank you so much)\b|!/i
    for (const key of ['er.urgent.waiting', 'er.urgent.inBay', 'er.urgent.tests'] as const) {
      for (const line of talkLines(key)) expect(line, `${key}: ${line}`).not.toMatch(cheerful)
    }
    for (const key of ['er.arriving', 'er.checkIn', 'er.waitingTriage', 'er.waitingDoctor'] as const) {
      expect(urgentTalkKey(key, 1)).toBe('er.urgent.waiting')
      expect(urgentTalkKey(key, 2)).toBe('er.urgent.waiting')
      expect(urgentTalkKey(key, 3)).toBe(key)
    }
    expect(urgentTalkKey('er.inBay', 2)).toBe('er.urgent.inBay')
    expect(urgentTalkKey('er.bloodResults', 1)).toBe('er.urgent.tests')
    expect(urgentTalkKey('er.leavingHome', 1)).toBe('er.leavingHome')
    expect(urgentTalkKey('er.inBay', 5)).toBe('er.inBay')
    expect(greetsBack(1)).toBe(false)
    expect(greetsBack(2)).toBe(false)
    expect(greetsBack(4)).toBe(true)
  })
})
