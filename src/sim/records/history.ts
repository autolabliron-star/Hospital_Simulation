/**
 * The patient's past, drawn once per patient (patient record, bedside tablet): allergies and intolerances, chronic conditions, past procedures,
 * usual (home) medicines, social history, immunisations, code status, isolation and falls risk. A pure function of the patient (id, name, age, the
 * reason for the stay and the ward chart): the draws come from an Rng seeded by a hash of the id and the name (never Math.random), so the same
 * seed, which gives the same people, always gives the same records, and two different people who happen to share an id in two seeds differ.
 *
 * Coherence rules (src/content/patientHistory.json):
 *   - no allergy to a medicine the patient is charted on (the ward chart and the stay's forced conditions), and the class mapping (amoxicillin is a
 *     penicillin) lives in src/content/pharmacistQueries.json;
 *   - the chronic medicines on the ward chart bring their condition (apixaban: atrial fibrillation), the stay template brings its own (heart
 *     failure), and random background conditions never bring a medicine the patient is allergic to;
 *   - procedures fit the sex (a caesarean for a woman, a TURP for a man) and happened at a plausible age, never in the future, never the operation
 *     of this stay.
 * Nothing here decides anything clinical. The only consumer outside the record is the pharmacist's allergy query on the presenter's orders.
 */
import { MEDICINES } from '@/content/catalogue'
import {
  demoDate,
  PATIENT_HISTORY,
  stayTemplateFor,
  type AllergenContent,
  type ConditionContent,
  type StayTemplate,
} from '@/content/patientHistory'
import { allergyClass, type AllergyFact } from '@/content/pharmacistQueries'
import { hashString, Rng } from '../rng'
import { avatarIsFemale, variantOf } from '../vitals/body'

const H = PATIENT_HISTORY

/** What the record needs to know about a patient to draw their past. */
export interface RecordSubject {
  id: string
  name: string
  age: number
  /** The reason for the stay in words ("Heart failure, fluid check"), or the ER reason, or a planned operation. */
  reason: string
  /** The ward chart: the catalogue medicines the doctors prescribe (empty for a patient not on a ward). */
  usualMeds: readonly string[]
  /** The entity's variant (default: derived from the id, which is how every entity gets it). */
  variant?: number
}

export type Sex = 'female' | 'male'
export type Severity = 'mild' | 'moderate' | 'severe'

export interface AllergyEntry extends AllergyFact {
  id: string
  kind: 'drug' | 'food' | 'other'
  severity: Severity
  /** Year it was recorded. */
  year: number
  /** Marked for clinician review (a suspected trigger still under investigation). */
  review: boolean
}

export interface ConditionEntry {
  id: string
  name: string
  /** Year of diagnosis. */
  since: number
}

export interface ProcedureEntry {
  id: string
  name: string
  year: number
}

export interface HomeMedEntry {
  medId: string
  /** On the ward chart now (continued), or not (for medicines reconciliation). */
  onChart: boolean
}

export interface ImmunisationEntry {
  name: string
  status: string
  given: boolean
}

export interface PatientHistory {
  /** "SYN-482-1170": an obviously synthetic record number. */
  mrn: string
  sex: Sex
  stay: StayTemplate
  allergies: AllergyEntry[]
  conditions: ConditionEntry[]
  procedures: ProcedureEntry[]
  homeMeds: HomeMedEntry[]
  social: { smoking: string; alcohol: string; living: string; mobility: string }
  immunisations: ImmunisationEntry[]
  codeStatus: string
  codeReview: boolean
  isolation: string | null
  falls: 'high' | 'moderate' | 'low'
}

const YEAR = demoDate()[0]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const CONDITION_BY_ID = new Map(H.conditions.map((c) => [c.id, c]))
const ALLERGEN_BY_ID = new Map(H.allergens.map((a) => [a.id, a]))
const CHRONIC = new Map(H.chronicMeds.map((m) => [m.med, m.anyOf]))
const MED_ORDER = new Map(MEDICINES.map((m, i) => [m.id, i]))

