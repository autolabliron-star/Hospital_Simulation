/**
 * Warm starts and determinism for the bed flow: a discharge picked up half way (signed, or already leaving) still ends with the
 * patient home, the same (seed, startHour) gives the same day, and a patient's pose follows the room's recline.
 */
import { describe, expect, it } from 'vitest'
import { DT, hourToT, makeSim, Recorder, runUntil } from './testkit'
import { watch } from './invariants'

function snapshot(sim: ReturnType<typeof makeSim>) {
  return [...sim.life.rooms.values()].map((r) => `${r.roomId} ${r.bed} ${r.patientId} ${r.patientName} ${r.since.toFixed(2)} v${r.version}`)
}

describe('warm start in the middle of a discharge', () => {
  it('B5 signed at 09:45 and waiting for the family at 10:30: medicines, family, changing, home', () => {
    const sim = makeSim(5, 10.5)
    expect(sim.life.rooms.get('B5')).toMatchObject({ bed: 'dischargeSigned', patientId: 'pt-B5' })
    const rec = new Recorder(sim)
    const o = watch(sim)
    runUntil(sim, hourToT(10.5) + 80 * 60, rec, o.sample)
    expect(rec.events.filter((e) => e.type === 'wentHome' && e.subjectId === 'pt-B5')).toHaveLength(1)
    expect(rec.events.some((e) => e.type === 'visitorLeft' && e.roomId === 'B5' && /left with/.test(e.text))).toBe(true)
    expect(o.out.lifecycle.get('B5')!.slice(0, 4)).toEqual(['dischargeSigned', 'leaving', 'needsCleaning', 'cleaning'])
    expect(o.out.problems).toEqual([])
    expect(sim.beds.board.log.violations).toEqual([])
  }, 120_000)

  it('B5 at 10:42, already changing: the family is in the room and the patient goes straight out', () => {
    const sim = makeSim(5, 10.7)
    // the medicines are given and the family is in the room: the patient got up at once
    expect(['leaving', 'dischargeSigned']).toContain(sim.life.rooms.get('B5')!.bed)
    const rec = new Recorder(sim)
    const o = watch(sim)
    runUntil(sim, hourToT(10.7) + 12 * 60, rec, o.sample)
    expect(rec.events.filter((e) => e.type === 'wentHome' && e.subjectId === 'pt-B5')).toHaveLength(1)
    expect(o.out.sawHidden.has('pt-B5')).toBe(true)
    expect(o.out.problems).toEqual([])
  }, 120_000)

  it('a room discharged this morning is already clean (or being cleaned), so an ER admission can take it at once', () => {
    const sim = makeSim(5, 10.5)
    // A1 left at 10:15: a quarter of an hour ago
    expect(['needsCleaning', 'ready']).toContain(sim.life.rooms.get('A1')!.bed)
    expect(sim.beds.stats.dischargesToday).toBe(1)
    expect(sim.beds.stats.dischargesBeforeNoon).toBe(1)
    // the planned patient is not in the building any more
    expect(sim.entities.has('pt-A1')).toBe(false)
  })
})

describe('determinism', () => {
  for (const hour of [10.5, 15]) {
    it(`the same seed and start hour give the same day (from ${hour})`, () => {
      const a = makeSim(31, hour)
      const b = makeSim(31, hour)
      const ra = new Recorder(a)
      const rb = new Recorder(b)
      expect(snapshot(a)).toEqual(snapshot(b))
      runUntil(a, hourToT(hour) + 12 * 60, ra)
      runUntil(b, hourToT(hour) + 12 * 60, rb)
      const fmt = (r: Recorder) => r.events.map((e) => `${e.t.toFixed(3)} ${e.type} ${e.text}`)
      expect(fmt(ra).length).toBeGreaterThan(20)
      expect(fmt(rb)).toEqual(fmt(ra))
      expect(snapshot(b)).toEqual(snapshot(a))
      expect(a.entities.size).toBe(b.entities.size)
    }, 120_000)
  }

  it('a different seed gives a different day', () => {
    const a = makeSim(31, 10.5)
    const b = makeSim(32, 10.5)
    runUntil(a, hourToT(10.5) + 300)
    runUntil(b, hourToT(10.5) + 300)
    expect(a.log.events.map((e) => e.text)).not.toEqual(b.log.events.map((e) => e.text))
  })
})

describe('the patient in bed', () => {
  it('raises the bed head with the room: seated pose recline above one half, lie below', () => {
    const sim = makeSim(9)
    const room = sim.life.rooms.get('A2')!
    const e = sim.entities.get('pt-A2')!
    for (let i = 0; i < 10; i++) sim.step(DT)
    expect(e.seated?.pose).toBe('lie')
    room.recline = 0.9
    for (let i = 0; i < 10; i++) sim.step(DT)
    expect(e.seated?.pose).toBe('recline')
    room.recline = 0.4
    for (let i = 0; i < 10; i++) sim.step(DT)
    expect(e.seated?.pose).toBe('lie')
  })

  it('the default start is unchanged: sixteen occupied rooms with their patients, nothing in the log about beds', () => {
    const sim = makeSim(9)
    expect(sim.life.rooms.size).toBe(16)
    for (const r of sim.life.rooms.values()) expect(r.bed).toBe('occupied')
    runUntil(sim, 120)
    expect(sim.log.events.some((e) => ['dischargeSigned', 'wentHome', 'roomCleaned', 'bedAssigned', 'patientBoarding', 'admittedToWard'].includes(e.type))).toBe(false)
  })
})
