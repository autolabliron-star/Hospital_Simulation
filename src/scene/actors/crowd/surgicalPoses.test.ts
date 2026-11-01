/**
 * R5: the procedure actions' poses (surgicalPoses.ts) through the real rig and its hand-reach solve, for the procedural body and every realistic avatar's own
 * skeleton at 0.94 and 1.06 of its size: every ProcAction has a pose; the hands land on what the pose asks wherever it can be reached; sterile hands stay
 * between the pelvis + 10 cm and the shoulders all through their strokes; the same step progress gives the same hands whatever the frames that led there
 * (the strokes follow the sim, not the clock); nothing is NaN; a change of action (pass -> receive -> suture) moves the hands smoothly.
 */
import { describe, expect, it } from 'vitest'
import { ATTIRE, type ProcAction, type StaffAct, type ToolKind } from '@/sim/types'
import { ACTION_MODE, MODES, MODE_INDEX, modeFor, type Mode } from './blend'
import { NOMINAL_BODY, P, PART_COUNT, standPelvis, type BodyDims } from './constants'
import { lookFor } from './outfit'
import { REACH_L, REACH_R } from './pose'
import { createRig, makeInput, solveRig, type PersonRig, type RigInput } from './rig'
import { ACTION_DEFS, ACTION_MODES, STERILE_BAND } from './surgicalPoses'
import { instrumentKindOf } from './instrumentTable'
import { readIndex } from './avatars.testkit'

type V3 = [number, number, number]
const people = readIndex().avatars
const BODIES: { id: string; body: Readonly<BodyDims> }[] = [{ id: 'procedural', body: NOMINAL_BODY }, ...people.map((a) => ({ id: a.id, body: a.body }))]
const ACTIONS = Object.keys(ACTION_MODE) as ProcAction[]

/** The tools a role holds for each action in the cholecystectomy (what the sim will hand out; the poses are made for them). */
const TOOLS: Partial<Record<ProcAction, [ToolKind, ToolKind]>> = {
  preoxygenate: ['oxygenMask', 'none'],
  bagMask: ['bagValveMask', 'none'],
  intubate: ['laryngoscope', 'breathingTube'],
  injectIv: ['none', 'syringe'],
  injectLocal: ['none', 'syringe'],
  skinPrep: ['none', 'prepStick'],
  markSkin: ['none', 'marker'],
  skinNick: ['none', 'scalpel'],
  insertTrocar: ['none', 'trocar12'],
  holdScope: ['none', 'laparoscope'],
  suction: ['none', 'lapSuction'],
  retractLap: ['none', 'lapGrasper'],
  clipLap: ['none', 'lapClipApplier'],
  closeFascia: ['forceps', 'needleHolder'],
  closeSkin: ['forceps', 'needleHolder'],
  passInstrument: ['none', 'needleHolder'],
  receiveInstrument: ['none', 'none'],
  chart: ['none', 'tablet'],
  tiltTable: ['none', 'tableRemote'],
  insertNeedle: ['none', 'cryoNeedle'],
  applyDressing: ['gauze', 'dressing'],
}

const handMiddle = (out: Float32Array, part: number, hand: number): V3 => {
  const b = part * 12
  return [out[b + 3] - hand * out[b + 1], out[b + 7] - hand * out[b + 5], out[b + 11] - hand * out[b + 9]]
}
const origin = (out: Float32Array, part: number): V3 => [out[part * 12 + 3], out[part * 12 + 7], out[part * 12 + 11]]
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** A world work point in front of a standing person of this skeleton and size: the patient's abdomen on the table, 20 cm over the pelvis, 48 cm ahead. */
function workFor(body: Readonly<BodyDims>, scale: number): V3 {
  return [0.02, standPelvis(body) * scale + 0.2, 0.48]
}

interface Run {
  rig: PersonRig
  inp: RigInput
  out: Float32Array
  t: number
}

function person(body: Readonly<BodyDims>, scale: number, id = 'surgeon'): Run {
  const look = { ...lookFor({ id, role: 'doctor', outfit: 'theatre', variant: 3 }) }
  look.scale = scale
  const rig = createRig(look, body)
  const inp = makeInput()
  inp.posture = 'stand'
  return { rig, inp, out: new Float32Array(PART_COUNT * 12), t: 0 }
}

