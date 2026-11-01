/**
 * R4: the robot arm's inverse kinematics and the suite's poses (node, hand-made states): the arm reaches every planned path within 1 mm and 0.5 deg
 * with its guide 5 cm out on the path, the angles run forward to the same pose, and at every sampled phase the arm stays out of the patient and the
 * table; the needles ride with the table and slide in along their paths.
 *
 * R5 (geometry): the same for the three targets, the paths the sim plans for the kidney (on her right side), the lung and the liver (face down) seen through the patient's
 * roll (src/sim/procedure/ctSlice.ts, the one map the sim's `needleEntry` and the drapes' window use), the arm keeping out of the ROLLED body, and its travel taking the
 * time the sim gives it (an 8 s repeat aim arrives, it does not snap).
 */
import { describe, expect, it } from 'vitest'
import { CRYO_SUITE } from '@/sim/places'
import { planCase } from '@/sim/cryoSuite/plan'
import { cryoSuite } from '@/sim/cryoSuite/testkit'
import { Rng } from '@/sim/rng'
import { ctBodyOffsetOf, ctSliceInto, CT_OBLIQUE_DEG } from '@/sim/procedure/ctSlice'
import { cryoTargetInto, newCryoTargetCtx } from '@/sim/procedure/cryoPlaces'
import type { CryoNeedleState, CryoRobotPhase, CryoSuiteState, CryoTarget } from '@/sim/types'
import { OBLIQUE_DEG } from '@/scene/actors/crowd/tablePatient'
import {
  AIM_TRAVEL_SHARE,
  aimLengthOf,
  APPROACH_BACK,
  ARM,
  armTargetInto,
  bodyDistance,
  boxDistance,
  cryoTableX,
  forwardArm,
  NEEDLE,
  needlePoseInto,
  newArmPose,
  newGuide,
  newNeedlePose,
  pathGuideInto,
  patientPointInto,
  retractLengthOf,
  ROBOT_TIMING,
  solveArm,
  tableBoxInto,
  type ArmPose,
  type Box3,
  type Guide,
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

const TARGETS: readonly CryoTarget[] = ['kidney', 'lung', 'liver']

/** The needles the sim plans for `seed` of `target`, as the suite's state holds them. */
function plannedNeedles(target: CryoTarget, seed: number): CryoNeedleState[] {
  return planCase(new Rng(seed), `s-${seed}`, 0, 0, false, target).needles.map((p, i) => ({
    index: i,
    entry: { ...p.entry },
    tip: { ...p.tip },
    dz: p.dz,
    inserted: 0,
    errorMm: p.errorMm,
    active: false,
    tempC: 37,
  }))
}

/** A state in the aim step for `target` with the plan's needles (the fixture's other fields: the case in the room). */
function aimState(target: CryoTarget, seed: number, robot: CryoRobotPhase, needle: number, since: number, tablePos = 0): CryoSuiteState {
  const s = cryoState({ step: 'aim', needles: 3, robot, robotNeedle: needle, robotSince: since, tablePos })
  s.target = target
  s.needles = plannedNeedles(target, seed)
  for (const n of s.needles) n.inserted = 0
  s.robot.needle = needle
  return s
}

/** Every plan shape the sim may make: 2..6 needles over the tumour sizes of the config, a few fans (the fixtures' kidney). */
const PLANS = [2, 3, 4, 5, 6].flatMap((n) => [18, 26, 35].map((mm) => fixtureNeedles(n, mm)))
/** The sim's own plans: 12 seeds of each target. */
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1)

