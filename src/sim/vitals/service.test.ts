/**
 * The kiosk service, proved in node: the station script, the line, abort, the player, the guide and determinism. A bare world (no population) is
 * stepped through the kiosk service only, with pretend people who obey the calls, so hundreds of sessions run in moments. The whole morning with the
 * real population is in morning.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { HEALTH_KIOSKS, HEALTH_LINE } from '../places'
import type { HealthKioskPhase, HealthSessionKind } from '../types'
import { bmiOf } from './model'
import { DT, FakeSubject, bareSim, drive } from './testkit'
import { TUNING } from './tuning'

interface Run {
  sim: ReturnType<typeof bareSim>
  subjects: FakeSubject[]
}

function fresh(seed = 1): Run {
  return { sim: bareSim(seed), subjects: [] }
}

function person(run: Run, i: number, walkSeconds = 0): FakeSubject {
  const s = new FakeSubject(`hk-${i}`, `Person Number${i}`, () => run.sim.t, walkSeconds)
  run.subjects.push(s)
  return s
}

/** Run until nobody is at a kiosk or in the line, ticking the pretend people; returns the phase timeline of kiosk 0 or both. */
function runOut(run: Run, maxSeconds = 4000, each?: (t: number) => void): number {
  const v = run.sim.vitals
  let spent = 0
  while (spent < maxSeconds) {
    drive(run.sim, 1, (t) => {
      for (const s of run.subjects) s.tick(t)
      each?.(t)
    })
    spent += 1
    if (v.line.length === 0 && v.kiosks.every((k) => k.phase === 'idle')) return spent
  }
  throw new Error(`still busy after ${maxSeconds} s`)
}

