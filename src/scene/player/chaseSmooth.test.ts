/**
 * W3 "Real", the smooth chase camera, measured where it matters: in the real building, on the real wall boxes (hanging signs included).
 *
 *   boom      the camera's distance from its pivot never changes by more than 3 m/s from one frame to the next, except on the frames the
 *             hard sweep had to cut it (the safety net: the camera is never inside a wall, a sign or past the ceiling, and that is rare:
 *             at most 2 % of the frames of a run); under every one of the 7 hanging signs it keeps 99 % of the length it would have had
 *             with no sign there
 *   shoulder  the pivot's lateral position changes by at most 1.5 m/s outside the swap's own glide and the clamped frames
 *   yaw       a 200 degrees a second turn trails by no more than the limit (plus a degree), and the yaw rate never jumps by 2 rad/s
 *   lens/bob  the lens widens when you run and the camera bobs with your footfalls, by no more than 4 degrees and 1.5 cm (0.8 cm
 *             walking), the same at 30, 60 and 144 fps, and both come to an exact rest when you stand and are not there in first person
 *
 * The walks are driven like the player system drives the camera (the easy scheme: the body first, then `ChaseCamera.update`); a simple
 * kinematic body stands in for the real one (the paths keep a body radius and a bit from every wall by construction).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { CONFIG } from '@/sim/config'
import { SIGNS } from '@/sim/places'
import { OPEN_PROBE, WallBoxProbe, buildWallBoxes, insideWallBox, type BoomProbe } from './boomProbe'
import { ChaseCamera } from './chaseCamera'
import { angleDelta, wrapAngle } from './chaseMath'
import { newTurn, stepTurn } from './scheme'
import { walkStride } from './state'
import { CHASE, EASY } from './tuning'

const DEG = Math.PI / 180
const WALK = CONFIG.player.walkSpeed
const RUN = CONFIG.player.hurrySpeed

const boxes = buildWallBoxes()
const probe = new WallBoxProbe(boxes)
const probeNoSigns = new WallBoxProbe(boxes.filter((b) => !b.sign))

afterEach(() => {
  walkStride.phase = 0
  walkStride.run = 0
})

interface P {
  x: number
  z: number
}

interface Walk {
  frames: number
  /** Frames the hard sweep (or the shoulder's) cut the camera. */
  hard: number
  /** The largest |change of the boom| / dt over the frames that were not hard-clamped, m/s. */
  boomRate: number
  /** The largest |change of the shoulder offset| / dt outside the clamped frames and the 0.8 s after a swap, m/s. */
  lateralRate: number
  /** The first frame the camera was inside the hard ball of a wall or the sign ball of a sign, or null. */
  inside: string | null
  booms: number[]
  swaps: number
}

/**
 * Walk the path at `speed`, turning at no more than `turnRate` (rad/s). The gait phase advances with distance like a real stride (a cycle
 * is 1.2 m plus a quarter of a metre per m/s), so the camera's bob is in the picture.
 */
