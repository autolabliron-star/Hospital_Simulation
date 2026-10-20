import { describe, expect, it } from 'vitest'
import { Rng } from '../rng'
import { CONFIG } from '../config'
import { createPathway, DRAW_FALLBACK_SECONDS, PATHWAY_STATES, RESULTS_FALLBACK_SECONDS, stageOf, stateOf, type PathwayActor, type PathwayHost, type PathwayState } from './pathway.machine'
import { SimClock } from './simClock'

function make(opts: { acuity?: number; ambulance?: boolean; patience?: number; seed?: number; liveBlood?: boolean; triageScale?: () => number } = {}) {
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
      liveBlood: opts.liveBlood,
      triageScale: opts.triageScale,
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

/** Walk a patient with a blood test to the draw (the exam says tests), for the live-blood tests. */
function toTests(opts: { liveBlood: boolean; seed?: number }) {
  for (let seed = opts.seed ?? 1; seed < 200; seed++) {
    const m = make({ seed, liveBlood: opts.liveBlood })
    toExam(m.actor, m.clock)
    m.clock.advanceTo(m.clock.now + 181_000)
    if (at(m.actor) === 'tests.waitingPorter') return m
  }
  throw new Error('no seed leads to the tests branch')
}

describe('W4 live bloods (the draw centre and the lab behind the patient)', () => {
  it('waits for DRAW_DONE in the chair, not for the old chair timer', () => {
    const { actor, clock } = toTests({ liveBlood: true })
    actor.send({ type: 'PICKED_UP' })
    expect(at(actor)).toBe('tests.toLab')
    actor.send({ type: 'AT_LAB' })
    expect(at(actor)).toBe('tests.testing')
    clock.advanceTo(clock.now + 91_000) // the M3 chair timer (60-90 s) would have moved them on
    expect(at(actor)).toBe('tests.testing')
    actor.send({ type: 'DRAW_DONE' })
    expect(at(actor)).toBe('tests.waitingReturn')
  })

  it('the old chair timer still moves M3 patients on, and they ignore DRAW_DONE', () => {
    const { actor, clock } = toTests({ liveBlood: false })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'AT_LAB' })
    actor.send({ type: 'DRAW_DONE' })
    expect(at(actor)).toBe('tests.testing')
    clock.advanceTo(clock.now + 91_000)
    expect(at(actor)).toBe('tests.waitingReturn')
  })

  it('a draw that never finishes does not strand the patient (fallback after config.blood.stuckSeconds x 3)', () => {
    expect(DRAW_FALLBACK_SECONDS).toBe(CONFIG.blood.stuckSeconds * 3)
    const { actor, clock } = toTests({ liveBlood: true })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'AT_LAB' })
    clock.advanceTo(clock.now + (DRAW_FALLBACK_SECONDS - 5) * 1000)
    expect(at(actor)).toBe('tests.testing')
    clock.advanceTo(clock.now + 10_000)
    expect(at(actor)).toBe('tests.waitingReturn')
  })

  it('waits in the bay for the lab (REPORT_READY) and decides when it comes, not after the old 2-4 minute timer', () => {
    const { actor, clock, visited } = toTests({ liveBlood: true })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'AT_LAB' })
    actor.send({ type: 'DRAW_DONE' })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'BACK_IN_BAY' })
    expect(at(actor)).toBe('tests.awaitingResults')
    clock.advanceTo(clock.now + 20 * 60 * 1000) // 20 minutes: the M3 timer (120-240 s) is long gone
    expect(at(actor)).toBe('tests.awaitingResults')
    actor.send({ type: 'REPORT_READY' })
    expect(['leaving.home', 'admittedOut.waitingPorter']).toContain(at(actor))
    expect(visited).toContain('decision')
  })

  it('a report that arrives before the patient is back in the bay is kept', () => {
    const { actor } = toTests({ liveBlood: true })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'AT_LAB' })
    actor.send({ type: 'DRAW_DONE' })
    actor.send({ type: 'REPORT_READY' }) // the lab was quick: they are still on the wheelchair
    expect(at(actor)).toBe('tests.waitingReturn')
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'BACK_IN_BAY' })
    expect(['leaving.home', 'admittedOut.waitingPorter']).toContain(at(actor))
  })

  it('a lab that never completes does not strand the patient either (fallback after the results bound)', () => {
    const { actor, clock } = toTests({ liveBlood: true })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'AT_LAB' })
    actor.send({ type: 'DRAW_DONE' })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'BACK_IN_BAY' })
    clock.advanceTo(clock.now + (RESULTS_FALLBACK_SECONDS - 5) * 1000)
    expect(at(actor)).toBe('tests.awaitingResults')
    clock.advanceTo(clock.now + 10_000)
    expect(['leaving.home', 'admittedOut.waitingPorter']).toContain(at(actor))
  })

  it('takes the same draws from the patient stream whether the bloods are live or on timers (nothing else shifts)', () => {
    const seen = (live: boolean) => {
      const { actor, clock } = toTests({ liveBlood: live, seed: 3 })
      const c = actor.getSnapshot().context
      return { exam: c.examSeconds, tests: c.needsTests, admit: c.admit, triage: c.triageSeconds, service: c.serviceSeconds, now: clock.now }
    }
    expect(seen(true)).toEqual(seen(false))
  })

  it('triage takes the scaled time when the patient already has kiosk vitals (0.8 x), and the usual time otherwise', () => {
    const triageOf = (scale: () => number) => {
      const m = make({ seed: 21, triageScale: scale })
      m.actor.send({ type: 'ARRIVED' })
      m.actor.send({ type: 'SERVICE_BEGIN' })
      m.clock.advanceTo(41_000)
      m.actor.send({ type: 'CALLED' })
      m.actor.send({ type: 'IN_TRIAGE_BAY' })
      return m.actor.getSnapshot().context.triageSeconds
    }
    const plain = triageOf(() => 1)
    const quick = triageOf(() => CONFIG.vitals.triageWithVitalsFactor)
    expect(CONFIG.vitals.triageWithVitalsFactor).toBe(0.8)
    expect(plain).toBeGreaterThanOrEqual(CONFIG.er.triageSeconds[0])
    expect(plain).toBeLessThanOrEqual(CONFIG.er.triageSeconds[1])
    expect(quick).toBeCloseTo(plain * 0.8, 9)
  })

  it('an imaging patient is not touched by DRAW_DONE', () => {
    const clock = new SimClock()
    const actor = createPathway({ rng: new Rng(1), host: { enter: () => {} }, clock, acuity: 3, ambulance: false, patienceSeconds: Infinity, testKind: 'imaging' }, clock)
    actor.send({ type: 'DRAW_DONE' })
    expect(at(actor)).toBe('arriving')
  })
})