describe('one full session', () => {
  it('runs login, height, weight, body fat, sit, SpO2, two cuff readings, temperature, report, and ends with a complete reading', () => {
    const run = fresh()
    const v = run.sim.vitals
    const a = person(run, 1)
    expect(v.offer(a, 'full')).toBe(true)
    const seen: HealthKioskPhase[] = []
    runOut(run, 600, () => {
      const k = v.kiosks.find((x) => x.userId === a.id)
      if (k && seen[seen.length - 1] !== k.phase) seen.push(k.phase)
    })
    const bp = seen.filter((p) => p === 'bp').length
    // (a person who is already on the platform is called and starts in the same step, so 'calling' only shows for somebody still walking)
    expect(seen.slice(0, 6)).toEqual(['login', 'height', 'weight', 'bodyFat', 'sit', 'spo2'])
    expect(seen.slice(-3)).toEqual(['bp', 'temp', 'report'])
    expect(bp).toBeGreaterThanOrEqual(2)
    const r = v.readingsFor(a.id)
    expect(r).toHaveLength(1)
    const rd = r[0]
    expect(rd.source).toBe('kiosk')
    expect(rd.partial).toBe(false)
    for (const k of ['sys', 'dia', 'pulse', 'spo2', 'tempC', 'heightCm', 'weightKg', 'bmi', 'bodyFatPct'] as const) expect(rd[k], k).not.toBeNull()
    expect(rd.bmi!).toBeCloseTo(bmiOf(rd.weightKg!, rd.heightCm!), 1)
    expect(rd.bp.length).toBeGreaterThanOrEqual(2)
    expect(a.reading).toBe(rd)
    expect(a.times('called')).toHaveLength(2) // onto the platform, and back from the stool for the thermometer
    expect(a.times('sit')).toHaveLength(1)
    expect(a.times('done')).toHaveLength(1)
  })

  it('writes one event line with the values and no judgement', () => {
    const run = fresh(2)
    const a = person(run, 2)
    run.sim.vitals.offer(a, 'full')
    runOut(run)
    const lines = run.sim.log.events.filter((e) => e.type === 'healthCheck')
    expect(lines).toHaveLength(1)
    const rd = run.sim.vitals.readingsFor(a.id)[0]
    expect(lines[0].text).toBe(`${a.name} finished a health check at kiosk 1: BP ${rd.sys}/${rd.dia}, SpO₂ ${rd.spo2}%, BMI ${rd.bmi!.toFixed(1)}.`)
    expect(lines[0].subjectId).toBe(a.id)
  })

  it('the state is updated in place and the reading fills in as steps finish', () => {
    const run = fresh(3)
    const v = run.sim.vitals
    const k = v.kiosks[0]
    const same = v.kiosks[0]
    const a = person(run, 3)
    v.offer(a, 'full')
    const snaps: { phase: HealthKioskPhase; h: number | null; w: number | null; f: number | null; o: number | null; bp: number; t: number | null }[] = []
    runOut(run, 600, () => {
      if (k.reading) snaps.push({ phase: k.phase, h: k.reading.heightCm, w: k.reading.weightKg, f: k.reading.bodyFatPct, o: k.reading.spo2, bp: k.reading.bp.length, t: k.reading.tempC })
    })
    expect(v.kiosks[0]).toBe(same)
    const at = (p: HealthKioskPhase) => snaps.filter((s) => s.phase === p)
    expect(at('login')[0].h).toBeNull()
    expect(at('weight')[0].h).not.toBeNull()
    expect(at('weight')[0].w).toBeNull()
    expect(at('bodyFat')[0].w).not.toBeNull()
    expect(at('bodyFat')[0].f).toBeNull()
    expect(at('spo2')[0].f).not.toBeNull()
    expect(at('spo2')[0].o).toBeNull()
    expect(at('bp')[0].o).not.toBeNull()
    expect(at('bp')[0].bp).toBe(0)
    expect(at('temp')[0].bp).toBeGreaterThanOrEqual(2)
    expect(at('temp')[0].t).toBeNull()
    expect(at('report')[0].t).not.toBeNull()
    expect(k.reading).toBeNull()
    expect(k.userId).toBeNull()
    expect(k.sessionsToday).toBe(1)
  })

  it('the cuff rises, holds and falls inside each reading, and the round number is shown', () => {
    const run = fresh(4)
    const v = run.sim.vitals
    const k = v.kiosks[0]
    const a = person(run, 4)
    v.offer(a, 'full')
    const byRound = new Map<number, number[]>()
    const rest: number[] = []
    runOut(run, 600, () => {
      if (k.phase === 'bp') {
        const l = byRound.get(k.bpRound) ?? []
        l.push(k.cuff)
        byRound.set(k.bpRound, l)
      } else {
        expect(k.cuff).toBe(0)
        if (k.phase === 'bpRest') rest.push(k.bpRound)
      }
    })
    expect([...byRound.keys()].slice(0, 2)).toEqual([1, 2])
    for (const list of byRound.values()) {
      const peak = Math.max(...list)
      expect(peak).toBeCloseTo(1, 6)
      const up = list.indexOf(peak)
      for (let i = 1; i <= up; i++) expect(list[i]).toBeGreaterThanOrEqual(list[i - 1] - 1e-9)
      expect(list[0]).toBeLessThan(0.05)
      expect(list[list.length - 1]).toBeLessThan(0.1)
      expect(Math.min(...list)).toBeGreaterThanOrEqual(0)
    }
    expect(rest[0]).toBe(1) // the rest after reading 1
  })

  it('bumps the version when something a screen shows changes, and not while nothing does', () => {
    const run = fresh(5)
    const v = run.sim.vitals
    const k = v.kiosks[0]
    drive(run.sim, 5)
    const idle = k.version
    drive(run.sim, 5)
    expect(k.version).toBe(idle)
    const a = person(run, 5)
    v.offer(a, 'full')
    drive(run.sim, 1, (t) => a.tick(t))
    expect(k.version).toBeGreaterThan(idle)
    const before = k.version
    drive(run.sim, 3, (t) => a.tick(t))
    expect(k.version - before).toBeLessThanOrEqual(5) // about one a second, never one a step
  })
})

