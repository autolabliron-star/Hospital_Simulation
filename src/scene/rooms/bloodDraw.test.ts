import { describe, expect, it } from 'vitest'
import { LAB_CATALOGUE } from '@/content/lab'
import { getLayout } from '@/scene/building/layout'
import { UNRESOLVED_SEATS, footprintDistance } from '@/scene/building/layout/builder'
import type { Footprint, Prim } from '@/scene/building/layout'
import { ARM_IN, armInPoint, armInTunnel } from '@/scene/actors/crowd/armIn'
import { CABINET, HEAD, NEEDLE_TRAVEL, PREP, PREP_BIN_KIND, QUEUE_SCREEN, RAIL_Y, SEAT_HEIGHT, SEND, TILE_ANCHORS, TUNNEL, checkInFace, prepBinLocal, prepWorld, robotDims } from '@/scene/drawCentre/dims'
import { MAT } from '@/scene/materials'
import { DRAW_CENTRE, PNEUMATIC, areaById } from '@/sim/places'

const layout = getLayout()
const AREA = areaById('diagnostics').rect
const inArea = (p: { x: number; z: number }): boolean => p.x > AREA.x0 && p.x < AREA.x1 && p.z > AREA.z0 && p.z < AREA.z1

/** The prims of the draw centre: inside the diagnostics walls. */
const prims: Prim[] = layout.prims.filter((p) => inArea({ x: p.position[0], z: p.position[2] }) && p.shape !== 'plane')
const footprints = layout.footprints.filter((f) => f.area === 'diagnostics')
const seats = layout.seats.filter((s) => s.area === 'diagnostics')

function primsOf(mat: string, shape?: string): Prim[] {
  return prims.filter((p) => p.mat === mat && (shape === undefined || p.shape === shape))
}

describe('the seats', () => {
  it('has one robot chair per cabinet, facing it (+z), at the contract anchors, sitting at 0.45 m', () => {
    const chairs = seats.filter((s) => s.kind === 'drawChair')
    expect(chairs.map((s) => s.id).sort()).toEqual(['drawChair:robot:0', 'drawChair:robot:1', 'drawChair:robot:2'])
    for (const r of DRAW_CENTRE.robots) {
      const s = chairs.find((c) => c.id === `drawChair:robot:${r.index}`)!
      expect(s.x).toBeCloseTo(r.chair.at.x, 6)
      expect(s.z).toBeCloseTo(r.chair.at.z, 6)
      expect(s.heading).toBeCloseTo(r.chair.heading, 6)
      expect(s.pose).toBe('sit')
      expect(s.height).toBeCloseTo(SEAT_HEIGHT, 6)
      // it faces the cabinet: the bearing from the chair to the cabinet is the chair's heading
      expect(Math.atan2(r.cabinet.x - s.x, r.cabinet.z - s.z)).toBeCloseTo(s.heading, 6)
      // the approach is a walkable spot inside the room, beside the chair
      expect(inArea(s.approach)).toBe(true)
      expect(Math.hypot(s.approach.x - s.x, s.approach.z - s.z)).toBeLessThan(1.1)
    }
  })

  it('has the waiting bench at the contract anchors (waiting:draw:<i>, facing east) and no old two-chair corner', () => {
    for (const [i, b] of DRAW_CENTRE.bench.entries()) {
      const s = seats.find((x) => x.id === `waiting:draw:${i}`)!
      expect(s, `waiting:draw:${i}`).toBeDefined()
      expect(s.kind).toBe('waiting')
      expect(s.x).toBeCloseTo(b.at.x, 6)
      expect(s.z).toBeCloseTo(b.at.z, 6)
      expect(s.heading).toBeCloseTo(b.heading, 6)
    }
    expect(layout.seats.some((s) => s.id.startsWith('drawChair:diag'))).toBe(false)
    expect(layout.footprints.some((f) => f.id.startsWith('diag:draw') || f.id === 'imaging:hatch')).toBe(false)
  })

  it('leaves no seat without an approach spot', () => {
    expect(UNRESOLVED_SEATS).toEqual([])
  })
})

