import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Rng } from '../rng'
import { createPathway, NO_TESTS, PATHWAY_STATES, stageOf, stateOf, type PathwayActor, type PathwayHost, type PathwayRng, type PathwayState, type TestBundle } from './pathway.machine'
import { SimClock } from './simClock'

const ALL: TestBundle = { chance: 1, bloods: true, ecg: true, imaging: true }
const BLOODS: TestBundle = { chance: 1, bloods: true, ecg: false, imaging: false }
const SEC = 1000

function make(opts: { acuity?: number; ambulance?: boolean; patience?: number; seed?: number; bundle?: TestBundle; triageScale?: () => number; rng?: PathwayRng } = {}) {
  const clock = new SimClock()
  const visited: PathwayState[] = []
  const host: PathwayHost = { enter: (s) => visited.push(s) }
  const actor = createPathway(
    {
      rng: opts.rng ?? new Rng(opts.seed ?? 1),
      host,
      clock,
      acuity: opts.acuity ?? 4,
      ambulance: opts.ambulance ?? false,
      patienceSeconds: opts.patience ?? Infinity,
      bundle: opts.bundle,
      triageScale: opts.triageScale,
    },
    clock,
  )
  return { actor, clock, visited }
}

const at = (a: PathwayActor): PathwayState => stateOf(a.getSnapshot().value)
const ctx = (a: PathwayActor) => a.getSnapshot().context

/** A rng that takes the low end of every span and records the order of its chance draws. */
function scripted(chances: (p: number) => boolean = () => true) {
  const draws: string[] = []
  const rng: PathwayRng = {
    between: (span) => span[0],
    chance: (p) => {
      draws.push(`chance:${p}`)
      return chances(p)
    },
  }
  return { rng, draws }
}

/** Drive a walk-in to the trolley (waiting for the nurse). */
function toTrolley(a: PathwayActor, clock: SimClock) {
  a.send({ type: 'ARRIVED' })
  if (!ctx(a).critical) {
    a.send({ type: 'SERVICE_BEGIN' })
    clock.advanceTo(clock.now + 41 * SEC)
    expect(at(a)).toBe('waitingTriage')
    a.send({ type: 'CALLED' })
    a.send({ type: 'IN_TRIAGE_BAY' })
    clock.advanceTo(clock.now + (CONFIG.er.triageSeconds[1] + 1) * SEC)
  }
  expect(at(a)).toBe('waitingDoctor')
  a.send({ type: 'BAY_CALLED' })
  a.send({ type: 'ON_TROLLEY' })
  expect(at(a)).toBe('inBay.waitingCare')
}

/** ... through the nurse's care to the doctor's assessment. */
function toExam(a: PathwayActor, clock: SimClock) {
  toTrolley(a, clock)
  a.send({ type: 'NURSE_HERE' })
  expect(at(a)).toBe('inBay.care')
  clock.advanceTo(clock.now + (ctx(a).careSeconds + 1) * SEC)
  expect(at(a)).toBe('inBay.waitingExam')
  a.send({ type: 'DOCTOR_HERE' })
  expect(at(a)).toBe('inBay.exam')
}

const examEnd = (clock: SimClock) => clock.advanceTo(clock.now + (CONFIG.er.examSeconds[1] * CONFIG.er.seriousScale + 1) * SEC)