/** The root stream of a patient's record. */
export function recordRng(subject: Pick<RecordSubject, 'id' | 'name'>): Rng {
  return new Rng(hashString(`record:${subject.id}|${subject.name}`))
}

/** The patient's record number: three and four digits after the synthetic prefix. */
export function mrnOf(subject: Pick<RecordSubject, 'id' | 'name'>): string {
  const h = hashString(`mrn:${subject.id}|${subject.name}`) % 10_000_000
  const s = String(h).padStart(7, '0')
  return `${H.mrn.prefix}-${s.slice(0, 3)}-${s.slice(3)}`
}

/** Is the medicine one of the patient's long-term medicines (it implies a condition), rather than one started for this stay? */
export function isChronicMed(medId: string): boolean {
  return CHRONIC.has(medId)
}

const bandOf = <T extends { maxAge: number }>(bands: readonly T[], age: number): T => bands.find((b) => age <= b.maxAge) ?? bands[bands.length - 1]

function eligible(c: ConditionContent, age: number): boolean {
  return age >= c.minAge && (c.maxAge === undefined || age <= c.maxAge)
}

/** The medicines an allergy class covers (none for a class-less allergen such as latex or a food). */
function classMeds(classId: string | null): readonly string[] {
  return classId === null ? [] : (allergyClass(classId)?.meds ?? [])
}

/** The medicines the patient must be able to take: the ward chart and the medicines of the conditions the stay itself brings. */
function chartedMeds(subject: RecordSubject, stay: StayTemplate): Set<string> {
  const out = new Set<string>(subject.usualMeds)
  for (const id of stay.conditions ?? []) for (const m of CONDITION_BY_ID.get(id)?.meds ?? []) out.add(m)
  return out
}

function allergyOf(a: AllergenContent, reactionIndex: number, year: number, review: boolean): AllergyEntry {
  const r = a.reactions[reactionIndex]
  return { id: a.id, agent: a.agent, kind: a.kind, classId: a.classId, type: r.type, reaction: r.text, severity: r.severity, year, review }
}

function recordedYear(rng: Rng, age: number): number {
  return YEAR - rng.int(1, Math.max(1, Math.min(30, age - 2)))
}

/**
 * The patient's allergies and intolerances: the pinned demo ones of a catalogue patient, else a seeded draw (about one patient in five has at
 * least one), plus the suspected trigger of an allergic-reaction admission. Never an allergy to a medicine they are charted on.
 */
export function allergiesOf(subject: RecordSubject, stay: StayTemplate = stayTemplateFor(subject.reason, subject.age)): AllergyEntry[] {
  const rng = recordRng(subject).fork('allergies')
  const charted = chartedMeds(subject, stay)
  const out: AllergyEntry[] = []
  const pinned = H.pinnedAllergies[subject.id]
  if (pinned) {
    for (const p of pinned) out.push(allergyOf(ALLERGEN_BY_ID.get(p.allergen)!, p.reaction, recordedYear(rng, subject.age), false))
  } else if (rng.chance(H.allergyChance)) {
    const pool = H.allergens.filter((a) => !classMeds(a.classId).some((m) => charted.has(m)))
    const draws = rng.chance(H.secondAllergyChance) ? 2 : 1
    for (let i = 0; i < draws && pool.length > 0; i++) {
      const a = rng.weighted(pool, pool.map((x) => x.weight))
      pool.splice(pool.indexOf(a), 1)
      const reaction = a.reactions.indexOf(rng.weighted(a.reactions, a.reactions.map((r) => r.weight)))
      out.push(allergyOf(a, reaction, recordedYear(rng, subject.age), false))
    }
  }
  if (stay.allergy) {
    const f = stay.allergy
    out.push({ id: 'stay-trigger', agent: f.agent, kind: f.kind, classId: null, type: f.type, reaction: f.reaction, severity: f.severity, year: YEAR, review: true })
  }
  return out
}

