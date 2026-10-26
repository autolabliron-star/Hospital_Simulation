/**
 * The body of a crowd walker moves like a body: no sideways lurches and no pivots on a waypoint.
 *
 * Measured on single walkers sent between seeded seat approaches across the ground floor (no one else in the way, so all of it is the path, the
 * keep-right lane and the corners):
 *   - the keep-right lane eases in and out (crowd.ts LAT_ACC): the lane offset's speed changes by at most LAT_ACC per second while it moves;
 *     before, it jumped from 0 to 0.9 m/s in one step at every lane change and corner;
 *   - corners are walked on a curve (follower.ts roundCorners, crowd.ts CORNER_R) wherever the curve is walkable: the direction of the body
 *     changes by more than 6 rad/s (a third of a radian in a 60 Hz step) in a small fraction of the steps; before, every corner was a pivot;
 *   - and nothing else changes: everyone arrives exactly on the target, on walkable ground.
 */
import { describe, expect, it } from 'vitest'
import { levelOf } from '../levels'
import { mulberry32 } from '../rng'
import { defaultSeats } from '../seats'
import { Crowd, type CrowdWalker } from './crowd'
import { isWalkable } from './layout'

const DT = 1 / 60

interface Run {
  /** Per step while the body moves faster than 0.5 m/s: how fast its direction turns (rad/s). */
  turn: number[]
  /** Per step: how much the lane offset's velocity changed (m/s^2). */
  laneAcc: number[]
  arrived: number
  missed: number
  offGround: number
}

function walkRoutes(seed: number, routes: number): Run {
  const seats = defaultSeats().filter((s) => s.kind !== 'bed' && levelOf(s.x) === 1)
  const rnd = mulberry32(seed)
  const out: Run = { turn: [], laneAcc: [], arrived: 0, missed: 0, offGround: 0 }
  for (let k = 0; k < routes; k++) {
    const a = seats[Math.floor(rnd() * seats.length)].approach
    const b = seats[Math.floor(rnd() * seats.length)].approach
    const crowd = new Crowd()
    const w = crowd.createWalker({ id: `w${k}` }) as CrowdWalker
    w.place(a.x, a.z, 0)
    w.goTo(b)
    const wi = w as unknown as { lx: number; lz: number }
    let px = w.x
    let pz = w.z
    let pdir = NaN
    let plx = wi.lx
    let plz = wi.lz
    let pvx = 0
    let pvz = 0
    let st = 'moving'
    for (let i = 0; i < 60 * 120 && st !== 'arrived'; i++) {
      crowd.beginStep()
      st = w.step(DT, 1.3)
      const dx = w.x - px
      const dz = w.z - pz
      const v = Math.hypot(dx, dz) / DT
      if (v > 0.5) {
        const dir = Math.atan2(dx, dz)
        if (!Number.isNaN(pdir)) {
          let d = dir - pdir
          d -= 2 * Math.PI * Math.round(d / (2 * Math.PI))
          out.turn.push(Math.abs(d) / DT)
        }
        pdir = dir
      } else pdir = NaN
      const lvx = (wi.lx - plx) / DT
      const lvz = (wi.lz - plz) / DT
      out.laneAcc.push(Math.hypot(lvx - pvx, lvz - pvz) / DT)
      pvx = lvx
      pvz = lvz
      plx = wi.lx
      plz = wi.lz
      px = w.x
      pz = w.z
      if (!isWalkable(w.x, w.z, 0.2)) out.offGround++
    }
    if (st === 'arrived' && Math.hypot(w.x - b.x, w.z - b.z) < 1e-6) out.arrived++
    else out.missed++
  }
  return out
}

const share = (a: number[], over: number) => a.filter((x) => x > over).length / Math.max(1, a.length)

describe('a crowd walker moves like a body', () => {
  const run = walkRoutes(7, 40)

  it('arrives exactly on every target, on walkable ground', () => {
    expect(run.missed).toBe(0)
    expect(run.arrived).toBe(40)
    expect(run.offGround).toBe(0)
  })

  it('eases the keep-right lane in and out: its speed almost never jumps (more than 10 m/s^2) from one step to the next', () => {
    // (measured with seed 7: 0.09 % of the steps after, 1.3 % before; what is left is the snap onto the spot at the very end of a route)
    expect(share(run.laneAcc, 10)).toBeLessThan(0.003)
  })

  it('bends round corners instead of pivoting on them: the direction of the body seldom turns faster than 6 rad/s', () => {
    expect(run.turn.length).toBeGreaterThan(10000)
    // (measured with seed 7: 0.25 % of the moving steps after, 1.4 % before; what is left is U-turns and corners with no room for a curve)
    expect(share(run.turn, 6)).toBeLessThan(0.006)
  })
})
