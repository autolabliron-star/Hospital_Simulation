/**
 * The ER patient pathway as an xstate v5 machine (skill: "journey state machine"; pattern: Waltz `journey.machine.ts`).
 *
 * Wave 1 "a real clinical day":
 *   arriving -> checkIn(queueing, serving) -> waitingTriage -> triage(walking, assessing) -> waitingDoctor
 *     -> inBay(walking, waitingCare, care, waitingExam, exam) -> [tests(waitingPorter, toLab, testing, waitingReturn, returning: the scan only)]
 *     -> [tests.awaitingResults] -> inBay(waitingReview, review) -> decision -> leaving.home | admittedOut(waitingPorter, riding) -> gone
 *   - a priority 1-2 walk-in or an ambulance patient skips check-in and triage (arriving -> waitingDoctor); a nurse wheels the walk-in to a bay
 *   - at the bay the ER nurse's care step comes before the doctor: observations, cannula, ECG and the bedside bloods (tubes go by pneumatic tube)
 *   - the doctor's assessment is 10-20 min; the tests of the complaint's bundle (content/imaging.json) are drawn at the bay
 *   - admission is decided AFTER the results, at the doctor's review (a patient with no results is decided at the end of the assessment)
 *   - a waiting patient whose patience runs out goes waitingTriage / waitingDoctor -> leaving.lwbs -> gone
 *   - S1 warm start: arriving -> waitingTriage | waitingDoctor | an in-bay stage mid-way (WARM_*)
 *
 * The machine only decides WHEN and WHICH way:
 *   - timers are `after` delays on the simulation clock (SimClock), so they honour pause and speed;
 *   - every random outcome (service time, tests or not, admitted or not) is drawn from the patient's own Rng in a
 *     transition action, never inside a guard, so replays are exact;
 *   - everything visible (walking, lying down, events, emotes) is done by the host callback on state entry, and the
 *     staff and the host send the physical events (SERVICE_BEGIN, CALLED, ON_TROLLEY, ...) back.
 * State names (`PathwayState`) map to the contract's `PatientStage` with `stageOf`.
 */
import { assign, createActor, setup, type ActorRefFrom } from 'xstate'
import { CONFIG } from '../config'
import type { PatientStage } from '../types'
import type { SimClock } from './simClock'

/**
 * Results that are still missing this long after the patient starts waiting for them are given up on, so a lab or a radiologist that never
 * completes cannot strand anybody (a safety net only: the lab's turnaround and the CT report are well under it).
 */
export const RESULTS_FALLBACK_SECONDS = 7200

export type PathwayState =
  | 'arriving'
  | 'checkIn.queueing'
  | 'checkIn.serving'
  | 'waitingTriage'
  | 'triage.walking'
  | 'triage.assessing'
  | 'waitingDoctor'
  | 'inBay.walking'
  | 'inBay.waitingCare'
  | 'inBay.care'
  | 'inBay.waitingExam'
  | 'inBay.exam'
  | 'inBay.waitingReview'
  | 'inBay.review'
  | 'tests.waitingPorter'
  | 'tests.toLab'
  | 'tests.testing'
  | 'tests.waitingReturn'
  | 'tests.returning'
  | 'tests.awaitingResults'
  | 'decision'
  | 'leaving.home'
  | 'leaving.lwbs'
  | 'admittedOut.waitingPorter'
  | 'admittedOut.riding'
  | 'gone'

/** The two draws the machine makes. `Rng` satisfies it. */
export interface PathwayRng {
  between(span: readonly [number, number]): number
  chance(p: number): boolean
}

export interface PathwayHost {
  /** Called on every state entry, after the transition's assignments, with the live context. */
  enter(state: PathwayState, ctx: PathwayContext): void
}

/** What the complaint's bundle holds (content/imaging.json), as the machine needs it. */
export interface TestBundle {
  /** Chance the bundle is ordered at all (1: a red flag). */
  chance: number
  bloods: boolean
  ecg: boolean
  imaging: boolean
}

export const NO_TESTS: TestBundle = { chance: 0, bloods: false, ecg: false, imaging: false }

