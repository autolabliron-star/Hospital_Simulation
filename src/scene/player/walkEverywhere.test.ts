/**
 * Never inside anything: on EVERY frame of every sampled walk the body is at least r - 1e-4 from every static solid (and from every fake
 * door leaf), and the region backstop never had to catch a step. The walks: the centrelines of the corridors, the spine, the lobby,
 * the imaging hall and the plaza; hugging each long wall at 0.35 m and 0.6 m at 3 and 10 degrees of incidence, both ways, at 20 and 60
 * frames a second; and a few hundred random walks at the run speed, turning at random, from random starts all over the building.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { BUILDING, PLAYER_PLAZA } from '@/sim/places'
import { buildWallBoxes } from './boomProbe'
import { BodyMover } from './body'
import { bearing, classicMover, staticClearance } from './bodyTestKit'
import { collisionStats, inRegion, walkableAt } from './collision'

const R = CONFIG.player.bodyRadius
const SOLID_TOL = 1e-4
const DEG = Math.PI / 180

/** A small deterministic generator (this is test code, not the seeded sim). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

let closest = Infinity
let frameCount = 0

function expectClear(x: number, z: number, what: string): void {
  const c = staticClearance(x, z)
  frameCount++
  if (c.d < closest) closest = c.d
  if (c.d < R - SOLID_TOL) throw new Error(`${what}: the body at (${x.toFixed(4)}, ${z.toFixed(4)}) is ${c.d.toFixed(5)} m from ${c.id}`)
}

/** Walk from a to b (classic scheme: the camera looks at the goal) and check every frame. Returns how close it got and the frames spent. */
function walkLine(a: { x: number; z: number }, b: { x: number; z: number }, hurry: boolean, dt: number): { left: number; frames: number } {
  const m = classicMover(a.x, a.z)
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const maxFrames = Math.ceil((len / 1.5 + 4) / dt)
  let frames = 0
  for (; frames < maxFrames; frames++) {
    if (Math.hypot(b.x - m.x, b.z - m.z) < 0.15) break
    m.step(dt, 1, 0, hurry, bearing(m.x, m.z, b.x, b.z))
    expectClear(m.x, m.z, `line (${a.x}, ${a.z}) -> (${b.x}, ${b.z}) frame ${frames}`)
    if (!inRegion(m.x, m.z)) throw new Error(`frame ${frames}: outside the region at (${m.x}, ${m.z})`)
  }
  return { left: Math.hypot(b.x - m.x, b.z - m.z), frames }
}

describe('never inside anything: the centrelines', () => {
  const lines: [string, { x: number; z: number }, { x: number; z: number }][] = [
    ['corridor A', { x: -39, z: -14 }, { x: 39, z: -14 }],
    ['corridor B', { x: -39, z: 14 }, { x: 39, z: 14 }],
    ['the spine', { x: -42, z: -15 }, { x: -42, z: 15 }],
    ['the lobby', { x: -60.5, z: 0 }, { x: -45, z: 0 }],
    ['the imaging hall', { x: -39, z: 0 }, { x: -23, z: 0 }],
    ['the plaza', { x: -73, z: 0 }, { x: -63, z: 0 }],
    ['the plaza diagonal', { x: -73, z: -8 }, { x: -64, z: 8 }],
    ['the entrance, in and out', { x: -70, z: 0 }, { x: -56, z: 0 }],
  ]

  it('walks and runs every line both ways at 20, 60 and 144 frames a second, and gets to the end of the ones that are open', () => {
    collisionStats.backstopFallbacks = 0
    let frames = 0
    const finished: string[] = []
    for (const [name, a, b] of lines) {
      for (const [from, to] of [[a, b], [b, a]] as const) {
        for (const hurry of [false, true]) {
          for (const dt of [1 / 20, 1 / 60, 1 / 144]) {
            const r = walkLine(from, to, hurry, dt)
            frames += r.frames
            if (r.left < 0.2) finished.push(name)
          }
        }
      }
    }
    // the corridors, the spine, the hall and the plaza are open: every walk of those got to the end
    for (const name of ['corridor A', 'corridor B', 'the spine', 'the imaging hall', 'the plaza', 'the entrance, in and out']) {
      expect(finished.filter((n) => n === name).length, name).toBe(2 * 2 * 3)
    }
    expect(frames).toBeGreaterThan(5000)
    expect(collisionStats.backstopFallbacks).toBe(0)
  })
})

