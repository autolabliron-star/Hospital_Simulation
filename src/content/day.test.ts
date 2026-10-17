import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { DAY_EVENT_TEMPLATES, DAY_MOMENTS, fillDayTemplate } from './day'
import dayJson from './day.json'
import { DAY_EVENT_FIELDS, DAY_EVENT_TYPES, DaySchema, PLACEHOLDER } from './schema'

/** The L1 event types from the brief (types.ts SimEventType, living day & bed flow). */
const L1_EVENTS = [
  'admittedToWard',
  'bedAssigned',
  'dischargeSigned',
  'doseWave',
  'huddle',
  'mealServed',
  'patientBoarding',
  'roomCleaned',
  'shiftHandover',
  'trayCollected',
  'wentHome',
]

describe('day.json parses', () => {
  it('parses against DaySchema', () => {
    expect(DaySchema.safeParse(dayJson).success).toBe(true)
  })
})

describe('moments match CONFIG.day.moments one to one', () => {
  it('has one moment per CONFIG.day.moments hour, in the same order', () => {
    expect(DAY_MOMENTS.map((m) => m.hour)).toEqual([...CONFIG.day.moments])
  })

  it('gives every moment a label and a one-line caption', () => {
    for (const m of DAY_MOMENTS) {
      expect(m.label.length, `${m.hour} label`).toBeGreaterThan(0)
      expect(m.caption.length, `${m.hour} caption`).toBeGreaterThan(0)
      expect(m.caption, `${m.hour} caption`).not.toMatch(/[\r\n]/)
    }
  })

  it('has unique labels', () => {
    const labels = DAY_MOMENTS.map((m) => m.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('names the handover, breakfast, rounds, discharges, lunch, visiting, dinner and night moments', () => {
    expect(DAY_MOMENTS[0].label).toBe('Shift handover')
    expect(DAY_MOMENTS[1].label).toBe('Breakfast')
    expect(DAY_MOMENTS[2].label).toBe('Ward rounds')
    expect(DAY_MOMENTS[3].label).toBe('Discharges')
    expect(DAY_MOMENTS[5].label).toBe('Visiting')
    expect(DAY_MOMENTS[6].label).toBe('Dinner')
    expect(DAY_MOMENTS[8].label).toBe('Night')
  })
})

describe('event templates', () => {
  it('lists exactly the L1 event types from the brief', () => {
    expect([...DAY_EVENT_TYPES].sort()).toEqual([...L1_EVENTS].sort())
  })

  it('every L1 event type has a template in day.json', () => {
    for (const type of L1_EVENTS) {
      expect(typeof (dayJson.events as Record<string, unknown>)[type], type).toBe('string')
      expect(DAY_EVENT_TEMPLATES[type as keyof typeof DAY_EVENT_TEMPLATES], type).toBeTruthy()
    }
  })

  it('uses only the placeholders declared for its event', () => {
    for (const type of DAY_EVENT_TYPES) {
      const allowed = DAY_EVENT_FIELDS[type] as readonly string[]
      for (const [, name] of DAY_EVENT_TEMPLATES[type].matchAll(PLACEHOLDER)) expect(allowed, `${type} {${name}}`).toContain(name)
    }
  })

  it('fills every placeholder, leaving no braces behind', () => {
    const values: Record<string, string | number> = {
      doctor: 'Dr. Mendes',
      patient: 'Grace Adeyemi',
      room: 'A5',
      days: 4,
      bay: 'ER bay 2',
      nurse: 'Nurse Ava',
      hub: 'Ward A nurse hub',
      topic: 'safety check',
      ward: 'Ward A',
      colleague: 'Nurse Maya',
      host: 'Host Ilona',
      dish: 'Lentil soup',
      time: '12:00',
      count: 6,
    }
    for (const type of DAY_EVENT_TYPES) {
      const text = fillDayTemplate(type, values)
      expect(text, type).not.toMatch(/[{}]/)
      expect(text.length, type).toBeGreaterThan(10)
    }
  })

  it('writes the house-style sentences the brief gives', () => {
    expect(fillDayTemplate('wentHome', { patient: 'Grace Adeyemi', days: 4 })).toBe('Grace Adeyemi went home after 4 days.')
    expect(fillDayTemplate('roomCleaned', { room: 'A5' })).toBe('Room A5 is clean and ready.')
    expect(fillDayTemplate('bedAssigned', { room: 'A5', patient: 'Leo Park', bay: 'ER bay 2' })).toBe('Bed A5 assigned to Leo Park (ER bay 2).')
  })

  it('throws when a value for one of its placeholders is missing', () => {
    expect(() => fillDayTemplate('wentHome', { patient: 'Grace Adeyemi' })).toThrow(/\{days\}/)
  })
})

describe('schema rejects bad day files', () => {
  it('rejects a moment hour that CONFIG.day.moments does not have', () => {
    const moments = dayJson.moments.map((m, i) => (i === 0 ? { ...m, hour: 6.5 } : m))
    expect(DaySchema.safeParse({ ...dayJson, moments }).success).toBe(false)
  })

  it('rejects a missing event template', () => {
    const events = Object.fromEntries(Object.entries(dayJson.events).filter(([type]) => type !== 'huddle'))
    expect(DaySchema.safeParse({ ...dayJson, events }).success).toBe(false)
  })

  it('rejects a placeholder the event does not declare', () => {
    const events = { ...dayJson.events, wentHome: '{patient} went home after {weeks} weeks.' }
    expect(DaySchema.safeParse({ ...dayJson, events }).success).toBe(false)
  })

  it('rejects an unknown event type', () => {
    const events = { ...dayJson.events, unknownEvent: 'Something happened.' }
    expect(DaySchema.safeParse({ ...dayJson, events }).success).toBe(false)
  })
})