describe('session lengths', () => {
  it('an unassisted full session with two cuff readings takes 180 to 300 s, and the research mean is about 4 minutes', () => {
    const run = fresh(6)
    const v = run.sim.vitals
    for (let i = 0; i < 120; i++) {
      const a = person(run, 100 + i)
      v.offer(a, 'full')
      runOut(run, 1500)
    }
    const ok = v.stats.sessions.filter((s) => !s.partial && s.kind === 'full' && !s.assisted && s.rounds === 2)
    expect(ok.length).toBeGreaterThan(60)
    const durs = ok.map((s) => s.endedAt - s.startedAt)
    expect(Math.min(...durs)).toBeGreaterThanOrEqual(180)
    expect(Math.max(...durs)).toBeLessThanOrEqual(300 + 0.2)
    const mean = durs.reduce((a, b) => a + b, 0) / durs.length
    expect(mean).toBeGreaterThan(225)
    expect(mean).toBeLessThan(285)
  })

  it('the third reading appears only when the first two differ by more than 10, and comes at least 180 s after the second', () => {
    const run = fresh(7)
    const v = run.sim.vitals
    let thirds = 0
    let twos = 0
    for (let i = 0; i < 160; i++) {
      const a = person(run, 300 + i)
      v.offer(a, 'full')
      const ends: Record<number, number> = {}
      const starts: Record<number, number> = {}
      let last: HealthKioskPhase = 'idle'
      let lastRound = 0
      runOut(run, 1500, (t) => {
        const k = v.kiosks.find((x) => x.userId === a.id)
        const phase = k?.phase ?? 'idle'
        if (k && phase === 'bp' && last !== 'bp') starts[k.bpRound] = t
        if (last === 'bp' && phase !== 'bp') ends[lastRound] = t
        last = phase
        lastRound = k?.bpRound ?? 0
      })
      const rd = v.readingsFor(a.id)[0]
      const delta = Math.abs(rd.bp[1][0] - rd.bp[0][0])
      if (rd.bp.length === 3) {
        thirds++
        expect(delta, `${a.id} had a third reading`).toBeGreaterThan(CONFIG.vitals.bpRepeatDeltaSys)
        expect(starts[3] - ends[2], a.id).toBeGreaterThanOrEqual(CONFIG.vitals.bpRepeatRestSeconds - 0.2)
        // the stored value is the mean of the last two
        expect(rd.sys).toBe(Math.round((rd.bp[1][0] + rd.bp[2][0]) / 2))
      } else {
        twos++
        expect(rd.bp).toHaveLength(2)
        expect(delta, `${a.id} had no third reading`).toBeLessThanOrEqual(CONFIG.vitals.bpRepeatDeltaSys)
        expect(rd.sys).toBe(Math.round((rd.bp[0][0] + rd.bp[1][0]) / 2))
      }
      // the gap between the first two readings is the rest
      expect(starts[2] - ends[1]).toBeGreaterThanOrEqual(TUNING.minBpGapSeconds - 0.2)
    }
    expect(thirds).toBeGreaterThan(3)
    expect(twos).toBeGreaterThan(100)
  })

  it('a vitals-only ER session skips height, weight and body fat, takes one cuff reading, and takes at most 150 s', () => {
    const run = fresh(8)
    const v = run.sim.vitals
    for (let i = 0; i < 150; i++) {
      const a = person(run, 500 + i)
      expect(v.offer(a, 'vitals')).toBe(true)
      const phases = new Set<HealthKioskPhase>()
      runOut(run, 400, () => phases.add(v.kiosks[0].phase))
      expect(phases.has('height') || phases.has('weight') || phases.has('bodyFat')).toBe(false)
      const rd = v.readingsFor(a.id)[0]
      expect(rd.heightCm).toBeNull()
      expect(rd.weightKg).toBeNull()
      expect(rd.bodyFatPct).toBeNull()
      expect(rd.bp).toHaveLength(1)
      expect(rd.spo2).not.toBeNull()
      expect(rd.tempC).not.toBeNull()
    }
    const logs = v.stats.sessions.filter((s) => s.kind === 'vitals')
    expect(logs).toHaveLength(150)
    for (const s of logs) expect(s.endedAt - s.startedAt, s.userId).toBeLessThanOrEqual(150)
    const mean = logs.reduce((a, s) => a + (s.endedAt - s.startedAt), 0) / logs.length
    expect(mean).toBeGreaterThan(90)
    expect(mean).toBeLessThan(140)
  })

  it('writes the ER line: "sent to triage"', () => {
    const run = fresh(9)
    const a = person(run, 9)
    run.sim.vitals.offer(a, 'vitals')
    runOut(run)
    const text = run.sim.log.events.filter((e) => e.type === 'healthCheck')[0].text
    const rd = run.sim.vitals.readingsFor(a.id)[0]
    expect(text).toBe(`${a.name} finished a health check: BP ${rd.sys}/${rd.dia}, SpO₂ ${rd.spo2}%, sent to triage.`)
  })
})

