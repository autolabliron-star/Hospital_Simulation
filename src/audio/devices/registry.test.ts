import { afterEach, describe, expect, it } from 'vitest'
import { LAB } from '@/sim/places'
import {
  blip,
  click,
  devicePatterns,
  FAR,
  NEAR,
  OTHER_ROOM,
  periodic,
  registerDevicePattern,
  registerPatternModules,
  registryVersion,
  soundGain,
  type DevicePattern,
} from './registry'
import { EAR_Y, listenerAt, ROOM_Y } from './listener'

const pat = (id: string): DevicePattern => ({ id, plan: () => {} })
const cleanup: (() => void)[] = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

describe('the device pattern registry', () => {
  it('registers, replaces and removes patterns, and bumps its version when the set changes', () => {
    const v0 = registryVersion()
    const a = pat('t:a')
    cleanup.push(registerDevicePattern(a))
    expect(devicePatterns().map((p) => p.id)).toContain('t:a')
    expect(registryVersion()).toBe(v0 + 1)
    // the same id replaces
    const a2 = pat('t:a')
    const offA2 = registerDevicePattern(a2)
    expect(devicePatterns().filter((p) => p.id === 't:a')).toEqual([a2])
    // removing the replaced one's handle later does not remove the new one
    const v1 = registryVersion()
    cleanup.push(offA2)
    cleanup.shift()!()
    expect(devicePatterns()).toContain(a2)
    expect(registryVersion()).toBe(v1)
    offA2()
    expect(devicePatterns().map((p) => p.id)).not.toContain('t:a')
    expect(registryVersion()).toBe(v1 + 1)
    cleanup.length = 0
  })

  it('registers whatever a set of modules exports as devicePatterns (the glob in DeviceSounds), ignoring modules without them', () => {
    const off = registerPatternModules({
      './kioskPatterns.ts': { devicePatterns: [pat('t:k1'), pat('t:k2')] },
      './drawPatterns.ts': { somethingElse: 1 },
      './nothing.ts': null,
    })
    const ids = devicePatterns().map((p) => p.id)
    expect(ids).toContain('t:k1')
    expect(ids).toContain('t:k2')
    off()
    expect(devicePatterns().map((p) => p.id)).not.toContain('t:k1')
  })
})

describe('how loud a source is where you stand', () => {
  const here = { x: -28, y: 1.6, z: 19 }
  const at = (d: number, y = 1.6) => ({ x: here.x + d, y, z: here.z })

  it('is full within 2.5 m, silent beyond 16 m, and falls smoothly and monotonically between', () => {
    expect(soundGain(here, null)).toBe(1)
    expect(soundGain(here, at(0))).toBe(1)
    expect(soundGain(here, at(NEAR - 0.1))).toBe(1)
    expect(soundGain(here, at(FAR + 0.1))).toBe(0)
    let prev = 1
    for (let d = NEAR; d <= FAR; d += 0.25) {
      const g = soundGain(here, at(d))
      expect(g).toBeLessThanOrEqual(prev + 1e-12)
      prev = g
    }
    // the sound of a source 1 m above your head counts that metre
    expect(soundGain(here, at(0, 10))).toBeLessThan(1)
  })

  it('muffles a source in another room by half, and not one in the same room', () => {
    // you in corridor B; a source the same 4.8 m away along the corridor, and one through the lab's glass front
    const you = { x: -28, y: 1.6, z: 14.2 }
    const sameRoom = soundGain(you, { x: -23.2, y: 1.6, z: 14.2 })
    const otherRoom = soundGain(you, { x: -28, y: 1.6, z: 19.0 })
    expect(sameRoom).toBeGreaterThan(0.3)
    expect(otherRoom / sameRoom).toBeCloseTo(OTHER_ROOM, 6)
    // inside the near zone nothing is muffled in the same room
    expect(soundGain({ x: -28, y: 1.6, z: 19 }, { x: -28, y: 1, z: 21 })).toBe(1)
  })
})

describe('periodic patterns', () => {
  it('give the same times however the audio clock is cut into windows (no gap, no repeat)', () => {
    const whole: number[] = []
    periodic(10.05, 14.05, 0.62, 0.17, (t) => whole.push(t))
    const sliced: number[] = []
    for (let from = 10.05; from < 14.05 - 1e-9; from += 0.12) periodic(from, Math.min(from + 0.12, 14.05), 0.62, 0.17, (t) => sliced.push(t))
    expect(sliced.length).toBe(whole.length)
    sliced.forEach((t, i) => expect(t).toBeCloseTo(whole[i], 9))
    for (let i = 1; i < whole.length; i++) expect(whole[i] - whole[i - 1]).toBeCloseTo(0.62, 9)
    expect(whole.length).toBeGreaterThanOrEqual(6)
    expect(whole.length).toBeLessThanOrEqual(7)
  })

  it('is empty for an empty window or a bad period, and includes the window start but not its end', () => {
    const got: number[] = []
    periodic(5, 5, 1, 0, (t) => got.push(t))
    periodic(5, 6, 0, 0, (t) => got.push(t))
    expect(got).toEqual([])
    periodic(2, 4, 1, 0, (t) => got.push(t))
    expect(got).toEqual([2, 3])
  })

  it('builds short clicks and blips with sane envelopes', () => {
    const c = click(1, 2000, 0.3)
    expect(c.kind).toBe('noise')
    expect(c.dur).toBeLessThan(0.03)
    const b = blip(1, 880, 0.05, 0.2)
    expect(b.kind).toBe('tone')
    expect(b.f0).toBe(b.f1)
  })
})

describe('where the device sounds are heard from', () => {
  it('is you while you walk, the middle of the focused room in the overview, and nobody otherwise', () => {
    const out = { x: 0, y: 0, z: 0 }
    expect(listenerAt({ x: -28, z: 15, mode: 'walk' }, null, out)).toEqual({ x: -28, y: EAR_Y, z: 15 })
    expect(listenerAt({ x: -28, z: 15, mode: 'overview' }, 'lab', out)).toEqual({ x: -28, y: ROOM_Y, z: 19 })
    expect(listenerAt(null, 'lab', out)).not.toBeNull()
    expect(listenerAt({ x: 0, z: 0, mode: 'overview' }, null, out)).toBeNull()
    expect(listenerAt(null, null, out)).toBeNull()
    // walking wins over a focused room
    expect(listenerAt({ x: -28, z: 15, mode: 'walk' }, 'lab', out)!.y).toBe(EAR_Y)
    expect(LAB.viewpoint.z).toBeLessThan(16)
  })
})
