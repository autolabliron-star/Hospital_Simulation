/**
 * Your own kiosk session (E at a kiosk): a short demo with the same phases and poses, a reading under 'player', and it ends by itself when you walk away.
 */
import { describe, expect, it } from 'vitest'
import { heightFor } from '@/scene/actors/crowd/outfit'
import { CONFIG } from '../config'
import { HEALTH_KIOSKS } from '../places'
import type { HealthKioskPhase } from '../types'
import { FakeSubject, bareSim, drive } from './testkit'

function withPlayer(seed = 1, at = HEALTH_KIOSKS[0].stand) {
  const sim = bareSim(seed)
  sim.addPlayer(at)
  return sim
}

describe('your session', () => {
  it('starts at a free kiosk, runs the whole script in about 40 s and leaves a complete reading under "player"', () => {
    const sim = withPlayer()
    const v = sim.vitals
    expect(v.beginPlayer(0)).toBe('started')
    const phases: HealthKioskPhase[] = []
    let t0 = sim.t
    let end = -1
    drive(sim, 90, (t) => {
      const k = v.kiosks[0]
      if (k.phase !== 'idle' && phases[phases.length - 1] !== k.phase) phases.push(k.phase)
      if (k.phase === 'idle' && end < 0) end = t
    })
    t0 = 0
    expect(phases).toEqual(['login', 'height', 'weight', 'bodyFat', 'sit', 'spo2', 'bp', 'temp', 'report'])
    expect(end - t0).toBeGreaterThan(CONFIG.vitals.playerSessionSeconds - 1)
    expect(end - t0).toBeLessThan(CONFIG.vitals.playerSessionSeconds + 1)
    const r = v.readingsFor('player')
    expect(r).toHaveLength(1)
    expect(r[0].source).toBe('player')
    expect(r[0].partial).toBe(false)
    expect(r[0].station).toBe(0)
    expect(r[0].bp).toHaveLength(1)
    for (const k of ['sys', 'dia', 'pulse', 'spo2', 'tempC', 'heightCm', 'weightKg', 'bmi', 'bodyFatPct'] as const) expect(r[0][k], k).not.toBeNull()
    expect(v.kiosks[0].sessionsToday).toBe(1)
    expect(v.beginPlayer(0)).toBe('started') // free again at once
  })

  it('reads your height from your avatar', () => {
    const sim = withPlayer(2)
    const e = sim.playerAvatar!
    sim.vitals.beginPlayer(0)
    drive(sim, 60)
    const h = sim.vitals.readingsFor('player')[0].heightCm!
    expect(Math.abs(h - heightFor('player', e.variant) * 100)).toBeLessThanOrEqual(0.5)
  })

  it('shows the same poses as everybody, but only the pose: the scene moves you', () => {
    const sim = withPlayer(3)
    const e = sim.playerAvatar!
    const v = sim.vitals
    v.beginPlayer(0)
    const anims = new Map<string, Set<string>>()
    drive(sim, 60, () => {
      const p = v.kiosks[0].phase
      if (!anims.has(p)) anims.set(p, new Set())
      anims.get(p)!.add(e.anim)
      expect(e.position.y).toBe(0)
      expect(e.seated).toBeUndefined()
    })
    expect([...anims.get('login')!]).toContain('finger')
    expect([...anims.get('bodyFat')!]).toEqual(['grip'])
    expect([...anims.get('bp')!]).toEqual(['armIn'])
    expect(['finger', 'grip', 'armIn']).not.toContain(e.anim)
  })

  it('says one event line with your numbers', () => {
    const sim = withPlayer(4)
    sim.vitals.beginPlayer(0)
    drive(sim, 60)
    const r = sim.vitals.readingsFor('player')[0]
    const lines = sim.log.events.filter((x) => x.type === 'healthCheck')
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe(`You finished a health check: BP ${r.sys}/${r.dia}, SpO₂ ${r.spo2}%, BMI ${r.bmi!.toFixed(1)}.`)
  })

  it('cancelPlayer ends it with a partial reading and frees the kiosk', () => {
    const sim = withPlayer(5, HEALTH_KIOSKS[1].stand)
    const v = sim.vitals
    v.beginPlayer(1)
    drive(sim, 18)
    expect(v.kiosks[1].phase).not.toBe('idle')
    v.cancelPlayer()
    expect(v.kiosks[1].phase).toBe('idle')
    expect(v.kiosks[1].userId).toBeNull()
    const r = v.readingsFor('player')
    expect(r).toHaveLength(1)
    expect(r[0].partial).toBe(true)
    expect(r[0].heightCm).not.toBeNull()
    expect(r[0].tempC).toBeNull()
    expect(sim.playerAvatar!.anim).toBe('idle')
    expect(v.beginPlayer(1)).toBe('started')
  })

  it('ends by itself when you walk more than 1.5 m from the stand spot', () => {
    const sim = withPlayer(6)
    const v = sim.vitals
    v.beginPlayer(0)
    drive(sim, 10)
    expect(v.kiosks[0].phase).not.toBe('idle')
    // a step or two aside is fine
    const stand = HEALTH_KIOSKS[0].stand
    sim.movePlayer(stand.at.x + 0.6, stand.at.z - 0.5, 0, 0)
    drive(sim, 1)
    expect(v.kiosks[0].phase).not.toBe('idle')
    sim.movePlayer(stand.at.x, stand.at.z - 2.2, Math.PI, 1.2)
    drive(sim, 0.2)
    expect(v.kiosks[0].phase).toBe('idle')
    expect(v.readingsFor('player')[0].partial).toBe(true)
  })

  it('gives you a short grace to be carried to the kiosk', () => {
    const sim = withPlayer(7, { at: { x: -56, z: 2 }, heading: 0 })
    const v = sim.vitals
    v.beginPlayer(0)
    drive(sim, 1.5)
    expect(v.kiosks[0].phase).toBe('login')
    drive(sim, 2)
    expect(v.kiosks[0].phase).toBe('idle') // still far away after the grace
  })

  it('is busy when the kiosk has somebody, when you are already in a session, and when you are not in the hospital', () => {
    const sim = withPlayer(8)
    const v = sim.vitals
    const a = new FakeSubject('hk-1', 'Ana Silva', () => sim.t)
    v.offer(a, 'full')
    drive(sim, 0.2, (t) => a.tick(t))
    expect(v.kiosks[0].userId).toBe(a.id)
    expect(v.beginPlayer(0)).toBe('busy')
    expect(v.beginPlayer(1)).toBe('started')
    expect(v.beginPlayer(1)).toBe('busy')
    v.cancelPlayer()
    sim.removePlayer()
    expect(v.beginPlayer(1)).toBe('busy')
    expect(v.beginPlayer(7)).toBe('busy')
  })

  it('does not take the kiosk from the line: the next person waits for the end of your session', () => {
    const sim = withPlayer(9)
    const v = sim.vitals
    v.beginPlayer(0)
    v.beginPlayer(1) // no-op: already in a session
    const a = new FakeSubject('hk-2', 'Ben Cho', () => sim.t)
    v.offer(a, 'full')
    drive(sim, 0.2, (t) => a.tick(t))
    expect(v.kiosks[1].userId).toBe(a.id) // the other kiosk takes them
    expect(v.kiosks[0].userId).toBe('player')
  })
})
