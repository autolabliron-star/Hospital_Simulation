/**
 * W4: the lab's event lines (agent L), validated with zod. The sim fills the {placeholders} when it logs an event; every line is plain
 * synthetic copy (no real names, no clinical advice). The lab only logs events for ER, outpatient, pre-scan and demo orders; the ward's
 * background samples are too many for the event feed.
 */
import { z } from 'zod'
import raw from './labCopy.json'

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')

/** The placeholders each line may use (a line must use all of them: nothing is silently dropped). */
export const LAB_COPY_FIELDS = {
  samplesReceived: ['ticket'],
  samplesReceivedNoTicket: ['name'],
  labResults: ['name', 'min'],
  demoReceived: [],
  demoResults: ['min'],
} as const

export type LabCopyKey = keyof typeof LAB_COPY_FIELDS

export const LabCopySchema = z
  .object({
    samplesReceived: line,
    samplesReceivedNoTicket: line,
    labResults: line,
    demoReceived: line,
    demoResults: line,
  })
  .strict()
  .superRefine((d, ctx) => {
    for (const key of Object.keys(LAB_COPY_FIELDS) as LabCopyKey[]) {
      const used = [...d[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      const want = [...LAB_COPY_FIELDS[key]].sort()
      if (used.join(',') !== want.join(',')) ctx.addIssue({ code: 'custom', path: [key], message: `placeholders must be exactly {${want.join('}, {')}}` })
    }
  })

export type LabCopy = z.output<typeof LabCopySchema>

export const LAB_COPY: LabCopy = LabCopySchema.parse(raw)

/** One event line with its placeholders filled. */
export function labLine(key: LabCopyKey, fields: Readonly<Record<string, string | number>> = {}): string {
  return LAB_COPY[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(fields[name] ?? ''))
}
