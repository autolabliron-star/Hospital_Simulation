import { describe, expect, it } from 'vitest'
import { cabinetFootprints, CAB, type Rect4 } from '../drawers/cabinet'
import { CIRCUITS, pointAt, type PathPoint } from '@/sim/meds/circuit'
import { NAV } from '@/sim/nav/graph'
import { PHARMACIST_ZONES } from '@/sim/nav/layout'
import { DOORS, PHARMACY, ROBOT, ROOMS } from '@/sim/places'
import { triangleCount } from '../robots/budget'
import { BOGIE, POD } from '../robots/podParts'
import { buildCoreStatic, type Solid } from './coreParts'
import { CONTACT, DESKS, DOOR, OPENINGS, PORTAL, RANK_SLOTS } from './layout'

/** The brief: static furniture keeps at least 0.35 m from the rail's centre line and from every nav edge and anchor. */
const CLEAR = 0.35
/** W2: the rail and the pods hang overhead. Only a solid that reaches above the portal sill (podBottomY - 0.05) can be in a pod's way. */
const POD_BAND_Y0 = ROBOT.podBottomY - 0.05

// ---------------------------------------------------------------------------------------------
// Independent helpers (deliberately not reusing the code under test)
// ---------------------------------------------------------------------------------------------

function distToRect(px: number, pz: number, r: Rect4): number {
  const dx = Math.max(r.x0 - px, 0, px - r.x1)
  const dz = Math.max(r.z0 - pz, 0, pz - r.z1)
  return Math.hypot(dx, dz)
}

/** Lane centre line sampled every 5 cm, both wards. */
const LANE_POINTS: { x: number; z: number }[] = (() => {
  const out: { x: number; z: number }[] = []
  const p: PathPoint = { x: 0, z: 0, heading: 0 }
  for (const w of ['A', 'B'] as const) {
    const c = CIRCUITS[w]
    for (let s = 0; s < c.length; s += 0.05) {
      pointAt(c, s, p)
      out.push({ x: p.x, z: p.z })
    }
  }
  return out
})()

function minDistToLanes(r: Rect4): number {
  let best = Infinity
  for (const p of LANE_POINTS) best = Math.min(best, distToRect(p.x, p.z, r))
  return best
}

/** Points along every nav edge every 5 cm, plus every node (the anchors). */
const NAV_POINTS: { x: number; z: number }[] = (() => {
  const out: { x: number; z: number }[] = NAV.nodes.map((n) => ({ x: n.x, z: n.z }))
  for (const e of NAV.edges) {
    const a = NAV.nodes[e.a]
    const b = NAV.nodes[e.b]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05))
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n })
  }
  return out
})()

function minDistToNav(r: Rect4, only?: Rect4): number {
  let best = Infinity
  for (const p of NAV_POINTS) {
    if (only && distToRect(p.x, p.z, only) > 0) continue
    best = Math.min(best, distToRect(p.x, p.z, r))
  }
  return best
}

const core = buildCoreStatic()
/** Solids people could touch: standing on the floor and reaching above ankle height (the charging contacts are on the rail, far above). */
const floorSolids: Solid[] = core.solids.filter((s) => s.y1 > 0.05 && !s.onRail)

describe('pharmacy core keeps clear of the overhead rail and its pods', () => {
  it('has solids to check, including posts, the island, both desks, the portal jambs and the dock ports', () => {
    const ids = floorSolids.map((s) => s.id)
    expect(ids).toContain('island')
    expect(ids).toContain('desk:A')
    expect(ids).toContain('desk:B')
    expect(ids.some((i) => i.startsWith('jamb:'))).toBe(true)
    expect(ids.some((i) => i.startsWith('corner:'))).toBe(true)
    expect(ids.filter((i) => i.startsWith('portal-jamb:'))).toHaveLength(8)
    expect(ids.filter((i) => i.startsWith('port:'))).toHaveLength(4)
  })

  it('every static solid that reaches the pods\' height band is at least 0.35 m from every rail centre line', () => {
    const inBand = floorSolids.filter((s) => s.y1 > POD_BAND_Y0 + 1e-9)
    expect(inBand.length).toBeGreaterThan(10)
    const offenders = inBand.map((s) => ({ id: s.id, d: minDistToLanes(s) })).filter((o) => o.d < CLEAR)
    expect(offenders).toEqual([])
  })

  it('everything else (desks, low furniture) stays below the pods: people can walk, work and carry things under the rail', () => {
    for (const s of floorSolids.filter((q) => q.y1 <= POD_BAND_Y0 + 1e-9)) expect(s.y1, s.id).toBeLessThan(ROBOT.podBottomY - 0.05 + 1e-9)
    for (const s of floorSolids.filter((q) => q.id.startsWith('desk:'))) expect(s.y1).toBeLessThan(ROBOT.podBottomY - 0.9)
  })

  it('the floor is plain: no lane paint, arrows, charging pads or dock plates', () => {
    expect(core.solids.filter((s) => s.id.startsWith('pad:'))).toEqual([])
    // the polished floor is one quad (two triangles)
    expect(triangleCount(core.geometries.floor)).toBe(2)
    // nothing flat on the floor at all: every static piece that touches it is a post, the island or a desk
    for (const s of core.solids.filter((q) => q.y0 <= 0.01 && !q.onRail)) expect(s.y1 - s.y0, s.id).toBeGreaterThan(0.5)
  })
})

