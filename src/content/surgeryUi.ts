/**
 * R2 (agent Copy): the words of the robotic surgery suite's screens: the level switch and the lift, the teaching console, the OR, PACU and
 * pre-op panels, the prompts and the go-to group. surgeryUi.json is parsed with the zod schema below at module load, so bad content throws
 * here with the field named. Templates use {placeholders}; `fillSurgery` fills them, and SURGERY_UI_FIELDS says which placeholders each line
 * may use (the tests check every template against it). Every value is synthetic. "Simulated" is on the console and the panels, and the
 * endoscope view and its words stay non-graphic.
 */
import { z } from 'zod'
import surgeryUiJson from './surgeryUi.json'

const GRAPHIC_WORDS = /\b(blood|bleed\w*|gore|gory|wounds?|incisions?|guts)\b/i

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')
  .refine((s) => !GRAPHIC_WORDS.test(s), 'copy must be non-graphic')

export const SurgeryUiSchema = z.strictObject({
  level: z.strictObject({ one: line, two: line, oneCaption: line, twoCaption: line, aria: line }),
  lift: z.strictObject({ toTwo: line, toOne: line, coverTwo: line, coverOne: line, noLevel3: line }),
  console: z.strictObject({
    title: line,
    subtitle: line,
    prompt: line,
    endoscope: line,
    procedure: line,
    phase: line,
    clock: line,
    arms: line,
    arm: line,
    force: line,
    insufflation: line,
    mmHg: line,
    standby: line,
    standbyNone: line,
    leave: line,
  }),
  panel: z.strictObject({
    tag: line,
    note: line,
    room: line,
    list: line,
    phase: line,
    robot: line,
    team: line,
    watch: line,
    kpi: z.strictObject({ firstOnTime: line, docking: line, console: line, turnover: line, recovery: line, utilisation: line }),
    kpiValue: z.strictObject({ yes: line, no: line, notYet: line, minutes: line, percent: line }),
    empty: z.strictObject({ list: line, room: line }),
    pacu: z.strictObject({ title: line, empty: line, bay: line }),
    preOp: z.strictObject({ title: line, empty: line, bay: line }),
  }),
  prompts: z.strictObject({ viewingWindow: line, preOpDesk: line, pacuIsland: line }),
  goTo: z.strictObject({ group: line }),
  /** The anaesthesia monitor's channel glyphs (synthetic traces; drawn on the theatre screens). */
  monitor: z.strictObject({ hr: line, spo2: line, rr: line, bp: line }),
})

export type SurgeryUiCopy = z.output<typeof SurgeryUiSchema>
export const SURGERY_UI: SurgeryUiCopy = SurgeryUiSchema.parse(surgeryUiJson)

/** The placeholders each template may use, as "section.key" (or "section.sub.key"). Lines not listed hold plain words. */
export const SURGERY_UI_FIELDS = {
  'console.arm': ['arm'],
  'console.standby': ['procedure', 'time'],
  'panel.kpiValue.minutes': ['n'],
  'panel.kpiValue.percent': ['n'],
  'panel.pacu.bay': ['n'],
  'panel.preOp.bay': ['n'],
} as const satisfies Record<string, readonly string[]>

/** Fill the {placeholders} of a template. A missing field stays visible as "{name}" so a test (or a glance) catches it. */
export function fillSurgery(template: string, fields: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => (name in fields ? String(fields[name]) : whole))
}
