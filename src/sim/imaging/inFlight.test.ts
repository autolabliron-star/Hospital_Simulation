/**
 * S1 in-flight warm of the scanners: after the build and the hidden pre-roll every staffed scanner has a patient on the
 * table in the middle of a sequence, the ultrasound on the renal exam's "Right kidney"; afterwards the exams finish
 * normally, the patients leave and the booking queue carries on.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { areaAt } from '../places'
import { Simulation } from '../Simulation'
import { MODALITIES } from '../types'

const SEED = 42

function build(opts: ConstructorParameters<typeof Simulation>[1] = {}, seed = SEED): Simulation {
  return new Simulation(seed, { inFlight: true, opening: 'showcase', ...opts })
}

function run(s: Simulation, seconds: number): void {
  const n = Math.round(seconds / CONFIG.sim.step)
  for (let i = 0; i < n; i++) s.step(CONFIG.sim.step)
  s.sync(1)
}

function fingerprint(s: Simulation): string[] {
  const im = s.imaging
  return MODALITIES.map((m) => {
    const st = im.scanners[m]
    const p = im.machines[m].session?.booking
    return `${m} ${st.phase} ${st.exam?.protocol} ${st.exam?.patientName} seq${st.sequence} ${st.progress.toFixed(4)} tab${st.tablePos} act${st.activity.toFixed(3)} rem${st.remaining.toFixed(2)} ${p?.id}`
  })
}

describe('S1 imaging in-flight warm', () => {
  it('has a patient mid-sequence on every staffed scanner after the pre-roll', () => {
    const s = build()
    s.preRoll(CONFIG.opening.preRollSeconds)
    const [p0, p1] = CONFIG.opening.seqProgress
    for (const m of MODALITIES) {
      const st = s.imaging.scanners[m]
      const sc = s.imaging.machines[m]
      expect(st.phase, m).toBe('scanning')
      expect(st.exam, m).not.toBeNull()
      expect(st.sequence, m).toBeGreaterThanOrEqual(0)
      expect(st.progress, m).toBeGreaterThanOrEqual(p0 - 0.01)
      expect(st.progress, m).toBeLessThanOrEqual(p1 + 0.01)
      expect(st.operatorId, m).not.toBeNull()
      expect(st.tablePos, m).toBe(m === 'mri' || m === 'ct' ? 1 : 0)
      expect(st.remaining, m).toBeGreaterThan(0)
      expect(sc.session?.step, m).toBe('scan')
      // the patient lies on the table seat, the operator sits or stands at her station
      const patient = s.entities.get(st.exam!.patientId)!
      expect(patient, m).toBeDefined()
      expect(patient.seated?.seatId, m).toBe(sc.sites.tableSeat.id)
      if (sc.sites.tableInRegistry) expect(s.seats.occupant(sc.sites.tableSeat.id), m).toBe(st.exam!.patientId)
      const spot = sc.tableSpot()
      expect(Math.hypot(patient.position.x - spot.x, patient.position.z - spot.z), m).toBeLessThan(0.25)
      if (m === 'mri') expect(patient.outfit).toBe('gown')
      const op = s.entities.get(st.operatorId!)!
      expect(op, m).toBeDefined()
      const station = sc.sites.station
      expect(Math.hypot(op.position.x - station.at.x, op.position.z - station.at.z), m).toBeLessThan(1)
    }
    expect(s.imaging.stuckFixes).toBe(0)
  })

  it('has the next outpatients seated in the imaging hall, waiting for their scanner', () => {
    const s = build()
    s.preRoll(CONFIG.opening.preRollSeconds)
    const waiting = s.imaging.outpatients.filter((o) => o.state === 'waiting' && areaAt(o.x, o.z)?.id === 'imagingHall')
    expect(waiting.length).toBeGreaterThanOrEqual(1)
    for (const o of waiting) {
      expect(o.booking.ready).toBe(true)
      expect(o.booking.state).toBe('waiting')
      expect(s.imaging.queues[o.booking.modality].waiting).toContain(o.booking)
    }
    const inHall = [...s.entities.values()].filter((e) => e.role === 'patient' && areaAt(e.position.x, e.position.z)?.id === 'imagingHall')
    expect(inHall.length).toBeGreaterThanOrEqual(1)
  })

  it('puts the ultrasound on the renal exam, right kidney', () => {
    const s = build()
    s.preRoll(CONFIG.opening.preRollSeconds)
    const st = s.imaging.scanners.us
    expect(st.exam?.protocol).toBe('Ultrasound kidneys and bladder')
    expect(st.exam?.bodyPart).toBe('kidneys')
    expect(st.exam?.sequences[st.sequence].name).toBe('Right kidney')
    expect(st.sequence).toBe(0)
    expect(st.activity).toBe(1)
    expect(st.detail).toBeGreaterThan(0)
  })

  it('logs nothing while placing, and counts the placed visits', () => {
    const s = build()
    expect(s.log.events.filter((e) => ['scanStarted', 'scanSequence', 'outpatientArrived'].includes(e.type))).toHaveLength(0)
    expect(s.imaging.bookings).toHaveLength(6)
    expect(s.imaging.outpatientsSpawned).toBe(6)
    expect(s.imaging.outpatients).toHaveLength(6)
    expect(s.imaging.exams).toHaveLength(4)
    expect(s.world.quiet).toBe(false)
  })

  // two hospitals built and run 450 s each: about 5 s alone, more under a full parallel run
  it('is deterministic', { timeout: 60_000 }, () => {
    const a = build()
    const b = build()
    a.preRoll(CONFIG.opening.preRollSeconds)
    b.preRoll(CONFIG.opening.preRollSeconds)
    expect(fingerprint(a)).toEqual(fingerprint(b))
    run(a, 400)
    run(b, 400)
    expect(fingerprint(a)).toEqual(fingerprint(b))
    expect(a.imaging.describe()).toBe(b.imaging.describe())
  })

  it('a different seed places different exams', () => {
    const seen = new Set<string>()
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = build({}, seed)
      seen.add(MODALITIES.map((m) => s.imaging.scanners[m].exam?.protocol).join('|'))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('the hold keeps every exam in place until the reveal: the end of any pre-roll, or endWarmHold()', () => {
    const a = build()
    a.preRoll(CONFIG.opening.preRollSeconds)
    const before = a.imaging.scanners.mri.progress
    run(a, 3)
    expect(a.imaging.scanners.mri.progress).toBeGreaterThan(before)
    // stepped by hand (no pre-roll), the hold stands until endWarmHold()
    const b = build()
    run(b, 10)
    const p = b.imaging.scanners.mri.progress
    run(b, 2)
    expect(b.imaging.scanners.mri.progress).toBe(p)
    b.imaging.endWarmHold()
    run(b, 2)
    expect(b.imaging.scanners.mri.progress).toBeGreaterThan(p)
    // a short pre-roll ends it too (Simulation.preRoll calls endWarmHold)
    const c = build()
    c.preRoll(10)
    const q = c.imaging.scanners.mri.progress
    run(c, 2)
    expect(c.imaging.scanners.mri.progress).toBeGreaterThan(q)
  })

  it('a Jump (60 s pre-roll) at any hour places a patient on every staffed scanner and skips the others', () => {
    let staffed = 0
    let unstaffed = 0
    for (const hour of [7.5, 9, 11, 13.5, 15.5, 18, 21, 23.5]) {
      const s = build({ startHour: hour })
      const operators = MODALITIES.filter((m) => s.imaging.machines[m].operator !== null)
      s.preRoll(60)
      for (const m of MODALITIES) {
        const st = s.imaging.scanners[m]
        if (operators.includes(m)) {
          staffed++
          expect(st.phase, `${m} at ${hour}`).toBe('scanning')
        } else {
          unstaffed++
          expect(st.phase, `${m} at ${hour}`).toBe('idle')
          expect(st.exam).toBeNull()
        }
      }
      run(s, 300)
      expect(s.imaging.stuckFixes, `at ${hour}: ${s.imaging.stuckLog.join(';')}`).toBe(0)
    }
    expect(staffed).toBeGreaterThan(8)
    expect(unstaffed).toBeGreaterThan(0)
  }, 120_000)

  it('the exams finish, the patients leave, the queue goes on, nobody is forced', () => {
    const s = build()
    s.preRoll(CONFIG.opening.preRollSeconds)
    const placed = [...s.imaging.bookings]
    expect(placed).toHaveLength(6)
    const placedPatients = placed.map((b) => b.subject!)
    const startT = s.t
    run(s, 3600)
    expect(s.imaging.stuckFixes, s.imaging.stuckLog.join('\n')).toBe(0)
    for (const b of placed) expect(b.state, b.id).toBe('done')
    for (const p of placedPatients) {
      expect(s.entities.has(p.id), p.id).toBe(false)
    }
    for (const m of MODALITIES) expect(s.imaging.finished[m], m).toBeGreaterThanOrEqual(1)
    // the morning's appointments (arrival before the end of the run) were served too
    const morning = s.imaging.bookings.filter((b) => b.apptAt <= startT + 3600 - 1200)
    expect(morning.length).toBeGreaterThan(4)
    for (const b of morning) expect(b.state, `${b.id} ${b.protocolName} ${b.apptAt}`).toBe('done')
    // every scanner table seat is free whenever the scanner is idle
    for (const m of MODALITIES) {
      const sc = s.imaging.machines[m]
      if (sc.session === null && sc.sites.tableInRegistry) expect(s.seats.occupant(sc.sites.tableSeat.id), m).toBeNull()
    }
  }, 120_000)

  it('never double-books a table seat', () => {
    const s = build()
    s.preRoll(CONFIG.opening.preRollSeconds)
    for (let i = 0; i < 600; i++) {
      run(s, 5)
      for (const m of MODALITIES) {
        const sc = s.imaging.machines[m]
        const ids = [...s.entities.values()].filter((e) => e.seated?.seatId === sc.sites.tableSeat.id)
        expect(ids.length, `${m} at ${s.t}`).toBeLessThanOrEqual(1)
      }
    }
  }, 120_000)

  it('without inFlight the scanners are idle at 07:30 and nothing is placed', () => {
    const s = new Simulation(SEED)
    s.preRoll(50)
    for (const m of MODALITIES) expect(s.imaging.scanners[m].phase, m).toBe('idle')
    expect(s.imaging.exams.filter((e) => e.patientId.startsWith('inflight'))).toHaveLength(0)
    const q = new Simulation(SEED, { opening: 'quiet' })
    q.preRoll(50)
    for (const m of MODALITIES) expect(q.imaging.scanners[m].phase, m).toBe('idle')
  })
})
