/**
 * R5: the watch overlay, the room panel's picker and the keys while watching, as markup and pure rules in node (react-dom/server, no effects).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import { scriptFor } from '@/content/procedures'
import { fillWatch, overlayWords, panelWords, WATCH } from '@/content/watch'
import { clearInsetSources, registerInsetSource } from '@/scene/registries/insetSources'
import type { WatchRoomId } from '@/scene/watch/rooms'
import { DEFAULT_KEYMAP, type ProcedureId } from '@/sim/types'
import { hotkeyAllowed, type HotkeyContext } from '@/ui/hotkeys'
import { hudIsHidden } from '@/ui/Hud'
import { PRESENT_KEY, PRESENT_NEXT_KEY } from '@/ui/present/presentation.store'
import { captionModel } from './watchView'
import { DipLayer, WatchOverlayView, type WatchOverlayViewProps } from './WatchOverlay'
import { INSET_H, INSET_W, Inset, drawInset, insetFit } from './Inset'
import { answerText, pickerItems, teamHours, WatchPicker, WatchPickerView, type WatchPickerViewProps } from './WatchPicker'
import { CryoSuiteBody } from '@/ui/CryoSuiteBody'
import { ScanViewer } from '@/ui/ScanViewer'

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


// ---------------------------------------------------------------------------------------------
// R5 wave 3: the CT suite's and the ultrasound room's pickers and panels
// ---------------------------------------------------------------------------------------------

const ROOM_PROCEDURES: Record<'cryo' | 'us', ProcedureId[]> = {
  cryo: ['cryo-kidney', 'cryo-lung', 'cryo-liver'],
  us: ['us-breastCancer', 'us-fibroadenoma'],
}

describe.each(['cryo', 'us'] as const)('the %s room\'s picker', (room) => {
  const items = pickerItems(room)
  const base: WatchPickerViewProps = { room, open: false, items, answer: null, onToggle: noop, onPick: noop, onFollow: noop, onFromStart: noop, onBack: noop }
  const w = panelWords(room)

  it('offers its own procedures, each with its title, detail and watch length (10 to 15 minutes)', () => {
    expect(items.map((i) => i.id)).toEqual(ROOM_PROCEDURES[room])
    for (const i of items) {
      expect(i.title).toBe(WATCH.procedures[i.id].title)
      expect(i.detail).toBe(WATCH.procedures[i.id].detail)
      const n = Number(/\d+/.exec(i.minutes)![0])
      expect(n).toBeGreaterThanOrEqual(10)
      expect(n).toBeLessThanOrEqual(15)
    }
  })

  it('is one button until opened (the same "Watch step by step"); opened, one button per procedure, under the room\'s own heading', () => {
    const closed = renderToStaticMarkup(createElement(WatchPickerView, base))
    expect(count(closed, '<button')).toBe(1)
    expect(closed).toContain(`>${WATCH.panel.button}<`)
    expect(closed).toContain(h(w.buttonTitle))
    expect(closed).toContain(`data-room="${room}"`)
    const open = renderToStaticMarkup(createElement(WatchPickerView, { ...base, open: true }))
    expect(count(open, '<button')).toBe(1 + items.length)
    expect(open).toContain(h(w.pick))
    for (const id of ROOM_PROCEDURES[room]) expect(open).toContain(h(WATCH.procedures[id].title))
    expect(open).not.toContain('theatre')
  })

  it('a case in the room: the two choices in the room\'s words; busy, no team and no camera: a line', () => {
    const id = ROOM_PROCEDURES[room][0]
    const following = renderToStaticMarkup(createElement(WatchPickerView, { ...base, open: true, answer: { id, result: 'following' } }))
    expect(following).toContain(h(w.following))
    expect(following).toContain(WATCH.panel.watchCurrent)
    expect(following).toContain(WATCH.panel.fromStart)
    expect(following).toContain(h(w.fromStartNote))
    const busy = renderToStaticMarkup(createElement(WatchPickerView, { ...base, open: true, answer: { id, result: 'busy' } }))
    expect(busy).toContain(h(w.busy))
    const noTeam = renderToStaticMarkup(createElement(WatchPickerView, { ...base, open: true, answer: { id, result: 'noTeam' } }))
    expect(noTeam).toContain('role="status"')
    expect(noTeam).toContain(h(answerText('noTeam', room)!))
    expect(answerText('noCamera', room)).toBe(w.busy)
    expect(answerText('started', room)).toBeNull()
    expect(answerText('queued', room)).toBeNull()
  })

  it('the choices call back with the procedure', () => {
    const id = ROOM_PROCEDURES[room][1]
    const onFromStart = vi.fn()
    const onFollow = vi.fn()
    const tree = WatchPickerView({ ...base, open: true, answer: { id, result: 'following' }, onFromStart, onFollow }) as unknown as { props: { children: unknown[] } }
    const choice = tree.props.children[1] as { props: { children: { props: { onClick?: () => void } }[] } }
    choice.props.children[1].props.onClick?.()
    choice.props.children[2].props.onClick?.()
    expect(onFollow).toHaveBeenCalledTimes(1)
    expect(onFromStart).toHaveBeenCalledWith(id)
  })
})

describe('what the pickers say when the team is not in', () => {
  it('names each room\'s own hours: the theatre\'s, the cryoablation team\'s, the ultrasound room\'s', () => {
    expect(teamHours('or')).toEqual({ from: 7, to: 18.5 })
    expect(teamHours('cryo')).toEqual({ from: 8, to: 17.5 })
    expect(teamHours('us')).toEqual({ from: 8, to: 18 })
    expect(answerText('noTeam', 'or')).toContain('07:00')
    expect(answerText('noTeam', 'or')).toContain('18:30')
    expect(answerText('noTeam', 'cryo')).toContain('08:00')
    expect(answerText('noTeam', 'cryo')).toContain('17:30')
    expect(answerText('noTeam', 'cryo')).toMatch(/cryoablation team/)
    expect(answerText('noTeam', 'us')).toContain('08:00')
    expect(answerText('noTeam', 'us')).toContain('18:00')
    expect(answerText('noTeam', 'us')).toMatch(/ultrasound team/)
    // the theatre's answers are the ones it always had
    expect(answerText('noTeam')).toBe(answerText('noTeam', 'or'))
    expect(answerText('busy')).toBe(WATCH.panel.busy)
  })

  it('the CT suite says it is too late today for a whole case, in the words its own panel uses', () => {
    expect(answerText('tooLate', 'cryo')).toBe(CRYO_SUITE_COPY.panel.tooLate)
    const html = renderToStaticMarkup(
      createElement(WatchPickerView, { room: 'cryo', open: true, items: pickerItems('cryo'), answer: { id: 'cryo-lung', result: 'tooLate' }, onToggle: noop, onPick: noop, onFollow: noop, onFromStart: noop, onBack: noop }),
    )
    expect(html).toContain(h(CRYO_SUITE_COPY.panel.tooLate))
    expect(html).toContain('role="status"')
  })

  it('the stateful picker renders for each room (closed: one button)', () => {
    for (const room of ['or', 'cryo', 'us'] as const satisfies readonly WatchRoomId[]) {
      const html = renderToStaticMarkup(createElement(WatchPicker, { room }))
      expect(count(html, '<button')).toBe(1)
      expect(html).toContain(`data-room="${room}"`)
    }
  })
})

describe('the room panels carry the picker', () => {
  it('the CT suite\'s panel has "Watch step by step" under its start button', () => {
    const html = renderToStaticMarkup(createElement(CryoSuiteBody))
    expect(html).toContain('watch-pick')
    expect(html).toContain('data-room="cryo"')
    expect(html).toContain(`>${WATCH.panel.button}<`)
    expect(html.indexOf('cr-start')).toBeGreaterThan(-1)
    expect(html.indexOf('watch-pick')).toBeGreaterThan(html.indexOf('cr-start'))
    // one picker, and the panel's own button is still there
    expect(count(html, 'watch-pick__open')).toBe(1)
  })

  it('the ultrasound room\'s scan viewer has it; the other scanners\' do not', () => {
    const us = renderToStaticMarkup(createElement(ScanViewer, { modality: 'us' }))
    expect(us).toContain('data-room="us"')
    expect(us).toContain(`>${WATCH.panel.button}<`)
    expect(count(us, 'watch-pick__open')).toBe(1)
    for (const modality of ['mri', 'ct', 'xray'] as const) expect(renderToStaticMarkup(createElement(ScanViewer, { modality })), modality).not.toContain('watch-pick')
  })
})

describe('the overlay\'s words for each room', () => {
  it('the CT suite and the ultrasound room name themselves while they wait and when the case is over; the theatre\'s words are untouched', () => {
    const wait = (room: WatchRoomId | undefined) =>
      captionModel({ room, status: 'waiting', mode: 'watch', procedureId: 'cryo-lung', view: null, startsAt: 1300, now: 1000 })
    expect(wait(undefined).title).toBe(fillWatch(WATCH.overlay.startsIn, { time: '5:00' }))
    expect(wait('or').title).toBe(fillWatch(WATCH.overlay.startsIn, { time: '5:00' }))
    expect(wait('cryo').title).toBe('The cryoablation starts in 5:00')
    expect(wait('us').title).toBe('The procedure starts in 5:00')
    const over = (room: WatchRoomId) => captionModel({ room, status: 'ended', mode: 'watch', procedureId: 'us-breastCancer', view: null, startsAt: null, now: 0 })
    expect(over('or').title).toBe(WATCH.overlay.ended)
    expect(over('cryo').title).toBe(overlayWords('cryo').ended)
    expect(over('us').why).toBe(overlayWords('us').endedWhy)
    expect(over('us').why).not.toMatch(/recovery/)
    expect(over('or').why).toBe(WATCH.overlay.endedWhy)
  })

  it('shows the room\'s name in the tag and the room\'s case in the step list', () => {
    const cryo = scriptFor('cryo-lung')!
    const caption = captionModel({ room: 'cryo', status: 'case', mode: 'watch', procedureId: 'cryo-lung', view: { procedureId: 'cryo-lung', stepIndex: 4, stepCount: cryo.steps.length, stepId: cryo.steps[4].id, repeat: null }, startsAt: null, now: 0 })
    const html = overlay({ caption, room: 'cryo' })
    expect(html).toContain(WATCH.rooms.cryo)
    expect(html).toContain(h(`Step 5 of ${cryo.steps.length}: ${cryo.steps[4].caption}`))
    expect(html).toContain(h(cryo.steps[4].why))
    expect(overlay({ caption, room: 'us' })).toContain(WATCH.rooms.us)
    expect(count(html, 'data-watch-step="done"')).toBe(4)
  })
})

describe('the picture-in-picture', () => {
  it('shows nothing at all while its source is not registered (never a black box), and its figure once it is', () => {
    clearInsetSources()
    expect(renderToStaticMarkup(createElement(Inset, { id: 'ctLive', big: true }))).toBe('')
    expect(renderToStaticMarkup(createElement(Inset, { id: 'us', big: false }))).toBe('')
    const off = registerInsetSource({ id: 'us', canvas: {}, width: 384, height: 384, paints: () => 0 })
    const html = renderToStaticMarkup(createElement(Inset, { id: 'us', big: true }))
    expect(html).toContain('data-big="true"')
    expect(html).toContain(WATCH.insets.us)
    expect(html).toContain('<canvas')
    // the other ids stay empty
    expect(renderToStaticMarkup(createElement(Inset, { id: 'ctPlan', big: false }))).toBe('')
    off()
    expect(renderToStaticMarkup(createElement(Inset, { id: 'us', big: true }))).toBe('')
    clearInsetSources()
  })

  it('fits a picture into the 16:9 box: a 16:9 one fills it (the endoscope\'s, as before), a square one is centred with bars each side, never stretched', () => {
    expect(insetFit(640, 360)).toEqual({ x: 0, y: 0, w: INSET_W, h: INSET_H })
    expect(insetFit(384, 216)).toEqual({ x: 0, y: 0, w: INSET_W, h: INSET_H })
    const sq = insetFit(384, 384)
    expect(sq.h).toBe(INSET_H)
    expect(sq.w).toBe(INSET_H)
    expect(sq.x).toBe((INSET_W - INSET_H) / 2)
    expect(sq.y).toBe(0)
    const tall = insetFit(100, 400)
    expect(tall.w / tall.h).toBeCloseTo(0.25, 9)
    expect(tall.h).toBe(INSET_H)
    const wide = insetFit(800, 200)
    expect(wide.w).toBe(INSET_W)
    expect(wide.y).toBeGreaterThan(0)
    // an unknown size draws the whole box
    expect(insetFit(0, 0)).toEqual({ x: 0, y: 0, w: INSET_W, h: INSET_H })
  })

  it('draws the source whole into the fitted rectangle, with black bars only when the shape differs', () => {
    const calls: unknown[][] = []
    const ctx = {
      fillStyle: '',
      fillRect: (...a: unknown[]) => calls.push(['fillRect', ...a]),
      drawImage: (...a: unknown[]) => calls.push(['drawImage', ...a.slice(1)]),
    } as unknown as CanvasRenderingContext2D
    drawInset(ctx, { canvas: {}, width: 640, height: 360 })
    expect(calls).toEqual([['drawImage', 0, 0, 640, 360, 0, 0, INSET_W, INSET_H]])
    calls.length = 0
    drawInset(ctx, { canvas: {}, width: 384, height: 384 })
    expect(calls[0]).toEqual(['fillRect', 0, 0, INSET_W, INSET_H])
    expect(calls[1]).toEqual(['drawImage', 0, 0, 384, 384, 84, 0, INSET_H, INSET_H])
  })
})
