/** F-41: presentation mode is the show. The ladder never steps UP while it is on (it still steps down), and a deferred pixel-ratio change waits like a walk. */
import { describe, expect, it } from 'vitest'
import { DprDeferral, MAX_DEFER_MS } from './dprDefer'
import { DEFAULT_LADDER_CONFIG, MAX_LEVEL, PRESENT_DPR_CAP, QUALITY_STEPS, QualityLadder, appliedDpr, presentDpr } from './ladder'

const FRAME = 1000 / 60

/** Feed `windows` full windows of frames, one fixed (interval, work) each; returns the last action and the clock. */
function feed(ladder: QualityLadder, now: number, windows: number, interval: number, work: number): { now: number; actions: string[] } {
  const actions: string[] = []
  for (let w = 0; w < windows; w++) {
    for (let i = 0; i < DEFAULT_LADDER_CONFIG.windowFrames; i++) {
      now += interval
      const a = ladder.sample(now, interval, work, 60, 2)
      if (a) actions.push(a)
    }
  }
  return { now, actions }
}

function readyLadder(level: number): { ladder: QualityLadder; now: number } {
  const ladder = new QualityLadder({}, level)
  ladder.setReady(true, 0)
  return { ladder, now: DEFAULT_LADDER_CONFIG.readyGraceMs + 10 }
}

describe('the quality ladder while presenting', () => {
  it('control: with presentation off, a long calm run steps up', () => {
    const { ladder, now } = readyLadder(3)
    ladder.presenting = () => false
    const r = feed(ladder, now, DEFAULT_LADDER_CONFIG.upWindows + 2, FRAME, 4)
    expect(r.actions).toContain('up')
    expect(ladder.level).toBeLessThan(3)
  })

  it('never steps up while presenting, however long it stays calm', () => {
    const { ladder, now } = readyLadder(3)
    ladder.presenting = () => true
    const r = feed(ladder, now, DEFAULT_LADDER_CONFIG.upWindows * 4, FRAME, 4)
    expect(r.actions).not.toContain('up')
    expect(ladder.level).toBe(3)
  })

  it('still steps down while presenting', () => {
    const { ladder, now } = readyLadder(2)
    ladder.presenting = () => true
    const r = feed(ladder, now, 2, FRAME * 2, 4)
    expect(r.actions).toContain('down')
    expect(ladder.level).toBeGreaterThan(2)
  })

  it('the calm streak restarts when the presentation ends (no instant step up)', () => {
    const { ladder, now } = readyLadder(3)
    let on = true
    ladder.presenting = () => on
    const a = feed(ladder, now, DEFAULT_LADDER_CONFIG.upWindows * 2, FRAME, 4)
    on = false
    const b = feed(ladder, a.now, DEFAULT_LADDER_CONFIG.upWindows - 1, FRAME, 4)
    expect(b.actions).not.toContain('up')
    const c = feed(ladder, b.now, 2, FRAME, 4)
    expect(c.actions).toContain('up')
  })
})

describe('a deferred pixel-ratio change while presenting', () => {
  const still = { mode: 'overview', live: true, stillFor: 10 }

  it('waits (the camera glides) up to the usual limit, then lands', () => {
    const d = new DprDeferral(undefined, undefined, () => true)
    expect(d.decide(1.5, 1, still, 0)).toBe('wait')
    expect(d.decide(1.5, 1, still, MAX_DEFER_MS - 1)).toBe('wait')
    expect(d.decide(1.5, 1, still, MAX_DEFER_MS)).toBe('apply')
  })

  it('control: not presenting and standing still applies at once', () => {
    const d = new DprDeferral(undefined, undefined, () => false)
    expect(d.decide(1.5, 1, still, 0)).toBe('apply')
  })
})

describe('the pixel ratio while presenting', () => {
  it('is the full Retina ratio on the top rung, one notch above the walk on the others, and steps down in order', () => {
    expect(presentDpr(0, 2)).toBe(2)
    expect(presentDpr(1, 2)).toBe(1.5)
    expect(presentDpr(2, 2)).toBe(1.25)
    expect(presentDpr(3, 2)).toBe(1)
    let last = Infinity
    for (let l = 0; l <= MAX_LEVEL; l++) {
      const d = presentDpr(l, 2)
      expect(d).toBeLessThanOrEqual(last)
      expect(d).toBeGreaterThanOrEqual(appliedDpr(QUALITY_STEPS[l], 2)) // never blurrier than the walk on the same rung
      last = d
    }
  })

  it('never exceeds the display or the cap, never goes below 1', () => {
    expect(presentDpr(0, 1)).toBe(1)
    expect(presentDpr(0, 1.5)).toBe(1.5)
    expect(presentDpr(0, 3)).toBe(PRESENT_DPR_CAP)
    expect(presentDpr(0, Number.NaN)).toBe(1)
    expect(presentDpr(99, 2)).toBe(1)
  })
})
