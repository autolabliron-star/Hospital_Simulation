import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AREAS, ROOMS, areaAt } from '@/sim/places'
import {
  AmbienceEngine,
  DOOR_REACH,
  LIFT_REACH,
  POD_REACH,
  ROOM_TONES,
  nextStepAt,
  newTrigger,
  podChimeDue,
  stepRateHz,
  stepTrigger,
  toneForArea,
  type AmbienceInputs,
  type AmbiencePlayer,
  type Reach,
  type RoomTone,
} from './ambience'

/** Steps a walker at `speed` takes in `seconds`, planned the way the engine plans them: 50 ms windows, one after another. */
function stepTimes(speed: number, seconds: number): number[] {
  const out: number[] = []
  const rate = stepRateHz(speed)
  let last = Number.NEGATIVE_INFINITY
  for (let now = 0; now < seconds; now += 0.05) {
    let t = nextStepAt(last, now, rate)
    while (t < now + 0.05) {
      out.push(t)
      last = t
      t = nextStepAt(last, now, rate)
    }
  }
  return out
}

describe('footstep timing', () => {
  it('is 1.8 steps a second at a 1.5 m/s walk', () => {
    expect(stepRateHz(1.5)).toBeCloseTo(1.8, 9)
  })

  it('is faster when hurrying, and capped', () => {
    expect(stepRateHz(3.2)).toBeGreaterThan(stepRateHz(1.5))
    expect(stepRateHz(3.2)).toBeCloseTo(3.84, 9)
    expect(stepRateHz(10)).toBe(4.5)
  })

  it('is silent when standing still, or moving too slowly to count', () => {
    expect(stepRateHz(0)).toBe(0)
    expect(stepRateHz(0.1)).toBe(0)
    expect(stepRateHz(Number.NaN)).toBe(0)
    expect(stepTimes(0, 5)).toHaveLength(0)
  })

  it('plays about 18 steps in 10 s at a walk, and about 38 when hurrying', () => {
    expect(Math.abs(stepTimes(1.5, 10).length - 18)).toBeLessThanOrEqual(1)
    expect(Math.abs(stepTimes(3.2, 10).length - 38)).toBeLessThanOrEqual(1)
  })

  it('spaces the steps evenly, and a first or late step is due at once', () => {
    const times = stepTimes(1.5, 6)
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(1 / 1.8, 6)
    expect(nextStepAt(Number.NEGATIVE_INFINITY, 5, 1.8)).toBe(5)
    expect(nextStepAt(5, 9, 2)).toBe(9)
    expect(nextStepAt(5, 5, 2)).toBe(5.5)
    expect(nextStepAt(5, 5, 0)).toBe(Number.POSITIVE_INFINITY)
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
