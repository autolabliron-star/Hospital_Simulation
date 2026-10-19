import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEVEL2_FOOTPRINT } from '@/sim/levels'
import { AREAS, ROOMS, areaAt, areaById } from '@/sim/places'
import {
  AMBIENCE_MASTER,
  AmbienceEngine,
  DOOR_REACH,
  LIFT_REACH,
  POD_REACH,
  ROOM_TONES,
  STEP_BURST_MAX,
  newTrigger,
  podChimeDue,
  stepTrigger,
  stepVoice,
  strikesSince,
  toneForArea,
  type AmbienceInputs,
  type AmbiencePlayer,
  type AmbienceStride,
  type Reach,
  type RoomTone,
} from './ambience'

describe('footsteps follow the heel strikes', () => {
  it('plays one step for each increment of the strike count, and none when it did not grow', () => {
    expect(strikesSince(10, 10)).toBe(0)
    expect(strikesSince(10, 11)).toBe(1)
    expect(strikesSince(10, 12)).toBe(2)
    // a counter that went backwards (a restart) plays nothing
    expect(strikesSince(10, 3)).toBe(0)
  })

  it('never plays a burst after a long pause, a Jump or a hidden tab', () => {
    expect(strikesSince(0, 500)).toBe(STEP_BURST_MAX)
    expect(STEP_BURST_MAX).toBeLessThanOrEqual(3)
  })

  it('is soft at a standing shuffle, firmer at a walk, loudest and longest running; always audible and never over the step peak', () => {
    const still = stepVoice(0, 0)
    const walk = stepVoice(2, 0)
    const run = stepVoice(4.2, 1)
    expect(still.peak).toBeGreaterThan(0)
    expect(walk.peak).toBeGreaterThan(still.peak)
    expect(run.peak).toBeGreaterThan(walk.peak)
    expect(run.decayS).toBeGreaterThan(walk.decayS)
    expect(run.band).toBeLessThan(walk.band)
    for (const v of [0, 0.5, 1, 2, 4.2, 9]) for (const r of [0, 0.5, 1]) expect(stepVoice(v, r).peak).toBeLessThanOrEqual(0.5 + 1e-12)
    // the same loudness as the old speed-timed steps at a walk (0.45 of the envelope at 1.5 m/s): the mix does not change
    expect(stepVoice(1.5, 0).peak).toBeGreaterThan(0.38)
    expect(stepVoice(1.5, 0).peak).toBeLessThan(0.5)
    expect(AMBIENCE_MASTER).toBe(0.2)
  })
})

describe('room tone per area', () => {
  it('is airy in the lobby and atrium, busy in the ER, quiet in a patient room, soft in a corridor', () => {
    expect(toneForArea({ id: 'lobby', kind: 'public' })).toBe('airy')
    expect(toneForArea({ id: 'atrium', kind: 'public' })).toBe('airy')
    expect(toneForArea({ id: 'er', kind: 'clinical' })).toBe('busy')
    expect(toneForArea({ id: 'room:A3', kind: 'room' })).toBe('quiet')
    expect(toneForArea({ id: 'corridorA', kind: 'public' })).toBe('corridor')
  })

  it('falls back to the kind of an area the mood does not name', () => {
    expect(toneForArea({ id: 'mri', kind: 'clinical' })).toBe('busy')
    expect(toneForArea({ id: 'command', kind: 'staff' })).toBe('corridor')
    expect(toneForArea({ id: 'supplyB', kind: 'service' })).toBe('corridor')
  })

  it('is outdoor outside the building', () => {
    expect(toneForArea(null)).toBe('outdoor')
  })

  it('gives every real area a tone, and the real places land where they should', () => {
    const tones = Object.keys(ROOM_TONES)
    for (const a of AREAS) expect(tones).toContain(toneForArea(a))
    expect(toneForArea(areaAt(-53, 0))).toBe('airy')
    expect(toneForArea(areaAt(-53, 14))).toBe('busy')
    const r = ROOMS[0].rect
    expect(toneForArea(areaAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2))).toBe('quiet')
    expect(toneForArea(areaAt(0, -14))).toBe('corridor')
    expect(toneForArea(areaAt(-70, 0))).toBe('outdoor')
  })

  it('gets brighter and louder in the order the mood asks, with the patient rooms the quietest', () => {
    expect(ROOM_TONES.airy.cutoffHz).toBeGreaterThan(ROOM_TONES.corridor.cutoffHz)
    expect(ROOM_TONES.corridor.cutoffHz).toBeGreaterThan(ROOM_TONES.quiet.cutoffHz)
    expect(ROOM_TONES.busy.level).toBeGreaterThan(ROOM_TONES.corridor.level)
    expect(ROOM_TONES.corridor.level).toBeGreaterThan(ROOM_TONES.quiet.level)
    for (const t of Object.keys(ROOM_TONES) as RoomTone[]) {
      if (t !== 'quiet') expect(ROOM_TONES[t].level).toBeGreaterThan(ROOM_TONES.quiet.level)
    }
  })
})

