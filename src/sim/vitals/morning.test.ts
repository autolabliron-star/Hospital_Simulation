/**
 * A whole morning with the real population, 07:30 to 12:30 (about a million fixed steps): the walk-up visitors arrive by their seeded curve, queue in the
 * lobby, take a full session and leave; the guide helps whoever needs it. Checked as it runs: no kiosk ever has two users, the line is first come first
 * served, every kiosk sees 20 to 90 sessions, a kiosk is busy at most 85 % of 08:00 to 10:00, and every walk-up goes home.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { HEALTH_KIOSKS } from '../places'
import { Simulation } from '../Simulation'
import type { HealthKioskPhase } from '../types'

const DT = CONFIG.sim.step
const hour = (h: number) => (h - CONFIG.sim.startHour) * 3600
/** Kiosk state is sampled every second of sim time. */
const SAMPLE_EVERY = 60

describe('a whole morning at the entrance health kiosks', () => {
  it('keeps every promise of the kiosk brief', { timeout: 900_000 }, () => {
    const sim = new Simulation(2026)
    const v = sim.vitals
    const end = hour(12.5)
    const problems: string[] = []
    const busy = [0, 0]
    let samples = 0
    const lastUser: (string | null)[] = [null, null]
    const lastPhase: HealthKioskPhase[] = ['idle', 'idle']
    let lineMax = 0
    let simMs = 0
    let steps = 0

    while (sim.t < end) {
      const t0 = performance.now()
      for (let k = 0; k < SAMPLE_EVERY; k++) sim.step(DT)
      simMs += performance.now() - t0
      steps += SAMPLE_EVERY

      const users = v.kiosks.filter((x) => x.phase !== 'idle').map((x) => x.userId)
      if (new Set(users).size !== users.length) problems.push(`${sim.t.toFixed(0)} s: two kiosks share a user`)
      for (const x of v.kiosks) {
        if (x.phase !== 'idle' && x.userId === null) problems.push(`${sim.t.toFixed(0)} s: kiosk ${x.index} runs with nobody`)
        if (lastPhase[x.index] !== 'idle' && x.phase !== 'idle' && lastUser[x.index] !== x.userId) problems.push(`${sim.t.toFixed(0)} s: kiosk ${x.index} changed user without going idle`)
        lastUser[x.index] = x.userId
        lastPhase[x.index] = x.phase
        if (sim.t >= hour(8) && sim.t < hour(10) && x.phase !== 'idle') busy[x.index]++
      }
      if (sim.t >= hour(8) && sim.t < hour(10)) samples++
      for (const m of v.line.members) if (users.includes(m.id)) problems.push(`${sim.t.toFixed(0)} s: ${m.id} is in the line and at a kiosk`)
      lineMax = Math.max(lineMax, v.line.length)
    }

    const sessions = v.stats.sessions
    const per = HEALTH_KIOSKS.map((k) => sessions.filter((s) => s.index === k.index))
    const util = busy.map((b) => b / samples)
    const durs = sessions.filter((s) => !s.partial && s.rounds === 2 && !s.assisted).map((s) => s.endedAt - s.startedAt)
    const forcedList = sessions.filter((s) => s.forced)
    const forced = forcedList.length
    const byKind = { full: sessions.filter((s) => s.kind === 'full').length, vitals: sessions.filter((s) => s.kind === 'vitals').length, early: sessions.filter((s) => s.partial).length }
    const assisted = sessions.filter((s) => s.assisted).length
    const waits = sessions.map((s) => s.calledAt - s.joinedAt).sort((a, b) => a - b)
    const stillHere = [...v.walkUps].map((w) => `${w.entity.name} ${w.state} arrived ${((w.arrivedAt - end) / 60).toFixed(0)} min`)
    console.log(
      `[W4 kiosks] sessions ${per.map((p) => p.length).join(' / ')} (${byKind.full} full, ${byKind.vitals} ER vitals, ${byKind.early} cut short); utilisation 08-10h ${util.map((u) => u.toFixed(2)).join(' / ')}; line max ${lineMax}; ` +
        `walk-ups ${v.spawner.spawned} spawned, ${v.stats.walkUpsGone} gone, ${v.spawner.skipped} turned away, on site at 12:30 ${v.walkUps.size}; ` +
        `forced arrivals ${forced}; assisted ${assisted}; full session ${Math.min(...durs).toFixed(0)}-${Math.max(...durs).toFixed(0)} s (mean ${(durs.reduce((a, b) => a + b, 0) / durs.length).toFixed(0)}); ` +
        `wait in line median ${waits[Math.floor(waits.length / 2)].toFixed(0)} s, max ${waits[waits.length - 1].toFixed(0)} s; step ${((simMs / steps) * 1000).toFixed(1)} us`,
    )

    expect(problems.slice(0, 10)).toEqual([])
    expect(forcedList.map((s) => `${s.userId} ${s.kind} kiosk ${s.index} called ${s.calledAt.toFixed(0)} s, started ${s.startedAt.toFixed(0)} s`)).toEqual([])
    // each kiosk: 20 to 90 sessions
    for (const p of per) {
      expect(p.length).toBeGreaterThanOrEqual(20)
      expect(p.length).toBeLessThanOrEqual(90)
    }
    // busy at most 85 % in the peak
    for (const u of util) expect(u).toBeLessThanOrEqual(0.85)
    // first come, first served: called in the order they joined
    const byCall = [...sessions].sort((a, b) => a.calledAt - b.calledAt)
    for (let i = 1; i < byCall.length; i++) expect(byCall[i].joinedAt, `${byCall[i].userId} after ${byCall[i - 1].userId}`).toBeGreaterThanOrEqual(byCall[i - 1].joinedAt)
    // nobody had to be waved through: they all reached the platform
    expect(forced).toBe(0)
    // everybody who came in good time went home (those still here arrived in the last 20 minutes)
    for (const w of v.walkUps) expect(w.arrivedAt, `${w.entity.name} ${w.state}`).toBeGreaterThan(end - 20 * 60)
    expect(stillHere.length).toBeLessThan(8)
    expect(v.stats.walkUpsGone).toBeGreaterThan(20)
    // every walk-up that was served went home with a complete reading
    for (const s of sessions.filter((x) => x.kind === 'full')) expect(s.partial, s.userId).toBe(false)
    // an ER walk-in's short session is at most 150 s (they may be called to triage first: then it is partial)
    for (const s of sessions.filter((x) => x.kind === 'vitals' && !x.partial)) expect(s.endedAt - s.startedAt, s.userId).toBeLessThanOrEqual(150)
  })
})
