import { afterEach, describe, expect, it } from 'vitest'
import {
  FramePacer,
  GameClock,
  MAX_FRAME_SECONDS,
  PowerMachine,
  activeNow,
  clampFrameDelta,
  frameCap,
  notePaused,
  pauseReason,
  presentFromSearch,
  resetActiveClock,
  resolvePower,
  usePower,
  usePresent,
  type PowerDecision,
  type PowerInputs,
} from './power'

describe('the frame cap', () => {
  it('is 60 when plugged in, and 30 on battery in normal mode', () => {
    expect(frameCap(false, false, false)).toBe(60)
    expect(frameCap(true, false, false)).toBe(30)
  })

  it('is 30 on the loading screen, in every mode', () => {
    expect(frameCap(false, false, true)).toBe(30)
    expect(frameCap(true, false, true)).toBe(30)
    expect(frameCap(false, true, true)).toBe(30)
    expect(frameCap(true, true, true)).toBe(30)
  })

  it('holds 60 on battery in presentation mode', () => {
    expect(frameCap(true, true, false)).toBe(60)
    expect(frameCap(false, true, false)).toBe(60)
  })
})

describe('when the demo pauses', () => {
  it('pauses a hidden tab, in every mode', () => {
    expect(pauseReason(true, true, false)).toBe('hidden')
    expect(pauseReason(true, false, false)).toBe('hidden')
    expect(pauseReason(true, true, true)).toBe('hidden')
    expect(pauseReason(true, false, true)).toBe('hidden')
  })

  it('pauses a blurred window in normal mode only', () => {
    expect(pauseReason(false, false, false)).toBe('background')
    expect(pauseReason(false, false, true)).toBe(null)
    expect(pauseReason(false, true, false)).toBe(null)
    expect(pauseReason(false, true, true)).toBe(null)
  })

  it('resolves every input to one decision', () => {
    const base = { hidden: false, focused: true, present: false, onBattery: false, loading: false }
    expect(resolvePower(base)).toEqual({ paused: false, reason: null, fps: 60, onBattery: false })
    expect(resolvePower({ ...base, focused: false })).toEqual({ paused: true, reason: 'background', fps: 60, onBattery: false })
    expect(resolvePower({ ...base, onBattery: true })).toEqual({ paused: false, reason: null, fps: 30, onBattery: true })
    expect(resolvePower({ ...base, onBattery: true, present: true, focused: false })).toEqual({ paused: false, reason: null, fps: 60, onBattery: true })
    expect(resolvePower({ ...base, hidden: true, present: true })).toEqual({ paused: true, reason: 'hidden', fps: 60, onBattery: false })
    expect(resolvePower({ ...base, loading: true, present: true })).toMatchObject({ paused: false, fps: 30 })
  })
})

describe('the power state machine', () => {
  function watch(initial: Partial<PowerInputs> = {}) {
    const changes: PowerDecision[] = []
    const machine = new PowerMachine(initial, (next) => changes.push(next))
    return { machine, changes }
  }

  it('starts from its inputs, without announcing anything', () => {
    const { machine, changes } = watch({ loading: true })
    expect(machine.decision).toEqual({ paused: false, reason: null, fps: 30, onBattery: false })
    expect(changes).toEqual([])
  })

  it('walks the normal-mode day: loading, playing, blur, focus, hidden, visible, unplugged', () => {
    const { machine, changes } = watch({ loading: true })
    machine.set({ loading: false })
    expect(machine.decision.fps).toBe(60)
    machine.set({ focused: false })
    expect(machine.decision).toMatchObject({ paused: true, reason: 'background' })
    machine.set({ focused: true })
    expect(machine.decision).toMatchObject({ paused: false, reason: null })
    machine.set({ hidden: true })
    expect(machine.decision).toMatchObject({ paused: true, reason: 'hidden' })
    machine.set({ hidden: false })
    expect(machine.decision).toMatchObject({ paused: false, fps: 60 })
    machine.set({ onBattery: true })
    expect(machine.decision).toMatchObject({ paused: false, fps: 30, onBattery: true })
    machine.set({ onBattery: false })
    expect(machine.decision.fps).toBe(60)
    expect(changes).toHaveLength(7)
  })

  it('announces only real changes', () => {
    const { machine, changes } = watch()
    machine.set({ focused: true })
    machine.set({ hidden: false })
    machine.set({ present: false })
    expect(changes).toEqual([])
    machine.set({ present: true }) // nothing a viewer could see: still playing at 60
    expect(changes).toEqual([])
    machine.set({ onBattery: true })
    expect(changes).toHaveLength(1) // battery is reported even though the cap stays 60 in presentation mode
    expect(changes[0]).toMatchObject({ fps: 60, onBattery: true })
  })

  it('presentation mode ignores blur and still pauses when hidden', () => {
    const { machine } = watch({ present: true })
    machine.set({ focused: false }) // the meeting window took the focus
    expect(machine.decision).toMatchObject({ paused: false, reason: null })
    machine.set({ hidden: true })
    expect(machine.decision).toMatchObject({ paused: true, reason: 'hidden' })
    machine.set({ hidden: false })
    expect(machine.decision).toMatchObject({ paused: false, reason: null }) // still blurred, still playing
  })

  it('presentation mode keeps 60 on battery; switching it off at run time drops to 30 and pauses a blurred window', () => {
    const { machine } = watch({ present: true, onBattery: true, focused: false })
    expect(machine.decision).toEqual({ paused: false, reason: null, fps: 60, onBattery: true })
    machine.set({ present: false })
    expect(machine.decision).toEqual({ paused: true, reason: 'background', fps: 30, onBattery: true })
    machine.set({ present: true })
    expect(machine.decision).toEqual({ paused: false, reason: null, fps: 60, onBattery: true })
  })

  it('drives the usePower store the way PowerLoop wires it', () => {
    const machine = new PowerMachine({ present: true }, (next) => usePower.getState().set(next))
    usePower.getState().set(machine.decision)
    machine.set({ focused: false })
    expect(usePower.getState().paused).toBe(false)
    machine.set({ hidden: true })
    expect(usePower.getState().paused).toBe(true)
    expect(usePower.getState().reason).toBe('hidden')
    machine.set({ hidden: false })
    expect(usePower.getState().paused).toBe(false)
    resetActiveClock()
  })
})