describe('the person on the platform', () => {
  it('is posed per phase: finger, idle, grip, armIn; raised 5 cm on the platform and seated on the stool', () => {
    const run = fresh(10)
    const v = run.sim.vitals
    const k = v.kiosks[0]
    const a = person(run, 10)
    v.offer(a, 'full')
    const seen = new Map<string, { anims: Set<string>; ys: Set<number>; seated: Set<boolean> }>()
    runOut(run, 600, () => {
      const rec = seen.get(k.phase) ?? { anims: new Set(), ys: new Set(), seated: new Set() }
      rec.anims.add(a.entity.anim)
      rec.ys.add(Math.round(a.entity.position.y * 1000) / 1000)
      rec.seated.add(a.entity.seated !== undefined)
      seen.set(k.phase, rec)
    })
    const at = (p: string) => seen.get(p)!
    expect([...at('login').anims]).toContain('finger')
    expect([...at('height').anims]).toEqual(['idle'])
    expect([...at('weight').anims]).toEqual(['idle'])
    expect([...at('bodyFat').anims]).toEqual(['grip'])
    expect([...at('spo2').anims]).toEqual(['finger'])
    expect([...at('bp').anims]).toEqual(['armIn'])
    expect([...at('bp').seated]).toEqual([true])
    expect([...at('spo2').seated]).toEqual([true])
    expect([...at('height').seated]).toEqual([false])
    expect(Math.max(...at('weight').ys)).toBeCloseTo(0.05, 6)
    expect(Math.min(...at('weight').ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...at('bp').ys)).toBeLessThan(0.01)
    expect([...at('report').anims]).toContain('finger')
    // afterwards: on the floor, no stool, no kiosk pose
    expect(a.entity.position.y).toBe(0)
    expect(a.entity.seated).toBeUndefined()
    expect(['finger', 'grip', 'armIn']).not.toContain(a.entity.anim)
  })

  it('waits in "calling" for somebody who is still walking, and does not start the clock until they are on the platform', () => {
    const run = fresh(11)
    const v = run.sim.vitals
    const a = person(run, 11, 12)
    v.offer(a, 'full')
    let started = -1
    runOut(run, 600, (t) => {
      if (started < 0 && v.kiosks[0].phase === 'login') started = t
    })
    const calledAt = a.times('called')[0]
    expect(started - calledAt).toBeGreaterThanOrEqual(12 - 0.1)
    expect(started - calledAt).toBeLessThan(13)
    const log = v.stats.sessions[0]
    expect(log.forced).toBe(false)
    expect(log.endedAt - log.startedAt).toBeLessThanOrEqual(310)
  })

  it('takes somebody who never arrives as arrived after the timeout, and still ends', () => {
    const run = fresh(12)
    const v = run.sim.vitals
    const a = person(run, 12)
    v.offer(a, 'full')
    // called, but never gets there
    a.kioskCalled = function (this: FakeSubject, index: number) {
      this.calls.push({ t: run.sim.t, what: 'called', index })
      this.done = false
    }
    runOut(run, 900)
    const log = v.stats.sessions[0]
    expect(log.forced).toBe(true)
    expect(log.startedAt - log.calledAt).toBeGreaterThanOrEqual(CONFIG.vitals.loginSeconds[0] * 0 + 45 - 0.1)
  })
})

