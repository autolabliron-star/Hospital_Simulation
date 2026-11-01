/**
 * R5 wave 2 (agent G): the patient on the OR table (tablePatient.ts, rig.ts, model.ts). For the procedural body and EVERY realistic avatar's own skeleton, at 0.94, 1 and
 * 1.06 of its size:
 *   - lithotomy: the ankles reach the boots (LITHOTOMY_LEG.ankle), or as near as the leg can; the knees bend the right way (outward and up, never hyper-extended);
 *   - tucked arms: the wrists are at BODY_LANDMARKS.wristTucked, the hands above the pad; the pelvis lies at PELVIS_ON_TABLE;
 *   - a tipped table (tilt -30..+20, roll +-12) carries the head, the pelvis and the ankles exactly where the table's own transform (tablePose.ts) puts them;
 *   - transitions are smooth (the boots' own rate), a warm start, a Jump, a long gap and a first appearance snap, the same pose and time give the same skeleton;
 *   - everybody else (no pose, a trolley, a bed, a stretcher) renders exactly as before: pinned to the numbers of the old solve (tablePatient.golden.ts).
 * And the plumbing: the model hands the table pose (with the level's drawn offsets) to the rig, the pick capsule follows the table, the probe can force a pose.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { levelView } from '@/scene/levels/levelView'
import { OMEGA_BOOT } from '@/scene/surgery/table'
import { LEVEL_Y, levelDx } from '@/sim/levels'
import { SURGERY } from '@/sim/places'
import { BODY_LANDMARKS, LITHOTOMY_LEG, PELVIS_ON_TABLE } from '@/sim/procedure/body'
import { newTablePose, setTablePose, tablePointInto } from '@/sim/surgery/tablePose'
import type { Entity, PatientPoseView } from '@/sim/types'
import { NOMINAL_BODY, P, PART_COUNT, ROW_FLOATS, TEX, type BodyDims } from './constants'
import { CrowdModel, type FrameInput } from './model'
import { lookFor } from './outfit'
import { createRig, makeInput, solveRig, type PersonRig, type RigInput } from './rig'
import { LITHO_POLE, TABLE_OMEGA, TABLE_REST, TUCK_EXTEND } from './tablePatient'
import { LYING_GOLDEN } from './tablePatient.golden'
import { readIndex } from './avatars.testkit'

type V3 = [number, number, number]

const people = readIndex().avatars
const BODIES: { id: string; body: Readonly<BodyDims> }[] = [{ id: 'procedural', body: NOMINAL_BODY }, ...people.map((a) => ({ id: a.id, body: a.body }))]
const SCALES = [0.94, 1, 1.06]

// the table as the crowd draws it: level 2 (sim x - 150, up 4.2 m); the table's centre is the lying person's root
const OFF_X = levelDx(2)
const OFF_Y = LEVEL_Y[2]
const X0 = SURGERY.table.at.x + OFF_X
const Z0 = SURGERY.table.at.z
const TOP = SURGERY.table.height

interface Patient {
  rig: PersonRig
  inp: RigInput
  out: Float32Array
  body: Readonly<BodyDims>
  scale: number
  t: number
}

/** A person lying on the OR table (no pose yet), settled flat. */
function patient(body: Readonly<BodyDims>, scale = 1, id = 'patient'): Patient {
  const look = { ...lookFor({ id, role: 'patient', outfit: 'gown', variant: 5 }) }
  look.scale = scale
  const rig = createRig(look, body)
  const inp = makeInput()
  inp.posture = 'lie'
  inp.mode = 'lie'
  inp.seatHeight = TOP
  inp.x = X0
  inp.y = OFF_Y
  inp.z = Z0
  inp.tableSeat = true
  inp.tableOffX = OFF_X
  inp.tableOffY = OFF_Y
  const p: Patient = { rig, inp, out: new Float32Array(PART_COUNT * 12), body, scale, t: 0 }
  run(p, 120)
  return p
}

function run(p: Patient, frames: number): void {
  for (let i = 0; i < frames; i++) {
    p.t += 1 / 60
    p.inp.time = p.t
    solveRig(p.rig, p.inp, p.out, 0)
    p.inp.tableSnap = false
  }
}

function pose(p: Patient, o: { lith?: boolean; tuck?: boolean; tilt?: number; roll?: number; posed?: boolean }): void {
  p.inp.tablePose = o.posed ?? true
  p.inp.tableLith = o.lith ?? false
  p.inp.tableTuck = o.tuck ?? false
  p.inp.tableTilt = o.tilt ?? 0
  p.inp.tableRoll = o.roll ?? 0
}

/** The origin of a part (the joint) in the drawn frame. */
const world = (p: Patient, part: number): V3 => [p.out[part * 12 + 3] + p.inp.x, p.out[part * 12 + 7] + p.inp.y, p.out[part * 12 + 11] + p.inp.z]
/** A drawn point in the LEVEL table's frame: d toward the feet from the centre, x across, h above the top. */
const onTable = (w: V3): V3 => [w[2] - Z0, w[0] - X0, w[1] - OFF_Y - TOP]
/** A table-frame point (d, x, h) in the drawn frame. */
const drawn = (d: number, x: number, h: number): V3 => [X0 + x, OFF_Y + TOP + h, Z0 + d]
const dist = (a: ArrayLike<number>, b: ArrayLike<number>): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const handMiddle = (p: Patient, part: number): V3 => {
  const b = part * 12
  return [p.out[b + 3] - p.body.hand * p.out[b + 1] + p.inp.x, p.out[b + 7] - p.body.hand * p.out[b + 5] + p.inp.y, p.out[b + 11] - p.body.hand * p.out[b + 9] + p.inp.z]
}

