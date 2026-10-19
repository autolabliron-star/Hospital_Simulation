import { afterEach, describe, expect, it } from 'vitest'
import { areaById } from '@/sim/places'
import { createDrawSoundSource, registerDrawSounds, type DrawSoundView } from './drawPatterns'
import { AREA_SOUND_Y, MAX_STEP_S, WALL_INSET, areaPattern, nearestInArea, registerAreaSource, voiceToEvent, type AreaSoundSource, type AreaVoice } from './areaSource'
import { devicePatterns, soundGain, type DeviceEvent, type DroneSpec, type PatternSink, type PlanWindow } from './registry'

const cleanup: (() => void)[] = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

class Sink implements PatternSink {
  events: DeviceEvent[] = []
  event(e: DeviceEvent): void {
    this.events.push(e)
  }
  drone(_d: DroneSpec): void {}
}
const win = (from: number, now: number, listener = { x: -25, y: 1.6, z: 7 }): PlanWindow => ({ from, to: from + 0.12, now, simTime: 0, simSpeed: 1, listener })

describe('area sound sources as device patterns', () => {
  const draw = areaById('diagnostics').rect

  it('puts a voice\'s time on the audio clock at the start of the window, and converts tones, noise and clicks', () => {
    const at = { x: 1, y: 1.3, z: 2 }
    const tone = voiceToEvent({ kind: 'tone', t: 0.1, freq: 660, dur: 0.2, level: 0.4, wave: 'triangle', glideTo: 880 }, 50, at)
    expect(tone).toMatchObject({ kind: 'tone', t: 50.1, f0: 660, f1: 880, dur: 0.2, peak: 0.4, wave: 'triangle', at })
    const flat = voiceToEvent({ kind: 'tone', t: 0, freq: 440, dur: 0.1, level: 0.3, wave: 'sine' }, 50, at)
    expect(flat).toMatchObject({ f0: 440, f1: 440 })
    const noise = voiceToEvent({ kind: 'noise', t: 0.05, dur: 0.3, level: 0.2, lowHz: 400, highHz: 1600 }, 50, at)
    expect(noise.kind).toBe('noise')
    if (noise.kind === 'noise') {
      expect(noise.f0).toBeCloseTo(800, 6) // the geometric middle of the band
      expect(noise.q).toBeGreaterThan(0.4)
      expect(noise.q).toBeLessThan(8)
    }
    const click = voiceToEvent({ kind: 'click', t: 0, level: 0.5, freq: 2400 }, 50, at)
    expect(click).toMatchObject({ kind: 'tone', f0: 2400, f1: 2400, peak: 0.5, wave: 'square' })
    if (click.kind === 'tone') expect(click.dur).toBeLessThan(0.03)
    // a negative time (a source that says "now") never lands before the window
    expect(voiceToEvent({ kind: 'click', t: -1, level: 0.5, freq: 2400 }, 50, at).t).toBe(50)
  })

  it('steps its source by the real time since the last plan (0 the first time, never more than half a second)', () => {
    const dts: number[] = []
    const src: AreaSoundSource = { id: 't', area: 'diagnostics', step: (dt) => (dts.push(dt), []) }
    const p = areaPattern(src)
    const sink = new Sink()
    p.plan(win(10.1, 10), sink)
    p.plan(win(10.22, 10.05), sink)
    p.plan(win(10.34, 10.1), sink)
    p.plan(win(40.1, 40), sink) // after a long silence (the engine was not live)
    expect(dts[0]).toBe(0)
    expect(dts[1]).toBeCloseTo(0.05, 9)
    expect(dts[2]).toBeCloseTo(0.05, 9)
    expect(dts[3]).toBe(MAX_STEP_S)
    expect(sink.events).toEqual([])
  })

  it('plays the voices at the nearest point of the room: full level inside it, quieter and muffled from outside', () => {
    const voices: AreaVoice[] = [{ kind: 'click', t: 0, level: 0.5, freq: 2000 }]
    const src: AreaSoundSource = { id: 'room', area: 'diagnostics', step: () => voices }
    const p = areaPattern(src)
    const inside = new Sink()
    p.plan(win(5, 4.9, { x: -25.4, y: 1.6, z: 6 }), inside)
    expect(inside.events.length).toBe(1)
    expect(inside.events[0].at).toEqual({ x: -25.4, y: AREA_SOUND_Y, z: 6 })
    expect(soundGain({ x: -25.4, y: 1.6, z: 6 }, inside.events[0].at)).toBe(1)
    // in the imaging hall next door, 2.25 m from the room's edge: heard, but through the wall
    const outside = new Sink()
    const hall = { x: -25.4, y: 1.6, z: 0 }
    p.plan(win(5.12, 5.02, hall), outside)
    const at = outside.events[0].at!
    expect(at.z).toBeCloseTo(draw.z0 + WALL_INSET, 9)
    const g = soundGain(hall, at)
    expect(g).toBeCloseTo(0.5, 6) // 2.25 m from the room's edge: inside the near zone, but through the wall
    // far away (the atrium): silent
    expect(soundGain({ x: 30, y: 1.6, z: 0 }, at)).toBe(0)
  })

  it('keeps the nearest point inside the room\'s walls', () => {
    const out = { x: 0, y: 0, z: 0 }
    nearestInArea('diagnostics', { x: -100, y: 1.6, z: -100 }, out)
    expect(out).toEqual({ x: draw.x0 + WALL_INSET, y: AREA_SOUND_Y, z: draw.z0 + WALL_INSET })
    nearestInArea('diagnostics', { x: 100, y: 1.6, z: 100 }, out)
    expect(out.x).toBe(draw.x1 - WALL_INSET)
    expect(out.z).toBe(draw.z1 - WALL_INSET)
  })

  it('registers as a pattern named after the source, and the draw centre\'s own registration function plugs straight in', () => {
    const off = registerAreaSource({ id: 'unit', area: 'lab', step: () => [] })
    cleanup.push(off)
    expect(devicePatterns().map((q) => q.id)).toContain('area:unit')
    off()
    cleanup.length = 0
    expect(devicePatterns().map((q) => q.id)).not.toContain('area:unit')
    // registerDrawSounds(register, read): the contract S2 exports
    let view: DrawSoundView | null = null
    const offDraw = registerDrawSounds(registerAreaSource, () => view)
    cleanup.push(offDraw)
    expect(devicePatterns().map((q) => q.id)).toContain('area:draw')
    const pat = devicePatterns().find((q) => q.id === 'area:draw')!
    const sink = new Sink()
    // no view yet: silent; a robot starting its draw with the tracker's first look: it only learns the state
    pat.plan(win(1, 0.9), sink)
    view = { stations: [{ phase: 'idle', scan: 0, needle: 0, cuff: 0 }], prep: { phase: 'idle', bin: -1, held: null, progress: 0 }, calling: null }
    pat.plan(win(1.12, 1), sink)
    expect(sink.events).toEqual([])
    // the draw source on its own is a plain structural source of the draw centre's area
    expect(createDrawSoundSource(() => null).area).toBe('diagnostics')
  })
})
