/**
 * R4: the cryoablation suite's layout as data (node): the footprints are the brief's (the bake reads them), every contract spot a person stands at is
 * free, the seats are where the sim expects them, the bezels sit behind the live screen faces, and the lounge re-lay kept every id the bake replaces.
 */
import { describe, expect, it } from 'vitest'
import { buildLayout } from '@/scene/building/layout'
import { footprintDistance } from '@/scene/building/layout/builder'
import { LEVEL2_DX, levelOf } from '@/sim/levels'
import { isWalkable } from '@/sim/nav/layout'
import { CRYO_SUITE, areaById, type Area } from '@/sim/places'
import { CRYO_CONSOLE_SEAT, CRYO_FOOTPRINTS, CRYO_SEATS, CRYO_TABLE_APPROACH } from './cryoRoom'

const layout = buildLayout()
const upper = layout.footprints.filter((f) => levelOf(f.x) === 2)
const solid = upper.filter((f) => !f.overhead)
const nearest = (x: number, z: number) => {
  let best = { id: '', d: Infinity }
  for (const f of solid) {
    const d = footprintDistance(f, x, z)
    if (d < best.d) best = { id: f.id, d }
  }
  return best
}

describe('the cryoablation suite footprints', () => {
  it('has every footprint of the brief, at its rect (drawn x), in its room', () => {
    for (const r of CRYO_FOOTPRINTS) {
      const f = upper.find((q) => q.id === r.id)
      expect(f, r.id).toBeDefined()
      expect(f!.kind).toBe('rect')
      expect(f!.area).toBe(r.area)
      expect(f!.x - LEVEL2_DX - f!.hw).toBeCloseTo(r.x0, 6)
      expect(f!.x - LEVEL2_DX + f!.hw).toBeCloseTo(r.x1, 6)
      expect(f!.z - f!.hd).toBeCloseTo(r.z0, 6)
      expect(f!.z + f!.hd).toBeCloseTo(r.z1, 6)
      expect(!!f!.overhead, r.id).toBe(!!r.overhead)
    }
    // the CT gantry is centred on the machine anchor, the robot base on its spot, the console on its spot
    const at = (id: string) => upper.find((q) => q.id === id)!
    expect(at('l2:cryo:ct:gantry').x).toBeCloseTo(CRYO_SUITE.ct.machine.x, 6)
    expect(at('l2:cryo:ct:gantry').z).toBeCloseTo(CRYO_SUITE.ct.machine.z, 6)
    expect(at('l2:cryo:robot').x).toBeCloseTo(CRYO_SUITE.robot.base.at.x, 6)
    expect(at('l2:cryo:robot').hw * 2).toBeCloseTo(CRYO_SUITE.robot.size.w, 6)
    expect(at('l2:cryo:console').x).toBeCloseTo(CRYO_SUITE.console.at.at.x, 6)
    expect(at('l2:cryo:console').z).toBeCloseTo(CRYO_SUITE.console.at.at.z, 6)
  })

  it('keeps every contract spot a person stands at walkable and 0.3 m or more from every footprint', () => {
    const s = CRYO_SUITE.staff
    const spots: [string, { x: number; z: number }][] = [
      ['insert', s.insert.at],
      ['atConsole', s.atConsole.at],
      ['sedation', s.sedation.at],
      ['assist', s.assist.at],
      ['stretcherPark', s.stretcherPark.at],
      ...s.clean.map((c, i) => [`clean ${i}`, c.at] as [string, { x: number; z: number }]),
      ...s.base.map((c, i) => [`base ${i}`, c.at] as [string, { x: number; z: number }]),
      ['viewing', CRYO_SUITE.viewing.at],
    ]
    for (const [name, p] of spots) {
      const n = nearest(p.x, p.z)
      expect(n.d, `${name} is ${n.d.toFixed(2)} m from ${n.id}`).toBeGreaterThanOrEqual(0.3 - 1e-9)
      expect(isWalkable(p.x, p.z, 0.3), name).toBe(true)
    }
  })

  it('the robot mount stands over the robot base, the target lies over the table, the table travels from out to in through the gantry', () => {
    const m = CRYO_SUITE.robot.mount
    const base = upper.find((q) => q.id === 'l2:cryo:robot')!
    expect(footprintDistance(base, m.x, m.z)).toBe(0)
    const table = upper.find((q) => q.id === 'l2:cryo:ct:table')!
    expect(footprintDistance(table, CRYO_SUITE.target.x, CRYO_SUITE.target.z)).toBe(0)
    const gantry = upper.find((q) => q.id === 'l2:cryo:ct:gantry')!
    expect(footprintDistance(gantry, CRYO_SUITE.ct.table.in.x, CRYO_SUITE.ct.table.in.z)).toBe(0)
  })
})

