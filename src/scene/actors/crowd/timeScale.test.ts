// S1: the crowd at the sim's 2x to 30x. People are measured in sim metres per sim second, so a stroll stays a walk; the legs cycle at most
// GAIT_RATE_MAX times real time and slide beyond that.
import { describe, expect, it } from 'vitest'
import type { Entity } from '@/sim/types'
import { ROW_FLOATS } from './constants'
import { CrowdModel, GAIT_RATE_MAX, type FrameInput } from './model'

function walker(): Entity {
  return { id: 'w', role: 'nurse', name: 'Test', position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'walk', mood: 'neutral', emote: 'none', tier: 'near', variant: 3 }
}

function frame(es: Map<string, Entity>, i: number, timeScale?: number): FrameInput {
  const f: FrameInput = { dt: 1 / 60, time: i / 60, camX: 0, camY: 50, camZ: 60, entities: es, followId: null, selectedId: null, hoverId: null }
  if (timeScale !== undefined) f.timeScale = timeScale
  return f
}

/** A person walking straight along +Z at `simSpeed` sim m/s while the sim runs `scale` times real time, for `frames` frames. */
function run(simSpeed: number, scale: number | undefined, frames: number) {
  const m = new CrowdModel()
  const e = walker()
  const es = new Map([[e.id, e]])
  const k = scale ?? 1
  for (let i = 0; i < frames; i++) {
    e.position.z += (simSpeed * k) / 60
    m.update(frame(es, i, scale))
  }
  return { m, slot: m.get(e.id)!, es }
}

describe('crowd gait and the sim speed', () => {
  it('at 30x a stroll in sim units is a walk, not a run', () => {
    const { slot } = run(1.3, 30, 240)
    expect(slot.speed).toBeGreaterThan(1.2)
    expect(slot.speed).toBeLessThan(1.4)
    expect(slot.rig.run).toBe(0)
    expect(slot.rig.brisk).toBeLessThan(0.1)
    expect(slot.rig.planter.steps).toBeGreaterThan(8)
  })

  it('at 30x a brisk walk (1.8 sim m/s) is a brisk walk, still not a run', () => {
    const { slot } = run(1.8, 30, 240)
    expect(slot.speed).toBeGreaterThan(1.65)
    expect(slot.speed).toBeLessThan(1.95)
    expect(slot.rig.run).toBe(0)
    expect(slot.rig.brisk).toBeGreaterThan(0.3)
  })

  it('without the time scale the same motion would be read as a sprint (the bug this guards)', () => {
    const { slot } = run(1.3, 30, 120)
    const raw = new CrowdModel()
    const e = walker()
    const es = new Map([[e.id, e]])
    for (let i = 0; i < 120; i++) {
      e.position.z += (1.3 * 30) / 60
      raw.update(frame(es, i)) // no timeScale: 39 m/s
    }
    expect(raw.get(e.id)!.speed).toBeGreaterThan(10)
    expect(slot.speed).toBeLessThan(2)
  })

  it('at 10x and 30x the feet cycle faster than real time but no more than GAIT_RATE_MAX times, and stay near the body', () => {
    const base = run(1.3, undefined, 240).slot.rig.planter.steps
    const fast = run(1.3, 30, 240)
    const steps = fast.slot.rig.planter.steps
    expect(steps).toBeGreaterThan(base * 1.5)
    expect(steps).toBeLessThan(base * GAIT_RATE_MAX * 1.35)
    // the feet are planned in a frame that moved less than the person: they never trail by metres
    const pl = fast.slot.rig.planter
    const px = fast.slot.x - fast.slot.gox
    const pz = fast.slot.z - fast.slot.goz
    expect(fast.slot.gox + fast.slot.goz).not.toBe(0)
    for (const foot of pl.feet) expect(Math.hypot(foot.x - px, foot.z - pz)).toBeLessThan(1.2)
    for (let i = 0; i < 100; i++) expect(Number.isFinite(fast.m.data[i])).toBe(true)
  })

  it('at 1x (and 2x, 4x) nothing is offset, and an absent time scale is byte-identical to 1', () => {
    const a = run(1.3, undefined, 180)
    const b = run(1.3, 1, 180)
    expect(a.slot.gox).toBe(0)
    expect(a.slot.goz).toBe(0)
    expect(Array.from(b.m.data.slice(0, ROW_FLOATS))).toEqual(Array.from(a.m.data.slice(0, ROW_FLOATS)))
    expect(b.slot.speed).toBe(a.slot.speed)
    for (const s of [2, 4]) {
      const r = run(1.3, s, 180)
      expect(r.slot.gox).toBe(0)
      expect(r.slot.speed).toBeGreaterThan(1.2)
      expect(r.slot.speed).toBeLessThan(1.4)
      expect(r.slot.rig.run).toBe(0)
    }
  })

  it('a paused sim at 30x freezes the poses: nobody moves, nobody steps', () => {
    const { m, slot, es } = run(1.3, 30, 120)
    for (let i = 0; i < 120; i++) m.update(frame(es, 120 + i, 30))
    expect(slot.speed).toBe(0)
    const steps = slot.rig.planter.steps
    for (let i = 0; i < 60; i++) m.update(frame(es, 240 + i, 30))
    expect(slot.rig.planter.steps).toBe(steps)
  })

  it('a teleport is still a teleport at 30x, and a seated person carries no offset', () => {
    const { m, slot, es } = run(1.3, 30, 60)
    const e = es.get('w')!
    e.position.z += 400
    m.update(frame(es, 61, 30))
    expect(slot.speed).toBe(0)
    expect(slot.gox).toBe(0)
    e.anim = 'sit'
    for (let i = 0; i < 5; i++) m.update(frame(es, 62 + i, 30))
    expect(slot.gox).toBe(0)
    expect(slot.goz).toBe(0)
  })
})
