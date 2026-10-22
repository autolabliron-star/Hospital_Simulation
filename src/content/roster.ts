/**
 * Name and reason lists for synthetic people: visitors, ER arrivals and ambulance arrivals. people.json is
 * parsed with the zod schema below at module load, so bad content throws here, with the field named.
 * Everything is fictional. syntheticName() draws from these lists with a passed RNG, never Math.random.
 */
import { z } from 'zod'
import peopleJson from './people.json'
import { PresentationSchema, type Presentation } from './schema'
import { HOSTS, NIGHT_STAFF, STAFF } from './staff'

export type { Presentation } from './schema'

/** Words that make a reason graphic. Reasons must stay plain and non-graphic. */
const GRAPHIC_WORDS = /\b(blood|bleed\w*|gunshot|stab\w*|severed|amputat\w*|wounds?|gore|gory|mangled|crushed|guts)\b/i

const wordCount = (text: string): number => text.trim().split(/\s+/).length

/** Lower-case, accent-free form, so "Tomás" and "Tomas" count as the same name. */
export function normaliseName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const NameSchema = z
  .string()
  .regex(/^\p{Lu}[\p{L}'-]*$/u, 'a name is one word: a capital letter, then letters, apostrophes or hyphens')

const ReasonText = z
  .string()
  .refine((t) => t === t.trim() && wordCount(t) >= 3 && wordCount(t) <= 7, 'a reason is 3 to 7 words with no stray spaces')
  .refine((t) => !GRAPHIC_WORDS.test(t), 'reasons must be non-graphic')

/** A reason with its triage acuity: 1 is the most urgent, 5 the least. */
const reasonSchema = (maxAcuity: number) =>
  z.strictObject({
    text: ReasonText,
    acuity: z.number().int().min(1).max(maxAcuity),
  })

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const v of values) {
    if (seen.has(v)) dupes.push(v)
    seen.add(v)
  }
  return dupes
}

export const PeopleSchema = z
  .strictObject({
    firstNames: z.array(NameSchema).length(80),
    lastNames: z.array(NameSchema).length(80),
    erReasons: z.array(reasonSchema(5)).length(24),
    ambulanceReasons: z.array(reasonSchema(3)).length(8),
    visitorRelations: z.array(z.string().min(1)).length(10),
    /** W3 wave B: how each given name is drawn (a woman's body, a man's, or the seeded draw). Rendering only. */
    presentation: PresentationSchema,
  })
  .superRefine((people, ctx) => {
    const lists: Record<string, string[]> = {
      firstNames: people.firstNames.map(normaliseName),
      lastNames: people.lastNames.map(normaliseName),
      erReasons: people.erReasons.map((r) => r.text.toLowerCase()),
      ambulanceReasons: people.ambulanceReasons.map((r) => r.text.toLowerCase()),
      visitorRelations: people.visitorRelations.map((r) => r.toLowerCase()),
    }
    for (const [key, values] of Object.entries(lists)) {
      for (const dupe of duplicatesOf(values)) {
        ctx.addIssue({ code: 'custom', path: [key], message: `duplicate entry "${dupe}"` })
      }
    }
  })

const parsed = PeopleSchema.safeParse(peopleJson)
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
  throw new Error(`src/content/people.json is invalid: ${details}`)
}
const people = parsed.data

export interface Reason {
  text: string
  acuity: number
}

export const FIRST_NAMES: readonly string[] = people.firstNames
export const LAST_NAMES: readonly string[] = people.lastNames
export const ER_REASONS: readonly Reason[] = people.erReasons
export const AMBULANCE_REASONS: readonly Reason[] = people.ambulanceReasons
export const VISITOR_RELATIONS: readonly string[] = people.visitorRelations

// ---------------------------------------------------------------------------------------------
// How a person is drawn (W3 wave B): by the given name, a rendering hint with no effect on the simulation
// ---------------------------------------------------------------------------------------------

/** The given names of each presentation, as written in people.json. */
export const PRESENTATION_NAMES: Readonly<Record<Presentation, readonly string[]>> = people.presentation

const PRESENTATION_OF = new Map<string, Presentation>()
for (const kind of ['female', 'male', 'either'] as const) for (const name of people.presentation[kind]) PRESENTATION_OF.set(normaliseName(name), kind)

/** A word of a name, lower-case and accent-free, without a closing full stop ("Dr." gives "dr"). */
const wordOf = (token: string): string => normaliseName(token).replace(/\.$/, '')

/**
 * The titles a staff name starts with ("Dr.", "Nurse", "Porter", "Cleaner", "Coordinator", "Host", "Paramedic", "Pharmacist", "Radiographer",
 * "Receptionist", "Sonographer"): the first word of every staff name that has a second one, read off the staff content so a new title there
 * is known at once.
 */
export const TITLE_WORDS: ReadonlySet<string> = new Set(
  [...STAFF, ...NIGHT_STAFF, ...HOSTS].flatMap((member) => {
    const words = member.name.trim().split(/\s+/)
    return words.length > 1 ? [wordOf(words[0])] : []
  }),
)

/** The given name of somebody: the first word once any leading title is dropped ("Nurse Maya" gives "Maya", "Dr. Okafor" gives "Okafor"). */
export function givenNameOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  let i = 0
  while (i < words.length - 1 && TITLE_WORDS.has(wordOf(words[i]))) i++
  return words[i] ?? ''
}

/** How a person called `name` is drawn: a woman, a man, or `either` (a unisex name, a surname, a name nobody has listed: the seeded draw decides). */
export function presentationOf(name: string): Presentation {
  return PRESENTATION_OF.get(normaliseName(givenNameOf(name))) ?? 'either'
}

/** A fictional "First Last" name. Pass a seeded Rng so the same seed always gives the same names. */
export function syntheticName(rng: { int(min: number, max: number): number }): string {
  const first = FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)]
  const last = LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]
  return `${first} ${last}`
}

/**
 * A fictional "First Last" name whose first name is drawn from the female or the male pool (a hysterectomy or a prostatectomy patient: the
 * avatar's sex follows the first name). Always two draws, like `syntheticName`.
 */
export function syntheticNameOf(rng: { int(min: number, max: number): number }, presentation: 'female' | 'male'): string {
  const pool = PRESENTATION_NAMES[presentation]
  const first = pool[rng.int(0, pool.length - 1)]
  const last = LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]
  return `${first} ${last}`
}
