import { describe, expect, it } from 'vitest'
import { LAB_CATALOGUE, testById } from '@/content/lab'
import { CONFIG } from '../config'
import type { LabOrder, LabPriority } from '../types'
import { constantValue } from './results'
import { makeBench } from './testkit'

const CFG = CONFIG.lab
const SCIENTIST = 'Scientist Arjun'

function flood(count: number, every = 20, mix = true) {
  // 01:00: the ward's own samples only start arriving at 06:00, after the run
  const b = makeBench(21, 1)
  const reviewStarts: { id: string; priority: LabPriority; t: number; availableThen: boolean }[] = []
  b.lab.verifier.onReviewStart = (id, priority, t) => reviewStarts.push({ id, priority, t, availableThen: true })
  const panels = ['er-chest', 'er-fever', 'op-annual', 'op-diabetes', 'op-thyroid', 'op-anticoag', 'op-precontrast', 'ward-routine']
  const orders: LabOrder[] = []
  for (let i = 0; i < count; i++) {
    orders.push(b.inject({ panel: panels[i % panels.length], priority: mix && i % 3 === 0 ? 'stat' : 'routine', source: i % 4 }))
    b.run(every)
  }
  b.run(4 * 3600)
  return { b, orders, reviewStarts }
}

describe('verification and the review desk', () => {
  it('every order completes; each result is verified at measurement (auto) or after a review by the scientist', () => {
    const { b, orders } = flood(120)
    for (const o of orders) {
      expect(o.completeAt, o.id).not.toBeNull()
      expect(o.results.length).toBe(o.tests.length)
      expect(o.results.map((r) => r.testId)).toEqual(o.tests)
      for (const r of o.results) {
        expect(r.verifiedAt).not.toBeNull()
        expect(r.verifiedAt!).toBeGreaterThanOrEqual(r.measuredAt)
        if (b.lab.verifier.needsReview(o.id)) expect(r.verifiedBy).toBe(SCIENTIST)
        else {
          expect(r.verifiedBy).toBe('auto')
          expect(r.verifiedAt).toBe(r.measuredAt)
        }
        expect(r.values.length).toBe(testById(r.testId).analytes.length)
      }
      expect(o.completeAt).toBe(Math.max(...o.results.map((r) => r.verifiedAt!)))
    }
    expect(b.lab.state.reviewQueue).toBe(0)
  })

  it('spreads the reviews evenly: the auto-verified share is 85 % of the orders (and about 85 % of the results)', () => {
    const { b, orders } = flood(200, 10)
    const flagged = orders.filter((o) => b.lab.verifier.needsReview(o.id)).length
    expect(Math.abs(flagged - Math.round(orders.length * (1 - CFG.autoVerifyShare)))).toBeLessThanOrEqual(1)
    const results = orders.flatMap((o) => o.results)
    const auto = results.filter((r) => r.verifiedBy === 'auto').length / results.length
    expect(auto).toBeGreaterThan(0.8)
    expect(auto).toBeLessThan(0.9)
    expect(Math.abs((b.lab.state.kpis.autoVerifiedPct ?? 0) - (100 * auto))).toBeLessThan(0.1)
  })

  it('a review takes reviewSeconds for its priority, and STAT reviews are taken before routine ones that queued later', () => {
    // 90 orders in about 15 minutes: the flagged ones queue up behind a scientist who needs 90-420 s each
    const { b, orders, reviewStarts } = flood(90, 10)
    const byId = new Map(orders.map((o) => [o.id, o]))
    expect(reviewStarts.length).toBeGreaterThanOrEqual(10)
    const created = (id: string) => Math.min(...byId.get(id)!.results.map((r) => r.measuredAt))
    for (const s of reviewStarts) {
      const o = byId.get(s.id)!
      expect(o.priority).toBe(s.priority)
      const first = o.results.filter((r) => r.measuredAt <= s.t)
      expect(first.length).toBeGreaterThan(0)
      // verified when the review ends: no sooner than the shortest review of its priority
      const end = Math.min(...first.map((r) => r.verifiedAt!))
      expect(end - s.t).toBeGreaterThanOrEqual(CFG.reviewSeconds[s.priority][0] - 1e-6)
      expect(end - s.t).toBeLessThanOrEqual(CFG.reviewSeconds[s.priority][1] + 1e-6)
    }
    // one review at a time, and no STAT order waits while a routine one that queued after it is taken
    const starts = [...reviewStarts].sort((a, c) => a.t - c.t)
    for (let i = 0; i < starts.length; i++)
      for (let j = i + 1; j < starts.length; j++) {
        const a = starts[i]
        const c = starts[j]
        if (a.priority === 'routine' && c.priority === 'stat') expect(created(c.id), `${a.id} (routine) started while ${c.id} (STAT) was already waiting`).toBeGreaterThan(a.t)
      }
    for (let i = 1; i < starts.length; i++) expect(starts[i].t).toBeGreaterThan(starts[i - 1].t + CFG.reviewSeconds.stat[0] - 1e-6)
    expect(b.lab.state.reviewQueue).toBe(0)
  })

  it('calls onOrderComplete once per order, with the completed order, and logs "Results ready" with the minutes after the draw', () => {
    const b = makeBench(8, 1)
    const done: LabOrder[] = []
    b.lab.onOrderComplete = (o) => done.push(o)
    const a = b.inject({ panel: 'er-chest', priority: 'stat', kind: 'er', patientId: 'er1', ticket: 'V001' })
    const c = b.inject({ panel: 'op-annual', priority: 'routine', kind: 'outpatient', patientId: 'op1', ticket: 'P001' })
    b.run(3 * 3600)
    expect(done.map((o) => o.id).sort()).toEqual([a.id, c.id].sort())
    for (const o of done) expect(o.completeAt).not.toBeNull()
    const lines = b.world.log.events.filter((e) => e.type === 'labResults')
    expect(lines.length).toBe(2)
    for (const o of [a, c]) {
      const min = Math.round((o.completeAt! - o.drawnAt!) / 60)
      expect(lines.map((l) => l.text)).toContain(`Results ready for Bench ${o.patientId}, ${min} min after the draw.`)
    }
  })

  it('no clinical decisions: a constant value generator leaves every time and every event unchanged', () => {
    const run = (constant: boolean) => {
      const b = makeBench(4, 1)
      if (constant) b.lab.valueGenerator = constantValue
      const orders: LabOrder[] = []
      for (let i = 0; i < 40; i++) {
        orders.push(b.inject({ panel: Object.keys(LAB_CATALOGUE.panels)[i % Object.keys(LAB_CATALOGUE.panels).length], priority: i % 3 === 0 ? 'stat' : 'routine', source: i % 4 }))
        b.run(30)
      }
      b.run(3 * 3600)
      return {
        events: b.world.log.events.map((e) => `${e.t.toFixed(6)} ${e.type} ${e.text}`),
        times: orders.map((o) => ({ id: o.id, completeAt: o.completeAt, results: o.results.map((r) => [r.testId, r.measuredAt, r.verifiedAt, r.verifiedBy]) })),
        stages: [...b.lab.samples.samples.values()].map((s) => [s.id, s.qc, JSON.stringify(s.stageAt)]),
        kpis: b.lab.state.kpis,
        values: orders.flatMap((o) => o.results.flatMap((r) => r.values.map((v) => v.value))),
      }
    }
    const real = run(false)
    const flat = run(true)
    expect(flat.events).toEqual(real.events)
    expect(flat.times).toEqual(real.times)
    expect(flat.stages).toEqual(real.stages)
    expect(flat.kpis).toEqual(real.kpis)
    expect(real.events.length).toBeGreaterThan(60)
    // ... while the numbers themselves do differ
    expect(flat.values).not.toEqual(real.values)
  })
})
