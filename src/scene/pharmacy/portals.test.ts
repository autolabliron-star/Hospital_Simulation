import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/Simulation'
import { CONFIG } from '@/sim/config'
import { CIRCUITS, pointAt, type PathPoint } from '@/sim/meds/circuit'
import { CORE, ROBOT, WALL } from '@/sim/places'
import { BOGIE, HATCH as POD_HATCH, POD } from '../robots/podParts'
import { SWAY } from '../robots/podMotion'
import { buildCoreStatic } from './coreParts'
import { FLAP, flapLowestY, OPENINGS, PORTAL, PORTALS, portalsOf, WALL_GLASS, wallGlassPanels, wallSolidIntervals, wallSegments } from './layout'
import { flapAngle, newPortalState, stepPortal } from './portalMotion'

const DT = CONFIG.sim.step
const WALL_Z: Record<'N' | 'S', number> = { N: CORE.z0, S: CORE.z1 }

/** Where the circuit of `ward` crosses its core wall (|z| = 12), as arc length, x, and the direction of travel (+1 leaving the core). */
function crossings(ward: 'A' | 'B'): { s: number; x: number; leaving: boolean; heading: number }[] {
  const c = CIRCUITS[ward]
  const zWall = ward === 'A' ? CORE.z0 : CORE.z1
  const out: { s: number; x: number; leaving: boolean; heading: number }[] = []
  const p: PathPoint = { x: 0, z: 0, heading: 0 }
  const step = 0.005
  let prev = 0
  pointAt(c, 0, p)
  prev = Math.abs(p.z) - Math.abs(zWall)
  // (the loop starts on the wall, at the entry portal: nudge the zero so "on the wall" counts as outside, and stop short of the wrap)
  const side = (v: number) => v + 1e-9 > 0
  for (let s = step; s < c.length; s += step) {
    pointAt(c, s, p)
    const now = Math.abs(p.z) - Math.abs(zWall)
    if (side(prev) !== side(now)) out.push({ s, x: p.x, leaving: now > prev, heading: p.heading })
    prev = now
  }
  return out
}

/** The x extent of the pod's footprint where it crosses the wall plane z = zWall, for a pod at pose p (null when it does not reach the plane). */
function footprintAtPlane(p: PathPoint, zWall: number): { x0: number; x1: number } | null {
  const hw = ROBOT.podSize.w / 2
  const hl = ROBOT.podSize.l / 2
  const ct = Math.cos(p.heading)
  const st = Math.sin(p.heading)
  const corners: [number, number][] = []
  for (const lx of [-hw, hw]) for (const lz of [-hl, hl]) corners.push([p.x + lx * ct + lz * st, p.z - lx * st + lz * ct])
  const ring = [corners[0], corners[1], corners[3], corners[2]]
  let x0 = Infinity
  let x1 = -Infinity
  for (let i = 0; i < 4; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % 4]
    if ((a[1] - zWall) * (b[1] - zWall) > 0 || a[1] === b[1]) continue
    const t = (zWall - a[1]) / (b[1] - a[1])
    const x = a[0] + (b[0] - a[0]) * t
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
  }
  return x0 === Infinity ? null : { x0, x1 }
}

describe('the rail portals sit where the circuits cross the core wall', () => {
  it('each ward\'s circuit crosses its wall exactly twice, once out at the exit portal and once back in at the entry portal', () => {
    for (const w of ['A', 'B'] as const) {
      const cs = crossings(w)
      expect(cs, `ward ${w}`).toHaveLength(2)
      const out = cs.find((c) => c.leaving)!
      const back = cs.find((c) => !c.leaving)!
      const exit = PORTALS.find((p) => p.ward === w && p.kind === 'exit')!
      const entry = PORTALS.find((p) => p.ward === w && p.kind === 'entry')!
      expect(Math.abs(out.x - exit.x), `exit ${w}`).toBeLessThan(0.02)
      expect(Math.abs(back.x - entry.x), `entry ${w}`).toBeLessThan(0.02)
      expect(exit.x).toBe(ROBOT.exitX)
      expect(entry.x).toBe(ROBOT.entryX)
      // the pod crosses straight through the wall (along its normal) at the portal's centre line
      for (const c of cs) expect(Math.abs(Math.cos(c.heading)) < 0.05 || Math.abs(Math.sin(c.heading)) < 0.05).toBe(true)
    }
  })

  it('there are exactly four portals, two in each corridor wall, on the wall plane |z| = 12', () => {
    expect(PORTALS).toHaveLength(4)
    for (const side of ['N', 'S'] as const) {
      const ps = portalsOf(side)
      expect(ps.map((p) => p.x)).toEqual([ROBOT.exitX, ROBOT.entryX])
      for (const p of ps) {
        expect(p.z).toBe(WALL_Z[side])
        expect(Math.abs(p.z)).toBe(12)
        expect(p.ward).toBe(side === 'N' ? 'A' : 'B')
      }
    }
  })
})

