/**
 * The ER kiosk detour (W4): a walk-in with acuity 3 or less urgent sometimes uses a health kiosk while waiting for triage. The kiosk service
 * (src/sim/vitals, built by another agent) is replaced here by a small stand-in that follows the frozen port, so the ER's side is tested on
 * its own: the offer, keeping the triage place, going to the kiosk and sitting on the stool through the KioskSubject callbacks, coming back
 * to wait, being called to triage mid-session (abort first), and the shorter assessment for a patient with kiosk vitals.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { HEALTH_KIOSKS } from '../places'
import { Simulation } from '../Simulation'
import type { HealthSessionKind, VitalsReading } from '../types'
import type { KioskSubject } from '../vitals/ports'
import type { VitalsService } from '../vitals'
import { kioskTuning, type ErPatient } from './patient'

const DT = CONFIG.sim.step

interface Slot {
  subject: KioskSubject
  state: 'waiting' | 'walking' | 'sitting' | 'done'
  since: number
  kind: HealthSessionKind
}

/** A stand-in kiosk service: one kiosk, a line of at most 3, 8 s to walk up, 6 s on the stool, 14 s of readings. */
class StandInKiosks {
  /** Never finish a session (a stuck kiosk): the ER's own cap must free the patient. */
  stall = false
  /** Call `kioskForced` this long after `kioskCalled` (the patient did not reach the platform in time). */
  forceAfter = Infinity
  readonly abortedAt = new Map<string, number>()
  readonly platformAt = new Map<string, number>()
  readonly line: Slot[] = []
  readonly offers: string[] = []
  readonly refused: string[] = []
  readonly aborted: string[] = []
  readonly finished: string[] = []
  readonly triage: string[] = []
  readonly readings = new Map<string, VitalsReading[]>()
  private readonly told = new Map<string, number>()
  private t = 0

  offer(subject: KioskSubject, kind: HealthSessionKind): boolean {
    if (this.line.length >= 3) {
      this.refused.push(subject.id)
      return false
    }
    this.line.push({ subject, state: 'waiting', since: this.t, kind })
    this.offers.push(subject.id)
    this.told.set(subject.id, -1)
    return true
  }
  abort(personId: string): void {
    const i = this.line.findIndex((s) => s.subject.id === personId)
    if (i < 0) return
    this.line.splice(i, 1)
    this.aborted.push(personId)
    this.abortedAt.set(personId, this.t)
    this.readings.set(personId, [...(this.readings.get(personId) ?? []), this.reading(personId, 'kiosk', true)])
  }
  recordTriage(personId: string, personName: string, _nurseId: string): VitalsReading {
    void personName
    this.triage.push(personId)
    const r = this.reading(personId, 'triage', false)
    this.readings.set(personId, [...(this.readings.get(personId) ?? []), r])
    return r
  }
  readingsFor(personId: string): readonly VitalsReading[] {
    return this.readings.get(personId) ?? []
  }
  beginPlayer(): 'started' | 'busy' {
    return 'busy'
  }
  cancelPlayer(): void {}
  step(t: number): void {
    this.t = t
    // tell everybody in the line where to stand (the front is the platform's approach)
    this.line.forEach((slot, i) => {
      if (this.told.get(slot.subject.id) === i) return
      this.told.set(slot.subject.id, i)
      slot.subject.kioskQueued?.({ at: { x: HEALTH_KIOSKS[0].stand.at.x + 0.8 * (i + 1), z: HEALTH_KIOSKS[0].stand.at.z - 1.2 }, heading: 0 }, i)
    })
    const head = this.line[0]
    if (!head) return
    const k = HEALTH_KIOSKS[0]
    if (head.state === 'waiting' && t - head.since >= 3) {
      head.state = 'walking'
      head.since = t
      head.subject.kioskCalled(0, k.stand)
    } else if (head.state === 'walking' && t - head.since >= this.forceAfter) {
      head.state = 'sitting'
      head.since = t
      head.subject.kioskForced?.(k.stand)
    } else if (head.state === 'walking' && t - head.since >= 8) {
      head.state = 'sitting'
      head.since = t
      this.platformAt.set(head.subject.id, t)
      head.subject.kioskSit(k.bpSeat)
    } else if (head.state === 'sitting' && !this.stall && t - head.since >= 14) {
      head.state = 'done'
      this.line.shift()
      const r = this.reading(head.subject.id, 'kiosk', false)
      this.readings.set(head.subject.id, [...(this.readings.get(head.subject.id) ?? []), r])
      this.finished.push(head.subject.id)
      head.subject.kioskDone(r)
    }
  }
  private reading(id: string, source: 'kiosk' | 'triage', partial: boolean): VitalsReading {
    return { id: `${source}:${id}`, personId: id, personName: id, at: this.t, source, station: source === 'kiosk' ? 0 : null, sys: 120, dia: 80, pulse: 70, spo2: 98, tempC: 36.7, heightCm: null, weightKg: null, bmi: null, bodyFatPct: null, bp: [[120, 80]], partial }
  }
}

