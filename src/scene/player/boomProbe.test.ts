import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { buildWallPieces } from '@/scene/building/layout/walls'
import { allSigns } from '@/scene/wayfinding/signsL2'
import { LEVEL2_STRIP, l2, levelOf } from '@/sim/levels'
import { AREAS, BUILDING, DOORS, PLAYER_PLAZA, ROOMS, SIGNS, VIEW_WINDOWS, WALL, areaAt, ceilingHeight } from '@/sim/places'
import { OPEN_PROBE, WallBoxProbe, buildWallBoxes, insideWallBox } from './boomProbe'
import { ChaseCamera } from './chaseCamera'
import { walkableAt } from './collision'
import { CHASE } from './tuning'

const DEG = Math.PI / 180
const boxes = buildWallBoxes()
const probe = new WallBoxProbe(boxes)

/** A small deterministic generator (this is test code and presentation code, not the seeded sim). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('the wall boxes', () => {
  it('cover every wall piece of the building at full height, plus a lintel over every door and a block for every drawer cabinet', () => {
    const pieces = buildWallPieces()
    expect(pieces.length).toBeGreaterThan(100)
    expect(boxes.length).toBeGreaterThan(pieces.length)
    // every wall piece has a full-height box on its line
    for (const p of pieces) {
      const mid = (p.a + p.b) / 2
      const hit = boxes.find((b) => b.y0 === 0 && b.y1 === WALL.height && (p.alongX ? mid > b.x0 && mid < b.x1 && Math.abs((b.z0 + b.z1) / 2 - p.c) < 1e-6 : mid > b.z0 && mid < b.z1 && Math.abs((b.x0 + b.x1) / 2 - p.c) < 1e-6))
      expect(hit, `wall piece at ${p.alongX ? 'z' : 'x'} = ${p.c}`).toBeDefined()
    }
    // a lintel over a door: the entrance, from the door height up to the wall height
    const lintel = boxes.find((b) => b.y0 === WALL.doorHeight && b.y1 === WALL.height && b.x0 < -61.9 && b.x1 > -62.1 && b.z0 <= -1.4 && b.z1 >= 1.4)
    expect(lintel).toBeDefined()
    // the cabinet gaps are closed to the floor
    for (const r of ROOMS) {
      const cabinet = boxes.find((b) => b.y0 === 0 && Math.abs((b.z0 + b.z1) / 2 - r.drawer.z) < 1e-6 && b.x0 <= r.drawer.x - 0.39 && b.x1 >= r.drawer.x + 0.39 && b.x1 - b.x0 < 1)
      expect(cabinet, `cabinet of ${r.id}`).toBeDefined()
    }
    // every box is inside (or on) the outline of its level: the building, or (R2) the level-2 strip of the flat sim
    for (const b of boxes) {
      const r = levelOf((b.x0 + b.x1) / 2) === 2 ? LEVEL2_STRIP : BUILDING
      expect(b.x0).toBeGreaterThanOrEqual(r.x0 - WALL.thickness)
      expect(b.x1).toBeLessThanOrEqual(r.x1 + WALL.thickness)
      expect(b.z0).toBeGreaterThanOrEqual(r.z0 - WALL.thickness)
      expect(b.z1).toBeLessThanOrEqual(r.z1 + WALL.thickness)
    }
  })
})

describe('the sweep', () => {
  const origin = { x: -66, y: 1.62, z: 0 }

  it('is clear in the open, and stops a ball radius short of a wall face', () => {
    // from the plaza towards the building's front wall at x = -62 (face at -62.1), far from the door at z = 0, so use z = 5
    const from = { x: -66, y: 1.62, z: 5 }
    const east = { x: 1, y: 0, z: 0 }
    const hit = probe.cast(from, east, 10, 0.2)
    expect(hit).not.toBeNull()
    expect(hit as number).toBeCloseTo(-62.1 - 0.2 - from.x, 6) // face at -62.1, ball radius 0.2
    expect(probe.cast(from, east, 3, 0.2)).toBeNull() // not within 3 m
    expect(probe.cast(from, { x: -1, y: 0, z: 0 }, 20, 0.2)).toBeNull() // the other way: open air
    expect(OPEN_PROBE.cast(from, east, 10, 0.2)).toBeNull()
  })

  it('goes through the door opening at head height but not through the lintel above it', () => {
    const east = { x: 1, y: 0, z: 0 }
    expect(probe.cast(origin, east, 6, 0.2)).toBeNull() // through the entrance (3 m wide), at 1.62 m
    // at a height where the lintel (from 2.3 m) is in the way, the ball (radius 0.2) is stopped by it
    const high = { x: -66, y: 2.4, z: 0 }
    const hit = probe.cast(high, east, 6, 0.2)
    expect(hit).not.toBeNull()
    expect(hit as number).toBeCloseTo(-62.1 - 0.2 + 66, 6)
  })

  it('reports an origin already inside a grown box as a hit at 0', () => {
    const inside = { x: -62, y: 1.0, z: 5 }
    expect(probe.cast(inside, { x: 1, y: 0, z: 0 }, 3, 0.2)).toBe(0)
  })

  it('never passes through any wall: random rays from walkable points stop before every box they meet', () => {
    const rnd = lcg(7)
    let tried = 0
    while (tried < 3000) {
      const x = BUILDING.x0 + rnd() * (BUILDING.x1 - BUILDING.x0)
      const z = BUILDING.z0 + rnd() * (BUILDING.z1 - BUILDING.z0)
      if (!walkableAt(x, z)) continue
      tried++
      const yaw = rnd() * 2 * Math.PI
      const pitch = (rnd() * 70 - 15) * DEG
      const dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }
      const from = { x, y: 1.62, z }
      const len = 4.5
      const hit = probe.cast(from, dir, len, 0.2)
      const reach = hit === null ? len : hit
      // sampled along the free part, the ball centre is never inside a grown box
      for (let t = 0; t <= reach; t += 0.05) {
        const b = insideWallBox(boxes, from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t, 0.2 - 1e-6)
        expect(b, `ray ${tried} at ${t.toFixed(2)} m`).toBeNull()
      }
    }
  })
})

describe('W3: hanging signs are swept at the sign radius only', () => {
  const sign = { x0: -1, x1: 1, y0: 2.18, y1: 2.84, z0: 4, z1: 4.05, sign: true as const }
  const wallBox = { x0: -1, x1: 1, y0: 2.18, y1: 2.84, z0: 4, z1: 4.05 }

  it('a ball passes under a sign that a ball of the same size would hit if it were a wall: the sign\'s grown box is the sign radius, not the ball\'s', () => {
    // a camera at 2.06 m (a little over its resting 2.04 m: a bob, or a wall beside it) looking along +z at a box whose lower edge is 2.18 m
    const from = { x: 0, y: 2.06, z: 0 }
    const ahead = { x: 0, y: 0, z: 1 }
    expect(new WallBoxProbe([wallBox]).cast(from, ahead, 6, CHASE.probeRadius)).not.toBeNull() // a wall in the way: 2.06 + 0.2 reaches 2.26
    expect(new WallBoxProbe([wallBox]).cast(from, ahead, 6, CHASE.nearRadius)).not.toBeNull() // 2.06 + 0.13 = 2.19, too
    expect(new WallBoxProbe([sign]).cast(from, ahead, 6, CHASE.probeRadius)).toBeNull() // the sign, with the soft ball: 2.06 + 0.09 = 2.15: under it
    expect(new WallBoxProbe([sign]).cast(from, ahead, 6, CHASE.nearRadius)).toBeNull()
    // a smaller ball than the sign radius is not made bigger
    expect(CHASE.signRadius).toBeLessThanOrEqual(CHASE.nearRadius)
    const lower = { x: 0, y: 2.18 - 0.05, z: 0 } // 5 cm under the sign: a 0.04 ball clears it, the sign radius (0.09) does not
    expect(new WallBoxProbe([sign]).cast(lower, ahead, 6, 0.04)).toBeNull()
    expect(new WallBoxProbe([sign]).cast(lower, ahead, 6, 0.2)).not.toBeNull()
  })

  it('the real signs carry the flag, and no floor-standing box does (the body\'s solids are built from y0 === 0 boxes)', () => {
    const signs = boxes.filter((b) => b.sign)
    expect(signs.length).toBe(allSigns(SIGNS).length) // the 7 of level 1 and the 3 of level 2
    for (const b of signs) expect(b.y0).toBeGreaterThan(2.1)
    for (const b of boxes.filter((q) => q.y0 === 0)) expect(b.sign).toBeUndefined()
  })

  it('insideWallBox grows a sign by the sign radius at most, as the sweep does', () => {
    expect(insideWallBox([sign], 0, 2.06, 4.02, 0.2)).toBeNull() // 2.06 + 0.09 < 2.18
    expect(insideWallBox([sign], 0, 2.12, 4.02, 0.2)).not.toBeNull() // 2.12 + 0.09 > 2.18
    expect(insideWallBox([wallBox], 0, 2.06, 4.02, 0.2)).not.toBeNull()
  })
})

describe('the ceilings', () => {
  it('are the contract: 3 m in every area, open sky in the atrium and outdoors', () => {
    expect(probe.ceilingAt(-30, 0)).toBe(WALL.height)
    expect(probe.ceilingAt(-66, 0)).toBeNull() // the plaza
    const atrium = AREAS.find((a) => a.id === 'atrium')!
    expect(probe.ceilingAt((atrium.rect.x0 + atrium.rect.x1) / 2, (atrium.rect.z0 + atrium.rect.z1) / 2)).toBe(ceilingHeight('atrium'))
  })
})

describe('the camera over the whole floor plan', () => {
  /**
   * The guarantee: wherever you can stand, whichever way the camera looks and however the wheel is set, the camera's centre is never
   * inside a wall, never above the ceiling of the area it is in and never under the floor; and when the boom has not been squeezed to
   * its minimum the whole camera ball (radius `probeRadius`) is clear of every wall.
   */
  function checkFrame(cam: PerspectiveCamera, boom: number, label: string, settled = false): void {
    const p = cam.position
    expect(insideWallBox(boxes, p.x, p.y, p.z, 0), `${label}: camera centre in a wall`).toBeNull()
    // W3: from the very first frame the HARD ball (`nearRadius`) is clear of every wall (a spring brings the boom in, the clamp is the
    // guarantee); the SOFT ball (`probeRadius`) is clear once the spring has had half a second
    expect(insideWallBox(boxes, p.x, p.y, p.z, CHASE.nearRadius - 1e-6), `${label}: camera hard ball in a wall`).toBeNull()
    if (settled && boom > CHASE.minBoom + 0.02) expect(insideWallBox(boxes, p.x, p.y, p.z, CHASE.probeRadius - 1e-6), `${label}: camera ball in a wall`).toBeNull()
    const area = areaAt(p.x, p.z)
    const ceiling = area ? ceilingHeight(area.id) : null
    if (ceiling !== null) expect(p.y, `${label}: camera above the ceiling (${area?.id})`).toBeLessThanOrEqual(ceiling - CHASE.ceilingClearance + 1e-9)
    expect(p.y, `${label}: camera under the floor`).toBeGreaterThanOrEqual(CHASE.floorClearance - 1e-9)
  }

  function run(x: number, z: number, yaw: number, pitch: number, dist: number, frames: number, label: string, settledFrom = 30): void {
    const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 500)
    const chase = new ChaseCamera('classic') // the camera steered by the mouse (the guarantee holds for the easy scheme's yaws too: see chaseEasy.test.ts)
    const feet = { x, y: 0, z }
    chase.reset(feet, yaw)
    chase.setLook(yaw, pitch)
    chase.dist = dist
    for (let i = 0; i < frames; i++) {
      const r = chase.update({ feet, vx: 0, vz: 0, heading: yaw, turning: false }, { dt: 1 / 60, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }, probe, cam)
      checkFrame(cam, r.boom, `${label} frame ${i}`, i >= settledFrom)
    }
  }

  it('on a 1 m grid of every walkable spot (and the plaza), eight yaws, three pitches, from the very first frame', () => {
    let positions = 0
    for (let x = BUILDING.x0 - 10; x <= BUILDING.x1; x += 1) {
      for (let z = BUILDING.z0; z <= BUILDING.z1; z += 1) {
        const px = x + 0.37
        const pz = z + 0.21
        if (!walkableAt(px, pz)) continue
        positions++
        for (let k = 0; k < 8; k++) {
          const yaw = k * 45 * DEG + 0.17
          for (const pitch of [-15 * DEG, 8 * DEG, 55 * DEG]) run(px, pz, yaw, pitch, 3.0, 2, `(${px.toFixed(2)}, ${pz.toFixed(2)}) yaw ${k * 45} pitch ${Math.round(pitch / DEG)}`)
        }
      }
    }
    expect(positions).toBeGreaterThan(1500)
  })

  it('with the wheel pulled all the way out, from random spots and views, after the boom has had time to grow', () => {
    const rnd = lcg(11)
    let n = 0
    while (n < 400) {
      const x = BUILDING.x0 - 10 + rnd() * (BUILDING.x1 - BUILDING.x0 + 10)
      const z = BUILDING.z0 + rnd() * (BUILDING.z1 - BUILDING.z0)
      if (!walkableAt(x, z)) continue
      n++
      // the wheel's 4.5 m wants a much longer boom than the walls allow: the spring brings it in at no more than boomInMax, about a second
      run(x, z, rnd() * 2 * Math.PI, (rnd() * 70 - 15) * DEG, CHASE.maxDistance, 120, `random ${n}`, 90)
    }
  })

  it('in and around every doorway: standing in it, a step either side, looking every way', () => {
    for (const d of DOORS) {
      const along = d.wallAxis === 'z' ? 'x' : 'z'
      for (const off of [-1.2, -0.6, 0, 0.6, 1.2]) {
        for (const lateral of [-0.4, 0, 0.4]) {
          const x = d.center.x + (along === 'x' ? off : lateral)
          const z = d.center.z + (along === 'z' ? off : lateral)
          if (!walkableAt(x, z)) continue
          for (let k = 0; k < 8; k++) run(x, z, k * 45 * DEG, 8 * DEG, 3.0, 4, `door ${d.id} (${x.toFixed(2)}, ${z.toFixed(2)}) yaw ${k * 45}`)
        }
      }
    }
  })

  it('the plaza is walkable up to the entrance, and the camera outside the front wall stays outside it', () => {
    expect(walkableAt(-66, 0)).toBe(true)
    expect(walkableAt(-62.5, 0)).toBe(true) // at the door
    expect(walkableAt(-61, 0)).toBe(true) // inside the lobby
    expect(walkableAt(-62.4, 5)).toBe(true) // standing against the façade, a body radius from its face
    expect(walkableAt(-62.3, 5)).toBe(false) // closer than that: not allowed
    expect(walkableAt(-61.9, 5)).toBe(false) // never inside the wall
    expect(PLAYER_PLAZA.x1).toBe(-62)
    // standing at the door looking in: the camera is behind you, outside, never through the façade
    for (const z of [-1, 0, 1]) run(-62.6, z, Math.PI / 2, 8 * DEG, 3.0, 30, `door z ${z}`)
  })
})

