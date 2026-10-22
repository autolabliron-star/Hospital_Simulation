/**
 * Imaging content for the R1 suite: the scan protocols, the ER reason to test mapping and the scheduled
 * outpatients. imaging.json and outpatients.json are parsed with the zod schemas below at module load, then
 * cross-checked against people.json (every reason has a test, no ER patient is sent to MRI). Bad content throws
 * here, with the file and field named. Everything is synthetic; the sim makes no clinical decisions.
 */
import { z } from 'zod'
import type { BodyPart, ImagingModality, ScanContrast, ScanPlane, ScanSequence } from '@/sim/types'
import imagingJson from './imaging.json'
import outpatientsJson from './outpatients.json'
import { LAB_CATALOGUE } from './lab'
import { AMBULANCE_REASONS, ER_REASONS } from './roster'

/** One exam: an ordered list of sequences on one scanner. */
export interface Protocol {
  id: string
  modality: ImagingModality
  bodyPart: BodyPart
  /** Human name, e.g. "MRI lumbar spine". */
  name: string
  sequences: ScanSequence[]
}

/**
 * The tests a complaint gets (Wave 1): a bundle drawn together with probability `chance` (1 for a red flag: always). The ER nurse does the
 * bloods (a lab panel id) and the ECG at the bedside; the doctor orders the imaging protocol (never MRI) after the assessment.
 */
export interface ErTest {
  chance: number
  redFlag: boolean
  bloods: string | null
  ecg: boolean
  imaging: string | null
  /** F-27: a chest pain gets its ECG at triage (or in the waiting area), not only at the bay: the nurse records it within minutes of arrival. */
  triageEcg?: boolean
}

/** Does the bundle hold any test at all? */
export function hasTests(t: ErTest): boolean {
  return t.bloods !== null || t.ecg || t.imaging !== null
}

/** A booked outpatient scan. `time` is 24-hour HH:MM on the sim day. */
export interface Outpatient {
  id: string
  name: string
  age: number
  time: string
  protocol: string
  reason: string
}

// Each Record lists every member, so the compiler rejects a missing or extra value (the same trick as schema.ts).
const MODALITY_CHECK: Record<ImagingModality, true> = { mri: true, ct: true, xray: true, us: true }
const BODY_PART_CHECK: Record<BodyPart, true> = {
  brain: true,
  head: true,
  lumbarSpine: true,
  cervicalSpine: true,
  knee: true,
  chest: true,
  abdomen: true,
  pelvis: true,
  ankle: true,
  wrist: true,
  neck: true,
  kidneys: true,
}
const PLANE_CHECK: Record<ScanPlane, true> = {
  axial: true,
  sagittal: true,
  coronal: true,
  projection: true,
  sweep: true,
  scout: true,
}
const CONTRAST_CHECK: Record<ScanContrast, true> = {
  T1: true,
  T2: true,
  FLAIR: true,
  DWI: true,
  PD: true,
  STIR: true,
  plain: true,
  arterial: true,
  portal: true,
  none: true,
}

const enumOf = <T extends string>(check: Record<T, true>) => z.enum(Object.keys(check) as [T, ...T[]])

/** The same graphic-word rule as roster.ts: outpatient reasons stay plain and non-graphic. */
const GRAPHIC_WORDS = /\b(blood|bleed\w*|gunshot|stab\w*|severed|amputat\w*|wounds?|gore|gory|mangled|crushed|guts)\b/i

const ReasonText = z
  .string()
  .refine((t) => t === t.trim() && t.split(/\s+/).length >= 3 && t.split(/\s+/).length <= 7, 'a reason is 3 to 7 words with no stray spaces')
  .refine((t) => !GRAPHIC_WORDS.test(t), 'reasons must be non-graphic')

/**
 * Sim clock in minutes after midnight. The outpatient window is 07:45 to 17:00 (Wave 1: the afternoon slots; it ends with
 * CONFIG.day.outpatientHours); the sim day starts at 07:30.
 */
const WINDOW_START = 7 * 60 + 45
const WINDOW_END = 17 * 60
const DAY_START = 7 * 60 + 30

function clockMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

export const ScanSequenceSchema: z.ZodType<ScanSequence> = z.strictObject({
  name: z.string().min(1),
  plane: enumOf(PLANE_CHECK),
  contrast: enumOf(CONTRAST_CHECK),
  seconds: z.number().positive(),
  images: z.number().int().min(1),
})

export const ProtocolSchema: z.ZodType<Protocol> = z.strictObject({
  id: z.string().regex(/^[a-z]+-[a-z]+$/, 'id looks like mri-brain'),
  modality: enumOf(MODALITY_CHECK),
  bodyPart: enumOf(BODY_PART_CHECK),
  name: z.string().min(1),
  sequences: z.array(ScanSequenceSchema).min(1),
})

const ErTestInput = z.strictObject({
  chance: z.number().min(0).max(1),
  redFlag: z.boolean().default(false),
  bloods: z.string().min(1).nullable().default(null),
  ecg: z.boolean().default(false),
  imaging: z.string().min(1).nullable().default(null),
  triageEcg: z.boolean().optional(),
})