/** Set the act on the input (the mode as the model picks it) and step `frames` at 60 Hz, the progress from `p0` to `p1`. */
function step(r: Run, action: ProcAction, work: V3 | null, p0: number, p1: number, frames: number, attire = ATTIRE.gloves | ATTIRE.gown | ATTIRE.mask): void {
  const tools = TOOLS[action] ?? ['none', 'none']
  const act: StaffAct = { action, progress: p0, left: tools[0], right: tools[1], work: work ? { x: work[0], y: work[1], z: work[2] } : null }
  const inp = r.inp
  inp.mode = modeFor('idle', 'stand', 'none', act.action, (attire & ATTIRE.gloves) !== 0)
  inp.actOn = true
  inp.attire = attire
  inp.toolL = instrumentKindOf(act.left)
  inp.toolR = instrumentKindOf(act.right)
  inp.hasWork = !!work
  if (work) {
    inp.workX = work[0]
    inp.workY = work[1]
    inp.workZ = work[2]
  }
  for (let i = 0; i < frames; i++) {
    r.t += 1 / 60
    inp.time = r.t
    inp.actProg = frames > 1 ? p0 + ((p1 - p0) * (i + 1)) / frames : p1
    // the sim clock runs with the step (a minute a step): the bag-mask's breaths, which follow the clock, then also meet at the same progress
    inp.simT = 500 + 60 * inp.actProg
    solveRig(r.rig, inp, r.out, 0)
  }
}

/** The pose's reach target of a hand (the blended reach block of the last solve) as a world point of the root frame, and its weight. */
function reachTarget(r: Run, side: 1 | -1): { p: V3; w: number } {
  const up = r.rig.up
  const b = side === 1 ? REACH_L : REACH_R
  const w = up[b]
  const s = r.rig.dims.s
  const sp = standPelvis(r.rig.dims.b)
  return { p: [(up[b + 1] / w) * s, sp * s + (up[b + 2] / w - sp) * s, (up[b + 3] / w) * s], w }
}

describe('every procedure action has a pose', () => {
  it('maps each ProcAction to an action mode with a def; idle is the sterile rest for a gloved person and a plain stand otherwise', () => {
    for (const a of ACTIONS) {
      const m = ACTION_MODE[a]
      expect(MODES, a).toContain(m)
      expect(ACTION_DEFS[m], a).toBeDefined()
    }
    for (const m of ACTION_MODES) expect(MODES).toContain(m as Mode)
    expect(modeFor('idle', 'stand', 'none', 'idle', true)).toBe('sterile')
    expect(modeFor('idle', 'stand', 'none', 'idle', false)).toBe('relaxed')
    expect(modeFor('walk', 'stand', 'none', null, true)).toBe('sterile')
    expect(modeFor('talk', 'stand', 'none', null, false)).toBe('talk')
    // an act wins over the anim; lying always wins; a few actions have a seated pose
    expect(modeFor('give', 'stand', 'none', 'closeSkin', true)).toBe('aSuture')
    expect(modeFor('idle', 'lie', 'none', 'closeSkin', true)).toBe('lie')
    expect(modeFor('console', 'sit', 'none', 'operateConsole', false)).toBe('sitConsole')
    // the action modes follow the old ones (nothing indexes the modes by position before them)
    expect(MODE_INDEX.sterile).toBe(MODE_INDEX.sitConsole + 1)
  })
})

