/**
 * The patient cart's skeleton in node (hand-made robot states, never the sim's internals): the four arms reach every port of both layouts within 1 cm with the
 * boom swung anywhere the sim turns it, the spar passes through the port, the joint angles stay within sane limits, the elbows stay under the boom, the poses
 * blend continuously from folded through deployed to solved, and the tip motion is seeded, small and the same for the arms and the endoscope painter.
 */
import { describe, expect, it } from 'vitest'
import { SURGERY } from '@/sim/places'
import { arm, dockedRobot, LAYOUTS, stowedRobot } from './testkit'
import { angleDelta, ARM_COUNT, BOOM_STOWED, CART, DEPLOY_AT, h01, LIMITS, motionGain, newRobotPose, poseRobot, smooth01, TIP, tipMotion, type ArmPose, type RobotPose, type TipMotion } from './robotPose'

const pose = newRobotPose()
const m = (): TipMotion => ({ insert: 0, pitch: 0, yaw: 0, jaw: 0, roll: 0 })
const dist3 = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const joints = (a: ArmPose) => ({ s: [a.sx, a.sy, a.sz], e: [a.ex, a.ey, a.ez], w: [a.wx, a.wy, a.wz], q: [a.qx, a.qy, a.qz], c: [a.cx, a.cy, a.cz], t: [a.tx, a.ty, a.tz] })

const YAWS = [-0.35, -0.2, 0, 0.2, 0.35]
const TIMES = [100, 117.3, 133.9, 160.2, 250.5]

describe('the arms reach the ports', () => {
  it('reaches every port of both layouts within 1 cm, whatever the boom\'s yaw (the sim turns it within +-0.35 rad) and whenever the tip moves', () => {
    for (const layout of LAYOUTS) {
      for (const yaw of YAWS) {
        for (const t of TIMES) {
          poseRobot(dockedRobot(layout, { boomYaw: yaw }), t, pose)
          for (const a of pose.arms) expect(a.error, `${layout} yaw ${yaw} t ${t} arm ${a.index}`).toBeLessThan(0.01)
        }
      }
    }
  })

  it('has the spar pass through the port (the remote centre of motion), to a millimetre, with the tip motion at work', () => {
    for (const layout of LAYOUTS) {
      for (const yaw of [-0.35, 0, 0.35]) {
        for (const t of TIMES) {
          const r = dockedRobot(layout, { boomYaw: yaw })
          poseRobot(r, t, pose)
          for (const a of pose.arms) {
            const port = r.arms[a.index].port!
            // the distance of the port from the spar's axis line (through the wrist, along d)
            const wx = port.x - a.wx
            const wy = port.y - a.wy
            const wz = port.z - a.wz
            const cx = wy * a.dz - wz * a.dy
            const cy = wz * a.dx - wx * a.dz
            const cz = wx * a.dy - wy * a.dx
            expect(Math.hypot(cx, cy, cz), `${layout} ${yaw} ${t} arm ${a.index}`).toBeLessThan(1e-3)
            // and the port is at the spar's wrist-to-port distance along it
            expect(wx * a.dx + wy * a.dy + wz * a.dz).toBeCloseTo(CART.sparWP, 3)
          }
        }
      }
    }
  })

  it('keeps every joint within its limits: the shoulder, the elbow\'s bend, the spar\'s tilt', () => {
    for (const layout of LAYOUTS) {
      for (const yaw of YAWS) {
        for (const t of TIMES) {
          poseRobot(dockedRobot(layout, { boomYaw: yaw }), t, pose)
          for (const a of pose.arms) {
            const label = `${layout} ${yaw} ${t} arm ${a.index}`
            expect(a.a1, label).toBeGreaterThan(LIMITS.shoulder[0])
            expect(a.a1, label).toBeLessThan(LIMITS.shoulder[1])
            expect(Math.abs(angleDelta(a.a1, a.a2)), label).toBeLessThan(LIMITS.bend)
            expect(a.beta, label).toBeGreaterThanOrEqual(LIMITS.tilt[0] - 0.2)
            expect(a.beta, label).toBeLessThanOrEqual(LIMITS.tilt[1])
          }
        }
      }
    }
  })

  it('never lets a link stretch or shrink: the upper arm and the forearm keep their lengths, in every pose from folded to solved', () => {
    const check = (r: ReturnType<typeof dockedRobot>, t: number, label: string): void => {
      poseRobot(r, t, pose)
      for (const a of pose.arms) {
        expect(Math.hypot(a.ex - a.sx, a.ey - a.sy, a.ez - a.sz), `${label} upper arm ${a.index}`).toBeCloseTo(CART.L1, 9)
        expect(Math.hypot(a.wx - a.ex, a.wy - a.ey, a.wz - a.ez), `${label} forearm ${a.index}`).toBeCloseTo(CART.L2, 9)
        expect(Math.hypot(a.qx - a.wx, a.qy - a.wy, a.qz - a.wz), `${label} spar ${a.index}`).toBeCloseTo(CART.sparLen, 9)
      }
    }
    for (const h of [BOOM_STOWED, 1.9, DEPLOY_AT, 2.47]) check(dockedRobot('transverse', { boomHeight: h, arms: stowedRobot().arms }), 100, `height ${h}`)
    for (const e of [0, 0.2, 0.5, 0.8, 1]) {
      const r = dockedRobot('oblique')
      r.arms.forEach((a) => (a.engage = e))
      check(r, 120, `engage ${e}`)
    }
  })

  it('keeps the elbows under the boom and the whole arm above the floor and above the table\'s pad, docked', () => {
    for (const layout of LAYOUTS) {
      for (const yaw of YAWS) {
        poseRobot(dockedRobot(layout, { boomYaw: yaw }), 140, pose)
        for (const a of pose.arms) {
          expect(a.ey, 'the elbow clears the boom underside').toBeLessThan(pose.boomTop - CART.boomThick)
          expect(a.wy).toBeGreaterThan(SURGERY.table.height + 0.3)
          expect(a.ty, 'the tip is inside the patient: below the port, above the table').toBeLessThan(a.py)
          expect(a.ty).toBeGreaterThan(SURGERY.table.height)
        }
      }
    }
  })
})

