/**
 * The words of the "Go to…" menu (F-33): group titles, the fixed rooms' labels and second lines, and the UK spellings that replace the
 * layout's own words for an area (places.ts now says "Robotic theatre" and "Command centre" too).
 * goTo.json is parsed with zod at module load. Ward rooms are named by their live occupant in src/ui/goToModel.ts, so they have no words here.
 */
import { z } from 'zod'
import goToJson from './goTo.json'
import { parseOrThrow } from './parse'

/** The menu groups, in reading order (the ward groups' items are built from the beds). */
export const GO_TO_GROUP_IDS = ['imaging', 'bloodLab', 'wardA', 'wardB', 'pharmacy', 'emergency', 'triage', 'entrance', 'atrium', 'command', 'hubs'] as const
export type GoToGroupWord = (typeof GO_TO_GROUP_IDS)[number]

const text = z
  .string()
  .min(1)
  .refine((s) => s === s.trim() && !/[\r\n]/.test(s), 'one line, no stray spaces')
const words = z.strictObject({ label: text, detail: text })

export const GoToCopySchema = z.strictObject({
  groups: z.strictObject(Object.fromEntries(GO_TO_GROUP_IDS.map((id) => [id, text])) as Record<GoToGroupWord, typeof text>),
  items: z.record(z.string().min(1), words),
  areaWords: z.record(z.string().min(1), words),
})

export type GoToCopy = z.output<typeof GoToCopySchema>
export const GO_TO_COPY: GoToCopy = parseOrThrow(GoToCopySchema, goToJson, 'src/content/goTo.json')