describe('S1 warm events on arriving', () => {
  function warmed(event: 'WARM_TRIAGE' | 'WARM_DOCTOR' | 'WARM_BAY') {
    const clock = new SimClock()
    const entered: PathwayState[] = []
    const host: PathwayHost = { enter: (s) => entered.push(s) }
    const rng = { between: (span: readonly [number, number]) => span[0], chance: () => false }
    const actor = createPathway({ rng, host, clock, acuity: 3, ambulance: false, patienceSeconds: 600 }, clock)
    actor.send({ type: event })
    return { actor, entered, clock }
  }

  it('WARM_TRIAGE enters waitingTriage and runs its entry hook', () => {
    const { actor, entered } = warmed('WARM_TRIAGE')
    expect(stateOf(actor.getSnapshot().value)).toBe('waitingTriage')
    expect(entered).toEqual(['arriving', 'waitingTriage'])
    actor.send({ type: 'CALLED' })
    expect(stateOf(actor.getSnapshot().value)).toBe('triage.walking')
  })

  it('WARM_DOCTOR enters waitingDoctor with its patience timer live', () => {
    const { actor, entered, clock } = warmed('WARM_DOCTOR')
    expect(stateOf(actor.getSnapshot().value)).toBe('waitingDoctor')
    expect(entered).toEqual(['arriving', 'waitingDoctor'])
    clock.advanceTo(601_000)
    expect(stateOf(actor.getSnapshot().value)).toBe('leaving.lwbs')
  })

  it('WARM_DOCTOR then BAY_CALLED and ON_TROLLEY follow the normal path', () => {
    const { actor } = warmed('WARM_DOCTOR')
    actor.send({ type: 'BAY_CALLED' })
    expect(stateOf(actor.getSnapshot().value)).toBe('inBay.walking')
    actor.send({ type: 'ON_TROLLEY' })
    expect(stateOf(actor.getSnapshot().value)).toBe('inBay.waitingExam')
  })

  it('WARM_BAY enters inBay.waitingExam and DOCTOR_HERE starts the exam', () => {
    const { actor, entered } = warmed('WARM_BAY')
    expect(stateOf(actor.getSnapshot().value)).toBe('inBay.waitingExam')
    expect(entered).toEqual(['arriving', 'inBay.waitingExam'])
    actor.send({ type: 'DOCTOR_HERE' })
    expect(stateOf(actor.getSnapshot().value)).toBe('inBay.exam')
  })

  it('ignores the warm events outside arriving', () => {
    const { actor } = warmed('WARM_TRIAGE')
    actor.send({ type: 'WARM_BAY' })
    expect(stateOf(actor.getSnapshot().value)).toBe('waitingTriage')
  })
})
