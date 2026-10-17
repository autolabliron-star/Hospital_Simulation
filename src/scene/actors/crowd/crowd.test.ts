// Ported from Waltz City (src/scene/actors/crowd/crowd.test.ts): stride, blending, LOD, rig, head look-at, picking, geometry and model tests. The
// outfit, sit/lie, hand-reach, props, vehicle and fade tests are new.
import { describe, expect, it } from 'vitest'
import type { AnimState, Entity, PropKind, Role, VehicleKind } from '@/sim/types'
import { MODES, advanceBlend, blendTo, createBlender, modeFor, postureOf, weightSum, type Mode, type Posture } from './blend'
import { FIXED_COLORS, LIE, MAX_PEOPLE, P, PALETTE_SLOTS, PART_COUNT, PROP, ROW_FLOATS, STAND_CROWN, TEX, VEHICLE, VEHICLE_AHEAD } from './constants'
import { GAIT, createPlanter, halfStride, updatePlanter } from './gait'
import { buildPropGeometry, buildVehicleGeometry } from './gear'
import { buildBodyGeometries } from './geometry'
import { crownPosition, headPosition, levelsOf, type Levels } from './head'
import { createHeadLook, LOOK, updateHeadLook } from './look'
import { coverage, ditherVisible, lodBounds, lodWeights } from './lod'
import { CrowdModel, FADE_SECONDS, type FrameInput } from './model'
import { EVERYDAY_NAME, GOWN_NAME, OUTFIT_NAMES, TONE, clothesOf, heightFor, lookFor, scaleFor, type Look } from './outfit'
import { pickRadius, rayVsPerson, rayVsSegment } from './picking'
import { HANDLE } from './pose'
import { createRig, makeInput, solveRig, type PersonRig } from './rig'

const ROLES: Role[] = ['patient', 'visitor', 'doctor', 'nurse', 'pharmacist', 'porter', 'cleaner', 'receptionist', 'coordinator', 'paramedic']
const ANIMS: AnimState[] = ['idle', 'walk', 'run', 'talk', 'sit', 'lie', 'tablet', 'give', 'carry', 'wave', 'push', 'clean']

// ---------------------------------------------------------------------------------------------
// Stride phase follows distance, not time
// ---------------------------------------------------------------------------------------------

/** Walk a straight line (heading +Z) for `metres` at `speed` with step `dt`; returns the planter and what the feet did. */
function walk(speed: number, metres: number, dt: number) {
  const p = createPlanter()
  let z = 0
  let maxPlantedMove = 0
  const prev = [
    { x: 0, z: 0, stepping: false },
    { x: 0, z: 0, stepping: false },
  ]
  const stepOrder: number[] = []
  let lastSteps = 0
  let lastStarter = -1
  updatePlanter(p, dt, 0, 0, 0, 0, 0, 0, 1)
  for (let i = 0; i < 2; i++) prev[i] = { x: p.feet[i].x, z: p.feet[i].z, stepping: false }
  const frames = Math.ceil(metres / (speed * dt))
  for (let n = 0; n < frames; n++) {
    z += speed * dt
    updatePlanter(p, dt, 0, z, 0, 0, speed, speed, 1)
    if (p.lastStepper !== lastStarter) {
      lastStarter = p.lastStepper
      stepOrder.push(lastStarter)
    }
    for (let i = 0; i < 2; i++) {
      const f = p.feet[i]
      // a foot that was planted last frame and is still planted must not have moved at all
      if (!prev[i].stepping && !f.stepping) maxPlantedMove = Math.max(maxPlantedMove, Math.hypot(f.x - prev[i].x, f.z - prev[i].z))
      prev[i] = { x: f.x, z: f.z, stepping: f.stepping }
    }
    lastSteps = p.steps
  }
  return { p, steps: lastSteps, maxPlantedMove, stepOrder }
}

describe('stride follows distance, not time', () => {
  it('takes steps in proportion to the distance walked', () => {
    const a = walk(1.4, 10, 1 / 60).steps
    const b = walk(1.4, 20, 1 / 60).steps
    expect(a).toBeGreaterThanOrEqual(8)
    expect(a).toBeLessThanOrEqual(16)
    expect(b / a).toBeGreaterThan(1.7)
    expect(b / a).toBeLessThan(2.3)
  })

  it('does not depend on the frame rate', () => {
    const s60 = walk(1.4, 20, 1 / 60).steps
    for (const dt of [1 / 30, 1 / 120, 1 / 144]) expect(Math.abs(walk(1.4, 20, dt).steps - s60)).toBeLessThanOrEqual(2)
  })

  it('slower walking covers the same distance in about the same number of steps, not twice as many', () => {
    const slow = walk(0.8, 12, 1 / 60).steps
    const fast = walk(1.6, 12, 1 / 60).steps
    expect(slow / fast).toBeLessThan(1.8)
    expect(slow / fast).toBeGreaterThan(0.9)
  })

  it('stands still: time passing takes no steps', () => {
    const p = createPlanter()
    for (let i = 0; i < 60 * 20; i++) updatePlanter(p, 1 / 60, 3, 4, 0.5, 0, 0, 0, 1)
    expect(p.steps).toBe(0)
  })

  it('planted feet never move (no sliding) and the feet alternate, at a walk, a hurry, a run and the sim at 4x', () => {
    for (const speed of [1.3, 1.9, 3.2, 5.2]) {
      const r = walk(speed, 30, 1 / 60)
      expect(r.maxPlantedMove).toBe(0)
      expect(r.stepOrder.length).toBeGreaterThan(8)
      for (let i = 2; i < r.stepOrder.length; i++) expect(r.stepOrder[i]).not.toBe(r.stepOrder[i - 1])
    }
  })

  it('steps follow the planned landing spot: feet land ahead of the body by about half a stride', () => {
    const r = walk(1.4, 20, 1 / 60)
    const p = r.p
    // after the last frame the planted foot is at most one half stride ahead of / behind the body
    for (const f of p.feet) {
      const a = f.z - p.pz
      expect(a).toBeLessThan(halfStride(1.4) + 0.1)
      expect(a).toBeGreaterThan(-halfStride(1.4) - 0.2)
    }
  })

  it('a stopped walker re-homes both feet next to the body, and a teleport does not smear a step', () => {
    const p = createPlanter()
    let z = 0
    for (let i = 0; i < 240; i++) {
      z += 1.4 / 60
      updatePlanter(p, 1 / 60, 0, z, 0, 0, 1.4, 1.4, 1)
    }
    for (let i = 0; i < 120; i++) updatePlanter(p, 1 / 60, 0, z, 0, 0, 0, 0, 1)
    for (const f of p.feet) {
      expect(Math.abs(f.z - z)).toBeLessThan(GAIT.idleStepDist + 0.05)
      expect(f.stepping).toBe(false)
    }
    const steps = p.steps
    updatePlanter(p, 1 / 60, 50, 50, 0, 0, 0, 0, 1) // teleport
    expect(p.steps).toBe(steps)
    expect(Math.hypot(p.feet[0].x - 50, p.feet[0].z - 50)).toBeLessThan(0.3)
  })
})

// ---------------------------------------------------------------------------------------------
// Pose blending
// ---------------------------------------------------------------------------------------------

