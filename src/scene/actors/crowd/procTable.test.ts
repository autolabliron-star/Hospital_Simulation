/**
 * R5 wave 3 (agent J): the patient on the CT cryo table and the ultrasound couch (tablePatient.ts, rig.ts, model.ts). For the procedural body and EVERY realistic avatar's own
 * skeleton, skinned on the CPU exactly as the avatar vertex shader does (procTable.testkit.ts), at 0.94, 1 and 1.06 of its size:
 *   - the positions: face up, face down (prone) and on the right side with the left flank up (obliqueLeftUp) lie ON the pad: the torso at the support its measured mesh gives
 *     (the back or the front within a few centimetres of the pad), no part more than the wave-2 tolerance under it, nothing floating;
 *   - face down the head is turned to the patient's left onto its cheek and down, the legs lie on the pad, the feet trail plantar-flexed, the forearms are over the head;
 *   - on the side the left flank is up, the upper leg rides on the lower, the left arm rests higher than the right;
 *   - one arm up (ProSense): the treated side's hand behind the head, the other arm along the side, the body rolled by the wedge;
 *   - the CT bore: every point of every body, in every position, fits the gantry's liner (radius CT.linerIn about the axis) when the table is in;
 *   - the turn (supine to prone and back, and onto the side) is a smooth roll over the pad: nothing under it at any frame, no joint jumping, the torso kept on the pad throughout;
 *   - warm starts, Jumps and a first appearance snap; the same pose gives the same skeleton bit for bit; the others (no pose, a diagnostic scanner's table) are unchanged.
 * And the plumbing: the model hands the poses to the rig (seat ids, the wedge, the treated side), the probe can force them on both tables.
 */
import { describe, expect, it } from 'vitest'
import { CT } from '@/scene/imaging/machines/ct'
import { levelView } from '@/scene/levels/levelView'
import { CRYO_SUITE, IMAGING } from '@/sim/places'
import type { Entity, PatientPoseView } from '@/sim/types'
import { P, PART_COUNT, ROW_FLOATS, TEX } from './constants'
import { CrowdModel, type FrameInput } from './model'
import { LIE_BINS, OBLIQUE_RAD, ROLL_LEGS, lieSupport, measureLieFit, oneUpSide, rollLift } from './tablePatient'
import { AVATARS, HEAD, LEFT_ARM, LEGS, RIGHT_ARM, TABLES, TORSO, TestPatient, heightRange, type ProcTableId } from './procTable.testkit'

const WHO = ['procedural', ...AVATARS] as const
const NAME = (w: (typeof WHO)[number]): string => (w === 'procedural' ? 'procedural' : w.id)
const SCALES = [0.94, 1, 1.06]
/** The two bodies that wear a coat and a dress that rises 5 to 20 cm off the body: no patient wears them (avatars.ts GOWN), the mesh tests leave them out as the drapes' do. */
const GARMENT = ['medical_male_05', 'female_adult_15']
/** The wave-2 tolerance: a body rests IN the pad (the back sunk 1 to 4 cm: tools/people-bed.test.ts), the head's hair a little more (the lying head is 7 cm under it on a few avatars). */
const SINK = 0.06
const SINK_HEAD = 0.085
/** The procedural body lies 8 cm in the pad, as it has always (head.ts LIE.pelvisAbove). */
const SINK_PROC = 0.11

const POSES: Record<string, Partial<PatientPoseView>> = {
  supine: { position: 'supine', arms: 'aboveHead' },
  prone: { position: 'prone', arms: 'aboveHead' },
  oblique: { position: 'obliqueLeftUp', arms: 'aboveHead' },
  one: { position: 'supine', arms: 'oneUp', rollDeg: -8 },
}

async function settled(who: (typeof WHO)[number], table: ProcTableId, pose: Partial<PatientPoseView>, scale = 1): Promise<TestPatient> {
  const p = await TestPatient.make(who, table, scale)
  p.setPose(pose)
  p.snap(4)
  p.run(30)
  return p
}

type V3 = readonly [number, number, number]
const dist = (a: ArrayLike<number>, b: ArrayLike<number>): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The body's skin (not the gown's skirt or the hair of the procedural body): the parts a person is made of. */
const BODY_PARTS = [P.pelvis, P.chest, P.head, P.armL, P.foreL, P.handL, P.armR, P.foreR, P.handR, P.thighL, P.shinL, P.footL, P.thighR, P.shinR, P.footR]

