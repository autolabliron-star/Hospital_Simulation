import { describe, expect, it } from 'vitest'
import { erPanelFor, LAB_CATALOGUE } from '@/content/lab'
import { CONFIG } from '../config'
import { Rng } from '../rng'
import { avatarCrownM, variantOf } from './body'
import { bmiOf, bpOfRounds, deurenbergBodyFat, drawAge, measureBp, measureHeight, profileFor, readingAt } from './model'

const ID = (i: number) => `hk-${i + 1}`
const people = (n: number, seed = 7) => {
  const rng = new Rng(seed)
  return Array.from({ length: n }, (_, i) => profileFor(ID(i), `Person ${i}`, {}, rng))
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

describe('the formulas', () => {
  it('Deurenberg: 1.2 BMI + 0.23 age - 10.8 male - 5.4', () => {
    expect(deurenbergBodyFat(25, 40, true)).toBeCloseTo(23.0, 9)
    expect(deurenbergBodyFat(25, 40, false)).toBeCloseTo(33.8, 9)
    expect(deurenbergBodyFat(30, 60, true)).toBeCloseTo(1.2 * 30 + 0.23 * 60 - 10.8 - 5.4, 9)
  })

  it('BMI is kg per square metre', () => {
    expect(bmiOf(80, 200)).toBeCloseTo(20, 9)
    expect(bmiOf(64, 160)).toBeCloseTo(25, 9)
  })

  it('a profile follows both: its BMI is its weight over its height squared and its body fat is Deurenberg of that', () => {
    for (const p of people(300)) {
      expect(p.bmi).toBeCloseTo(bmiOf(p.weightKg, p.heightCm), 9)
      const want = Math.min(60, Math.max(3, deurenbergBodyFat(p.bmi, p.age, !p.female)))
      expect(p.bodyFatPct).toBeCloseTo(want, 1)
    }
  })

  it('the cuff mean is both of two readings, or the last two of three', () => {
    expect(bpOfRounds([])).toBeNull()
    expect(bpOfRounds([[120, 80]])).toEqual([120, 80])
    expect(bpOfRounds([[120, 80], [130, 84]])).toEqual([125, 82])
    expect(bpOfRounds([[150, 90], [130, 84], [126, 80]])).toEqual([128, 82])
  })
})

describe('the population', () => {
  const ps = people(3000)

  it('BMI is about N(26, 4), clamped to 17..42', () => {
    const b = ps.map((p) => p.bmi)
    expect(mean(b)).toBeGreaterThan(25.6)
    expect(mean(b)).toBeLessThan(26.4)
    expect(sd(b)).toBeGreaterThan(3.6)
    expect(sd(b)).toBeLessThan(4.2)
    expect(Math.min(...b)).toBeGreaterThanOrEqual(17 - 0.05)
    expect(Math.max(...b)).toBeLessThanOrEqual(42 + 0.05)
  })

  it('heights are the avatars (1.64 to 1.85 m) and weights follow from them', () => {
    for (const p of ps.slice(0, 500)) {
      expect(Math.abs(p.heightCm - avatarCrownM(p.id, variantOf(p.id)) * 100)).toBeLessThanOrEqual(0.05)
      expect(p.weightKg).toBeGreaterThan(40)
      expect(p.weightKg).toBeLessThan(150)
    }
  })

  it('pressure, pulse, SpO2 and temperature follow the age baselines', () => {
    const young = people(2500).filter((p) => p.age <= 39)
    const old = people(2500).filter((p) => p.age >= 65)
    expect(young.length).toBeGreaterThan(200)
    expect(old.length).toBeGreaterThan(200)
    expect(mean(young.map((p) => p.sys))).toBeGreaterThan(114)
    expect(mean(young.map((p) => p.sys))).toBeLessThan(122)
    expect(mean(old.map((p) => p.sys))).toBeGreaterThan(131)
    expect(mean(old.map((p) => p.sys))).toBeLessThan(141)
    expect(mean(old.map((p) => p.spo2))).toBeLessThan(mean(young.map((p) => p.spo2)))
    for (const p of ps) {
      expect(p.spo2).toBeLessThanOrEqual(100)
      expect(p.tempC).toBeGreaterThan(35)
      expect(p.tempC).toBeLessThan(41)
    }
  })

  it('a seeded age is 18 to 92', () => {
    const rng = new Rng(3)
    const ages = Array.from({ length: 2000 }, () => drawAge(rng))
    expect(Math.min(...ages)).toBeGreaterThanOrEqual(18)
    expect(Math.max(...ages)).toBeLessThanOrEqual(92)
    expect(mean(ages)).toBeGreaterThan(47)
    expect(mean(ages)).toBeLessThan(53)
  })

  it('white-coat offsets are 0 to 30 mmHg with a 0.4 share on the diastolic', () => {
    for (const p of ps) {
      expect(p.whiteCoatSys).toBeGreaterThanOrEqual(0)
      expect(p.whiteCoatSys).toBeLessThanOrEqual(30)
      expect(p.whiteCoatDia).toBeCloseTo(p.whiteCoatSys * CONFIG.vitals.whiteCoatDiaShare, 9)
    }
  })
})

describe('an ER reason shifts the display values', () => {
  it('a fever raises the temperature and the pulse by the content shift, and nothing else changes', () => {
    const reason = Object.keys(LAB_CATALOGUE.erPanels).find((r) => erPanelFor(r) === 'er-fever')!
    const shift = LAB_CATALOGUE.panelShifts['er-fever']
    for (let i = 0; i < 40; i++) {
      const base = profileFor(ID(i), 'Test Person', { age: 40 }, new Rng(11))
      const fever = profileFor(ID(i), 'Test Person', { age: 40, reason }, new Rng(11))
      expect(fever.panel).toBe('er-fever')
      expect(fever.tempC - base.tempC).toBeCloseTo(shift.tempC, 6)
      expect(fever.pulse - base.pulse).toBeCloseTo(shift.pulse, 6)
      expect(fever.heightCm).toBe(base.heightCm)
      expect(fever.sys).toBe(base.sys)
    }
  })

  it('a reason with no panel changes nothing', () => {
    const a = profileFor('er-1', 'Ana Silva', { age: 50 }, new Rng(5))
    const b = profileFor('er-1', 'Ana Silva', { age: 50, reason: 'Something the content does not know' }, new Rng(5))
    expect(b).toEqual(a)
  })
})

describe('determinism', () => {
  it('the same id and seed give the same body, whatever was drawn before', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    for (let i = 0; i < 50; i++) a.float() // a is used for other things first
    expect(profileFor('er-9', 'Ana Silva', {}, a)).toEqual(profileFor('er-9', 'Ana Silva', {}, b))
  })

  it('different people differ', () => {
    const rng = new Rng(1)
    expect(profileFor('hk-1', 'A B', {}, rng)).not.toEqual(profileFor('hk-2', 'A B', {}, rng))
  })

  it('the same readings come from the same seed', () => {
    const p = profileFor('hk-1', 'Ana Silva', {}, new Rng(9))
    expect(readingAt(p, 'kiosk', new Rng(2))).toEqual(readingAt(p, 'kiosk', new Rng(2)))
    expect(readingAt(p, 'kiosk', new Rng(2))).not.toEqual(readingAt(p, 'kiosk', new Rng(3)))
  })
})

