/**
 * The kiosks inside the real hospital: the same seed replays the same readings and event lines (walk-ups, ER walk-ins, the guide and all), a
 * different seed does not, and a warm start at another hour begins with idle kiosks and an empty line.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'

const DT = CONFIG.sim.step

function run(seed: number, seconds: number, startHour?: number) {
  const sim = new Simulation(seed, startHour === undefined ? {} : { startHour })
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) sim.step(DT)
  const v = sim.vitals
  const ids = new Set<string>()
  for (const s of v.stats.sessions) ids.add(s.userId)
  return {
    sim,
    sessions: v.stats.sessions,
    readings: [...ids].sort().map((id) => v.readingsFor(id)),
    lines: sim.log.events.filter((e) => e.type === 'healthCheck').map((e) => `${e.id}|${e.t.toFixed(3)}|${e.text}|${e.subjectId}`),
    spawned: v.spawner.spawned,
  }
}

describe('the kiosks in the whole hospital', () => {
  it('the same seed gives the same sessions, readings and event lines; another seed does not', { timeout: 300_000 }, () => {
    const a = run(11, 65 * 60)
    const b = run(11, 65 * 60)
    expect(a.sessions.length).toBeGreaterThan(6)
    expect(a.lines.length).toBeGreaterThan(6)
    expect(a.spawned).toBeGreaterThan(5)
    expect(a.sessions).toEqual(b.sessions)
    expect(a.readings).toEqual(b.readings)
    expect(a.lines).toEqual(b.lines)
    expect(a.spawned).toBe(b.spawned)
    const c = run(12, 65 * 60)
    expect(c.lines).not.toEqual(a.lines)
  })

  it('a warm start begins with idle kiosks and an empty line, and the day carries on from that hour', { timeout: 300_000 }, () => {
    const sim = new Simulation(5, { startHour: 10 })
    const v = sim.vitals
    expect(v.line.length).toBe(0)
    expect(v.kiosks.every((k) => k.phase === 'idle' && k.sessionsToday === 0 && k.reading === null)).toBe(true)
    const n = Math.round((40 * 60) / DT)
    for (let i = 0; i < n; i++) sim.step(DT)
    expect(v.spawner.spawned).toBeGreaterThan(3)
    expect(v.stats.sessions.length).toBeGreaterThan(3)
    // nobody who started before the end is stuck
    for (const k of v.kiosks) expect(k.phase === 'idle' || k.userId !== null).toBe(true)
    expect(v.guide).not.toBeNull()
  })

  it('late at night the walk-ups stop (the table ends at 19:00) and the kiosks stay idle', { timeout: 300_000 }, () => {
    const sim = new Simulation(6, { startHour: 22.5 })
    const v = sim.vitals
    const n = Math.round((20 * 60) / DT)
    for (let i = 0; i < n; i++) sim.step(DT)
    expect(v.spawner.spawned).toBe(0)
    expect(v.walkUps.size).toBe(0)
  })
})
