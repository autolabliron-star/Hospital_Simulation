/**
 * The patient record's content (the bedside tablet's "Record" tab): allergens and their reactions, chronic conditions with the catalogue medicines
 * that treat them, past procedures (sex and age appropriate), social history, immunisations, and one stay template per reason for admission (how
 * the patient arrived, the tests and their summaries, the working diagnosis, the plan and the ward round note). patientHistory.json is parsed with
 * PatientHistorySchema at module load and cross-checked against the medicine catalogue and the pharmacist's allergy classes, so bad content throws
 * here with the field named.
 *
 * Synthetic demo content, written to be conservative: nothing here makes a clinical decision. src/sim/records draws one history per patient from a
 * hash of their id and name (never Math.random), and the only use outside the record is the pharmacist's allergy query on the presenter's orders.
 */
import { z } from 'zod'
import { medicineById } from './catalogue'
import { parseOrThrow } from './parse'
import { allergyClass } from './pharmacistQueries'
import historyJson from './patientHistory.json'

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')
const weight = z.number().positive()
const severity = z.enum(['mild', 'moderate', 'severe'])
const reactionType = z.enum(['allergy', 'intolerance'])
const kind = z.enum(['drug', 'food', 'other'])
const ageBand = z.object({ maxAge: z.number().int().min(0), weights: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)]) }).strict()
const optionsBand = z.object({ maxAge: z.number().int().min(0), options: z.array(line).min(1) }).strict()

const ReactionSchema = z.object({ type: reactionType, text: line, severity, weight }).strict()
const AllergenSchema = z
  .object({ id: z.string().min(1), agent: line, kind, classId: z.string().min(1).nullable(), weight, reactions: z.array(ReactionSchema).min(1) })
  .strict()
const ConditionSchema = z
  .object({
    id: z.string().min(1),
    name: line,
    minAge: z.number().int().min(0),
    maxAge: z.number().int().min(0).optional(),
    meds: z.array(z.string().min(1)),
    /** Weight in the random draw of background conditions (0: only when the reason or the ward chart calls for it). */
    random: z.number().min(0),
    /** A different random weight for women (hypothyroidism, osteoporosis). */
    femaleRandom: z.number().min(0).optional(),
    /** Drawn at random only for current or ex-smokers. */
    smokers: z.boolean().optional(),
    /** Never drawn at random for a patient whose ward chart has one of these medicines (asthma with a beta-blocker). */
    avoidWith: z.array(z.string().min(1)).optional(),
  })
  .strict()
const ProcedureSchema = z
  .object({
    id: z.string().min(1),
    name: line,
    sex: z.enum(['female', 'male']).optional(),
    side: z.boolean().optional(),
    ageAt: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    weight,
    requires: z.array(z.string().min(1)).optional(),
  })
  .strict()
const TestSchema = z
  .object({
    kind: z.enum(['bloods', 'imaging', 'ecg', 'micro', 'other']),
    name: line,
    summary: line,
    /** Day of stay it was done (default 1, the admission day). */
    day: z.number().int().min(1).optional(),
    review: z.boolean().optional(),
  })
  .strict()
const ObsShiftSchema = z
  .object({
    tempC: z.number().optional(),
    pulse: z.number().optional(),
    rr: z.number().optional(),
    spo2: z.number().optional(),
    sys: z.number().optional(),
    /** Days on supplemental oxygen from admission. */
    o2Days: z.number().int().min(0).optional(),
    acvpu: z.enum(['A', 'C', 'V', 'P', 'U']).optional(),
  })
  .strict()
const StaySchema = z
  .object({
    id: z.string().min(1),
    /** Lower-case words looked for in the reason for the stay; the first template that matches (and fits the age) wins. Empty: the fallback. */
    match: z.array(z.string().min(1)),
    maxAge: z.number().int().optional(),
    team: line,
    route: z.enum(['er', 'ambulance', 'gp', 'elective', 'clinic']),
    triage: z.number().int().min(1).max(5).nullable(),
    arrival: line,
    diagnosis: line,
    procedure: z.object({ name: line, day: z.number().int().min(1), note: line }).strict().optional(),
    tests: z.array(TestSchema),
    problems: z.array(line).min(1),
    plan: z.array(line).min(1),
    round: line,
    pending: z.array(line).optional(),
    obs: ObsShiftSchema,
    conditions: z.array(z.string().min(1)).optional(),
    falls: z.boolean().optional(),
    mobility: line.optional(),
    excludesPast: z.array(z.string().min(1)).optional(),
    allergy: z.object({ agent: line, kind, type: reactionType, reaction: line, severity }).strict().optional(),
  })
  .strict()

