import { describe, expect, it } from 'vitest'
import { GLIDE_MAX_SECONDS, GLIDE_MIN_SECONDS, Glide, catmullRom, glideSeconds, hermite, joinDirection, shortestTurn, smootherstep, type GlidePose } from './glide'
import { EYE, SHOTS, nextShot, prevShot, shotYaw } from './shots'

const pose = (i: number): GlidePose => ({ x: SHOTS[i].x, z: SHOTS[i].z, yaw: shotYaw(SHOTS[i]), pitch: SHOTS[i].pitch })

describe('the easing and the spline', () => {
  it('smootherstep rests at both ends and is monotone', () => {
    expect(smootherstep(0)).toBe(0)
    expect(smootherstep(1)).toBe(1)
    expect(smootherstep(-3)).toBe(0)
    expect(smootherstep(4)).toBe(1)
    let last = 0
    for (let i = 1; i <= 100; i++) {
      const v = smootherstep(i / 100)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
    expect(smootherstep(0.01)).toBeLessThan(0.0001)
  })
  it('catmull-rom passes through p1 and p2', () => {
    expect(catmullRom(0, 1, 5, 9, 0)).toBeCloseTo(1, 12)
    expect(catmullRom(0, 1, 5, 9, 1)).toBeCloseTo(5, 12)
    // a straight, evenly spaced line stays a straight line
    expect(catmullRom(0, 1, 2, 3, 0.5)).toBeCloseTo(1.5, 12)
  })
  it('hermite passes through both ends and is a straight line for chord-length tangents along it', () => {
    expect(hermite(2, 5, 7, -1, 0)).toBeCloseTo(2, 12)
    expect(hermite(2, 5, 7, -1, 1)).toBeCloseTo(7, 12)
    expect(hermite(0, 4, 4, 4, 0.25)).toBeCloseTo(1, 12)
  })
  it('the join direction is the bisector going on, the move itself when the neighbour is behind', () => {
    const o = { x: 0, z: 0 }
    joinDirection(1, 0, 1, 0, o)
    expect([o.x, o.z]).toEqual([1, 0])
    joinDirection(1, 0, 0, 1, o)
    expect(o.x).toBeGreaterThan(0.7)
    expect(o.z).toBeGreaterThan(0.3)
    expect(Math.hypot(o.x, o.z)).toBeCloseTo(1, 12)
    joinDirection(1, 0, -1, 0, o)
    expect([o.x, o.z]).toEqual([1, 0])
    joinDirection(1, 0, -1, 0.05, o) // nearly opposed: still essentially the move itself
    expect(o.x).toBeGreaterThan(0.99)
  })
  it('the shortest turn goes the short way round', () => {
    expect(shortestTurn(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9)
    expect(shortestTurn(0, 1)).toBeCloseTo(1, 12)
    expect(Math.abs(shortestTurn(-3, 3))).toBeLessThan(Math.PI + 1e-9)
  })
  it('a glide lasts between 6 and 8 seconds', () => {
    expect(glideSeconds(0)).toBe(GLIDE_MIN_SECONDS)
    expect(glideSeconds(100)).toBe(GLIDE_MAX_SECONDS)
    for (let i = 0; i < SHOTS.length; i++) {
      const a = SHOTS[i]
      const b = SHOTS[nextShot(i)]
      const s = glideSeconds(Math.hypot(b.x - a.x, b.z - a.z))
      expect(s).toBeGreaterThanOrEqual(6)
      expect(s).toBeLessThanOrEqual(8)
    }
  })
})

describe('a glide between the lobby shots', () => {
  it('starts and ends exactly on the shots, with no jump and no NaN, at 30, 60 and 144 fps', () => {
    for (const hz of [60, 144, 30]) {
      for (let i = 0; i < SHOTS.length; i++) {
        const j = nextShot(i)
        const g = new Glide()
        g.start(pose(i), pose(j), pose(prevShot(i)), pose(nextShot(j)))
        expect(g.active).toBe(true)
        expect([g.x, g.z]).toEqual([SHOTS[i].x, SHOTS[i].z])
        const dt = 1 / hz
        let lastX = g.x
        let lastZ = g.z
        let maxStep = 0
        let frames = 0
        let done = false
        while (!done && frames < 20 * hz) {
          done = g.tick(dt)
          frames++
          expect(Number.isFinite(g.x + g.z + g.yaw + g.pitch)).toBe(true)
          maxStep = Math.max(maxStep, Math.hypot(g.x - lastX, g.z - lastZ))
          lastX = g.x
          lastZ = g.z
        }
        expect(done).toBe(true)
        expect(g.active).toBe(false)
        expect(g.x).toBe(SHOTS[j].x)
        expect(g.z).toBe(SHOTS[j].z)
        expect(shortestTurn(g.yaw, shotYaw(SHOTS[j]))).toBeCloseTo(0, 9)
        // a gentle dolly: the peak is the ease's (1.875x the average speed over the chord) plus a little for the bend, never more than 1.3x that
        const chord = Math.hypot(SHOTS[j].x - SHOTS[i].x, SHOTS[j].z - SHOTS[i].z)
        expect(maxStep * hz).toBeLessThan(((1.875 * chord) / g.seconds) * 1.3 + 0.05)
        expect(frames / hz).toBeGreaterThanOrEqual(6 - 1 / hz)
        expect(frames / hz).toBeLessThanOrEqual(8 + 1 / hz)
      }
    }
  })
  it('starts at rest (the first frame barely moves) and takes the short way round in yaw', () => {
    const g = new Glide()
    g.start(pose(0), pose(1), pose(3), pose(2))
    g.tick(1 / 60)
    expect(Math.hypot(g.x - SHOTS[0].x, g.z - SHOTS[0].z)).toBeLessThan(1e-3)
    const total = shortestTurn(shotYaw(SHOTS[0]), shotYaw(SHOTS[1]))
    expect(Math.abs(total)).toBeLessThanOrEqual(Math.PI)
    let prev = g.yaw
    let swing = 0
    while (g.active) {
      g.tick(1 / 60)
      swing += Math.abs(shortestTurn(prev, g.yaw))
      prev = g.yaw
    }
    // never goes the long way: the swung angle is the short turn
    expect(swing).toBeLessThan(Math.abs(total) + 0.01)
  })
  it('a glide can start away from any shot (mirrored control points) and can be cancelled', () => {
    const g = new Glide()
    g.start({ x: -55, z: -2, yaw: 0.3, pitch: 0.1 }, pose(2), null, null)
    for (let i = 0; i < 120; i++) g.tick(1 / 60)
    expect(g.active).toBe(true)
    g.cancel()
    expect(g.active).toBe(false)
    expect(g.tick(1 / 60)).toBe(false)
  })
})

describe('the shots', () => {
  it('are the four lobby shots at eye height 1.6 m, looping', () => {
    expect(EYE).toBe(1.6)
    expect(SHOTS).toHaveLength(4)
    expect(SHOTS[0]).toMatchObject({ x: -61, z: 0, lookX: -44, lookZ: 0 })
    expect(SHOTS[3]).toMatchObject({ x: -55.5, z: 0.5, lookX: -59.6, lookZ: 5.3 })
    expect(nextShot(3)).toBe(0)
    expect(nextShot(-1)).toBe(0)
    expect(prevShot(0)).toBe(3)
  })
  it('look along +x at shot 1 and -x at shot 3 (compass yaw)', () => {
    expect(shotYaw(SHOTS[0])).toBeCloseTo(Math.PI / 2, 9)
    expect(shotYaw(SHOTS[2])).toBeCloseTo(-Math.PI / 2, 9)
  })
})