export interface PathwayContext {
  rng: PathwayRng
  host: PathwayHost
  clock: SimClock
  /** True acuity 1 (most urgent) .. 5, from the reason. */
  acuity: number
  ambulance: boolean
  /** A priority 1-2 walk-in: no kiosk, no triage queue; a nurse brings a wheelchair and takes them straight to a bay. */
  critical: boolean
  /** Sim time (ms) after which a waiting patient gives up; Infinity: never. */
  deadlineMs: number
  serviceSeconds: number
  triageSeconds: number
  careSeconds: number
  examSeconds: number
  reviewSeconds: number
  /** The complaint's bundle. */
  bundle: TestBundle
  /** W4: how much of the usual triage time this patient's assessment takes (0.8 when kiosk vitals are already in the record). */
  triageScale: () => number
  /** Drawn when the patient lies on the trolley: does this patient get the bundle at all? */
  tests: boolean
  needsBloods: boolean
  needsEcg: boolean
  needsImaging: boolean
  /** The bedside bloods are verified by the lab / the imaging report arrived (either may arrive early). */
  bloodsReady: boolean
  reportReady: boolean
  /** Drawn AFTER the results are in (at the doctor's review, or at the end of the assessment when there is nothing to wait for). */
  admit: boolean
  admitChance: number | null
  /** S1 warm start: how far through the current step the patient already is (0..1). */
  careProgress: number
  examProgress: number
  reviewProgress: number
}

export interface PathwayInput {
  rng: PathwayRng
  host: PathwayHost
  clock: SimClock
  acuity: number
  ambulance: boolean
  /** Seconds a waiting patient tolerates, counted from `clock.now` when the patient is created. */
  patienceSeconds: number
  /** The complaint's tests (default: none). */
  bundle?: TestBundle
  /** The admission profile's chance for this complaint (content/admissions.ts `admitChanceFor`): 0 never admits; null: the acuity table decides. */
  admitChance?: number | null
  /** A factor on the triage assessment time, read when the assessment starts (default 1). */
  triageScale?: () => number
}

export type PathwayEvent =
  | { type: 'ARRIVED' }
  | { type: 'SERVICE_BEGIN' }
  | { type: 'CALLED' }
  | { type: 'IN_TRIAGE_BAY' }
  | { type: 'BAY_CALLED' }
  | { type: 'ON_TROLLEY' }
  /** The ER nurse is at the bedside: the care step starts. */
  | { type: 'NURSE_HERE' }
  | { type: 'DOCTOR_HERE' }
  /** The doctor is back at the bedside with the results: the review starts. */
  | { type: 'REVIEW_HERE' }
  | { type: 'PICKED_UP' }
  | { type: 'AT_LAB' }
  | { type: 'BACK_IN_BAY' }
  /** Imaging: the scan is finished and the patient may be collected. */
  | { type: 'SCAN_DONE' }
  /** Imaging: the report is ready. */
  | { type: 'REPORT_READY' }
  /** The lab verified every test of the bedside bloods. */
  | { type: 'BLOODS_READY' }
  | { type: 'OUT' }
  /**
   * S1 in-flight warm (docs/S1-SHOWCASE.md): a patient placed at a warm start is already under way. Only `arriving` takes these, so the
   * normal entry hooks of the target state run (no snapshot restore). `progress` is how far through that step they are.
   */
  | { type: 'WARM_TRIAGE' }
  | { type: 'WARM_DOCTOR' }
  | { type: 'WARM_BAY' }
  | { type: 'WARM_CARE'; progress: number }
  | { type: 'WARM_WAITEXAM' }
  | { type: 'WARM_EXAM'; progress: number }
  | { type: 'WARM_RESULTS' }
  | { type: 'WARM_REVIEW'; progress: number }

const enter = (state: PathwayState) => ({ type: 'enter' as const, params: { state } })

const clamp01 = (x: number) => Math.min(0.95, Math.max(0, x))

