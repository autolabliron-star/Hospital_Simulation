/**
 * The loading card as markup, in node (react-dom/server, no browser): the words, the bar, and an Enter button that is disabled and hidden until the
 * warm-up is done. No effects run here, so the stores and the sim are not involved: the card takes its view as props.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LOADING } from '@/content/loading'
import { LoadingCard } from './LoadingScreen'
import { loadingView, type LoadingInput } from './loadingModel'

const noop = (): void => undefined
const card = (over: Partial<LoadingInput> = {}): string =>
  renderToStaticMarkup(
    createElement(LoadingCard, { view: loadingView(LOADING, { ready: false, progress: 0.4, failed: false, timedOut: false, entered: false, skipIntro: false, ...over }), onEnter: noop }),
  )

describe('the loading card', () => {
  it("shows the hospital's name and the calm line while preparing, as a dialog with a progress bar", () => {
    const out = card()
    expect(out).toContain('The Ideal Hospital')
    expect(out).toContain('Preparing the hospital…')
    expect(out).toContain('role="dialog"')
    expect(out).toContain('role="progressbar"')
    expect(out).toContain('aria-valuenow="40"')
    expect(out).toContain('scaleX(0.4)')
    expect(out).toContain('data-ready="false"')
  })

  it('has an Enter button that is disabled, out of the tab order and hidden until everything is warm', () => {
    const out = card()
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Enter<\/button>/)
    expect(out).toContain('tabindex="-1"')
    expect(out).not.toContain('loading__enter--shown')
    expect(out).toContain('aria-hidden="true"')
  })

  it('shows an enabled Enter button once ready', () => {
    const out = card({ ready: true, progress: 1 })
    expect(out).toContain('loading__enter--shown')
    expect(out).toMatch(/<button[^>]*>Enter<\/button>/)
    expect(out).not.toMatch(/<button[^>]*disabled/)
    expect(out).toContain(LOADING.status.ready)
    expect(out).toContain(LOADING.enter.hint)
    expect(out).toContain('data-ready="true"')
  })

  it('has no Enter to press with ?skipIntro=1, and fades out (and hides from assistive tech) after Enter', () => {
    expect(card({ ready: true, progress: 1, skipIntro: true })).not.toContain('loading__enter--shown')
    const leaving = card({ ready: true, progress: 1, entered: true })
    expect(leaving).toContain('loading--leaving')
    expect(leaving).toMatch(/<div class="loading loading--leaving"[^>]*aria-hidden="true"/)
  })
})