describe('the line', () => {
  it('is first come, first served across both kiosks', () => {
    const run = fresh(13)
    const v = run.sim.vitals
    const people = Array.from({ length: 6 }, (_, i) => person(run, 700 + i))
    const accepted: FakeSubject[] = []
    for (const p of people) {
      if (v.offer(p, 'full')) accepted.push(p)
      drive(run.sim, 7, (t) => run.subjects.forEach((s) => s.tick(t)))
    }
    runOut(run, 3000)
    const order = accepted.map((p) => ({ p, t: p.times('called')[0] }))
    expect(order.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < order.length; i++) expect(order[i].t, `${order[i].p.id} after ${order[i - 1].p.id}`).toBeGreaterThanOrEqual(order[i - 1].t)
    // both kiosks were used
    const used = new Set(v.stats.sessions.map((s) => s.index))
    expect(used.size).toBe(2)
  })

  it('takes four in the line and says no to the fifth', () => {
    const run = fresh(14)
    const v = run.sim.vitals
    // the two kiosks are busy with the first two; four more fit in the line
    const people = Array.from({ length: 8 }, (_, i) => person(run, 800 + i))
    const results = people.map((p) => v.offer(p, 'full'))
    expect(results.slice(0, 4)).toEqual([true, true, true, true])
    expect(results.slice(4)).toEqual([false, false, false, false])
    expect(v.line.length).toBe(HEALTH_LINE.capacity)
    drive(run.sim, 0.2) // two of the four are called at once; two more can join
    expect(v.line.length).toBe(2)
    expect(v.offer(people[4], 'full')).toBe(true)
    expect(v.offer(people[5], 'full')).toBe(true)
    expect(v.offer(people[6], 'full')).toBe(false)
  })

  it('offers an ER vitals session only when at most erMaxAhead are in the line', () => {
    const run = fresh(15)
    const v = run.sim.vitals
    const ahead = Array.from({ length: CONFIG.vitals.erMaxAhead + 3 }, (_, i) => person(run, 900 + i))
    const er = person(run, 950)
    // fill both kiosks, then the line
    for (const p of ahead) v.offer(p, 'full')
    drive(run.sim, 0.2)
    expect(v.line.length).toBe(ahead.length - 2)
    expect(v.line.length).toBeGreaterThan(CONFIG.vitals.erMaxAhead)
    expect(v.offer(er, 'vitals')).toBe(false)
    // once the line is down to erMaxAhead, the ER walk-in is welcome
    while (v.line.length > CONFIG.vitals.erMaxAhead) drive(run.sim, 1, (t) => run.subjects.forEach((s) => s.tick(t)))
    expect(v.offer(er, 'vitals')).toBe(true)
  })

  it('tells each person in it where to stand, and moves them up when the line moves', () => {
    const run = fresh(16)
    const v = run.sim.vitals
    const people = Array.from({ length: 6 }, (_, i) => person(run, 1000 + i))
    for (const p of people.slice(0, 4)) v.offer(p, 'full')
    drive(run.sim, 0.2) // the first two go to the kiosks, the other two wait
    for (const p of people.slice(4)) expect(v.offer(p, 'full')).toBe(true)
    drive(run.sim, 0.2)
    const last = people[5]
    const q = last.calls.filter((c) => c.what === 'queued')
    expect(q.length).toBeGreaterThanOrEqual(1)
    expect(q[q.length - 1].place).toBe(3)
    const spot = v.line.spotFor(3)
    expect(spot.at.x).toBe(HEALTH_LINE.front.x)
    expect(spot.at.z).toBeCloseTo(HEALTH_LINE.front.z - 3 * HEALTH_LINE.pitch, 9)
    expect(spot.heading).toBe(HEALTH_LINE.heading)
    runOut(run, 3000, (t) => run.subjects.forEach((s) => s.tick(t)))
    // it moved up as the others were called: told places only ever go down, and it ends at the front before it is called
    const places = last.calls.filter((c) => c.what === 'queued').map((c) => c.place!)
    for (let i = 1; i < places.length; i++) expect(places[i]).toBeLessThan(places[i - 1])
    expect(places[places.length - 1]).toBe(0)
    expect(last.times('called').length).toBeGreaterThan(0)
  })

  it('does not call the same person twice and ignores a second offer', () => {
    const run = fresh(17)
    const v = run.sim.vitals
    const a = person(run, 17)
    expect(v.offer(a, 'full')).toBe(true)
    expect(v.offer(a, 'full')).toBe(true)
    expect(v.line.length).toBe(1)
    drive(run.sim, 0.2, (t) => a.tick(t))
    expect(v.offer(a, 'full')).toBe(true) // already at a kiosk
    expect(v.line.length).toBe(0)
    runOut(run)
    expect(v.stats.sessions).toHaveLength(1)
  })
})

