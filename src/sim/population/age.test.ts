import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Rng } from '../rng'
import { Simulation } from '../Simulation'
import { ageWalkFactor, drawVisitorAge } from './age'

describe('ageWalkFactor', () => {
  it('is 1 up to 60, falls with age and never rises', () => {
    expect(ageWalkFactor(18)).toBe(1)
    expect(ageWalkFactor(60)).toBe(1)
    let prev = 1
    for (let a = 60; a <= 95; a++) {
      const f = ageWalkFactor(a)
      expect(f, `age ${a}`).toBeLessThanOrEqual(prev + 1e-12)
      prev = f
    }
  })

  it('walks an 88-year-old at about 0.7 of a young adult', () => {
    expect(ageWalkFactor(88)).toBeGreaterThan(0.65)
    expect(ageWalkFactor(88)).toBeLessThan(0.75)
    expect(ageWalkFactor(88) * CONFIG.people.walkSpeed).toBeLessThan(CONFIG.people.walkSpeed * 0.75)
  })

  it('draws adult visitor ages, the same for the same seed', () => {
    const a = Array.from({ length: 50 }, (_, i) => drawVisitorAge(new Rng(i)))
    const b = Array.from({ length: 50 }, (_, i) => drawVisitorAge(new Rng(i)))
    expect(a).toEqual(b)
    for (const x of a) {
      expect(x).toBeGreaterThanOrEqual(20)
      expect(x).toBeLessThanOrEqual(89)
    }
  })
})

describe('age slows the people created by the population code', () => {
  it('gives an old outpatient a slower pace than a young one (content ages)', { timeout: 60_000 }, () => {
    const s = new Simulation(5, { startHour: 12, inFlight: false })
    for (let i = 0; i < 60 * 60 * 25; i++) s.step(1 / 60)
    const people = s.imaging.outpatients
    // by 12:25 a good number of the day's outpatients have arrived
    expect(s.imaging.outpatientsSpawned).toBeGreaterThan(3)
    const young = people.filter((o) => o.age < 55)
    const old = people.filter((o) => o.age >= 75)
    for (const o of people) expect(o.cruise, `${o.name} ${o.age}`).toBeLessThanOrEqual(CONFIG.er.walkSpeed * 1.2 * ageWalkFactor(o.age) + 1e-9)
    if (young.length && old.length) {
      const mean = (xs: typeof people) => xs.reduce((t, o) => t + o.cruise / ageWalkFactor(o.age), 0) / xs.length
      // (the personal variety is the same for both: the difference is the age factor)
      expect(Math.max(...old.map((o) => o.cruise))).toBeLessThan(CONFIG.er.walkSpeed * 1.2 * 0.9 + 1e-9)
      expect(mean(old)).toBeGreaterThan(0)
    }
  })
})
