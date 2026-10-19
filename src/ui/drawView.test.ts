import { describe, expect, it } from 'vitest'
import type { DrawPhase, DrawStationState, DrawTicket, TubePrepState } from '@/sim/types'
import { PHASE_SPAN, drawPercent, drawView, toneOf, type DrawSource } from './drawView'

const PHASES = Object.keys(PHASE_SPAN) as DrawPhase[]

function station(i: number, o: Partial<DrawStationState> = {}): DrawStationState {
  return {
    index: i,
    phase: 'idle',
    phaseTime: 0,
    progress: 0,
    ticket: null,
    patientId: null,
    patientName: null,
    tubes: [],
    tube: 0,
    tubeFill: 0,
    inversions: 0,
    cuff: 0,
    needle: 0,
    scan: 0,
    trayHere: false,
    attendantId: null,
    light: 'white',
    attempts: 0,
    drawsToday: 0,
    robotDrawsToday: 0,
    nurseDrawsToday: 0,
    version: 0,
    ...o,
  }
}

function ticket(id: string, state: DrawTicket['state'] = 'waiting', station: number | null = null): DrawTicket {
  return { id, cls: id.startsWith('V') ? 'V' : 'P', patientId: `p-${id}`, patientName: 'Synthetic Person', orderId: `o-${id}`, issuedAt: 0, calledAt: null, station, state }
}

const prep = (o: Partial<TubePrepState> = {}): TubePrepState => ({ phase: 'idle', progress: 0, ticket: null, queue: 0, bin: -1, held: null, rack: [], traysToday: 0, version: 0, ...o })

function source(o: Partial<DrawSource> = {}): DrawSource {
  return {
    stations: [station(0), station(1), station(2)],
    prep: prep(),
    queue: [],
    calling: null,
    nurseId: 'nurse-1',
    stats: { draws: 0, robotFirstPass: 0, nurseDraws: 0, medianWaitMin: null },
    ...o,
  }
}

