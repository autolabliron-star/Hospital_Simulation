import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SURGERY_UI } from '@/content/surgeryUi'
import { useFocus } from '@/scene/camera/focus.store'
import { useOverviewLevel } from '@/scene/levels/levelView'
import { useWalk } from '@/scene/player/state'
import type { LevelId } from '@/sim/levels'
import { DEFAULT_KEYMAP, type PlayerMode } from '@/sim/types'
import { HudView, type HudViewProps } from './Hud'
import { LevelSwitchView } from './LevelSwitch'
import { installLevelKey, type LevelKeyEnv } from './levelKey'
import { captionOf, levelKeyApplies, levelOptions, otherLevel, switchShown, type LevelKeyFacts } from './levelSwitchModel'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('the Level switch model', () => {
  it('has two options in order, with the words of the copy', () => {
    const o = levelOptions()
    expect(o.map((x) => x.level)).toEqual([1, 2])
    expect(o[0].label).toBe('Level 1')
    expect(o[1].label).toBe('Level 2 · Surgery')
    expect(o[0].label).toBe(SURGERY_UI.level.one)
    expect(o[1].label).toBe(SURGERY_UI.level.two)
    expect(captionOf(1)).toBe(SURGERY_UI.level.oneCaption)
    expect(captionOf(2)).toBe(SURGERY_UI.level.twoCaption)
  })

  it('goes to the other level', () => {
    expect(otherLevel(1)).toBe(2)
    expect(otherLevel(2)).toBe(1)
  })

  it('is on the glass only in the overview (not walking, not mid-flight)', () => {
    expect(switchShown('overview')).toBe(true)
    for (const m of ['walk', 'toWalk', 'toOverview'] as PlayerMode[]) expect(switchShown(m), m).toBe(false)
  })
})

describe('the Level switch markup', () => {
  it('is a labelled group of two toggle buttons, the shown level pressed, with its caption and the key', () => {
    const out = html(createElement(LevelSwitchView, { level: 1, onChoose: () => undefined }))
    expect(out).toContain('aria-label="Choose a level"')
    expect(out).toContain('role="group"')
    expect(out).toContain('Level 1')
    expect(out).toContain('Level 2 · Surgery')
    expect(out).toContain(SURGERY_UI.level.oneCaption)
    expect(out).not.toContain(SURGERY_UI.level.twoCaption)
    const pressed = [...out.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]])
    expect(pressed).toEqual([
      ['true', 'Level 1'],
      ['false', 'Level 2 · Surgery'],
    ])
    expect(out).toContain('>L<')
  })

  it('shows the other level pressed and its caption when Level 2 is on', () => {
    const out = html(createElement(LevelSwitchView, { level: 2, onChoose: () => undefined }))
    expect(out).toContain(SURGERY_UI.level.twoCaption)
    const pressed = [...out.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]])
    expect(pressed).toEqual([
      ['false', 'Level 1'],
      ['true', 'Level 2 · Surgery'],
    ])
  })
})

const noop = (): void => undefined
const hud = (mode: PlayerMode, over: Partial<HudViewProps> = {}): string =>
  html(createElement(HudView, { mode, hidden: false, rxOpen: false, rxRoom: null, rxRequest: 0, onToggleRx: noop, onCloseRx: noop, ...over }))

describe('the HUD', () => {
  it('shows the Level switch in the overview, under the clock card, and nowhere else', () => {
    const overview = hud('overview')
    expect(overview).toContain('hud-level')
    expect(overview.indexOf('hud-title')).toBeLessThan(overview.indexOf('hud-level'))
    for (const m of ['walk', 'toWalk', 'toOverview'] as PlayerMode[]) expect(hud(m), m).not.toContain('hud-level')
    expect(hud('overview', { hidden: true })).toBe('')
  })
})

