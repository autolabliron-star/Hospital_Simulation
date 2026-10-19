/**
 * The robotic OR's furniture, as data (node), in the pattern of labRoom.test.ts and shell.test.ts: everything stays inside the OR's walls and 0.35 m from the nav
 * routes, the seats are there with walkable, reachable approaches, the door's front, the table's side, the team's spots and the patient cart's whole drive path
 * from its parking bay to the dock stay free, the hand controllers stand where the crowd's console pose puts the hands, the screens face the people who read
 * them, and the level-2 static budget (the shell's plus the OR's) stays within 25 draw calls.
 */
import { describe, expect, it } from 'vitest'
import { CONSOLE_HANDS, seatPoint } from '@/scene/actors/crowd/armIn'
import { buildLayout } from '@/scene/building/layout'
import { footprintDistance, LayoutBuilder, UNRESOLVED_SEATS } from '@/scene/building/layout/builder'
import type { Footprint, Prim } from '@/scene/building/layout/types'
import { compileLayout, estimateBudget } from '@/scene/building/render/compile'
import { MAT } from '@/scene/materials'
import { BEZEL, CONSOLES, KIT_SCREENS, LIGHTS, LIVE, LIVE_SCREENS, OR_APPROACH, OR_SPOTS, SEAT_HEIGHT, VISION_HEADING } from '@/scene/surgery/dims'
import { l2, LEVEL2_DX, levelOf } from '@/sim/levels'
import { NAV, NAV_WARNINGS, tryPlanRoute } from '@/sim/nav/graph'
import { isWalkable } from '@/sim/nav/layout'
import { areaById, DOORS, LIFTS, SURGERY, WALL } from '@/sim/places'
import { cartPath } from '@/sim/surgery/robot'
import { buildOperatingRoom, OR_ROOM } from './or'

const layout = buildLayout()
const orRect = areaById('l2Or').rect
const orPrims = layout.prims.filter((p) => levelOf(p.position[0]) === 2 && p.position[0] > orRect.x0 - 0.5 && p.position[0] < orRect.x1 + 0.5 && p.position[2] > orRect.z0 - 0.5 && p.position[2] < orRect.z1 + 0.5)
const orFootprints = layout.footprints.filter((f) => f.id.startsWith('l2:or:'))
const orSeats = layout.seats.filter((s) => s.area === 'l2Or')
const upperFootprints = layout.footprints.filter((f) => levelOf(f.x) === 2)
/** The OR's own prims, built alone (the shell's walls, floors and furniture are not in it). */
const own = new LayoutBuilder()
buildOperatingRoom(own)
const ownPrims = own.prims

const extent = (fp: Footprint) => {
  if (fp.kind === 'circle') return { x0: fp.x - fp.hw, x1: fp.x + fp.hw, z0: fp.z - fp.hw, z1: fp.z + fp.hw }
  const c = Math.abs(Math.cos(fp.rotationY))
  const s = Math.abs(Math.sin(fp.rotationY))
  const ex = fp.hw * c + fp.hd * s
  const ez = fp.hw * s + fp.hd * c
  return { x0: fp.x - ex, x1: fp.x + ex, z0: fp.z - ez, z1: fp.z + ez }
}
const primExtent = (p: Prim) => {
  const [sx, sy, sz] = p.size
  // a prim turned about y by any angle: the box's corners
  const c = Math.abs(Math.cos(p.rotationY))
  const s = Math.abs(Math.sin(p.rotationY))
  const hx = (sx * c + sz * s) / 2
  const hz = (sx * s + sz * c) / 2
  return { x0: p.position[0] - hx, x1: p.position[0] + hx, z0: p.position[2] - hz, z1: p.position[2] + hz, y0: p.position[1] - sy / 2, y1: p.position[1] + sy / 2 }
}
const nearest = (x: number, z: number, list: readonly Footprint[] = upperFootprints): { id: string; d: number } => {
  let best = { id: '', d: Infinity }
  for (const f of list) {
    const d = footprintDistance(f, x, z)
    if (d < best.d) best = { id: f.id, d }
  }
  return best
}

