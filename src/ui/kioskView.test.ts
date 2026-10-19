/**
 * The health kiosks' view models, in node: the rows of a reading, the step dots, the BP unit's view, your card in each state, the lobby section, the
 * triage list and the memory of each kiosk's last result.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { KIOSK_UI } from '@/content/kioskUi'
import type { HealthKioskPhase, HealthKioskState, VitalsReading } from '@/sim/types'
import {
  PHASE_FIELD,
  SESSION_STEPS,
  bpLines,
  bpPair,
  bpScreenView,
  fieldRows,
  kioskScreenView,
  lastReadings,
  readCard,
  readKioskSection,
  resetKioskMemory,
  stepDots,
  summaryOf,
  trackKiosk,
  triageRows,
  triageVersion,
  yourLastReading,
  type KioskSim,
  type TriageSim,
} from './kioskView'

function reading(over: Partial<VitalsReading> = {}): VitalsReading {
  return { id: 'r1', personId: 'p1', personName: 'Test Patient', at: 0, source: 'kiosk', station: 0, sys: null, dia: null, pulse: null, spo2: null, tempC: null, heightCm: null, weightKg: null, bmi: null, bodyFatPct: null, bp: [], partial: true, ...over }
}

const FULL = (over: Partial<VitalsReading> = {}): VitalsReading =>
  reading({ heightCm: 172.4, weightKg: 71.43, bmi: 24.1, bodyFatPct: 22.4, spo2: 98, pulse: 72, tempC: 36.6, bp: [[124, 79], [126, 80]], sys: 125, dia: 80, partial: false, ...over })

function kiosk(index: number, phase: HealthKioskPhase, over: Partial<HealthKioskState> = {}): HealthKioskState {
  const busy = phase !== 'idle'
  return { index, phase, phaseTime: 0, progress: 0.5, kind: busy ? 'full' : null, userId: busy ? 'p1' : null, userName: busy ? 'Test Patient' : null, bpRound: 0, cuff: 0, reading: busy ? reading() : null, assisted: false, sessionsToday: 3, version: 1, ...over }
}

beforeEach(resetKioskMemory)

describe('fieldRows', () => {
  it('lists the eight fields in the order the session measures them, with a dash until each is measured', () => {
    const rows = fieldRows(null)
    expect(rows.map((r) => r.key)).toEqual(['height', 'weight', 'bmi', 'bodyFat', 'spo2', 'pulse', 'bp', 'temp'])
    expect(rows.every((r) => r.value === KIOSK_UI.pending && !r.measured && !r.outOfRange && !r.current)).toBe(true)
  })

  it('writes each value with its decimals and unit, and the BP as sys/dia', () => {
    const rows = Object.fromEntries(fieldRows(FULL()).map((r) => [r.key, r]))
    expect(rows.height.value).toBe('172')
    expect(rows.weight.value).toBe('71.4')
    expect(rows.bmi.value).toBe('24.1')
    expect(rows.bodyFat.value).toBe('22')
    expect(rows.spo2.value).toBe('98')
    expect(rows.pulse.value).toBe('72')
    expect(rows.bp.value).toBe('125/80')
    expect(rows.temp.value).toBe('36.6')
    expect(rows.weight.unit).toBe('kg')
    expect(rows.bp.unit).toBe('mmHg')
    expect(Object.values(rows).every((r) => r.measured)).toBe(true)
  })

  it('marks a value outside its usual range (style only), and the step measuring now', () => {
    const rows = Object.fromEntries(fieldRows(FULL({ spo2: 90, sys: 150, dia: 95, tempC: 38.4 }), 'spo2').map((r) => [r.key, r]))
    expect(rows.spo2.outOfRange).toBe(true)
    expect(rows.bp.outOfRange).toBe(true)
    expect(rows.temp.outOfRange).toBe(true)
    expect(rows.weight.outOfRange).toBe(false)
    expect(rows.spo2.current).toBe(true)
    expect(rows.pulse.current).toBe(true) // the finger clip gives the pulse too
    expect(rows.bp.current).toBe(false)
    const w = fieldRows(null, 'weight')
    expect(w.find((r) => r.key === 'bmi')!.current).toBe(true)
    expect(PHASE_FIELD.bp).toBe('bp')
  })

  it('uses the last cuff reading for the BP until the combined one is known', () => {
    expect(bpPair(reading({ bp: [[120, 78]] }))).toEqual([120, 78])
    expect(bpPair(reading({ bp: [[120, 78]], sys: 121, dia: 79 }))).toEqual([121, 79])
    expect(bpPair(reading())).toBeNull()
    expect(bpPair(null)).toBeNull()
    expect(bpLines(FULL())).toEqual(['Reading 1: 124/79', 'Reading 2: 126/80'])
    expect(bpLines(null)).toEqual([])
  })
})

describe('step dots', () => {
  it('count the steps done, the one now and the ones to come; the rest between two cuff readings is the pressure step', () => {
    const dots = stepDots('weight')
    expect(dots.map((d) => d.phase)).toEqual([...SESSION_STEPS])
    expect(dots.map((d) => d.state)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo'])
    expect(stepDots('bpRest').find((d) => d.state === 'current')!.phase).toBe('bp')
    expect(stepDots('idle').every((d) => d.state === 'todo')).toBe(true)
    expect(stepDots('report').filter((d) => d.state === 'done').length).toBe(SESSION_STEPS.length - 1)
  })
})

describe('the touchscreen view', () => {
  it('a free kiosk is idle with no dots; one in use shows its step, hint, progress, user and the rows', () => {
    const idle = kioskScreenView(kiosk(0, 'idle'))
    expect(idle.idle).toBe(true)
    expect(idle.dots).toEqual([])
    const v = kioskScreenView(kiosk(0, 'bodyFat', { progress: 0.4, assisted: true, reading: reading({ heightCm: 170, weightKg: 70 }) }))
    expect(v.idle).toBe(false)
    expect(v.title).toBe('Body fat')
    expect(v.hint).toBe(KIOSK_UI.steps.bodyFat.hint)
    expect(v.progress).toBe(0.4)
    expect(v.userName).toBe('Test Patient')
    expect(v.assisted).toBe(true)
    expect(v.rows.find((r) => r.key === 'bodyFat')!.current).toBe(true)
    expect(v.rows.find((r) => r.key === 'weight')!.value).toBe('70.0')
    expect(v.footer).toBe('Simulated')
  })
})

describe('the blood-pressure unit view', () => {
  it('is free until somebody sits; dashes while the cuff works; the finished reading and the pulse after it', () => {
    expect(bpScreenView(kiosk(0, 'idle')).inUse).toBe(false)
    expect(bpScreenView(kiosk(0, 'height')).inUse).toBe(false)
    const sit = bpScreenView(kiosk(0, 'sit'))
    expect(sit.inUse).toBe(true)
    expect(sit.sys).toBe(KIOSK_UI.pending)
    const r = reading({ bp: [[128, 82]], pulse: 71 })
    const working = bpScreenView(kiosk(0, 'bp', { reading: r, bpRound: 2, cuff: 0.6 }))
    expect(working.measuring).toBe(true)
    expect(working.sys).toBe(KIOSK_UI.pending)
    expect(working.cuff).toBe(0.6)
    expect(working.round).toBe('Reading 2')
    const rest = bpScreenView(kiosk(0, 'bpRest', { reading: r, bpRound: 1 }))
    expect(rest.sys).toBe('128')
    expect(rest.dia).toBe('82')
    expect(rest.pulse).toBe('71')
    expect(rest.cuff).toBe(0)
    expect(rest.round).toBe('Reading 1')
    expect(rest.unit).toBe('mmHg')
    const out = bpScreenView(kiosk(0, 'bpRest', { reading: reading({ bp: [[160, 100]] }), bpRound: 1 }))
    expect(out.sysOut).toBe(true)
    expect(out.diaOut).toBe(true)
  })
})

describe('your card', () => {
  const sim = (kiosks: HealthKioskState[], mine: VitalsReading[] = []): KioskSim => ({ vitals: { kiosks, readingsFor: (id) => (id === 'player' ? mine : []) } })

  it('while your session runs it shows the step and the values so far', () => {
    const k = kiosk(1, 'spo2', { kind: 'player', userId: 'player', userName: 'You', reading: reading({ source: 'player', heightCm: 180, weightKg: 80 }) })
    const v = readCard(sim([kiosk(0, 'idle'), k]), 1)
    expect(v.state).toBe('running')
    expect(v.stepTitle).toBe('Step: Oxygen')
    expect(v.hint).toBe(KIOSK_UI.steps.spo2.hint)
    expect(v.rows.find((r) => r.key === 'height')!.value).toBe('180')
    expect(v.rows.find((r) => r.key === 'spo2')!.value).toBe(KIOSK_UI.pending)
    expect(v.sent).toBeNull()
    expect(v.dots.find((d) => d.state === 'current')!.phase).toBe('spo2')
  })

  it('somebody else on the kiosk is not your card: it falls back to your last report', () => {
    const k = kiosk(0, 'height', { kind: 'full' })
    const v = readCard(sim([k, kiosk(1, 'idle')], [FULL({ source: 'player', personId: 'player' })]), 0)
    expect(v.state).toBe('done')
  })

  it('afterwards it is the printed slip: every value, "Sent to triage · Simulated", the report\'s own footer', () => {
    const v = readCard(sim([kiosk(0, 'idle'), kiosk(1, 'idle')], [FULL({ source: 'player', personId: 'player' })]), 0)
    expect(v.state).toBe('done')
    expect(v.title).toBe(KIOSK_UI.card.doneTitle)
    expect(v.stepTitle).toBeNull()
    expect(v.sent).toBe('Sent to triage · Simulated')
    expect(v.rows.every((r) => r.measured)).toBe(true)
    expect(v.bp).toEqual(['Reading 1: 124/79', 'Reading 2: 126/80'])
    expect(v.footer).toMatch(/Simulated/)
  })

  it('a session cut short is a partial slip with dashes for the rest', () => {
    const v = readCard(sim([kiosk(0, 'idle'), kiosk(1, 'idle')], [reading({ source: 'player', heightCm: 175, weightKg: 77, partial: true })]), 0)
    expect(v.state).toBe('stopped')
    expect(v.sent).toBe(KIOSK_UI.card.stopped)
    expect(v.rows.find((r) => r.key === 'height')!.value).toBe('175')
    expect(v.rows.find((r) => r.key === 'temp')!.value).toBe(KIOSK_UI.pending)
  })

  it('with nothing yet it is an empty slip, not a crash; the kiosk\'s own memory stands in for a service that keeps nothing', () => {
    expect(readCard(sim([kiosk(0, 'idle'), kiosk(1, 'idle')]), 0).rows.every((r) => !r.measured)).toBe(true)
    const k = kiosk(0, 'report', { kind: 'player', reading: FULL({ source: 'player' }) })
    trackKiosk(k)
    trackKiosk({ ...k, reading: null, phase: 'idle', kind: null })
    expect(yourLastReading(sim([kiosk(0, 'idle'), kiosk(1, 'idle')]), 0)!.heightCm).toBe(172.4)
  })
})

describe('the memory of each kiosk\'s last result', () => {
  it('keeps the reading a session ended with, per kiosk, and forgets it on a Jump', () => {
    const r = FULL()
    const live = kiosk(0, 'bp', { reading: r })
    trackKiosk(live)
    expect(lastReadings[0]).toBeNull()
    live.reading = null
    live.phase = 'idle'
    trackKiosk(live)
    expect(lastReadings[0]).toBe(r)
    expect(lastReadings[1]).toBeNull()
    // the next session replaces it only when it ends
    const r2 = FULL({ spo2: 95 })
    live.reading = r2
    trackKiosk(live)
    expect(lastReadings[0]).toBe(r)
    live.reading = null
    trackKiosk(live)
    expect(lastReadings[0]).toBe(r2)
    resetKioskMemory()
    expect(lastReadings[0]).toBeNull()
  })
})

describe('the lobby panel\'s kiosk section', () => {
  it('shows who is on each kiosk and at which step, the sessions today and the last result', () => {
    const r = FULL()
    const busy = kiosk(0, 'bp', { userName: 'Ana Reyes', sessionsToday: 7, assisted: true })
    const free = kiosk(1, 'idle', { sessionsToday: 2 })
    const sim: KioskSim = { vitals: { kiosks: [busy, free], readingsFor: () => [] } }
    let v = readKioskSection(sim)
    expect(v.title).toBe('Health kiosks')
    expect(v.rows[0]).toMatchObject({ n: 1, free: false, line: 'Ana Reyes · Blood pressure', assisted: true, last: KIOSK_UI.section.noLast, today: '7 today' })
    expect(v.rows[1]).toMatchObject({ n: 2, free: true, line: 'Free', assisted: false, today: '2 today' })
    expect(v.disclaimer).toMatch(/Simulated/)
    // once a session ended, its summary is the last result
    free.reading = r
    trackKiosk(free)
    free.reading = null
    trackKiosk(free)
    v = readKioskSection(sim)
    expect(v.rows[1].last).toBe('Last: BP 125/80 · SpO₂ 98% · 36.6 °C')
    expect(summaryOf(reading({ spo2: 97 }))).toBe('SpO₂ 97%')
    expect(summaryOf(reading())).toBe('')
  })
})

describe('the triage list', () => {
  const sim = (waiting: { id: string; name: string; state?: string; arrivedAt: number; readings: VitalsReading[] }[]): TriageSim => ({
    world: { er: { cases: new Map(waiting.map((w) => [w.id, { id: w.id, name: w.name, state: w.state ?? 'waitingTriage', arrivedAt: w.arrivedAt }])) } },
    vitals: { readingsFor: (id) => waiting.find((w) => w.id === id)?.readings ?? [] },
  })
  const kioskReading = (id: string, over: Partial<VitalsReading> = {}): VitalsReading => FULL({ personId: id, source: 'kiosk', ...over })

  it('lists those waiting for triage with a kiosk reading, longest waiting first, and counts the rest', () => {
    const s = sim([
      { id: 'b', name: 'Ben', arrivedAt: 20, readings: [kioskReading('b')] },
      { id: 'a', name: 'Ana', arrivedAt: 10, readings: [kioskReading('a', { spo2: 91 })] },
      { id: 'c', name: 'Cy', arrivedAt: 5, readings: [] },
      { id: 'd', name: 'Di', arrivedAt: 1, state: 'triage.assessing', readings: [kioskReading('d')] },
      { id: 'e', name: 'Ed', arrivedAt: 30, readings: [reading({ source: 'triage' })] },
    ])
    const { rows, total } = triageRows(s)
    expect(total).toBe(2)
    expect(rows.map((r) => r.name)).toEqual(['Ana', 'Ben'])
    expect(rows[0]).toMatchObject({ bp: '125/80', spo2: '91%', temp: '36.6', spo2Out: true, bpOut: false })
    expect(triageRows(s, 1).rows.length).toBe(1)
    expect(triageRows(s, 1).total).toBe(2)
  })

  it('takes the newest kiosk reading of a person', () => {
    const s = sim([{ id: 'a', name: 'Ana', arrivedAt: 1, readings: [kioskReading('a', { spo2: 91 }), kioskReading('a', { spo2: 97 }), reading({ source: 'triage', spo2: 80 })] }])
    expect(triageRows(s).rows[0].spo2).toBe('97%')
  })

  it('has a version that changes when somebody waiting gets a reading or a person leaves the queue', () => {
    const waiting = [{ id: 'a', name: 'Ana', arrivedAt: 1, readings: [] as VitalsReading[] }]
    const s = sim(waiting)
    const v0 = triageVersion(s)
    expect(triageVersion(s)).toBe(v0)
    waiting[0].readings.push(kioskReading('a'))
    const v1 = triageVersion(s)
    expect(v1).not.toBe(v0)
    waiting[0].readings.push(kioskReading('a', { partial: true }))
    expect(triageVersion(s)).not.toBe(v1)
    ;(s.world.er.cases as Map<string, unknown>).clear()
    expect(triageVersion(s)).toBe(v0)
  })
})