/** The boot's ankle, in the drawn frame, for side `s` (+1 the patient's left, east). */
const bootAnkle = (s: 1 | -1): V3 => drawn(PELVIS_ON_TABLE.lithotomy + LITHOTOMY_LEG.ankle.d, s * LITHOTOMY_LEG.ankle.x, LITHOTOMY_LEG.ankle.h)
/** The tucked wrist, in the drawn frame, for side `s` and the pelvis at `d`. */
const tuckedWrist = (s: 1 | -1, pelvisD: number): V3 => drawn(pelvisD + BODY_LANDMARKS.wristTucked.d, s * BODY_LANDMARKS.wristTucked.x, BODY_LANDMARKS.wristTucked.h)

const SIDES = [
  { s: 1 as const, thigh: P.thighL, shin: P.shinL, foot: P.footL, hand: P.handL },
  { s: -1 as const, thigh: P.thighR, shin: P.shinR, foot: P.footR, hand: P.handR },
]

describe('the rate of the swing is the table top\'s own', () => {
  it('TABLE_OMEGA equals OMEGA_BOOT of src/scene/surgery/table.ts (the crowd keeps its own copy: features talk through registries at runtime)', () => {
    expect(TABLE_OMEGA).toBe(OMEGA_BOOT)
  })
})

describe('lithotomy: the legs go into the boots', () => {
  it('every avatar and the procedural body: the ankles reach the boots (or as near as the leg can), the knees bend outward and up, nothing hyper-extends', () => {
    const bad: string[] = []
    let worstAtNominal = 0
    for (const { id, body } of BODIES) {
      for (const scale of SCALES) {
        const p = patient(body, scale)
        pose(p, { lith: true })
        run(p, 360)
        for (const { s, thigh, shin, foot } of SIDES) {
          const hip = world(p, thigh)
          const knee = world(p, shin)
          const ankle = world(p, foot)
          const target = bootAnkle(s)
          const miss = dist(ankle, target)
          const t = body.thigh * scale
          const sh = body.shin * scale
          // as near as the leg reaches: along the line from the hip, at the full length (the solve keeps a hair under it)
          const slack = Math.max(0, dist(hip, target) - (t + sh) * 0.9995)
          if (miss > Math.max(0.02, slack + 0.006)) bad.push(`${id} ${scale} ${s}: the ankle is ${(miss * 100).toFixed(1)} cm from the boot (the leg falls ${(slack * 100).toFixed(1)} cm short)`)
          if (scale === 1) worstAtNominal = Math.max(worstAtNominal, miss)
          // the bones keep their own lengths
          if (Math.abs(dist(hip, knee) - t) > 0.002 || Math.abs(dist(knee, ankle) - sh) > 0.002) bad.push(`${id} ${scale} ${s}: the thigh or shin length changed`)
          // the knee's offset from the hip-ankle line, perpendicular to it
          const u = [ankle[0] - hip[0], ankle[1] - hip[1], ankle[2] - hip[2]]
          const ul = Math.hypot(u[0], u[1], u[2])
          for (let i = 0; i < 3; i++) u[i] /= ul
          const v = [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]]
          const dot = v[0] * u[0] + v[1] * u[1] + v[2] * u[2]
          const off = [v[0] - dot * u[0], v[1] - dot * u[1], v[2] - dot * u[2]]
          const offLen = Math.hypot(off[0], off[1], off[2])
          // the knee bends toward the anterior side (the pole): never backward
          const forward = off[0] * s * LITHO_POLE.x + off[1] * LITHO_POLE.up
          if (forward < -0.002) bad.push(`${id} ${scale} ${s}: the knee is hyper-extended (${(forward * 100).toFixed(1)} cm behind the line)`)
          if (offLen > 0.015) {
            if (off[0] * s <= 0) bad.push(`${id} ${scale} ${s}: the knee does not point outward`)
            if (off[1] <= 0) bad.push(`${id} ${scale} ${s}: the knee does not point up`)
          }
          // the foot is square to the shin, toes up: its Y (up the foot) is the shin's, and the sole is not under the pad
          const fy = [p.out[foot * 12 + 1], p.out[foot * 12 + 5], p.out[foot * 12 + 9]]
          const shinUp = [(knee[0] - ankle[0]) / sh, (knee[1] - ankle[1]) / sh, (knee[2] - ankle[2]) / sh]
          const fl = Math.hypot(fy[0], fy[1], fy[2])
          const along = (fy[0] * shinUp[0] + fy[1] * shinUp[1] + fy[2] * shinUp[2]) / fl
          if (along < 0.98) bad.push(`${id} ${scale} ${s}: the foot is not square to the shin (${along.toFixed(3)})`)
          if (ankle[1] < OFF_Y + TOP - 0.02 || knee[1] < OFF_Y + TOP - 0.02) bad.push(`${id} ${scale} ${s}: the knee or ankle is under the pad`)
        }
      }
    }
    expect(bad).toEqual([])
    // at the nominal size every avatar reaches its boots to within 2 cm (a short man's leg is the limit)
    expect(worstAtNominal).toBeLessThan(0.02)
  })

  it('a long leg bends more, a short one reaches along the line: the knee rises with the length of the leg', () => {
    const short = patient(BODIES.find((b) => b.id === 'medical_male_02')!.body, 0.94)
    const long = patient(BODIES.find((b) => b.id === 'medical_female_03')!.body, 1.06)
    for (const p of [short, long]) {
      pose(p, { lith: true })
      run(p, 360)
    }
    const kneeH = (p: Patient): number => onTable(world(p, P.shinL))[2]
    expect(kneeH(long)).toBeGreaterThan(kneeH(short) + 0.08)
    // the short one is at its full length and falls short of the boot; the long one reaches it
    expect(dist(world(short, P.footL), bootAnkle(1))).toBeGreaterThan(0.03)
    expect(dist(world(long, P.footL), bootAnkle(1))).toBeLessThan(0.01)
  })

  it('the nominal body\'s knee falls where the contract\'s own knee is (body.ts LITHOTOMY_LEG.knee), within 3 cm', () => {
    const p = patient(NOMINAL_BODY, 1)
    pose(p, { lith: true })
    run(p, 360)
    const K = LITHOTOMY_LEG.knee
    expect(dist(world(p, P.shinL), drawn(PELVIS_ON_TABLE.lithotomy + K.d, K.x, K.h))).toBeLessThan(0.03)
    expect(dist(world(p, P.shinR), drawn(PELVIS_ON_TABLE.lithotomy + K.d, -K.x, K.h))).toBeLessThan(0.03)
  })

  it('supine stays flat: the legs are as they lie on any bed, the ankles on the pad', () => {
    for (const { id, body } of BODIES) {
      const p = patient(body, 1)
      pose(p, { tuck: true })
      run(p, 360)
      for (const { foot } of SIDES) {
        const a = onTable(world(p, foot))
        expect(a[2], `${id}: the ankle's height on the pad`).toBeGreaterThan(0)
        expect(a[2], id).toBeLessThan(0.25)
        expect(a[0], `${id}: the ankle toward the feet`).toBeGreaterThan(0.7)
      }
    }
  })
})

