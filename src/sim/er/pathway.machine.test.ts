import { describe, expect, it } from 'vitest'
import { Rng } from '../rng'
import { createPathway, PATHWAY_STATES, stageOf, stateOf, type PathwayActor, type PathwayHost, type PathwayState } from './pathway.machine'
import { SimClock } from './simClock'

function make(opts: { acuity?: number; ambulance?: boolean; patience?: number; seed?: number } = {}) {
  const clock = new SimClock()
  const visited: PathwayState[] = []
  const host: PathwayHost = { enter: (s) => visited.push(s) }
  const actor = createPathway(
    {
      rng: new Rng(opts.seed ?? 1),
      host,
      clock,
      acuity: opts.acuity ?? 4,
      ambulance: opts.ambulance ?? false,
      patienceSeconds: opts.patience ?? Infinity,
    },
    clock,
  )
  return { actor, clock, visited }
}

const at = (a: PathwayActor): PathwayState => stateOf(a.getSnapshot().value)

/** Drive a walk-in to the exam, then let the timers run out. */
function toExam(a: PathwayActor, clock: SimClock) {
  a.send({ type: 'ARRIVED' })
  a.send({ type: 'SERVICE_BEGIN' })
  clock.advanceTo(clock.now + 41_000) // check-in takes at most 40 s
  expect(at(a)).toBe('waitingTriage')
  a.send({ type: 'CALLED' })
  a.send({ type: 'IN_TRIAGE_BAY' })
  clock.advanceTo(clock.now + 121_000)
  expect(at(a)).toBe('waitingDoctor')
  a.send({ type: 'BAY_CALLED' })
  a.send({ type: 'ON_TROLLEY' })
  a.send({ type: 'DOCTOR_HERE' })
  expect(at(a)).toBe('inBay.exam')
}

