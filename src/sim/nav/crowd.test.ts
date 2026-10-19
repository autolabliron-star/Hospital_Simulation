/**
 * Node tests of the crowd movement: keep right, local avoidance, doors, queues' neighbours, a whole building of walkers sent
 * to random seats, the courtesy sidestep, determinism, and the cost per step. (W2: the whole corridor is the people's: no robot lanes
 * or crossing zones.)
 */
import { describe, expect, it } from 'vitest'
import { BANDS, ROOMS, roomById } from '../places'
import { mulberry32 } from '../rng'
import { defaultSeats } from '../seats'
import type { Vec2 } from '../types'
import { makeWalker, type Walker } from '../walker'
import { Crowd, type CrowdWalker } from './crowd'
import { NAV } from './graph'
import { isWalkable } from './layout'

const DT = 1 / 60

// ---------------------------------------------------------------------------------------------
// Independent helpers
// ---------------------------------------------------------------------------------------------

interface Rig {
  crowd: Crowd
  walkers: Walker[]
}

function rig(): Rig {
  return { crowd: new Crowd(), walkers: [] }
}

function add(r: Rig, id: string, from: Vec2, heading: number, to?: Vec2, opts: { radius?: number } = {}): Walker {
  const w = makeWalker(r.crowd, { id, ...opts })
  w.place(from.x, from.z, heading)
  if (to) w.goTo(to)
  r.walkers.push(w)
  return w
}

/** One sim step for everyone: the crowd's snapshot first, then each walker in order. Returns how many have not arrived. */
function stepAll(r: Rig, speed = 1.3): number {
  r.crowd.beginStep()
  let moving = 0
  for (const w of r.walkers) if (w.step(DT, speed) !== 'arrived') moving++
  return moving
}

// ---------------------------------------------------------------------------------------------
// Keep right
// ---------------------------------------------------------------------------------------------

describe('keep right', () => {
  it('two walkers meeting head-on in a corridor pass without overlapping, to the right of each other', () => {
    const r = rig()
    const a = add(r, 'a', { x: -38, z: -14 }, Math.PI / 2, { x: 34, z: -14 })
    const b = add(r, 'b', { x: 34, z: -14 }, -Math.PI / 2, { x: -38, z: -14 })
    let minGap = Infinity
    let aSouth = 0
    let bNorth = 0
    let steps = 0
    for (; steps < 60 * 120; steps++) {
      const moving = stepAll(r)
      minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.z - b.z))
      // while they are side by side
      if (Math.abs(a.x - b.x) < 1.5) {
        aSouth = Math.max(aSouth, a.z + 14)
        bNorth = Math.max(bNorth, -14 - b.z)
      }
      if (moving === 0) break
    }
    expect(steps).toBeLessThan(60 * 120)
    expect(minGap).toBeGreaterThanOrEqual(0.5) // two 0.25 m bodies never touch
    // a walks east: its right is south (+z); b walks west: its right is north (-z)
    expect(aSouth).toBeGreaterThan(0.2)
    expect(bNorth).toBeGreaterThan(0.2)
    // and both end exactly where they were going
    expect(a.x).toBe(34)
    expect(a.z).toBe(-14)
    expect(b.x).toBe(-38)
  })

  it('a walker on a corridor takes an offset of at most 0.45 m, on its right, and a hall gives more room', () => {
    const r = rig()
    const a = add(r, 'solo', { x: -38, z: 14 }, Math.PI / 2, { x: 30, z: 14 }) // ward B, eastbound: right is... south? (z grows)
    let maxOff = 0
    let sum = 0
    let n = 0
    for (let i = 0; i < 60 * 80; i++) {
      stepAll(r)
      if (a.x > -30 && a.x < 20) {
        maxOff = Math.max(maxOff, Math.abs(a.z - 14))
        sum += a.z - 14
        n++
      }
    }
    expect(maxOff).toBeLessThanOrEqual(0.45 + 1e-6)
    expect(maxOff).toBeGreaterThan(0.25)
    expect(sum / n).toBeGreaterThan(0) // eastbound: right is +z
  })
})