describe('on the pad: face up, face down, on the side, one arm up', () => {
  for (const [name, pose] of Object.entries(POSES)) {
    it(`${name}: the torso rests on the pad at its measured support, no part is far under it, nothing floats; every avatar, three sizes`, async () => {
      const bad: string[] = []
      for (const who of WHO) {
        for (const scale of SCALES) {
          const p = await settled(who, 'cryo', pose, scale)
          const b = p.skin()
          const label = `${NAME(who)} ${scale}`
          const proc = who === 'procedural'
          const torso = heightRange(b, TORSO)
          // the torso: the lowest vertex at the pad within the sink (and not hovering more than 3 cm); the procedural body's lies 8 cm in
          if (torso.lo < -(proc ? SINK_PROC : SINK) || torso.lo > 0.035) bad.push(`${label}: the torso's lowest point is at ${torso.lo.toFixed(3)}`)
          for (const part of BODY_PARTS) {
            const r = heightRange(b, [part])
            const limit = part === P.head ? SINK_HEAD : SINK
            if (r.lo < -(proc ? SINK_PROC + 0.06 : limit)) bad.push(`${label}: part ${part} is ${(-r.lo).toFixed(3)} under the pad`)
          }
          // nothing floating: the lowest of the body's parts within 5 cm of the pad
          const all = heightRange(b, BODY_PARTS)
          if (!proc && all.lo > 0.025) bad.push(`${label}: the whole body floats ${all.lo.toFixed(3)} over the pad`)
          // the legs, feet and hands rest on the pad or on what holds them (the stacked leg and the arm up on a support are higher): the lower leg and the lower arm on it
          const legsLo = heightRange(b, LEGS).lo
          if (!proc && (legsLo > 0.035 || legsLo < -0.05)) bad.push(`${label}: the legs' lowest point is at ${legsLo.toFixed(3)}`)
        }
      }
      expect(bad).toEqual([])
    }, 240000)
  }

  it('the torso lands where the avatar\'s own measured support function says (the lift is m(0) - m(psi) at nominal size): its sink at every roll angle of every position is its supine sink within 4 cm (the raised arms pull the shoulder\'s skin a little)', async () => {
    const bad: string[] = []
    for (const who of WHO) {
      if (who === 'procedural') continue
      const sup = await settled(who, 'cryo', { position: 'supine', arms: 'out' })
      const sinkSupine = -heightRange(sup.skin(), TORSO).lo
      for (const [name, pose] of Object.entries(POSES)) {
        const p = await settled(who, 'cryo', pose)
        const sink = -heightRange(p.skin(), TORSO).lo
        // the same sink at every angle: the support function keeps the back or the front or the flank at the pad as it keeps the supine back
        if (Math.abs(sink - sinkSupine) > 0.04) bad.push(`${who.id} ${name}: sinks ${sink.toFixed(3)} against ${sinkSupine.toFixed(3)} supine`)
      }
    }
    expect(bad).toEqual([])
  }, 240000)

  it('measureLieFit: a body\'s back is its deepest side, the half turn flips it to the front, a roll of the left up puts the left flank first; the table says how far the pelvis rides up', async () => {
    for (const who of AVATARS.filter((a) => !GARMENT.includes(a.id))) {
      const p = await TestPatient.make(who, 'cryo')
      const m = p.rig.dims.lie
      expect(m.m.length, who.id).toBe(LIE_BINS)
      // the back and the front are each a hand's depth or more and not a trunk's (a woman's chest or a man's belly may reach further than the buttocks)
      for (const k of [0, LIE_BINS / 2]) {
        expect(-m.m[k], who.id).toBeGreaterThan(0.08)
        expect(-m.m[k], who.id).toBeLessThan(0.3)
      }
      // the sides (a quarter turn either way) are the half-width of the body: the shoulders and the hips
      expect(-m.m[LIE_BINS / 4], who.id).toBeGreaterThan(0.15)
      expect(-m.m[(3 * LIE_BINS) / 4], who.id).toBeGreaterThan(0.15)
      // the pelvis rides up on its side, the lift stays within a few centimetres of the back's depth at the half turn
      expect(rollLift(m, OBLIQUE_RAD), who.id).toBeGreaterThan(-0.05)
      expect(rollLift(m, OBLIQUE_RAD), who.id).toBeLessThan(0.12)
      expect(Math.abs(rollLift(m, Math.PI)), who.id).toBeLessThan(0.08)
      // interpolated between bins and periodic
      expect(lieSupport(m, 0)).toBeCloseTo(lieSupport(m, 2 * Math.PI), 6)
      expect(lieSupport(m, (2 * Math.PI) / LIE_BINS / 2)).toBeCloseTo((m.m[0] + m.m[1]) / 2, 6)
    }
    expect(measureLieFit([], [], [], 0, new Array(PART_COUNT * 12).fill(0))).toBeNull()
  })
})

