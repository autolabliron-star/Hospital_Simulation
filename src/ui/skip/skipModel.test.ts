import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { timelineOf, planDay } from '@/sim/surgery/plan'
import { Rng } from '@/sim/rng'
import { clockText } from '@/sim/events'
import {
  caseTimes,
  contextTarget,
  DEFAULT_SKIP_CTX,
  keyTarget,
  nextMilestone,
  orContext,
  requestFor,
  rowModel,
  scannerContext,
  skipTargets,
  stepLabel,
  type CaseTimes,
  type SkipView,
} from './skipModel'

const LIMIT = (CONFIG.day.endHour - CONFIG.sim.startHour) * 3600
const LEAD = CONFIG.skip.milestoneLeadSeconds
const T = (h: number, m: number) => (h - CONFIG.sim.startHour) * 3600 + m * 60

const base = (over: Partial<SkipView> = {}): SkipView => ({
  nowT: 0,
  limitT: LIMIT,
  playerArea: null,
  overviewLevel: 1,
  panelArea: null,
  cases: [],
  scanners: {},
  ...over,
})

const caseAt = (docking: number, consoleStart: number, undocking: number, wheelsOut: number, pacuDischarge: number, nextWheelsIn: number): CaseTimes => ({
  docking,
  console: consoleStart,
  undocking,
  wheelsOut,
  pacuDischarge,
  nextWheelsIn,
})

describe('plain steps', () => {
  it('offers +15 min and +1 h from the clock', () => {
    const t = skipTargets(base({ nowT: 1000 }))
    expect(t.map((x) => [x.kind, x.label, x.toT, x.caption])).toEqual([
      ['step', '+15 min', 1900, ''],
      ['step', '+1 h', 4600, ''],
    ])
  })
  it('labels minutes and hours from the config', () => {
    expect(stepLabel(900)).toBe('+15 min')
    expect(stepLabel(3600)).toBe('+1 h')
    expect(stepLabel(7200)).toBe('+2 h')
  })
  it('clamps at the end of the day and drops a step that lands where the first does', () => {
    const t = skipTargets(base({ nowT: LIMIT - 1200 }))
    expect(t.map((x) => x.toT)).toEqual([LIMIT - 300, LIMIT])
    const near = skipTargets(base({ nowT: LIMIT - 600 }))
    expect(near.map((x) => x.toT)).toEqual([LIMIT])
    expect(near[0].label).toBe('+15 min')
  })
  it('offers nothing once the day is over', () => {
    expect(skipTargets(base({ nowT: LIMIT }))).toEqual([])
    expect(skipTargets(base({ nowT: LIMIT - 2 }))).toEqual([])
  })
})

