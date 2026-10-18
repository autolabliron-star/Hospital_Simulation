import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { angleDelta } from './chaseMath'
import { FROM_REST, SMOOTH_DIVISOR, SMOOTH_TIME, angleBetween, facingFromVelocity, newSpring, restDistance, retarget, speedOf, stepSpring, turnDirection, turnTowards } from './motion'
import { MOVE } from './tuning'

const P = CONFIG.player
const WALK = P.walkSpeed
const RUN = P.hurrySpeed

/** Step a spring `seconds` at `dt` towards its target; returns the distance covered and the time at which `until` first held (or -1). */
function run(s: ReturnType<typeof newSpring>, seconds: number, dt: number, until?: (v: number) => boolean): { dist: number; at: number } {
  let dist = 0
  let at = -1
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) {
    dist += stepSpring(s, dt)
    if (at < 0 && until && until(s.v)) at = (i + 1) * dt
  }
  return { dist, at }
}

describe('the speeds are a real person\'s pace, from the contract', () => {
  it('walk 2 m/s and run 4.2 m/s, held exactly once reached', () => {
    expect(MOVE.walkSpeed).toBe(P.walkSpeed)
    expect(MOVE.hurrySpeed).toBe(P.hurrySpeed)
    const s = newSpring()
    retarget(s, WALK)
    run(s, 2, 1 / 60)
    expect(s.v).toBe(WALK)
    expect(s.a).toBe(0)
    retarget(s, RUN)
    run(s, 2, 1 / 60)
    expect(s.v).toBe(RUN)
  })
})

