/**
 * The chase camera in the easy scheme (the default): its yaw is the body's heading, followed lazily, plus a look offset the mouse adds.
 * A and D turn the heading, so the view turns with you; the mouse offset holds while you stand and swings back behind you once you move
 * on; every smoother ends in an exact rest; and the wall guarantees of the classic camera (never in a wall, under the ceiling, over the
 * floor, the shoulder swap) hold while it swings. (Adapted from Waltz City's `chaseCamera.test.ts` and `chaseRest.test.ts`, easy parts.)
 *
 * The body is simulated here as a heading that turns at a given rate and a ground speed along it; the keys, collision and the rest of
 * the player system are in system.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { CONFIG } from '@/sim/config'
import { BUILDING, ceilingHeight, areaAt } from '@/sim/places'
import type { Vec3 } from '@/sim/types'
import { OPEN_PROBE, WallBoxProbe, buildWallBoxes, insideWallBox, type BoomProbe } from './boomProbe'
import { ChaseCamera } from './chaseCamera'
import { angleDelta, rightOf, shoulderPose, wrapAngle } from './chaseMath'
import { settle, walkableAt } from './collision'
import { CHASE, EASY } from './tuning'

const DEG = Math.PI / 180
const DT = 1 / 60
const C = CONFIG.player.camera
const WALK = CONFIG.player.walkSpeed
const RUN = CONFIG.player.hurrySpeed

/** A flat wall: solid where `normal . p < d`; the ball of the sweep stops `radius` short of the plane. */
function wall(nx: number, nz: number, d: number): BoomProbe {
  return {
    cast(from, dir, length, radius) {
      const s0 = nx * from.x + nz * from.z - d
      const ds = nx * dir.x + nz * dir.z
      if (s0 < radius || ds >= 0) return null
      const t = (s0 - radius) / -ds
      return t <= length ? t : null
    },
    ceilingAt: () => null,
  }
}

interface Input {
  /** Mouse pixels (right is positive dx; down is positive dy). */
  dx?: number
  dy?: number
  /** How fast the body turns this frame, radians per second (positive turns LEFT: the heading gets larger). */
  turn?: number
  /** Ground speed along the heading, m/s. */
  speed?: number
  firstPerson?: boolean
  dragging?: boolean
}

/** You and the easy chase camera, stepped like the player system steps it: the body first, then the camera. */
class Rig {
  readonly camera = new PerspectiveCamera(CHASE.fov, 16 / 9, C.near, 500)
  readonly chase = new ChaseCamera('easy')
  readonly feet: Vec3
  heading: number
  probe: BoomProbe = OPEN_PROBE
  vx = 0
  vz = 0
  report!: ReturnType<ChaseCamera['update']>

  constructor(heading = 0, feet: Vec3 = { x: 0, y: 0, z: 0 }) {
    this.feet = { ...feet }
    this.heading = wrapAngle(heading)
    this.chase.reset(this.feet, this.heading)
    this.step()
  }

  step(o: Input = {}): void {
    const turn = o.turn ?? 0
    const speed = o.speed ?? 0
    this.heading = wrapAngle(this.heading + turn * DT)
    this.vx = Math.sin(this.heading) * speed
    this.vz = Math.cos(this.heading) * speed
    this.feet.x += this.vx * DT
    this.feet.z += this.vz * DT
    this.report = this.chase.update(
      { feet: this.feet, vx: this.vx, vz: this.vz, heading: this.heading, turning: Math.abs(turn) > 0.15 },
      { dt: DT, dx: o.dx ?? 0, dy: o.dy ?? 0, wheel: 0, dragging: !!o.dragging, firstPerson: !!o.firstPerson, floorY: this.feet.y },
      this.probe,
      this.camera,
    )
  }

  run(seconds: number, o: Input = {}): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.step(o)
  }

  /** How far the camera lags behind the heading, radians (positive: the camera looks to the left of the heading's side... see `angleDelta`). */
  lag(): number {
    return Math.abs(angleDelta(this.chase.facing, this.heading))
  }

  /** The whole camera state as numbers, for "to the last bit". */
  pose(): number[] {
    const c = this.camera
    return [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov, this.chase.shoulderOffset, this.chase.softening]
  }

  expectExactRest(seconds: number, o: Input = {}): void {
    const rest = this.pose()
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      this.step(o)
      expect(this.pose()).toEqual(rest)
    }
  }

  /** The camera's lateral position over your head, metres to the camera's right (negative: left). */
  side(): number {
    const r = rightOf(this.chase.facing)
    return (this.camera.position.x - this.feet.x) * r.x + (this.camera.position.z - this.feet.z) * r.z
  }
}

