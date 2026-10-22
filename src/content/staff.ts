/**
 * Synthetic staff on shift (fictional names). Ids are referenced by the simulation; names appear in the
 * event line ("Nurse Maya gave 3 medicines to …").
 *
 * createPeople() builds only staff with a ward, plus coordinators. The ward-less entries (ER, triage,
 * reception, transport, housekeeping, paramedics) are data for later milestones.
 *
 * L1 adds NIGHT_STAFF and HOSTS in their own arrays. The running simulation spawns only from STAFF, so these
 * are data for the day rhythm and meals builders until they are wired in. Every member has a shift (hours in
 * CONFIG.day.shifts).
 */
import { z } from 'zod'
import type { Role, ShiftId, WardId } from '@/sim/types'
import { parseOrThrow } from './parse'

/** Where a member of staff works. */
export type StaffPost =
  | 'ward'
  | 'er'
  | 'triage'
  | 'reception'
  | 'transport'
  | 'housekeeping'
  | 'pharmacy'
  | 'command'
  | 'imaging'
  | 'bloodDraw'
  | 'kiosk'
  | 'lab'
  /** R2: the robotic surgery suite on level 2. */
  | 'theatre'

export interface StaffMember {
  id: string
  role: Extract<
    Role,
    | 'doctor'
    | 'nurse'
    | 'pharmacist'
    | 'coordinator'
    | 'porter'
    | 'cleaner'
    | 'receptionist'
    | 'paramedic'
    | 'radiographer'
    | 'sonographer'
    | 'host'
    | 'labScientist'
  >

  ward?: WardId
  /** Where they work. */
  post?: StaffPost
  /** Which roster they work (CONFIG.day.shifts): ward nurses day, doctors and imaging office hours, night staff night. */
  shift: ShiftId
  /** How the event line names them. */
  name: string
}

export const STAFF: StaffMember[] = [
  { id: 'doc-A', role: 'doctor', ward: 'A', post: 'ward', shift: 'day', name: 'Dr. Levi' },
  { id: 'doc-B', role: 'doctor', ward: 'B', post: 'ward', shift: 'day', name: 'Dr. Okafor' },
  { id: 'nurse-A1', role: 'nurse', ward: 'A', post: 'ward', shift: 'day', name: 'Nurse Maya' },
  { id: 'nurse-A2', role: 'nurse', ward: 'A', post: 'ward', shift: 'day', name: 'Nurse Tomás' },
  { id: 'nurse-B1', role: 'nurse', ward: 'B', post: 'ward', shift: 'day', name: 'Nurse Leah' },
  { id: 'nurse-B2', role: 'nurse', ward: 'B', post: 'ward', shift: 'day', name: 'Nurse Kenji' },
  { id: 'pharm-A', role: 'pharmacist', ward: 'A', post: 'pharmacy', shift: 'day', name: 'Pharmacist Noa' },
  { id: 'pharm-B', role: 'pharmacist', ward: 'B', post: 'pharmacy', shift: 'day', name: 'Pharmacist Ravi' },
  { id: 'coord-1', role: 'coordinator', post: 'command', shift: 'day', name: 'Coordinator Dana' },
  { id: 'coord-2', role: 'coordinator', post: 'command', shift: 'day', name: 'Coordinator Eli' },

  { id: 'doc-ER1', role: 'doctor', post: 'er', shift: 'day', name: 'Dr. Halima' },
  { id: 'doc-ER2', role: 'doctor', post: 'er', shift: 'day', name: 'Dr. Sven' },
  { id: 'nurse-ER1', role: 'nurse', post: 'er', shift: 'day', name: 'Nurse Bianca' },
  { id: 'nurse-ER2', role: 'nurse', post: 'er', shift: 'day', name: 'Nurse Joon' },
  { id: 'nurse-T1', role: 'nurse', post: 'triage', shift: 'day', name: 'Nurse Femi' },
  { id: 'nurse-T2', role: 'nurse', post: 'triage', shift: 'day', name: 'Nurse Greta' },
  { id: 'recep-1', role: 'receptionist', post: 'reception', shift: 'day', name: 'Receptionist Yara' },
  { id: 'porter-1', role: 'porter', post: 'transport', shift: 'day', name: 'Porter Callum' },
  { id: 'porter-2', role: 'porter', post: 'transport', shift: 'day', name: 'Porter Ines' },
  { id: 'porter-3', role: 'porter', post: 'transport', shift: 'day', name: 'Porter Felix' },
  { id: 'cleaner-1', role: 'cleaner', post: 'housekeeping', shift: 'day', name: 'Cleaner Rosa' },
  { id: 'cleaner-2', role: 'cleaner', post: 'housekeeping', shift: 'day', name: 'Cleaner Amir' },
  { id: 'para-1', role: 'paramedic', post: 'er', shift: 'day', name: 'Paramedic Hugo' },
  { id: 'para-2', role: 'paramedic', post: 'er', shift: 'day', name: 'Paramedic Sana' },

  { id: 'rad-MRI', role: 'radiographer', post: 'imaging', shift: 'office', name: 'Radiographer Tariq' },
  { id: 'rad-CT', role: 'radiographer', post: 'imaging', shift: 'office', name: 'Radiographer Ilse' },
  { id: 'rad-XR', role: 'radiographer', post: 'imaging', shift: 'office', name: 'Radiographer Rohan' },
  { id: 'sono-1', role: 'sonographer', post: 'imaging', shift: 'office', name: 'Sonographer Elin' },
]

