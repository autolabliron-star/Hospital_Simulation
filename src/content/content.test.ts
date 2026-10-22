import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { ROOM_IDS } from '@/sim/places'
import { MEDICINES, PATIENTS, doseHoursOf, isPrn, medicineById, minDoseGapSeconds, patientInRoom } from './catalogue'
import medicinesJson from './medicines.json'
import patientsJson from './patients.json'
import { MedicinesSchema, PatientsSchema } from './schema'

const wordCount = (text: string) => text.trim().split(/\s+/).length

describe('content files parse', () => {
  it('medicines.json parses against MedicinesSchema', () => {
    expect(MedicinesSchema.safeParse(medicinesJson).success).toBe(true)
  })

  it('patients.json parses against PatientsSchema', () => {
    expect(PatientsSchema.safeParse(patientsJson).success).toBe(true)
  })
})

describe('catalogue size and coverage', () => {
  it('has 18 medicines and 16 patients', () => {
    expect(MEDICINES).toHaveLength(18)
    expect(PATIENTS).toHaveLength(16)
  })

  it('covers every room exactly once', () => {
    const roomIds = PATIENTS.map((p) => p.roomId).sort()
    expect(roomIds).toEqual([...ROOM_IDS].sort())
    expect(new Set(roomIds).size).toBe(roomIds.length)
  })

  it('gives each patient a unique id that matches its room', () => {
    const ids = PATIENTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PATIENTS) expect(p.id).toBe(`pt-${p.roomId}`)
  })

  it('keeps ages in 24..89 and reasons to 4..8 words', () => {
    for (const p of PATIENTS) {
      expect(p.age).toBeGreaterThanOrEqual(24)
      expect(p.age).toBeLessThanOrEqual(89)
      expect(wordCount(p.reason), p.id).toBeGreaterThanOrEqual(4)
      expect(wordCount(p.reason), p.id).toBeLessThanOrEqual(8)
    }
  })
})

describe('usualMeds', () => {
  it('every usualMeds id exists in the catalogue', () => {
    const catalogueIds = new Set(MEDICINES.map((m) => m.id))
    for (const p of PATIENTS) {
      for (const medId of p.usualMeds) expect(catalogueIds.has(medId), `${p.id} -> ${medId}`).toBe(true)
    }
  })

  it('each patient has 2 to 4 distinct usual medicines', () => {
    for (const p of PATIENTS) {
      expect(p.usualMeds.length, p.id).toBeGreaterThanOrEqual(2)
      expect(p.usualMeds.length, p.id).toBeLessThanOrEqual(4)
      expect(new Set(p.usualMeds).size, p.id).toBe(p.usualMeds.length)
    }
  })

  it('every catalogue medicine is used at least once', () => {
    const used = new Set(PATIENTS.flatMap((p) => p.usualMeds))
    const unused = MEDICINES.map((m) => m.id).filter((id) => !used.has(id))
    expect(unused).toEqual([])
  })
})

describe('display data', () => {
  it('colours are unique #rrggbb values', () => {
    const colours = MEDICINES.map((m) => m.color)
    for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    expect(new Set(colours.map((c) => c.toLowerCase())).size).toBe(colours.length)
  })

  it('bins are unique and inside 0..71', () => {
    const bins = MEDICINES.map((m) => m.bin)
    expect(new Set(bins).size).toBe(bins.length)
    for (const b of bins) {
      expect(Number.isInteger(b)).toBe(true)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(71)
    }
  })

  it('spreads bins over the wall: no grid row holds more than 4 packs', () => {
    const perRow = new Map<number, number>()
    for (const m of MEDICINES) {
      const row = Math.floor(m.bin / 12)
      perRow.set(row, (perRow.get(row) ?? 0) + 1)
    }
    for (const count of perRow.values()) expect(count).toBeLessThanOrEqual(4)
  })
})

describe('lookups', () => {
  it('medicineById returns the entry and throws on an unknown id', () => {
    expect(medicineById('paracetamol').name).toBe('Paracetamol')
    expect(() => medicineById('not-a-medicine')).toThrow(/Unknown medicine id/)
  })

  it('patientInRoom returns the room occupant and throws on an unknown room', () => {
    expect(patientInRoom('A1').id).toBe('pt-A1')
    expect(patientInRoom('B8').roomId).toBe('B8')
    expect(() => patientInRoom('Z9')).toThrow(/No patient in room Z9/)
  })
})

