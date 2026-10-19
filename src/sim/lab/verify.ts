/**
 * W4 lab: measuring, verifying and completing (agent L).
 *
 * A test's result exists `analyticSeconds` (content) after its tube was aspirated. Then it is verified: `autoVerifyShare` of the orders verify
 * themselves the moment they are measured; the others wait for the scientist at the review terminal, STAT first (`reviewSeconds` by
 * priority). One review covers the whole order: every result of the order measured before the review ends is verified together, and a result
 * measured after it is verified by the scientist the moment it appears. The decision is the same whatever the numbers are: a value never
 * changes who reviews what, or when (no clinical decisions).
 *
 * When every test of an order is verified the order is complete: `completeAt`, an event, the KPIs, and `onOrderComplete`.
 * Which orders need review is spread evenly (error diffusion from a seeded phase), so the share stays at `autoVerifyShare` in any run.
 */
import { labLine } from '@/content/labCopy'
import { testById } from '@/content/lab'
import type { EventRefs } from '../er/world'
import type { LabOrder, LabPriority, LabTestResult, SimEventType } from '../types'
import type { LabHost } from './job'
import { resultValues, type ValueGenerator } from './results'

/** The person at the review terminal (src/sim/lab/scientist.ts). */
export interface Reviewer {
  /** At the terminal, free to start a review. */
  readonly available: boolean
  readonly name: string
}

interface Meta {
  flagged: boolean
  item: ReviewItem | null
  reviewed: boolean
  verified: number
}
interface ReviewItem {
  order: LabOrder
  priority: LabPriority
  seconds: number
  results: LabTestResult[]
}
interface Measure {
  at: number
  order: LabOrder
  testId: string
}

export interface VerifyDeps {
  host: LabHost
  seed: number
  generator: () => ValueGenerator
  say: (type: SimEventType, text: string, refs?: EventRefs) => void
  complete: (order: LabOrder, t: number) => void
  reviewer: () => Reviewer | null
}

export class Verifier {
  private readonly meta = new Map<string, Meta>()
  private readonly measures: Measure[] = []
  private readonly queue: ReviewItem[] = []
  private current: ReviewItem | null = null
  private currentUntil = 0
  private acc: number
  private auto = 0
  private verified = 0
  /** Draw-to-verified minutes of every completed order, sorted. */
  private readonly tats: number[] = []
  /** Debug hook for the tests: a review starts. */
  onReviewStart: ((orderId: string, priority: LabPriority, t: number) => void) | null = null

  constructor(
    private readonly deps: VerifyDeps,
    phase: number,
  ) {
    this.acc = phase
  }

  get reviewing(): boolean {
    return this.current !== null
  }
  get waiting(): number {
    return this.queue.length
  }

  /** An order exists: decide now whether its results will need a review. */
  register(order: LabOrder): void {
    this.acc += 1 - this.deps.host.cfg.autoVerifyShare
    let flagged = false
    if (this.acc >= 1) {
      this.acc -= 1
      flagged = true
    }
    this.meta.set(order.id, { flagged, item: null, reviewed: false, verified: 0 })
  }

  /** Is this order one that waits for the scientist? */
  needsReview(orderId: string): boolean {
    return this.meta.get(orderId)?.flagged ?? false
  }

  /** The tube's test is being analysed: its result will exist at `at`. */
  schedule(order: LabOrder, testId: string, at: number): void {
    const m = this.measures
    let i = m.length
    while (i > 0 && m[i - 1].at > at) i--
    m.splice(i, 0, { at, order, testId })
  }

  step(t: number): void {
    const m = this.measures
    while (m.length > 0 && m[0].at <= t) {
      const due = m.shift()!
      this.measure(due, t)
    }
    const cur = this.current
    if (cur !== null && t >= this.currentUntil) {
      this.current = null
      const meta = this.meta.get(cur.order.id)!
      meta.item = null
      meta.reviewed = true
      const by = this.deps.reviewer()?.name ?? 'Scientist'
      for (const r of cur.results) this.verify(cur.order, r, t, by)
      this.updateQueueState()
    }
    if (this.current === null && this.queue.length > 0) {
      const rv = this.deps.reviewer()
      if (rv === null || rv.available) {
        this.current = this.queue.shift()!
        this.currentUntil = t + this.current.seconds
        this.updateQueueState()
        this.onReviewStart?.(this.current.order.id, this.current.priority, t)
      }
    }
  }

  private measure(m: Measure, t: number): void {
    const order = m.order
    const test = testById(m.testId)
    const result: LabTestResult = {
      testId: m.testId,
      values: resultValues(this.deps.generator(), this.deps.seed, order.patientId, order.panel, m.testId),
      measuredAt: t,
      verifiedAt: null,
      verifiedBy: null,
    }
    order.results.push(result)
    const an = this.deps.host.state.analysers[test.analyser]
    if (an.running > 0) an.running--
    an.testsToday++
    const meta = this.meta.get(order.id)!
    if (!meta.flagged) this.verify(order, result, t, 'auto')
    else if (meta.item !== null) meta.item.results.push(result)
    else if (meta.reviewed) this.verify(order, result, t, this.deps.reviewer()?.name ?? 'Scientist')
    else {
      const item: ReviewItem = { order, priority: order.priority, seconds: this.deps.host.rng.between(this.deps.host.cfg.reviewSeconds[order.priority]), results: [result] }
      meta.item = item
      const q = this.queue
      if (order.priority === 'stat') {
        let i = 0
        while (i < q.length && q[i].priority === 'stat') i++
        q.splice(i, 0, item)
      } else q.push(item)
      this.updateQueueState()
    }
    this.deps.host.dirty()
  }

  private verify(order: LabOrder, r: LabTestResult, t: number, by: string): void {
    r.verifiedAt = t
    r.verifiedBy = by
    this.verified++
    if (by === 'auto') this.auto++
    const meta = this.meta.get(order.id)!
    meta.verified++
    this.updateKpis()
    if (meta.verified >= order.tests.length) this.complete(order, t)
  }

  private complete(order: LabOrder, t: number): void {
    order.completeAt = t
    order.results.sort((a, b) => order.tests.indexOf(a.testId) - order.tests.indexOf(b.testId))
    const tat = (t - (order.drawnAt ?? order.orderedAt)) / 60
    const tats = this.tats
    let i = tats.length
    while (i > 0 && tats[i - 1] > tat) i--
    tats.splice(i, 0, tat)
    this.updateKpis()
    const min = Math.max(0, Math.round(tat))
    if (order.source === 'demo') this.deps.say('labResults', labLine('demoResults', { min }), {})
    else if (order.source !== 'background') this.deps.say('labResults', labLine('labResults', { name: order.patientName, min }), { subjectId: order.patientId })
    this.deps.complete(order, t)
    this.deps.host.dirty()
  }

  private updateQueueState(): void {
    this.deps.host.state.reviewQueue = this.queue.length + (this.current !== null ? 1 : 0)
    this.deps.host.dirty()
  }

  private updateKpis(): void {
    const k = this.deps.host.state.kpis
    k.autoVerifiedPct = this.verified > 0 ? Math.round((1000 * this.auto) / this.verified) / 10 : null
    const n = this.tats.length
    k.medianTatMin = n === 0 ? null : Math.round((n % 2 === 1 ? this.tats[(n - 1) / 2] : (this.tats[n / 2 - 1] + this.tats[n / 2]) / 2) * 10) / 10
  }
}