describe('the easy camera follows your heading', () => {
  it('at rest it is the shoulder pose behind you, the same as the classic camera (the flight lands on it)', () => {
    const feet = { x: -66, y: 0, z: 3 }
    const heading = Math.PI / 2
    const r = new Rig(heading, feet)
    r.run(1)
    const want = shoulderPose(feet, heading)
    expect(r.camera.position.x).toBeCloseTo(want.position.x, 6)
    expect(r.camera.position.y).toBeCloseTo(want.position.y, 6)
    expect(r.camera.position.z).toBeCloseTo(want.position.z, 6)
    expect(r.chase.lookOffset).toBe(0)
    r.expectExactRest(2)
  })

  it('holding D (turning right at 140 degrees a second) for 1 s: the view turns with you, trailing by no more than the lag limit', () => {
    const r = new Rig(0.3)
    r.run(0.5)
    const facing0 = r.chase.facing
    const rate = -140 * DEG // D: the heading gets smaller
    let worst = 0
    for (let i = 0; i < 60; i++) {
      r.step({ turn: rate })
      worst = Math.max(worst, r.lag())
      expect(r.lag()).toBeLessThanOrEqual(EASY.maxYawLag + 1e-9)
    }
    expect(-angleDelta(facing0, r.chase.facing) / DEG).toBeGreaterThan(100) // the picture turned right, by itself
    expect(worst / DEG).toBeGreaterThan(20) // a lazy follow: about the rate times 0.22 s
    expect(worst / DEG).toBeLessThan(40)
    // and the camera is to the right of where it was, looking the way you face (not a mouse offset)
    expect(r.chase.lookOffset).toBe(0)
    // letting go: the camera settles EXACTLY behind you, and then does not move at all
    r.run(2.5)
    expect(angleDelta(r.chase.facing, r.heading)).toBeCloseTo(0, 12)
    r.expectExactRest(2)
  })

  it('holding A turns the view to the left the same way', () => {
    const r = new Rig(-1)
    r.run(0.5)
    const facing0 = r.chase.facing
    r.run(1, { turn: 140 * DEG })
    expect(angleDelta(facing0, r.chase.facing) / DEG).toBeGreaterThan(100)
    expect(r.lag()).toBeLessThanOrEqual(EASY.maxYawLag + 1e-9)
    r.run(2.5)
    expect(angleDelta(r.chase.facing, r.heading)).toBeCloseTo(0, 12)
  })

  it('running and turning at 200 degrees a second: the lag stops at the limit (give or take the frame\'s own turn), however long you turn', () => {
    const r = new Rig(0)
    r.run(0.5)
    let atLimit = 0
    for (let i = 0; i < 60 * 4; i++) {
      r.step({ turn: -200 * DEG, speed: RUN })
      expect(r.lag()).toBeLessThanOrEqual(EASY.maxYawLag + 200 * DEG * DT + 1e-9)
      if (r.lag() > EASY.maxYawLag - 1 * DEG) atLimit++
    }
    expect(atLimit).toBeGreaterThan(60) // a long steady turn does reach the limit: the cap is what holds it there
    r.run(3, { speed: RUN })
    expect(angleDelta(r.chase.facing, r.heading)).toBeCloseTo(0, 12)
  })

  it('a turn taken through the +-pi seam is as smooth as any other (the camera takes the short way round)', () => {
    const r = new Rig(170 * DEG)
    r.run(0.5)
    let last = r.chase.facing
    for (let i = 0; i < 90; i++) {
      r.step({ turn: 140 * DEG }) // from 170 degrees round through 180 and on to the other side
      const step = Math.abs(angleDelta(last, r.chase.facing))
      expect(step).toBeLessThan(5 * DEG)
      last = r.chase.facing
      expect(r.lag()).toBeLessThanOrEqual(EASY.maxYawLag + 5 * DEG)
    }
    r.run(3)
    expect(angleDelta(r.chase.facing, r.heading)).toBeCloseTo(0, 12)
    r.expectExactRest(1)
  })

  it('walking and stopping behind a turn ends in an exact rest too (the follow lag, the follow point and the look-ahead)', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.run(1.5, { speed: WALK, turn: -90 * DEG })
    r.run(1, { speed: RUN })
    r.run(3) // stopped
    r.expectExactRest(2)
  })

  it('in first person the view is glued to your heading: it trails by far less, and ends on it exactly', () => {
    const r = new Rig(0)
    r.run(1, { firstPerson: true })
    let worst = 0
    for (let i = 0; i < 60; i++) {
      r.step({ turn: -200 * DEG, firstPerson: true })
      worst = Math.max(worst, r.lag())
    }
    expect(worst / DEG).toBeLessThan(15) // against about 40 behind you in third person
    expect(worst / DEG).toBeGreaterThan(5)
    r.run(1.5, { firstPerson: true })
    expect(angleDelta(r.chase.facing, r.heading)).toBeCloseTo(0, 12)
    r.expectExactRest(2, { firstPerson: true })
  })
})