describe('face down: the head turned onto its cheek, the legs on the pad, the arms over the head', () => {
  it('the head is turned to the patient\'s left (the table\'s -x) and down, its lowest point near the pad; the hands and forearms lie over the head, the feet trail on the pad, the knees are not bent into it', async () => {
    const bad: string[] = []
    for (const who of WHO) {
      for (const scale of SCALES) {
        const p = await settled(who, 'cryo', POSES.prone, scale)
        const label = `${NAME(who)} ${scale}`
        const b = p.skin()
        // the head's forward axis (column 2 of its matrix) in the table frame (x across, h up, d toward the feet)
        const hm = p.out.slice(P.head * 12, P.head * 12 + 12)
        const fwd: V3 = [hm[2], hm[6], hm[10]]
        const fl = Math.hypot(...fwd)
        if (fwd[0] / fl > -0.6) bad.push(`${label}: the face looks ${(fwd[0] / fl).toFixed(2)} across (it must turn to the patient's left, -x)`)
        if (fwd[1] / fl > 0.05) bad.push(`${label}: the face looks up (${(fwd[1] / fl).toFixed(2)})`)
        const head = heightRange(b, HEAD)
        if (who !== 'procedural' && (head.lo > 0.06 || head.lo < -SINK_HEAD)) bad.push(`${label}: the head's lowest point is at ${head.lo.toFixed(3)}`)
        // the hands are over the head (toward -d beyond the crown), the wrists a hand's breadth over the pad or less
        for (const [hand, arm] of [[P.handL, LEFT_ARM], [P.handR, RIGHT_ARM]] as const) {
          const j = p.joint(hand)
          if (j[2] > -0.7 * scale) bad.push(`${label}: a hand is at d ${j[2].toFixed(2)} (not over the head)`)
          if (j[1] > 0.14 || j[1] < -0.04) bad.push(`${label}: a wrist is ${j[1].toFixed(3)} over the pad`)
          if (heightRange(b, arm).lo < -SINK) bad.push(`${label}: an arm is in the pad`)
        }
        // both knees lie on the pad: the shin joints are at the thigh-shin line's height or higher (they bow up, not into the pad)
        for (const [thigh, shin, foot] of [[P.thighL, P.shinL, P.footL], [P.thighR, P.shinR, P.footR]] as const) {
          const hip = p.joint(thigh)
          const knee = p.joint(shin)
          const ankle = p.joint(foot)
          const mid = (hip[1] + ankle[1]) / 2
          if (knee[1] < mid - 0.005) bad.push(`${label}: a knee bows into the pad (${knee[1].toFixed(3)} under the hip-ankle line at ${mid.toFixed(3)})`)
          if (ankle[1] > 0.14 || ankle[1] < 0) bad.push(`${label}: an ankle is ${ankle[1].toFixed(3)} over the pad`)
        }
        // the feet trail plantar-flexed: the foot's axis (its local forward) points down-ish and toward the feet
        const fm = p.out.slice(P.footL * 12, P.footL * 12 + 12)
        const toes: V3 = [fm[2], fm[6], fm[10]]
        if (toes[2] < 0.3) bad.push(`${label}: the foot is not plantar-flexed (toes ${toes.map((x) => x.toFixed(2)).join(',')})`)
      }
    }
    expect(bad).toEqual([])
  }, 240000)

  it('the chest faces down and the back is up: the chest\'s facing is -h, the pelvis lies on the centre line', async () => {
    for (const who of WHO) {
      const p = await settled(who, 'cryo', POSES.prone)
      const cm = p.out.slice(P.chest * 12, P.chest * 12 + 12)
      // the chest's forward axis (column 2): down; its up axis (column 1): toward the head (-d)
      expect(cm[6] / Math.hypot(cm[2], cm[6], cm[10]), NAME(who)).toBeLessThan(-0.9)
      expect(cm[9] / Math.hypot(cm[1], cm[5], cm[9]), NAME(who)).toBeLessThan(-0.9)
      const pel = p.joint(P.pelvis)
      expect(Math.abs(pel[0]), NAME(who)).toBeLessThan(0.02)
      expect(Math.abs(pel[2]), NAME(who)).toBeLessThan(0.02)
    }
  })
})