describe('the hands land where the pose asks, for every skeleton', () => {
  it('within 2 cm of every reachable target, for every action, every avatar skeleton and the procedural body, at 0.94 and 1.06', () => {
    const misses: string[] = []
    let checked = 0
    for (const { id, body } of BODIES) {
      for (const scale of [0.94, 1.06]) {
        for (const action of ACTIONS) {
          const r = person(body, scale)
          step(r, action, workFor(body, scale), 0.3, 0.3, 75)
          for (let k = 0; k < r.out.length; k++) if (!Number.isFinite(r.out[k])) misses.push(`${id} ${scale} ${action}: NaN`)
          const reach = (body.upperArm + body.forearm + body.hand) * scale
          for (const [side, hand, arm] of [
            [1, P.handL, P.armL],
            [-1, P.handR, P.armR],
          ] as const) {
            const t = reachTarget(r, side)
            if (!(t.w > 0.99)) continue
            const shoulder = origin(r.out, arm)
            if (dist(shoulder, t.p) > 0.97 * reach) continue
            checked++
            const d = dist(handMiddle(r.out, hand, body.hand * scale), t.p)
            if (d > 0.02) misses.push(`${id} ${scale} ${action} ${side === 1 ? 'L' : 'R'}: ${(d * 100).toFixed(1)} cm`)
          }
        }
      }
    }
    expect(misses).toEqual([])
    expect(checked).toBeGreaterThan(BODIES.length * 2 * ACTIONS.length * 1.5)
  }, 120_000)

  it('the work point is within reach of the shortest arms for the table actions (the chest leans in)', () => {
    const shortest = BODIES.reduce((a, b) => (a.body.upperArm + a.body.forearm < b.body.upperArm + b.body.forearm ? a : b))
    for (const action of ['closeSkin', 'skinNick', 'insertTrocar', 'markSkin', 'skinPrep', 'clipLap'] as ProcAction[]) {
      const r = person(shortest.body, 0.94)
      step(r, action, workFor(shortest.body, 0.94), 0.5, 0.5, 75)
      const reach = (shortest.body.upperArm + shortest.body.forearm + shortest.body.hand) * 0.94
      const t = reachTarget(r, -1)
      expect(dist(origin(r.out, P.armR), t.p), action).toBeLessThan(0.97 * reach)
      expect(dist(handMiddle(r.out, P.handR, shortest.body.hand * 0.94), t.p), action).toBeLessThan(0.02)
    }
  })
})

describe('sterile hands', () => {
  const sterileActions = ACTIONS.filter((a) => ACTION_DEFS[ACTION_MODE[a]].sterile)
  it('stay between the pelvis + 10 cm and the shoulders all through the step, for every skeleton', () => {
    expect(sterileActions.length).toBeGreaterThan(15)
    const out: string[] = []
    for (const { id, body } of BODIES) {
      for (const scale of [0.94, 1.06]) {
        for (const action of sterileActions) {
          const r = person(body, scale)
          step(r, action, workFor(body, scale), 0, 0, 40)
          // through the whole step, slowly enough that no stroke fades
          for (let k = 0; k < 24; k++) {
            step(r, action, workFor(body, scale), k / 24, (k + 1) / 24, 20)
            const pelvis = r.out[P.pelvis * 12 + 7]
            const shoulder = Math.min(r.out[P.armL * 12 + 7], r.out[P.armR * 12 + 7])
            for (const [hand, name] of [
              [P.handL, 'L'],
              [P.handR, 'R'],
            ] as const) {
              const y = handMiddle(r.out, hand, body.hand * scale)[1]
              if (y < pelvis + 0.1 - 0.005 || y > shoulder + 0.005) out.push(`${id} ${scale} ${action} ${name} at ${k}: ${(y - pelvis).toFixed(3)} over the pelvis, ${(shoulder - y).toFixed(3)} under the shoulder`)
            }
          }
        }
      }
    }
    expect(out).toEqual([])
    expect(STERILE_BAND.abovePelvis).toBeGreaterThanOrEqual(0.1)
  }, 120_000)

  it('a gloved person with nothing to do holds the hands clasped above the waist, walking too (no arm swing)', () => {
    const r = person(NOMINAL_BODY, 1)
    r.inp.mode = modeFor('walk', 'stand', 'none', null, true)
    r.inp.attire = ATTIRE.gloves
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < 180; i++) {
      r.t += 1 / 60
      r.inp.time = r.t
      r.inp.x = 1.3 * r.t
      r.inp.vx = 1.3
      r.inp.speed = 1.3
      r.inp.heading = Math.PI / 2
      solveRig(r.rig, r.inp, r.out, 0)
      if (i > 30) {
        const l = handMiddle(r.out, P.handL, NOMINAL_BODY.hand)
        lo = Math.min(lo, l[1])
        hi = Math.max(hi, l[1])
        expect(l[1]).toBeGreaterThan(r.out[P.pelvis * 12 + 7] + 0.1)
      }
    }
    // the hands ride with the chest: a few centimetres of bob, no swing
    expect(hi - lo).toBeLessThan(0.06)
  })
})

