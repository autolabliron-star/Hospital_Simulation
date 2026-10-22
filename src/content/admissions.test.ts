import { describe, expect, it } from 'vitest'
import { ADMISSION_PROFILES, admissionProfilesFor, admitChanceFor } from './admissions'
import admissionsJson from './admissions.json'
import { MEDICINES } from './catalogue'
import { AMBULANCE_REASONS, ER_REASONS } from './roster'
import { AdmissionsSchema } from './schema'

const wordCount = (text: string) => text.trim().split(/\s+/).length

describe('admissions.json parses', () => {
  it('parses against AdmissionsSchema', () => {
    expect(AdmissionsSchema.safeParse(admissionsJson).success).toBe(true)
  })

  it('has about 24 synthetic profiles', () => {
    expect(ADMISSION_PROFILES.length).toBeGreaterThanOrEqual(20)
    expect(ADMISSION_PROFILES.length).toBeLessThanOrEqual(28)
  })

  it('gives every profile a unique id', () => {
    const ids = ADMISSION_PROFILES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('coverage', () => {
  it('every ER reason that can be admitted has at least one profile', () => {
    for (const r of ER_REASONS) expect(admissionProfilesFor(r.text).length, r.text).toBeGreaterThan(0)
  })

  it('every ambulance reason has at least one profile (ambulance patients are admitted by the same check)', () => {
    for (const r of AMBULANCE_REASONS) expect(admissionProfilesFor(r.text).length, r.text).toBeGreaterThan(0)
  })

  it('every profile reason is a reason in people.json', () => {
    const known = new Set([...ER_REASONS, ...AMBULANCE_REASONS].map((r) => r.text))
    for (const p of ADMISSION_PROFILES) for (const reason of p.reasons) expect(known.has(reason), `${p.id}: ${reason}`).toBe(true)
  })

  it('admissionProfilesFor throws on a reason with no profile', () => {
    expect(() => admissionProfilesFor('Not a reason in people.json')).toThrow(/No admission profile/)
  })
})

describe('profile contents', () => {
  it('every usualMeds id exists in the medicine catalogue', () => {
    const ids = new Set(MEDICINES.map((m) => m.id))
    for (const p of ADMISSION_PROFILES) for (const medId of p.usualMeds) expect(ids.has(medId), `${p.id} -> ${medId}`).toBe(true)
  })

  it('every profile has 2 to 4 distinct usual medicines', () => {
    for (const p of ADMISSION_PROFILES) {
      expect(p.usualMeds.length, p.id).toBeGreaterThanOrEqual(2)
      expect(p.usualMeds.length, p.id).toBeLessThanOrEqual(4)
      expect(new Set(p.usualMeds).size, p.id).toBe(p.usualMeds.length)
    }
  })

  it('every ward reason is plain: 3 to 8 words', () => {
    for (const p of ADMISSION_PROFILES) {
      expect(wordCount(p.wardReason), p.id).toBeGreaterThanOrEqual(3)
      expect(wordCount(p.wardReason), p.id).toBeLessThanOrEqual(8)
    }
  })

  it('keeps every age range ordered and inside the inpatient ages 24..89', () => {
    for (const p of ADMISSION_PROFILES) {
      const [low, high] = p.ageRange
      expect(low, p.id).toBeGreaterThanOrEqual(24)
      expect(high, p.id).toBeLessThanOrEqual(89)
      expect(low, p.id).toBeLessThanOrEqual(high)
    }
  })
})

describe('admissions that make sense (Wave 1)', () => {
  it('never admits for sunburn, a cold, a cut finger, a sprain or a prescription review', () => {
    for (const reason of [
      'Sunburn, feels sore and hot',
      'Mild cold symptoms for days',
      'Cut finger needing stitches',
      'Twisted ankle playing football',
      'Sprained wrist from a bike fall',
      'Prescription running out, needs review',
    ]) {
      expect(admitChanceFor(reason), reason).toBe(0)
    }
  })

  it('always admits a stroke, a fit, confusion, a collapse and chest pain (F-23)', () => {
    for (const reason of [
      'Sudden weakness down one side',
      'Fit that has now stopped',
      'Confused and very drowsy today',
      'Confused after a fall',
      'Collapsed, not fully conscious',
      'Collapsed at home, slow to respond',
      'Chest pain spreading to arm',
      'Chest pain at rest, sweating',
      'Severe difficulty breathing',
      'Breathless and struggling to speak',
      'Allergic reaction, face swollen',
    ]) {
      expect(admitChanceFor(reason), reason).toBe(1)
    }
  })

  it('almost never admits a neck bump, and never a rash or ear pain (F-23)', () => {
    expect(admitChanceFor('Minor car bump, neck sore')).toBeLessThanOrEqual(0.05)
    expect(admitChanceFor('Rash and itchy eyes')).toBe(0)
    expect(admitChanceFor('Ear pain for three days')).toBe(0)
    expect(admitChanceFor('Sore throat and swollen glands')).toBeLessThanOrEqual(0.05)
  })

  it('leaves the ordinary middle reasons to the acuity table', () => {
    expect(admitChanceFor('High fever since yesterday')).toBeNull()
    expect(admitChanceFor('Severe abdominal pain, vomiting')).toBeNull()
  })

  it('starts no anticoagulant for sudden weakness: a stroke workup ward reason instead', () => {
    const p = ADMISSION_PROFILES.find((x) => x.reasons.includes('Sudden weakness down one side'))!
    expect(p.usualMeds).not.toContain('apixaban')
    expect(p.wardReason).toMatch(/stroke/i)
  })

  it('gives apixaban to no profile that comes from a possible new stroke or a fall', () => {
    for (const p of ADMISSION_PROFILES) expect(p.usualMeds, p.id).not.toContain('apixaban')
  })
})

describe('schema rejects bad profiles', () => {
  const [first] = admissionsJson.profiles

  it('rejects a profile with a single usual medicine', () => {
    expect(AdmissionsSchema.safeParse({ profiles: [{ ...first, usualMeds: [first.usualMeds[0]] }] }).success).toBe(false)
  })

  it('rejects a graphic ward reason', () => {
    expect(AdmissionsSchema.safeParse({ profiles: [{ ...first, wardReason: 'Observation after a bleeding wound' }] }).success).toBe(false)
  })

  it('rejects a reversed age range', () => {
    expect(AdmissionsSchema.safeParse({ profiles: [{ ...first, ageRange: [80, 60] }] }).success).toBe(false)
  })

  it('rejects a profile that repeats a reason', () => {
    const repeated = { ...first, reasons: [first.reasons[0], first.reasons[0]] }
    expect(AdmissionsSchema.safeParse({ profiles: [repeated] }).success).toBe(false)
  })

  it('rejects two profiles with the same id', () => {
    expect(AdmissionsSchema.safeParse({ profiles: [first, first] }).success).toBe(false)
  })
})
