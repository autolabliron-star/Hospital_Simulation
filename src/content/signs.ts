/**
 * Wayfinding copy (W1 walk-in): the words on the hanging signs and the door plates. signs.json is parsed with the zod schema
 * below at module load, so bad content throws here with the file and the field named. The building draws every word from here
 * (src/scene/building/render/walk/signAtlas.ts); no sign or plate has copy of its own. Cross-checks against the layout (every
 * sign's destinations have words, every plate names a real door) live in signs.test.ts, so this module stays free of the layout.
 *
 * Kept apart from schema.ts on purpose: it has its own owner.
 */
import { z } from 'zod'
import signsJson from './signs.json'

/** The colour chip of a destination: the same names as the floor wayfinding lines (`WAYFINDING` in src/scene/materials.ts), or none. */
export const SIGN_ACCENTS = ['wardA', 'wardB', 'emergency', 'atrium', 'diagnostics', 'neutral'] as const
export type SignAccent = (typeof SIGN_ACCENTS)[number]

/** Longest words that still fit a sign row and a plate at a readable size. */
export const MAX_LABEL = 22
export const MAX_DETAIL = 34
export const MAX_TITLE = 26

const Text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max, `at most ${max} characters, so it fits the sign`)
    .refine((t) => t === t.trim() && !/\s{2,}/.test(t), 'no stray spaces')

const DestinationSchema = z.strictObject({
  label: Text(MAX_LABEL),
  detail: Text(MAX_DETAIL).optional(),
  accent: z.enum(SIGN_ACCENTS),
})

const SignSchema = z.strictObject({ title: Text(MAX_TITLE) })

const PlateSchema = z.strictObject({ label: Text(MAX_LABEL), sub: Text(MAX_LABEL).optional() })

export const SignsSchema = z.strictObject({
  /** Words per area a sign can point to (keyed by the area id of `SIGNS[].points`). */
  destinations: z.record(z.string().min(1), DestinationSchema),
  /** A small title per hanging sign (keyed by the sign id of `SIGNS`). */
  signs: z.record(z.string().min(1), SignSchema),
  plates: z.strictObject({
    /** The patient-room plate: this caption over the room id ("Room" over "A3"). */
    room: z.strictObject({ caption: Text(MAX_LABEL) }),
    /** Name plates by door id (src/sim/places.ts DOORS). */
    doors: z.record(z.string().min(1), PlateSchema),
  }),
})

export type SignsContent = z.output<typeof SignsSchema>
export type DestinationCopy = SignsContent['destinations'][string]
export type PlateCopy = SignsContent['plates']['doors'][string]

function parse(data: unknown): SignsContent {
  const result = SignsSchema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new Error(`src/content/signs.json is invalid: ${details}`)
  }
  return result.data
}

export const SIGNS_CONTENT: SignsContent = parse(signsJson)

const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined)

/** The words a sign row shows for an area it points to. */
export function destinationCopy(areaId: string): DestinationCopy | undefined {
  return own(SIGNS_CONTENT.destinations, areaId)
}

/** The small title of a hanging sign. */
export function signTitle(signId: string): string | undefined {
  return own(SIGNS_CONTENT.signs, signId)?.title
}

/** The name on the plate beside a door, or undefined when the door has none. */
export function doorPlateCopy(doorId: string): PlateCopy | undefined {
  return own(SIGNS_CONTENT.plates.doors, doorId)
}

/** The caption over a patient room's number on its plate. */
export const ROOM_PLATE_CAPTION = SIGNS_CONTENT.plates.room.caption
