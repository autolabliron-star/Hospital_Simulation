/**
 * Node tests of the walk-mode renderer's pure parts (W1): the door bank (opening, holding, closing, rest), the leaf matrices, the sign
 * atlas painter (run against a recording stub: no canvas here), the ceiling picture and the geometry's winding (every ceiling faces
 * down, every picture faces the way its heading says, every box faces outward).
 */
import { describe, expect, it } from 'vitest'
import { Vector3, type BufferGeometry } from 'three'
import { DOORS } from '@/sim/places'
import { levelOf } from '@/sim/levels'
import { CONFIG } from '@/sim/config'
import { BLOCKER_STRIDE } from '@/scene/blockers'
import { buildWallBoxes } from '@/scene/player/boomProbe'
import { smoothDamp } from '@/scene/player/chaseMath'
import { buildLayout } from '../../layout'
import { buildWalkLayout } from '../../layout/walk'
import type { WalkDoor } from '../../layout/walk/types'
import { DoorBank, DOOR_TIMING, newLead, setLead, type DoorLead, type PersonLike } from './doorBank'
import { LEAF_BLOCKER_GROW, autoLeafWidth, autoTravel, leafBlockerCount, setInstance, swingDirection, swingLeafWidth, writeAutoDoor, writeLeafBlockers, writeSwingDoor } from './doorMatrices'
import { CEILING_PX, paintCeilingCell, type CeilingPaint } from './ceilingTexture'
import { packAtlas, paintAtlas, type Paint2D } from './signAtlas'
import { compileWalk } from './walkGeometry'

const layout = buildLayout()
const walk = buildWalkLayout(layout)
const door = (id: string): WalkDoor => walk.doors.find((d) => d.id === id)!
const person = (x: number, z: number): PersonLike => ({ entity: { position: { x, z } } })

// ---------------------------------------------------------------------------------------------
// The door bank
// ---------------------------------------------------------------------------------------------