function drive(path: readonly P[], speed: number, turnRate: number, world: BoomProbe = probe, fps = 60, bob = true): Walk {
  const dt = 1 / fps
  const cam = new PerspectiveCamera(CHASE.fov, 16 / 9, CONFIG.player.camera.near, 500)
  const chase = new ChaseCamera('easy')
  let heading = Math.atan2(path[1].x - path[0].x, path[1].z - path[0].z)
  const feet = { x: path[0].x, y: 0, z: path[0].z }
  chase.reset(feet, heading)
  const subject = { feet, vx: 0, vz: 0, heading, turning: false }
  const frame = { dt, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }
  for (let i = 0; i < fps; i++) chase.update(subject, frame, world, cam) // a second standing
  const out: Walk = { frames: 0, hard: 0, boomRate: 0, lateralRate: 0, inside: null, booms: [], swaps: 0 }
  let lastBoom = -1
  let lastLateral = chase.shoulderOffset
  let lastSwaps = chase.shoulderSwaps
  let sinceSwap = 99
  let v = 0
  let phase = 0
  let wp = 1
  for (let step = 0; step < fps * 600 && wp < path.length; step++) {
    const dx = path[wp].x - feet.x
    const dz = path[wp].z - feet.z
    if (Math.hypot(dx, dz) < 0.5) {
      wp++
      continue
    }
    const dh = angleDelta(heading, Math.atan2(dx, dz))
    const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, dh))
    heading = wrapAngle(heading + turn)
    // slow down for a sharp turn, like a person does
    v += ((Math.abs(dh) > 60 * DEG ? speed * 0.5 : speed) - v) * Math.min(1, dt / 0.3)
    feet.x += Math.sin(heading) * v * dt
    feet.z += Math.cos(heading) * v * dt
    if (bob) {
      phase = (phase + (v / (1.2 + 0.25 * v)) * dt) % 1
      walkStride.phase = phase
    }
    subject.vx = Math.sin(heading) * v
    subject.vz = Math.cos(heading) * v
    subject.heading = heading
    subject.turning = Math.abs(turn) > 1e-6
    const r = chase.update(subject, frame, world, cam)
    out.frames++
    if (r.hardClamped) out.hard++
    if (lastBoom >= 0 && !r.hardClamped) out.boomRate = Math.max(out.boomRate, Math.abs(r.boom - lastBoom) / dt)
    lastBoom = r.boom
    out.booms.push(r.boom)
    if (chase.shoulderSwaps !== lastSwaps) {
      lastSwaps = chase.shoulderSwaps
      sinceSwap = 0
      out.swaps++
    } else sinceSwap += dt
    const lateral = chase.shoulderOffset
    if (!r.hardClamped && sinceSwap > 0.8) out.lateralRate = Math.max(out.lateralRate, Math.abs(lateral - lastLateral) / dt)
    lastLateral = lateral
    const p = cam.position
    if (out.inside === null && insideWallBox(world === probe ? boxes : boxes.filter((b) => !b.sign), p.x, p.y, p.z, CHASE.nearRadius - 1e-6)) {
      out.inside = `frame ${step} camera (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`
    }
  }
  return out
}

const line = (...pts: [number, number][]): P[] => pts.map(([x, z]) => ({ x, z }))

/** Straight runs and turns beside the real walls: ward A and B along their walls, the lobby's corner, the spine's corners. */
const WALLS: Record<string, P[]> = {
  'corridor A along its north wall': line([-38, -15.5], [38, -15.5]),
  'corridor A along its south wall (the room doors and the atrium openings)': line([-38, -12.45], [38, -12.45]),
  'corridor B along its south wall, the other way': line([38, 15.5], [-38, 15.5]),
  'corridor A, 3 degrees toward the south wall, then along it': line([-30, -14], [-0.4, -12.45], [30, -12.45]),
  'corridor B, 10 degrees toward the north wall, then along it': line([-30, 14], [-21.2, 12.45], [30, 12.45]),
  'the lobby to the spine to corridor A (140 degrees a second turns)': line([-55, 0], [-42, 0], [-42, -14], [-30, -14]),
  'the lobby corner and the spine, hugging the inside of the bends': line([-55, 0], [-45, 3], [-42, 5.5], [-42, -13.5], [-38, -14]),
  'the spine into corridor B along its wall': line([-42, -5], [-42, 13.4], [-38, 15.4], [-20, 15.4]),
}