/** Every medicine any of these allergies rules out (the class members). */
export function blockedMeds(allergies: readonly AllergyFact[]): Set<string> {
  const out = new Set<string>()
  for (const a of allergies) for (const m of classMeds(a.classId)) out.add(m)
  return out
}

function drawSmoking(rng: Rng, age: number, mustHaveSmoked: boolean): { kind: 'never' | 'ex' | 'current'; text: string } {
  const opts = H.social.smoking
  const weights = opts.map((o) => {
    if (age < 18) return o.kind === 'never' ? 1 : 0
    if (mustHaveSmoked && o.kind === 'never') return 0
    if (age >= 80 && o.kind === 'current') return o.weight * 0.3
    return o.weight
  })
  const o = rng.weighted(opts, weights)
  let text: string
  if (o.kind === 'ex') {
    // stopped 1 to (age - 25) years ago; at most about a pack a day for the years smoked from 17 (a 29-year-old has no 37 pack-years)
    const ago = rng.int(1, Math.max(1, age - 25))
    const smoked = Math.max(1, age - ago - 17)
    text = o.text.replace('{year}', String(YEAR - ago)).replace('{packs}', String(rng.int(1, Math.max(1, Math.min(40, smoked)))))
  } else text = o.text.replace('{n}', String(rng.int(5, 20)))
  return { kind: o.kind, text }
}

function sinceYear(rng: Rng, age: number, c: ConditionContent): number {
  return YEAR - rng.int(1, Math.max(1, Math.min(25, age - c.minAge)))
}