function runWith(sim: Simulation, kiosks: StandInKiosks, minutes: number, onSample: (p: ErPatient) => void, onTick?: () => void): void {
  const end = minutes * 60
  let t = 0
  // Wave 1: the real arrival rate is a few an hour; the detour needs a crowd, so a walk-in comes in every 100 s until the last half hour
  let nextWalkIn = 100
  while (t < end) {
    while (t >= nextWalkIn && nextWalkIn < end * 0.7) {
      sim.director!.spawnWalkIn()
      nextWalkIn += 100
    }
    for (let k = 0; k < 30; k++) sim.step(DT)
    t += 30 * DT
    kiosks.step(sim.t)
    onTick?.()
    for (const p of sim.world.patients.values() as Iterable<ErPatient>) onSample(p)
  }
}

describe('the ER kiosk detour', () => {
  const defaultAhead = kioskTuning.minAhead
  afterEach(() => {
    kioskTuning.minAhead = defaultAhead
  })

  it('walk-ins stop at a kiosk while they wait for triage, are not called away mid-session, keep their place, and are triaged faster with kiosk vitals', () => {
    kioskTuning.minAhead = 0 // (a busy triage line is not needed here: every offer is accepted so the whole detour is exercised)
    const sim = new Simulation(404)
    const kiosks = new StandInKiosks()
    sim.world.vitals = kiosks as unknown as VitalsService
    const seenStool = new Set<string>()
    const seenPlatform = new Set<string>()
    const seenInLine = new Set<string>()
    const armIn = new Set<string>()
    const triageSeconds = new Map<string, number>()
    const usedKiosk = new Set<string>()
    const waitingAfter = new Map<string, string>()
    const offerAt = new Map<string, number>()
    const readyAtAfter = new Map<string, number>()
    const calledDuring: string[] = []
    const readyDuring: string[] = []
    const platform = HEALTH_KIOSKS[0].stand.at
    runWith(sim, kiosks, 75, (p) => {
      const id = p.c.id
      if (kiosks.offers.includes(id) && !offerAt.has(id)) offerAt.set(id, sim.t)
      const inKiosk = kiosks.line.some((s) => s.subject.id === id)
      if (inKiosk) {
        seenInLine.add(id)
        // in the line or the session: not ready for triage, and never taken by a nurse
        if (p.c.ready) readyDuring.push(id)
        if (p.state !== 'waitingTriage' || p.c.nurseId !== null) calledDuring.push(`${id} ${p.state}`)
      }
      if (p.seat?.id.startsWith('kioskBp:')) {
        seenStool.add(id)
        if (p.entity.anim === 'armIn') armIn.add(id)
      }
      if (Math.hypot(p.x - platform.x, p.z - platform.z) < 0.5) seenPlatform.add(id)
      if (kiosks.finished.includes(id)) usedKiosk.add(id)
      if (p.state === 'triage.assessing' && !triageSeconds.has(id)) triageSeconds.set(id, p.pathway.getSnapshot().context.triageSeconds)
      if (kiosks.finished.includes(id) && p.state === 'waitingTriage') {
        if (p.c.ready && !readyAtAfter.has(id)) readyAtAfter.set(id, p.c.readyAt)
        if ((p.seat !== null || p.mode === 'static') && !waitingAfter.has(id)) waitingAfter.set(id, p.seat ? p.seat.id : 'standing')
      }
    })
    console.log(`[W4 B kiosk] offers ${kiosks.offers.length}, refused ${kiosks.refused.length}, finished ${kiosks.finished.length}, aborted ${kiosks.aborted.length}, triage records ${kiosks.triage.length}`)
    // a few walk-ins used the kiosk, through the whole set of callbacks (queued, called, sit, done)
    expect(kiosks.offers.length).toBeGreaterThanOrEqual(4)
    expect(kiosks.finished.length).toBeGreaterThanOrEqual(3)
    // no session was cut short by a nurse's call: the detour is only ever ended by the service (or the ER's own cap, never reached here)
    expect(kiosks.aborted).toEqual([])
    expect(calledDuring).toEqual([])
    expect(readyDuring).toEqual([])
    for (const id of kiosks.finished) {
      expect(seenPlatform.has(id), `${id} walked to the platform`).toBe(true)
      expect(seenStool.has(id), `${id} sat on the stool`).toBe(true)
      expect(armIn.has(id), `${id} had the arm in the cuff`).toBe(true)
    }
    // they keep their first-come place: ready again with the time they began, not the time they got back
    for (const [id, at] of readyAtAfter) expect(at, `${id} kept their place`).toBeLessThanOrEqual((offerAt.get(id) ?? Infinity) + 15)
    // after the session they went back to wait (a seat, or a standing spot if the lobby was full)
    expect(waitingAfter.size).toBeGreaterThanOrEqual(1)
    // the nurse's reading is recorded at every triage
    expect(kiosks.triage.length).toBeGreaterThanOrEqual(triageSeconds.size - 2)
    // triage with kiosk vitals takes 0.8 x the usual 60-120 s; without, the usual
    const [lo, hi] = CONFIG.er.triageSeconds
    const f = CONFIG.vitals.triageWithVitalsFactor
    let fast = 0
    let plain = 0
    for (const [id, secs] of triageSeconds) {
      const had = (kiosks.readings.get(id) ?? []).some((r) => r.source === 'kiosk' && r.at < sim.t)
      if (had && usedKiosk.has(id)) {
        fast++
        expect(secs, id).toBeGreaterThanOrEqual(lo * f - 1e-9)
        expect(secs, id).toBeLessThanOrEqual(hi * f + 1e-9)
      } else if (!had) {
        plain++
        expect(secs, id).toBeGreaterThanOrEqual(lo - 1e-9)
        expect(secs, id).toBeLessThanOrEqual(hi + 1e-9)
      }
    }
    expect(fast).toBeGreaterThanOrEqual(1)
    expect(plain).toBeGreaterThanOrEqual(3)
    expect(seenInLine.size).toBeGreaterThanOrEqual(4)
    // nobody was left behind: every ER patient who came in good time is through triage
    const stuck = [...sim.world.er.cases.values()].filter((c) => c.arrivedAt < 75 * 60 - 40 * 60 && c.state === 'waitingTriage').map((c) => `${c.name} ${c.state}`)
    expect(stuck).toEqual([])
  }, 300_000)

  it('a kiosk that never finishes does not hold a patient for ever: 3 minutes on the platform, then the session is aborted and they are triaged', () => {
    kioskTuning.minAhead = 0
    const sim = new Simulation(404)
    const kiosks = new StandInKiosks()
    kiosks.stall = true
    sim.world.vitals = kiosks as unknown as VitalsService
    const triaged = new Set<string>()
    const everWaiting = new Set<string>()
    runWith(sim, kiosks, 45, (p) => {
      if (p.state === 'triage.walking' || p.state === 'triage.assessing') triaged.add(p.c.id)
      if (kiosks.platformAt.has(p.c.id)) everWaiting.add(p.c.id)
    })
    expect(kiosks.platformAt.size).toBeGreaterThanOrEqual(2)
    for (const [id, at] of kiosks.platformAt) {
      const gone = kiosks.abortedAt.get(id)
      // the stand-in marks the moment it told them to sit; the cap runs from when they reached the platform, a few seconds earlier
      if (gone === undefined) continue
      expect(gone - at, `${id} was held ${(gone - at).toFixed(0)} s after sitting down`).toBeGreaterThanOrEqual(150)
      expect(gone - at, `${id}`).toBeLessThanOrEqual(310)
    }
    expect(kiosks.aborted.length).toBeGreaterThanOrEqual(1)
    // every aborted patient went on to triage (their place was kept: nobody was left waiting for the kiosk)
    for (const id of kiosks.aborted) expect(triaged.has(id) || !sim.world.patients.has(id), `${id} got triaged after the abort`).toBe(true)
  }, 300_000)

  it('is told to glide onto the platform when the kiosk starts without them (kioskForced)', () => {
    kioskTuning.minAhead = 0
    const sim = new Simulation(404)
    const kiosks = new StandInKiosks()
    kiosks.forceAfter = 0.01
    sim.world.vitals = kiosks as unknown as VitalsService
    const onPlatform = new Set<string>()
    const platform = HEALTH_KIOSKS[0].stand.at
    runWith(sim, kiosks, 25, (p) => {
      if (kiosks.line.some((s) => s.subject.id === p.c.id && s.state === 'sitting') && Math.hypot(p.x - platform.x, p.z - platform.z) < 0.35 && p.mode === 'static') onPlatform.add(p.c.id)
    })
    expect(kiosks.offers.length).toBeGreaterThanOrEqual(1)
    expect(onPlatform.size).toBeGreaterThanOrEqual(1)
  }, 300_000)

  it('with the optional brake on, a walk-in only stops at a kiosk when there is a wait to fill: two or more patients already waiting for triage ahead of them', () => {
    kioskTuning.minAhead = 2
    const sim = new Simulation(404, { startHour: 10 }) // the busy hour: the triage line is long enough
    const kiosks = new StandInKiosks()
    const offer = kiosks.offer.bind(kiosks)
    const aheadAtOffer: number[] = []
    kiosks.offer = (subject, kind) => {
      const me = sim.world.er.cases.get(subject.id)!
      let n = 0
      for (const o of sim.world.er.cases.values()) if (o !== me && o.state === 'waitingTriage' && !o.ambulance && o.arrivedAt <= me.arrivedAt) n++
      aheadAtOffer.push(n)
      return offer(subject, kind)
    }
    sim.world.vitals = kiosks as unknown as VitalsService
    runWith(sim, kiosks, 60, () => {})
    expect(aheadAtOffer.length).toBeGreaterThanOrEqual(1)
    for (const n of aheadAtOffer) expect(n).toBeGreaterThanOrEqual(kioskTuning.minAhead)
  }, 300_000)
})
