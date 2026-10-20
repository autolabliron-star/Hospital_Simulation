/**
 * Sliding: a body pressed against a wall keeps its speed ALONG it, with no jitter, at any frame rate; round furniture is followed within
 * millimetres; an inside corner takes the speed to 0 without ever reversing it. All on the real building's solids (the plaza's west fence
 * is a long flat wall in the open; the forecourt planter is a round obstacle), driven through a pure BodyMover frame by frame.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { PLAYER_PLAZA } from '@/sim/places'
import { BodyMover } from './body'
import { bearing, classicMover, staticClearance } from './bodyTestKit'
import { collisionStats } from './collision'

const R = CONFIG.player.bodyRadius
const SKIN = CONFIG.player.bodySkin
const DTS = [1 / 20, 1 / 30, 1 / 60, 1 / 144]
const DEG = Math.PI / 180

/** Frames of a body at cruise speed along `facing` from (x, z), until `seconds` are up. */
function slide(x: number, z: number, speed: number, facing: number, dt: number, seconds: number, hurry = false): { m: BodyMover; frames: { x: number; z: number; vx: number; vz: number; speed: number; v: number; progress: number }[] } {
  const m = classicMover(x, z)
  m.cruise(speed, facing)
  const frames: { x: number; z: number; vx: number; vz: number; speed: number; v: number; progress: number }[] = []
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    m.step(dt, 1, 0, hurry, facing)
    frames.push({ x: m.x, z: m.z, vx: m.state.vx, vz: m.state.vz, speed: Math.hypot(m.state.vx, m.state.vz), v: m.spring.v, progress: m.move.progress })
  }
  return { m, frames }
}

describe('sliding along a flat wall (the plaza\'s west fence, x = -74, 16 m long, nothing near it)', () => {
  const face = PLAYER_PLAZA.x0
  const stop = face + R + SKIN

  it('keeps at least 98 % of v cos(alpha) along the wall from the frame after contact, with no change of speed above 0.01 m/s from frame to frame, at every frame rate', () => {
    collisionStats.backstopFallbacks = 0
    let worstRatio = Infinity
    let worstJump = 0
    let worstGap = 0
    for (const [speed, hurry] of [[CONFIG.player.walkSpeed, false], [CONFIG.player.hurrySpeed, true]] as const) {
      for (const alpha of [10, 20, 30, 45, 60, 75]) {
        for (const dt of DTS) {
          // heading into the wall (west, -x) and along it (+z), alpha off the tangent
          const facing = Math.atan2(-Math.sin(alpha * DEG), Math.cos(alpha * DEG))
          const toWall = (face + 1.2 - stop) / (speed * Math.sin(alpha * DEG)) // seconds to the contact
          const { frames } = slide(face + 1.2, -7.5, speed, facing, dt, toWall + 1.2, hurry)
          const contact = frames.findIndex((f) => f.progress < 0.999)
          expect(contact, `alpha ${alpha} dt ${dt}: it touched the wall`).toBeGreaterThan(0)
          for (let k = contact + 1; k < frames.length; k++) {
            const f = frames[k]
            const want = f.v * Math.cos(alpha * DEG)
            const ratio = f.vz / want
            worstRatio = Math.min(worstRatio, ratio)
            expect(f.vz, `alpha ${alpha} dt ${dt} speed ${speed} frame ${k}`).toBeGreaterThanOrEqual(0.98 * want)
            worstGap = Math.max(worstGap, Math.abs(f.x - stop))
            if (k > contact + 1) worstJump = Math.max(worstJump, Math.abs(f.speed - frames[k - 1].speed))
          }
        }
      }
    }
    expect(worstJump).toBeLessThanOrEqual(0.01)
    expect(worstGap).toBeLessThan(1e-6) // pressed on at exactly r + skin, never creeping in and never backing off
    expect(collisionStats.backstopFallbacks).toBe(0)
    // eslint-disable-next-line no-console
    console.log(`flat wall slide: worst tangential ratio ${worstRatio.toFixed(5)}, worst frame-to-frame speed change ${worstJump.toExponential(2)} m/s, worst gap error ${worstGap.toExponential(2)} m`)
  })

  it('the speed comes from the spring, never from the wall: pressing at 85 degrees (head on) drops the speed to what is achieved, at 75 it does not', () => {
    const walk = CONFIG.player.walkSpeed
    const shallow = slide(face + 1.2, -7.5, walk, Math.atan2(-Math.sin(75 * DEG), Math.cos(75 * DEG)), 1 / 60, 2)
    expect(shallow.frames[shallow.frames.length - 1].v).toBeCloseTo(walk, 6)
    const headOn = slide(face + 1.2, 0, walk, Math.atan2(-Math.sin(88 * DEG), Math.cos(88 * DEG)), 1 / 60, 2)
    const last = headOn.frames[headOn.frames.length - 1]
    expect(last.v).toBeLessThan(0.2) // what it achieves: 1.4 cos(88) = 0.05
  })

  it('never ends inside the wall however long you push, and always at the same distance', () => {
    for (const dt of DTS) {
      const { frames } = slide(face + 1, 0, CONFIG.player.hurrySpeed, -Math.PI / 2, dt, 3, true) // straight at the wall
      for (const f of frames.slice(Math.round(1 / dt))) expect(f.x).toBeGreaterThanOrEqual(stop - 1e-9)
      expect(frames[frames.length - 1].x).toBeCloseTo(stop, 9)
    }
  })
})

