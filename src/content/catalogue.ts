/**
 * The fixed demo catalogue: medicines and synthetic inpatients. Both JSON files are parsed with the zod
 * schemas at module load, and cross-checked against each other and the room layout. Bad content throws
 * here, at startup, with the file and field named.
 */
import { ROOM_IDS } from '@/sim/places'
import type { Medicine, PatientRecord, RoomId } from '@/sim/types'
import medicinesJson from './medicines.json'
import patientsJson from './patients.json'
import { MedicinesSchema, parseOrThrow, PatientsSchema, type Dose, type LeavesBy, type PatientStay } from './schema'

/** An inpatient with their L1 day plan (every PatientRecord field, plus the stay). The sim reads PatientRecord as before. */
export type PatientPlan = PatientRecord & { stay: PatientStay; leavesBy: LeavesBy; dayOfStay: number }

export const MEDICINES: Medicine[] = parseOrThrow(MedicinesSchema, medicinesJson, 'src/content/medicines.json')
export const PATIENTS: PatientPlan[] = parseOrThrow(PatientsSchema, patientsJson, 'src/content/patients.json')

const DOSE_BY_ID = new Map<string, Dose>(parseOrThrow(MedicinesSchema, medicinesJson, 'src/content/medicines.json').map((m) => [m.id, m.dose]))

/** The clock hours a medicine is due (empty for an as-needed one). */
export function doseHoursOf(id: string): readonly number[] {
  const d = DOSE_BY_ID.get(id)
  if (!d) throw new Error(`Unknown medicine id "${id}"`)
  return 'hours' in d ? d.hours : []
}

/** Is this medicine given only as needed (never on the dose waves)? */
export function isPrn(id: string): boolean {
  const d = DOSE_BY_ID.get(id)
  if (!d) throw new Error(`Unknown medicine id "${id}"`)
  return 'prn' in d
}

/** The shortest time (seconds) allowed between two doses of a medicine: its closest dose hours, or the as-needed gap. */
export function minDoseGapSeconds(id: string): number {
  const d = DOSE_BY_ID.get(id)
  if (!d) throw new Error(`Unknown medicine id "${id}"`)
  if ('prn' in d) return d.minGapHours * 3600
  const h = d.hours
  let gap = 24
  for (let i = 0; i < h.length; i++) gap = Math.min(gap, i === 0 ? h[0] + 24 - h[h.length - 1] : h[i] - h[i - 1])
  return gap * 3600
}

const MEDICINE_BY_ID = new Map<string, Medicine>(MEDICINES.map((m) => [m.id, m]))
const PATIENT_BY_ROOM = new Map<RoomId, PatientPlan>(PATIENTS.map((p) => [p.roomId, p]))

// Cross-file checks: every usual medicine exists, and the patients cover exactly the sim's rooms.
for (const patient of PATIENTS) {
  for (const medId of patient.usualMeds) {
    if (!MEDICINE_BY_ID.has(medId)) {
      throw new Error(`src/content/patients.json: ${patient.id} lists unknown medicine "${medId}" in usualMeds`)
    }
  }
}
const roomsInRoster = new Set<RoomId>(PATIENTS.map((p) => p.roomId))
const missingRooms = ROOM_IDS.filter((roomId) => !roomsInRoster.has(roomId))
const unknownRooms = PATIENTS.filter((p) => !ROOM_IDS.includes(p.roomId)).map((p) => `${p.id} (${p.roomId})`)
if (missingRooms.length > 0 || unknownRooms.length > 0) {
  throw new Error(
    `src/content/patients.json must cover exactly the rooms in ROOM_IDS. ` +
      `Missing: ${missingRooms.join(', ') || 'none'}. Not in ROOM_IDS: ${unknownRooms.join(', ') || 'none'}.`,
  )
}

/** The catalogue medicine with this id. Throws if it is not in the catalogue. */
export function medicineById(id: string): Medicine {
  const medicine = MEDICINE_BY_ID.get(id)
  if (!medicine) throw new Error(`Unknown medicine id "${id}"`)
  return medicine
}

/** The synthetic inpatient in this room, with their day plan. Throws if the room has no patient. */
export function patientInRoom(roomId: RoomId): PatientPlan {
  const patient = PATIENT_BY_ROOM.get(roomId)
  if (!patient) throw new Error(`No patient in room ${roomId}`)
  return patient
}
