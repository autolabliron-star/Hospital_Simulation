/**
 * Soak test (review F-48, WP-8): the demo's worst case is a presenter who Jumps around the day and then lets the clock run to the end.
 * This chains the app's own Jump flow (a fresh Simulation per Jump: same seed, `inFlight`, the showcase opening, a 60 s hidden pre-roll,
 * as `buildSimulation` in `src/sim/index.ts` does) through 07:45, 18:00 and 22:30, runs on to 23:30 (the limit of a skip, and the day's
 * end), then crosses it with the new-day Jump to 07:00 (`src/ui/dayEnd.ts`).
 *
 * At every sample (every 5 sim minutes) nobody may have a NaN position and the headcount stays inside a sensible band; at the end of each
 * leg every department's stuck counter is within its bound (each leg is a fresh hospital, so these are per leg). A throw anywhere in a step
 * fails the test. A long test, like the other integration tests: about 3 to 6 minutes.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { Simulation } from './Simulation'

const DT = CONFIG.sim.step
const SAMPLE_EVERY = 5 * 60
/** Sim seconds from 07:30 to a clock hour. */
const at = (hour: number) => (hour - CONFIG.sim.startHour) * 3600

/** A fresh hospital as the Jump flow builds it. */
function jump(hour: number, rosterBase: number): Simulation {
  const s = new Simulation(CONFIG.sim.worldSeed, { startHour: hour, rosterBase, opening: 'showcase', inFlight: true })
  s.preRoll(CONFIG.day.jumpPreRollSeconds)
  return s
}

interface Leg {
  label: string
  maxPeople: number
  minPeople: number
  samples: number
}

/** Run `s` until the clock reads `until` (sim seconds), sampling positions and headcount. */
function run(s: Simulation, label: string, until: number): Leg {
  const leg: Leg = { label, maxPeople: 0, minPeople: Infinity, samples: 0 }
  let nextSample = s.t
  while (s.t < until) {
    s.step(DT)
    if (s.t < nextSample) continue
    nextSample += SAMPLE_EVERY
    leg.samples++
    const n = s.entities.size
    leg.maxPeople = Math.max(leg.maxPeople, n)
    leg.minPeople = Math.min(leg.minPeople, n)
    const bad: string[] = []
    for (const e of s.entities.values()) {
      const { x, y, z } = e.position
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) bad.push(`${e.name} (${e.role})`)
    }
    expect(bad, `${label}: NaN positions at ${(s.t / 60).toFixed(0)} min`).toEqual([])
  }
  return leg
}

/** Every department's stuck counter. */
function stuck(s: Simulation): Record<string, number> {
  return {
    surgery: s.surgery.stuckFixes,
    imaging: s.imaging.stuckFixes,
    blood: s.blood.stuckFixes,
    lifts: s.lifts.stuckFixes,
  }
}

/** Per-leg bounds: a stuck fix is a safety net firing, so a handful over a leg is tolerated and a flood is a bug. */
const STUCK_BOUND = 2
const PEOPLE_MIN = 30
const PEOPLE_MAX = 180

function check(s: Simulation, leg: Leg, log: string[]): void {
  const counts = stuck(s)
  const lines = [
    ...s.imaging.stuckLog.map((l) => `imaging ${l}`),
    ...s.surgery.stuckLog.map((l) => `surgery ${l}`),
    ...s.lifts.stuckLog.map((l) => `lifts ${l}`),
  ]
  const line = `[soak] ${leg.label}: people ${leg.minPeople}..${leg.maxPeople} over ${leg.samples} samples, stuck ${JSON.stringify(counts)}, ER in ${s.world.er.cases.size} finished ${s.world.er.finished.length}`
  log.push(line)
  console.log(line)
  for (const l of lines) console.log(`[soak]   ${leg.label}: ${l}`)
  expect(leg.minPeople, `${leg.label}: headcount low`).toBeGreaterThanOrEqual(PEOPLE_MIN)
  expect(leg.maxPeople, `${leg.label}: headcount high`).toBeLessThanOrEqual(PEOPLE_MAX)
  for (const [dept, n] of Object.entries(counts)) expect(n, `${leg.label}: ${dept} stuckFixes (${lines.join(' | ')})`).toBeLessThanOrEqual(STUCK_BOUND)
  // the whole bed board never broke its own rules
  expect(s.beds.board.log.violations, `${leg.label}: bed violations`).toEqual([])
}

describe('soak: Jumps through the day and a run to the end of it', () => {
  it('07:45, 18:00, 22:30 then on to 23:30 and a new day at 07:00, with nothing thrown, bounded and finite', () => {
    const log: string[] = []

    // Jump 1: 07:45, an hour and a half of the morning
    let s = jump(7.75, 1000)
    check(s, run(s, 'jump 07:45', at(9.25)), log)

    // Jump 2: 18:00, through the visiting hour and the evening dose wave
    s = jump(18, 2000)
    check(s, run(s, 'jump 18:00', at(19.5)), log)

    // Jump 3: 22:30, then the run to the end of the day (23:30, where a skip stops and the new day starts)
    s = jump(22.5, 3000)
    check(s, run(s, 'jump 22:30 to 23:30', at(CONFIG.day.endHour)), log)
    expect(s.t).toBeGreaterThanOrEqual(at(CONFIG.day.endHour))

    // the day-end Jump (src/ui/dayEnd.ts): the new day at 07:00 builds and runs
    s = jump(7, 4000)
    check(s, run(s, 'new day 07:00', at(8.5)), log)

    expect(log.length).toBe(4)
  }, 1_200_000)
})