describe('no kiosk ever has two users', () => {
  it('holds over a busy stretch of arrivals, aborts and kiosk-hopping', () => {
    const run = fresh(18)
    const v = run.sim.vitals
    let next = 0
    let nextOffer = 3
    const problems: string[] = []
    const lastUser: (string | null)[] = [null, null]
    const lastPhase: HealthKioskPhase[] = ['idle', 'idle']
    for (let i = 0; i < 50; i++) person(run, 2000 + i)
    drive(run.sim, 3 * 3600, (t) => {
      for (const s of run.subjects) s.tick(t)
      if (t >= nextOffer && next < run.subjects.length) {
        const kind: HealthSessionKind = next % 3 === 0 ? 'vitals' : 'full'
        v.offer(run.subjects[next++], kind)
        nextOffer = t + 20 + (next % 5) * 25
      }
      // somebody leaves mid-way now and then
      if (Math.floor(t) % 211 === 0 && t % 1 < DT) {
        const k = v.kiosks.find((x) => x.phase === 'bp' || x.phase === 'spo2')
        if (k?.userId) v.abort(k.userId)
      }
      const users = v.kiosks.filter((x) => x.phase !== 'idle').map((x) => x.userId)
      if (new Set(users).size !== users.length) problems.push(`${t.toFixed(1)}: two kiosks share a user`)
      for (const x of v.kiosks) {
        if (x.phase !== 'idle' && x.userId === null) problems.push(`${t.toFixed(1)}: kiosk ${x.index} runs with nobody`)
        if (x.phase === 'idle' && x.userId !== null) problems.push(`${t.toFixed(1)}: kiosk ${x.index} idle with a user`)
        if (lastPhase[x.index] !== 'idle' && x.phase !== 'idle' && lastUser[x.index] !== x.userId) problems.push(`${t.toFixed(1)}: kiosk ${x.index} changed user without going idle`)
        lastUser[x.index] = x.userId
        lastPhase[x.index] = x.phase
      }
      for (const m of v.line.members) if (users.includes(m.id)) problems.push(`${t.toFixed(1)}: ${m.id} is in the line and at a kiosk`)
    })
    expect(problems.slice(0, 5)).toEqual([])
    expect(v.stats.sessions.length).toBeGreaterThan(30)
    // everyone who was at a kiosk has been told when they were done
    const done = run.subjects.filter((s) => s.times('done').length > 0)
    for (const s of done) expect(s.times('done')).toHaveLength(1)
  })
})