export const ErTestSchema: z.ZodType<ErTest, z.input<typeof ErTestInput>> = ErTestInput.superRefine((t, ctx) => {
  if (t.redFlag && t.chance !== 1) ctx.addIssue({ code: 'custom', message: 'a red flag always gets its tests (chance 1)' })
  if (t.redFlag && !(t.bloods !== null || t.ecg || t.imaging !== null)) ctx.addIssue({ code: 'custom', message: 'a red flag has at least one test' })
  if (t.chance > 0 && !(t.bloods !== null || t.ecg || t.imaging !== null)) ctx.addIssue({ code: 'custom', message: 'a chance above 0 needs a test' })
  if (t.triageEcg === true && !(t.ecg && t.chance === 1)) ctx.addIssue({ code: 'custom', message: 'an ECG at triage needs the ECG test, and chance 1' })
})

export const OutpatientSchema: z.ZodType<Outpatient> = z.strictObject({
  id: z.string().regex(/^op-\d{2}$/, 'id looks like op-01'),
  name: z.string().regex(/^\p{Lu}[\p{L}'-]*( \p{Lu}[\p{L}'-]*)+$/u, 'a name is First Last, each word capitalised'),
  age: z.number().int().min(18).max(88),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time is HH:MM, 24-hour'),
  protocol: z.string().min(1),
  reason: ReasonText,
})

const ImagingFileSchema = z
  .strictObject({
    protocols: z.record(z.string().min(1), ProtocolSchema),
    erTests: z.record(z.string().min(1), ErTestSchema),
  })
  .superRefine((file, ctx) => {
    for (const [key, protocol] of Object.entries(file.protocols)) {
      if (protocol.id !== key) {
        ctx.addIssue({ code: 'custom', path: ['protocols', key, 'id'], message: `must equal its key "${key}"` })
      }
    }
  })

const OutpatientsSchema = z
  .array(OutpatientSchema)
  .length(64)
  .superRefine((list, ctx) => {
    const ids = new Set<string>()
    let previous = -1
    list.forEach((o, i) => {
      if (ids.has(o.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate outpatient id "${o.id}"` })
      ids.add(o.id)
      const minutes = clockMinutes(o.time)
      if (minutes < WINDOW_START || minutes > WINDOW_END) {
        ctx.addIssue({ code: 'custom', path: [i, 'time'], message: `${o.time} is outside the 07:45 to 17:00 window` })
      }
      if (minutes < previous) ctx.addIssue({ code: 'custom', path: [i, 'time'], message: 'outpatients must be sorted by time' })
      previous = minutes
    })
  })

function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown, source: string): z.output<T> {
  const result = schema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new Error(`${source} is invalid: ${details}`)
  }
  return result.data as z.output<T>
}

/** Every reason has a test, every test names a real protocol, and no ER reason is sent to MRI. */
function crossCheck(erTests: Record<string, ErTest>, protocols: Record<string, Protocol>, outpatients: Outpatient[]): string[] {
  const problems: string[] = []
  const reasons = [...ER_REASONS, ...AMBULANCE_REASONS].map((r) => r.text)
  const reasonSet = new Set(reasons)
  for (const text of reasons) {
    if (!Object.hasOwn(erTests, text)) problems.push(`erTests has no entry for the reason "${text}"`)
  }
  for (const key of Object.keys(erTests)) {
    if (!reasonSet.has(key)) problems.push(`erTests entry "${key}" matches no reason in people.json`)
  }
  for (const [reason, test] of Object.entries(erTests)) {
    if (test.bloods !== null && !Object.hasOwn(LAB_CATALOGUE.panels, test.bloods)) problems.push(`erTests "${reason}" uses unknown lab panel "${test.bloods}"`)
    if (test.imaging === null) continue
    if (!Object.hasOwn(protocols, test.imaging)) {
      problems.push(`erTests "${reason}" uses unknown protocol "${test.imaging}"`)
    } else if (protocols[test.imaging].modality === 'mri') {
      problems.push(`erTests "${reason}" books an MRI, and ER patients never get MRI`)
    }
  }
  for (const o of outpatients) {
    if (!Object.hasOwn(protocols, o.protocol)) problems.push(`outpatient ${o.id} uses unknown protocol "${o.protocol}"`)
  }
  return problems
}

const imaging = parseOrThrow(ImagingFileSchema, imagingJson, 'src/content/imaging.json')
const outpatients = parseOrThrow(OutpatientsSchema, outpatientsJson, 'src/content/outpatients.json')

const problems = crossCheck(imaging.erTests, imaging.protocols, outpatients)
if (problems.length > 0) {
  throw new Error(`Imaging content does not match people.json or the protocols: ${problems.join('; ')}`)
}

/** Every imaging protocol, keyed by id. */
export const PROTOCOLS: Record<string, Protocol> = imaging.protocols

const ER_TEST_BY_REASON = new Map<string, ErTest>(Object.entries(imaging.erTests))

/** The protocol with this id. Throws on an unknown id. */
export function protocolById(id: string): Protocol {
  if (!Object.hasOwn(PROTOCOLS, id)) throw new Error(`Unknown imaging protocol id "${id}"`)
  return PROTOCOLS[id]
}

/** The test for an ER or ambulance reason, exactly as written in people.json. Throws on an unknown reason. */
export function testForReason(text: string): ErTest {
  const test = ER_TEST_BY_REASON.get(text)
  if (!test) throw new Error(`No imaging test is mapped for reason "${text}"`)
  return test
}

/** The booked outpatients, sorted by time. */
export const OUTPATIENTS: Outpatient[] = outpatients

/** Sim seconds since 07:30, the start of the day. */
export function outpatientTimeSeconds(o: Outpatient): number {
  return (clockMinutes(o.time) - DAY_START) * 60
}