export const PatientHistorySchema = z
  .object({
    _comment: z.string().optional(),
    demoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    mrn: z.object({ prefix: z.string().regex(/^[A-Z]{2,5}$/), label: line }).strict(),
    allergyChance: z.number().min(0).max(1),
    secondAllergyChance: z.number().min(0).max(1),
    allergens: z.array(AllergenSchema).min(1),
    pinnedAllergies: z.record(z.string(), z.array(z.object({ allergen: z.string().min(1), reaction: z.number().int().min(0) }).strict())),
    conditions: z.array(ConditionSchema).min(1),
    conditionCount: z.array(ageBand).min(1),
    chronicMeds: z.array(z.object({ med: z.string().min(1), anyOf: z.array(z.string().min(1)).min(1) }).strict()),
    procedures: z.array(ProcedureSchema).min(1),
    procedureCount: z.array(ageBand).min(1),
    sides: z.array(line).min(1),
    social: z
      .object({
        smoking: z.array(z.object({ kind: z.enum(['never', 'ex', 'current']), text: line, weight }).strict()).min(1),
        alcohol: z.array(z.object({ text: line, weight }).strict()).min(1),
        living: z.array(optionsBand).min(1),
        mobility: z.array(optionsBand).min(1),
      })
      .strict(),
    immunisations: z
      .array(
        z
          .object({
            name: line,
            fromAge: z.number().int().min(0),
            chance: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
            olderFrom: z.number().int().min(0),
            given: line,
            missing: line,
          })
          .strict(),
      )
      .min(1),
    codeStatus: z.object({ full: line, dnacpr: line, dnacprFromAge: z.number().int(), dnacprChance: z.number().min(0).max(1) }).strict(),
    isolation: z.object({ none: line, chance: z.number().min(0).max(1), flag: line }).strict(),
    falls: z.object({ high: line, moderate: line, low: line, highFromAge: z.number().int(), moderateFromAge: z.number().int() }).strict(),
    routes: z.object({ er: line, ambulance: line, gp: line, elective: line, clinic: line }).strict(),
    triageLabels: z.array(z.string()).length(6),
    stays: z.array(StaySchema).min(1),
    text: z.record(z.string(), line),
    ui: z
      .object({
        recordTab: line,
        prescribeTab: line,
        recordTitle: line,
        syntheticNote: line,
        sections: z.object({ summary: line, stay: line, history: line }).strict(),
        filters: z.object({ all: line, med: line, obs: line, result: line, imaging: line, note: line, movement: line }).strict(),
        banner: z.record(z.string(), line),
        headings: z.record(z.string(), line),
      })
      .catchall(z.union([line, z.record(z.string(), line)])),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    const dupes = (label: string, ids: string[]) => {
      const seen = new Set<string>()
      for (const id of ids) {
        if (seen.has(id)) issue(`${label} id "${id}" repeats`)
        seen.add(id)
      }
    }
    dupes('allergen', v.allergens.map((a) => a.id))
    dupes('condition', v.conditions.map((c) => c.id))
    dupes('procedure', v.procedures.map((p) => p.id))
    dupes('stay', v.stays.map((s) => s.id))
    const conditionIds = new Set(v.conditions.map((c) => c.id))
    const procedureIds = new Set(v.procedures.map((p) => p.id))
    const allergenById = new Map(v.allergens.map((a) => [a.id, a]))
    for (const p of v.procedures) {
      if (p.ageAt[0] > p.ageAt[1]) issue(`procedure ${p.id}: ageAt is not ordered`)
      for (const c of p.requires ?? []) if (!conditionIds.has(c)) issue(`procedure ${p.id} requires unknown condition ${c}`)
    }
    for (const m of v.chronicMeds) for (const c of m.anyOf) if (!conditionIds.has(c)) issue(`chronicMeds ${m.med}: unknown condition ${c}`)
    for (const s of v.stays) {
      for (const c of s.conditions ?? []) if (!conditionIds.has(c)) issue(`stay ${s.id}: unknown condition ${c}`)
      for (const p of s.excludesPast ?? []) if (!procedureIds.has(p)) issue(`stay ${s.id}: excludesPast names unknown procedure ${p}`)
      if (s.route !== 'elective' && s.route !== 'clinic' && s.triage === null) issue(`stay ${s.id}: an unplanned arrival needs a triage category`)
    }
    if (v.stays[v.stays.length - 1].match.length !== 0) issue('the last stay template must be the fallback (match: [])')
    for (const [id, list] of Object.entries(v.pinnedAllergies)) {
      for (const pin of list) {
        const a = allergenById.get(pin.allergen)
        if (!a) issue(`pinnedAllergies ${id}: unknown allergen ${pin.allergen}`)
        else if (pin.reaction >= a.reactions.length) issue(`pinnedAllergies ${id}: ${pin.allergen} has no reaction ${pin.reaction}`)
      }
    }
    for (const bands of [v.conditionCount, v.procedureCount, v.social.living, v.social.mobility]) {
      if (bands[bands.length - 1].maxAge < 110) issue('the last age band must cover every age (maxAge 110 or more)')
    }
  })