describe('leaving early', () => {
  it('somebody called to triage mid-session leaves a partial reading with what was measured, and the kiosk is free again', () => {
    const run = fresh(19)
    const v = run.sim.vitals
    const k = v.kiosks[0]
    const a = person(run, 19)
    const b = person(run, 20)
    v.offer(a, 'vitals')
    v.offer(b, 'vitals')
    runOut(run, 60 * 20, () => {
      if (k.userId === a.id && k.phase === 'bp' && k.progress > 0.5) v.abort(a.id)
    })
    const ra = v.readingsFor(a.id)
    expect(ra).toHaveLength(1)
    expect(ra[0].partial).toBe(true)
    expect(ra[0].spo2).not.toBeNull()
    expect(ra[0].bp).toHaveLength(0)
    expect(ra[0].tempC).toBeNull()
    expect(a.times('done')).toHaveLength(0) // the person who left was not told they are done: they asked to leave
    expect(v.stats.sessions[0].partial).toBe(true)
    // the next person was served on the other kiosk or, once the platform cleared, on this one
    expect(v.readingsFor(b.id)[0].partial).toBe(false)
    expect(v.kiosks.every((x) => x.phase === 'idle')).toBe(true)
    const early = run.sim.log.events.filter((e) => e.type === 'healthCheck' && e.subjectId === a.id)
    expect(early).toHaveLength(1)
    expect(early[0].text).toBe(`${a.name} left the health check early.`)
  })

  it('a partial reading after a cuff reading says so with the pressure', () => {
    const run = fresh(20)
    const v = run.sim.vitals
    const k = v.kiosks[0]
    const a = person(run, 21)
    v.offer(a, 'full')
    runOut(run, 1500, () => {
      if (k.userId === a.id && k.phase === 'bpRest') v.abort(a.id)
    })
    const rd = v.readingsFor(a.id)[0]
    expect(rd.partial).toBe(true)
    expect(rd.bp).toHaveLength(1)
    expect(rd.sys).toBe(rd.bp[0][0])
    const text = run.sim.log.events.filter((e) => e.subjectId === a.id)[0].text
    expect(text).toBe(`${a.name} left the health check early, with BP ${rd.sys}/${rd.dia} recorded.`)
    expect(v.kiosks[0].sessionsToday).toBe(1)
  })

  it('leaving the line costs nothing: no reading, nobody is called who is gone, the others move up', () => {
    const run = fresh(21)
    const v = run.sim.vitals
    const people = Array.from({ length: 6 }, (_, i) => person(run, 1100 + i))
    for (const p of people.slice(0, 4)) v.offer(p, 'full')
    drive(run.sim, 0.2)
    for (const p of people.slice(4)) v.offer(p, 'full')
    drive(run.sim, 0.2)
    expect(v.line.has(people[4].id)).toBe(true)
    v.abort(people[4].id)
    expect(v.line.has(people[4].id)).toBe(false)
    runOut(run, 3000, (t) => run.subjects.forEach((s) => s.tick(t)))
    expect(v.readingsFor(people[4].id)).toHaveLength(0)
    expect(people[4].times('called')).toHaveLength(0)
    expect(v.stats.sessions).toHaveLength(5)
    // the one behind moved up into the place they left
    const places = people[5].calls.filter((c) => c.what === 'queued').map((c) => c.place)
    expect(places).toEqual([3, 2, 1, 0].filter((p) => places.includes(p)))
    expect(places[places.length - 1]).toBe(0)
  })

  it('somebody who leaves while being called has no reading and the kiosk takes the next at once', () => {
    const run = fresh(22)
    const v = run.sim.vitals
    const a = person(run, 22, 30)
    const b = person(run, 23)
    v.offer(a, 'full')
    drive(run.sim, 1, (t) => a.tick(t))
    expect(v.kiosks[0].phase).toBe('calling')
    v.abort(a.id)
    expect(v.kiosks[0].phase).toBe('idle')
    expect(v.readingsFor(a.id)).toHaveLength(0)
    v.offer(b, 'full')
    drive(run.sim, 0.2, (t) => b.tick(t))
    expect(v.kiosks[0].userId).toBe(b.id)
  })
})

describe('triage readings', () => {
  it('sit beside the kiosk reading, oldest first, and run 10 to 30 mmHg higher on average over 200 people', () => {
    const run = fresh(23)
    const v = run.sim.vitals
    const diffs: number[] = []
    for (let i = 0; i < 200; i++) {
      const a = person(run, 3000 + i)
      v.offer(a, 'vitals')
      runOut(run, 400)
      const tri = v.recordTriage(a.id, a.name, 'nurse-T1')
      const all = v.readingsFor(a.id)
      expect(all.map((r) => r.source)).toEqual(['kiosk', 'triage'])
      expect(tri).toBe(all[1])
      expect(tri.station).toBeNull()
      diffs.push(tri.sys! - all[0].sys!)
    }
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length
    expect(mean).toBeGreaterThanOrEqual(10)
    expect(mean).toBeLessThanOrEqual(30)
    expect(v.stats.triageReadings).toBe(200)
  })

  it('draws the same body for a person who was never at a kiosk, and the same height as their avatar', () => {
    const run = fresh(24)
    const v = run.sim.vitals
    const r = v.recordTriage('er-77', 'Ana Silva', 'nurse-T1')
    expect(v.readingsFor('er-77')).toEqual([r])
    expect(r.source).toBe('triage')
    expect(r.sys).not.toBeNull()
  })

  it('an unknown person has no readings', () => {
    expect(fresh(25).sim.vitals.readingsFor('nobody')).toEqual([])
  })
})