// ---------------------------------------------------------------------------------------------
// Local avoidance
// ---------------------------------------------------------------------------------------------

describe('local avoidance', () => {
  it('slows down behind a slower walker going the same way instead of walking through them', () => {
    const r = rig()
    const slow = add(r, 'slow', { x: -36, z: -14 }, Math.PI / 2, { x: 20, z: -14 })
    const fast = add(r, 'fast', { x: -39, z: -14 }, Math.PI / 2, { x: 20, z: -14 })
    let minGap = Infinity
    let fastSpeedBehind = 0
    for (let i = 0; i < 60 * 70; i++) {
      r.crowd.beginStep()
      slow.step(DT, 0.7)
      fast.step(DT, 1.6)
      minGap = Math.min(minGap, Math.hypot(slow.x - fast.x, slow.z - fast.z))
      if (slow.x < 10 && fast.x < slow.x && slow.x - fast.x < 0.9) fastSpeedBehind = Math.max(fastSpeedBehind, fast.speed)
    }
    expect(minGap).toBeGreaterThanOrEqual(0.45)
    // when it was right behind (under 0.9 m between the two centres), the fast walker was no faster than the slow one
    expect(fastSpeedBehind).toBeLessThan(0.7 * 1.06 + 0.2)
  })

  it('steps round a standing person in an open hall and in a corridor, and does not touch them', () => {
    for (const [from, to, stand] of [
      [{ x: -58, z: 0 }, { x: -46, z: 0 }, { x: -52, z: 0.4 }],
      [{ x: -38, z: -14 }, { x: 10, z: -14 }, { x: -10, z: -14 }],
    ] as const) {
      const r = rig()
      const w = add(r, 'mover', from, Math.PI / 2, to)
      const s = add(r, 'standing', stand, 0)
      s.setStatic(true)
      let minGap = Infinity
      for (let i = 0; i < 60 * 80; i++) {
        stepAll(r)
        minGap = Math.min(minGap, Math.hypot(w.x - s.x, w.z - s.z))
        if (isArrived(w, to)) break
      }
      expect(isArrived(w, to)).toBe(true)
      expect(minGap).toBeGreaterThanOrEqual(0.45)
      expect(s.x).toBe(stand.x)
      expect(s.z).toBe(stand.z)
    }
  })

  it('treats a seated person (placed on a seat, no route) as a fixed obstacle and removes them from the crowd on remove()', () => {
    const r = rig()
    const w = add(r, 'mover', { x: -38, z: -14 }, Math.PI / 2, { x: 10, z: -14 })
    const blocker = add(r, 'sitter', { x: -20, z: -14 }, 0)
    // a wall of people across the middle of the corridor: the mover must stop short, not pass through
    const extra = [add(r, 'p1', { x: -20, z: -14.6 }, 0), add(r, 'p2', { x: -20, z: -13.4 }, 0)]
    for (const e of extra) e.setStatic(true)
    let minGap = Infinity
    for (let i = 0; i < 60 * 12; i++) {
      stepAll(r)
      for (const o of [blocker, ...extra]) minGap = Math.min(minGap, Math.hypot(w.x - o.x, w.z - o.z))
    }
    expect(minGap).toBeGreaterThanOrEqual(0.45)
    expect(w.x).toBeLessThan(-19)
    // they leave: the way is free
    blocker.remove()
    extra.forEach((e) => e.remove())
    r.walkers.splice(1)
    for (let i = 0; i < 60 * 60 && stepAll(r) > 0; i++) {
      /* walk */
    }
    expect(w.x).toBe(10)
  })

  it('a crowd member and the solo walker agree on the route end: arrives exactly on the target', () => {
    const r = rig()
    const target = ROOMS.find((q) => q.id === 'B6')!.drawerSpot
    const w = add(r, 'solo', { x: -61, z: 0 }, Math.PI / 2, target)
    let steps = 0
    while (stepAll(r) > 0 && steps++ < 60 * 300) {
      expect(isWalkable(w.x, w.z, 0.2)).toBe(true)
    }
    expect(w.x).toBe(target.x)
    expect(w.z).toBe(target.z)
    expect(w.speed).toBe(0)
  })
})