describe('on the side: the left flank up toward the robot, the legs stacked', () => {
  it('rolled by OBLIQUE_RAD: the left shoulder and hip are above the right, the left arm rests higher than the right, the upper leg rides on the lower one', async () => {
    const bad: string[] = []
    for (const who of WHO) {
      for (const scale of SCALES) {
        const p = await settled(who, 'cryo', POSES.oblique, scale)
        const label = `${NAME(who)} ${scale}`
        const lh = p.joint(P.armL)
        const rh = p.joint(P.armR)
        if (lh[1] - rh[1] < 0.18 * scale) bad.push(`${label}: the left shoulder is only ${(lh[1] - rh[1]).toFixed(3)} over the right`)
        const lw = p.joint(P.handL)
        const rw = p.joint(P.handR)
        if (lw[1] - rw[1] < 0.08) bad.push(`${label}: the left hand is only ${(lw[1] - rw[1]).toFixed(3)} over the right`)
        const la = p.joint(P.footL)
        const ra = p.joint(P.footR)
        if (la[1] - ra[1] < 0.08 * scale || la[1] - ra[1] > ROLL_LEGS.stack * scale + 0.03) bad.push(`${label}: the legs are ${(la[1] - ra[1]).toFixed(3)} apart in height (the upper one rides on the lower)`)
        // the shoulders are still along the table: the roll is about its long axis
        if (Math.abs(lh[2] - rh[2]) > 0.05) bad.push(`${label}: the shoulders are ${(lh[2] - rh[2]).toFixed(3)} apart along the table`)
        // the left side is north (+x of the table's frame when supine) and the back faces it: the chest's back (-forward axis) points to +x
        const cm = p.out.slice(P.chest * 12, P.chest * 12 + 12)
        const f: V3 = [cm[2], cm[6], cm[10]]
        const fl = Math.hypot(...f)
        // the face looks toward the table's -x (the patient's right, south) and a little up, the back toward the robot
        if (f[0] / fl > -0.6) bad.push(`${label}: the chest does not face the table's -x side (${(f[0] / fl).toFixed(2)})`)
        // the roll angle itself: the chest's forward axis is rotated by OBLIQUE_RAD from straight up
        const ang = Math.atan2(-f[0] / fl, f[1] / fl)
        if (Math.abs(ang - OBLIQUE_RAD) > 0.08) bad.push(`${label}: the roll is ${((ang * 180) / Math.PI).toFixed(1)} degrees`)
      }
    }
    expect(bad).toEqual([])
  }, 240000)
})

describe('one arm up: the ProSense patient', () => {
  it('on the couch: the treated (left) hand behind the head, the other arm along the side, the body rolled slightly (the left up) by the wedge', async () => {
    const bad: string[] = []
    for (const who of WHO) {
      for (const scale of SCALES) {
        const p = await settled(who, 'us', POSES.one, scale)
        const label = `${NAME(who)} ${scale}`
        const lw = p.joint(P.handL)
        const rw = p.joint(P.handR)
        // the left hand behind the head (toward -d beyond the shoulder line), the right at the side (about the hip), far from it
        if (lw[2] > -0.65 * scale) bad.push(`${label}: the raised hand is at d ${lw[2].toFixed(2)}`)
        if (Math.abs(rw[2]) > 0.3 || rw[1] > 0.12) bad.push(`${label}: the other hand is at d ${rw[2].toFixed(2)}, h ${rw[1].toFixed(3)}`)
        if (Math.abs(rw[0]) < 0.17) bad.push(`${label}: the other hand is ${rw[0].toFixed(2)} across: not at the side`)
        // the 8 degree wedge lifts the left shoulder over the right
        const lh = p.joint(P.armL)
        const rh = p.joint(P.armR)
        if (lh[1] - rh[1] < 0.02 || lh[1] - rh[1] > 0.12) bad.push(`${label}: the left shoulder is ${(lh[1] - rh[1]).toFixed(3)} over the right`)
        // the couch's patient is face up: the chest faces up
        const cm = p.out.slice(P.chest * 12, P.chest * 12 + 12)
        if (cm[6] / Math.hypot(cm[2], cm[6], cm[10]) < 0.97) bad.push(`${label}: the chest does not face up`)
      }
    }
    expect(bad).toEqual([])
  }, 240000)

  it('the treated side follows the wedge: a roll that lifts the right (+) raises the right arm, none or the left raises the left', async () => {
    expect(oneUpSide({ rollDeg: -8 })).toBe(1)
    expect(oneUpSide({ rollDeg: 0 })).toBe(1)
    expect(oneUpSide({ rollDeg: 8 })).toBe(-1)
    const p = await settled(AVATARS[1], 'us', { position: 'supine', arms: 'oneUp', rollDeg: 8 })
    expect(p.joint(P.handR)[2]).toBeLessThan(-0.6)
    expect(p.joint(P.handL)[2]).toBeGreaterThan(-0.3)
  })

  it('the wedge rolls the body: -8 lifts the left side, +8 the right, 0 is flat', async () => {
    const a = await settled(AVATARS[2], 'us', { position: 'supine', arms: 'out', rollDeg: -8 })
    const b = await settled(AVATARS[2], 'us', { position: 'supine', arms: 'out', rollDeg: 8 })
    const c = await settled(AVATARS[2], 'us', { position: 'supine', arms: 'out', rollDeg: 0 })
    const lr = (p: TestPatient): number => p.joint(P.armL)[1] - p.joint(P.armR)[1]
    expect(lr(a)).toBeGreaterThan(lr(c) + 0.03)
    expect(lr(b)).toBeLessThan(lr(c) - 0.03)
  })
})

