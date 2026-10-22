/**
 * F-23: a complaint's own admission chance (content/admissions.json) overrides the acuity table in both directions: 1 is always admitted
 * (a stroke, a fit, confusion), 0 never, and a small chance (a neck bump) follows its own number. One draw is made either way.
 */
import { describe, expect, it } from 'vitest'
import { admitChanceFor } from '@/content/admissions'
import { Rng } from '../rng'
import { createPathway, stateOf, type PathwayActor } from './pathway.machine'
import { SimClock } from './simClock'

const SEC = 1000
const at = (a: PathwayActor) => stateOf(a.getSnapshot().value)

function decide(seed: number, acuity: number, admitChance: number | null): { admitted: boolean; draws: number } {
  const clock = new SimClock()
  const rng = new Rng(seed)
  let draws = 0
  const counting = { between: rng.between.bind(rng), chance: (p: number) => (draws++, rng.chance(p)) }
  const actor = createPathway({ rng: counting, host: { enter: () => {} }, clock, acuity, ambulance: acuity <= 2, patienceSeconds: Infinity, admitChance }, clock)
  actor.send({ type: 'ARRIVED' })
  if (!actor.getSnapshot().context.critical) {
    actor.send({ type: 'SERVICE_BEGIN' })
    clock.advanceTo(clock.now + 41 * SEC)
    actor.send({ type: 'CALLED' })
    actor.send({ type: 'IN_TRIAGE_BAY' })
    clock.advanceTo(clock.now + 600 * SEC)
  }
  actor.send({ type: 'BAY_CALLED' })
  actor.send({ type: 'ON_TROLLEY' })
  actor.send({ type: 'NURSE_HERE' })
  clock.advanceTo(clock.now + (actor.getSnapshot().context.careSeconds + 1) * SEC)
  actor.send({ type: 'DOCTOR_HERE' })
  clock.advanceTo(clock.now + 4000 * SEC)
  actor.send({ type: 'BLOODS_READY' })
  actor.send({ type: 'REVIEW_HERE' })
  clock.advanceTo(clock.now + 4000 * SEC)
  const s = at(actor)
  return { admitted: s.startsWith('admittedOut'), draws }
}

describe('a complaint with its own admission chance (F-23)', () => {
  it('1 admits at every acuity, and 0 never does', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const acuity of [2, 3, 4, 5]) {
        expect(decide(seed, acuity, 1).admitted, `${seed}/${acuity}`).toBe(true)
        expect(decide(seed, acuity, 0).admitted, `${seed}/${acuity}`).toBe(false)
      }
    }
  })

  it('makes the same number of draws whatever the chance (the stream stays the same length)', () => {
    for (const p of [null, 0, 0.05, 1]) expect(decide(3, 3, p).draws, `${p}`).toBe(decide(3, 3, null).draws)
  })

  it('a small chance is rare', () => {
    let n = 0
    for (let seed = 1; seed <= 200; seed++) if (decide(seed, 3, 0.05).admitted) n++
    expect(n).toBeLessThan(30)
  })

  it('the content gives stroke, fit and confusion 1 and a neck bump a small chance', () => {
    for (const r of ['Sudden weakness down one side', 'Fit that has now stopped', 'Confused and very drowsy today']) expect(admitChanceFor(r)).toBe(1)
    expect(admitChanceFor('Minor car bump, neck sore')).toBeLessThanOrEqual(0.05)
  })
})