describe('never inside anything: hugging the long walls', () => {
  // every floor-standing wall of the building, as the solids see it (axis aligned boxes), and the fences
  const walls = buildWallBoxes()
    .filter((w) => w.y0 === 0)
    .map((w) => ({ x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1 }))
    .filter((w) => Math.max(w.x1 - w.x0, w.z1 - w.z0) >= 3)

  it('has plenty of long walls to hug', () => {
    expect(walls.length).toBeGreaterThan(40)
  })

  it('at 0.35 and 0.6 m, 3 and 10 degrees into the wall, both ways, on both sides, at 20 and 60 fps: never inside, the same gap when pressed on, no fallback', () => {
    collisionStats.backstopFallbacks = 0
    let walks = 0
    let pressed = 0
    for (const w of walls) {
      const alongX = w.x1 - w.x0 >= w.z1 - w.z0
      const len = alongX ? w.x1 - w.x0 : w.z1 - w.z0
      for (const side of [-1, 1]) {
        for (const offset of [0.35, 0.6]) {
          for (const incidence of [3, 10]) {
            for (const dir of [-1, 1]) {
              // along the wall, and a little INTO it (towards the face)
              const a = incidence * DEG
              const ax = alongX ? dir : 0
              const az = alongX ? 0 : dir
              // the unit normal pointing from the wall to the body
              const nx = alongX ? 0 : side
              const nz = alongX ? side : 0
              const dx = ax * Math.cos(a) - nx * Math.sin(a)
              const dz = az * Math.cos(a) - nz * Math.sin(a)
              // start a metre in from one end, at `offset` off the face
              const face = alongX ? (side > 0 ? w.z1 : w.z0) : side > 0 ? w.x1 : w.x0
              const startAlong = (alongX ? (dir > 0 ? w.x0 : w.x1) : dir > 0 ? w.z0 : w.z1) + dir * 1
              const sx = alongX ? startAlong : face + side * (offset + R)
              const sz = alongX ? face + side * (offset + R) : startAlong
              if (len < 2.5 || !inRegion(sx, sz) || staticClearance(sx, sz, 2).d < R + 0.05) continue // (the outer face of the shell is outdoors: nobody starts there)
              for (const dt of [1 / 20, 1 / 60]) {
                for (const hurry of [false, true]) {
                  const m = classicMover(sx, sz)
                  const facing = Math.atan2(dx, dz)
                  const frames = Math.round(Math.min(len - 2, 3) / ((hurry ? 4.2 : 2) * Math.cos(a)) / dt) + Math.round(0.5 / dt)
                  for (let i = 0; i < frames; i++) {
                    m.step(dt, 1, 0, hurry, facing)
                    expectClear(m.x, m.z, `wall ${JSON.stringify(w)} side ${side} offset ${offset} inc ${incidence} dir ${dir} dt ${dt} frame ${i}`)
                    if (!inRegion(m.x, m.z)) throw new Error(`outside the region at (${m.x}, ${m.z})`)
                  }
                  walks++
                  if (m.move.progress < 0.999) pressed++
                }
              }
            }
          }
        }
      }
    }
    expect(walks).toBeGreaterThan(1000)
    expect(pressed).toBeGreaterThan(100) // the walks did run into the walls
    expect(collisionStats.backstopFallbacks).toBe(0)
    // eslint-disable-next-line no-console
    console.log(`wall hugging: ${walls.length} walls, ${walks} walks (${pressed} ended pressed on the wall), every frame checked; nearest approach to any solid so far ${(closest * 100).toFixed(4)} cm`)
  })
})

