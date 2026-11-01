/**
 * R5 wave 3 (P11, P12): a patient's arms through every positioning transition of the five table scripts (cryo-kidney, cryo-lung, cryo-liver on the CT table, us-breastCancer and
 * us-fibroadenoma on the couch), solved by the rig (rig.ts `placeArms`, `solveArmReach`) and read frame by frame at 60 Hz on the procedural body and the realistic avatars:
 *   - no joint of the body moves more than 3 cm in a frame (the arm flew 0.6 to 1.0 m: the pitch of a raised arm wraps at +-pi and the twist at +-pi while the angles are mixed
 *     with the lying pose's by the follower, so a wrap crossed mid-mix swung the arm, or the forearm round it, to the other side in one frame);
 *   - and no VERTEX of the upper arms, forearms and hands moves more than 3 cm in a frame either (the joints are not the skin: the solved arm's twist was blended from the lying pose's
 *     in about ten frames at the start of every arms-up turn, so the forearm and the hand rolled about the arm's own axis at 0.25 to 0.36 radians a frame, 3.1 to 4.1 cm a frame at the
 *     fingers and the upper arm, while the joints moved 1.3 cm; the elbow now swings round the shoulder-to-hand line from the lying arm's side over the first part of the sweep);
 *   - the raised arm of the ProSense patient keeps its side while it comes down (the pose going null re-read the side as the left);
 *   - tucked arms follow the roll: face down the patient's left hand is on the table's -x (it crossed to the right hand's place);
 *   - the forearms, hands and elbows stay above the pad through every turn (P11 again: the first fix swept the raised arms through the chest's front, which face down is the table: wrists
 *     37 to 49 cm under the pad for 3 to 4 s of each turn; the hand now slides over the pad in the table's frame, round the shoulder);
 *   - and the wrap helper itself.
 */
import { describe, expect, it } from 'vitest'
import { COMPILED_SCRIPTS } from '@/sim/procedure/script'
import type { PatientPoseView, ProcedureId } from '@/sim/types'
import { P, PART_COUNT } from './constants'
import { ARM_L, ARM_R } from './pose'
import { AVATARS, TestPatient, heightRange, type ProcTableId } from './procTable.testkit'
import { ARM_SWEEP, unwrapNear } from './tablePatient'

const SCRIPTS: readonly { id: ProcedureId; table: ProcTableId }[] = [
  { id: 'cryo-kidney', table: 'cryo' },
  { id: 'cryo-lung', table: 'cryo' },
  { id: 'cryo-liver', table: 'cryo' },
  { id: 'us-breastCancer', table: 'us' },
  { id: 'us-fibroadenoma', table: 'us' },
]
const WHO = ['procedural', AVATARS[0], AVATARS[3], AVATARS[8]] as const
const SCALES = [0.94, 1.06]
const SKIP = new Set<number>([P.skirt, P.hairCap, P.hairBack, P.hairFront])

/** The poses of a script that change how the patient lies (position, arms, the wedge), in order, from its start. */
function lyingPoses(id: ProcedureId): Partial<PatientPoseView>[] {
  const cs = COMPILED_SCRIPTS[id]!
  const out: Partial<PatientPoseView>[] = []
  let last = ''
  const push = (p: PatientPoseView): void => {
    const key = `${p.position}/${p.arms}/${p.rollDeg}`
    if (key === last) return
    last = key
    out.push({ position: p.position, arms: p.arms, rollDeg: p.rollDeg, headTiltDeg: p.headTiltDeg })
  }
  push(cs.script.start)
  for (const p of cs.poseAfter) push(p)
  return out
}

