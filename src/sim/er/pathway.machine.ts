/**
 * The ER patient pathway as an xstate v5 machine (skill: "journey state machine"; pattern: Waltz `journey.machine.ts`).
 *
 *   arriving -> checkIn(queueing, serving) -> waitingTriage -> triage(walking, assessing) -> waitingDoctor
 *     -> inBay(walking, waitingExam, exam) -> [tests(waitingPorter, toLab, testing, waitingReturn, returning,
 *        awaitingResults)] -> decision -> leaving.home | admittedOut(waitingPorter, riding) -> gone
 *   a waiting patient whose patience runs out goes waitingTriage / waitingDoctor -> leaving.lwbs -> gone
 *   an ambulance patient skips check-in and triage: arriving -> waitingDoctor (held on the stretcher until a bay is ready)
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

export type PathwayState =
  | 'arriving'
  | 'checkIn.queueing'
  | 'checkIn.serving'
  | 'waitingTriage'
  | 'triage.walking'
  | 'triage.assessing'
  | 'waitingDoctor'
  | 'inBay.walking'
  | 'inBay.waitingExam'
  | 'inBay.exam'
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

export interface PathwayContext {
  rng: PathwayRng
  host: PathwayHost
  clock: SimClock
  /** True acuity 1 (most urgent) .. 5, from the reason. */
  acuity: number
  ambulance: boolean
  /** Sim time (ms) after which a waiting patient gives up; Infinity: never. */
  deadlineMs: number
  serviceSeconds: number
  triageSeconds: number
  examSeconds: number
  labSeconds: number
  resultsSeconds: number
  /** What kind of test this reason gets (from the imaging content): none (never enters the tests branch), blood, imaging. */
  testKind: TestKind
  /** Drawn when the exam starts. */
  needsTests: boolean
  admit: boolean
  /** An imaging report arrived (it may arrive before the patient is back in the bay). */
  reportReady: boolean
}

export type TestKind = 'none' | 'blood' | 'imaging'

export interface PathwayInput {
  rng: PathwayRng
  host: PathwayHost
  clock: SimClock
  acuity: number
  ambulance: boolean
  /** Seconds a waiting patient tolerates, counted from `clock.now` when the patient is created. */
  patienceSeconds: number
  /** Default 'blood' (the M3 behaviour). */
  testKind?: TestKind
}

export type PathwayEvent =
  | { type: 'ARRIVED' }
  | { type: 'SERVICE_BEGIN' }
  | { type: 'CALLED' }
  | { type: 'IN_TRIAGE_BAY' }
  | { type: 'BAY_CALLED' }
  | { type: 'ON_TROLLEY' }
  | { type: 'DOCTOR_HERE' }
  | { type: 'PICKED_UP' }
  | { type: 'AT_LAB' }
  | { type: 'BACK_IN_BAY' }
  /** Imaging: the scan is finished and the patient may be collected. */
  | { type: 'SCAN_DONE' }
  /** Imaging: the report is ready. */
  | { type: 'REPORT_READY' }
  | { type: 'OUT' }

const enter = (state: PathwayState) => ({ type: 'enter' as const, params: { state } })

export const pathwayMachine = setup({
  types: {} as { context: PathwayContext; events: PathwayEvent; input: PathwayInput },
  actions: {
    enter: ({ context }, params: { state: PathwayState }) => context.host.enter(params.state, context),
    sampleService: assign({ serviceSeconds: ({ context }) => context.rng.between(CONFIG.er.checkInSeconds) }),
    sampleTriage: assign({ triageSeconds: ({ context }) => context.rng.between(CONFIG.er.triageSeconds) }),
    markReport: assign({ reportReady: () => true }),
    sampleExam: assign({
      examSeconds: ({ context }) => context.rng.between(CONFIG.er.examSeconds),
      // the draw is always made (so the stream does not depend on the reason); a reason with no test never gets one
      needsTests: ({ context }) => context.rng.chance(CONFIG.er.testsChance) && context.testKind !== 'none',
      admit: ({ context }) => context.rng.chance(CONFIG.er.admitChanceByAcuity[Math.min(5, Math.max(1, context.acuity)) - 1]),
    }),
    sampleLab: assign({ labSeconds: ({ context }) => context.rng.between(CONFIG.er.labSeconds) }),
    sampleResults: assign({ resultsSeconds: ({ context }) => context.rng.between(CONFIG.er.resultsSeconds) }),
  },
  guards: {
    ambulance: ({ context }) => context.ambulance,
    needsTests: ({ context }) => context.needsTests,
    admit: ({ context }) => context.admit,
    isBlood: ({ context }) => context.testKind !== 'imaging',
    reportDone: ({ context }) => context.reportReady,
  },
  delays: {
    serviceDelay: ({ context }) => context.serviceSeconds * 1000,
    triageDelay: ({ context }) => context.triageSeconds * 1000,
    examDelay: ({ context }) => context.examSeconds * 1000,
    labDelay: ({ context }) => context.labSeconds * 1000,
    resultsDelay: ({ context }) => context.resultsSeconds * 1000,
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
    deadlineMs: input.clock.now + input.patienceSeconds * 1000,
    serviceSeconds: 0,
    triageSeconds: 0,
    examSeconds: 0,
    labSeconds: 0,
    resultsSeconds: 0,
    testKind: input.testKind ?? 'blood',
    needsTests: false,
    admit: false,
    reportReady: false,
  }),
  initial: 'arriving',
  states: {
    arriving: {
      entry: enter('arriving'),
      on: { ARRIVED: [{ guard: 'ambulance', target: 'waitingDoctor' }, { target: 'checkIn' }] },
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
          on: { ON_TROLLEY: 'waitingExam' },
        },
        waitingExam: {
          entry: enter('inBay.waitingExam'),
          on: { DOCTOR_HERE: { target: 'exam', actions: 'sampleExam' } },
        },
        exam: {
          entry: enter('inBay.exam'),
          after: {
            examDelay: [{ guard: 'needsTests', target: '#erPatient.tests' }, { target: '#erPatient.decision' }],
          },
        },
      },
    },
    tests: {
      initial: 'waitingPorter',
      // an imaging report can arrive at any point of the branch; awaitingResults looks at the flag on entry
      on: { REPORT_READY: { actions: 'markReport' } },
      states: {
        waitingPorter: { entry: enter('tests.waitingPorter'), on: { PICKED_UP: 'toLab' } },
        toLab: { entry: enter('tests.toLab'), on: { AT_LAB: { target: 'testing', actions: 'sampleLab' } } },
        // blood: a timer; imaging: the scanner says SCAN_DONE
        testing: { entry: enter('tests.testing'), after: { labDelay: { guard: 'isBlood', target: 'waitingReturn' } }, on: { SCAN_DONE: 'waitingReturn' } },
        waitingReturn: { entry: enter('tests.waitingReturn'), on: { PICKED_UP: 'returning' } },
        returning: { entry: enter('tests.returning'), on: { BACK_IN_BAY: { target: 'awaitingResults', actions: 'sampleResults' } } },
        // blood: a timer; imaging: the report (REPORT_READY, or the flag if it came while the patient was on the way back)
        awaitingResults: {
          entry: enter('tests.awaitingResults'),
          always: { guard: 'reportDone', target: '#erPatient.decision' },
          after: { resultsDelay: { guard: 'isBlood', target: '#erPatient.decision' } },
          on: { REPORT_READY: '#erPatient.decision' },
        },
      },
    },
    decision: {
      entry: enter('decision'),
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
  'inBay.waitingExam',
  'inBay.exam',
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
