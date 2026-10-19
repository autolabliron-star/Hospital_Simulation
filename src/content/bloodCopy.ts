/**
 * W4 robot blood-draw centre copy (agent B): the event lines the draw centre writes, and the display words for the robots' and the prep
 * machine's phases. bloodCopy.json is parsed with zod at module load, so bad copy throws here with the field named. Templates use
 * {placeholders}; `bloodText` fills them and throws on a missing value, so a sim bug shows up in a test rather than as a stray "{name}".
 */
import { z } from 'zod'
import bloodJson from './bloodCopy.json'
import { parseOrThrow, PLACEHOLDER } from './schema'
import type { DrawPhase, SimEventType, TubePrepState } from '@/sim/types'

/** Which placeholders each event line may use (the schema checks every template against this). */
export const BLOOD_EVENT_FIELDS = {
  drawTicket: ['name', 'ticket'],
  drawTicketEr: ['name', 'ticket'],
  drawCalled: ['ticket', 'robot'],
  bloodDrawn: ['robot', 'tubes', 'tubeWord', 'name'],
  bloodDrawnRetry: ['robot', 'tubes', 'tubeWord', 'name', 'attempt'],
  bloodDrawnByNurse: ['nurse', 'tubes', 'tubeWord', 'name'],
  drawByNurseNoVein: ['robot', 'name', 'nurse'],
  drawByNurseMissed: ['robot', 'name', 'nurse'],
  drawByNurseMoved: ['robot', 'name', 'nurse'],
  armMoved: ['name', 'robot', 'nurse'],
  samplesSent: ['robot', 'tubes', 'tubeWord', 'name'],
  samplesSentByNurse: ['nurse', 'tubes', 'tubeWord', 'name'],
  playerTicket: ['ticket'],
  porterToDraw: ['porter', 'name'],
  porterFromDraw: ['porter', 'name', 'bay'],
  porterToLounge: ['porter', 'name'],
} as const satisfies Record<string, readonly string[]>

export type BloodEventKey = keyof typeof BLOOD_EVENT_FIELDS
export const BLOOD_EVENT_KEYS = Object.keys(BLOOD_EVENT_FIELDS) as BloodEventKey[]

/** The SimEventType each line is logged as. */
export const BLOOD_EVENT_TYPE: Readonly<Record<BloodEventKey, SimEventType>> = {
  drawTicket: 'drawTicket',
  drawTicketEr: 'drawTicket',
  drawCalled: 'drawCalled',
  bloodDrawn: 'bloodDrawn',
  bloodDrawnRetry: 'bloodDrawn',
  bloodDrawnByNurse: 'bloodDrawn',
  drawByNurseNoVein: 'drawByNurse',
  drawByNurseMissed: 'drawByNurse',
  drawByNurseMoved: 'drawByNurse',
  armMoved: 'drawByNurse',
  samplesSent: 'samplesSent',
  samplesSentByNurse: 'samplesSent',
  playerTicket: 'drawTicket',
  porterToDraw: 'porterJob',
  porterFromDraw: 'porterJob',
  porterToLounge: 'porterJob',
}

const DRAW_PHASES = [
  'idle',
  'calling',
  'cardScan',
  'armIn',
  'cuff',
  'sanitise',
  'veinScan',
  'needleIn',
  'filling',
  'needleOut',
  'bandage',
  'release',
  'awaitPorter',
  'armMoved',
  'fallbackToNurse',
  'reset',
] as const satisfies readonly DrawPhase[]
const PREP_PHASES = ['idle', 'picking', 'labelling', 'output'] as const satisfies readonly TubePrepState['phase'][]

const wordCount = (text: string): number => text.trim().split(/\s+/).length
const Line = z.string().refine((t) => t === t.trim() && wordCount(t) >= 2 && wordCount(t) <= 22, 'a line is 2 to 22 words with no stray spaces')
const Label = z.string().refine((t) => t === t.trim() && wordCount(t) >= 1 && wordCount(t) <= 6, 'a label is 1 to 6 words')

const EventsShape = Object.fromEntries(BLOOD_EVENT_KEYS.map((k) => [k, Line])) as Record<BloodEventKey, typeof Line>
const PhasesShape = Object.fromEntries(DRAW_PHASES.map((k) => [k, Label])) as Record<(typeof DRAW_PHASES)[number], typeof Label>
const PrepShape = Object.fromEntries(PREP_PHASES.map((k) => [k, Label])) as Record<(typeof PREP_PHASES)[number], typeof Label>

export const BloodCopySchema = z
  .strictObject({
    events: z.strictObject(EventsShape),
    tubeWords: z.strictObject({ one: z.string().min(1), other: z.string().min(1) }),
    phases: z.strictObject(PhasesShape),
    prep: z.strictObject(PrepShape),
  })
  .superRefine((copy, ctx) => {
    for (const key of BLOOD_EVENT_KEYS) {
      const template = copy.events[key]
      const allowed = BLOOD_EVENT_FIELDS[key] as readonly string[]
      for (const [, name] of template.matchAll(PLACEHOLDER)) {
        if (!allowed.includes(name)) ctx.addIssue({ code: 'custom', path: ['events', key], message: `{${name}} is not a field of "${key}" (allowed: ${allowed.join(', ')})` })
      }
      if (/[{}]/.test(template.replace(PLACEHOLDER, ''))) ctx.addIssue({ code: 'custom', path: ['events', key], message: 'stray brace; placeholders look like {name}' })
    }
  })

const COPY = parseOrThrow(BloodCopySchema, bloodJson, 'src/content/bloodCopy.json')

/** The raw templates, with the {placeholders} still in. */
export const BLOOD_EVENT_TEMPLATES: Readonly<Record<BloodEventKey, string>> = COPY.events
/** Display words for each robot phase and prep-machine phase (screens and panels). */
export const DRAW_PHASE_LABELS: Readonly<Record<DrawPhase, string>> = COPY.phases
export const PREP_PHASE_LABELS: Readonly<Record<TubePrepState['phase'], string>> = COPY.prep

/** "tube" for 1, "tubes" otherwise. */
export function tubeWord(n: number): string {
  return n === 1 ? COPY.tubeWords.one : COPY.tubeWords.other
}

/** Fill every {placeholder} of an event line. Throws if a value for one of its fields is missing. */
export function bloodText(key: BloodEventKey, fields: Readonly<Record<string, string | number>>): string {
  return BLOOD_EVENT_TEMPLATES[key].replace(PLACEHOLDER, (_match, name: string) => {
    const allowed = BLOOD_EVENT_FIELDS[key] as readonly string[]
    if (!allowed.includes(name) || !Object.hasOwn(fields, name)) throw new Error(`bloodText: the "${key}" line needs a value for {${name}}`)
    return String(fields[name])
  })
}
