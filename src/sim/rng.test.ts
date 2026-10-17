import { describe, expect, it } from 'vitest'
import { Rng, chance, gaussian, hashString, int, mulberry32, pick, range } from './rng'

describe('mulberry32', () => {
  it('is deterministic for a seed and different across seeds', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const c = mulberry32(43)
    const sa = Array.from({ length: 20 }, a)
    const sb = Array.from({ length: 20 }, b)
    const sc = Array.from({ length: 20 }, c)
    expect(sa).toEqual(sb)
    expect(sa).not.toEqual(sc)
  })

  it('produces floats in [0, 1) that cover the interval', () => {
    const r = mulberry32(7)
    let min = 1
    let max = 0
    for (let i = 0; i < 20000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    expect(min).toBeLessThan(0.01)
    expect(max).toBeGreaterThan(0.99)
  })
})

describe('helpers', () => {
  it('range, int, pick and chance stay inside their bounds', () => {
    const r = mulberry32(1)
    for (let i = 0; i < 2000; i++) {
      const x = range(r, 3, 5)
      expect(x).toBeGreaterThanOrEqual(3)
      expect(x).toBeLessThan(5)
      const k = int(r, 2, 4)
      expect([2, 3, 4]).toContain(k)
      expect(['a', 'b', 'c']).toContain(pick(r, ['a', 'b', 'c']))
    }
    let hits = 0
    for (let i = 0; i < 20000; i++) if (chance(r, 0.3)) hits++
    expect(hits / 20000).toBeGreaterThan(0.28)
    expect(hits / 20000).toBeLessThan(0.32)
  })

  it('gaussian has about the requested mean and spread', () => {
    const r = mulberry32(5)
    const n = 20000
    let sum = 0
    let sq = 0
    for (let i = 0; i < n; i++) {
      const v = gaussian(r, 10, 2)
      sum += v
      sq += (v - 10) * (v - 10)
    }
    expect(sum / n).toBeGreaterThan(9.9)
    expect(sum / n).toBeLessThan(10.1)
    expect(Math.sqrt(sq / n)).toBeGreaterThan(1.9)
    expect(Math.sqrt(sq / n)).toBeLessThan(2.1)
  })

  it('pick refuses an empty array', () => {
    expect(() => pick(mulberry32(1), [])).toThrow()
  })
})

describe('Rng', () => {
  it('replays exactly from the same seed', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    for (let i = 0; i < 100; i++) {
      expect(a.float()).toBe(b.float())
      expect(a.gaussian()).toBe(b.gaussian())
      expect(a.int(0, 9)).toBe(b.int(0, 9))
    }
  })

  it('forks are reproducible and independent of how much the parent has drawn', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    for (let i = 0; i < 50; i++) a.float()
    const fa = a.fork('ped-1')
    const fb = b.fork('ped-1')
    expect(Array.from({ length: 10 }, () => fa.float())).toEqual(Array.from({ length: 10 }, () => fb.float()))
    expect(b.fork('ped-2').float()).not.toBe(b.fork('ped-1').float())
  })

  it('weighted never picks a zero-weight item and follows the weights', () => {
    const r = new Rng(9)
    const counts = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 20000; i++) counts[r.weighted(['a', 'b', 'c'] as const, [1, 3, 0])]++
    expect(counts.c).toBe(0)
    expect(counts.b / counts.a).toBeGreaterThan(2.7)
    expect(counts.b / counts.a).toBeLessThan(3.3)
  })

  it('shuffle keeps the elements', () => {
    const r = new Rng(3)
    const arr = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = r.shuffle([...arr])
    expect([...out].sort()).toEqual(arr)
  })

  it('hashString is stable', () => {
    expect(hashString('waltz')).toBe(hashString('waltz'))
    expect(hashString('waltz')).not.toBe(hashString('city'))
  })
})
