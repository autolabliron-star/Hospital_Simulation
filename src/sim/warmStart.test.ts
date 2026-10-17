import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { clockText } from './events'
import { parseStartHour } from './startHour'
import { Simulation } from './Simulation'

function logOf(s: Simulation): string[] {
  return s.log.events.map((e) => `${e.t.toFixed(2)} ${e.type} ${e.text}`)
}

describe('L1 warm start (Jump)', () => {
  it('starts the clock at the requested hour, with no burst of past arrivals', () => {
    const s = new Simulation(42, { startHour: 12 })
    expect(s.t).toBe((12 - CONFIG.sim.startHour) * 3600)
    expect(clockText(s.t)).toBe('12:00')
    expect(s.life.startHour).toBe(12)
    s.preRoll(60)
    const arrivals = s.log.events.filter((e) => e.type === 'patientArrived' || e.type === 'visitorArrived' || e.type === 'outpatientArrived')
    expect(arrivals.length).toBeLessThan(12)
  })

  it('the same seed and start hour replay the identical day', () => {
    const a = new Simulation(7, { startHour: 15 })
    const b = new Simulation(7, { startHour: 15 })
    a.preRoll(120)
    b.preRoll(120)
    expect(logOf(a)).toEqual(logOf(b))
  })

  it('the default start is unchanged', () => {
    const s = new Simulation(42)
    expect(s.t).toBe(0)
    expect(s.life.rooms.size).toBe(16)
    for (const r of s.life.rooms.values()) expect(r.bed).toBe('occupied')
  })

  it('parses ?start=', () => {
    expect(parseStartHour(null)).toBeUndefined()
    expect(parseStartHour('12:30')).toBe(12.5)
    expect(parseStartHour('19')).toBe(19)
    expect(parseStartHour('2')).toBe(CONFIG.day.startHour)
    expect(parseStartHour('nope')).toBeUndefined()
  })
})
