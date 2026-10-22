import { describe, expect, it } from 'vitest'
import { ADMISSION_PROFILES } from './admissions'
import { PATIENTS } from './catalogue'
import { PATIENT_HISTORY, PatientHistorySchema, recordText, stayTemplateFor, uiText } from './patientHistory'
import historyJson from './patientHistory.json'
import { PHARMACIST_QUERIES } from './pharmacistQueries'

const clone = () => JSON.parse(JSON.stringify(historyJson)) as Record<string, unknown> & typeof historyJson

describe('patientHistory.json', () => {
  it('parses, and the loaded content is the file', () => {
    expect(PatientHistorySchema.parse(historyJson)).toEqual(PATIENT_HISTORY)
  })

  it('rejects an unknown key, a condition that does not exist and a fallback that is not last', () => {
    const extra = clone()
    extra.surprise = 1
    expect(PatientHistorySchema.safeParse(extra).success).toBe(false)
    const badCondition = clone()
    badCondition.stays[0].conditions = ['nope']
    expect(PatientHistorySchema.safeParse(badCondition).success).toBe(false)
    const fallbackFirst = clone()
    fallbackFirst.stays = [...fallbackFirst.stays].reverse()
    expect(PatientHistorySchema.safeParse(fallbackFirst).success).toBe(false)
  })

  it('gives every catalogue inpatient a stay template of their own (never the fallback)', () => {
    for (const p of PATIENTS) {
      const s = stayTemplateFor(p.reason, p.age)
      expect(s.id, `${p.id}: ${p.reason}`).not.toBe('general')
    }
  })

  it('gives every admission profile a template (the minor reasons may use the fallback)', () => {
    const specific = ADMISSION_PROFILES.filter((p) => p.admitChance === 1)
    for (const p of specific) expect(stayTemplateFor(p.wardReason, 70).id, p.wardReason).not.toBe('general')
    for (const p of ADMISSION_PROFILES) expect(stayTemplateFor(p.wardReason, 50)).toBeDefined()
  })

  it('picks the knee operation by age: a ligament repair for a young patient, a replacement for an older one', () => {
    expect(stayTemplateFor('Recovering after knee surgery', 39).id).toBe('knee-ligament')
    expect(stayTemplateFor('Recovering after knee surgery', 71).id).toBe('knee-replacement')
  })

  it('every allergen with a class maps to catalogue medicines of the pharmacist\'s classes (amoxicillin is a penicillin)', () => {
    const penicillin = PHARMACIST_QUERIES.allergy.classes.find((c) => c.id === 'penicillin')!
    expect(penicillin.meds).toContain('amoxicillin')
    for (const a of PATIENT_HISTORY.allergens) {
      if (a.classId === null) continue
      expect(PHARMACIST_QUERIES.allergy.classes.some((c) => c.id === a.classId)).toBe(true)
    }
  })

  it('the record sentences fill completely', () => {
    const values = { procedure: 'x', protocol: 'x', n: 3, label: 'Urgent', diagnosis: 'x', name: 'x', summary: 'x', team: 'x', ward: 'A', room: 'A1', meds: 'x', note: 'x', doctor: 'Dr. X', plan: 'x', time: '08:00' }
    for (const key of Object.keys(PATIENT_HISTORY.text)) expect(recordText(key, values), key).not.toMatch(/[{}]/)
    expect(() => recordText('nope')).toThrow()
    expect(uiText('news2', { score: 2 })).toBe('NEWS2 2')
  })
})
