/**
 * F-22: the medicines a ward-round visit may add on its own (roundAdds.json), validated with zod against the medicine catalogue. The sim makes no
 * clinical decisions: this is a short plausible list of symptomatic drugs, so the demo never shows a random apixaban or levothyroxine start.
 */
import { z } from 'zod'
import { MEDICINES } from './catalogue'
import roundAddsJson from './roundAdds.json'
import { parseOrThrow } from './schema'

export const RoundAddsSchema = z.strictObject({
  _comment: z.string().optional(),
  safe: z
    .array(z.string().min(1))
    .min(3)
    .refine((ids) => new Set(ids).size === ids.length, 'safe must not repeat a medicine'),
})

export const ROUND_ADDS: readonly string[] = parseOrThrow(RoundAddsSchema, roundAddsJson, 'src/content/roundAdds.json').safe

const ids = new Set(MEDICINES.map((m) => m.id))
for (const id of ROUND_ADDS) if (!ids.has(id)) throw new Error(`src/content/roundAdds.json lists unknown medicine "${id}"`)