describe('the poses blend', () => {
  const sweep = (make: (k: number) => ReturnType<typeof dockedRobot>, steps = 200): number => {
    // the largest jump of any arm joint between two consecutive steps of a parameter that runs 0 -> 1
    let prev: ReturnType<typeof joints>[] | null = null
    let worst = 0
    for (let i = 0; i <= steps; i++) {
      poseRobot(make(i / steps), 100, pose)
      const now = pose.arms.map(joints)
      if (prev) {
        for (let a = 0; a < ARM_COUNT; a++) for (const k of ['e', 'w', 't'] as const) worst = Math.max(worst, dist3(prev[a][k], now[a][k]))
      }
      prev = now
    }
    return worst
  }

  it('is continuous as the boom rises (folded to deployed): no joint jumps more than 2.5 cm in a hundredth of the climb', () => {
    const worst = sweep((k) => dockedRobot('transverse', { boomHeight: BOOM_STOWED + k * (2.47 - BOOM_STOWED), arms: stowedRobot().arms.map((a) => ({ ...a, drape: 1 })) }))
    expect(worst).toBeLessThan(0.05)
  })

  it('is continuous as the arms engage on their ports (deployed to solved)', () => {
    const worst = sweep((k) => {
      const r = dockedRobot('oblique', { phase: 'targeting' })
      r.arms.forEach((a) => (a.engage = k))
      return r
    })
    expect(worst).toBeLessThan(0.05)
  })

  it('is exactly the folded pose at the stowed height and exactly the deployed one from DEPLOY_AT up (the same arms, a different boom)', () => {
    poseRobot(stowedRobot(), 100, pose)
    expect(pose.deploy).toBe(0)
    poseRobot(stowedRobot('stowed'), 100, pose)
    const folded = pose.arms.map((a) => [a.a1, a.a2, a.beta])
    const r = stowedRobot()
    r.boomHeight = DEPLOY_AT
    poseRobot(r, 100, pose)
    expect(pose.deploy).toBe(1)
    const reached = pose.arms.map((a) => [a.a1, a.a2, a.beta])
    r.boomHeight = 2.47
    poseRobot(r, 100, pose)
    expect(pose.arms.map((a) => [a.a1, a.a2, a.beta])).toEqual(reached)
    expect(reached).not.toEqual(folded)
    expect(smooth01(-1)).toBe(0)
    expect(smooth01(2)).toBe(1)
  })

  it('folds the arms over the cart when stowed: the elbow, wrist and the spar\'s end are above the base and no further than the cart\'s length from the column, under the boom', () => {
    const r = stowedRobot('stowed', 1)
    poseRobot(r, 100, pose)
    for (const a of pose.arms) {
      for (const p of [[a.ex, a.ey, a.ez], [a.wx, a.wy, a.wz], [a.qx, a.qy, a.qz]]) {
        expect(p[1], 'above the cart\'s base').toBeGreaterThan(CART.baseTop)
        expect(p[1], 'under the boom').toBeLessThan(pose.boomTop)
        expect(Math.hypot(p[0] - pose.colX, p[2] - pose.colZ), 'over the cart').toBeLessThan(1.3)
      }
    }
  })

  it('carries the arm through an instrument exchange: in the console phase an engage dip to 55% leaves the arm on its port and withdraws the instrument along the spar (the carriage rides up, the tip leaves the patient)', () => {
    const full = dockedRobot('transverse')
    poseRobot(full, 100, pose)
    const still = joints(pose.arms[2])
    const c1 = pose.arms[2].cy
    const tip1 = pose.arms[2].ty
    const part = dockedRobot('transverse')
    part.arms[2].engage = 0.55
    poseRobot(part, 100, pose)
    const a = pose.arms[2]
    // (the small tip moves pause during the change: the wrist is within a couple of centimetres of where it was)
    expect(dist3(joints(a).w, still.w)).toBeLessThan(0.03)
    expect(dist3(joints(a).e, still.e)).toBeLessThan(0.03)
    expect(a.ty).toBeGreaterThan(tip1 + 0.1)
    expect(a.ty, 'the tip is out of the patient, above the port').toBeGreaterThan(a.py)
    expect(a.cy).toBeGreaterThan(c1)
    expect(a.engage).toBe(0.55)
    expect(a.error).toBeLessThan(0.01)
    // while it swings on or off (targeting, undocking) the same dip is the arm itself moving
    const moving = dockedRobot('transverse', { phase: 'targeting' })
    moving.arms[2].engage = 0.55
    poseRobot(moving, 100, pose)
    expect(dist3(joints(pose.arms[2]).w, still.w)).toBeGreaterThan(0.1)
  })
})

