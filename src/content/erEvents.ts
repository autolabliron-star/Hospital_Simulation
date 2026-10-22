/**
 * The ER event lines (F-33): what the event ticker says as a patient walks through the emergency department, as the porters move them and as
 * a bay is cleaned. These sentences used to sit in src/sim/er; they live here now, parsed with zod at module load, one vocabulary (UK).
 * Templates use {placeholders}; `erLine` fills them and throws on a missing or unknown value, so a sim bug shows up in a test rather than as a
 * stray "{patient}" in the ticker.
 */
import { z } from 'zod'
import erEventsJson from './erEvents.json'
import { parseOrThrow } from './parse'

/** The placeholders each line uses, exactly (the schema checks every template against this). */
export const ER_LINE_FIELDS = {
  'patient.arrived': ['patient', 'reason'],
  'patient.ambulanceArrived': ['patient', 'reason'],
  'patient.checkedInDesk': ['patient'],
  'patient.checkedInKiosk': ['patient'],
  'patient.triagedCritical': ['patient', 'priority'],
  'patient.triaged': ['nurse', 'patient', 'priority'],
  'patient.triageEcg': ['patient'],
  'patient.care': ['nurse', 'items', 'patient', 'bay'],
  'patient.seenByDoctor': ['doctor', 'patient', 'bay'],
  'patient.resultsBack': ['patient'],
  'patient.review': ['doctor', 'patient'],
  'patient.scanOrdered': ['doctor', 'scan', 'patient'],
  'patient.scanOrderedEarly': ['nurse', 'scan', 'patient', 'priority'],
  'patient.discharged': ['patient', 'minutes'],
  'patient.leftWithoutBeingSeen': ['patient', 'minutes'],
  'patient.admittedRoom': ['patient', 'ward', 'room'],
  'patient.admittedUpstairs': ['patient'],
  'patient.tubesSent': ['patient'],
  'porter.toDiagnostics': ['porter', 'patient'],
  'porter.toImaging': ['porter', 'patient', 'place'],
  'porter.fromImaging': ['porter', 'patient', 'bay'],
  'porter.toRoom': ['porter', 'patient', 'room'],
  'porter.toLift': ['porter', 'patient'],
  'cleaner.bayCleaned': ['bay'],
} as const satisfies Record<string, readonly string[]>

export type ErLineKey = keyof typeof ER_LINE_FIELDS

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')
const word = z.string().min(1)

const SECTIONS = {
  patient: ['arrived', 'ambulanceArrived', 'checkedInDesk', 'checkedInKiosk', 'triagedCritical', 'triaged', 'triageEcg', 'care', 'seenByDoctor', 'resultsBack', 'review', 'scanOrdered', 'scanOrderedEarly', 'discharged', 'leftWithoutBeingSeen', 'admittedRoom', 'admittedUpstairs', 'tubesSent'],
  porter: ['toDiagnostics', 'toImaging', 'fromImaging', 'toRoom', 'toLift'],
  cleaner: ['bayCleaned'],
} as const

const keyed = <K extends string>(keys: readonly K[]) => z.strictObject(Object.fromEntries(keys.map((k) => [k, line])) as Record<K, typeof line>)

export const ErEventsSchema = z
  .strictObject({
    patient: keyed(SECTIONS.patient),
    careItems: z.strictObject({ observations: word, cannula: word, ecg: word, bloods: word, and: word }),
    porter: keyed(SECTIONS.porter),
    scanPlaces: z.strictObject({ mri: word, ct: word, xray: word, us: word }),
    cleaner: keyed(SECTIONS.cleaner),
  })
  .superRefine((copy, ctx) => {
    for (const key of Object.keys(ER_LINE_FIELDS) as ErLineKey[]) {
      const [section, name] = key.split('.') as [keyof typeof SECTIONS, string]
      const text = (copy[section] as Record<string, string>)[name]
      const allowed = new Set<string>(ER_LINE_FIELDS[key])
      const used = new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
      for (const f of used) if (!allowed.has(f)) ctx.addIssue({ code: 'custom', path: [section, name], message: `{${f}} is not a field of "${key}"` })
      for (const f of allowed) if (!used.has(f)) ctx.addIssue({ code: 'custom', path: [section, name], message: `"${key}" must use {${f}}` })
      if (/[{}]/.test(text.replace(/\{\w+\}/g, ''))) ctx.addIssue({ code: 'custom', path: [section, name], message: 'stray brace' })
    }
  })

export type ErEventsCopy = z.output<typeof ErEventsSchema>
export const ER_EVENTS: ErEventsCopy = parseOrThrow(ErEventsSchema, erEventsJson, 'src/content/erEvents.json')

type Fields<K extends ErLineKey> = { readonly [F in (typeof ER_LINE_FIELDS)[K][number]]: string | number }

/** One ER event line with its placeholders filled. Throws when a value is missing, so a test catches it. */
export function erLine<K extends ErLineKey>(key: K, fields: Fields<K>): string {
  const [section, name] = key.split('.') as [keyof typeof SECTIONS, string]
  const bag = fields as Readonly<Record<string, string | number>>
  return (ER_EVENTS[section] as Record<string, string>)[name].replace(/\{(\w+)\}/g, (_whole, f: string) => {
    if (!Object.hasOwn(bag, f)) throw new Error(`erLine: the "${key}" line needs a value for {${f}}`)
    return String(bag[f])
  })
}

/** "observations, a cannula and bloods": the nurse's care items joined in the UK way (no Oxford comma). */
export function joinCareItems(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${ER_EVENTS.careItems.and} ${items[items.length - 1]}`
}