describe('placement and arms', () => {
  it('the pelvis centre lies at PELVIS_ON_TABLE (supine on the centre, lithotomy 0.3 m toward the feet) within 1 cm, on the centre line, at its own lying height', () => {
    const bad: string[] = []
    for (const { id, body } of BODIES) {
      for (const scale of SCALES) {
        for (const lith of [false, true]) {
          const p = patient(body, scale)
          pose(p, { lith, tuck: true })
          run(p, 360)
          const [d, x, h] = onTable(world(p, P.pelvis))
          const want = PELVIS_ON_TABLE[lith ? 'lithotomy' : 'supine']
          if (Math.abs(d - want) > 0.01 || Math.abs(x) > 0.01 || Math.abs(h - body.liePelvis) > 0.01) bad.push(`${id} ${scale} ${lith ? 'lithotomy' : 'supine'}: pelvis at d ${d.toFixed(3)} x ${x.toFixed(3)} h ${h.toFixed(3)}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('tucked arms: the wrists are within 3 cm of BODY_LANDMARKS.wristTucked (mirrored), the hands above the pad, supine and in lithotomy', () => {
    const bad: string[] = []
    let worst = 0
    for (const { id, body } of BODIES) {
      for (const scale of SCALES) {
        for (const lith of [false, true]) {
          const p = patient(body, scale)
          pose(p, { lith, tuck: true })
          run(p, 360)
          const pelvisD = PELVIS_ON_TABLE[lith ? 'lithotomy' : 'supine']
          for (const { s, hand } of SIDES) {
            const wrist = world(p, hand)
            const miss = dist(wrist, tuckedWrist(s, pelvisD))
            worst = Math.max(worst, miss)
            if (miss > 0.03) bad.push(`${id} ${scale} ${s} ${lith ? 'lithotomy' : 'supine'}: the wrist is ${(miss * 100).toFixed(1)} cm from wristTucked`)
            if (onTable(wrist)[2] < 0.02) bad.push(`${id} ${scale} ${s}: the wrist is on or under the pad (${onTable(wrist)[2].toFixed(3)})`)
            if (onTable(handMiddle(p, hand))[2] < 0.0) bad.push(`${id} ${scale} ${s}: the hand is under the pad`)
            // along the side: the wrist is beside the body, not across it
            if (s * onTable(wrist)[1] < 0.2) bad.push(`${id} ${scale} ${s}: the wrist is not out at the side`)
          }
        }
      }
    }
    expect(bad).toEqual([])
    expect(worst).toBeLessThanOrEqual(TUCK_EXTEND + 0.004)
  })

  it('out arms are the lying arms, and a pose without lithotomy or tucking changes only the carrying: the body is the plain lying body', () => {
    for (const { body } of [BODIES[0], BODIES[1], BODIES[9]]) {
      const plain = patient(body, 1)
      const posed = patient(body, 1)
      pose(posed, {})
      run(plain, 120)
      run(posed, 120)
      // (the pelvis does not sway sideways on the table; every other part is where the plain lying body has it)
      for (let part = 0; part < P.prop; part++) {
        if (part === P.skirt) continue
        const a = world(plain, part)
        const b = world(posed, part)
        expect(dist(a, b), `part ${part}`).toBeLessThan(0.03)
      }
    }
  })
})

describe('a tipped table carries the whole body', () => {
  it('with tilts -30..+20 and rolls +-12, the head, the pelvis and the ankles are where tablePointInto puts their level positions, within 1 cm; so are the wrists and knees', () => {
    const tp = newTablePose()
    const tmp = { x: 0, y: 0, z: 0 }
    const parts = [P.head, P.pelvis, P.footL, P.footR, P.shinL, P.shinR, P.handL, P.handR, P.chest]
    const bad: string[] = []
    let worst = 0
    for (const { id, body } of BODIES) {
      for (const lith of [false, true]) {
        const level = patient(body, 1)
        pose(level, { lith, tuck: true })
        run(level, 360)
        const ref = parts.map((part) => world(level, part))
        for (const tilt of [-30, -25, -10, 0, 10, 20]) {
          for (const roll of [-12, 0, 12]) {
            const p = patient(body, 1)
            pose(p, { lith, tuck: true, tilt, roll })
            run(p, 360)
            setTablePose(tp, tilt, roll)
            parts.forEach((part, i) => {
              // (the level's drawn frame is the sim frame shifted: tablePointInto works in the sim frame)
              tablePointInto(tp, ref[i][0] - OFF_X, ref[i][1] - OFF_Y, ref[i][2], tmp)
              const want: V3 = [tmp.x + OFF_X, tmp.y + OFF_Y, tmp.z]
              const miss = dist(world(p, part), want)
              worst = Math.max(worst, miss)
              if (miss > 0.01) bad.push(`${id} ${lith ? 'lith' : 'supine'} tilt ${tilt} roll ${roll} part ${part}: ${(miss * 100).toFixed(2)} cm`)
            })
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
    expect(worst).toBeLessThan(0.002)
  })

  it('the body stays on the pad when the table tips: its pelvis keeps its height above the tipped top, and the head end goes down with a negative tilt', () => {
    const p = patient(BODIES[1].body, 1)
    pose(p, { lith: true, tuck: true, tilt: -25 })
    run(p, 360)
    const head = world(p, P.head)
    const pel = world(p, P.pelvis)
    const level = patient(BODIES[1].body, 1)
    pose(level, { lith: true, tuck: true })
    run(level, 360)
    // Trendelenburg: the head is lower than level, the feet higher
    expect(head[1]).toBeLessThan(world(level, P.head)[1] - 0.1)
    expect(world(p, P.footL)[1]).toBeGreaterThan(world(level, P.footL)[1] + 0.1)
    // the distance of the pelvis from the tipped top's plane: the table's up (its tilt only) over the level height
    const tp = newTablePose()
    setTablePose(tp, -25, 0)
    const up = { x: 0, y: 0, z: 0 }
    tablePointInto(tp, 0, 1, 0, up)
    // (the plane through the pivot with normal (0, cos, -sin)): the pelvis is BODY.liePelvis above it
    const n = [0, Math.cos((-25 * Math.PI) / 180), -Math.sin((-25 * Math.PI) / 180)]
    const piv = [X0, OFF_Y + 0.8, Z0 + SURGERY.tablePivot.dz]
    const topAt = (w: V3) => (w[0] - piv[0]) * n[0] + (w[1] - piv[1]) * n[1] + (w[2] - piv[2]) * n[2] - (TOP - 0.8)
    expect(topAt(pel)).toBeCloseTo(BODIES[1].body.liePelvis, 2)
  })
})

describe('transitions', () => {
  it('into lithotomy and tucked arms and back out: no part jumps more than 2 cm in a frame, and it is in place after about 3 s', () => {
    for (const { id, body } of [BODIES[0], BODIES[1], BODIES[5], BODIES[10]]) {
      const p = patient(body, 1)
      const prev = new Float64Array(P.prop * 3)
      const read = (): void => {
        for (let part = 0; part < P.prop; part++) {
          const w = world(p, part)
          prev[part * 3] = w[0]
          prev[part * 3 + 1] = w[1]
          prev[part * 3 + 2] = w[2]
        }
      }
      read()
      let worst = 0
      let worstPart = -1
      const sweep = (frames: number): void => {
        for (let i = 0; i < frames; i++) {
          run(p, 1)
          for (let part = 0; part < P.prop; part++) {
            if (part === P.skirt) continue
            const w = world(p, part)
            const j = Math.hypot(w[0] - prev[part * 3], w[1] - prev[part * 3 + 1], w[2] - prev[part * 3 + 2])
            if (j > worst) {
              worst = j
              worstPart = part
            }
            prev[part * 3] = w[0]
            prev[part * 3 + 1] = w[1]
            prev[part * 3 + 2] = w[2]
          }
        }
      }
      pose(p, { lith: true, tuck: true, tilt: -25 })
      // (the tilt itself is the sim's, already eased: it is set at once here, so look at the parts relative to the table)
      p.inp.tableTilt = 0
      sweep(180)
      expect(worst, `${id} into the pose: part ${worstPart}`).toBeLessThan(0.02)
      expect(dist(world(p, P.footL), bootAnkle(1)), id).toBeLessThan(0.02)
      pose(p, {})
      worst = 0
      sweep(180)
      expect(worst, `${id} out of the pose: part ${worstPart}`).toBeLessThan(0.02)
      // (the legs are down and the arms are out again: the plain lying body)
      expect(onTable(world(p, P.footL))[2]).toBeLessThan(0.25)
    }
  })

  it('the pelvis slide eases: PELVIS_ON_TABLE jumps 0.3 m when the position switches to lithotomy (and back to supine at the wake-up), the body slides over about 1.5 s, at most 8 mm a frame, never backward', () => {
    for (const { id, body } of BODIES) {
      const p = patient(body, 1)
      pose(p, { tuck: true })
      run(p, 120)
      const d = (): number => onTable(world(p, P.pelvis))[0]
      expect(d(), id).toBeCloseTo(PELVIS_ON_TABLE.supine, 2)
      // the positioning step: lithotomy from this frame on
      pose(p, { lith: true, tuck: true })
      let prev = d()
      let worst = 0
      for (let i = 0; i < 240; i++) {
        run(p, 1)
        const now = d()
        worst = Math.max(worst, Math.abs(now - prev))
        expect(now, `${id} slides toward the feet only`).toBeGreaterThanOrEqual(prev - 1e-4)
        prev = now
        if (i === 0) expect(now - PELVIS_ON_TABLE.supine, `${id}: the first frame`).toBeLessThan(0.005)
      }
      expect(worst, `${id} into lithotomy`).toBeLessThan(0.008)
      expect(d(), id).toBeCloseTo(PELVIS_ON_TABLE.lithotomy, 2)
      // the wake-up: supine again, the body slides back up the table
      pose(p, { tuck: true })
      worst = 0
      for (let i = 0; i < 240; i++) {
        run(p, 1)
        const now = d()
        worst = Math.max(worst, Math.abs(now - prev))
        expect(now, `${id} slides back toward the head only`).toBeLessThanOrEqual(prev + 1e-4)
        prev = now
      }
      expect(worst, `${id} back to supine`).toBeLessThan(0.008)
      expect(d(), id).toBeCloseTo(PELVIS_ON_TABLE.supine, 2)
    }
  })

  it('the swing takes about as long as the boots do: half done at about 0.25 s, 95 % at about 1.5 s', () => {
    const p = patient(NOMINAL_BODY, 1)
    pose(p, { lith: true })
    const slide0 = onTable(world(p, P.pelvis))[0]
    const frames: number[] = []
    for (let i = 1; i <= 120; i++) {
      run(p, 1)
      frames.push((onTable(world(p, P.pelvis))[0] - slide0) / PELVIS_ON_TABLE.lithotomy)
    }
    // the critically damped follower: x(t) = 1 - (1 + w t) e^(-w t)
    for (const sec of [0.25, 0.5, 1, 1.5]) {
      const want = 1 - (1 + TABLE_OMEGA * sec) * Math.exp(-TABLE_OMEGA * sec)
      expect(frames[Math.round(sec * 60) - 1]).toBeCloseTo(want, 2)
    }
    expect(frames[89]).toBeGreaterThan(0.93)
    expect(frames[89]).toBeLessThan(0.97)
  })

  it('a warm start, a Jump (the entity was replaced), a first appearance on the table and a long gap in drawing snap with no swing; a plain pose change swings', () => {
    for (const { id, body } of [BODIES[0], BODIES[2]]) {
      // a pose change on the table: a swing (a frame later the ankle is still far from the boot)
      const swing = patient(body, 1)
      pose(swing, { lith: true, tuck: true })
      run(swing, 2)
      expect(dist(world(swing, P.footL), bootAnkle(1)), `${id} swing`).toBeGreaterThan(0.2)
      expect(Math.abs(onTable(world(swing, P.pelvis))[0]), `${id} swing`).toBeLessThan(0.02)
      // the snap flag: placed on the next frame
      const snap = patient(body, 1)
      pose(snap, { lith: true, tuck: true })
      snap.inp.tableSnap = true
      run(snap, 1)
      snap.inp.tableSnap = false
      expect(dist(world(snap, P.footL), bootAnkle(1)), `${id} snap`).toBeLessThan(0.03)
      expect(onTable(world(snap, P.pelvis))[0], `${id} snap`).toBeGreaterThan(0.29)
      expect(dist(world(snap, P.handL), tuckedWrist(1, PELVIS_ON_TABLE.lithotomy)), `${id} snap`).toBeLessThan(0.04)
      // a long gap in drawing (out of view): the followers are placed, whatever the flag
      const gap = patient(body, 1)
      pose(gap, { lith: true })
      gap.t += 5
      run(gap, 1)
      expect(dist(world(gap, P.footL), bootAnkle(1)), `${id} gap`).toBeLessThan(0.03)
      // the first frame on the table: a person who comes onto it already posed is placed (their rig has no memory of the table)
      const look = { ...lookFor({ id: 'first', role: 'patient', outfit: 'gown', variant: 5 }) }
      const rig = createRig(look, body)
      const inp = makeInput()
      inp.posture = 'lie'
      inp.mode = 'lie'
      inp.seatHeight = TOP
      inp.x = X0
      inp.y = OFF_Y
      inp.z = Z0
      const out = new Float32Array(PART_COUNT * 12)
      for (let i = 0; i < 120; i++) {
        inp.time = i / 60
        solveRig(rig, inp, out, 0)
      }
      inp.tableSeat = true
      inp.tableOffX = OFF_X
      inp.tableOffY = OFF_Y
      inp.tablePose = true
      inp.tableLith = true
      inp.time = 3
      solveRig(rig, inp, out, 0)
      const first: Patient = { rig, inp, out, body, scale: 1, t: 3 }
      expect(dist(world(first, P.footL), bootAnkle(1)), `${id} first`).toBeLessThan(0.03)
    }
  })

  it('when the pose goes the legs come down and the arms untuck (no pop), and then the person is solved exactly as any other lying person', () => {
    const body = BODIES[1].body
    const p = patient(body, 1)
    pose(p, { lith: true, tuck: true })
    run(p, 240)
    pose(p, { posed: false })
    run(p, 360)
    expect(p.rig.tbl.on).toBe(false)
    const plain = patient(body, 1)
    // (the same frames, so the same time: the idle noise of a lying person follows the clock)
    run(plain, 240 + 360)
    for (let part = 0; part < PART_COUNT; part++) for (let k = 0; k < 12; k++) expect(Math.abs(p.out[part * 12 + k] - plain.out[part * 12 + k]), `part ${part} [${k}]`).toBeLessThan(2e-3)
    expect(p.rig.tbl.st[0]).toBe(0)
    expect(TABLE_REST).toBeLessThan(0.01)
  })
})

describe('determinism', () => {
  it('the same pose and time give the same skeleton, bit for bit; a different history converges to it', () => {
    const body = BODIES[3].body
    const a = patient(body, 1)
    const b = patient(body, 1)
    for (const p of [a, b]) {
      pose(p, { lith: true, tuck: true, tilt: -20, roll: 7 })
      run(p, 300)
    }
    expect(Array.from(a.out)).toEqual(Array.from(b.out))
    // another history (a different pose first, then this one) converges within a few seconds
    const c = patient(body, 1)
    pose(c, { tilt: 15, roll: -5 })
    run(c, 100)
    pose(c, { lith: true, tuck: true, tilt: -20, roll: 7 })
    c.t = a.t - 600 / 60
    run(c, 600)
    const d = patient(body, 1)
    pose(d, { lith: true, tuck: true, tilt: -20, roll: 7 })
    d.t = a.t - 600 / 60
    run(d, 600)
    for (const part of [P.pelvis, P.head, P.footL, P.footR, P.handL, P.handR, P.shinL]) expect(dist(world(c, part), world(d, part)), `part ${part}`).toBeLessThan(0.005)
  })
})

describe('everybody else renders exactly as before', () => {
  const GOLDEN_BODIES = [
    ['procedural', NOMINAL_BODY],
    ['medical_male_01', people.find((a) => a.id === 'medical_male_01')!.body],
    ['female_adult_15', people.find((a) => a.id === 'female_adult_15')!.body],
  ] as const
  const SURFACES = [
    ['ward bed', 0.49],
    ['stretcher', 0.79],
    ['or table', 0.88],
  ] as const

  it('a lying person with no table fields (a bed, a stretcher, the OR table with no pose) matches the numbers of the solve before the table work, to 0.03 mm', () => {
    let checked = 0
    for (const [bn, body] of GOLDEN_BODIES) {
      for (const [sn, seat] of SURFACES) {
        const look = { ...lookFor({ id: 'golden-' + bn, role: 'patient', outfit: 'gown', variant: 5 }) }
        const rig = createRig(look, body)
        const inp = makeInput()
        inp.posture = 'lie'
        inp.mode = 'lie'
        inp.seatHeight = seat
        inp.x = 3
        inp.y = 4.2
        inp.z = 5.9
        const rows = new Float32Array(PART_COUNT * 12)
        for (let i = 0; i < 240; i++) {
          inp.time = i / 60
          solveRig(rig, inp, rows, 0)
        }
        const want = LYING_GOLDEN[`${bn}|${sn}`]
        expect(want, `${bn} ${sn}`).toBeDefined()
        let i = 0
        for (let part = 0; part < PART_COUNT; part++) {
          for (const k of [3, 7, 11, 0, 5, 10]) {
            expect(Math.abs(rows[part * 12 + k] - want[i++]), `${bn} ${sn} part ${part} [${k}]`).toBeLessThan(3e-5)
            checked++
          }
        }
      }
    }
    expect(checked).toBe(9 * PART_COUNT * 6)
  })

  it('pose fields on a person who is not on the OR table change nothing (bit for bit): the table paths are off', () => {
    const body = BODIES[2].body
    const a = patient(body, 1)
    const b = patient(body, 1)
    a.inp.tableSeat = false
    b.inp.tableSeat = false
    pose(b, { lith: true, tuck: true, tilt: -25, roll: 10 })
    run(a, 200)
    run(b, 200)
    expect(Array.from(b.out)).toEqual(Array.from(a.out))
    expect(b.rig.tbl.on).toBe(false)
  })

  it('on the OR table with a level, supine, arms-out pose the person is where a plain lying person is (the body is not touched, only carried)', () => {
    const a = patient(BODIES[1].body, 1)
    const b = patient(BODIES[1].body, 1)
    pose(b, {})
    run(a, 200)
    run(b, 200)
    for (const part of [P.head, P.chest, P.footL, P.handR]) expect(dist(world(a, part), world(b, part))).toBeLessThan(0.03)
  })
})

// ---------------------------------------------------------------------------------------------
// the model: the entity's patientPose reaches the rig with the level's drawn offsets
// ---------------------------------------------------------------------------------------------

function ent(o: Partial<Entity> & { id: string }): Entity {
  return { role: 'patient', outfit: 'gown', name: o.id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'lie', emote: 'none', mood: 'neutral', tier: 'near', variant: 3, ...o } as Entity
}

const POSE: PatientPoseView = { position: 'lithotomy', headTiltDeg: -25, rollDeg: 8, arms: 'tucked', airway: 'none', awareness: 'asleep', prep: 0, drape: 0, marks: 'none', catheter: false, manipulator: false }

function frame(entities: Map<string, Entity>, t: number): FrameInput {
  return { dt: 1 / 60, time: t, camX: -49.2, camY: 6.2, camZ: 8, entities, followId: null, selectedId: null, hoverId: null, driven: null }
}

function runModel(m: CrowdModel, es: Map<string, Entity>, frames: number, t0 = 0): void {
  for (let i = 0; i < frames; i++) m.update(frame(es, t0 + i / 60))
}

/** The origin of a part of a (procedural: no binds) person's row, in the drawn frame (heading 0). */
function modelPart(m: CrowdModel, key: string, part: number): V3 {
  const p = m.get(key)!
  const o = p.row * ROW_FLOATS + TEX.parts * 4 + part * 12
  return [m.data[o + 3] + p.x, m.data[o + 7] + p.y, m.data[o + 11] + p.z]
}

describe('the crowd model', () => {
  const shownBefore = { shown: levelView.shown, overview: levelView.overview }
  beforeAll(() => {
    levelView.shown = 2
    levelView.overview = false
  })
  afterAll(() => {
    levelView.shown = shownBefore.shown
    levelView.overview = shownBefore.overview
  })

  const onTableEntity = (id: string, patientPose: PatientPoseView | null): Entity =>
    ent({ id, anim: 'lie', seated: { seatId: 'orTable:0', pose: 'lie' }, position: { x: SURGERY.table.at.x, y: 0, z: SURGERY.table.at.z }, patientPose })

  it('a patient on the OR table with a pose is carried by the table in the level\'s drawn frame: the body is where tablePointInto (the sim frame) puts the level body', () => {
    const level = new CrowdModel()
    const tipped = new CrowdModel()
    const a = new Map([['pat', onTableEntity('pat', { ...POSE, headTiltDeg: 0, rollDeg: 0 })]])
    const b = new Map([['pat', onTableEntity('pat', POSE)]])
    runModel(level, a, 360)
    runModel(tipped, b, 360)
    const tp = newTablePose()
    setTablePose(tp, POSE.headTiltDeg, POSE.rollDeg)
    const tmp = { x: 0, y: 0, z: 0 }
    for (const part of [P.head, P.pelvis, P.footL, P.footR, P.handL, P.handR]) {
      const l = modelPart(level, 'pat', part)
      tablePointInto(tp, l[0] - OFF_X, l[1] - OFF_Y, l[2], tmp)
      const want: V3 = [tmp.x + OFF_X, tmp.y + OFF_Y, tmp.z]
      expect(dist(modelPart(tipped, 'pat', part), want), `part ${part}`).toBeLessThan(0.005)
    }
    // the level body is in the pose: the pelvis slid 0.3 m toward the feet, the ankle in the boot
    const pel = onTable(modelPart(level, 'pat', P.pelvis))
    expect(pel[0]).toBeCloseTo(PELVIS_ON_TABLE.lithotomy, 2)
    // (the procedural body's lying pelvis is 2.5 cm above the pad)
    expect(pel[2]).toBeCloseTo(NOMINAL_BODY.liePelvis, 2)
    expect(dist(modelPart(level, 'pat', P.footL), bootAnkle(1))).toBeLessThan(0.01)
  })

  it('the pick capsule follows the table: tipped head down, the head end of the capsule is lower than level, and slid with the legs in lithotomy', () => {
    const level = new CrowdModel()
    const tipped = new CrowdModel()
    runModel(level, new Map([['pat', onTableEntity('pat', { ...POSE, headTiltDeg: 0, rollDeg: 0 })]]), 360)
    runModel(tipped, new Map([['pat', onTableEntity('pat', POSE)]]), 360)
    const l = level.get('pat')!
    const t = tipped.get('pat')!
    expect(t.ay).toBeLessThan(l.ay - 0.2)
    expect(t.by).toBeGreaterThan(l.by + 0.05)
    // the level capsule's hip end is slid toward the feet by the lithotomy slide
    const plain = new CrowdModel()
    runModel(plain, new Map([['pat', onTableEntity('pat', null)]]), 360)
    expect(l.bz - plain.get('pat')!.bz).toBeCloseTo(PELVIS_ON_TABLE.lithotomy, 2)
  })

  it('a patient on a trolley, in a ward bed, on a stretcher or on any other table renders exactly as without the pose, whatever the pose says', () => {
    const seats: [string, Partial<Entity>][] = [
      ['trolley', { seated: { seatId: 'surgeryBed:preop:0', pose: 'lie' } }],
      ['ward bed', { seated: { seatId: 'bed:A1', pose: 'lie' } }],
      ['er trolley', { seated: { seatId: 'erBay:bay:2', pose: 'lie' } }],
      ['mri table', { seated: { seatId: 'scanTable:mri', pose: 'lie' } }],
      ['stretcher', { riding: true, vehicle: 'stretcher' }],
      ['no seat', {}],
    ]
    for (const [name, more] of seats) {
      const posed = new CrowdModel()
      const plain = new CrowdModel()
      const at = { x: SURGERY.table.at.x, y: 0, z: SURGERY.table.at.z }
      runModel(posed, new Map([['pat', ent({ id: 'pat', position: at, patientPose: POSE, ...more })]]), 200)
      runModel(plain, new Map([['pat', ent({ id: 'pat', position: at, ...more })]]), 200)
      const o = (m: CrowdModel): number[] => {
        const p = m.get('pat')!
        const s = p.row * ROW_FLOATS + TEX.parts * 4
        return Array.from(m.data.subarray(s, s + PART_COUNT * 12))
      }
      expect(o(posed), name).toEqual(o(plain))
      expect(posed.get('pat')!.rig.tbl.on, name).toBe(false)
      expect(posed.get('pat')!.ay, name).toBe(plain.get('pat')!.ay)
    }
  })

  it('a Jump (the entity is replaced) places the patient at once; the sim changing the pose swings', () => {
    const m = new CrowdModel()
    const es = new Map([['pat', onTableEntity('pat', { ...POSE, position: 'supine', arms: 'out', headTiltDeg: 0, rollDeg: 0 })]])
    runModel(m, es, 200)
    // the sim changes the pose on the same entity: a swing
    es.get('pat')!.patientPose = { ...POSE, headTiltDeg: 0, rollDeg: 0 }
    runModel(m, es, 2, 200 / 60)
    expect(dist(modelPart(m, 'pat', P.footL), bootAnkle(1))).toBeGreaterThan(0.2)
    // a Jump replaces the entity object: placed on the next frame
    const m2 = new CrowdModel()
    const es2 = new Map([['pat', onTableEntity('pat', { ...POSE, position: 'supine', arms: 'out', headTiltDeg: 0, rollDeg: 0 })]])
    runModel(m2, es2, 200)
    es2.set('pat', onTableEntity('pat', { ...POSE, headTiltDeg: 0, rollDeg: 0 }))
    runModel(m2, es2, 1, 200 / 60)
    expect(dist(modelPart(m2, 'pat', P.footL), bootAnkle(1))).toBeLessThan(0.01)
  })

  it('the probe can force a patient pose on the OR table (forcePatient) and give the patient back (null, or clearForced)', () => {
    const m = new CrowdModel()
    const es = new Map([['pat', onTableEntity('pat', null)]])
    runModel(m, es, 200)
    const flat = modelPart(m, 'pat', P.footL)
    m.forcePatient('pat', { position: 'lithotomy', arms: 'tucked', headTiltDeg: -20 })
    runModel(m, es, 300, 200 / 60)
    const forced = modelPart(m, 'pat', P.footL)
    expect(forced[1]).toBeGreaterThan(flat[1] + 0.1)
    expect(m.get('pat')!.rig.tbl.on).toBe(true)
    // (a field left out is the plain level patient's: no roll)
    const tp = newTablePose()
    setTablePose(tp, -20, 0)
    expect(m.get('pat')!.rig.tbl.pose.tiltDeg).toBe(-20)
    expect(m.get('pat')!.rig.tbl.pose.rollDeg).toBe(0)
    m.forcePatient('pat', null)
    runModel(m, es, 600, 500 / 60)
    expect(m.get('pat')!.rig.tbl.on).toBe(false)
    expect(dist(modelPart(m, 'pat', P.footL), flat)).toBeLessThan(0.02)
    m.forcePatient('pat', { position: 'lithotomy' })
    m.clearForced()
    expect(m.forcedPatients.size).toBe(0)
    // forcing a pose on somebody who does not lie on the OR table does nothing to them
    const w = new CrowdModel()
    const ward = new Map([['w', ent({ id: 'w', seated: { seatId: 'bed:A1', pose: 'lie' }, position: { x: 3, y: 0, z: 3 } })]])
    runModel(w, ward, 100)
    w.forcePatient('w', { position: 'lithotomy', arms: 'tucked', headTiltDeg: -25 })
    runModel(w, ward, 100, 2)
    expect(w.get('w')!.rig.tbl.on).toBe(false)
  })

  it('a forced airway still reaches the patient (the pose\'s airway is read from the forced pose first)', () => {
    const m = new CrowdModel()
    const es = new Map([['pat', onTableEntity('pat', null)]])
    runModel(m, es, 120)
    expect(m.get('pat')!.rig.tube).toBe(false)
    m.forcePatient('pat', { airway: 'tube' })
    runModel(m, es, 60, 2)
    expect(m.get('pat')!.rig.tube).toBe(true)
  })
})
