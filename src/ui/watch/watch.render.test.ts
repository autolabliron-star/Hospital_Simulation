/**
 * R5: the watch overlay, the room panel's picker and the keys while watching, as markup and pure rules in node (react-dom/server, no effects).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { scriptFor } from '@/content/procedures'
import { fillWatch, WATCH } from '@/content/watch'
import { DEFAULT_KEYMAP } from '@/sim/types'
import { hotkeyAllowed, type HotkeyContext } from '@/ui/hotkeys'
import { hudIsHidden } from '@/ui/Hud'
import { PRESENT_KEY, PRESENT_NEXT_KEY } from '@/ui/present/presentation.store'
import { captionModel } from './watchView'
import { DipLayer, WatchOverlayView, type WatchOverlayViewProps } from './WatchOverlay'
import { answerText, pickerItems, WatchPickerView, type WatchPickerViewProps } from './WatchPicker'

const ID = 'or-cholecystectomy' as const
const script = scriptFor(ID)!
const noop = (): void => undefined

function overlay(o: Partial<WatchOverlayViewProps> = {}): string {
  const caption = captionModel({ status: 'case', mode: 'watch', procedureId: ID, view: { procedureId: ID, stepIndex: 6, stepCount: script.steps.length, stepId: script.steps[6].id, repeat: null }, startsAt: null, now: 0 })
  const props: WatchOverlayViewProps = {
    caption,
    room: 'or',
    free: 'off',
    inset: null,
    insetBig: false,
    skipping: false,
    paused: false,
    speed: 1,
    stepsOpen: true,
    onToggleSteps: noop,
    onPause: noop,
    onSpeed: noop,
    onFreeLook: noop,
    onExit: noop,
    onSkip: noop,
    ...o,
  }
  return renderToStaticMarkup(createElement(WatchOverlayView, props))
}

const count = (html: string, needle: string): number => html.split(needle).length - 1
const h = (text: string): string => text.replace(/'/g, '&#x27;')

describe('the watch overlay', () => {
  it('shows the caption bar with the step and its why, the room, "Simulated" and the controls', () => {
    const html = overlay()
    expect(html).toContain(h(`Step 7 of ${script.steps.length}: ${script.steps[6].caption}`))
    expect(html).toContain(h(script.steps[6].why))
    expect(html).toContain(WATCH.rooms.or)
    expect(html).toContain(WATCH.overlay.simulated)
    for (const label of [WATCH.overlay.pause, WATCH.overlay.freeLook, WATCH.overlay.exit]) expect(html).toContain(`>${label}`)
    for (const n of [1, 2, 4]) expect(html).toContain(`>${fillWatch(WATCH.overlay.speedLabel, { n })}<`)
    expect(html).not.toMatch(/\bOR\b/)
  })

  it('lists the steps with the current one marked, and folds the list away', () => {
    const open = overlay()
    expect(count(open, 'data-watch-step="done"')).toBe(6)
    expect(count(open, 'data-watch-step="current"')).toBe(1)
    expect(count(open, 'aria-current="step"')).toBe(1)
    const closed = overlay({ stepsOpen: false })
    expect(count(closed, 'data-watch-step=')).toBe(0)
    expect(closed).toContain('aria-expanded="false"')
  })

  it('shows the pause state, the speed, held free look and the drag hint', () => {
    const html = overlay({ paused: true, speed: 4, free: 'held' })
    expect(html).toContain(`>${WATCH.overlay.play}<`)
    expect(html).toContain(`aria-pressed="true" title="${fillWatch(WATCH.overlay.speedTitle, { n: 4 })}"`)
    expect(overlay({ free: 'drag' })).toContain(WATCH.overlay.dragHint)
    expect(overlay({ free: 'off' })).not.toContain(WATCH.overlay.dragHint)
  })

  it('counts down to a booked case with a skip, and says when the skip is running', () => {
    const caption = captionModel({ status: 'waiting', mode: 'watch', procedureId: ID, view: null, startsAt: 1300, now: 1000 })
    expect(overlay({ caption })).toContain(fillWatch(WATCH.overlay.startsIn, { time: '5:00' }))
    expect(overlay({ caption })).toContain(`>${WATCH.overlay.skip}<`)
    expect(overlay({ caption, skipping: true })).toContain(`>${WATCH.overlay.skipBusy}<`)
  })

  it('marks the inset size for the layout, and the dip replays only after the first cut', () => {
    expect(overlay({ inset: 'endo', insetBig: true })).toContain('data-inset="big"')
    expect(overlay({ inset: 'endo' })).toContain('data-inset="small"')
    expect(overlay()).toContain('data-inset="none"')
    expect(renderToStaticMarkup(createElement(DipLayer, { dip: 0 }))).toBe('')
    expect(renderToStaticMarkup(createElement(DipLayer, { dip: 3 }))).toContain('watch-dip')
  })
})

describe('the room panel picker', () => {
  const items = pickerItems('or')
  const base: WatchPickerViewProps = { room: 'or', open: false, items, answer: null, onToggle: noop, onPick: noop, onFollow: noop, onFromStart: noop, onBack: noop }

  it('offers the procedures that have a script, with their watch length', () => {
    expect(items.map((i) => i.id)).toContain(ID)
    for (const i of items) expect(scriptFor(i.id)).toBeDefined()
    const chole = items.find((i) => i.id === ID)!
    expect(chole.title).toBe(WATCH.procedures[ID].title)
    expect(chole.minutes).toMatch(/\d+ min/)
  })

  it('is one button until opened; opened, one button per procedure', () => {
    const closed = renderToStaticMarkup(createElement(WatchPickerView, base))
    expect(count(closed, '<button')).toBe(1)
    expect(closed).toContain(`>${WATCH.panel.button}<`)
    const open = renderToStaticMarkup(createElement(WatchPickerView, { ...base, open: true }))
    expect(count(open, '<button')).toBe(1 + items.length)
    expect(open).toContain(WATCH.procedures[ID].title)
  })

  it('a case in the room: the two choices; busy or no team: a line', () => {
    const following = renderToStaticMarkup(createElement(WatchPickerView, { ...base, open: true, answer: { id: ID, result: 'following' } }))
    expect(following).toContain(WATCH.panel.watchCurrent)
    expect(following).toContain(WATCH.panel.fromStart)
    const busy = renderToStaticMarkup(createElement(WatchPickerView, { ...base, open: true, answer: { id: ID, result: 'busy' } }))
    expect(busy).toContain(WATCH.panel.busy)
    expect(answerText('noTeam')).toContain('07:00')
    expect(answerText('noTeam')).toContain('18:30')
    expect(answerText('started')).toBeNull()
  })

  it('the choices call back with the procedure', () => {
    const onFromStart = vi.fn()
    const onFollow = vi.fn()
    const tree = WatchPickerView({ ...base, open: true, answer: { id: ID, result: 'following' }, onFromStart, onFollow }) as unknown as { props: { children: unknown[] } }
    const choice = tree.props.children[1] as { props: { children: { props: { onClick?: () => void } }[] } }
    choice.props.children[1].props.onClick?.()
    choice.props.children[2].props.onClick?.()
    expect(onFollow).toHaveBeenCalledTimes(1)
    expect(onFromStart).toHaveBeenCalledWith(ID)
  })
})

describe('the keys and the HUD while watching', () => {
  const km = DEFAULT_KEYMAP
  const ctx = (watching: boolean): HotkeyContext => ({ entered: true, presenting: false, menuOpen: false, typing: false, watching })

  it('hears only Esc, M, Space and the speeds', () => {
    for (const code of [km.overview, km.mute, km.pause, km.speed1, km.speed2, km.speed4, km.speed10, km.speed30]) expect(hotkeyAllowed(code, ctx(true)), code).toBe(true)
    for (const code of [km.prescribe, km.jump, km.cleanScreen, km.goTo, km.skip, PRESENT_KEY, PRESENT_NEXT_KEY]) expect(hotkeyAllowed(code, ctx(true)), code).toBe(false)
    for (const code of [km.prescribe, km.jump, PRESENT_KEY]) expect(hotkeyAllowed(code, ctx(false)), code).toBe(true)
  })

  it('hides the HUD', () => {
    expect(hudIsHidden(false, false, true)).toBe(true)
    expect(hudIsHidden(false, false, false)).toBe(false)
    expect(hudIsHidden(false, false)).toBe(false)
  })
})
