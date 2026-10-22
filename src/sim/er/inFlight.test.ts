import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'
import type { ErCase } from './department'

const SEED = 42

function build(opts: ConstructorParameters<typeof Simulation>[1] = {}, seed = SEED): Simulation {
  return new Simulation(seed, { inFlight: true, opening: 'showcase', ...opts })
}

function fingerprint(s: Simulation): string[] {
  return [...s.world.er.cases.values()].map((c) => `${c.id} ${c.name} ${c.acuity} ${c.state} bay${c.bay} tb${c.triageBay} ${c.arrivedAt.toFixed(1)}`)
}

function positions(s: Simulation): string[] {
  return [...s.entities.values()].filter((e) => e.role === 'patient').map((e) => `${e.id} ${e.position.x.toFixed(3)},${e.position.z.toFixed(3)} ${e.stage}`)
}

describe('S1 ER in-flight warm', () => {
  it('places the configured patients through the WARM events, logging nothing: the bays are mid-stay, not waiting for a doctor', () => {
    const s = build()
    const want = CONFIG.opening.er
    const cases = [...s.world.er.cases.values()]
    const by = (st: string) => cases.filter((c) => c.state === st)
    expect(by('waitingTriage')).toHaveLength(want.triage)
    expect(by('waitingDoctor')).toHaveLength(want.doctor)
    // the bays: part-way through the nurse's care, the assessment, the wait for the lab, the doctor's review
    expect(by('inBay.care')).toHaveLength(1)
    expect(by('inBay.exam')).toHaveLength(1)
    expect(by('inBay.review')).toHaveLength(1)
    expect(by('tests.awaitingResults')).toHaveLength(2)
    expect(by('inBay.waitingExam')).toHaveLength(0)
    const inBay = cases.filter((c) => c.bay >= 0)
    expect(inBay.length).toBeGreaterThanOrEqual(Math.max(want.bay, 5))
    for (const c of inBay) {
      expect(c.onTrolley).toBe(true)
      expect(s.world.er.bays[c.bay].caseId).toBe(c.id)
      expect(s.seats.byId(s.world.er.bays[c.bay].seat.id)).toBeTruthy()
    }
    // the staff are at those bedsides already
    expect(by('inBay.care')[0].careBy).not.toBeNull()
    expect(by('inBay.exam')[0].doctorId).not.toBeNull()
    expect(by('inBay.review')[0].doctorId).not.toBeNull()
    for (const c of by('waitingTriage')) expect(c.ready).toBe(true)
    // those waiting for a doctor are held a little (so they are still in the rows after the pre-roll), then called
    const held = by('waitingDoctor')
    for (const c of held) expect(c.ready).toBe(false)
    // nothing was said while placing
    expect(s.log.events.filter((e) => e.type === 'patientArrived' || e.type === 'checkedIn' || e.type === 'triaged' || e.type === 'seenByDoctor')).toHaveLength(0)
    expect(s.world.quiet).toBe(false)
    // placed like the Director's patients: in the roster, with a name, a body on a seat or trolley
    for (const c of cases) {
      const e = s.entities.get(c.id)!
      expect(e).toBeDefined()
      expect(e.name).toBe(c.name)
      expect(e.seated).toBeDefined()
    }
    // (with the bays mid-stay they wait for a bay to free: they are called only as the stays end)
    s.preRoll(130)
  })

  it('after the 50 s showcase pre-roll the ER is visibly at work, and no bay was freed and sent home at once', () => {
    const s = build()
    s.preRoll(CONFIG.opening.preRollSeconds)
    const er = s.world.er
    expect(er.triageBays.filter((b) => b.state === 'occupied').length).toBeGreaterThanOrEqual(1)
    expect(er.bays.filter((b) => b.state === 'occupied').length).toBeGreaterThanOrEqual(4)
    expect(er.bays.filter((b) => b.state === 'free').length).toBeLessThanOrEqual(2)
    const cases = [...er.cases.values()]
    expect(cases.some((c) => c.state === 'waitingDoctor')).toBe(true)
    // a doctor is with a patient (an assessment or a review), a nurse is at a bedside
    expect(cases.some((c) => c.state === 'inBay.exam' || c.state === 'inBay.review')).toBe(true)
    expect(cases.some((c) => c.state === 'inBay.care' || c.careBy !== null)).toBe(true)
    // nobody was lost or sent home in the pre-roll
    expect(er.finished).toHaveLength(0)
  })

  it('also works on a Jump to other hours (60 s pre-roll)', () => {
    for (const startHour of [9, 11.5, 14, 18]) {
      const s = build({ startHour })
      s.preRoll(60)
      const er = s.world.er
      expect(er.bays.filter((b) => b.state === 'occupied').length, `bays at ${startHour}`).toBeGreaterThanOrEqual(4)
      expect(er.triageBays.filter((b) => b.state === 'occupied').length, `triage at ${startHour}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('is deterministic: two builds are identical, before and after the pre-roll', () => {
    const a = build()
    const b = build()
    expect(fingerprint(a)).toEqual(fingerprint(b))
    a.preRoll(50)
    b.preRoll(50)
    expect(fingerprint(a)).toEqual(fingerprint(b))
    expect(positions(a)).toEqual(positions(b))
    expect(fingerprint(build({}, 7))).not.toEqual(fingerprint(a))
  })

  it('every placed patient progresses and finishes; nothing is stuck', () => {
    const s = build()
    const placed = [...s.world.er.cases.values()].map((c) => c.id)
    const first = new Map<string, string>()
    for (const c of s.world.er.cases.values()) first.set(c.id, c.state)
    s.preRoll(5 * 3600)
    const er = s.world.er
    const done = new Set(er.finished.map((f) => f.id))
    const live = new Map<string, ErCase>(er.cases)
    for (const id of placed) {
      const c = live.get(id)
      // finished (discharged, admitted or gave up) or at least moved past where it was placed and not parked in a waiting state
      if (done.has(id)) continue
      expect(c, `${id} vanished without an outcome`).toBeDefined()
      expect(c!.state, `${id} is still ${first.get(id)}`).not.toBe(first.get(id))
    }
    // real stays are 1-4 h: most of the placed patients have an outcome after five hours
    expect(placed.filter((id) => done.has(id)).length).toBeGreaterThanOrEqual(placed.length - 3)
    // bays are cleaned and nobody holds a bay or triage chair without being in the department
    expect(er.maxCleanWait).toBeLessThanOrEqual(45 * 60)
    for (const b of er.bays) if (b.state === 'occupied') expect(live.get(b.caseId!)?.bay).toBe(b.index)
    for (const b of er.triageBays) if (b.state === 'occupied') expect(live.get(b.caseId!)?.triageBay).toBe(b.index)
    expect(er.finished.map((f) => f.id)).toEqual([...new Set(er.finished.map((f) => f.id))])
  }, 300_000)

  it('leaves the default start unchanged', () => {
    const plain = new Simulation(SEED)
    const quiet = new Simulation(SEED, { inFlight: false, opening: 'quiet' })
    expect(plain.world.er.cases.size).toBe(0)
    expect(plain.inFlight).toBe(false)
    plain.preRoll(120)
    quiet.preRoll(120)
    expect(fingerprint(plain)).toEqual(fingerprint(quiet))
    expect(plain.log.events.map((e) => `${e.t} ${e.type} ${e.text}`)).toEqual(quiet.log.events.map((e) => `${e.t} ${e.type} ${e.text}`))
  })
})