describe('door bank', () => {
  const run = (bank: DoorBank, seconds: number, people: PersonLike[], player: { x: number; z: number } | null = null): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) bank.update(1 / 60, people, player)
  }

  it('starts shut and stays shut (and reports no change) while nobody is near', () => {
    const bank = new DoorBank(walk.doors)
    expect(bank.update(1 / 60, [person(0, 0)], null)).toBe(true) // the first write
    expect(bank.update(1 / 60, [person(0, 0)], null)).toBe(false)
    for (let i = 0; i < bank.count; i++) expect(bank.shown[i]).toBe(0)
  })

  it('an auto door opens when a person comes within 2.5 m, either side, and fully opens within about half a second', () => {
    const entrance = walk.doors.findIndex((d) => d.id === 'entrance')
    for (const dx of [-2.4, 2.4]) {
      const bank = new DoorBank(walk.doors)
      run(bank, DOOR_TIMING.auto.opens + 0.1, [person(-62 + dx, 0)])
      expect(bank.shown[entrance]).toBe(1)
    }
    const bank = new DoorBank(walk.doors)
    run(bank, 2, [person(-62 + 2.6, 0)])
    expect(bank.shown[entrance]).toBe(0)
  })

  it('a swing door opens for somebody passing within 1.6 m, and ignores a patient in bed', () => {
    const idx = walk.doors.findIndex((d) => d.id === 'room:A3')
    const d = door('room:A3')
    const bank = new DoorBank(walk.doors)
    run(bank, 1, [person(d.x, d.z + 1.4)])
    expect(bank.shown[idx]).toBe(1)
    const quiet = new DoorBank(walk.doors)
    // the bed head is ~2.5 m from the door
    run(quiet, 2, [person(d.x + 2.1, d.z - 1.35)])
    expect(quiet.shown[idx]).toBe(0)
  })

  it('you open doors too: the player position counts like a person', () => {
    const idx = walk.doors.findIndex((d) => d.id === 'entrance')
    const bank = new DoorBank(walk.doors)
    run(bank, 1, [], { x: -64, z: 0.5 })
    expect(bank.shown[idx]).toBe(1)
  })

  it('holds open after the last one leaves, then eases shut, and comes to an exact rest', () => {
    const idx = walk.doors.findIndex((d) => d.id === 'triage')
    const bank = new DoorBank(walk.doors)
    const d = door('triage')
    run(bank, 1, [person(d.x, d.z)])
    expect(bank.shown[idx]).toBe(1)
    run(bank, DOOR_TIMING.auto.hold - 0.1, [])
    expect(bank.shown[idx]).toBe(1)
    let last = 1
    for (let i = 0; i < 120; i++) {
      bank.update(1 / 60, [], null)
      expect(bank.shown[idx]).toBeLessThanOrEqual(last + 1e-9)
      last = bank.shown[idx]
    }
    expect(bank.shown[idx]).toBe(0)
    expect(bank.update(1 / 60, [], null)).toBe(false) // at rest: nothing to write
  })

  it('every door of the layout can be sensed from its own centre', () => {
    const bank = new DoorBank(walk.doors)
    run(
      bank,
      1.2,
      walk.doors.map((d) => person(d.x, d.z)),
    )
    for (let i = 0; i < bank.count; i++) expect(bank.shown[i], walk.doors[i].id).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Leaf matrices
// ---------------------------------------------------------------------------------------------

/** The world position and x axis of instance `i`. */
function readInstance(a: Float32Array, i: number): { p: Vector3; xAxis: Vector3; zAxis: Vector3; sy: number } {
  const o = i * 16
  return { p: new Vector3(a[o + 12], a[o + 13], a[o + 14]), xAxis: new Vector3(a[o], a[o + 1], a[o + 2]), zAxis: new Vector3(a[o + 8], a[o + 9], a[o + 10]), sy: a[o + 5] }
}

describe('door leaf matrices', () => {
  it('setInstance writes a column-major matrix that turns the x axis to (c, 0, -s)', () => {
    const a = new Float32Array(16)
    setInstance(a, 0, 1, 2, 3, 0, 1, 2, 3, 4)
    expect(Array.from(a)).toEqual([0, 0, -2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 1, 2, 3, 1])
  })

  it('a shut auto door: two leaves meeting in the middle of the opening, one each side, at the door height', () => {
    for (const id of ['entrance', 'liftA', 'imaging']) {
      const d = door(id)
      const glass = new Float32Array(2 * 16)
      const bars = new Float32Array(8 * 16)
      writeAutoDoor(glass, bars, 0, d, 0)
      const l = readInstance(glass, 0)
      const r = readInstance(glass, 1)
      const alongX = d.wallAxis === 'x'
      const mid = alongX ? d.x : d.z
      const a0 = alongX ? l.p.x : l.p.z
      const a1 = alongX ? r.p.x : r.p.z
      expect(a0, id).toBeLessThan(mid)
      expect(a1, id).toBeGreaterThan(mid)
      expect((a0 + a1) / 2, id).toBeCloseTo(mid, 4)
      // together (frame bars, leaf edge to leaf edge) they span the clear opening between the two jambs
      expect(a1 - a0 + autoLeafWidth(d), id).toBeGreaterThanOrEqual(d.width - 0.07 - 1e-6)
      expect(l.sy).toBeCloseTo(2.28, 6)
      // across the wall: off the line by the door's offset
      expect(alongX ? l.p.z : l.p.x).toBeCloseTo((alongX ? d.z : d.x) + d.offset, 4)
    }
  })

  it('a fully open auto door slides each leaf almost its own width apart, into the wall', () => {
    const d = door('triage')
    const g0 = new Float32Array(2 * 16)
    const g1 = new Float32Array(2 * 16)
    const bars = new Float32Array(8 * 16)
    writeAutoDoor(g0, bars, 0, d, 0)
    writeAutoDoor(g1, bars, 0, d, 1)
    const moved = Math.abs(readInstance(g1, 0).p.x - readInstance(g0, 0).p.x)
    expect(moved).toBeCloseTo(autoTravel(d), 5)
    // the leaves are in the wall beside the opening, not across it
    expect(readInstance(g1, 0).p.x).toBeLessThan(d.x - d.width / 2 + 0.05)
    expect(readInstance(g1, 1).p.x).toBeGreaterThan(d.x + d.width / 2 - 0.05)
  })

  it('a wall along z turns the leaf: its x axis runs along z', () => {
    const d = door('imaging')
    expect(d.wallAxis).toBe('z')
    const glass = new Float32Array(2 * 16)
    writeAutoDoor(glass, new Float32Array(8 * 16), 0, d, 0)
    const l = readInstance(glass, 0)
    expect(Math.abs(l.xAxis.z)).toBeGreaterThan(0.99 * (autoLeafWidth(d) - 0.02))
    expect(Math.abs(l.xAxis.x)).toBeLessThan(1e-6)
  })

  it('a shut swing leaf lies in the doorway from its hinge to the far jamb; opened, it stands out into the room', () => {
    const d = door('room:A3')
    const lw = swingLeafWidth(d)
    const leaves = new Float32Array(16)
    writeSwingDoor(leaves, 0, d, 0)
    const shut = readInstance(leaves, 0)
    expect(shut.p.z).toBeCloseTo(d.z, 6)
    expect(shut.p.x).toBeCloseTo(d.x + d.hinge * (d.width / 2 - 0.015) - d.hinge * (lw / 2), 6)
    writeSwingDoor(leaves, 0, d, 1)
    const open = readInstance(leaves, 0)
    // the hinge end is unchanged: the leaf's centre is half a leaf from it, now turned toward the room
    const hinge = new Vector3(d.x + d.hinge * (d.width / 2 - 0.015), 0, d.z)
    const toCentre = new Vector3(open.p.x - hinge.x, 0, open.p.z - hinge.z)
    expect(toCentre.length()).toBeCloseTo(lw / 2, 5)
    expect(Math.sign(toCentre.z)).toBe(d.into.z) // into the room
    const dir = swingDirection(d, d.maxAngle)
    expect(toCentre.normalize().distanceTo(new Vector3(dir.x, 0, dir.z))).toBeLessThan(1e-5)
    // the leaf's thin side faces along the wall: its z axis is perpendicular to its x axis
    expect(Math.abs(open.xAxis.dot(open.zAxis))).toBeLessThan(1e-6)
  })

  it('opening is monotonic: a swing leaf turns steadily from shut to its widest', () => {
    const d = door('staffA')
    const a = new Float32Array(16)
    let lastZ = -Infinity
    for (let k = 0; k <= 10; k++) {
      writeSwingDoor(a, 0, d, k / 10)
      const z = readInstance(a, 0).p.z * d.into.z
      expect(z).toBeGreaterThanOrEqual(lastZ - 1e-9)
      lastZ = z
    }
  })
})

// ---------------------------------------------------------------------------------------------
// W3: the leaves are solid, so the doors have to be open when your body gets there
// ---------------------------------------------------------------------------------------------

const LEAD_SECONDS = CONFIG.player.doorLeadSeconds
const WALK = CONFIG.player.walkSpeed
const HURRY = CONFIG.player.hurrySpeed
const DT = 1 / 60

/** Which way people cross the wall of `d` (the axis), the wall line's coordinate on it, and the coordinate across the opening's middle. */
function crossing(d: WalkDoor): { axis: 'x' | 'z'; wall: number; middle: number } {
  return d.wallAxis === 'x' ? { axis: 'z', wall: d.z, middle: d.x } : { axis: 'x', wall: d.x, middle: d.z }
}

/**
 * Walk straight at the middle of door `d` from 9 m out on `side` (1 or -1) at `speed`, the door shut when you start, the bank stepped at
 * 60 Hz with your position and (with `lead`) the lead the game gives it. Returns how open the door was when your body centre was
 * `at` metres from the wall line, and the distances from the wall line at which it first stirred and was first wide open (>= 0.999).
 */
function walkAtDoor(d: WalkDoor, side: 1 | -1, speed: number, lead: boolean, at = 0.6): { shownAt: number; stirred: number; wide: number } {
  const bank = new DoorBank(walk.doors)
  const idx = walk.doors.indexOf(d)
  const c = crossing(d)
  const l: DoorLead = newLead()
  let s = c.wall + side * 9
  let stirred = Infinity
  let wide = Infinity
  for (let i = 0; i < 60 * 12; i++) {
    const pos = c.axis === 'z' ? { x: c.middle, z: s } : { x: s, z: c.middle }
    const v = -side * speed
    if (lead) setLead(l, c.axis === 'x' ? v : 0, c.axis === 'z' ? v : 0, 0, 0, LEAD_SECONDS)
    bank.update(DT, [], pos, lead ? l : null)
    const dist = Math.abs(s - c.wall)
    if (bank.shown[idx] > 0 && stirred === Infinity) stirred = dist
    if (bank.shown[idx] >= 0.999 && wide === Infinity) wide = dist
    if (dist <= at) return { shownAt: bank.shown[idx], stirred, wide }
    s += v * DT
  }
  throw new Error('never got there')
}

describe('W3: the doors sense you along your way (the leaves are solid)', () => {
  const leafDoors = walk.doors.filter((d) => d.kind === 'auto' || d.kind === 'swing')

  it('every auto and swing door, from both sides, at a walk and at a hurry: wide open (98 %) when your body is 0.6 m from the wall line', () => {
    expect(leafDoors.length).toBeGreaterThan(30)
    let worst = 1
    for (const d of leafDoors) {
      for (const side of [1, -1] as const) {
        for (const speed of [WALK, HURRY]) {
          const r = walkAtDoor(d, side, speed, true)
          worst = Math.min(worst, r.shownAt)
          expect(r.shownAt, `${d.id}, side ${side}, ${speed} m/s`).toBeGreaterThanOrEqual(0.98)
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(0.98)
  })

  it('without the lead a hurrying body meets a swing door that is not open yet (it is the lead that does it)', () => {
    const d = door('room:A3')
    expect(walkAtDoor(d, 1, HURRY, false).shownAt).toBeLessThan(0.6)
    expect(walkAtDoor(d, 1, HURRY, true).shownAt).toBeGreaterThanOrEqual(0.98)
  })

  it('at a hurry an auto door stirs about 5 m out and is wide open about 2.7 m out; a swing door about 4.1 m and 1.6 m', () => {
    const auto = walkAtDoor(door('triage'), 1, HURRY, true)
    expect(auto.stirred).toBeGreaterThan(4.6)
    expect(auto.stirred).toBeLessThan(5.2)
    expect(auto.wide).toBeGreaterThan(2.4)
    expect(auto.wide).toBeLessThan(3.1)
    const swing = walkAtDoor(door('room:A3'), 1, HURRY, true)
    expect(swing.stirred).toBeGreaterThan(3.8)
    expect(swing.stirred).toBeLessThan(4.4)
    expect(swing.wide).toBeGreaterThan(1.3)
    expect(swing.wide).toBeLessThan(2.2)
  })

  it('a lead of nothing (standing, or no lead at all) is exactly the old point sensing: a door 2.6 m away stays shut', () => {
    const d = door('triage')
    const bank = new DoorBank(walk.doors)
    const idx = walk.doors.indexOf(d)
    const l = newLead()
    for (let i = 0; i < 120; i++) bank.update(DT, [], { x: d.x, z: d.z + 2.6 }, l)
    expect(bank.shown[idx]).toBe(0)
    for (let i = 0; i < 120; i++) bank.update(DT, [], { x: d.x, z: d.z + 2.6 }, null)
    expect(bank.shown[idx]).toBe(0)
    // the lead applies to YOU only: a person at the same spot with the same lead set does not open it either
    for (let i = 0; i < 120; i++) bank.update(DT, [person(d.x, d.z + 2.6)], null, setLead(l, 0, -HURRY, 0, 0, LEAD_SECONDS))
    expect(bank.shown[idx]).toBe(0)
  })

  it('setting off from rest with a key held: the wish is the lead until the body has the speed, and the door is still open in time', () => {
    // (close to a door at a hurry there is no time for any door: a swing door takes 0.6 s and a hurried start covers 2 m in 0.7 s)
    for (const [id, start] of [['room:A3', 2.8], ['triage', 3.2], ['staffA', 2.8]] as const) {
      const d = door(id)
      for (const speed of [WALK, HURRY]) {
        const bank = new DoorBank(walk.doors)
        const idx = walk.doors.indexOf(d)
        const c = crossing(d)
        const l = newLead()
        const vel = { v: 0 }
        let v = 0
        let s = c.wall + start
        let shownAt = -1
        for (let i = 0; i < 60 * 6 && shownAt < 0; i++) {
          // a critically damped start (CONFIG.player.startSeconds is the time to 95 %: the smooth time is that over 2.37)
          v = smoothDamp(v, speed, vel, CONFIG.player.startSeconds / 2.37, DT)
          const pos = c.axis === 'z' ? { x: c.middle, z: s } : { x: s, z: c.middle }
          const vx = c.axis === 'x' ? -v : 0
          const vz = c.axis === 'z' ? -v : 0
          setLead(l, vx, vz, c.axis === 'x' ? -speed : 0, c.axis === 'z' ? -speed : 0, LEAD_SECONDS)
          bank.update(DT, [], pos, l)
          if (Math.abs(s - c.wall) <= 0.6) shownAt = bank.shown[idx]
          s -= v * DT
        }
        expect(shownAt, `${id} from rest at ${speed} m/s`).toBeGreaterThanOrEqual(0.98)
      }
    }
  })

  it('setLead takes the wish when it is faster than the velocity you have, and the velocity otherwise', () => {
    const l = newLead()
    setLead(l, 0, 0, 0, 4.2, 0.6)
    expect([l.vx, l.vz, l.seconds]).toEqual([0, 4.2, 0.6])
    setLead(l, 2, 0, 0, 0, 0.6) // coasting to a stop: no key held
    expect([l.vx, l.vz]).toEqual([2, 0])
    setLead(l, 1, 1, 3, 0, 0.6)
    expect([l.vx, l.vz]).toEqual([3, 0])
  })

  it('snapOpenNear: Tab into a doorway opens the doors you are in range of at once, and only those', () => {
    const d = door('triage')
    const bank = new DoorBank(walk.doors)
    const idx = walk.doors.indexOf(d)
    expect(bank.snapOpenNear({ x: d.x, z: d.z + 0.5 })).toBe(true)
    expect(bank.shown[idx]).toBe(1)
    expect(bank.raw[idx]).toBe(1)
    for (let i = 0; i < bank.count; i++) if (i !== idx) expect(bank.shown[i], walk.doors[i].id).toBe(0)
    // the leaves are rewritten (the next update reports the change), and it holds open the usual time, then closes
    expect(bank.update(DT, [], { x: d.x, z: d.z + 0.5 })).toBe(true)
    expect(bank.snapOpenNear({ x: d.x, z: d.z + 0.5 })).toBe(false) // already open: nothing to do
    for (let i = 0; i < 60 * 4; i++) bank.update(DT, [], null)
    expect(bank.shown[idx]).toBe(0)
  })
})

describe('W3: the leaves as solid boxes (writeLeafBlockers)', () => {
  const OPENINGS = [0, 0.3, 0.7, 1]
  const read = (a: Float64Array, i: number) => ({ cx: a[i * 6], cz: a[i * 6 + 1], ux: a[i * 6 + 2], uz: a[i * 6 + 3], hu: a[i * 6 + 4], hv: a[i * 6 + 5] })

  it('writes 2 boxes per auto door and 1 per swing door, for the count the registry is told', () => {
    const out = new Float64Array(leafBlockerCount(walk.doors) * BLOCKER_STRIDE)
    const n = writeLeafBlockers(walk.doors, new Float32Array(walk.doors.length), out)
    expect(n).toBe(leafBlockerCount(walk.doors))
    expect(n).toBe(walk.doors.filter((d) => d.kind === 'auto').length * 2 + walk.doors.filter((d) => d.kind === 'swing').length)
    for (let i = 0; i < n; i++) {
      const b = read(out, i)
      expect(Math.hypot(b.ux, b.uz)).toBeCloseTo(1, 9)
      expect(b.hu).toBeGreaterThan(0.25)
      expect(b.hv).toBeGreaterThan(0.02)
    }
  })

  it('match the drawn leaves within a millimetre at openings 0, 0.3, 0.7 and 1: where, how long, which way, and a centimetre thicker', () => {
    for (const d of walk.doors) {
      for (const e of OPENINGS) {
        const out = new Float64Array(2 * BLOCKER_STRIDE)
        const n = writeLeafBlockers([d], [e], out)
        if (d.kind === 'auto') {
          expect(n).toBe(2)
          const glass = new Float32Array(2 * 16)
          const bars = new Float32Array(8 * 16)
          writeAutoDoor(glass, bars, 0, d, e)
          for (let side = 0; side < 2; side++) {
            // the leaf's top bar spans its whole width and thickness
            const bar = readInstance(bars, side * 4)
            const b = read(out, side)
            const label = `${d.id} leaf ${side} at ${e}`
            expect(Math.abs(b.cx - bar.p.x), label).toBeLessThan(1e-3)
            expect(Math.abs(b.cz - bar.p.z), label).toBeLessThan(1e-3)
            expect(Math.abs(b.hu - bar.xAxis.length() / 2), label).toBeLessThan(1e-3)
            expect(Math.abs(b.hv - (bar.zAxis.length() / 2 + LEAF_BLOCKER_GROW)), label).toBeLessThan(1e-3)
            expect(Math.abs(b.ux * bar.xAxis.x + b.uz * bar.xAxis.z) / bar.xAxis.length(), label).toBeGreaterThan(1 - 1e-6)
          }
        } else {
          expect(n).toBe(1)
          const leaves = new Float32Array(16)
          writeSwingDoor(leaves, 0, d, e)
          const leaf = readInstance(leaves, 0)
          const b = read(out, 0)
          const label = `${d.id} at ${e}`
          expect(Math.abs(b.cx - leaf.p.x), label).toBeLessThan(1e-3)
          expect(Math.abs(b.cz - leaf.p.z), label).toBeLessThan(1e-3)
          expect(Math.abs(b.hu - leaf.xAxis.length() / 2), label).toBeLessThan(1e-3)
          expect(Math.abs(b.hv - (leaf.zAxis.length() / 2 + LEAF_BLOCKER_GROW)), label).toBeLessThan(1e-3)
          expect(Math.abs(b.ux * leaf.xAxis.x + b.uz * leaf.xAxis.z) / leaf.xAxis.length(), label).toBeGreaterThan(1 - 1e-6)
        }
      }
    }
  })

  /** The four corners of box `b`. */
  const corners = (b: { cx: number; cz: number; ux: number; uz: number; hu: number; hv: number }): [number, number][] => {
    const out: [number, number][] = []
    for (const su of [-1, 1]) for (const sv of [-1, 1]) out.push([b.cx + b.ux * b.hu * su - b.uz * b.hv * sv, b.cz + b.uz * b.hu * su + b.ux * b.hv * sv])
    return out
  }

  it('shut, the leaves close the opening (nobody walks through a closed door)', () => {
    for (const d of walk.doors) {
      const out = new Float64Array(2 * BLOCKER_STRIDE)
      const n = writeLeafBlockers([d], [0], out)
      // the coordinates along the wall that the boxes cover must cover the whole opening but the jamb clearances
      const c = crossing(d)
      const along = c.axis === 'z' ? 'x' : 'z'
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < n; i++) {
        for (const [x, z] of corners(read(out, i))) {
          const a = along === 'x' ? x : z
          lo = Math.min(lo, a)
          hi = Math.max(hi, a)
        }
      }
      expect(hi - lo, d.id).toBeGreaterThanOrEqual(d.width - 0.06 - 1e-9)
    }
  })

  it('fully open, the auto leaves are inside the wall beside the opening: no blocker in the clear opening', () => {
    const walls = buildWallBoxes().filter((b) => b.y0 === 0 && !b.sign)
    const inWall = (x: number, z: number): boolean => walls.some((b) => x >= b.x0 - 1e-6 && x <= b.x1 + 1e-6 && z >= b.z0 - 1e-6 && z <= b.z1 + 1e-6)
    let doors = 0
    for (const d of walk.doors.filter((q) => q.kind === 'auto')) {
      const out = new Float64Array(2 * BLOCKER_STRIDE)
      writeLeafBlockers([d], [1], out)
      doors++
      for (let i = 0; i < 2; i++) {
        for (const [x, z] of corners(read(out, i))) expect(inWall(x, z), `${d.id} leaf ${i} corner (${x.toFixed(3)}, ${z.toFixed(3)})`).toBe(true)
        // and the clear opening is the whole opening between the jambs
        const c = crossing(d)
        const mid = c.axis === 'z' ? d.x : d.z
        const b = read(out, i)
        const centre = c.axis === 'z' ? b.cx : b.cz
        expect(Math.abs(centre - mid) - b.hu, `${d.id} leaf ${i}`).toBeGreaterThanOrEqual(d.width / 2)
      }
    }
    expect(doors).toBeGreaterThan(10)
  })

  it('fully open, every swing leaf leaves at least 0.75 m of the doorway for your body', () => {
    for (const d of walk.doors.filter((q) => q.kind === 'swing')) {
      const out = new Float64Array(BLOCKER_STRIDE)
      writeLeafBlockers([d], [1], out)
      // along the wall, measured from the hinge jamb toward the far jamb
      const hingeAt = d.hinge * (d.width / 2)
      let reach = 0
      for (const [x, z] of corners(read(out, 0))) {
        const a = d.wallAxis === 'x' ? x - d.x : z - d.z
        reach = Math.max(reach, (-d.hinge * a) + hingeAt) // distance from the hinge jamb along the doorway
      }
      expect(d.width - reach, d.id).toBeGreaterThanOrEqual(0.75)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// W3: the swing doors are double-acting
// ---------------------------------------------------------------------------------------------

describe('W3: swing doors are double-acting (the leaf opens away from whoever sets it off)', () => {
  const swingDoors = walk.doors.filter((d) => d.kind === 'swing')
  const indexOf = (d: WalkDoor): number => walk.doors.indexOf(d)
  /** Signed metres from the wall line of `d`, positive on its `into` side. */
  const across = (d: WalkDoor, x: number, z: number): number => (x - d.x) * d.into.x + (z - d.z) * d.into.z
  /** The point `m` metres from the middle of the doorway on side `s` (+1 the `into` side, -1 the other), `lateral` metres along the wall. */
  const at = (d: WalkDoor, s: 1 | -1, m: number, lateral = 0): { x: number; z: number } => ({
    x: d.x + d.into.x * s * m + d.along.x * lateral,
    z: d.z + d.into.z * s * m + d.along.z * lateral,
  })
  const who = (d: WalkDoor, s: 1 | -1, m = 1.2, lateral = 0): PersonLike => {
    const p = at(d, s, m, lateral)
    return person(p.x, p.z)
  }
  const step = (bank: DoorBank, seconds: number, people: PersonLike[], player: { x: number; z: number } | null = null, lead: DoorLead | null = null): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) bank.update(DT, people, player, lead)
  }
  /** Where the leaf of `d` is, measured across its wall line (positive on the `into` side): the drawn leaf's centre and the blocker box's centre. */
  const leafAcross = (d: WalkDoor, bank: DoorBank): { drawn: number; box: number } => {
    const i = indexOf(d)
    const m = new Float32Array(16)
    writeSwingDoor(m, 0, d, bank.shown[i], bank.swing[i])
    const l = readInstance(m, 0)
    const out = new Float64Array(BLOCKER_STRIDE)
    writeLeafBlockers([d], [bank.shown[i]], out, [bank.swing[i]])
    return { drawn: across(d, l.p.x, l.p.z), box: across(d, out[0], out[1]) }
  }

  it('a person coming from either side: the leaf swings to the far side of the wall line from them (drawn, and as the solid box)', () => {
    // level 1 still has 21 (16 patient rooms, the staff room, clean supply, ... and the W4 lab door); R2 level 2 adds the theatre staff room, and its doors are swept the same way
    expect(swingDoors.filter((d) => levelOf(d.x) === 1).length).toBe(21)
    expect(swingDoors.filter((d) => levelOf(d.x) === 2).map((d) => d.id)).toEqual(['l2Staff'])
    expect(swingDoors.length).toBe(22)
    for (const d of swingDoors) {
      for (const s of [1, -1] as const) {
        const bank = new DoorBank(walk.doors)
        step(bank, 1, [who(d, s)])
        const i = indexOf(d)
        expect(bank.shown[i], d.id).toBe(1)
        // the person is on side s, so the leaf goes toward -s: `swing` is +1 toward `into`
        expect(bank.swing[i], `${d.id} person on side ${s}`).toBe(-s)
        const l = leafAcross(d, bank)
        expect(l.drawn * s, `${d.id} drawn leaf, person on side ${s}`).toBeLessThan(-0.5)
        expect(l.box * s, `${d.id} leaf box, person on side ${s}`).toBeLessThan(-0.5)
        expect(Math.abs(l.drawn - l.box), d.id).toBeLessThan(1e-3)
      }
    }
  })

  it('you, running at the door from either side: the leaf swings away from you (the lead segment crosses the wall line, your side is where you stand)', () => {
    for (const d of swingDoors) {
      for (const s of [1, -1] as const) {
        const bank = new DoorBank(walk.doors)
        const from = at(d, s, 2.4)
        const lead = setLead(newLead(), -s * d.into.x * HURRY, -s * d.into.z * HURRY, 0, 0, LEAD_SECONDS)
        step(bank, 1, [], from, lead)
        const i = indexOf(d)
        expect(bank.swing[i], `${d.id} player on side ${s}`).toBe(-s)
        expect(bank.shown[i], d.id).toBe(1)
        expect(leafAcross(d, bank).box * s, d.id).toBeLessThan(-0.5)
      }
    }
  })

  it('standing in the doorway, the way you are heading decides (toward the into side: it swings that way; the other way, the other; no lead: toward into)', () => {
    const d = door('room:A3')
    const i = indexOf(d)
    const mid = { x: d.x, z: d.z }
    for (const [heading, want] of [[1, 1], [-1, -1]] as const) {
      const bank = new DoorBank(walk.doors)
      step(bank, 0.2, [], mid, setLead(newLead(), d.into.x * heading * WALK, d.into.z * heading * WALK, 0, 0, LEAD_SECONDS))
      expect(bank.swing[i], `heading ${heading}`).toBe(want)
    }
    const bank = new DoorBank(walk.doors)
    step(bank, 0.2, [], mid)
    expect(bank.swing[i]).toBe(1)
  })

  it('a patient in bed (2 m off, either side) still does not set a swing door off: the sensing radius is unchanged', () => {
    for (const d of swingDoors) {
      for (const s of [1, -1] as const) {
        const bank = new DoorBank(walk.doors)
        step(bank, 2, [who(d, s, 2.0), who(d, s, 1.7, 0.6)])
        expect(bank.shown[indexOf(d)], `${d.id} side ${s}`).toBe(0)
      }
    }
  })

  it('the direction is kept until the door has shut: another body on either side, while it opens, stands open or closes, never flips it', () => {
    const d = door('room:A3')
    const i = indexOf(d)
    const bank = new DoorBank(walk.doors)
    // somebody on side -1 opens it toward +1
    step(bank, 1, [who(d, -1)])
    expect([bank.swing[i], bank.shown[i]]).toEqual([1, 1])
    // both sides at once: still the same way
    step(bank, 1, [who(d, -1), who(d, 1)])
    expect([bank.swing[i], bank.shown[i]]).toEqual([1, 1])
    // only the side the leaf stands on is occupied: held open, same way
    step(bank, 1, [who(d, 1)])
    expect([bank.swing[i], bank.shown[i]]).toEqual([1, 1])
    // everybody leaves; part-way through closing somebody comes from the leaf's own side: it opens again the SAME way
    for (let k = 0; k < 600 && bank.raw[i] >= 0.5; k++) bank.update(DT, [], null)
    expect(bank.raw[i]).toBeGreaterThan(0)
    expect(bank.raw[i]).toBeLessThan(0.5)
    const before = bank.raw[i]
    step(bank, 0.1, [who(d, 1)])
    expect(bank.swing[i]).toBe(1)
    expect(bank.raw[i]).toBeGreaterThan(before)
    // all the way open, everyone gone, and shut again: now the same side flips it (away from them)
    step(bank, 1, [who(d, 1)])
    step(bank, 4, [])
    expect([bank.raw[i], bank.shown[i]]).toEqual([0, 0])
    step(bank, 1, [who(d, 1)])
    expect([bank.swing[i], bank.shown[i]]).toEqual([-1, 1])
  })

  it('from shut, people on both sides on the same frame: you before the crowd, then the crowd in order (a fixed rule, no flicker)', () => {
    const d = door('room:A3')
    const i = indexOf(d)
    const you = at(d, -1, 1.2)
    const a = new DoorBank(walk.doors)
    step(a, 0.2, [who(d, 1)], you)
    expect(a.swing[i]).toBe(1) // you are on side -1: away from you
    const b = new DoorBank(walk.doors)
    step(b, 0.2, [who(d, 1), who(d, -1)])
    expect(b.swing[i]).toBe(-1) // the first person is on side 1
    const c = new DoorBank(walk.doors)
    step(c, 0.2, [who(d, -1), who(d, 1)])
    expect(c.swing[i]).toBe(1)
  })

  it('a long muddle of people switching sides: the direction only ever changes on a frame the door was fully shut, and it does change between visits', () => {
    const d = door('room:B5')
    const i = indexOf(d)
    const bank = new DoorBank(walk.doors)
    const cycles = [5, 2.9, 3.4, 5, 2.7, 4, 3.1, 5]
    let flips = 0
    let t0 = 0
    cycles.forEach((len, c) => {
      const first: 1 | -1 = c % 3 === 1 ? 1 : c % 2 === 0 ? -1 : 1
      for (let f = 0; f < Math.round(len * 60); f++) {
        const t = f / 60
        // for the first 1.5 s of a visit somebody is near, swapping sides every 16 frames; then nobody (the door closes, or is caught closing)
        const people = t < 1.5 ? [who(d, (Math.floor(f / 16) % 2 === 0 ? first : -first) as 1 | -1, 1.0)] : []
        const swingBefore = bank.swing[i]
        const rawBefore = bank.raw[i]
        bank.update(DT, people, null)
        if (bank.swing[i] !== swingBefore) {
          flips++
          expect(rawBefore, `visit ${c} frame ${f}: the direction changed with the door ${(rawBefore * 100).toFixed(1)} % open`).toBe(0)
        }
      }
      t0 += len
    })
    expect(t0).toBeGreaterThan(30)
    expect(flips).toBeGreaterThan(0)
  })

  it('Tab into a doorway: the doors in range open at once and swing away from you; a door already part open keeps its way', () => {
    const d = door('room:A3')
    const i = indexOf(d)
    for (const s of [1, -1] as const) {
      const bank = new DoorBank(walk.doors)
      const me = at(d, s, 0.5)
      expect(bank.snapOpenNear(me)).toBe(true)
      expect([bank.swing[i], bank.shown[i]]).toEqual([-s, 1])
      expect(leafAcross(d, bank).box * s).toBeLessThan(-0.5)
    }
    const bank = new DoorBank(walk.doors)
    step(bank, 0.25, [who(d, -1)]) // opening toward +1
    expect(bank.raw[i]).toBeGreaterThan(0)
    expect(bank.raw[i]).toBeLessThan(1)
    bank.snapOpenNear(at(d, 1, 0.5))
    expect([bank.swing[i], bank.shown[i]]).toEqual([1, 1])
  })

  it('auto doors have no direction: their swing stays +1 whoever comes and from where', () => {
    const entrance = door('entrance')
    const bank = new DoorBank(walk.doors)
    step(bank, 1, [person(entrance.x - 1, entrance.z), person(entrance.x + 1, entrance.z)])
    step(bank, 1, [who(entrance, -1)])
    for (let k = 0; k < bank.count; k++) if (walk.doors[k].kind === 'auto') expect(bank.swing[k], walk.doors[k].id).toBe(1)
  })

  it('the drawn leaf and the blocker box agree within a millimetre at openings 0, 0.3, 0.7 and 1, in both directions; one is the mirror of the other across the wall line', () => {
    for (const d of swingDoors) {
      for (const e of [0, 0.3, 0.7, 1]) {
        const centres: { along: number; across: number; ux: number; uz: number }[] = []
        for (const dir of [1, -1] as const) {
          const leaves = new Float32Array(16)
          writeSwingDoor(leaves, 0, d, e, dir)
          const leaf = readInstance(leaves, 0)
          const out = new Float64Array(BLOCKER_STRIDE)
          const n = writeLeafBlockers([d], [e], out, [dir])
          expect(n).toBe(1)
          const label = `${d.id} at ${e}, dir ${dir}`
          expect(Math.abs(out[0] - leaf.p.x), label).toBeLessThan(1e-3)
          expect(Math.abs(out[1] - leaf.p.z), label).toBeLessThan(1e-3)
          expect(Math.abs(out[4] - leaf.xAxis.length() / 2), label).toBeLessThan(1e-3)
          expect(Math.abs(out[5] - (leaf.zAxis.length() / 2 + LEAF_BLOCKER_GROW)), label).toBeLessThan(1e-3)
          expect(Math.abs(out[2] * leaf.xAxis.x + out[3] * leaf.xAxis.z) / leaf.xAxis.length(), label).toBeGreaterThan(1 - 1e-6)
          // the leaf's end points: the hinge end stays at the jamb, the free end is where `swingDirection` says
          const dirV = swingDirection(d, e * d.maxAngle, dir)
          const lw = swingLeafWidth(d)
          const hx = d.x + d.hinge * d.along.x * (d.width / 2 - 0.015)
          const hz = d.z + d.hinge * d.along.z * (d.width / 2 - 0.015)
          expect(Math.abs(leaf.p.x - (hx + dirV.x * lw / 2)), label).toBeLessThan(1e-3)
          expect(Math.abs(leaf.p.z - (hz + dirV.z * lw / 2)), label).toBeLessThan(1e-3)
          centres.push({ along: (leaf.p.x - d.x) * d.along.x + (leaf.p.z - d.z) * d.along.z, across: across(d, leaf.p.x, leaf.p.z), ux: out[2], uz: out[3] })
        }
        // the mirror image across the wall line: the same place along the wall, the opposite across it
        expect(Math.abs(centres[0].along - centres[1].along), `${d.id} at ${e}`).toBeLessThan(1e-3)
        expect(Math.abs(centres[0].across + centres[1].across), `${d.id} at ${e}`).toBeLessThan(1e-3)
        if (e === 0) expect(Math.abs(centres[0].across), d.id).toBeLessThan(1e-6)
        else expect(centres[0].across, `${d.id} at ${e}: dir +1 is toward the into side`).toBeGreaterThan(0)
      }
    }
  })

  it('swung the other way a fully open leaf still leaves at least 0.75 m of the doorway for your body', () => {
    for (const d of swingDoors) {
      const out = new Float64Array(BLOCKER_STRIDE)
      writeLeafBlockers([d], [1], out, [-1])
      const hingeAt = d.hinge * (d.width / 2)
      let reach = 0
      const [cx, cz, ux, uz, hu, hv] = [out[0], out[1], out[2], out[3], out[4], out[5]]
      for (const su of [-1, 1]) {
        for (const sv of [-1, 1]) {
          const x = cx + ux * hu * su - uz * hv * sv
          const z = cz + uz * hu * su + ux * hv * sv
          const a = d.wallAxis === 'x' ? x - d.x : z - d.z
          reach = Math.max(reach, -d.hinge * a + hingeAt)
        }
      }
      expect(d.width - reach, d.id).toBeGreaterThanOrEqual(0.75)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The painters, against recording stubs
// ---------------------------------------------------------------------------------------------

function stubContext(): { ctx: Paint2D; texts: string[]; rects: number } {
  const texts: string[] = []
  const state = { rects: 0 }
  const noop = (): void => undefined
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    rect: noop,
    clip: noop,
    fillRect: () => {
      state.rects++
    },
    fillText: (t: string) => {
      texts.push(t)
    },
    measureText: (t: string) => ({ width: t.length * 9 }),
  } as unknown as Paint2D
  return { ctx, texts, get rects() { return state.rects } }
}

describe('the sign atlas painter', () => {
  it('draws every label of every sign and every plate, from the content words', () => {
    const atlas = packAtlas(walk.tiles)
    const stub = stubContext()
    paintAtlas(stub.ctx, atlas, walk.tiles)
    const drawn = stub.texts.join('\u0000')
    for (const t of walk.tiles) {
      if (t.kind === 'sign') for (const r of t.rows) expect(drawn, r.label).toContain(r.label)
      else if (t.kind === 'room') expect(drawn).toContain(t.id)
      else expect(drawn, t.label).toContain(t.label)
    }
  })

  it('shrinks text to fit instead of overflowing: the font only gets smaller', () => {
    const atlas = packAtlas(walk.tiles.filter((t) => t.kind === 'name'))
    const stub = stubContext()
    const sizes: number[] = []
    const ctx = stub.ctx
    let font = ''
    Object.defineProperty(ctx, 'font', { get: () => font, set: (v: string) => { font = v; const m = /(\d+(?:\.\d+)?)px/.exec(v); if (m) sizes.push(Number(m[1])) } })
    paintAtlas(ctx, atlas, walk.tiles.filter((t) => t.kind === 'name'))
    expect(sizes.length).toBeGreaterThan(0)
    for (const s of sizes) expect(s).toBeLessThanOrEqual(44)
  })

  it('refuses a tile that has no cell', () => {
    const atlas = packAtlas([])
    expect(() => paintAtlas(stubContext().ctx, atlas, walk.tiles.slice(0, 1))).toThrow()
  })
})

describe('the ceiling picture', () => {
  it('paints a square cell: seams on the tile grid in the albedo, a light panel in both, and black everywhere else in the emissive', () => {
    for (const emissive of [false, true]) {
      const calls: { style: string; x: number; y: number; w: number; h: number }[] = []
      const ctx: CeilingPaint = {
        fillStyle: '',
        fillRect(x, y, w, h) {
          calls.push({ style: String(this.fillStyle), x, y, w, h })
        },
      }
      paintCeilingCell(ctx, emissive)
      expect(calls[0]).toMatchObject({ x: 0, y: 0, w: CEILING_PX, h: CEILING_PX })
      expect(calls[0].style).toBe(emissive ? '#000000' : '#f2f2ee')
      // nothing is drawn outside the cell
      for (const c of calls) {
        expect(c.x + c.w).toBeLessThanOrEqual(CEILING_PX + 1)
        expect(c.y + c.h).toBeLessThanOrEqual(CEILING_PX + 1)
      }
      if (emissive) expect(calls.some((c) => c.style === '#ffffff')).toBe(true)
      else expect(calls.length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Winding: what faces which way
// ---------------------------------------------------------------------------------------------

/** The unit normal of every triangle, and the triangle's centre. */
function triangleNormals(g: BufferGeometry): { n: Vector3; c: Vector3 }[] {
  const pos = g.getAttribute('position')
  const idx = g.index!
  const out: { n: Vector3; c: Vector3 }[] = []
  const v = (i: number): Vector3 => new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
  for (let i = 0; i < idx.count; i += 3) {
    const a = v(idx.getX(i))
    const b = v(idx.getX(i + 1))
    const c = v(idx.getX(i + 2))
    out.push({ n: new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize(), c: a.clone().add(b).add(c).divideScalar(3) })
  }
  return out
}

describe('the geometry faces the right way', () => {
  const atlas = packAtlas(walk.tiles)
  const compiled = compileWalk(walk, atlas)

  it('every ceiling triangle faces down (so it is seen from inside the rooms and from nowhere above)', () => {
    for (const ch of compiled.chunks) {
      if (!ch.ceiling) continue
      for (const t of triangleNormals(ch.ceiling)) expect(t.n.y).toBeCloseTo(-1, 6)
    }
  })

  it('the normals the shader gets agree with the winding', () => {
    for (const ch of compiled.chunks) {
      for (const g of [ch.wall, ch.frame, ch.ceiling]) {
        if (!g) continue
        const nor = g.getAttribute('normal')
        const idx = g.index!
        const faces = triangleNormals(g)
        for (let t = 0; t < faces.length; t += 37) {
          const i = idx.getX(t * 3)
          expect(faces[t].n.x * nor.getX(i) + faces[t].n.y * nor.getY(i) + faces[t].n.z * nor.getZ(i)).toBeCloseTo(1, 5)
        }
      }
    }
  })

  it('every box faces outward: the triangle normal points away from the box centre', () => {
    const g = compiled.chunks.find((c) => c.wall)!.wall!
    g.computeBoundingBox()
    const pos = g.getAttribute('position')
    // sample the first 40 boxes (24 vertices each)
    for (let box = 0; box < 40; box++) {
      const vs = Array.from({ length: 24 }, (_, k) => new Vector3(pos.getX(box * 24 + k), pos.getY(box * 24 + k), pos.getZ(box * 24 + k)))
      const centre = vs.reduce((s, p) => s.add(p), new Vector3()).divideScalar(24)
      const tris = triangleNormals(g).slice(box * 12, box * 12 + 12)
      for (const t of tris) expect(t.n.dot(t.c.clone().sub(centre))).toBeGreaterThan(0)
    }
  })

  it('each sign and plate picture faces along its heading, and sits where its placement says', () => {
    const g = compiled.signs!
    const faces = triangleNormals(g)
    expect(faces.length).toBe(walk.quads.length * 2)
    walk.quads.forEach((q, i) => {
      for (const t of [faces[i * 2], faces[i * 2 + 1]]) {
        expect(t.n.x).toBeCloseTo(Math.sin(q.heading), 6)
        expect(t.n.z).toBeCloseTo(Math.cos(q.heading), 6)
        expect(Math.abs(t.c.y - q.cy)).toBeLessThan(q.h / 2)
      }
    })
  })

  it('the picture on a sign reads left to right for a reader in front of it (its right edge is where the heading says)', () => {
    const g = compiled.signs!
    const pos = g.getAttribute('position')
    const uv = g.getAttribute('uv')
    walk.quads.forEach((q, i) => {
      // vertex 0 is bottom-left, vertex 1 bottom-right (seen from the front): u grows along (cos h, -sin h)
      const a = new Vector3(pos.getX(i * 4), 0, pos.getZ(i * 4))
      const b = new Vector3(pos.getX(i * 4 + 1), 0, pos.getZ(i * 4 + 1))
      const right = b.sub(a).normalize()
      expect(right.x).toBeCloseTo(Math.cos(q.heading), 6)
      expect(right.z).toBeCloseTo(-Math.sin(q.heading), 6)
      expect(uv.getX(i * 4 + 1)).toBeGreaterThan(uv.getX(i * 4))
    })
  })

  it('plates hang on the face of their wall: a solid wall one half-thickness plus the backing off the line, facing into the corridor', () => {
    for (const p of walk.plates.filter((q) => q.kind === 'room')) {
      expect(Math.abs(p.z - p.line)).toBeCloseTo(0.1 + 0.02 + 0.002, 6)
    }
    expect(DOORS.length).toBeGreaterThan(0)
  })
})
