import { beforeEach, describe, expect, it } from 'vitest'
import { presentActive, presentViewFromSearch, usePresentation } from './presentation.store'

describe('?view=present', () => {
  it('is on only for view=present', () => {
    expect(presentViewFromSearch('')).toBe(false)
    expect(presentViewFromSearch('?view=present')).toBe(true)
    expect(presentViewFromSearch('?seed=3&view=present&building=model')).toBe(true)
    expect(presentViewFromSearch('?view=overview')).toBe(false)
    expect(presentViewFromSearch('?view=PRESENT')).toBe(false)
  })
  it('does not collide with ?present=1 (the power flag)', () => {
    expect(presentViewFromSearch('?present=1')).toBe(false)
  })
})

describe('the presentation store', () => {
  beforeEach(() => usePresentation.getState().setOn(false))
  it('starts off in node, toggles and reports through presentActive()', () => {
    expect(presentActive()).toBe(false)
    usePresentation.getState().toggle()
    expect(presentActive()).toBe(true)
    usePresentation.getState().setOn(false)
    expect(presentActive()).toBe(false)
  })
})
