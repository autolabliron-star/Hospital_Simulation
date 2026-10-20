/**
 * S1 in-flight warm for the ER (docs/S1-SHOWCASE.md): patients already under way at a warm start. Some wait for triage, some wait for a
 * doctor, some lie in an ER bay. They are built exactly like the Director's walk-ins (same id/name registries, same hooks), then enter their
 * pathway through the WARM_* events on `arriving`, so the normal entry hooks run (no snapshot restore). The hidden pre-roll moves them on:
 *   - waiting for triage: seated in the triage rows; a triage nurse claims them, so a triage bay is in use;
 *   - waiting for a doctor: triaged some minutes ago, seated in the ER rows; the bay assignment and the ER nurses' escort take them in;
 *   - in a bay: promised a bay (`ErDepartment.occupyBay`) and lying on its trolley; an ER doctor claims them (`claimExam`).
 * Logs nothing (the caller sets `world.quiet`). All randomness comes from the given Rng.
 */
import { ER_REASONS } from '@/content/roster'
import { CONFIG } from '../config'
import { ARRIVALS } from '../places'
import type { Rng } from '../rng'
import { ErPatient } from './patient'
import type { World } from './world'

type WarmStage = 'triage' | 'doctor' | 'bay'

/** How long (sim seconds) each kind of placed patient has been here already. */
const WAITED: Record<WarmStage, readonly [number, number]> = {
  triage: [60, 240],
  doctor: [420, 1020],
  bay: [600, 1500],
}

/**
 * A patient waiting for a doctor is not called to a bay before this many sim seconds (more than the 60 s Jump pre-roll), so the ER waiting rows
 * are still occupied when the hidden pre-roll ends; the first minutes of the live day then show the nurse coming to fetch them.
 */
const DOCTOR_HOLD: readonly [number, number] = [75, 110]

/** A walk-in built the way `Director.spawnWalkIn` builds one (without the fade-in, the companion and the arrival message). */
function buildPatient(world: World, rng: Rng): ErPatient {
  const id = world.id('er')
  const name = world.uniqueName(rng)
  const reason = rng.weighted(ER_REASONS, ER_REASONS.map((r) => CONFIG.er.reasonWeightByAcuity[r.acuity - 1]))
  const patient = new ErPatient({
    world,
    id,
    name,
    reason,
    ambulance: false,
    at: { x: ARRIVALS.entrance.at.x, z: ARRIVALS.entrance.at.z },
    heading: ARRIVALS.entrance.heading,
    walker: world.walkerFor(id),
    rng: rng.fork(id),
  })
  patient.start()
  return patient
}

/** Place CONFIG.opening.er patients mid-pathway at `t`. */
export function warmErInFlight(world: World, rng: Rng, t: number): void {
  const want = CONFIG.opening.er
  const was = world.quiet
  world.quiet = true
  try {
    world.t = t
    // bays first (most advanced), a shuffled choice so they are not all in a row
    const order = rng.fork('bays').shuffle(world.er.bays.map((b) => b.index))
    const stages: WarmStage[] = [
      ...Array.from({ length: want.bay }, () => 'bay' as const),
      ...Array.from({ length: want.doctor }, () => 'doctor' as const),
      ...Array.from({ length: want.triage }, () => 'triage' as const),
    ]
    const roll = rng.fork('patients')
    let next = 0
    for (const wanted of stages) {
      const patient = buildPatient(world, roll)
      let stage = wanted
      if (stage === 'bay') {
        // the first free bay of the shuffled order; none left means this one waits for a doctor like the rest
        let got = false
        while (next < order.length && !got) got = world.er.occupyBay(patient.c, order[next++], t)
        if (!got) stage = 'doctor'
      }
      patient.warmStart(stage, roll.between(WAITED[stage]), stage === 'doctor' ? roll.between(DOCTOR_HOLD) : 0)
      world.hooks.add(patient)
    }
  } finally {
    world.quiet = was
  }
}