describe('room tone on level 2 (the robotic surgery suite)', () => {
  const l2 = AREAS.filter((a) => a.id.startsWith('l2'))

  it('hums quietly all through the suite, a little more machine in the robotic OR, and the family lounge stays quiet', () => {
    expect(l2.length).toBe(10)
    expect(toneForArea(areaById('l2Or'))).toBe('machine')
    expect(toneForArea(areaById('l2Lounge'))).toBe('quiet')
    for (const id of ['l2Corridor', 'l2PreOp', 'l2Staff', 'l2Sterile', 'l2Hall', 'l2Pacu', 'l2LiftA', 'l2LiftB'] as const) expect(toneForArea(areaById(id)), id).toBe('hum')
  })

  it('names every level-2 area by id (none falls through to the kind: a clinical room there is not the ER\'s "busy")', () => {
    for (const a of l2) expect(['hum', 'machine', 'quiet'], a.id).toContain(toneForArea(a))
  })

  it('finds the level-2 tone from a sim position in the strip (you walk in sim coordinates), not from where the level is drawn', () => {
    const at = (drawnX: number, z: number) => toneForArea(areaAt(drawnX + 150, z))
    expect(at(-48.6, 5.9)).toBe('machine') // by the OR's table
    expect(at(-48.5, 16)).toBe('hum') // the recovery island
    expect(at(-57.5, 12)).toBe('quiet') // the lounge
    // the same x, z DRAWN (as if the drawn camera were the listener) is a ground-floor room of level 1: the lobby is airy, the ER busy
    expect(toneForArea(areaAt(-53, 0))).toBe('airy')
    expect(toneForArea(areaAt(-48.6, 12))).toBe('busy')
    expect(LEVEL2_FOOTPRINT.x0).toBe(-62)
  })

  it('is a clinical hum: softer and darker than a corridor, louder than a patient room, the OR a touch brighter and louder, and under the ER', () => {
    expect(ROOM_TONES.hum.level).toBeGreaterThan(ROOM_TONES.quiet.level)
    expect(ROOM_TONES.hum.level).toBeLessThan(ROOM_TONES.corridor.level)
    expect(ROOM_TONES.hum.cutoffHz).toBeLessThan(ROOM_TONES.corridor.cutoffHz)
    expect(ROOM_TONES.hum.cutoffHz).toBeGreaterThan(ROOM_TONES.quiet.cutoffHz)
    expect(ROOM_TONES.machine.level).toBeGreaterThan(ROOM_TONES.hum.level)
    expect(ROOM_TONES.machine.cutoffHz).toBeGreaterThan(ROOM_TONES.hum.cutoffHz)
    expect(ROOM_TONES.machine.level).toBeLessThan(ROOM_TONES.busy.level)
  })

  it('leaves the level-1 tones as they were', () => {
    expect(toneForArea(areaById('lobby'))).toBe('airy')
    expect(toneForArea(areaById('er'))).toBe('busy')
    expect(toneForArea(areaById('liftA'))).toBe('corridor')
    expect(ROOM_TONES.airy).toEqual({ cutoffHz: 2400, level: 0.6 })
    expect(ROOM_TONES.corridor).toEqual({ cutoffHz: 900, level: 0.45 })
  })
})

/** Feeds a trigger one distance a second (index = seconds) and counts the sounds it sets off. */
function sounds(reach: Reach, dists: readonly number[]): number {
  const trigger = newTrigger()
  let n = 0
  dists.forEach((d, i) => {
    if (stepTrigger(trigger, d, i, reach)) n++
  })
  return n
}

/** `n` distances going evenly from `from` to `to` (the start itself is left out). */
function line(from: number, to: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n)
}

/** `seconds` samples of the same distance. */
function rep(d: number, seconds: number): number[] {
  return Array.from({ length: seconds }, () => d)
}

