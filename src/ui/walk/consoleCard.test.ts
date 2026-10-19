/**
 * The teaching-console card in node (react-dom/server for the markup, a recording context for the picture): the HUD view model (procedure, phase, console
 * clock, each arm's instrument and force bar, insufflation, the standby line before docking), the 12 Hz canvas that paints only while it is open and only when
 * something changed, the card's markup, and its store.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import { createRecorder, mockSurface } from '@/scene/imaging/images/mockCanvas'
import { caseView, dockedRobot, stowedRobot, surgeryState, theatre } from '@/scene/surgery/testkit'
import { CONFIG } from '@/sim/config'
import type { SurgeryState } from '@/sim/types'
import { CARD_H, CARD_MS, CARD_W, ConsoleCanvas } from './consoleCard.canvas'
import { useConsoleCard } from './consoleCard.store'
import { consoleHud } from './consoleCard.view'
import { ConsoleCardView } from './ConsoleCard'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)
const noop = (): void => undefined

function docked(): SurgeryState {
  const robot = dockedRobot('transverse', { arms: dockedRobot('transverse').arms.map((a, i) => ({ ...a, instrument: SURGERY_COPY.procedures.cholecystectomy.instruments[i], force: [0, 0.25, 0.5, 1][i] })) })
  return surgeryState({ theatre: theatre('console', { cases: [caseView('c1', { consoleStart: 1000, wheelsIn: 100 })] }), robot })
}

function standby(): SurgeryState {
  return surgeryState({ theatre: theatre('idle', { cases: [caseView('c1', { plannedIn: 5400 })] }), robot: stowedRobot() })
}

describe('the HUD view model', () => {
  it('while docked: the procedure, the phase, the console clock, four arms with their instruments and force bars, the insufflation, and the "Teaching console · view only · Simulated" title', () => {
    const v = consoleHud(docked(), 1600)
    expect(v.title).toBe('Teaching console · view only · Simulated')
    expect(v.live).toBe(true)
    expect(v.standby).toBeNull()
    expect(v.procedure).toBe(SURGERY_COPY.procedures.cholecystectomy.name)
    expect(v.phase).toBe(SURGERY_COPY.phases.console)
    expect(v.clock).toBe('10:00')
    expect(v.insufflation).toBe(`${SURGERY_UI.console.insufflation} ${CONFIG.surgery.insufflationMmHg} ${SURGERY_UI.console.mmHg}`)
    expect(v.insufflation).toContain('12')
    expect(v.arms.map((a) => a.label)).toEqual(['Arm 1', 'Arm 2', 'Arm 3', 'Arm 4'])
    expect(v.arms.map((a) => a.instrument)).toEqual(SURGERY_COPY.procedures.cholecystectomy.instruments)
    expect(v.arms[1].instrument).toBe('Endoscope 30°')
    expect(v.arms.map((a) => a.force)).toEqual([0, 25, 50, 100])
    expect(v.arms.every((a) => a.engaged)).toBe(true)
    expect(v.leave).toBe(SURGERY_UI.console.leave)
  })

  it('before docking: the standby line with the next case and its time, a dash for the clock, no insufflation', () => {
    const v = consoleHud(standby(), 100)
    expect(v.live).toBe(false)
    expect(v.insufflation).toBeNull()
    expect(v.clock).toBe('–')
    expect(v.standby).toMatch(/^The robot is not docked yet\. Next: Gallbladder at \d\d:\d\d\.$/)
    expect(v.procedure).toBe('')
    expect(v.arms.every((a) => !a.engaged && a.instrument === '')).toBe(true)
  })

  it('says there are no more cases when the list is done', () => {
    const none = surgeryState()
    expect(consoleHud(none, 0).standby).toBe(SURGERY_UI.console.standbyNone)
  })

  it('clamps a force reading to 0..100, and is plain JSON (usePoll diffs it)', () => {
    const st = docked()
    st.robot.arms[0].force = 3
    st.robot.arms[1].force = -1
    const v = consoleHud(st, 1600)
    expect(v.arms[0].force).toBe(100)
    expect(v.arms[1].force).toBe(0)
    expect(JSON.parse(JSON.stringify(v))).toEqual(v)
  })

  it('shows an arm that is mid-swing as not engaged (its force reading means nothing yet)', () => {
    const st = docked()
    st.robot.arms[2].engage = 0.55
    expect(consoleHud(st, 1600).arms[2].engaged).toBe(false)
  })
})

describe('the card\'s picture', () => {
  const make = () => {
    const rec = createRecorder()
    const s = mockSurface(CARD_W, CARD_H, rec)
    return { painter: new ConsoleCanvas(s.ctx), rec }
  }

  it('is a 384 x 240 canvas at 12 Hz', () => {
    expect([CARD_W, CARD_H]).toEqual([384, 240])
    expect(CARD_MS).toBeCloseTo(1000 / 12, 9)
  })

  it('paints the standby screen once per robot phase, then nothing until the phase changes', () => {
    const { painter } = make()
    const r = stowedRobot('stowed')
    expect(painter.update(r, 1, 0)).toBe(true)
    for (let i = 1; i < 120; i++) expect(painter.update(r, 1 + i, i * 16)).toBe(false)
    expect(painter.paints).toBe(1)
    expect(painter.update(stowedRobot('draping', 0.3), 200, 3000)).toBe(true)
    expect(painter.paints).toBe(2)
  })

  it('paints the live picture at the 12 Hz timer\'s rate, never faster than 16 Hz even when it is called every frame, and holds the frame while the sim clock is paused', () => {
    const { painter, rec } = make()
    const r = dockedRobot('transverse')
    let n = 0
    // the card's timer: a tick every 83.3 ms for 10 s
    for (let f = 0; f < 120; f++) if (painter.update(r, 100 + f / 12, f * (1000 / 12))) n++
    expect(n).toBeGreaterThanOrEqual(118)
    expect(rec.count('clip')).toBe(n) // each live paint is the round endoscope view
    // called every 60 Hz frame it still stays under 16 paints a second
    const other = make().painter
    let m = 0
    for (let f = 0; f < 600; f++) if (other.update(r, 100 + f / 60, (f * 1000) / 60)) m++
    expect(m).toBeLessThanOrEqual(160)
    expect(m).toBeGreaterThanOrEqual(100)
    // a paused demo: the sim clock stands still, so after one paint at the new time nothing more is painted
    const before = painter.paints
    for (let f = 0; f < 60; f++) painter.update(r, 999, 20_000 + f * 100)
    expect(painter.paints - before).toBe(1)
  })

  it('goes back to the standby screen when the arms come off', () => {
    const { painter } = make()
    painter.update(dockedRobot('transverse'), 100, 0)
    expect(painter.update(stowedRobot('cleaning', 1), 500, 1000)).toBe(true)
    expect(painter.update(stowedRobot('cleaning', 1), 501, 1100)).toBe(false)
  })
})

describe('the card', () => {
  it('while live: the title, the canvas, the facts, four arms with a force meter each, the insufflation, the leave hint', () => {
    const out = html(createElement(ConsoleCardView, { hud: consoleHud(docked(), 1600), onClose: noop }))
    expect(out).toContain('Teaching console · view only · Simulated')
    expect(out).toContain('<canvas')
    expect(out).toContain(`width="${CARD_W}"`)
    expect(out).toContain(`height="${CARD_H}"`)
    expect(out).toContain(SURGERY_COPY.procedures.cholecystectomy.name)
    expect(out).toContain(SURGERY_COPY.phases.console)
    expect(out).toContain('10:00')
    expect(out).toContain('Arm 4')
    expect(out).toContain('Endoscope 30°')
    expect(out.match(/role="meter"/g)?.length).toBe(4)
    expect(out).toContain('width:100%') // the fourth arm's bar
    expect(out).toContain('width:50%')
    expect(out).toContain('12 mmHg')
    expect(out).toContain(SURGERY_UI.console.leave)
    expect(out).toContain('data-live="true"')
    expect(out).not.toContain('walk-console__standby')
    expect(out).not.toContain('walk-console--inline')
  })

  it('before docking: the standby line under the picture, no insufflation, dashes for the instruments, and no bar', () => {
    const out = html(createElement(ConsoleCardView, { hud: consoleHud(standby(), 100), onClose: noop }))
    expect(out).toContain('walk-console__standby')
    expect(out).toContain('The robot is not docked yet.')
    expect(out).toContain('data-live="false"')
    expect(out).not.toContain('mmHg')
    expect(out).toContain('width:0%')
  })

  it('is an ordinary block inside the OR panel (the inline variant) and has a close button named for leaving', () => {
    const out = html(createElement(ConsoleCardView, { hud: consoleHud(docked(), 1600), onClose: noop, inline: true }))
    expect(out).toContain('walk-console--inline')
    expect(out).toContain(`aria-label="${SURGERY_UI.console.leave}"`)
    expect(out).toContain('hud-icon-btn')
  })

  it('says nothing graphic, anywhere on it', () => {
    for (const st of [docked(), standby()]) {
      const out = html(createElement(ConsoleCardView, { hud: consoleHud(st, 1600), onClose: noop }))
      expect(out).not.toMatch(/\b(blood|bleed\w*|gore|wounds?|incisions?)\b/i)
    }
  })
})

describe('the card\'s store', () => {
  beforeEach(() => useConsoleCard.setState({ open: false, source: 'seat' }))

  it('opens from a source and closes', () => {
    useConsoleCard.getState().show('panel')
    expect(useConsoleCard.getState()).toMatchObject({ open: true, source: 'panel' })
    useConsoleCard.getState().close()
    expect(useConsoleCard.getState().open).toBe(false)
  })

  it('toggles: opens from a source, closes when it is the same source, switches when it is the other', () => {
    const s = useConsoleCard.getState()
    s.toggle('panel')
    expect(useConsoleCard.getState()).toMatchObject({ open: true, source: 'panel' })
    useConsoleCard.getState().toggle('panel')
    expect(useConsoleCard.getState().open).toBe(false)
    useConsoleCard.getState().toggle('panel')
    useConsoleCard.getState().toggle('seat')
    expect(useConsoleCard.getState()).toMatchObject({ open: true, source: 'seat' })
  })
})
