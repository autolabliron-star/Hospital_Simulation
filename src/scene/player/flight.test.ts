import { describe, expect, it } from 'vitest'
import { OVERVIEW_FOV_DEG, overviewPose, poseToLookAt, type LookAt } from '@/scene/camera/cameraApi'
import { copyFlightState, ModeFlight, newFlightState, type FlightState } from './flight'
import { shoulderPose } from './chaseMath'
import { CHASE, FLIGHT } from './tuning'

const DT = 1 / 60

function walkState(): FlightState {
  const pose = shoulderPose({ x: -66, y: 0, z: 0 }, Math.PI / 2)
  return { px: pose.position.x, py: pose.position.y, pz: pose.position.z, tx: pose.target.x, ty: pose.target.y, tz: pose.target.z, fov: CHASE.fov }
}

function overviewState(): FlightState {
  const look: LookAt = poseToLookAt(overviewPose(OVERVIEW_FOV_DEG, 16 / 9), { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 })
  return { ...look, fov: OVERVIEW_FOV_DEG }
}

const same = (a: FlightState, b: FlightState): void => {
  expect([a.px, a.py, a.pz, a.tx, a.ty, a.tz, a.fov]).toEqual([b.px, b.py, b.pz, b.tx, b.ty, b.tz, b.fov])
}

describe('the walk <-> overview flights', () => {
  it('start exactly where the camera was, and END EXACTLY at the destination, in the configured time', () => {
    for (const [from, to] of [
      [overviewState(), walkState()],
      [walkState(), overviewState()],
    ] as const) {
      const f = new ModeFlight()
      expect(f.start(from, to)).toBe(true)
      same(f.now, from)
      let ended = false
      let frames = 0
      while (!ended && frames < 600) {
        ended = f.tick(DT)
        frames++
      }
      expect(ended).toBe(true)
      expect(frames * DT).toBeGreaterThanOrEqual(FLIGHT.seconds - DT)
      expect(frames * DT).toBeLessThan(FLIGHT.seconds + 2 * DT)
      same(f.now, to) // the destination's own numbers, not an interpolation that landed near them
      expect(f.active).toBe(false)
      expect(f.tick(DT)).toBe(false) // and it stays
      same(f.now, to)
    }
  })

  it('ends at the same numbers whatever the frame rate, and a long hitch does not skip it forward', () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 30, 0.05, 0.2]) {
      const f = new ModeFlight()
      f.start(overviewState(), walkState())
      let n = 0
      while (!f.tick(dt) && n < 2000) n++
      same(f.now, walkState())
    }
    // a 2 s frame counts as 0.05 s: the flight is still going
    const g = new ModeFlight()
    g.start(overviewState(), walkState())
    g.tick(2)
    expect(g.active).toBe(true)
    expect(g.t).toBeCloseTo(FLIGHT.maxFrameDt, 9)
  })

  it('moves smoothly: the camera never jumps between frames and the lens eases from one to the other', () => {
    const from = overviewState()
    const to = walkState()
    const f = new ModeFlight()
    f.start(from, to)
    let last = copyFlightState(f.now, newFlightState())
    let worst = 0
    let lastFov = from.fov
    let fovNeverFalls = true
    while (!f.tick(DT)) {
      const n = f.now
      worst = Math.max(worst, Math.hypot(n.px - last.px, n.py - last.py, n.pz - last.pz))
      if (n.fov < lastFov - 1e-12) fovNeverFalls = false
      lastFov = n.fov
      last = copyFlightState(n, last)
    }
    // the whole hop is about a hundred metres in 0.9 s; the biggest frame is the middle of the ease (three times the mean speed)
    expect(worst).toBeLessThan(12)
    expect(fovNeverFalls).toBe(true) // 35 -> 60 only rises
    // the other way, the lens falls
    const g = new ModeFlight()
    g.start(to, from)
    g.tick(DT * 20)
    expect(g.now.fov).toBeLessThan(CHASE.fov)
    expect(g.now.fov).toBeGreaterThan(OVERVIEW_FOV_DEG)
  })

  it('looks at where it is going: mid-flight the camera is above the building, swooping, not through the floor', () => {
    const f = new ModeFlight()
    f.start(overviewState(), walkState())
    let lowest = Infinity
    while (!f.tick(DT)) lowest = Math.min(lowest, f.now.py)
    expect(lowest).toBeGreaterThan(0)
  })

  it('with zero seconds (reduced motion) it is over at once, and the state is the destination', () => {
    const f = new ModeFlight()
    expect(f.start(overviewState(), walkState(), 0)).toBe(false)
    expect(f.active).toBe(false)
    same(f.now, walkState())
  })

  it('can be cancelled, and restarted from wherever it was (reversing a flight)', () => {
    const f = new ModeFlight()
    f.start(overviewState(), walkState())
    f.tick(0.3)
    const mid = copyFlightState(f.now, newFlightState())
    f.cancel()
    expect(f.active).toBe(false)
    f.start(mid, overviewState())
    same(f.now, mid)
    let n = 0
    while (!f.tick(DT) && n < 600) n++
    same(f.now, overviewState())
  })
})