describe('the presentation flag', () => {
  it('reads ?present=1 (and true), and nothing else', () => {
    expect(presentFromSearch('?present=1')).toBe(true)
    expect(presentFromSearch('?seed=7&present=1&probe=1')).toBe(true)
    expect(presentFromSearch('?present=true')).toBe(true)
    expect(presentFromSearch('?present=0')).toBe(false)
    expect(presentFromSearch('?present=')).toBe(false)
    expect(presentFromSearch('?probe=1')).toBe(false)
    expect(presentFromSearch('')).toBe(false)
  })

  it('has a store that starts off in node and can be switched', () => {
    expect(usePresent.getState().on).toBe(false)
    usePresent.getState().setOn(true)
    expect(usePresent.getState().on).toBe(true)
    usePresent.getState().toggle()
    expect(usePresent.getState().on).toBe(false)
  })
})

describe('the frame-time clamp', () => {
  it('passes a normal frame, and caps a hitch at 0.1 s', () => {
    expect(clampFrameDelta(1 / 60)).toBeCloseTo(1 / 60, 9)
    expect(clampFrameDelta(0.05)).toBe(0.05)
    expect(clampFrameDelta(0.5)).toBe(MAX_FRAME_SECONDS)
    expect(clampFrameDelta(3600)).toBe(MAX_FRAME_SECONDS)
    expect(MAX_FRAME_SECONDS).toBe(0.1)
  })

  it('never goes negative or non-numeric', () => {
    expect(clampFrameDelta(0)).toBe(0)
    expect(clampFrameDelta(-1)).toBe(0)
    expect(clampFrameDelta(Number.NaN)).toBe(0)
    expect(clampFrameDelta(Number.POSITIVE_INFINITY)).toBe(MAX_FRAME_SECONDS)
  })
})

describe('the game clock', () => {
  it('adds one frame at the cap on its first tick, then the real gaps', () => {
    const clock = new GameClock()
    expect(clock.tick(10_000, 60)).toBeCloseTo(1 / 60, 9)
    expect(clock.tick(10_016.5, 60)).toBeCloseTo(1 / 60 + 0.0165, 9)
    const c30 = new GameClock()
    expect(c30.tick(500, 30)).toBeCloseTo(1 / 30, 9)
  })

  it('clamps a hitch: a 400 ms stall adds 0.1 s', () => {
    const clock = new GameClock()
    clock.tick(1000, 60)
    const before = clock.time
    expect(clock.tick(1400, 60) - before).toBeCloseTo(MAX_FRAME_SECONDS, 9)
  })

  it('does not fast-forward across a pause: an hour in another window adds one frame', () => {
    const clock = new GameClock()
    let t = 1000
    for (let i = 0; i < 60; i++) clock.tick((t += 1000 / 60), 60) // a second of play
    const beforePause = clock.time
    expect(beforePause).toBeCloseTo(1, 2) // the first tick is one frame, then 59 real gaps
    clock.reset() // PowerLoop does this the moment it pauses
    t += 3_600_000 // an hour away
    const after = clock.tick(t, 60)
    expect(after - beforePause).toBeCloseTo(1 / 60, 9)
    expect(clock.tick(t + 16.7, 60) - after).toBeCloseTo(0.0167, 9)
  })

  it('even without the reset, the clamp stops an hour from fast-forwarding the simulation', () => {
    const clock = new GameClock()
    clock.tick(1000, 60)
    const before = clock.time
    expect(clock.tick(1000 + 3_600_000, 60) - before).toBeLessThanOrEqual(MAX_FRAME_SECONDS)
  })

  it('never runs backwards', () => {
    const clock = new GameClock()
    clock.tick(5000, 60)
    const t = clock.time
    expect(clock.tick(4000, 60)).toBe(t) // a timestamp that went back adds nothing
    expect(clock.time).toBe(t)
  })
})