export const pathwayMachine = setup({
  types: {} as { context: PathwayContext; events: PathwayEvent; input: PathwayInput },
  actions: {
    enter: ({ context }, params: { state: PathwayState }) => context.host.enter(params.state, context),
    sampleService: assign({ serviceSeconds: ({ context }) => context.rng.between(CONFIG.er.checkInSeconds) }),
    sampleTriage: assign({ triageSeconds: ({ context }) => context.rng.between(CONFIG.er.triageSeconds) * context.triageScale() }),
    markReport: assign({ reportReady: () => true }),
    markBloods: assign({ bloodsReady: () => true }),
    // the draw is always made (so the stream does not depend on the reason)
    sampleBundle: assign(({ context }) => {
      const hit = context.rng.chance(context.bundle.chance)
      const b = context.bundle
      return { tests: hit, needsBloods: hit && b.bloods, needsEcg: hit && b.ecg, needsImaging: hit && b.imaging }
    }),
    /** S1: the patient has results to wait for (their bundle's bloods; the scan is left out of a placed patient). */
    warmTests: assign(({ context }) => ({ tests: true, needsBloods: context.bundle.bloods, needsEcg: context.bundle.ecg, needsImaging: false })),
    sampleCare: assign({
      // a patient with no tests gets observations only (a short step)
      careSeconds: ({ context }) =>
        context.rng.between(CONFIG.er.bayCareSeconds) * (context.tests ? 1 : CONFIG.er.minorCareShare) * (context.acuity <= 2 ? CONFIG.er.seriousScale : 1),
    }),
    sampleExam: assign({
      // a minor complaint with no tests is seen and treated quickly
      examSeconds: ({ context }) =>
        context.rng.between(!context.tests && context.acuity >= 4 ? CONFIG.er.minorExamSeconds : CONFIG.er.examSeconds) * (context.acuity <= 2 ? CONFIG.er.seriousScale : 1),
    }),
    sampleReview: assign({ reviewSeconds: ({ context }) => context.rng.between(CONFIG.er.reviewSeconds) }),
    // the draw is always made (one per patient). A complaint with an admission chance of its own uses it instead of the acuity table:
    // 0 (a cold, sunburn, a sprain) never leads to a bed, 1 (a stroke, a fit, confusion) always does.
    drawAdmit: assign({
      admit: ({ context }) => {
        const p = context.admitChance ?? CONFIG.er.admitChanceByAcuity[Math.min(5, Math.max(1, context.acuity)) - 1]
        const hit = context.rng.chance(p)
        return context.admitChance === 0 ? false : hit
      },
    }),
    warmCare: assign({ careProgress: ({ event }) => (event.type === 'WARM_CARE' ? clamp01(event.progress) : 0) }),
    warmExam: assign({ examProgress: ({ event }) => (event.type === 'WARM_EXAM' ? clamp01(event.progress) : 0) }),
    warmReview: assign({ reviewProgress: ({ event }) => (event.type === 'WARM_REVIEW' ? clamp01(event.progress) : 0), bloodsReady: () => true }),
  },
  guards: {
    skipsQueue: ({ context }) => context.ambulance || context.critical,
    needsImaging: ({ context }) => context.needsImaging,
    needsResults: ({ context }) => context.needsBloods || context.needsImaging,
    resultsIn: ({ context }) => (!context.needsBloods || context.bloodsReady) && (!context.needsImaging || context.reportReady),
    admit: ({ context }) => context.admit,
  },
  delays: {
    serviceDelay: ({ context }) => context.serviceSeconds * 1000,
    triageDelay: ({ context }) => context.triageSeconds * 1000,
    careDelay: ({ context }) => Math.max(500, context.careSeconds * 1000 * (1 - context.careProgress)),
    examDelay: ({ context }) => Math.max(500, context.examSeconds * 1000 * (1 - context.examProgress)),
    reviewDelay: ({ context }) => Math.max(500, context.reviewSeconds * 1000 * (1 - context.reviewProgress)),
    resultsFallbackDelay: () => RESULTS_FALLBACK_SECONDS * 1000,
    // never less than 30 s, so nobody gives up in the same breath as triage ends
    patienceDelay: ({ context }) => Math.max(30_000, context.deadlineMs - context.clock.now),
  },
}).createMachine({
  id: 'erPatient',
  context: ({ input }) => ({
    rng: input.rng,
    host: input.host,
    clock: input.clock,
    acuity: input.acuity,
    ambulance: input.ambulance,
    critical: !input.ambulance && input.acuity <= 2,
    deadlineMs: input.clock.now + input.patienceSeconds * 1000,
    serviceSeconds: 0,
    triageSeconds: 0,
    careSeconds: 0,
    examSeconds: 0,
    reviewSeconds: 0,
    bundle: input.bundle ?? NO_TESTS,
    triageScale: input.triageScale ?? (() => 1),
    tests: false,
    needsBloods: false,
    needsEcg: false,
    needsImaging: false,
    bloodsReady: false,
    reportReady: false,
    admit: false,
    admitChance: input.admitChance ?? null,
    careProgress: 0,
    examProgress: 0,
    reviewProgress: 0,
  }),
  initial: 'arriving',
  // either result can arrive at any point of the stay (the bloods usually come back during the assessment); awaitingResults looks at the flags
  on: { REPORT_READY: { actions: 'markReport' }, BLOODS_READY: { actions: 'markBloods' } },
  states: {
    arriving: {
      entry: enter('arriving'),
      on: {
        ARRIVED: [{ guard: 'skipsQueue', target: 'waitingDoctor' }, { target: 'checkIn' }],
        WARM_TRIAGE: '#erPatient.waitingTriage',
        WARM_DOCTOR: '#erPatient.waitingDoctor',
        WARM_BAY: { target: '#erPatient.inBay.waitingCare', actions: 'sampleBundle' },
        WARM_CARE: { target: '#erPatient.inBay.care', actions: ['sampleBundle', 'sampleCare', 'warmCare'] },
        WARM_WAITEXAM: { target: '#erPatient.inBay.waitingExam', actions: ['sampleBundle', 'sampleCare'] },
        WARM_EXAM: { target: '#erPatient.inBay.exam', actions: ['sampleBundle', 'sampleCare', 'sampleExam', 'warmExam'] },
        WARM_RESULTS: { target: '#erPatient.tests.awaitingResults', actions: ['warmTests', 'sampleCare', 'sampleExam'] },
        WARM_REVIEW: { target: '#erPatient.inBay.review', actions: ['warmTests', 'sampleCare', 'sampleExam', 'sampleReview', 'warmReview'] },
      },
    },
    checkIn: {
      initial: 'queueing',
      states: {
        queueing: {
          entry: enter('checkIn.queueing'),
          on: { SERVICE_BEGIN: { target: 'serving', actions: 'sampleService' } },
        },
        serving: {
          entry: enter('checkIn.serving'),
          after: { serviceDelay: '#erPatient.waitingTriage' },
        },
      },
    },
    waitingTriage: {
      entry: enter('waitingTriage'),
      on: { CALLED: 'triage' },
      after: { patienceDelay: '#erPatient.leaving.lwbs' },
    },
    triage: {
      initial: 'walking',
      states: {
        walking: {
          entry: enter('triage.walking'),
          on: { IN_TRIAGE_BAY: { target: 'assessing', actions: 'sampleTriage' } },
        },
        assessing: {
          entry: enter('triage.assessing'),
          after: { triageDelay: '#erPatient.waitingDoctor' },
        },
      },
    },
    waitingDoctor: {
      entry: enter('waitingDoctor'),
      on: { BAY_CALLED: 'inBay' },
      after: { patienceDelay: '#erPatient.leaving.lwbs' },
    },
    inBay: {
      initial: 'walking',
      states: {
        walking: {
          entry: enter('inBay.walking'),
          on: { ON_TROLLEY: { target: 'waitingCare', actions: 'sampleBundle' } },
        },
        waitingCare: {
          entry: enter('inBay.waitingCare'),
          on: { NURSE_HERE: { target: 'care', actions: 'sampleCare' } },
        },
        care: {
          entry: enter('inBay.care'),
          after: { careDelay: 'waitingExam' },
        },
        waitingExam: {
          entry: enter('inBay.waitingExam'),
          on: { DOCTOR_HERE: { target: 'exam', actions: 'sampleExam' } },
        },
        exam: {
          entry: enter('inBay.exam'),
          after: {
            examDelay: [
              { guard: 'needsImaging', target: '#erPatient.tests.waitingPorter' },
              { guard: 'needsResults', target: '#erPatient.tests.awaitingResults' },
              { target: '#erPatient.decision' },
            ],
          },
        },
        waitingReview: {
          entry: enter('inBay.waitingReview'),
          on: { REVIEW_HERE: { target: 'review', actions: 'sampleReview' } },
        },
        review: {
          entry: enter('inBay.review'),
          after: { reviewDelay: '#erPatient.decision' },
        },
      },
    },
    tests: {
      initial: 'waitingPorter',
      states: {
        waitingPorter: { entry: enter('tests.waitingPorter'), on: { PICKED_UP: 'toLab' } },
        toLab: { entry: enter('tests.toLab'), on: { AT_LAB: 'testing' } },
        // the scanner says SCAN_DONE
        testing: { entry: enter('tests.testing'), on: { SCAN_DONE: 'waitingReturn' } },
        waitingReturn: { entry: enter('tests.waitingReturn'), on: { PICKED_UP: 'returning' } },
        returning: { entry: enter('tests.returning'), on: { BACK_IN_BAY: 'awaitingResults' } },
        // in the bay, until the lab and the radiologist have both reported; then the doctor reviews
        awaitingResults: {
          entry: enter('tests.awaitingResults'),
          always: { guard: 'resultsIn', target: '#erPatient.inBay.waitingReview' },
          after: { resultsFallbackDelay: '#erPatient.inBay.waitingReview' },
          on: {
            REPORT_READY: { actions: 'markReport', reenter: false },
            BLOODS_READY: { actions: 'markBloods', reenter: false },
          },
        },
      },
    },
    decision: {
      entry: [{ type: 'drawAdmit' }, enter('decision')],
      always: [{ guard: 'admit', target: 'admittedOut' }, { target: 'leaving.home' }],
    },
    leaving: {
      initial: 'home',
      states: {
        home: { entry: enter('leaving.home'), on: { OUT: '#erPatient.gone' } },
        lwbs: { entry: enter('leaving.lwbs'), on: { OUT: '#erPatient.gone' } },
      },
    },
    admittedOut: {
      initial: 'waitingPorter',
      states: {
        waitingPorter: { entry: enter('admittedOut.waitingPorter'), on: { PICKED_UP: 'riding' } },
        riding: { entry: enter('admittedOut.riding'), on: { OUT: '#erPatient.gone' } },
      },
    },
    gone: { type: 'final', entry: enter('gone') },
  },
})