describe('round furniture (the forecourt planter, radius 0.5 at (-70.2, 4.2))', () => {
  const cx = -70.2
  const cz = 4.2
  const ring = 0.5 + R + SKIN

  /** Where a body on the ring goes in `dt` at speed `v`, pressed east (u = (1, 0)) round the planter: it follows the ring at v |u . tangent| (RK4). */
  function ringStep(px: number, pz: number, v: number, dt: number): { x: number; z: number } {
    const k = (x: number, z: number): [number, number] => {
      const dx = x - cx
      const dz = z - cz
      const len = Math.hypot(dx, dz)
      const tx = -dz / len
      const tz = dx / len
      return [v * tx * tx, v * tx * tz] // v (u . t) t
    }
    // start exactly on the ring
    let d = Math.hypot(px - cx, pz - cz)
    let x = cx + ((px - cx) / d) * ring
    let z = cz + ((pz - cz) / d) * ring
    const n = 64
    const h = dt / n
    for (let i = 0; i < n; i++) {
      const [a1, b1] = k(x, z)
      const [a2, b2] = k(x + (h / 2) * a1, z + (h / 2) * b1)
      const [a3, b3] = k(x + (h / 2) * a2, z + (h / 2) * b2)
      const [a4, b4] = k(x + h * a3, z + h * b3)
      x += (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4)
      z += (h / 6) * (b1 + 2 * b2 + 2 * b3 + b4)
      d = Math.hypot(x - cx, z - cz)
      x = cx + ((x - cx) / d) * ring
      z = cz + ((z - cz) / d) * ring
    }
    return { x, z }
  }

  it('is followed within 5 mm of r + skin, and the speed along it is the exact speed of a body riding the ring (v |u . tangent|): no jitter above 0.03 m/s', () => {
    let worstGap = 0
    let worstJitter = 0
    let totalSteady = 0
    for (const [speed, hurry] of [[CONFIG.player.walkSpeed, false], [CONFIG.player.hurrySpeed, true]] as const) {
      for (const dt of DTS) {
        for (const offset of [0.15, 0.3, 0.5]) {
          // walking east past the planter, aimed `offset` off its centre line, so it slides round the near side
          const { frames } = slide(-73.4, cz - offset, speed, Math.PI / 2, dt, 2.2, hurry)
          // the episode of the slide: from the first frame that was held up to the last one
          const first = frames.findIndex((f) => f.progress < 0.999)
          let end = -1
          frames.forEach((f, i) => {
            if (f.progress < 0.999) end = i
          })
          expect(first, `dt ${dt} offset ${offset}: it met the planter`).toBeGreaterThanOrEqual(0)
          for (let i = first; i <= end; i++) {
            const f = frames[i]
            const gap = Math.hypot(f.x - cx, f.z - cz) - ring
            expect(gap, `dt ${dt} offset ${offset}`).toBeGreaterThanOrEqual(-1e-9)
            worstGap = Math.max(worstGap, Math.abs(gap))
            // (the frame of the impact and the frame it slides off have a free part: the exact model is for the frames in between)
            if (i > first && i < end && f.progress < 0.999) {
              const prev = frames[i - 1]
              const to = ringStep(prev.x, prev.z, f.v, dt)
              const expected = Math.hypot(to.x - prev.x, to.z - prev.z) / dt
              worstJitter = Math.max(worstJitter, Math.abs(f.speed - expected))
              totalSteady++
            }
          }
        }
      }
    }
    expect(totalSteady).toBeGreaterThan(100) // the model was checked on plenty of sliding frames
    expect(worstGap).toBeLessThanOrEqual(0.005)
    expect(worstJitter).toBeLessThanOrEqual(0.03)
    // eslint-disable-next-line no-console
    console.log(`round furniture: worst gap ${(worstGap * 1000).toFixed(3)} mm, worst deviation from the exact ring speed ${worstJitter.toFixed(4)} m/s`)
  })

  it('never inside it, from any side, at any frame rate', () => {
    for (const dt of DTS) {
      for (let a = 0; a < 360; a += 30) {
        const sx = cx + Math.sin(a * DEG) * 3
        const sz = cz + Math.cos(a * DEG) * 3
        if (staticClearance(sx, sz).d < R + 0.1) continue
        const { frames } = slide(sx, sz, CONFIG.player.hurrySpeed, bearing(sx, sz, cx, cz + 0.2), dt, 2, true)
        for (const f of frames) expect(Math.hypot(f.x - cx, f.z - cz)).toBeGreaterThanOrEqual(ring - 1e-9)
      }
    }
  })
})

