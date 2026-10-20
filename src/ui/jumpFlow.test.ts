import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { DAY_MOMENTS } from '@/content/day'
import { CONFIG } from '@/sim/config'
import type { SkipRequest } from './skip/types'
import { createJumpState, FADE_IN_MS, FADE_OUT_MS, SETTLE_MS, SKIP_SETTLE_MS, targetOf, type JumpDeps, type JumpState } from './jumpFlow'

/** A hand-cranked clock: the flow only ever has one callback waiting, and `next()` runs it. */
function harness(options: { failRebuild?: boolean; failAdvance?: boolean; busy?: () => boolean } = {}) {
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
    advance: (seconds) => {
      calls.push(`advance:${seconds}`)
      if (options.failAdvance) throw new Error('boom')
    },
    rebuildAt: (t) => {
      calls.push(`rebuildAt:${t}`)
      if (options.failRebuild) throw new Error('boom')
      generation++
    },
    generation: () => generation,
    afterSwap: () => calls.push('afterSwap'),
    afterLiveSkip: () => calls.push('afterLiveSkip'),
    after: (ms, fn) => schedule(`after:${ms}`, fn),
    frames: (n, fn) => schedule(`frames:${n}`, fn),
    onError: () => calls.push('error'),
    busy: options.busy,
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

  it('neither opens nor starts while something else owns the screen (R2: your lift ride)', () => {
    let riding = true
    const { store, isWaiting } = harness({ busy: () => riding })
    store.getState().setOpen(true)
    expect(store.getState().open).toBe(false)
    expect(store.getState().jump(10.5)).toBe(false)
    expect(store.getState().phase).toBe('idle')
    expect(isWaiting()).toBe(false)
    riding = false
    store.getState().setOpen(true)
    expect(store.getState().open).toBe(true)
    expect(store.getState().jump(10.5)).toBe(true)
  })
})

