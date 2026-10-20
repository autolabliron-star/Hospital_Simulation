/**
 * S1 in-flight warm of the entrance health kiosks: after the build and the hidden pre-roll both kiosks have somebody mid-session, the sessions finish
 * normally, the run is deterministic, and a plain `new Simulation(seed)` is untouched.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'

const DT = CONFIG.sim.step
const MEASURING = new Set(['height', 'weight', 'bodyFat', 'sit', 'spo2', 'bp', 'bpRest'])

function open(seed: number, preRoll: number, options: ConstructorParameters<typeof Simulation>[1] = {}): Simulation {
  const sim = new Simulation(seed, { inFlight: true, opening: 'showcase', ...options })
  sim.preRoll(preRoll)
  return sim
}

describe('kiosks already mid-session at the opening', () => {
  it('both kiosks are measuring somebody after the 50 s and the 60 s pre-roll', () => {
    for (const pr of [50, 60]) {
      const sim = open(7, pr)
      const k = sim.vitals.kiosks
      expect(k.map((x) => x.phase), `pre-roll ${pr}`).toSatisfy((ph: string[]) => ph.every((p) => MEASURING.has(p) || p === 'login'))
      expect(k.every((x) => x.userId !== null && x.reading !== null)).toBe(true)
      expect(new Set(k.map((x) => x.userId)).size).toBe(2)
      expect(sim.log.events.filter((e) => e.type === 'healthCheck')).toEqual([])
    }
  })

  it('the placed sessions finish normally and nobody is stuck', { timeout: 120_000 }, () => {
    const sim = open(3, 50)
    const v = sim.vitals
    const placed = v.kiosks.map((x) => x.userId)
    const n = Math.round((20 * 60) / DT)
    for (let i = 0; i < n; i++) sim.step(DT)
    for (const id of placed) {
      const s = v.stats.sessions.find((x) => x.userId === id)
      expect(s, `${id} finished`).toBeDefined()
      expect(s!.partial).toBe(false)
      expect(s!.forced).toBe(false)
      expect(v.readingsFor(id as string).length).toBe(1)
    }
    expect(v.stats.sessions.every((s) => !s.forced)).toBe(true)
    // whoever was placed has gone home, and nobody sits at a kiosk with no session behind it
    for (const w of v.walkUps) expect(placed.includes(w.id) && w.state === 'waiting').toBe(false)
    for (const k of v.kiosks) expect(k.phase === 'idle' || k.userId !== null).toBe(true)
    expect(sim.log.events.some((e) => e.type === 'healthCheck')).toBe(true)
  })

  it('is deterministic', () => {
    const snap = (sim: Simulation) => JSON.stringify([sim.vitals.kiosks.map((k) => [k.phase, k.userId, k.userName, k.kind, k.assisted, k.bpRound, k.progress.toFixed(3)]), sim.vitals.line.length])
    expect(snap(open(11, 50))).toBe(snap(open(11, 50)))
  })

  it('a plain run and a warm start without in-flight begin with idle kiosks', () => {
    const plain = new Simulation(7)
    expect(plain.vitals.kiosks.every((k) => k.phase === 'idle')).toBe(true)
    const warm = new Simulation(7, { startHour: 10 })
    expect(warm.vitals.kiosks.every((k) => k.phase === 'idle')).toBe(true)
  })

  it('a Jump (warm start) places them too, but not after the walk-up hours', () => {
    const day = open(5, 60, { startHour: 10 })
    expect(day.vitals.kiosks.every((k) => k.phase !== 'idle')).toBe(true)
    const night = open(5, 60, { startHour: 22.5 })
    expect(night.vitals.kiosks.every((k) => k.phase === 'idle')).toBe(true)
  })
})