describe('ER pathway machine', () => {
  it('walks a patient through check-in, triage and the exam, then to a decision on the sim clock', () => {
    const { actor, clock, visited } = make({ seed: 7 })
    toExam(actor, clock)
    clock.advanceTo(clock.now + 181_000) // the exam takes at most 180 s
    const end = at(actor)
    expect(['tests.waitingPorter', 'leaving.home', 'admittedOut.waitingPorter']).toContain(end)
    expect(visited.slice(0, 9)).toEqual([
      'arriving',
      'checkIn.queueing',
      'checkIn.serving',
      'waitingTriage',
      'triage.walking',
      'triage.assessing',
      'waitingDoctor',
      'inBay.walking',
      'inBay.waitingExam',
    ])
  })

  it('timers wait for the clock: nothing moves on until the sim time passes', () => {
    const { actor, clock } = make()
    actor.send({ type: 'ARRIVED' })
    actor.send({ type: 'SERVICE_BEGIN' })
    clock.advanceTo(10_000)
    expect(at(actor)).toBe('checkIn.serving')
    clock.advanceTo(40_001)
    expect(at(actor)).toBe('waitingTriage')
  })

  it('sends a patient through the tests branch and back to a decision', () => {
    // find a seed whose draw says "tests"
    let found = false
    for (let seed = 1; seed < 60 && !found; seed++) {
      const { actor, clock, visited } = make({ seed })
      toExam(actor, clock)
      clock.advanceTo(clock.now + 181_000)
      if (at(actor) !== 'tests.waitingPorter') continue
      found = true
      actor.send({ type: 'PICKED_UP' })
      expect(at(actor)).toBe('tests.toLab')
      actor.send({ type: 'AT_LAB' })
      clock.advanceTo(clock.now + 91_000)
      expect(at(actor)).toBe('tests.waitingReturn')
      actor.send({ type: 'PICKED_UP' })
      expect(at(actor)).toBe('tests.returning')
      actor.send({ type: 'BACK_IN_BAY' })
      expect(at(actor)).toBe('tests.awaitingResults')
      clock.advanceTo(clock.now + 241_000)
      expect(['leaving.home', 'admittedOut.waitingPorter']).toContain(at(actor))
      expect(visited).toContain('decision')
    }
    expect(found).toBe(true)
  })

  it('discharges and admits in roughly the configured proportions', () => {
    let admitted = 0
    let n = 0
    for (let seed = 1; seed <= 400; seed++) {
      const { actor, clock } = make({ seed, acuity: 3 })
      toExam(actor, clock)
      clock.advanceTo(clock.now + 181_000)
      if (at(actor) === 'tests.waitingPorter') {
        actor.send({ type: 'PICKED_UP' })
        actor.send({ type: 'AT_LAB' })
        clock.advanceTo(clock.now + 91_000)
        actor.send({ type: 'PICKED_UP' })
        actor.send({ type: 'BACK_IN_BAY' })
        clock.advanceTo(clock.now + 241_000)
      }
      n++
      if (at(actor).startsWith('admittedOut')) admitted++
    }
    expect(admitted / n).toBeGreaterThan(0.3)
    expect(admitted / n).toBeLessThan(0.5)
  })

  it('an impatient waiting patient leaves without being seen; a patient in the bay never does', () => {
    const a = make({ patience: 600 })
    a.actor.send({ type: 'ARRIVED' })
    a.actor.send({ type: 'SERVICE_BEGIN' })
    a.clock.advanceTo(41_000)
    expect(at(a.actor)).toBe('waitingTriage')
    a.clock.advanceTo(601_000)
    expect(at(a.actor)).toBe('leaving.lwbs')
    a.actor.send({ type: 'OUT' })
    expect(at(a.actor)).toBe('gone')
    expect(a.actor.getSnapshot().status).toBe('done')

    const b = make({ patience: 600 })
    b.actor.send({ type: 'ARRIVED' })
    b.actor.send({ type: 'SERVICE_BEGIN' })
    b.clock.advanceTo(41_000)
    b.actor.send({ type: 'CALLED' }) // a nurse has taken them: the patience timer is cancelled
    b.clock.advanceTo(300_000)
    expect(at(b.actor)).toBe('triage.walking')
    b.actor.send({ type: 'IN_TRIAGE_BAY' })
    b.clock.advanceTo(421_000)
    expect(at(b.actor)).toBe('waitingDoctor') // triage done at <= 41 + 300 + 120 s; the deadline is at 600 s
    b.actor.send({ type: 'BAY_CALLED' }) // a bay is theirs: the timer is cancelled again
    b.clock.advanceTo(2_000_000)
    expect(at(b.actor)).toBe('inBay.walking')
  })

  it('patients with acuity 1-2 (no patience limit) wait for ever', () => {
    const { actor, clock } = make({ acuity: 2, patience: Infinity })
    actor.send({ type: 'ARRIVED' })
    actor.send({ type: 'SERVICE_BEGIN' })
    clock.advanceTo(41_000)
    clock.advanceTo(10 * 3600 * 1000)
    expect(at(actor)).toBe('waitingTriage')
  })

  it('an ambulance patient skips check-in and triage', () => {
    const { actor, visited } = make({ ambulance: true, acuity: 2 })
    actor.send({ type: 'ARRIVED' })
    expect(at(actor)).toBe('waitingDoctor')
    expect(visited).not.toContain('checkIn.queueing')
    actor.send({ type: 'BAY_CALLED' })
    actor.send({ type: 'ON_TROLLEY' })
    actor.send({ type: 'DOCTOR_HERE' })
    expect(at(actor)).toBe('inBay.exam')
  })

  it('is deterministic for a seed', () => {
    const run = () => {
      const { actor, clock, visited } = make({ seed: 99 })
      toExam(actor, clock)
      clock.advanceTo(clock.now + 181_000)
      return [...visited, at(actor)].join('>')
    }
    expect(run()).toBe(run())
  })

  it('maps every state onto a contract stage', () => {
    const stages = new Set(PATHWAY_STATES.map(stageOf))
    for (const s of ['arriving', 'checkIn', 'waitingTriage', 'triage', 'waitingDoctor', 'inBay', 'tests', 'decision', 'leaving', 'admittedOut', 'gone']) {
      expect(stages.has(s as never)).toBe(true)
    }
  })
})