describe('one-shot triggers', () => {
  it('a door whoosh plays once per approach: walking in, standing, walking out and in again', () => {
    const walk = [...line(6, 1, 5), ...rep(1, 30), ...line(1, 5, 4), ...rep(5, 10), ...line(5, 1, 4)]
    expect(sounds(DOOR_REACH, walk)).toBe(2)
  })

  it('a door whoosh does not repeat while you stand close, even with a cooldown that has passed', () => {
    expect(sounds(DOOR_REACH, [5, 1, ...rep(1, 60)])).toBe(1)
  })

  it('a cooldown blocks a quick return, and the sound does not play late', () => {
    // in at t=0, out at t=1, back in at t=2 (inside the 4 s cooldown: silent), out at t=3, in at t=11 (plays)
    expect(sounds(DOOR_REACH, [1, 5, 1, 5, ...rep(5, 7), 1])).toBe(2)
    expect(sounds(DOOR_REACH, [1, 5, 1, 5, 5])).toBe(1)
  })

  it('a wobble across the entry radius is one approach, and only leaving the exit radius re-arms it', () => {
    expect(sounds(DOOR_REACH, [2.6, 1.9, 2.1, 1.9, 2.2, 1.8])).toBe(1)
    // 3.0 to 3.4 is between the enter and exit radii, so the approach is not over
    expect(sounds(DOOR_REACH, [1.5, 3.0, 3.4, 2.9, 3.2, 1.5, 1.5])).toBe(1)
  })

  it('a door you never come near makes no sound', () => {
    expect(sounds(DOOR_REACH, [10, 9, 8, 7])).toBe(0)
  })

  it('the lift ding plays once per visit, and not again while you stay in the lift lobby', () => {
    expect(sounds(LIFT_REACH, [...line(10, 2, 8), ...rep(1, 60)])).toBe(1)
    // a visit goes on while you wander between the enter and exit radii
    expect(sounds(LIFT_REACH, [...line(10, 2, 8), ...rep(3.5, 5), ...rep(2, 5)])).toBe(1)
    // a second visit, after you walk clear and come back later
    expect(sounds(LIFT_REACH, [...line(10, 2, 8), ...rep(6, 20), ...line(6, 2, 4), ...rep(2, 5)])).toBe(2)
  })

  it('the pod chime plays once per pass of a moving pod', () => {
    const trigger = newTrigger()
    const passes = [5, 2.9, 2.5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 2.8]
    let chimes = 0
    passes.forEach((d, i) => {
      if (podChimeDue(trigger, d, 1.2, i)) chimes++
    })
    expect(chimes).toBe(2)
  })

  it('a parked pod does not chime, and uses up its approach so it does not chime when it starts moving close by', () => {
    const trigger = newTrigger()
    expect(podChimeDue(trigger, 2, 0, 0)).toBe(false)
    expect(podChimeDue(trigger, 2, 1.2, 1)).toBe(false)
    expect(podChimeDue(trigger, 6, 1.2, 2)).toBe(false)
    expect(podChimeDue(trigger, 2.5, 1.2, 20)).toBe(true)
  })

  it('reach is wider for the pods than for a door, and wider for the lifts than for a door', () => {
    expect(POD_REACH.enterM).toBeGreaterThan(DOOR_REACH.enterM)
    expect(LIFT_REACH.enterM).toBeGreaterThan(DOOR_REACH.enterM)
    expect(POD_REACH.exitM).toBeGreaterThan(POD_REACH.enterM)
  })
})

describe('AmbienceEngine gating', () => {
  const WALKING: AmbiencePlayer = { x: -60, z: 0, speed: 1.5, mode: 'walk' }
  const realContext = (globalThis as { AudioContext?: unknown }).AudioContext
  let built = 0

  /** A stand-in for any Web Audio node: every method and property answers, so the graph can be built without a browser. */
  function fakeNode(): any {
    return new Proxy(function () {}, {
      get(_t, key) {
        if (key === 'sampleRate') return 48000
        if (key === 'currentTime') return 0
        if (key === 'state') return 'running'
        if (key === 'value') return 0
        if (key === Symbol.toPrimitive) return () => 0
        return fakeNode()
      },
      set: () => true,
      apply: () => fakeNode(),
    })
  }

  beforeEach(() => {
    built = 0
    ;(globalThis as { AudioContext?: unknown }).AudioContext = class {
      constructor() {
        built++
        return fakeNode()
      }
    }
  })

  afterEach(() => {
    ;(globalThis as { AudioContext?: unknown }).AudioContext = realContext
  })

  function run(over: { player?: AmbiencePlayer | null; muted?: boolean; unlocked?: boolean; hidden?: boolean }): number {
    const inputs: AmbienceInputs = {
      player: () => (over.player === undefined ? WALKING : over.player),
      pods: () => [],
      area: () => null,
      muted: () => over.muted ?? false,
      unlocked: () => over.unlocked ?? true,
      hidden: () => over.hidden ?? false,
      autoDoors: [],
      lifts: [],
    }
    const engine = new AmbienceEngine(inputs)
    engine.start()
    engine.stop()
    return built
  }

  it('builds no audio in overview, muted, before the first click, or with the tab hidden', () => {
    expect(run({ player: { ...WALKING, mode: 'overview' } })).toBe(0)
    expect(run({ muted: true })).toBe(0)
    expect(run({ unlocked: false })).toBe(0)
    expect(run({ hidden: true })).toBe(0)
    expect(run({ player: null })).toBe(0)
  })

  it('builds the graph once when you walk, unmuted, unlocked and visible', () => {
    expect(run({})).toBe(1)
  })
})

