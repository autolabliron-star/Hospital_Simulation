/**
 * An adapter for "area sound sources": a tracker that is stepped with the seconds since its last look and returns the sounds to START now as plain
 * voices, and that belongs to one room (the draw centre's `createDrawSoundSource`, src/audio/devices/drawPatterns.ts). `registerAreaSource` turns such a
 * source into a `DevicePattern` of the device engine (registry.ts): each plan it steps the source by the real time since the last plan, puts the voices
 * on the audio clock at the start of the window and gives them a position, so the engine's distance and wall rules apply. The position is the point of
 * the room nearest to the listener (a little inside its walls): in the room you hear it at full level, outside it fades with the distance to the room
 * and is muffled by the walls.
 */
import { areaById, type AreaId } from '@/sim/places'
import type { Vec3 } from '@/sim/types'
import { blip, registerDevicePattern, type DeviceEvent, type DevicePattern, type PatternSink, type PlanWindow } from './registry'

/** The voices an area source returns (the draw centre's `DrawVoice`: times are seconds from the moment the source returned them, `level` is 0..1). */
export type AreaVoice =
  | { kind: 'tone'; t: number; freq: number; dur: number; level: number; wave: 'sine' | 'triangle' | 'square'; glideTo?: number }
  | { kind: 'noise'; t: number; dur: number; level: number; lowHz: number; highHz: number }
  | { kind: 'click'; t: number; level: number; freq: number }

export interface AreaSoundSource {
  readonly id: string
  readonly area: AreaId
  /** Look at the world `dt` seconds after the last look and return the sounds to start. */
  step(dt: number): readonly AreaVoice[]
}

/** The longest step handed to a source: after a pause or a long silence it would otherwise see a jump and fire a burst. */
export const MAX_STEP_S = 0.5
/** Height of the sound's position, and how far inside the room's walls the nearest point is kept. */
export const AREA_SOUND_Y = 1.3
export const WALL_INSET = 0.25

/** The point of an area (kept `WALL_INSET` inside its walls) nearest to the listener. Written into `out`. */
export function nearestInArea(area: AreaId, listener: Vec3, out: Vec3): Vec3 {
  const r = areaById(area).rect
  const x0 = r.x0 + WALL_INSET
  const x1 = r.x1 - WALL_INSET
  const z0 = r.z0 + WALL_INSET
  const z1 = r.z1 - WALL_INSET
  out.x = listener.x < x0 ? x0 : listener.x > x1 ? x1 : listener.x
  out.z = listener.z < z0 ? z0 : listener.z > z1 ? z1 : listener.z
  out.y = AREA_SOUND_Y
  return out
}

/** One voice as a device event at audio time `from + voice.t`, at position `at` (shared between the events of one plan). */
export function voiceToEvent(v: AreaVoice, from: number, at: Vec3): DeviceEvent {
  const t = from + Math.max(0, v.t)
  if (v.kind === 'tone') return { kind: 'tone', t, f0: v.freq, f1: v.glideTo ?? v.freq, dur: v.dur, peak: v.level, wave: v.wave, attack: 0.006, at }
  if (v.kind === 'noise') {
    const centre = Math.sqrt(Math.max(40, v.lowHz) * Math.max(41, v.highHz))
    const width = Math.max(40, v.highHz - v.lowHz)
    return { kind: 'noise', t, f0: centre, f1: centre, q: Math.min(8, Math.max(0.4, centre / width)), dur: v.dur, peak: v.level, attack: 0.006, at }
  }
  return { ...blip(t, v.freq, 0.016, v.level, at, 'square'), attack: 0.001 }
}

/** The pattern of an area source. */
export function areaPattern(source: AreaSoundSource): DevicePattern {
  let last = Number.NaN
  const at: Vec3 = { x: 0, y: AREA_SOUND_Y, z: 0 }
  return {
    id: `area:${source.id}`,
    plan(w: PlanWindow, out: PatternSink) {
      const dt = Number.isNaN(last) ? 0 : Math.min(MAX_STEP_S, Math.max(0, w.now - last))
      last = w.now
      const voices = source.step(dt)
      if (voices.length === 0) return
      // one position object per plan, copied per event (the engine keeps it only until it has scheduled the voice)
      nearestInArea(source.area, w.listener, at)
      for (const v of voices) out.event(voiceToEvent(v, w.from, { x: at.x, y: at.y, z: at.z }))
    },
  }
}

/** The register function the draw centre's `registerDrawSounds(register, read)` wants: registers the source as a pattern and returns the remover. */
export function registerAreaSource(source: AreaSoundSource): () => void {
  return registerDevicePattern(areaPattern(source))
}
