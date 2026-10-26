/**
 * R4: the robot arm's inverse kinematics and the suite's poses (node, hand-made states): the arm reaches every planned path within 1 mm and 0.5 deg
 * with its guide 5 cm out on the path, the angles run forward to the same pose, and at every sampled phase the arm stays out of the patient and the
 * table; the needles ride with the table and slide in along their paths.
 */
import { describe, expect, it } from 'vitest'
import { CRYO_SUITE } from '@/sim/places'
import type { CryoRobotPhase } from '@/sim/types'
import {
  ARM,
  armTargetInto,
  boxDistance,
  cryoTableX,
  forwardArm,
  NEEDLE,
  needlePoseInto,
  newArmPose,
  newGuide,
  newNeedlePose,
  pathGuideInto,
  patientBoxInto,
  patientPointInto,
  ROBOT_TIMING,
  solveArm,
  tableBoxInto,
  type ArmPose,
  type Box3,
  type P3,
} from './pose'
import { LINK } from './rig'
import { cryoState, fixtureNeedles } from './testkit'

const dist = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z
const deg = (a: P3, b: P3) => (Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180) / Math.PI

/** Distance from point p to the line through a along unit u. */
function lineDistance(p: P3, a: P3, u: P3): number {
  const t = (p.x - a.x) * u.x + (p.y - a.y) * u.y + (p.z - a.z) * u.z
  return Math.hypot(p.x - a.x - u.x * t, p.y - a.y - u.y * t, p.z - a.z - u.z * t)
}

/** Every plan shape the sim may make: 2..6 needles over the tumour sizes of the config, a few fans. */
const PLANS = [2, 3, 4, 5, 6].flatMap((n) => [18, 26, 35].map((mm) => fixtureNeedles(n, mm)))

describe('the arm reaches every planned path', () => {
  it('within 1 mm and 0.5 deg: the guide centre on the path, 5 cm outside the skin entry, the axis along the path; nothing out of reach', () => {
    const g = newGuide()
    const arm = newArmPose()
    const entry: P3 = { x: 0, y: 0, z: 0 }
    const tip: P3 = { x: 0, y: 0, z: 0 }
    let worst = 0
    let worstDeg = 0
    for (const plan of PLANS) {
      for (const n of plan) {
        pathGuideInto(n, 0, 0, g)
        solveArm(g, arm)
        expect(arm.reachError, `needle ${n.index}`).toBe(0)
        patientPointInto(0, n.entry.x, n.entry.y, n.dz, entry)
        patientPointInto(0, n.tip.x, n.tip.y, n.dz, tip)
        const len = dist(entry, tip)
        const u = { x: (tip.x - entry.x) / len, y: (tip.y - entry.y) / len, z: (tip.z - entry.z) / len }
        const off = lineDistance(arm.g, entry, u)
        worst = Math.max(worst, off)
        expect(off).toBeLessThan(0.001)
        expect(Math.abs(dist(arm.g, entry) - ARM.standoff)).toBeLessThan(0.001)
        // outside the skin: the guide is on the entry's far side from the tip
        expect(dot({ x: arm.g.x - entry.x, y: arm.g.y - entry.y, z: arm.g.z - entry.z }, u)).toBeLessThan(0)
        const a = deg(arm.u, u)
        worstDeg = Math.max(worstDeg, a)
        expect(a).toBeLessThan(0.5)
      }
    }
    // eslint-disable-next-line no-console
    console.log(`cryo arm IK: worst guide offset ${(worst * 1000).toFixed(4)} mm, worst axis error ${worstDeg.toFixed(5)} deg over ${PLANS.flat().length} paths`)
  })

  it('is a real 5-axis chain: the solved angles run forward to the same guide pose, and the links keep their lengths', () => {
    const g = newGuide()
    const arm = newArmPose()
    const fk = newArmPose()
    for (const n of fixtureNeedles(6, 30)) {
      solveArm(pathGuideInto(n, 0, 0, g), arm)
      forwardArm(arm.j1, arm.j2, arm.j3, arm.j4, arm.j5, fk)
      expect(dist(fk.g, arm.g)).toBeLessThan(1e-9)
      expect(deg(fk.u, arm.u)).toBeLessThan(1e-6)
      expect(dist(arm.s, arm.e)).toBeCloseTo(ARM.upper, 9)
      expect(dist(arm.e, arm.w)).toBeCloseTo(ARM.fore, 9)
      expect(dist(arm.w, arm.g)).toBeCloseTo(ARM.hand, 9)
      expect(dist(arm.m, arm.s)).toBeCloseTo(ARM.column, 9)
      // the hand never lies along the needle
      expect(Math.abs(dot(arm.h, arm.u))).toBeLessThan(1e-9)
      // the mount is the contract's
      expect([arm.m.x, arm.m.y, arm.m.z]).toEqual([CRYO_SUITE.robot.mount.x, CRYO_SUITE.robot.mount.y, CRYO_SUITE.robot.mount.z])
    }
  })

  it('reports a guide out of reach instead of tearing the arm', () => {
    const arm = newArmPose()
    const far = newGuide()
    far.g.x = CRYO_SUITE.robot.mount.x + 3
    far.g.y = 1
    far.g.z = CRYO_SUITE.robot.mount.z
    solveArm(far, arm)
    expect(arm.reachError).toBeGreaterThan(1)
    expect(dist(arm.s, arm.e)).toBeCloseTo(ARM.upper, 9)
    expect(dist(arm.e, arm.w)).toBeCloseTo(ARM.fore, 9)
  })
})

