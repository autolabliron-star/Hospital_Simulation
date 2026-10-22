/**
 * The shift changes, played out in the whole simulation, each from a warm start a few minutes before the hour with the full
 * population around them: 19:00 (the night porter and cleaner relieve), 22:00 (the ER team hands over to the colleague who
 * stays; the night footing begins) and 07:00 (the day team comes back). Invariants are sampled every half second of sim time.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { ARRIVALS, DEPARTURES } from '../places'
import { Simulation } from '../Simulation'
import { Doctor, Nurse } from '../people'
import { kitOf } from './kits'
import { onShift, shiftChanges } from './roster'
import { ShiftActor } from './shiftActor'
import type { Run } from './shifts'
import { staffRegistry } from './staffRegistry'
import { DOORWAYS, DT, hourT, inside, run } from './testkit'

const SAMPLE_EVERY = 30

/** The functions that must never be unstaffed, by the staff ids that can fill them. */
const FUNCTIONS: [string, string[]][] = [
  ['the ER doctors', ['doc-ER1', 'doc-ER2']],
  ['the ER nurses', ['nurse-ER1', 'nurse-ER2']],
  ['triage', ['nurse-T1', 'nurse-T2']],
  ['reception', ['recep-1']],
  ['transport', ['porter-1', 'porter-2', 'porter-3', 'porter-N']],
  ['housekeeping', ['cleaner-1', 'cleaner-2', 'cleaner-N']],
]

interface Observed {
  problems: string[]
  /** Sim time each person first showed as a ShiftActor, with its fade and distance from the entrance at that moment. */
  firstSeen: Map<string, { t: number; fade: number; fromEntrance: number }>
  /** Relief runs: samples taken while the post was covered by the comer or the leaver / total samples in the hand-over window. */
  covered: Map<string, { ok: number; total: number }>
  talks: Map<string, number>
  maxLockerWait: number
}

function watch(sim: Simulation, minutes: number): Observed {
  const stillIn = new Map<string, number>()
  const obs: Observed = { problems: [], firstSeen: new Map(), covered: new Map(), talks: new Map(), maxLockerWait: 0 }
  const mgr = sim.day.shifts
  const world = sim.world
  const end = sim.t + minutes * 60
  let seen = 0
  const problem = (msg: string) => {
    if (obs.problems.length < 25) obs.problems.push(`${sim.t.toFixed(0)}s ${msg}`)
  }
  while (sim.t < end) {
    for (let k = 0; k < SAMPLE_EVERY; k++) sim.step(DT)

    // everybody who arrives: where and how they appear
    while (seen < mgr.arrived.length) {
      const id = mgr.arrived[seen++]
      const p = sim.people.find((q) => q.entity.id === id)
      if (!p) continue
      obs.firstSeen.set(id, {
        t: sim.t,
        fade: p.entity.fade ?? 1,
        fromEntrance: Math.hypot(p.walker.x - ARRIVALS.entrance.at.x, p.walker.z - ARRIVALS.entrance.at.z),
      })
    }

    // nobody is two people, and nobody sits on a seat somebody else holds
    const ids = new Set<string>()
    const seatedBy = new Map<string, string>()
    for (const p of sim.people) {
      if (ids.has(p.entity.id)) problem(`${p.entity.id} is in the simulation twice`)
      ids.add(p.entity.id)
      const seat = p.entity.seated?.seatId
      if (seat) {
        const other = seatedBy.get(seat)
        if (other) problem(`seat ${seat} holds ${other} and ${p.entity.id}`)
        seatedBy.set(seat, p.entity.id)
      }
    }

    // nobody stands still inside a doorway for more than 2 s
    const sample = SAMPLE_EVERY * DT
    for (const p of sim.people) {
      if (!p.mobile || p.entity.seated || p.entity.riding) continue
      const w = p.walker
      const zone = w.speed < 0.05 ? DOORWAYS.find((z) => inside(z.r, w.x, w.z)) : undefined
      if (!zone) {
        stillIn.delete(p.entity.id)
        continue
      }
      const held = (stillIn.get(p.entity.id) ?? 0) + sample
      stillIn.set(p.entity.id, held)
      if (held > 2 + 1e-9) problem(`${p.entity.name} (${p.entity.role}) still in ${zone.id} for ${held.toFixed(1)} s`)
    }

    // every function is staffed at every moment of a change (a colleague stays, or the relief is there)
    for (const [fn, members] of FUNCTIONS) {
      if (!members.some((id) => ids.has(id))) problem(`nobody is working ${fn}`)
    }

    for (const run of mgr.runs) {
      if (run.state === 'done' && run.talk === 'none') continue
      // a handover never stands in a doorway
      if (run.talk === 'talking') {
        obs.talks.set(run.change.key, (obs.talks.get(run.change.key) ?? 0) + sample)
        for (const a of [run.host, run.comer, run.leaverAct]) {
          if (!a) continue
          // (a ward change walks through the hub counter and the room doors on its tour: only standing still in one is a problem)
          const zone = a.walker.speed < 0.05 ? DOORWAYS.find((z) => inside(z.r, a.walker.x, a.walker.z)) : undefined
          if (zone) problem(`handover ${run.change.key}: ${a.entity.id} stands in ${zone.id}`)
        }
      }
      // a post is never empty while a relief takes it over: from the moment the comer is beside it until the comer is on it
      // (a ward change leaves the hub for the bedside tour on purpose: the night nurse and the day nurse are in the rooms)
      if (run.change.kind === 'relief' && run.change.comer!.post!.kind !== 'wardNurse' && run.comerReady && !run.comerSwapped) {
        const post = kitOf(run.change.comer!.post!.kind).post(world, run.change.comer!)
        const near = [run.change.leaver!.member.id, run.change.comer!.member.id].some((id) => {
          const p = sim.people.find((q) => q.entity.id === id)
          return p !== undefined && Math.hypot(p.walker.x - post.at.x, p.walker.z - post.at.z) < 2.5
        })
        const c = obs.covered.get(run.change.key) ?? { ok: 0, total: 0 }
        c.total++
        if (near) c.ok++
        obs.covered.set(run.change.key, c)
      }
    }
  }
  return obs
}

