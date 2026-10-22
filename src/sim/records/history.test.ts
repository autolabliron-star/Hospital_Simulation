/**
 * The patient's past (history.ts): deterministic, coherent with the ward chart and the stay, sex and age appropriate, and never Math.random.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADMISSION_PROFILES } from '@/content/admissions'
import { PATIENTS } from '@/content/catalogue'
import { demoDate, PATIENT_HISTORY } from '@/content/patientHistory'
import { allergyClass } from '@/content/pharmacistQueries'
import { syntheticName } from '@/content/roster'
import { Rng } from '../rng'
import { allergiesOf, blockedMeds, mrnOf, patientHistory, type RecordSubject } from './history'

const YEAR = demoDate()[0]

/** Many synthetic patients: every catalogue inpatient and a crowd of admissions drawn from the admission profiles. */
function crowd(n = 1500): RecordSubject[] {
  const rng = new Rng(77)
  const out: RecordSubject[] = PATIENTS.map((p) => ({ id: p.id, name: p.name, age: p.age, reason: p.reason, usualMeds: p.usualMeds }))
  for (let i = 0; i < n; i++) {
    const prof = rng.pick(ADMISSION_PROFILES)
    out.push({ id: `er-${i}`, name: syntheticName(rng), age: rng.int(prof.ageRange[0], prof.ageRange[1]), reason: prof.wardReason, usualMeds: prof.usualMeds })
  }
  return out
}

const PEOPLE = crowd()

describe('the patient history', () => {
  it('is deterministic: the same patient always gets the same past', () => {
    for (const s of PEOPLE.slice(0, 200)) expect(JSON.stringify(patientHistory({ ...s }))).toBe(JSON.stringify(patientHistory(s)))
  })

  it('differs between two people who share an id (another seed, another name)', () => {
    const a = patientHistory({ id: 'er-3', name: 'Ada Lind', age: 60, reason: 'Observation after a fall', usualMeds: [] })
    const b = patientHistory({ id: 'er-3', name: 'Bo Kerr', age: 60, reason: 'Observation after a fall', usualMeds: [] })
    expect(a.mrn).not.toBe(b.mrn)
  })

  it('has an obviously synthetic record number', () => {
    expect(mrnOf({ id: 'pt-A1', name: 'Grace Adeyemi' })).toMatch(/^SYN-\d{3}-\d{4}$/)
  })

  it('gives about one patient in five an allergy, never to a medicine on their ward chart', () => {
    let withAllergy = 0
    for (const s of PEOPLE) {
      const h = patientHistory(s)
      if (h.allergies.some((a) => a.id !== 'stay-trigger')) withAllergy++
      const blocked = blockedMeds(h.allergies)
      for (const m of s.usualMeds) expect(blocked.has(m), `${s.id} is charted ${m} but allergic to it`).toBe(false)
      for (const m of h.homeMeds) expect(blocked.has(m.medId), `${s.id} takes ${m.medId} at home but is allergic to it`).toBe(false)
      for (const a of h.allergies) {
        expect(['mild', 'moderate', 'severe']).toContain(a.severity)
        if (a.classId !== null) expect(allergyClass(a.classId)).toBeDefined()
      }
    }
    const share = withAllergy / PEOPLE.length
    expect(share).toBeGreaterThan(0.15)
    expect(share).toBeLessThan(0.3)
  })

  it('keeps the pinned demo allergies (A2: penicillin, rash)', () => {
    const a2 = PATIENTS.find((p) => p.id === 'pt-A2')!
    const h = patientHistory(a2)
    expect(h.allergies).toHaveLength(1)
    expect(h.allergies[0]).toMatchObject({ id: 'penicillin', classId: 'penicillin', reaction: 'Rash', severity: 'mild' })
    for (const id of Object.keys(PATIENT_HISTORY.pinnedAllergies)) expect(PATIENTS.some((p) => p.id === id)).toBe(true)
  })

  it('records the suspected trigger of an allergic-reaction admission, for clinician review', () => {
    const h = patientHistory({ id: 'er-x', name: 'Ines Moro', age: 40, reason: 'Allergic reaction, observed after treatment', usualMeds: ['cetirizine', 'paracetamol'] })
    expect(h.allergies.some((a) => a.id === 'stay-trigger' && a.review)).toBe(true)
  })

  it('draws sex- and age-appropriate procedures, in the past, never the operation of this stay', () => {
    for (const s of PEOPLE) {
      const h = patientHistory(s)
      const seen = new Set<string>()
      for (const p of h.procedures) {
        const c = PATIENT_HISTORY.procedures.find((x) => x.id === p.id)!
        expect(seen.has(p.id)).toBe(false)
        seen.add(p.id)
        if (c.sex) expect(h.sex, `${s.id}: ${p.name}`).toBe(c.sex)
        const ageThen = s.age - (YEAR - p.year)
        expect(ageThen).toBeGreaterThanOrEqual(c.ageAt[0])
        expect(ageThen).toBeLessThanOrEqual(Math.min(c.ageAt[1], s.age - 1))
        expect(p.year).toBeLessThan(YEAR)
        expect(h.stay.excludesPast ?? []).not.toContain(p.id)
        for (const req of c.requires ?? []) expect(h.conditions.some((x) => x.id === req)).toBe(true)
      }
      if (h.sex === 'male') expect(h.procedures.some((p) => p.id === 'caesarean' || p.id === 'hysterectomy')).toBe(false)
      if (h.sex === 'female') expect(h.procedures.some((p) => p.id === 'turp')).toBe(false)
    }
  })

  it('is coherent with the chart and the stay: chronic medicines bring their condition, COPD has a smoking history, no random asthma on a beta-blocker', () => {
    for (const s of PEOPLE) {
      const h = patientHistory(s)
      const ids = new Set(h.conditions.map((c) => c.id))
      if (s.usualMeds.includes('apixaban')) expect(ids.has('af')).toBe(true)
      if (s.usualMeds.includes('levothyroxine')) expect(ids.has('hypothyroid')).toBe(true)
      if (s.usualMeds.includes('metformin')) expect(ids.has('t2dm')).toBe(true)
      for (const c of h.stay.conditions ?? []) expect(ids.has(c), `${s.id} ${h.stay.id} lacks ${c}`).toBe(true)
      if (ids.has('copd')) expect(h.social.smoking).not.toMatch(/^Never/)
      if (s.usualMeds.includes('bisoprolol') && !(h.stay.conditions ?? []).includes('asthma')) expect(ids.has('asthma')).toBe(false)
      for (const c of h.conditions) expect(c.since).toBeLessThan(YEAR)
      for (const m of s.usualMeds) if (h.homeMeds.some((x) => x.medId === m)) expect(h.homeMeds.find((x) => x.medId === m)!.onChart).toBe(true)
    }
  })

  it('the allergy draw matches what the pharmacist sees (allergiesOf is the same list)', () => {
    for (const s of PEOPLE.slice(0, 300)) expect(allergiesOf(s)).toEqual(patientHistory(s).allergies)
  })

  it('never uses Math.random in src/sim/records', () => {
    const dir = __dirname
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/Math\.random\s*\(/)
    }
  })
})