describe('the cart and the boom', () => {
  it('puts the cart base where the state says, the column a little ahead of it, and the boom along the cart\'s heading plus its yaw', () => {
    const r = dockedRobot('transverse', { boomYaw: 0.3 })
    poseRobot(r, 100, pose)
    expect([pose.cartX, pose.cartZ, pose.heading]).toEqual([r.cart.x, r.cart.z, r.cart.heading])
    expect(Math.hypot(pose.colX - r.cart.x, pose.colZ - r.cart.z)).toBeCloseTo(CART.colZ, 9)
    expect(pose.boomAngle).toBeCloseTo(r.cart.heading + 0.3, 9)
    expect(Math.hypot(pose.headX - pose.colX, pose.headZ - pose.colZ)).toBeCloseTo(CART.boomMax, 9)
    expect(pose.boomTop).toBe(r.boomHeight)
  })

  it('reaches out from boomMin to boomMax with boomExtend, and rises to the height the state says', () => {
    const r = dockedRobot('transverse', { boomExtend: 0 })
    poseRobot(r, 100, pose)
    expect(pose.boomLen).toBeCloseTo(CART.boomMin, 9)
    r.boomExtend = 0.5
    poseRobot(r, 100, pose)
    expect(pose.boomLen).toBeCloseTo((CART.boomMin + CART.boomMax) / 2, 9)
    // the four mounts are a row 0.2 m apart under the head
    const a = pose.arms
    expect(Math.hypot(a[1].mx - a[0].mx, a[1].mz - a[0].mz)).toBeCloseTo(CART.spacing, 9)
    expect(a[0].my).toBeCloseTo(pose.boomTop - CART.boomThick, 9)
  })

  it('puts the laser on the endoscope\'s port while it is docking, and on the middle of the two port lines before', () => {
    const r = dockedRobot('oblique', { laser: true })
    poseRobot(r, 100, pose)
    expect(pose.laser).toBe(true)
    expect([pose.laserX, pose.laserY, pose.laserZ]).toEqual([SURGERY.ports.oblique[1].x, SURGERY.ports.oblique[1].y, SURGERY.ports.oblique[1].z])
    r.arms[1].port = null
    poseRobot(r, 100, pose)
    expect(pose.laserX).toBeGreaterThan(SURGERY.ports.oblique[0].x - 0.2)
    expect(pose.laserX).toBeLessThan(SURGERY.ports.oblique[3].x + 0.2)
    expect(pose.laserY).toBe(SURGERY.ports.transverse[1].y)
  })

  it('reads the sterile drape and the engage of each arm from the state', () => {
    const r = stowedRobot('draping')
    r.arms[2].drape = 0.4
    r.arms[3].engage = 0
    poseRobot(r, 100, pose)
    expect(pose.arms[2].drape).toBe(0.4)
    expect(pose.arms[0].fitted).toBe(false)
    const d = dockedRobot()
    poseRobot(d, 100, pose)
    expect(pose.arms[1].fitted).toBe(true)
  })
})