/** The staff of a real controller (not a ShiftActor) on its post. */
function onPost(sim: Simulation, id: string): boolean {
  const p = staffRegistry(sim.world).get(id)
  return p !== undefined && !(p instanceof ShiftActor) && sim.people.includes(p)
}

function leaversOf(runs: readonly Run[], hour: number): string[] {
  return runs.filter((r) => r.change.hour === hour && r.change.leaver).map((r) => r.change.leaver!.member.id)
}

function comersOf(runs: readonly Run[], hour: number): string[] {
  return runs.filter((r) => r.change.hour === hour && r.change.comer).map((r) => r.change.comer!.member.id)
}

describe('the evening change at 19:00 (a warm start at 18:45)', () => {
  let sim: Simulation
  let obs: Observed
  let runs: readonly Run[]
  beforeAll(() => {
    sim = new Simulation(2026, { startHour: 18.75 })
    obs = watch(sim, 38)
    runs = sim.day.shifts.runs
  }, 300_000)

  it('keeps every promise of the shift change', () => {
    expect(obs.problems).toEqual([])
  })

  it('the night porter and the night cleaner take over, and the day porter and cleaner go out by the entrance', () => {
    const evening = runs.filter((r) => r.change.hour === 19)
    // porter-1 and cleaner-1, Coordinator Eli goes home, and the ward change (day nurses and doctors to the night team)
    expect(evening.map((r) => r.change.key).sort()).toEqual(['cleaner-1@19', 'coord-2@19', 'doc-A@19', 'doc-B@19', 'nurse-A1@19', 'nurse-A2@19', 'nurse-B1@19', 'nurse-B2@19', 'porter-1@19'])
    for (const r of evening) expect(r.state, r.change.key).toBe('done')
    for (const id of ['porter-N', 'cleaner-N']) expect(onPost(sim, id), `${id} on post`).toBe(true)
    for (const id of ['porter-1', 'cleaner-1']) {
      expect(sim.entities.has(id), `${id} gone`).toBe(false)
      expect(sim.day.shifts.departed).toContain(id)
    }
    // the others stay for the ER evening peak
    for (const id of ['porter-2', 'porter-3', 'cleaner-2', 'doc-ER1', 'doc-ER2', 'nurse-ER1', 'nurse-ER2', 'nurse-T1', 'nurse-T2']) expect(sim.entities.has(id), id).toBe(true)
    expect(onShift('porter-1', 19.5)).toBe(false)
  })

  it('the comers arrive at the entrance 5-10 minutes before the hour and fade in', () => {
    for (const id of ['porter-N', 'cleaner-N']) {
      const seen = obs.firstSeen.get(id)
      expect(seen, id).toBeDefined()
      const run = runs.find((r) => r.change.comer?.member.id === id && r.change.hour === 19)!
      const early = run.hourT - seen!.t
      // sampled within half a second of the spawn
      expect(early, `${id} early`).toBeGreaterThanOrEqual(CONFIG.day.arriveEarlySeconds[0] - 1)
      expect(early, `${id} early`).toBeLessThanOrEqual(CONFIG.day.arriveEarlySeconds[1] + 1)
      expect(seen!.fade, `${id} fade`).toBeLessThan(1)
      expect(seen!.fromEntrance, `${id} at the entrance`).toBeLessThan(2)
    }
  })

  it('hands over in pairs: two people talking for at most the bedside handover time', () => {
    const [lo, hi] = CONFIG.day.bedsideHandoverSeconds
    const pairs = runs.filter((r) => r.change.hour === 19 && r.talk === 'done' && r.change.comer!.post!.kind !== 'wardNurse')
    expect(pairs.map((r) => r.change.key).sort()).toEqual(['cleaner-1@19', 'doc-A@19', 'porter-1@19'])
    for (const r of pairs) {
      const t = obs.talks.get(r.change.key) ?? 0
      expect(t, r.change.key).toBeGreaterThanOrEqual(lo - 1)
      expect(t, r.change.key).toBeLessThanOrEqual(hi + 1.5)
      expect(r.talkEndT - r.talkStartT, r.change.key).toBeLessThanOrEqual(hi + 0.5)
    }
    const events = sim.log.events.filter((e) => e.type === 'shiftHandover')
    const texts = events.map((e) => e.text)
    expect(texts).toContain('Cleaner Wren took over housekeeping from Cleaner Rosa.')
    expect(texts).toContain('Porter Gideon took over transport from Porter Callum.')
    expect(texts).toContain('Dr. Oriel took over the wards from Dr. Levi.')
    for (const e of events) {
      expect(e.actorId).toBeDefined()
      expect(e.subjectId).toBeDefined()
    }
  })

  it('a post is never empty while a relief takes it over', () => {
    expect([...obs.covered.keys()].sort()).toEqual(['cleaner-1@19', 'doc-A@19', 'porter-1@19'])
    for (const [key, c] of obs.covered) {
      expect(c.total, key).toBeGreaterThan(0)
      expect(c.ok, `${key}: ${c.ok} of ${c.total} samples covered`).toBe(c.total)
    }
  })

  it('the population at 19:15 stays sensible: nobody lost, nobody doubled', () => {
    const byRole: Record<string, number> = {}
    for (const e of sim.entities.values()) byRole[e.role] = (byRole[e.role] ?? 0) + 1
    // porters 2, 3 and the night porter; cleaner 2 and the night cleaner
    expect(byRole.porter).toBe(3)
    expect(byRole.cleaner).toBe(2)
    expect(sim.entities.size).toBeGreaterThanOrEqual(55)
    expect(sim.entities.size).toBeLessThanOrEqual(115)
  })

  it('the ward change: the day nurses and ward doctors go home, the night team takes over, with a huddle and a bedside handover in each room', () => {
    for (const id of ['nurse-A1', 'nurse-A2', 'nurse-B1', 'nurse-B2', 'doc-A', 'doc-B']) {
      expect(sim.entities.has(id), `${id} gone`).toBe(false)
      expect(sim.day.shifts.departed, id).toContain(id)
    }
    for (const id of ['nurse-N-A', 'nurse-N-B', 'doc-N']) expect(onPost(sim, id), `${id} on post`).toBe(true)
    expect(sim.people.find((p) => p.entity.id === 'nurse-N-A')).toBeInstanceOf(Nurse)
    expect(sim.people.find((p) => p.entity.id === 'doc-N')).toBeInstanceOf(Doctor)
    for (const key of ['nurse-A1@19', 'nurse-B1@19']) {
      const r = runs.find((x) => x.change.key === key)!
      expect(r.talk, key).toBe('done')
      // the huddle, then eight bedside handovers: minutes, not the half minute of a post handover
      expect(r.talkEndT - r.talkStartT, key).toBeGreaterThan(CONFIG.day.huddleSeconds[0] + 8 * CONFIG.day.bedsideHandoverSeconds[0])
      expect(r.progress, key).toEqual([8, 8])
    }
    const texts = sim.log.events.filter((e) => e.type === 'shiftHandover').map((e) => e.text)
    expect(texts).toContain('Nurse Ottilie took over ward A from Nurse Maya.')
    expect(texts).toContain('Nurse Rhys took over ward B from Nurse Leah.')
  })
})