describe('readings', () => {
  const rng = new Rng(77)
  const ps = people(250, 5)

  it('a kiosk reading is complete, rounded the way a screen shows it, and consistent', () => {
    for (const p of ps.slice(0, 80)) {
      const r = readingAt(p, 'kiosk', rng, { station: 1, at: 100 })
      expect(r.partial).toBe(false)
      expect(r.source).toBe('kiosk')
      expect(r.station).toBe(1)
      for (const k of ['sys', 'dia', 'pulse', 'spo2', 'tempC', 'heightCm', 'weightKg', 'bmi', 'bodyFatPct'] as const) expect(r[k], k).not.toBeNull()
      expect(Number.isInteger(r.sys!)).toBe(true)
      expect(Number.isInteger(r.spo2!)).toBe(true)
      expect(r.spo2!).toBeLessThanOrEqual(100)
      expect(r.bmi!).toBeCloseTo(bmiOf(r.weightKg!, r.heightCm!), 1)
      expect(r.bp).toEqual([[r.sys, r.dia]])
    }
  })

  it('the kiosk height is the avatar within half a centimetre', () => {
    for (const p of ps) {
      const h = measureHeight(p, rng)
      expect(Math.abs(h - avatarCrownM(p.id, variantOf(p.id)) * 100)).toBeLessThanOrEqual(0.5)
    }
  })

  it('a triage reading has the white-coat offset: over 200 people it is 10 to 30 mmHg above the kiosk reading', () => {
    const diffs = ps.slice(0, 200).map((p) => {
      const kiosk = readingAt(p, 'kiosk', rng)
      const triage = readingAt(p, 'triage', rng)
      return triage.sys! - kiosk.sys!
    })
    const m = mean(diffs)
    expect(m).toBeGreaterThanOrEqual(10)
    expect(m).toBeLessThanOrEqual(30)
  })

  it('a triage reading is a nurse\'s vitals: no height or weight, no station', () => {
    const r = readingAt(ps[0], 'triage', rng)
    expect(r.source).toBe('triage')
    expect(r.station).toBeNull()
    expect(r.heightCm).toBeNull()
    expect(r.weightKg).toBeNull()
    expect(r.bodyFatPct).toBeNull()
    expect(r.sys).not.toBeNull()
    expect(r.partial).toBe(false)
  })

  it('the first cuff reading runs a little high, the later ones do not', () => {
    const p = ps[3]
    const first = mean(Array.from({ length: 4000 }, () => measureBp(p, 1, rng)[0]))
    const second = mean(Array.from({ length: 4000 }, () => measureBp(p, 2, rng)[0]))
    expect(first - second).toBeGreaterThan(1.5)
    expect(first - second).toBeLessThan(3.5)
  })
})