export type PatientHistoryContent = z.output<typeof PatientHistorySchema>
export type StayTemplate = PatientHistoryContent['stays'][number]
export type AllergenContent = PatientHistoryContent['allergens'][number]
export type ConditionContent = PatientHistoryContent['conditions'][number]
export type ProcedureContent = PatientHistoryContent['procedures'][number]

export const PATIENT_HISTORY: PatientHistoryContent = parseOrThrow(PatientHistorySchema, historyJson, 'src/content/patientHistory.json')

// Cross-file checks: every medicine named exists in the catalogue, every allergy class in the pharmacist's classes.
for (const c of PATIENT_HISTORY.conditions) for (const id of [...c.meds, ...(c.avoidWith ?? [])]) medicineById(id)
for (const m of PATIENT_HISTORY.chronicMeds) medicineById(m.med)
for (const a of PATIENT_HISTORY.allergens) {
  if (a.classId !== null && !allergyClass(a.classId)) {
    throw new Error(`src/content/patientHistory.json: allergen ${a.id} names allergy class "${a.classId}", which src/content/pharmacistQueries.json does not define`)
  }
}

/** The record's UI words. */
export const RECORD_UI = PATIENT_HISTORY.ui
/** The record's sentence templates for the stay story. */
export const RECORD_TEXT = PATIENT_HISTORY.text

/** Fill the {placeholders} of a template; an unknown key is left as it is (a test catches it). */
export function fillRecord(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole))
}

/** A record text template by key (throws for a typo, so the tests catch it). */
export function recordText(key: string, values: Record<string, string | number> = {}): string {
  const t = RECORD_TEXT[key]
  if (t === undefined) throw new Error(`patientHistory.json text has no "${key}"`)
  return fillRecord(t, values)
}

/** A UI word by key (string entries of `ui` only). */
export function uiText(key: string, values: Record<string, string | number> = {}): string {
  const t = (RECORD_UI as Record<string, unknown>)[key]
  if (typeof t !== 'string') throw new Error(`patientHistory.json ui has no string "${key}"`)
  return fillRecord(t, values)
}

/** The stay template for a reason and age: the first whose words appear in the reason (and whose age limit fits), else the fallback. */
export function stayTemplateFor(reason: string, age: number): StayTemplate {
  const r = reason.toLowerCase()
  for (const s of PATIENT_HISTORY.stays) {
    if (s.match.length === 0) continue
    if (s.maxAge !== undefined && age > s.maxAge) continue
    if (s.match.some((m) => r.includes(m))) return s
  }
  return PATIENT_HISTORY.stays[PATIENT_HISTORY.stays.length - 1]
}

/** The demo's "today" as [year, month (1-12), day]. */
export function demoDate(): [number, number, number] {
  const [y, m, d] = PATIENT_HISTORY.demoDate.split('-').map(Number)
  return [y, m, d]
}