describe('the CT bore: every body fits through the gantry', () => {
  // the bore liner's inner radius about the axis (CT.centreY above the floor; the table top is CRYO_SUITE.ct.table.height): the table goes IN, the whole patient is in the tunnel or at its face
  const AXIS = CT.centreY - CRYO_SUITE.ct.table.height
  it('the supine, prone and oblique patients with the arms above the head, at every avatar and size, lie inside the liner (the table at its top: the rows ride the table, so tablePos does not change the fit)', async () => {
    const bad: string[] = []
    let worst = 0
    for (const who of WHO) {
      if (who === 'procedural') continue
      for (const scale of SCALES) {
        for (const name of ['supine', 'prone', 'oblique']) {
          const p = await settled(who, 'cryo', POSES[name], scale)
          const b = p.skin()
          // the hair, the coat and the dress of the two garment bodies reach out: the people who lie there are the gowned four (and the tests of every pose hold the others to the pad)
          if (GARMENT.includes(who.id)) continue
          let r = 0
          for (let i = 0; i < b.count; i++) r = Math.max(r, Math.hypot(b.v[i * 3], b.v[i * 3 + 1] - AXIS))
          worst = Math.max(worst, r)
          if (r > CT.linerIn) bad.push(`${who.id} ${scale} ${name}: ${r.toFixed(3)} from the axis (liner ${CT.linerIn})`)
        }
      }
    }
    expect(bad).toEqual([])
    expect(worst).toBeGreaterThan(0.25)
  }, 240000)
})

describe('the turn: a roll over the pad, nothing through it', () => {
  async function sweep(who: (typeof WHO)[number], from: Partial<PatientPoseView>, to: Partial<PatientPoseView>, seconds: number): Promise<{ lo: number; torso: number; jump: number; frames: number; psi: number[] }> {
    const p = await settled(who, 'cryo', from)
    p.setPose(to)
    const prev = new Float64Array(PART_COUNT * 3)
    const read = (): void => {
      for (let q = 0; q < P.prop; q++) {
        const j = p.joint(q)
        prev[q * 3] = j[0]
        prev[q * 3 + 1] = j[1]
        prev[q * 3 + 2] = j[2]
      }
    }
    read()
    let lo = Infinity
    let torso = Infinity
    let jump = 0
    const psi: number[] = []
    const frames = Math.round(seconds * 60)
    for (let f = 0; f < frames; f++) {
      p.run(1)
      for (let q = 0; q < P.prop; q++) {
        if (q === P.skirt || q === P.hairCap || q === P.hairBack || q === P.hairFront) continue
        const j = p.joint(q)
        jump = Math.max(jump, Math.hypot(j[0] - prev[q * 3], j[1] - prev[q * 3 + 1], j[2] - prev[q * 3 + 2]))
        prev[q * 3] = j[0]
        prev[q * 3 + 1] = j[1]
        prev[q * 3 + 2] = j[2]
      }
      if (f % 10 === 0) {
        const b = p.skin()
        lo = Math.min(lo, heightRange(b, BODY_PARTS).lo)
        torso = Math.min(torso, heightRange(b, TORSO).lo)
        psi.push(p.rig.tbl.psi)
      }
    }
    return { lo, torso, jump, frames, psi }
  }

  it('supine to prone and back, arms over the head: no vertex goes deeper into the pad than at rest, no joint jumps more than 3 cm in a frame, the roll passes through the side', async () => {
    const bad: string[] = []
    for (const who of WHO) {
      const proc = who === 'procedural'
      const limit = proc ? SINK_PROC + 0.06 : SINK_HEAD
      const down = await sweep(who, { position: 'supine', arms: 'aboveHead' }, { position: 'prone', arms: 'aboveHead' }, 8)
      const up = await sweep(who, { position: 'prone', arms: 'aboveHead' }, { position: 'supine', arms: 'aboveHead' }, 8)
      for (const [name, r] of [['turn onto the front', down], ['turn back', up]] as const) {
        if (r.lo < -limit) bad.push(`${NAME(who)} ${name}: a vertex is ${(-r.lo).toFixed(3)} under the pad`)
        if (r.torso < -(proc ? SINK_PROC + 0.02 : SINK)) bad.push(`${NAME(who)} ${name}: the torso is ${(-r.torso).toFixed(3)} under the pad`)
        if (r.jump > 0.03) bad.push(`${NAME(who)} ${name}: a joint jumps ${(r.jump * 100).toFixed(1)} cm in a frame`)
        // the roll goes through the side (psi = pi / 2) and ends at the half turn
        expect(Math.max(...r.psi), `${NAME(who)} ${name}`).toBeGreaterThan(3.1)
      }
    }
    expect(bad).toEqual([])
  }, 480000)

  it('supine to the side and back: the same, and it settles at the oblique roll (about 3 seconds for 95 %)', async () => {
    const bad: string[] = []
    for (const who of WHO) {
      const proc = who === 'procedural'
      const r = await sweep(who, { position: 'supine', arms: 'aboveHead' }, { position: 'obliqueLeftUp', arms: 'aboveHead' }, 8)
      if (r.lo < -(proc ? SINK_PROC + 0.06 : SINK_HEAD)) bad.push(`${NAME(who)}: a vertex is ${(-r.lo).toFixed(3)} under the pad`)
      if (r.jump > 0.03) bad.push(`${NAME(who)}: a joint jumps ${(r.jump * 100).toFixed(1)} cm in a frame`)
      expect(r.psi[r.psi.length - 1], NAME(who)).toBeCloseTo(OBLIQUE_RAD, 2)
    }
    expect(bad).toEqual([])
  }, 480000)

  it('the roll follows a critically damped follower: half done at about 0.7 s, 95 % at about 3 s, never over the end', async () => {
    const p = await settled('procedural', 'cryo', { position: 'supine', arms: 'out' })
    p.setPose({ position: 'prone', arms: 'out' })
    const psi: number[] = []
    for (let f = 0; f < 360; f++) {
      p.run(1)
      psi.push(p.rig.tbl.psi / Math.PI)
    }
    const w = 1.6
    for (const sec of [0.5, 1, 2, 3]) {
      const want = 1 - (1 + w * sec) * Math.exp(-w * sec)
      expect(psi[Math.round(sec * 60) - 1]).toBeCloseTo(want, 2)
    }
    expect(Math.max(...psi)).toBeLessThanOrEqual(1 + 1e-9)
    expect(psi[179]).toBeGreaterThan(0.93)
    expect(psi[179]).toBeLessThan(0.97)
  })
})

