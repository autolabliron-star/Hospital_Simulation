/**
 * W4: the three kiosk poses ('grip', 'finger', 'sitArmIn') through the real rig and the real hand-reach solve: which anims map to them, that the hands land
 * on the fixed points of armIn.ts for a short and a tall person and for every realistic avatar's own skeleton, that the arm lies inside the BP and
 * robot tunnel, that a person on the weighing platform is drawn 5 cm up, and that blending to and from them is smooth.
 */
import { describe, expect, it } from 'vitest'
import type { AnimState, Entity } from '@/sim/types'
import { MODES, MODE_COUNT, advanceBlend, blendTo, createBlender, isSeatedMode, modeFor, postureOf, weightSum, type Mode, type Posture } from './blend'
import { ARM_IN, FINGER, GRIP, KIOSK_SEAT_HEIGHT, armInPoint, armInTunnel } from './armIn'
import { NOMINAL_BODY, PART_COUNT, P, ROW_FLOATS, STAND_PELVIS, standPelvis, type BodyDims } from './constants'
import { CrowdModel, type FrameInput } from './model'
import { lookFor } from './outfit'
import { seatedReachY } from './pose'
import { createRig, makeInput, solveRig } from './rig'
import { readIndex } from './avatars.testkit'

type V3 = [number, number, number]

/** The middle of a hand in the root frame: the wrist plus the hand's own half length along the forearm (the part matrix's y axis, already scaled). */
function handCentre(out: Float32Array, part: number, hand: number): V3 {
  const b = part * 12
  return [out[b + 3] - hand * out[b + 1], out[b + 7] - hand * out[b + 5], out[b + 11] - hand * out[b + 9]]
}
const origin = (out: Float32Array, part: number): V3 => [out[part * 12 + 3], out[part * 12 + 7], out[part * 12 + 11]]
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

interface Pose {
  out: Float32Array
  rig: ReturnType<typeof createRig>
  body: Readonly<BodyDims>
  scale: number
}

/** Pose a person in `mode` for two seconds. `body` is their skeleton; with `own` the rig is told it (what rig.ts will do: see the change request). */
function pose(mode: Mode, o: { posture?: Posture; seat?: number; scale?: number; body?: Readonly<BodyDims>; own?: boolean; id?: string; seconds?: number }): Pose {
  const look = { ...lookFor({ id: o.id ?? 'kiosk-user', role: 'visitor', variant: 5 }) }
  look.scale = o.scale ?? 1
  const body = o.body ?? NOMINAL_BODY
  const rig = createRig(look, body)
  if (o.own) {
    rig.ctx.standPelvis = standPelvis(body)
    rig.ctx.seatedPelvis = body.seatedPelvis
  }
  const inp = makeInput()
  inp.mode = mode
  inp.posture = o.posture ?? 'stand'
  inp.seatHeight = o.seat ?? KIOSK_SEAT_HEIGHT
  const out = new Float32Array(PART_COUNT * 12)
  const frames = Math.round((o.seconds ?? 2) * 60)
  for (let i = 0; i < frames; i++) {
    inp.time = i / 60
    solveRig(rig, inp, out, 0)
  }
  return { out, rig, body, scale: look.scale }
}

const people = readIndex().avatars

describe('which anims draw which pose', () => {
  it('maps grip, finger and armIn to their modes, standing and seated', () => {
    expect(modeFor('grip', 'stand', 'none')).toBe('grip')
    expect(modeFor('finger', 'stand', 'none')).toBe('finger')
    expect(modeFor('armIn', 'sit', 'none')).toBe('sitArmIn')
    // the station says 'finger' while the person is seated at the BP wing (the finger clip is the rest before the cuff): the arm is in
    expect(modeFor('finger', 'sit', 'none')).toBe('sitArmIn')
    // a standing person whose station has not taken 'armIn' back yet just stands (and walks); a seated 'grip' is a plain seat
    expect(modeFor('armIn', 'stand', 'none')).toBe('relaxed')
    expect(modeFor('grip', 'sit', 'none')).toBe('sit')
    // lying always wins
    expect(modeFor('armIn', 'lie', 'none')).toBe('lie')
  })

  it('the posture comes from the seat the sim says, not from the anim', () => {
    for (const a of ['grip', 'finger', 'armIn'] as AnimState[]) {
      expect(postureOf(a, undefined, false, undefined), a).toBe('stand')
      expect(postureOf(a, 'sit', false, undefined), a).toBe('sit')
    }
  })

  it('sitArmIn is a seated mode and the others are not; the blender knows all three', () => {
    expect(isSeatedMode('sitArmIn')).toBe(true)
    expect(isSeatedMode('grip')).toBe(false)
    expect(isSeatedMode('finger')).toBe(false)
    expect(MODE_COUNT).toBe(MODES.length)
    for (const m of ['grip', 'finger', 'sitArmIn'] as Mode[]) expect(MODES).toContain(m)
    const b = createBlender('relaxed')
    for (const m of ['grip', 'finger', 'sitArmIn', 'sit', 'relaxed'] as Mode[]) {
      blendTo(b, m)
      for (let i = 0; i < 20; i++) {
        advanceBlend(b, 1 / 60)
        expect(Math.abs(weightSum(b) - 1)).toBeLessThan(1e-5)
      }
    }
  })
})