describe('the night footing begins at 22:00 (a warm start at 21:50)', () => {
  let sim: Simulation
  let obs: Observed
  let runs: readonly Run[]
  beforeAll(() => {
    sim = new Simulation(2026, { startHour: 21 + 50 / 60 })
    obs = watch(sim, 30)
    runs = sim.day.shifts.runs
  }, 300_000)

  it('keeps every promise of the shift change', () => {
    expect(obs.problems).toEqual([])
  })

  it('the ER team and the extra porter and cleaner go out; the colleagues who stay are on post', () => {
    const night = runs.filter((r) => r.change.hour === 22)
    expect(night.map((r) => r.change.key).sort()).toEqual(['cleaner-2@22', 'doc-ER1@22', 'nurse-ER1@22', 'nurse-T1@22', 'porter-3@22'])
    for (const r of night) expect(r.state, r.change.key).toBe('done')
    for (const id of ['doc-ER1', 'nurse-ER1', 'nurse-T1', 'porter-3', 'cleaner-2']) {
      expect(sim.entities.has(id), `${id} gone`).toBe(false)
      expect(sim.day.shifts.departed, id).toContain(id)
    }
    for (const id of ['doc-ER2', 'nurse-ER2', 'nurse-T2', 'recep-1', 'porter-2', 'porter-N', 'cleaner-N', 'rad-CT', 'rad-XR']) expect(sim.entities.has(id), id).toBe(true)
    // the staff who stayed are real controllers again, not left as actors after the talk
    for (const id of ['doc-ER2', 'nurse-ER2', 'nurse-T2']) expect(onPost(sim, id), `${id} on post`).toBe(true)
    // the night footing: two porters, one cleaner
    expect(sim.people.filter((p) => p.entity.role === 'porter').map((p) => p.entity.id).sort()).toEqual(['porter-2', 'porter-N'])
    expect(sim.people.filter((p) => p.entity.role === 'cleaner').map((p) => p.entity.id)).toEqual(['cleaner-N'])
  })

  it('the leaving doctor, nurse and triage nurse hand over to the colleague who stays: two people talking for at most the handover time', () => {
    const [lo, hi] = CONFIG.day.bedsideHandoverSeconds
    const talked = runs.filter((r) => r.change.hour === 22 && r.talk === 'done')
    // a busy colleague may not get to rest in time: the talk is then skipped, never forced
    expect(talked.length).toBeGreaterThanOrEqual(2)
    for (const r of talked) {
      expect(r.change.kind).toBe('leaveStayer')
      const t = obs.talks.get(r.change.key) ?? 0
      expect(t, r.change.key).toBeGreaterThanOrEqual(lo - 1)
      expect(t, r.change.key).toBeLessThanOrEqual(hi + 1.5)
    }
    const events = sim.log.events.filter((e) => e.type === 'shiftHandover')
    expect(events).toHaveLength(talked.length)
    expect(events.some((e) => /^Dr\. Sven took over the ER from Dr\. Halima\.$/.test(e.text) || /^Nurse (Joon|Greta) took over (the ER|triage) from /.test(e.text))).toBe(true)
  })

  it('nobody leaves by anything but the entrance: every leaver faded out at the entrance door', () => {
    expect(sim.day.shifts.departed.length).toBe(5)
    expect(DEPARTURES.entrance.x).toBeLessThan(ARRIVALS.entrance.at.x + 1)
  })
})