describe('the robots', () => {
  it('has a white cabinet 0.82 x 1.05 x 0.62 at every contract anchor, against the corridor wall', () => {
    for (const r of DRAW_CENTRE.robots) {
      const fp = footprints.find((f) => f.id === `draw:robot${r.index}`)!
      expect(fp.x).toBeCloseTo(r.cabinet.x, 6)
      expect(fp.z).toBeCloseTo(r.cabinet.z, 6)
      expect(fp.hw * 2).toBeCloseTo(CABINET.w, 6)
      expect(fp.hd * 2).toBeCloseTo(CABINET.d, 6)
      const body = prims.find((p) => p.mat === 'whitePlastic' && p.shape === 'roundedBox' && Math.abs(p.position[0] - r.cabinet.x) < 1e-6 && Math.abs(p.position[2] - r.cabinet.z) < 1e-6)!
      expect(body.size[0]).toBeCloseTo(CABINET.w, 6)
      expect(body.size[2]).toBeCloseTo(CABINET.d, 6)
      expect(body.position[1] + body.size[1] / 2).toBeCloseTo(CABINET.h, 6)
      // 0.1 m of wall face behind it at most
      expect(AREA.z1 - 0.1 - (r.cabinet.z + CABINET.d / 2)).toBeLessThan(0.2)
    }
  })

  it('has the teal band at 0.95 on every cabinet, and two e-stops (yellow ring + red mushroom) on each', () => {
    for (const r of DRAW_CENTRE.robots) {
      const near = (p: Prim): boolean => Math.abs(p.position[0] - r.cabinet.x) < 0.5 && p.position[2] > r.cabinet.z - 0.5 && p.position[2] < r.cabinet.z
      const band = prims.filter((p) => p.mat === 'fabricTeal' && p.shape === 'box' && near(p) && Math.abs(p.position[1] - 0.955) < 0.01)
      expect(band.length, `band ${r.index}`).toBe(1)
      const rings = prims.filter((p) => p.mat === 'tinted' && p.color === '#f2c230' && near(p))
      const caps = prims.filter((p) => p.mat === 'tinted' && p.color === '#d63a3a' && near(p))
      expect(rings.length, `rings ${r.index}`).toBe(2)
      expect(caps.length, `caps ${r.index}`).toBe(2)
    }
  })

  it('has an enclosed arm tunnel on the crowd arm-in line, within 3 cm, with a clear hood and a hand grip', () => {
    for (const r of DRAW_CENTRE.robots) {
      const d = robotDims(r.index)
      const frame = { x: r.chair.at.x, z: r.chair.at.z, heading: r.chair.heading, seatHeight: SEAT_HEIGHT }
      const hand = armInPoint(frame)
      const tun = armInTunnel(frame)
      // the line is the crowd's: the middle of the left hand, and the tunnel's mouth on the axis
      expect(d.arm.x).toBeCloseTo(r.chair.at.x + ARM_IN.left, 9)
      expect(d.arm.y).toBeCloseTo(SEAT_HEIGHT + ARM_IN.up, 9)
      expect(d.arm.zHand).toBeCloseTo(r.chair.at.z + ARM_IN.ahead, 9)
      expect(Math.hypot(d.arm.x - hand.x, d.arm.y - hand.y, d.arm.zHand - hand.z)).toBeLessThan(1e-9)
      expect(d.arm.zMouth).toBeCloseTo(tun.mouth.z, 9)
      const hood = primsOf('glass', 'roundedBox').filter((p) => Math.abs(p.position[0] - d.arm.x) < 0.03 && p.size[2] > 0.5 && p.position[2] > r.chair.at.z)
      expect(hood.length, `hood ${r.index}`).toBe(1)
      const h = hood[0]
      expect(Math.abs(h.position[0] - d.arm.x)).toBeLessThan(0.03)
      // the arm line runs through the hood's cross section, inside the crowd's tube radius around the axis
      expect(d.arm.y).toBeGreaterThan(h.position[1] - h.size[1] / 2 + ARM_IN.radius * 0.5)
      expect(d.arm.y).toBeLessThan(h.position[1] + h.size[1] / 2 - ARM_IN.radius * 0.5)
      expect(h.size[0] / 2).toBeGreaterThanOrEqual(ARM_IN.radius)
      // it starts at the crowd's mouth (within 3 cm) and runs to the cabinet's face; the hand is inside it
      expect(Math.abs(h.position[2] - h.size[2] / 2 - tun.mouth.z)).toBeLessThan(0.03)
      expect(h.position[2] + h.size[2] / 2).toBeGreaterThanOrEqual(d.arm.zFront)
      expect(d.arm.zHand + 0.1).toBeLessThan(h.position[2] + h.size[2] / 2)
      // the padded cradle under the arm: its top is just below the arm line
      const pad = prims.find((p) => p.mat === 'fabricTeal' && p.shape === 'roundedBox' && Math.abs(p.position[0] - d.arm.x) < 0.03 && p.size[2] > 0.4)!
      expect(pad, `pad ${r.index}`).toBeDefined()
      expect(d.arm.y - (pad.position[1] + pad.size[1] / 2)).toBeGreaterThan(0.03)
      expect(d.arm.y - (pad.position[1] + pad.size[1] / 2)).toBeLessThan(0.07)
      // the hand grip: a bar across the palm on the line, a hand length in
      const grip = prims.find((p) => p.mat === 'rubber' && Math.abs(p.position[0] - d.arm.x) < 0.03 && Math.abs(p.position[2] - (d.arm.zHand + 0.065)) < 0.03)!
      expect(grip, `grip ${r.index}`).toBeDefined()
      expect(Math.abs(grip.position[1] - d.arm.y)).toBeLessThan(0.05)
      // the hood is above the knees: its underside clears the seat by 0.2 m or more
      expect(TUNNEL.yBase - SEAT_HEIGHT).toBeGreaterThan(0.2)
      // ... and the head fits under its roof with the needle's reach to the skin (the hand's top is about 4.5 cm over the axis)
      expect(HEAD.y - HEAD.halfY).toBeGreaterThan(d.arm.y + 0.045)
      expect(HEAD.y + HEAD.halfY).toBeLessThan(RAIL_Y)
      expect(HEAD.y - HEAD.halfY - NEEDLE_TRAVEL).toBeLessThan(d.arm.y + 0.045)
      expect(RAIL_Y).toBeLessThan(TUNNEL.yTop)
    }
  })

  it('has a screen on an arm, about 0.47 x 0.27 at about 1.38 m, facing the chair', () => {
    for (const r of DRAW_CENTRE.robots) {
      const d = robotDims(r.index)
      const bezel = prims.find((p) => p.mat === 'metalDark' && p.shape === 'roundedBox' && Math.abs(p.position[0] - r.cabinet.x) < 1e-6 && Math.abs(p.position[1] - 1.38) < 0.01)!
      expect(bezel, `bezel ${r.index}`).toBeDefined()
      expect(bezel.size[0]).toBeCloseTo(0.47, 2)
      expect(bezel.size[1]).toBeGreaterThanOrEqual(0.27)
      expect(Math.abs(Math.abs(bezel.rotationY) - Math.PI)).toBeLessThan(1e-6) // faces north
      expect(d.screen.y).toBeCloseTo(1.38, 6)
    }
  })

  it('leaves the risers to the pipe system: this room builds none of its own (src/scene/rooms/pneumatic.ts draws them, one per source)', () => {
    for (let i = 0; i < 4; i++) {
      const src = PNEUMATIC.sources[i]
      const thin = primsOf('glass', 'cylinder').filter((p) => Math.abs(p.position[0] - src.x) < 0.01 && Math.abs(p.position[2] - src.z) < 0.01 && p.size[0] < PNEUMATIC.outerDiameter - 0.001)
      expect(thin.length, `riser ${i}`).toBe(0)
    }
  })
})