describe('the mouse is a look offset around you', () => {
  const px = (rad: number): number => rad / CHASE.yawPerPixel

  it('dragging to the right adds an offset to the right; it is held while you stand still, however long', () => {
    const r = new Rig(0.4)
    r.run(0.5)
    r.step({ dx: px(0.8) })
    r.run(1)
    expect(r.chase.lookOffset).toBeCloseTo(-0.8, 3) // to the right: negative, like the heading
    expect(angleDelta(r.chase.facing, r.heading - 0.8)).toBeCloseTo(0, 3)
    const off = r.chase.lookOffset
    r.run(120) // two minutes
    expect(r.chase.lookOffset).toBe(off)
    r.expectExactRest(2)
  })

  it('the offset is added to a turning heading: the mouse and the keys both work at once', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dx: px(0.5), turn: -90 * DEG, dragging: true })
    r.run(0.5, { turn: -90 * DEG, dragging: true })
    expect(r.chase.lookOffset).toBeCloseTo(-0.5, 3)
    r.run(2, { dragging: true }) // the turn is over, the drag goes on: the view is your heading plus the offset, exactly
    expect(angleDelta(r.chase.facing, r.heading + r.chase.lookOffset)).toBeCloseTo(0, 12)
    expect(r.chase.lookOffset).toBeCloseTo(-0.5, 3)
  })

  it('moving, it holds for the recentre delay after the last mouse input, then swings back behind you, ending at exactly 0', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dx: px(0.9), speed: WALK })
    r.run(EASY.recenterDelay - 0.15, { speed: WALK })
    expect(r.chase.lookOffset).toBeCloseTo(-0.9, 3) // still held
    r.run(0.15 + 0.4, { speed: WALK })
    expect(Math.abs(r.chase.lookOffset)).toBeLessThan(0.8) // under way
    expect(Math.abs(r.chase.lookOffset)).toBeGreaterThan(0.05)
    r.run(3, { speed: WALK })
    expect(r.chase.lookOffset).toBe(0)
    expect(angleDelta(r.chase.facing, r.heading)).toBeCloseTo(0, 12)
    r.run(2) // stopped
    r.expectExactRest(2)
  })

  it('the swing back is a monotone glide: it never overshoots past behind you or reverses', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dx: px(1.2), speed: WALK })
    let last = Math.abs(r.chase.lookOffset)
    r.run(EASY.recenterDelay, { speed: WALK })
    last = Math.abs(r.chase.lookOffset)
    for (let i = 0; i < 60 * 4; i++) {
      r.step({ speed: WALK })
      const now = r.chase.lookOffset
      expect(now).toBeLessThanOrEqual(1e-12) // never past behind you to the left
      expect(Math.abs(now)).toBeLessThanOrEqual(last + 1e-12)
      last = Math.abs(now)
    }
  })

  it('a look nearly straight behind you swings back round the short way, in smooth steps', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dx: px(3.0), speed: WALK }) // nearly straight behind you, to the right
    r.run(EASY.recenterDelay + 0.2, { speed: WALK })
    let prev = r.chase.lookOffset
    for (let i = 0; i < 60 * 3; i++) {
      r.step({ speed: WALK })
      expect(Math.abs(angleDelta(prev, r.chase.lookOffset))).toBeLessThan(10 * DEG)
      prev = r.chase.lookOffset
    }
    expect(r.chase.lookOffset).toBe(0)
  })

  it('turning on the spot counts as moving', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dx: px(0.9) })
    r.run(5, { turn: -120 * DEG })
    expect(r.chase.lookOffset).toBe(0)
  })

  it('standing still without turning, the pitch is kept as well; moving, it comes back to the default height after the delay', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dy: 60 })
    r.run(2)
    const tilted = r.chase.drawnPitch
    expect(tilted).toBeGreaterThan(CHASE.pitch + 0.1)
    r.run(5)
    expect(r.chase.drawnPitch).toBe(tilted)
    r.run(4, { speed: WALK })
    expect(r.chase.drawnPitch).toBeCloseTo(CHASE.pitch, 4)
  })

  it('it never fights an active drag: with the button held (even still) the offset stays, and it recentres only a second after the release', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dx: px(0.9), speed: WALK, dragging: true })
    r.run(5, { speed: WALK, dragging: true })
    expect(r.chase.lookOffset).toBeCloseTo(-0.9, 3)
    const held = r.chase.lookOffset
    r.run(0.9, { speed: WALK }) // released: the clock starts now
    expect(r.chase.lookOffset).toBe(held)
    r.run(4, { speed: WALK })
    expect(r.chase.lookOffset).toBe(0)
  })

  it('a look in the middle of the swing back stops it dead and holds the new look for a second', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dx: px(1.0), speed: WALK })
    r.run(1.6, { speed: WALK })
    const mid = r.chase.lookOffset
    expect(Math.abs(mid)).toBeLessThan(0.95)
    r.step({ dx: px(0.1), speed: WALK })
    r.run(0.8, { speed: WALK })
    expect(r.chase.lookOffset).toBeLessThan(mid + 1e-9) // further right than before
    const held = r.chase.lookOffset
    r.run(0.1, { speed: WALK })
    expect(r.chase.lookOffset).toBeCloseTo(held, 3)
  })

  it('setLook is a look offset like the mouse: held while you stand, swung back when you move', () => {
    const r = new Rig(0.5)
    r.run(0.5)
    r.chase.setLook(0.5 + 1.1) // 1.1 rad to the left of the heading
    r.run(1)
    expect(r.chase.lookOffset).toBeCloseTo(1.1, 3)
    r.run(10)
    expect(r.chase.lookOffset).toBeCloseTo(1.1, 3)
    r.run(5, { speed: WALK })
    expect(r.chase.lookOffset).toBe(0)
  })

  it('reset puts the camera behind you with no offset at all', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dx: px(1.5) })
    r.run(0.5)
    r.heading = 2
    r.chase.reset(r.feet, 2)
    r.run(0.1)
    expect(r.chase.lookOffset).toBe(0)
    expect(angleDelta(r.chase.facing, 2)).toBeCloseTo(0, 12)
  })
})

