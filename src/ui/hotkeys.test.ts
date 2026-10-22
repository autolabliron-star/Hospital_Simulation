import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYMAP } from '@/sim/types'
import { PRESENT_KEY, PRESENT_NEXT_KEY } from './present/presentation.store'
import { hotkeyAllowed, type HotkeyContext } from './hotkeys'
import { REALISM_KEY } from './walk/realism.store'

const km = DEFAULT_KEYMAP
const base: HotkeyContext = { entered: true, presenting: false, menuOpen: false, typing: false }
const ctx = (over: Partial<HotkeyContext> = {}): HotkeyContext => ({ ...base, ...over })

const UI_KEYS = [km.prescribe, km.jump, km.cleanScreen, km.goTo, km.skip, REALISM_KEY]
const TIME_KEYS = [km.pause, km.speed1, km.speed2, km.speed4, km.speed10, km.speed30]
const PRESENTER_KEYS = [PRESENT_KEY, PRESENT_NEXT_KEY]

describe('the keymap entries the HUD and the presenter share', () => {
  it('match the keys the stores export', () => {
    expect(km.realism).toBe(REALISM_KEY)
    expect(km.present).toBe(PRESENT_KEY)
    expect(km.presentNext).toBe(PRESENT_NEXT_KEY)
  })
})

describe('hotkeyAllowed: the table', () => {
  it('lets every key through in the overview or walk mode once the day has started', () => {
    for (const code of [...UI_KEYS, ...TIME_KEYS, ...PRESENTER_KEYS, km.mute, km.overview]) expect(hotkeyAllowed(code, ctx()), code).toBe(true)
  })

  it('hears nothing before Enter except M and Esc (F-04)', () => {
    const loading = ctx({ entered: false })
    for (const code of [...UI_KEYS, ...TIME_KEYS, ...PRESENTER_KEYS]) expect(hotkeyAllowed(code, loading), code).toBe(false)
    expect(hotkeyAllowed(km.mute, loading)).toBe(true)
    expect(hotkeyAllowed(km.overview, loading)).toBe(true)
  })

  it('in presentation mode hears no game-UI key, but M, Esc, C, N, Space and the speeds (F-07)', () => {
    const presenting = ctx({ presenting: true })
    for (const code of UI_KEYS) expect(hotkeyAllowed(code, presenting), code).toBe(false)
    for (const code of [...TIME_KEYS, ...PRESENTER_KEYS, km.mute, km.overview]) expect(hotkeyAllowed(code, presenting), code).toBe(true)
  })

  it('under an open menu hears no game-UI key (no stacking), but the clock, M, C and Esc still work', () => {
    const menu = ctx({ menuOpen: true })
    for (const code of UI_KEYS) expect(hotkeyAllowed(code, menu), code).toBe(false)
    for (const code of [...TIME_KEYS, ...PRESENTER_KEYS, km.mute, km.overview]) expect(hotkeyAllowed(code, menu), code).toBe(true)
  })

  it('while typing hears nothing but Esc (a field keeps its letters, M included)', () => {
    const typing = ctx({ typing: true })
    for (const code of [...UI_KEYS, ...TIME_KEYS, ...PRESENTER_KEYS, km.mute]) expect(hotkeyAllowed(code, typing), code).toBe(false)
    expect(hotkeyAllowed(km.overview, typing)).toBe(true)
  })

  it('M is heard in every mode, with or without the HUD, menus and loading screen', () => {
    for (const entered of [true, false])
      for (const presenting of [true, false])
        for (const menuOpen of [true, false]) expect(hotkeyAllowed(km.mute, { entered, presenting, menuOpen, typing: false })).toBe(true)
  })
})
