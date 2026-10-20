/** The skip row and the walk chip as markup, in node (react-dom/server): what they say and when they rest or vanish. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SIM_SPEEDS } from '@/sim/types'
import { HudView } from '../Hud'
import { SkipChipView } from './SkipChip'
import { SkipRowView } from './SkipControl'
import type { SkipRowModel } from './skipModel'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)
const noop = (): void => undefined

const plain: SkipRowModel = { steps: [{ label: '+15 min' }, { label: '+1 h' }], context: null }
const withCtx: SkipRowModel = { ...plain, context: { label: 'Skip to undocking · 10:12', kind: 'surgery' } }

describe('the skip row', () => {
  it('shows both steps and no context button on a plain view', () => {
    const out = html(createElement(SkipRowView, { model: plain, busy: false, onSkip: noop }))
    expect(out).toContain('+15 min')
    expect(out).toContain('+1 h')
    expect(out).toContain('(])')
    expect(out).toContain('(Shift+])')
    expect(out).not.toContain('hud-skip__ctx')
  })
  it('puts the context button in, and gives Shift+] to it rather than to +1 h', () => {
    const out = html(createElement(SkipRowView, { model: withCtx, busy: false, onSkip: noop }))
    expect(out).toContain('Skip to undocking · 10:12')
    expect(out).toContain('hud-skip__ctx')
    expect(out).not.toContain('Skip ahead +1 h (Shift+])')
  })
  it('rests every button while a jump is running', () => {
    const out = html(createElement(SkipRowView, { model: withCtx, busy: true, onSkip: noop }))
    expect(out.match(/disabled=""/g)?.length).toBe(3)
  })
})

describe('the walk chip', () => {
  it('is nothing without a context target, a small button with one', () => {
    expect(html(createElement(SkipChipView, { model: plain, busy: false, onSkip: noop }))).toBe('')
    const out = html(createElement(SkipChipView, { model: withCtx, busy: false, onSkip: noop }))
    expect(out).toContain('skip-chip')
    expect(out).toContain('Skip to undocking · 10:12')
  })
})

describe('the HUD', () => {
  const hud = (mode: 'overview' | 'walk'): string =>
    html(createElement(HudView, { mode, hidden: false, rxOpen: false, rxRoom: null, rxRequest: 0, onToggleRx: noop, onCloseRx: noop }))
  it('has a speed button for every speed, including 10× and 30×, and the skip row, in the overview', () => {
    const out = hud('overview')
    for (const n of SIM_SPEEDS) expect(out).toContain(`${n}×`)
    expect(out).toContain('Speed 30× (key 3)')
    expect(out).toContain('Speed 10× (key 0)')
    expect(out).toContain('hud-skip')
    expect(out).toContain('+15 min')
  })
  it('keeps walk mode quiet: no skip row (the chip appears only with a context)', () => {
    const out = hud('walk')
    expect(out).toContain('walk-clock')
    expect(out).not.toContain('hud-skip')
  })
})