describe('the operating-room context', () => {
  const c0 = caseAt(T(7, 40), T(7, 52), T(8, 30), T(8, 50), T(9, 30), T(10, 10))
  it('is on for Level 2 areas, the Level 2 overview and a Level 2 room panel; off elsewhere', () => {
    expect(orContext(base({ playerArea: 'l2Or', overviewLevel: null }))).toBe(true)
    expect(orContext(base({ overviewLevel: 2 }))).toBe(true)
    expect(orContext(base({ panelArea: 'l2Pacu' }))).toBe(true)
    expect(orContext(base({ playerArea: 'lobby', overviewLevel: null }))).toBe(false)
    expect(orContext(base({ panelArea: 'mri' }))).toBe(false)
    expect(orContext(base())).toBe(false)
  })
  it('adds nothing outside the OR, whatever the cases are', () => {
    expect(skipTargets(base({ cases: [c0] })).map((x) => x.kind)).toEqual(['step', 'step'])
  })
  it('lands the lead before the next event, with the event time in the label and the caption', () => {
    const now = T(7, 30)
    const [, , m] = skipTargets(base({ nowT: now - 0, overviewLevel: 2, cases: [c0] }), DEFAULT_SKIP_CTX)
    expect(m.kind).toBe('surgery')
    expect(m.toT).toBe(c0.docking - LEAD)
    expect(m.label).toBe('Skip to docking · 07:40')
    expect(m.caption).toBe('Docking')
  })
  it('walks the milestones in order as the clock passes each one', () => {
    const order = ['docking', 'the console', 'undocking', 'wheels-out', 'PACU discharge', 'the next patient'] as const
    const events = [c0.docking, c0.console, c0.undocking, c0.wheelsOut, c0.pacuDischarge, c0.nextWheelsIn]
    events.forEach((ev, i) => {
      // just after the previous landing point
      const now = i === 0 ? 0 : events[i - 1] - LEAD + 1
      const m = nextMilestone(base({ nowT: now, cases: [c0] }), DEFAULT_SKIP_CTX)
      expect(m?.eventT).toBe(ev)
      const label = skipTargets(base({ nowT: now, overviewLevel: 2, cases: [c0] })).at(-1)!.label
      expect(label).toBe(`Skip to ${order[i]} · ${clockText(ev)}`)
    })
  })
  it('uses the undocking of the case you are looking at: 10:12 example', () => {
    const undock = T(10, 12)
    const t = skipTargets(base({ nowT: T(9, 0), overviewLevel: 2, cases: [caseAt(0, 0, undock, undock + 1200, undock + 3000, undock + 5000)] }))
    expect(t.at(-1)!.label).toBe('Skip to undocking · 10:12')
    expect(t.at(-1)!.toT).toBe(undock - LEAD)
  })
  it('picks the earliest event over several cases, and skips past ones', () => {
    const c1 = caseAt(T(9, 0), T(9, 10), T(9, 40), T(10, 0), T(10, 40), T(11, 0))
    const m = nextMilestone(base({ nowT: T(8, 55), cases: [c0, c1] }), DEFAULT_SKIP_CTX)
    expect(m?.kind).toBe('docking')
    expect(m?.eventT).toBe(c1.docking)
  })
  it('offers no milestone when everything left is past the end of the day, or when the landing is not ahead', () => {
    expect(nextMilestone(base({ nowT: LIMIT - 100, cases: [c0] }), DEFAULT_SKIP_CTX)).toBeNull()
    const soon = caseAt(10 + LEAD, 1e9, 1e9, 1e9, 1e9, 1e9)
    expect(nextMilestone(base({ nowT: 8, cases: [soon] }), DEFAULT_SKIP_CTX)).toBeNull()
  })
  it('does not offer a milestone beyond the end of the day', () => {
    const late = caseAt(LIMIT + 600, LIMIT + 700, LIMIT + 800, LIMIT + 900, LIMIT + 1000, LIMIT + 1100)
    const t = skipTargets(base({ overviewLevel: 2, cases: [late] }))
    expect(t.map((x) => x.kind)).toEqual(['step', 'step'])
  })
})

describe('the scanner context', () => {
  const scan = (phase: string, remaining: number): SkipView['scanners'] => ({ us: { phase, remaining }, mri: { phase, remaining } })
  it('maps scan rooms and control rooms to their scanner; the panel wins over where you stand', () => {
    expect(scannerContext(base({ panelArea: 'mriControl' }))).toBe('mri')
    expect(scannerContext(base({ playerArea: 'ultrasound', overviewLevel: null }))).toBe('us')
    expect(scannerContext(base({ panelArea: 'ct', playerArea: 'xray', overviewLevel: null }))).toBe('ct')
    expect(scannerContext(base({ playerArea: 'lobby', overviewLevel: null }))).toBeNull()
  })
  it('offers "skip to scan end" only when it is short enough to run live', () => {
    const live = skipTargets(base({ nowT: 100, panelArea: 'ultrasound', scanners: scan('scanning', 120) }))
    expect(live.at(-1)).toMatchObject({ kind: 'scan', label: 'Skip to scan end', toT: 220 })
    const long = skipTargets(base({ nowT: 100, panelArea: 'ultrasound', scanners: scan('scanning', CONFIG.skip.liveMaxSeconds + 1) }))
    expect(long.map((x) => x.kind)).toEqual(['step', 'step'])
    const edge = skipTargets(base({ nowT: 100, panelArea: 'mri', scanners: scan('scanning', CONFIG.skip.liveMaxSeconds) }))
    expect(edge.at(-1)?.kind).toBe('scan')
  })
  it('offers nothing for an idle scanner or one that is about to end', () => {
    expect(skipTargets(base({ panelArea: 'ultrasound', scanners: scan('idle', 100) })).length).toBe(2)
    expect(skipTargets(base({ panelArea: 'ultrasound', scanners: scan('cleanup', 1) })).length).toBe(2)
  })
  it('does not fall back on the other scanner', () => {
    expect(skipTargets(base({ panelArea: 'xray', scanners: scan('scanning', 60) })).length).toBe(2)
  })
})

