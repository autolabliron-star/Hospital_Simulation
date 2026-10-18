// W3 "Real": the player's legs and body feel, in node (no GL). The doctor is the entity `player`, drawn by the instanced crowd; its slot is driven by the true
// body (the contract `walkBody`, state.ts) instead of a velocity measured afterwards. playerDrive.testkit.ts drives the rig the way the player system does:
// the speed follows a critically damped spring (CONFIG.player.startSeconds / stopSeconds / shiftSeconds), the heading turns with the configured time, and
// the rig is handed the true velocity and the intent (what the keys ask for, the acceleration, the turn rate, the rest point).
//
// What these tests pin down:
//   - every NPC is bit-identical with and without the driven player (the whole crowd model, every row of the pose texture)
//   - starting: the first foot is down within 0.2 s, no emergency step, the pelvis never sinks below what a steady stride does
//   - stopping: the last steps land under the body, at most two footfalls once it is still, feet within 12 cm of their rest spots, no hop
//   - walk <-> run, backing up (real steps backwards), turning on the spot (feet alternate, first lift before 0.5 rad of error)
//   - the lean into acceleration and braking, the roll into a curve, the head that leads a turn
//   - footfall counts do not depend on the frame rate; `walkStride` counts one heel strike per landing, alternating feet
//   - NPCs glance at you as you pass, and let go when you leave
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import type { Entity } from '@/sim/types'
import { walkStride } from '@/scene/player/state'
import { P, PART_COUNT, ROW_FLOATS, STAND_HEAD_CENTRE } from './constants'
import { GAIT, DRIVEN } from './gait'
import { LOOK, EYE } from './look'
import { CrowdModel, type DrivenBody, type FrameInput } from './model'
import { LEAN, aimHead, createRig, makeInput, solveRig } from './rig'
import { PLAYER_LOOK, bankOf, drive, leanOf, standingPelvis, type DriveResult, type Script } from './playerDrive.testkit'

const DEG = Math.PI / 180
const STAND = standingPelvis()
const WALK = CONFIG.player.walkSpeed
const RUN = CONFIG.player.hurrySpeed
/** The lowest the pelvis goes below standing in `r` (metres), from script time `from`. */
const drop = (r: DriveResult, from = 0): number => STAND - Math.min(...r.frames.filter((f) => f.t >= from).map((f) => f.pelvisY))
const maxReach = (r: DriveResult): number => Math.max(...r.frames.map((f) => f.reachErr))

// ---------------------------------------------------------------------------------------------
// Every NPC is untouched
// ---------------------------------------------------------------------------------------------
function ent(id: string, role: Entity['role'], over: Partial<Entity> = {}): Entity {
  return { id, role, name: id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'idle', mood: 'neutral', emote: 'none', tier: 'near', variant: 3, ...over }
}