describe('skip flow (S1)', () => {
  const live: SkipRequest = { fromT: 100, toT: 190, fromHour: 7.53, toHour: 7.55, caption: '', mode: 'live' }
  const rebuild: SkipRequest = { fromT: 100, toT: 3700, fromHour: 7.53, toHour: 8.53, caption: 'Undocking', mode: 'rebuild' }

  it('a rebuilding skip: lapse, swap behind two painted frames, settle, fade in, idle', () => {
    const { store, calls, next, isWaiting } = harness()
    store.getState().setOpen(true)
    expect(store.getState().skip(rebuild)).toBe(true)
    expect(store.getState()).toMatchObject({ open: false, phase: 'lapsing', skipping: rebuild })
    expect(calls).toEqual([])

    expect(next()).toBe(`after:${CONFIG.skip.lapseMs}`)
    expect(store.getState().phase).toBe('swapping')
    expect(calls).not.toContain('rebuildAt:3700')
    expect(next()).toBe('frames:2')
    expect(calls).toContain('rebuildAt:3700')
    expect(calls.filter((c) => c.startsWith('rebuild:'))).toEqual([]) // not the Jump rebuild
    expect(calls).toContain('afterSwap')
    expect(calls).not.toContain('afterLiveSkip')
    expect(store.getState()).toMatchObject({ phase: 'swapping', generation: 1, skipping: rebuild })

    expect(next()).toBe(`after:${SKIP_SETTLE_MS}`)
    expect(next()).toBe('frames:3')
    expect(store.getState()).toMatchObject({ phase: 'fadingIn', skipping: rebuild })
    expect(next()).toBe(`after:${CONFIG.skip.fadeInMs}`)
    expect(store.getState()).toMatchObject({ phase: 'idle', skipping: null, target: null, generation: 1 })
    expect(isWaiting()).toBe(false)
  })

  it('a live skip advances the same hospital: no generation bump, no selection reset', () => {
    const { store, calls, next, isWaiting } = harness()
    expect(store.getState().skip(live)).toBe(true)
    expect(next()).toBe(`after:${CONFIG.skip.lapseMs}`)
    expect(next()).toBe('frames:2')
    expect(calls).toContain('advance:90')
    expect(calls).toContain('afterLiveSkip')
    expect(calls).not.toContain('afterSwap')
    expect(calls.some((c) => c.startsWith('rebuildAt'))).toBe(false)
    expect(store.getState().generation).toBe(0)
    expect(next()).toBe('frames:2')
    expect(store.getState().phase).toBe('fadingIn')
    expect(next()).toBe(`after:${CONFIG.skip.fadeInMs}`)
    expect(store.getState()).toMatchObject({ phase: 'idle', skipping: null, generation: 0 })
    expect(isWaiting()).toBe(false)
  })

  it('does the swap only once the veil is opaque and painted, and the cover never lifts before it', () => {
    const { store, calls, next, isWaiting } = harness()
    store.getState().skip(rebuild)
    const phases: string[] = []
    while (isWaiting()) {
      next()
      phases.push(store.getState().phase)
      if (calls.includes('rebuildAt:3700')) expect(store.getState().phase).not.toBe('lapsing')
    }
    expect(phases.indexOf('swapping')).toBeLessThan(phases.indexOf('fadingIn'))
    expect(phases.at(-1)).toBe('idle')
  })

  it('refuses while a jump or another skip is running, and during your lift ride', () => {
    const a = harness()
    a.store.getState().jump(10.5)
    expect(a.store.getState().skip(live)).toBe(false)
    expect(a.store.getState().skipping).toBeNull()

    const b = harness()
    expect(b.store.getState().skip(live)).toBe(true)
    expect(b.store.getState().skip(rebuild)).toBe(false)
    expect(b.store.getState().jump(9)).toBe(false)
    b.store.getState().setOpen(true)
    expect(b.store.getState().open).toBe(false)
    expect(b.store.getState().skipping).toBe(live)

    let riding = true
    const c = harness({ busy: () => riding })
    expect(c.store.getState().skip(live)).toBe(false)
    expect(c.store.getState().phase).toBe('idle')
    expect(c.isWaiting()).toBe(false)
    riding = false
    expect(c.store.getState().skip(live)).toBe(true)
  })

  it('shows the old hospital again when the rebuild fails', () => {
    const { store, calls, next } = harness({ failRebuild: true })
    store.getState().skip(rebuild)
    next()
    next()
    expect(calls).toContain('error')
    expect(calls).not.toContain('afterSwap')
    expect(store.getState()).toMatchObject({ phase: 'fadingIn', generation: 0, skipping: rebuild })
    expect(next()).toBe(`after:${CONFIG.skip.fadeInMs}`)
    expect(store.getState()).toMatchObject({ phase: 'idle', skipping: null })
  })

  it('shows the old hospital again when the live advance fails, and a new skip works after', () => {
    const { store, calls, next } = harness({ failAdvance: true })
    store.getState().skip(live)
    next()
    next()
    expect(calls).toContain('error')
    expect(calls).not.toContain('afterLiveSkip')
    expect(store.getState().phase).toBe('fadingIn')
    next()
    expect(store.getState().phase).toBe('idle')
    expect(store.getState().skip(live)).toBe(true)
  })

  it('a jump still takes the Jump route (rebuild, SETTLE_MS) and leaves `skipping` null', () => {
    const { store, calls, next } = harness()
    store.getState().jump(12)
    expect(store.getState().skipping).toBeNull()
    next()
    next()
    expect(calls).toContain('rebuild:12')
    expect(next()).toBe(`after:${SETTLE_MS}`)
  })

  it('keeps a skip short enough for a live demo (about 1 s of cover)', () => {
    expect(CONFIG.skip.lapseMs + CONFIG.skip.fadeInMs).toBeLessThanOrEqual(1500)
  })
})