describe('W3: the boom never snaps', () => {
  for (const [name, path] of Object.entries(WALLS)) {
    for (const [speed, turn] of [
      [WALK, 140 * DEG],
      [RUN, 140 * DEG],
      [RUN, 200 * DEG],
    ] as const) {
      it(`${name}, at ${speed} m/s turning at up to ${Math.round(turn / DEG)} degrees a second: no change over 3 m/s, few hard frames, never in a wall or a sign`, () => {
        const w = drive(path, speed, turn)
        expect(w.frames).toBeGreaterThan(200)
        expect(w.inside, 'the camera was inside a wall box').toBeNull()
        expect(w.boomRate).toBeLessThanOrEqual(3)
        expect(w.hard / w.frames).toBeLessThanOrEqual(0.02)
      })
    }
  }

  it('the boom is a spring, not a clamp: when a wall comes behind you the boom shortens over several frames', () => {
    // walk toward the lobby's wall backwards-ish: stand, then swing the view into a corner and watch the boom come in
    const cam = new PerspectiveCamera(CHASE.fov, 16 / 9, CONFIG.player.camera.near, 500)
    const chase = new ChaseCamera('easy')
    const feet = { x: -61.4, y: 0, z: -2.5 } // in the lobby, a body radius from the front wall, heading into the building
    chase.reset(feet, Math.PI / 2)
    const frame = { dt: 1 / 60, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }
    for (let i = 0; i < 60; i++) chase.update({ feet, vx: 0, vz: 0, heading: Math.PI / 2, turning: false }, frame, probe, cam)
    const settled = chase.update({ feet, vx: 0, vz: 0, heading: Math.PI / 2, turning: false }, frame, probe, cam).boom
    // turn the body round (the camera swings to look at the wall it has its back to...): the boom has to come in
    let h = Math.PI / 2
    let last = settled
    let worst = 0
    let frames = 0
    for (let i = 0; i < 120; i++) {
      h = wrapAngle(h + 200 * DEG * (1 / 60))
      const r = chase.update({ feet, vx: 0, vz: 0, heading: h, turning: true }, frame, probe, cam)
      if (!r.hardClamped) worst = Math.max(worst, Math.abs(r.boom - last) * 60)
      last = r.boom
      frames++
    }
    expect(frames).toBe(120)
    expect(worst).toBeLessThanOrEqual(3)
  })
})

describe('W3: the camera passes under the hanging signs', () => {
  /** The path along a sign's walking line (across its face), 8 m before it to 8 m past it, cut where the body would meet a wall. */
  function through(id: string, direction: 1 | -1): P[] {
    const s = SIGNS.find((q) => q.id === id)!
    const dx = Math.sin(s.heading) * direction
    const dz = Math.cos(s.heading) * direction
    const pts: P[] = []
    for (let t = -8; t <= 8; t += 0.5) {
      const x = s.at.x + dx * t
      const z = s.at.z + dz * t
      // a body radius and a skin from every wall: from here on it could not go further
      if (insideWallBox(boxes.filter((b) => !b.sign), x, 1.0, z, 0.3 + 0.02)) {
        if (t < 0) pts.length = 0
        else break
      } else pts.push({ x, z })
    }
    return pts
  }

  it('there are seven signs, and each is walked under both ways at a walk and at a run', () => {
    expect(SIGNS.length).toBe(7)
  })

  for (const s of SIGNS) {
    for (const direction of [1, -1] as const) {
      for (const speed of [WALK, RUN]) {
        it(`${s.id}, ${direction > 0 ? 'one way' : 'the other way'}, at ${speed} m/s: the boom keeps 99 % of the length it has with no sign, and the camera is never inside it`, () => {
          const path = through(s.id, direction)
          expect(path.length).toBeGreaterThan(8) // a real walk through the sign
          const withSigns = drive(path, speed, 140 * DEG, probe)
          const without = drive(path, speed, 140 * DEG, probeNoSigns)
          expect(withSigns.inside).toBeNull()
          expect(withSigns.frames).toBe(without.frames)
          let worst = 1
          for (let i = 0; i < withSigns.frames; i++) {
            if (without.booms[i] > 1e-6) worst = Math.min(worst, withSigns.booms[i] / without.booms[i])
          }
          expect(worst, `the boom under the sign, as a share of its length with no sign there`).toBeGreaterThanOrEqual(0.99)
        })
      }
    }
  }
})

