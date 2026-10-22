/**
 * Admission profiles (L1): the ward record an ER patient gets when they are admitted to ward A or B. A profile is
 * keyed by the ER or ambulance reasons that can lead to it (people.json), and a reason may have several profiles,
 * so the sim can draw one per admission. Display data only: no clinical rules, no dosing logic.
 * admissions.json is parsed with AdmissionsSchema at module load and cross-checked against people.json and the
 * medicine catalogue. Bad content throws here, with the file and field named.
 */
import admissionsJson from './admissions.json'
import { MEDICINES } from './catalogue'
import { AMBULANCE_REASONS, ER_REASONS } from './roster'
import { AdmissionsSchema, parseOrThrow, type AdmissionProfile } from './schema'

export type { AdmissionProfile } from './schema'

export const ADMISSION_PROFILES: readonly AdmissionProfile[] = parseOrThrow(
  AdmissionsSchema,
  admissionsJson,
  'src/content/admissions.json',
).profiles

// Every reason that can be admitted: ER walk-ins and ambulance arrivals both go through the same admit check.
const ADMITTABLE_REASONS: readonly string[] = [...ER_REASONS, ...AMBULANCE_REASONS].map((r) => r.text)
const MEDICINE_IDS = new Set(MEDICINES.map((m) => m.id))

const problems: string[] = []
for (const profile of ADMISSION_PROFILES) {
  for (const reason of profile.reasons) {
    if (!ADMITTABLE_REASONS.includes(reason)) problems.push(`${profile.id} lists "${reason}", which is not a reason in people.json`)
  }
  for (const medId of profile.usualMeds) {
    if (!MEDICINE_IDS.has(medId)) problems.push(`${profile.id} lists unknown medicine "${medId}"`)
  }
}
for (const reason of ADMITTABLE_REASONS) {
  if (!ADMISSION_PROFILES.some((p) => p.reasons.includes(reason))) problems.push(`no admission profile for the reason "${reason}"`)
}
if (problems.length > 0) {
  throw new Error(`src/content/admissions.json does not match people.json or medicines.json: ${problems.join('; ')}`)
}

const PROFILES_BY_REASON = new Map<string, AdmissionProfile[]>()
for (const profile of ADMISSION_PROFILES) {
  for (const reason of profile.reasons) {
    const list = PROFILES_BY_REASON.get(reason) ?? []
    list.push(profile)
    PROFILES_BY_REASON.set(reason, list)
  }
}

/** The admission profiles that can follow this ER or ambulance reason (people.json text). Throws on an unknown reason. */
export function admissionProfilesFor(reason: string): readonly AdmissionProfile[] {
  const profiles = PROFILES_BY_REASON.get(reason)
  if (!profiles) throw new Error(`No admission profile for reason "${reason}"`)
  return profiles
}

/**
 * Wave 1: the admission chance this reason has of its own, or null when the acuity table (CONFIG.er.admitChanceByAcuity) decides. It is 0
 * when every profile for the reason says 0 (sunburn, a cold, a cut finger, a sprain, a prescription review never lead to a bed).
 * Throws on an unknown reason.
 */
export function admitChanceFor(reason: string): number | null {
  const profiles = admissionProfilesFor(reason)
  let max: number | null = null
  for (const p of profiles) {
    if (p.admitChance === undefined) return null
    max = Math.max(max ?? 0, p.admitChance)
  }
  return max
}