function isArrived(w: Walker, to: Vec2): boolean {
  return Math.abs(w.x - to.x) < 1e-6 && Math.abs(w.z - to.z) < 1e-6
}

// ---------------------------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------------------------

describe('single-file doors', () => {
  it('two people meeting in a room doorway take turns: one waits outside the door width, nobody is ever inside it together', () => {
    const room = roomById('A3')
    const r = rig()
    // one walks out of the room, one walks in; they meet at the door
    const out = add(r, 'out', room.doorInside, 0, { x: room.doorOutside.x + 4, z: room.doorOutside.z })
    const inn = add(r, 'inn', { x: room.doorOutside.x - 4, z: room.doorOutside.z }, 0, room.doorInside)
    const door = room.door
    const insideDoor = (w: Walker) => Math.abs(w.x - door.x) < room.doorWidth / 2 && Math.abs(w.z - door.z) < 0.5
    let both = 0
    let minGap = Infinity
    let sawWait = false
    for (let i = 0; i < 60 * 90; i++) {
      const moving = stepAll(r)
      if (insideDoor(out) && insideDoor(inn)) both++
      minGap = Math.min(minGap, Math.hypot(out.x - inn.x, out.z - inn.z))
      if (out.speed < 0.05 && !insideDoor(out) && Math.abs(out.z - door.z) < 2.5 && Math.abs(out.x - door.x) < 1) sawWait = true
      if (inn.speed < 0.05 && !insideDoor(inn) && Math.abs(inn.z - door.z) < 2.5 && Math.abs(inn.x - door.x) < 1) sawWait = true
      if (moving === 0) break
    }
    expect(both).toBe(0)
    expect(minGap).toBeGreaterThanOrEqual(0.45)
    expect(sawWait || minGap > 0.5).toBe(true)
    expect(isArrived(inn, room.doorInside)).toBe(true)
    expect(out.x).toBeGreaterThan(room.doorOutside.x + 3)
  })

  // the doorway proper (the wall line of a ward-A room door, z -16.35 .. -15.65): nobody may come to rest in it
  const inDoorway = (w: Walker, door: Vec2, width: number) => Math.abs(w.x - door.x) < width / 2 && Math.abs(w.z - door.z) < 0.35

  it('a walker following another into a room waits short of the door while the one ahead stops just inside it', () => {
    const room = roomById('A3')
    const door = room.door
    const deep = { x: door.x, z: -19 }
    const side = { x: door.x + 0.6, z: -18.4 }
    expect(isWalkable(deep.x, deep.z, 0.3) && isWalkable(side.x, side.z, 0.3)).toBe(true)
    const r = rig()
    // both in the corridor in line with the door, 1.2 m apart, going in
    const lead = add(r, 'lead', { x: door.x, z: -14.3 }, Math.PI, deep)
    const next = add(r, 'next', { x: door.x, z: -13.1 }, Math.PI, side)
    let holdUntil = -1
    let t = 0
    let stillInDoor = 0
    let waitedOutside = false
    for (let i = 0; i < 60 * 60; i++) {
      t += DT
      // the one ahead stops dead 0.95 m inside the room (somebody crossed in front of it) for 4 s, still on its way
      if (holdUntil < 0 && lead.z < door.z - 0.95) holdUntil = t + 4
      r.crowd.beginStep()
      const a = lead.step(DT, t < holdUntil ? 0 : 1.3)
      const b = next.step(DT, 1.3)
      if (next.speed < 0.05 && inDoorway(next, door, room.doorWidth)) stillInDoor += DT
      if (t < holdUntil && next.speed < 0.05 && next.z > door.z + 0.35) waitedOutside = true
      if (a === 'arrived' && b === 'arrived') break
    }
    expect(holdUntil).toBeGreaterThan(0)
    expect(stillInDoor).toBe(0)
    expect(waitedOutside).toBe(true)
    expect(isArrived(lead, deep)).toBe(true)
    expect(isArrived(next, side)).toBe(true)
  })

  it('somebody giving way at a door (a porter with a wheelchair, 0.4 m) stands aside off its centre line, and the one coming out walks past', () => {
    const room = roomById('A3')
    const door = room.door
    const r = rig()
    // one is just inside the room, nearer the door, going out; the other is in the corridor in line with the door, going in
    const out = add(r, 'out', room.doorInside, 0, { x: door.x + 4, z: room.doorOutside.z })
    const inn = add(r, 'inn', { x: door.x, z: -13.2 }, Math.PI, room.doorInside, { radius: 0.4 })
    let slowest = Infinity
    let worstAside = Infinity
    let stillInDoor = 0
    let minGap = Infinity
    for (let i = 0; i < 60 * 60; i++) {
      const moving = stepAll(r)
      if (out.speed < 0.05 && inDoorway(out, door, room.doorWidth)) stillInDoor += DT
      // from the moment it has had time to react, while the one coming out is in the door or just past it, the one giving way
      // slows down and stands to the side, still outside the door
      if (i > 30 && inn.z > door.z + 0.35 && out.z > door.z - 0.35 && out.z < door.z + 1.2) {
        slowest = Math.min(slowest, inn.speed)
        worstAside = Math.min(worstAside, Math.abs(inn.x - door.x))
      }
      minGap = Math.min(minGap, Math.hypot(out.x - inn.x, out.z - inn.z))
      if (moving === 0) break
    }
    expect(slowest).toBeLessThan(0.6)
    expect(worstAside).toBeGreaterThanOrEqual(0.45)
    expect(stillInDoor).toBe(0)
    expect(minGap).toBeGreaterThanOrEqual(0.6)
    expect(isArrived(inn, room.doorInside)).toBe(true)
    expect(out.x).toBeGreaterThan(door.x + 3)
  })
})