describe('the arm reaches every planned path', () => {
  it('within 1 mm and 0.5 deg: the guide centre on the path, 5 cm outside the skin entry, the axis along the path; nothing out of reach (the fixtures\' kidney fans)', () => {
    const g = newGuide()
    const arm = newArmPose()
    const entry: P3 = { x: 0, y: 0, z: 0 }
    const tip: P3 = { x: 0, y: 0, z: 0 }
    let worst = 0
    let worstDeg = 0
    for (const plan of PLANS) {
      for (const n of plan) {
        pathGuideInto('kidney', n, 0, 0, g)
        solveArm(g, arm)
        expect(arm.reachError, `needle ${n.index}`).toBe(0)
        patientPointInto('kidney', 0, n.entry.x, n.entry.y, n.dz, entry)
        patientPointInto('kidney', 0, n.tip.x, n.tip.y, n.dz, tip)
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
    console.log(`cryo arm IK (fixtures): worst guide offset ${(worst * 1000).toFixed(4)} mm, worst axis error ${worstDeg.toFixed(5)} deg over ${PLANS.flat().length} paths`)
  })

  for (const target of TARGETS) {
    it(`${target}: the arm reaches every path the sim plans (12 seeds), at the skin and at the approach point, the guide on the path and the axis along it; the sim's own entry is the arm's`, () => {
      const g = newGuide()
      const arm = newArmPose()
      const entry: P3 = { x: 0, y: 0, z: 0 }
      const tip: P3 = { x: 0, y: 0, z: 0 }
      const ctx = newCryoTargetCtx()
      const sim: P3 = { x: 0, y: 0, z: 0 }
      let n = 0
      let worst = 0
      let worstDeg = 0
      for (const seed of SEEDS) {
        const needles = plannedNeedles(target, seed)
        for (const nd of needles) {
          for (const back of [0, APPROACH_BACK]) {
            pathGuideInto(target, nd, 0, back, g)
            solveArm(g, arm)
            expect(arm.reachError, `${target} seed ${seed} needle ${nd.index} back ${back}`).toBeLessThan(1e-9)
          }
          pathGuideInto(target, nd, 0, 0, g)
          solveArm(g, arm)
          patientPointInto(target, 0, nd.entry.x, nd.entry.y, nd.dz, entry)
          patientPointInto(target, 0, nd.tip.x, nd.tip.y, nd.dz, tip)
          const len = dist(entry, tip)
          const u = { x: (tip.x - entry.x) / len, y: (tip.y - entry.y) / len, z: (tip.z - entry.z) / len }
          const off = lineDistance(arm.g, entry, u)
          worst = Math.max(worst, off)
          expect(off).toBeLessThan(0.001)
          expect(Math.abs(dist(arm.g, entry) - ARM.standoff)).toBeLessThan(0.001)
          const a = deg(arm.u, u)
          worstDeg = Math.max(worstDeg, a)
          expect(a).toBeLessThan(0.5)
          expect(dot({ x: arm.g.x - entry.x, y: arm.g.y - entry.y, z: arm.g.z - entry.z }, u)).toBeLessThan(0)
          // the SIM's needleEntry (what the people's hands and the drapes' window go to) is the point the arm's path starts from
          ctx.target = target
          ctx.tablePos = 0
          ctx.needles = needles
          ctx.needle = nd.index
          cryoTargetInto('needleEntry', ctx, sim)
          expect(dist(sim, entry), `${target} seed ${seed} needle ${nd.index}`).toBeLessThan(1e-9)
          n++
        }
      }
      expect(n).toBeGreaterThan(15)
      // eslint-disable-next-line no-console
      console.log(`cryo arm IK (${target}): worst guide offset ${(worst * 1000).toFixed(4)} mm, worst axis error ${worstDeg.toFixed(5)} deg over ${n} paths`)
    })

    it(`${target}: the path seen from the room starts on the body's skin (the nominal body) and runs into it: the guide is outside, the tip inside`, () => {
      const g = newGuide()
      const tip: P3 = { x: 0, y: 0, z: 0 }
      for (const seed of SEEDS) {
        for (const nd of plannedNeedles(target, seed)) {
          pathGuideInto(target, nd, 0, 0, g)
          // the guide is ARM.standoff outside the entry: outside the nominal skin (offset > 0), less than the standoff from it
          const off = ctBodyOffsetOf(target, g.g.y, g.g.z)
          expect(off, `${target} seed ${seed} needle ${nd.index} guide`).toBeGreaterThan(0)
          expect(off).toBeLessThan(ARM.standoff + 0.016)
          patientPointInto(target, 0, nd.tip.x, nd.tip.y, nd.dz, tip)
          expect(ctBodyOffsetOf(target, tip.y, tip.z), `${target} seed ${seed} needle ${nd.index} tip`).toBeLessThan(-0.03)
        }
      }
    })
  }

  it('is a real 5-axis chain: the solved angles run forward to the same guide pose, and the links keep their lengths', () => {
    const g = newGuide()
    const arm = newArmPose()
    const fk = newArmPose()
    for (const target of TARGETS) {
      for (const n of target === 'kidney' ? fixtureNeedles(6, 30) : plannedNeedles(target, 3)) {
        solveArm(pathGuideInto(target, n, 0, 0, g), arm)
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

  for (const target of TARGETS) {
    it(`${target}: at every sampled phase of every needle of the sim's plans (the rolled body: ${target === 'kidney' ? 'on her right side' : 'face down'}), with the table out (where the robot works)`, () => {
      const tgt = newGuide()
      const arm = newArmPose()
      const tb: Box3 = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }
      tableBoxInto(0, tb)
      let checked = 0
      let tightest = Infinity
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const count = plannedNeedles(target, seed).length
        for (let k = 0; k < count; k++) {
          for (const [phase, times] of phases) {
            for (const since of times) {
              const s = aimState(target, seed, phase, k, 1000)
              armTargetInto(s, 1000 + since, tgt)
              solveArm(tgt, arm)
              expect(arm.reachError, `${target} seed ${seed} ${phase} +${since}s needle ${k}`).toBeLessThan(1e-9)
              for (const q of armSamples(arm)) {
                const clear = bodyDistance(target, 0, q.p.x, q.p.y, q.p.z) - q.r
                tightest = Math.min(tightest, clear)
                expect(clear, `${q.what} in the patient at ${phase} +${since}s, needle ${k} of ${count}, seed ${seed}`).toBeGreaterThan(0)
                expect(boxDistance(tb, q.p.x, q.p.y, q.p.z), `${q.what} in the table at ${phase} +${since}s, needle ${k} of ${count}, seed ${seed}`).toBeGreaterThan(q.r)
                checked++
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(8_000)
      // eslint-disable-next-line no-console
      console.log(`cryo arm keep-out (${target}): ${checked} samples, the tightest clearance ${(tightest * 100).toFixed(1)} cm`)
    })
  }

  it('stowed and on standby (the CT scans), the arm is clear of the table at every table position, the patient riding into the bore', () => {
    const target = newGuide()
    const arm = newArmPose()
    const tb: Box3 = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }
    for (const patient of TARGETS) {
      for (const phase of ['stowed', 'deploying'] as const) {
        for (const tablePos of [0, 0.25, 0.5, 0.75, 1]) {
          const s = cryoState({ step: 'checkCt', robot: phase, robotSince: 0, tablePos })
          s.target = patient
          armTargetInto(s, 100, target)
          solveArm(target, arm)
          tableBoxInto(tablePos, tb)
          for (const q of armSamples(arm)) {
            expect(bodyDistance(patient, tablePos, q.p.x, q.p.y, q.p.z)).toBeGreaterThan(q.r)
            expect(boxDistance(tb, q.p.x, q.p.y, q.p.z)).toBeGreaterThan(q.r)
          }
        }
      }
    }
  })

  it('the keep-out is the ROLLED body: the kidney\'s patient lies up on her side (the flank near the robot is 0.3 m over the table top), the prone back 0.25 m; a box over the level body would miss both', () => {
    // the nominal body's top over the table top and across, from the cylinder's own distance function
    const top = (target: CryoTarget): number => {
      let best = -Infinity
      for (let y = 0.8; y < 1.3; y += 0.005) if (bodyDistance(target, 0, CRYO_SUITE.ct.table.out.x, y, CRYO_SUITE.ct.table.out.z) < 0) best = y
      return best - CRYO_SUITE.ct.table.height
    }
    expect(top('kidney')).toBeGreaterThan(0.27)
    expect(top('kidney')).toBeLessThan(0.36)
    expect(top('lung')).toBeGreaterThan(0.22)
    expect(top('lung')).toBeLessThan(0.3)
    // the north side (the robot's): a point 0.2 m north of the table's centre line, 0.2 m over the pad, is outside the rolled kidney patient (her flank has fallen away), inside the lung's
    const north = (target: CryoTarget): number => bodyDistance(target, 0, CRYO_SUITE.ct.table.out.x, CRYO_SUITE.ct.table.height + 0.2, CRYO_SUITE.ct.table.out.z - 0.2)
    expect(north('kidney')).toBeGreaterThan(0)
    expect(north('lung')).toBeGreaterThan(0)
    // the head and the feet: the cylinder ends where the body does
    expect(bodyDistance('lung', 0, CRYO_SUITE.ct.table.out.x - 1.2, CRYO_SUITE.ct.table.height + 0.1, CRYO_SUITE.ct.table.out.z)).toBeGreaterThan(0.2)
    expect(bodyDistance('lung', 0, CRYO_SUITE.ct.table.out.x + 1.1, CRYO_SUITE.ct.table.height + 0.1, CRYO_SUITE.ct.table.out.z)).toBeGreaterThan(0.2)
    expect(bodyDistance('lung', 0, CRYO_SUITE.ct.table.out.x, CRYO_SUITE.ct.table.height + 0.1, CRYO_SUITE.ct.table.out.z)).toBeLessThan(-0.05)
    // the body rides in with the table
    expect(bodyDistance('lung', 1, cryoTableX(1), CRYO_SUITE.ct.table.height + 0.1, CRYO_SUITE.ct.table.out.z)).toBeLessThan(-0.05)
  })

  it('aiming comes in along the needle\'s own axis for the last part, and ends exactly on the aligned pose (every target)', () => {
    for (const target of TARGETS) {
      const s = aimState(target, 3, 'aiming', 1, 0)
      const a = newGuide()
      const on = newGuide()
      pathGuideInto(target, s.needles[1], 0, 0, on)
      const total = ROBOT_TIMING.aimTravel + ROBOT_TIMING.aimSettle
      for (const t of [ROBOT_TIMING.aimTravel + 0.5, ROBOT_TIMING.aimTravel + 3]) {
        armTargetInto(s, t, a)
        expect(deg(a.u, on.u)).toBeLessThan(1e-6)
        expect(lineDistance(a.g, on.g, on.u)).toBeLessThan(1e-9)
      }
      armTargetInto(s, total + 1, a)
      expect(dist(a.g, on.g)).toBeLessThan(1e-9)
      s.robot.phase = 'aligned'
      armTargetInto(s, 500, a)
      expect(dist(a.g, on.g)).toBeLessThan(1e-9)
    }
  })
})

describe('the arm takes the time the sim gives it', () => {
  /** A scripted case's state: the robot aims during the step that begins with its phase and the procedure says when it ends. */
  const scripted = (target: CryoTarget, phase: CryoRobotPhase, since: number, stepSince: number, stepEnds: number): CryoSuiteState => {
    const s = aimState(target, 3, phase, 0, since)
    s.procedure.procedureId = target === 'kidney' ? 'cryo-kidney' : target === 'lung' ? 'cryo-lung' : 'cryo-liver'
    s.procedure.stepSince = stepSince
    s.procedure.stepEnds = stepEnds
    return s
  }

  it('without a script the aim is the living day\'s 18 s (12 to travel, 6 to settle in) and the retract 6 s', () => {
    const s = aimState('kidney', 3, 'aiming', 0, 100)
    expect(aimLengthOf(s)).toBe(ROBOT_TIMING.aimTravel + ROBOT_TIMING.aimSettle)
    expect(retractLengthOf(s)).toBe(ROBOT_TIMING.retract)
    expect(AIM_TRAVEL_SHARE).toBeCloseTo(12 / 18, 12)
  })

  for (const target of TARGETS) {
    for (const seconds of [28, 26, 8]) {
      it(`${target}: an aim of ${seconds} s (${seconds === 8 ? 'a repeat' : 'the first needle'}) arrives on the aligned pose as the sim turns aligned, and does not jump on the way`, () => {
        const since = 400
        const s = scripted(target, 'aiming', since, since, since + seconds)
        expect(aimLengthOf(s)).toBe(seconds)
        const on = newGuide()
        pathGuideInto(target, s.needles[0], 0, 0, on)
        const standby = newGuide()
        armTargetInto(scripted(target, 'deploying', since, since, since + 99), since + 99, standby)
        const g = newGuide()
        const prev = newGuide()
        // at the end of the window it is on the aligned pose, at the start on the standby
        armTargetInto(s, since + seconds, g)
        expect(dist(g.g, on.g)).toBeLessThan(1e-9)
        armTargetInto(s, since, g)
        expect(dist(g.g, standby.g)).toBeLessThan(1e-9)
        // midway it is still on its way (the old 12 s travel: at 8 s a repeat was two thirds of the way, then snapped)
        armTargetInto(s, since + seconds * 0.4, g)
        expect(dist(g.g, on.g)).toBeGreaterThan(0.05)
        // 60 Hz through the whole window: no frame moves the guide further than a hand's speed allows (a snap is metres per second)
        let worstSpeed = 0
        armTargetInto(s, since, prev)
        for (let t = since + 1 / 60; t <= since + seconds + 1; t += 1 / 60) {
          armTargetInto(s, t, g)
          worstSpeed = Math.max(worstSpeed, dist(g.g, prev.g) * 60)
          prev.g.x = g.g.x
          prev.g.y = g.g.y
          prev.g.z = g.g.z
        }
        expect(worstSpeed, `${target} ${seconds} s: the guide's fastest frame`).toBeLessThan(seconds === 8 ? 0.8 : 0.4)
        // (the control: the old timing took 18 s whatever the sim gave: at the end of an 8 s aim the arm was 5 cm from the path's start and still travelling)
        const unscripted = aimState(target, 3, 'aiming', 0, since)
        armTargetInto(unscripted, since + 8, g)
        if (seconds === 8) expect(dist(g.g, on.g), 'an unscripted 18 s aim at 8 s').toBeGreaterThan(0.1)
      })
    }
  }

  it('a step that does not start with the robot\'s phase is not the robot\'s: the living day\'s timing; a script that ends before it begins, or in hours, is ignored too', () => {
    expect(aimLengthOf(scripted('kidney', 'aiming', 400, 380, 408))).toBe(18)
    expect(aimLengthOf(scripted('kidney', 'aiming', 400, 400, 399))).toBe(18)
    expect(aimLengthOf(scripted('kidney', 'aiming', 400, 400, 400 + 36_000))).toBe(18)
    // a window of a fraction of a second is stretched to a moment, not divided by nothing
    expect(aimLengthOf(scripted('kidney', 'aiming', 400, 400, 400.2))).toBeGreaterThan(1)
  })

  for (const target of TARGETS) {
    it(`${target}: the retract takes the time the sim gives it (3 s: out along the axis, then up to the standby; never longer than the 6 s), and the arm is on the standby at its end`, () => {
      const since = 900
      const s = scripted(target, 'retracting', since, since - 40, since + 3)
      expect(retractLengthOf(s)).toBe(3)
      const g = newGuide()
      const standby = newGuide()
      armTargetInto(scripted(target, 'deploying', since, since, since + 99), since + 99, standby)
      armTargetInto(s, since + 3, g)
      expect(dist(g.g, standby.g)).toBeLessThan(1e-9)
      const on = newGuide()
      pathGuideInto(target, s.needles[0], 0, 0, on)
      armTargetInto(s, since, g)
      expect(dist(g.g, on.g)).toBeLessThan(1e-9)
      expect(retractLengthOf(scripted(target, 'retracting', since, since - 40, since + 40))).toBe(ROBOT_TIMING.retract)
    })
  }
})

describe('the arm and the real sim agree (a watch case of the kidney, stepped)', () => {
  it('the aim the sim publishes is as long as `aimLengthOf` says, and the guide the arm is told to reach as the phase turns aligned is the aligned pose (needle 1 and the repeats)', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    const c = h.cryo
    h.step(0.1)
    expect(c.startWatch('kidney')).toBe('started')
    const s = c.state
    const guide = newGuide()
    const on = newGuide()
    let aims = 0
    let phase: CryoRobotPhase = s.robot.phase
    let since = s.robot.since
    let needle = s.robot.needle
    let lastLen = 0
    const seen: string[] = []
    const lengths: number[] = []
    for (let i = 0; i < 40_000 && aims < 3; i++) {
      const before = armTargetInto(s, h.t, guide)
      void before
      const len = s.robot.phase === 'aiming' ? aimLengthOf(s) : 0
      if (s.robot.phase === 'aiming') lastLen = len
      h.step(0.1)
      if (s.robot.phase !== phase || s.robot.needle !== needle) {
        if (phase === 'aiming' && s.robot.phase === 'aligned') {
          // the phase turned aligned: how long the aim lasted is what `aimLengthOf` said (the sim steps at 0.1 s)
          const actual = h.t - since
          lengths.push(actual)
          expect(Math.abs(actual - lastLen), `aim ${aims + 1}: ${actual.toFixed(2)} s against ${lastLen.toFixed(2)} s`).toBeLessThan(0.35)
          // and the guide just before the flip was (all but) on the aligned pose
          armTargetInto(s, h.t - 0.2, guide)
          const st = { ...s, robot: { ...s.robot, phase: 'aligned' as const } }
          armTargetInto(st, h.t, on)
          expect(dist(guide.g, on.g), `aim ${aims + 1}: the guide 0.2 s before aligned`).toBeLessThan(0.02)
          seen.push(`${s.robot.needle}`)
          aims++
        }
        phase = s.robot.phase
        since = s.robot.since
        needle = s.robot.needle
      }
    }
    expect(aims).toBe(3)
    // the first needle's aim is the script's 26 to 28 s, a repeat's 8 s
    expect(lengths[0]).toBeGreaterThan(24)
    expect(lengths[0]).toBeLessThan(31)
    expect(lengths[1]).toBeGreaterThan(6)
    expect(lengths[1]).toBeLessThan(10)
    expect(lengths[2]).toBeGreaterThan(6)
    expect(lengths[2]).toBeLessThan(10)
  }, 600_000)
})

describe('the table and the needles', () => {
  it('the table centre runs from out to in; the target is in the rotor plane with the table in', () => {
    expect(cryoTableX(0)).toBeCloseTo(CRYO_SUITE.ct.table.out.x, 9)
    expect(cryoTableX(1)).toBeCloseTo(CRYO_SUITE.ct.table.in.x, 9)
    const p: P3 = { x: 0, y: 0, z: 0 }
    const k = CRYO_SUITE.targets.kidney.tumour
    patientPointInto('kidney', 0, 0, 0, 0, p)
    expect([p.x, p.y, p.z]).toEqual([k.x, k.y, k.z])
    patientPointInto('kidney', 1, 0, 0, 0, p)
    expect(p.x).toBeCloseTo(CRYO_SUITE.ct.machine.x + 0.2, 6) // the rotor plane
    // the kidney's patient lies on her right side: her left is UP and north, posterior is down (and north), toward the head is west
    patientPointInto('kidney', 0, 10, 0, 0, p)
    expect(p.y).toBeGreaterThan(k.y)
    expect(p.z).toBeLessThan(k.z)
    patientPointInto('kidney', 0, 0, 10, 0, p)
    expect(p.y).toBeLessThan(k.y)
    expect(p.z).toBeLessThan(k.z)
    patientPointInto('kidney', 0, 0, 0, 10, p)
    expect(p.x).toBeLessThan(k.x)
    // face down: posterior is up, her left is south
    const l = CRYO_SUITE.targets.lung.tumour
    patientPointInto('lung', 0, 0, 10, 0, p)
    expect(p.y).toBeGreaterThan(l.y)
    patientPointInto('lung', 0, 10, 0, 0, p)
    expect(p.z).toBeGreaterThan(l.z)
  })

  it('the roll is the crowd\'s: the kidney\'s 55 degrees is `OBLIQUE_DEG` of the table patient, by value', () => {
    expect(CT_OBLIQUE_DEG).toBe(OBLIQUE_DEG)
    // (the same point of the room through the arm's helper and through the sim's)
    const p: P3 = { x: 0, y: 0, z: 0 }
    const q: P3 = { x: 0, y: 0, z: 0 }
    for (const t of TARGETS) {
      patientPointInto(t, 0.3, 40, -20, 5, p)
      ctSliceInto(t, 0.3, 40, -20, 5, q)
      expect(dist(p, q)).toBe(0)
    }
  })

  it('a needle shows once it is in (or waits in the aligned guide), slides in along its path, and rides with the table', () => {
    for (const target of TARGETS) {
      const s = aimState(target, 4, 'aligned', 0, 0)
      const n = newNeedlePose()
      expect(needlePoseInto(s, 0, n).shown).toBe(true) // ready in the guide
      expect(needlePoseInto(s, 1, n).shown).toBe(false)
      const entry: P3 = { x: 0, y: 0, z: 0 }
      const tip: P3 = { x: 0, y: 0, z: 0 }
      const nd = s.needles[0]
      patientPointInto(target, 0, nd.entry.x, nd.entry.y, nd.dz, entry)
      patientPointInto(target, 0, nd.tip.x, nd.tip.y, nd.dz, tip)
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
    }
  })

  it('the guide of an aligned needle sits on the sim\'s own path: the entry\'s distance to the guide centre is the standoff, in every target', () => {
    const g: Guide = newGuide()
    const sim: P3 = { x: 0, y: 0, z: 0 }
    const ctx = newCryoTargetCtx()
    for (const target of TARGETS) {
      const s = aimState(target, 5, 'aligned', 0, 0)
      armTargetInto(s, 10, g)
      ctx.target = target
      ctx.needles = s.needles
      ctx.needle = 0
      cryoTargetInto('needleEntry', ctx, sim)
      expect(dist(g.g, sim)).toBeCloseTo(ARM.standoff, 9)
    }
  })
})
