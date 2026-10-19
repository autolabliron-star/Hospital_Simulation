/**
 * W4: the static health kiosks (rooms/healthKiosks.ts): inside the lobby's south-east strip, the tower at most 2.3 m, the stand spot at the middle of the
 * platform, the arm tunnel on the ARM_IN line, the grips where the hands land, the stool a seat the nav can reach, clear of the lobby's routes and of the
 * check-in kiosks, palette materials only.
 */
import { describe, expect, it } from 'vitest'
import { getLayout } from '@/scene/building/layout'
import { LayoutBuilder, UNRESOLVED_SEATS, footprintDistance } from '@/scene/building/layout/builder'
import type { Footprint, Prim } from '@/scene/building/layout/types'
import { ARM_IN, GRIP, KIOSK_SEAT_HEIGHT, armInTunnel } from '@/scene/actors/crowd/armIn'
import { MAT } from '@/scene/materials'
import { HEALTH_KIOSKS, LOBBY, areaById } from '@/sim/places'
import { NAV, NAV_WARNINGS } from '@/sim/nav/graph'
import { isWalkable } from '@/sim/nav/layout'
import { buildHealthKiosks } from './healthKiosks'
import { KIOSKS, PLATFORM, TOWER, WING } from '@/scene/kiosks/layout'

/** Only what this builder adds. */
function mine(): LayoutBuilder {
  const b = new LayoutBuilder()
  buildHealthKiosks(b)
  return b
}
const own = mine()
const layout = getLayout()
const top = (p: Prim): number => p.position[1] + p.size[1] / 2

/** Every prim of kiosk `i`: those nearer to its tower, platform or wing than to the other kiosk's. */
function primsOf(i: number): Prim[] {
  const k = HEALTH_KIOSKS[i]
  const cx = (k.tower.x + k.wing.x) / 2
  return own.prims.filter((p) => Math.abs(p.position[0] - cx) < 0.9 && Math.abs(p.position[0] - (HEALTH_KIOSKS[1 - i].tower.x + HEALTH_KIOSKS[1 - i].wing.x) / 2) > Math.abs(p.position[0] - cx) - 1e-9)
}

describe('placement', () => {
  it('builds prims, footprints and two seats for the two kiosks', () => {
    expect(own.prims.length).toBeGreaterThan(80)
    expect(own.footprints.map((f) => f.id).sort()).toEqual(['health:stool:0', 'health:stool:1', 'health:tower:0', 'health:tower:1', 'health:wing:0', 'health:wing:1'])
    expect(own.pendingSeats.map((s) => s.spec.id).sort()).toEqual(['kioskBp:0', 'kioskBp:1'])
  })

  it('stays inside the lobby strip x -54.5..-51.2 (within 10 cm) and in front of the south wall', () => {
    for (const p of own.prims) {
      const half = Math.max(p.size[0], p.size[2]) / 2
      expect(p.position[0] - half, `${p.mat} at ${p.position}`).toBeGreaterThan(-54.5 - 0.1)
      expect(p.position[0] + half, `${p.mat} at ${p.position}`).toBeLessThan(-51.2 + 0.1)
      expect(p.position[2] + half).toBeLessThan(areaById('lobby').rect.z1 - 0.1)
    }
    for (const f of own.footprints) expect(f.area).toBe('lobby')
  })

  it('every tower is at most 2.3 m tall and stands 2.0 m or more (the overhead arm is over the stand spot)', () => {
    for (let i = 0; i < 2; i++) {
      const tallest = Math.max(...primsOf(i).map(top))
      expect(tallest).toBeLessThanOrEqual(2.3)
      expect(tallest).toBeGreaterThan(2.0)
      expect(tallest).toBeCloseTo(TOWER.capTop, 2)
      // the sensor puck hangs over the platform's middle, clear of a tall person's crown (1.745 x 1.06)
      const a = KIOSKS[i]
      expect(a.puck.y).toBeGreaterThan(1.745 * 1.06 + 0.05)
      expect(a.puck.x).toBeCloseTo(HEALTH_KIOSKS[i].stand.at.x, 9)
      expect(a.puck.z).toBeCloseTo(HEALTH_KIOSKS[i].stand.at.z, 9)
    }
  })

  it('the weighing platform is centred on the stand spot within 1 cm, 0.50 x 0.05 x 0.46, and has no footprint (you stand on it)', () => {
    for (let i = 0; i < 2; i++) {
      const s = HEALTH_KIOSKS[i].stand.at
      const base = own.prims.find((p) => p.shape === 'roundedBox' && p.mat === 'whitePlastic' && Math.abs(p.size[0] - PLATFORM.w) < 1e-6)!
      expect(base).toBeDefined()
      const mine = own.prims.filter((p) => p.shape === 'roundedBox' && p.mat === 'whitePlastic' && Math.abs(p.size[0] - PLATFORM.w) < 1e-6)[i]
      expect(Math.hypot(mine.position[0] - s.x, mine.position[2] - s.z)).toBeLessThan(0.01)
      expect(mine.size[2]).toBeCloseTo(PLATFORM.d, 6)
      // the rubber top ends at 0.05: the height the sim stands people at
      const plate = own.prims.filter((p) => p.mat === 'rubber' && Math.abs(p.size[0] - (PLATFORM.w - 0.04)) < 1e-6)[i]
      expect(top(plate)).toBeCloseTo(PLATFORM.h, 6)
      expect(own.footprints.some((f) => Math.hypot(f.x - s.x, f.z - s.z) < 0.01)).toBe(false)
    }
  })

  it('the tower faces north: its screen side is toward the lobby and the stand spot is in front of it', () => {
    for (let i = 0; i < 2; i++) {
      const k = HEALTH_KIOSKS[i]
      expect(k.stand.at.z).toBeLessThan(k.tower.z)
      expect(KIOSKS[i].screen.heading).toBeCloseTo(Math.PI, 9)
      expect(KIOSKS[i].screen.at.z).toBeLessThan(KIOSKS[i].frontZ)
      expect(KIOSKS[i].screen.at.z).toBeGreaterThan(KIOSKS[i].frontZ - 0.06)
      expect(KIOSKS[i].bpScreen.heading).toBeCloseTo(Math.PI, 9)
    }
  })
})

