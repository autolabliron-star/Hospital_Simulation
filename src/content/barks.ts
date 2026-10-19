/**
 * W1 walk-in: what people say to the doctor you play. All of the copy lives in barks.json; this module validates it with
 * its own zod schema at module load (bad content throws here, with the file and the field named), types it, and fills
 * the {placeholders}.
 *
 *   greetings   one list per role ("{hello}, Doctor."): staff greet you as you pass, patients and visitors sometimes greet back
 *   talk        what somebody says when you press E on them, by situation: "er.scanResults", "ward.eaten.lunch",
 *               "nurse.drawerLoaded", "porter.wheelchair" ... The situation is worked out by src/sim/reactions.ts
 *   events      the event-line sentence this feature adds (`talkedTo`)
 *
 * Rules the schema enforces (content.test.ts-style checks live in barks.test.ts):
 *   - a speech bubble stays short: at most MAX_BARK_WORDS words;
 *   - every list has at least two lines, so pressing E twice does not repeat itself;
 *   - plain and kind: nothing graphic, no medical advice, no doses and no diagnoses (the sim makes no clinical decisions);
 *   - every {placeholder} is one that the situation can fill, so a stray "{room}" never reaches the screen.
 * Names never appear in the copy: they arrive through {placeholders}, from the synthetic content only.
 */
import { z } from 'zod'
import type { Role } from '@/sim/types'
import barksJson from './barks.json'
import { parseOrThrow } from './schema'

/** Speech bubbles stay short. */
export const MAX_BARK_WORDS = 14

/** Every list needs at least this many lines, so a second press of E says something else. */
export const MIN_LINES = 2

// ---------------------------------------------------------------------------------------------
// The situations of a conversation and the {placeholders} each one may use
// ---------------------------------------------------------------------------------------------

/**
 * Every talk situation, with the placeholders its lines may use. A key missing from barks.json, or a line with a placeholder
 * that is not listed here, fails at load. `satisfies` makes `tsc` fail if a value is not a list of names.
 */
export const TALK_FIELDS = {
  // an ER patient, by where they are on their pathway
  'er.arriving': [],
  'er.checkIn': [],
  'er.waitingTriage': [],
  'er.triage': [],
  'er.waitingDoctor': [],
  'er.inBay': [],
  'er.exam': [],
  'er.bloodTest': [],
  'er.scanWaiting': ['modality'],
  'er.scanResults': ['modality'],
  'er.bloodResults': [],
  'er.decision': [],
  'er.leavingHome': [],
  'er.leavingTired': [],
  'er.admitted': [],
  // a ward patient, by the meal and the bed
  'ward.rested': [],
  'ward.served.breakfast': ['dish'],
  'ward.served.lunch': ['dish'],
  'ward.served.dinner': ['dish'],
  'ward.eaten.breakfast': [],
  'ward.eaten.lunch': [],
  'ward.eaten.dinner': [],
  'ward.medsReady': [],
  'ward.medsGiven': [],
  'ward.dischargeSigned': [],
  'ward.leaving': [],
  'ward.up': [],
  // an imaging outpatient
  'outpatient.checkIn': [],
  'outpatient.waiting': ['modality'],
  'outpatient.after': [],
  // visitors, people resting and the companion of an ER patient
  'visitor.arriving': ['patient'],
  'visitor.visit': ['patient'],
  'visitor.cafe': [],
  'visitor.leaving': [],
  'visitor.collecting': ['patient'],
  'ambient.waiting': [],
  'ambient.cafe': [],
  'ambient.resting': [],
  'companion.waiting': ['patient'],
  'companion.standing': ['patient'],
  // staff, by what they are doing
  'nurse.charting': [],
  'nurse.drawerLoaded': ['room'],
  'nurse.giving': ['room'],
  'nurse.checking': ['room'],
  'nurse.walking': [],
  'nurse.er': [],
  'nurse.triage': [],
  'doctor.rounds': [],
  'doctor.examining': ['room'],
  'doctor.er': [],
  'doctor.resting': [],
  'pharmacist.verifying': [],
  'pharmacist.idle': [],
  'coordinator.beds': ['ready'],
  'coordinator.idle': [],
  'receptionist.desk': [],
  'porter.idle': [],
  'porter.wheelchair': [],
  'porter.stretcher': [],
  'porter.linen': [],
  'cleaner.room': ['room'],
  'cleaner.cart': [],
  'cleaner.mopping': [],
  'radiographer.scanning': ['protocol', 'minutes'],
  'radiographer.idle': [],
  'host.serving': ['dish'],
  'host.idle': [],
  'paramedic.handover': [],
  'paramedic.idle': [],
  // W4: the automated lab
  'labScientist.working': [],
  // anybody, when nothing more specific applies
  'generic.patient': [],
  'generic.visitor': [],
} as const satisfies Record<string, readonly string[]>

export type TalkKey = keyof typeof TALK_FIELDS
export const TALK_KEYS = Object.keys(TALK_FIELDS) as TalkKey[]

/** Every role has greetings: this table makes `tsc` fail when types.ts gains a role that barks.json has no entry for. */
const GREET_ROLES = {
  patient: true,
  visitor: true,
  doctor: true,
  nurse: true,
  pharmacist: true,
  porter: true,
  cleaner: true,
  receptionist: true,
  coordinator: true,
  paramedic: true,
  radiographer: true,
  sonographer: true,
  host: true,
  labScientist: true,
} as const satisfies Record<Role, true>
export const GREET_ROLE_LIST = Object.keys(GREET_ROLES) as Role[]

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'
const TIMES: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night']