describe('schemas reject bad content', () => {
  const [first, second] = medicinesJson

  it('rejects duplicate medicine ids', () => {
    const bad = [first, { ...second, id: first.id }]
    expect(MedicinesSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects duplicate bins', () => {
    const bad = [first, { ...second, bin: first.bin }]
    expect(MedicinesSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects bins outside 0..71', () => {
    expect(MedicinesSchema.safeParse([{ ...first, bin: 72 }]).success).toBe(false)
    expect(MedicinesSchema.safeParse([{ ...first, bin: -1 }]).success).toBe(false)
  })

  it('rejects an unknown form', () => {
    expect(MedicinesSchema.safeParse([{ ...first, form: 'syrup' }]).success).toBe(false)
  })

  it('rejects two patients in the same room', () => {
    const [p1, p2] = patientsJson
    expect(PatientsSchema.safeParse([p1, { ...p2, roomId: p1.roomId }]).success).toBe(false)
  })
})

describe('dose times (Wave 1)', () => {
  it('every medicine has dose hours that are dose-wave hours, or is as-needed with a gap', () => {
    for (const m of MEDICINES) {
      if (isPrn(m.id)) {
        expect(doseHoursOf(m.id), m.id).toEqual([])
        expect(minDoseGapSeconds(m.id), m.id).toBeGreaterThanOrEqual(3600)
      } else {
        expect(doseHoursOf(m.id).length, m.id).toBeGreaterThan(0)
        for (const h of doseHoursOf(m.id)) expect(CONFIG.doseWaves.hours, `${m.id} ${h}`).toContain(h)
      }
    }
  })

  it('has the usual hospital dose times', () => {
    const expected: Record<string, number[]> = {
      paracetamol: [8, 12, 18, 22],
      ibuprofen: [8, 14, 22],
      omeprazole: [8],
      amoxicillin: [8, 14, 22],
      metformin: [8, 18],
      atorvastatin: [22],
      amlodipine: [8],
      bisoprolol: [8],
      furosemide: [8],
      levothyroxine: [6],
      apixaban: [8, 20],
      senna: [22],
      macrogol: [8],
      lactulose: [8, 18],
      colecalciferol: [8],
      cetirizine: [8],
    }
    for (const [id, hours] of Object.entries(expected)) expect(doseHoursOf(id), id).toEqual(hours)
    expect(isPrn('ondansetron')).toBe(true)
    expect(isPrn('salbutamol')).toBe(true)
  })

  it('a twice-daily anticoagulant is 12 hours apart, a three-times-daily antibiotic or anti-inflammatory is 6 to 10 hours apart, levothyroxine is before breakfast (F-28)', () => {
    expect(doseHoursOf('apixaban')).toEqual([8, 20])
    for (const id of ['amoxicillin', 'ibuprofen']) {
      const h = doseHoursOf(id)
      expect(h, id).toHaveLength(3)
      for (let i = 1; i < h.length; i++) expect(h[i] - h[i - 1], id).toBeGreaterThanOrEqual(6)
      expect(h[0] + 24 - h[h.length - 1], id).toBeGreaterThanOrEqual(6)
    }
    expect(doseHoursOf('levothyroxine')).toEqual([6])
    expect(CONFIG.doseWaves.hours).toEqual(expect.arrayContaining([6, 20]))
  })

  it('the interval of a medicine is its closest two dose hours (a once-daily one: 24 h)', () => {
    expect(minDoseGapSeconds('paracetamol')).toBe(4 * 3600)
    expect(minDoseGapSeconds('amoxicillin')).toBe(6 * 3600)
    expect(minDoseGapSeconds('atorvastatin')).toBe(24 * 3600)
  })

  it('the schema rejects a dose hour that has no wave', () => {
    const bad = (MEDICINES as unknown as Record<string, unknown>[]).map((m) => ({ ...m }))
    bad[0].dose = { hours: [9] }
    expect(MedicinesSchema.safeParse(bad).success).toBe(false)
  })
})
