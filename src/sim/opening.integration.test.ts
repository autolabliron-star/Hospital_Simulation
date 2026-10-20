/**
 * S1 "Showcase" end to end (docs/S1-SHOWCASE.md): the app's 07:30 opening (the showcase list, work placed under way, the
 * 50 s hidden pre-roll) has somebody in every room and at every machine when the hospital fades in, and the day it opens
 * runs to the evening with nothing stuck. Only passages are allowed to be empty (corridors and lifts).
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { AREAS, areaAt, type AreaId } from './places'
import { Simulation } from './Simulation'

/** Passages: people walk through them, nobody works there. */
const PASSAGES = new Set<AreaId>(['spine', 'corridorA', 'corridorB', 'liftA', 'liftB', 'l2LiftA', 'l2LiftB', 'l2Corridor', 'l2Hall'])

function opening(seed: number): Simulation {
  const s = new Simulation(seed, { opening: 'showcase', inFlight: true })
  s.preRoll(CONFIG.opening.preRollSeconds)
  return s
}

function headcount(s: Simulation): Map<string, number> {
  const count = new Map<string, number>()
  for (const e of s.entities.values()) {
    if (e.fade !== undefined && e.fade <= 0) continue
    const a = areaAt(e.position.x, e.position.z)?.id
    if (a) count.set(a, (count.get(a) ?? 0) + 1)
  }
  return count
}

describe('the showcase opening', () => {
  for (const seed of [CONFIG.sim.worldSeed, 7, 2026]) {
    it(`has somebody in every room at 07:30 (seed ${seed})`, () => {
      const s = opening(seed)
      const count = headcount(s)
      const empty = AREAS.filter((a) => !PASSAGES.has(a.id) && !count.get(a.id)).map((a) => a.id)
      expect(empty).toEqual([])
      // every machine at work
      for (const m of ['mri', 'ct', 'xray', 'us'] as const) expect(s.imaging.scanners[m].phase, m).toBe('scanning')
      expect(s.surgery.state.theatre.phase).toBe('console')
      expect(s.surgery.state.theatre.surgeonAtConsole).toBe(true)
    }, 60000)
  }

  it('is the same opening every time for a seed', () => {
    const snap = (s: Simulation) =>
      JSON.stringify([...s.entities.values()].map((e) => [e.id, Math.round(e.position.x * 100), Math.round(e.position.z * 100), e.anim]))
    expect(snap(opening(11))).toBe(snap(opening(11)))
  }, 60000)

  it('a quiet start is still the R2 day', () => {
    const a = new Simulation(5)
    const b = new Simulation(5, { opening: 'quiet' })
    a.preRoll(30)
    b.preRoll(30)
    expect(a.log.events.map((e) => e.text)).toEqual(b.log.events.map((e) => e.text))
    for (const m of ['mri', 'ct', 'xray', 'us'] as const) expect(a.imaging.scanners[m].phase).not.toBe('scanning')
  }, 60000)

  it('the day it opens runs to 20:00 with nothing stuck', () => {
    const s = opening(CONFIG.sim.worldSeed)
    s.preRoll((20 - CONFIG.sim.startHour) * 3600 - CONFIG.opening.preRollSeconds)
    expect(s.surgery.stuckFixes).toBe(0)
    expect(s.imaging.stuckFixes).toBe(0)
    expect(s.blood.stuckFixes).toBe(0)
    expect(s.lifts.stuckFixes).toBe(0)
    expect(s.surgery.state.theatre.cases.every((c) => c.phase === 'done')).toBe(true)
  }, 900000)
})