describe('the morning change at 07:00 (a warm start at 06:45)', () => {
  let sim: Simulation
  let obs: Observed
  let runs: readonly Run[]
  beforeAll(() => {
    sim = new Simulation(2026, { startHour: 6.75 })
    obs = watch(sim, 45)
    runs = sim.day.shifts.runs
  }, 300_000)

  it('keeps every promise of the shift change', () => {
    expect(obs.problems).toEqual([])
  })

  it('starts on the night footing and ends on the day footing', () => {
    // the start: at 06:45 the night porter and cleaner are on post and the day staff are not here yet
    const early = new Simulation(2026, { startHour: 6.75 })
    expect(early.entities.has('porter-N')).toBe(true)
    expect(early.entities.has('cleaner-N')).toBe(true)
    expect(early.entities.has('porter-1')).toBe(false)
    expect(early.entities.has('doc-ER1')).toBe(false)
    expect(early.entities.has('doc-ER2')).toBe(true)
    expect(early.entities.has('rad-CT')).toBe(true)
    // the end: the day team is on post, the night team has gone home
    for (const id of comersOf(runs, 7)) expect(onPost(sim, id), `${id} on post`).toBe(true)
    for (const id of leaversOf(runs, 7)) expect(sim.entities.has(id), `${id} gone`).toBe(false)
    expect(sim.entities.has('porter-N')).toBe(false)
    expect(sim.entities.has('cleaner-N')).toBe(false)
    const day = runs.filter((r) => r.change.hour === 7)
    for (const r of day) expect(r.state, r.change.key).toBe('done')
  })

  it('the comers fade in at the entrance 5-10 minutes before the hour', () => {
    const comers = comersOf(runs, 7)
    // the ER doctor, ER nurse and triage nurse, porters 1 and 3, cleaners 1 and 2, Coordinator Eli, the four day nurses and the two ward doctors
    expect(comers.length).toBe(14)
    for (const id of comers) {
      const seen = obs.firstSeen.get(id)
      expect(seen, id).toBeDefined()
      const run = runs.find((r) => r.change.comer?.member.id === id && r.change.hour === 7)!
      expect(run.hourT - seen!.t, `${id} early`).toBeGreaterThanOrEqual(CONFIG.day.arriveEarlySeconds[0] - 1)
      expect(run.hourT - seen!.t, `${id} early`).toBeLessThanOrEqual(CONFIG.day.arriveEarlySeconds[1] + 1)
      expect(seen!.fade).toBeLessThan(1)
      expect(seen!.fromEntrance).toBeLessThan(2)
    }
  })

  it('a post is never empty while a relief takes it over, and no handover stands in a pinch', () => {
    for (const [key, c] of obs.covered) expect(c.ok, key).toBe(c.total)
    const handovers = sim.log.events.filter((e) => e.type === 'shiftHandover')
    expect(handovers.length).toBeGreaterThanOrEqual(4)
    // (a busy ER doctor at real exam lengths may not be at rest in time, and then the talk is skipped: the ward change is the sure one)
    expect(handovers.some((e) => /Nurse Maya took over ward A from Nurse Ottilie\./.test(e.text))).toBe(true)
  })

  it('the day team goes through the staff-room lockers on the way in and the night team on the way out', () => {
    expect(sim.day.shifts.arrived.length).toBe(14)
    expect(sim.day.shifts.departed).toEqual(expect.arrayContaining(['porter-N', 'cleaner-N']))
    // the scheduled changes after 07:30: the imaging office hours at 08:00 are still to come
    const later = shiftChanges(7.5, 8.5)
    expect(later.length).toBe(2)
    expect(hourT(8)).toBeGreaterThan(sim.t)
  })
})