describe('grip: both hands on the handles of the kiosk tower', () => {
  const scales = [0.94, 1, 1.06]
  it('lands each hand within 3 cm of its handle for a short, a middle and a tall person', () => {
    for (const scale of scales) {
      const p = pose('grip', { scale })
      const l = handCentre(p.out, P.handL, p.body.hand)
      const r = handCentre(p.out, P.handR, p.body.hand)
      expect(dist(l, [GRIP.side, GRIP.up, GRIP.ahead]), `left at ${scale}`).toBeLessThan(0.03)
      expect(dist(r, [-GRIP.side, GRIP.up, GRIP.ahead]), `right at ${scale}`).toBeLessThan(0.03)
    }
  })

  it('does the same for every realistic avatar skeleton (a standing target needs nothing of the skeleton)', () => {
    for (const a of people) {
      for (const scale of [0.94, 1.06]) {
        const p = pose('grip', { scale, body: a.body })
        const l = handCentre(p.out, P.handL, a.body.hand)
        const r = handCentre(p.out, P.handR, a.body.hand)
        expect(dist(l, [GRIP.side, GRIP.up, GRIP.ahead]), `${a.id} left at ${scale}`).toBeLessThan(0.04)
        expect(dist(r, [-GRIP.side, GRIP.up, GRIP.ahead]), `${a.id} right at ${scale}`).toBeLessThan(0.04)
      }
    }
  })

  it('stands on the platform: the crowd draws a person at position.y = 0.05 five centimetres up, and the pose is unchanged by it', () => {
    const m = new CrowdModel()
    const e: Entity = { id: 'kiosk-user', role: 'visitor', name: 'Test', position: { x: -53.95, y: 0.05, z: 4.98 }, heading: 0, speed: 0, anim: 'grip', mood: 'neutral', emote: 'none', tier: 'near', variant: 3 }
    const es = new Map([[e.id, e]])
    const frame = (i: number): FrameInput => ({ dt: 1 / 60, time: i / 60, camX: -53, camY: 2, camZ: 0, entities: es, followId: null, selectedId: null, hoverId: null })
    for (let i = 0; i < 90; i++) m.update(frame(i))
    const slot = m.get(e.id)!
    // the root texel is (x, y, z, heading): the body is drawn 5 cm above the floor, and in the grip pose
    expect(m.data[slot.row * ROW_FLOATS]).toBeCloseTo(-53.95, 4)
    expect(m.data[slot.row * ROW_FLOATS + 1]).toBeCloseTo(0.05, 6)
    expect(m.data[slot.row * ROW_FLOATS + 2]).toBeCloseTo(4.98, 4)
    expect(slot.rig.blender.target).toBe(MODES.indexOf('grip'))
  })
})

describe('finger: the right hand out to the tower', () => {
  it('holds the right hand at the reader for every size and every avatar, with the left arm hanging', () => {
    for (const scale of [0.94, 1, 1.06]) {
      const p = pose('finger', { scale })
      const r = handCentre(p.out, P.handR, p.body.hand)
      expect(dist(r, [FINGER.x, FINGER.up, FINGER.ahead]), `size ${scale}`).toBeLessThan(0.03)
      const l = handCentre(p.out, P.handL, p.body.hand)
      expect(l[2], 'the left hand is not out in front').toBeLessThan(0.2)
    }
    for (const a of people) {
      const p = pose('finger', { scale: 1, body: a.body })
      const r = handCentre(p.out, P.handR, a.body.hand)
      expect(dist(r, [FINGER.x, FINGER.up, FINGER.ahead]), a.id).toBeLessThan(0.04)
    }
  })
})

