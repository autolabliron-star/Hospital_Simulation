/**
 * W4 (agent S3): the words of the lab panel, the lab status screens and the lab prompts. labUi.json is parsed with LabUiSchema at module
 * load, so bad content throws here with the field named. Templates use {placeholders}; `fillLab` fills them, and the tests check every
 * template against `LAB_UI_FIELDS` (a stray "{n}" on a screen would be a bug the viewer sees). Every value is synthetic.
 */
import { z } from 'zod'
import raw from './labUi.json'

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')

const STAGES = ['ordered', 'labelled', 'drawn', 'inTube', 'received', 'onTrack', 'centrifuge', 'decap', 'analysing', 'recap', 'archived'] as const
export const LAB_MODULE_IDS = ['receive', 'camera', 'cfg0', 'cfg1', 'decap', 'haem', 'chem', 'immuno', 'coag', 'recap', 'archive'] as const
export type LabModuleId = (typeof LAB_MODULE_IDS)[number]

const record = <K extends readonly [string, ...string[]]>(keys: K) => z.object(Object.fromEntries(keys.map((k) => [k, line])) as Record<K[number], typeof line>).strict()

export const LabUiSchema = z
  .object({
    simulated: line,
    intro: line,
    sections: z.object({ track: line, kpis: line, samples: line, results: line, send: line }).strict(),
    kpi: z.object({ samplesToday: line, onTrack: line, turnaround: line, sends: line }).strict(),
    units: z.object({ minutes: line, seconds: line, none: line, justNow: line, inTube: line }).strict(),
    stage: record(STAGES),
    priority: z.object({ stat: line, routine: line }).strict(),
    module: record(LAB_MODULE_IDS),
    moduleShort: record(LAB_MODULE_IDS),
    status: z.object({ idle: line, busy: line, loading: line, spinning: line, unloading: line, queue: line, full: line }).strict(),
    empty: z.object({ samples: line, results: line, track: line }).strict(),
    send: z.object({ button: line, note: line }).strict(),
    row: z.object({ result: line, resultDetail: line, sample: line, sampleDetail: line }).strict(),
    prompt: z.object({ viewpoint: line, totem: line }).strict(),
    tiles: z
      .object({
        labStatus: z.object({ title: line, samples: line, onTrack: line, tat: line, review: line, archive: line, idle: line, flight: line }).strict(),
        centrifuge: z
          .object({ title: line, idle: line, loading: line, spinning: line, unloading: line, load: line, left: line, program: z.object({ stat: line, routine: line }).strict() })
          .strict(),
        labReceive: z.object({ title: line, waiting: line, none: line, incoming: line, last: line, sent: line }).strict(),
        archive: z.object({ title: line, temp: line, count: line, racks: line }).strict(),
      })
      .strict(),
  })
  .strict()

export type LabUiCopy = z.output<typeof LabUiSchema>
export const LAB_UI: LabUiCopy = LabUiSchema.parse(raw)

/** The placeholders each template may use, as "section.key" (or "section.sub.key"). Lines not listed hold plain words. */
export const LAB_UI_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'units.minutes': ['n'],
  'units.seconds': ['n'],
  'status.spinning': ['pct'],
  'status.queue': ['n'],
  'row.result': ['name'],
  'row.resultDetail': ['panel', 'tests', 'minutes'],
  'row.sample': ['tests'],
  'row.sampleDetail': ['patient', 'tube'],
  'tiles.centrifuge.load': ['n', 'max'],
  'tiles.centrifuge.left': ['mm', 'ss'],
  'tiles.labReceive.waiting': ['n'],
  'tiles.labReceive.last': ['id'],
  'tiles.labReceive.sent': ['n'],
  'tiles.archive.count': ['n'],
  'tiles.archive.racks': ['n', 'max'],
}

/** Fill the {placeholders} of a template. A missing field stays visible as "{name}" so a test (or a glance) catches it. */
export function fillLab(template: string, fields: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => (name in fields ? String(fields[name]) : whole))
}

/** "3 min", "45 s", "just now": a duration in sim seconds as the panel says it. */
export function durationText(seconds: number): string {
  if (!(seconds >= 0)) return LAB_UI.units.none
  if (seconds < 5) return LAB_UI.units.justNow
  if (seconds < 90) return fillLab(LAB_UI.units.seconds, { n: Math.round(seconds) })
  return fillLab(LAB_UI.units.minutes, { n: Math.round(seconds / 60) })
}
