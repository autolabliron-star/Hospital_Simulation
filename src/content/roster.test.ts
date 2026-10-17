import { describe, expect, it, vi } from 'vitest'
import { STAFF, staffName } from '@/content/staff'
import { Rng } from '@/sim/rng'
import patientsJson from './patients.json'
import peopleJson from './people.json'
import {
  AMBULANCE_REASONS,
  ER_REASONS,
  FIRST_NAMES,
  LAST_NAMES,
  PeopleSchema,
  VISITOR_RELATIONS,
  normaliseName,
  syntheticName,
} from './roster'

/** Every word of a name, lower-cased and accent-free, so "Tomás" matches "Tomas". */
const tokens = (name: string): string[] =>
  name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map(normaliseName)

const NEW_STAFF: Array<[id: string, role: string, post: string]> = [
  ['doc-ER1', 'doctor', 'er'],
  ['doc-ER2', 'doctor', 'er'],
  ['nurse-ER1', 'nurse', 'er'],
  ['nurse-ER2', 'nurse', 'er'],
  ['nurse-T1', 'nurse', 'triage'],
  ['nurse-T2', 'nurse', 'triage'],
  ['recep-1', 'receptionist', 'reception'],
  ['porter-1', 'porter', 'transport'],
  ['porter-2', 'porter', 'transport'],
  ['porter-3', 'porter', 'transport'],
  ['cleaner-1', 'cleaner', 'housekeeping'],
  ['cleaner-2', 'cleaner', 'housekeeping'],
  ['para-1', 'paramedic', 'er'],
  ['para-2', 'paramedic', 'er'],
  ['rad-MRI', 'radiographer', 'imaging'],
  ['rad-CT', 'radiographer', 'imaging'],
  ['rad-XR', 'radiographer', 'imaging'],
  ['sono-1', 'sonographer', 'imaging'],
]

const EXISTING_STAFF = [
  { id: 'doc-A', role: 'doctor', ward: 'A', name: 'Dr. Levi', post: 'ward', shift: 'office' },
  { id: 'doc-B', role: 'doctor', ward: 'B', name: 'Dr. Okafor', post: 'ward', shift: 'office' },
  { id: 'nurse-A1', role: 'nurse', ward: 'A', name: 'Nurse Maya', post: 'ward', shift: 'day' },
  { id: 'nurse-A2', role: 'nurse', ward: 'A', name: 'Nurse Tomás', post: 'ward', shift: 'day' },
  { id: 'nurse-B1', role: 'nurse', ward: 'B', name: 'Nurse Leah', post: 'ward', shift: 'day' },
  { id: 'nurse-B2', role: 'nurse', ward: 'B', name: 'Nurse Kenji', post: 'ward', shift: 'day' },
  { id: 'pharm-A', role: 'pharmacist', ward: 'A', name: 'Pharmacist Noa', post: 'pharmacy', shift: 'day' },
  { id: 'pharm-B', role: 'pharmacist', ward: 'B', name: 'Pharmacist Ravi', post: 'pharmacy', shift: 'day' },
  { id: 'coord-1', role: 'coordinator', name: 'Coordinator Dana', post: 'command', shift: 'day' },
  { id: 'coord-2', role: 'coordinator', name: 'Coordinator Eli', post: 'command', shift: 'day' },
]

describe('people.json parses', () => {
  it('parses against PeopleSchema', () => {
    expect(PeopleSchema.safeParse(peopleJson).success).toBe(true)
  })

  it('has the counts the brief asks for', () => {
    expect(FIRST_NAMES).toHaveLength(80)
    expect(LAST_NAMES).toHaveLength(80)
    expect(ER_REASONS).toHaveLength(24)
    expect(AMBULANCE_REASONS).toHaveLength(8)
    expect(VISITOR_RELATIONS).toHaveLength(10)
  })

  it('has no duplicate names in either list', () => {
    expect(new Set(FIRST_NAMES.map(normaliseName)).size).toBe(FIRST_NAMES.length)
    expect(new Set(LAST_NAMES.map(normaliseName)).size).toBe(LAST_NAMES.length)
  })

  it('has no duplicate visitor relations or reason texts', () => {
    expect(new Set(VISITOR_RELATIONS).size).toBe(VISITOR_RELATIONS.length)
    expect(new Set(ER_REASONS.map((r) => r.text.toLowerCase())).size).toBe(ER_REASONS.length)
    expect(new Set(AMBULANCE_REASONS.map((r) => r.text.toLowerCase())).size).toBe(AMBULANCE_REASONS.length)
  })

  it('has no first or last name that collides with an existing patient or staff name', () => {
    const taken = new Set([...patientsJson.flatMap((p) => tokens(p.name)), ...STAFF.flatMap((s) => tokens(s.name))])
    const collisions = [...FIRST_NAMES, ...LAST_NAMES].map(normaliseName).filter((n) => taken.has(n))
    expect(collisions).toEqual([])
  })

  it('keeps every ER acuity in 1..5, mostly 3 to 5, with a few 2s and one or two 1s', () => {
    for (const r of ER_REASONS) {
      expect(r.acuity, r.text).toBeGreaterThanOrEqual(1)
      expect(r.acuity, r.text).toBeLessThanOrEqual(5)
    }
    const count = (a: number) => ER_REASONS.filter((r) => r.acuity === a).length
    expect(count(1)).toBeGreaterThanOrEqual(1)
    expect(count(1)).toBeLessThanOrEqual(2)
    expect(count(2)).toBeGreaterThanOrEqual(2)
    expect(count(2)).toBeLessThanOrEqual(4)
    expect(count(3) + count(4) + count(5)).toBeGreaterThanOrEqual(18)
  })

  it('keeps ambulance acuities in 1..3', () => {
    for (const r of AMBULANCE_REASONS) {
      expect(r.acuity, r.text).toBeGreaterThanOrEqual(1)
      expect(r.acuity, r.text).toBeLessThanOrEqual(3)
    }
  })

  it('keeps every reason to 3..7 words', () => {
    for (const r of [...ER_REASONS, ...AMBULANCE_REASONS]) {
      const words = r.text.trim().split(/\s+/).length
      expect(words, r.text).toBeGreaterThanOrEqual(3)
      expect(words, r.text).toBeLessThanOrEqual(7)
    }
  })
})

