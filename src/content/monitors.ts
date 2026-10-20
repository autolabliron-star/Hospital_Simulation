/**
 * R3: the words on the live patient monitors (src/scene/monitors): bed names, wave and parameter labels, units, the standby screen and the
 * "Simulated" mark. Parsed with zod at module load, so bad content throws here with the field named. Every value on a monitor is synthetic and
 * display-only; the copy names channels and units and never judges a value (no alarm words: the monitors never alarm).
 */
import { z } from 'zod'
import raw from './monitors.json'
import { parseOrThrow } from './schema'

/** Words a monitor never shows: no alarm, no judgement of a value (the sim makes no clinical decisions). */
export const ALARM_WORDS = /\b(alarm\w*|alert\w*|warning|critical|high|low|abnormal|normal|danger\w*|asystole|arrest|v-?fib|v-?tach|apnea|apnoea|desat\w*)\b/i

/** A short label that fits a monitor's line. */
const label = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), 'one line only')
    .refine((s) => !ALARM_WORDS.test(s), 'no alarm or judgement words on a monitor')

/** The placeholders each templated line may use. */
const FIELDS: Record<string, readonly string[]> = {
  'beds.pacu': ['n'],
  'beds.preop': ['n'],
  'beds.er': ['n'],
  'beds.triage': ['n'],
  'nibp.at': ['time'],
  'nibp.auto': ['n'],
}

const MonitorsSchema = z
  .strictObject({
    simulated: label(16),
    standby: label(16),
    standbyNote: label(32),
    spotCheck: label(16),
    adult: label(8),
    beds: z.strictObject({ or: label(24), pacu: label(16), preop: label(16), er: label(16), triage: label(16), station: label(28) }),
    waves: z.strictObject({ ecg: label(6), ecgV: label(6), pleth: label(8), art: label(6), co2: label(6), resp: label(8) }),
    params: z.strictObject({
      hr: label(6),
      pr: label(6),
      spo2: label(6),
      nibp: label(6),
      art: label(6),
      co2: label(6),
      etco2: label(4),
      fico2: label(4),
      awrr: label(6),
      rr: label(6),
      temp: label(6),
    }),
    units: z.strictObject({ bpm: label(6), percent: label(2), mmHg: label(6), perMin: label(6), celsius: label(4) }),
    nibp: z.strictObject({ none: label(10), at: label(12), auto: label(16), manual: label(10) }),
    station: z.strictObject({ empty: label(16) }),
  })
  .superRefine((d, ctx) => {
    const lookup = (path: string): string => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], d) as string
    for (const [path, allowed] of Object.entries(FIELDS)) {
      const text = lookup(path)
      for (const m of text.matchAll(/\{(\w+)\}/g)) {
        if (!allowed.includes(m[1])) ctx.addIssue({ code: 'custom', path: path.split('.'), message: `unknown placeholder {${m[1]}}` })
      }
    }
  })

export const MONITORS = parseOrThrow(MonitorsSchema, raw, 'src/content/monitors.json')
export type MonitorsCopy = typeof MONITORS

/** The placeholders a templated line may use, by its path (for the tests). */
export function monitorFields(): Readonly<Record<string, readonly string[]>> {
  return FIELDS
}

/** Fill `{key}` placeholders. A key with no value is a bug, so it throws. */
export function fillMonitor(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = values[key]
    if (v === undefined) throw new Error(`monitors copy "${template}" needs {${key}}`)
    return String(v)
  })
}