describe('the cryoablation suite seats', () => {
  const seat = (id: string) => layout.seats.find((s) => s.id === id)!

  it('the CT table: lying, head west, at the table out position, approached at the table foot', () => {
    const s = seat(CRYO_SEATS.table)
    const t = CRYO_SUITE.ct.table
    expect(s.kind).toBe('scanTable')
    expect(s.pose).toBe('lie')
    expect(s.area).toBe('l2Cryo')
    expect(s.height).toBeCloseTo(t.height, 9)
    expect(s.x).toBeCloseTo(t.out.x, 9)
    expect(s.z).toBeCloseTo(t.out.z, 9)
    expect(Math.sin(s.heading)).toBeCloseTo(1, 9)
    expect(s.approach.x).toBeCloseTo(CRYO_TABLE_APPROACH.x + LEVEL2_DX, 9)
    expect(s.approach.z).toBeCloseTo(CRYO_TABLE_APPROACH.z, 9)
  })

  it('the two control seats face the glass, behind their desks, approached from behind', () => {
    for (const [id, spot] of [
      [CRYO_SEATS.ct, CRYO_SUITE.seats.ctConsole],
      [CRYO_SEATS.robot, CRYO_SUITE.seats.robotStation],
    ] as const) {
      const s = seat(id)
      expect(s.kind, id).toBe('console')
      expect(s.pose, id).toBe('sit')
      expect(s.area, id).toBe('l2CryoControl')
      expect(s.height).toBe(CRYO_CONSOLE_SEAT)
      expect([s.x, s.z]).toEqual([spot.at.x, spot.at.z])
      expect(Math.cos(s.heading)).toBeCloseTo(1, 9)
      expect(s.approach.z, id).toBeLessThan(s.z)
      const a = areaById(s.area as Area['id']).rect
      expect(s.approach.z).toBeGreaterThan(a.z0 + 0.5)
    }
  })
})

describe('the cryoablation suite prims', () => {
  const prims = layout.prims.filter((p) => levelOf(p.position[0]) === 2)

  it('a dark bezel sits just behind every live screen face (the face 3 mm proud of it), facing the same way', () => {
    const s = CRYO_SUITE.screens
    const anchors = [s.roomPlan, s.roomLive, s.ctConsole, s.robotStation, { ...CRYO_SUITE.console.screen, heading: CRYO_SUITE.console.screen.heading }]
    for (const a of anchors) {
      const bez = prims.find((p) => p.mat === 'metalDark' && Math.abs(p.size[0] - (a.w + 0.04)) < 1e-6 && Math.abs(p.size[1] - (a.h + 0.04)) < 1e-6 && Math.hypot(p.position[0] - a.x, p.position[2] - a.z) < 0.03)
      expect(bez, `bezel at ${a.x - LEVEL2_DX}, ${a.z}`).toBeDefined()
      expect(Math.abs(Math.cos(bez!.rotationY - a.heading) - 1)).toBeLessThan(1e-9)
      // the bezel's centre is 1.8 cm behind the face along its normal
      const tilt = 'tilt' in a ? (a.tilt as number) : 0
      const nx = Math.sin(a.heading) * Math.cos(tilt)
      const nz = Math.cos(a.heading) * Math.cos(tilt)
      const back = (a.x - bez!.position[0]) * nx + (a.y - bez!.position[1]) * Math.sin(tilt) + (a.z - bez!.position[2]) * nz
      expect(back).toBeCloseTo(0.018, 4)
    }
  })

  it('never casts, and the CT itself is not drawn here (it is live)', () => {
    const inSuite = prims.filter((p) => p.position[2] > 10 && p.position[2] < 22 && p.position[0] - LEVEL2_DX < -53)
    for (const p of inSuite) expect(p.castShadow).toBe(false)
    const gantry = CRYO_FOOTPRINTS.find((r) => r.id === 'l2:cryo:ct:gantry')!
    const onGantry = inSuite.filter((p) => {
      const x = p.position[0] - LEVEL2_DX
      return x > gantry.x0 && x < gantry.x1 && p.position[2] > gantry.z0 && p.position[2] < gantry.z1 && p.position[1] > 0.05
    })
    expect(onGantry).toEqual([])
  })
})

describe('the re-laid family lounge', () => {
  it('keeps every lounge id the authored zone replaces, all inside z 2..10', () => {
    const ids = upper.filter((f) => f.area === 'l2Lounge').map((f) => f.id)
    for (const id of ['recliner0', 'recliner1', 'recliner2', 'recliner3', 'side5.1', 'side7.3', 'sofa0', 'sofa1', 'table0', 'table1', 'rug', 'tea', 'cooler', 'plantN', 'plantS']) {
      expect(ids, id).toContain(`l2:lounge:${id}`)
    }
    for (const f of upper.filter((q) => q.area === 'l2Lounge')) {
      expect(f.z - f.hd, f.id).toBeGreaterThan(2)
      expect(f.z + f.hd, f.id).toBeLessThan(10)
    }
  })

  it('the recovery supply cabinet runs z 12.2..15.6, clear of both cryo doors', () => {
    const c = upper.find((f) => f.id === 'l2:pacu:supply')!
    expect(c.z - c.hd).toBeCloseTo(12.2, 6)
    expect(c.z + c.hd).toBeCloseTo(15.6, 6)
  })
})
