import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LiftCoverView } from './LiftCover'

const html = (phase: Parameters<typeof LiftCoverView>[0]['phase'], caption: string | null): string => renderToStaticMarkup(createElement(LiftCoverView, { phase, caption }))

describe('the lift cover markup', () => {
  it('is hidden and silent when idle, with no caption', () => {
    const out = html('idle', null)
    expect(out).toContain('data-phase="idle"')
    expect(out).toContain('data-covered="false"')
    expect(out).toContain('aria-hidden="true"')
    expect(out).not.toContain('lc-cover__caption')
  })

  it('covers the screen while it fades out and while it holds, with the name of the level', () => {
    for (const phase of ['fadingOut', 'holding'] as const) {
      const out = html(phase, 'Level 2 · Surgery')
      expect(out, phase).toContain('data-covered="true"')
      expect(out, phase).toContain('aria-hidden="false"')
      expect(out, phase).toContain('Level 2 · Surgery')
      expect(out, phase).toContain('role="status"')
    }
  })

  it('lifts again while it fades in (the caption stays until the cover is gone)', () => {
    const out = html('fadingIn', 'Level 1 · Entrance and wards')
    expect(out).toContain('data-covered="false"')
    expect(out).toContain('Level 1 · Entrance and wards')
  })
})
