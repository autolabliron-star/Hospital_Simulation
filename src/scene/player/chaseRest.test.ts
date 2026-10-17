/**
 * "The words still move after I let go of the view". The chase camera must come to an EXACT rest soon after your input ends, and
 * stay there while you stand still. (Adapted from Waltz City's `chaseRest.test.ts`.)
 *
 * The camera is stepped like the player system does (60 Hz, the real `ChaseCamera.update`). "Motion" is measured where a player
 * sees it, in pixels on a 1080 pixel high screen: how far the view turned (at the middle of the picture) plus how far the camera
 * itself moved (as seen from the 3 m you are away) between two frames. "Exactly still" is stricter: the camera's position,
 * orientation and field of view are the same numbers, to the last bit, frame after frame.
 */
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { CONFIG } from '@/sim/config'
import { OPEN_PROBE, type BoomProbe } from './boomProbe'
import { ChaseCamera, type CameraFrame, type CameraSubject } from './chaseCamera'
import { CHASE } from './tuning'

const DT = 1 / 60
const DEG = Math.PI / 180
const SCREEN_H = 1080
const C = CONFIG.player.camera

/** The plane `normal . p = d`, solid on the side where it is smaller; the ball of the sweep stops `radius` short of it. */
function wall(nx: number, nz: number, d: number, ceiling: number | null = null): BoomProbe {
  return {
    cast(from, dir, length, radius) {
      const s0 = nx * from.x + nz * from.z - d
      const ds = nx * dir.x + nz * dir.z
      if (s0 < radius || ds >= 0) return null
      const t = (s0 - radius) / -ds
      return t <= length ? t : null
    },
    ceilingAt: () => ceiling,
  }
}

/** Two walls at once (a passage): the nearer hit wins. */
function both(a: BoomProbe, b: BoomProbe): BoomProbe {
  return {
    cast(from, dir, length, radius) {
      const x = a.cast(from, dir, length, radius)
      const y = b.cast(from, dir, length, radius)
      return x === null ? y : y === null ? x : Math.min(x, y)
    },
    ceilingAt: () => null,
  }
}

interface Input {
  dx?: number
  dy?: number
  wheel?: number
  /** Ground speed along +z, m/s. */
  speed?: number
  firstPerson?: boolean
}

/** You standing at the origin facing +z, and the chase camera behind you at -z. */
class Rig {
  readonly camera = new PerspectiveCamera(CHASE.fov, 16 / 9, C.near, 500)
  readonly chase = new ChaseCamera('classic') // the camera steered by the mouse (the easy scheme's rests are in chaseEasy.test.ts)
  readonly feet = { x: 0, y: 0, z: 0 }
  probe: BoomProbe = OPEN_PROBE
  private readonly lastQ = new Quaternion()
  private readonly lastP = new Vector3()

  constructor() {
    this.chase.reset(this.feet, 0)
    this.step()
    this.moved()
  }

  step(o: Input = {}): void {
    const speed = o.speed ?? 0
    this.feet.z += speed * DT
    const subject: CameraSubject = { feet: this.feet, vx: 0, vz: speed, heading: 0, turning: false }
    const frame: CameraFrame = { dt: DT, dx: o.dx ?? 0, dy: o.dy ?? 0, wheel: o.wheel ?? 0, dragging: false, firstPerson: !!o.firstPerson, floorY: this.feet.y }
    this.chase.update(subject, frame, this.probe, this.camera)
  }

  run(seconds: number, o: Input = {}): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.step(o)
  }

  /** How far the picture moved since the last call, pixels (see the file comment). */
  moved(): number {
    const c = this.camera
    const turn = this.lastQ.angleTo(c.quaternion)
    const slide = this.lastP.distanceTo(c.position)
    this.lastQ.copy(c.quaternion)
    this.lastP.copy(c.position)
    const pxPerRadian = SCREEN_H / (CHASE.fov * DEG)
    const pxPerMetre = SCREEN_H / (2 * 3 * Math.tan((CHASE.fov * DEG) / 2))
    return turn * pxPerRadian + slide * pxPerMetre
  }

  /** The whole camera state as numbers, for "to the last bit". */
  pose(): number[] {
    const c = this.camera
    return [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov, c.zoom]
  }
}

/** Steps `seconds` with the input and returns the per-frame motion, pixels. */
function motion(r: Rig, seconds: number, o: Input = {}): number[] {
  const out: number[] = []
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    r.step(o)
    out.push(r.moved())
  }
  return out
}

/** The camera is the same numbers, to the last bit, on every one of `seconds` of frames. */
function expectExactRest(r: Rig, seconds: number, o: Input = {}): void {
  const rest = r.pose()
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    r.step(o)
    expect(r.pose()).toEqual(rest)
  }
}