describe('the tube-prep machine', () => {
  it('is 0.60 x 0.755 x 1.18 against the west wall, inside the room, with its tray outlet at the contract point', () => {
    const fp = footprints.find((f) => f.id === 'draw:prep')!
    expect(fp.x - fp.hw).toBeGreaterThanOrEqual(AREA.x0 + 0.1 - 1e-6)
    expect(fp.hd * 2).toBeCloseTo(PREP.w, 6)
    expect(PREP.d).toBeCloseTo(0.755, 6)
    expect(PREP.h).toBeCloseTo(1.18, 6)
    expect(PREP.cz).toBeCloseTo(DRAW_CENTRE.prep.center.z, 6)
    // the machine's east face and the contract's tray point are one point
    expect(Math.abs(PREP.cx + PREP.d / 2 - DRAW_CENTRE.prep.tray.x)).toBeLessThan(0.01)
    // the machine's top is at 1.18 m (a clear roof in a white frame) and nothing of it is higher
    const parts = prims.filter((p) => !p.rotationX && !p.rotationZ && p.position[0] > fp.x - fp.hw - 0.01 && p.position[0] < fp.x + fp.hw + 0.01 && Math.abs(p.position[2] - PREP.cz) < fp.hd + 0.01)
    const top = Math.max(...parts.map((p) => p.position[1] + p.size[1] / 2))
    expect(top).toBeCloseTo(1.18, 3)
  })

  it('has a glass hood over a 2 x 4 bank of tube bins in the cap colours of the content', () => {
    const glass = primsOf('glass', 'roundedBox').filter((p) => Math.abs(p.position[0] - PREP.cx) < 0.05 && Math.abs(p.position[2] - PREP.cz) < 0.05)
    expect(glass.length).toBe(1)
    const bins = prims.filter((p) => p.mat === 'tinted' && p.shape === 'roundedBox' && p.size[1] > 0.12 && p.position[0] < -26.9 && Math.abs(p.position[2] - PREP.cz) < 0.3)
    expect(bins.length).toBe(8)
    for (let i = 0; i < 8; i++) {
      const b = prepBinLocal(i)
      const w = prepWorld(b.lx, b.lz)
      const bin = bins.find((p) => Math.abs(p.position[0] - w.x) < 1e-6 && Math.abs(p.position[2] - w.z) < 1e-6)!
      expect(bin, `bin ${i}`).toBeDefined()
      expect(bin.color).toBe(LAB_CATALOGUE.tubes[PREP_BIN_KIND[i]].hex)
    }
    // 2 rows of 4: two depths, four positions across
    expect(new Set(bins.map((p) => p.position[0].toFixed(3))).size).toBe(2)
    expect(new Set(bins.map((p) => p.position[2].toFixed(3))).size).toBe(4)
  })
})