describe('the opening encloses the pod and its bogie', () => {
  it('through the whole crossing, the pod\'s footprint (body corners and all, even on the door turn) stays inside the opening, with room for its sway', () => {
    const swayLateral = (ROBOT.rail.undersideY - ROBOT.podBottomY) * Math.sin(SWAY.max)
    const p: PathPoint = { x: 0, z: 0, heading: 0 }
    let worst = Infinity
    for (const portal of PORTALS) {
      const c = CIRCUITS[portal.ward]
      let sawCrossing = false
      for (let s = 0; s < c.length; s += 0.005) {
        pointAt(c, s, p)
        const fp = footprintAtPlane(p, portal.z)
        // only the pods that are at this portal (the circuit also passes the other portal's x)
        if (!fp || Math.abs(p.x - portal.x) > 1) continue
        sawCrossing = true
        const margin = Math.min(portal.x + PORTAL.width / 2 - (fp.x1 + swayLateral), fp.x0 - swayLateral - (portal.x - PORTAL.width / 2))
        worst = Math.min(worst, margin)
        expect(margin, `${portal.id} at s=${s.toFixed(2)}`).toBeGreaterThanOrEqual(0.02)
      }
      expect(sawCrossing, portal.id).toBe(true)
    }
    expect(worst).toBeLessThan(0.2) // the opening is "just around" the pod: not a barn door
  })

  it('the opening runs from just under the pod to the ceiling, around the bogie too', () => {
    expect(PORTAL.y0).toBeCloseTo(ROBOT.podBottomY - 0.05, 9)
    expect(PORTAL.y1).toBe(ROBOT.rail.hangerTopY)
    expect(PORTAL.y1 - PORTAL.y0).toBeCloseTo(0.75, 9)
    expect(PORTAL.y0).toBeLessThan(POD.pivotY + POD.bottom) // under the pod's lowest point (its bottom hatch, at podBottomY)
    expect(PORTAL.y0).toBeLessThan(ROBOT.podBottomY)
    expect(PORTAL.y1).toBeGreaterThanOrEqual(ROBOT.rail.undersideY + Math.min(ROBOT.rail.depth, ROBOT.rail.hangerTopY - ROBOT.rail.undersideY))
    // the bogie (plate and wheels) fits the width with room to spare
    const bogieHalf = Math.max(BOGIE.plateW / 2, BOGIE.wheelX + BOGIE.wheelW / 2)
    expect(PORTAL.width / 2).toBeGreaterThan(bogieHalf + 0.1)
    expect(PORTAL.width).toBeCloseTo(0.8, 9)
    // and the wider opening is still small: a pod's width plus a hand each side
    expect(PORTAL.width).toBeLessThanOrEqual(ROBOT.podSize.w + 0.35)
  })

  it('the jamb strips and the sill keep 0.35 m clear of the rail line and the pod stays above the sill', () => {
    const solids = buildCoreStatic().solids
    const jambs = solids.filter((s) => s.id.startsWith('portal-jamb:'))
    expect(jambs).toHaveLength(PORTALS.length * 2)
    for (const j of jambs) {
      const portal = PORTALS.find((p) => j.id.includes(p.id))!
      const gap = Math.min(Math.abs(j.x0 - portal.x), Math.abs(j.x1 - portal.x))
      expect(gap).toBeGreaterThanOrEqual(0.35)
      expect(j.y0).toBeCloseTo(PORTAL.y0, 9)
      expect(j.y1).toBeCloseTo(PORTAL.y1, 9)
    }
    for (const s of solids.filter((q) => q.id.startsWith('portal-sill:'))) expect(s.y1).toBeCloseTo(PORTAL.y0, 9)
  })
})