describe('drawView', () => {
  it('is a plain, serialisable snapshot (the panel compares snapshots by JSON)', () => {
    const v = drawView(source())
    expect(JSON.parse(JSON.stringify(v))).toEqual(v)
  })

  it('says who is being called and where: "P023 to Robot 2"', () => {
    const calling = ticket('P023', 'called', 1)
    const v = drawView(source({ calling, queue: [calling] }))
    expect(v.calling).toEqual({ ticket: 'P023', robot: 2, text: 'P023 → Robot 2' })
    expect(drawView(source()).calling).toBeNull()
  })

  it('lists the waiting tickets in call order, up to eight, and counts the rest', () => {
    const queue = ['V001', 'P002', 'P003', 'P004', 'P005', 'P006', 'P007', 'P008', 'P009', 'P010', 'P011'].map((id) => ticket(id))
    queue.push(ticket('P000', 'called', 0))
    const v = drawView(source({ queue }))
    expect(v.waiting.ids).toEqual(['V001', 'P002', 'P003', 'P004', 'P005', 'P006', 'P007', 'P008'])
    expect(v.waiting.more).toBe(3)
    expect(v.waiting.moreText).toBe('and 3 more')
    expect(drawView(source({ queue: queue.slice(0, 3) })).waiting.moreText).toBeNull()
  })

  it('has three robot cards with the phase words, a chip tone, the synthetic patient and a progress bar', () => {
    const v = drawView(
      source({
        stations: [
          station(0),
          station(1, { phase: 'filling', ticket: 'P023', patientName: 'Mira Okafor', tubes: ['citrate', 'serum', 'EDTA', 'fluoride'], tube: 1, tubeFill: 0.5, attempts: 1, light: 'teal' }),
          station(2, { phase: 'fallbackToNurse', ticket: 'P030', patientName: 'Ivan Petrov', attempts: 2, light: 'amber' }),
        ],
      }),
    )
    expect(v.robots.map((r) => r.n)).toEqual([1, 2, 3])
    expect(v.robots[0]).toMatchObject({ phaseText: 'Free', tone: 'idle', percent: 0, patient: null, attempt: null })
    expect(v.robots[1]).toMatchObject({ phaseText: 'Filling tube 2 of 4', tone: 'live', patient: 'Mira Okafor', ticket: 'P023', attempt: 'first', attemptText: 'First attempt', light: 'teal' })
    expect(v.robots[1].percent).toBe(Math.round(55 + 35 * 0.375))
    expect(v.robots[2]).toMatchObject({ tone: 'attention', attempt: 'second', attemptText: 'Second attempt', light: 'amber' })
  })

  it('gives a first-attempt tick only once the needle is in and only on the first attempt', () => {
    const at = (phase: DrawPhase, attempts: number): string | null => drawView(source({ stations: [station(0, { phase, ticket: 'P1', attempts }), station(1), station(2)] })).robots[0].attempt
    expect(at('veinScan', 1)).toBeNull()
    expect(at('needleIn', 1)).toBeNull()
    expect(at('filling', 1)).toBe('first')
    expect(at('release', 1)).toBe('first')
    expect(at('filling', 2)).toBe('second')
    expect(at('filling', 0)).toBeNull()
    expect(drawView(source({ stations: [station(0, { phase: 'filling', attempts: 1 }), station(1), station(2)] })).robots[0].attempt).toBeNull() // nobody there
  })

  it('shows the staff line: "1 nurse · 3 robots", or that no nurse is on site', () => {
    expect(drawView(source()).staff).toBe('1 nurse · 3 robots')
    expect(drawView(source({ nurseId: null })).staff).toBe('No nurse on site · 3 robots')
  })

  it('computes draws, first-attempt success, nurse share and the median wait', () => {
    const v = drawView(source({ stats: { draws: 50, robotFirstPass: 44, nurseDraws: 3, medianWaitMin: 6.4 } }))
    expect(v.stats).toEqual({ draws: '50', firstAttempt: '94%', manual: '6%', wait: '6 min' })
    const empty = drawView(source())
    expect(empty.stats).toEqual({ draws: '0', firstAttempt: '–', manual: '–', wait: '–' })
    // a robot-only day has no manual draws
    expect(drawView(source({ stats: { draws: 10, robotFirstPass: 10, nurseDraws: 0, medianWaitMin: 1 } })).stats.manual).toBe('0%')
    // nothing divides by zero when every draw was the nurse's
    expect(drawView(source({ stats: { draws: 2, robotFirstPass: 0, nurseDraws: 2, medianWaitMin: null } })).stats.firstAttempt).toBe('–')
  })

  it('shows the tube-prep machine: phase, ticket, progress, labels today and trays waiting', () => {
    const v = drawView(source({ prep: prep({ phase: 'labelling', progress: 0.5, ticket: 'P023', traysToday: 12, rack: ['P020', 'P021'] }) }))
    expect(v.prep).toEqual({ phase: 'Printing labels', ticket: 'P023', percent: 50, labels: 12, trays: 'Trays waiting: 2', busy: true })
    expect(drawView(source()).prep).toMatchObject({ phase: 'Ready', percent: 0, busy: false })
  })

  it('says it is simulated', () => {
    expect(drawView(source()).disclaimer).toBe('Simulated, not real patient data')
  })
})

describe('the progress and tone of a draw', () => {
  it('never goes backwards through a normal draw, from 0 to 100', () => {
    const order: DrawPhase[] = ['calling', 'cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'needleIn', 'filling', 'needleOut', 'bandage', 'release']
    let last = -1
    for (const phase of order) {
      for (let k = 0; k <= 10; k++) {
        const p = drawPercent({ phase, progress: k / 10, tube: Math.min(3, Math.floor(k / 3)), tubeFill: (k % 3) / 3, tubes: ['citrate', 'serum', 'EDTA', 'fluoride'] })
        expect(p, `${phase} ${k}`).toBeGreaterThanOrEqual(last)
        last = p
      }
    }
    expect(last).toBe(100)
  })

  it('stays between 0 and 100 for every phase, even for a progress outside 0..1', () => {
    for (const phase of PHASES)
      for (const progress of [-1, 0, 0.5, 1, 7]) {
        const p = drawPercent({ phase, progress, tube: 9, tubeFill: 5, tubes: ['serum'] })
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThanOrEqual(100)
      }
  })

  it('has a tone for every phase: idle, busy, live, attention or done', () => {
    for (const p of PHASES) expect(['idle', 'busy', 'live', 'attention', 'done']).toContain(toneOf(p))
    expect(toneOf('veinScan')).toBe('live')
    expect(toneOf('armMoved')).toBe('attention')
    expect(toneOf('bandage')).toBe('done')
    expect(toneOf('cuff')).toBe('busy')
    expect(toneOf('idle')).toBe('idle')
  })
})