describe('sitArmIn: the left arm in the BP cuff or the robot tunnel', () => {
  const target: V3 = [ARM_IN.left, KIOSK_SEAT_HEIGHT + ARM_IN.up, ARM_IN.ahead]

  it('the ARM_IN point sits on the tunnel axis, between the mouth and the far end, at the seat height plus `up`', () => {
    const f = { x: -53.35, z: 4.62, heading: 0 }
    const p = armInPoint(f)
    const t = armInTunnel(f)
    expect(p.y).toBeCloseTo(KIOSK_SEAT_HEIGHT + ARM_IN.up, 9)
    expect(Math.hypot(p.x - t.mouth.x, p.y - t.mouth.y)).toBeLessThan(1e-9)
    expect(Math.hypot(t.far.z - t.mouth.z, t.far.x - t.mouth.x)).toBeCloseTo(ARM_IN.length, 9)
    expect(p.z).toBeGreaterThan(t.mouth.z)
    expect(p.z).toBeLessThan(t.far.z)
    // turned to face east the same numbers rotate with the person
    const e = armInPoint({ x: 0, z: 0, heading: Math.PI / 2 })
    expect(e.x).toBeCloseTo(ARM_IN.ahead, 9)
    expect(e.z).toBeCloseTo(-ARM_IN.left, 9)
  })

  it('puts the middle of the left hand within 4 cm of the point for a short, a middle and a tall person, with the right hand on the thigh', () => {
    for (const scale of [0.94, 1, 1.06]) {
      const p = pose('sitArmIn', { posture: 'sit', scale })
      const l = handCentre(p.out, P.handL, p.body.hand)
      expect(dist(l, target), `size ${scale}`).toBeLessThan(0.04)
      const r = handCentre(p.out, P.handR, p.body.hand)
      expect(r[2], 'the right hand stays near the lap').toBeLessThan(0.45)
      expect(r[1], 'the right hand is below the chest').toBeLessThan(KIOSK_SEAT_HEIGHT + 0.5)
    }
  })

  it('does the same for every realistic avatar skeleton once the rig tells the pose the skeleton (rig.ts change request), and stays near it without', () => {
    for (const a of people) {
      for (const scale of [0.94, 1, 1.06]) {
        const own = pose('sitArmIn', { posture: 'sit', scale, body: a.body, own: true })
        expect(dist(handCentre(own.out, P.handL, a.body.hand), target), `${a.id} at ${scale}, own skeleton`).toBeLessThan(0.04)
      }
      // without the skeleton the pose assumes the nominal one: the hand is off by the difference of the two seated pelvis heights at most
      const blind = pose('sitArmIn', { posture: 'sit', scale: 1, body: a.body })
      expect(dist(handCentre(blind.out, P.handL, a.body.hand), target), `${a.id} blind`).toBeLessThan(0.1)
    }
  })

  it('the forearm lies inside the tunnel: within its radius minus 3 cm of the axis from the mouth on', () => {
    for (const scale of [0.94, 1, 1.06]) {
      for (const a of [undefined, ...people.slice(0, 6)]) {
        const p = pose('sitArmIn', { posture: 'sit', scale, body: a?.body, own: true })
        const elbow = origin(p.out, P.foreL)
        const wrist = origin(p.out, P.handL)
        const hand = handCentre(p.out, P.handL, p.body.hand)
        const axis = { y: KIOSK_SEAT_HEIGHT + ARM_IN.up, x: ARM_IN.left }
        let samples = 0
        for (let k = 0; k <= 10; k++) {
          const t = k / 10
          const q: V3 = [elbow[0] + (wrist[0] - elbow[0]) * t, elbow[1] + (wrist[1] - elbow[1]) * t, elbow[2] + (wrist[2] - elbow[2]) * t]
          if (q[2] < ARM_IN.mouth) continue
          samples++
          expect(Math.hypot(q[0] - axis.x, q[1] - axis.y), `${a?.id ?? 'nominal'} at ${scale}, forearm ${k}/10`).toBeLessThan(ARM_IN.radius - 0.03)
        }
        expect(samples, 'part of the forearm is in the tube').toBeGreaterThan(0)
        expect(Math.hypot(hand[0] - axis.x, hand[1] - axis.y)).toBeLessThan(ARM_IN.radius - 0.03)
        expect(hand[2]).toBeLessThan(ARM_IN.mouth + ARM_IN.length)
      }
    }
  })

  it('the hand is reachable by everybody: the shoulder-to-hand distance stays within the arm (the arm is nearly straight, never clamped short)', () => {
    for (const a of people) {
      for (const scale of [0.94, 1.06]) {
        const p = pose('sitArmIn', { posture: 'sit', scale, body: a.body, own: true })
        const shoulder = origin(p.out, P.armL)
        const hand = handCentre(p.out, P.handL, a.body.hand)
        const reach = (a.body.upperArm + a.body.forearm + a.body.hand) * scale
        const d = dist(shoulder, hand)
        expect(d, `${a.id} at ${scale}`).toBeLessThan(reach * 0.999)
        expect(dist(hand, target), `${a.id} at ${scale}: not clamped short`).toBeLessThan(0.04)
      }
    }
  })

  it('seatedReachY lands a point `up` above any seat surface', () => {
    const c = { standPelvis: STAND_PELVIS, seatedPelvis: NOMINAL_BODY.seatedPelvis, size: 1 }
    // rig: world y = seat + seatedPelvis * s + (y - standPelvis) * s
    for (const s of [0.94, 1, 1.06]) {
      const y = seatedReachY({ ...c, size: s }, 0.38)
      expect(0.5 + c.seatedPelvis * s + (y - c.standPelvis) * s).toBeCloseTo(0.5 + 0.38, 9)
    }
  })

  it('sits on any seat height: the hand follows the seat surface', () => {
    for (const seat of [0.45, 0.5]) {
      const p = pose('sitArmIn', { posture: 'sit', seat })
      const l = handCentre(p.out, P.handL, p.body.hand)
      expect(l[1]).toBeCloseTo(seat + ARM_IN.up, 1)
    }
  })

  it('the head turns to the screen and tips down', () => {
    const p = pose('sitArmIn', { posture: 'sit' })
    expect(p.rig.up[4]).toBeGreaterThan(0.1) // head pitch
    expect(p.rig.up[3]).toBeLessThan(-0.1) // head yaw: to the right
  })
})