export type PathwayActor = ActorRefFrom<typeof pathwayMachine>

/** Start a pathway actor whose timers run on the given simulation clock. */
export function createPathway(input: PathwayInput, clock: SimClock): PathwayActor {
  const actor = createActor(pathwayMachine, {
    input,
    clock: { setTimeout: (fn, ms) => clock.setTimeout(fn, ms), clearTimeout: (id) => clock.clearTimeout(id as number) },
  })
  actor.start()
  return actor
}

/** The contract's coarse stage for a machine state. */
export function stageOf(state: PathwayState): PatientStage {
  if (state === 'arriving' || state === 'waitingTriage' || state === 'waitingDoctor' || state === 'decision' || state === 'gone') return state
  const head = state.split('.')[0]
  switch (head) {
    case 'checkIn':
      return 'checkIn'
    case 'triage':
      return 'triage'
    case 'inBay':
      return 'inBay'
    case 'tests':
      return 'tests'
    case 'leaving':
      return 'leaving'
    case 'admittedOut':
      return 'admittedOut'
    default:
      return 'gone'
  }
}

/** The leaf state of a snapshot as a dotted name ('inBay.exam'). */
export function stateOf(value: unknown): PathwayState {
  if (typeof value === 'string') return value as PathwayState
  if (value && typeof value === 'object') {
    const key = Object.keys(value)[0]
    return `${key}.${stateOf((value as Record<string, unknown>)[key])}` as PathwayState
  }
  return 'gone'
}

/** Every state, for tests (reachability, stage mapping). */
export const PATHWAY_STATES: readonly PathwayState[] = [
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
  'inBay.exam',
  'inBay.waitingReview',
  'inBay.review',
  'tests.waitingPorter',
  'tests.toLab',
  'tests.testing',
  'tests.waitingReturn',
  'tests.returning',
  'tests.awaitingResults',
  'decision',
  'leaving.home',
  'leaving.lwbs',
  'admittedOut.waitingPorter',
  'admittedOut.riding',
  'gone',
]
