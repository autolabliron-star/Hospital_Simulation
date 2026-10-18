import { describe, expect, it } from 'vitest'
import { LOADING } from '@/content/loading'
import { FINISHING_FROM, GIVE_UP_MS, FADE_MS, loadingView, type LoadingInput } from './loadingModel'

const input = (over: Partial<LoadingInput> = {}): LoadingInput => ({ ready: false, progress: 0, failed: false, timedOut: false, entered: false, skipIntro: false, ...over })
const view = (over: Partial<LoadingInput> = {}) => loadingView(LOADING, input(over))

describe('the loading screen model', () => {
  it("carries the hospital's name and the calm progress line from the content file", () => {
    const v = view()
    expect(v.title).toBe(LOADING.title)
    expect(v.tagline).toBe(LOADING.tagline)
    expect(v.progressLabel).toBe(LOADING.progressLabel)
    expect(v.line).toBe('Preparing the hospital…')
    expect(v.enterLabel).toBe('Enter')
    expect(v.hint).toBe(LOADING.enter.hint)
    for (const text of [v.title, v.tagline, v.progressLabel, v.line, v.enterLabel, v.hint]) expect(text.length).toBeGreaterThan(0)
  })

  it('keeps Enter disabled and out of sight until the warm-up is done', () => {
    for (const progress of [0, 0.3, 0.84, 0.99, 1]) {
      const v = view({ progress, ready: false })
      expect(v.enterDisabled).toBe(true)
      expect(v.enterVisible).toBe(false)
    }
    const done = view({ ready: true, progress: 1 })
    expect(done.enterDisabled).toBe(false)
    expect(done.enterVisible).toBe(true)
    expect(done.line).toBe(LOADING.status.ready)
  })

  it('moves the bar with the progress, never shows 100 before it is ready, and clamps rubbish', () => {
    expect(view({ progress: 0.4 }).percent).toBe(40)
    expect(view({ progress: 1 }).percent).toBe(99)
    expect(view({ progress: 1, ready: true }).percent).toBe(100)
    expect(view({ progress: -3 }).percent).toBe(0)
    expect(view({ progress: 7 }).percent).toBe(99)
    expect(view({ progress: Number.NaN }).percent).toBe(0)
  })

  it('says "Almost ready" for the last stretch only', () => {
    expect(view({ progress: FINISHING_FROM - 0.01 }).line).toBe(LOADING.status.preparing)
    expect(view({ progress: FINISHING_FROM }).line).toBe(LOADING.status.finishing)
  })

  it('says so kindly, and still offers Enter, when the warm-up failed or ran out of time', () => {
    for (const over of [{ failed: true }, { timedOut: true }]) {
      const v = view({ ready: true, progress: 1, ...over })
      expect(v.line).toBe(LOADING.status.readyDegraded)
      expect(v.enterVisible).toBe(true)
      expect(v.enterDisabled).toBe(false)
    }
    // a failure that is not over yet does not change the calm line
    expect(view({ failed: true, progress: 0.3 }).line).toBe(LOADING.status.preparing)
  })

  it('has no button with ?skipIntro=1, and enters by itself once ready (once)', () => {
    expect(view({ skipIntro: true, progress: 0.5 })).toMatchObject({ enterVisible: false, autoEnter: false })
    expect(view({ skipIntro: true, ready: true, progress: 1 })).toMatchObject({ enterVisible: false, autoEnter: true })
    expect(view({ skipIntro: true, ready: true, progress: 1, entered: true }).autoEnter).toBe(false)
    expect(view({ skipIntro: false, ready: true, progress: 1 }).autoEnter).toBe(false)
  })

  it('fades out after Enter: the button goes, the card is leaving', () => {
    const v = view({ ready: true, progress: 1, entered: true })
    expect(v.leaving).toBe(true)
    expect(v.enterVisible).toBe(false)
    expect(view({ ready: true, progress: 1 }).leaving).toBe(false)
  })

  it('fades over about 0.4 s and gives up on a warm-up that never ends after a generous wait', () => {
    expect(FADE_MS).toBe(400)
    expect(GIVE_UP_MS).toBeGreaterThanOrEqual(20000)
  })
})