describe('tip motion', () => {
  it('is deterministic: the same arm, time and seed give the same move, and a different seed or arm another', () => {
    const a = m()
    const b = m()
    tipMotion(2, 31.7, 99, a)
    tipMotion(2, 31.7, 99, b)
    expect(a).toEqual(b)
    tipMotion(2, 31.7, 100, b)
    expect(b).not.toEqual(a)
    tipMotion(3, 31.7, 99, b)
    expect(b).not.toEqual(a)
    tipMotion(2, 32.7, 99, b)
    expect(b).not.toEqual(a)
  })

  it('stays small: the insertion within 2.5 cm, the pitch and yaw within 0.07 rad, the jaw 0..1, the endoscope calmer than the instruments and with no jaw', () => {
    const o = m()
    let max = { insert: 0, pitch: 0, yaw: 0 }
    let jawMax = 0
    let jawMin = 1
    let endoMax = 0
    let toolMax = 0
    for (let t = 0; t < 600; t += 0.37) {
      for (const arm of [0, 1, 2, 3]) {
        tipMotion(arm, t, 12345, o)
        expect(Math.abs(o.insert)).toBeLessThanOrEqual(TIP.insert + 1e-9)
        expect(Math.abs(o.pitch)).toBeLessThanOrEqual(TIP.pitch + 1e-9)
        expect(Math.abs(o.yaw)).toBeLessThanOrEqual(TIP.yaw + 1e-9)
        expect(o.jaw).toBeGreaterThanOrEqual(0)
        expect(o.jaw).toBeLessThanOrEqual(1)
        if (arm === 1) {
          expect(o.jaw).toBe(0)
          endoMax = Math.max(endoMax, Math.abs(o.pitch))
        } else {
          toolMax = Math.max(toolMax, Math.abs(o.pitch))
          jawMax = Math.max(jawMax, o.jaw)
          jawMin = Math.min(jawMin, o.jaw)
        }
        max = { insert: Math.max(max.insert, Math.abs(o.insert)), pitch: Math.max(max.pitch, Math.abs(o.pitch)), yaw: Math.max(max.yaw, Math.abs(o.yaw)) }
      }
    }
    expect(endoMax).toBeLessThan(toolMax * 0.5)
    // it moves (not a constant) and the jaws really open and close
    expect(max.insert).toBeGreaterThan(0.01)
    expect(max.pitch).toBeGreaterThan(0.03)
    expect(jawMax).toBeGreaterThan(0.9)
    expect(jawMin).toBeLessThan(0.1)
  })

  it('is smooth: no move jumps between two frames 1/60 s apart', () => {
    const a = m()
    const b = m()
    for (let t = 0; t < 120; t += 1 / 60) {
      tipMotion(0, t, 7, a)
      tipMotion(0, t + 1 / 60, 7, b)
      expect(Math.abs(b.insert - a.insert)).toBeLessThan(0.002)
      expect(Math.abs(b.pitch - a.pitch)).toBeLessThan(0.004)
      expect(Math.abs(b.jaw - a.jaw)).toBeLessThan(0.1)
    }
  })

  it('moves the 3D arms: a docked arm\'s carriage and tip change with time, and not at all before the console phase has settled', () => {
    const r = dockedRobot('transverse', { phaseSince: 0 })
    poseRobot(r, 100, pose)
    const a1 = joints(pose.arms[2])
    poseRobot(r, 104.7, pose)
    const a2 = joints(pose.arms[2])
    expect(dist3(a1.t, a2.t)).toBeGreaterThan(0.001)
    // 'targeting': no tip motion, so the pose is the same at any time
    const g = dockedRobot('transverse', { phase: 'targeting' })
    poseRobot(g, 100, pose)
    const b1 = joints(pose.arms[2])
    poseRobot(g, 137.2, pose)
    expect(joints(pose.arms[2])).toEqual(b1)
    expect(motionGain(g, 100)).toBe(0)
    expect(motionGain(dockedRobot('transverse', { phaseSince: 100 }), 100)).toBe(0)
    expect(motionGain(dockedRobot('transverse', { phaseSince: 0 }), 100)).toBe(1)
    expect(motionGain(dockedRobot('transverse', { phase: 'undocking', phaseSince: 50 }), 100)).toBe(0)
  })

  it('hashes to 0..1, and spreads (h01)', () => {
    let lo = 1
    let hi = 0
    for (let i = 0; i < 500; i++) {
      const v = h01(i, 3, 4)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    expect(lo).toBeLessThan(0.05)
    expect(hi).toBeGreaterThan(0.95)
  })
})

describe('an arm with no port stays in its base pose', () => {
  it('ignores `engage` while its port is null (the sim writes a port as soon as an arm starts to swing)', () => {
    const base = dockedRobot('transverse')
    base.arms[3] = arm(3, { engage: 0.6, port: null })
    poseRobot(base, 100, pose)
    const free = joints(pose.arms[3])
    const same = dockedRobot('transverse')
    same.arms[3] = arm(3, { engage: 0, port: null })
    poseRobot(same, 100, pose)
    expect(joints(pose.arms[3])).toEqual(free)
  })
})

// keep the types referenced (the pose objects are reused across tests)
void (null as unknown as RobotPose)
