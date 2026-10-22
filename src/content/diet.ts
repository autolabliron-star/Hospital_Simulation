/**
 * Diet content (F-29): which admission reasons are kept nil by mouth, so the meal service serves no tray and the patient says nothing
 * about lunch. A stroke work-up waits for the swallow screen, a patient who is drowsy or confused cannot eat safely, a patient who is
 * vomiting or has severe abdominal pain waits for review, and a possible hip fracture fasts for theatre. The sim makes no clinical decisions:
 * this is a fixed demo list of reasons, parsed with zod at module load and cross-checked against people.json.
 * Consumers (Change request): sim/meals (no tray for a nil-by-mouth patient) and sim/reactions (no meal bark); they call `isNilByMouth(reason)`.
 */
import { z } from 'zod'
import dietJson from './diet.json'
import { AMBULANCE_REASONS, ER_REASONS } from './roster'
import { parseOrThrow } from './parse'

const oneLine = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')

export const DietSchema = z.strictObject({
  nilByMouth: z.strictObject({
    reasons: z
      .array(z.string().min(1))
      .min(1)
      .refine((list) => new Set(list).size === list.length, 'a reason is listed once'),
    /** The bedside label ("Nil by mouth") and what the patient says when asked about a meal. */
    sign: oneLine.max(24),
    bark: oneLine.max(60),
  }),
})
export type DietCopy = z.output<typeof DietSchema>

export const DIET: DietCopy = parseOrThrow(DietSchema, dietJson, 'src/content/diet.json')

const known = new Set([...ER_REASONS, ...AMBULANCE_REASONS].map((r) => r.text))
const unknown = DIET.nilByMouth.reasons.filter((r) => !known.has(r))
if (unknown.length > 0) throw new Error(`src/content/diet.json lists reasons that are not in people.json: ${unknown.join('; ')}`)

const NBM = new Set(DIET.nilByMouth.reasons)

/** Is a patient admitted for this ER or ambulance reason (people.json text) kept nil by mouth? An unknown or ward-only reason is not. */
export function isNilByMouth(reason: string): boolean {
  return NBM.has(reason)
}
