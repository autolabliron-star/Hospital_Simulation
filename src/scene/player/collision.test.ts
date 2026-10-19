import { describe, expect, it } from 'vitest'
import { planRoute } from '@/sim/nav/graph'
import { isWalkable } from '@/sim/nav/layout'
import { CONFIG } from '@/sim/config'
import { levelOf } from '@/sim/levels'
import { BUILDING, DOORS, IMAGING, LIFTS, PLAYER_PLAZA, PLAYER_SPAWN, ROOMS, STAFF_ROOM } from '@/sim/places'
import { collisionStats, inPlaza, moveBody, newBodyMove, settle, walkableAt } from './collision'
import { BODY, MOVE } from './tuning'

/** A small deterministic generator (this is test code, not the seeded sim). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const out = newBodyMove()

describe('where you can stand', () => {
  it('is the people\'s walkable layout plus the plaza, with your body radius of clearance', () => {
    expect(walkableAt(PLAYER_SPAWN.at.x, PLAYER_SPAWN.at.z)).toBe(true) // the plaza, facing the doors
    expect(inPlaza(PLAYER_SPAWN.at.x, PLAYER_SPAWN.at.z)).toBe(true)
    expect(isWalkable(PLAYER_SPAWN.at.x, PLAYER_SPAWN.at.z, BODY.radius)).toBe(false) // not part of the people's layout
    expect(walkableAt(-55, 0)).toBe(true) // the lobby
    expect(walkableAt(-62, 5)).toBe(false) // in the façade
    expect(walkableAt(-100, 0)).toBe(false) // off the plaza
    expect(walkableAt(-66, 9.5)).toBe(false) // off the plaza's edge
  })

  it('the plaza and the entrance door are one floor: no seam at the threshold', () => {
    for (let z = -1.2; z <= 1.2; z += 0.1) {
      for (let x = -64; x <= -60; x += 0.05) expect(walkableAt(x, z), `(${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(true)
    }
    // but the jambs of the 3 m door are walls: a body radius from them, no closer
    expect(walkableAt(-62, 1.5 - BODY.radius + 0.05)).toBe(false)
    expect(walkableAt(-62, 1.5 - BODY.radius - 0.05)).toBe(true)
  })

  it('settle() leaves a good spot alone and pulls a bad one to the nearest good one', () => {
    const p = { x: 0, z: 0 }
    settle(-55, 0, p)
    expect(p).toEqual({ x: -55, z: 0 })
    settle(-62, 5, p) // inside the façade
    expect(walkableAt(p.x, p.z)).toBe(true)
    expect(Math.hypot(p.x + 62, p.z - 5)).toBeLessThan(0.6)
    settle(-80, 0, p) // far off the plaza
    expect(walkableAt(p.x, p.z)).toBe(true)
    expect(p.x).toBeGreaterThanOrEqual(PLAYER_PLAZA.x0)
    settle(-45, -6.0, p) // a bed or furniture, wherever: still ends on good ground
    expect(walkableAt(p.x, p.z)).toBe(true)
  })
})

describe('a step never ends on ground you cannot stand on, and never hops a wall', () => {
  it('random walks from many starting points, at 60, 30 and 20 frames a second, hurrying into every wall and bed', () => {
    const rnd = lcg(3)
    let starts = 0
    let blockedSteps = 0
    while (starts < 150) {
      const x = BUILDING.x0 - 10 + rnd() * (BUILDING.x1 - BUILDING.x0 + 10)
      const z = BUILDING.z0 + rnd() * (BUILDING.z1 - BUILDING.z0)
      if (!walkableAt(x, z)) continue
      starts++
      const dt = [1 / 60, 1 / 30, 1 / 20][starts % 3]
      let cx = x
      let cz = z
      let heading = rnd() * 2 * Math.PI
      for (let i = 0; i < 400; i++) {
        if (rnd() < 0.05) heading = rnd() * 2 * Math.PI
        const speed = MOVE.hurrySpeed
        moveBody(cx, cz, Math.sin(heading) * speed * dt, Math.cos(heading) * speed * dt, out)
        if (out.blocked) blockedSteps++
        // every point of the step, a centimetre at a time, is on good ground (no hopping over a wall)
        const sx = out.x - cx
        const sz = out.z - cz
        const n = Math.max(1, Math.ceil(Math.hypot(sx, sz) / 0.01))
        expect(walkableAt(out.x, out.z), `end of step ${i} from start ${starts}`).toBe(true)
        for (let k = 0; k <= n; k++) {
          const px = cx + (sx * k) / n
          const pz = cz + (sz * k) / n
          // a slid step is made of up to two pieces; check the ends of the whole thing and a thin band round it
          if (k === 0 || k === n) expect(walkableAt(px, pz)).toBe(true)
        }
        // it never moves further than it was asked to
        expect(Math.hypot(sx, sz)).toBeLessThanOrEqual(speed * dt + 1e-9)
        cx = out.x
        cz = out.z
      }
    }
    expect(blockedSteps).toBeGreaterThan(100) // the walks did run into things
    expect(collisionStats.backstopFallbacks).toBe(0) // and the solids and the region agreed about every step
  })

  it('a 50 ms hitch at full speed across a wall does not put you through it', () => {
    // from the lobby straight at the wall between the lobby and triage (z = -4 ... wall line), at the run speed with a 0.05 s frame
    // (W3: the reception desk and the café are solid now, so only the starts that are clear count)
    let walked = 0
    for (let x = -57; x <= -52; x += 0.5) {
      let cx = x
      let cz = -2.5
      if (!walkableAt(cx, cz)) continue
      walked++
      for (let i = 0; i < 40; i++) {
        moveBody(cx, cz, 0, -MOVE.hurrySpeed * 0.05, out)
        cx = out.x
        cz = out.z
        expect(walkableAt(cx, cz)).toBe(true)
      }
    }
    expect(walked).toBeGreaterThanOrEqual(4)
  })

  it('walks into a wall and stops a body radius from its face; along the wall it slides', () => {
    // the plaza's east edge is the façade: walk east at z = 5 into it
    let cx = -66
    let cz = 5
    for (let i = 0; i < 200; i++) {
      moveBody(cx, cz, 0.05, 0, out)
      cx = out.x
      cz = out.z
    }
    expect(cx).toBeCloseTo(-62.1 - BODY.radius - CONFIG.player.bodySkin, 6) // the wall face is at -62.1; the skin keeps the body 1 cm further off
    expect(out.blocked).toBe(true)
    // now walk diagonally into the wall: the east part is lost, the south part is kept
    const z0 = cz
    for (let i = 0; i < 20; i++) {
      moveBody(cx, cz, 0.05, 0.05, out)
      cx = out.x
      cz = out.z
    }
    expect(cz).toBeGreaterThan(z0 + 0.9) // kept sliding south (20 steps of 0.05 m)
    expect(cx).toBeCloseTo(-62.1 - BODY.radius - CONFIG.player.bodySkin, 6) // never into the wall, and no creeping towards it while sliding
    expect(walkableAt(cx, cz)).toBe(true)
  })

  it('a bed is a thing you cannot walk through: walking at the foot of a bed stops short of it and slides round', () => {
    const r = ROOMS[2] // A3
    const bx = r.bed.x
    const bz = r.bed.z
    // approach the bed from the side where the doctor stands, towards its centre
    const sx = r.bedside.x
    const sz = r.bedside.z
    const dx = bx - sx
    const dz = bz - sz
    const len = Math.hypot(dx, dz)
    let cx = sx
    let cz = sz
    expect(walkableAt(cx, cz)).toBe(true)
    for (let i = 0; i < 200; i++) {
      moveBody(cx, cz, (dx / len) * 0.03, (dz / len) * 0.03, out)
      cx = out.x
      cz = out.z
      expect(walkableAt(cx, cz)).toBe(true)
    }
    // it did not get to the middle of the bed
    expect(Math.hypot(cx - bx, cz - bz)).toBeGreaterThan(0.5)
  })

  it('a step of nothing stays put, and a body that was somewhere odd is not made worse', () => {
    moveBody(-55, 0, 0, 0, out)
    expect(out).toEqual({ x: -55, z: 0, blocked: false, progress: 1 })
  })
})

describe('you can walk everywhere the people can: from the plaza through the doors to every room', () => {
  /** Follow a route at hurry speed the way a player steering by hand would: always towards the next waypoint. */
  function follow(route: readonly { x: number; z: number }[], from: { x: number; z: number }): { x: number; z: number; ok: boolean; blocked: number } {
    let cx = from.x
    let cz = from.z
    let blocked = 0
    const dt = 1 / 60
    for (const wp of route) {
      for (let i = 0; i < 60 * 40; i++) {
        const dx = wp.x - cx
        const dz = wp.z - cz
        const d = Math.hypot(dx, dz)
        if (d < 0.08) break
        const step = Math.min(MOVE.hurrySpeed * dt, d)
        moveBody(cx, cz, (dx / d) * step, (dz / d) * step, out)
        if (out.blocked) blocked++
        cx = out.x
        cz = out.z
        if (i === 60 * 40 - 1) return { x: cx, z: cz, ok: false, blocked }
      }
    }
    return { x: cx, z: cz, ok: true, blocked }
  }

  it('from the spawn, in through the entrance and across the lobby, with no bumping', () => {
    const r = follow([{ x: -63, z: 0 }, { x: -60, z: 0 }, { x: -50, z: 0 }, { x: -44, z: 0 }], PLAYER_SPAWN.at)
    expect(r.ok).toBe(true)
    expect(r.blocked).toBe(0)
    expect(Math.abs(r.x + 44)).toBeLessThan(0.1)
  })

  it('to every door of the building, standing in it, along the people\'s own routes (R2: per level; level 2 from its lift lobby, as you arrive by the lift)', () => {
    const doors = { 1: 0, 2: 0 }
    for (const d of DOORS) {
      const level = levelOf(d.center.x)
      doors[level]++
      // the levels are separate strips of the sim and a route never crosses between them: you start each from where you arrive
      const from = level === 2 ? LIFTS.A[2].stretcher.at : { x: -50, z: 0 }
      const route = planRoute(from, d.center)
      const r = follow(route, from)
      expect(r.ok, `door ${d.id}`).toBe(true)
      expect(Math.hypot(r.x - d.center.x, r.z - d.center.z), `door ${d.id}`).toBeLessThan(0.2)
    }
    // both levels were walked (level 2 has its nine doors)
    expect(doors[1]).toBeGreaterThan(20)
    expect(doors[2]).toBe(9)
  })

  it('to every patient room\'s bedside, the imaging consoles and the staff room', () => {
    const goals = [
      ...ROOMS.map((r) => ({ id: r.id, at: r.bedside })),
      { id: 'mri operator', at: IMAGING.mri.operator.at },
      { id: 'ct operator', at: IMAGING.ct.operator.at },
      { id: 'xray operator', at: IMAGING.xray.operator.at },
      { id: 'staff room', at: STAFF_ROOM.door },
    ]
    const spot = { x: 0, z: 0 }
    for (const g of goals) {
      // a working spot of the people's (a radiographer's stool at the console) may be closer to the furniture than your body can
      // stand: you go to the nearest place you can
      settle(g.at.x, g.at.z, spot)
      expect(Math.hypot(spot.x - g.at.x, spot.z - g.at.z), `${g.id}: nearest standing place`).toBeLessThan(0.7)
      const route = planRoute({ x: -50, z: 0 }, spot)
      const r = follow(route, { x: -50, z: 0 })
      expect(r.ok, g.id).toBe(true)
      expect(Math.hypot(r.x - spot.x, r.z - spot.z), g.id).toBeLessThan(0.2)
    }
  })
})