/** The largest step any joint takes in one frame while the patient moves to `to` (run `seconds`), and which joint, and the hand's table x at the end. */
async function sweep(who: (typeof WHO)[number], table: ProcTableId, scale: number, from: Partial<PatientPoseView>, to: Partial<PatientPoseView>, seconds = 8): Promise<{ step: number; part: number; frame: number }> {
  const p = await TestPatient.make(who, table, scale)
  p.setPose(from)
  p.snap(4)
  p.run(30)
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
  let step = 0
  let part = -1
  let frame = -1
  const frames = Math.round(seconds * 60)
  for (let f = 0; f < frames; f++) {
    p.run(1)
    for (let q = 0; q < P.prop; q++) {
      if (SKIP.has(q)) continue
      const j = p.joint(q)
      const d = Math.hypot(j[0] - prev[q * 3], j[1] - prev[q * 3 + 1], j[2] - prev[q * 3 + 2])
      if (d > step) {
        step = d
        part = q
        frame = f
      }
      prev[q * 3] = j[0]
      prev[q * 3 + 1] = j[1]
      prev[q * 3 + 2] = j[2]
    }
  }
  return { step, part, frame }
}

describe('no joint moves more than 3 cm in a frame through any positioning transition of the five scripts', () => {
  for (const { id, table } of SCRIPTS) {
    it(`${id}: every change of position, arms and wedge in its order (the procedural body and three avatars at three sizes)`, async () => {
      const poses = lyingPoses(id)
      expect(poses.length, `${id} has positioning transitions`).toBeGreaterThanOrEqual(3)
      const bad: string[] = []
      let worst = 0
      for (const who of WHO) {
        const name = who === 'procedural' ? who : who.id
        for (const scale of who === 'procedural' ? [1] : [1, ...SCALES]) {
          for (let i = 1; i < poses.length; i++) {
            const r = await sweep(who, table, scale, poses[i - 1], poses[i])
            worst = Math.max(worst, r.step)
            if (r.step > 0.03) bad.push(`${name} x${scale} ${poses[i - 1].position}/${poses[i - 1].arms} -> ${poses[i].position}/${poses[i].arms}: part ${r.part} moves ${(r.step * 100).toFixed(1)} cm in frame ${r.frame}`)
          }
        }
      }
      expect(bad.slice(0, 10)).toEqual([])
      // the control: the bodies really do move (the largest step is a centimetre or more: not a frozen rig)
      expect(worst).toBeGreaterThan(0.01)
    }, 480000)
  }

  it('the transitions the scripts do not use but a day can reach: the side to face down, face down to the side, one arm up to the arms over the head and back', async () => {
    const bad: string[] = []
    const legs: [Partial<PatientPoseView>, Partial<PatientPoseView>][] = [
      [{ position: 'obliqueLeftUp', arms: 'aboveHead' }, { position: 'prone', arms: 'aboveHead' }],
      [{ position: 'prone', arms: 'aboveHead' }, { position: 'obliqueLeftUp', arms: 'aboveHead' }],
      [{ position: 'supine', arms: 'oneUp', rollDeg: -8 }, { position: 'supine', arms: 'aboveHead', rollDeg: 0 }],
      [{ position: 'supine', arms: 'aboveHead' }, { position: 'supine', arms: 'oneUp', rollDeg: -8 }],
      [{ position: 'supine', arms: 'oneUp', rollDeg: 8 }, { position: 'supine', arms: 'out', rollDeg: 0 }],
      [{ position: 'prone', arms: 'tucked' }, { position: 'supine', arms: 'out' }],
    ]
    for (const who of WHO) {
      for (const [a, b] of legs) {
        const r = await sweep(who, 'cryo', 1, a, b)
        if (r.step > 0.03) bad.push(`${who === 'procedural' ? who : who.id} ${a.position}/${a.arms} -> ${b.position}/${b.arms}: part ${r.part} moves ${(r.step * 100).toFixed(1)} cm in frame ${r.frame}`)
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
  }, 480000)
})

describe('the raised arm keeps its side (P12 a)', () => {
  it('the right arm up for a right-sided procedure (the wedge lifts the other side): when the pose goes away it comes DOWN on the right, the left arm never goes up in its place, and no joint jumps', async () => {
    for (const who of WHO) {
      const name = who === 'procedural' ? who : who.id
      const p = await TestPatient.make(who, 'us')
      p.setPose({ position: 'supine', arms: 'oneUp', rollDeg: 8 })
      p.snap(4)
      p.run(60)
      // the right arm (the patient's right is the table's -x for a supine patient) is up behind the head: its hand is well above the pad, the left's is by the side
      const upRight = p.joint(P.handR)
      const sideLeft = p.joint(P.handL)
      expect(upRight[1], `${name} the right hand is up`).toBeGreaterThan(0.07)
      expect(upRight[2], `${name} the right hand is behind the head`).toBeLessThan(-0.6)
      expect(sideLeft[2], `${name} the left hand is by the side`).toBeGreaterThan(-0.3)
      // the pose goes away (the sim cleared the view): the view reads as no pose, whose side is the left's
      p.setPose(null)
      const prev = new Float64Array(PART_COUNT * 3)
      for (let q = 0; q < P.prop; q++) prev.set(p.joint(q), q * 3)
      let jump = 0
      let leftUp = -Infinity
      for (let f = 0; f < 300; f++) {
        p.run(1)
        for (let q = 0; q < P.prop; q++) {
          if (SKIP.has(q)) continue
          const j = p.joint(q)
          jump = Math.max(jump, Math.hypot(j[0] - prev[q * 3], j[1] - prev[q * 3 + 1], j[2] - prev[q * 3 + 2]))
          prev.set(j, q * 3)
        }
        // the left hand stays where it was (by the side, beside the hip: z about 0.05): it does not follow the right arm's way over the head
        leftUp = Math.max(leftUp, -p.joint(P.handL)[2])
      }
      expect(jump, `${name} no joint jumps as the pose goes`).toBeLessThan(0.03)
      expect(leftUp, `${name} the left arm never goes over the head`).toBeLessThan(0.4)
    }
  }, 240000)

  it('one arm up for a left-sided procedure still raises the left arm, and a pose that asks for the other side switches to it while it is at rest', async () => {
    const p = await TestPatient.make(AVATARS[3], 'us')
    p.setPose({ position: 'supine', arms: 'oneUp', rollDeg: -8 })
    p.snap(4)
    p.run(60)
    expect(p.rig.tbl.oneSide).toBe(1)
    expect(p.joint(P.handL)[2]).toBeLessThan(-0.6)
    p.setPose(null)
    p.run(900)
    expect(p.rig.tbl.on).toBe(false)
    p.setPose({ position: 'supine', arms: 'oneUp', rollDeg: 8 })
    p.run(5)
    expect(p.rig.tbl.oneSide).toBe(-1)
  })
})

describe('tucked arms follow the roll (P12 b)', () => {
  it('supine the left hand is on the table\'s +x (the patient\'s left) and the right on -x; face down they swap with the body (the left is on -x); on the side the hands are between: every body, three sizes', async () => {
    const bad: string[] = []
    for (const who of WHO) {
      for (const scale of who === 'procedural' ? [1] : [0.94, 1, 1.06]) {
        const name = `${who === 'procedural' ? who : who.id} x${scale}`
        const at = async (position: PatientPoseView['position']): Promise<{ l: number; r: number }> => {
          const p = await TestPatient.make(who, 'cryo', scale)
          p.setPose({ position, arms: 'tucked' })
          p.snap(4)
          p.run(240)
          return { l: p.joint(P.handL)[0], r: p.joint(P.handR)[0] }
        }
        const sup = await at('supine')
        const pro = await at('prone')
        if (!(sup.l > 0.1 && sup.r < -0.1)) bad.push(`${name} supine: hands at ${sup.l.toFixed(2)}, ${sup.r.toFixed(2)}`)
        if (!(pro.l < -0.1 && pro.r > 0.1)) bad.push(`${name} prone: hands at ${pro.l.toFixed(2)}, ${pro.r.toFixed(2)} (crossed to the wrong sides)`)
        // the arms are as far from the midline face down as face up
        if (Math.abs(Math.abs(pro.l) - Math.abs(sup.l)) > 0.12) bad.push(`${name}: the tucked hands are ${Math.abs(pro.l).toFixed(2)} from the midline face down but ${Math.abs(sup.l).toFixed(2)} face up`)
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
  }, 240000)
})

/** Every distinct change of how the patient lies in the five scripts, as (from, to) pairs of poses, with the table it is on. */
function scriptLegs(): { from: Partial<PatientPoseView>; to: Partial<PatientPoseView>; table: ProcTableId; label: string }[] {
  const out: { from: Partial<PatientPoseView>; to: Partial<PatientPoseView>; table: ProcTableId; label: string }[] = []
  const seen = new Set<string>()
  for (const { id, table } of SCRIPTS) {
    const poses = lyingPoses(id)
    for (let i = 1; i < poses.length; i++) {
      const a = poses[i - 1]
      const b = poses[i]
      const label = `${table} ${a.position}/${a.arms}/${a.rollDeg} -> ${b.position}/${b.arms}/${b.rollDeg}`
      if (seen.has(label)) continue
      seen.add(label)
      out.push({ from: a, to: b, table, label })
    }
  }
  return out
}

const FOREARMS_AND_HANDS = [P.foreL, P.handL, P.foreR, P.handR]
const ELBOWS_AND_WRISTS = [P.foreL, P.handL, P.foreR, P.handR]

describe('the forearms, hands and elbows stay above the pad through every turn of the five scripts (P11)', () => {
  it('every body (the procedural one and all the avatars at three sizes), every distinct change of position and arms the scripts make, frame by frame: no joint moves more than 3 cm in a frame; no wrist or elbow is more than 3 cm under the pad; no forearm or hand vertex is more than 6 cm under the pad (or under where the hand lies at rest, for the procedural body, which sinks into it), and none more than 3 cm under it for more than about two thirds of a second (a fingertip dips into the pad while the hand turns over at the very end of the arms coming down)', async () => {
    const legs = scriptLegs()
    // the turns that matter are all there: onto the front and back, onto the side and back, arms up and down
    const labels = legs.map((l) => l.label).join('\n')
    expect(labels).toMatch(/prone\/aboveHead/)
    expect(labels).toMatch(/obliqueLeftUp\/aboveHead/)
    expect(legs.length).toBeGreaterThanOrEqual(6)
    const bad: string[] = []
    const prev = new Float64Array(PART_COUNT * 3)
    let frames = 0
    let lowest = Infinity
    let lowestAt = ''
    for (const who of ['procedural', ...AVATARS] as const) {
      const name = who === 'procedural' ? who : who.id
      for (const scale of who === 'procedural' ? [1] : [0.94, 1, 1.06]) {
        for (const leg of legs) {
          const p = await TestPatient.make(who, leg.table, scale)
          p.setPose(leg.from)
          p.snap(4)
          p.run(30)
          const startLow = heightRange(p.skin(), FOREARMS_AND_HANDS).lo
          p.setPose(leg.to)
          let low = Infinity
          let lowJoint = Infinity
          let step = 0
          let stepPart = -1
          const lows: number[] = []
          for (let q = 0; q < P.prop; q++) prev.set(p.joint(q), q * 3)
          for (let f = 0; f < 420; f++) {
            p.run(1)
            frames++
            // (every joint of every body at every size: none moves more than 3 cm in a frame, as the first fix of P11 made sure of on three bodies)
            for (let q = 0; q < P.prop; q++) {
              if (SKIP.has(q)) continue
              const j = p.joint(q)
              const d = Math.hypot(j[0] - prev[q * 3], j[1] - prev[q * 3 + 1], j[2] - prev[q * 3 + 2])
              if (d > step) {
                step = d
                stepPart = q
              }
              prev.set(j, q * 3)
            }
            for (const q of ELBOWS_AND_WRISTS) lowJoint = Math.min(lowJoint, p.joint(q)[1])
            // (the skin is the heavy part: every third frame)
            if (f % 3 === 0) {
              const l = heightRange(p.skin(), FOREARMS_AND_HANDS).lo
              lows.push(l)
              low = Math.min(low, l)
            }
          }
          p.run(120)
          const endLow = heightRange(p.skin(), FOREARMS_AND_HANDS).lo
          // (where the pad is for this body: its top, or lower where the body's own rest sinks into it)
          const rest = Math.min(startLow, endLow, 0)
          const label = `${name} x${scale} ${leg.label}`
          if (step > 0.03) bad.push(`${label}: part ${stepPart} moves ${(step * 100).toFixed(1)} cm in a frame`)
          if (lowJoint < -0.03) bad.push(`${label}: a wrist or elbow goes ${(-lowJoint * 100).toFixed(1)} cm under the pad`)
          if (low < rest - 0.06) bad.push(`${label}: a forearm or hand vertex goes ${((rest - low) * 100).toFixed(1)} cm under the pad (${(rest * 100).toFixed(1)} cm at rest)`)
          const under = lows.filter((l) => l < rest - 0.03).length * 3
          if (under > 40) bad.push(`${label}: a forearm or hand vertex is more than 3 cm under the pad for ${under} frames`)
          if (low - rest < lowest) {
            lowest = low - rest
            lowestAt = label
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
    // the control: a real number of frames were read, and the metric is not blind (some frame of some turn is below its rest, if only by a few millimetres)
    expect(frames).toBeGreaterThan(40 * 6 * 400)
    expect(lowest, lowestAt).toBeLessThan(0.0005)
  }, 900000)

  it('the metric sees an arm through the pad: the roll alone with the arms out (which no script does: the arms go over the head as the body turns) takes a hand well under it', async () => {
    const p = await TestPatient.make(AVATARS[3], 'cryo')
    p.setPose({ position: 'supine', arms: 'out' })
    p.snap(4)
    p.run(30)
    p.setPose({ position: 'prone', arms: 'out' })
    let low = Infinity
    for (let f = 0; f < 420; f++) {
      p.run(1)
      low = Math.min(low, p.joint(P.handL)[1], p.joint(P.handR)[1])
    }
    expect(low).toBeLessThan(-0.1)
  })
})

/** The skin of the upper arms, forearms and hands (the vertices each of those parts has the most weight of): the parts the arms-up turns roll about the arm's own axis. */
const ARM_SKIN: readonly number[] = [P.armL, P.foreL, P.handL, P.armR, P.foreR, P.handR]
const ARM_SKIN_NAME: Record<number, string> = { [P.armL]: 'upper arm L', [P.foreL]: 'forearm L', [P.handL]: 'hand L', [P.armR]: 'upper arm R', [P.foreR]: 'forearm R', [P.handR]: 'hand R' }
/** The frames at the start of a turn (60 Hz) in which the shoulder's twist is read: the blend of the solve into the lying pose (frames 3 to 13) and the elbow's swing after it (the later twist is the roll's own). */
const TWIST_FRAMES = 40
const UP_LEGS = (leg: { to: Partial<PatientPoseView> }): boolean => leg.to.arms === 'aboveHead' || leg.to.arms === 'oneUp'

/**
 * The largest step any vertex of the arms' skin takes in one frame while the patient moves from `from` to `to` (`seconds` at 60 Hz), the frame, the part, and the largest turn the
 * solved twist of either shoulder takes in a frame over the first `TWIST_FRAMES` (radians; the angle itself, wrapped to the shortest way round).
 */
async function skinSweep(who: (typeof WHO)[number], table: ProcTableId, scale: number, from: Partial<PatientPoseView>, to: Partial<PatientPoseView>, seconds = 7): Promise<{ step: number; part: number; frame: number; twist: number }> {
  const p = await TestPatient.make(who, table, scale)
  p.setPose(from)
  p.snap(4)
  p.run(30)
  const s0 = p.skin()
  const ids: number[] = []
  for (let i = 0; i < s0.count; i++) if (ARM_SKIN.includes(s0.parts[i])) ids.push(i)
  expect(ids.length, 'the arms have skin').toBeGreaterThan(100)
  const prev = new Float32Array(ids.length * 3)
  const take = (v: Float32Array): void => {
    for (let k = 0; k < ids.length; k++) {
      prev[k * 3] = v[ids[k] * 3]
      prev[k * 3 + 1] = v[ids[k] * 3 + 1]
      prev[k * 3 + 2] = v[ids[k] * 3 + 2]
    }
  }
  take(s0.v)
  let twL = p.rig.up[ARM_L + 2]
  let twR = p.rig.up[ARM_R + 2]
  p.setPose(to)
  let step = 0
  let part = -1
  let frame = -1
  let twist = 0
  const frames = Math.round(seconds * 60)
  const TAU = 2 * Math.PI
  for (let f = 0; f < frames; f++) {
    p.run(1)
    const s = p.skin()
    for (let k = 0; k < ids.length; k++) {
      const v = ids[k] * 3
      const d = Math.hypot(s.v[v] - prev[k * 3], s.v[v + 1] - prev[k * 3 + 1], s.v[v + 2] - prev[k * 3 + 2])
      if (d > step) {
        step = d
        part = s.parts[ids[k]]
        frame = f
      }
    }
    take(s.v)
    if (f < TWIST_FRAMES) {
      for (const [cur, last] of [[p.rig.up[ARM_L + 2], twL], [p.rig.up[ARM_R + 2], twR]] as const) {
        let d = cur - last
        d -= TAU * Math.round(d / TAU)
        if (Math.abs(d) > twist) twist = Math.abs(d)
      }
    }
    twL = p.rig.up[ARM_L + 2]
    twR = p.rig.up[ARM_R + 2]
  }
  return { step, part, frame, twist }
}

describe('the skin of the arms moves at most 3 cm in a frame through every scripted turn (P11, the residual twitch)', () => {
  it('every body (the procedural one and all 14 avatars at three sizes), every distinct change of position, arms and wedge the five scripts make, frame by frame: no vertex of an upper arm, forearm or hand moves more than 3 cm in a frame, and the solved twist of a shoulder turns less than 0.2 radians in a frame through the first 40 frames of every turn (it turned 0.25 to 0.40; now 0.15 at most)', async () => {
    const legs = scriptLegs()
    expect(legs.filter(UP_LEGS).length, 'the arms-up turns of the scripts are in').toBeGreaterThanOrEqual(3)
    const bad: string[] = []
    let worst = 0
    let worstAt = ''
    let worstUp = 0
    let worstTwist = 0
    let sweeps = 0
    for (const who of ['procedural', ...AVATARS] as const) {
      const name = who === 'procedural' ? who : who.id
      for (const scale of who === 'procedural' ? [1] : [0.94, 1, 1.06]) {
        for (const leg of legs) {
          const r = await skinSweep(who, leg.table, scale, leg.from, leg.to)
          sweeps++
          const label = `${name} x${scale} ${leg.label}`
          if (r.step > worst) {
            worst = r.step
            worstAt = `${label}: ${ARM_SKIN_NAME[r.part]} in frame ${r.frame}`
          }
          if (UP_LEGS(leg)) {
            worstUp = Math.max(worstUp, r.step)
            worstTwist = Math.max(worstTwist, r.twist)
          }
          if (r.step > 0.03) bad.push(`${label}: a vertex of the ${ARM_SKIN_NAME[r.part]} moves ${(r.step * 100).toFixed(1)} cm in frame ${r.frame}`)
          if (r.twist > 0.2) bad.push(`${label}: a shoulder's twist turns ${r.twist.toFixed(2)} radians in a frame`)
        }
      }
    }
    console.log(`ARM SKIN: ${sweeps} sweeps, worst vertex step ${(worst * 100).toFixed(2)} cm (${worstAt}), worst in an arms-up turn ${(worstUp * 100).toFixed(2)} cm, worst twist ${worstTwist.toFixed(3)} rad a frame`)
    expect(bad.slice(0, 10)).toEqual([])
    // the controls: every body and leg was read, and the skin really does move (a frozen rig would pass); the arms-up turns are the ones that move the most
    expect(sweeps).toBeGreaterThanOrEqual((1 + 14 * 3) * legs.length)
    expect(worst).toBeGreaterThan(0.01)
    expect(worstUp).toBeGreaterThan(0.01)
  }, 900000)

  it('the elbow starts the sweep on the lying arm\'s own side: at the first frames of an arms-up turn the hand and the forearm have not left where the lying pose has them (the solve with the lying pole is the lying pose), and the swing is over before the hand has gone a quarter of the way', async () => {
    const p = await TestPatient.make(AVATARS[3], 'cryo')
    p.setPose({ position: 'supine', arms: 'out' })
    p.snap(4)
    p.run(30)
    const hand0 = p.joint(P.handL)
    const fore0 = p.joint(P.foreL)
    p.setPose({ position: 'prone', arms: 'aboveHead' })
    // (the followers' first frames: the solve is in force, and still the lying arm's)
    let drift = 0
    for (let f = 0; f < 6; f++) {
      p.run(1)
      const h = p.joint(P.handL)
      const e = p.joint(P.foreL)
      drift = Math.max(drift, Math.hypot(h[0] - hand0[0], h[1] - hand0[1], h[2] - hand0[2]), Math.hypot(e[0] - fore0[0], e[1] - fore0[1], e[2] - fore0[2]))
    }
    expect(drift, 'the hand and the elbow are where the lying arm had them (a few millimetres of the sweep and the roll)').toBeLessThan(0.02)
    // the swing is a constant of the sweep: it ends well inside it
    expect(ARM_SWEEP.swing).toBeGreaterThan(ARM_SWEEP.blend)
    expect(ARM_SWEEP.swing).toBeLessThanOrEqual(0.3)
    // the twist arrives where the solve puts it, whole, and stays: at rest over the head the arm is the solved one (the swing leaves nothing behind)
    p.run(600)
    const twist = p.rig.up[ARM_L + 2]
    expect(Number.isFinite(twist)).toBe(true)
    expect(Math.abs(twist), 'at rest the twist is the solve\'s, about a radian and more').toBeGreaterThan(0.5)
  })
})

describe('unwrapNear', () => {
  it('takes an angle on the branch nearest the reference, nearest zero for NaN, and never changes the angle itself (only by whole turns)', () => {
    const TAU = 2 * Math.PI
    expect(unwrapNear(3.1, 3.2)).toBeCloseTo(3.1, 12)
    expect(unwrapNear(-3.1, 3.2)).toBeCloseTo(-3.1 + TAU, 12)
    expect(unwrapNear(3.1, -3.2)).toBeCloseTo(3.1 - TAU, 12)
    expect(unwrapNear(4, NaN)).toBeCloseTo(4 - TAU, 12)
    expect(unwrapNear(-4, NaN)).toBeCloseTo(-4 + TAU, 12)
    for (const [a, r] of [[0.3, 10], [-2, 7], [5, -9], [3.14, -3.14]] as const) {
      const u = unwrapNear(a, r)
      expect(Math.abs(u - r)).toBeLessThanOrEqual(Math.PI + 1e-9)
      expect(Math.abs(Math.sin(u) - Math.sin(a)) + Math.abs(Math.cos(u) - Math.cos(a))).toBeLessThan(1e-9)
    }
  })
})