describe('the glass below the portals is continuous: nobody walks through', () => {
  it('no floor robot door remains: the only openings are the two pharmacist doors', () => {
    expect(OPENINGS).toHaveLength(2)
    for (const o of OPENINGS) expect(o.kind).toBe('people')
    // the file and every mention of a robot door are gone
    const dir = __dirname
    expect(existsSync(join(dir, 'RobotDoors.tsx'))).toBe(false)
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))) {
      const text = readFileSync(join(dir, f), 'utf8')
      expect(text, f).not.toMatch(/RobotDoors|triggerRobot|kind: 'robot'/)
    }
  })

  it('every point of the glass below the sill is covered, in the portals\' x range as everywhere else (except the pharmacist doors)', () => {
    for (const side of ['N', 'S'] as const) {
      const panels = wallGlassPanels(side)
      const covered = (x: number, y: number) => panels.some((r) => x >= r.x0 - 1e-9 && x <= r.x1 + 1e-9 && y >= r.y0 - 1e-9 && y <= r.y1 + 1e-9)
      const doors = OPENINGS.filter((o) => o.side === side)
      for (let x = CORE.x0 + 0.01; x < CORE.x1; x += 0.05) {
        if (doors.some((o) => Math.abs(x - o.x) < o.width / 2 + 0.02)) continue
        for (const y of [WALL_GLASS.y0 + 0.01, 0.5, 1.0, 1.7, 2.0, 2.2, PORTAL.y0 - 0.01]) expect(covered(x, y), `${side} wall at x=${x.toFixed(2)}, y=${y}`).toBe(true)
        // above the sill: glass everywhere except inside a portal
        const inPortal = portalsOf(side).some((p) => Math.abs(x - p.x) < PORTAL.width / 2 - 0.01)
        const inPortalOrOn = portalsOf(side).some((p) => Math.abs(x - p.x) <= PORTAL.width / 2 + 0.01)
        if (inPortal) expect(covered(x, 2.6), `${side} wall at x=${x.toFixed(2)} should be open at 2.6 m`).toBe(false)
        else if (!inPortalOrOn) expect(covered(x, 2.6), `${side} wall at x=${x.toFixed(2)}`).toBe(true)
      }
    }
  })

  it('the sill is too high to step through, and the posts and top bar leave every portal open', () => {
    expect(PORTAL.y0).toBeGreaterThanOrEqual(WALL.doorHeight - 0.1)
    expect(PORTAL.y0).toBeGreaterThan(2.0)
    const core = buildCoreStatic()
    for (const s of core.solids) {
      if (!s.id.startsWith('post:') && !s.id.startsWith('jamb:') && !s.id.startsWith('corner:')) continue
      for (const p of PORTALS) {
        const inX = s.x1 > p.x - PORTAL.width / 2 && s.x0 < p.x + PORTAL.width / 2
        const inZ = s.z1 > p.z - 0.05 && s.z0 < p.z + 0.05
        expect(inX && inZ, `${s.id} stands in ${p.id}`).toBe(false)
      }
    }
    for (const side of ['N', 'S'] as const) {
      for (const seg of wallSegments(side)) {
        for (const iv of wallSolidIntervals(seg.a, seg.b, side)) {
          for (const p of portalsOf(side)) {
            // the top bar's pieces never cross the opening (they may end at the jamb)
            const crosses = iv.a < p.x + PORTAL.width / 2 - 1e-9 && iv.b > p.x - PORTAL.width / 2 + 1e-9
            expect(crosses, `top bar piece ${iv.a}..${iv.b} crosses ${p.id}`).toBe(false)
          }
        }
      }
    }
  })
})