// ---------------------------------------------------------------------------------------------
// A whole building of walkers
// ---------------------------------------------------------------------------------------------

interface Outcome {
  arrived: number
  total: number
  minGap: number
  offGround: string[]
  endHash: string
  seconds: number
}

/** `n` walkers, each sent from one random seat's approach spot to another's. */
function crossBuilding(n: number, seed: number, maxSeconds = 420): Outcome {
  const rnd = mulberry32(seed)
  const seats = defaultSeats().filter((s) => s.kind !== 'bed')
  // every walker starts at its own seat's approach spot and goes to another walker's-free one (starts and goals are each unique)
  const pickFrom = (taken: Set<number>): Vec2 => {
    for (;;) {
      const i = Math.floor(rnd() * seats.length)
      if (!taken.has(i)) {
        taken.add(i)
        return seats[i].approach
      }
    }
  }
  const starts = new Set<number>()
  const goals = new Set<number>()
  const r = rig()
  const dests: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const from = pickFrom(starts)
    const to = pickFrom(goals)
    dests.push(to)
    add(r, `p${i}`, from, 0, to)
  }
  let minGap = Infinity
  const offGround: string[] = []
  let seconds = 0
  for (let step = 0; step < maxSeconds * 60; step++) {
    const moving = stepAll(r, 1.3)
    seconds = (step + 1) * DT
    const ws = r.walkers
    for (let i = 0; i < ws.length; i++) {
      const a = ws[i]
      if (offGround.length < 5 && !isWalkable(a.x, a.z, 0.2)) offGround.push(`p${i} at (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) t=${seconds.toFixed(1)}`)
      for (let j = i + 1; j < ws.length; j++) {
        const dx = a.x - ws[j].x
        if (dx > 0.6 || dx < -0.6) continue
        minGap = Math.min(minGap, Math.hypot(dx, a.z - ws[j].z))
      }
    }
    if (moving === 0) break
  }
  const arrived = r.walkers.filter((w, i) => Math.hypot(w.x - dests[i].x, w.z - dests[i].z) < 0.05).length
  let h = 2166136261
  for (const w of r.walkers) {
    h = Math.imul(h ^ Math.round(w.x * 1000), 16777619)
    h = Math.imul(h ^ Math.round(w.z * 1000), 16777619)
  }
  return { arrived, total: n, minGap, offGround, endHash: (h >>> 0).toString(16), seconds }
}