describe('R2: the boom probe over level 2 (sim coordinates, the strip at sim x 88..110)', () => {
  const ahead = (x: number, z: number) => ({ x, y: 1.62, z })
  const west = { x: -1, y: 0, z: 0 }
  const window = VIEW_WINDOWS[0]

  it('the camera ball stops short of level 2\'s walls like level 1\'s: the theatre corridor\'s east glazing, and the pre-op door lintel', () => {
    // from the corridor centre looking east: the glazed outer wall at drawn x = -40 (the sim x 110), face at 109.9
    const east = { x: 1, y: 0, z: 0 }
    const hit = probe.cast(ahead(l2(-42), 0), east, 6, 0.2)
    expect(hit).not.toBeNull()
    expect(hit!).toBeCloseTo(l2(-40) - WALL.thickness / 2 - 0.2 - l2(-42), 1)
    // under the door header of the pre-op door (drawn x -44, z -13) a ball of the camera's size passes at 1.6 m; at the lintel's height it does not
    expect(probe.cast(ahead(l2(-42), -13), west, 3, 0.2)).toBeNull()
    expect(probe.cast({ x: l2(-42), y: WALL.doorHeight + 0.1, z: -13 }, west, 3, 0.05)).not.toBeNull()
  })

  it('a view window is glass: the camera ball is stopped by it, and what shows over people\'s heads (the sight boxes) sees through it into the OR', () => {
    expect(window.alongX).toBe(false)
    const z = (window.a + window.b) / 2
    const from = ahead(l2(-42.8), z)
    const solid = probe.cast(from, west, 14, 0.1)
    expect(solid).not.toBeNull()
    expect(solid!).toBeCloseTo(from.x - (window.c + WALL.thickness / 2 + 0.1), 1) // stopped by the glass at the OR's east wall line
    const sight = new WallBoxProbe(buildWallBoxes({ sight: true }))
    const through = sight.cast(from, west, 14, 0.1)
    // the ray passes the glass and ends at the OR's far (west) wall, 9 m on
    expect(through).not.toBeNull()
    expect(through!).toBeGreaterThan(solid! + 7)
    // a point on the same line beside the window (the solid part of the wall) stops both
    const beside = ahead(l2(-42.8), 8)
    expect(sight.cast(beside, west, 14, 0.1)).not.toBeNull()
    expect(sight.cast(beside, west, 14, 0.1)!).toBeLessThan(3)
  })

  it('has a ceiling at 3 m in every level-2 area, and none outdoors beside the strip', () => {
    for (const a of AREAS.filter((q) => levelOf((q.rect.x0 + q.rect.x1) / 2) === 2)) {
      const cx = (a.rect.x0 + a.rect.x1) / 2
      const cz = (a.rect.z0 + a.rect.z1) / 2
      expect(probe.ceilingAt(cx, cz), a.id).toBe(3)
    }
    expect(probe.ceilingAt(l2(-30), 0)).toBeNull() // east of the strip: nothing
    expect(probe.ceilingAt(l2(-70), 0)).toBeNull()
  })

  it('no level-2 box overlaps a level-1 one, and none of level 2\'s lies in the level-1 plan', () => {
    const upper = boxes.filter((b) => levelOf((b.x0 + b.x1) / 2) === 2)
    expect(upper.length).toBeGreaterThan(40)
    for (const b of upper) {
      expect(b.x0).toBeGreaterThanOrEqual(LEVEL2_STRIP.x0 - WALL.thickness)
      expect(b.x1).toBeLessThanOrEqual(LEVEL2_STRIP.x1 + WALL.thickness)
    }
    for (const b of boxes.filter((q) => levelOf((q.x0 + q.x1) / 2) === 1)) expect(b.x1).toBeLessThanOrEqual(BUILDING.x1 + WALL.thickness)
  })
})