describe('never inside anything: the six corners where the people\'s floor used to clip a wall by up to 10 cm', () => {
  // the ends of the lobby-spine opening (z = +-5.7 at x = -44) and the corners of the spine-to-corridor openings near x = -40
  const spots = [
    { x: -44, z: -5.7 },
    { x: -44, z: 5.7 },
    { x: -40, z: -12.3 },
    { x: -40, z: 12.3 },
    { x: -40, z: -15.7 },
    { x: -40, z: 15.7 },
  ]

  it('walking at each from every side, at the walk and the run, 20 and 60 fps: the body stays a body radius from the wall', () => {
    let walks = 0
    let closest = Infinity
    for (const spot of spots) {
      for (let a = 0; a < 360; a += 30) {
        const sx = spot.x + Math.sin(a * DEG) * 1.2
        const sz = spot.z + Math.cos(a * DEG) * 1.2
        if (!inRegion(sx, sz) || staticClearance(sx, sz, 1).d < R + 0.02) continue
        for (const hurry of [false, true]) {
          for (const dt of [1 / 20, 1 / 60]) {
            const m = classicMover(sx, sz)
            for (let i = 0; i < Math.round(2 / dt); i++) {
              m.step(dt, 1, 0, hurry, bearing(m.x, m.z, spot.x, spot.z))
              const c = staticClearance(m.x, m.z)
              closest = Math.min(closest, c.d)
              expect(c.d, `spot (${spot.x}, ${spot.z}) from ${a} deg: inside ${c.id}`).toBeGreaterThanOrEqual(R - SOLID_TOL)
            }
            walks++
          }
        }
      }
    }
    expect(walks).toBeGreaterThan(40)
    // eslint-disable-next-line no-console
    console.log(`corner spots: ${walks} walks, the body never closer than ${(closest * 100).toFixed(3)} cm to a solid (the radius is 30 cm, the skin 1 cm)`)
  })
})

describe('never inside anything: random walks at the run speed', () => {
  it('from random starts all over the building and the plaza, turning at random, at 20, 30 and 60 fps: never inside a solid, the backstop never fires', () => {
    collisionStats.backstopFallbacks = 0
    const rnd = lcg(5)
    let starts = 0
    let held = 0
    while (starts < 200) {
      const x = PLAYER_PLAZA.x0 + rnd() * (BUILDING.x1 - PLAYER_PLAZA.x0)
      const z = BUILDING.z0 + rnd() * (BUILDING.z1 - BUILDING.z0)
      if (!walkableAt(x, z)) continue
      starts++
      const dt = [1 / 60, 1 / 30, 1 / 20][starts % 3]
      const m = classicMover(x, z)
      let facing = rnd() * 2 * Math.PI
      for (let i = 0; i < 500; i++) {
        if (rnd() < 0.04) facing = rnd() * 2 * Math.PI
        m.step(dt, 1, 0, true, facing)
        expectClear(m.x, m.z, `random start ${starts} frame ${i}`)
        if (m.move.progress < 0.999) held++
        expect(Math.hypot(m.state.vx, m.state.vz)).toBeLessThanOrEqual(4.2 + 1e-9) // never faster than the run
      }
    }
    expect(held).toBeGreaterThan(1000)
    expect(collisionStats.backstopFallbacks).toBe(0)
    // eslint-disable-next-line no-console
    console.log(`random walks: 200 starts x 500 frames (${held} frames held up by something); ${frameCount} frames checked in this file, nearest approach to any solid ${(closest * 100).toFixed(4)} cm (r = 30 cm, skin 1 cm)`)
  })

  it('the easy scheme too: steering with the turn keys into every wall it meets', () => {
    collisionStats.backstopFallbacks = 0
    const rnd = lcg(9)
    let starts = 0
    while (starts < 60) {
      const x = PLAYER_PLAZA.x0 + rnd() * (BUILDING.x1 - PLAYER_PLAZA.x0)
      const z = BUILDING.z0 + rnd() * (BUILDING.z1 - BUILDING.z0)
      if (!walkableAt(x, z)) continue
      starts++
      const dt = [1 / 60, 1 / 30, 1 / 20][starts % 3]
      const easy = new BodyMover('easy')
      easy.place(x, z, rnd() * 2 * Math.PI)
      let turn = 0
      let hurry = false
      for (let i = 0; i < 400; i++) {
        if (rnd() < 0.05) turn = [-1, 0, 1][Math.floor(rnd() * 3)]
        if (rnd() < 0.02) hurry = !hurry
        easy.step(dt, 1, turn, hurry, 0)
        expectClear(easy.x, easy.z, `easy start ${starts} frame ${i}`)
      }
    }
    expect(collisionStats.backstopFallbacks).toBe(0)
  })
})