describe('the waiting bench, check-in kiosk, queue screen and send station', () => {
  it('has the check-in pedestal 0.5 x 1.0 x 0.4 at the device anchor, with room for the guest spot', () => {
    const fp = footprints.find((f) => f.id === 'draw:checkin')!
    expect(fp.x).toBeCloseTo(DRAW_CENTRE.checkIn.device.x, 6)
    expect(fp.z).toBeCloseTo(DRAW_CENTRE.checkIn.device.z, 6)
    expect(footprintDistance(fp, DRAW_CENTRE.checkIn.guest.at.x, DRAW_CENTRE.checkIn.guest.at.z)).toBeGreaterThanOrEqual(0.35)
  })

  it('puts each tile where its bezel is (within 4 cm), facing the right way', () => {
    // the queue screen above the door: the quad is in front of its bezel
    const q = TILE_ANCHORS.drawQueue()
    const qb = prims.find((p) => p.mat === 'metalDark' && Math.abs(p.position[0] - q.at.x) < 1e-6 && Math.abs(p.position[1] - q.at.y) < 0.05 && p.size[0] > 0.7)!
    expect(qb, 'queue bezel').toBeDefined()
    expect(q.at.z - (qb.position[2] + qb.size[2] / 2)).toBeLessThan(0.04)
    expect(q.at.z - (qb.position[2] + qb.size[2] / 2)).toBeGreaterThanOrEqual(0)
    expect(q.w).toBeLessThanOrEqual(QUEUE_SCREEN.w)
    expect(q.heading).toBe(DRAW_CENTRE.queueScreen.heading)
    expect(q.at.y).toBeCloseTo(DRAW_CENTRE.queueScreen.y, 6)
    // the check-in screen: the tilted head's face
    const c = TILE_ANCHORS.drawCheckIn()
    const f = checkInFace()
    expect(c.at.x).toBeCloseTo(f.x, 9)
    const head = prims.find((p) => p.mat === 'metalDark' && p.shape === 'roundedBox' && Math.abs(p.position[0] - f.x) < 1e-6 && Math.abs(p.position[1] - 0.88) < 0.02 && p.rotationX !== undefined)!
    expect(head, 'check-in head').toBeDefined()
    expect(Math.hypot(head.position[1] - c.at.y, head.position[2] - c.at.z)).toBeLessThan(0.04)
    // the prep display and the send display
    const p = TILE_ANCHORS.tubePrep()
    expect(p.heading).toBeCloseTo(Math.PI / 2, 9)
    expect(Math.abs(p.at.x - (PREP.cx + PREP.d / 2))).toBeLessThan(0.01)
    const s = TILE_ANCHORS.manualSend()
    expect(s.heading).toBeCloseTo(Math.PI, 9)
    expect(Math.abs(s.at.z - (DRAW_CENTRE.manualSend.z - SEND.d / 2))).toBeLessThan(0.01)
  })

  it('has the manual send station 0.45 x 0.70 x 0.28 between 0.95 and 1.65 m at the contract anchor, with its riser', () => {
    const fp = footprints.find((f) => f.id === 'draw:send')!
    expect(fp.x).toBeCloseTo(DRAW_CENTRE.manualSend.x, 6)
    expect(fp.z).toBeCloseTo(DRAW_CENTRE.manualSend.z, 6)
    expect(fp.hw * 2).toBeCloseTo(0.45, 6)
    expect(fp.hd * 2).toBeCloseTo(0.28, 6)
    const box = prims.find((p) => p.mat === 'whitePlastic' && Math.abs(p.position[0] - DRAW_CENTRE.manualSend.x) < 1e-6 && Math.abs(p.position[2] - DRAW_CENTRE.manualSend.z) < 1e-6)!
    expect(box.position[1] - box.size[1] / 2).toBeCloseTo(0.95, 6)
    expect(box.position[1] + box.size[1] / 2).toBeCloseTo(1.65, 6)
  })
})

