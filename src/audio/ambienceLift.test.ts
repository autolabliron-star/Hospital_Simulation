/**
 * The lift ding of your ride (R2): the cover asks for it with `cueLiftDing`, and the ambience engine plays it on its own rig, under the mute. A Web Audio stand-in that
 * records the pitch of every bell that rings (the ding is 1318.5 Hz with an octave partial at 2637 Hz, the pod chime 880 and 1174.66 Hz).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AmbienceEngine, cueLiftDing, liftDingCues, type AmbienceInputs, type AmbiencePlayer, type AmbienceStride } from './ambience'
import { LIFTS } from '@/sim/places'

const DING_HZ = 1318.5
const DING_PARTIAL_HZ = 2637

describe('the lift ding cue', () => {
  const realContext = (globalThis as { AudioContext?: unknown }).AudioContext
  let now = 0
  let bells: number[] = []

  const param = (record?: (v: number) => void) => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime(v: number) {
      record?.(v)
    },
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  })
  const node = (extra: Record<string, unknown> = {}) => ({ connect() {}, disconnect() {}, start() {}, ...extra })

  class FakeContext {
    sampleRate = 48000
    state = 'running'
    destination = {}
    get currentTime(): number {
      return now
    }
    createGain() {
      return node({ gain: param() })
    }
    createBiquadFilter() {
      return node({ type: '', Q: param(), frequency: param() })
    }
    createBufferSource() {
      return node({ buffer: null, loop: false })
    }
    createBuffer(_channels: number, len: number) {
      return { getChannelData: () => new Float32Array(len) }
    }
    // a bell: every `setValueAtTime` on an oscillator's pitch is a ring
    createOscillator() {
      return node({ type: '', frequency: param((hz) => bells.push(hz)) })
    }
    resume() {
      return Promise.resolve()
    }
    suspend() {
      return Promise.resolve()
    }
    close() {
      return Promise.resolve()
    }
  }

  beforeEach(() => {
    now = 0
    bells = []
    vi.useFakeTimers()
    ;(globalThis as { AudioContext?: unknown }).AudioContext = FakeContext
  })
  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as { AudioContext?: unknown }).AudioContext = realContext
  })

  function advance(ms: number): void {
    for (let t = 0; t < ms; t += 50) {
      now += 0.05
      vi.advanceTimersByTime(50)
    }
  }

  const stride: AmbienceStride = { steps: 0, foot: 0, strikeSpeed: 0, run: 0 }
  const lifts = [LIFTS.A[1].stretcher.at, LIFTS.A[2].stretcher.at, LIFTS.B[2].stretcher.at]

  function engine(state: { player: AmbiencePlayer; muted?: boolean }) {
    const inputs: AmbienceInputs = {
      player: () => state.player,
      stride: () => stride,
      pods: () => [],
      area: () => null,
      muted: () => state.muted ?? false,
      unlocked: () => true,
      hidden: () => false,
      autoDoors: [],
      lifts,
    }
    const e = new AmbienceEngine(inputs)
    e.start()
    return e
  }

  const count = (hz: number): number => bells.filter((b) => b === hz).length
  const FAR_AWAY: AmbiencePlayer = { x: -20, z: 0, speed: 0, mode: 'walk' }

  it('counts the cues, and asking with no engine running is harmless', () => {
    const n = liftDingCues()
    cueLiftDing()
    cueLiftDing()
    expect(liftDingCues()).toBe(n + 2)
  })

  it('rings one ding, with its octave partial, for one cue', () => {
    const state = { player: FAR_AWAY }
    const e = engine(state)
    advance(300)
    expect(bells).toEqual([])
    cueLiftDing()
    advance(100)
    expect(count(DING_HZ)).toBe(1)
    expect(count(DING_PARTIAL_HZ)).toBe(1)
    advance(2000)
    expect(count(DING_HZ)).toBe(1)
    e.stop()
  })

  it('rings once per cue, however many ticks pass', () => {
    const e = engine({ player: FAR_AWAY })
    advance(200)
    cueLiftDing()
    advance(50)
    cueLiftDing()
    advance(500)
    expect(count(DING_HZ)).toBe(2)
    e.stop()
  })

  it('does not ring again for the lobby you arrive in: the walk-in ding is used up by the ride\'s own', () => {
    const state = { player: FAR_AWAY }
    const e = engine(state)
    advance(300)
    // the ride: the cue, and you stand in the level-2 lobby (a few metres from its lift spot) at the same moment
    cueLiftDing()
    const w = LIFTS.A[2].walkers[0]
    state.player = { x: w.x, z: w.z, speed: 0, mode: 'walk' }
    advance(300)
    expect(count(DING_HZ)).toBe(1)
    e.stop()
  })

  it('still rings for a lobby you walk into, as it did, on both levels (the level-2 lifts are in the engine\'s lift list)', () => {
    for (const spot of [LIFTS.A[1].stretcher.at, LIFTS.B[2].stretcher.at]) {
      bells = []
      const e = engine({ player: { x: spot.x - 4, z: spot.z, speed: 1, mode: 'walk' } })
      advance(300)
      expect(count(DING_HZ), `${spot.x}`).toBe(0)
      e.stop()
      bells = []
      const near = engine({ player: { x: spot.x, z: spot.z, speed: 0, mode: 'walk' } })
      advance(300)
      expect(count(DING_HZ), `${spot.x}`).toBe(1)
      near.stop()
    }
  })

  it('is silent when muted, and a cue asked for while muted is dropped, not played late when the sound comes back', () => {
    const state = { player: FAR_AWAY, muted: true }
    const e = engine(state)
    advance(300)
    cueLiftDing()
    advance(300)
    expect(bells).toEqual([])
    state.muted = false
    advance(600)
    expect(count(DING_HZ)).toBe(0)
    cueLiftDing()
    advance(100)
    expect(count(DING_HZ)).toBe(1)
    e.stop()
  })

  it('is silent in the overview, too (you ride only while you walk)', () => {
    const e = engine({ player: { ...FAR_AWAY, mode: 'overview' } })
    advance(300)
    cueLiftDing()
    advance(300)
    expect(bells).toEqual([])
    e.stop()
  })
})
