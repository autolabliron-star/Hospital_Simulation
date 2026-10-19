/**
 * R2: the da Vinci patient cart is solid. Its footprint, written from the robot state the way SurgeryLayer.tsx writes it each frame, is a blocker of the real
 * registry, and the real BodyMover walks against it on level 2 (sim coordinates) in every place the cart stands: parked, turning on the spot, driving in,
 * docked; and while it drives it pushes a body standing in its way aside instead of passing through it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { clearBlockers, registerBlockers } from '@/scene/blockers'
import { blockerClearance, boxDistance, classicMover } from '@/scene/player/bodyTestKit'
import { walkableAt } from '@/scene/player/collision'
import { CONFIG } from '@/sim/config'
import { SURGERY } from '@/sim/places'
import { cartPose, type CartPose } from '@/sim/surgery/robot'
import { CART_HALF, createCartBlockers, writeCartBlocker } from './cartBlocker'

const R = CONFIG.player.bodyRadius
const EPS = 1e-4
const DT = 1 / 60

afterEach(() => clearBlockers())

/** The cart's poses along its drive: parked (k 0), turning toward the dock (0.12), driving (0.4, 0.5, 0.6), turning at the dock (0.85), docked (1). */
const POSES: [string, CartPose][] = [0, 0.12, 0.4, 0.5, 0.6, 0.85, 1].map((k) => [k === 0 ? 'parked' : k === 1 ? 'docked' : k < 0.25 || k > 0.75 ? `turning ${k}` : `driving ${k}`, cartPose(k, { x: 0, z: 0, heading: 0 })])

describe('the cart blocker', () => {
  it('is the cart base where the rig draws it: centred on the cart, long along its heading, the drawn base and its trim inside it', () => {
    const src = createCartBlockers()
    expect(src.count).toBe(0)
    for (const [name, pose] of POSES) {
      src.count = writeCartBlocker(pose, src.data)
      const d = src.data
      expect(src.count, name).toBe(1)
      expect(d[0], name).toBe(pose.x)
      expect(d[1], name).toBe(pose.z)
      expect(Math.hypot(d[2], d[3]), name).toBeCloseTo(1, 12)
      expect(Math.atan2(d[2], d[3]), name).toBeCloseTo(Math.atan2(Math.sin(pose.heading), Math.cos(pose.heading)), 12)
      expect(d[4]).toBeCloseTo(SURGERY.cart.size.l / 2, 12)
      expect(d[5]).toBeCloseTo(SURGERY.cart.size.w / 2, 12)
      // rig.ts writeCart: the base is 0.9 x 1.38 and the trim 0.93 x 1.41 (width x length), both centred on the cart
      expect(CART_HALF.u).toBeGreaterThanOrEqual(1.41 / 2)
      expect(CART_HALF.v).toBeGreaterThanOrEqual(0.93 / 2)
    }
    // the docked cart faces east (+x), toward the table: long along x
    src.count = writeCartBlocker({ x: SURGERY.cart.dock.at.x, z: SURGERY.cart.dock.at.z, heading: SURGERY.cart.dock.heading }, src.data)
    expect(src.data[2]).toBeCloseTo(1, 9)
    expect(boxDistance(SURGERY.cart.dock.at.x + 0.7, SURGERY.cart.dock.at.z, src.data[0], src.data[1], src.data[2], src.data[3], src.data[4], src.data[5])).toBe(0)
  })

  it('stops you at the cart wherever it stands: from every side, walking and running, never inside it (without it you walk through)', () => {
    const src = createCartBlockers()
    const lines: string[] = []
    let through = 0
    for (const [name, pose] of POSES) {
      src.count = writeCartBlocker(pose, src.data)
      let contacts = 0
      let walks = 0
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        const sx = pose.x + Math.sin(a) * 1.6
        const sz = pose.z + Math.cos(a) * 1.6
        // a start the body may stand at, clear of the cart
        if (!walkableAt(sx, sz) || blockerClearance(src, sx, sz) < R + 0.05) continue
        const facing = Math.atan2(pose.x - sx, pose.z - sz)
        for (const hurry of [false, true]) {
          // with the cart solid
          const off = registerBlockers(src)
          const m = classicMover(sx, sz)
          let least = Infinity
          for (let f = 0; f < 150; f++) {
            m.step(DT, 1, 0, hurry, facing)
            const c = blockerClearance(src, m.x, m.z)
            least = Math.min(least, c)
            expect(c, `${name}, from ${((a * 180) / Math.PI).toFixed(0)} deg, ${hurry ? 'running' : 'walking'}, frame ${f}`).toBeGreaterThanOrEqual(R - EPS)
          }
          off()
          walks++
          if (least < R + 0.03) contacts++
          // the same walk with no cart: the body ends up inside its footprint (or a wall or the table stops it first)
          const ghost = classicMover(sx, sz)
          let inside = false
          for (let f = 0; f < 150 && !inside; f++) {
            ghost.step(DT, 1, 0, hurry, facing)
            inside = blockerClearance(src, ghost.x, ghost.z) < R - 0.05
          }
          if (inside) through++
        }
      }
      lines.push(`${name}: ${contacts}/${walks} at the cart`)
      expect(walks, name).toBeGreaterThanOrEqual(8)
      // most approaches end against the cart itself (the rest meet the wall, the table or other furniture first)
      expect(contacts, name).toBeGreaterThanOrEqual(walks / 2)
    }
    // eslint-disable-next-line no-console
    console.log(`cart blocker: ${lines.join('; ')}; ${through} walks pass through it with no blocker`)
    expect(through).toBeGreaterThan(20)
  })

  it('pushes a body standing in its way aside as it drives in and back, never through it', () => {
    const src = createCartBlockers()
    const pose: CartPose = { x: 0, z: 0, heading: 0 }
    cartPose(0, pose)
    src.count = writeCartBlocker(pose, src.data)
    const off = registerBlockers(src)
    // standing on the drive line, halfway between the parking spot and the dock
    const mid = cartPose(0.5, { x: 0, z: 0, heading: 0 })
    const m = classicMover(mid.x, mid.z)
    expect(walkableAt(mid.x, mid.z)).toBe(true)
    // the drive at 0.25 m/s (the real one takes over a minute): there and back
    const frames = 1200
    let worst = Infinity
    let moved = 0
    for (let f = 0; f <= frames * 2; f++) {
      const k = f <= frames ? f / frames : 2 - f / frames
      cartPose(k, pose)
      src.count = writeCartBlocker(pose, src.data)
      const x0 = m.x
      const z0 = m.z
      m.step(DT, 0, 0, false, 0)
      moved += Math.hypot(m.x - x0, m.z - z0)
      // pushed out within the frame: never inside the cart by more than float rounding
      worst = Math.min(worst, blockerClearance(src, m.x, m.z))
    }
    off()
    expect(worst).toBeGreaterThanOrEqual(R - 0.01)
    expect(moved).toBeGreaterThan(0.3)
    expect(walkableAt(m.x, m.z)).toBe(true)
  })
})