describe('the changing cubicles and the sink (moved from the old blood-draw corner)', () => {
  it('has the sink counter exactly as before', () => {
    const fp = footprints.find((f) => f.id === 'imaging:sink')!
    expect(fp).toBeDefined()
    expect(fp.x).toBeCloseTo(-27.63, 6)
    expect(fp.z).toBeCloseTo(4.6, 6)
  })

  it('puts every cubicle spot between two partitions, in front of its bench, with a free approach outside', () => {
    const parts = footprints.filter((f) => f.id.startsWith('imaging:cubicles:part'))
    const benches = footprints.filter((f) => f.id.startsWith('imaging:cubicles:bench'))
    expect(parts.length).toBe(4)
    expect(benches.length).toBe(3)
    for (const [i, c] of DRAW_CENTRE.cubicles.entries()) {
      const lo = parts[i]
      const hi = parts[i + 1]
      expect(c.at.z).toBeGreaterThan(lo.z)
      expect(c.at.z).toBeLessThan(hi.z)
      for (const f of footprints) {
        // the patient stands on the spot: clear of everything by 0.3 m (a body), and the approach by 0.35 (a route)
        expect(footprintDistance(f, c.at.x, c.at.z), `${f.id} vs cubicle ${i}`).toBeGreaterThanOrEqual(0.3)
        expect(footprintDistance(f, c.approach.x, c.approach.z), `${f.id} vs approach ${i}`).toBeGreaterThanOrEqual(0.35)
      }
    }
  })
})

