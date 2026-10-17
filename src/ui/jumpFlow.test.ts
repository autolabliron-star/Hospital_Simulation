import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { DAY_MOMENTS } from '@/content/day'
import { CONFIG } from '@/sim/config'
import { createJumpState, FADE_IN_MS, FADE_OUT_MS, SETTLE_MS, targetOf, type JumpDeps, type JumpState } from './jumpFlow'

/** A hand-cranked clock: the flow only ever has one callback waiting, and `next()` runs it. */
function harness(options: { failRebuild?: boolean } = {}) {
  const calls: string[] = []
  let pending: { label: string; fn: () => void } | null = null
  let generation = 0
  const schedule = (label: string, fn: () => void) => {
    expect(pending, 'two callbacks waiting at once').toBeNull()
    pending = { label, fn }
  }
  const deps: JumpDeps = {
    rebuild: (hour) => {
      calls.push(`rebuild:${hour}`)
      if (options.failRebuild) throw new Error('boom')
      generation++
    },
    generation: () => generation,
    afterSwap: () => calls.push('afterSwap'),
    after: (ms, fn) => schedule(`after:${ms}`, fn),
    frames: (n, fn) => schedule(`frames:${n}`, fn),
    onError: () => calls.push('error'),
  }
  const store = createStore<JumpState>(createJumpState(deps))
  const next = (): string => {
    const p = pending
    expect(p, 'nothing is waiting').not.toBeNull()
    pending = null
    calls.push(p!.label)
    p!.fn()
    return p!.label
  }
  return { store, calls, next, isWaiting: () => pending !== null }
}

describe('jump flow', () => {
  it('starts idle with the menu closed', () => {
    const { store } = harness()
    expect(store.getState()).toMatchObject({ open: false, phase: 'idle', target: null, generation: 0 })
  })

  it('opens, closes and toggles the menu', () => {
    const { store } = harness()
    store.getState().toggle()
    expect(store.getState().open).toBe(true)
    store.getState().toggle()
    expect(store.getState().open).toBe(false)
    store.getState().setOpen(true)
    store.getState().setOpen(false)
    expect(store.getState().open).toBe(false)
  })

  it('fades out, rebuilds behind the cover, settles, fades in, and ends idle', () => {
    const { store, calls, next, isWaiting } = harness()
    store.getState().setOpen(true)
    expect(store.getState().jump(10.5)).toBe(true)

    // the menu closes at once and the cover starts to come in; nothing is rebuilt yet
    expect(store.getState()).toMatchObject({ open: false, phase: 'fadingOut', target: { hour: 10.5, time: '10:30', label: 'Discharges' } })
    expect(calls).toEqual([])

    expect(next()).toBe(`after:${FADE_OUT_MS}`)
    expect(store.getState().phase).toBe('fadingOut')
    expect(next()).toBe('frames:2') // two painted frames with the cover opaque, then the rebuild
    expect(calls).toContain('rebuild:10.5')
    expect(calls.indexOf('rebuild:10.5')).toBeGreaterThan(calls.indexOf('frames:2'))
    expect(store.getState()).toMatchObject({ phase: 'swapping', generation: 1 })
    expect(calls).toContain('afterSwap')

    expect(next()).toBe(`after:${SETTLE_MS}`)
    expect(store.getState().phase).toBe('swapping')
    expect(next()).toBe('frames:3')
    expect(store.getState().phase).toBe('fadingIn')
    expect(next()).toBe(`after:${FADE_IN_MS}`)
    expect(store.getState()).toMatchObject({ phase: 'idle', target: null, generation: 1 })
    expect(isWaiting()).toBe(false)
    expect(calls.filter((c) => c.startsWith('rebuild'))).toEqual(['rebuild:10.5'])
  })

  it('never lets the cover lift before the new hospital has been mounted', () => {
    const { store, next, isWaiting } = harness()
    store.getState().jump(19)
    const phases: string[] = []
    while (isWaiting()) {
      next()
      phases.push(store.getState().phase)
    }
    // 'swapping' (generation bumped, layers remounting) always comes before 'fadingIn'
    expect(phases.indexOf('swapping')).toBeLessThan(phases.indexOf('fadingIn'))
    expect(phases.at(-1)).toBe('idle')
  })

  it('ignores a second jump, and the menu, while one is running', () => {
    const { store, calls, next } = harness()
    expect(store.getState().jump(7)).toBe(true)
    expect(store.getState().jump(12)).toBe(false)
    store.getState().setOpen(true)
    expect(store.getState().open).toBe(false)
    while (store.getState().phase !== 'idle') next()
    expect(calls.filter((c) => c.startsWith('rebuild'))).toEqual(['rebuild:7'])
    // and afterwards a new jump works
    expect(store.getState().jump(12)).toBe(true)
  })

  it('keeps the old hospital and still lifts the cover when the rebuild fails', () => {
    const { store, calls, next } = harness({ failRebuild: true })
    store.getState().jump(15)
    next() // fade-out wait
    next() // frames, then the failing rebuild
    expect(calls).toContain('error')
    expect(calls).not.toContain('afterSwap')
    expect(store.getState()).toMatchObject({ phase: 'fadingIn', generation: 0 })
    next()
    expect(store.getState().phase).toBe('idle')
  })

  it('a target outside the listed moments has no label', () => {
    expect(targetOf(10.75)).toEqual({ hour: 10.75, time: '10:45', label: '' })
  })

  it('knows the label and time of every moment on the menu', () => {
    for (const hour of CONFIG.day.moments) {
      const t = targetOf(hour)
      expect(t.label).toBe(DAY_MOMENTS.find((m) => m.hour === hour)?.label)
      expect(t.time).toMatch(/^\d\d:\d\d$/)
    }
  })

  it('keeps the real-time lengths short enough for a live demo (about 1.5 s of cover in all)', () => {
    expect(FADE_OUT_MS).toBeLessThanOrEqual(500)
    expect(SETTLE_MS).toBeGreaterThanOrEqual(400) // people fade in over 0.35 s
    expect(FADE_OUT_MS + SETTLE_MS + FADE_IN_MS).toBeLessThanOrEqual(2000)
  })
})
