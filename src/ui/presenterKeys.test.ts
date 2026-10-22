/** The presenter's keys: M toggles the mute in every mode, C and Esc leave the walkthrough, a mouse click gives a button's focus back. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mutedFromSearch, toggleMute, useAudio } from '@/audio/audio.store'
import { PRESENTER, PresenterSchema } from '@/content/presenter'
import { DEFAULT_KEYMAP } from '@/sim/types'
import { hotkeyAllowed } from './hotkeys'
import { showNotice, useNotice } from './notice.store'
import { presentKeyAction } from './present/PresentationControls'
import { usePresentation } from './present/presentation.store'
import { shouldBlurAfterClick } from './walk/typing'

describe('M toggles the mute in all modes', () => {
  beforeEach(() => useAudio.getState().setMuted(false))
  afterEach(() => useAudio.getState().setMuted(false))

  it('flips the store and returns the new state, and flips back', () => {
    expect(toggleMute()).toBe(true)
    expect(useAudio.getState().muted).toBe(true)
    expect(toggleMute()).toBe(false)
    expect(useAudio.getState().muted).toBe(false)
  })

  it('is allowed by the key table in the overview, in walk, presenting, under a menu and on the loading screen', () => {
    for (const entered of [true, false])
      for (const presenting of [true, false])
        for (const menuOpen of [true, false]) expect(hotkeyAllowed(DEFAULT_KEYMAP.mute, { entered, presenting, menuOpen, typing: false })).toBe(true)
  })

  it('is not remembered across a reload: a fresh page starts with sound, `?mute=1` starts muted on purpose (F-03)', () => {
    expect(mutedFromSearch('')).toBe(false)
    expect(mutedFromSearch('?seed=3')).toBe(false)
    expect(mutedFromSearch('?mute=1')).toBe(true)
    expect(mutedFromSearch('?mute=0')).toBe(false)
  })
})

describe('C or Esc exits presentation mode', () => {
  afterEach(() => usePresentation.getState().setOn(false))

  it('C toggles, N glides only inside the walkthrough, Esc exits only while it is on', () => {
    expect(presentKeyAction('KeyC', false, true)).toBe('toggle')
    expect(presentKeyAction('KeyC', true, true)).toBe('toggle')
    expect(presentKeyAction('KeyN', true, true)).toBe('next')
    expect(presentKeyAction('KeyN', false, true)).toBe('none')
    expect(presentKeyAction('Escape', true, true)).toBe('exit')
    expect(presentKeyAction('Escape', false, true)).toBe('none')
  })

  it('Esc exits even while a field has focus (the table does not gate it), but C does not act on the loading screen or while typing', () => {
    expect(presentKeyAction('Escape', true, false)).toBe('exit')
    expect(presentKeyAction('KeyC', false, false)).toBe('none')
  })

  it('the exit actions leave the store off', () => {
    usePresentation.getState().setOn(true)
    if (presentKeyAction('KeyC', usePresentation.getState().on, true) === 'toggle') usePresentation.getState().toggle()
    expect(usePresentation.getState().on).toBe(false)
    usePresentation.getState().setOn(true)
    if (presentKeyAction('Escape', usePresentation.getState().on, true) === 'exit') usePresentation.getState().setOn(false)
    expect(usePresentation.getState().on).toBe(false)
  })
})

describe('the notice', () => {
  it('replaces the old one, with a new key each time', () => {
    showNotice('one', 10_000)
    const a = useNotice.getState().id
    showNotice('two', 10_000)
    expect(useNotice.getState().text).toBe('two')
    expect(useNotice.getState().id).toBe(a + 1)
    useNotice.getState().clear()
    expect(useNotice.getState().text).toBeNull()
  })
})

describe('a clicked button gives the focus back (F-35)', () => {
  it('only for a mouse click on a button outside a dialog', () => {
    expect(shouldBlurAfterClick(1, 'BUTTON', false)).toBe(true)
    expect(shouldBlurAfterClick(0, 'BUTTON', false)).toBe(false) // Enter or Space on a focused button
    expect(shouldBlurAfterClick(1, 'BUTTON', true)).toBe(false)
    expect(shouldBlurAfterClick(1, 'INPUT', false)).toBe(false)
  })
})

describe('presenter copy', () => {
  it('parses, and the tablet never shows an order id or "developer"', () => {
    expect(PresenterSchema.safeParse(PRESENTER).success).toBe(true)
    expect(JSON.stringify(PRESENTER.rx)).not.toMatch(/ord-|developer|\{id\}/i)
  })
})