describe('the room keeps clear of every contract spot', () => {
  const spots: { id: string; x: number; z: number }[] = [
    ...DRAW_CENTRE.robots.map((r) => ({ id: `assist${r.index}`, x: r.assist.at.x, z: r.assist.at.z })),
    { id: 'nurse', x: DRAW_CENTRE.nurse.at.x, z: DRAW_CENTRE.nurse.at.z },
    { id: 'prepNurse', x: DRAW_CENTRE.prep.nurse.at.x, z: DRAW_CENTRE.prep.nurse.at.z },
    { id: 'guest', x: DRAW_CENTRE.checkIn.guest.at.x, z: DRAW_CENTRE.checkIn.guest.at.z },
    ...DRAW_CENTRE.overflow.map((o, i) => ({ id: `overflow${i}`, x: o.x, z: o.z })),
    ...seats.map((s) => ({ id: `approach ${s.id}`, x: s.approach.x, z: s.approach.z })),
  ]

  it('keeps 0.35 m between every standing spot or approach and every piece of furniture (except a seat from its own)', () => {
    const offenders: string[] = []
    for (const s of spots) {
      for (const f of footprints) {
        const own = s.id === `approach ${'drawChair:robot:' + f.id.replace(/\D/g, '')}` && f.id.endsWith('chair')
        if (own) continue
        const d = footprintDistance(f, s.x, s.z)
        if (d < 0.35 - 1e-9) offenders.push(`${s.id} is ${d.toFixed(2)} m from ${f.id}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps every footprint of the room inside its walls', () => {
    for (const f of footprints) {
      const c = Math.abs(Math.cos(f.rotationY))
      const s = Math.abs(Math.sin(f.rotationY))
      const ex = f.hw * c + f.hd * s
      const ez = f.hw * s + f.hd * c
      expect(f.x - ex, f.id).toBeGreaterThanOrEqual(AREA.x0 + 0.1 - 1e-6)
      expect(f.x + ex, f.id).toBeLessThanOrEqual(AREA.x1 - 0.1 + 1e-6)
      expect(f.z - ez, f.id).toBeGreaterThanOrEqual(AREA.z0 + 0.1 - 1e-6)
      expect(f.z + ez, f.id).toBeLessThanOrEqual(AREA.z1 - 0.1 + 1e-6)
    }
  })
})

describe('the prims', () => {
  it('use palette materials only, with finite sizes and positions', () => {
    for (const p of prims) {
      expect(p.mat in MAT, p.mat).toBe(true)
      for (const v of [...p.position, ...p.size]) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('stay within a sensible budget for the static room', () => {
    // eslint-disable-next-line no-console
    console.log(`[draw centre room] ${prims.length} prims, ${footprints.length} footprints, ${seats.length} seats`)
    expect(prims.length).toBeLessThan(420)
  })

  it('never put anything in the door opening of the room', () => {
    // the door is at (-26.6, 2), 1.6 wide: nothing taller than 0.3 m stands in the swing of the leaf, in the first metre inside
    const blockers: Footprint[] = footprints.filter((f) => footprintDistance(f, -26.6, 3.0) < 0.6)
    expect(blockers.map((f) => f.id)).toEqual([])
  })
})
