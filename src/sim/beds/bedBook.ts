/**
 * The bed book: a pure function of the world seed and the content (pattern: population/visitBook.ts, but with no state).
 * It answers three questions without touching the simulation:
 *
 *   - which inpatients go home today and when (the discharge plans, from the stay plans in src/content/patients.json);
 *   - which synthetic admission profile a new ward patient gets (`admissionRecord`);
 *   - what each room looks like when the sim starts at clock hour H (`bedBook(seed, H).rooms`): rooms whose planned
 *     discharge is over are cleaned and either `ready` or already re-occupied by a synthetic admission; a discharge
 *     that is under way is picked up where it is. A warm start is a plausible state, not a replay of the morning.
 *
 * Times are sim seconds since 07:30 (like `Simulation.t`). Nothing here uses Math.random: draws come from forks of the seed.
 */
import { ADMISSION_PROFILES, admissionProfilesFor, type AdmissionProfile } from '@/content/admissions'
import { PATIENTS, type PatientPlan } from '@/content/catalogue'
import type { LeavesBy } from '@/content/schema'
import { syntheticName } from '@/content/roster'
import { CONFIG } from '../config'
import { ROOMS } from '../places'
import { Rng } from '../rng'
import type { RoomId } from '../types'

/**
 * The doctor signs this long before the planned departure (Wave 1): the family are called and arrive 30-90 minutes after the signature
 * (CONFIG.beds.familyArrivesSeconds), then the medicines and the changing take a few minutes, so the patient leaves about at the planned hour.
 * The planned discharges of the morning are signed on the ward round.
 */
export const SIGN_LEAD_SECONDS = 3600
/** A cleaner needs about this long to reach a room that has just been vacated (the bed board's ready-by estimate). */
export const CLEANER_PICKUP_SECONDS = 75
/**
 * In a live day the room is empty about this long after the planned departure (the patient is still walking out for a
 * minute or two) and the cleaner gets there about this long after it: the warm start keeps the same pace.
 */
const WARM_CLEAN_LEAD_SECONDS = 225
/** The linen tail after the cleaning (the porter making the bed). */
const WARM_LINEN_TAIL_SECONDS = 45

/** Sim time (s since 07:30) of a clock hour. */
export function timeOfHour(hour: number): number {
  return (hour - CONFIG.sim.startHour) * 3600
}

/** What the ward knows about the patient in a bed: display data and the doctors' usual medicines. No clinical rules. */
export interface WardRecord {
  /** The entity id of the person. */
  id: string
  name: string
  age: number
  reason: string
  usualMeds: readonly string[]
  /** 1 on the day of admission. */
  dayOfStay: number
  leavesBy: LeavesBy
}

export function recordOfPlan(p: PatientPlan): WardRecord {
  return { id: p.id, name: p.name, age: p.age, reason: p.reason, usualMeds: p.usualMeds, dayOfStay: p.dayOfStay, leavesBy: p.leavesBy }
}

export interface DischargePlan {
  roomId: RoomId
  patientId: string
  patientName: string
  /** Planned clock hour of leaving (from the stay plan). */
  leaveHour: number
  leaveAt: number
  /** The doctor signs on rounds from this time on. */
  signAt: number
  leavesBy: LeavesBy
  /** Days of stay, for "went home after N days". */
  days: number
}

/** Today's planned discharges, earliest sign time first (a stay plan only: nothing here decides anything clinical). */
export function dischargePlans(): DischargePlan[] {
  const plans: DischargePlan[] = []
  for (const p of PATIENTS) {
    if (p.stay.kind !== 'goingHome') continue
    const leaveAt = timeOfHour(p.stay.atHour)
    plans.push({
      roomId: p.roomId,
      patientId: p.id,
      patientName: p.name,
      leaveHour: p.stay.atHour,
      leaveAt,
      signAt: leaveAt - SIGN_LEAD_SECONDS,
      leavesBy: p.leavesBy,
      days: p.dayOfStay,
    })
  }
  return plans.sort((a, b) => a.signAt - b.signAt || (a.roomId < b.roomId ? -1 : 1))
}