describe('pose blending', () => {
  it('weights always sum to 1 and stay in [0, 1], whatever the requests', () => {
    const b = createBlender('relaxed')
    let seed = 12345
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < 5000; i++) {
      if (rand() < 0.05) blendTo(b, MODES[Math.floor(rand() * MODES.length)])
      advanceBlend(b, rand() * 0.05)
      expect(Math.abs(weightSum(b) - 1)).toBeLessThan(1e-5)
      for (const w of b.weights) {
        expect(w).toBeGreaterThanOrEqual(0)
        expect(w).toBeLessThanOrEqual(1 + 1e-6)
      }
    }
  })

  it('reaches the target mode in 0.25 s and never jumps', () => {
    const b = createBlender('relaxed')
    blendTo(b, 'push')
    let last = 0
    for (let i = 0; i < 15; i++) {
      advanceBlend(b, 1 / 60)
      const w = b.weights[MODES.indexOf('push')]
      expect(Math.abs(w - last)).toBeLessThan(0.2)
      last = w
    }
    expect(last).toBeGreaterThan(0.99)
  })

  it('interrupting a blend starts from the current weights (no snap)', () => {
    const b = createBlender('relaxed')
    blendTo(b, 'talk')
    for (let i = 0; i < 7; i++) advanceBlend(b, 1 / 60)
    const before = Array.from(b.weights)
    blendTo(b, 'clean')
    advanceBlend(b, 0)
    for (let i = 0; i < before.length; i++) expect(b.weights[i]).toBeCloseTo(before[i], 5)
  })

  it('every animation state maps to a mode, and the postures map as the brief says', () => {
    const want: Partial<Record<AnimState, Mode>> = { talk: 'talk', wave: 'wave', tablet: 'tablet', give: 'give', push: 'push', clean: 'clean', idle: 'relaxed', walk: 'relaxed', run: 'relaxed', carry: 'relaxed' }
    for (const a of ANIMS) {
      const posture = postureOf(a, undefined, false, undefined)
      const m = modeFor(a, posture, 'none')
      expect(MODES).toContain(m)
      if (want[a]) expect(m).toBe(want[a])
    }
    expect(postureOf('sit', undefined, false, undefined)).toBe('sit')
    expect(postureOf('lie', undefined, false, undefined)).toBe('lie')
    expect(modeFor('sit', 'sit', 'none')).toBe('sit')
    expect(modeFor('lie', 'lie', 'none')).toBe('lie')
    // a seated person keeps doing what the sim says, and a seat the sim put them on counts even when the anim is 'idle'
    expect(postureOf('idle', 'sit', false, undefined)).toBe('sit')
    expect(postureOf('idle', 'lie', false, undefined)).toBe('lie')
    expect(modeFor('talk', 'sit', 'none')).toBe('sitTalk')
    expect(modeFor('tablet', 'sit', 'none')).toBe('typing')
    expect(modeFor('idle', 'sit', 'tablet')).toBe('sitTablet')
    // riders: a wheelchair seats, a stretcher lays
    expect(postureOf('idle', undefined, true, 'wheelchair')).toBe('sit')
    expect(postureOf('idle', undefined, true, 'stretcher')).toBe('lie')
    expect(postureOf('idle', undefined, false, 'wheelchair')).toBe('stand')
  })
})

// ---------------------------------------------------------------------------------------------
// Level of detail
// ---------------------------------------------------------------------------------------------