describe('the paused clock', () => {
  afterEach(() => resetActiveClock())

  it('stands still while paused and carries on from where it stopped', () => {
    resetActiveClock()
    expect(activeNow(1000)).toBe(1000)
    notePaused(true, 1500)
    expect(activeNow(1500)).toBe(1500)
    expect(activeNow(61_500)).toBe(1500) // a minute in another window counts for nothing
    notePaused(false, 61_500)
    expect(activeNow(61_500)).toBe(1500)
    expect(activeNow(62_000)).toBe(2000)
  })

  it('adds up several pauses and ignores a repeated pause or resume', () => {
    resetActiveClock()
    notePaused(true, 100)
    notePaused(true, 400) // already paused: the first moment counts
    notePaused(false, 1100) // 1000 ms paused
    notePaused(false, 1200)
    notePaused(true, 2000)
    notePaused(false, 2500) // 500 ms more
    expect(activeNow(3000)).toBe(3000 - 1500)
  })

  it('usePower.set keeps the clock in step with the paused flag', () => {
    resetActiveClock()
    usePower.getState().set({ paused: true })
    const frozen = activeNow()
    expect(activeNow(performance.now() + 5000)).toBe(frozen)
    usePower.getState().set({ paused: false })
    usePower.getState().set({ fps: 60 })
  })
})

/** Feed a display of `hz` for `seconds` (with a little timestamp jitter) and return when frames were drawn. */
function simulate(hz: number, fps: number, seconds: number, jitter = 0.3, pacer = new FramePacer(), startAt = 1000): number[] {
  const drawn: number[] = []
  const period = 1000 / hz
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  for (let t = startAt, i = 0; t < startAt + seconds * 1000; t += period, i++) {
    const now = t + rand() * jitter
    if (pacer.accept(now, fps)) drawn.push(now)
  }
  return drawn
}

function stats(times: number[], skip = 3000) {
  const t = times.filter((x) => x > 1000 + skip)
  const gaps = t.slice(1).map((x, i) => x - t[i])
  const span = t[t.length - 1] - t[0]
  return { fps: ((t.length - 1) / span) * 1000, worst: Math.max(...gaps), best: Math.min(...gaps) }
}