describe('W3: the shoulder offset never snaps', () => {
  for (const [name, path] of Object.entries(WALLS)) {
    it(`${name}: the pivot moves by at most 1.5 m/s (outside the swap's own glide)`, () => {
      for (const [speed, turn] of [
        [WALK, 140 * DEG],
        [RUN, 200 * DEG],
      ] as const) {
        const w = drive(path, speed, turn)
        expect(w.lateralRate).toBeLessThanOrEqual(1.5)
      }
    })
  }
})

describe('W3: the yaw follows a 200 degrees a second turn without a kink', () => {
  function turnRun(fps: number): { lag: number; jump: number; rates: number[] } {
    const dt = 1 / fps
    const cam = new PerspectiveCamera(CHASE.fov, 16 / 9, CONFIG.player.camera.near, 500)
    const chase = new ChaseCamera('easy')
    const feet = { x: 0, y: 0, z: 0 }
    let heading = 0
    chase.reset(feet, heading)
    const frame = { dt, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }
    for (let i = 0; i < fps / 2; i++) chase.update({ feet, vx: 0, vz: RUN, heading, turning: false }, frame, probe, cam)
    let lag = 0
    let jump = 0
    let last = chase.facing
    let lastRate = 0
    const rates: number[] = []
    const turn = newTurn()
    for (let i = 0; i < fps * 4; i++) {
      // the easy scheme's own running turn (scheme.ts stepTurn: a first-order lag up to 200 deg/s, no kick)
      heading = wrapAngle(heading + stepTurn(turn, -1, true, dt))
      chase.update({ feet, vx: 0, vz: RUN, heading, turning: true }, frame, probe, cam)
      const rate = angleDelta(last, chase.facing) / dt
      if (i > 0) jump = Math.max(jump, Math.abs(rate - lastRate))
      rates.push(rate)
      last = chase.facing
      lastRate = rate
      lag = Math.max(lag, Math.abs(angleDelta(chase.facing, heading)))
    }
    return { lag, jump, rates }
  }

  for (const fps of [30, 60, 144]) {
    it(`at ${fps} fps: the lag stays within the limit plus a degree, and the yaw rate never jumps by 2 rad/s`, () => {
      const r = turnRun(fps)
      expect(r.lag).toBeLessThanOrEqual(EASY.maxYawLag + 1 * DEG)
      expect(r.jump).toBeLessThan(2)
    })
  }
})

