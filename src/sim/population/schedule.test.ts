import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Rng } from '../rng'
import { isNightHour } from '../day/roster'
import { AmbulanceSchedule, ArrivalProcess, hourAt, levelAt, NIGHT_STRETCH, rateAt, timeAtHour } from './schedule'

function times(p: ArrivalProcess, until: number): number[] {
  const out: number[] = []
  for (let t = p.next(); t < until; t = p.next()) out.push(t)
  return out
}

describe('arrival curves', () => {
  it('interpolates linearly and is zero outside the table', () => {
    const c = [[8, 10], [10, 30]] as const
    expect(rateAt(c, 7)).toBe(0)
    expect(rateAt(c, 9)).toBe(20)
    expect(rateAt(c, 11)).toBe(0)
    expect(levelAt(c, 7)).toBe(10)
    expect(levelAt(c, 11)).toBe(30)
  })

  it('converts between sim time and clock hours (the day starts at 07:30)', () => {
    expect(hourAt(0)).toBe(7.5)
    expect(timeAtHour(8.5)).toBe(3600)
  })

  // L1: the ER curve is the full-day table (CONFIG.day.erArrivalsPerHour). M3 stopped at 12:15; the day now goes on to 23:30.
  it('generates ER walk-ins over the whole day: a late-morning peak, an evening peak, quieter nights', () => {
    // (about 7 an hour, so one seed is noisy: ten seeds together)
    const all: number[][] = []
    for (let seed = 1; seed <= 10; seed++) all.push(times(new ArrivalProcess(new Rng(seed).fork('er'), CONFIG.day.erArrivalsPerHour), timeAtHour(26)))
    const perHour = (h0: number, h1: number) => all.reduce((n, ts) => n + ts.filter((t) => hourAt(t) >= h0 && hourAt(t) < h1).length, 0) / all.length
    expect(perHour(10, 11)).toBeGreaterThan(perHour(7.5, 8.5))
    // the evening peak beats the afternoon, and the late night is quieter than the evening
    expect(perHour(18, 20) / 2).toBeGreaterThan(perHour(14, 16) / 2)
    expect(perHour(18, 20) / 2).toBeGreaterThan(perHour(22.5, 23.5))
    for (const ts of all) {
      // nothing after the last point of the curve (23:30)
      expect(ts.filter((t) => hourAt(t) >= 23.5).length).toBe(0)
      for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1])
      // Wave 1: sized to 6 bays and 2 doctors at real durations (about 5 an hour over 17 hours, not 25)
      expect(ts.length).toBeGreaterThan(45)
      expect(ts.length).toBeLessThan(160)
    }
    const mean = all.reduce((n, ts) => n + ts.length, 0) / all.length
    expect(mean).toBeGreaterThan(65)
    expect(mean).toBeLessThan(110)
  })

  it('keeps the morning of the M3 curve: the same arrivals up to 11:30', () => {
    // the day table repeats the old points through 11:30, so the first morning (and its medicine story) is the same day
    for (const h of [7.5, 8.5, 9.5, 10.5, 11.5]) expect(rateAt(CONFIG.day.erArrivalsPerHour, h)).toBe(rateAt(CONFIG.er.arrivalsPerHour, h))
    const a = times(new ArrivalProcess(new Rng(5).fork('er'), CONFIG.day.erArrivalsPerHour), timeAtHour(11.5))
    const b = times(new ArrivalProcess(new Rng(5).fork('er'), CONFIG.er.arrivalsPerHour), timeAtHour(11.5))
    expect(a).toEqual(b)
  })

  it('is deterministic for a seed and differs between seeds', () => {
    const a = times(new ArrivalProcess(new Rng(1).fork('v'), CONFIG.day.visitorPartiesPerHour), 1e9)
    const b = times(new ArrivalProcess(new Rng(1).fork('v'), CONFIG.day.visitorPartiesPerHour), 1e9)
    const c = times(new ArrivalProcess(new Rng(2).fork('v'), CONFIG.day.visitorPartiesPerHour), 1e9)
    expect(b).toEqual(a)
    expect(c).not.toEqual(a)
  })

  it('visitors start at 11:00 (none before), dip in the quiet hour, peak in the afternoon and stop at 20:00', () => {
    for (const seed of [3, 4, 5, 6]) {
      const ts = times(new ArrivalProcess(new Rng(seed).fork('v'), CONFIG.day.visitorPartiesPerHour), 1e9)
      expect(ts.length).toBeGreaterThan(50)
      // visiting opens at 11:00: nobody arrives in the morning
      expect(Math.min(...ts), `seed ${seed}`).toBeGreaterThanOrEqual(timeAtHour(11))
      const perHour = (h0: number, h1: number) => ts.filter((t) => hourAt(t) >= h0 && hourAt(t) < h1).length
      expect(perHour(6, 11)).toBe(0)
      // the quiet hour (13:00-14:00, CONFIG.day.quietHours) is far below the lunchtime peak and the afternoon
      expect(perHour(...(CONFIG.day.quietHours as [number, number]))).toBeLessThan(perHour(12, 13))
      expect(perHour(13, 14)).toBeLessThan(perHour(15, 16) / 2)
      expect(perHour(15, 19) / 4).toBeGreaterThan(perHour(13, 14))
      // visiting hours: no party after 20:00 (they leave by 20:30)
      expect(perHour(20, 40)).toBe(0)
    }
  })

  it('keeps the visitor tables to the visiting hours: nothing before 11:00 in either table, and the quiet hour dips in the full-day one', () => {
    expect(CONFIG.visitors.partiesPerHour[0][0]).toBeGreaterThanOrEqual(11)
    expect(CONFIG.day.visitorPartiesPerHour[0][0]).toBeGreaterThanOrEqual(11)
    for (const h of [6.5, 7.5, 8.5, 9.5, 10.5, 10.99]) {
      expect(rateAt(CONFIG.day.visitorPartiesPerHour, h)).toBe(0)
      expect(rateAt(CONFIG.visitors.partiesPerHour, h)).toBe(0)
    }
    const [q0, q1] = CONFIG.day.quietHours
    expect(rateAt(CONFIG.day.visitorPartiesPerHour, (q0 + q1) / 2)).toBeLessThan(rateAt(CONFIG.day.visitorPartiesPerHour, 12) / 2)
  })

  it('schedules an ambulance every 40-70 minutes by day (longer at night), the first one early, until the last hour of the day', () => {
    const s = new AmbulanceSchedule(new Rng(9).fork('amb'))
    const ts: number[] = []
    const [lo, hi] = CONFIG.er.ambulance.every
    for (let t = s.next(); Number.isFinite(t); t = s.next()) ts.push(t)
    expect(ts[0]).toBe(CONFIG.er.ambulance.firstAt)
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i] - ts[i - 1]
      const night = isNightHour(hourAt(ts[i - 1]) % 24)
      expect(gap).toBeGreaterThanOrEqual(night ? lo * NIGHT_STRETCH : lo)
      expect(gap).toBeLessThanOrEqual(night ? hi * NIGHT_STRETCH : hi)
    }
    // all day, not just the morning: M3 stopped at noon
    expect(hourAt(ts[ts.length - 1])).toBeLessThanOrEqual(CONFIG.day.ambulanceLastHour)
    expect(hourAt(ts[ts.length - 1])).toBeGreaterThan(21)
    expect(ts.filter((t) => hourAt(t) > 13).length).toBeGreaterThan(8)
    expect(ts.length).toBeGreaterThanOrEqual(12)
  })

  it('anchors the sequence at the earliest start: the same day wherever a Jump starts', () => {
    const full = new AmbulanceSchedule(new Rng(9).fork('amb'))
    const warm = new AmbulanceSchedule(new Rng(9).fork('amb'))
    const afternoon = timeAtHour(15)
    const a: number[] = []
    for (let t = full.next(); Number.isFinite(t); t = full.next()) if (t >= afternoon) a.push(t)
    const b: number[] = []
    for (let t = warm.skipTo(afternoon); Number.isFinite(t); t = warm.next()) b.push(t)
    expect(b).toEqual(a)
    // a start before 07:30 gets its first ambulance firstAt seconds after the start
    const early = new AmbulanceSchedule(new Rng(9).fork('amb'), timeAtHour(7))
    expect(early.next()).toBe(timeAtHour(7) + CONFIG.er.ambulance.firstAt)
  })
})