const GREET_FIELDS = ['hello'] as const
const EVENT_FIELDS = { talkedTo: ['name'] } as const satisfies Record<string, readonly string[]>
export type BarkEventType = keyof typeof EVENT_FIELDS

// ---------------------------------------------------------------------------------------------
// Rules for a line
// ---------------------------------------------------------------------------------------------

/** Words that make copy graphic. ("blood test" is plain and fine; a wound is not.) */
const GRAPHIC_WORDS = /\b(bleed\w*|gunshot|stab\w*|severed|amputat\w*|wounds?|gore|gory|mangled|crushed|guts|dying|dead)\b/i
/** Clinical advice, doses and diagnoses are not for a demo to give: the sim makes no clinical decisions. */
const ADVICE_WORDS = /\b(mg|ml|mcg|dosage|diagnos\w*|prognosis|cures?|cured|symptoms?|you should|you must|you need to|stop taking|start taking|side effects?)\b/i
const PLACEHOLDER = /\{(\w+)\}/g

export const wordCount = (text: string): number => text.split(/\s+/).filter((w) => w.length > 0).length

/** The names inside the {braces} of a line. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1])
}

const LineSchema = z
  .string()
  .refine((t) => t === t.trim() && t.length > 0, 'a line is not empty and has no stray spaces')
  .refine((t) => wordCount(t) <= MAX_BARK_WORDS, `a line is at most ${MAX_BARK_WORDS} words`)
  .refine((t) => !GRAPHIC_WORDS.test(t), 'lines must be non-graphic')
  .refine((t) => !ADVICE_WORDS.test(t), 'lines give no clinical advice, doses or diagnoses')

const LinesSchema = z.array(LineSchema).min(MIN_LINES, `at least ${MIN_LINES} lines, so a second press says something else`)

const listsOf = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, LinesSchema])) as Record<K, typeof LinesSchema>

/** Check that every {placeholder} of every line is one of `allowed`. */
function checkFields(lines: readonly string[], allowed: readonly string[], path: (string | number)[], ctx: z.RefinementCtx): void {
  lines.forEach((line, i) => {
    for (const name of placeholdersOf(line)) {
      if (!allowed.includes(name)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, i],
          message: `{${name}} is not available here (allowed: ${allowed.length > 0 ? allowed.map((a) => `{${a}}`).join(', ') : 'none'})`,
        })
      }
    }
  })
}

const BarksSchema = z
  .strictObject({
    timeOfDay: z.strictObject({ morning: z.string().min(1), afternoon: z.string().min(1), evening: z.string().min(1), night: z.string().min(1) }),
    greetings: z.strictObject(listsOf(GREET_ROLE_LIST)),
    talk: z.strictObject(listsOf(TALK_KEYS)),
    events: z.strictObject({ talkedTo: LineSchema }),
  })
  .superRefine((b, ctx) => {
    for (const role of GREET_ROLE_LIST) checkFields(b.greetings[role], GREET_FIELDS, ['greetings', role], ctx)
    for (const key of TALK_KEYS) checkFields(b.talk[key], TALK_FIELDS[key], ['talk', key], ctx)
    for (const type of Object.keys(EVENT_FIELDS) as BarkEventType[]) checkFields([b.events[type]], EVENT_FIELDS[type], ['events', type], ctx)
  })

export type Barks = z.output<typeof BarksSchema>
export const BARKS: Barks = parseOrThrow(BarksSchema, barksJson, 'src/content/barks.json')

// ---------------------------------------------------------------------------------------------
// Use
// ---------------------------------------------------------------------------------------------

/** Fill every {placeholder}. Throws when a value is missing, so a sim bug shows up in tests, not as "{room}" on screen. */
export function fillBark(text: string, fields: Readonly<Record<string, string | number>> = {}): string {
  if (text.indexOf('{') < 0) return text
  return text.replace(PLACEHOLDER, (_m, name: string) => {
    if (!Object.hasOwn(fields, name)) throw new Error(`fillBark: "${text}" needs a value for {${name}}`)
    return String(fields[name])
  })
}

/** The lines somebody says in a situation. */
export function talkLines(key: TalkKey): readonly string[] {
  return BARKS.talk[key]
}

/** The greetings of a role. */
export function greetLines(role: Role): readonly string[] {
  return BARKS.greetings[role]
}

/** morning until noon, afternoon until 17:00, evening until 22:00, then night. `hour` is the clock hour (0..24, fractional). */
export function timeOfDay(hour: number): TimeOfDay {
  const h = ((hour % 24) + 24) % 24
  if (h >= 5 && h < 12) return TIMES[0]
  if (h >= 12 && h < 17) return TIMES[1]
  if (h >= 17 && h < 22) return TIMES[2]
  return TIMES[3]
}

/** "Morning", "Afternoon", "Evening" or "Hello" for a clock hour. */
export function helloFor(hour: number): string {
  return BARKS.timeOfDay[timeOfDay(hour)]
}

/** The event-line sentence for `talkedTo` ("You spoke with {name}."). */
export function barkEvent(type: BarkEventType, fields: Readonly<Record<string, string | number>>): string {
  return fillBark(BARKS.events[type], fields)
}
