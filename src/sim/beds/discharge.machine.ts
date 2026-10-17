/**
 * A planned discharge as an xstate v5 machine (pattern: er/pathway.machine.ts). The doctor has signed; the machine only
 * decides WHEN and WHICH way, and the ward patient (the host) does everything visible on state entry.
 *
 *   signed            waiting for the take-home medicines to be handed over (MEDS_GIVEN) and the family to arrive
 *                     (FAMILY_HERE); either alone changes nothing. A safety timer moves on after FORCE_SECONDS.
 *   changing          standing (off the bed) -> walking (to the bathroom pod door) -> inside (invisible, a timer) ->
 *                     out (fade in, everyday clothes)
 *   leave             walking out with the family, or by porter wheelchair (wheelchairWaiting -> riding), then
 *                     fading at the entrance
 *   gone
 *
 * Timers are `after` delays on the simulation clock (SimClock), so they honour pause and the speed buttons.
 */
import { createActor, setup, assign, type ActorRefFrom } from 'xstate'
import type { SimClock } from '../er/simClock'

export type DischargeState =
  | 'signed'
  | 'changing.standing'
  | 'changing.walking'
  | 'changing.inside'
  | 'changing.out'
  | 'leave.walking'
  | 'leave.wheelchairWaiting'
  | 'leave.riding'
  | 'leave.fading'
  | 'gone'

export interface DischargeHost {
  /** Called on every state entry with the live context. */
  enter(state: DischargeState, ctx: DischargeContext): void
}

export interface DischargeContext {
  host: DischargeHost
  /** How long the patient stays invisible in the bathroom pod (sim seconds). */
  changeSeconds: number
  wheelchair: boolean
  medsGiven: boolean
  familyHere: boolean
}

export interface DischargeInput {
  host: DischargeHost
  changeSeconds: number
  wheelchair: boolean
  /** Start with these already true (a warm start in the middle of a discharge). */
  medsGiven?: boolean
  familyHere?: boolean
}

export type DischargeEvent =
  | { type: 'MEDS_GIVEN' }
  | { type: 'FAMILY_HERE' }
  | { type: 'STOOD' }
  | { type: 'AT_BATH' }
  | { type: 'DRESSED' }
  | { type: 'PICKED_UP' }
  | { type: 'AT_EXIT' }
  | { type: 'OUT' }

/** If the medicines or the family never come, the discharge moves on after this long (a safety net, not a behaviour). */
export const FORCE_SECONDS = 1500

const enter = (state: DischargeState) => ({ type: 'enter' as const, params: { state } })

export const dischargeMachine = setup({
  types: {} as { context: DischargeContext; events: DischargeEvent; input: DischargeInput },
  actions: {
    enter: ({ context }, params: { state: DischargeState }) => context.host.enter(params.state, context),
    medsGiven: assign({ medsGiven: () => true }),
    familyHere: assign({ familyHere: () => true }),
  },
  guards: {
    allSet: ({ context }) => context.medsGiven && context.familyHere,
    wheelchair: ({ context }) => context.wheelchair,
  },
  delays: {
    forceDelay: () => FORCE_SECONDS * 1000,
    changeDelay: ({ context }) => context.changeSeconds * 1000,
  },
}).createMachine({
  id: 'discharge',
  context: ({ input }) => ({
    host: input.host,
    changeSeconds: input.changeSeconds,
    wheelchair: input.wheelchair,
    medsGiven: input.medsGiven ?? false,
    familyHere: input.familyHere ?? false,
  }),
  initial: 'signed',
  states: {
    signed: {
      entry: enter('signed'),
      on: { MEDS_GIVEN: { actions: 'medsGiven' }, FAMILY_HERE: { actions: 'familyHere' } },
      always: { guard: 'allSet', target: 'changing' },
      after: { forceDelay: 'changing' },
    },
    changing: {
      initial: 'standing',
      states: {
        standing: { entry: enter('changing.standing'), on: { STOOD: 'walking' } },
        walking: { entry: enter('changing.walking'), on: { AT_BATH: 'inside' } },
        inside: { entry: enter('changing.inside'), after: { changeDelay: 'out' } },
        out: { entry: enter('changing.out'), on: { DRESSED: '#discharge.leave' } },
      },
    },
    leave: {
      initial: 'choose',
      states: {
        choose: { always: [{ guard: 'wheelchair', target: 'wheelchairWaiting' }, { target: 'walking' }] },
        walking: { entry: enter('leave.walking'), on: { AT_EXIT: 'fading' } },
        wheelchairWaiting: { entry: enter('leave.wheelchairWaiting'), on: { PICKED_UP: 'riding' } },
        riding: { entry: enter('leave.riding'), on: { AT_EXIT: 'fading' } },
        fading: { entry: enter('leave.fading'), on: { OUT: '#discharge.gone' } },
      },
    },
    gone: { type: 'final', entry: enter('gone') },
  },
})

export type DischargeActor = ActorRefFrom<typeof dischargeMachine>

/** Start a discharge actor whose timers run on the given simulation clock. */
export function createDischarge(input: DischargeInput, clock: SimClock): DischargeActor {
  const actor = createActor(dischargeMachine, {
    input,
    clock: { setTimeout: (fn, ms) => clock.setTimeout(fn, ms), clearTimeout: (id) => clock.clearTimeout(id as number) },
  })
  actor.start()
  return actor
}

/** The leaf state of a snapshot as a dotted name ('changing.inside'). */
export function dischargeStateOf(value: unknown): DischargeState {
  if (typeof value === 'string') return value as DischargeState
  if (value && typeof value === 'object') {
    const key = Object.keys(value)[0]
    return `${key}.${dischargeStateOf((value as Record<string, unknown>)[key])}` as DischargeState
  }
  return 'gone'
}

/** Every state, for tests. */
export const DISCHARGE_STATES: readonly DischargeState[] = [
  'signed',
  'changing.standing',
  'changing.walking',
  'changing.inside',
  'changing.out',
  'leave.walking',
  'leave.wheelchairWaiting',
  'leave.riding',
  'leave.fading',
  'gone',
]