describe('LOD cross-fade', () => {
  it('is continuous in distance, sums to 1, and brackets 120 m as specified', () => {
    let prev = lodWeights(0)
    for (let d = 0; d <= 300; d += 0.05) {
      const w = lodWeights(d)
      expect(w.high + w.mid + w.far).toBeCloseTo(1, 9)
      expect(Math.abs(w.far - prev.far)).toBeLessThan(0.01)
      expect(Math.abs(w.high - prev.high)).toBeLessThan(0.01)
      prev = { ...w }
    }
    expect(lodWeights(119.99).far).toBe(0)
    expect(lodWeights(120).far).toBe(0)
    expect(lodWeights(125).far).toBeCloseTo(0.5, 9)
    expect(lodWeights(130).far).toBe(1)
    expect(lodWeights(5).high).toBe(1)
  })

  it('tiles every pixel exactly once: the three bodies cover [0, presence) with no overlap', () => {
    for (const presence of [1, 0.6, 0.2]) {
      for (const d of [10, 26, 90, 122, 126, 129, 200]) {
        const b = lodBounds(lodWeights(d), presence)
        expect(b[0]).toBeLessThanOrEqual(b[1])
        expect(b[1]).toBeLessThanOrEqual(b[2])
        const c = coverage(b)
        expect(c.high + c.mid + c.far).toBeCloseTo(presence, 9)
        for (let t = 0; t < 1; t += 0.01) {
          const n = [ditherVisible(t, 0, b[0]), ditherVisible(t, b[0], b[1]), ditherVisible(t, b[1], b[2])].filter(Boolean).length
          expect(n).toBe(t < presence ? 1 : 0)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------------------------

/** World position of the origin of part `part` for a solved row at offset 0, given the root. */
function partPos(out: Float32Array, part: number, x: number, z: number, heading: number): [number, number, number] {
  const b = part * 12
  const lx = out[b + 3]
  const ly = out[b + 7]
  const lz = out[b + 11]
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  return [x + c * lx + s * lz, ly, z - s * lx + c * lz]
}

/** The middle of a hand (the wrist plus 0.085 along the forearm, already scaled), in the root frame. */
function handCentre(out: Float32Array, part: number): [number, number, number] {
  const b = part * 12
  return [out[b + 3] - 0.085 * out[b + 1], out[b + 7] - 0.085 * out[b + 5], out[b + 11] - 0.085 * out[b + 9]]
}

interface Solved {
  rig: PersonRig
  out: Float32Array
  look: Look
}

function solved(opts: { id?: string; mode: Mode; posture?: Posture; prop?: number; seconds?: number; seat?: number; speed?: number; scale?: number; role?: Role }): Solved {
  const look = { ...lookFor({ id: opts.id ?? 'pose', role: opts.role ?? 'porter', variant: 4 }) }
  if (opts.scale) look.scale = opts.scale
  const rig = createRig(look)
  const inp = makeInput()
  inp.mode = opts.mode
  inp.posture = opts.posture ?? 'stand'
  inp.prop = opts.prop ?? PROP.none
  inp.seatHeight = opts.seat ?? 0.45
  const out = new Float32Array(PART_COUNT * 12)
  const speed = opts.speed ?? 0
  let z = 0
  const frames = Math.round((opts.seconds ?? 2) * 60)
  for (let i = 0; i < frames; i++) {
    z += speed / 60
    inp.time = i / 60
    inp.z = z
    inp.vz = speed
    inp.speed = speed
    solveRig(rig, inp, out, 0)
  }
  return { rig, out, look }
}

describe('rig', () => {
  it('produces finite matrices for every mode in every posture, walking and still, and keeps planted feet on their targets', () => {
    for (const mode of MODES) {
      for (const posture of ['stand', 'sit', 'lie'] as Posture[]) {
        const look = lookFor({ id: `x-${mode}-${posture}`, role: 'nurse', variant: 2 })
        const rig = createRig(look)
        const inp = makeInput()
        inp.mode = mode
        inp.posture = posture
        inp.seatHeight = posture === 'lie' ? LIE.bed : 0.45
        inp.prop = mode === 'tablet' || mode === 'sitTablet' ? PROP.tablet : PROP.bag
        const out = new Float32Array(PART_COUNT * 12)
        let z = 0
        let worstFoot = 0
        for (let i = 0; i < 400; i++) {
          const walking = posture === 'stand' && i > 100 && i < 300
          const v = walking ? 1.4 : 0
          z += v / 60
          inp.dt = 1 / 60
          inp.time = i / 60
          inp.z = z
          inp.heading = 0.6
          inp.x = z * Math.tan(0.6)
          inp.vx = v * Math.sin(0.6)
          inp.vz = v * Math.cos(0.6)
          inp.speed = v
          solveRig(rig, inp, out, 0)
          for (const f of out) expect(Number.isFinite(f)).toBe(true)
          if (posture === 'stand') {
            const foot = partPos(out, P.footL, inp.x, inp.z, inp.heading)
            const planted = rig.planter.feet[0]
            if (!planted.stepping) worstFoot = Math.max(worstFoot, Math.hypot(foot[0] - planted.x, foot[2] - planted.z))
          }
        }
        if (posture === 'stand') expect(worstFoot).toBeLessThan(0.02)
      }
    }
  }, 60000)

  it('keeps the planted foot where the planner put it at a run and at 4x sim speed (the leg always reaches)', () => {
    for (const speed of [3.2, 5.2]) {
      const look = lookFor({ id: 'runner', role: 'paramedic', variant: 1 })
      const rig = createRig(look)
      const inp = makeInput()
      inp.mode = 'relaxed'
      const out = new Float32Array(PART_COUNT * 12)
      let z = 0
      let worst = 0
      for (let i = 0; i < 600; i++) {
        z += speed / 60
        inp.time = i / 60
        inp.z = z
        inp.vz = speed
        inp.speed = speed
        solveRig(rig, inp, out, 0)
        for (const f of out) expect(Number.isFinite(f)).toBe(true)
        if (i > 120) {
          for (const [part, foot] of [
            [P.footL, rig.planter.feet[0]],
            [P.footR, rig.planter.feet[1]],
          ] as const) {
            const w = partPos(out, part, inp.x, inp.z, inp.heading)
            if (!foot.stepping) worst = Math.max(worst, Math.hypot(w[0] - foot.x, w[2] - foot.z))
          }
        }
      }
      expect(worst).toBeLessThan(0.03)
      expect(rig.run).toBeGreaterThan(0.3) // the arms swing like a runner
    }
  })

  it('walks with a bob of a few centimetres, not a bounce', () => {
    const look = lookFor({ id: 'bob', role: 'nurse', variant: 1 })
    const rig = createRig(look)
    const inp = makeInput()
    const out = new Float32Array(PART_COUNT * 12)
    let lo = 9
    let hi = 0
    let z = 0
    for (let i = 0; i < 600; i++) {
      z += 1.4 / 60
      inp.z = z
      inp.vz = 1.4
      inp.speed = 1.4
      inp.time = i / 60
      solveRig(rig, inp, out, 0)
      if (i > 240) {
        lo = Math.min(lo, out[P.pelvis * 12 + 7])
        hi = Math.max(hi, out[P.pelvis * 12 + 7])
      }
    }
    expect(hi - lo).toBeGreaterThan(0.02)
    expect(hi - lo).toBeLessThan(0.11)
  })

  it('poses: wave lifts the hand above the shoulder, typing puts hands at desk height, sitting keeps the head over the seat', () => {
    const wave = solved({ mode: 'wave' })
    // the dominant hand waves
    const [hand, shoulder] = wave.look.hand === 1 ? [P.handR, P.armR] : [P.handL, P.armL]
    expect(wave.out[hand * 12 + 7]).toBeGreaterThan(wave.out[shoulder * 12 + 7])
    const typing = solved({ mode: 'typing', posture: 'sit' })
    const hy = typing.out[P.handL * 12 + 7]
    expect(hy).toBeGreaterThan(0.62)
    expect(hy).toBeLessThan(0.92)
    const sitting = solved({ mode: 'sit', posture: 'sit' })
    const head = sitting.out[P.head * 12 + 7]
    expect(head).toBeGreaterThan(0.45 + 0.5)
    expect(head).toBeLessThan(0.45 + 0.75)
    // forearms rest on the thighs when sitting: hands above the seat, in front of the hips
    expect(sitting.out[P.handL * 12 + 11]).toBeGreaterThan(0.2)
    expect(sitting.out[P.handL * 12 + 7]).toBeGreaterThan(0.45)
    expect(sitting.out[P.handL * 12 + 7]).toBeLessThan(0.8)
  })

  it('sitting puts the hips on the seat, whatever the seat height (and never lower than the pelvis can sit)', () => {
    for (const seat of [0.45, 0.5, 0.7]) {
      const r = solved({ mode: 'sit', posture: 'sit', seat, seconds: 2 })
      const pelvis = r.out[P.pelvis * 12 + 7]
      expect(pelvis).toBeCloseTo(seat + 0.125 * r.look.scale, 2)
    }
  })

  it('pushing: both hands land on the handle at the same place for a short and a tall pusher', () => {
    for (const scale of [0.94, 1, 1.06]) {
      const r = solved({ mode: 'push', scale, speed: 1.0, seconds: 2 })
      const l = handCentre(r.out, P.handL)
      const rr = handCentre(r.out, P.handR)
      expect(Math.hypot(l[0] - HANDLE.half, l[1] - HANDLE.y, l[2] - HANDLE.ahead)).toBeLessThan(0.03)
      expect(Math.hypot(rr[0] + HANDLE.half, rr[1] - HANDLE.y, rr[2] - HANDLE.ahead)).toBeLessThan(0.03)
    }
  })

  it('tablet: the right hand holds the tablet in front of the chest and the head looks down at it', () => {
    const r = solved({ mode: 'tablet', prop: PROP.tablet })
    const h = handCentre(r.out, P.handR)
    expect(Math.hypot(h[0] + 0.11, h[1] - 1.07, h[2] - 0.27)).toBeLessThan(0.05)
    expect(r.rig.propDraw).toBe(PROP.tablet)
    expect(r.rig.up[4]).toBeGreaterThan(0.3) // head pitch: nodding down
  })

  it('give: the right arm reaches out in front of the body', () => {
    const r = solved({ mode: 'give' })
    const h = handCentre(r.out, P.handR)
    expect(h[2]).toBeGreaterThan(0.4)
    expect(h[1]).toBeGreaterThan(0.95)
    expect(h[1]).toBeLessThan(1.3)
  })

  it('clean: both hands ride on a mop pole whose head sweeps across the floor ahead', () => {
    const heads: number[] = []
    const look = lookFor({ id: 'mop', role: 'cleaner', variant: 1 })
    const rig = createRig(look)
    const inp = makeInput()
    inp.mode = 'clean'
    const out = new Float32Array(PART_COUNT * 12)
    for (let i = 0; i < 360; i++) {
      inp.time = i / 60
      solveRig(rig, inp, out, 0)
      if (i > 60) {
        expect(rig.propDraw).toBe(PROP.mop)
        // the mop frame's origin is the floor point under the head; its +Y runs up the pole
        const b = P.prop * 12
        expect(out[b + 7]).toBeCloseTo(0, 1)
        expect(out[b + 5]).toBeGreaterThan(0.5)
        heads.push(out[b + 3])
        const l = handCentre(out, P.handL)
        const r = handCentre(out, P.handR)
        // both hands are on the pole line (within 8 cm of it)
        const ux = out[b + 1]
        const uy = out[b + 5]
        const uz = out[b + 9]
        for (const hnd of [l, r]) {
          const dx = hnd[0] - out[b + 3]
          const dy = hnd[1] - out[b + 7]
          const dz = hnd[2] - out[b + 11]
          const along = dx * ux + dy * uy + dz * uz
          const off = Math.hypot(dx - ux * along, dy - uy * along, dz - uz * along)
          expect(off).toBeLessThan(0.1)
        }
      }
    }
    expect(Math.max(...heads) - Math.min(...heads)).toBeGreaterThan(0.6) // a real sweep
  })

  it('held items: the hand takes each of them, and lets go before it takes another', () => {
    for (const kind of [PROP.tablet, PROP.folder, PROP.tray, PROP.cup, PROP.bag, PROP.flowers]) {
      const r = solved({ mode: 'relaxed', prop: kind })
      expect(r.rig.propDraw).toBe(kind)
      expect(r.rig.propScale).toBeGreaterThan(0.9)
      const b = P.prop * 12
      const hand = handCentre(r.out, P.handR)
      // the item is within a forearm's length of the hand
      expect(Math.hypot(r.out[b + 3] - hand[0], r.out[b + 7] - hand[1], r.out[b + 11] - hand[2])).toBeLessThan(0.25)
    }
    const look = lookFor({ id: 'swap', role: 'visitor', variant: 1 })
    const rig = createRig(look)
    const inp = makeInput()
    const out = new Float32Array(PART_COUNT * 12)
    inp.prop = PROP.bag
    for (let i = 0; i < 120; i++) solveRig(rig, inp, out, 0)
    expect(rig.propDraw).toBe(PROP.bag)
    inp.prop = PROP.cup
    let sawNone = false
    let kindsSeen = new Set<number>()
    for (let i = 0; i < 120; i++) {
      solveRig(rig, inp, out, 0)
      kindsSeen.add(rig.propDraw)
      if (rig.propDraw === PROP.none) sawNone = true
    }
    expect(sawNone).toBe(true)
    expect(rig.propDraw).toBe(PROP.cup)
    expect(kindsSeen.has(PROP.bag)).toBe(true)
    kindsSeen = new Set()
  })

  it('lying: flat on the mattress, head towards the back of the heading, feet towards the front, face up', () => {
    for (const mattress of [LIE.bed, LIE.stretcher]) {
      const r = solved({ mode: 'lie', posture: 'lie', seat: mattress, seconds: 3 })
      const k = r.look.scale
      const pelvis = [r.out[P.pelvis * 12 + 3], r.out[P.pelvis * 12 + 7], r.out[P.pelvis * 12 + 11]]
      const head = [r.out[P.head * 12 + 3], r.out[P.head * 12 + 7], r.out[P.head * 12 + 11]]
      const foot = [r.out[P.footL * 12 + 3], r.out[P.footL * 12 + 7], r.out[P.footL * 12 + 11]]
      expect(pelvis[1]).toBeCloseTo(mattress + LIE.pelvisAbove, 2)
      // head at the back (-Z), about 0.5 m from the hips at the neck base, level with them
      expect(head[2]).toBeLessThan(-0.4 * k)
      expect(Math.abs(head[1] - pelvis[1])).toBeLessThan(0.1)
      // feet at the front, level with the hips (toes up)
      expect(foot[2]).toBeGreaterThan(0.7 * k)
      expect(Math.abs(foot[1] - pelvis[1])).toBeLessThan(0.15)
      // face up: the head's forward axis (local +Z) points up
      expect(r.out[P.head * 12 + 6]).toBeGreaterThan(0.8)
      // the whole body stays within a bed's width and on the mattress
      for (let part = 0; part < P.prop; part++) {
        const x = r.out[part * 12 + 3]
        const y = r.out[part * 12 + 7]
        if (part === P.skirt) continue
        expect(Math.abs(x)).toBeLessThan(0.5)
        expect(y).toBeGreaterThan(mattress - 0.1)
        expect(y).toBeLessThan(mattress + 0.5)
      }
      // hands rest on the mattress beside the hips, not in the air
      const hand = handCentre(r.out, P.handL)
      expect(hand[1]).toBeLessThan(mattress + 0.14)
    }
  })

  it('lying down and standing up are motions, not pops', () => {
    const look = lookFor({ id: 'liedown', role: 'patient', variant: 1 })
    const rig = createRig(look)
    const inp = makeInput()
    const out = new Float32Array(PART_COUNT * 12)
    for (let i = 0; i < 60; i++) solveRig(rig, inp, out, 0)
    inp.posture = 'lie'
    inp.mode = 'lie'
    inp.seatHeight = LIE.bed
    let prev = out[P.head * 12 + 7]
    let maxJump = 0
    for (let i = 0; i < 90; i++) {
      inp.time = i / 60
      solveRig(rig, inp, out, 0)
      maxJump = Math.max(maxJump, Math.abs(out[P.head * 12 + 7] - prev))
      prev = out[P.head * 12 + 7]
    }
    expect(maxJump).toBeLessThan(0.08)
    expect(rig.lie).toBe(1)
    inp.posture = 'stand'
    inp.mode = 'relaxed'
    for (let i = 0; i < 90; i++) {
      solveRig(rig, inp, out, 0)
      maxJump = Math.max(maxJump, Math.abs(out[P.head * 12 + 7] - prev))
      prev = out[P.head * 12 + 7]
    }
    expect(rig.lie).toBe(0)
    expect(out[P.head * 12 + 7]).toBeGreaterThan(1.4)
  })

  it('a white coat or a gown hangs from the pelvis; trousers and shorts have no skirt piece', () => {
    const coat = solved({ mode: 'relaxed', role: 'doctor' })
    expect(coat.look.overlay).toBe('coat')
    expect(coat.out[P.skirt * 12 + 5]).toBeGreaterThan(0.5) // a long piece, y-scale well above zero
    const nurse = solved({ mode: 'relaxed', role: 'nurse' })
    expect(nurse.look.overlay).toBe('none')
    for (let i = 0; i < 12; i++) expect(nurse.out[P.skirt * 12 + i]).toBe(0)
  })
})

describe('head look-at', () => {
  it('stays within the neck limits and moves smoothly', () => {
    const s = createHeadLook()
    let prev = 0
    for (let i = 0; i < 120; i++) {
      updateHeadLook(s, 1 / 60, 2.0, 1.2, true) // way beyond the limits
      expect(Math.abs(s.yaw)).toBeLessThanOrEqual(LOOK.maxYaw + 1e-9)
      expect(s.pitch).toBeLessThanOrEqual(LOOK.maxPitchUp + 1e-9)
      const out = s.yaw * s.weight
      expect(Math.abs(out - prev)).toBeLessThan(0.15)
      prev = out
    }
    // the target vanishes: the head eases back instead of snapping
    for (let i = 0; i < 90; i++) {
      updateHeadLook(s, 1 / 60, 0, 0, false)
      const out = s.yaw * s.weight
      expect(Math.abs(out - prev)).toBeLessThan(0.15)
      prev = out
    }
    expect(s.weight).toBe(0)
  })

  it('ignores a target behind the person', () => {
    const s = createHeadLook()
    for (let i = 0; i < 60; i++) updateHeadLook(s, 1 / 60, Math.PI, 0, true)
    expect(s.weight).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Outfits
// ---------------------------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/

describe('outfits', () => {
  it('every role has an outfit with a name and valid colours, deterministic from the id and variant', () => {
    for (const role of ROLES) {
      expect(OUTFIT_NAMES[role].length).toBeGreaterThan(3)
      const a = lookFor({ id: `x-${role}`, role, variant: 7 })
      const b = lookFor({ id: `x-${role}`, role, variant: 7 })
      expect(a).toEqual(b)
      for (const c of [a.skin, a.hair, a.top, a.pants, a.shoes, a.front, a.accent, a.sleeve, a.lowerLeg, a.lanyard, a.upperLeg, a.glasses, a.coat, a.gear, a.badge]) expect(c).toMatch(HEX)
    }
    expect(GOWN_NAME.length).toBeGreaterThan(3)
    expect(EVERYDAY_NAME.length).toBeGreaterThan(3)
  })

  it('roles read by colour: scrubs, coats, tunics, hi-vis, gowns', () => {
    const many = (role: Role, n = 40) => Array.from({ length: n }, (_, i) => lookFor({ id: `${role}-${i}`, role, variant: i * 13 }))
    for (const d of many('doctor')) {
      expect(d.overlay).toBe('coat')
      expect(d.coat.toLowerCase()).toBe(TONE.white)
      expect(d.top.toLowerCase()).toBe(TONE.white)
      expect([TONE.scrubTeal, TONE.scrubNavy]).toContain(d.pants.toLowerCase())
      expect(d.front.toLowerCase()).toBe(d.pants.toLowerCase()) // the scrub top in the V of the coat
      expect(d.lanyardOn).toBe(true) // the stethoscope
      expect(d.lanyard).not.toBe(d.top)
    }
    expect(new Set(many('doctor').map((d) => d.pants)).size).toBe(2) // teal and navy both appear
    for (const n of many('nurse')) {
      expect([TONE.scrubBlue, TONE.scrubBlue2]).toContain(n.top.toLowerCase())
      expect(n.pants).toBe(n.top)
      expect(n.overlay).toBe('none')
    }
    for (const p of many('pharmacist')) {
      expect(p.pants.toLowerCase()).toBe(TONE.scrubGreen)
      expect(p.overlay).toBe('coat')
      expect(p.coat.toLowerCase()).toBe(TONE.white)
    }
    for (const p of many('porter')) expect(p.top.toLowerCase()).toBe(TONE.porterTop)
    for (const c of many('cleaner')) expect(c.top.toLowerCase()).toBe(TONE.cleanerTunic)
    for (const r of many('receptionist')) {
      expect(r.top.toLowerCase()).toBe(TONE.receptionNavy)
      expect(r.pants.toLowerCase()).toBe(TONE.receptionNavy)
    }
    for (const c of many('coordinator')) expect(c.top.toLowerCase()).toBe(TONE.slate)
    for (const m of many('paramedic')) {
      expect(m.top.toLowerCase()).toBe(TONE.paramedicGreen)
      expect(m.accent.toLowerCase()).toBe(TONE.hiVis) // the reflective bands
      expect(m.accent).not.toBe(m.top)
    }
    // everybody else has no bands: the accent slot repeats the top, so the band geometry is invisible on them
    for (const role of ['doctor', 'nurse', 'porter', 'cleaner', 'coordinator'] as Role[]) for (const l of many(role, 10)) expect(l.accent).toBe(l.top)
  })

  it('patients wear a pale blue gown unless dressed for the street; visitors dress for the street', () => {
    expect(clothesOf('patient', undefined)).toBe('gown')
    expect(clothesOf('patient', 'role')).toBe('gown')
    expect(clothesOf('patient', 'gown')).toBe('gown')
    expect(clothesOf('patient', 'everyday')).toBe('everyday')
    expect(clothesOf('visitor', undefined)).toBe('everyday')
    expect(clothesOf('nurse', undefined)).toBe('uniform')
    for (let i = 0; i < 30; i++) {
      const g = lookFor({ id: `pt-${i}`, role: 'patient', outfit: 'gown', variant: i })
      expect(g.top.toLowerCase()).toBe(TONE.gown)
      expect(g.coat.toLowerCase()).toBe(TONE.gown)
      expect(g.overlay).toBe('gown')
      expect(g.legs).toBe('bare')
    }
    const tops = new Set<string>()
    const overlays = new Set<string>()
    for (let i = 0; i < 80; i++) {
      const e = lookFor({ id: `v-${i}`, role: 'visitor', variant: i * 7 })
      tops.add(e.top)
      overlays.add(e.overlay + e.legs)
      expect(e.top.toLowerCase()).not.toBe(TONE.gown)
    }
    expect(tops.size).toBeGreaterThan(10) // varied everyday clothes
    expect(overlays.size).toBeGreaterThanOrEqual(3) // trousers, shorts and skirts
    // an ER arrival is admitted: same person, new clothes
    const before = lookFor({ id: 'er-1', role: 'patient', outfit: 'everyday', variant: 9 })
    const after = lookFor({ id: 'er-1', role: 'patient', outfit: 'gown', variant: 9 })
    expect(before.skin).toBe(after.skin)
    expect(before.hair).toBe(after.hair)
    expect(before.scale).toBe(after.scale)
    expect(before.top).not.toBe(after.top)
  })

  it('give a crowd of different heights (within 6 %) and skin tones', () => {
    const heights = new Set<number>()
    const skins = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const l = lookFor({ id: `ped-${i}`, role: ROLES[i % ROLES.length], variant: i % 12 })
      heights.add(Math.round(l.height * 100))
      skins.add(l.skin)
      expect(l.scale).toBeGreaterThanOrEqual(0.94)
      expect(l.scale).toBeLessThanOrEqual(1.06)
      expect(l.height).toBeCloseTo(STAND_CROWN * l.scale, 9)
    }
    expect(heights.size).toBeGreaterThan(8)
    expect(skins.size).toBeGreaterThanOrEqual(6)
  })

  it('headPosition agrees with the renderer for standing, seated and lying people', () => {
    const e = ent({ position: { x: 3, y: 0, z: 4 } })
    const k = heightFor(e.id, e.variant) / STAND_CROWN
    expect(scaleFor(e.id, e.variant)).toBeCloseTo(k, 9)
    const out = { x: 0, y: 0, z: 0 }
    headPosition(e, out)
    expect(out.y).toBeCloseTo(1.63 * k, 2)
    expect(out.x).toBe(3)
    crownPosition(e, out)
    expect(out.y).toBeCloseTo(heightFor(e.id, e.variant), 2)
    const seated = ent({ position: { x: 1, y: 0.45, z: 2 }, anim: 'sit' })
    headPosition(seated, out)
    expect(out.y).toBeGreaterThan(1.2)
    expect(out.y).toBeLessThan(1.4)
    const lying = ent({ position: { x: 5, y: 0, z: 5 }, anim: 'lie', heading: Math.PI })
    headPosition(lying, out)
    // head towards the back of the heading (heading PI faces -z, so the head is at +z), about 0.7 m from the hips, just above the mattress
    expect(out.z).toBeGreaterThan(5.6)
    expect(out.y).toBeGreaterThan(LIE.bed)
    expect(out.y).toBeLessThan(LIE.bed + 0.25)
  })
})

describe('levels of a seated or lying entity', () => {
  const lv: Levels = { posture: 'stand', floorY: 0, surface: 0 }
  it('uses the seat height the sim gives, defaults when it only gives the floor, and never seats lower than 0.45 m', () => {
    expect(levelsOf(ent({ anim: 'sit', position: { x: 0, y: 0, z: 0 } }), lv).surface).toBe(0.45)
    expect(levelsOf(ent({ anim: 'sit', position: { x: 0, y: 0.55, z: 0 } }), lv).surface).toBe(0.55)
    expect(levelsOf(ent({ anim: 'sit', position: { x: 0, y: 0.3, z: 0 } }), lv).surface).toBe(0.45)
    expect(levelsOf(ent({ anim: 'idle', seated: { seatId: 's', pose: 'sit' }, position: { x: 0, y: 0.5, z: 0 } }), lv).posture).toBe('sit')
    expect(levelsOf(ent({ anim: 'lie', position: { x: 0, y: 0, z: 0 } }), lv).surface).toBe(LIE.bed)
    expect(levelsOf(ent({ anim: 'lie', position: { x: 0, y: 0.7, z: 0 } }), lv).surface).toBe(0.7)
    expect(levelsOf(ent({ anim: 'idle', riding: true, vehicle: 'stretcher', position: { x: 0, y: 0, z: 0 } }), lv)).toMatchObject({ posture: 'lie', surface: LIE.stretcher })
    expect(levelsOf(ent({ anim: 'idle', riding: true, vehicle: 'wheelchair', position: { x: 0, y: 0, z: 0 } }), lv)).toMatchObject({ posture: 'sit', surface: LIE.wheelchairSeat })
    expect(levelsOf(ent({ anim: 'walk', position: { x: 0, y: 0, z: 0 } }), lv).posture).toBe('stand')
  })
})

describe('picking', () => {
  it('hits a person under the ray and misses one to the side; far people get a larger radius', () => {
    expect(rayVsPerson(0, 1.6, -10, 0, 0, 1, 0, 0, 1.7, 0, 0.34)).not.toBeNull()
    expect(rayVsPerson(0, 1.6, -10, 0, 0, 1, 1.5, 0, 1.7, 0, 0.34)).toBeNull()
    expect(pickRadius(150)).toBeGreaterThan(pickRadius(10) * 3)
    // from above at a steep angle the person is still found
    const d = Math.sqrt(0.5)
    expect(rayVsPerson(0, 20, -20, 0, -d, d, 0, 0, 1.7, 0, 0.5)).not.toBeNull()
  })

  it('finds a lying person along the bed and a seated one by the seat, and not the one behind the ray', () => {
    // a body lying along z from -0.7 to 0.8 at height 0.75, seen from above
    expect(rayVsSegment(0, 10, 0, 0, -1, 0, 0, 0.75, -0.7, 0, 0.75, 0.8, 0.3)).not.toBeNull()
    expect(rayVsSegment(0, 10, 3, 0, -1, 0, 0, 0.75, -0.7, 0, 0.75, 0.8, 0.3)).toBeNull()
    // behind the origin
    expect(rayVsSegment(0, 1.6, 5, 0, 0, 1, 0, 0, 1.7, 0, 0, 0, 0.34)).toBeNull()
  })
})

describe('geometry', () => {
  it('stays inside the triangle budget and addresses valid parts and slots', () => {
    const g = buildBodyGeometries()
    expect(g.triangles.high).toBeLessThan(2200) // W1: the close-up head, hair, hands and staff details (the budget test prints the number)
    expect(g.triangles.mid).toBeLessThan(520) // the mid body is drawn for hundreds of people: about 480 triangles
    expect(g.triangles.far).toBeLessThan(120)
    expect(g.triangles.mid).toBeLessThan(g.triangles.high)
    for (const geo of [g.high, g.mid, g.far]) {
      const part = geo.getAttribute('aPart')
      for (let i = 0; i < part.count; i++) {
        expect(part.getX(i)).toBeGreaterThanOrEqual(0)
        expect(part.getX(i)).toBeLessThan(P.prop) // the prop frame is not in the body
        expect(part.getY(i)).toBeLessThan(PALETTE_SLOTS + FIXED_COLORS.length)
      }
      const n = geo.getAttribute('normal')
      for (let i = 0; i < n.count; i++) expect(Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))).toBe(true)
    }
  })

  it('props and vehicles have every kind, valid slots and finite normals', () => {
    const props = buildPropGeometry()
    for (const k of [PROP.tablet, PROP.folder, PROP.tray, PROP.cup, PROP.bag, PROP.flowers, PROP.mop]) expect(props.triangles[k]).toBeGreaterThan(0)
    const veh = buildVehicleGeometry()
    for (const k of [VEHICLE.wheelchair, VEHICLE.stretcher, VEHICLE.cleaningCart, VEHICLE.linenCart]) expect(veh.triangles[k]).toBeGreaterThan(0)
    expect(props.total).toBeLessThan(900)
    expect(veh.total).toBeLessThan(2500)
    for (const { geometry } of [props, veh]) {
      const part = geometry.getAttribute('aPart')
      const n = geometry.getAttribute('normal')
      for (let i = 0; i < part.count; i++) {
        expect(part.getX(i)).toBeGreaterThanOrEqual(1)
        expect(part.getX(i)).toBeLessThanOrEqual(7)
        expect(part.getY(i)).toBeLessThan(PALETTE_SLOTS + FIXED_COLORS.length)
        expect(Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))).toBe(true)
      }
    }
  })

  it('vehicle handles sit where the pusher holds them (the pusher is the origin, the handle HANDLE.ahead in front)', () => {
    const veh = buildVehicleGeometry().geometry
    const pos = veh.getAttribute('position')
    const part = veh.getAttribute('aPart')
    for (const kind of [VEHICLE.wheelchair, VEHICLE.stretcher, VEHICLE.cleaningCart, VEHICLE.linenCart]) {
      // some vertex of this kind is within 3 cm of the right-hand grip, in the vehicle's own frame
      const gz = HANDLE.ahead - VEHICLE_AHEAD[kind]
      let best = 9
      for (let i = 0; i < pos.count; i++) {
        if (part.getX(i) !== kind) continue
        best = Math.min(best, Math.hypot(pos.getX(i) + HANDLE.half, pos.getY(i) - HANDLE.y, pos.getZ(i) - gz))
      }
      expect(best).toBeLessThan(0.03)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

function ent(over: Partial<Entity> = {}): Entity {
  return {
    id: 'ped-1',
    role: 'nurse',
    name: 'Test',
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    speed: 0,
    anim: 'idle',
    mood: 'neutral',
    emote: 'none',
    tier: 'near',
    variant: 3,
    ...over,
  }
}

function world(entities: Map<string, Entity>, over: Partial<FrameInput> = {}): FrameInput {
  return { dt: 1 / 60, time: 0, camX: 0, camY: 50, camZ: 60, entities, followId: null, selectedId: null, hoverId: null, ...over }
}

describe('crowd model', () => {
  it('draws everyone, fades newcomers in and leavers out without popping', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>()
    es.set('ped-1', ent({ id: 'ped-1' }))
    m.update(world(es))
    expect(m.stats.people).toBe(1)
    es.set('ped-2', ent({ id: 'ped-2', position: { x: 2, y: 0, z: 2 } }))
    m.update(world(es))
    const slot = m.get('ped-2')!
    expect(slot.presence).toBeLessThan(0.1) // fading in where they stand
    let last = slot.presence
    for (let i = 0; i < 40; i++) {
      m.update(world(es))
      expect(slot.presence).toBeGreaterThanOrEqual(last)
      last = slot.presence
    }
    expect(slot.presence).toBe(1)
    es.delete('ped-2')
    m.update(world(es))
    expect(m.get('ped-2')!.ghost).toBe(true)
    expect(m.get('ped-2')!.presence).toBeGreaterThan(0.9) // still standing there
    expect(m.get('ped-2')!.x).toBe(2)
    let prev = m.get('ped-2')!.presence
    for (let i = 0; i < 40; i++) {
      m.update(world(es))
      const g = m.get('ped-2')
      if (!g) break
      expect(g.presence).toBeLessThanOrEqual(prev)
      prev = g.presence
    }
    expect(m.get('ped-2')).toBeUndefined()
    expect(m.stats.people).toBe(1)
  })

  it("the sim's fade gives monotonic visibility: coverage follows fade, up and down, and a person at fade 0 is not drawn", () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>()
    const e = ent({ id: 'arriving', fade: 0 })
    es.set(e.id, e)
    m.update(world(es))
    expect(m.stats.people).toBe(0)
    expect(m.stats.high + m.stats.mid + m.stats.far).toBe(0)
    let lastCover = -1
    for (let i = 1; i <= 20; i++) {
      e.fade = i / 20
      m.update(world(es))
      const slot = m.get(e.id)!
      const lod = slot.row * ROW_FLOATS + TEX.lod * 4
      const cover = coverage([m.data[lod], m.data[lod + 1], m.data[lod + 2]])
      const total = cover.high + cover.mid + cover.far
      expect(total).toBeCloseTo(e.fade, 5)
      expect(total).toBeGreaterThan(lastCover)
      lastCover = total
    }
    for (let i = 19; i >= 0; i--) {
      e.fade = i / 20
      m.update(world(es))
      const slot = m.get(e.id)!
      const lod = slot.row * ROW_FLOATS + TEX.lod * 4
      const total = m.data[lod + 2]
      expect(total).toBeCloseTo(e.fade, 5)
    }
    expect(m.stats.people).toBe(0)
  })

  it('never culls by distance and never pops: at every distance a person is drawn by the three bodies together at full presence', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>([['p', ent({ id: 'p' })]])
    for (let d = 3; d <= 400; d += 7) {
      m.update(world(es, { camX: d, camY: 1, camZ: 0 }))
      const slot = m.get('p')!
      const lod = slot.row * ROW_FLOATS + TEX.lod * 4
      expect(m.data[lod + 2]).toBeCloseTo(1, 6) // dither covers every pixel [0, 1)
      expect(m.data[lod]).toBeLessThanOrEqual(m.data[lod + 1])
      expect(m.stats.high + m.stats.mid + m.stats.far).toBeGreaterThanOrEqual(1)
    }
  })

  it('writes finite data, puts rows in the right LOD lists and never exceeds the texture', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>()
    for (let i = 0; i < 150; i++) es.set(`ped-${i}`, ent({ id: `ped-${i}`, position: { x: (i % 15) * 20 - 150, y: 0, z: Math.floor(i / 15) * 20 - 80 }, speed: 1.4, anim: 'walk' }))
    for (let f = 0; f < 5; f++) m.update(world(es))
    expect(m.stats.people).toBe(150)
    expect(m.stats.high + m.stats.mid + m.stats.far).toBeGreaterThanOrEqual(150)
    expect(m.stats.far).toBeGreaterThan(0)
    for (let i = 0; i < 150 * ROW_FLOATS; i++) expect(Number.isFinite(m.data[i])).toBe(true)
    expect(MAX_PEOPLE * ROW_FLOATS).toBe(m.data.length)
    const slot = m.get('ped-0')!
    const lod = slot.row * ROW_FLOATS + TEX.lod * 4
    expect(m.data[lod + 2]).toBeCloseTo(1, 5)
  })

  it('survives more people than the texture holds', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>()
    for (let i = 0; i < MAX_PEOPLE + 20; i++) es.set(`p${i}`, ent({ id: `p${i}`, position: { x: i, y: 0, z: 0 } }))
    m.update(world(es))
    expect(m.stats.people).toBe(MAX_PEOPLE)
    expect(m.stats.overflow).toBe(20)
  })

  it('a patient who is admitted changes from everyday clothes into a gown, keeping the same body', () => {
    const m = new CrowdModel()
    const e = ent({ id: 'er-7', role: 'patient', outfit: 'everyday' })
    const es = new Map([[e.id, e]])
    m.update(world(es))
    const slot = m.get(e.id)!
    const before = slot.look
    e.outfit = 'gown'
    m.update(world(es))
    expect(slot.look.top.toLowerCase()).toBe(TONE.gown)
    expect(slot.look.skin).toBe(before.skin)
    // the palette texels follow
    const pal = slot.row * ROW_FLOATS + (TEX.palette + 2) * 4
    expect(m.data[pal + 2]).toBeGreaterThan(m.data[pal]) // blue-ish
  })

  it('measures real motion: a walker steps, a person the sim paused stands still', () => {
    const m = new CrowdModel()
    const e = ent({ id: 'walker', anim: 'walk', speed: 1.3 })
    const es = new Map([[e.id, e]])
    for (let i = 0; i < 180; i++) {
      e.position.z += 1.3 / 60
      m.update(world(es, { time: i / 60 }))
    }
    const slot = m.get(e.id)!
    expect(slot.speed).toBeGreaterThan(1.1)
    expect(slot.rig.planter.steps).toBeGreaterThan(3)
    const steps = slot.rig.planter.steps
    for (let i = 0; i < 120; i++) m.update(world(es, { time: 3 + i / 60 })) // paused: the position does not change
    expect(slot.speed).toBe(0)
    expect(slot.rig.planter.steps).toBeLessThanOrEqual(steps + 2)
  })
})

describe('held items in the model', () => {
  const draw = (e: Entity) => {
    const m = new CrowdModel()
    const es = new Map([[e.id, e]])
    for (let i = 0; i < 90; i++) m.update(world(es, { time: i / 60 }))
    return m
  }
  it('the right hand takes the prop the sim names; a tablet or a mop comes with the animation', () => {
    const kinds: [PropKind, number][] = [
      ['tablet', PROP.tablet],
      ['folder', PROP.folder],
      ['tray', PROP.tray],
      ['coffee', PROP.cup],
      ['bag', PROP.bag],
      ['flowers', PROP.flowers],
    ]
    for (const [name, kind] of kinds) {
      const m = draw(ent({ prop: name }))
      expect(m.stats.props).toBe(1)
      expect(m.propKinds[0]).toBe(kind)
      expect(m.propRows[0]).toBe(m.get('ped-1')!.row)
    }
    // no prop, no draw
    expect(draw(ent({})).stats.props).toBe(0)
    // 'tablet' with nothing in the hand still shows the tablet; 'clean' shows the mop; 'carry' shows a folder
    expect(draw(ent({ anim: 'tablet' })).propKinds[0]).toBe(PROP.tablet)
    expect(draw(ent({ anim: 'clean', role: 'cleaner' })).propKinds[0]).toBe(PROP.mop)
    expect(draw(ent({ anim: 'carry' })).propKinds[0]).toBe(PROP.folder)
    // a patient in bed holds nothing
    expect(draw(ent({ role: 'patient', anim: 'lie', prop: 'bag' })).stats.props).toBe(0)
  })
})

describe('vehicles and riders', () => {
  const pusher = (over: Partial<Entity> = {}) => ent({ id: 'porter-1', role: 'porter', anim: 'push', vehicle: 'wheelchair', ...over })
  const rider = (over: Partial<Entity> = {}) => ent({ id: 'pt-1', role: 'patient', anim: 'sit', vehicle: 'wheelchair', riding: true, outfit: 'gown', ...over })
  const settle = (es: Map<string, Entity>, frames = 30) => {
    const m = new CrowdModel()
    for (let i = 0; i < frames; i++) m.update(world(es, { time: i / 60 }))
    return m
  }

  it('only the pusher draws the vehicle: the rider is not double-drawn', () => {
    for (const [vehicle, kind] of [
      ['wheelchair', VEHICLE.wheelchair],
      ['stretcher', VEHICLE.stretcher],
    ] as [VehicleKind, number][]) {
      const a = pusher({ vehicle })
      const b = rider({ vehicle, anim: vehicle === 'stretcher' ? 'lie' : 'sit', position: { x: 0, y: 0, z: 0.8 } })
      const m = settle(
        new Map([
          [a.id, a],
          [b.id, b],
        ]),
      )
      expect(m.stats.people).toBe(2)
      expect(m.stats.vehicles).toBe(1)
      expect(m.vehKinds[0]).toBe(kind)
      expect(m.vehRows[0]).toBe(m.get(a.id)!.row) // the pusher's row
      expect(m.get(b.id)!.vKind).toBe(0)
      expect(m.get(a.id)!.vKind).toBe(kind)
      expect(m.get(b.id)!.pusher).toBe(m.get(a.id))
      expect(m.vehOffs[0]).toBeCloseTo(VEHICLE_AHEAD[kind], 6)
    }
  })

  it('anyone with a vehicle in front of them has both hands on its handle, whatever animation the sim named', () => {
    for (const anim of ['walk', 'idle', 'push'] as AnimState[]) {
      const a = pusher({ anim, vehicle: 'cleaningCart', role: 'cleaner' })
      const m = settle(new Map([[a.id, a]]), 60)
      expect(m.get(a.id)!.mode).toBe('push')
    }
  })

  it('a pusher with an empty wheelchair or a cart draws the vehicle; a parked rider draws its own', () => {
    for (const [v, kind] of [
      ['wheelchair', VEHICLE.wheelchair],
      ['cleaningCart', VEHICLE.cleaningCart],
      ['linenCart', VEHICLE.linenCart],
    ] as [VehicleKind, number][]) {
      const m = settle(new Map([['x', pusher({ id: 'x', vehicle: v })]]))
      expect(m.stats.vehicles).toBe(1)
      expect(m.vehKinds[0]).toBe(kind)
    }
    const parked = rider({ position: { x: 20, y: 0, z: 5 } })
    const m = settle(new Map([[parked.id, parked]]))
    expect(m.stats.vehicles).toBe(1)
    expect(m.vehOffs[0]).toBe(0) // under the rider
    expect(m.vehRows[0]).toBe(m.get(parked.id)!.row)
  })

  it('the vehicle follows the pusher at their heading: the rider sits exactly where the vehicle is, whichever way they face', () => {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.4]) {
      for (const [vehicle, ahead] of [
        ['wheelchair', VEHICLE_AHEAD[VEHICLE.wheelchair]],
        ['stretcher', VEHICLE_AHEAD[VEHICLE.stretcher]],
      ] as [VehicleKind, number][]) {
        const a = pusher({ vehicle, heading, position: { x: 10, y: 0, z: -4 } })
        // the sim puts the rider about 0.8 m ahead, give or take
        const b = rider({ vehicle, heading, anim: vehicle === 'stretcher' ? 'lie' : 'sit', position: { x: 10 + Math.sin(heading) * 0.8, y: 0, z: -4 + Math.cos(heading) * 0.8 } })
        const m = settle(
          new Map([
            [a.id, a],
            [b.id, b],
          ]),
        )
        const ps = m.get(a.id)!
        const rs = m.get(b.id)!
        // the GPU places the vehicle at root + R(heading) * (0, 0, off)
        const vx = ps.x + Math.sin(ps.heading) * m.vehOffs[0]
        const vz = ps.z + Math.cos(ps.heading) * m.vehOffs[0]
        expect(rs.x).toBeCloseTo(vx, 5)
        expect(rs.z).toBeCloseTo(vz, 5)
        expect(rs.heading).toBeCloseTo(ps.heading, 9)
        expect(vx).toBeCloseTo(10 + Math.sin(heading) * ahead, 5)
        expect(vz).toBeCloseTo(-4 + Math.cos(heading) * ahead, 5)
        // and the pose texture agrees
        const root = rs.row * ROW_FLOATS
        expect(m.data[root]).toBeCloseTo(vx, 4)
        expect(m.data[root + 2]).toBeCloseTo(vz, 4)
      }
    }
  })

  it('moves with the pusher without sliding: the rider stays on the vehicle every frame of a walk', () => {
    const a = pusher({ heading: 0.5, speed: 1.2, anim: 'push' })
    const b = rider({ heading: 0.5, position: { x: Math.sin(0.5) * 0.8, y: 0, z: Math.cos(0.5) * 0.8 } })
    const es = new Map([
      [a.id, a],
      [b.id, b],
    ])
    const m = new CrowdModel()
    for (let i = 0; i < 300; i++) {
      a.position.x += (Math.sin(0.5) * 1.2) / 60
      a.position.z += (Math.cos(0.5) * 1.2) / 60
      b.position.x = a.position.x + Math.sin(0.5) * 0.8
      b.position.z = a.position.z + Math.cos(0.5) * 0.8
      m.update(world(es, { time: i / 60 }))
      const ps = m.get(a.id)!
      const rs = m.get(b.id)!
      expect(Math.hypot(rs.x - (ps.x + Math.sin(ps.heading) * VEHICLE_AHEAD[VEHICLE.wheelchair]), rs.z - (ps.z + Math.cos(ps.heading) * VEHICLE_AHEAD[VEHICLE.wheelchair]))).toBeLessThan(1e-4)
    }
    expect(m.get(a.id)!.speed).toBeGreaterThan(1)
    // the rider is seated and still: no gait of its own
    expect(m.get(b.id)!.speed).toBe(0)
    expect(m.get(b.id)!.rig.planter.steps).toBe(0)
  })

  it('blob shadows: one under every person and every vehicle, none under a bed', () => {
    const a = pusher({ vehicle: 'wheelchair' })
    const b = rider({ position: { x: 0, y: 0, z: 0.8 } })
    const lying = ent({ id: 'bed-1', role: 'patient', anim: 'lie', position: { x: 30, y: 0, z: 0 } })
    const m = settle(
      new Map([
        [a.id, a],
        [b.id, b],
        [lying.id, lying],
      ]),
    )
    expect(m.stats.blobs).toBe(3 + 1 - 1) // pusher, rider, the wheelchair; the patient on the bed has none
    for (let i = 0; i < m.stats.blobs; i++) {
      expect(m.blobFade[i]).toBeGreaterThan(0.8)
      expect(m.blobMatrix[i * 16 + 15]).toBe(1)
      expect(m.blobMatrix[i * 16 + 13]).toBeGreaterThan(0) // lifted a touch above the floor
    }
  })
})

describe('picking people in the model', () => {
  it('finds standing, seated and lying people under a ray, nearest first', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>([
      ['stand', ent({ id: 'stand', position: { x: 0, y: 0, z: 0 } })],
      ['sit', ent({ id: 'sit', anim: 'sit', position: { x: 10, y: 0.45, z: 0 } })],
      ['lie', ent({ id: 'lie', role: 'patient', anim: 'lie', position: { x: 20, y: 0, z: 0 }, heading: 0 })],
    ])
    for (let i = 0; i < 5; i++) m.update(world(es, { camX: 10, camY: 30, camZ: 30 }))
    const from = (x: number, y: number, z: number): [number, number, number, number, number, number] => {
      const dx = x - 10
      const dy = y - 30
      const dz = z - 30
      const l = Math.hypot(dx, dy, dz)
      return [10, 30, 30, dx / l, dy / l, dz / l]
    }
    expect(m.pick(...from(0, 0.9, 0))).toBe('stand')
    expect(m.pick(...from(10, 0.9, 0))).toBe('sit')
    expect(m.pick(...from(20, LIE.bed + 0.1, 0.2))).toBe('lie')
    expect(m.pick(...from(-30, 0.9, 0))).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Allocation-free frames are checked by src/scene/frameAllocations.test.ts; here: the model does not grow its arrays after warm-up
// ---------------------------------------------------------------------------------------------

describe('steady state', () => {
  it('every instance list has a fixed capacity: nothing grows while the crowd runs', () => {
    const m = new CrowdModel()
    const caps = [m.data.length, m.rowsHigh.length, m.rowsMid.length, m.rowsFar.length, m.propRows.length, m.vehRows.length, m.blobMatrix.length, m.blobFade.length]
    const es = new Map<string, Entity>()
    for (let i = 0; i < 60; i++) es.set(`p${i}`, ent({ id: `p${i}`, position: { x: i, y: 0, z: 0 }, prop: i % 3 === 0 ? 'bag' : 'none' }))
    for (let f = 0; f < 30; f++) m.update(world(es))
    expect([m.data.length, m.rowsHigh.length, m.rowsMid.length, m.rowsFar.length, m.propRows.length, m.vehRows.length, m.blobMatrix.length, m.blobFade.length]).toEqual(caps)
    expect(FADE_SECONDS).toBeGreaterThan(0.2)
  })
})
