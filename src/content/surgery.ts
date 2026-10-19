/**
 * R2 (agent Copy): the robotic surgery suite's sim-facing words. surgery.json holds the three procedures and their generic instrument names,
 * the phase labels of the case and of the robot, the event lines the suite logs, and the two outcomes. It is parsed with zod at module load, so
 * bad copy throws here with the field named. Templates use {placeholders}: `surgeryLine` fills them, and its argument type requires every field
 * the event lists, so a sim call that forgets one fails to typecheck. Synthetic and display-only: the sim makes no clinical decisions.
 *
 * Arms: `instruments` is by arm index 0..3 (RobotArmState.index). The endoscope is index 1, which the copy shows as "arm 2". The `arm` field of
 * an event is that 1-based number (index + 1).
 */
import { z } from 'zod'
import type { PortLayout } from '@/sim/places'
import type { CasePhase, RobotPhase, SimEventType, SurgeryProcedure } from '@/sim/types'
import surgeryJson from './surgery.json'

/** Words that make a line graphic. The endoscope view and its copy stay non-graphic. */
const GRAPHIC_WORDS = /\b(blood|bleed\w*|gore|gory|wounds?|incisions?|guts|mangled|severed)\b/i
const ENDOSCOPE = 'Endoscope 30°'

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')
  .refine((s) => !GRAPHIC_WORDS.test(s), 'copy must be non-graphic')

const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])

// ---------------------------------------------------------------------------------------------
// The unions the copy must cover. Each is a Record keyed by the type, so the compiler rejects a missing or an extra member.
// ---------------------------------------------------------------------------------------------

const PROCEDURE_CHECK: Record<SurgeryProcedure, true> = { cholecystectomy: true, hysterectomy: true, prostatectomy: true }
export const SURGERY_PROCEDURE_IDS = Object.keys(PROCEDURE_CHECK) as SurgeryProcedure[]

const LAYOUT_CHECK: Record<PortLayout, true> = { oblique: true, transverse: true }
const LAYOUTS = Object.keys(LAYOUT_CHECK) as [PortLayout, ...PortLayout[]]

/** The theatre's phase keys: every CasePhase, plus the two states the theatre shows between cases ('idle' and 'turnover'). */
const THEATRE_PHASE_CHECK: Record<CasePhase | 'idle' | 'turnover', true> = {
  scheduled: true,
  arrived: true,
  preOp: true,
  toTheatre: true,
  in: true,
  induction: true,
  positioning: true,
  ports: true,
  docking: true,
  console: true,
  undocking: true,
  closing: true,
  emergence: true,
  out: true,
  pacu: true,
  phase2: true,
  leaving: true,
  done: true,
  idle: true,
  turnover: true,
}
export const THEATRE_PHASE_KEYS = Object.keys(THEATRE_PHASE_CHECK) as (CasePhase | 'idle' | 'turnover')[]

const ROBOT_PHASE_CHECK: Record<RobotPhase, true> = {
  stowed: true,
  draping: true,
  draped: true,
  deploying: true,
  driving: true,
  docking: true,
  targeting: true,
  docked: true,
  undocking: true,
  returning: true,
  cleaning: true,
}
export const ROBOT_PHASE_KEYS = Object.keys(ROBOT_PHASE_CHECK) as RobotPhase[]

/** The R2 event types the suite logs. Each is a SimEventType: a rename in types.ts fails the typecheck at SURGERY_EVENT_FIELDS below. */
export type SurgeryEventType = Extract<
  SimEventType,
  | 'surgeryArrived'
  | 'preOpReady'
  | 'theatreIn'
  | 'robotDocked'
  | 'consoleStart'
  | 'instrumentExchange'
  | 'robotUndocked'
  | 'theatreOut'
  | 'pacuOut'
  | 'turnoverDone'
>

/** The placeholders a line may use. */
export type SurgeryField = 'patient' | 'procedure' | 'surgeon' | 'bay' | 'minutes' | 'instrument' | 'arm'

/**
 * The placeholders each event line uses, exactly (the schema checks every template against this). `procedure` is the procedure's `short`
 * name, written in brackets so the sentence reads in any case ("Ana Costa (Gallbladder)"); `arm` is the 1-based arm number (index + 1).
 */
