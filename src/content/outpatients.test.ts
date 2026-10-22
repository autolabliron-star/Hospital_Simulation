/**
 * The imaging outpatients of the day (content/outpatients.json via content/imaging.ts). Split out of imaging.test.ts so the outpatient
 * schedule has its own file.
 */
import { describe, expect, it } from 'vitest'
import { STAFF } from '@/content/staff'
import { CONFIG } from '@/sim/config'
import { OUTPATIENTS, OutpatientSchema, PROTOCOLS, outpatientTimeSeconds, protocolById } from './imaging'
import patientsJson from './patients.json'
import { FIRST_NAMES, LAST_NAMES, normaliseName } from './roster'

/** Every word of a name, lower-cased and accent-free, so "Tomás" matches "Tomas". */
const tokens = (name: string): string[] =>
  name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map(normaliseName)

/** Minutes after midnight for an HH:MM string. */
const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Modality spacing in minutes, from the brief. */
const SPACING_MINUTES: Record<string, number> = { mri: 20, ct: 10, xray: 8, us: 15 }

const modalityOf = (o: { protocol: string }): string => protocolById(o.protocol).modality

describe('outpatients', () => {
  it('has 64 synthetic outpatients (40 in the morning, 24 in the afternoon), each parsing against OutpatientSchema', () => {
    expect(OUTPATIENTS).toHaveLength(64)
    for (const o of OUTPATIENTS) expect(OutpatientSchema.safeParse(o).success, o.id).toBe(true)
  })

  it('has the modality mix of the day: 19 MRI, 16 CT, 13 X-ray, 16 ultrasound (the morning was 12, 10, 8, 10)', () => {
    const counts = new Map<string, number>()
    for (const o of OUTPATIENTS) counts.set(modalityOf(o), (counts.get(modalityOf(o)) ?? 0) + 1)
    expect(counts.get('mri')).toBe(19)
    expect(counts.get('ct')).toBe(16)
    expect(counts.get('xray')).toBe(13)
    expect(counts.get('us')).toBe(16)
  })

  it('has unique ids, numbered in time order', () => {
    expect(new Set(OUTPATIENTS.map((o) => o.id)).size).toBe(OUTPATIENTS.length)
    OUTPATIENTS.forEach((o, i) => expect(o.id).toBe(`op-${String(i + 1).padStart(2, '0')}`))
  })

  it('has times inside 07:45 to the end of the outpatient day (CONFIG.day.outpatientHours, 17:00) and sorted by time', () => {
    const [, endHour] = CONFIG.day.outpatientHours
    for (const o of OUTPATIENTS) {
      expect(minutesOf(o.time), o.id).toBeGreaterThanOrEqual(minutesOf('07:45'))
      expect(minutesOf(o.time), o.id).toBeLessThanOrEqual(endHour * 60)
    }
    const times = OUTPATIENTS.map((o) => o.time)
    expect(times).toEqual([...times].sort())
  })

  it('runs through the afternoon: every modality has appointments after 13:30, and the last booking is late enough to finish by 17:00', () => {
    const afternoon = OUTPATIENTS.filter((o) => minutesOf(o.time) >= minutesOf('13:30'))
    expect(afternoon).toHaveLength(24)
    for (const modality of Object.keys(SPACING_MINUTES)) {
      const mine = afternoon.filter((o) => modalityOf(o) === modality)
      expect(mine.length, modality).toBeGreaterThanOrEqual(5)
      // each scanner has something booked in each part of the afternoon (13:30-15:00, 15:00-17:00): not idle
      expect(mine.some((o) => minutesOf(o.time) < minutesOf('15:00')), `${modality} early afternoon`).toBe(true)
      expect(mine.some((o) => minutesOf(o.time) >= minutesOf('16:00')), `${modality} late afternoon`).toBe(true)
    }
    // (an exam takes 5 to 30 minutes: nobody is booked so late that the scanner runs on past the end of the day)
    expect(Math.max(...OUTPATIENTS.map((o) => minutesOf(o.time)))).toBeLessThanOrEqual(minutesOf('16:50'))
  })

  it('books at least one patient of 80 or older among the afternoon list (the slower walkers show)', () => {
    expect(OUTPATIENTS.filter((o) => minutesOf(o.time) >= minutesOf('13:30') && o.age >= 80).length).toBeGreaterThanOrEqual(3)
  })

  it('keeps each modality spaced: MRI 20 min, CT 10, X-ray 8, ultrasound 15', () => {
    for (const modality of Object.keys(SPACING_MINUTES)) {
      const times = OUTPATIENTS.filter((o) => modalityOf(o) === modality).map((o) => minutesOf(o.time))
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1], `${modality} gap before ${times[i]}`).toBeGreaterThanOrEqual(SPACING_MINUTES[modality])
      }
    }
  })

  it('gives each outpatient a protocol that exists', () => {
    for (const o of OUTPATIENTS) expect(PROTOCOLS[o.protocol], o.id).toBeDefined()
  })

  it('computes sim seconds since 07:30', () => {
    const at = (time: string) => outpatientTimeSeconds({ ...OUTPATIENTS[0], time })
    expect(at('07:30')).toBe(0)
    expect(at('07:45')).toBe(900)
    expect(at('13:30')).toBe(6 * 3600)
  })

  it('uses full fictional names that reuse no patient, roster or staff name', () => {
    const taken = new Set<string>([
      ...patientsJson.flatMap((p) => tokens(p.name)),
      ...STAFF.flatMap((s) => tokens(s.name)),
      ...FIRST_NAMES.map(normaliseName),
      ...LAST_NAMES.map(normaliseName),
    ])
    const seen = new Set<string>()
    for (const o of OUTPATIENTS) {
      expect(o.name.trim().split(/\s+/).length, o.id).toBeGreaterThanOrEqual(2)
      const clashes = tokens(o.name).filter((t) => taken.has(t))
      expect(clashes, `${o.id} ${o.name}`).toEqual([])
      expect(seen.has(o.name), o.name).toBe(false)
      seen.add(o.name)
    }
  })
})

describe('outpatient exams fit the reason (F-31)', () => {
  const byId = (id: string) => OUTPATIENTS.find((o) => o.id === id)!

  it('a kidney stone gets the non-contrast CT KUB, and a lung nodule follow-up gets a non-contrast chest CT', () => {
    expect(byId('op-50').protocol).toBe('ct-kub')
    expect(byId('op-12').protocol).toBe('ct-chest')
    for (const id of ['ct-kub', 'ct-chest']) {
      for (const s of protocolById(id).sequences) expect(['arterial', 'portal'], `${id} ${s.name}`).not.toContain(s.contrast)
    }
  })

  it('no reason asks for a pancreas view the ultrasound protocol does not have, and no reason says "tummy" (UK clinical wording)', () => {
    for (const o of OUTPATIENTS) {
      expect(o.reason, o.id).not.toMatch(/tummy/i)
      if (/pancrea/i.test(o.reason)) expect(protocolById(o.protocol).sequences.map((s) => s.name.toLowerCase()), o.id).toContain('pancreas')
    }
  })
})