describe('first person: the mouse turns the body (absorbLook)', () => {
  const px = (rad: number): number => rad / CHASE.yawPerPixel

  /** The owner's side of it: after the camera's update, the look offset becomes heading. */
  function stepFirstPerson(r: Rig, o: Input = {}): number {
    r.step({ ...o, firstPerson: true })
    const d = r.chase.absorbLook(DT)
    r.heading = wrapAngle(r.heading + d)
    return d
  }

  it('the offset moves into the heading and the view does not move at all while it does', () => {
    const r = new Rig(0)
    for (let i = 0; i < 60; i++) stepFirstPerson(r)
    stepFirstPerson(r, { dx: px(0.7) }) // look 0.7 rad to the right
    let total = 0
    let last = r.chase.facing
    for (let i = 0; i < 120; i++) {
      total += stepFirstPerson(r)
      // the view is only smoothing towards where the mouse put it: it never goes backwards
      expect(angleDelta(last, r.chase.facing)).toBeLessThanOrEqual(1e-12)
      last = r.chase.facing
    }
    expect(r.heading).toBeCloseTo(-0.7, 3) // the body now faces where you looked
    expect(total).toBeLessThan(0) // (to the right: smaller)
    expect(r.chase.lookOffset).toBe(0)
    expect(angleDelta(r.chase.facing, r.heading)).toBeCloseTo(0, 12)
  })

  it('absorbing changes nothing the picture shows: a camera that absorbs and one that does not draw the same view on every frame', () => {
    const a = new Rig(0.3) // the look stays an offset
    const b = new Rig(0.3) // the look becomes heading
    for (let i = 0; i < 60 * 6; i++) {
      const o: Input = { dx: i === 10 ? px(0.9) : i === 100 ? px(-2.2) : i === 101 ? px(0.4) : 0, dy: i === 30 ? 20 : 0 }
      a.step({ ...o, firstPerson: true })
      stepFirstPerson(b, o)
      expect(angleDelta(a.chase.facing, b.chase.facing), `frame ${i}`).toBeCloseTo(0, 4)
    }
    expect(a.chase.lookOffset).not.toBe(0) // (one of them kept it)
    expect(b.chase.lookOffset).toBe(0) // (the other turned the body)
  })

  it('it is one more way to turn the body: with A or D held at the same time, both count', () => {
    const r = new Rig(0)
    for (let i = 0; i < 60; i++) stepFirstPerson(r)
    for (let i = 0; i < 30; i++) stepFirstPerson(r, { turn: -140 * DEG, dx: i === 0 ? px(0.5) : 0 })
    expect(-r.heading).toBeGreaterThan(0.5 + 30 * DT * 140 * DEG * 0.8)
  })

  it('does nothing in the classic scheme', () => {
    const chase = new ChaseCamera('classic')
    expect(chase.absorbLook(DT)).toBe(0)
    const easy = new ChaseCamera('easy')
    expect(easy.absorbLook(DT)).toBe(0) // nothing to absorb
  })

  it('ends exactly: the last of a look is taken in one go, so nothing creeps for ever', () => {
    const r = new Rig(0)
    for (let i = 0; i < 60; i++) stepFirstPerson(r)
    stepFirstPerson(r, { dx: px(2.0) })
    for (let i = 0; i < 180; i++) stepFirstPerson(r)
    expect(r.chase.lookOffset).toBe(0)
    const rest = r.pose()
    for (let i = 0; i < 120; i++) {
      stepFirstPerson(r)
      expect(r.pose()).toEqual(rest)
    }
  })
})

