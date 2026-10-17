import { describe, expect, it } from 'vitest'
import { PATIENTS } from './catalogue'
import { OUTPATIENTS } from './imaging'
import { FIRST_NAMES, LAST_NAMES, normaliseName } from './roster'
import { HOSTS, NIGHT_STAFF, STAFF } from './staff'

/** Every word of a name, accent-free and lower-case. Titles ("Dr.", "Nurse") count as words too. */
const words = (name: string): string[] =>
  name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map(normaliseName)

/** The given name of a staff member: the last word ("Nurse Tomás" gives "tomas", "Dr. Levi" gives "levi"). */
const givenName = (name: string): string => words(name).at(-1) ?? ''

const staff = [...STAFF, ...NIGHT_STAFF, ...HOSTS]
const patientNames = PATIENTS.map((p) => p.name)
const outpatientNames = OUTPATIENTS.map((o) => o.name)
const peopleNames = new Set([...FIRST_NAMES, ...LAST_NAMES].map(normaliseName))

describe('names are unique across all content', () => {
  it('no staff id is repeated', () => {
    const ids = staff.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no two staff members share a given name', () => {
    const given = staff.map((s) => givenName(s.name))
    expect(new Set(given).size).toBe(given.length)
  })

  it('no patient or outpatient repeats a full name, and no staff name repeats', () => {
    const people = [...patientNames, ...outpatientNames].map((n) => words(n).join(' '))
    expect(new Set(people).size).toBe(people.length)
    const staffNames = staff.map((s) => words(s.name).join(' '))
    expect(new Set(staffNames).size).toBe(staffNames.length)
  })

  it('no staff given name is a word of a patient or outpatient name', () => {
    const taken = new Set([...patientNames, ...outpatientNames].flatMap(words))
    const clashes = staff.map((s) => givenName(s.name)).filter((n) => taken.has(n))
    expect(clashes).toEqual([])
  })

  it('no staff given name is a first or last name from the visitor and ER name pools', () => {
    const clashes = staff.map((s) => givenName(s.name)).filter((n) => peopleNames.has(n))
    expect(clashes).toEqual([])
  })

  it('no patient or outpatient name word is in the visitor and ER name pools', () => {
    const clashes = [...patientNames, ...outpatientNames].flatMap(words).filter((n) => peopleNames.has(n))
    expect(clashes).toEqual([])
  })

  it('no outpatient shares a name with a patient', () => {
    const patientWords = new Set(patientNames.flatMap(words))
    const clashes = outpatientNames.flatMap(words).filter((n) => patientWords.has(n))
    expect(clashes).toEqual([])
  })
})
