/**
 * S1 in-flight warm of the entrance health kiosks: after the build and the hidden pre-roll one kiosk has somebody mid-session and the other is kept
 * free for the presenter to show, the sessions finish normally, the run is deterministic, and a plain `new Simulation(seed)` is untouched.
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
  it('one kiosk is measuring somebody after the 50 s and the 60 s pre-roll, and the other is free for you to show', () => {
    for (const pr of [50, 60]) {
      const sim = open(7, pr)
      const held = sim.vitals.heldKiosk
      expect(held, `pre-roll ${pr}`).toBe(sim.vitals.kiosks.length - 1)
      const k = sim.vitals.kiosks.filter((x) => x.index !== held)
      expect(k.map((x) => x.phase), `pre-roll ${pr}`).toSatisfy((ph: string[]) => ph.every((p) => MEASURING.has(p) || p === 'login'))
      expect(k.every((x) => x.userId !== null && x.reading !== null)).toBe(true)
      expect(sim.vitals.kiosks[held].phase).toBe('idle')
      expect(sim.vitals.kiosks[held].userId).toBeNull()
      expect(sim.log.events.filter((e) => e.type === 'healthCheck')).toEqual([])
    }
  })

  it('the placed sessions finish normally and nobody is stuck', { timeout: 120_000 }, () => {
    const sim = open(3, 50)
    const v = sim.vitals
    const placed = v.kiosks.map((x) => x.userId).filter((id) => id !== null)
    expect(placed.length).toBe(1)
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

  it('a Jump (warm start) places one too and keeps the other free, but not after the walk-up hours', () => {
    const day = open(5, 60, { startHour: 10 })
    expect(day.vitals.kiosks.filter((k) => k.phase !== 'idle').length).toBe(1)
    expect(day.vitals.kiosks[day.vitals.heldKiosk].phase).toBe('idle')
    // after the walk-up hours nothing is PLACED (no walk-up, none in the line): right after the build both kiosks are idle. During the 60 s pre-roll
    // an ER walk-in may still check in at a kiosk for its short triage session (kind 'vitals'; the ER takes arrivals until late, and which seed's
    // patient turns up in that minute is luck), which is real ER flow and not a placed walk-up.
    const night = new Simulation(5, { inFlight: true, opening: 'showcase', startHour: 22.5 })
    expect(night.vitals.kiosks.every((k) => k.phase === 'idle')).toBe(true)
    night.preRoll(60)
    expect(night.vitals.walkUps.size).toBe(0)
    expect(night.vitals.kiosks.every((k) => k.phase === 'idle' || k.kind === 'vitals')).toBe(true)
  })
})