describe('AmbienceEngine footsteps', () => {
  const WALKING: AmbiencePlayer = { x: -60, z: 0, speed: 1.5, mode: 'walk' }
  const realContext = (globalThis as { AudioContext?: unknown }).AudioContext
  let now = 0
  let filters = 0
  let stepCalls: { hz: number; t: number }[] = []

  const param = (record?: (v: number, t: number) => void) => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime(v: number, t: number) {
      record?.(v, t)
    },
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  })
  const node = (extra: Record<string, unknown> = {}) => ({ connect() {}, disconnect() {}, start() {}, ...extra })

  /** A Web Audio context that records the band of every footstep (the second filter the engine builds is the step filter) and whose clock the test moves. */
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
      const id = filters++
      return node({ type: '', Q: param(), frequency: param((hz, t) => id === 1 && stepCalls.push({ hz, t })) })
    }
    createBufferSource() {
      return node({ buffer: null, loop: false })
    }
    createBuffer(_channels: number, len: number) {
      return { getChannelData: () => new Float32Array(len) }
    }
    createOscillator() {
      return node({ type: '', frequency: param() })
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
    filters = 0
    stepCalls = []
    vi.useFakeTimers()
    ;(globalThis as { AudioContext?: unknown }).AudioContext = FakeContext
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as { AudioContext?: unknown }).AudioContext = realContext
  })

  /** Moves the audio clock and the timers on together, 50 ms at a time (the engine's tick). */
  function advance(ms: number): void {
    for (let t = 0; t < ms; t += 50) {
      now += 0.05
      vi.advanceTimersByTime(50)
    }
  }

  function engineFor(stride: { steps: number; foot: number; strikeSpeed: number; run: number }, player: () => AmbiencePlayer | null = () => WALKING): AmbienceEngine {
    const inputs: AmbienceInputs = { player, stride: (): AmbienceStride => stride, pods: () => [], area: () => null, muted: () => false, unlocked: () => true, hidden: () => false, autoDoors: [], lifts: [] }
    const engine = new AmbienceEngine(inputs)
    engine.start()
    return engine
  }

  it('plays one step for each heel strike, on the foot that struck, and none while the count stands still, whatever the speed says', () => {
    const stride = { steps: 40, foot: 0, strikeSpeed: 2, run: 0 }
    const engine = engineFor(stride)
    advance(300)
    // starting to walk with a count that is already high plays nothing
    expect(stepCalls).toHaveLength(0)
    // the player's speed is high but no foot lands: silence (the old engine would have timed steps from it)
    advance(1000)
    expect(stepCalls).toHaveLength(0)
    stride.steps += 1
    stride.foot = 1
    advance(50)
    expect(stepCalls).toHaveLength(1)
    // the two feet sound different: left and right bands
    const right = stepCalls[0].hz
    advance(500)
    expect(stepCalls).toHaveLength(1)
    stride.steps += 1
    stride.foot = 0
    advance(50)
    expect(stepCalls).toHaveLength(2)
    expect(stepCalls[1].hz).toBeLessThan(right)
    // two strikes inside one tick are heard as two, in order, ending on the latest foot
    stride.steps += 2
    stride.foot = 1
    advance(50)
    expect(stepCalls).toHaveLength(4)
    expect(stepCalls[2].hz).toBeLessThan(stepCalls[3].hz)
    expect(stepCalls[3].t).toBeGreaterThan(stepCalls[2].t)
    engine.stop()
  })

  it('caps a burst, and plays nothing for the strikes that happened while you were not walking', () => {
    const stride = { steps: 0, foot: 0, strikeSpeed: 3, run: 1 }
    let mode = 'walk'
    const engine = engineFor(stride, () => ({ ...WALKING, mode }))
    advance(300)
    stride.steps += 100
    advance(50)
    expect(stepCalls).toHaveLength(STEP_BURST_MAX)
    stepCalls.length = 0
    // overview: the engine goes quiet and forgets the count; the strikes that pass meanwhile are not played when you come back
    mode = 'overview'
    advance(600)
    stride.steps += 7
    mode = 'walk'
    advance(400)
    expect(stepCalls).toHaveLength(0)
    stride.steps += 1
    advance(50)
    expect(stepCalls).toHaveLength(1)
    engine.stop()
  })
})