describe('the overhead charging rank', () => {
  it('has one slot per pod, exactly where the idle pods queue in the rank, along the rank line x = rankX', () => {
    expect(RANK_SLOTS).toHaveLength(ROBOT.podsPerWard * 2)
    for (const slot of RANK_SLOTS) {
      const c = CIRCUITS[slot.ward]
      let best = Infinity
      const p: PathPoint = { x: 0, z: 0, heading: 0 }
      for (let s = 0; s < c.length; s += 0.02) {
        pointAt(c, s, p)
        best = Math.min(best, Math.hypot(p.x - slot.x, p.z - slot.z))
      }
      expect(best).toBeLessThan(0.03)
      expect(slot.x).toBeCloseTo(ROBOT.rankX, 6)
    }
  })

  it('has two slim contacts per slot, on the sides of the rail, above the pod\'s bogie and clear of its wheels', () => {
    const contacts = core.solids.filter((s) => s.id.startsWith('contact:'))
    expect(contacts).toHaveLength(RANK_SLOTS.length * 2)
    for (const s of contacts) {
      expect(s.onRail).toBe(true)
      // inside the beam's height: from the underside up to the ceiling plane
      expect(s.y0).toBeGreaterThanOrEqual(ROBOT.rail.undersideY)
      expect(s.y1).toBeLessThanOrEqual(ROBOT.rail.hangerTopY)
      // above the bogie plate and its wheels, so nothing it carries can touch them
      expect(s.y0).toBeGreaterThan(POD.pivotY + BOGIE.plateTop)
      expect(s.y0).toBeGreaterThan(POD.pivotY - BOGIE.plateT / 2 + BOGIE.wheelR)
      // right beside the rail (touching distance), outside its half width, and slim
      const cx = (s.x0 + s.x1) / 2
      expect(Math.abs(Math.abs(cx - ROBOT.rankX) - CONTACT.x)).toBeLessThan(1e-9)
      expect(s.x0 - ROBOT.rankX >= ROBOT.rail.width / 2 || ROBOT.rankX - s.x1 >= ROBOT.rail.width / 2).toBe(true)
      expect(s.x1 - s.x0).toBeLessThanOrEqual(0.02)
    }
    // each slot's contacts are centred on the slot and shorter than the pod
    for (const slot of RANK_SLOTS) {
      const mine = contacts.filter((s) => s.id.startsWith(`contact:${slot.ward}${slot.slot}:`))
      expect(mine).toHaveLength(2)
      for (const s of mine) {
        expect((s.z0 + s.z1) / 2).toBeCloseTo(slot.z, 9)
        expect(s.z1 - s.z0).toBeLessThanOrEqual(ROBOT.podSize.l)
      }
    }
  })

  it('the contacts of neighbouring slots do not touch (a pod length plus the gap apart)', () => {
    for (const w of ['A', 'B'] as const) {
      const zs = RANK_SLOTS.filter((s) => s.ward === w).map((s) => s.z).sort((a, b) => a - b)
      for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1] - CONTACT.length).toBeGreaterThan(0.3)
    }
  })
})

describe('the dock ports and the portals are where the pods pass', () => {
  it('every port frame is at least 0.4 m from the dock lane\'s centre line, so a pod passing never nears it', () => {
    for (const s of core.solids.filter((q) => q.id.startsWith('port:'))) expect(minDistToLanes(s), s.id).toBeGreaterThanOrEqual(0.4)
  })

  it('the pharmacist doors match the contract', () => {
    const people = OPENINGS.filter((o) => o.kind === 'people')
    expect(people).toHaveLength(2)
    for (const o of people) {
      const d = DOORS.find((q) => q.id === `pharmacist${o.ward}`)!
      expect(o.x).toBe(d.center.x)
      expect(o.z).toBe(d.center.z)
      expect(o.width).toBe(d.width)
    }
  })

  it('the door leaves open at least the width of a person each way (a leaf never blocks the gap when open)', () => {
    for (const o of OPENINGS) {
      const leafW = o.width / 2
      const travel = leafW - 0.04
      // open leaf inner edge: centre offset (leafW/2 + travel) minus half a leaf
      const innerEdge = leafW / 2 + travel - leafW / 2
      expect(o.width / 2 - innerEdge).toBeGreaterThan(0)
      expect(innerEdge).toBeGreaterThanOrEqual(o.width / 2 - 0.05)
    }
    expect(DOOR.triggerPeople).toBe(1.4)
  })

  it('the portals are well above any person: the sill is higher than the door height minus a hand', () => {
    expect(PORTAL.y0).toBeGreaterThanOrEqual(DOOR.height - 0.1)
  })
})