describe('the OR is furnished', () => {
  it('has the table, both consoles with their chairs, the vision cart, the anaesthesia machine and stool, the back table, the Mayo stand and the circulator\'s desk, each with a footprint', () => {
    const ids = orFootprints.map((f) => f.id)
    for (const id of ['table', 'console:surgeon', 'console:surgeon:chair', 'console:teach', 'console:teach:chair', 'vision', 'anaesthesia', 'stool', 'backtable', 'mayo', 'desk']) expect(ids, id).toContain(`l2:or:${id}`)
    expect(orPrims.length).toBeGreaterThan(150)
    expect(NAV_WARNINGS).toEqual([])
    expect(UNRESOLVED_SEATS).toEqual([])
  })

  it('puts the table, the carts, the console, the anaesthesia machine, the back table, the Mayo stand and the desk exactly on the contract\'s anchors', () => {
    const at = (id: string) => orFootprints.find((f) => f.id === `l2:or:${id}`)!
    const same = (id: string, p: { x: number; z: number }) => {
      expect(at(id).x, id).toBeCloseTo(p.x, 6)
      expect(at(id).z, id).toBeCloseTo(p.z, 6)
    }
    same('table', SURGERY.table.at)
    same('vision', SURGERY.visionCart.at)
    same('anaesthesia', SURGERY.anaesthesia.machine.at)
    same('mayo', SURGERY.mayo.at)
    same('console:surgeon', SURGERY.consoles.surgeon.centre)
    same('console:teach', SURGERY.consoles.teach.centre)
    same('console:surgeon:chair', SURGERY.consoles.surgeon.seat.at)
    same('stool', SURGERY.anaesthesia.stool.at)
    // the back table's footprint is its stance, 7.5 cm narrower on the east side only
    expect(at('backtable').z).toBeCloseTo(SURGERY.backTable.at.z, 6)
    expect(at('backtable').x).toBeCloseTo(SURGERY.backTable.at.x - 0.0375, 6)
    expect(at('backtable').hd * 2).toBeCloseTo(SURGERY.backTable.l, 6)
    // the desk stands against the north wall, x on the contract's, a hair south of its z (the footprint is 0.42 deep)
    expect(at('desk').x).toBeCloseTo(SURGERY.circulatorDesk.at.x, 6)
    expect(Math.abs(at('desk').z - SURGERY.circulatorDesk.at.z)).toBeLessThan(0.05)
    // the consoles are the contract's size
    expect(at('console:surgeon').hd * 2).toBeCloseTo(SURGERY.consoles.size.d, 6)
    expect(at('vision').hw * 2).toBeCloseTo(0.68, 6)
    expect(at('vision').hd * 2).toBeCloseTo(0.93, 6)
    expect(at('vision').rotationY).toBeCloseTo(VISION_HEADING, 6)
  })

  it('turns the vision cart toward the bedside assistant (the contract\'s own heading faces away from them)', () => {
    const a = SURGERY.staff.assistant.at
    const c = SURGERY.visionCart.at
    const n = { x: Math.sin(VISION_HEADING), z: Math.cos(VISION_HEADING) }
    const to = { x: a.x - c.x, z: a.z - c.z }
    const l = Math.hypot(to.x, to.z)
    expect((n.x * to.x + n.z * to.z) / l).toBeGreaterThan(0.99)
  })
})