describe('ER pathway machine', () => {
  it('walks a patient through check-in, triage, the nurse, the doctor and a decision on the sim clock', () => {
    const { actor, clock, visited } = make({ seed: 7 })
    toExam(actor, clock)
    examEnd(clock)
    expect(['leaving.home', 'admittedOut.waitingPorter']).toContain(at(actor))
    expect(visited.slice(0, 11)).toEqual([
      'arriving',
      'checkIn.queueing',
      'checkIn.serving',
      'waitingTriage',
      'triage.walking',
      'triage.assessing',
      'waitingDoctor',
      'inBay.walking',
      'inBay.waitingCare',
      'inBay.care',
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

  it('the nurse comes first (3-6 min) and then the doctor assesses for 10-20 min, on the real clock', () => {
    const { actor, clock } = make({ seed: 3 })
    toTrolley(actor, clock)
    actor.send({ type: 'NURSE_HERE' })
    const care = ctx(actor).careSeconds
    expect(care).toBeGreaterThanOrEqual(CONFIG.er.bayCareSeconds[0] * CONFIG.er.minorCareShare)
    expect(care).toBeLessThanOrEqual(CONFIG.er.bayCareSeconds[1])
    clock.advanceTo(clock.now + (care - 1) * SEC)
    expect(at(actor)).toBe('inBay.care')
    clock.advanceTo(clock.now + 2 * SEC)
    expect(at(actor)).toBe('inBay.waitingExam')
    actor.send({ type: 'DOCTOR_HERE' })
    const exam = ctx(actor).examSeconds
    expect(exam).toBeGreaterThanOrEqual(CONFIG.er.minorExamSeconds[0])
    expect(exam).toBeLessThanOrEqual(CONFIG.er.examSeconds[1])
  })

  it('a patient with tests has a 10-20 minute assessment; a minor with none is seen and treated quickly', () => {
    const tested = make({ seed: 5, bundle: BLOODS, acuity: 4 })
    toExam(tested.actor, tested.clock)
    expect(ctx(tested.actor).examSeconds).toBeGreaterThanOrEqual(CONFIG.er.examSeconds[0])
    const minor = make({ seed: 5, bundle: NO_TESTS, acuity: 5 })
    toExam(minor.actor, minor.clock)
    expect(ctx(minor.actor).examSeconds).toBeLessThanOrEqual(CONFIG.er.minorExamSeconds[1])
    examEnd(minor.clock)
    // no results to wait for: the decision follows the assessment
    expect(['leaving.home', 'admittedOut.waitingPorter']).toContain(at(minor.actor))
  })

  it('bloods only: waits in the bay for the lab, then the doctor reviews and decides (never before the results)', () => {
    const s = scripted()
    const { actor, clock, visited } = make({ rng: s.rng, bundle: BLOODS, acuity: 3 })
    toExam(actor, clock)
    examEnd(clock)
    expect(at(actor)).toBe('tests.awaitingResults')
    clock.advanceTo(clock.now + 45 * 60 * SEC)
    expect(at(actor)).toBe('tests.awaitingResults') // no timer decides for the lab
    actor.send({ type: 'BLOODS_READY' })
    expect(at(actor)).toBe('inBay.waitingReview')
    actor.send({ type: 'REVIEW_HERE' })
    expect(at(actor)).toBe('inBay.review')
    expect(visited).not.toContain('decision')
    clock.advanceTo(clock.now + (CONFIG.er.reviewSeconds[1] + 1) * SEC)
    expect(['leaving.home', 'admittedOut.waitingPorter']).toContain(at(actor))
    expect(visited).toContain('decision')
  })

  it('the admission is drawn after the results are in, not when the assessment starts', () => {
    const s = scripted()
    const { actor, clock } = make({ rng: s.rng, bundle: BLOODS, acuity: 3 })
    toExam(actor, clock)
    // the bundle draw has been made; the admission draw has not
    expect(s.draws).toEqual([`chance:${BLOODS.chance}`])
    examEnd(clock)
    expect(s.draws).toEqual([`chance:${BLOODS.chance}`])
    actor.send({ type: 'BLOODS_READY' })
    actor.send({ type: 'REVIEW_HERE' })
    clock.advanceTo(clock.now + (CONFIG.er.reviewSeconds[1] + 1) * SEC)
    expect(s.draws).toEqual([`chance:${BLOODS.chance}`, `chance:${CONFIG.er.admitChanceByAcuity[2]}`])
  })

  it('a scan takes the patient out and the report is awaited together with the bloods', () => {
    const { actor, clock } = make({ seed: 2, bundle: ALL, acuity: 2 })
    toExam(actor, clock)
    examEnd(clock)
    expect(at(actor)).toBe('tests.waitingPorter')
    actor.send({ type: 'PICKED_UP' })
    expect(at(actor)).toBe('tests.toLab')
    actor.send({ type: 'AT_LAB' })
    actor.send({ type: 'SCAN_DONE' })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'BACK_IN_BAY' })
    expect(at(actor)).toBe('tests.awaitingResults')
    actor.send({ type: 'BLOODS_READY' })
    expect(at(actor)).toBe('tests.awaitingResults') // the report is still to come
    actor.send({ type: 'REPORT_READY' })
    expect(at(actor)).toBe('inBay.waitingReview')
  })

  it('a result that arrives while the patient is away is kept', () => {
    const { actor, clock } = make({ seed: 2, bundle: ALL, acuity: 2 })
    toExam(actor, clock)
    examEnd(clock)
    actor.send({ type: 'BLOODS_READY' })
    actor.send({ type: 'REPORT_READY' })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'AT_LAB' })
    actor.send({ type: 'SCAN_DONE' })
    actor.send({ type: 'PICKED_UP' })
    actor.send({ type: 'BACK_IN_BAY' })
    expect(at(actor)).toBe('inBay.waitingReview')
  })

  it('bloods that come back during the assessment are kept: no wait for the lab after it', () => {
    const { actor, clock } = make({ seed: 4, bundle: BLOODS })
    toExam(actor, clock)
    actor.send({ type: 'BLOODS_READY' })
    expect(at(actor)).toBe('inBay.exam')
    examEnd(clock)
    expect(at(actor)).toBe('inBay.waitingReview')
  })

  it('a lab that never completes does not strand the patient (fallback)', () => {
    const { actor, clock } = make({ seed: 2, bundle: BLOODS })
    toExam(actor, clock)
    clock.advanceTo(clock.now + (ctx(actor).examSeconds + 1) * SEC)
    clock.advanceTo(clock.now + 7100 * SEC)
    expect(at(actor)).toBe('tests.awaitingResults')
    clock.advanceTo(clock.now + 120 * SEC)
    expect(at(actor)).toBe('inBay.waitingReview')
  })

  it('discharges and admits in roughly the configured proportions, drawn at the decision', () => {
    let admitted = 0
    let n = 0
    for (let seed = 1; seed <= 400; seed++) {
      const { actor, clock } = make({ seed, acuity: 3 })
      toExam(actor, clock)
      examEnd(clock)
      n++
      if (at(actor).startsWith('admittedOut')) admitted++
    }
    expect(admitted / n).toBeGreaterThan(0.3)
    expect(admitted / n).toBeLessThan(0.6)
  })

  it('priority 1-2 are admitted nearly always, priority 5 almost never', () => {
    const rate = (acuity: number) => {
      let a = 0
      for (let seed = 1; seed <= 300; seed++) {
        const { actor, clock } = make({ seed, acuity })
        toExam(actor, clock)
        examEnd(clock)
        if (at(actor).startsWith('admittedOut')) a++
      }
      return a / 300
    }
    expect(rate(1)).toBe(1)
    expect(rate(2)).toBeGreaterThan(0.9)
    expect(rate(5)).toBeLessThan(0.1)
  })

  it('a complaint whose admission profile says 0 is never admitted, whatever the acuity table says', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const clock = new SimClock()
      const actor = createPathway({ rng: new Rng(seed), host: { enter: () => {} }, clock, acuity: 2, ambulance: false, patienceSeconds: Infinity, admitChance: 0 }, clock)
      toExam(actor, clock)
      examEnd(clock)
      expect(at(actor)).toBe('leaving.home')
    }
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

    const b = make({ patience: 5000 })
    b.actor.send({ type: 'ARRIVED' })
    b.actor.send({ type: 'SERVICE_BEGIN' })
    b.clock.advanceTo(41_000)
    b.actor.send({ type: 'CALLED' }) // a nurse has taken them: the patience timer is cancelled
    b.clock.advanceTo(300_000)
    expect(at(b.actor)).toBe('triage.walking')
    b.actor.send({ type: 'IN_TRIAGE_BAY' })
    b.clock.advanceTo(41_000 + 301_000 + CONFIG.er.triageSeconds[1] * SEC)
    expect(b.clock.now).toBeLessThan(5_000_000)
    expect(at(b.actor)).toBe('waitingDoctor')
    b.actor.send({ type: 'BAY_CALLED' }) // a bay is theirs: the timer is cancelled again
    b.clock.advanceTo(50_000_000)
    expect(at(b.actor)).toBe('inBay.walking')
  })

  it('patients with acuity 1-2 (no patience limit) wait for ever', () => {
    const { actor, clock } = make({ acuity: 3, patience: Infinity })
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
    expect(at(actor)).toBe('inBay.waitingCare')
  })

  it('a priority 1-2 walk-in skips the kiosk, the check-in and triage too (a nurse wheels them to a bay)', () => {
    for (const acuity of [1, 2]) {
      const { actor, visited } = make({ acuity, ambulance: false })
      expect(ctx(actor).critical).toBe(true)
      actor.send({ type: 'ARRIVED' })
      expect(at(actor)).toBe('waitingDoctor')
      expect(visited.some((s) => s.startsWith('checkIn') || s.startsWith('triage') || s === 'waitingTriage')).toBe(false)
    }
    const walker = make({ acuity: 3 })
    expect(ctx(walker.actor).critical).toBe(false)
    walker.actor.send({ type: 'ARRIVED' })
    expect(at(walker.actor)).toBe('checkIn.queueing')
  })

  it('is deterministic for a seed', () => {
    const run = () => {
      const { actor, clock, visited } = make({ seed: 99, bundle: ALL })
      toExam(actor, clock)
      examEnd(clock)
      return [...visited, at(actor), JSON.stringify([ctx(actor).careSeconds, ctx(actor).examSeconds, ctx(actor).needsBloods])].join('>')
    }
    expect(run()).toBe(run())
  })

  it('maps every state onto a contract stage', () => {
    const stages = new Set(PATHWAY_STATES.map(stageOf))
    for (const s of ['arriving', 'checkIn', 'waitingTriage', 'triage', 'waitingDoctor', 'inBay', 'tests', 'decision', 'leaving', 'admittedOut', 'gone']) {
      expect(stages.has(s as never)).toBe(true)
    }
    expect(stageOf('inBay.care')).toBe('inBay')
    expect(stageOf('inBay.review')).toBe('inBay')
  })

  it('triage takes the scaled time when the patient already has kiosk vitals (0.8 x), and the usual time otherwise', () => {
    const triageOf = (scale: () => number) => {
      const m = make({ seed: 21, triageScale: scale })
      m.actor.send({ type: 'ARRIVED' })
      m.actor.send({ type: 'SERVICE_BEGIN' })
      m.clock.advanceTo(41_000)
      m.actor.send({ type: 'CALLED' })
      m.actor.send({ type: 'IN_TRIAGE_BAY' })
      return ctx(m.actor).triageSeconds
    }
    const plain = triageOf(() => 1)
    const quick = triageOf(() => CONFIG.vitals.triageWithVitalsFactor)
    expect(plain).toBeGreaterThanOrEqual(CONFIG.er.triageSeconds[0])
    expect(plain).toBeLessThanOrEqual(CONFIG.er.triageSeconds[1])
    expect(quick).toBeCloseTo(plain * 0.8, 9)
  })
})