describe('the arm tunnel and the grips are where the hands go', () => {
  it('the tunnel axis passes through the ARM_IN point (within 3 cm) at the seat height plus ARM_IN.up, mouth and far end on the line', () => {
    for (let i = 0; i < 2; i++) {
      const seat = HEALTH_KIOSKS[i].bpSeat
      const t = armInTunnel({ x: seat.at.x, z: seat.at.z, heading: seat.heading })
      const a = KIOSKS[i].axis
      expect(Math.hypot(a.x - t.mouth.x, a.y - t.mouth.y)).toBeLessThan(0.03)
      expect(a.mouthZ).toBeCloseTo(t.mouth.z, 6)
      expect(a.farZ).toBeCloseTo(t.far.z, 6)
      // the eight liner slabs ring that axis at the inner radius
      const liner = primsOf(i).filter((p) => p.mat === 'metalDark' && p.shape === 'box' && Math.abs(p.size[1] - 0.012) < 1e-9)
      expect(liner.length).toBe(8)
      for (const p of liner) {
        const rho = Math.hypot(p.position[0] - a.x, p.position[1] - a.y)
        expect(rho - p.size[1] / 2).toBeCloseTo(ARM_IN.radius, 6)
        expect(p.position[2] - p.size[2] / 2).toBeCloseTo(a.mouthZ, 6)
      }
      // the tunnel sits clear above the desk top and the unit's top above it
      expect(a.y - ARM_IN.radius - 0.03).toBeGreaterThan(WING.deskTop)
      expect(a.y).toBeCloseTo(KIOSK_SEAT_HEIGHT + ARM_IN.up, 9)
    }
  })

  it('the two grips stand where the hands land: x +-0.31, 1.04 up, 0.33 ahead of the stand spot (within 1 cm)', () => {
    for (let i = 0; i < 2; i++) {
      const s = HEALTH_KIOSKS[i].stand.at
      const bars = primsOf(i).filter((p) => p.shape === 'cylinder' && p.mat === 'frame')
      expect(bars.length).toBe(2)
      for (const bar of bars) {
        const dx = bar.position[0] - s.x
        expect(Math.abs(Math.abs(dx) - GRIP.side)).toBeLessThan(0.01)
        expect(Math.abs(bar.position[1] - GRIP.up)).toBeLessThan(0.01)
        expect(Math.abs(bar.position[2] - (s.z + GRIP.ahead))).toBeLessThan(0.01)
      }
      expect(bars[0].position[0]).not.toBeCloseTo(bars[1].position[0], 2)
    }
  })
})