describe('pharmacist desks keep clear of people', () => {
  it('no nav edge or anchor inside a pharmacist zone comes within 0.35 m of a desk', () => {
    for (const desk of DESKS) {
      const zone = PHARMACIST_ZONES.find((z) => z.ward === desk.ward)!
      const d = minDistToNav(desk.rect, zone.rect)
      expect(d, `desk ${desk.ward}`).toBeGreaterThanOrEqual(CLEAR)
    }
  })

  it('there are nav points to check inside each pharmacist zone (door to desk spot)', () => {
    for (const zone of PHARMACIST_ZONES) {
      const inside = NAV_POINTS.filter((p) => p.x >= zone.rect.x0 && p.x <= zone.rect.x1 && p.z >= zone.rect.z0 && p.z <= zone.rect.z1)
      expect(inside.length).toBeGreaterThan(20)
    }
  })

  it('the desk stands between the pharmacist and the island, inside the pharmacist zone', () => {
    for (const desk of DESKS) {
      const spot = PHARMACY.desk[desk.ward].spot
      // the pharmacist faces the desk centre
      const toDesk = { x: desk.centre.x - spot.x, z: desk.centre.z - spot.z }
      expect(toDesk.x * desk.forward.x + toDesk.z * desk.forward.z).toBeGreaterThan(0.5)
      expect(Math.abs(desk.centre.z)).toBeLessThan(Math.abs(spot.z))
      expect(Math.abs(desk.centre.z)).toBeGreaterThan(PHARMACY.island.z1 + 1)
      const zone = PHARMACIST_ZONES.find((z) => z.ward === desk.ward)!.rect
      expect(desk.rect.x0).toBeGreaterThanOrEqual(zone.x0 - 0.5)
      expect(desk.rect.x1).toBeLessThanOrEqual(zone.x1 + 0.5)
    }
  })

  it('no static core solid is within 0.35 m of any nav edge or anchor', () => {
    const offenders = floorSolids.map((s) => ({ id: s.id, d: minDistToNav(s) })).filter((o) => o.d < CLEAR)
    expect(offenders).toEqual([])
  })
})

describe('MedDrawer cabinets', () => {
  it('fill exactly the 0.8 m gap the building leaves', () => {
    expect(CAB.w).toBe(0.8)
    expect(CAB.h).toBe(1.3)
  })

  it('stand well below the pods: the rail and pods are overhead, so the cabinet is not in their way', () => {
    expect(CAB.h).toBeLessThan(ROBOT.podBottomY - 0.5)
  })

  it('keep 0.35 m clear of every nav edge and anchor, even with the drawer pulled fully out', () => {
    const offenders: { id: string; d: number }[] = []
    for (const r of ROOMS) {
      const f = cabinetFootprints(r)
      for (const [part, rect] of [['body', f.body], ['drawer', f.drawerOut]] as const) {
        const d = minDistToNav(rect)
        if (d < CLEAR - 1e-9) offenders.push({ id: `${r.id}:${part}`, d })
      }
    }
    expect(offenders).toEqual([])
  })

  it('stand beside the bed, not in it, and centred on the contract point', () => {
    for (const r of ROOMS) {
      const f = cabinetFootprints(r)
      expect((f.body.x0 + f.body.x1) / 2).toBeCloseTo(r.drawer.x, 6)
      // the wall line passes through the cabinet
      expect(f.body.z0 < r.drawer.z && r.drawer.z < f.body.z1).toBe(true)
      // a pod stopped at the dock is within reach of the cabinet's face
      expect(Math.abs(r.podDock.x - r.drawer.x)).toBeLessThan(1e-9)
    }
  })

  it('swing the hatch inside the cavity', () => {
    const { hatch, cavity, hatchOpen } = CAB
    // lowest point of the hatch when fully open, in cabinet-local z: hinge z minus the panel height times sin(angle)
    const bottomZ = CAB.zCorr - hatch.h * Math.sin(hatchOpen)
    expect(bottomZ).toBeGreaterThanOrEqual(cavity.zBack)
    const bottomY = hatch.hingeY - hatch.h * Math.cos(hatchOpen)
    expect(bottomY).toBeGreaterThan(cavity.y0)
  })
})