describe('the seats', () => {
  it('has the table (lying, head north, top at the contract height), the two consoles\' chairs and the anaesthetist\'s stool (sitting)', () => {
    expect(orSeats.map((s) => s.id).sort()).toEqual(['console:or:anaes', 'console:or:surgeon', 'console:or:teach', 'orTable:0'])
    const table = orSeats.find((s) => s.id === 'orTable:0')!
    expect(table.kind).toBe('orTable')
    expect(table.pose).toBe('lie')
    expect(table.height).toBe(SURGERY.table.height)
    expect([table.x, table.z]).toEqual([SURGERY.table.at.x, SURGERY.table.at.z])
    // the heading runs from the head toward the feet: the head is north (-z), so it faces +z
    expect(Math.cos(table.heading)).toBeCloseTo(1, 9)
    expect(table.approach).toEqual({ x: SURGERY.table.approach.x, z: SURGERY.table.approach.z })
    for (const c of CONSOLES) {
      const s = orSeats.find((q) => q.id === c.seat)!
      expect(s.kind, c.seat).toBe('console')
      expect(s.pose, c.seat).toBe('sit')
      expect(s.height, c.seat).toBe(SEAT_HEIGHT.console)
      expect([s.x, s.z]).toEqual([c.seatAt.x, c.seatAt.z])
      // facing west, toward the console's viewer
      expect(s.heading).toBeCloseTo(-Math.PI / 2, 9)
    }
    const stool = orSeats.find((s) => s.id === 'console:or:anaes')!
    expect(stool.pose).toBe('sit')
    expect(stool.height).toBe(SEAT_HEIGHT.stool)
    expect([stool.x, stool.z]).toEqual([SURGERY.anaesthesia.stool.at.x, SURGERY.anaesthesia.stool.at.z])
    expect(stool.heading).toBeCloseTo(SURGERY.anaesthesia.stool.heading, 9)
  })

  it('gives every seat an approach that is walkable, 0.4 m or more from every footprint, near the seat, and reachable on foot from the level-2 lift lobby', () => {
    const from = LIFTS.A[2].walkers[0]
    for (const s of orSeats) {
      expect(isWalkable(s.approach.x, s.approach.z, 0.3), `${s.id} approach walkable`).toBe(true)
      expect(Math.hypot(s.approach.x - s.x, s.approach.z - s.z), `${s.id} approach distance`).toBeLessThan(1.6)
      // the table's own footprint is next to its approach: the exemption is the seat's, like a bed's
      if (s.id !== 'orTable:0' && s.id !== 'console:or:anaes') expect(nearest(s.approach.x, s.approach.z).d, `${s.id} approach is ${nearest(s.approach.x, s.approach.z).id}`).toBeGreaterThanOrEqual(0.4 - 1e-9)
      expect(NAV.has(`seat:${s.id}`), s.id).toBe(true)
      expect(tryPlanRoute(from, s.approach), `${s.id} reachable from the lift lobby`).not.toBeNull()
    }
    expect(OR_APPROACH.consoles.z).toBeCloseTo(7.75, 9)
  })

  it('puts both consoles\' approaches in the walkway between them, and the stool\'s east of it', () => {
    for (const id of ['console:or:surgeon', 'console:or:teach']) {
      const s = orSeats.find((q) => q.id === id)!
      expect(s.approach).toEqual(OR_APPROACH.consoles)
    }
    expect(orSeats.find((q) => q.id === 'console:or:anaes')!.approach).toEqual(OR_APPROACH.stool)
  })
})

describe('everything is inside the OR\'s walls', () => {
  it('keeps every footprint half a wall inside the room', () => {
    const m = 0.1 - 1e-6
    for (const f of orFootprints) {
      const e = extent(f)
      expect(f.area, f.id).toBe('l2Or')
      expect(e.x0, f.id).toBeGreaterThanOrEqual(orRect.x0 + m)
      expect(e.x1, f.id).toBeLessThanOrEqual(orRect.x1 - m)
      expect(e.z0, f.id).toBeGreaterThanOrEqual(orRect.z0 + m)
      expect(e.z1, f.id).toBeLessThanOrEqual(orRect.z1 - m)
    }
  })

  it('keeps every furniture prim of the OR inside the walls inner faces and under the ceiling (the two boards bezels are in the rooms next door)', () => {
    const r = { x0: l2(OR_ROOM.x0), x1: l2(OR_ROOM.x1), z0: OR_ROOM.z0, z1: OR_ROOM.z1 }
    let checked = 0
    for (const p of ownPrims) {
      if (p.position[2] < 2 || p.position[2] > 10) continue // the pre-op and PACU boards' bezels
      const e = primExtent(p)
      const label = `${p.mat} ${p.shape} at (${p.position.map((v) => v.toFixed(2)).join(', ')})`
      checked++
      expect(e.x0, label).toBeGreaterThanOrEqual(r.x0 - 1e-6)
      expect(e.x1, label).toBeLessThanOrEqual(r.x1 + 1e-6)
      expect(e.z0, label).toBeGreaterThanOrEqual(r.z0 - 1e-6)
      expect(e.z1, label).toBeLessThanOrEqual(r.z1 + 1e-6)
      expect(e.y1, label).toBeLessThanOrEqual(WALL.height + 1e-6)
      expect(e.y0, label).toBeGreaterThanOrEqual(-1e-6)
    }
    expect(checked).toBeGreaterThan(120)
  })

  it('never casts into the baked sun shadow and uses only palette materials, with no colour except on tinted ones', () => {
    for (const p of ownPrims) {
      expect(p.castShadow).toBe(false)
      expect(MAT[p.mat], p.mat).toBeDefined()
      if (p.color !== undefined) expect(['tinted', 'tintedGlow']).toContain(p.mat)
    }
  })
})

