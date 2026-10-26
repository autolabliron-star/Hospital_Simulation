/**
 * R4: the CT cryoablation suite's words (docs/R4-CRYO-SUITE.md section 2). cryoSuite.json holds the step labels, the event lines the sim logs,
 * the "Meet the devices" card, the panel's labels, the robot's phases and the list's states. It is parsed with zod at module load, so bad
 * copy throws here with the field named.
 * Templates use {placeholders}; `fillCryo` fills them and leaves an unknown one visible as "{name}", so a test or a glance catches it.
 *
 * The model is brand-free: real products are named only on the card. The copy says "lying on the CT table" and never claims prone or supine.
 * Synthetic and display-only: the sim makes no clinical decisions.
 */
import { z } from 'zod'
import { CRYO_STEPS, type CryoRobotPhase, type CryoStep, type SimEventType } from '@/sim/types'
import { parseOrThrow } from './parse'
import cryoJson from './cryoSuite.json'

/** Words that make a line graphic, and the body positions the copy must not claim. */
const GRAPHIC_WORDS = /\b(blood|bleed\w*|gore|gory|wounds?|incisions?|guts|mangled|severed)\b/i
const POSITION_WORDS = /\b(prone|supine)\b/i

const line = z
  .string()
  .min(1)
  .refine((s) => s === s.trim() && !/\s{2,}/.test(s), 'no stray spaces')
  .refine((s) => !/[\r\n]/.test(s), 'one line only')
  .refine((s) => !GRAPHIC_WORDS.test(s), 'copy must be non-graphic')
  .refine((s) => !POSITION_WORDS.test(s), 'the copy never claims prone or supine ("lying on the CT table")')
  .refine((s) => !/TEMPLATE/.test(s), 'no template text')

const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])

/** The placeholders a template may use. */
export type CryoField = 'patient' | 'n' | 'k' | 'err' | 'ir'

/** The R4 event keys, the SimEventType each is logged as, and exactly the placeholders each line uses. */
export const CRYO_EVENT_FIELDS = {
  arrived: ['patient'],
  planned: ['ir', 'n', 'patient'],
  needle: ['k', 'n', 'err'],
  freeze: ['k', 'patient'],
  done: ['patient'],
} as const satisfies Record<string, readonly CryoField[]>
export type CryoEventKey = keyof typeof CRYO_EVENT_FIELDS
export const CRYO_EVENT_KEYS = Object.keys(CRYO_EVENT_FIELDS) as CryoEventKey[]
export const CRYO_EVENT_TYPE = {
  arrived: 'cryoArrived',
  planned: 'cryoPlanned',
  needle: 'cryoNeedle',
  freeze: 'cryoFreeze',
  done: 'cryoDone',
} as const satisfies Record<CryoEventKey, SimEventType>

/** The panel's labels that carry placeholders (the others are plain words). */
const PANEL_FIELDS: Readonly<Record<string, readonly CryoField[]>> = { needle: ['k', 'n'], aligned: ['err'] }

const keyed = <K extends string, S extends z.ZodType>(keys: readonly K[], schema: S) =>
  z.strictObject(Object.fromEntries(keys.map((key) => [key, schema])) as Record<K, S>)

/** Every placeholder of `text` is allowed, every required one is used, and no brace is stray. */
function checkFields(text: string, allowed: readonly string[], required: readonly string[], path: (string | number)[], ctx: z.RefinementCtx): void {
  const used = new Set(placeholdersOf(text))
  for (const name of used) if (!allowed.includes(name)) ctx.addIssue({ code: 'custom', path, message: `{${name}} is not allowed here (allowed: ${allowed.join(', ') || 'none'})` })
  for (const name of required) if (!used.has(name)) ctx.addIssue({ code: 'custom', path, message: `must use {${name}}` })
  if (/[{}]/.test(text.replace(/\{\w+\}/g, ''))) ctx.addIssue({ code: 'custom', path, message: 'stray brace; placeholders look like {n}' })
}

