import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { angleDelta } from './chaseMath'
import { facingFromVelocity, newVelocity, pushOutOfPerson, speedOf, stepVelocity, turnTowards } from './motion'
import { BODY, CROWD, MOVE } from './tuning'

const DT = 1 / 60
const P = CONFIG.player

function run(v: ReturnType<typeof newVelocity>, dirX: number, dirZ: number, wish: number, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepVelocity(v, dirX, dirZ, wish, DT)
}

describe('the speeds are a real person\'s pace, from the contract', () => {
  it('walk 1.5 m/s and hurry 3.2 m/s, reached in the configured acceleration time and exactly held', () => {
    expect(MOVE.walkSpeed).toBe(P.walkSpeed)
    expect(MOVE.hurrySpeed).toBe(P.hurrySpeed)
    const v = newVelocity()
    run(v, 0, 1, MOVE.walkSpeed, P.accelSeconds + 2 * DT)
    expect(speedOf(v)).toBeCloseTo(MOVE.walkSpeed, 9)
    // part-way after half the acceleration time
    const half = newVelocity()
    run(half, 0, 1, MOVE.walkSpeed, P.accelSeconds / 2)
    expect(speedOf(half)).toBeGreaterThan(MOVE.walkSpeed * 0.4)
    expect(speedOf(half)).toBeLessThan(MOVE.walkSpeed * 0.7)
    const h = newVelocity()
    run(h, 1, 0, MOVE.hurrySpeed, 1)
    expect(h.x).toBeCloseTo(MOVE.hurrySpeed, 9)
    expect(h.z).toBe(0)
  })

  it('releasing every key brakes to an exact stop in about the brake time', () => {
    const v = newVelocity()
    run(v, 0, 1, MOVE.hurrySpeed, 1)
    let frames = 0
    while (speedOf(v) > 0 && frames < 120) {
      stepVelocity(v, 0, 0, 0, DT)
      frames++
    }
    expect(speedOf(v)).toBe(0)
    expect(v.x).toBe(0)
    expect(v.z).toBe(0)
    expect(frames * DT).toBeGreaterThan(P.brakeSeconds * 0.5)
    expect(frames * DT).toBeLessThan(P.brakeSeconds + 3 * DT)
  })

  it('slowing from a hurry to a walk uses the braking time, and ends exactly at the walking speed', () => {
    const v = newVelocity()
    run(v, 0, 1, MOVE.hurrySpeed, 1)
    run(v, 0, 1, MOVE.walkSpeed, P.brakeSeconds + 2 * DT)
    expect(speedOf(v)).toBeCloseTo(MOVE.walkSpeed, 9)
  })

  it('turning round (the wanted direction reverses) passes through a stop and never exceeds the speed', () => {
    const v = newVelocity()
    run(v, 0, 1, MOVE.walkSpeed, 1)
    let peak = 0
    for (let i = 0; i < 60; i++) {
      stepVelocity(v, 0, -1, MOVE.walkSpeed, DT)
      peak = Math.max(peak, speedOf(v))
    }
    expect(peak).toBeLessThanOrEqual(MOVE.walkSpeed + 1e-9)
    expect(v.z).toBeCloseTo(-MOVE.walkSpeed, 9)
  })

  it('a diagonal wish is no faster than a straight one', () => {
    const v = newVelocity()
    run(v, 1, 1, MOVE.walkSpeed, 1)
    expect(speedOf(v)).toBeCloseTo(MOVE.walkSpeed, 9)
  })
})

describe('the body turns to face where it goes', () => {
  it('a quarter turn takes about a tenth of a second and ends facing the target', () => {
    let h = 0
    for (let i = 0; i < 6; i++) h = turnTowards(h, Math.PI / 2, DT)
    expect(h).toBeGreaterThan((Math.PI / 2) * 0.55)
    for (let i = 0; i < 90; i++) h = turnTowards(h, Math.PI / 2, DT)
    expect(h).toBeCloseTo(Math.PI / 2, 4)
  })

  it('takes the short way round, never faster than the turn limit', () => {
    let h = (170 * Math.PI) / 180
    const before = h
    h = turnTowards(h, (-170 * Math.PI) / 180, DT)
    expect(angleDelta(before, h)).toBeGreaterThan(0) // up through 180, not back down through zero
    expect(Math.abs(angleDelta(before, h))).toBeLessThanOrEqual(MOVE.maxTurnRate * DT + 1e-9)
  })

  it('facingFromVelocity says nothing when too slow, and the compass heading otherwise', () => {
    expect(facingFromVelocity({ x: 0.05, z: 0 })).toBeNull()
    expect(facingFromVelocity({ x: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 9)
    expect(facingFromVelocity({ x: 0, z: -1 })).toBeCloseTo(Math.PI, 9)
  })
})

describe('other people are circles you do not walk through', () => {
  const push = { x: 0, z: 0 }

  it('pushes you straight away from their middle until the two circles just touch', () => {
    const reach = BODY.radius + CROWD.npcRadius
    pushOutOfPerson(0.3, 0, 0, 0, BODY.radius, 10, push)
    expect(0.3 + push.x).toBeCloseTo(reach, 9)
    expect(push.z).toBeCloseTo(0, 9)
    pushOutOfPerson(0, -0.2, 0, 0, BODY.radius, 10, push)
    expect(push.x).toBeCloseTo(0, 9)
    expect(-0.2 + push.z).toBeCloseTo(-reach, 9)
  })

  it('does nothing when clear, is capped per frame, and survives standing on the same spot', () => {
    pushOutOfPerson(2, 0, 0, 0, BODY.radius, 10, push)
    expect(push).toEqual({ x: 0, z: 0 })
    pushOutOfPerson(0.1, 0, 0, 0, BODY.radius, 0.02, push)
    expect(Math.hypot(push.x, push.z)).toBeCloseTo(0.02, 9)
    pushOutOfPerson(0, 0, 0, 0, BODY.radius, 0.02, push)
    expect(Number.isFinite(push.x + push.z)).toBe(true)
    expect(Math.hypot(push.x, push.z)).toBeCloseTo(0.02, 9)
  })
})