describe('an inside corner (the plaza\'s north-west corner)', () => {
  it('takes the speed to 0 without ever reversing it, ends exactly in the corner and never inside either wall', () => {
    const corner = { x: PLAYER_PLAZA.x0 + R + SKIN, z: PLAYER_PLAZA.z0 + R + SKIN }
    for (const dt of DTS) {
      for (const [speed, hurry] of [[CONFIG.player.walkSpeed, false], [CONFIG.player.hurrySpeed, true]] as const) {
        const m = classicMover(PLAYER_PLAZA.x0 + 2, PLAYER_PLAZA.z0 + 2)
        const facing = Math.atan2(-1, -1) // north-west
        m.cruise(speed, facing)
        let vs: number[] = []
        for (let i = 0; i < Math.round(3 / dt); i++) {
          m.step(dt, 1, 0, hurry, facing)
          vs.push(m.spring.v)
          expect(m.x).toBeGreaterThanOrEqual(corner.x - 1e-9)
          expect(m.z).toBeGreaterThanOrEqual(corner.z - 1e-9)
        }
        expect(Math.min(...vs), `dt ${dt} speed ${speed}`).toBeGreaterThanOrEqual(0) // never changes sign
        // once pinned, it only goes down
        const pinned = vs.findIndex((v, i) => i > 0 && m.state.vx === 0 && v < speed)
        expect(pinned).toBeGreaterThanOrEqual(0)
        for (let i = pinned + 1; i < vs.length; i++) expect(vs[i]).toBeLessThanOrEqual(vs[i - 1] + 1e-9)
        expect(vs[vs.length - 1]).toBeLessThan(0.01)
        expect(m.x).toBeCloseTo(corner.x, 6)
        expect(m.z).toBeCloseTo(corner.z, 6)
        vs = []
      }
    }
  })

  it('and out of it again: from the corner the body walks away along either wall with no pop', () => {
    const m = classicMover(PLAYER_PLAZA.x0 + R + SKIN, PLAYER_PLAZA.z0 + R + SKIN)
    let last = { x: m.x, z: m.z }
    for (let i = 0; i < 60; i++) {
      m.step(1 / 60, 1, 0, false, 0) // south, along the west wall
      expect(Math.hypot(m.x - last.x, m.z - last.z)).toBeLessThanOrEqual(2 / 60 + 1e-9)
      last = { x: m.x, z: m.z }
    }
    expect(m.z).toBeGreaterThan(PLAYER_PLAZA.z0 + 1)
  })
})
