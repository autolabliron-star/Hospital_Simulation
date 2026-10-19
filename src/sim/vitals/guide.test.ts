/**
 * The guide: she helps the elderly (and one user in seven), goes to the user's shoulder, makes the session 30 % slower, and goes back to her post.
 * Stepped through the whole hospital (a bare world: the ward staff and inpatients only) so she really walks.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { tryPlanRoute } from '../nav/graph'
import { HEALTH_GUIDE, HEALTH_KIOSKS, HEALTH_LINE } from '../places'
import { guideSpotFor } from './guide'
import { FakeSubject, bareSim } from './testkit'

const DT = CONFIG.sim.step

function stepFor(sim: ReturnType<typeof bareSim>, seconds: number, subs: FakeSubject[], each?: () => void): void {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) {
    sim.step(DT)
    for (const s of subs) s.tick(sim.t)
    each?.()
  }
}

describe('the guide', () => {
  it('comes with the first step of a hospital that has a population, not to a bare world', () => {
    const bare = bareSim(1)
    bare.step(DT)
    expect(bare.vitals.guide).toBeNull()
    expect(bare.entities.has('kiosk-guide')).toBe(false)
    expect(bare.vitals.ensureGuide()).not.toBeNull()
    expect(bare.entities.get('kiosk-guide')?.name).toBe('Nurse Ingrid')
    expect(bare.vitals.ensureGuide()).toBe(bare.vitals.guide) // idempotent
  })

  it('stands at her post, goes to an elderly user, helps (30 % slower), and goes back', () => {
    const sim = bareSim(5)
    const v = sim.vitals
    const guide = v.ensureGuide()!
    const a = new FakeSubject('hk-5', 'Ana Silva', () => sim.t)
    expect(v.setAge(a.id, 82)).toBe(true)
    stepFor(sim, 2, [a])
    expect(guide.state).toBe('post')
    expect(Math.hypot(guide.x - HEALTH_GUIDE.at.x, guide.z - HEALTH_GUIDE.at.z)).toBeLessThan(0.3)

    v.offer(a, 'full')
    stepFor(sim, 0.5, [a])
    const k = v.kiosks[0]
    expect(k.userId).toBe(a.id)
    expect(k.assisted).toBe(true)
    expect(v.guideFor).toBe(0)

    stepFor(sim, 25, [a])
    expect(guide.helping).toBe(0)
    expect(guide.state).toBe('helping')
    const spot = guideSpotFor(0)
    expect(Math.hypot(guide.x - spot.at.x, guide.z - spot.at.z)).toBeLessThan(0.8)
    expect(guide.entity.anim).toBe('talk')

    // the session runs to its end, 1.3 x slower than any unassisted session can be
    while (k.phase !== 'idle') stepFor(sim, 5, [a])
    const log = v.stats.sessions[0]
    expect(log.assisted).toBe(true)
    expect(log.endedAt - log.startedAt).toBeGreaterThanOrEqual(214 * CONFIG.vitals.assistFactor - 1)
    expect(v.guideFor).toBe(-1)

    stepFor(sim, 30, [a])
    expect(guide.state).toBe('post')
    expect(Math.hypot(guide.x - HEALTH_GUIDE.at.x, guide.z - HEALTH_GUIDE.at.z)).toBeLessThan(0.6)

    const lines = sim.log.events.filter((e) => e.type === 'healthCheck')
    expect(lines[0].text).toBe(`Nurse Ingrid is helping ${a.name} at kiosk 1.`)
  })

  it('helps one kiosk at a time: a second elderly user while she is busy goes unassisted', () => {
    const sim = bareSim(6)
    const v = sim.vitals
    v.ensureGuide()
    const a = new FakeSubject('hk-6', 'Ana Silva', () => sim.t)
    const b = new FakeSubject('hk-7', 'Ben Cho', () => sim.t)
    v.setAge(a.id, 80)
    v.setAge(b.id, 84)
    v.offer(a, 'full')
    v.offer(b, 'full')
    stepFor(sim, 0.5, [a, b])
    expect(v.kiosks[0].assisted).toBe(true)
    expect(v.kiosks[1].assisted).toBe(false)
    expect(v.guideFor).toBe(0)
    while (v.kiosks.some((k) => k.phase !== 'idle')) stepFor(sim, 5, [a, b])
    const logs = v.stats.sessions
    expect(logs.find((s) => s.userId === a.id)!.assisted).toBe(true)
    expect(logs.find((s) => s.userId === b.id)!.assisted).toBe(false)
  })

  it('without a guide on site nobody is assisted', () => {
    const sim = bareSim(7)
    const v = sim.vitals
    const a = new FakeSubject('hk-8', 'Ana Silva', () => sim.t)
    v.setAge(a.id, 90)
    v.offer(a, 'full')
    stepFor(sim, 0.5, [a])
    expect(v.kiosks[0].assisted).toBe(false)
  })

  it('her helping spots are clear of every route in the lobby strip (a spot on somebody\'s route once froze the first person called)', () => {
    const entrance = { x: -60.8, z: 0 }
    const line = [0, 1, 2, 3].map((i) => ({ x: HEALTH_LINE.front.x, z: HEALTH_LINE.front.z - i * HEALTH_LINE.pitch }))
    const stands = HEALTH_KIOSKS.map((k) => k.stand.at)
    const stools = HEALTH_KIOSKS.map((k) => k.bpSeat.at)
    const routes: { x: number; z: number }[][] = []
    for (const l of line) for (const s of stands) routes.push(tryPlanRoute(l, s)!)
    for (const s of stands) routes.push(tryPlanRoute(s, entrance)!)
    for (const l of line) routes.push(tryPlanRoute(entrance, l)!)
    for (let i = 0; i < 2; i++) routes.push(tryPlanRoute(stands[i], stools[i])!, tryPlanRoute(stools[i], stands[i])!)
    for (const r of routes) expect(r).toBeTruthy()
    const dist = (p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => {
      const dx = b.x - a.x
      const dz = b.z - a.z
      const l2 = dx * dx + dz * dz
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2))
      return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
    }
    for (const i of [0, 1]) {
      const g = guideSpotFor(i)
      let min = Infinity
      for (const r of routes) for (let k = 1; k < r.length; k++) min = Math.min(min, dist(g.at, r[k - 1], r[k]))
      expect(min, `kiosk ${i + 1}`).toBeGreaterThanOrEqual(0.5)
      // close enough to help: within 1.3 m of the platform, facing it
      const stand = stands[i]
      expect(Math.hypot(g.at.x - stand.x, g.at.z - stand.z)).toBeLessThan(1.3)
      const toStand = Math.atan2(stand.x - g.at.x, stand.z - g.at.z)
      expect(Math.abs(Math.atan2(Math.sin(g.heading - toStand), Math.cos(g.heading - toStand)))).toBeLessThan(1e-9)
    }
  })
})
