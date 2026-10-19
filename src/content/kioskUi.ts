/**
 * W4: the words of the entrance health kiosks' screens, the E prompts, your health card and the lobby panel's kiosk section, validated with zod at module
 * load (bad content throws here with the field named). Templates use {placeholders}; `fillUi` fills them and throws for a missing value, so a stray
 * "{n}" can never reach the glass. Values are styled outside their usual range by COLOUR only (`inRange`): no line ever judges a number, and every
 * screen says "Simulated".
 */
import { z } from 'zod'
import type { HealthKioskPhase } from '@/sim/types'
import raw from './kioskUi.json'
import { parseOrThrow } from './schema'

const text = z.string().min(1).max(80)
const line = text.refine((s) => !/[\r\n]/.test(s), 'one line only')
const Pair = z.tuple([z.number(), z.number()]).refine(([lo, hi]) => lo < hi, 'low must be below high')

const Step = z.strictObject({ title: line, hint: line })
const Field = z.strictObject({ label: line, unit: z.string().max(12), decimals: z.number().int().min(0).max(2) })

/** Every phase, as keys of a Record, so the compiler rejects a missing or extra one (the same trick as schema.ts). */
const PHASE_CHECK: Record<HealthKioskPhase, true> = {
  idle: true,
  calling: true,
  login: true,
  height: true,
  weight: true,
  bodyFat: true,
  sit: true,
  spo2: true,
  bp: true,
  bpRest: true,
  temp: true,
  report: true,
}
export const PHASES = Object.keys(PHASE_CHECK) as HealthKioskPhase[]

const StepsSchema = z.strictObject({
  idle: Step,
  calling: Step,
  login: Step,
  height: Step,
  weight: Step,
  bodyFat: Step,
  sit: Step,
  spo2: Step,
  bp: Step,
  bpRest: Step,
  temp: Step,
  report: Step,
})

export const FIELD_KEYS = ['height', 'weight', 'bmi', 'bodyFat', 'spo2', 'pulse', 'bp', 'temp'] as const
export type FieldKey = (typeof FIELD_KEYS)[number]

export const RANGE_KEYS = ['bmi', 'bodyFat', 'spo2', 'pulse', 'sys', 'dia', 'temp'] as const
export type RangeKey = (typeof RANGE_KEYS)[number]

export const KioskUiSchema = z.strictObject({
  disclaimer: line,
  footer: line,
  prompt: z.strictObject({ use: line, inUse: line, leave: line, closeReport: line, busyToast: line }),
  steps: StepsSchema,
  fields: z.strictObject({
    height: Field,
    weight: Field,
    bmi: Field,
    bodyFat: Field,
    spo2: Field,
    pulse: Field,
    bp: Field,
    temp: Field,
  }),
  pending: line,
  ranges: z.strictObject({ bmi: Pair, bodyFat: Pair, spo2: Pair, pulse: Pair, sys: Pair, dia: Pair, temp: Pair }),
  bpScreen: z.strictObject({ title: line, reading: line, sys: line, dia: line, pulse: line, unit: line, cuff: line, free: line, freeHint: line, waiting: line }),
  triageScreen: z.strictObject({
    title: line,
    columns: z.strictObject({ name: line, bp: line, spo2: line, temp: line }),
    empty: line,
    more: line,
    footer: line,
  }),
  card: z.strictObject({ title: line, step: line, close: line, closeTitle: line, doneTitle: line, sent: line, stopped: line, bpRound: line, slipFooter: line }),
  section: z.strictObject({
    title: line,
    kiosk: line,
    free: line,
    using: line,
    last: line,
    noLast: line,
    today: line,
    assisted: line,
    bpSummary: line,
    spo2Summary: line,
    tempSummary: line,
  }),
})

/** The placeholders each template may use, by dotted path. Every other line holds plain words. */
export const UI_FIELDS: Record<string, readonly string[]> = {
  'prompt.use': ['n'],
  'prompt.inUse': ['n'],
  'prompt.leave': ['n'],
  'bpScreen.reading': ['n'],
  'triageScreen.more': ['n'],
  'card.step': ['title'],
  'card.bpRound': ['n'],
  'section.kiosk': ['n'],
  'section.using': ['name', 'step'],
  'section.last': ['summary'],
  'section.today': ['n'],
  'section.bpSummary': ['sys', 'dia'],
  'section.spo2Summary': ['spo2'],
  'section.tempSummary': ['temp'],
}

export const KIOSK_UI = parseOrThrow(KioskUiSchema, raw, 'src/content/kioskUi.json')
export type KioskUi = typeof KIOSK_UI

/** Fill a template: every `{key}` takes its value. A key with no value is a bug, so it throws. */
export function fillUi(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = values[key]
    if (v === undefined) throw new Error(`kioskUi: "${template}" needs {${key}}`)
    return String(v)
  })
}

/** Title and hint of a phase. */
export function stepOf(phase: HealthKioskPhase): { title: string; hint: string } {
  return KIOSK_UI.steps[phase]
}

/** A measured value as the screens write it ("71.4", "172", "—" while it has not been measured). */
export function formatValue(key: FieldKey, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return KIOSK_UI.pending
  return v.toFixed(KIOSK_UI.fields[key].decimals)
}

/** Is a value inside its usual range (content `ranges`)? A value that has not been measured is "in range" (nothing to style). Display only: the sim never reads this. */
export function inRange(key: RangeKey, v: number | null | undefined): boolean {
  if (v === null || v === undefined || !Number.isFinite(v)) return true
  const [lo, hi] = KIOSK_UI.ranges[key]
  return v >= lo && v <= hi
}