describe('syntheticName', () => {
  it('is deterministic for a seeded Rng', () => {
    const draw = (rng: Rng) => Array.from({ length: 50 }, () => syntheticName(rng))
    const a = draw(new Rng(1))
    const b = draw(new Rng(1))
    expect(a).toEqual(b)
    for (const name of a) {
      const [first, last, extra] = name.split(' ')
      expect(extra, name).toBeUndefined()
      expect(FIRST_NAMES, name).toContain(first)
      expect(LAST_NAMES, name).toContain(last)
    }
  })

  it('does not call Math.random', () => {
    const spy = vi.spyOn(Math, 'random')
    try {
      syntheticName(new Rng(2))
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('staff additions', () => {
  it('keeps the ten existing staff with the same ids, names, wards and roles, each with a post', () => {
    for (const expected of EXISTING_STAFF) {
      expect(STAFF.find((s) => s.id === expected.id), expected.id).toEqual(expected)
    }
  })

  it('keeps staffName working for existing and new staff, and falls back to the id', () => {
    expect(staffName('nurse-A1')).toBe('Nurse Maya')
    expect(staffName('doc-ER1')).toBe('Dr. Halima')
    expect(staffName('unknown-id')).toBe('unknown-id')
  })

  it('has the ten existing entries plus the fourteen new ones', () => {
    expect(STAFF).toHaveLength(EXISTING_STAFF.length + NEW_STAFF.length)
  })

  it.each(NEW_STAFF)('%s exists with role %s and post %s', (id, role, post) => {
    const member = STAFF.find((s) => s.id === id)
    expect(member, id).toBeDefined()
    expect(member?.role, id).toBe(role)
    expect(member?.post, id).toBe(post)
  })

  it('gives none of the new staff a ward', () => {
    for (const [id] of NEW_STAFF) {
      expect(STAFF.find((s) => s.id === id)?.ward, id).toBeUndefined()
    }
  })
})

describe('schema rejects bad content', () => {
  it('rejects a graphic reason', () => {
    const erReasons = [...peopleJson.erReasons.slice(1), { text: 'Bleeding from a deep wound', acuity: 3 }]
    expect(PeopleSchema.safeParse({ ...peopleJson, erReasons }).success).toBe(false)
  })

  it('rejects an ER acuity above 5', () => {
    const erReasons = [...peopleJson.erReasons.slice(1), { text: 'Cough and fever for a week', acuity: 6 }]
    expect(PeopleSchema.safeParse({ ...peopleJson, erReasons }).success).toBe(false)
  })

  it('rejects an ambulance acuity above 3', () => {
    const ambulanceReasons = [...peopleJson.ambulanceReasons.slice(1), { text: 'Fall at home, hip pain', acuity: 4 }]
    expect(PeopleSchema.safeParse({ ...peopleJson, ambulanceReasons }).success).toBe(false)
  })

  it('rejects a reason of fewer than 3 words', () => {
    const erReasons = [...peopleJson.erReasons.slice(1), { text: 'Cough again', acuity: 4 }]
    expect(PeopleSchema.safeParse({ ...peopleJson, erReasons }).success).toBe(false)
  })

  it('rejects a duplicate first name', () => {
    const firstNames = [...peopleJson.firstNames.slice(1), peopleJson.firstNames[1]]
    expect(PeopleSchema.safeParse({ ...peopleJson, firstNames }).success).toBe(false)
  })

  it('rejects a list of the wrong length', () => {
    const lastNames = peopleJson.lastNames.slice(1)
    expect(PeopleSchema.safeParse({ ...peopleJson, lastNames }).success).toBe(false)
  })
})
