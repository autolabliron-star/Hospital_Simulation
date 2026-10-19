/**
 * The draw centre's room panel as markup, in node (react-dom/server, no browser). `usePoll` renders its first read on the server, so the panel's
 * first paint is the real view; no effects run here.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DrawStationState } from '@/sim/types'

const state = vi.hoisted(() => ({
  blood: null as unknown,
}))
vi.mock('@/sim', () => ({
  sim: {
    get blood() {
      return state.blood
    },
  },
}))

import { DrawCentreBody } from './DrawCentreBody'

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

const ticket = (id: string, st: 'waiting' | 'called', station: number | null = null) => ({ id, cls: id.startsWith('V') ? 'V' : 'P', patientId: id, patientName: 'Synthetic', orderId: id, issuedAt: 0, calledAt: null, station, state: st })

function blood(o: Record<string, unknown> = {}) {
  return {
    stations: [station(0), station(1), station(2)],
    prep: { phase: 'idle', progress: 0, ticket: null, queue: 0, bin: -1, held: null, rack: [], traysToday: 0, version: 0 },
    queue: [],
    calling: null,
    nurseId: 'n1',
    stats: { draws: 0, robotFirstPass: 0, nurseDraws: 0, medianWaitMin: null },
    startDemoDraw: () => true,
    takePlayerTicket: () => 'P001',
    version: 0,
    ...o,
  }
}

const render = (): string => renderToStaticMarkup(createElement(DrawCentreBody))

describe('the draw centre panel', () => {
  it('shows an empty centre calmly: nobody called, nobody waiting, three free robots, the staff line, the button and the disclaimer', () => {
    state.blood = blood()
    const html = render()
    expect(html).toContain('Now calling')
    expect(html).toContain('Nobody is being called')
    expect(html).toContain('Nobody is waiting')
    expect(html.match(/dc-robot"/g)?.length).toBe(3)
    expect(html).toContain('Robot 1')
    expect(html).toContain('Robot 3')
    expect(html).toContain('1 nurse · 3 robots')
    expect(html).toContain('Call next patient')
    expect(html).toContain('Simulated, not real patient data')
    expect(html).not.toContain('undefined')
    expect(html).not.toContain('NaN')
  })

  it('shows the call, the waiting tickets and a busy robot with its patient and a first-attempt tick', () => {
    const calling = ticket('P023', 'called', 1)
    state.blood = blood({
      calling,
      queue: [calling, ticket('V004', 'waiting'), ticket('P024', 'waiting')],
      stations: [
        station(0),
        station(1, { phase: 'filling', ticket: 'P023', patientName: 'Mira Okafor', tubes: ['citrate', 'serum', 'EDTA', 'fluoride'], tube: 1, tubeFill: 0.5, attempts: 1, light: 'teal' }),
        station(2),
      ],
      stats: { draws: 40, robotFirstPass: 36, nurseDraws: 2, medianWaitMin: 5.2 },
      prep: { phase: 'labelling', progress: 0.5, ticket: 'P024', queue: 1, bin: 0, held: 'serum', rack: ['P022'], traysToday: 31, version: 1 },
    })
    const html = render()
    expect(html).toContain('P023 → Robot 2')
    expect(html).toContain('V004')
    expect(html).toContain('P024')
    expect(html).toContain('Mira Okafor')
    expect(html).toContain('Filling tube 2 of 4')
    expect(html).toContain('First attempt')
    expect(html).toContain('Printing labels')
    expect(html).toContain('Labels printed')
    expect(html).toContain('31')
    expect(html).toContain('95%') // 36 of 38 robot draws on the first attempt
    expect(html).toContain('5 min')
    expect(html).toContain('aria-valuenow="')
  })

  it('says when no nurse is on site', () => {
    state.blood = blood({ nurseId: null })
    expect(render()).toContain('No nurse on site · 3 robots')
  })
})