describe('the ways through the OR stay free', () => {
  it('leaves the OR door\'s front free: a 1.3 m square on each side of the opening has no footprint within 0.3 m', () => {
    const d = DOORS.find((q) => q.id === 'l2Or')!
    for (const side of [-1, 1]) {
      for (let t = -0.9; t <= 0.9 + 1e-9; t += 0.25) {
        for (let m = 0.4; m <= 1.3; m += 0.3) {
          const near = nearest(d.center.x + t, d.center.z + side * m, orFootprints)
          expect(near.d, `${near.id} at side ${side}, ${m} m out`).toBeGreaterThanOrEqual(0.3 - 1e-9)
        }
      }
    }
  })

  it('keeps every spot a person stands at in the OR 0.3 m or more clear of the furniture, and walkable', () => {
    for (const { id, spot } of OR_SPOTS) {
      expect(nearest(spot.at.x, spot.at.z, orFootprints).d, `${id}: ${nearest(spot.at.x, spot.at.z, orFootprints).id}`).toBeGreaterThanOrEqual(0.3 - 1e-9)
      expect(isWalkable(spot.at.x, spot.at.z, 0.3), id).toBe(true)
    }
    // the table's approach, and the team's places the sim derives (surgeon at the table side, the waiting spots, the drive end)
    const extra: [string, number, number][] = [
      ['table approach', SURGERY.table.approach.x, SURGERY.table.approach.z],
      ['surgeon at the table', l2(-48.45), 5.25],
      ['assistant waits', l2(-47.0), 4.9],
      ['scrub waits', l2(-47.0), 8.5],
      ['drive end', l2(-52.4), 5.9],
    ]
    for (const [name, x, z] of extra) {
      expect(nearest(x, z, orFootprints).d, `${name}: ${nearest(x, z, orFootprints).id}`).toBeGreaterThanOrEqual(0.3 - 1e-9)
      expect(isWalkable(x, z, 0.3), name).toBe(true)
    }
  })

  it('keeps the patient cart\'s whole drive path from the parking bay to the dock clear of every footprint, inside the walls', () => {
    const { w, l } = SURGERY.cart.size
    const path = cartPath(80)
    expect(path.length).toBe(81)
    let least = Infinity
    let at = ''
    for (const p of path) {
      const c = Math.cos(p.heading)
      const s = Math.sin(p.heading)
      // the cart's rectangle (w across, l along its heading) sampled on a grid, corners and edges included
      for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 14; j++) {
          const lx = (i / 10 - 0.5) * w
          const lz = (j / 14 - 0.5) * l
          const x = p.x + c * lx + s * lz
          const z = p.z - s * lx + c * lz
          for (const f of orFootprints) {
            const d = footprintDistance(f, x, z)
            if (d < least) {
              least = d
              at = f.id
            }
          }
          expect(x, 'the cart stays inside the west wall').toBeGreaterThan(l2(OR_ROOM.x0) + 0.1)
          expect(z, 'and the south wall').toBeLessThan(OR_ROOM.z1 - 0.1)
          expect(z, 'and the north wall').toBeGreaterThan(OR_ROOM.z0 + 0.1)
        }
      }
    }
    expect(least, `the closest furniture to the cart's path is ${at}`).toBeGreaterThanOrEqual(0.25)
  })

  it('keeps the cart\'s parking and docking bays free of footprints (their outlines are on the floor)', () => {
    for (const bay of [SURGERY.cart.park, SURGERY.cart.dock]) {
      for (let dx = -0.75; dx <= 0.75; dx += 0.25) for (let dz = -0.5; dz <= 0.5; dz += 0.25) expect(nearest(bay.at.x + dx, bay.at.z + dz, orFootprints).d, `${nearest(bay.at.x + dx, bay.at.z + dz, orFootprints).id}`).toBeGreaterThan(0.3)
    }
  })
})

