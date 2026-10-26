/**
 * R4: the cryo suite panel's view model in node, from hand-made states: "Simulated", the step and the stepper, the needles (planned, aiming, aligned,
 * in, out), the console's readouts only while they mean something, today's list, and the start button's three faces (start now, book next, booked).
 */
import { describe, expect, it } from 'vitest'
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import { emptyCryoState } from '@/sim/cryoSuite'
import { cryoState } from '@/scene/cryoSuite/testkit'
import { cryoSuiteView, startButton, STEPPER_STEPS, stepRows } from './cryoSuiteView'

const P = CRYO_SUITE_COPY.panel

describe('the cryo suite panel view', () => {
  it('an empty day: "Simulated", the title, the room ready, nobody, the empty-list line, a start button', () => {
    const v = cryoSuiteView(emptyCryoState())
    expect(v.tag).toBe('Simulated')
    expect(v.title).toBe(P.title)
    expect(v.step).toBe(CRYO_SUITE_COPY.steps.idle)
    expect(v.patient).toBeNull()
    expect(v.needles).toEqual([])
    expect(v.empty).toBe(P.empty)
    expect(v.start).toEqual({ label: P.start, disabled: false, note: null })
    expect(v.console.timer).toBe('--:--')
    expect(v.console.ice).toBeNull()
    expect(v.steps.every((s) => s.state === 'todo')).toBe(true)
  })

  it('the stepper: done before the room\'s step, current at it, to come after', () => {
    const rows = stepRows('aim')
    expect(rows).toHaveLength(STEPPER_STEPS.length)
    expect(STEPPER_STEPS).not.toContain('idle')
    const at = rows.findIndex((r) => r.state === 'current')
    expect(rows[at].step).toBe('aim')
    expect(rows.slice(0, at).every((r) => r.state === 'done')).toBe(true)
    expect(rows.slice(at + 1).every((r) => r.state === 'todo')).toBe(true)
  })

  it('during the aim: the needle in, the one aligned with its error, the rest planned', () => {
    const s = cryoState({ step: 'aim', needles: 3, robot: 'aligned', robotNeedle: 1, inserted: [1, 0, 0] })
    const v = cryoSuiteView(s)
    expect(v.patient).toBe('Mara Lindqvist')
    expect(v.needles.map((n) => n.state)).toEqual(['in', 'aligned', 'planned'])
    expect(v.needles[1].aligned).toBe(`Aligned ${s.needles[1].errorMm.toFixed(1)} mm`)
    expect(v.needles[2].aligned).toBeNull()
    expect(v.needleNow).toBe('Needle 2 of 3')
    expect(v.needles[0].insertedPct).toBe(100)
  })

  it('during a freeze: the timer, the margin sensor, the ice ball and the coldest tip; argon on', () => {
    const s = cryoState({ step: 'freeze1', timer: 125, ice: 0.5 })
    const v = cryoSuiteView(s)
    expect(v.console.timer).toBe('2:05')
    expect(v.console.argon).toBe(true)
    expect(v.console.ice).toBe(`${s.iceMm.long} × ${s.iceMm.short} mm`)
    expect(v.console.coldest).toBe(`${Math.round(Math.min(...s.needles.map((n) => n.tempC)))} °C`)
    expect(v.console.margin).toBe(`${Math.round(s.marginC)} °C`)
    expect(v.needles.every((n) => n.state === 'in' && n.active)).toBe(true)
  })

  it('needles out: the needles come out one at a time and read "out"', () => {
    const s = cryoState({ step: 'needlesOut', needles: 3, inserted: [0, 0.5, 1] })
    expect(cryoSuiteView(s).needles.map((n) => n.state)).toEqual(['out', 'in', 'in'])
    s.step = 'finalCt'
    for (const n of s.needles) n.inserted = 0
    expect(cryoSuiteView(s).needles.every((n) => n.state === 'out')).toBe(true)
  })

  it('today\'s list: a clock time, the patient, the step, the case in the room marked', () => {
    const v = cryoSuiteView(cryoState({ step: 'sedation' }))
    expect(v.list).toHaveLength(2)
    expect(v.list[0]).toMatchObject({ time: '10:06', patient: 'Mara Lindqvist', step: CRYO_SUITE_COPY.steps.sedation, current: true })
    expect(v.list[1]).toMatchObject({ time: '14:18', current: false, step: 'Booked' })
  })

  it('the button: start now with the room free, book next while a case is in, disabled once a demo is booked; the last answer\'s note', () => {
    const idle = emptyCryoState()
    expect(startButton(idle, null).label).toBe(P.start)
    expect(startButton(idle, 'noTeam').note).toBe(P.noTeam)
    const busy = cryoState({ step: 'freeze1' })
    expect(startButton(busy, null).label).toBe(P.startNext)
    expect(startButton(busy, 'queued').note).toBe(P.queued)
    busy.demoQueued = true
    expect(startButton(busy, null)).toEqual({ label: P.startNext, disabled: true, note: P.queued })
    const demo = cryoState({ step: 'aim' })
    demo.demo = true
    expect(startButton(demo, 'started').disabled).toBe(true)
  })

  it('the card names the real devices; the model elsewhere is brand-free', () => {
    const v = cryoSuiteView(cryoState())
    expect(v.card.robot).toMatch(/MAXIO|Epione/)
    expect(v.card.console).toMatch(/Visual-ICE/)
    expect(v.card.honesty.startsWith('Simulated')).toBe(true)
    const rest = JSON.stringify({ ...v, card: null })
    expect(rest).not.toMatch(/MAXIO|Epione|Perfint|Quantum|Boston|Visual-ICE/)
  })
})
