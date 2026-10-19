/**
 * The three surgery panels as markup, in node (react-dom/server): what OrBody, PacuBody and PreOpBody show for the hospital as it starts (the live
 * sim's surgery suite), and what the presentational panels show for hand-made state. No effects run here; the view models' behaviour is in
 * orView.test.ts, pacuView.test.ts and preOpView.test.ts. The teaching-console card is replaced by a marker so the test does not depend on it.
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEATRE_STAFF } from '@/content/staff'
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import { timeAtHour } from '@/sim/population/schedule'
import type { CasePhase, SurgeryBayState, SurgeryCaseView, SurgeryState } from '@/sim/types'
import { useConsoleCard } from '@/ui/walk/consoleCard.store'
import { OrBody, OrPanel, toggleWatch, watchingPanel } from './OrBody'
import { orView, type TeamInput } from './orView'
import { PacuBody, PacuPanel } from './PacuBody'
import { pacuView } from './pacuView'
import { PreOpBody, PreOpPanel } from './PreOpBody'
import { preOpView } from './preOpView'

vi.mock('@/ui/walk/ConsoleCard', () => ({
  ConsoleCardInline: () => createElement('div', { 'data-marker': 'console-card' }),
  ConsoleCard: () => null,
}))

afterEach(() => useConsoleCard.setState({ open: false, source: 'seat' }))

const live = { or: renderToStaticMarkup(createElement(OrBody)), pacu: renderToStaticMarkup(createElement(PacuBody)), preOp: renderToStaticMarkup(createElement(PreOpBody)) }

function caseView(id: string, o: Partial<SurgeryCaseView> = {}): SurgeryCaseView {
  return { id, patientId: null, name: `Patient ${id}`, procedure: 'cholecystectomy', phase: 'scheduled', plannedIn: timeAtHour(9), wheelsIn: null, dockedAt: null, consoleStart: null, consoleEnd: null, wheelsOut: null, outcome: 'home', bay: null, ...o }
}

function stateOf(cases: SurgeryCaseView[], o: { caseId?: string | null; phase?: CasePhase | 'idle'; phaseEnds?: number | null; preOp?: Partial<SurgeryBayState>[]; pacu?: Partial<SurgeryBayState>[] } = {}): SurgeryState {
  const bays: SurgeryBayState[] = [
    ...[0, 1, 2, 3].map((i): SurgeryBayState => ({ seatId: `surgeryBed:preop:${i}`, kind: 'preOp', patientId: null, since: 0, curtain: false, ...(o.preOp?.[i] ?? {}) })),
    ...[0, 1, 2].map((i): SurgeryBayState => ({ seatId: `surgeryBed:pacu:${i}`, kind: 'pacu', patientId: null, since: 0, curtain: false, ...(o.pacu?.[i] ?? {}) })),
  ]
  return {
    theatre: { caseId: o.caseId ?? null, phase: o.phase ?? 'idle', phaseSince: 0, phaseEnds: o.phaseEnds ?? null, lights: false, surgeonAtConsole: false, teachingInUse: false, cases, kpis: { casesToday: cases.length, firstCaseOnTime: true, dockingMin: 7, consoleMin: 25, turnoverMin: 20, pacuMin: 45, utilisation: 0.5 }, version: 0 },
    robot: {
      phase: 'docked',
      cart: { x: 0, z: 0, heading: 0 },
      boomYaw: 0,
      boomHeight: 2,
      boomExtend: 1,
      laser: false,
      arms: [
        { index: 0, instrument: 'Fenestrated bipolar forceps', port: null, drape: 1, engage: 1, force: 0.4, exchanges: 0 },
        { index: 1, instrument: 'Endoscope 30°', port: null, drape: 1, engage: 1, force: 0, exchanges: 0 },
        { index: 2, instrument: 'Monopolar curved scissors', port: null, drape: 1, engage: 0.5, force: 0.8, exchanges: 0 },
        { index: 3, instrument: '', port: null, drape: 0, engage: 0, force: 0, exchanges: 0 },
      ],
      motionSeed: 1,
      phaseSince: 0,
      version: 0,
    },
    bays,
    version: 0,
  }
}

const team = (inOr: number): TeamInput[] => THEATRE_STAFF.map((m, i) => ({ id: m.id, name: m.name, title: m.title, inOr: i < inOr }))

/** The markup escapes an apostrophe. */
const h = (text: string): string => text.replace(/'/g, '&#x27;')

const count = (html: string, needle: string): number => html.split(needle).length - 1

/** Every element in a React element tree whose type is the string `type` (the panels hold no hooks, so calling them gives the whole tree). */
function findAll(node: ReactNode, type: string, out: ReactElement<{ children?: ReactNode; onClick?: () => void }>[] = []): ReactElement<{ children?: ReactNode; onClick?: () => void }>[] {
  if (Array.isArray(node)) for (const n of node) findAll(n, type, out)
  else if (isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) {
    if (node.type === type) out.push(node)
    findAll(node.props.children, type, out)
  }
  return out
}

describe('the live panels (the hospital as it starts)', () => {
  it('the OR panel says "Simulated" and has the list, phase, robot and team sections, the four arms and the watch button', () => {
    expect(live.or).toContain('Simulated')
    expect(live.or).toContain(SURGERY_UI.panel.note)
    expect(live.or).toContain(SURGERY_UI.panel.room)
    for (const title of [SURGERY_UI.panel.list, SURGERY_UI.panel.phase, SURGERY_UI.panel.robot, SURGERY_UI.panel.team]) expect(live.or, title).toContain(`>${h(title)}<`)
    for (const k of Object.values(SURGERY_UI.panel.kpi)) expect(live.or, k).toContain(k)
    expect(count(live.or, 'or-arm__tool')).toBe(4)
    for (const n of [1, 2, 3, 4]) expect(live.or).toContain(`Arm ${n}`)
    expect(count(live.or, 'data-title=')).toBe(THEATRE_STAFF.length)
    expect(live.or).toContain(`>${SURGERY_UI.panel.watch}<`)
    expect(live.or).toContain('aria-expanded="false"')
    expect(live.or).not.toContain('data-marker="console-card"')
  })

  it('the recovery and pre-op panels say "Simulated", their title and name every bay', () => {
    expect(live.pacu).toContain('Simulated')
    expect(live.pacu).toContain(`>${SURGERY_UI.panel.pacu.title}<`)
    for (const n of [1, 2, 3]) expect(live.pacu).toContain(`Bay ${n}`)
    expect(live.pacu).not.toContain('Bay 4')
    expect(live.preOp).toContain('Simulated')
    expect(live.preOp).toContain(`>${SURGERY_UI.panel.preOp.title}<`)
    for (const n of [1, 2, 3, 4]) expect(live.preOp).toContain(`Bay ${n}`)
    expect(live.preOp).not.toContain('Bay 5')
  })
})

describe('the OR panel for hand-made state', () => {
  const cases = [caseView('c1', { name: 'Ana Costa', phase: 'done', outcome: 'home', plannedIn: timeAtHour(8) }), caseView('c2', { name: 'Ben Okoye', phase: 'console', procedure: 'prostatectomy', plannedIn: timeAtHour(10.5) }), caseView('c3', { name: 'Cy Dalton', procedure: 'hysterectomy', plannedIn: timeAtHour(14) })]
  const state = stateOf(cases, { caseId: 'c2', phase: 'console', phaseEnds: 1000 + 14 * 60 - 10 })
  const html = renderToStaticMarkup(createElement(OrPanel, { v: orView(state, 1000, team(3)), watching: false, onWatch: () => undefined }))

  it("lists today's cases with name, procedure, time and phase, highlights the one in the room and says the outcome of one that is out", () => {
    for (const name of ['Ana Costa', 'Ben Okoye', 'Cy Dalton']) expect(html).toContain(name)
    for (const time of ['08:00', '10:30', '14:00']) expect(html).toContain(`>${time}<`)
    expect(html).toContain(SURGERY_COPY.procedures.prostatectomy.name)
    expect(html).toContain(SURGERY_COPY.phases.console)
    expect(count(html, 'class="rp-list__item or-case" data-current="true"')).toBe(1)
    expect(count(html, 'or-case__outcome')).toBe(1) // only the finished case says where the patient went
    expect(html).toContain(SURGERY_COPY.outcomes.home)
    expect(html).not.toContain(SURGERY_COPY.outcomes.ward)
  })

  it('draws the ten-step timeline with the console phase current and its minutes left', () => {
    expect(count(html, 'class="or-step"')).toBe(10)
    expect(count(html, 'data-state="done"')).toBe(5)
    expect(count(html, 'data-state="current"')).toBe(1)
    expect(count(html, 'data-state="upcoming"')).toBe(4)
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('>14 min<')
    expect(html).toContain(SURGERY_COPY.phases.positioning)
  })

  it('shows the robot phase, each arm with its instrument, engage and force bar, and the drape', () => {
    expect(html).toContain(SURGERY_COPY.robotPhases.docked)
    expect(html).toContain('Fenestrated bipolar forceps')
    expect(html).toContain('Endoscope 30°')
    expect(html).toContain('Monopolar curved scissors')
    expect(count(html, 'role="progressbar"')).toBe(4)
    expect(html).toContain('style="width:40%"')
    expect(html).toContain('style="width:80%"')
    expect(html).toContain('data-drape="on"')
    expect(html).toContain('data-drape="off"')
    expect(html).toContain('data-endoscope="true"')
  })

  it('shows the nine team members and marks the ones in the OR', () => {
    for (const m of THEATRE_STAFF) expect(html).toContain(m.name)
    expect(count(html, 'data-in="true"')).toBe(3)
    expect(count(html, 'data-in="false"')).toBe(6)
  })

  it('shows the numbers with their labels', () => {
    for (const label of Object.values(SURGERY_UI.panel.kpi)) expect(html).toContain(`>${label}<`)
    expect(html).toContain(`>${SURGERY_UI.panel.kpiValue.yes}<`)
    expect(html).toContain('>7 min<')
    expect(html).toContain('>50%<')
  })

  it('says so when the list is empty and the theatre is free', () => {
    const empty = renderToStaticMarkup(createElement(OrPanel, { v: orView(stateOf([]), 0, team(0)), watching: false, onWatch: () => undefined }))
    expect(empty).toContain(h(SURGERY_UI.panel.empty.list))
    expect(empty).toContain(SURGERY_UI.panel.empty.room)
    expect(count(empty, 'class="or-step"')).toBe(0)
  })
})

describe('the endoscope button', () => {
  const v = orView(stateOf([]), 0, team(0))

  it('is a button with the copy\'s label that calls onWatch when it is clicked', () => {
    const onWatch = vi.fn()
    const tree = OrPanel({ v, watching: false, onWatch })
    const buttons = findAll(tree, 'button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].props.children).toBe(SURGERY_UI.panel.watch)
    buttons[0].props.onClick?.()
    expect(onWatch).toHaveBeenCalledTimes(1)
  })

  it('shows the endoscope card right under the button only while it is open from the panel', () => {
    const closed = renderToStaticMarkup(createElement(OrPanel, { v, watching: false, onWatch: () => undefined }))
    const open = renderToStaticMarkup(createElement(OrPanel, { v, watching: true, onWatch: () => undefined }))
    expect(closed).not.toContain('data-marker="console-card"')
    expect(open).toContain('data-marker="console-card"')
    expect(open).toContain('aria-expanded="true"')
    expect(open.indexOf(SURGERY_UI.panel.watch)).toBeLessThan(open.indexOf('data-marker="console-card"'))
  })

  it('the panel counts the card as its own only when it is open from the panel, and its button toggles the card from there', () => {
    expect(watchingPanel({ open: true, source: 'panel' })).toBe(true)
    expect(watchingPanel({ open: true, source: 'seat' })).toBe(false)
    expect(watchingPanel({ open: false, source: 'panel' })).toBe(false)
    expect(useConsoleCard.getState().open).toBe(false)
    toggleWatch()
    expect(useConsoleCard.getState()).toMatchObject({ open: true, source: 'panel' })
    toggleWatch()
    expect(useConsoleCard.getState().open).toBe(false)
    // open from the seat: the button takes the card over for the panel instead of closing it
    useConsoleCard.getState().show('seat')
    toggleWatch()
    expect(useConsoleCard.getState()).toMatchObject({ open: true, source: 'panel' })
  })
})

describe('the recovery and pre-op panels for hand-made state', () => {
  const cases = [caseView('c1', { patientId: 'p-1', name: 'Ana Costa', phase: 'pacu', outcome: 'home', plannedIn: timeAtHour(9.5) }), caseView('c2', { patientId: 'p-2', name: 'Ben Okoye', phase: 'preOp', procedure: 'hysterectomy', plannedIn: timeAtHour(11) })]
  const state = stateOf(cases, { pacu: [{ patientId: 'p-1', since: 0 }], preOp: [{}, { patientId: 'p-2', since: 0, curtain: true }] })

  it('recovery: the bay, the patient, the minutes and where they go next; the free bays are dashes', () => {
    const html = renderToStaticMarkup(createElement(PacuPanel, { v: pacuView(state, 9 * 60) }))
    expect(html).toContain('Ana Costa')
    expect(html).toContain('>9 min<')
    expect(html).toContain(SURGERY_COPY.outcomes.home)
    expect(count(html, 'data-occupied="true"')).toBe(1)
    expect(count(html, 'data-occupied="false"')).toBe(2)
    expect(html).not.toContain(SURGERY_UI.panel.pacu.empty)
  })

  it('recovery: says nobody is there when every bay is free', () => {
    const html = renderToStaticMarkup(createElement(PacuPanel, { v: pacuView(stateOf([]), 0) }))
    expect(html).toContain(SURGERY_UI.panel.pacu.empty)
    expect(count(html, 'data-occupied="false"')).toBe(3)
  })

  it('pre-op: the patient with the short procedure name, the planned time and the curtain; says nobody is there when empty', () => {
    const html = renderToStaticMarkup(createElement(PreOpPanel, { v: preOpView(state, 5 * 60) }))
    expect(html).toContain('Ben Okoye')
    expect(html).toContain(SURGERY_COPY.procedures.hysterectomy.short)
    expect(html).toContain('>11:00<')
    expect(html).toContain('>5 min<')
    expect(html).toContain('data-curtain="drawn"')
    expect(count(html, 'data-curtain="open"')).toBe(3)
    const none = renderToStaticMarkup(createElement(PreOpPanel, { v: preOpView(stateOf([]), 0) }))
    expect(none).toContain(SURGERY_UI.panel.preOp.empty)
  })
})