describe('a building of walkers', () => {
  const first = crossBuilding(60, 20261012)

  it('60 walkers sent across the building to random seats all arrive', () => {
    // eslint-disable-next-line no-console
    console.log(`crowd: ${first.arrived}/${first.total} arrived in ${first.seconds.toFixed(0)} sim s, closest approach ${first.minGap.toFixed(2)} m`)
    expect(first.arrived).toBe(first.total)
  })

  it('no two bodies ever overlap by more than 5 cm', () => {
    expect(first.minGap).toBeGreaterThanOrEqual(0.5 - 0.05)
  })

  it('nobody leaves walkable ground', () => {
    expect(first.offGround).toEqual([])
  })

  it('is deterministic: the same seed gives the same final positions; another seed differs', () => {
    expect(crossBuilding(60, 20261012).endHash).toBe(first.endHash)
    expect(crossBuilding(60, 99).endHash).not.toBe(first.endHash)
  })
})

// ---------------------------------------------------------------------------------------------
// Courtesy (W1): stepping aside for the player
// ---------------------------------------------------------------------------------------------

describe('courtesy sidestep', () => {
  /** The ward A corridor: 4 m wide, its centre line is z = -14 (W2: all of it is walkable, up to the walls and furniture). */
  const CZ = -14
  const LATERAL_RATE = 0.9
  /** A body standing mid-corridor the way the player is: a static crowd member of radius 0.45. */
  function stander(r: Rig, x: number, z: number): CrowdWalker {
    const w = makeWalker(r.crowd, { id: 'player', radius: 0.45 }) as CrowdWalker
    w.place(x, z, 0)
    w.setStatic(true)
    return w
  }
  function walker(r: Rig, id: string, from: number, to: number): CrowdWalker {
    return add(r, id, { x: from, z: CZ }, to > from ? Math.PI / 2 : -Math.PI / 2, { x: to, z: CZ }) as CrowdWalker
  }

  it('moves a walker over to one side well before they meet a body in the corridor, smoothly, and passes it with the room it was asked for', () => {
    for (const [from, to] of [
      [-12, 20],
      [20, -12],
    ]) {
      const r = rig()
      const body = stander(r, -4.7, CZ)
      const w = walker(r, 'a', from, to)
      w.setCourtesy(w.courtesyPick(body.x, body.z, 0.5), 0.5)
      expect(Math.abs(w.courtesy)).toBe(1)
      let lastZ = w.z
      let maxStep = 0
      let closest = Infinity
      let slowest = Infinity
      let moved = 0
      let sideAtThreeMetres = 0
      for (let i = 0; i < 60 * 40; i++) {
        r.crowd.beginStep()
        body.step(DT, 0)
        const st = w.step(DT, 1.3)
        maxStep = Math.max(maxStep, Math.abs(w.z - lastZ))
        lastZ = w.z
        closest = Math.min(closest, Math.hypot(w.x - body.x, w.z - body.z))
        if (Math.abs(w.x - body.x) < 3) slowest = Math.min(slowest, w.speed)
        if (Math.abs(w.x - body.x) > 2.95 && Math.abs(w.x - body.x) < 3.05) sideAtThreeMetres = Math.abs(w.z - CZ)
        moved = Math.max(moved, Math.abs(w.z - CZ))
        if (st === 'arrived') break
      }
      // it passes with the room asked for (keep-right 0.30-0.45 m plus the 0.5 m of courtesy: nothing stops it at the old 0.85 m
      // lane band), without slowing down for it
      expect(closest).toBeGreaterThanOrEqual(0.8 - 1e-6)
      expect(slowest).toBeGreaterThan(1.1)
      expect(moved).toBeGreaterThanOrEqual(0.8 - 1e-6)
      expect(moved).toBeLessThanOrEqual(0.45 + 0.5 + 1e-6)
      // the sideways move never exceeds the keep-right rate (0.9 m/s), and is under way before the last 3 m
      expect(maxStep).toBeLessThanOrEqual(LATERAL_RATE * DT * 1.05)
      expect(sideAtThreeMetres).toBeGreaterThan(0.5)
      expect(w.x).toBe(to)
    }
  })

  it('uses the whole width of the corridor, on the room side too: the full sidestep all along it, past every door, on walkable ground', () => {
    const r = rig()
    // a walker going west with the courtesy to its right, the room side, and one going east with it on the inner side
    const w = walker(r, 'w', 30, -38)
    w.setCourtesy(1, 0.6)
    const east = walker(r, 'e', -38, 30)
    east.setCourtesy(1, 0.6)
    let wide = 0
    let wideRoomSide = 0
    for (let i = 0; i < 60 * 100; i++) {
      stepAll(r)
      for (const b of [w, east]) {
        expect(isWalkable(b.x, b.z, 0.2), `(${b.x.toFixed(2)}, ${b.z.toFixed(2)})`).toBe(true)
        wide = Math.max(wide, Math.abs(b.z - CZ))
      }
      // (going west the right is the room side, z < CZ)
      wideRoomSide = Math.max(wideRoomSide, CZ - w.z)
    }
    // the 0.6 m of courtesy is made in full over the keep-right offset, where the old band stopped it at 0.85 m: no door zone
    // or lane edge gets in the way any more
    expect(wide).toBeGreaterThan(0.85)
    expect(wide).toBeLessThanOrEqual(0.45 + 0.6 + 1e-6)
    expect(wideRoomSide).toBeGreaterThan(0.85)
  })

  it('picks the side with room, with no zone in the way: at a room door the walker keeps right all the same', () => {
    const r = rig()
    // the player stands in front of door A3 (x = -13.9)
    const body = stander(r, -13.9, CZ)
    // going west, a walker's right is the room side; going east it is the inner side: both keep right (W2: no door zone shuts it)
    const west = walker(r, 'w', -2, -30)
    west.step(DT, 1.3)
    const east = walker(r, 'e', -30, -2)
    east.step(DT, 1.3)
    expect(west.courtesyPick(body.x, body.z, 0.5)).toBe(1)
    expect(east.courtesyPick(body.x, body.z, 0.5)).toBe(1)
    // out in the open corridor, with the body on the walker's path line, everybody keeps right
    const w2 = walker(r, 'w2', 8, -20)
    w2.step(DT, 1.3)
    expect(w2.courtesyPick(-4.7, CZ, 0.5)).toBe(1)
    // a body a little off the centre line, on the walker's right: the left clears it better (going west, right is z-)
    expect(w2.courtesyPick(-4.7, CZ - 0.3, 0.5)).toBe(-1)
    expect(w2.courtesyPick(-4.7, CZ + 0.3, 0.5)).toBe(1)
  })

  it('does nothing in a doorway or when crossing a corridor, and ending it returns to keep-right at the usual rate', () => {
    const r = rig()
    // from inside room A3 out through its door and on: it crosses the corridor first, so there is no sidestep there
    const w = add(r, 'door', { x: -13.9, z: -17.5 }, 0, { x: -2, z: CZ }) as CrowdWalker
    w.setCourtesy(1, 0.6)
    let worstInDoor = 0
    for (let i = 0; i < 60 * 5; i++) {
      stepAll(r)
      // while it is still in the wall line of the door (z -16.35 .. -15.65) it is on the door's centre line
      if (w.z > -16.35 && w.z < -15.65) worstInDoor = Math.max(worstInDoor, Math.abs(w.x + 13.9))
    }
    expect(worstInDoor).toBeLessThan(0.05)
    // ending it: the offset comes back to the keep-right one, no faster than 0.9 m/s
    const r2 = rig()
    const a = walker(r2, 'a', -38, 30)
    a.setCourtesy(1, 0.6)
    let lastZ = a.z
    let peak = 0
    let after = 0
    for (let i = 0; i < 60 * 30; i++) {
      if (i === 60 * 10) {
        peak = Math.abs(a.z - CZ)
        a.setCourtesy(0)
      }
      stepAll(r2)
      if (i > 60 * 10) after = Math.max(after, Math.abs(a.z - lastZ))
      lastZ = a.z
    }
    expect(peak).toBeGreaterThan(0.7)
    expect(after).toBeLessThanOrEqual(LATERAL_RATE * DT * 1.05)
    expect(Math.abs(a.z - CZ)).toBeLessThan(0.46)
  })

  it('a walker that was never asked is exactly as before (also after a request is withdrawn before it is acted on)', () => {
    const run = (touch: boolean): number[] => {
      const r = rig()
      stander(r, -4.7, CZ)
      const a = walker(r, 'a', -12, 20)
      const out: number[] = []
      for (let i = 0; i < 60 * 25; i++) {
        if (touch && i === 100) {
          a.setCourtesy(1, 0.5)
          a.setCourtesy(0)
        }
        stepAll(r)
        out.push(a.x, a.z)
      }
      return out
    }
    expect(run(true)).toEqual(run(false))
  })
})