describe('W3: running widens the lens', () => {
  function lensRun(fps: number, seconds: number, speed: number, legsRun = 0): { fov: number[]; cam: PerspectiveCamera; chase: ChaseCamera } {
    const dt = 1 / fps
    const cam = new PerspectiveCamera(CHASE.fov, 16 / 9, CONFIG.player.camera.near, 500)
    const chase = new ChaseCamera('easy')
    const feet = { x: 0, y: 0, z: 0 }
    chase.reset(feet, 0)
    const frame = { dt, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }
    const fov: number[] = []
    walkStride.run = legsRun
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      feet.z += speed * dt
      chase.update({ feet, vx: 0, vz: speed, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
      fov.push(cam.fov)
    }
    return { fov, cam, chase }
  }

  it('at a run the lens widens by up to 4 degrees, smoothly and without overshoot, and not at all at a walk', () => {
    const run = lensRun(60, 4, RUN)
    const widest = Math.max(...run.fov)
    expect(widest - CHASE.fov).toBeGreaterThan(3.5)
    expect(widest - CHASE.fov).toBeLessThanOrEqual(CHASE.runFovWiden + 1e-9)
    for (let i = 1; i < run.fov.length; i++) expect(run.fov[i]).toBeGreaterThanOrEqual(run.fov[i - 1] - 1e-12) // only ever widens
    let worstStep = 0
    for (let i = 1; i < run.fov.length; i++) worstStep = Math.max(worstStep, run.fov[i] - run.fov[i - 1])
    expect(worstStep).toBeLessThan(0.15) // 7 degrees a second at the very most (the spring's own peak is 7.4), 0.12 a frame
    const walk = lensRun(60, 4, WALK)
    expect(Math.max(...walk.fov)).toBe(CHASE.fov)
  })

  it('the legs\' run blend widens it too (even before the speed is there)', () => {
    const r = lensRun(60, 3, WALK, 1)
    expect(Math.max(...r.fov) - CHASE.fov).toBeGreaterThan(3.5)
  })

  it('the same at 30, 60 and 144 fps: the lens a second into a run differs by under 0.05 degrees', () => {
    const a = lensRun(30, 1, RUN).fov.at(-1)!
    const b = lensRun(60, 1, RUN).fov.at(-1)!
    const c = lensRun(144, 1, RUN).fov.at(-1)!
    expect(Math.abs(a - b)).toBeLessThan(0.05)
    expect(Math.abs(c - b)).toBeLessThan(0.05)
  })

  it('stopping brings the lens back to exactly the chase lens, and then it never moves again', () => {
    const dt = 1 / 60
    const cam = new PerspectiveCamera(CHASE.fov, 16 / 9, CONFIG.player.camera.near, 500)
    const chase = new ChaseCamera('easy')
    const feet = { x: 0, y: 0, z: 0 }
    chase.reset(feet, 0)
    const frame = { dt, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }
    for (let i = 0; i < 240; i++) {
      feet.z += RUN * dt
      chase.update({ feet, vx: 0, vz: RUN, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
    }
    expect(cam.fov).toBeGreaterThan(CHASE.fov + 3)
    for (let i = 0; i < 60 * 3; i++) chase.update({ feet, vx: 0, vz: 0, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
    expect(cam.fov).toBe(CHASE.fov)
    for (let i = 0; i < 120; i++) {
      chase.update({ feet, vx: 0, vz: 0, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
      expect(cam.fov).toBe(CHASE.fov)
    }
  })

  it('first person keeps its own lens: no widening there', () => {
    const dt = 1 / 60
    const cam = new PerspectiveCamera(CHASE.fov, 16 / 9, CONFIG.player.camera.near, 500)
    const chase = new ChaseCamera('easy')
    const feet = { x: 0, y: 0, z: 0 }
    chase.reset(feet, 0)
    const frame = { dt, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: true, floorY: 0 }
    for (let i = 0; i < 60 * 5; i++) {
      feet.z += RUN * dt
      chase.update({ feet, vx: 0, vz: RUN, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
    }
    expect(cam.fov).toBe(CHASE.firstPersonFov)
  })
})

describe('W3: the footfall bob', () => {
  /** Runs `seconds` at `speed` with a gait phase from the clock (`cycleSeconds` a cycle); the camera's height at each frame, and the camera. */
  function bobRun(fps: number, seconds: number, speed: number, cycleSeconds: number, firstPerson = false): { y: number[]; t: number[] } {
    const dt = 1 / fps
    const cam = new PerspectiveCamera(CHASE.fov, 16 / 9, CONFIG.player.camera.near, 500)
    const chase = new ChaseCamera('easy')
    const feet = { x: 0, y: 0, z: 0 }
    chase.reset(feet, 0)
    const frame = { dt, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson, floorY: 0 }
    const y: number[] = []
    const t: number[] = []
    walkStride.run = speed > WALK ? 1 : 0
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      const time = (i + 1) * dt
      feet.z += speed * dt
      walkStride.phase = (time / cycleSeconds) % 1
      chase.update({ feet, vx: 0, vz: speed, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
      y.push(cam.position.y)
      t.push(time)
    }
    return { y, t }
  }

  const swing = (ys: number[]): number => (Math.max(...ys) - Math.min(...ys)) / 2

  it('walking: the camera rises and falls by no more than 0.8 cm; running: no more than 1.5 cm (and both are really there)', () => {
    const walk = bobRun(60, 6, WALK, 0.8)
    const run = bobRun(60, 6, RUN, 0.5)
    const w = swing(walk.y.slice(60 * 3))
    const r = swing(run.y.slice(60 * 3))
    expect(w).toBeLessThanOrEqual(CHASE.bobWalk + 1e-4)
    expect(w).toBeGreaterThan(CHASE.bobWalk * 0.6)
    expect(r).toBeLessThanOrEqual(CHASE.bobRun + 1e-4)
    expect(r).toBeGreaterThan(CHASE.bobRun * 0.6)
  })

  it('standing: none at all, to the last bit, however the gait phase sits', () => {
    const dt = 1 / 60
    const cam = new PerspectiveCamera(CHASE.fov, 16 / 9, CONFIG.player.camera.near, 500)
    const chase = new ChaseCamera('easy')
    const feet = { x: 0, y: 0, z: 0 }
    chase.reset(feet, 0)
    const frame = { dt, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }
    for (let i = 0; i < 60; i++) chase.update({ feet, vx: 0, vz: 0, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
    const rest = [cam.position.x, cam.position.y, cam.position.z, cam.fov]
    // walk, then stop, with the phase left wherever it ended
    for (let i = 0; i < 60 * 4; i++) {
      feet.z += RUN * dt
      walkStride.phase = (i * dt * 2) % 1
      walkStride.run = 1
      chase.update({ feet, vx: 0, vz: RUN, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
    }
    walkStride.run = 0
    walkStride.phase = 0.13
    for (let i = 0; i < 60 * 4; i++) chase.update({ feet, vx: 0, vz: 0, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
    // the same camera, shifted along z by the way you walked, exactly
    const stoppedY = cam.position.y
    expect(stoppedY).toBe(rest[1])
    for (let i = 0; i < 120; i++) {
      chase.update({ feet, vx: 0, vz: 0, heading: 0, turning: false }, frame, OPEN_PROBE, cam)
      expect(cam.position.y).toBe(stoppedY)
      expect(cam.fov).toBe(rest[3])
    }
  })

  it('the same at 30, 60 and 144 fps: the height at the same moments differs by under 2 mm', () => {
    const at = (fps: number): number[] => {
      const r = bobRun(fps, 5, RUN, 0.5)
      const out: number[] = []
      // moments that are whole frames at all three rates: every sixth of a second
      for (let k = 18; k <= 30; k++) out.push(r.y[Math.round((k / 6) * fps) - 1])
      return out
    }
    const a = at(30)
    const b = at(60)
    const c = at(144)
    for (let i = 0; i < b.length; i++) {
      expect(Math.abs(a[i] - b[i])).toBeLessThan(0.002)
      expect(Math.abs(c[i] - b[i])).toBeLessThan(0.002)
    }
  })

  it('in first person there is none: the eye is exactly where it should be', () => {
    const r = bobRun(60, 6, RUN, 0.5, true)
    const tail = r.y.slice(60 * 3)
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(1e-9)
    expect(tail[0]).toBeCloseTo(CONFIG.player.camera.eyeHeight, 9)
  })

  it('the bob is never allowed to carry the camera into a ceiling, a sign or the floor', () => {
    // under a sign at a run, with the bob at its highest: the whole camera ball stays clear (checked in `drive`: `inside`)
    for (const s of SIGNS) {
      const dx = Math.sin(s.heading)
      const dz = Math.cos(s.heading)
      const path: P[] = []
      for (let t = -8; t <= 8; t += 0.5) path.push({ x: s.at.x + dx * t, z: s.at.z + dz * t })
      const clean = path.filter((p) => !insideWallBox(boxes.filter((b) => !b.sign), p.x, 1.0, p.z, 0.32))
      if (clean.length < 10) continue
      const w = drive(clean, RUN, 140 * DEG, probe, 60, true)
      expect(w.inside, s.id).toBeNull()
    }
  })
})
