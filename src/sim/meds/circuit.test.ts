import { describe, expect, it } from 'vitest'
import { BANDS, CORE, PHARMACY, ROBOT, ROOMS } from '../places'
import type { WardId } from '../types'
import { CIRCUITS, drawerS, pointAt, type PathPoint } from './circuit'

const WARDS: WardId[] = ['A', 'B']
const p: PathPoint = { x: 0, z: 0, heading: 0 }
const q: PathPoint = { x: 0, z: 0, heading: 0 }

function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

describe('robot circuits', () => {
  it('are closed loops of the expected length, the same for both wards', () => {
    expect(CIRCUITS.A.length).toBeCloseTo(136.4, 0)
    expect(CIRCUITS.B.length).toBeCloseTo(CIRCUITS.A.length, 9)
  })

  it('are continuous in position and heading everywhere (segments join up)', () => {
    for (const w of WARDS) {
      const c = CIRCUITS[w]
      const ds = 0.01
      pointAt(c, 0, p)
      for (let s = ds; s <= c.length + 1e-9; s += ds) {
        pointAt(c, s, q)
        expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan(ds * 1.01)
        // tightest turn is r = 0.7 m: 0.0143 rad per centimetre
        expect(Math.abs(angleDiff(p.heading, q.heading))).toBeLessThan(0.016)
        p.x = q.x
        p.z = q.z
        p.heading = q.heading
      }
    }
  })

  it('ward B is ward A mirrored in z', () => {
    for (let s = 0; s < CIRCUITS.A.length; s += 0.37) {
      pointAt(CIRCUITS.A, s, p)
      pointAt(CIRCUITS.B, s, q)
      expect(q.x).toBeCloseTo(p.x, 9)
      expect(q.z).toBeCloseTo(-p.z, 9)
    }
  })

  it('stays in the corridors or inside the core, clear of the MedVend island and the walls', () => {
    const half = ROBOT.podSize.w / 2
    const isl = PHARMACY.island
    for (const w of WARDS) {
      const c = CIRCUITS[w]
      for (let s = 0; s < c.length; s += 0.05) {
        pointAt(c, s, p)
        const inCore = p.x > CORE.x0 && p.x < CORE.x1 && Math.abs(p.z) < BANDS.innerWall
        if (inCore) {
          // clear of the island by the pod's half width plus a margin
          const clearX = p.x < isl.x0 - half || p.x > isl.x1 + half
          const clearZ = p.z < isl.z0 - half - 0.1 || p.z > isl.z1 + half + 0.1
          expect(clearX || clearZ).toBe(true)
        } else {
          const az = Math.abs(p.z)
          expect(az).toBeGreaterThanOrEqual(BANDS.innerWall - 1e-9)
          // the pod body stays off the room wall
          expect(az + half).toBeLessThanOrEqual(BANDS.roomWall + 1e-9)
          expect(Math.abs(p.x)).toBeLessThanOrEqual(ROBOT.uturnX + 1.3 + 1e-9)
        }
      }
    }
  })

  it('orders its stops along the path: rank, docks, exit, then drawers 1..8 eastbound', () => {
    for (const w of WARDS) {
      const c = CIRCUITS[w]
      expect(c.rankHead).toBeCloseTo(8, 6)
      expect(c.docks[0]).toBeGreaterThan(c.rankHead)
      expect(c.docks[1]).toBeGreaterThan(c.docks[0])
      expect(c.exitDoor).toBeGreaterThan(c.docks[1])
      let prev = c.exitDoor
      for (const r of ROOMS.filter((x) => x.ward === w)) {
        const s = drawerS(r.id)
        expect(s).toBeGreaterThan(prev)
        prev = s
        pointAt(c, s, p)
        expect(Math.hypot(p.x - r.podDock.x, p.z - r.podDock.z)).toBeLessThan(0.05)
      }
    }
  })

  it('has room in the rank for every pod of the ward', () => {
    const spacing = ROBOT.podSize.l + 0.45
    expect(CIRCUITS.A.rankHead - (ROBOT.podsPerWard - 1) * spacing).toBeGreaterThanOrEqual(0)
  })
})