describe('switching the scheme', () => {
  it('easy to classic keeps the picture where it is (no jump); from then on nothing swings it behind you', () => {
    const r = new Rig(0)
    r.run(0.5)
    r.step({ dx: 100 })
    r.run(1)
    const facing = r.chase.facing
    r.chase.setScheme('classic')
    expect(r.chase.controlScheme).toBe('classic')
    r.run(1)
    expect(r.chase.facing).toBeCloseTo(facing, 6)
    r.run(5, { speed: WALK })
    expect(r.chase.facing).toBeCloseTo(facing, 6)
  })

  it('classic to easy keeps the picture at first and then swings in behind your heading', () => {
    const chase = new ChaseCamera('classic')
    const camera = new PerspectiveCamera(CHASE.fov, 16 / 9, C.near, 500)
    const feet = { x: 0, y: 0, z: 0 }
    chase.reset(feet, 0)
    chase.setLook(1.0)
    const frame = { dt: DT, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }
    const subject = { feet, vx: 0, vz: 0, heading: 0, turning: false }
    for (let i = 0; i < 90; i++) chase.update(subject, frame, OPEN_PROBE, camera)
    expect(chase.facing).toBeCloseTo(1.0, 6)
    chase.setScheme('easy')
    chase.update(subject, frame, OPEN_PROBE, camera)
    expect(chase.facing).toBeCloseTo(1.0, 1) // no jump
    for (let i = 0; i < 240; i++) chase.update(subject, frame, OPEN_PROBE, camera)
    expect(angleDelta(chase.facing, 0)).toBeCloseTo(0, 12)
  })
})