describe('moving in and out of the poses', () => {
  it('blends smoothly: no part jumps more than 8 cm in a frame (a hand crosses half a metre in the 0.25 s blend) from a plain stance or seat into the pose and back', () => {
    const cases: { mode: Mode; posture: Posture; from: Mode }[] = [
      { mode: 'grip', posture: 'stand', from: 'relaxed' },
      { mode: 'finger', posture: 'stand', from: 'relaxed' },
      { mode: 'sitArmIn', posture: 'sit', from: 'sit' },
    ]
    for (const c of cases) {
      const look = { ...lookFor({ id: `blend-${c.mode}`, role: 'visitor', variant: 5 }) }
      const rig = createRig(look)
      const inp = makeInput()
      inp.posture = c.posture
      inp.seatHeight = KIOSK_SEAT_HEIGHT
      const out = new Float32Array(PART_COUNT * 12)
      const prev = new Float32Array(PART_COUNT * 12)
      let worst = 0
      for (let i = 0; i < 360; i++) {
        inp.time = i / 60
        inp.mode = i < 120 ? c.from : i < 240 ? c.mode : c.from
        solveRig(rig, inp, out, 0)
        if (i > 1) for (const part of [P.handL, P.handR, P.foreL, P.foreR, P.head]) worst = Math.max(worst, dist(origin(out, part), origin(prev, part)))
        prev.set(out)
      }
      expect(worst, `${c.from} -> ${c.mode}`).toBeLessThan(0.08)
    }
  })

  it('every output is finite in every kiosk mode and posture, including a person walking while posed', () => {
    for (const mode of ['grip', 'finger', 'sitArmIn'] as Mode[]) {
      for (const posture of ['stand', 'sit', 'lie'] as Posture[]) {
        const look = lookFor({ id: `fin-${mode}-${posture}`, role: 'visitor', variant: 2 })
        const rig = createRig(look)
        const inp = makeInput()
        inp.mode = mode
        inp.posture = posture
        inp.seatHeight = posture === 'lie' ? 0.49 : KIOSK_SEAT_HEIGHT
        const out = new Float32Array(PART_COUNT * 12)
        for (let i = 0; i < 200; i++) {
          inp.time = i / 60
          const v = posture === 'stand' && i > 60 ? 1.4 : 0
          inp.z += v / 60
          inp.vz = v
          inp.speed = v
          solveRig(rig, inp, out, 0)
          for (const f of out) expect(Number.isFinite(f)).toBe(true)
        }
      }
    }
  })
})
