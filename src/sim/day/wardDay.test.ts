/**
 * Wave 1 "A real clinical day" for the wards, over a whole simulated day: medicines on their dose times (no medicine twice inside its
 * dosing interval), the 08:00 and 22:00 waves, ONE morning ward round and no round at night, the 19:00 ward change and the night team
 * on site from 22:00 to 07:00 doing quiet checks, and determinism. The day and the night are each simulated once and feed every check.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { doseHoursOf, minDoseGapSeconds } from '@/content/catalogue'
import { CONFIG } from '../config'
import { Doctor, Nurse } from '../people'
import { Simulation } from '../Simulation'
import type { Order, SimEvent } from '../types'
import { clockHourAt, onShift, timeOfClockHour } from './roster'
import { DT, hourT } from './testkit'

const T = timeOfClockHour
const DAY_STAFF = ['nurse-A1', 'nurse-A2', 'nurse-B1', 'nurse-B2', 'doc-A', 'doc-B']
const NIGHT_STAFF_IDS = ['nurse-N-A', 'nurse-N-B', 'doc-N']

interface Watched {
  presence: { hour: number; ids: Set<string> }[]
  doctors: Set<Doctor>
  nurses: Set<Nurse>
  /** Every huddle and hand-over line (the event log keeps only the last 2000). */
  lines: SimEvent[]
  lastId: number
}

/** Step to `until` (sim time), sampling who is on site every 30 s of sim time. */
function runWatched(sim: Simulation, until: number, w: Watched): void {
  while (sim.t < until) {
    for (let k = 0; k < 1800; k++) sim.step(DT)
    const ids = new Set<string>()
    for (const p of sim.people) {
      ids.add(p.entity.id)
      if (p instanceof Doctor) w.doctors.add(p)
      if (p instanceof Nurse) w.nurses.add(p)
    }
    w.presence.push({ hour: clockHourAt(sim.t), ids })
    for (const e of sim.log.since(w.lastId)) {
      w.lastId = e.id
      if (e.type === 'huddle' || e.type === 'shiftHandover') w.lines.push(e)
    }
  }
}

const watched = (): Watched => ({ presence: [], doctors: new Set(), nurses: new Set(), lines: [], lastId: 0 })

