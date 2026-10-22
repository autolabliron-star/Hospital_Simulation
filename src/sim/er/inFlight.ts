/**
 * S1 in-flight warm for the ER (docs/S1-SHOWCASE.md): patients already under way at a warm start. Some wait for triage, some wait for a
 * doctor, some lie in an ER bay. They are built exactly like the Director's walk-ins (same id/name registries, same hooks), then enter their
 * pathway through the WARM_* events on `arriving`, so the normal entry hooks run (no snapshot restore). The hidden pre-roll moves them on:
 *   - waiting for triage: seated in the triage rows; a triage nurse claims them, so a triage bay is in use;
 *   - waiting for a doctor: triaged some minutes ago, seated in the ER rows; the bay assignment and the ER nurses' escort take them in;
 *   - in a bay: promised a bay (`ErDepartment.occupyBay`) and lying on its trolley; an ER doctor claims them (`claimExam`).
 * Logs nothing (the caller sets `world.quiet`). All randomness comes from the given Rng.
 */
import { testForReason } from '@/content/imaging'
import { ER_REASONS, type Reason } from '@/content/roster'
import { staffRegistry } from '../day/staffRegistry'
import { CONFIG } from '../config'
import { ARRIVALS } from '../places'
import type { Rng } from '../rng'
import { ErPatient, type BayStep } from './patient'
import { ErDoctor, ErNurse } from './staff'
import type { World } from './world'

type WarmStage = 'triage' | 'doctor' | 'bay'

/** How long (sim seconds) each kind of placed patient has been here already. */
const WAITED: Record<WarmStage, readonly [number, number]> = {
  triage: [60, 240],
  doctor: [420, 1020],
  bay: [2400, 5400],
}

/**
 * The bays at a warm start are mid-stay (Wave 1: real stays are 1-4 h, so no bay is free or "waiting for a doctor" at the reveal): the ER
 * nurse is part-way through the care step of one, a doctor is mid-assessment of another and the second doctor is reviewing a third whose
 * results are in, and the rest are assessed and waiting for the lab. `CONFIG.opening.er.bay` is the least that is placed.
 */
const BAY_PLAN: readonly BayStep[] = [
  { step: 'exam', progress: 0.5 },
  { step: 'review', progress: 0.4 },
  { step: 'care', progress: 0.55 },
  { step: 'results', progress: 0 },
  { step: 'results', progress: 0 },
]

/** Reasons that bring bloods most of the time: the patients who can be waiting for a result or a review. */
const WITH_BLOODS: readonly Reason[] = ER_REASONS.filter((r) => {
  const t = testForReason(r.text)
  return t.bloods !== null && t.chance >= 0.9
})

/**
 * A patient waiting for a doctor is not called to a bay before this many sim seconds (more than the 60 s Jump pre-roll), so the ER waiting rows
 * are still occupied when the hidden pre-roll ends; the first minutes of the live day then show the nurse coming to fetch them.
 */
const DOCTOR_HOLD: readonly [number, number] = [75, 110]

/** A walk-in built the way `Director.spawnWalkIn` builds one (without the fade-in, the companion and the arrival message). */
function buildPatient(world: World, rng: Rng, pool: readonly Reason[] = ER_REASONS): ErPatient {
  const id = world.id('er')
  const name = world.uniqueName(rng)
  const reason = rng.weighted(pool, pool.map((r) => CONFIG.er.reasonWeightByAcuity[r.acuity - 1]))
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
    const nBay = Math.min(order.length, Math.max(want.bay, BAY_PLAN.length))
    const stages: WarmStage[] = [
      ...Array.from({ length: nBay }, () => 'bay' as const),
      ...Array.from({ length: want.doctor }, () => 'doctor' as const),
      ...Array.from({ length: want.triage }, () => 'triage' as const),
    ]
    const reg = staffRegistry(world)
    const doctors = ['doc-ER1', 'doc-ER2'].map((id) => reg.get(id)).filter((p): p is ErDoctor => p instanceof ErDoctor)
    const nurses = ['nurse-ER1', 'nurse-ER2'].map((id) => reg.get(id)).filter((p): p is ErNurse => p instanceof ErNurse)
    let doctorsUsed = 0
    let nursesUsed = 0
    const roll = rng.fork('patients')
    let next = 0
    let planned = 0
    for (const wanted of stages) {
      const step = wanted === 'bay' ? BAY_PLAN[planned % BAY_PLAN.length] : null
      // the patients with something to wait for have a complaint that brings bloods
      const pool = step !== null && step.step !== 'exam' ? WITH_BLOODS : ER_REASONS
      const patient = buildPatient(world, roll, pool)
      let stage = wanted
      if (stage === 'bay') {
        // the first free bay of the shuffled order; none left means this one waits for a doctor like the rest
        let got = false
        while (next < order.length && !got) got = world.er.occupyBay(patient.c, order[next++], t)
        if (!got) stage = 'doctor'
        else planned++
      }
      const bayStep = stage === 'bay' && step !== null ? step : undefined
      patient.warmStart(stage, roll.between(WAITED[stage]), stage === 'doctor' ? roll.between(DOCTOR_HOLD) : 0, bayStep)
      world.hooks.add(patient)
      // the staff who are part-way through a placed patient's step are at the bedside
      if (bayStep?.step === 'exam' || bayStep?.step === 'review') {
        const doc = doctors[doctorsUsed++]
        doc?.warmVisit(patient, bayStep.step, bayStep.progress)
      } else if (bayStep?.step === 'care') {
        nurses[nursesUsed++]?.warmCare(patient, bayStep.progress)
      }
    }
  } finally {
    world.quiet = was
  }
}