/** L1: the night roster. One night nurse per ward, one on-call doctor for both wards, a night porter and a night cleaner. */
export const NIGHT_STAFF: StaffMember[] = [
  { id: 'nurse-N-A', role: 'nurse', ward: 'A', post: 'ward', shift: 'night', name: 'Nurse Ottilie' },
  { id: 'nurse-N-B', role: 'nurse', ward: 'B', post: 'ward', shift: 'night', name: 'Nurse Rhys' },
  { id: 'doc-N', role: 'doctor', post: 'ward', shift: 'night', name: 'Dr. Oriel' },
  { id: 'porter-N', role: 'porter', post: 'transport', shift: 'night', name: 'Porter Gideon' },
  { id: 'cleaner-N', role: 'cleaner', post: 'housekeeping', shift: 'night', name: 'Cleaner Wren' },
]

/** L1: the ward hosts who serve meals with the MealBot. One per ward. */
export const HOSTS: StaffMember[] = [
  { id: 'host-A', role: 'host', ward: 'A', post: 'ward', shift: 'day', name: 'Host Ilona' },
  { id: 'host-B', role: 'host', ward: 'B', post: 'ward', shift: 'day', name: 'Host Caspian' },
]

/**
 * W4 smart diagnostics: on site around the clock in v1 (not on the day rhythm's roster; robots only work while the supervising nurse is there,
 * and manual review needs the scientist). Spawned by their services: the draw centre (src/sim/blood), the kiosks (src/sim/vitals) and the lab
 * (src/sim/lab).
 */
export const W4_STAFF: StaffMember[] = [
  { id: 'draw-nurse', role: 'nurse', post: 'bloodDraw', shift: 'day', name: 'Nurse Hana' },
  { id: 'kiosk-guide', role: 'nurse', post: 'kiosk', shift: 'day', name: 'Nurse Ingrid' },
  { id: 'lab-sci-1', role: 'labScientist', post: 'lab', shift: 'day', name: 'Scientist Arjun' },
]

/**
 * R2: the theatre team on level 2 (on site CONFIG.surgery.teamFromHour..teamToHour, not on the ward roster). Existing roles with
 * theatre titles: `title` says what each does in the OR (the surgery sim gives each their part; the crowd dresses them in theatre
 * scrubs and a cap). Synthetic people only.
 */