function visitsOf(set: Set<Doctor>): { doctor: string; t: number; roomId: string; patientId: string; kind: string }[] {
  return [...set].flatMap((d) => d.visits.map((v) => ({ doctor: d.staff.id, ...v })))
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the day: 07:30 to 23:30
// ---------------------------------------------------------------------------------------------------------------------------------

let day: Simulation
const dayW = watched()
/** The occupants of each room at 08:31, just after the round started. */
let atRoundStart: { roomId: string; patientId: string }[] = []

beforeAll(() => {
  day = new Simulation(2026)
  runWatched(day, T(8.5) + 90, dayW)
  atRoundStart = [...day.beds.board.rooms.keys()].flatMap((r) => {
    const o = day.beds.board.occupantOf(r)
    return o ? [{ roomId: r, patientId: o.id }] : []
  })
  runWatched(day, T(23.5), dayW)
}, 1_800_000)

const allOrders = (): Order[] => [...day.meds.orders.values()]

describe('medicines on real dose times (a whole day)', () => {
  it('no patient gets the same medicine twice inside its dosing interval', () => {
    const doses = new Map<string, number[]>()
    for (const o of allOrders()) {
      if (o.cancelledAt !== undefined || o.source === 'discharge' || o.source === 'presenter') continue
      for (const i of o.items) {
        const k = `${o.patientId}|${i.medId}`
        doses.set(k, [...(doses.get(k) ?? []), o.doseAt])
      }
    }
    let pairs = 0
    for (const [k, times] of doses) {
      const med = k.split('|')[1]
      times.sort((a, b) => a - b)
      for (let i = 1; i < times.length; i++) {
        pairs++
        expect(times[i] - times[i - 1], `${k} at ${clockHourAt(times[i - 1]).toFixed(2)} and ${clockHourAt(times[i]).toFixed(2)}`).toBeGreaterThanOrEqual(minDoseGapSeconds(med) - 61)
      }
    }
    // the day really had repeated doses to check (paracetamol four times a day, ...)
    expect(pairs).toBeGreaterThan(10)
  })

  it('every scheduled order carries only medicines that are due at its dose hour, and is given', () => {
    const waves = allOrders().filter((o) => o.source === 'schedule')
    expect(waves.length).toBeGreaterThan(20)
    for (const o of waves) {
      const hour = clockHourAt(o.doseAt)
      const wave = CONFIG.doseWaves.hours.find((h) => Math.abs(T(h) - o.doseAt) < 2)
      expect(wave, `${o.id} at ${hour.toFixed(2)}`).toBeDefined()
      for (const i of o.items) expect(doseHoursOf(i.medId), `${o.id} ${i.medId}`).toContain(wave)
      expect(o.items.length).toBeLessThanOrEqual(CONFIG.orders.maxItems)
      if (o.cancelledAt === undefined && o.createdAt < T(23)) expect(o.stage, `${o.id} ${o.roomId}`).toBe('given')
    }
  })

  it('the 08:00 wave goes out at the 07:30 opening with the morning medicines; the 22:00 wave carries the night ones (statin, senna)', () => {
    const at = (h: number) => allOrders().filter((o) => o.source === 'schedule' && Math.abs(o.doseAt - T(h)) < 2)
    const morning = at(8)
    expect(morning.length).toBeGreaterThanOrEqual(10)
    for (const o of morning) expect(o.createdAt).toBeLessThan(5)
    const meds = (os: Order[]) => new Set(os.flatMap((o) => o.items.map((i) => i.medId)))
    for (const m of ['furosemide', 'bisoprolol', 'levothyroxine', 'colecalciferol', 'amlodipine']) expect(meds(morning).has(m), m).toBe(true)
    for (const m of ['atorvastatin', 'senna']) expect(meds(morning).has(m), m).toBe(false)
    const night = at(22)
    expect(night.length).toBeGreaterThan(3)
    expect(meds(night).has('atorvastatin')).toBe(true)
    for (const m of ['furosemide', 'bisoprolol', 'levothyroxine', 'colecalciferol', 'omeprazole']) expect(meds(night).has(m), m).toBe(false)
    for (const o of night) expect(o.createdAt).toBeGreaterThanOrEqual(T(21.5) - 1)
  })

  it('the doctors write rounds orders only now and then, never a duplicate of a pending medicine', () => {
    const sim = allOrders().filter((o) => o.source === 'sim')
    const visits = visitsOf(dayW.doctors).length
    // about changeChance of the visits (and a refused duplicate writes nothing): far fewer than one order a visit
    expect(sim.length).toBeLessThan(visits * 0.6)
    for (const o of sim) {
      expect(o.items.length).toBe(1)
      expect(o.doseAt - o.createdAt).toBeCloseTo(CONFIG.orders.roundDoseDelaySeconds, 3)
    }
  })
})

describe('ONE ward round each morning (a whole day)', () => {
  const round = () => visitsOf(dayW.doctors).filter((v) => v.kind === 'round')

  it('each ward doctor sees each occupied bed once, between 08:30 and 11:00 (6-10 minutes a bed), then rounds no more', () => {
    const r = round()
    expect(r.length).toBeGreaterThanOrEqual(10)
    for (const v of r) {
      expect(clockHourAt(v.t), `${v.doctor} ${v.roomId}`).toBeGreaterThanOrEqual(CONFIG.people.round.startHour - 0.01)
      expect(clockHourAt(v.t), `${v.doctor} ${v.roomId}`).toBeLessThan(CONFIG.people.round.endHour + 1.5)
    }
    const key = (v: { doctor: string; patientId: string }) => `${v.doctor}|${v.patientId}`
    expect(new Set(r.map(key)).size).toBe(r.length)
    // everyone who was in bed when the round began was seen on it, unless they went home first
    const home = new Set(day.beds.board.log.wentHome.map((x) => x.patientId))
    for (const o of atRoundStart) {
      const ward = o.roomId[0] === 'A' ? 'doc-A' : 'doc-B'
      const seen = r.some((v) => v.doctor === ward && v.patientId === o.patientId)
      expect(seen || home.has(o.patientId), `${o.roomId} ${o.patientId}`).toBe(true)
    }
    // the bedside visits are minutes long, and the nurse is rarely missing: the doctor is at a bed for the whole 6-10 minutes
    const starts = r.filter((v) => v.doctor === 'doc-A').map((v) => v.t)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(CONFIG.people.round.bedsideSeconds[0])
  })

  it('does not round in the afternoon or at night: only a signature or a review of a new admission', () => {
    for (const v of visitsOf(dayW.doctors)) {
      if (v.kind === 'round') continue
      expect(['sign', 'review']).toContain(v.kind)
    }
    const late = visitsOf(dayW.doctors).filter((v) => clockHourAt(v.t) >= 15)
    for (const v of late) expect(v.kind, `${v.doctor} ${v.roomId} at ${clockHourAt(v.t).toFixed(2)}`).not.toBe('round')
    // the afternoon review is of patients who were not on the morning round
    const seenMorning = new Set(round().map((v) => v.patientId))
    for (const v of visitsOf(dayW.doctors).filter((x) => x.kind === 'review')) expect(seenMorning.has(v.patientId), v.patientId).toBe(false)
  })

  it('signs every planned discharge that falls due, on the round or at the desk', () => {
    // A1, B5, B4, A6, B2 and A8 are planned to go home today (the event log keeps only the last 2000 lines: read the board's own)
    expect(day.beds.board.log.wentHome.map((h) => h.roomId).sort()).toEqual(['A1', 'A6', 'A8', 'B2', 'B4', 'B5'])
    const signs = visitsOf(dayW.doctors).filter((v) => v.kind === 'sign' || v.kind === 'round')
    for (const room of ['A1', 'A6', 'A8', 'B2', 'B4', 'B5']) expect(signs.some((v) => v.roomId === room), room).toBe(true)
    for (const o of allOrders().filter((x) => x.source === 'discharge')) expect(o.prescriberId).toMatch(/^doc-[AB]$/)
  })
})

describe('the ward change at 19:00 and the night team (a whole day)', () => {
  const at = (h: number) => dayW.presence.filter((p) => Math.abs(p.hour - h) < 0.01)

  it('the day team is on site by day and the night team is not', () => {
    for (const s of [at(9), at(13), at(17)].flat()) {
      for (const id of DAY_STAFF) expect(s.ids.has(id), `${id} at ${s.hour.toFixed(2)}`).toBe(true)
      for (const id of NIGHT_STAFF_IDS) expect(s.ids.has(id), `${id} at ${s.hour.toFixed(2)}`).toBe(false)
    }
  })

  it('from 20:00 on the day ward staff are gone and the night ward staff are on site', () => {
    const night = dayW.presence.filter((p) => p.hour >= 20 && p.hour < 23.5)
    expect(night.length).toBeGreaterThan(100)
    for (const s of night) {
      for (const id of DAY_STAFF) expect(s.ids.has(id), `${id} at ${s.hour.toFixed(2)}`).toBe(false)
      for (const id of NIGHT_STAFF_IDS) expect(s.ids.has(id), `${id} at ${s.hour.toFixed(2)}`).toBe(true)
    }
  })

  it('both teams are on site together only around the 19:00 handover', () => {
    const both = dayW.presence.filter((p) => NIGHT_STAFF_IDS.some((id) => p.ids.has(id)) && DAY_STAFF.some((id) => p.ids.has(id)))
    expect(both.length).toBeGreaterThan(0)
    for (const s of both) {
      expect(s.hour, 'overlap').toBeGreaterThan(18.6)
      expect(s.hour, 'overlap').toBeLessThan(19.4)
    }
  })

  it('they hand over with a huddle at the hub and at each bedside, and the hand-overs are written', () => {
    const texts = dayW.lines.filter((e) => e.type === 'shiftHandover').map((e) => e.text)
    expect(texts).toContain('Nurse Ottilie took over ward A from Nurse Maya.')
    expect(texts).toContain('Nurse Rhys took over ward B from Nurse Leah.')
  })

  it('the morning safety huddle takes place at each nurse hub at 07:33', () => {
    const h = dayW.lines.filter((e) => e.type === 'huddle')
    expect(h.map((e) => e.text.split(' huddle')[0]).sort()).toEqual(['Nurse hub A', 'Nurse hub B'])
    for (const e of h) {
      expect(e.t).toBeGreaterThanOrEqual(T(CONFIG.day.safetyHuddle.atHour) - 1)
      expect(e.t).toBeLessThan(T(CONFIG.day.safetyHuddle.atHour) + CONFIG.day.safetyHuddle.seconds)
    }
  })

  it('the day team that went home never works the night: the on-call doctor reviews, and no round is made', () => {
    const night = visitsOf(dayW.doctors).filter((v) => clockHourAt(v.t) >= 19.5)
    for (const v of night) {
      expect(v.doctor).toBe('doc-N')
      expect(v.kind).toBe('review')
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// the night: 21:50 to 07:40 the next morning
// ---------------------------------------------------------------------------------------------------------------------------------

let night: Simulation
const nightW = watched()

beforeAll(() => {
  night = new Simulation(2026, { startHour: 21 + 50 / 60 })
  runWatched(night, hourT(31 + 40 / 60), nightW)
}, 1_800_000)

describe('the night (21:50 to 07:40)', () => {
  // (the day team comes in 5-10 minutes early, through the lockers: they are on site together only around 07:00)
  it('the night ward staff are on site from 22:00 to 07:00 and the day ward staff are not', () => {
    const inside = nightW.presence.filter((p) => p.hour >= 22 && p.hour < 30.7)
    expect(inside.length).toBeGreaterThan(1000)
    for (const s of inside) {
      for (const id of NIGHT_STAFF_IDS) expect(s.ids.has(id), `${id} at ${s.hour.toFixed(2)}`).toBe(true)
      for (const id of DAY_STAFF) expect(s.ids.has(id), `${id} at ${s.hour.toFixed(2)}`).toBe(false)
    }
    expect(onShift('nurse-N-A', 23)).toBe(true)
  })

  it('at 07:00 the night team hands over to the day team and goes home; by 07:40 the day team is on post', () => {
    const end = nightW.presence.at(-1)!
    for (const id of DAY_STAFF) expect(end.ids.has(id), id).toBe(true)
    for (const id of NIGHT_STAFF_IDS) expect(end.ids.has(id), id).toBe(false)
    expect(nightW.lines.filter((e) => e.type === 'shiftHandover').map((e) => e.text)).toContain('Nurse Maya took over ward A from Nurse Ottilie.')
  })

  it('each night nurse looks into every room of her ward on every night round (22:30, 00:30, 02:30, 04:30)', () => {
    for (const id of ['nurse-N-A', 'nurse-N-B']) {
      const n = [...nightW.nurses].find((x) => x.staff.id === id)!
      expect(n, id).toBeDefined()
      const ward = id.endsWith('A') ? 'A' : 'B'
      for (const start of [22.5, 24.5, 26.5, 28.5]) {
        const looks = n.nightLooks.filter((l) => clockHourAt(l.t) >= start && clockHourAt(l.t) < start + 0.5)
        expect(new Set(looks.map((l) => l.roomId)).size, `${id} round ${start}`).toBe(8)
        for (const l of looks) expect(l.roomId[0]).toBe(ward)
      }
      // none by day or outside the rounds
      for (const l of n.nightLooks) expect(clockHourAt(l.t)).toBeLessThan(30)
    }
  })

  it('the on-call doctor never makes a round at night', () => {
    const v = visitsOf(nightW.doctors)
    for (const x of v) expect(x.kind).toBe('review')
    for (const x of v.filter((y) => y.doctor === 'doc-N')) expect(x.kind).toBe('review')
  })

  it('the night nurse gives the 22:00 doses on her own', () => {
    const wave = [...night.meds.orders.values()].filter((o) => o.source === 'schedule' && Math.abs(o.doseAt - T(22)) < 2)
    expect(wave.length).toBeGreaterThan(3)
    for (const o of wave) {
      expect(o.stage, o.roomId).toBe('given')
      expect(o.stageAt.given!).toBeLessThan(T(22) + 25 * 60)
    }
  })
})

describe('determinism', () => {
  it('the same seed gives the same orders, round and event log (08:20 to 10:00)', () => {
    const go = () => {
      const s = new Simulation(31, { startHour: 8 + 20 / 60 })
      const w = watched()
      runWatched(s, hourT(10), w)
      return {
        orders: [...s.meds.orders.values()].map((o) => `${o.id} ${o.roomId} ${o.source} ${o.doseAt.toFixed(1)} ${o.items.map((i) => i.medId).join('+')}`),
        visits: visitsOf(w.doctors).map((v) => `${v.doctor} ${v.t.toFixed(2)} ${v.roomId} ${v.kind}`),
        log: s.log.events.map((e) => `${e.t.toFixed(2)} ${e.type} ${e.text}`),
      }
    }
    const a = go()
    const b = go()
    expect(a.visits.length).toBeGreaterThan(5)
    expect(a.orders.length).toBeGreaterThan(5)
    expect(b).toEqual(a)
  }, 600_000)
})
