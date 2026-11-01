/**
 * R5 wave 3: every English line the imaging scanners log (src/sim/imaging/scanner.ts), moved out of the sim into scanLines.json and checked with
 * a zod schema at module load, so bad copy throws here with the key named. Templates use {placeholders}; each line allows only the placeholders
 * listed in `PLACEHOLDERS` (the sim fills them with `scanLine`). UK English, non-graphic, synthetic. The strings the old code produced are
 * the same, character for character (src/sim/imaging/cryo.test.ts and scanLines.test.ts assert them).
 */
import { z } from 'zod'
import type { ImagingModality } from '@/sim/types'
import json from './scanLines.json'

/** The line keys and the placeholders each may use. */
export const PLACEHOLDERS = {
  gettingReadyEr: ['who', 'modality', 'patient', 'protocol'],
  gettingReady: ['who', 'patient', 'protocol'],
  changing: ['patient', 'protocol'],
  screening: ['who', 'patient'],
  screeningCleared: ['patient'],
  explainCryoDemo: ['who', 'patient'],
  explainCryo: ['who', 'patient'],
  positioningCryo: ['who', 'patient'],
  positioning: ['who', 'patient', 'protocol'],
  tableIn: ['modality', 'patient'],
  tableOut: ['modality', 'patient'],
  cleanupCryo: ['who', 'patient', 'modality'],
  cleanup: ['who', 'patient', 'modality'],
  sequence: ['who', 'protocol', 'patient', 'name'],
  cryoPlace: ['who', 'patient', 'name'],
  cryoPlaceLump: ['who', 'patient', 'name'],
  cryoMove: ['who', 'patient', 'name'],
  cryoFreeze: ['who', 'patient', 'name'],
  cryoThaw: ['who', 'patient'],
  finishedCryo: ['patient'],
  finishedFreezing: ['patient'],
  finished: ['protocol', 'patient'],
  cryoChecking: ['who', 'patient'],
} as const satisfies Record<string, readonly string[]>

export type ScanLineKey = keyof typeof PLACEHOLDERS
const KEYS = Object.keys(PLACEHOLDERS) as ScanLineKey[]

/**
 * R5 fix K7: the lines a scripted ProSense case says when a STEP of its script begins (keyed by step id; the placeholders each may use). Said by the run
 * (src/sim/imaging/prosense.ts) at the moment the step starts, so the log never runs ahead of the room: the probe is "guided in" when the probe goes in,
 * not when the numbing starts.
 */
export const STEP_PLACEHOLDERS = {
  probeIn: ['who', 'patient', 'lump'],
  thawMove: ['who', 'patient'],
  thawFree: ['who', 'patient'],
  probeOut: ['who', 'patient'],
  walkOut: ['patient'],
} as const satisfies Record<string, readonly string[]>

export type StepLineKey = keyof typeof STEP_PLACEHOLDERS
const STEP_KEYS = Object.keys(STEP_PLACEHOLDERS) as StepLineKey[]

/** Words that make a line graphic (the rule of src/content/surgery.ts). */
const GRAPHIC_WORDS = /\b(blood|bleed\w*|gore|gory|wounds?|incisions?|guts|mangled|severed)\b/i
/** US spellings and words the UK copy avoids. */
const US_WORDS = /\bcenters?\b|\bcentered\b|anesth\w*|\bdiarrhea|\bgurney|\bhospitalization|\bpediatric|\bcolor\b/

const text = z
  .string()
  .min(1)
  .refine((s) => s === s.trim() && !/\s{2,}/.test(s) && !/[\r\n]/.test(s), 'one line, no stray spaces')
  .refine((s) => s.endsWith('.'), 'a log line ends with a full stop')
  .refine((s) => !GRAPHIC_WORDS.test(s), 'copy must be non-graphic')
  .refine((s) => !US_WORDS.test(s), 'UK vocabulary')

export const ScanLinesSchema = z
  .strictObject({
    modality: z.strictObject({ mri: z.string().min(1), ct: z.string().min(1), xray: z.string().min(1), us: z.string().min(1) }),
    lines: z.strictObject(Object.fromEntries(KEYS.map((k) => [k, text])) as Record<ScanLineKey, typeof text>),
    stepLines: z.strictObject(Object.fromEntries(STEP_KEYS.map((k) => [k, text])) as Record<StepLineKey, typeof text>),
  })
  .superRefine((file, ctx) => {
    for (const k of KEYS) {
      for (const [, name] of file.lines[k].matchAll(/\{(\w+)\}/g)) {
        if (!(PLACEHOLDERS[k] as readonly string[]).includes(name)) ctx.addIssue({ code: 'custom', path: ['lines', k], message: `{${name}} is not a placeholder of "${k}" (${PLACEHOLDERS[k].join(', ')})` })
      }
      if (/[{}]/.test(file.lines[k].replace(/\{\w+\}/g, ''))) ctx.addIssue({ code: 'custom', path: ['lines', k], message: 'stray brace' })
    }
    for (const k of STEP_KEYS) {
      for (const [, name] of file.stepLines[k].matchAll(/\{(\w+)\}/g)) {
        if (!(STEP_PLACEHOLDERS[k] as readonly string[]).includes(name)) ctx.addIssue({ code: 'custom', path: ['stepLines', k], message: `{${name}} is not a placeholder of "${k}" (${STEP_PLACEHOLDERS[k].join(', ')})` })
      }
      if (/[{}]/.test(file.stepLines[k].replace(/\{\w+\}/g, ''))) ctx.addIssue({ code: 'custom', path: ['stepLines', k], message: 'stray brace' })
    }
  })

const parsed = ScanLinesSchema.safeParse(json)
if (!parsed.success) {
  throw new Error(`src/content/scanLines.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
}
const FILE = parsed.data

/** The scanner's short name in a sentence ("MRI", "CT", "X-ray", "ultrasound"). */
export const MODALITY_NAME: Readonly<Record<ImagingModality, string>> = FILE.modality as Record<ImagingModality, string>

/** The template of a line (for tests and the UI). */
export function scanLineTemplate(key: ScanLineKey): string {
  return FILE.lines[key]
}

/** Fill a line's placeholders. A placeholder left out of `values` stays as written ({who}), so a typo shows. */
export function scanLine(key: ScanLineKey, values: Readonly<Record<string, string>>): string {
  return FILE.lines[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m))
}

/** The line a script step says when it begins (null: this step says nothing of its own: the room log has the script's `event` line, or none). */
export function stepLine(stepId: string, values: Readonly<Record<string, string>>): string | null {
  if (!Object.hasOwn(FILE.stepLines, stepId)) return null
  return FILE.stepLines[stepId as StepLineKey].replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m))
}

/** The template of a step line (for tests). */
export function stepLineTemplate(stepId: StepLineKey): string {
  return FILE.stepLines[stepId]
}
