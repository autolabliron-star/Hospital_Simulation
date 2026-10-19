import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'

const DT = CONFIG.sim.step

function runMorning(seed: number, minutes: number) {
  const sim = new Simulation(seed)
  for (let i = 0, n = Math.round((minutes * 60) / DT); i < n; i++) sim.step(DT)
  const blood = sim.blood
  return {
    records: JSON.stringify(blood.records),
    stats: JSON.stringify(blood.stats),
    events: JSON.stringify(sim.log.events.filter((e) => ['drawTicket', 'drawCalled', 'bloodDrawn', 'drawByNurse', 'samplesSent'].includes(e.type)).map((e) => [e.t, e.type, e.text])),
    stations: JSON.stringify(blood.stations.map((s) => [s.phase, s.ticket, s.drawsToday, s.version])),
    queue: JSON.stringify(blood.queue.map((t) => t.id)),
    n: blood.records.length,
  }
}

describe('the draw centre is deterministic', () => {
  it('the same seed replays the same morning: tickets, calls, draws, failures and events', () => {
    const a = runMorning(31, 45)
    const b = runMorning(31, 45)
    expect(a.n).toBeGreaterThan(10)
    expect(b).toEqual(a)
  }, 180_000)

  it('a different seed gives a different morning', () => {
    const a = runMorning(31, 20)
    const c = runMorning(32, 20)
    expect(c.events).not.toEqual(a.events)
  }, 180_000)
})