describe('the frame pacer', () => {
  it('draws every frame of a 60 Hz display at a 60 cap, and every second one at a 30 cap', () => {
    expect(stats(simulate(60, 60, 10)).fps).toBeCloseTo(60, 0)
    expect(stats(simulate(60, 30, 10)).fps).toBeCloseTo(30, 0)
  })

  it('draws every second frame of a 120 Hz display (a MacBook Pro) at a 60 cap, evenly', () => {
    const s = stats(simulate(120, 60, 10))
    expect(s.fps).toBeCloseTo(60, 0)
    expect(s.worst - s.best).toBeLessThan(1.5)
  })

  it('keeps 144 Hz and 165 Hz even (every second frame) instead of drawing 21 ms apart', () => {
    for (const hz of [144, 165]) {
      const s = stats(simulate(hz, 60, 10))
      expect(s.fps, `${hz} Hz`).toBeGreaterThan(60)
      expect(s.fps, `${hz} Hz`).toBeLessThan(90)
      expect(s.worst - s.best, `${hz} Hz`).toBeLessThan(1.5)
    }
    expect(stats(simulate(240, 60, 10)).fps).toBeCloseTo(60, 0)
    expect(stats(simulate(144, 30, 10)).fps).toBeGreaterThan(28)
  })

  it('never runs a slower display (75 or 90 Hz) below its own rate by skipping frames unevenly', () => {
    expect(stats(simulate(75, 60, 10)).fps).toBeCloseTo(75, 0)
    expect(stats(simulate(90, 60, 10)).fps).toBeCloseTo(90, 0)
  })

  it('draws the first frames while it is still learning, at about the cap', () => {
    const drawn = simulate(144, 60, 1.0)
    expect(drawn.length).toBeGreaterThan(30)
    expect(drawn.length).toBeLessThan(75)
  })

  it('draws the frame right after a pause at once, and ignores the gap across it', () => {
    const pacer = new FramePacer()
    simulate(120, 60, 4, 0.3, pacer)
    pacer.reset()
    expect(pacer.accept(500_000, 60)).toBe(true)
    // a minute away did not teach it a 60 second refresh period
    const s = stats(simulate(120, 60, 6, 0.3, pacer, 500_016))
    expect(s.fps).toBeCloseTo(60, 0)
  })

  it('follows a change of cap at once (the loading screen is 30, Enter makes it 60)', () => {
    const pacer = new FramePacer()
    simulate(120, 30, 4, 0.3, pacer)
    const after = simulate(120, 60, 3, 0.3, pacer, 5000)
    expect(stats(after, 500).fps).toBeCloseTo(60, 0)
  })

  it('does not lose a tick when a frame takes longer than one display frame', () => {
    // 120 Hz display, 60 cap, each drawn frame costs 12 ms of main thread: ticks that fall inside the work arrive late
    const pacer = new FramePacer()
    const period = 1000 / 120
    const drawn: number[] = []
    let busyUntil = 0
    for (let v = 1000; v < 12_000; v += period) {
      if (v < busyUntil) continue // the callback could not run: the next one is delivered at a later vsync
      if (pacer.accept(v, 60)) {
        drawn.push(v)
        busyUntil = v + 12
      }
    }
    const s = stats(drawn)
    expect(s.fps).toBeGreaterThan(55)
    expect(s.fps).toBeLessThan(62)
  })

  it('stays even when a few frames are dropped', () => {
    const pacer = new FramePacer()
    const drawn: number[] = []
    const period = 1000 / 120
    for (let t = 1000, i = 0; t < 12_000; t += period, i++) {
      if (i % 97 === 5) t += period * 3 // a hitch
      if (pacer.accept(t, 60)) drawn.push(t)
    }
    expect(stats(drawn).fps).toBeGreaterThan(55)
    expect(stats(drawn).fps).toBeLessThan(62)
  })

  it('remembers the fastest refresh period it has seen, so a slow stretch does not look like a slow display', () => {
    const pacer = new FramePacer()
    expect(pacer.refreshMs).toBe(0)
    simulate(120, 60, 3, 0.2, pacer)
    expect(pacer.refreshMs).toBeGreaterThan(8.0)
    expect(pacer.refreshMs).toBeLessThan(8.7)
    // the GPU falls behind: the browser delivers every third vsync for a while (25 ms gaps)
    const slow = simulate(40, 60, 6, 0.2, pacer, 4000)
    expect(slow.length).toBeGreaterThan(10)
    expect(pacer.period).toBeGreaterThan(20)
    expect(pacer.refreshMs).toBeLessThan(8.7) // the display is still the 120 Hz one
  })

  it('reads a throttled page (Energy Saver, 30 fps) as a 33 ms display', () => {
    const pacer = new FramePacer()
    simulate(30, 60, 6, 0.3, pacer)
    expect(pacer.refreshMs).toBeGreaterThan(32)
    expect(pacer.refreshMs).toBeLessThan(34.5)
  })

  it('learns the refresh period as the median gap, ignoring the odd dropped frame', () => {
    const pacer = new FramePacer()
    expect(pacer.period).toBe(0) // nothing learned yet
    simulate(120, 60, 2, 0.2, pacer)
    expect(pacer.period).toBeGreaterThan(8.0)
    expect(pacer.period).toBeLessThan(8.7)
  })
})

describe('a whole session through the pieces', () => {
  it('plays, loses focus in presentation mode, hides, comes back, and never fast-forwards', () => {
    const machine = new PowerMachine({ present: true, loading: true }, (next) => usePower.getState().set(next))
    usePower.getState().set(machine.decision)
    const clock = new GameClock()
    const pacer = new FramePacer()
    let now = 1000
    let drawn = 0
    const run = (seconds: number) => {
      const end = now + seconds * 1000
      for (; now < end; now += 1000 / 120) {
        const power = usePower.getState()
        if (power.paused) {
          clock.reset()
          pacer.reset()
          continue
        }
        if (pacer.accept(now, power.fps)) {
          clock.tick(now, power.fps)
          drawn++
        }
      }
    }
    expect(usePower.getState().fps).toBe(30)
    run(2)
    machine.set({ loading: false }) // Enter
    run(5)
    const afterPlay = clock.time
    machine.set({ focused: false }) // the meeting window took the focus: the picture keeps moving
    run(5)
    expect(clock.time - afterPlay).toBeGreaterThan(4.5)
    const beforeHidden = clock.time
    machine.set({ hidden: true })
    run(0.5)
    now += 3_600_000 // an hour with the tab hidden
    machine.set({ hidden: false })
    run(1)
    // the hour added nothing: a second of play after the pause is about a second
    expect(clock.time - beforeHidden).toBeLessThan(1.2)
    expect(drawn).toBeGreaterThan(100)
    resetActiveClock()
  })
})
