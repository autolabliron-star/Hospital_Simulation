/**
 * Doors, through the pure BodyMover and fake blocker sources: through every door of the building (every auto, swing and opening door,
 * both pharmacist doors), the leaves forced OPEN (nothing in the way) and forced SHUT (a thin leaf across the whole opening), at the
 * walk and the run, at 20, 30, 60 and 144 frames a second, straight on and 30 degrees off to either side.
 *   open: the body crosses 2 m past the wall line within (distance / v + 0.5 s), and never touches a jamb or anything else;
 *   shut: the body never crosses, never gets inside the leaf, and never passes the wall line.
 * (A3 publishes the real leaves; these tests are the body's half of the contract.)
 */
import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { DOORS, type DoorSpec } from '@/sim/places'
import { FakeBlockers, blockerClearance, classicMover, staticClearance } from './bodyTestKit'
import { collisionStats, inRegion } from './collision'
import { BODY_FEEL } from './body'
import { clearBlockers } from '@/scene/blockers'

const R = CONFIG.player.bodyRadius
const DEG = Math.PI / 180
const DTS = [1 / 20, 1 / 30, 1 / 60, 1 / 144]
const LEAF = 0.03

afterEach(() => clearBlockers())

interface Approach {
  door: DoorSpec
  /** The unit direction of travel through the door at 0 degrees of approach. */
  nx: number
  nz: number
  dir: 1 | -1
}

/** The doors that are real doorways you walk through (not the ER's ambulance door that opens onto the bay, nor the hub counters). */
const DOORWAYS = DOORS.filter((d) => d.id !== 'ambulance' && d.kind !== 'counter')

function approaches(): Approach[] {
  const out: Approach[] = []
  for (const door of DOORWAYS) {
    for (const dir of [1, -1] as const) {
      out.push({ door, dir, nx: door.wallAxis === 'z' ? dir : 0, nz: door.wallAxis === 'x' ? dir : 0 })
    }
  }
  return out
}

/** The start of a straight approach `dist` m before the door's centre, `angle` radians off its normal, and the goal 2 m beyond the wall line. */
function line(a: Approach, angle: number, dist: number): { sx: number; sz: number; facing: number; length: number } {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // the direction: the normal rotated by `angle`
  const ux = a.nx * c - a.nz * s
  const uz = a.nz * c + a.nx * s
  return { sx: a.door.center.x - ux * dist, sz: a.door.center.z - uz * dist, facing: Math.atan2(ux, uz), length: (dist + 2) / c }
}

/** Is the straight line from the start to 2 m beyond the door clear of every solid by the body radius (a 1 cm margin)? */
function clearLine(a: Approach, angle: number, dist: number): boolean {
  const l = line(a, angle, dist)
  const ux = Math.sin(l.facing)
  const uz = Math.cos(l.facing)
  for (let d = 0; d <= l.length; d += 0.05) {
    const x = l.sx + ux * d
    const z = l.sz + uz * d
    if (staticClearance(x, z).d < R + 0.01 || !inRegion(x, z)) return false
  }
  return true
}

/** The longest clear approach (3 m, or a shorter one when furniture is in the way), or 0. */
function approachDistance(a: Approach, angle: number): number {
  for (const d of [3, 2.5, 2, 1.5]) if (clearLine(a, angle, d)) return d
  return 0
}

/** The thin leaf that shuts the whole opening (across the wall, centred in it). */
function shutLeaf(door: DoorSpec): { cx: number; cz: number; ux: number; uz: number; hu: number; hv: number } {
  const alongX = door.wallAxis === 'x' // the wall runs along x: the leaf spans x
  return { cx: door.center.x, cz: door.center.z, ux: alongX ? 1 : 0, uz: alongX ? 0 : 1, hu: door.width / 2, hv: LEAF }
}

