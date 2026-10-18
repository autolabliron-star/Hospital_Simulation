import { afterEach, describe, expect, it } from 'vitest'
import { QUALITY_STEPS } from './ladder'
import { parseForcedLevel, useRenderStore } from './render.store'

const rs = useRenderStore.getState

afterEach(() => {
  rs().setLevel(0, null)
  rs().setAuto(true)
})

describe('?quality=N', () => {
  it('forces a rung, clamped to the ladder', () => {
    expect(parseForcedLevel('?quality=0')).toBe(0)
    expect(parseForcedLevel('?quality=3')).toBe(3)
    expect(parseForcedLevel('?seed=1&quality=2&probe=1')).toBe(2)
    expect(parseForcedLevel('?quality=99')).toBe(QUALITY_STEPS.length - 1)
    expect(parseForcedLevel('?quality=-2')).toBe(0)
  })

  it('ignores a missing, empty or non-numeric value', () => {
    expect(parseForcedLevel('')).toBeNull()
    expect(parseForcedLevel('?probe=1')).toBeNull()
    expect(parseForcedLevel('?quality=')).toBeNull()
    expect(parseForcedLevel('?quality=high')).toBeNull()
  })
})

describe('the render store', () => {
  it('starts at the best rung, adaptive, in node', () => {
    expect(rs().level).toBe(0)
    expect(rs().step).toBe(QUALITY_STEPS[0])
    expect(rs().auto).toBe(true)
    expect(rs().reason).toBeNull()
  })

  it('moves to a rung, keeps step in step with level, and says why', () => {
    rs().setLevel(3, 'late')
    expect(rs().level).toBe(3)
    expect(rs().step).toBe(QUALITY_STEPS[3])
    expect(rs().reason).toBe('late')
    rs().setLevel(99)
    expect(rs().level).toBe(QUALITY_STEPS.length - 1)
    expect(rs().reason).toBe('forced') // a move nobody explained came from a dev switch
  })

  it('does not publish when the rung is the same', () => {
    let publishes = 0
    const unsub = useRenderStore.subscribe(() => publishes++)
    rs().setLevel(0, 'late')
    expect(publishes).toBe(0)
    unsub()
  })

  it('holds the applied pixel ratio and the last window for the probe overlay', () => {
    rs().setApplied(1.25)
    rs().setWindow(5.5, 0.02)
    expect(rs().dpr).toBe(1.25)
    expect(rs().workP95).toBe(5.5)
    expect(rs().lateShare).toBe(0.02)
  })
})
