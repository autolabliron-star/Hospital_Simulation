import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Menu, JUMP_OPEN_FOCUS } from './JumpMenu'
import { HudView } from './Hud'
import { NoticeView, SoundPillView, TimePillView } from './PresenterOverlay'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)
const noop = (): void => undefined

describe('the presenter overlay views', () => {
  it('the time pill shows only a pause or a speed other than 1x', () => {
    expect(html(createElement(TimePillView, { paused: false, speed: 1 }))).toBe('')
    expect(html(createElement(TimePillView, { paused: true, speed: 1 }))).toContain('Paused')
    expect(html(createElement(TimePillView, { paused: false, speed: 30 }))).toContain('30×')
  })

  it('the sound pill says the state and the key', () => {
    const on = html(createElement(SoundPillView, { muted: false, onToggle: noop }))
    const off = html(createElement(SoundPillView, { muted: true, onToggle: noop }))
    expect(on).toContain('Sound on')
    expect(off).toContain('Sound off')
    expect(on).toContain('>M<')
  })

  it('the notice renders its text, and nothing when empty', () => {
    expect(html(createElement(NoticeView, { id: 1, text: 'Sound off.' }))).toContain('Sound off.')
    expect(html(createElement(NoticeView, { id: 1, text: null }))).toBe('')
  })
})

describe('the HUD behind the loading screen', () => {
  const props = { mode: 'overview' as const, hidden: false, rxOpen: false, rxRoom: null, rxRequest: 0, onToggleRx: noop, onCloseRx: noop }
  it('is inert until Enter is pressed', () => {
    expect(html(createElement(HudView, { ...props, inert: true }))).toMatch(/inert/)
    expect(html(createElement(HudView, { ...props, inert: false }))).not.toMatch(/inert/)
  })
  it('the tablet is labelled for doctors and says nothing of ord ids', () => {
    const out = html(createElement(HudView, { ...props, rxOpen: true }))
    expect(out).toContain('Prescribe medicines')
    expect(out).not.toContain('developer')
  })
})

describe('the Jump menu focus target (F-36)', () => {
  it('is the Close button, the first button in the dialog, not a moment of the day', () => {
    const out = html(createElement(Menu, { onClose: noop }))
    expect(JUMP_OPEN_FOCUS).toBe('[data-jump-close]')
    const firstButton = out.slice(out.indexOf('<button'), out.indexOf('>', out.indexOf('<button')))
    expect(firstButton).toContain('data-jump-close')
    expect(out.match(/data-jump-close/g)).toHaveLength(1)
    expect(firstButton).not.toContain('data-jump-item')
  })
})
