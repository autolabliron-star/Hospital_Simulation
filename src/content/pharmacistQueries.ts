/**
 * The pharmacist's queries on the presenter's tablet: the duplicate wording, the interactions of the demo catalogue and the tablet's
 * dose line (route and frequency). pharmacistQueries.json is parsed with PharmacistQueriesSchema at module load and cross-checked
 * against the medicine catalogue, so bad content throws here with the field named.
 *
 * Demo content only: the interaction list is a short, well-known sample for the demo catalogue, not a clinical decision tool.
 * `findInteractions` is pure and deterministic; the sim holds an order that is queried until the presenter confirms or cancels it.
 */
import { z } from 'zod'
import type { Medicine } from '@/sim/types'
import { doseHoursOf, isPrn, MEDICINES, medicineById, minDoseGapSeconds } from './catalogue'
import queriesJson from './pharmacistQueries.json'

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')

const ids = z.array(z.string().min(1)).min(1)

export const PharmacistQueriesSchema = z
  .object({
    duplicate: z.object({ pending: line, recent: line }).strict(),
    rules: z
      .array(
        z
          .object({
            id: z.string().min(1),
            /** The medicines that raise the query. */
            meds: ids,
            /** What they clash with: other medicines the patient is on, or words in the reason for the stay. */
            with: z.union([z.object({ meds: ids }).strict(), z.object({ conditions: ids }).strict()]),
            text: line,
          })
          .strict(),
      )
      .min(1),
    /** The allergy check (patient record): the query sentence and which catalogue medicines belong to each allergy class. */
    allergy: z
      .object({
        text: line,
        classes: z
          .array(z.object({ id: z.string().min(1), name: line, meds: ids }).strict())
          .min(1),
      })
      .strict(),
    ui: z
      .object({
        queryTitle: line,
        allergyTitle: line,
        heldNote: line,
        queriedNotice: line,
        confirm: line,
        cancel: line,
        confirmedNotice: line,
        cancelledNotice: line,
        queryFor: line,
        route: z.record(z.string(), line),
        frequency: z
          .object({ once: line, twice: line, three: line, four: line, many: line, at: line, prn: line })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>()
    for (const r of v.rules) {
      if (seen.has(r.id)) ctx.addIssue({ code: 'custom', message: `rule id "${r.id}" repeats` })
      seen.add(r.id)
    }
    const classes = new Set<string>()
    for (const c of v.allergy.classes) {
      if (classes.has(c.id)) ctx.addIssue({ code: 'custom', message: `allergy class "${c.id}" repeats` })
      classes.add(c.id)
    }
  })

export type PharmacistQueriesCopy = z.output<typeof PharmacistQueriesSchema>

export const PHARMACIST_QUERIES: PharmacistQueriesCopy = PharmacistQueriesSchema.parse(queriesJson)

// Cross-checks against the catalogue: every medicine a rule names exists, and every dose form has a route.
for (const r of PHARMACIST_QUERIES.rules) {
  const named = [...r.meds, ...('meds' in r.with ? r.with.meds : [])]
  for (const id of named) medicineById(id) // throws "Unknown medicine id" for a typo
}
for (const c of PHARMACIST_QUERIES.allergy.classes) for (const id of c.meds) medicineById(id)
for (const m of MEDICINES) {
  if (!(m.form in PHARMACIST_QUERIES.ui.route)) {
    throw new Error(`src/content/pharmacistQueries.json: ui.route has no entry for the form "${m.form}" (${m.id})`)
  }
}

/** Fill the {placeholders} of a template. */
export function fillQuery(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole))
}

export type QueryKind = 'duplicate' | 'interaction' | 'allergy'

/** One thing the pharmacist queries about an order, as a sentence for the tablet. */
export interface QueryReason {
  id: string
  kind: QueryKind
  medId: string
  text: string
}

export interface InteractionContext {
  /** The medicines in the new order. */
  orderMeds: readonly string[]
  /** The medicines the patient is already on (their chart and their open orders). */
  patientMeds: ReadonlySet<string>
  /** The reason for the patient's stay, in words ("Heart failure, fluid check"). */
  condition: string
}

/**
 * The interactions of the demo catalogue that the order raises, in a fixed order (the order's medicines, then the rules). A rule
 * between two medicines works both ways round: ibuprofen on top of apixaban, or apixaban on top of ibuprofen.
 */