describe('the consoles', () => {
  it('stand the hand controllers where the crowd\'s console pose puts the hands: 0.2 m either side, 0.4 m ahead of the seat, 0.34 m above it', () => {
    for (const c of CONSOLES) {
      const seat = orSeats.find((s) => s.id === c.seat)!
      for (const side of [-1, 1]) {
        const p = seatPoint({ x: seat.x, z: seat.z, heading: seat.heading, seatHeight: seat.height }, side * CONSOLE_HANDS.side, CONSOLE_HANDS.up, CONSOLE_HANDS.ahead)
        // a 'frame' cylinder lying along the console's z (a horizontal grip) within 3 cm of the hand
        const grip = orPrims.find((q) => q.mat === 'frame' && q.shape === 'cylinder' && Math.abs(q.rotationX ?? 0) > 1 && Math.hypot(q.position[0] - p.x, q.position[2] - p.z) < 0.03 && Math.abs(q.position[1] - p.y) < 0.03)
        expect(grip, `${c.id} ${side}`).toBeDefined()
      }
    }
  })

  it('faces the viewer at the surgeon: the live screen of a viewer looks east, at the seat, from the hood\'s face', () => {
    for (const [idx, c] of [[LIVE.viewerSurgeon, CONSOLES[0]], [LIVE.viewerTeach, CONSOLES[1]]] as const) {
      const a = LIVE_SCREENS[idx]
      expect(a.heading).toBeCloseTo(Math.PI / 2, 9)
      expect(a.at.x).toBeGreaterThan(c.centre.x)
      expect(a.at.x).toBeLessThan(c.seatAt.x)
      expect(a.at.z).toBeCloseTo(c.centre.z, 6)
      // at a seated surgeon's eyes (the seat plus about 0.8 m)
      expect(a.at.y).toBeGreaterThan(SEAT_HEIGHT.console + 0.6)
      expect(a.at.y).toBeLessThan(SEAT_HEIGHT.console + 1.0)
    }
  })
})

describe('the screens face the people who read them', () => {
  const toward = (a: { at: { x: number; z: number }; heading: number }, x: number, z: number): number => {
    const dx = x - a.at.x
    const dz = z - a.at.z
    return (Math.sin(a.heading) * dx + Math.cos(a.heading) * dz) / Math.hypot(dx, dz)
  }
  it('has the vision cart\'s monitor toward the assistant, the wall monitor toward the table, the anaesthesia monitor toward the anaesthetist and the stool, the desk screen toward the circulator', () => {
    expect(toward(LIVE_SCREENS[LIVE.visionCart], SURGERY.staff.assistant.at.x, SURGERY.staff.assistant.at.z)).toBeGreaterThan(0.99)
    expect(toward(LIVE_SCREENS[LIVE.wall], SURGERY.table.at.x, SURGERY.table.at.z)).toBeGreaterThan(0.95)
    expect(toward(KIT_SCREENS.anaesthesia, SURGERY.anaesthesia.stand.at.x, SURGERY.anaesthesia.stand.at.z)).toBeGreaterThan(0.93)
    expect(toward(KIT_SCREENS.anaesthesia, SURGERY.anaesthesia.stool.at.x, SURGERY.anaesthesia.stool.at.z)).toBeGreaterThan(0.93)
    expect(toward(KIT_SCREENS.circulator, SURGERY.staff.circulator.at.x, SURGERY.staff.circulator.at.z)).toBeGreaterThan(0.99)
  })

  it('puts the PACU board on the recovery room\'s north wall facing south, and the pre-op board on its south wall facing north, inside their rooms', () => {
    const pacu = areaById('l2Pacu').rect
    const pre = areaById('l2PreOp').rect
    const p = KIT_SCREENS.pacuBoard
    const q = KIT_SCREENS.preOpBoard
    expect(p.at.x).toBeGreaterThan(pacu.x0)
    expect(p.at.x).toBeLessThan(pacu.x1)
    expect(p.at.z).toBeGreaterThan(pacu.z0)
    expect(p.at.z).toBeLessThan(pacu.z0 + 0.3)
    expect(Math.cos(p.heading)).toBeCloseTo(1, 9)
    expect(q.at.x).toBeGreaterThan(pre.x0)
    expect(q.at.x).toBeLessThan(pre.x1)
    expect(q.at.z).toBeLessThan(pre.z1)
    expect(q.at.z).toBeGreaterThan(pre.z1 - 0.3)
    expect(Math.cos(q.heading)).toBeCloseTo(-1, 9)
  })

  it('draws a dark bezel behind each screen but the console viewers (the hood has its own cushion behind those), 4 mm or less behind the quad', () => {
    const quads = [...LIVE_SCREENS.filter((_, i) => i !== LIVE.viewerSurgeon && i !== LIVE.viewerTeach), ...Object.values(KIT_SCREENS)]
    expect(quads.length).toBe(8)
    for (const a of quads) {
      const behind = ownPrims.some((p) => {
        if (p.mat !== 'metalDark' || p.shape !== 'roundedBox') return false
        const d = Math.hypot(p.position[0] - a.at.x, p.position[2] - a.at.z, (p.position[1] - a.at.y) * 0.5)
        return d < BEZEL + 0.05 && p.size[0] > a.w * 0.95 && p.size[0] < a.w * 1.2
      })
      expect(behind, `a bezel for the screen at (${a.at.x.toFixed(2)}, ${a.at.y.toFixed(2)}, ${a.at.z.toFixed(2)})`).toBe(true)
    }
    // the viewers: the hood's cushioned face (teal) right behind each
    for (const idx of [LIVE.viewerSurgeon, LIVE.viewerTeach]) {
      const a = LIVE_SCREENS[idx]
      expect(ownPrims.some((p) => p.mat === 'fabricTeal' && Math.abs(p.position[2] - a.at.z) < 0.01 && Math.abs(p.position[0] + p.size[2] / 2 - a.at.x) < 0.02), `a cushion behind viewer ${idx}`).toBe(true)
    }
  })
})