export const THEATRE_STAFF: (StaffMember & { title: 'surgeon' | 'assistant' | 'anaesthetist' | 'scrub' | 'circulator' | 'preOp' | 'pacu' | 'porter' | 'cleaner' })[] = [
  { id: 'or-surgeon', role: 'doctor', post: 'theatre', shift: 'day', name: 'Dr. Elena', title: 'surgeon' },
  { id: 'or-assistant', role: 'doctor', post: 'theatre', shift: 'day', name: 'Dr. Amir', title: 'assistant' },
  { id: 'or-anaes', role: 'doctor', post: 'theatre', shift: 'day', name: 'Dr. Keiko', title: 'anaesthetist' },
  { id: 'or-scrub', role: 'nurse', post: 'theatre', shift: 'day', name: 'Nurse Andreas', title: 'scrub' },
  { id: 'or-circ', role: 'nurse', post: 'theatre', shift: 'day', name: 'Nurse Clara', title: 'circulator' },
  { id: 'or-preop', role: 'nurse', post: 'theatre', shift: 'day', name: 'Nurse Fatima', title: 'preOp' },
  { id: 'or-pacu', role: 'nurse', post: 'theatre', shift: 'day', name: 'Nurse Ben', title: 'pacu' },
  { id: 'or-porter', role: 'porter', post: 'theatre', shift: 'day', name: 'Porter Basil', title: 'porter' },
  { id: 'or-cleaner', role: 'cleaner', post: 'theatre', shift: 'day', name: 'Cleaner Lina', title: 'cleaner' },
]

// ---------------------------------------------------------------------------------------------
// The schema (F-34): the staff lists are checked at module load, so a typo names the list and the member instead of failing somewhere later.
// Each list of values is a Record keyed by the union, so the compiler rejects a missing or an extra value.
// ---------------------------------------------------------------------------------------------

const ROLE_CHECK: Record<StaffMember['role'], true> = {
  doctor: true,
  nurse: true,
  pharmacist: true,
  coordinator: true,
  porter: true,
  cleaner: true,
  receptionist: true,
  paramedic: true,
  radiographer: true,
  sonographer: true,
  host: true,
  labScientist: true,
}
const POST_CHECK: Record<StaffPost, true> = {
  ward: true,
  er: true,
  triage: true,
  reception: true,
  transport: true,
  housekeeping: true,
  pharmacy: true,
  command: true,
  imaging: true,
  bloodDraw: true,
  kiosk: true,
  lab: true,
  theatre: true,
}
const SHIFT_CHECK: Record<ShiftId, true> = { day: true, night: true, office: true }
const WARDS: readonly WardId[] = ['A', 'B']

export const StaffMemberSchema = z.looseObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9-]*$/, 'an id is letters, digits and hyphens, starting with a lower-case letter'),
  role: z.enum(Object.keys(ROLE_CHECK) as [StaffMember['role'], ...StaffMember['role'][]]),
  ward: z.enum(WARDS as [WardId, ...WardId[]]).optional(),
  post: z.enum(Object.keys(POST_CHECK) as [StaffPost, ...StaffPost[]]).optional(),
  shift: z.enum(Object.keys(SHIFT_CHECK) as [ShiftId, ...ShiftId[]]),
  name: z
    .string()
    .trim()
    .min(3)
    .refine((n) => /^(Dr\.|Nurse|Pharmacist|Coordinator|Receptionist|Porter|Cleaner|Paramedic|Radiographer|Sonographer|Host|Scientist) \S/.test(n), 'a name is a title and a first name, e.g. "Nurse Maya"'),
})

/** Every staff list, each id once across all of them. */
export const StaffListsSchema = z.array(z.array(StaffMemberSchema)).superRefine((lists, ctx) => {
  const seen = new Set<string>()
  lists.forEach((list, li) =>
    list.forEach((m, i) => {
      if (seen.has(m.id)) ctx.addIssue({ code: 'custom', path: [li, i, 'id'], message: `duplicate staff id "${m.id}"` })
      seen.add(m.id)
    }),
  )
})
parseOrThrow(StaffListsSchema, [STAFF, NIGHT_STAFF, HOSTS, W4_STAFF, THEATRE_STAFF], 'src/content/staff.ts')

const BY_ID = new Map([...STAFF, ...NIGHT_STAFF, ...HOSTS, ...W4_STAFF, ...THEATRE_STAFF].map((s) => [s.id, s]))

export function staffName(id: string): string {
  return BY_ID.get(id)?.name ?? id
}