describe('the view comes to an exact rest after you let go of the mouse', () => {
  const drags: { name: string; dx: number; dy: number; frames: number }[] = [
    { name: 'a small sideways drag', dx: 6, dy: 0, frames: 8 },
    { name: 'a big sideways flick', dx: 90, dy: 0, frames: 6 },
    { name: 'a small tilt', dx: 0, dy: 5, frames: 8 },
    { name: 'a long tilt up and a turn', dx: -30, dy: -25, frames: 12 },
    { name: 'a diagonal drag held for a second', dx: 12, dy: 8, frames: 60 },
  ]

  for (const d of drags) {
    it(`${d.name}: under half a pixel a frame from 0.25 s after the mouse stops, and exactly still from 1 s`, () => {
      const r = new Rig()
      r.run(0.5)
      for (let i = 0; i < d.frames; i++) r.step({ dx: d.dx, dy: d.dy })
      r.moved()
      const tail = motion(r, 0.5)
      const late = tail.slice(Math.round(0.25 / DT))
      expect(Math.max(...late), `a frame at a time: ${tail.map((m) => m.toFixed(3)).join(' ')}`).toBeLessThan(0.5)
      r.run(0.25) // 0.75 s
      motion(r, 0.25) // 1 s
      expectExactRest(r, 2)
    })
  }

  it('a zoom with the wheel ends in an exact rest too, not a creep', () => {
    const r = new Rig()
    r.run(0.5)
    r.step({ wheel: -100 })
    r.step({ wheel: -100 })
    r.run(1)
    expectExactRest(r, 2)
    r.step({ wheel: 100 })
    r.run(1)
    expectExactRest(r, 2)
  })

  it('walking and stopping: the follow lag and the look-ahead end in an exact rest', () => {
    const r = new Rig()
    r.run(0.5)
    r.run(3, { speed: CONFIG.player.hurrySpeed })
    r.run(2.5) // stopped
    expectExactRest(r, 2)
  })

  it('first person: in and out are exact rests too', () => {
    const r = new Rig()
    r.run(0.5)
    r.run(1, { firstPerson: true })
    expectExactRest(r, 2, { firstPerson: true })
    r.run(1)
    expectExactRest(r, 2)
  })

  it('a wall behind you: the boom that was pulled in grows back within about a second and then stops dead', () => {
    const r = new Rig()
    r.probe = wall(0, 1, -1.5) // the camera (behind you, at -z) is squeezed by a wall 1.5 m behind you
    r.run(1.5)
    const pivot = new Vector3(-C.shoulder, C.pivotHeight, 0)
    expect(r.camera.position.distanceTo(pivot)).toBeLessThan(1.6)
    r.probe = OPEN_PROBE // you look away, or walk off: the way is clear
    r.run(1.3)
    expect(r.camera.position.distanceTo(pivot)).toBeGreaterThan(C.boom - 0.05) // it is back out
    motion(r, 0.2)
    expectExactRest(r, 2)
  })

  it('walls at both shoulders: the pivot that was pulled in grows back and ends exactly still', () => {
    const r = new Rig()
    r.probe = both(wall(1, 0, -0.35), wall(-1, 0, -0.35)) // your right hand is -x; a passage 0.7 m wide, so there is no other shoulder to go to
    r.run(1)
    expect(r.chase.shoulderOffset).toBeLessThan(C.shoulder)
    r.probe = OPEN_PROBE
    r.run(1.3)
    expect(r.chase.shoulderOffset).toBe(C.shoulder)
    motion(r, 0.2)
    expectExactRest(r, 2)
  })

  it('under a low ceiling: tilting back down grows the boom back and the view ends exactly still', () => {
    const r = new Rig()
    r.probe = wall(0, 1, -50, 2.6)
    r.run(0.5)
    for (let i = 0; i < 12; i++) r.step({ dy: 40 }) // look down on yourself from above: the camera is pushed against the ceiling
    r.run(0.6)
    for (let i = 0; i < 12; i++) r.step({ dy: -45 }) // and back level
    r.moved()
    const tail = motion(r, 1.5)
    // no lurch: the regrowth is a glide that only ever slows down (about 15 px a frame at the start, fading to nothing)
    const late = tail.slice(Math.round(0.4 / DT))
    expect(Math.max(...late)).toBeLessThan(20)
    for (let i = 1; i < late.length; i++) expect(late[i]).toBeLessThanOrEqual(late[i - 1] + 0.05)
    motion(r, 0.5) // 2 s
    expectExactRest(r, 2)
  })

  it('a camera creeping along a wall does not flip the pull-in on and off at the end of its glide', () => {
    const r = new Rig()
    r.probe = wall(1, 0, -2.2) // a wall on the camera's side as it swings round you
    const px = (60 * DEG) / CHASE.yawPerPixel
    for (let i = 0; i < 10; i++) r.step({ dx: px / 10 })
    const boom = (): number => r.camera.position.distanceTo(new Vector3(r.feet.x, C.pivotHeight, r.feet.z))
    r.run(0.5)
    let flips = 0
    let last = boom()
    let dir = 0
    for (let i = 0; i < 180; i++) {
      r.step()
      const b = boom()
      const d = Math.sign(b - last)
      if (d !== 0 && dir !== 0 && d !== dir && Math.abs(b - last) > 1e-6) flips++
      if (d !== 0) dir = d
      last = b
    }
    expect(flips).toBeLessThanOrEqual(1) // at most the one turn-round of a boom that was too long and settles back to the wall
  })
})