/** The patient's past (see the module comment). */
export function patientHistory(subject: RecordSubject): PatientHistory {
  const root = recordRng(subject)
  const age = subject.age
  const stay = stayTemplateFor(subject.reason, age)
  const female = avatarIsFemale(subject.id, subject.name, subject.variant ?? variantOf(subject.id))
  const sex: Sex = female ? 'female' : 'male'
  const allergies = allergiesOf(subject, stay)
  const blocked = blockedMeds(allergies)
  const charted = new Set(subject.usualMeds)

  // the conditions the stay and the chronic chart medicines bring (no draw), in order
  const implied: ConditionContent[] = []
  const impliedIds = new Set<string>()
  const imply = (c: ConditionContent | undefined) => {
    if (!c || impliedIds.has(c.id)) return
    impliedIds.add(c.id)
    implied.push(c)
  }
  for (const id of stay.conditions ?? []) imply(CONDITION_BY_ID.get(id))
  for (const med of subject.usualMeds) {
    const anyOf = CHRONIC.get(med)
    if (!anyOf || anyOf.some((id) => impliedIds.has(id))) continue
    imply(anyOf.map((id) => CONDITION_BY_ID.get(id)!).find((c) => eligible(c, age)) ?? CONDITION_BY_ID.get(anyOf[anyOf.length - 1]))
  }

  // social first: COPD (implied or drawn) needs a smoking history
  const srng = root.fork('social')
  const smoking = drawSmoking(srng, age, implied.some((c) => c.smokers))
  const alcoholOpt = age < 18 ? H.social.alcohol[0] : srng.weighted(H.social.alcohol, H.social.alcohol.map((a) => a.weight))
  const alcohol = alcoholOpt.text.replace('{n}', String(alcoholOpt === H.social.alcohol[2] ? srng.int(18, 40) : srng.int(2, 14)))
  const living = srng.pick(bandOf(H.social.living, age).options)
  const mobility = stay.mobility ?? srng.pick(bandOf(H.social.mobility, age).options)

  // conditions: the stay's own, those the chronic chart medicines imply, then a few background ones
  const crng = root.fork('conditions')
  const conditions: ConditionEntry[] = []
  const have = new Set<string>()
  const add = (c: ConditionContent | undefined) => {
    if (!c || have.has(c.id)) return
    have.add(c.id)
    conditions.push({ id: c.id, name: c.name, since: sinceYear(crng, age, c) })
  }
  for (const c of implied) add(c)
  const countWeights = bandOf(H.conditionCount, age).weights
  const extra = crng.weighted([0, 1, 2, 3], countWeights)
  for (let i = 0; i < extra; i++) {
    const pool = H.conditions.filter(
      (c) =>
        !have.has(c.id) &&
        eligible(c, age) &&
        !(c.smokers && smoking.kind === 'never') &&
        !c.meds.some((m) => blocked.has(m)) &&
        !(c.avoidWith ?? []).some((m) => charted.has(m)),
    )
    const weights = pool.map((c) => (female && c.femaleRandom !== undefined ? c.femaleRandom : c.random))
    if (weights.every((w) => w <= 0)) break
    add(crng.weighted(pool, weights))
  }
  conditions.sort((a, b) => a.since - b.since || (a.name < b.name ? -1 : 1))

  // home medicines: the chronic medicines on the chart, and the medicines of every condition (never one they are allergic to)
  const home = new Set<string>()
  for (const m of subject.usualMeds) if (CHRONIC.has(m)) home.add(m)
  for (const c of conditions) for (const m of CONDITION_BY_ID.get(c.id)?.meds ?? []) if (!blocked.has(m)) home.add(m)
  const homeMeds: HomeMedEntry[] = [...home]
    .sort((a, b) => (MED_ORDER.get(a) ?? 0) - (MED_ORDER.get(b) ?? 0))
    .map((medId) => ({ medId, onChart: charted.has(medId) }))

  // past procedures: sex and age appropriate, never the operation of this stay
  const prng = root.fork('procedures')
  const excluded = new Set(stay.excludesPast ?? [])
  const procedures: ProcedureEntry[] = []
  const count = prng.weighted([0, 1, 2, 3], bandOf(H.procedureCount, age).weights)
  const done = new Set<string>()
  for (let i = 0; i < count; i++) {
    const pool = H.procedures.filter(
      (p) =>
        !done.has(p.id) &&
        !excluded.has(p.id) &&
        (p.sex === undefined || p.sex === sex) &&
        p.ageAt[0] <= age - 1 &&
        (p.requires ?? []).every((c) => have.has(c)),
    )
    if (pool.length === 0) break
    const p = prng.weighted(pool, pool.map((x) => x.weight))
    done.add(p.id)
    const at = prng.int(p.ageAt[0], Math.min(p.ageAt[1], age - 1))
    const name = p.side ? `${p.name} (${prng.pick(H.sides)})` : p.name
    procedures.push({ id: p.id, name, year: YEAR - (age - at) })
  }
  procedures.sort((a, b) => b.year - a.year)

  const irng = root.fork('immunisations')
  const immunisations: ImmunisationEntry[] = []
  for (const im of H.immunisations) {
    if (age < im.fromAge) continue
    const p = age >= im.olderFrom ? im.chance[1] : im.chance[0]
    const given = irng.chance(p)
    const status = given
      ? im.given.replace('{month}', irng.pick([MONTHS[8], MONTHS[9]])).replace('{year}', String(YEAR)).replace('{pastYear}', String(YEAR - irng.int(1, 8)))
      : im.missing
    immunisations.push({ name: im.name, status, given })
  }

  const orng = root.fork('flags')
  const dnacpr = age >= H.codeStatus.dnacprFromAge && orng.chance(H.codeStatus.dnacprChance)
  const isolation = orng.chance(H.isolation.chance) ? H.isolation.flag : null
  const falls = stay.falls || age >= H.falls.highFromAge ? 'high' : age >= H.falls.moderateFromAge ? 'moderate' : 'low'

  return {
    mrn: mrnOf(subject),
    sex,
    stay,
    allergies,
    conditions,
    procedures,
    homeMeds,
    social: { smoking: smoking.text, alcohol, living, mobility },
    immunisations,
    codeStatus: dnacpr ? H.codeStatus.dnacpr : H.codeStatus.full,
    codeReview: dnacpr,
    isolation,
    falls,
  }
}
