/**
 * The drawn facing (facing.ts) and its use in the crowd model: a walker faces where it goes, not where its path points; a standing person whom
 * the sim turns in one step turns at a human rate; seated people, vehicles and you keep the sim's heading exactly.
 */
import { describe, expect, it } from 'vitest'
import type { Entity } from '@/sim/types'
import { FACING, facingTarget, turnFacing } from './facing'
import { wrapPi } from './math'
import { CrowdModel, type FrameInput } from './model'

const DT = 1 / 60

function ent(over: Partial<Entity> = {}): Entity {
  return { id: 'ped-1', role: 'nurse', name: 'Test', position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'idle', mood: 'neutral', emote: 'none', tier: 'near', variant: 3, ...over }
}

function frame(entities: Map<string, Entity>, over: Partial<FrameInput> = {}): FrameInput {
  return { dt: DT, time: 0, camX: 0, camY: 6, camZ: 8, entities, followId: null, selectedId: null, hoverId: null, ...over }
}

describe('facing maths', () => {
  it('faces the sim heading when slow, the direction of motion when walking, and never spins round for a step back', () => {
    // standing: the sim's heading
    expect(facingTarget(0.3, 1, 0, 0.1)).toBeCloseTo(0.3, 9)
    // walking at 1.2 m/s due +x (pi/2) while the path points +z (0): face +x
    expect(facingTarget(0, 1.2, 0, 1.2)).toBeCloseTo(Math.PI / 2, 6)
    // walking backwards (a push from the front): keep the sim's heading
    expect(facingTarget(0, 0, -1, 1)).toBeCloseTo(0, 9)
    // in between, a blend (continuous in speed)
    const mid = facingTarget(0, 0.5, 0, 0.5)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(Math.PI / 2)
  })

  it('turns at most FACING.maxTurn rad/s: a 180 degree turn takes about half a second or more, then settles exactly', () => {
    let h = 0
    let frames = 0
    let maxStep = 0
    while (Math.abs(wrapPi(Math.PI - 1e-3 - h)) > 0.01 && frames < 600) {
      const n = turnFacing(h, Math.PI - 1e-3, DT)
      maxStep = Math.max(maxStep, Math.abs(wrapPi(n - h)))
      h = n
      frames++
    }
    expect(maxStep).toBeLessThanOrEqual(FACING.maxTurn * DT + 1e-9)
    expect(frames * DT).toBeGreaterThan(0.5)
    expect(frames * DT).toBeLessThan(1.2)
    // and at 10x sim speed it keeps up with a sim that runs 10 times faster
    expect(Math.abs(wrapPi(turnFacing(0, 1, DT, 10)))).toBeGreaterThan(Math.abs(turnFacing(0, 1, DT, 1)) * 5)
  })
})

describe('the crowd model draws the facing', () => {
  it('a walker crabbing sideways off its path heading is drawn facing where it walks', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>()
    // the sim says heading +z (0), the body moves along +x at 1.2 m/s (a keep-right lane change, an avoidance push)
    const e = ent({ anim: 'walk', heading: 0 })
    es.set(e.id, e)
    for (let i = 0; i < 60; i++) {
      e.position.x += 1.2 * DT
      m.update(frame(es))
    }
    const slot = m.get(e.id)!
    expect(Math.abs(wrapPi(slot.heading - Math.PI / 2))).toBeLessThan(0.15)
  })

  it('a standing person the sim turns 180 degrees in one step turns on screen over half a second, never more than a few degrees a frame', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>()
    const e = ent({ heading: 0 })
    es.set(e.id, e)
    for (let i = 0; i < 30; i++) m.update(frame(es))
    expect(m.get(e.id)!.heading).toBeCloseTo(0, 6)
    e.heading = Math.PI - 0.01 // the controller's walker.face() on arrival
    let last = m.get(e.id)!.heading
    let maxStep = 0
    let settled = -1
    for (let i = 0; i < 90; i++) {
      m.update(frame(es))
      const h = m.get(e.id)!.heading
      maxStep = Math.max(maxStep, Math.abs(wrapPi(h - last)))
      if (settled < 0 && Math.abs(wrapPi(h - e.heading)) < 0.02) settled = i
      last = h
    }
    expect(maxStep).toBeLessThanOrEqual(FACING.maxTurn * DT + 1e-6)
    expect(settled * DT).toBeGreaterThan(0.45)
    expect(Math.abs(wrapPi(last - e.heading))).toBeLessThan(0.01)
  })

  it('seated people, pushers, a jump and you keep the sim heading exactly', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>()
    const sit = ent({ id: 'sit', anim: 'sit', seated: { seatId: 's1', pose: 'sit' }, position: { x: 3, y: 0.45, z: 0 } })
    const push = ent({ id: 'push', anim: 'walk', vehicle: 'wheelchair', position: { x: -3, y: 0, z: 0 } })
    const you = ent({ id: 'player', anim: 'walk', role: 'doctor', position: { x: 0, y: 0, z: 3 } })
    const jumper = ent({ id: 'jumper', position: { x: 6, y: 0, z: 0 } })
    for (const e of [sit, push, you, jumper]) es.set(e.id, e)
    for (let i = 0; i < 10; i++) m.update(frame(es))
    sit.heading = 2
    push.heading = -2
    you.heading = 1.5
    jumper.heading = 3
    jumper.position.x += 8 // a teleport (walker.place), not a walk
    for (let i = 0; i < 40; i++) {
      push.position.x += 1.2 * DT // pushing sideways to its heading: the vehicle's footprint is the sim's
      you.position.x += 1.2 * DT
      m.update(frame(es))
      expect(m.get('sit')!.heading).toBe(2)
      expect(m.get('push')!.heading).toBe(-2)
      expect(m.get('player')!.heading).toBe(1.5)
      expect(m.get('jumper')!.heading).toBe(3)
    }
  })
})
