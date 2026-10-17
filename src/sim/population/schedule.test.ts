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
  it('generates ER walk-ins over the whole day: a 10:30 peak, an evening peak, quieter nights', () => {
    const p = new ArrivalProcess(new Rng(5).fork('er'), CONFIG.day.erArrivalsPerHour)
    const ts = times(p, timeAtHour(26))
    const perHour = (h0: number, h1: number) => ts.filter((t) => hourAt(t) >= h0 && hourAt(t) < h1).length
    expect(perHour(10, 11)).toBeGreaterThan(perHour(7.5, 8.5))
    // the evening peak beats the afternoon, and the late night is quieter than the evening
    expect(perHour(18, 20) / 2).toBeGreaterThan(perHour(14, 16) / 2)
    expect(perHour(18, 20) / 2).toBeGreaterThan(perHour(22.5, 23.5))
    // nothing after the last point of the curve (23:30)
    expect(perHour(23.5, 30)).toBe(0)
    expect(ts.length).toBeGreaterThan(350)
    expect(ts.length).toBeLessThan(600)
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1])
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

  it('visitors start from 07:45, dip in the quiet hour, peak in the afternoon and stop at 20:00', () => {
    const ts = times(new ArrivalProcess(new Rng(3).fork('v'), CONFIG.day.visitorPartiesPerHour), 1e9)
    expect(Math.min(...ts)).toBeGreaterThanOrEqual(timeAtHour(7.75))
    const perHour = (h0: number, h1: number) => ts.filter((t) => hourAt(t) >= h0 && hourAt(t) < h1).length
    // the quiet hour (13:00-14:00) is far below the late morning and the afternoon peak
    expect(perHour(13, 14)).toBeLessThan(perHour(10, 11) / 2)
    expect(perHour(13, 14)).toBeLessThan(perHour(15, 16) / 2)
    expect(perHour(15, 19) / 4).toBeGreaterThan(perHour(13, 14))
    // visiting hours: no party after 20:00 (they leave by 20:30)
    expect(perHour(20, 40)).toBe(0)
  })

  it('schedules an ambulance every 12-20 minutes by day (longer at night), the first one early, until the last hour of the day', () => {
    const s = new AmbulanceSchedule(new Rng(9).fork('amb'))
    const ts: number[] = []
    for (let t = s.next(); Number.isFinite(t); t = s.next()) ts.push(t)
    expect(ts[0]).toBe(CONFIG.er.ambulance.firstAt)
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i] - ts[i - 1]
      const night = isNightHour(hourAt(ts[i - 1]) % 24)
      expect(gap).toBeGreaterThanOrEqual(night ? 720 * NIGHT_STRETCH : 720)
      expect(gap).toBeLessThanOrEqual(night ? 1200 * NIGHT_STRETCH : 1200)
    }
    // all day, not just the morning: M3 stopped at noon
    expect(hourAt(ts[ts.length - 1])).toBeLessThanOrEqual(CONFIG.day.ambulanceLastHour)
    expect(hourAt(ts[ts.length - 1])).toBeGreaterThan(22.5)
    expect(ts.filter((t) => hourAt(t) > 13).length).toBeGreaterThan(20)
    expect(ts.length).toBeGreaterThanOrEqual(40)
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