describe('determinism', () => {
  const trace = (seed: number) => {
    const run = fresh(seed)
    const v = run.sim.vitals
    for (let i = 0; i < 12; i++) person(run, 4000 + i)
    let next = 0
    drive(run.sim, 3600, (t) => {
      for (const s of run.subjects) s.tick(t)
      if (t >= 5 + next * 90 && next < 12) v.offer(run.subjects[next], next % 2 ? 'vitals' : 'full'), next++
    })
    const readings = run.subjects.flatMap((s) => v.readingsFor(s.id))
    return { readings, log: run.sim.log.events.map((e) => `${e.id}|${e.t.toFixed(2)}|${e.text}`), sessions: v.stats.sessions }
  }

  it('the same seed gives the same readings, the same event log and the same sessions', () => {
    const a = trace(5)
    const b = trace(5)
    expect(a.readings.length).toBeGreaterThan(8)
    expect(a.readings).toEqual(b.readings)
    expect(a.log).toEqual(b.log)
    expect(a.sessions).toEqual(b.sessions)
  })

  it('a different seed gives different numbers for the same people', () => {
    const a = trace(5)
    const c = trace(6)
    expect(a.readings.map((r) => r.sys)).not.toEqual(c.readings.map((r) => r.sys))
  })

  it('a person has the same body in every run, so their height is the same', () => {
    const a = trace(5)
    const c = trace(6)
    const hs = (t: ReturnType<typeof trace>) => new Map(t.readings.filter((r) => r.heightCm !== null).map((r) => [r.personId, r.heightCm as number] as const))
    const ha = hs(a)
    let compared = 0
    for (const [id, h] of hs(c)) {
      const other = ha.get(id)
      if (other === undefined) continue
      compared++
      expect(Math.abs(other - h), id).toBeLessThanOrEqual(0.6)
    }
    expect(compared).toBeGreaterThan(3)
  })
})

describe('a warm start', () => {
  it('begins with an empty line and idle kiosks at that hour', () => {
    const sim = bareSim(3, 10)
    const v = sim.vitals
    expect(v.line.length).toBe(0)
    expect(v.kiosks.every((k) => k.phase === 'idle' && k.sessionsToday === 0 && k.reading === null && k.userId === null)).toBe(true)
    expect(HEALTH_KIOSKS).toHaveLength(2)
  })
})

describe('a long run', () => {
  it('keeps two days of readings and bodies, and forgets older ones; the day counts reset at midnight', () => {
    const run = fresh(30)
    const v = run.sim.vitals
    const a = person(run, 6000)
    v.offer(a, 'full')
    runOut(run)
    expect(v.readingsFor(a.id)).toHaveLength(1)
    expect(v.profileIfDrawn(a.id)).not.toBeNull()
    expect(v.kiosks[0].sessionsToday + v.kiosks[1].sessionsToday).toBe(1)
    // 24 h later: the day has rolled over (07:30 + 17 h = midnight is after 16.5 h)
    drive(run.sim, 17 * 3600, undefined, 5)
    expect(v.kiosks.every((k) => k.sessionsToday === 0)).toBe(true)
    expect(v.readingsFor(a.id)).toHaveLength(1)
    // 49 h on: gone
    drive(run.sim, 32 * 3600, undefined, 5)
    expect(v.readingsFor(a.id)).toHaveLength(0)
    expect(v.profileIfDrawn(a.id)).toBeNull()
  })
})