const PANEL_KEYS = ['tag', 'title', 'start', 'startNext', 'queued', 'noTeam', 'planning', 'live', 'needle', 'aligned', 'aiming', 'tip', 'margin', 'ice', 'timer', 'argon', 'heater', 'list', 'empty'] as const

/** The robot's phases (a Record keyed by the union, so the compiler rejects a missing or an extra one). */
const ROBOT_PHASE_CHECK: Record<CryoRobotPhase, true> = { stowed: true, deploying: true, aiming: true, aligned: true, retracting: true }
export const CRYO_ROBOT_PHASES = Object.keys(ROBOT_PHASE_CHECK) as CryoRobotPhase[]
/** The list's words for a case that is not in the room: booked, in recovery (or on its way back up), done. */
export const CRYO_LIST_STATES = ['booked', 'pacu', 'done'] as const

export const CryoSuiteCopySchema = z
  .strictObject({
    steps: keyed(CRYO_STEPS as readonly CryoStep[], line),
    events: keyed(CRYO_EVENT_KEYS, line),
    card: z.strictObject({ title: line, robot: line, console: line, honesty: line }),
    panel: keyed(PANEL_KEYS, line),
    robotPhases: keyed(CRYO_ROBOT_PHASES, line),
    listStates: keyed(CRYO_LIST_STATES, line),
    prompts: z.strictObject({ glass: line }),
  })
  .superRefine((c, ctx) => {
    for (const key of CRYO_EVENT_KEYS) {
      const text = c.events[key]
      checkFields(text, CRYO_EVENT_FIELDS[key], CRYO_EVENT_FIELDS[key], ['events', key], ctx)
      if (!text.endsWith('.')) ctx.addIssue({ code: 'custom', path: ['events', key], message: 'an event line ends with a full stop' })
    }
    for (const key of PANEL_KEYS) checkFields(c.panel[key], PANEL_FIELDS[key] ?? [], PANEL_FIELDS[key] ?? [], ['panel', key], ctx)
    for (const step of CRYO_STEPS) checkFields(c.steps[step], [], [], ['steps', step], ctx)
    for (const ph of CRYO_ROBOT_PHASES) checkFields(c.robotPhases[ph], [], [], ['robotPhases', ph], ctx)
    for (const k of CRYO_LIST_STATES) checkFields(c.listStates[k], [], [], ['listStates', k], ctx)
    for (const k of ['title', 'robot', 'console', 'honesty'] as const) checkFields(c.card[k], [], [], ['card', k], ctx)
    checkFields(c.prompts.glass, [], [], ['prompts', 'glass'], ctx)
    if (c.panel.tag !== 'Simulated') ctx.addIssue({ code: 'custom', path: ['panel', 'tag'], message: 'the tag reads "Simulated"' })
    if (!c.card.honesty.startsWith('Simulated')) ctx.addIssue({ code: 'custom', path: ['card', 'honesty'], message: 'the honesty line starts with "Simulated"' })
  })

export type CryoSuiteCopy = z.output<typeof CryoSuiteCopySchema>
export const CRYO_SUITE_COPY: CryoSuiteCopy = parseOrThrow(CryoSuiteCopySchema, cryoJson, 'src/content/cryoSuite.json')

/** A template with its {placeholders} filled from `vars`; a placeholder with no value stays visible as "{name}". */
export function fillCryo(template: string, vars: Readonly<Partial<Record<CryoField, string | number>>> = {}): string {
  const bag = vars as Readonly<Record<string, string | number | undefined>>
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = Object.hasOwn(bag, name) ? bag[name] : undefined
    return v === undefined ? whole : String(v)
  })
}

/** The values an event line is filled with: exactly the placeholders it lists. */
export type CryoEventVars<K extends CryoEventKey> = { readonly [F in (typeof CRYO_EVENT_FIELDS)[K][number]]: string | number }

/** One event line, filled (the argument type requires every field of the line). */
export function cryoLine<K extends CryoEventKey>(key: K, vars: CryoEventVars<K>): string {
  return fillCryo(CRYO_SUITE_COPY.events[key], vars as Readonly<Partial<Record<CryoField, string | number>>>)
}