describe('the speed spring (critically damped, exact for any frame time)', () => {
  it('the smooth times are the configured seconds-to-95-percent over 2.37', () => {
    expect(SMOOTH_DIVISOR).toBe(2.37)
    expect(SMOOTH_TIME.start).toBeCloseTo(P.startSeconds / 2.37, 12)
    expect(SMOOTH_TIME.stop).toBeCloseTo(P.stopSeconds / 2.37, 12)
    expect(SMOOTH_TIME.shift).toBeCloseTo(P.shiftSeconds / 2.37, 12)
  })

  it('reaches 95 % of the walk speed at 0.35 s (and a run at the same time: it is 95 % of the change), at every frame rate', () => {
    for (const dt of [1 / 20, 1 / 30, 1 / 60, 1 / 144]) {
      for (const speed of [WALK, RUN]) {
        const s = newSpring()
        retarget(s, speed)
        const r = run(s, 1, dt, (v) => v >= 0.95 * speed)
        expect(r.at, `dt ${dt} speed ${speed}`).toBeGreaterThanOrEqual(0.3)
        expect(r.at, `dt ${dt} speed ${speed}`).toBeLessThanOrEqual(0.4)
        expect(Math.abs(r.at - P.startSeconds)).toBeLessThanOrEqual(dt + 1e-9)
      }
    }
  })

  it('the first frame from rest changes the speed by well under 0.1 m/s at 60 and 144 fps (0.15 at 30), and the walk\'s peak acceleration is about 10 m/s^2', () => {
    for (const [dt, max] of [[1 / 30, 0.16], [1 / 60, 0.05], [1 / 144, 0.01]] as const) {
      const s = newSpring()
      retarget(s, WALK)
      stepSpring(s, dt)
      expect(s.v, `dt ${dt}`).toBeLessThan(max)
      expect(s.v).toBeGreaterThan(0)
    }
    const s = newSpring()
    retarget(s, WALK)
    let peak = 0
    for (let i = 0; i < 120; i++) {
      stepSpring(s, 1 / 240)
      peak = Math.max(peak, Math.abs(s.a))
    }
    expect(peak).toBeGreaterThan(9)
    expect(peak).toBeLessThan(11)
  })

  it('never overshoots its target, and walks and runs up smoothly (no jump in the speed or in the acceleration)', () => {
    for (const dt of [1 / 20, 1 / 60, 1 / 144]) {
      const s = newSpring()
      retarget(s, RUN)
      let lastV = 0
      let lastA = 0
      for (let i = 0; i < Math.round(1.5 / dt); i++) {
        stepSpring(s, dt)
        expect(s.v).toBeLessThanOrEqual(RUN + 1e-12)
        expect(s.v).toBeGreaterThanOrEqual(lastV - 1e-12) // monotone
        const w = 2 / SMOOTH_TIME.start
        expect(Math.abs(s.v - lastV)).toBeLessThan((RUN * w * Math.exp(-1) + 1e-6) * dt) // never faster than the peak acceleration of this step
        expect(Math.abs(s.a - lastA)).toBeLessThan(RUN * w * w * dt + 1e-9) // no jump in acceleration (the jerk of a critically damped step is at most w^2 times the step)
        lastV = s.v
        lastA = s.a
      }
    }
  })

  it('stops from a walk in under 0.3 s and over 0.2-0.3 m, from a run over 0.4-0.6 m, ending in an exact rest', () => {
    for (const [speed, lo, hi] of [[WALK, 0.2, 0.3], [RUN, 0.4, 0.6]] as const) {
      for (const dt of [1 / 20, 1 / 30, 1 / 60, 1 / 144]) {
        const s = newSpring()
        retarget(s, speed)
        run(s, 2, dt)
        expect(s.v).toBe(speed)
        retarget(s, 0)
        const r = run(s, 1, dt, (v) => v <= 0.05 * speed)
        expect(r.at, `stop time from ${speed} at ${dt}`).toBeLessThanOrEqual(0.3 + 1e-9)
        expect(r.at).toBeGreaterThan(0.2)
        expect(r.dist, `stop distance from ${speed} at ${dt}`).toBeGreaterThanOrEqual(lo)
        expect(r.dist, `stop distance from ${speed} at ${dt}`).toBeLessThanOrEqual(hi)
        expect(s.v).toBe(0)
        expect(s.a).toBe(0)
      }
    }
  })

  it('switching walk <-> run takes 0.45 s to 95 %, and so does backing up from a walk', () => {
    const up = newSpring()
    retarget(up, WALK)
    run(up, 2, 1 / 60)
    retarget(up, RUN)
    expect(up.T).toBeCloseTo(SMOOTH_TIME.shift, 12)
    const a = run(up, 1, 1 / 60, (v) => v >= WALK + 0.95 * (RUN - WALK))
    expect(a.at).toBeGreaterThan(P.shiftSeconds - 0.03)
    expect(a.at).toBeLessThan(P.shiftSeconds + 0.03)
    const down = newSpring()
    retarget(down, RUN)
    run(down, 2, 1 / 60)
    retarget(down, WALK)
    const b = run(down, 1, 1 / 60, (v) => v <= WALK + 0.05 * (RUN - WALK))
    expect(b.at).toBeGreaterThan(P.shiftSeconds - 0.03)
    expect(b.at).toBeLessThan(P.shiftSeconds + 0.03)
    const back = newSpring()
    retarget(back, WALK)
    run(back, 2, 1 / 60)
    retarget(back, -WALK * 0.5)
    expect(back.T).toBeCloseTo(SMOOTH_TIME.shift, 12)
    run(back, 2, 1 / 60)
    expect(back.v).toBe(-WALK * 0.5)
  })

  it('picks the smooth time when the target changes: start from rest, stop to zero, shift otherwise, and holds it', () => {
    const s = newSpring()
    retarget(s, WALK)
    expect(s.T).toBe(SMOOTH_TIME.start)
    run(s, 0.1, 1 / 60)
    expect(s.v).toBeLessThan(FROM_REST * 2)
    retarget(s, WALK) // the same target again changes nothing
    expect(s.T).toBe(SMOOTH_TIME.start)
    run(s, 1, 1 / 60)
    retarget(s, 0)
    expect(s.T).toBe(SMOOTH_TIME.stop)
    run(s, 0.05, 1 / 60)
    retarget(s, RUN) // pressing again while still moving fast is a shift, not a start
    expect(s.T).toBe(SMOOTH_TIME.shift)
    retarget(s, 0.3, 'stop') // a reversal's slow-down is stop-like
    expect(s.T).toBe(SMOOTH_TIME.stop)
  })

  it('the same 3 s walk and the stop after it end within 2 cm at 20, 30, 60 and 144 frames a second (an exact integral)', () => {
    const ends: number[] = []
    for (const dt of [1 / 20, 1 / 30, 1 / 60, 1 / 144]) {
      const s = newSpring()
      retarget(s, WALK)
      let d = run(s, 3, dt).dist
      retarget(s, 0)
      d += run(s, 1, dt).dist
      ends.push(d)
    }
    const min = Math.min(...ends)
    const max = Math.max(...ends)
    expect(max - min).toBeLessThan(0.02)
    // the closed form: 3 s of walking from rest, then the rest of the stop
    expect(ends[0]).toBeCloseTo(WALK * (3 - SMOOTH_TIME.start) + WALK * SMOOTH_TIME.stop, 2) // (the last 0.03 m/s of the stop is snapped to rest: about a millimetre)
  })

  it('restDistance is the travel that is left: v T + a T^2 / 4, from rest, mid-start, at speed, and backing up', () => {
    for (const dt of [1 / 30, 1 / 60]) {
      for (const [target, lead] of [[WALK, 0.05], [WALK, 0.15], [RUN, 0.3], [RUN, 3], [-WALK / 2, 0.2]] as const) {
        const s = newSpring()
        retarget(s, target)
        run(s, lead, dt)
        const predicted = restDistance(s)
        retarget(s, 0)
        const actual = run(s, 2, dt).dist
        expect(Math.abs(predicted - actual), `${target} after ${lead}`).toBeLessThan(0.003)
      }
    }
    const rest = newSpring()
    expect(restDistance(rest)).toBe(0)
  })

  it('a zero-length frame changes nothing', () => {
    const s = newSpring()
    retarget(s, WALK)
    run(s, 0.1, 1 / 60)
    const v = s.v
    expect(stepSpring(s, 0)).toBe(0)
    expect(s.v).toBe(v)
  })
})