describe('the NPCs are bit-identical with the driven player', () => {
  /** Run the crowd model for `frames` frames of a crowd and a player walking off, stopping and turning; with or without the player's body handed over. */
  function run(driven: boolean, frames = 360): { model: CrowdModel; rows: Float32Array[] } {
    const model = new CrowdModel()
    const es = new Map<string, Entity>()
    const player = ent('player', 'doctor', { position: { x: 0, y: 0, z: 0 } })
    const walker = ent('walker', 'nurse', { anim: 'walk', speed: 1.3 })
    const runner = ent('runner', 'paramedic', { anim: 'run', speed: 4 })
    const stander = ent('stander', 'patient')
    const glancer = ent('glancer', 'visitor', { lookAt: { x: 0.5, y: 1.6, z: 2 } })
    const sitter = ent('sitter', 'receptionist', { anim: 'sit' })
    for (const e of [player, walker, runner, stander, glancer, sitter]) es.set(e.id, e)
    const body: DrivenBody = { live: true, x: 0, z: 0, vx: 0, vz: 0, wishX: 0, wishZ: 0, ax: 0, az: 0, turnRate: 0, stopping: false, restX: 0, restZ: 0 }
    const world: FrameInput = { dt: 1 / 60, time: 0, camX: 0, camY: 1.7, camZ: -4, entities: es, followId: null, selectedId: null, hoverId: null, driven: driven ? body : null }
    let pz = 0
    let v = 0
    for (let i = 0; i < frames; i++) {
      const t = i / 60
      // the player: off at 2 m/s after 0.5 s, stops at 3 s (a simple ramp is enough: the NPC rows must not care)
      const want = t > 0.5 && t < 3 ? WALK : 0
      v += (want - v) * Math.min(1, (1 / 60) * 8)
      pz += v / 60
      player.position.z = pz
      player.speed = v
      player.anim = v > 0.1 ? 'walk' : 'idle'
      body.z = pz
      body.vz = v
      body.wishZ = want
      body.az = (want - v) * 8
      body.stopping = want === 0 && v > 0.05
      body.restZ = pz + v / 8
      // the crowd: the walker and the runner move on, everybody else stays
      walker.position.x = 3 + 1.3 * t
      walker.heading = Math.PI / 2
      runner.position.z = 6 - 4 * t
      runner.heading = Math.PI
      glancer.lookAt = i % 200 < 120 ? { x: 0.5, y: 1.6, z: 2 + pz } : null
      world.time = t
      model.update(world)
    }
    const rows: Float32Array[] = []
    for (const id of ['walker', 'runner', 'stander', 'glancer', 'sitter']) {
      const r = model.get(id)!.row
      rows.push(model.data.slice(r * ROW_FLOATS, (r + 1) * ROW_FLOATS))
    }
    return { model, rows }
  }

  it('writes exactly the same pose texture row for every other person, and a different one for the player', () => {
    const a = run(false)
    const b = run(true)
    for (let i = 0; i < a.rows.length; i++) {
      expect(a.rows[i].length).toBe(ROW_FLOATS)
      for (let k = 0; k < ROW_FLOATS; k++) expect(Object.is(a.rows[i][k], b.rows[i][k]), `row ${i} float ${k}`).toBe(true)
    }
    // the driven path was in use: the player's rig leaned into the stop, which the measured one never does
    expect(b.model.get('player')!.rig.lean).not.toBe(0)
    expect(a.model.get('player')!.rig.lean).toBe(0)
    // and nobody else's rig knows about it
    for (const id of ['walker', 'runner', 'stander', 'glancer', 'sitter']) {
      expect(b.model.get(id)!.rig.lean).toBe(0)
      expect(b.model.get(id)!.rig.roll).toBe(0)
    }
  })

  it('measures the player like everybody else while the player system is not live, when the body is not where the entity is (a Jump), or when the body says it is moving and the avatar is not (the overview leaves the last velocity in it)', () => {
    const model = new CrowdModel()
    const es = new Map<string, Entity>()
    const player = ent('player', 'doctor')
    es.set('player', player)
    const body: DrivenBody = { live: false, x: 0, z: 0, vx: 0, vz: 2, wishX: 0, wishZ: 2, ax: 0, az: 0, turnRate: 0, stopping: false, restX: 0, restZ: 0 }
    const world: FrameInput = { dt: 1 / 60, time: 0, camX: 0, camY: 1.7, camZ: -4, entities: es, followId: null, selectedId: null, hoverId: null, driven: body }
    const step = (n: number, move: boolean): void => {
      for (let i = 0; i < n; i++) {
        if (move) {
          player.position.z += 2 / 60
          body.z = player.position.z
        }
        model.update(world)
      }
    }
    // not live: the slot is measured (the entity does not move, so its speed is 0)
    step(30, false)
    expect(model.get('player')!.speed).toBe(0)
    // live, and the avatar moves with the body: driven (the true 2 m/s at once, where a measured one would still be climbing to it)
    body.live = true
    step(1, true)
    expect(model.get('player')!.speed).toBeCloseTo(2, 6)
    // the body is somewhere else (a Jump swapped the sim): measured
    body.x = 40
    step(30, true)
    expect(model.get('player')!.speed).toBeCloseTo(2, 1)
    expect(model.get('player')!.rig.planter.moving).toBe(true)
    body.x = 0
    // stale: the body still says 2 m/s but the avatar has stopped (the overview): measured, so 0 once the measured speed has settled
    step(60, false)
    expect(model.get('player')!.speed).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------------------------
describe('starting', () => {
  for (const [name, v, limit] of [
    ['walking', WALK, 0.08],
    ['running', RUN, 0.09],
  ] as const) {
    it(`${name}: a foot is down within 0.2 s, no emergency step, the pelvis never sinks more than ${limit * 100} cm, and the legs always reach`, () => {
      const r = drive({ speed: () => v, dir: () => 0 }, 6)
      expect(r.finite).toBe(true)
      expect(r.strikes[0].t, `first footfall at ${v}`).toBeLessThanOrEqual(0.2)
      expect(r.forced, `emergency steps starting at ${v}`).toBe(0)
      expect(drop(r), `pelvis drop starting at ${v}`).toBeLessThanOrEqual(limit)
      expect(maxReach(r)).toBeLessThan(0.02)
      // the first step is up on the first frame the keys ask for it
      expect(r.lifts.filter((l) => l.t >= 0)[0].t).toBeLessThanOrEqual(1 / 60 + 1e-9)
    })

    it(`${name}: the steps of the start grow into the steady rhythm: lifts come further apart, never closer, and the first four step lengths grow`, () => {
      const r = drive({ speed: () => v, dir: () => 0 }, 6)
      const lifts = r.lifts.filter((l) => l.t >= 0).map((l) => l.t)
      const gaps = lifts.slice(1).map((t, i) => t - lifts[i])
      // alternating feet from the very first step
      const feet = r.lifts.filter((l) => l.t >= 0).map((l) => l.foot)
      for (let i = 1; i < feet.length; i++) expect(feet[i]).not.toBe(feet[i - 1])
      // each gap is at least about as long as the last (a step or two of the ramp can wobble by a few frames), and the steady gap is the longest
      for (let i = 1; i < 6; i++) expect(gaps[i], `gap ${i} at ${v}`).toBeGreaterThan(gaps[i - 1] - 0.05)
      expect(gaps[0]).toBeLessThan(gaps[gaps.length - 1] * 0.8)
    })

    it(`${name}: a start is no deeper than a steady stride by more than ${v > 3 ? 4 : 1.5} cm`, () => {
      const steady = drive({ speed: () => v, dir: () => 0 }, 10)
      const start = drive({ speed: () => v, dir: () => 0 }, 3)
      expect(drop(start)).toBeLessThanOrEqual(drop(steady, 3) + (v > 3 ? 0.04 : 0.015))
    })
  }

  it('answers the keys at once where the measured planner needed a third of a second: a foot down at 0.18 s against 0.55, the same body', () => {
    for (const v of [WALK, RUN]) {
      const measured = drive({ speed: () => v, dir: () => 0 }, 3, { driven: false })
      const driven = drive({ speed: () => v, dir: () => 0 }, 3)
      expect(driven.strikes[0].t).toBeLessThan(measured.strikes[0].t - 0.2)
      expect(driven.forced).toBeLessThanOrEqual(measured.forced)
      expect(drop(driven)).toBeLessThanOrEqual(drop(measured) + 0.01)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------------------------------------
describe('stopping', () => {
  /** Stop from `v` at 16 different moments of the stride (a stop is a different thing at each phase of the walk). */
  function stops(v: number): { r: DriveResult; T: number; still: number }[] {
    const out: { r: DriveResult; T: number; still: number }[] = []
    for (let k = 0; k < 16; k++) {
      const T = 2 + k * 0.03
      const r = drive({ speed: (t) => (t < T ? v : 0), dir: () => 0 }, T + 3)
      const still = r.frames.find((f) => f.t > T && f.speed < 0.05)!
      out.push({ r, T, still: still.t })
    }
    return out
  }

  for (const v of [1.0, 1.5, WALK, 3.0, RUN]) {
    it(`from ${v} m/s: at most 2 footfalls once the body is still, feet within 12 cm of their rest spots 0.35 s later, no hop, no landing past the rest point`, () => {
      for (const { r, T, still } of stops(v)) {
        const label = `${v} m/s, released at ${T.toFixed(2)}`
        expect(r.finite).toBe(true)
        expect(r.strikes.filter((s) => s.t > still).length, `footfalls after the stop, ${label}`).toBeLessThanOrEqual(2)
        const later = r.frames.find((f) => f.t >= still + 0.35)!
        expect(Math.max(...later.footHome), `feet from their rest spots, ${label}`).toBeLessThan(0.12)
        // no hop: never both feet in the air once the body is down to a walk
        expect(r.frames.filter((f) => f.t > T && f.bothAir && f.speed < 1).length, `hop, ${label}`).toBe(0)
        // the last steps land under the body: nothing lands more than 10 cm past where it stops
        for (const s of r.strikes.filter((s) => s.t > T)) expect(s.fz - r.z, `landing past the rest point, ${label}`).toBeLessThan(0.1)
        expect(maxReach(r)).toBeLessThan(0.02)
      }
    })
  }

  it('the pelvis never sinks more than 9 cm in a stop from a walk or a run, at any phase of the stride', () => {
    for (const v of [WALK, RUN])
      for (const { r, T } of stops(v)) expect(drop(r, T - 0.5), `${v} m/s released at ${T.toFixed(2)}`).toBeLessThan(0.09)
  })

  it('a stop takes steps that follow the body: the speed has fallen to nothing within 0.4 s of letting go (the spring, not the legs)', () => {
    for (const v of [WALK, RUN]) for (const { T, still } of stops(v)) expect(still - T).toBeLessThan(0.4)
  })
})

// ---------------------------------------------------------------------------------------------
// Walk <-> run
// ---------------------------------------------------------------------------------------------
describe('switching between a walk and a run', () => {
  it('every 2 s for 20 s: at most one emergency step and the pelvis never sinks more than 12 cm', () => {
    const r = drive({ speed: (t) => (t % 4 < 2 ? WALK : RUN), dir: () => 0 }, 20)
    expect(r.finite).toBe(true)
    expect(r.forced).toBeLessThanOrEqual(1)
    expect(drop(r)).toBeLessThanOrEqual(0.12)
    expect(maxReach(r)).toBeLessThan(0.02)
    // the run pose follows the speed closely (rate 20), not 0.2 s behind it
    const f = r.frames.find((x) => x.t > 2.2 && x.speed > 3)!
    expect(f.run).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Backing up (the easy scheme's S key: 1 m/s backwards, facing forward)
// ---------------------------------------------------------------------------------------------
describe('backing up', () => {
  const script: Script = { speed: (t) => (t >= 0 && t < 6 ? 1.0 : 0), dir: () => 0, back: (t) => t >= 0 && t < 7, face: () => 0 }

  it('takes real steps backwards: no emergency step, the feet always reach, each foot lands behind its last landing, 0.35 to 0.6 m a step', () => {
    const r = drive(script, 8)
    expect(r.finite).toBe(true)
    expect(r.forced).toBe(0)
    expect(maxReach(r)).toBeLessThan(0.02)
    // the walk back: from the second step on (the first starts from beside the other foot) up to the last, which closes up
    const walking = r.strikes.filter((s) => s.t < 5.9)
    expect(walking.length).toBeGreaterThan(8)
    const prev: number[] = [NaN, NaN]
    for (const s of walking) {
      if (!Number.isNaN(prev[s.foot])) expect(s.fz, `foot ${s.foot} at ${s.t.toFixed(2)}`).toBeLessThan(prev[s.foot])
      prev[s.foot] = s.fz
    }
    // alternating feet, steps of a human length
    for (let i = 1; i < walking.length; i++) {
      expect(walking[i].foot).not.toBe(walking[i - 1].foot)
      if (i > 2) {
        const len = walking[i - 1].fz - walking[i].fz
        expect(len, `step ${i}`).toBeGreaterThan(0.35)
        expect(len, `step ${i}`).toBeLessThan(0.6)
      }
    }
    // the body keeps facing forward the whole time
    expect(Math.abs(r.heading)).toBeLessThan(1e-6)
    // and steps a little further than the old planner's lunge did: the pelvis stays up
    expect(drop(r)).toBeLessThan(0.07)
  })

  it('swings the arms against the legs as they swing in space, the same as walking forwards: the left arm goes back as the left foot comes forward', () => {
    const corr = (a: number[], b: number[]): number => {
      const ma = a.reduce((x, y) => x + y, 0) / a.length
      const mb = b.reduce((x, y) => x + y, 0) / b.length
      let sxy = 0
      let sxx = 0
      let syy = 0
      for (let i = 0; i < a.length; i++) {
        sxy += (a[i] - ma) * (b[i] - mb)
        sxx += (a[i] - ma) ** 2
        syy += (b[i] - mb) ** 2
      }
      return sxy / Math.sqrt(sxx * syy)
    }
    for (const [name, s] of [
      ['forwards', { speed: () => 1.0, dir: () => 0 }],
      ['backwards', { speed: () => 1.0, dir: () => 0, back: () => true, face: () => 0 }],
    ] as const) {
      const fr = drive(s, 8).frames.filter((f) => f.t > 3)
      const legs = fr.map((f) => f.footAhead[0] - f.footAhead[1])
      expect(corr(fr.map((f) => f.armL), legs), `left arm and legs ${name}`).toBeLessThan(-0.45)
      expect(corr(fr.map((f) => f.armR), legs), `right arm and legs ${name}`).toBeGreaterThan(0.45)
    }
  })
})

describe('curves', () => {
  it('the tightest turns the keys can make (A or D held while walking at 140 degrees a second, running at 200): the feet keep up, with at most one emergency step', () => {
    for (const [v, rate, forced] of [
      [WALK, 140 * DEG, 0],
      [RUN, 200 * DEG, 1],
      [WALK, 0.7, 0],
      [RUN, 1.2, 0],
    ] as const) {
      const r = drive({ speed: () => v, dir: (t) => t * rate }, 8)
      expect(r.finite).toBe(true)
      expect(r.forced, `emergencies at ${v} m/s turning ${rate.toFixed(2)} rad/s`).toBeLessThanOrEqual(forced)
      expect(maxReach(r)).toBeLessThan(0.03)
      expect(drop(r)).toBeLessThan(0.115)
    }
  })

  it('a long steady curve leaves the feet where the legs can carry them: no foot is left more than 0.9 rad (50 degrees) behind the heading', () => {
    for (const [v, rate] of [
      [WALK, 140 * DEG],
      [RUN, 200 * DEG],
    ] as const) {
      const r = drive({ speed: () => v, dir: (t) => t * rate }, 8)
      expect(Math.max(...r.frames.map((f) => Math.max(...f.footYawErr)))).toBeLessThan(0.9)
    }
  })
})

describe('strafing', () => {
  it('sideways at 1.5 m/s (a scheme that does not turn the body to its way): the feet step in turn, never on each other, and always reach', () => {
    for (const side of [-1, 1]) {
      const r = drive({ speed: (t) => (t >= 0 && t < 5 ? 1.5 : 0), dir: () => 0, strafe: () => (side * Math.PI) / 2, face: () => 0 }, 7)
      expect(r.finite).toBe(true)
      expect(r.forced).toBeLessThanOrEqual(1)
      expect(maxReach(r)).toBeLessThan(0.02)
      expect(r.strikes.length).toBeGreaterThan(6)
      for (let i = 1; i < r.strikes.length; i++) expect(r.strikes[i].foot).not.toBe(r.strikes[i - 1].foot)
      // the body keeps facing forward; a foot is never on top of the other
      expect(Math.abs(r.heading)).toBeLessThan(1e-6)
      expect(Math.min(...r.frames.map((f) => Math.abs(f.footAhead[0] - f.footAhead[1])))).toBeGreaterThanOrEqual(0)
      expect(drop(r)).toBeLessThan(0.125)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Turning on the spot (140 degrees a second, A/D held)
// ---------------------------------------------------------------------------------------------
describe('turning on the spot', () => {
  const RATE = 140 * DEG
  // (a turn of exactly pi has no side, so the half turns are 3 degrees short of it)
  for (const angle of [Math.PI / 2, Math.PI - 0.05, -Math.PI / 2, -Math.PI + 0.05, 0.6, 2.5]) {
    it(`${((angle * 180) / Math.PI).toFixed(0)} degrees: the feet alternate, the first lifts before 0.5 rad of error, the turn side first, they end within 0.15 rad of the heading, and the pelvis does not sink`, () => {
      const r = drive({ speed: () => 0, dir: () => 0, face: (t) => (t >= 0.3 ? angle : 0), turnMax: RATE }, 4)
      expect(r.finite).toBe(true)
      expect(r.strikes.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < r.strikes.length; i++) expect(r.strikes[i].foot, `strike ${i}`).not.toBe(r.strikes[i - 1].foot)
      const lifts = r.lifts.filter((l) => l.t > 0.2)
      expect(lifts[0].yawErr).toBeLessThan(0.5)
      // a left turn (positive heading) starts with the left foot
      expect(lifts[0].foot).toBe(angle > 0 ? 0 : 1)
      for (let i = 1; i < lifts.length; i++) expect(lifts[i].foot).not.toBe(lifts[i - 1].foot)
      const last = r.frames[r.frames.length - 1]
      expect(Math.max(...last.footYawErr), 'foot yaw at the end').toBeLessThan(0.15)
      expect(STAND - Math.min(...r.frames.map((f) => f.pelvisY)), 'sink').toBeLessThan(0.03)
      expect(maxReach(r)).toBeLessThan(0.02)
      // the legs never twist more than about 40 degrees behind the body (they used to twist 80)
      const worst = Math.max(...r.frames.map((f) => Math.max(f.footYawErr[0], f.footYawErr[1])))
      expect(worst).toBeLessThan(0.75)
    })
  }

  it('a small turn leaves the feet where they are', () => {
    const r = drive({ speed: () => 0, dir: () => 0, face: (t) => (t >= 0.3 ? 0.3 : 0), turnMax: RATE }, 3)
    expect(r.strikes.length).toBe(0)
  })

  it('does not touch the feet of somebody standing still with no turn: nothing steps for 10 s', () => {
    const r = drive({ speed: () => 0, dir: () => 0 }, 10)
    expect(r.strikes.length).toBe(0)
    expect(r.lifts.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Lean into acceleration, roll into curves, the head that leads
// ---------------------------------------------------------------------------------------------
describe('the body leans', () => {
  /**
   * The rig alone: a body going 2 m/s along its heading for 3 s with an acceleration (m/s^2, along the facing) and a turn rate handed to it, as `walkBody`
   * would. Returns the chest's lean and bank (degrees) averaged over the last half second, and the head's.
   */
  function pose(accel: number, turnRate: number, speed = WALK): { lean: number; bank: number; headBank: number; headYaw: number } {
    const rig = createRig(PLAYER_LOOK)
    const inp = makeInput()
    const out = new Float32Array(PART_COUNT * 12)
    let x = 0
    let z = 0
    let h = 0
    let lean = 0
    let bank = 0
    let headBank = 0
    let n = 0
    for (let i = 0; i < 60 * 3; i++) {
      h += turnRate / 60
      x += (Math.sin(h) * speed) / 60
      z += (Math.cos(h) * speed) / 60
      inp.dt = 1 / 60
      inp.time = i / 60
      inp.x = x
      inp.z = z
      inp.heading = h
      inp.vx = Math.sin(h) * speed
      inp.vz = Math.cos(h) * speed
      inp.speed = speed
      inp.driven = true
      inp.wishX = inp.vx
      inp.wishZ = inp.vz
      inp.ax = Math.sin(h) * accel
      inp.az = Math.cos(h) * accel
      inp.turnRate = turnRate
      aimHead(rig, 1 / 60, inp, STAND_HEAD_CENTRE)
      solveRig(rig, inp, out, 0)
      if (i >= 60 * 2.5) {
        lean += leanOf(out, P.chest)
        bank += bankOf(out, P.chest)
        headBank += bankOf(out, P.head)
        n++
      }
    }
    return { lean: (lean / n) / DEG, bank: (bank / n) / DEG, headBank: (headBank / n) / DEG, headYaw: rig.headLook.yaw / DEG }
  }

  it('leans forward into an acceleration of +3 m/s^2 by 1.5 to 5 degrees, and back under -6 m/s^2 by 1.5 to 6 degrees', () => {
    const rest = pose(0, 0)
    const fwd = pose(3, 0).lean - rest.lean
    const back = rest.lean - pose(-6, 0).lean
    expect(fwd, '+3 m/s^2').toBeGreaterThan(1.5)
    expect(fwd, '+3 m/s^2').toBeLessThan(5)
    expect(back, '-6 m/s^2').toBeGreaterThan(1.5)
    expect(back, '-6 m/s^2').toBeLessThan(6)
  })

  it('the lean is the same shape at each end: more for harder pushes, never more than 7 degrees forward or 4.6 back', () => {
    const rest = pose(0, 0).lean
    let last = 0
    for (const a of [1, 2, 3, 5, 10, 25]) {
      const d = pose(a, 0).lean - rest
      expect(d).toBeGreaterThanOrEqual(last - 1e-6)
      expect(d).toBeLessThanOrEqual(LEAN.forward / DEG + 0.05)
      last = d
    }
    expect(rest - pose(-30, 0).lean).toBeLessThanOrEqual(LEAN.back / DEG + 0.05)
  })

  it('rolls INTO a curve: 2 m/s at 1.5 rad/s rolls the chest towards the side it turns to by 1.5 to 5 degrees (a left turn is a bank to the left)', () => {
    const left = pose(0, 1.5)
    const right = pose(0, -1.5)
    // + is towards the body's left (+X, the way a positive turn rate goes)
    expect(left.bank, 'left turn').toBeGreaterThan(1.5)
    expect(left.bank, 'left turn').toBeLessThan(5)
    expect(right.bank, 'right turn').toBeLessThan(-1.5)
    expect(right.bank, 'right turn').toBeGreaterThan(-5)
    // the head stays more upright than the chest
    expect(Math.abs(left.headBank)).toBeLessThan(Math.abs(left.bank))
    // straight on: level
    expect(Math.abs(pose(0, 0).bank)).toBeLessThan(0.5)
  })

  it('leans only the driven body: the same input without `driven` leaves the trunk where it was', () => {
    const rig = createRig(PLAYER_LOOK)
    const inp = makeInput()
    const out = new Float32Array(PART_COUNT * 12)
    for (let i = 0; i < 120; i++) {
      inp.dt = 1 / 60
      inp.time = i / 60
      inp.z = (2 * i) / 60
      inp.vz = 2
      inp.speed = 2
      inp.ax = 0
      inp.az = 5
      inp.turnRate = 2
      solveRig(rig, inp, out, 0)
    }
    expect(rig.lean).toBe(0)
    expect(rig.roll).toBe(0)
  })

  it('the head turns before the body: a turn at 2.4 rad/s turns the head towards it (up to 0.5 rad), the eyes first, and lets go when the turn ends', () => {
    const left = pose(0, 2.4)
    expect(left.headYaw).toBeGreaterThan(10)
    expect(left.headYaw).toBeLessThan(0.5 / DEG + 1)
    const right = pose(0, -2.4)
    expect(right.headYaw).toBeLessThan(-10)
    expect(Math.abs(pose(0, 0).headYaw)).toBeLessThan(0.01)
    // it comes back: a turn that stops releases the head within half a second
    const r = drive({ speed: () => 0, dir: () => 0, face: (t) => (t >= 0.3 ? Math.PI / 2 : 0), turnMax: 140 * DEG }, 4)
    expect(r.rig.headLook.weight).toBeLessThan(0.01)
    // while it turned the head's lead was set (checked at the peak by running the same turn and stopping part way)
    const mid = drive({ speed: () => 0, dir: () => 0, face: (t) => (t >= 0.3 ? 3.0 : 0), turnMax: 140 * DEG }, 0.9)
    expect(mid.rig.headLook.yaw).toBeGreaterThan(0.3)
    expect(mid.rig.headLook.weight).toBeGreaterThan(0.9)
  })

  it('an NPC glance is not the player\'s business, but a look-at on the driven body wins over the lead: the head goes to the target, not where the turn is going', () => {
    const rig = createRig(PLAYER_LOOK)
    const inp = makeInput()
    const out = new Float32Array(PART_COUNT * 12)
    inp.driven = true
    inp.turnRate = 2
    inp.hasLook = true
    inp.lookX = -3
    inp.lookY = 1.6
    inp.lookZ = 3
    for (let i = 0; i < 60; i++) {
      inp.time = i / 60
      aimHead(rig, 1 / 60, inp, STAND_HEAD_CENTRE)
      solveRig(rig, inp, out, 0)
    }
    // the target is 45 degrees to the right; a left turn would lead to the left
    expect(rig.headLook.yaw).toBeLessThan(-0.5)
  })
})

// ---------------------------------------------------------------------------------------------
// The frame rate
// ---------------------------------------------------------------------------------------------
describe('the frame rate', () => {
  it('does not change how many footfalls a start, a walk and a stop take, at 30, 60 and 144 fps (within one)', () => {
    for (const v of [WALK, RUN]) {
      const counts = [30, 60, 144].map((fps) => drive({ speed: (t) => (t >= 0 && t < 3 ? v : 0), dir: () => 0 }, 6, { dt: 1 / fps }).strikes.length)
      expect(Math.max(...counts) - Math.min(...counts), `${v} m/s: ${counts.join(', ')}`).toBeLessThanOrEqual(1)
    }
    // turning on the spot too
    const turn = [30, 60, 144].map((fps) => drive({ speed: () => 0, dir: () => 0, face: (t) => (t >= 0.3 ? Math.PI : 0), turnMax: 140 * DEG }, 4, { dt: 1 / fps }).strikes.length)
    expect(Math.max(...turn) - Math.min(...turn), `turn: ${turn.join(', ')}`).toBeLessThanOrEqual(1)
    // and backing up
    const back = [30, 60, 144].map((fps) => drive({ speed: (t) => (t >= 0 && t < 4 ? 1 : 0), dir: () => 0, back: (t) => t >= 0 && t < 5, face: () => 0 }, 6, { dt: 1 / fps }).strikes.length)
    expect(Math.max(...back) - Math.min(...back), `back: ${back.join(', ')}`).toBeLessThanOrEqual(1)
  })

  it('keeps the legs reaching and finite at every frame rate', () => {
    for (const fps of [20, 30, 60, 144]) {
      for (const v of [WALK, RUN]) {
        const r = drive({ speed: (t) => (t >= 0 && t < 3 ? v : 0), dir: () => 0 }, 6, { dt: 1 / fps })
        expect(r.finite).toBe(true)
        expect(maxReach(r), `${fps} fps at ${v}`).toBeLessThan(0.02)
        // the first foot is down at the first frame after 0.2 s at the latest
        expect(r.strikes[0].t, `${fps} fps at ${v}`).toBeLessThanOrEqual(0.2 + 1 / fps)
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Any keys at all
// ---------------------------------------------------------------------------------------------
describe('whatever the keys do', () => {
  /** A deterministic stream of numbers in [0, 1). */
  function rng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const KINDS = ['stand', 'walk', 'run', 'back', 'spinL', 'spinR', 'walkL', 'walkR', 'runL', 'runR'] as const
  type Kind = (typeof KINDS)[number]
  /** Random presses of W, S, Shift, A and D, each held for a quarter of a second to two seconds: the easy scheme (A and D turn at 140 degrees a second, 200 running). */
  function keys(seed: number, seconds: number): Script {
    const r = rng(seed)
    const segs: { t0: number; kind: Kind }[] = []
    for (let t = 0; t < seconds; t += 0.25 + r() * 1.8) segs.push({ t0: t, kind: KINDS[Math.floor(r() * KINDS.length)] })
    const rate = (k: Kind): number => (k === 'spinL' || k === 'walkL' ? 140 * DEG : k === 'spinR' || k === 'walkR' ? -140 * DEG : k === 'runL' ? 200 * DEG : k === 'runR' ? -200 * DEG : 0)
    const kindAt = (t: number): Kind => {
      let k = segs[0].kind
      for (const s of segs) if (s.t0 <= t) k = s.kind
      return k
    }
    // the heading the body turns to: the integral of the turn rate
    const heading = (t: number): number => {
      let h = 0
      for (let i = 0; i < segs.length && t > segs[i].t0; i++) h += rate(segs[i].kind) * (Math.min(t, i + 1 < segs.length ? segs[i + 1].t0 : 1e9) - segs[i].t0)
      return h
    }
    return {
      speed: (t) => {
        const k = kindAt(t)
        return k === 'walk' || k === 'walkL' || k === 'walkR' ? WALK : k === 'run' || k === 'runL' || k === 'runR' ? RUN : k === 'back' ? 1 : 0
      },
      dir: heading,
      face: heading,
      back: (t) => kindAt(t) === 'back',
    }
  }

  it('the legs always reach, nothing goes non-finite and the pelvis never sinks more than 17 cm, 12 random minutes at 30, 60 and 144 fps', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const fps = [30, 60, 144][seed % 3]
      const r = drive(keys(seed, 30), 30, { dt: 1 / fps })
      expect(r.finite, `seed ${seed}`).toBe(true)
      expect(maxReach(r), `reach, seed ${seed} at ${fps} fps`).toBeLessThan(0.03)
      expect(drop(r), `pelvis, seed ${seed} at ${fps} fps`).toBeLessThan(0.17)
      // somebody walking, running, backing and turning for half a minute takes steps: and not a foot more often than a person could (a step every 0.12 s at most)
      expect(r.strikes.length).toBeLessThan(30 / 0.12)
      for (let i = 1; i < r.strikes.length; i++) expect(r.strikes[i].t - r.strikes[i - 1].t, `seed ${seed}`).toBeGreaterThanOrEqual(0)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// walkStride: the heel strikes, for the footsteps and the camera bob
// ---------------------------------------------------------------------------------------------
describe('walkStride', () => {
  /** The crowd model with the player walking off from rest, stopping and turning on the spot, frame by frame. */
  function stride(fade: number | undefined): { frames: number; strikes: number[]; model: CrowdModel; trace: { steps: number; foot: number; since: number; phase: number; landed: number }[] } {
    const model = new CrowdModel()
    const es = new Map<string, Entity>()
    const player = ent('player', 'doctor', fade === undefined ? {} : { fade })
    es.set('player', player)
    const body: DrivenBody = { live: true, x: 0, z: 0, vx: 0, vz: 0, wishX: 0, wishZ: 0, ax: 0, az: 0, turnRate: 0, stopping: false, restX: 0, restZ: 0 }
    const world: FrameInput = { dt: 1 / 60, time: 0, camX: 0, camY: 1.7, camZ: -4, entities: es, followId: null, selectedId: null, hoverId: null, driven: body }
    const w = 2.37 * 2
    const strikes: number[] = []
    const trace: { steps: number; foot: number; since: number; phase: number; landed: number }[] = []
    let v = 0
    let a = 0
    let z = 0
    walkStride.steps = 0
    walkStride.foot = 0
    walkStride.sinceStrike = 0
    walkStride.phase = 0
    const frames = 60 * 6
    for (let i = 0; i < frames; i++) {
      const t = i / 60
      const want = t > 0.5 && t < 3 ? WALK : 0
      const sec = want === 0 ? CONFIG.player.stopSeconds : CONFIG.player.startSeconds
      // critically damped speed (what the player system does)
      const omega = w / sec
      a += ((omega * omega) * (want - v) - 2 * omega * a) / 60
      v = Math.max(0, v + a / 60)
      z += v / 60
      player.position.z = z
      body.z = z
      body.vz = v
      body.wishZ = want
      body.az = a
      body.stopping = want === 0 && v > 0.05
      body.restZ = z + (2 * v) / omega + a / (omega * omega)
      world.time = t
      const before = walkStride.steps
      model.update(world)
      strikes.push(walkStride.steps - before)
      trace.push({ steps: walkStride.steps, foot: walkStride.foot, since: walkStride.sinceStrike, phase: walkStride.phase, landed: model.get('player')!.rig.planter.landed })
    }
    return { frames, strikes, model, trace }
  }

  it('puts the first heel strike within 0.2 s of the first key press, through the whole model (the player starts moving at 0.5 s)', () => {
    const r = stride(undefined)
    const first = r.strikes.findIndex((n) => n > 0)
    expect(first / 60 - 0.5).toBeGreaterThan(0)
    expect(first / 60 - 0.5).toBeLessThanOrEqual(0.2)
  })

  it('counts one heel strike per landing of a foot, alternating feet, and the count matches the planter', () => {
    const r = stride(undefined)
    const total = r.strikes.reduce((s, x) => s + x, 0)
    const pl = r.model.get('player')!.rig.planter
    expect(total).toBe(pl.steps)
    expect(total).toBeGreaterThan(6)
    // never more than the two feet in one frame; the increments match what the planter landed in that very frame
    for (let i = 0; i < r.trace.length; i++) {
      expect(r.strikes[i]).toBe(r.trace[i].landed)
      expect(r.strikes[i]).toBeLessThanOrEqual(2)
    }
    // the foot that struck alternates from one strike to the next
    let last = -1
    for (let i = 0; i < r.trace.length; i++) {
      if (r.strikes[i] === 0) continue
      if (last >= 0) expect(r.trace[i].foot, `strike at frame ${i}`).not.toBe(last)
      last = r.trace[i].foot
    }
  })

  it('resets the time since the strike on each strike and runs it on between, and puts the phase at 0 for a left strike and 0.5 for a right one', () => {
    const r = stride(undefined)
    let prev = 0
    for (let i = 0; i < r.trace.length; i++) {
      const t = r.trace[i]
      if (r.strikes[i] > 0) {
        expect(t.since).toBe(0)
        expect(t.phase).toBe(t.foot === 0 ? 0 : 0.5)
      } else if (r.trace[i].steps > 0) expect(t.since).toBeCloseTo(prev + 1 / 60, 9)
      expect(t.phase).toBeGreaterThanOrEqual(0)
      expect(t.phase).toBeLessThan(1)
      prev = t.since
    }
  })

  it('goes on counting when the avatar is invisible (first person), so the footsteps and the bob do not stop', () => {
    const visible = stride(undefined)
    const hidden = stride(0)
    expect(hidden.strikes.reduce((s, x) => s + x, 0)).toBe(visible.strikes.reduce((s, x) => s + x, 0))
    expect(hidden.model.get('player')!.presence).toBeLessThan(0.01)
  })

  it('does not count a thing while the player sits (the legs are put back at rest every frame, and nothing lands)', () => {
    const model = new CrowdModel()
    const es = new Map<string, Entity>()
    const player = ent('player', 'doctor')
    es.set('player', player)
    const body: DrivenBody = { live: true, x: 0, z: 0, vx: 0, vz: 0, wishX: 0, wishZ: 0, ax: 0, az: 0, turnRate: 0, stopping: false, restX: 0, restZ: 0 }
    const world: FrameInput = { dt: 1 / 60, time: 0, camX: 0, camY: 1.7, camZ: -4, entities: es, followId: null, selectedId: null, hoverId: null, driven: body }
    // walk until a foot lands (and sit down on the very next frame, when a stale count would show)
    for (let i = 0; i < 300; i++) {
      player.position.z += WALK / 60
      body.z = player.position.z
      body.vz = WALK
      body.wishZ = WALK
      world.time = i / 60
      model.update(world)
      if (i > 30 && model.get('player')!.rig.planter.landed > 0) break
    }
    expect(model.get('player')!.rig.planter.landed).toBeGreaterThan(0)
    expect(walkStride.steps).toBeGreaterThan(0)
    player.anim = 'sit'
    player.speed = 0
    body.vz = 0
    body.wishZ = 0
    model.update(world)
    const steps = walkStride.steps
    for (let i = 0; i < 120; i++) {
      world.time = 2 + i / 60
      model.update(world)
    }
    expect(walkStride.steps).toBe(steps)
    expect(model.get('player')!.rig.planter.landed).toBe(0)
  })

  it('holds still while standing: no strike, the time since the last one runs on, and the phase stays', () => {
    const r = stride(undefined)
    const end = r.trace[r.trace.length - 1]
    const before = r.trace[r.trace.length - 60]
    expect(end.steps).toBe(before.steps)
    expect(end.phase).toBe(before.phase)
    expect(end.since).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Glances (the sim sets `entity.lookAt` for somebody within CONFIG.player.noticeRadius; the crowd turns the head)
// ---------------------------------------------------------------------------------------------
describe('NPCs glance at you as you pass', () => {
  it('turn their head to a point with a spring (no snap), within what a neck can do, and let go when it is gone', () => {
    const model = new CrowdModel()
    const es = new Map<string, Entity>()
    const npc = ent('nurse', 'nurse', { position: { x: 0, y: 0, z: 0 }, heading: 0 })
    es.set('nurse', npc)
    const world: FrameInput = { dt: 1 / 60, time: 0, camX: 0, camY: 1.7, camZ: 6, entities: es, followId: null, selectedId: null, hoverId: null }
    // you walk past on their left at 2 m/s, 1 m away, from 3 m ahead to 3 m behind: the sim looks at your head the whole time (within the notice radius)
    const yaws: number[] = []
    const weights: number[] = []
    let t = 0
    for (let i = 0; i < 60 * 3; i++) {
      t = i / 60
      const z = 3 - 2 * t
      if (z > -3) npc.lookAt = { x: 1, y: 1.6, z }
      else npc.lookAt = null
      world.time = t
      model.update(world)
      const hl = model.get('nurse')!.rig.headLook
      yaws.push(hl.yaw)
      weights.push(hl.weight)
    }
    const hl = model.get('nurse')!.rig.headLook
    // it looked: ahead-left at first (atan2(1, 3) = 18 degrees), then to the side as you pass, then round to the back where the neck gives up
    expect(Math.max(...weights)).toBeGreaterThan(0.99)
    expect(Math.max(...yaws)).toBeLessThan(LOOK.maxYaw + 1e-6)
    expect(Math.min(...yaws)).toBeGreaterThan(-LOOK.maxYaw - 1e-6)
    expect(yaws[30]).toBeGreaterThan(0.2)
    // no snap: the head never moves faster than the spring's cap
    for (let i = 1; i < yaws.length; i++) expect(Math.abs(yaws[i] - yaws[i - 1])).toBeLessThan(LOOK.maxSpeed / 60 + 1e-9)
    // you are gone (lookAt null from 2.9 s): the head has let go
    for (let i = 0; i < 60; i++) {
      world.time = 3 + i / 60
      model.update(world)
    }
    expect(hl.weight).toBeLessThan(0.01)
    expect(Math.abs(hl.eyeYaw)).toBeLessThan(EYE.maxYaw)
  })

  it('looks at you within a third of a second of the sim asking, and is back within half a second of it letting go', () => {
    const model = new CrowdModel()
    const es = new Map<string, Entity>()
    es.set('visitor', ent('visitor', 'visitor'))
    const world: FrameInput = { dt: 1 / 60, time: 0, camX: 0, camY: 1.7, camZ: 6, entities: es, followId: null, selectedId: null, hoverId: null }
    for (let i = 0; i < 30; i++) model.update(world)
    es.get('visitor')!.lookAt = { x: -1.2, y: 1.6, z: 1.2 }
    const hl = model.get('visitor')!.rig.headLook
    let t = 0
    while (hl.weight < 0.9 && t < 2) {
      model.update(world)
      t += 1 / 60
    }
    expect(t).toBeLessThan(0.35)
    for (let i = 0; i < 30; i++) model.update(world)
    // the target is 45 degrees to the right (-x is the right-hand side): the head carries about that
    expect(hl.yaw).toBeLessThan(-0.6)
    es.get('visitor')!.lookAt = null
    t = 0
    while (hl.weight > 0.02 && t < 2) {
      model.update(world)
      t += 1 / 60
    }
    expect(t).toBeLessThan(0.5)
  })

  it('does not wring its neck for somebody right behind it: a target more than 125 degrees round leaves the head to its own pose', () => {
    const model = new CrowdModel()
    const es = new Map<string, Entity>()
    es.set('porter', ent('porter', 'porter', { lookAt: { x: 0.3, y: 1.6, z: -3 } }))
    const world: FrameInput = { dt: 1 / 60, time: 0, camX: 0, camY: 1.7, camZ: 6, entities: es, followId: null, selectedId: null, hoverId: null }
    for (let i = 0; i < 90; i++) model.update(world)
    expect(model.get('porter')!.rig.headLook.weight).toBeLessThan(0.01)
  })
})

// ---------------------------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------------------------
describe('the driven planner contract', () => {
  it('keeps the numbers the tests above lean on', () => {
    expect(DRIVEN.firstSwing).toBeLessThan(0.2)
    expect(DRIVEN.turnReplant).toBe(0.45)
    expect(DRIVEN.turnLead).toBe(0.15)
    expect(DRIVEN.turnSwing).toBe(0.24)
    expect(DRIVEN.turnGate).toBe(0.6)
    expect(DRIVEN.restThreshold).toBe(0.12)
    expect(GAIT.maxReach).toBeGreaterThan(0.5)
    expect(CONFIG.player.startSeconds).toBe(0.35)
    expect(CONFIG.player.stopSeconds).toBe(0.28)
    expect(CONFIG.player.shiftSeconds).toBe(0.45)
  })
})
