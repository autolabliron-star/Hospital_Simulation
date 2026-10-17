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
import type { Role, ShiftId, WardId } from '@/sim/types'

/** Where a member of staff works. */
export type StaffPost = 'ward' | 'er' | 'triage' | 'reception' | 'transport' | 'housekeeping' | 'pharmacy' | 'command' | 'imaging'

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
  { id: 'doc-A', role: 'doctor', ward: 'A', post: 'ward', shift: 'office', name: 'Dr. Levi' },
  { id: 'doc-B', role: 'doctor', ward: 'B', post: 'ward', shift: 'office', name: 'Dr. Okafor' },
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

const BY_ID = new Map([...STAFF, ...NIGHT_STAFF, ...HOSTS].map((s) => [s.id, s]))

export function staffName(id: string): string {
  return BY_ID.get(id)?.name ?? id
}