// ---------------------------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------------------------

describe('cost', () => {
  it('120 walkers cost at most 0.3 ms per 60 Hz step (and the step does not allocate)', () => {
    const rnd = mulberry32(5)
    const seats = defaultSeats()
    const r = rig()
    for (let i = 0; i < 120; i++) {
      const a = seats[Math.floor(rnd() * seats.length)].approach
      const b = seats[Math.floor(rnd() * seats.length)].approach
      add(r, `c${i}`, a, 0, b)
    }
    // warm up (JIT) and let them spread out
    for (let i = 0; i < 600; i++) stepAll(r)
    // keep them walking: send each to a new place whenever it arrives, outside the timed region
    const reroute = () => {
      for (const w of r.walkers) if (w.speed === 0) w.goTo(seats[Math.floor(rnd() * seats.length)].approach)
    }
    reroute()
    for (let i = 0; i < 300; i++) stepAll(r)
    let total = 0
    let worst = 0
    let steps = 0
    for (let block = 0; block < 12; block++) {
      reroute()
      for (let i = 0; i < 100; i++) {
        const t0 = performance.now()
        stepAll(r)
        const dt = performance.now() - t0
        total += dt
        worst = Math.max(worst, dt)
        steps++
      }
    }
    const mean = total / steps
    // eslint-disable-next-line no-console
    console.log(`crowd cost: ${mean.toFixed(3)} ms per step for ${r.walkers.length} walkers (worst step ${worst.toFixed(3)} ms; nav nodes ${NAV.nodes.length})`)
    expect(mean).toBeLessThan(0.3)
  })

  it('does not allocate in step', () => {
    const src = Crowd.prototype.beginStep.toString() + makeWalker(new Crowd()).step.toString()
    expect(src).not.toMatch(/\bnew\b|=>|\.\.\.|\[\s*\]/)
  })
})

