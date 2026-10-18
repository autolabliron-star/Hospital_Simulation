// W3 wave B follow-up: how a person's given name reads (people.json `presentation`) decides whether the realistic and the procedural bodies draw them as a woman
// or a man. These tests check the lists against every name the content uses, and the pure helpers that turn an entity's name into a presentation.
import { describe, expect, it } from 'vitest'
import { PATIENTS } from './catalogue'
import { OUTPATIENTS } from './imaging'
import admissionsJson from './admissions.json'
import patientsJson from './patients.json'
import outpatientsJson from './outpatients.json'
import peopleJson from './people.json'
import { FIRST_NAMES, PRESENTATION_NAMES, PeopleSchema, TITLE_WORDS, givenNameOf, normaliseName, presentationOf, syntheticName } from './roster'
import { PresentationSchema } from './schema'
import { HOSTS, NIGHT_STAFF, STAFF } from './staff'
import { Rng } from '@/sim/rng'

const staff = [...STAFF, ...NIGHT_STAFF, ...HOSTS]

/** Every given name the content and the simulation can put on a person, with where it comes from. */
function nameSources(): Array<[given: string, source: string]> {
  const out: Array<[string, string]> = []
  for (const n of FIRST_NAMES) out.push([n, 'people.json firstNames (visitors, ER and ambulance arrivals, new ward patients)'])
  for (const p of patientsJson) out.push([givenNameOf(p.name), `patients.json ${p.name}`])
  for (const o of outpatientsJson) out.push([givenNameOf(o.name), `outpatients.json ${o.name}`])
  for (const s of staff) out.push([givenNameOf(s.name), `staff.ts ${s.name}`])
  // the generated names are "First Last" from the lists above: the first word is always a given name from firstNames
  const rng = new Rng(7)
  for (let i = 0; i < 400; i++) out.push([givenNameOf(syntheticName(rng)), 'syntheticName'])
  return out
}

describe('people.json presentation', () => {
  it('parses against the schema, inside PeopleSchema', () => {
    expect(PresentationSchema.safeParse(peopleJson.presentation).success).toBe(true)
    expect(PeopleSchema.safeParse(peopleJson).success).toBe(true)
  })

  it('has a woman list, a man list and an either list, each with names in it', () => {
    expect(PRESENTATION_NAMES.female.length).toBeGreaterThan(60)
    expect(PRESENTATION_NAMES.male.length).toBeGreaterThan(60)
    expect(PRESENTATION_NAMES.either.length).toBeGreaterThanOrEqual(14)
  })

  it('puts no name in two lists, and none twice in one (accents and case do not make a different name)', () => {
    const all = [...PRESENTATION_NAMES.female, ...PRESENTATION_NAMES.male, ...PRESENTATION_NAMES.either].map(normaliseName)
    expect(new Set(all).size).toBe(all.length)
  })

  it('rejects a name in two lists, a name twice in one list, a missing list and an unknown list', () => {
    const base = { female: ['Grace'], male: ['Callum'], either: ['Noa'] }
    expect(PresentationSchema.safeParse(base).success).toBe(true)
    expect(PresentationSchema.safeParse({ ...base, male: ['Callum', 'Grace'] }).success).toBe(false)
    expect(PresentationSchema.safeParse({ ...base, male: ['Callum', 'Tomás', 'Tomas'] }).success).toBe(false)
    expect(PresentationSchema.safeParse({ female: ['Grace'], male: ['Callum'] }).success).toBe(false)
    expect(PresentationSchema.safeParse({ ...base, other: ['Sam'] }).success).toBe(false)
    expect(PresentationSchema.safeParse({ ...base, female: ['grace'] }).success).toBe(false)
  })

  it('lists every given name the content uses in exactly one list', () => {
    const count = (name: string): number => (['female', 'male', 'either'] as const).filter((k) => PRESENTATION_NAMES[k].some((n) => normaliseName(n) === normaliseName(name))).length
    const unlisted = nameSources().filter(([given]) => count(given) !== 1)
    expect(unlisted).toEqual([])
  })

  it('knows every given name of the 16 ward patients, the outpatients and the staff as a woman or a man, except the surnames and unisex names kept as either', () => {
    for (const p of PATIENTS) expect(presentationOf(p.name), p.name).not.toBe('either')
    for (const o of OUTPATIENTS) {
      const given = givenNameOf(o.name)
      // the only unisex outpatient names are the ones listed as either
      const listedEither = PRESENTATION_NAMES.either.some((n) => normaliseName(n) === normaliseName(given))
      expect(presentationOf(o.name) === 'either', o.name).toBe(listedEither)
    }
    expect(staff.filter((s) => presentationOf(s.name) === 'either').map((s) => s.name).sort()).toEqual(
      ['Cleaner Wren', 'Coordinator Dana', 'Dr. Okafor', 'Dr. Oriel', 'Nurse Femi', 'Pharmacist Noa'].sort(),
    )
  })

  it('has no new names in the admission profiles (they carry reasons and ages, never a name)', () => {
    expect(JSON.stringify(admissionsJson)).not.toMatch(/"name"/)
  })
})