export const SURGERY_EVENT_FIELDS = {
  surgeryArrived: ['patient', 'procedure'],
  preOpReady: ['patient', 'bay'],
  theatreIn: ['patient'],
  robotDocked: ['patient', 'procedure', 'minutes'],
  consoleStart: ['surgeon', 'patient'],
  instrumentExchange: ['surgeon', 'arm', 'instrument'],
  robotUndocked: ['patient', 'minutes'],
  theatreOut: ['patient', 'minutes'],
  pacuOut: ['patient', 'minutes'],
  turnoverDone: ['minutes'],
} as const satisfies Record<SurgeryEventType, readonly SurgeryField[]>
export const SURGERY_EVENT_TYPES = Object.keys(SURGERY_EVENT_FIELDS) as SurgeryEventType[]

// ---------------------------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------------------------

const ProcedureSchema = z.strictObject({
  name: line,
  short: line,
  portLayout: z.enum(LAYOUTS),
  instruments: z
    .array(line)
    .length(4, 'four arms: exactly 4 instrument names, by arm index 0..3')
    .refine((list) => list[1] === ENDOSCOPE, `arm index 1 (the second arm) holds the endoscope: "${ENDOSCOPE}"`)
    .refine((list) => list.filter((name) => name.startsWith('Endoscope')).length === 1, 'only arm index 1 holds the endoscope')
    .refine((list) => new Set(list).size === list.length, 'an arm cannot repeat an instrument'),
  exchanges: z
    .array(line)
    .min(2)
    .max(4)
    .refine((list) => new Set(list).size === list.length, 'an exchange list must not repeat a name'),
})

const EventsSchema = z
  .strictObject(Object.fromEntries(SURGERY_EVENT_TYPES.map((type) => [type, line])) as Record<SurgeryEventType, typeof line>)
  .superRefine((events, ctx) => {
    for (const type of SURGERY_EVENT_TYPES) {
      const text = events[type]
      const allowed = new Set<string>(SURGERY_EVENT_FIELDS[type])
      const used = new Set(placeholdersOf(text))
      for (const name of used) {
        if (!allowed.has(name)) ctx.addIssue({ code: 'custom', path: [type], message: `{${name}} is not a field of "${type}" (allowed: ${[...allowed].join(', ')})` })
      }
      for (const name of allowed) {
        if (!used.has(name)) ctx.addIssue({ code: 'custom', path: [type], message: `"${type}" must use {${name}}` })
      }
      if (/[{}]/.test(text.replace(/\{\w+\}/g, ''))) ctx.addIssue({ code: 'custom', path: [type], message: 'stray brace; placeholders look like {minutes}' })
      if (!text.endsWith('.')) ctx.addIssue({ code: 'custom', path: [type], message: 'an event line ends with a full stop' })
    }
  })

/** A record with exactly these keys, each holding `schema`. */
const keyed = <K extends string, S extends z.ZodType>(keys: readonly K[], schema: S) =>
  z.strictObject(Object.fromEntries(keys.map((key) => [key, schema])) as Record<K, S>)

export const SurgeryCopySchema = z.strictObject({
  procedures: keyed(SURGERY_PROCEDURE_IDS, ProcedureSchema),
  phases: keyed(THEATRE_PHASE_KEYS, line),
  robotPhases: keyed(ROBOT_PHASE_KEYS, line),
  events: EventsSchema,
  outcomes: z.strictObject({ home: line, ward: line }),
})

export type SurgeryCopy = z.output<typeof SurgeryCopySchema>
export const SURGERY_COPY: SurgeryCopy = SurgeryCopySchema.parse(surgeryJson)

/** The values a given event line is filled with: exactly the placeholders its line lists. */
export type SurgeryVars<T extends SurgeryEventType> = { readonly [F in (typeof SURGERY_EVENT_FIELDS)[T][number]]: string | number }

/**
 * One event line with its placeholders filled. The argument type requires every field of the line. A value that is missing at runtime stays
 * visible as "{name}", so a test or a glance catches it.
 */
export function surgeryLine<T extends SurgeryEventType>(type: T, vars: SurgeryVars<T>): string {
  const bag = vars as Readonly<Record<string, string | number>>
  return SURGERY_COPY.events[type].replace(/\{(\w+)\}/g, (whole, name: string) => (name in bag ? String(bag[name]) : whole))
}