describe('the flap', () => {
  const hw = PORTAL.width / 2

  it('hangs from just under the rail to the sill, in two halves with a gap for the bogie stem, all inside the opening', () => {
    expect(PORTAL.hingeY).toBe(ROBOT.rail.undersideY)
    expect(flapLowestY(0)).toBeCloseTo(PORTAL.y0, 9)
    expect(FLAP.cx - FLAP.w / 2).toBeGreaterThanOrEqual(PORTAL.slot / 2)
    expect(FLAP.cx + FLAP.w / 2).toBeLessThanOrEqual(hw)
    const bogieHalf = BOGIE.wheelX + BOGIE.wheelW / 2
    expect(PORTAL.slot / 2).toBeGreaterThanOrEqual(bogieHalf + 0.01)
  })

  it('lifted, it is above the pod\'s roof and below the ceiling, never reaching beyond the hinge', () => {
    expect(flapLowestY(PORTAL.lift)).toBeGreaterThanOrEqual(ROBOT.podTopY + 0.05)
    expect(flapLowestY(PORTAL.lift)).toBeLessThanOrEqual(PORTAL.hingeY)
    // the swing stays under the hinge line for every angle up to the lift
    for (let a = 0; a <= PORTAL.lift; a += 0.05) expect(flapLowestY(a)).toBeLessThanOrEqual(PORTAL.hingeY + 1e-9)
    expect(PORTAL.lift).toBeLessThan(Math.PI / 2)
    // and the side hatch of a docked pod is nowhere near a portal: the pods only open it at the MedVend
    expect(POD_HATCH.sideHinge.x).toBeLessThan(hw)
  })

  it('has time to lift before a pod arrives', () => {
    const lift = 1 / PORTAL.speed
    expect(PORTAL.trigger / CONFIG.pods.corridorSpeed).toBeGreaterThan(lift + 0.5)
    expect(PORTAL.trigger / CONFIG.pods.coreSpeed).toBeGreaterThan(lift + 0.5)
  })

  it('state machine: lifts while a pod is near, holds, drops a moment after, frozen when paused', () => {
    const s = newPortalState()
    expect(flapAngle(s.raw)).toBe(0)
    for (let i = 0; i < 120; i++) stepPortal(s, true, DT)
    expect(s.raw).toBe(1)
    expect(flapAngle(s.raw)).toBeCloseTo(PORTAL.lift, 9)
    // a pod just left: it stays up for `closeAfter`
    for (let i = 0; i < Math.floor((PORTAL.closeAfter - 0.05) / DT); i++) stepPortal(s, false, DT)
    expect(s.raw).toBe(1)
    for (let i = 0; i < 120; i++) stepPortal(s, false, DT)
    expect(s.raw).toBe(0)
    const before = { ...s }
    stepPortal(s, false, 0)
    expect(s).toEqual(before)
  })

  it('in the real simulation the flap is always out of every pod\'s way: lifted to clear the roof whenever a pod is at the portal', () => {
    const sim = new Simulation(5)
    for (const [room, meds] of [
      ['A3', [{ medId: 'paracetamol', qty: 1 }]],
      ['A6', [{ medId: 'omeprazole', qty: 1 }]],
      ['B2', [{ medId: 'cetirizine', qty: 1 }]],
      ['B7', [{ medId: 'paracetamol', qty: 1 }]],
    ] as const) {
      expect(sim.prescribe(room, [...meds]).ok).toBe(true)
    }
    const states = PORTALS.map(newPortalState)
    const trig2 = PORTAL.trigger * PORTAL.trigger
    const p: PathPoint = { x: 0, z: 0, heading: 0 }
    const passes = new Map<string, number>()
    let was = PORTALS.map(() => false)
    const roof = ROBOT.podTopY + 0.02
    for (let step = 0; step < 60 * 420; step++) {
      sim.step(DT)
      const here: boolean[] = []
      for (let i = 0; i < PORTALS.length; i++) {
        const portal = PORTALS[i]
        let near = false
        let inside = false
        for (const d of sim.meds.fleet.drivers) {
          if (d.pod.ward !== portal.ward) continue
          pointAt(CIRCUITS[portal.ward], d.pod.s, p)
          const dx = p.x - portal.x
          const dz = p.z - portal.z
          if (dx * dx + dz * dz < trig2) near = true
          // the pod's body overlaps the wall plane (half its length, and a hair)
          if (Math.abs(dz) < ROBOT.podSize.l / 2 + 0.3 && Math.abs(dx) < 0.6) inside = true
        }
        stepPortal(states[i], near, DT)
        if (inside) expect(flapLowestY(flapAngle(states[i].raw)), `${portal.id} at step ${step}`).toBeGreaterThanOrEqual(roof)
        here.push(inside)
        if (inside && !was[i]) passes.set(portal.id, (passes.get(portal.id) ?? 0) + 1)
      }
      was = here
      if (PORTALS.every((q) => (passes.get(q.id) ?? 0) >= 1)) break
    }
    // every portal was used at least once (the check above was not vacuous)
    for (const q of PORTALS) expect(passes.get(q.id) ?? 0, `${q.id} passes`).toBeGreaterThanOrEqual(1)
  })
})