describe('the direction of travel (classic) and the body turning to face where it goes', () => {
  const out = { x: 0, z: 0 }

  it('turnDirection turns at most the step, along the short way round, and reports what is left', () => {
    let left = turnDirection(0, 1, 1, 0, 0.5, out) // from facing +z towards +x (a quarter turn)
    expect(left).toBeCloseTo(Math.PI / 2 - 0.5, 9)
    expect(Math.atan2(out.x, out.z)).toBeCloseTo(0.5, 9)
    left = turnDirection(Math.sin(3), Math.cos(3), Math.sin(-3), Math.cos(-3), 0.2, out) // across the +-pi seam
    expect(left).toBeGreaterThan(0)
    expect(angleDelta(3, Math.atan2(out.x, out.z))).toBeCloseTo(0.2, 9) // up through pi, not back through 0
    left = turnDirection(0, 1, 0, 1, 0.5, out)
    expect(left).toBe(0)
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1, 12)
  })

  it('angleBetween is the unsigned angle between two directions', () => {
    expect(angleBetween(0, 1, 0, -1)).toBeCloseTo(Math.PI, 9)
    expect(angleBetween(0, 1, 1, 0)).toBeCloseTo(Math.PI / 2, 9)
    expect(angleBetween(1, 0, 1, 0)).toBe(0)
  })

  it('a quarter turn of the body takes about a tenth of a second and ends facing the target', () => {
    let h = 0
    for (let i = 0; i < 6; i++) h = turnTowards(h, Math.PI / 2, 1 / 60)
    expect(h).toBeGreaterThan((Math.PI / 2) * 0.55)
    for (let i = 0; i < 90; i++) h = turnTowards(h, Math.PI / 2, 1 / 60)
    expect(h).toBeCloseTo(Math.PI / 2, 4)
  })

  it('takes the short way round, never faster than the turn limit', () => {
    let h = (170 * Math.PI) / 180
    const before = h
    h = turnTowards(h, (-170 * Math.PI) / 180, 1 / 60)
    expect(angleDelta(before, h)).toBeGreaterThan(0) // up through 180, not back down through zero
    expect(Math.abs(angleDelta(before, h))).toBeLessThanOrEqual(MOVE.maxTurnRate / 60 + 1e-9)
  })

  it('facingFromVelocity says nothing when too slow, and the compass heading otherwise; speedOf is the length', () => {
    expect(facingFromVelocity({ x: 0.05, z: 0 })).toBeNull()
    expect(facingFromVelocity({ x: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 9)
    expect(facingFromVelocity({ x: 0, z: -1 })).toBeCloseTo(Math.PI, 9)
    expect(speedOf({ x: 3, z: 4 })).toBe(5)
  })
})