describe('the given name of somebody', () => {
  it('drops a leading title and takes the first word', () => {
    expect(givenNameOf('Grace Adeyemi')).toBe('Grace')
    expect(givenNameOf('Nurse Maya')).toBe('Maya')
    expect(givenNameOf('Dr. Halima')).toBe('Halima')
    expect(givenNameOf('Dr. Okafor')).toBe('Okafor')
    expect(givenNameOf('Porter Callum')).toBe('Callum')
    expect(givenNameOf('Receptionist Yara')).toBe('Yara')
    expect(givenNameOf('Pharmacist Noa')).toBe('Noa')
    expect(givenNameOf('Radiographer Tariq')).toBe('Tariq')
    expect(givenNameOf('Sonographer Elin')).toBe('Elin')
    expect(givenNameOf('Host Ilona')).toBe('Ilona')
    expect(givenNameOf('Paramedic Hugo')).toBe('Hugo')
    expect(givenNameOf('Cleaner Rosa')).toBe('Rosa')
    expect(givenNameOf('Coordinator Eli')).toBe('Eli')
    expect(givenNameOf('Nurse Tomás')).toBe('Tomás')
    expect(givenNameOf('Quinn')).toBe('Quinn')
    expect(givenNameOf('  Grace   Adeyemi ')).toBe('Grace')
    expect(givenNameOf('')).toBe('')
  })

  it('knows every title of the staff content, and only those (derived from staff.ts)', () => {
    for (const s of staff) expect(TITLE_WORDS.has(normaliseName(s.name.split(' ')[0]).replace(/\.$/, '')), s.name).toBe(true)
    expect([...TITLE_WORDS].sort()).toEqual(['cleaner', 'coordinator', 'dr', 'host', 'nurse', 'paramedic', 'pharmacist', 'porter', 'radiographer', 'receptionist', 'sonographer'])
    // a title is only dropped when something follows it
    expect(givenNameOf('Nurse')).toBe('Nurse')
  })

  it('reads a name as a woman, a man or either; an unlisted name and the player are either', () => {
    expect(presentationOf('Grace Adeyemi')).toBe('female')
    expect(presentationOf('Nurse Maya')).toBe('female')
    expect(presentationOf('Receptionist Yara')).toBe('female')
    expect(presentationOf('Dr. Halima')).toBe('female')
    expect(presentationOf('Porter Callum')).toBe('male')
    expect(presentationOf('Bruno Varga')).toBe('male')
    expect(presentationOf('Nurse Tomás')).toBe('male')
    expect(presentationOf('Nurse Tomas')).toBe('male')
    expect(presentationOf('Pharmacist Noa')).toBe('either')
    expect(presentationOf('Dr. Okafor')).toBe('either')
    expect(presentationOf('Coordinator Dana')).toBe('either')
    expect(presentationOf('Zzyzx Smith')).toBe('either')
    expect(presentationOf('You')).toBe('either')
    expect(presentationOf('')).toBe('either')
  })
})