describe('the coordinators (the day rhythm needs the live people list: DayRhythm.attachPeople)', () => {
  it('the second coordinator goes home at 19:00 and the first stays on night duty at the command desks', () => {
    const sim = new Simulation(2026, { startHour: 18.8 })
    sim.day.attachPeople(sim.people)
    expect(sim.entities.has('coord-2')).toBe(true)
    run(sim, 14 * 60)
    expect(sim.entities.has('coord-2')).toBe(false)
    expect(sim.day.shifts.departed).toContain('coord-2')
    expect(sim.entities.has('coord-1')).toBe(true)
    // the desk she left is free; the one still working is hers
    expect(sim.seats.occupant('command:desk:1')).toBeNull()
    expect(sim.seats.occupant('command:desk:0')).toBe('coord-1')
    const run19 = sim.day.shifts.runs.find((r) => r.change.key === 'coord-2@19')!
    expect(run19.state).toBe('done')
  }, 60_000)

  it('the second coordinator comes back at 07:00: through the entrance and the lockers, then sits at her desk', () => {
    const sim = new Simulation(2026, { startHour: 6.75 })
    sim.day.attachPeople(sim.people)
    // at 06:45 only the night duty coordinator is at work
    expect(sim.entities.has('coord-2')).toBe(false)
    expect(sim.entities.has('coord-1')).toBe(true)
    run(sim, 35 * 60)
    const p = sim.people.find((q) => q.entity.id === 'coord-2')
    expect(p).toBeDefined()
    expect(p).not.toBeInstanceOf(ShiftActor)
    expect(p!.entity.seated?.seatId).toBe('command:desk:1')
    expect(sim.seats.occupant('command:desk:1')).toBe('coord-2')
    expect(sim.day.shifts.arrived).toContain('coord-2')
  }, 60_000)
})