/** The arm's links as sampled points with their radius. */
function armSamples(a: ArmPose): { p: P3; r: number; what: string }[] {
  const out: { p: P3; r: number; what: string }[] = []
  const seg = (p: P3, q: P3, r: number, what: string, upTo = 1) => {
    for (let i = 0; i <= 20; i++) {
      const t = (i / 20) * upTo
      out.push({ p: { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t }, r, what })
    }
  }
  seg(a.s, a.e, LINK.upper / 2, 'upper arm')
  seg(a.e, a.w, LINK.fore / 2, 'forearm')
  // the hand up to its end (it stops 3.5 cm short of the guide, which sits on the path outside the skin by design)
  seg(a.w, a.g, LINK.hand / 2, 'hand', (ARM.hand - 0.035) / ARM.hand)
  return out
}

describe('the arm never enters the patient or the table', () => {
  const phases: [CryoRobotPhase, number[]][] = [
    ['stowed', [0]],
    ['deploying', [0, 2, 4, 6, 8, 12]],
    ['aiming', [0, 3, 6, 9, 12, 14, 16, 18, 20]],
    ['aligned', [0, 30]],
    ['retracting', [0, 1, 2, 3, 4, 5, 6, 8]],
  ]

  it('at every sampled phase of every needle of every plan, with the table out (where the robot works)', () => {
    const target = newGuide()
    const arm = newArmPose()
    const pb: Box3 = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }
    const tb: Box3 = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }
    patientBoxInto(0, pb)
    tableBoxInto(0, tb)
    let checked = 0
    for (const n of [2, 4, 6]) {
      for (const mm of [18, 35]) {
        for (let k = 0; k < n; k++) {
          for (const [phase, times] of phases) {
            for (const since of times) {
              const s = cryoState({ step: 'aim', needles: n, tumourMm: mm, robot: phase, robotNeedle: k, robotSince: 1000 })
              armTargetInto(s, 1000 + since, target)
              solveArm(target, arm)
              expect(arm.reachError, `${phase} +${since}s needle ${k}`).toBeLessThan(1e-9)
              for (const q of armSamples(arm)) {
                expect(boxDistance(pb, q.p.x, q.p.y, q.p.z), `${q.what} in the patient at ${phase} +${since}s, needle ${k} of ${n}`).toBeGreaterThan(q.r)
                expect(boxDistance(tb, q.p.x, q.p.y, q.p.z), `${q.what} in the table at ${phase} +${since}s, needle ${k} of ${n}`).toBeGreaterThan(q.r)
                checked++
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000)
  })

  it('stowed and on standby (the CT scans), the arm is clear of the table at every table position, the patient riding into the bore', () => {
    const target = newGuide()
    const arm = newArmPose()
    const pb: Box3 = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }
    const tb: Box3 = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }
    for (const phase of ['stowed', 'deploying'] as const) {
      for (const tablePos of [0, 0.25, 0.5, 0.75, 1]) {
        const s = cryoState({ step: 'checkCt', robot: phase, robotSince: 0, tablePos })
        armTargetInto(s, 100, target)
        solveArm(target, arm)
        patientBoxInto(tablePos, pb)
        tableBoxInto(tablePos, tb)
        for (const q of armSamples(arm)) {
          expect(boxDistance(pb, q.p.x, q.p.y, q.p.z)).toBeGreaterThan(q.r)
          expect(boxDistance(tb, q.p.x, q.p.y, q.p.z)).toBeGreaterThan(q.r)
        }
      }
    }
  })

  it('aiming comes in along the needle\'s own axis for the last part, and ends exactly on the aligned pose', () => {
    const s = cryoState({ step: 'aim', robot: 'aiming', robotNeedle: 1, robotSince: 0 })
    const a = newGuide()
    const on = newGuide()
    pathGuideInto(s.needles[1], 0, 0, on)
    for (const t of [ROBOT_TIMING.aimTravel + 0.5, ROBOT_TIMING.aimTravel + 3]) {
      armTargetInto(s, t, a)
      expect(deg(a.u, on.u)).toBeLessThan(1e-6)
      expect(lineDistance(a.g, on.g, on.u)).toBeLessThan(1e-9)
    }
    armTargetInto(s, ROBOT_TIMING.aimTravel + ROBOT_TIMING.aimSettle + 1, a)
    expect(dist(a.g, on.g)).toBeLessThan(1e-9)
    s.robot.phase = 'aligned'
    armTargetInto(s, 500, a)
    expect(dist(a.g, on.g)).toBeLessThan(1e-9)
  })
})

describe('the table and the needles', () => {
  it('the table centre runs from out to in; the target is in the rotor plane with the table in', () => {
    expect(cryoTableX(0)).toBeCloseTo(CRYO_SUITE.ct.table.out.x, 9)
    expect(cryoTableX(1)).toBeCloseTo(CRYO_SUITE.ct.table.in.x, 9)
    const p: P3 = { x: 0, y: 0, z: 0 }
    patientPointInto(0, 0, 0, 0, p)
    expect([p.x, p.y, p.z]).toEqual([CRYO_SUITE.target.x, CRYO_SUITE.target.y, CRYO_SUITE.target.z])
    patientPointInto(1, 0, 0, 0, p)
    expect(p.x).toBeCloseTo(CRYO_SUITE.ct.machine.x + 0.2, 6) // the rotor plane
    // the patient's left is north, posterior is down, toward the head is west
    patientPointInto(0, 10, 10, 10, p)
    expect(p.z).toBeLessThan(CRYO_SUITE.target.z)
    expect(p.y).toBeLessThan(CRYO_SUITE.target.y)
    expect(p.x).toBeLessThan(CRYO_SUITE.target.x)
  })

  it('a needle shows once it is in (or waits in the aligned guide), slides in along its path, and rides with the table', () => {
    const s = cryoState({ step: 'aim', robot: 'aligned', robotNeedle: 0, inserted: [0, 0, 0] })
    const n = newNeedlePose()
    expect(needlePoseInto(s, 0, n).shown).toBe(true) // ready in the guide
    expect(needlePoseInto(s, 1, n).shown).toBe(false)
    const entry: P3 = { x: 0, y: 0, z: 0 }
    const tip: P3 = { x: 0, y: 0, z: 0 }
    const nd = s.needles[0]
    patientPointInto(0, nd.entry.x, nd.entry.y, nd.dz, entry)
    patientPointInto(0, nd.tip.x, nd.tip.y, nd.dz, tip)
    needlePoseInto(s, 0, n)
    expect(dist(n.tip, entry)).toBeLessThan(1e-9)
    nd.inserted = 1
    needlePoseInto(s, 0, n)
    expect(dist(n.tip, tip)).toBeLessThan(1e-9)
    expect(dist(n.tip, n.hub)).toBeCloseTo(NEEDLE.length, 9)
    s.tablePos = 1
    s.robot.phase = 'retracting'
    needlePoseInto(s, 0, n)
    expect(n.tip.x - tip.x).toBeCloseTo(cryoTableX(1) - cryoTableX(0), 9)
  })
})