export function findInteractions(ctx: InteractionContext): QueryReason[] {
  const out: QueryReason[] = []
  const condition = ctx.condition.toLowerCase()
  const meds = (id: string) => `${medicineById(id).name}`
  const has = (id: string) => ctx.patientMeds.has(id) || ctx.orderMeds.includes(id)
  for (const medId of ctx.orderMeds) {
    for (const rule of PHARMACIST_QUERIES.rules) {
      if ('conditions' in rule.with) {
        if (!rule.meds.includes(medId)) continue
        const hit = rule.with.conditions.find((c) => condition.includes(c.toLowerCase()))
        if (hit === undefined) continue
        out.push({ id: rule.id, kind: 'interaction', medId, text: fillQuery(rule.text, { med: meds(medId), with: hit }) })
        continue
      }
      // between two medicines: either side may be the one being ordered, the other is on the patient already (or in the same order)
      const other = rule.meds.includes(medId) ? rule.with.meds : rule.with.meds.includes(medId) ? rule.meds : null
      if (other === null) continue
      const partner = other.find((id) => id !== medId && has(id))
      if (partner === undefined) continue
      // report each pair once: when both are in the order, the first of the order's medicines reports it
      if (ctx.orderMeds.includes(partner) && ctx.orderMeds.indexOf(partner) < ctx.orderMeds.indexOf(medId)) continue
      out.push({ id: rule.id, kind: 'interaction', medId, text: fillQuery(rule.text, { med: meds(medId), with: meds(partner) }) })
    }
  }
  return out
}

/** An allergy class of the content ("penicillin"), or undefined. */
export function allergyClass(id: string): PharmacistQueriesCopy['allergy']['classes'][number] | undefined {
  return PHARMACIST_QUERIES.allergy.classes.find((c) => c.id === id)
}

/** One recorded allergy as the pharmacist's check sees it (src/sim/records builds these from the patient record). */
export interface AllergyFact {
  agent: string
  classId: string | null
  type: 'allergy' | 'intolerance'
  reaction: string
  severity: string
}

/**
 * The allergy queries an order raises: every ordered medicine that belongs to the class of a recorded allergy or intolerance (amoxicillin with a
 * penicillin allergy). Pure, in a fixed order (the order's medicines, then the allergies). Allergies with no class (latex, a food) never match a medicine.
 */
export function findAllergyConflicts(orderMeds: readonly string[], allergies: readonly AllergyFact[], patient: string): QueryReason[] {
  const out: QueryReason[] = []
  for (const medId of orderMeds) {
    for (const a of allergies) {
      if (a.classId === null) continue
      const cls = allergyClass(a.classId)
      if (!cls || !cls.meds.includes(medId)) continue
      out.push({
        id: `allergy-${a.classId}`,
        kind: 'allergy',
        medId,
        text: fillQuery(PHARMACIST_QUERIES.allergy.text, {
          patient,
          agent: a.agent,
          type: a.type,
          reaction: a.reaction.toLowerCase(),
          severity: a.severity,
          med: medicineById(medId).name,
          className: cls.name,
        }),
      })
    }
  }
  return out
}

/** The clock label of a dose hour: 8 becomes "08:00", 6.5 becomes "06:30". */
function hourLabel(h: number): string {
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  return `${String(whole).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

/** How often a medicine is given, from the catalogue's dose plan ("four times a day (08:00, 12:00, 18:00, 22:00)"). */
export function frequencyText(med: Pick<Medicine, 'id'>): string {
  const f = PHARMACIST_QUERIES.ui.frequency
  if (isPrn(med.id)) return fillQuery(f.prn, { gap: minDoseGapSeconds(med.id) / 3600 })
  const hours = doseHoursOf(med.id)
  const n = hours.length
  const label = n === 1 ? f.once : n === 2 ? f.twice : n === 3 ? f.three : n === 4 ? f.four : fillQuery(f.many, { n })
  return fillQuery(f.at, { label, hours: hours.map(hourLabel).join(', ') })
}

/** The route of a medicine, from its dose form. */
export function routeText(med: Pick<Medicine, 'form'>): string {
  return PHARMACIST_QUERIES.ui.route[med.form]
}