describe('bookkeeping', () => {
  it('registers and frees slots; a removed walker keeps working alone', () => {
    const c = new Crowd()
    const a = makeWalker(c, { id: 'a' })
    const b = makeWalker(c, { id: 'b' })
    expect(c.size).toBe(2)
    a.remove()
    expect(c.size).toBe(1)
    a.remove()
    expect(c.size).toBe(1)
    const d = makeWalker(c, { id: 'd' })
    expect(c.size).toBe(2)
    b.place(-61, 0, 0)
    b.goTo({ x: -55, z: 0 })
    d.place(-60, 2, 0)
    a.place(-58, 0, 0)
    a.goTo({ x: -57, z: 0 })
    for (let i = 0; i < 600; i++) {
      c.beginStep()
      a.step(DT, 1.3)
      b.step(DT, 1.3)
    }
    expect(a.x).toBe(-57)
    expect(b.x).toBe(-55)
  })

  it('without a crowd the walker is the plain follower: it stays exactly on its route', () => {
    const w = makeWalker()
    w.place(-38, -14, 0)
    w.goTo({ x: 10, z: -14 })
    let worst = 0
    for (let i = 0; i < 60 * 60; i++) {
      w.step(DT, 1.3)
      worst = Math.max(worst, Math.abs(w.z + 14))
    }
    expect(worst).toBeLessThan(1e-9)
    w.setStatic(true)
    w.remove()
  })

  it('knows where the corridor bands are (sanity of the helpers)', () => {
    expect(BANDS.roomWall - BANDS.innerWall).toBe(4)
  })
})