/** The ward record a newly admitted patient gets: one of the profiles for their ER reason (all of them if the reason has none). */
export function admissionRecord(rng: Rng, erReason: string | null, id: string, name: string): WardRecord {
  let pool: readonly AdmissionProfile[] = ADMISSION_PROFILES
  if (erReason !== null) {
    try {
      pool = admissionProfilesFor(erReason)
    } catch {
      pool = ADMISSION_PROFILES
    }
  }
  const profile = rng.pick(pool)
  const [lo, hi] = profile.ageRange
  const age = rng.int(lo, hi)
  return {
    id,
    name,
    age,
    reason: profile.wardReason,
    usualMeds: profile.usualMeds,
    dayOfStay: 1,
    // the same rule as the stay plans: from 80 on, a wheelchair with a porter
    leavesBy: age >= 80 ? 'wheelchair' : 'walk',
  }
}

/** The state of one room when the sim starts. */
export type WarmKind =
  /** Nothing changes: the M1 inpatient is in bed. */
  | 'occupied'
  /** The doctor has signed; the medicines and the family are on the way. */
  | 'signed'
  /** The medicines are given and the family is in the room: the patient is about to change and leave. */
  | 'leaving'
  /** The patient has gone; a cleaner is yet to come (or is half way: `cleanSeconds` is what is left). */
  | 'needsCleaning'
  | 'ready'
  /** A new admission lives here (a synthetic ward record). */
  | 'readmitted'

export interface WarmRoom {
  roomId: RoomId
  kind: WarmKind
  /** For `needsCleaning` and `ready`/`readmitted`: sim seconds the bed has been in that state (for `since`). */
  elapsed: number
  /** `needsCleaning` only: the cleaning that is left, in seconds (shorter than a full clean when it was half done). */
  cleanSeconds?: number
  /** `readmitted` only. */
  occupant?: WardRecord
}

export interface BedBookDay {
  plans: DischargePlan[]
  rooms: WarmRoom[]
}

/** How long a room takes from "patient left" to "ready": the cleaner's walk, the clean, the linen. */
function turnaround(rng: Rng): { clean: number } {
  return { clean: rng.between(CONFIG.beds.roomCleanSeconds) }
}

/**
 * The day for a sim that starts at clock hour `startHour`. Pure: the same (seed, startHour) always gives the same book.
 * At the default start (07:30) every room is simply occupied.
 */
export function bedBook(seed: number, startHour: number): BedBookDay {
  const plans = dischargePlans()
  const t0 = timeOfHour(startHour)
  const root = new Rng(seed).fork('bedBook')
  const names = new Set<string>(PATIENTS.map((p) => p.name))
  const planByRoom = new Map(plans.map((p) => [p.roomId, p]))
  const rooms: WarmRoom[] = []
  for (const room of ROOMS) {
    const plan = planByRoom.get(room.id)
    if (!plan || t0 < plan.signAt) {
      rooms.push({ roomId: room.id, kind: 'occupied', elapsed: 0 })
      continue
    }
    if (t0 < plan.leaveAt - 360) {
      rooms.push({ roomId: room.id, kind: 'signed', elapsed: t0 - plan.signAt })
      continue
    }
    if (t0 < plan.leaveAt) {
      rooms.push({ roomId: room.id, kind: 'leaving', elapsed: t0 - plan.signAt })
      continue
    }
    // the patient is gone: how far has the room got?
    const rng = root.fork(`room:${room.id}`)
    const since = t0 - plan.leaveAt
    const { clean } = turnaround(rng)
    const cleanEnd = WARM_CLEAN_LEAD_SECONDS + clean + WARM_LINEN_TAIL_SECONDS
    if (since < cleanEnd) {
      // empty: the cleaner is on the way (or half way through: a shorter clean is left)
      const cleanDone = Math.max(0, since - WARM_CLEAN_LEAD_SECONDS)
      rooms.push({ roomId: room.id, kind: 'needsCleaning', elapsed: Math.max(0, since - 150), cleanSeconds: Math.max(60, clean - cleanDone) })
      continue
    }
    // clean: either still ready, or the next admission has already arrived
    const readyFor = since - cleanEnd
    const admitAfter = rng.range(600, 7200)
    if (readyFor >= admitAfter + CONFIG.beds.bedTransferSeconds) {
      const id = `pt-w-${room.id}`
      let name = syntheticName(rng)
      for (let i = 0; i < 12 && names.has(name); i++) name = syntheticName(rng)
      names.add(name)
      rooms.push({ roomId: room.id, kind: 'readmitted', elapsed: readyFor - admitAfter, occupant: admissionRecord(rng, null, id, name) })
    } else {
      rooms.push({ roomId: room.id, kind: 'ready', elapsed: readyFor })
    }
  }
  return { plans, rooms }
}
