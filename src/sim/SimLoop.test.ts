import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { maxStepsPerFrame, SimLoop } from './SimLoop'
import type { Simulation } from './Simulation'

const STEP = CONFIG.sim.step

function fakeSim() {
  const s = { steps: 0, alpha: -1, step: () => void s.steps++, sync: (a: number) => void (s.alpha = a) }
  return s
}
/** A clock that advances `tick` ms on every read. */
function fakeClock(tick: number) {
  const c = { t: 0, reads: 0, now: () => ((c.reads++, (c.t += tick))) }
  return c
}
function make(tick = 0) {
  const sim = fakeSim()
  const clock = fakeClock(tick)
  let published = 0
  const loop = new SimLoop(sim as unknown as Simulation, () => void published++, clock.now)
  return { sim, clock, loop, published: () => published }
}

describe('SimLoop step caps', () => {
  it('maxStepsPerFrame = max(40, ceil(speed × 2.2))', () => {
    expect([1, 2, 4, 10, 30].map(maxStepsPerFrame)).toEqual([40, 40, 40, 40, 66])
  })

  it('runs whole steps per frame at each speed, at 60 and 30 fps', () => {
    for (const [speed, fps, expected] of [
      [1, 60, 1],
      [2, 60, 2],
      [4, 60, 4],
      [10, 60, 10],
      [30, 60, 30],
      [1, 30, 2],
      [4, 30, 8],
      [10, 30, 20],
      [30, 30, 60],
    ] as const) {
      const { sim, loop } = make()
      loop.speed = speed
      // Warm up one frame, then measure the mean over 60 frames.
      for (let i = 0; i < 60; i++) loop.frame(1 / fps)
      expect(Math.abs(sim.steps - (expected * 60))).toBeLessThanOrEqual(1)
    }
  })

  it('30x at 30 fps is not capped (60 steps fit under 66)', () => {
    const { sim, loop } = make()
    loop.speed = 30
    loop.frame(1 / 30 + 1e-9)
    expect(sim.steps).toBe(60)
  })

  it('a long hitch is clamped to 0.1 s of dt, then to the step cap, and drops the leftover', () => {
    const { sim, loop } = make()
    loop.speed = 30
    loop.frame(5) // 0.1 s × 30 = 3 s = 180 steps → capped at 66
    expect(sim.steps).toBe(66)
    loop.frame(0)
    expect(sim.steps).toBe(66) // nothing left over
    expect(sim.alpha).toBe(0)
  })

  it('at 1x a hitch frame runs at most 6 steps (dt clamp) and keeps the fraction', () => {
    const { sim, loop } = make()
    loop.frame(1)
    expect(sim.steps).toBe(6)
    expect(sim.alpha).toBeGreaterThanOrEqual(0)
    expect(sim.alpha).toBeLessThan(1)
  })
})

describe('SimLoop wall-clock budget', () => {
  it('stops at the budget (checked every 4 steps) and drops the leftover', () => {
    // 1 ms per clock read: t0 read = 1, check at n=4 reads 2 (elapsed 1), n=8 → 2 ... n=24 → 6 ≥ 6.
    const { sim, loop, clock } = make(1)
    loop.speed = 30
    loop.frame(0.1) // wants 180 steps
    expect(sim.steps).toBeLessThan(66)
    expect(sim.steps % 4).toBe(0)
    expect(sim.steps).toBe(24)
    const reads = clock.reads
    loop.frame(0) // leftover was dropped: no steps
    expect(sim.steps).toBe(24)
    expect(clock.reads).toBe(reads) // no clock reads when nothing is due
  })

  it('never stops before the first steps, even if the clock is already past the budget', () => {
    const { sim, loop } = make(1000)
    loop.speed = 30
    loop.frame(0.1)
    expect(sim.steps).toBe(4)
  })

  it('normal frames never touch the budget', () => {
    const { sim, loop } = make(1000)
    loop.speed = 1
    loop.frame(STEP * 2)
    expect(sim.steps).toBe(2)
  })
})

describe('SimLoop state', () => {
  it('paused: no steps, no sync, but still publishes', () => {
    const { sim, loop, published } = make()
    loop.paused = true
    for (let i = 0; i < 30; i++) loop.frame(0.05)
    expect(sim.steps).toBe(0)
    expect(sim.alpha).toBe(-1)
    expect(published()).toBeGreaterThan(0)
  })

  it('resync drops the accumulator and publishes at once', () => {
    const { sim, loop, published } = make()
    loop.frame(STEP * 0.9) // fraction in the accumulator
    expect(sim.steps).toBe(0)
    const p = published()
    loop.resync()
    expect(published()).toBe(p + 1)
    loop.frame(STEP * 0.2) // would have completed a step without the resync
    expect(sim.steps).toBe(0)
  })

  it('replace swaps the sim and keeps speed and pause', () => {
    const { loop, published } = make()
    loop.speed = 10
    loop.paused = true
    const next = fakeSim()
    const p = published()
    loop.replace(next as unknown as Simulation)
    expect(loop.sim).toBe(next)
    expect(loop.speed).toBe(10)
    expect(loop.paused).toBe(true)
    expect(published()).toBe(p + 1)
    loop.paused = false
    loop.frame(STEP * 3.55)
    expect(next.steps).toBe(35)
  })

  it('publishes at about publishHz, not per frame', () => {
    const { loop, published } = make()
    for (let i = 0; i < 60; i++) loop.frame(1 / 60)
    expect(published()).toBeGreaterThanOrEqual(CONFIG.sim.publishHz - 1)
    expect(published()).toBeLessThanOrEqual(CONFIG.sim.publishHz + 1)
  })
})
