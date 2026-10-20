/**
 * S1 Smart skip: the words of the skip row, the context chip and the speed keys (src/ui/skip, the HUD). skip.json is parsed with this zod
 * schema at module load, so bad content throws here with the field named. Templates use {placeholders}, filled by `fillSkip`.
 */
import { z } from 'zod'
import json from './skip.json'

/** The surgery milestones a skip can land before, in the order the model lists them for the same time. */
export const MILESTONE_KINDS = ['docking', 'console', 'undocking', 'wheelsOut', 'pacuDischarge', 'nextWheelsIn'] as const
export type MilestoneKind = (typeof MILESTONE_KINDS)[number]

const line = z
  .string()
  .min(1)
  .max(60)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')

const milestone = z.strictObject({ name: line, caption: line })

export const SkipCopySchema = z.strictObject({
  group: line,
  stepMinutes: line,
  stepHours: line,
  stepTitle: line,
  stepTitleNoKey: line,
  chipTitle: line,
  busyTitle: line,
  keys: z.strictObject({ step: line, milestone: line }),
  speedTitle: line,
  /** The key that sets each speed, by speed ("10" is the 0 key). */
  speedKeys: z.record(z.string(), line),
  milestoneLabel: line,
  milestones: z.strictObject({
    docking: milestone,
    console: milestone,
    undocking: milestone,
    wheelsOut: milestone,
    pacuDischarge: milestone,
    nextWheelsIn: milestone,
  }),
  scan: z.strictObject({ label: line, caption: line }),
})

export type SkipCopy = z.infer<typeof SkipCopySchema>

export const SKIP: SkipCopy = SkipCopySchema.parse(json)

/** Fill `{name}` placeholders; an unknown one stays visible. */
export function fillSkip(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`))
}