describe('the L key', () => {
  type Listener = (e: Record<string, unknown>) => void
  /** A window that only keeps its keydown listeners. */
  function fakeWindow() {
    const listeners = new Set<Listener>()
    return {
      listeners,
      addEventListener: (_t: string, fn: Listener) => void listeners.add(fn),
      removeEventListener: (_t: string, fn: Listener) => void listeners.delete(fn),
      press(code: string, over: Record<string, unknown> = {}) {
        const e = { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...over }
        for (const l of [...listeners]) l(e)
        return e
      },
    }
  }

  function env(over: Partial<{ mode: PlayerMode; menuOpen: boolean; typing: boolean }> = {}) {
    const state = { mode: 'overview' as PlayerMode, menuOpen: false, typing: false, level: 1 as LevelId, chosen: [] as LevelId[], ...over }
    const e: LevelKeyEnv = {
      mode: () => state.mode,
      menuOpen: () => state.menuOpen,
      typing: () => state.typing,
      level: () => state.level,
      choose: (l) => {
        state.chosen.push(l)
        state.level = l
      },
    }
    return { state, e }
  }

  it('toggles the level in the overview: 1 to 2 to 1', () => {
    const w = fakeWindow()
    const { state, e } = env()
    const off = installLevelKey(w as never, e)
    const ev = w.press(DEFAULT_KEYMAP.level)
    expect(DEFAULT_KEYMAP.level).toBe('KeyL')
    expect(ev.defaultPrevented).toBe(true)
    w.press('KeyL')
    w.press('KeyL')
    expect(state.chosen).toEqual([2, 1, 2])
    off()
    expect(w.listeners.size).toBe(0)
    w.press('KeyL')
    expect(state.chosen).toEqual([2, 1, 2])
  })

  it('does nothing while walking or flying, with a menu open, while typing, with a modifier, on a repeat, or for another key', () => {
    for (const over of [{ mode: 'walk' as PlayerMode }, { mode: 'toWalk' as PlayerMode }, { mode: 'toOverview' as PlayerMode }, { menuOpen: true }, { typing: true }]) {
      const w = fakeWindow()
      const { state, e } = env(over)
      installLevelKey(w as never, e)
      w.press('KeyL')
      expect(state.chosen, JSON.stringify(over)).toEqual([])
    }
    const w = fakeWindow()
    const { state, e } = env()
    installLevelKey(w as never, e)
    w.press('KeyL', { ctrlKey: true })
    w.press('KeyL', { metaKey: true })
    w.press('KeyL', { altKey: true })
    w.press('KeyL', { repeat: true })
    w.press('KeyG')
    w.press('KeyM')
    expect(state.chosen).toEqual([])
  })

  it('is a pure rule: the key, the overview, no field, no menu', () => {
    const base: LevelKeyFacts = { code: 'KeyL', repeat: false, modifier: false, typing: false, mode: 'overview', menuOpen: false }
    expect(levelKeyApplies(base, 'KeyL')).toBe(true)
    expect(levelKeyApplies({ ...base, code: 'KeyK' }, 'KeyL')).toBe(false)
    expect(levelKeyApplies({ ...base, mode: 'walk' }, 'KeyL')).toBe(false)
  })
})

describe('the real stores behind it (the overview level and the room panel)', () => {
  beforeEach(() => {
    useOverviewLevel.setState({ level: 1 })
    useFocus.setState({ area: null })
  })
  afterEach(() => {
    useOverviewLevel.setState({ level: 1 })
    useFocus.setState({ area: null })
  })

  it('drives useOverviewLevel through chooseLevel (the switch buttons and the key share it)', async () => {
    const { chooseLevel } = await import('@/scene/camera/roomFocus')
    chooseLevel(2)
    expect(useOverviewLevel.getState().level).toBe(2)
    chooseLevel(1)
    expect(useOverviewLevel.getState().level).toBe(1)
  })

  it('the L key, on the real stores: it flips the overview level in the overview, and leaves it alone while walking', () => {
    const listeners = new Set<(e: unknown) => void>()
    const win = { addEventListener: (_t: string, fn: (e: unknown) => void) => void listeners.add(fn), removeEventListener: (_t: string, fn: (e: unknown) => void) => void listeners.delete(fn) }
    const off = installLevelKey(win as never)
    const press = (): void => {
      for (const l of [...listeners]) l({ code: 'KeyL', repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, preventDefault() {} })
    }
    useWalk.setState({ mode: 'overview' })
    press()
    expect(useOverviewLevel.getState().level).toBe(2)
    press()
    expect(useOverviewLevel.getState().level).toBe(1)
    useWalk.setState({ mode: 'walk' })
    press()
    expect(useOverviewLevel.getState().level).toBe(1)
    off()
  })
})