describe('snaps, determinism and everybody else', () => {
  it('a warm start places the patient at once; a pose change swings; the same pose and time give the same skeleton, bit for bit; another history converges', async () => {
    for (const who of [WHO[0], WHO[2], WHO[9]]) {
      const swing = await TestPatient.make(who, 'cryo')
      swing.setPose(POSES.prone)
      swing.run(2)
      // two frames into the turn the body is still nearly face up
      expect(swing.rig.tbl.psi, NAME(who)).toBeLessThan(0.1)
      const snap = await TestPatient.make(who, 'cryo')
      snap.setPose(POSES.prone)
      snap.snap(3)
      expect(snap.rig.tbl.psi, NAME(who)).toBeCloseTo(Math.PI, 6)
    }
    const a = await TestPatient.make(AVATARS[3], 'cryo')
    const b = await TestPatient.make(AVATARS[3], 'cryo')
    for (const p of [a, b]) {
      p.setPose(POSES.prone)
      p.run(400)
    }
    expect(Array.from(a.out)).toEqual(Array.from(b.out))
    // another history (the side first, then face down) converges within a few seconds
    const c = await TestPatient.make(AVATARS[3], 'cryo')
    c.setPose(POSES.oblique)
    c.run(100)
    c.setPose(POSES.prone)
    c.t = a.t - 600 / 60
    c.run(600)
    const d = await TestPatient.make(AVATARS[3], 'cryo')
    d.setPose(POSES.prone)
    d.t = a.t - 600 / 60
    d.run(600)
    for (const part of [P.pelvis, P.head, P.footL, P.footR, P.handL, P.handR, P.shinL]) expect(dist(c.joint(part), d.joint(part)), `part ${part}`).toBeLessThan(0.005)
  })

  it('when the pose goes the body rolls back, the arms come down and the legs settle (no pop), and then the person is solved exactly as any other lying person', async () => {
    const who = AVATARS[1]
    const p = await settled(who, 'cryo', POSES.prone)
    p.setPose(null)
    p.run(600)
    expect(p.rig.tbl.on).toBe(false)
    expect(p.rig.tbl.psi).toBe(0)
    const plain = await TestPatient.make(who, 'cryo')
    plain.run(600 + 34)
    for (let part = 0; part < PART_COUNT; part++) for (let k = 0; k < 12; k++) expect(Math.abs(p.out[part * 12 + k] - plain.out[part * 12 + k]), `part ${part} [${k}]`).toBeLessThan(2e-3)
  })

  it('a supine, arms-out pose changes nothing but the carrying: the body is the plain lying body (the pelvis does not sway), on both tables', async () => {
    for (const table of ['cryo', 'us'] as const) {
      for (const who of [WHO[0], WHO[1], WHO[9]]) {
        const plain = await TestPatient.make(who, table)
        const posed = await TestPatient.make(who, table)
        posed.setPose({ position: 'supine', arms: 'out' })
        plain.run(200)
        posed.run(200)
        for (let part = 0; part < P.prop; part++) {
          if (part === P.skirt) continue
          expect(dist(plain.joint(part), posed.joint(part)), `${NAME(who)} part ${part}`).toBeLessThan(0.03)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// the model: seats, the pose and the probe
// ---------------------------------------------------------------------------------------------

function ent(o: Partial<Entity> & { id: string }): Entity {
  return { role: 'patient', outfit: 'gown', name: o.id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'lie', emote: 'none', mood: 'neutral', tier: 'near', variant: 3, ...o } as Entity
}

const POSE: PatientPoseView = { position: 'prone', headTiltDeg: 0, rollDeg: 0, arms: 'aboveHead', airway: 'none', awareness: 'asleep', prep: 0, drape: 0, marks: 'none', catheter: false, manipulator: false }

function frame(entities: Map<string, Entity>, t: number): FrameInput {
  return { dt: 1 / 60, time: t, camX: -49.2, camY: 6.2, camZ: 8, entities, followId: null, selectedId: null, hoverId: null, driven: null }
}

function runModel(m: CrowdModel, es: Map<string, Entity>, frames: number, t0 = 0): void {
  for (let i = 0; i < frames; i++) m.update(frame(es, t0 + i / 60))
}

/** The origin of a part of a (procedural: no binds) person's row in the drawn frame: the row is in the root frame, turned by the heading the shader applies. */
function modelPart(m: CrowdModel, key: string, part: number): V3 {
  const p = m.get(key)!
  const o = p.row * ROW_FLOATS + TEX.parts * 4 + part * 12
  const lx = m.data[o + 3]
  const lz = m.data[o + 11]
  const s = Math.sin(p.heading)
  const c = Math.cos(p.heading)
  return [c * lx + s * lz + p.x, m.data[o + 7] + p.y, -s * lx + c * lz + p.z]
}

describe('the crowd model', () => {
  const shownBefore = { shown: levelView.shown, overview: levelView.overview }

  const CRYO = CRYO_SUITE.ct.table
  const US = IMAGING.us.table
  const cryoEntity = (id: string, patientPose: PatientPoseView | null): Entity => ent({ id, seated: { seatId: 'scanTable:cryo', pose: 'lie' }, position: { x: CRYO.out.x, y: 0, z: CRYO.out.z }, heading: CRYO.heading, patientPose })
  const usEntity = (id: string, patientPose: PatientPoseView | null): Entity => ent({ id, seated: { seatId: 'usCouch:us', pose: 'lie' }, position: { x: US.out.x, y: 0, z: US.out.z }, heading: US.heading, patientPose })

  it('a patient on the CT cryo table with a pose is laid as it says, in the level\'s drawn frame; the body rides the table (the entity\'s position) and goes where tablePos takes the entity', () => {
    levelView.shown = 2
    levelView.overview = false
    try {
      const flat = new CrowdModel()
      const prone = new CrowdModel()
      runModel(flat, new Map([['pat', cryoEntity('pat', null)]]), 400)
      runModel(prone, new Map([['pat', cryoEntity('pat', POSE)]]), 400)
      // the head toward the west (heading +pi/2: the table's -d is west): the head is west of the pelvis in both, face down in one: the head is lower than the face-up one's
      const ph = modelPart(prone, 'pat', P.head)
      const pp = modelPart(prone, 'pat', P.pelvis)
      expect(ph[0]).toBeLessThan(pp[0] - 0.4)
      // the hands over the head (west of it)
      expect(modelPart(prone, 'pat', P.handL)[0]).toBeLessThan(ph[0] - 0.05)
      expect(prone.get('pat')!.rig.tbl.on).toBe(true)
      expect(prone.get('pat')!.rig.tbl.psi).toBeCloseTo(Math.PI, 3)
      expect(flat.get('pat')!.rig.tbl.on).toBe(false)
      // the table's travel: the entity moves 2.55 m toward the bore; the body goes with it exactly (the crowd draws the root where the entity is)
      const es = new Map([['pat', cryoEntity('pat', POSE)]])
      const before = modelPart(prone, 'pat', P.pelvis)
      es.get('pat')!.position.x += CRYO.in.x - CRYO.out.x
      runModel(prone, es, 120, 400 / 60)
      const after = modelPart(prone, 'pat', P.pelvis)
      expect(after[0] - before[0]).toBeCloseTo(CRYO.in.x - CRYO.out.x, 1)
      expect(Math.abs(after[1] - before[1])).toBeLessThan(0.01)
    } finally {
      levelView.shown = shownBefore.shown
      levelView.overview = shownBefore.overview
    }
  })

  it('a patient on the ultrasound couch with the arm up and the wedge: the left hand is behind the head (south of the body), the body rolled', () => {
    levelView.shown = 1
    levelView.overview = false
    try {
      const m = new CrowdModel()
      const pose = { ...POSE, position: 'supine' as const, arms: 'oneUp' as const, rollDeg: -8 }
      runModel(m, new Map([['pat', usEntity('pat', pose)]]), 400)
      const l = modelPart(m, 'pat', P.handL)
      const r = modelPart(m, 'pat', P.handR)
      const pel = modelPart(m, 'pat', P.pelvis)
      // heading pi: the head is +z (south): the raised left hand is south of the pelvis, the right beside the hip
      expect(l[2]).toBeGreaterThan(pel[2] + 0.6)
      expect(Math.abs(r[2] - pel[2])).toBeLessThan(0.3)
      // the patient's left is west (-x) on this couch: the raised hand is west of the body's middle
      expect(l[0]).toBeLessThan(pel[0])
    } finally {
      levelView.shown = shownBefore.shown
      levelView.overview = shownBefore.overview
    }
  })

  it('every other seat renders exactly as without the pose, whatever the pose says: the diagnostic scanners\' tables, beds, trolleys, stretchers (and no seat)', () => {
    const seats: [string, Partial<Entity>][] = [
      ['ct table', { seated: { seatId: 'scanTable:ct', pose: 'lie' } }],
      ['mri table', { seated: { seatId: 'scanTable:mri', pose: 'lie' } }],
      ['xray table', { seated: { seatId: 'xrayTable:xray', pose: 'lie' } }],
      ['ward bed', { seated: { seatId: 'bed:A1', pose: 'lie' } }],
      ['trolley', { seated: { seatId: 'surgeryBed:preop:0', pose: 'lie' } }],
      ['stretcher', { riding: true, vehicle: 'stretcher' }],
      ['no seat', {}],
    ]
    for (const [name, more] of seats) {
      const posed = new CrowdModel()
      const plain = new CrowdModel()
      const at = { x: CRYO.out.x, y: 0, z: CRYO.out.z }
      runModel(posed, new Map([['pat', ent({ id: 'pat', position: at, patientPose: POSE, ...more })]]), 200)
      runModel(plain, new Map([['pat', ent({ id: 'pat', position: at, ...more })]]), 200)
      const o = (m: CrowdModel): number[] => {
        const p = m.get('pat')!
        const s = p.row * ROW_FLOATS + TEX.parts * 4
        return Array.from(m.data.subarray(s, s + PART_COUNT * 12))
      }
      expect(o(posed), name).toEqual(o(plain))
      expect(posed.get('pat')!.rig.tbl.on, name).toBe(false)
    }
  })

  it('the probe can force a pose on the CT table and the couch (forcePatient) and give the patient back (null)', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = new CrowdModel()
    const es = new Map([['pat', cryoEntity('pat', null)]])
    runModel(m, es, 200)
    const flat = modelPart(m, 'pat', P.head)
    m.forcePatient('pat', { position: 'prone', arms: 'aboveHead' })
    runModel(m, es, 400, 200 / 60)
    expect(m.get('pat')!.rig.tbl.on).toBe(true)
    expect(m.get('pat')!.rig.tbl.psi).toBeCloseTo(Math.PI, 2)
    const forced = modelPart(m, 'pat', P.head)
    expect(forced[1]).not.toBeCloseTo(flat[1], 2)
    m.forcePatient('pat', null)
    runModel(m, es, 700, 600 / 60)
    expect(m.get('pat')!.rig.tbl.on).toBe(false)
    expect(dist(modelPart(m, 'pat', P.head), flat)).toBeLessThan(0.02)
    // the couch too (level 1)
    levelView.shown = 1
    const c = new CrowdModel()
    const us = new Map([['pat', usEntity('pat', null)]])
    runModel(c, us, 200)
    c.forcePatient('pat', { position: 'supine', arms: 'oneUp', rollDeg: -8 })
    // (the arm follower is 95 % there in 4.3 s: tablePatient.ts ARM_OMEGA)
    runModel(c, us, 600, 200 / 60)
    expect(c.get('pat')!.rig.tbl.on).toBe(true)
    expect(c.get('pat')!.rig.tbl.st[10]).toBeGreaterThan(0.99)
    expect(TABLES.us.top).toBe(IMAGING.us.table.height)
    levelView.shown = shownBefore.shown
    levelView.overview = shownBefore.overview
  })
})
