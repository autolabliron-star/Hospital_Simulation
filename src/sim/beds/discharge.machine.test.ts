import { describe, expect, it } from 'vitest'
import { SimClock } from '../er/simClock'
import { createDischarge, DISCHARGE_STATES, dischargeStateOf, FORCE_SECONDS, type DischargeActor, type DischargeHost, type DischargeState } from './discharge.machine'

function make(o: { wheelchair?: boolean; medsGiven?: boolean; familyHere?: boolean; changeSeconds?: number } = {}) {
  const clock = new SimClock()
  const visited: DischargeState[] = []
  const host: DischargeHost = { enter: (s) => visited.push(s) }
  const actor = createDischarge({ host, changeSeconds: o.changeSeconds ?? 120, wheelchair: o.wheelchair ?? false, medsGiven: o.medsGiven, familyHere: o.familyHere }, clock)
  return { actor, clock, visited }
}

const at = (a: DischargeActor): DischargeState => dischargeStateOf(a.getSnapshot().value)

describe('discharge machine', () => {
  it('waits for both the take-home medicines and the family, in either order', () => {
    const { actor, visited } = make()
    expect(at(actor)).toBe('signed')
    actor.send({ type: 'MEDS_GIVEN' })
    expect(at(actor)).toBe('signed')
    actor.send({ type: 'FAMILY_HERE' })
    expect(at(actor)).toBe('changing.standing')
    expect(visited).toEqual(['signed', 'changing.standing'])

    const b = make()
    b.actor.send({ type: 'FAMILY_HERE' })
    expect(at(b.actor)).toBe('signed')
    b.actor.send({ type: 'MEDS_GIVEN' })
    expect(at(b.actor)).toBe('changing.standing')
  })

  it('walks a patient out: stand, bathroom, hidden for the changing time on the sim clock, dressed, out, gone', () => {
    const { actor, clock, visited } = make({ medsGiven: true, familyHere: true, changeSeconds: 100 })
    expect(at(actor)).toBe('changing.standing')
    actor.send({ type: 'STOOD' })
    actor.send({ type: 'AT_BATH' })
    expect(at(actor)).toBe('changing.inside')
    clock.advanceTo(clock.now + 99_000)
    expect(at(actor)).toBe('changing.inside')
    clock.advanceTo(clock.now + 2_000)
    expect(at(actor)).toBe('changing.out')
    actor.send({ type: 'DRESSED' })
    expect(at(actor)).toBe('leave.walking')
    actor.send({ type: 'AT_EXIT' })
    expect(at(actor)).toBe('leave.fading')
    actor.send({ type: 'OUT' })
    expect(at(actor)).toBe('gone')
    expect(actor.getSnapshot().status).toBe('done')
    expect(visited).toEqual(['signed', 'changing.standing', 'changing.walking', 'changing.inside', 'changing.out', 'leave.walking', 'leave.fading', 'gone'])
  })

  it('a patient who leaves by wheelchair waits for the porter and rides out', () => {
    const { actor, clock, visited } = make({ wheelchair: true, medsGiven: true, familyHere: true, changeSeconds: 30 })
    actor.send({ type: 'STOOD' })
    actor.send({ type: 'AT_BATH' })
    actor.send({ type: 'DRESSED' }) // too early (still inside the pod): ignored
    expect(at(actor)).toBe('changing.inside')
    clock.advanceTo(clock.now + 31_000)
    actor.send({ type: 'DRESSED' })
    expect(at(actor)).toBe('leave.wheelchairWaiting')
    actor.send({ type: 'PICKED_UP' })
    expect(at(actor)).toBe('leave.riding')
    actor.send({ type: 'AT_EXIT' })
    expect(at(actor)).toBe('leave.fading')
    expect(visited).not.toContain('leave.walking')
  })

  it('moves on by itself after the safety time if the medicines or the family never come', () => {
    const { actor, clock } = make()
    clock.advanceTo((FORCE_SECONDS - 1) * 1000)
    expect(at(actor)).toBe('signed')
    clock.advanceTo((FORCE_SECONDS + 1) * 1000)
    expect(at(actor)).toBe('changing.standing')
  })

  it('every state is reachable (the list of states is complete)', () => {
    const seen = new Set<DischargeState>()
    for (const wheelchair of [false, true]) {
      const { actor, clock, visited } = make({ wheelchair, medsGiven: true, familyHere: true, changeSeconds: 10 })
      actor.send({ type: 'STOOD' })
      actor.send({ type: 'AT_BATH' })
      clock.advanceTo(clock.now + 11_000)
      actor.send({ type: 'DRESSED' })
      actor.send({ type: 'PICKED_UP' })
      actor.send({ type: 'AT_EXIT' })
      actor.send({ type: 'OUT' })
      for (const s of visited) seen.add(s)
    }
    expect([...seen].sort()).toEqual([...DISCHARGE_STATES].sort())
  })
})