describe('the walls and the shoulder, with the easy camera', () => {
  it('a wall behind you pulls the boom in and it grows back when the way is clear, ending in an exact rest', () => {
    const r = new Rig(0)
    r.probe = wall(0, 1, -1.5) // the camera (behind you, at -z) is squeezed by a wall 1.5 m behind you
    r.run(1.5)
    expect(Math.hypot(r.camera.position.x + C.shoulder, r.camera.position.z, r.camera.position.y - C.pivotHeight)).toBeLessThan(1.6)
    r.probe = OPEN_PROBE
    r.run(1.5)
    expect(Math.hypot(r.camera.position.x + C.shoulder, r.camera.position.z, r.camera.position.y - C.pivotHeight)).toBeGreaterThan(C.boom - 0.05)
    r.run(0.5)
    r.expectExactRest(2)
  })

  it('a wall at your right shoulder swaps the camera across to the left; turning with D and A does not fight it', () => {
    const r = new Rig(0)
    r.probe = wall(1, 0, -0.35) // your right hand is -x when you face +z: a wall 0.35 m to your right
    r.run(1)
    expect(r.chase.shoulderSide).toBe(-1)
    expect(r.side()).toBeCloseTo(-C.shoulder, 2)
    r.probe = OPEN_PROBE
    r.run(4)
    expect(r.chase.shoulderSide).toBe(1) // clear for a while: back to the preferred shoulder
  })

  it('Q (toggleShoulder) puts the camera over the other shoulder in the easy scheme as well', () => {
    const r = new Rig(0.7)
    r.run(0.5)
    expect(r.side()).toBeCloseTo(C.shoulder, 4)
    r.chase.toggleShoulder()
    r.run(1)
    expect(r.chase.preferredShoulder).toBe(-1)
    expect(r.side()).toBeCloseTo(-C.shoulder, 2)
  })

  const probe = new WallBoxProbe()
  const boxes = buildWallBoxes()

  /** Every frame: the camera's centre is in no wall, under the ceiling of its area, above the floor; the ball is clear unless the boom is squeezed. */
  function checkFrame(cam: PerspectiveCamera, boom: number, label: string): void {
    const p = cam.position
    expect(insideWallBox(boxes, p.x, p.y, p.z, 0), `${label}: camera centre in a wall`).toBeNull()
    if (boom > CHASE.minBoom + 0.02) expect(insideWallBox(boxes, p.x, p.y, p.z, CHASE.probeRadius - 1e-6), `${label}: camera ball in a wall`).toBeNull()
    const area = areaAt(p.x, p.z)
    const ceiling = area ? ceilingHeight(area.id) : null
    if (ceiling !== null) expect(p.y, `${label}: camera above the ceiling (${area?.id})`).toBeLessThanOrEqual(ceiling - CHASE.ceilingClearance + 1e-9)
    expect(p.y, `${label}: camera under the floor`).toBeGreaterThanOrEqual(CHASE.floorClearance - 1e-9)
  }

  it('from walkable spots all over the floor plan, spinning on the spot at 200 degrees a second (both ways) and then at rest: never in a wall, under the ceiling, over the floor', () => {
    let spots = 0
    let swapped = 0
    for (let x = BUILDING.x0 - 10; x <= BUILDING.x1; x += 2) {
      for (let z = BUILDING.z0; z <= BUILDING.z1; z += 2) {
        const px = x + 0.37
        const pz = z + 0.21
        if (!walkableAt(px, pz)) continue
        spots++
        for (const turn of [200 * DEG, -200 * DEG]) {
          const r = new Rig(spots * 0.7, { x: px, y: 0, z: pz })
          r.probe = probe
          for (let i = 0; i < 100; i++) {
            r.step({ turn: i < 70 ? turn : 0 })
            checkFrame(r.camera, r.report.boom, `(${px.toFixed(2)}, ${pz.toFixed(2)}) ${turn > 0 ? 'A' : 'D'} frame ${i}`)
          }
          if (r.chase.shoulderSwaps > 0) swapped++
        }
      }
    }
    expect(spots).toBeGreaterThan(400)
    expect(swapped).toBeGreaterThan(20) // the spins do exercise the swap
  })

  it('walking and running turns through the building (a figure of eight, W and A or D), every frame inside the guarantees', () => {
    let frames = 0
    for (const [sx, sz] of [[-50, 0], [-40, 0], [-20, 15.6], [-5, 5], [10, 0]] as const) {
      const at = { x: 0, z: 0 }
      settle(sx, sz, at)
      const x0 = at.x
      const z0 = at.z
      for (const speed of [WALK, RUN]) {
        const r = new Rig(Math.PI / 2, { x: x0, y: 0, z: z0 })
        r.probe = probe
        for (let i = 0; i < 60 * 6; i++) {
          // walls stop the body, as they do in the game: only step where the body can stand
          const turn = (i % 180 < 90 ? 1 : -1) * 150 * DEG
          const ox = r.feet.x
          const oz = r.feet.z
          r.step({ turn, speed })
          if (!walkableAt(r.feet.x, r.feet.z)) {
            r.feet.x = ox
            r.feet.z = oz
          }
          checkFrame(r.camera, r.report.boom, `from (${x0}, ${z0}) at ${speed} m/s, frame ${i}`)
          frames++
        }
      }
    }
    expect(frames).toBeGreaterThan(3000)
  })
})