describe('the complaint bundle is drawn once and gates the tests', () => {
  it('a chance of 0 never orders a test, a chance of 1 always does', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const none = make({ seed, bundle: { ...ALL, chance: 0 } })
      toTrolley(none.actor, none.clock)
      expect(ctx(none.actor).tests).toBe(false)
      expect(ctx(none.actor).needsBloods || ctx(none.actor).needsImaging || ctx(none.actor).needsEcg).toBe(false)
      const all = make({ seed, bundle: ALL })
      toTrolley(all.actor, all.clock)
      expect(ctx(all.actor)).toMatchObject({ tests: true, needsBloods: true, needsEcg: true, needsImaging: true })
    }
  })
})

describe('S1 warm events on arriving', () => {
  function warmed(event: Parameters<PathwayActor['send']>[0], bundle: TestBundle = BLOODS) {
    const clock = new SimClock()
    const entered: PathwayState[] = []
    const host: PathwayHost = { enter: (s) => entered.push(s) }
    const rng = { between: (span: readonly [number, number]) => span[0] + (span[1] - span[0]) / 2, chance: (p: number) => p >= 1 }
    const actor = createPathway({ rng, host, clock, acuity: 3, ambulance: false, patienceSeconds: 600, bundle }, clock)
    actor.send(event)
    return { actor, entered, clock }
  }

  it('WARM_TRIAGE enters waitingTriage and runs its entry hook', () => {
    const { actor, entered } = warmed({ type: 'WARM_TRIAGE' })
    expect(at(actor)).toBe('waitingTriage')
    expect(entered).toEqual(['arriving', 'waitingTriage'])
    actor.send({ type: 'CALLED' })
    expect(at(actor)).toBe('triage.walking')
  })

  it('WARM_DOCTOR enters waitingDoctor with its patience timer live', () => {
    const { actor, entered, clock } = warmed({ type: 'WARM_DOCTOR' })
    expect(at(actor)).toBe('waitingDoctor')
    expect(entered).toEqual(['arriving', 'waitingDoctor'])
    clock.advanceTo(601_000)
    expect(at(actor)).toBe('leaving.lwbs')
  })

  it('WARM_BAY enters the nurse wait; the other bay stages are mid-way', () => {
    expect(at(warmed({ type: 'WARM_BAY' }).actor)).toBe('inBay.waitingCare')
    const care = warmed({ type: 'WARM_CARE', progress: 0.5 })
    expect(at(care.actor)).toBe('inBay.care')
    const left = ctx(care.actor).careSeconds * 0.5
    care.clock.advanceTo((left - 5) * SEC)
    expect(at(care.actor)).toBe('inBay.care')
    care.clock.advanceTo((left + 5) * SEC)
    expect(at(care.actor)).toBe('inBay.waitingExam')

    const exam = warmed({ type: 'WARM_EXAM', progress: 0.5 })
    expect(at(exam.actor)).toBe('inBay.exam')
    exam.clock.advanceTo(ctx(exam.actor).examSeconds * 0.5 * SEC + 5 * SEC)
    expect(at(exam.actor)).toBe('tests.awaitingResults')

    const results = warmed({ type: 'WARM_RESULTS' })
    expect(at(results.actor)).toBe('tests.awaitingResults')
    results.actor.send({ type: 'BLOODS_READY' })
    expect(at(results.actor)).toBe('inBay.waitingReview')

    const review = warmed({ type: 'WARM_REVIEW', progress: 0.4 })
    expect(at(review.actor)).toBe('inBay.review')
    review.clock.advanceTo(ctx(review.actor).reviewSeconds * 0.6 * SEC + 5 * SEC)
    expect(['leaving.home', 'admittedOut.waitingPorter']).toContain(at(review.actor))
  })

  it('ignores the warm events outside arriving', () => {
    const { actor } = warmed({ type: 'WARM_TRIAGE' })
    actor.send({ type: 'WARM_BAY' })
    expect(at(actor)).toBe('waitingTriage')
  })
})
