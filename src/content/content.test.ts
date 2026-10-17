import { describe, expect, it } from 'vitest'
import { ROOM_IDS } from '@/sim/places'
import { MEDICINES, PATIENTS, medicineById, patientInRoom } from './catalogue'
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
