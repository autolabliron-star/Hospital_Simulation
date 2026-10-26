/**
 * R4: the cryo suite panel as markup, in node (react-dom/server): what CryoSuiteBody shows for the hospital as it starts (the live sim's suite), and
 * what the presentational panel shows for hand-made state. No effects run here (the picture's canvas is only an element); the view model's behaviour
 * is in cryoSuiteView.test.ts.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import { cryoState } from '@/scene/cryoSuite/testkit'
import { CryoSuiteBody, CryoSuitePanel, LIVE_PX } from './CryoSuiteBody'
import { cryoSuiteView } from './cryoSuiteView'

const P = CRYO_SUITE_COPY.panel
const panel = (v = cryoSuiteView(cryoState({ step: 'freeze1', ice: 0.5 })), mode: 'planning' | 'live' = 'live') =>
  renderToStaticMarkup(createElement(CryoSuitePanel, { v, mode, onMode: () => {}, onStart: () => {}, picture: createElement('canvas', { 'data-marker': 'picture' }) }))

describe('the cryo suite panel', () => {
  it('renders for the live sim: "Simulated", the title, the 384 px picture, the Planning/Live toggle, the start button and the card', () => {
    const html = renderToStaticMarkup(createElement(CryoSuiteBody))
    expect(html).toContain('>Simulated<')
    expect(html).toContain(P.title)
    expect(html).toContain(`width="${LIVE_PX}"`)
    expect(html).toContain(`height="${LIVE_PX}"`)
    expect(html).toContain(`>${P.planning}<`)
    expect(html).toContain(`>${P.live}<`)
    expect(html).toContain('cr-start')
    expect(html).toContain(CRYO_SUITE_COPY.card.title)
    expect(html).toContain('Simulated.')
  })

  it('shows the step, the stepper, a row per needle with its temperature, the console readouts and the list', () => {
    const s = cryoState({ step: 'freeze1', ice: 0.5, timer: 125 })
    const html = panel(cryoSuiteView(s))
    expect(html).toContain(CRYO_SUITE_COPY.steps.freeze1)
    expect(html).toContain('aria-current="step"')
    expect((html.match(/class="cr-needle"/g) ?? []).length).toBe(s.needles.length)
    expect(html).toContain('2:05')
    expect(html).toContain(P.margin)
    expect(html).toContain(P.ice)
    expect(html).toContain('Mara Lindqvist')
    expect(html).toContain('Tomas Ekwueme')
    expect(html).toContain('data-marker="picture"')
  })

  it('the toggle shows which picture is on, and the button its state', () => {
    expect(panel(undefined, 'planning')).toMatch(/aria-pressed="true"[^>]*>Planning</)
    expect(panel(undefined, 'live')).toMatch(/aria-pressed="true"[^>]*>Live</)
    const booked = cryoState({ step: 'aim' })
    booked.demoQueued = true
    const html = panel(cryoSuiteView(booked))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Book a cryoablation next</)
    expect(html).toContain(P.queued)
  })
})
