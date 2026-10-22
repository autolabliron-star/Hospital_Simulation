/**
 * The HUD as markup, in node (react-dom/server, no browser): which cards the overview and walk mode put on the glass, and that the
 * walk pieces say what they are given. (zustand renders its initial state on the server, so the views take their state as props.)
 * No effects run here, so the minimap's canvas is only checked for being there.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlayerMode } from '@/sim/types'
import { HudView, type HudViewProps } from '../Hud'
import { DrawerCardView } from './DrawerCard'
import { readDrawer } from './drawerModel'
import { useHudPrefs } from './hudPrefs.store'
import { PromptView } from './InteractPrompt'
import { ObjectiveView } from './ObjectiveLine'
import { useRx } from './rx.store'
import { ClockView } from './WalkClock'
import { ToastView } from './WalkToast'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

const noop = (): void => undefined
const hud = (over: Partial<HudViewProps> & { mode: PlayerMode }): string =>
  html(createElement(HudView, { hidden: false, rxOpen: false, rxRoom: null, rxRequest: 0, onToggleRx: noop, onCloseRx: noop, ...over }))

describe('the HUD in the overview', () => {
  it("is today's: title card, KPI card, Prescribe pill, event line and order rail; nothing of walk mode", () => {
    const out = hud({ mode: 'overview' })
    expect(out).toContain('The Ideal Hospital')
    expect(out).toContain('Key figures')
    expect(out).toContain('Orders by stage')
    expect(out).toContain('Prescribe a medicine (P)')
    expect(out).toContain('data-hud="overview"')
    expect(out).not.toContain('walk-map')
    expect(out).not.toContain('walk-clock')
    expect(out).not.toContain('walk-hint')
  })

  it('keeps the tablet where it was: in the right column, in place of the pill', () => {
    const out = hud({ mode: 'overview', rxOpen: true, rxRoom: null })
    expect(out).toContain('Prescribe medicines')
    expect(out).toContain('Key figures')
    expect(out).not.toContain('Prescribe a medicine (P)')
  })
})

describe('the HUD in walk mode', () => {
  it('is quiet: a clock, the minimap and the key hint; no KPI card, order rail, event line, title card or pill', () => {
    const out = hud({ mode: 'walk' })
    expect(out).toContain('data-hud="walk"')
    expect(out).toContain('walk-clock')
    expect(out).toContain('walk-map')
    expect(out).toContain('walk-hint')
    expect(out).toContain('First person')
    expect(out).not.toContain('Key figures')
    expect(out).not.toContain('Orders by stage')
    expect(out).not.toContain('hud-event')
    expect(out).not.toContain('The Ideal Hospital')
    expect(out).not.toContain('hud-rx-open')
  })

  it('hands the right column to the tablet, which starts on the bed you faced', () => {
    const out = hud({ mode: 'walk', rxOpen: true, rxRoom: 'A3' })
    expect(out).toContain('Prescribe medicines')
    expect(out).toContain('data-walk="true"')
    expect(out).not.toContain('walk-map')
    expect(out).toMatch(/<option value="A3" selected/)
    // and with no room asked for it starts on the first one
    expect(hud({ mode: 'walk', rxOpen: true, rxRoom: null })).toMatch(/<option value="A1" selected/)
  })

  it('ignores a room that does not exist', () => {
    expect(hud({ mode: 'walk', rxOpen: true, rxRoom: 'Z9' })).toMatch(/<option value="A1" selected/)
  })

  it('shows the flights as the HUD of where you are going', () => {
    expect(hud({ mode: 'toWalk' })).toContain('walk-clock')
    expect(hud({ mode: 'toOverview' })).toContain('Key figures')
  })
})

describe('H', () => {
  it('hides the whole HUD, in both modes', () => {
    expect(hud({ mode: 'walk', hidden: true })).toBe('')
    expect(hud({ mode: 'overview', hidden: true })).toBe('')
    expect(hud({ mode: 'walk', hidden: true, rxOpen: true })).toBe('')
  })

  it('comes back when the tablet is opened (an invisible panel would hold your input)', () => {
    useHudPrefs.setState({ hidden: true })
    useRx.getState().openFor('A3')
    expect(useHudPrefs.getState().hidden).toBe(false)
    useRx.getState().close()
  })
})

describe('the pieces', () => {
  it('splits the prompt into a key cap and its words, and shows a locked prompt without a key', () => {
    const keyed = html(createElement(PromptView, { prompt: 'E · Sit down' }))
    expect(keyed).toContain('<kbd class="walk-key">E</kbd>')
    expect(keyed).toContain('Sit down')
    expect(keyed).toContain('data-locked="false"')
    const locked = html(createElement(PromptView, { prompt: 'A4 has no patient right now' }))
    expect(locked).not.toContain('walk-key')
    expect(locked).toContain('data-locked="true"')
    expect(html(createElement(PromptView, { prompt: null }))).toBe('')
  })

  it('shows the prompt for the bedside with the patient name', () => {
    expect(html(createElement(PromptView, { prompt: 'E · Prescribe for Grace Adeyemi' }))).toContain('Prescribe for Grace Adeyemi')
  })

  it('shows the objective line only when there is one', () => {
    expect(html(createElement(ObjectiveView, { text: null }))).toBe('')
    expect(html(createElement(ObjectiveView, { text: 'Pod A1 is bringing your order to A3: about 2 min' }))).toContain('Pod A1 is bringing your order to A3: about 2 min')
  })

  it('shows a toast while there is one', () => {
    expect(html(createElement(ToastView, { id: 1, text: null }))).toBe('')
    expect(html(createElement(ToastView, { id: 1, text: 'The wards upstairs aren\'t open in this demo.' }))).toContain('walk-toast')
  })

  it('shows the clock, with a tag when paused or fast', () => {
    expect(html(createElement(ClockView, { clock: '07:42', speed: 1, paused: false }))).not.toContain('walk-clock__tag')
    expect(html(createElement(ClockView, { clock: '07:42', speed: 1, paused: true }))).toContain('paused')
    expect(html(createElement(ClockView, { clock: '07:42', speed: 4, paused: false }))).toContain('4×')
    expect(html(createElement(ClockView, { clock: '07:42', speed: 1, paused: false }))).toContain('07:42')
  })

  it('shows what is in a drawer, and whose it is', () => {
    const empty = html(createElement(DrawerCardView, { v: readDrawerFixture(false), onClose: noop }))
    expect(empty).toContain('A3 medicine drawer')
    expect(empty).toContain('Empty')
    expect(empty).toContain('Nothing in it right now.')
    const loaded = html(createElement(DrawerCardView, { v: readDrawerFixture(true), onClose: noop }))
    expect(loaded).toContain('Loaded')
    expect(loaded).toContain('Salbutamol')
    expect(loaded).toContain('Dose due')
    expect(loaded).toContain('Locked to Grace Adeyemi')
  })
})

function readDrawerFixture(loaded: boolean) {
  return readDrawer(
    {
      meds: {
        drawers: new Map([['A3', { roomId: 'A3', state: loaded ? 'loaded' : 'empty', orderIds: [], items: loaded ? [{ medId: 'salbutamol', qty: 1 }] : [], lightOn: loaded }]]),
        occupant: () => ({ id: 'p', name: 'Grace Adeyemi' }),
      },
    },
    'A3',
    null,
  )
}
