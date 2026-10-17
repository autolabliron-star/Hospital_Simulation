import { describe, expect, it } from 'vitest'
import { ADMISSION_PROFILES } from '@/content/admissions'
import { PATIENTS } from '@/content/catalogue'
import { CONFIG } from '../config'
import { bedBook, dischargePlans, SIGN_LEAD_SECONDS, timeOfHour, admissionRecord } from './bedBook'
import { Rng } from '../rng'

describe('the bed book: today\'s discharges', () => {
  it('has one plan per patient going home, signed before the planned departure, earliest first', () => {
    const plans = dischargePlans()
    expect(plans.map((p) => p.roomId).sort()).toEqual(PATIENTS.filter((p) => p.stay.kind === 'goingHome').map((p) => p.roomId).sort())
    for (const p of plans) {
      expect(p.leaveAt).toBe(timeOfHour(p.leaveHour))
      expect(p.signAt).toBe(p.leaveAt - SIGN_LEAD_SECONDS)
    }
    for (let i = 1; i < plans.length; i++) expect(plans[i].signAt).toBeGreaterThanOrEqual(plans[i - 1].signAt)
    // the doctor signs inside the discharge window, and at least two leave before 11:00 (discharge before noon)
    expect(plans.filter((p) => p.leaveHour < 11).length).toBeGreaterThanOrEqual(CONFIG.beds.beforeNoon)
  })

  it('at the default start every room is simply occupied', () => {
    const day = bedBook(1, CONFIG.sim.startHour)
    expect(day.rooms).toHaveLength(16)
    for (const r of day.rooms) expect(r.kind).toBe('occupied')
  })

  it('is a pure function of the seed and the start hour', () => {
    expect(bedBook(7, 15)).toEqual(bedBook(7, 15))
    expect(bedBook(7, 15)).not.toEqual(bedBook(8, 15))
  })
})

describe('the bed book: the state of each room at hour H', () => {
  it('shows a discharge in its stages as the day goes on', () => {
    const kindOf = (h: number, room: string) => bedBook(3, h).rooms.find((r) => r.roomId === room)!.kind
    expect(kindOf(9.5, 'A1')).toBe('occupied')
    expect(kindOf(10.0, 'A1')).toBe('signed')
    expect(kindOf(10.2, 'A1')).toBe('leaving')
    expect(['needsCleaning', 'ready']).toContain(kindOf(10.3, 'A1'))
    expect(['ready', 'readmitted']).toContain(kindOf(13, 'A1'))
    // patients who stay never change
    expect(kindOf(15, 'A2')).toBe('occupied')
  })

  it('gives a room that has been ready a long time a synthetic admission, with a ward record from an admission profile', () => {
    const day = bedBook(3, 20)
    const re = day.rooms.filter((r) => r.kind === 'readmitted')
    expect(re.length).toBeGreaterThan(0)
    const names = new Set(PATIENTS.map((p) => p.name))
    const seen = new Set<string>()
    for (const r of re) {
      const o = r.occupant!
      expect(names.has(o.name)).toBe(false)
      expect(seen.has(o.name)).toBe(false)
      seen.add(o.name)
      expect(o.dayOfStay).toBe(1)
      const profile = ADMISSION_PROFILES.find((p) => p.wardReason === o.reason)
      expect(profile, o.reason).toBeDefined()
      expect(o.age).toBeGreaterThanOrEqual(profile!.ageRange[0])
      expect(o.age).toBeLessThanOrEqual(profile!.ageRange[1])
      expect(o.usualMeds).toEqual(profile!.usualMeds)
      if (o.age >= 80) expect(o.leavesBy).toBe('wheelchair')
    }
  })

  it('never has a patient planned to go home in a room that is already empty, and every planned room is covered once', () => {
    for (const h of [8, 10.3, 12, 14.5, 16, 21]) {
      const day = bedBook(5, h)
      expect(new Set(day.rooms.map((r) => r.roomId)).size).toBe(16)
      for (const p of day.plans) {
        const r = day.rooms.find((x) => x.roomId === p.roomId)!
        if (timeOfHour(h) >= p.leaveAt) expect(['needsCleaning', 'ready', 'readmitted']).toContain(r.kind)
      }
    }
  })
})

describe('admission profiles', () => {
  it('a ward record comes from a profile for the ER reason and keeps the ER patient\'s id and name', () => {
    const rng = new Rng(11)
    for (const profile of ADMISSION_PROFILES.slice(0, 6)) {
      const rec = admissionRecord(rng, profile.reasons[0], 'er-9', 'Test Person')
      expect(rec.id).toBe('er-9')
      expect(rec.name).toBe('Test Person')
      expect(profile.reasons.length).toBeGreaterThan(0)
      expect(ADMISSION_PROFILES.filter((p) => p.reasons.includes(profile.reasons[0])).map((p) => p.wardReason)).toContain(rec.reason)
    }
  })
})
