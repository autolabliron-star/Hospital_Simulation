/**
 * W4: the event-line copy of the entrance health kiosks (src/sim/vitals), validated with zod at module load. Values only: a line states the
 * numbers that were measured and never judges them (the sim makes no clinical decisions). Owned by agent V.
 */
import { z } from 'zod'
import raw from './vitalsCopy.json'
import { parseOrThrow } from './schema'

/** The placeholders each line may use. A line with another `{word}` is rejected when the file loads. */
const ALLOWED: Record<string, readonly string[]> = {
  er: ['name', 'sys', 'dia', 'spo2'],
  walkUp: ['name', 'kiosk', 'sys', 'dia', 'spo2', 'bmi'],
  player: ['sys', 'dia', 'spo2', 'bmi'],
  earlyWithBp: ['name', 'sys', 'dia'],
  early: ['name'],
  guide: ['guide', 'name', 'kiosk'],
}

/** Words that would make a line a judgement of a value. Copy states numbers only. */
export const JUDGEMENT_WORDS = /\b(normal|abnormal|high|low|elevated|healthy|unhealthy|good|bad|risk\w*|danger\w*|concern\w*|diagnos\w*|hypertens\w*|obese|overweight|worrying|alarming)\b/i

const Line = z.string().min(8).max(130)

const HealthCheckSchema = z.strictObject({
  /** An ER walk-in who used a kiosk while waiting for triage ('vitals' session). */
  er: Line,
  /** A walk-up visitor's full session. */
  walkUp: Line,
  /** Your own session. */
  player: Line,
  /** A session cut short after at least one cuff reading, and one cut short before it. */
  earlyWithBp: Line,
  early: Line,
  /** The guide goes to help somebody. */
  guide: Line,
})

const VitalsCopySchema = z
  .strictObject({ healthCheck: HealthCheckSchema })
  .superRefine((d, ctx) => {
    for (const [key, text] of Object.entries(d.healthCheck)) {
      const allowed = ALLOWED[key] ?? []
      for (const m of text.matchAll(/\{(\w+)\}/g)) {
        if (!allowed.includes(m[1])) ctx.addIssue({ code: 'custom', path: ['healthCheck', key], message: `unknown placeholder {${m[1]}}` })
      }
      if (/[—–]/.test(text)) ctx.addIssue({ code: 'custom', path: ['healthCheck', key], message: 'no dashes in event lines' })
      if (JUDGEMENT_WORDS.test(text)) ctx.addIssue({ code: 'custom', path: ['healthCheck', key], message: 'a line states values only, never a judgement' })
      if (!/[.]$/.test(text)) ctx.addIssue({ code: 'custom', path: ['healthCheck', key], message: 'a line is one sentence ending with a full stop' })
    }
  })

export const VITALS_COPY = parseOrThrow(VitalsCopySchema, raw, 'src/content/vitalsCopy.json')
export type HealthCheckLine = keyof typeof VITALS_COPY.healthCheck

/** The placeholders a line may use (for tests and the sim). */
export function placeholdersOf(line: HealthCheckLine): readonly string[] {
  return ALLOWED[line]
}

/** Fill a line: every `{key}` takes its value. A key with no value is a bug, so it throws. */
export function renderLine(line: HealthCheckLine, values: Record<string, string | number>): string {
  return VITALS_COPY.healthCheck[line].replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = values[key]
    if (v === undefined) throw new Error(`vitalsCopy "${line}" needs {${key}}`)
    return String(v)
  })
}