describe('seats, footprints and routes', () => {
  it('every seat resolves, and the two stools are seats the nav graph reaches', () => {
    expect(UNRESOLVED_SEATS).toEqual([])
    for (let i = 0; i < 2; i++) {
      const seat = layout.seats.find((s) => s.id === `kioskBp:${i}`)!
      expect(seat).toBeDefined()
      expect(seat.kind).toBe('kioskBp')
      expect(seat.pose).toBe('sit')
      expect(seat.height).toBe(KIOSK_SEAT_HEIGHT)
      expect(seat.area).toBe('lobby')
      const spot = HEALTH_KIOSKS[i].bpSeat
      expect(Math.hypot(seat.x - spot.at.x, seat.z - spot.at.z)).toBeLessThan(0.01)
      expect(seat.heading).toBeCloseTo(spot.heading, 9)
      const d = Math.hypot(seat.approach.x - seat.x, seat.approach.z - seat.z)
      expect(d).toBeGreaterThanOrEqual(0.5 - 1e-9)
      expect(d).toBeLessThanOrEqual(1.0 + 1e-9)
      // the approach is walkable (0.3 m from every wall and solid) and joined to the graph
      expect(isWalkable(seat.approach.x, seat.approach.z, 0.3)).toBe(true)
      expect(NAV.has(`seat:kioskBp:${i}`)).toBe(true)
      expect(NAV_WARNINGS.filter((w) => w.includes('kioskBp'))).toEqual([])
    }
  })

  it('the stand spot is walkable: the tower footprint is clear of it by more than the body (0.3 m)', () => {
    for (let i = 0; i < 2; i++) {
      const s = HEALTH_KIOSKS[i].stand.at
      expect(isWalkable(s.x, s.z, 0.3)).toBe(true)
      const fp = own.footprints.find((f) => f.id === `health:tower:${i}`)!
      expect(footprintDistance(fp, s.x, s.z)).toBeGreaterThan(0.3)
      // and the tower footprint is flush with the back of the body, inside the wall
      expect(fp.z + fp.hd).toBeCloseTo(HEALTH_KIOSKS[i].tower.z + TOWER.d / 2, 6)
    }
  })

  it('keeps clear of the lobby\'s check-in kiosks (0.35 m) and of each other', () => {
    const checkIn = layout.footprints.filter((f) => f.id.startsWith('lobby:kiosk'))
    expect(checkIn.length).toBe(LOBBY.kiosks.length)
    for (const f of own.footprints) {
      for (const c of checkIn) {
        const d = c.kind === 'rect' ? Math.min(...[[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]].map(([sx, sz]) => footprintDistance(f, c.x + sx * c.hw, c.z + sz * c.hd))) : 9
        expect(d, `${f.id} vs ${c.id}`).toBeGreaterThan(0.35)
      }
    }
    const sorted: Footprint[] = own.footprints
    for (let a = 0; a < sorted.length; a++) {
      for (let c = a + 1; c < sorted.length; c++) {
        const pa = sorted[a]
        const pc = sorted[c]
        // no two of our solids overlap (a tower and its neighbour's wing may touch the same strip but not intersect)
        const near = footprintDistance(pa, pc.x, pc.z)
        expect(near, `${pa.id} vs ${pc.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('walkers pass: nothing of ours blocks the lobby\'s main routes, and the line of the guide keeps free (HEALTH_LINE, HEALTH_GUIDE)', () => {
    // the people nav graph is built from these footprints: it must still connect the kiosks' surroundings, with no warning naming us
    expect(NAV_WARNINGS.filter((w) => /health|kioskBp/.test(w))).toEqual([])
    for (const f of own.footprints) expect(footprintDistance(f, -53.15, 3.7)).toBeGreaterThan(0.5) // the front of the line
    for (const f of own.footprints) expect(footprintDistance(f, -51.0, 3.9)).toBeGreaterThan(0.5) // the guide's spot
  })
})

describe('materials', () => {
  it('uses only palette materials and no per-object colour', () => {
    for (const p of own.prims) {
      expect(p.mat in MAT, p.mat).toBe(true)
      expect(p.color).toBeUndefined()
    }
  })

  it('adds no draw calls of its own: nothing but palette prims (merged by the building) and no screens', () => {
    expect(own.prims.some((p) => p.shape === 'quad')).toBe(false)
    expect(own.consoleScreens.length).toBe(0)
    expect(own.labels.length).toBe(0)
  })
})