describe('requests and keys', () => {
  it('is live up to the live limit and a rebuild beyond', () => {
    const t = (toT: number) => ({ kind: 'step' as const, toT, label: 'x', caption: '' })
    expect(requestFor(t(100 + CONFIG.skip.liveMaxSeconds), 100).mode).toBe('live')
    expect(requestFor(t(101 + CONFIG.skip.liveMaxSeconds), 100).mode).toBe('rebuild')
    const [a, b] = skipTargets(base({ nowT: 0 }))
    expect(requestFor(a, 0)).toMatchObject({ fromT: 0, toT: 900, fromHour: CONFIG.sim.startHour, caption: '', mode: 'rebuild' })
    expect(requestFor(b, 0).toHour).toBeCloseTo(CONFIG.sim.startHour + 1, 9)
  })
  it('carries the milestone caption into the request', () => {
    const c = caseAt(T(7, 40), 0, 0, 0, 0, 0)
    const m = contextTarget(skipTargets(base({ overviewLevel: 2, cases: [c] })))!
    expect(requestFor(m, 0).caption).toBe('Docking')
  })
  it('] picks +15 min; Shift+] the context target, else +1 h; nothing at the end of the day', () => {
    const plain = skipTargets(base())
    expect(keyTarget(plain, false)?.label).toBe('+15 min')
    expect(keyTarget(plain, true)?.label).toBe('+1 h')
    const or = skipTargets(base({ overviewLevel: 2, cases: [caseAt(T(7, 40), 0, 0, 0, 0, 0)] }))
    expect(keyTarget(or, true)?.kind).toBe('surgery')
    expect(keyTarget(or, false)?.label).toBe('+15 min')
    expect(keyTarget([], false)).toBeNull()
    expect(keyTarget([], true)).toBeNull()
  })
  it('the row model carries labels only, so a clock tick does not change it', () => {
    const a = rowModel(skipTargets(base({ nowT: 10 })))
    const b = rowModel(skipTargets(base({ nowT: 20 })))
    expect(a).toEqual(b)
    expect(a.context).toBeNull()
  })
})

describe('case times from the plan', () => {
  const plan = planDay(new Rng(7))[0]
  const tl = timelineOf(plan)
  it('equals the plan when nothing has run late', () => {
    const t = caseTimes(tl, {}, null, 0)
    expect(t.docking).toBe(tl.phaseStart.docking)
    expect(t.wheelsOut).toBe(tl.outAt)
    expect(t.pacuDischarge).toBe(tl.pacuOut)
    expect(t.nextWheelsIn).toBe(tl.phaseStart.in)
  })
  it('shifts what is still ahead by how late the latest realised phase started', () => {
    const now = tl.phaseStart.console + 100
    const t = caseTimes(tl, { in: tl.phaseStart.in + 20, docking: tl.phaseStart.docking + 45, console: tl.phaseStart.console + 60 }, null, now)
    expect(t.undocking).toBe(tl.phaseStart.undocking + 60)
    expect(t.pacuDischarge).toBe(tl.pacuOut + 60)
  })
  it('ignores a realised time that is not yet in the past', () => {
    const t = caseTimes(tl, { docking: tl.phaseStart.docking + 45 }, null, tl.phaseStart.docking)
    expect(t.undocking).toBe(tl.phaseStart.undocking)
  })
})