describe('doors forced open: you walk through every doorway', () => {
  it('crosses 2 m past the wall line within distance / v + 0.5 s, and never touches anything, at every speed, frame rate and approach angle', () => {
    collisionStats.backstopFallbacks = 0
    const slowest: { name: string; over: number }[] = []
    let walks = 0
    const skipped: string[] = []
    let worstMargin = Infinity
    for (const a of approaches()) {
      for (const angle of [0, 30 * DEG, -30 * DEG]) {
        const dist = approachDistance(a, angle)
        if (dist === 0) {
          skipped.push(`${a.door.id} ${a.dir} ${(angle / DEG).toFixed(0)}`)
          continue
        }
        const l = line(a, angle, dist)
        for (const hurry of [false, true]) {
          const v = hurry ? CONFIG.player.hurrySpeed : CONFIG.player.walkSpeed
          for (const dt of DTS) {
            const m = classicMover(l.sx, l.sz)
            const budget = l.length / v + 0.5
            let t = 0
            let crossed = -1
            for (let i = 0; i < Math.ceil((budget + 1) / dt); i++) {
              m.step(dt, 1, 0, hurry, l.facing)
              t += dt
              const c = staticClearance(m.x, m.z)
              expect(c.d, `${a.door.id} dir ${a.dir}: inside ${c.id}`).toBeGreaterThanOrEqual(R - 1e-4)
              const along = (m.x - a.door.center.x) * a.nx + (m.z - a.door.center.z) * a.nz
              if (crossed < 0 && along >= 2) {
                crossed = t
                break
              }
            }
            walks++
            expect(crossed, `${a.door.id} dir ${a.dir} angle ${(angle / DEG).toFixed(0)} ${v} m/s dt ${dt.toFixed(4)}: never got 2 m past the wall`).toBeGreaterThan(0)
            const margin = budget - crossed
            worstMargin = Math.min(worstMargin, margin)
            if (margin < 0) slowest.push({ name: `${a.door.id} ${a.dir} ${v} ${dt}`, over: -margin })
          }
        }
      }
    }
    expect(slowest).toEqual([])
    expect(walks).toBeGreaterThan(500)
    expect(collisionStats.backstopFallbacks).toBe(0)
    // eslint-disable-next-line no-console
    console.log(`doors open: ${walks} crossings, ${skipped.length} approaches skipped (furniture in the line), tightest margin to the budget ${worstMargin.toFixed(3)} s`)
  })
})

describe('doors forced shut: a leaf across the opening is a wall', () => {
  it('you never cross the wall line, never enter the leaf and never touch a jamb, at every speed, frame rate and approach angle', () => {
    collisionStats.backstopFallbacks = 0
    let walks = 0
    let deepest = -Infinity
    for (const a of approaches()) {
      for (const angle of [0, 30 * DEG, -30 * DEG]) {
        const dist = approachDistance(a, angle)
        if (dist === 0) continue
        const l = line(a, angle, dist)
        const leaf = shutLeaf(a.door)
        const src = new FakeBlockers()
        src.add(leaf.cx, leaf.cz, leaf.ux, leaf.uz, leaf.hu, leaf.hv)
        const unregister = src.register()
        for (const hurry of [false, true]) {
          const v = hurry ? CONFIG.player.hurrySpeed : CONFIG.player.walkSpeed
          for (const dt of DTS) {
            const m = classicMover(l.sx, l.sz)
            let furthest = -Infinity
            for (let i = 0; i < Math.ceil((l.length / v + 1.5) / dt); i++) {
              m.step(dt, 1, 0, hurry, l.facing)
              const along = (m.x - a.door.center.x) * a.nx + (m.z - a.door.center.z) * a.nz
              furthest = Math.max(furthest, along)
              const c = staticClearance(m.x, m.z)
              expect(c.d, `${a.door.id}: inside ${c.id}`).toBeGreaterThanOrEqual(R - 1e-4)
              expect(blockerClearance(src, m.x, m.z), `${a.door.id} dir ${a.dir}: inside the leaf`).toBeGreaterThanOrEqual(R - 1e-4)
            }
            walks++
            deepest = Math.max(deepest, furthest)
            expect(furthest, `${a.door.id} dir ${a.dir} angle ${(angle / DEG).toFixed(0)} ${v} m/s dt ${dt.toFixed(4)}: crossed a shut door`).toBeLessThan(0)
          }
        }
        unregister()
      }
    }
    expect(walks).toBeGreaterThan(500)
    expect(collisionStats.backstopFallbacks).toBe(0)
    // eslint-disable-next-line no-console
    console.log(`doors shut: ${walks} attempts, the furthest any body got towards the wall line was ${(deepest * 100).toFixed(2)} cm short of it (the leaf is 3 cm thick, the body 31 cm)`)
  })

  it('a leaf that closes ON the body pushes it out through the doorway side it is on, never through a wall, and the body can walk away from it', () => {
    // the entrance, 3 m wide: stand in the middle of the doorway, and slide a leaf across it from the plaza side
    const door = DOORS.find((d) => d.id === 'entrance')!
    const src = new FakeBlockers()
    const unregister = src.register()
    const m = classicMover(door.center.x + 0.15, door.center.z)
    let leafX = door.center.x - 1.0 // far away, then it closes in 5 cm steps onto the body
    for (let i = 0; i < 40; i++) {
      leafX += 0.05
      src.clear().add(leafX, door.center.z, 0, 1, door.width / 2, 0.03) // a leaf whose face is at x
      m.step(1 / 60, 0, 0, false, 0)
      const c = staticClearance(m.x, m.z)
      expect(c.d, `frame ${i}: inside ${c.id}`).toBeGreaterThanOrEqual(R - 1e-4)
    }
    // pushed east, off the leaf, by at most the push speed each frame
    expect(m.x).toBeGreaterThanOrEqual(leafX + R + CONFIG.player.bodySkin - 0.2)
    unregister()
    expect(BODY_FEEL.pushSpeed).toBeGreaterThan(CONFIG.player.hurrySpeed)
  })
})
