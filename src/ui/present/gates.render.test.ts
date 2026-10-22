import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hudIsHidden } from '../Hud'
import { realismActive } from '../walk/realism.store'
import { CloakedView, HiddenView } from './PresentationControls'
import { usePresentation } from './presentation.store'

const child = createElement('p', { className: 'game-ui' }, 'menu')

describe('the gates the game UI goes through', () => {
  it('Hidden renders its children normally and nothing while presenting', () => {
    expect(renderToStaticMarkup(createElement(HiddenView, { on: false }, child))).toContain('game-ui')
    expect(renderToStaticMarkup(createElement(HiddenView, { on: true }, child))).toBe('')
  })
  it('Cloaked keeps its children mounted but display:none while presenting (and a box-less wrapper otherwise)', () => {
    expect(renderToStaticMarkup(createElement(CloakedView, { on: false }, child))).toContain('display:contents')
    const out = renderToStaticMarkup(createElement(CloakedView, { on: true }, child))
    expect(out).toContain('game-ui')
    expect(out).toContain('display:none')
  })
})

describe('the HUD and realism while presenting', () => {
  it('the HUD is hidden by H or by presentation mode, whatever else un-hides H', () => {
    expect(hudIsHidden(false, false)).toBe(false)
    expect(hudIsHidden(true, false)).toBe(true)
    expect(hudIsHidden(false, true)).toBe(true)
    expect(hudIsHidden(true, true)).toBe(true)
  })
  it('realism is always on in the walk, so there are no emotes or bubbles; the overview keeps its own preference', () => {
    usePresentation.getState().setOn(false)
    expect(realismActive('walk')).toBe(true)
    usePresentation.getState().setOn(true)
    expect(realismActive('walk')).toBe(true)
    expect(realismActive('overview')).toBe(false)
    usePresentation.getState().setOn(false)
  })
})
