/**
 * F-24: how the vital signs of an ER or ambulance patient differ from the age baseline, by reason (erVitals.json). Display data only: the
 * sim never branches on a value. Every reason of people.json has an entry (an empty one means "normal for the age"), so a new reason
 * cannot be added without saying what its monitor shows. The model clamps the result to its limits (SpO2 never above 100).
 */
import { z } from 'zod'
import erVitalsJson from './erVitals.json'
import { AMBULANCE_REASONS, ER_REASONS } from './roster'
import { parseOrThrow } from './schema'

/** One reason's shifts: mmHg, beats a minute, percentage points of SpO2 and degrees Celsius. Every field is optional. */
export const VitalsShiftSchema = z.strictObject({
  sys: z.number().min(-60).max(60).optional(),
  dia: z.number().min(-40).max(40).optional(),
  pulse: z.number().min(-20).max(50).optional(),
  spo2: z.number().min(-20).max(0).optional(),
  tempC: z.number().min(-2).max(3).optional(),
})
export type VitalsShift = z.infer<typeof VitalsShiftSchema>

export const ErVitalsSchema = z.strictObject({
  _comment: z.string().optional(),
  shifts: z.record(z.string().min(1), VitalsShiftSchema),
})

export const ER_VITALS: Readonly<Record<string, VitalsShift>> = parseOrThrow(ErVitalsSchema, erVitalsJson, 'src/content/erVitals.json').shifts

const problems: string[] = []
const known = new Set([...ER_REASONS, ...AMBULANCE_REASONS].map((r) => r.text))
for (const reason of known) if (!(reason in ER_VITALS)) problems.push(`no vitals shift for the reason "${reason}"`)
for (const reason of Object.keys(ER_VITALS)) if (!known.has(reason)) problems.push(`erVitals.json lists "${reason}", which is not a reason in people.json`)
if (problems.length > 0) throw new Error(`src/content/erVitals.json does not match people.json: ${problems.join('; ')}`)

/** The shifts of a reason, or null for a text the content does not know (a walk-up, a made-up reason). */
export function erVitalsShiftFor(reason: string): VitalsShift | null {
  return ER_VITALS[reason] ?? null
}
