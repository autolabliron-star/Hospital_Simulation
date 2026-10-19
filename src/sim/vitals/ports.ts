/**
 * W4: the frozen interface of the health-kiosk service (src/sim/vitals), so the ER (src/sim/blood's wiring of er/patient.ts) and the scene can
 * call it while it is being built. Contract glue, owned by the orchestrator.
 */
import type { Spot } from '../places'
import type { HealthKioskState, HealthSessionKind, VitalsReading } from '../types'

/** A person who uses a kiosk (an ER walk-in waiting for triage, a walk-up visitor). The service drives them through these callbacks. */
export interface KioskSubject {
  readonly id: string
  readonly name: string
  /** Your turn: walk to this kiosk's platform and stand facing it. */
  kioskCalled(index: number, stand: Spot): void
  /** Sit on the blood-pressure stool now (arm into the tunnel: anim 'armIn'). */
  kioskSit(seat: Spot): void
  /** Done (the reading may be partial): walk on. */
  kioskDone(reading: VitalsReading): void
  /** Optional: where to stand in the line (place 0 is the front). */
  kioskQueued?(spot: Spot, place: number): void
  /** Optional: you were called but did not reach the platform in time; the kiosk starts anyway (glide onto it). */
  kioskForced?(stand: Spot): void
}

export interface VitalsPort {
  /** The two kiosks, mutated in place (the scene reads them every frame). */
  readonly kiosks: readonly HealthKioskState[]
  /** Offer a session; false when the line is too long (the caller carries on without). 'vitals' is the short ER session. */
  offer(subject: KioskSubject, kind: HealthSessionKind): boolean
  /** Leave the line or the kiosk now (called to triage, walked away): a partial reading is kept. */
  abort(personId: string): void
  /** A nurse's reading at triage (adds the white-coat offset), recorded beside the kiosk's. */
  recordTriage(personId: string, personName: string, nurseId: string): VitalsReading
  /** Every reading of a person, oldest first. */
  readingsFor(personId: string): readonly VitalsReading[]
  /** You (E at a kiosk): start your own short session, or 'busy'. */
  beginPlayer(index: number): 'started' | 'busy'
  cancelPlayer(): void
}