describe('the strokes follow the step, not the clock', () => {
  it('the same progress gives the same hands (within 5 mm) whatever the frames that led to it', () => {
    const out: string[] = []
    for (const { id, body } of [BODIES[0], BODIES[1], BODIES[BODIES.length - 1]]) {
      for (const action of ACTIONS) {
        const w = workFor(body, 1)
        // A: straight to 0.43 over 3 s; B: to 0.2, a pause, back to 0.1 (a new step is fine too), then on to 0.43 at another pace
        const a = person(body, 1)
        step(a, action, w, 0, 0.43, 180)
        step(a, action, w, 0.43, 0.43, 90)
        const b = person(body, 1)
        step(b, action, w, 0, 0.2, 50)
        step(b, action, w, 0.2, 0.2, 37)
        step(b, action, w, 0.2, 0.43, 230)
        step(b, action, w, 0.43, 0.43, 90)
        for (const hand of [P.handL, P.handR]) {
          const d = dist(handMiddle(a.out, hand, body.hand), handMiddle(b.out, hand, body.hand))
          if (d > 0.005) out.push(`${id} ${action} ${hand === P.handL ? 'L' : 'R'}: ${(d * 1000).toFixed(1)} mm`)
        }
      }
    }
    expect(out).toEqual([])
  }, 60_000)

  it('a stroke that would run faster than 2 a second fades (a high sim speed does not flicker)', () => {
    const w = workFor(NOMINAL_BODY, 1)
    const slow = person(NOMINAL_BODY, 1)
    step(slow, 'scrubHands', w, 0, 0.1, 120)
    expect(slow.rig.ctx.strokeGain).toBeGreaterThan(0.99)
    const fast = person(NOMINAL_BODY, 1)
    // 10 strokes a step, a step in 2 s: 5 a second
    step(fast, 'scrubHands', w, 0, 0.5, 60)
    expect(fast.rig.ctx.strokeGain).toBeLessThan(0.01)
  })
})

describe('smooth', () => {
  it('a change of action moves the hands, never jumps them (at most 3.5 cm a frame)', () => {
    for (const { body } of [BODIES[0], BODIES[2]]) {
      const r = person(body, 1)
      const w = workFor(body, 1)
      const other: V3 = [0.25, w[1] + 0.05, 0.4]
      let prevL = handMiddle(r.out, P.handL, body.hand)
      let prevR = handMiddle(r.out, P.handR, body.hand)
      let max = 0
      const seq: [ProcAction, V3][] = [
        ['watchField', w],
        ['passInstrument', other],
        ['receiveInstrument', other],
        ['closeSkin', w],
        ['skinPrep', w],
        ['drapePatient', w],
        ['countItems', w],
        ['intubate', w],
        ['idle', w],
      ]
      for (const [action, at] of seq) {
        for (let k = 0; k < 45; k++) {
          step(r, action, at, k / 90, (k + 1) / 90, 1)
          const l = handMiddle(r.out, P.handL, body.hand)
          const h = handMiddle(r.out, P.handR, body.hand)
          if (r.t > 0.2) max = Math.max(max, dist(l, prevL), dist(h, prevR))
          prevL = l
          prevR = h
        }
      }
      expect(max).toBeLessThan(0.035)
    }
  })

  it('the hands start from where they are when an act comes on (the work point is smoothed from them)', () => {
    const r = person(NOMINAL_BODY, 1)
    r.inp.mode = 'relaxed'
    for (let i = 0; i < 30; i++) {
      r.t += 1 / 60
      r.inp.time = r.t
      solveRig(r.rig, r.inp, r.out, 0)
    }
    const before = handMiddle(r.out, P.handR, NOMINAL_BODY.hand)
    step(r, 'skinNick', workFor(NOMINAL_BODY, 1), 0, 0, 1)
    // one frame in, the smoothed work point is still at the hand (it moves at most 1.5 m/s)
    const t = r.rig.ctx.tR
    expect(Math.hypot(t[0] - before[0], t[1] - before[1], t[2] - before[2])).toBeLessThan(1.5 / 60 + 0.01)
  })
})