describe('the ceiling', () => {
  it('has the lights, the pendant and the boom as walk-only prims, all on linen (one extra mesh, and a material the shell does not use)', () => {
    const walk = layout.prims.filter((p) => p.walkOnly && levelOf(p.position[0]) === 2)
    expect(walk.length).toBeGreaterThan(12)
    for (const p of walk) {
      expect(p.mat).toBe('linen')
      expect(p.castShadow).toBe(false)
      expect(p.position[1] - p.size[1] / 2, 'hangs from the ceiling').toBeGreaterThan(1.5)
    }
    // two light housings over the table, at the heads' positions
    for (const h of LIGHTS.heads) expect(walk.some((p) => p.shape === 'cylinder' && Math.abs(p.size[0] - LIGHTS.housingDia) < 1e-9 && Math.hypot(p.position[0] - h.x, p.position[2] - h.z) < 1e-6)).toBe(true)
    // the lit faces (the rig's glow) sit a hair under the housings' undersides
    expect(LIGHTS.faceY).toBeGreaterThan(2.4)
    // and no non-walk prim of the OR is above the light faces
    for (const p of ownPrims) if (!p.walkOnly && p.position[2] > 2 && p.position[2] < 10) expect(primExtent(p).y1).toBeLessThan(2.4)
  })
})

describe('budget: level 2 on its own', () => {
  it('stays within 25 draw calls and 150 k triangles with the OR in (the OR adds one draw call, for its walk-only ceiling items)', () => {
    const compiled = compileLayout(layout, 2)
    const b = estimateBudget(compiled)
    expect(b.drawCalls).toBeLessThanOrEqual(25)
    expect(b.triangles).toBeLessThanOrEqual(150_000)
    expect(compiled.merged.filter((m) => m.walkOnly)).toHaveLength(1)
    // one mesh per (material, walk-only) key: the ceiling's linen is the only one with its material
    const keys = compiled.merged.map((m) => m.key.split('|')[0])
    expect(new Set(keys).size).toBe(compiled.merged.length)
    // the OR is level 2's, so level 1 is unchanged
    expect(estimateBudget(compileLayout(layout, 1)).drawCalls).toBe(estimateBudget(compileLayout(buildLayout({ level2: false }))).drawCalls)
  })

  it('is deterministic: the layout builds the same OR every time', () => {
    const again = buildLayout()
    const strip = (l: typeof layout) => l.footprints.filter((f) => f.id.startsWith('l2:or:')).map((f) => `${f.id}:${f.x.toFixed(4)},${f.z.toFixed(4)}`)
    expect(strip(again)).toEqual(strip(layout))
    expect(again.prims.length).toBe(layout.prims.length)
  })
})

describe('the room is on level 2 in sim coordinates', () => {
  it('draws at sim x = drawn x + the level-2 offset', () => {
    for (const f of orFootprints) expect(levelOf(f.x), f.id).toBe(2)
    expect(l2(-49.2) - LEVEL2_DX).toBeCloseTo(-49.2, 9)
  })
})
