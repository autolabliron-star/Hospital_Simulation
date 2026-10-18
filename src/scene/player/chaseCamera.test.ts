import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { CONFIG } from '@/sim/config'
import type { Vec3 } from '@/sim/types'
import { OPEN_PROBE, type BoomProbe } from './boomProbe'
import { ChaseCamera, boomWithinCeilings, type CameraFrame, type CameraSubject } from './chaseCamera'
import { angleDelta, rightOf, shoulderPose } from './chaseMath'
import { CHASE } from './tuning'

const DEG = Math.PI / 180
const DT = 1 / 60
const C = CONFIG.player.camera

/** A flat wall: solid where `normal . p < offset`... the ball of the sweep stops `radius` short of the plane. */
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
  firstPerson?: boolean
  /** Ground speed along +z, m/s (the look-ahead reads it). */
  speed?: number
  dt?: number
}

/** You standing at the origin facing +z, with the camera behind you at -z, stepped like the player system steps it. */
class Rig {
  readonly camera = new PerspectiveCamera(CHASE.fov, 16 / 9, C.near, 500)
  readonly chase = new ChaseCamera('classic') // the camera steered by the mouse (the easy scheme is tested in chaseEasy.test.ts)
  readonly feet: Vec3 = { x: 0, y: 0, z: 0 }
  probe: BoomProbe = OPEN_PROBE
  /** You cannot walk past this z (a wall, less your body). */
  minZ = -Infinity
  report!: ReturnType<ChaseCamera['update']>

  constructor(readonly heading = 0) {
    this.chase.reset(this.feet, heading)
    this.step()
  }

  step(o: Input = {}): void {
    const dt = o.dt ?? DT
    const speed = o.speed ?? 0
    this.feet.z = Math.max(this.minZ, this.feet.z + speed * dt)
    const subject: CameraSubject = { feet: this.feet, vx: 0, vz: speed, heading: this.heading, turning: false }
    const frame: CameraFrame = { dt, dx: o.dx ?? 0, dy: o.dy ?? 0, wheel: o.wheel ?? 0, dragging: false, firstPerson: !!o.firstPerson, floorY: this.feet.y }
    this.report = this.chase.update(subject, frame, this.probe, this.camera)
  }

  run(seconds: number, o: Input = {}): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.step(o)
  }

  /** The boom: how far the camera is from the (shoulder) pivot. */
  boom(): number {
    const r = rightOf(this.chase.facing)
    const px = this.feet.x + r.x * this.chase.shoulderOffset
    const pz = this.feet.z + r.z * this.chase.shoulderOffset
    return Math.hypot(this.camera.position.x - px, this.camera.position.y - (this.feet.y + CHASE.pivotHeight), this.camera.position.z - pz)
  }

  cameraYaw(): number {
    const d = this.camera.getWorldDirection(new Vector3())
    return Math.atan2(d.x, d.z)
  }

  /** Where your head appears on screen, -1..1 (x right, y up). */
  ndc(y: number = CHASE.pivotHeight): { x: number; y: number; z: number } {
    this.camera.updateMatrixWorld(true)
    const v = new Vector3(this.feet.x, this.feet.y + y, this.feet.z).project(this.camera)
    return { x: v.x, y: v.y, z: v.z }
  }
}

describe('the first frame lands on the shoulder pose the flight flies to', () => {
  it('is the same pose, so the hand-over from the flight has no jump', () => {
    const feet = { x: -66, y: 0, z: 3 }
    const heading = Math.PI / 2
    const w = new Rig(heading)
    w.feet.x = feet.x
    w.feet.z = feet.z
    w.chase.reset(feet, heading)
    w.step()
    const want = shoulderPose(feet, heading)
    expect(w.camera.position.x).toBeCloseTo(want.position.x, 5)
    expect(w.camera.position.y).toBeCloseTo(want.position.y, 5)
    expect(w.camera.position.z).toBeCloseTo(want.position.z, 5)
    expect(w.report.target.x).toBeCloseTo(want.target.x, 5)
    expect(w.report.target.y).toBeCloseTo(want.target.y, 5)
    expect(w.report.target.z).toBeCloseTo(want.target.z, 5)
    expect(w.camera.fov).toBe(C.fovDeg)
  })

  it.each(['classic', 'easy'] as const)('settle() runs the camera to its resting pose, which is the shoulder pose in the open (%s scheme)', (scheme) => {
    const feet = { x: 5, y: 0, z: -4 }
    const heading = 2
    const chase = new ChaseCamera(scheme)
    const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 500)
    chase.reset(feet, heading)
    const r = chase.settle({ feet, vx: 0, vz: 0, heading, turning: false }, { firstPerson: false, floorY: 0 }, OPEN_PROBE, cam)
    const want = shoulderPose(feet, heading)
    expect(cam.position.distanceTo(new Vector3(want.position.x, want.position.y, want.position.z))).toBeLessThan(1e-9)
    expect(r.target.x).toBeCloseTo(want.target.x, 9)
  })
})

describe('over the right shoulder', () => {
  it('you stand left of the middle of the picture, level with it, and the whole of you is in the frame', () => {
    const w = new Rig(0)
    w.run(1)
    const head = w.ndc(CHASE.pivotHeight)
    const feet = w.ndc(0)
    expect(head.z).toBeGreaterThan(0)
    expect(head.z).toBeLessThan(1)
    expect(head.x).toBeLessThan(-0.05) // left of centre: the camera is over your RIGHT shoulder
    expect(head.x).toBeGreaterThan(-0.5)
    expect(head.y).toBeGreaterThan(-0.05) // head just above the middle of the picture
    expect(head.y).toBeLessThan(0.4)
    expect(feet.y).toBeGreaterThan(-0.95) // feet on screen, clear of the bottom edge
    expect(feet.x).toBeLessThan(0)
  })

  it('the camera sits behind your right shoulder, a little above eye level, whatever way you face', () => {
    for (const heading of [0, 1, Math.PI, -2]) {
      const w = new Rig(heading)
      w.run(1)
      const r = rightOf(heading)
      const side = (w.camera.position.x - w.feet.x) * r.x + (w.camera.position.z - w.feet.z) * r.z
      expect(side).toBeCloseTo(C.shoulder, 4)
      expect(w.camera.position.y).toBeGreaterThan(C.pivotHeight)
      expect(w.camera.position.y).toBeLessThan(C.pivotHeight + 1)
      expect(w.boom()).toBeCloseTo(C.boom, 4)
      expect(Math.abs(angleDelta(w.cameraYaw(), heading))).toBeLessThan(0.05)
    }
  })

  it('walls at both shoulders (nowhere to swap to) pull the pivot in over your head, and it grows back when they are gone', () => {
    const w = new Rig(0)
    // facing +z, your right hand is -x: a wall whose face is 0.35 m from your centre on that side, and another on your left
    w.probe = both(wall(1, 0, -0.35), wall(-1, 0, -0.35))
    w.run(1)
    expect(w.chase.shoulderSide).toBe(1) // no swap: the other side is no better
    expect(w.chase.shoulderOffset).toBeLessThan(C.shoulder - 0.2)
    expect(w.chase.shoulderOffset).toBeGreaterThanOrEqual(0)
    // the camera is inside the passage
    expect(w.camera.position.x).toBeGreaterThan(-0.35 + CHASE.probeRadius - 1e-6)
    expect(w.camera.position.x).toBeLessThan(0.35 - CHASE.probeRadius + 1e-6)
    w.probe = OPEN_PROBE
    w.run(2)
    expect(w.chase.shoulderOffset).toBe(C.shoulder)
  })

  it('a wall on your LEFT does not move the shoulder at all', () => {
    const w = new Rig(0)
    w.probe = wall(-1, 0, -0.5) // solid for x > 0.5: your left, facing +z
    w.run(1)
    expect(w.chase.shoulderOffset).toBe(C.shoulder)
  })
})

describe('mouse look, and the camera never swings by itself', () => {
  const dragNinety = (w: Rig): void => {
    const px = (90 * DEG) / CHASE.yawPerPixel
    for (let i = 0; i < 6; i++) w.step({ dx: px / 6 })
  }

  it('looks around: dragging right turns the view right, and the pitch follows the mouse down and up', () => {
    const w = new Rig(0)
    w.run(0.3)
    dragNinety(w)
    w.run(0.5)
    // facing +z, turning right is clockwise from above: towards -x
    expect(angleDelta(0, w.cameraYaw())).toBeLessThan(-80 * DEG)
    const pitch0 = w.chase.drawnPitch
    for (let i = 0; i < 8; i++) w.step({ dy: 20 })
    w.run(0.5)
    expect(w.chase.drawnPitch).toBeGreaterThan(pitch0 + 0.2)
    for (let i = 0; i < 40; i++) w.step({ dy: -80 })
    w.run(0.5)
    expect(w.chase.drawnPitch).toBeGreaterThanOrEqual(CHASE.minPitch - 1e-9)
    expect(w.chase.drawnPitch).toBeLessThan(0)
  })

  it('stays where it was put, however long you stand or walk: there is no swing back', () => {
    const w = new Rig(0)
    dragNinety(w)
    w.run(2)
    const facing = w.chase.facing
    const yaw = w.cameraYaw()
    w.run(8, { speed: 1.5 })
    expect(w.chase.facing).toBe(facing) // exactly: nothing turns it
    // the aim leads you along the way you go by a few centimetres, so the picture itself is within a few degrees
    expect(Math.abs(angleDelta(w.cameraYaw(), yaw))).toBeLessThan(4 * DEG)
  })

  it('the wheel zooms the boom in and out, within its range, and asks for first person once it is pulled in far enough', () => {
    const w = new Rig(0)
    w.run(0.5)
    w.step({ wheel: 100 })
    w.run(1)
    expect(w.boom()).toBeGreaterThan(C.boom + 0.2)
    for (let i = 0; i < 40; i++) {
      w.step({ wheel: 100 })
      w.run(0.1)
    }
    expect(w.boom()).toBeLessThanOrEqual(CHASE.maxDistance + 1e-6)
    let wants = false
    for (let i = 0; i < 40 && !wants; i++) {
      w.step({ wheel: -100 })
      wants = w.report.wantsFirstPerson
      w.run(0.1)
    }
    expect(wants).toBe(true)
    expect(w.chase.dist).toBeGreaterThanOrEqual(CHASE.minDistance - 1e-9)
  })
})

describe('first person', () => {
  it('puts the camera at your eyes, with the wider lens, and fades your avatar out', () => {
    const w = new Rig(0)
    w.run(0.3)
    expect(w.report.avatarFade).toBe(1)
    w.run(1, { firstPerson: true })
    expect(w.camera.position.y).toBeCloseTo(C.eyeHeight, 6)
    expect(Math.hypot(w.camera.position.x - w.feet.x, w.camera.position.z - w.feet.z)).toBeLessThan(0.15)
    expect(w.camera.fov).toBeCloseTo(C.fovFirstDeg, 6)
    expect(w.report.avatarFade).toBe(0)
    expect(w.report.boom).toBe(0)
    expect(w.chase.firstPersonBlend).toBe(1)
  })

  it('blends in over about 0.3 s, not in a jump, and back out again to the shoulder pose', () => {
    const w = new Rig(0)
    w.run(0.5)
    const chasePos = w.camera.position.clone()
    let worst = 0
    let last = chasePos.clone()
    for (let i = 0; i < 20; i++) {
      w.step({ firstPerson: true })
      worst = Math.max(worst, w.camera.position.distanceTo(last))
      last = w.camera.position.clone()
    }
    expect(worst).toBeLessThan(0.3)
    w.run(1, { firstPerson: false })
    expect(w.camera.position.distanceTo(chasePos)).toBeLessThan(1e-6)
    expect(w.camera.fov).toBe(C.fovDeg)
    expect(w.report.avatarFade).toBe(1)
  })

  it('looks where the mouse points, up and down, and pulling the wheel back asks to leave', () => {
    const w = new Rig(0)
    w.run(0.5, { firstPerson: true })
    for (let i = 0; i < 20; i++) w.step({ firstPerson: true, dy: -30 })
    w.run(0.5, { firstPerson: true })
    expect(w.report.pitchDeg).toBeLessThan(-40) // looking up
    w.step({ firstPerson: true, wheel: 100 })
    expect(w.report.wantsFirstPerson).toBe(true)
  })
})

describe('the wall pull-in', () => {
  it('never lets the camera past a wall, however close it is behind you', () => {
    // you face +z at the origin, the camera behind you at -z; a wall at z = -gap (solid for z < -gap)
    for (const gap of [0.4, 0.8, 1.5, 2.5, 3.5, 6]) {
      const w = new Rig(0)
      w.probe = wall(0, 1, -gap)
      w.run(2)
      const z = w.camera.position.z
      expect(z).toBeGreaterThanOrEqual(-gap + CHASE.probeRadius - 1e-6)
      // and it has come in to about the wall, not much further than it must: the camera does not hug the wall (it is lifted off it
      // and comes in a little more, `CHASE.nearWallBoomCut`), but it is still behind you, not on top of you
      if (gap > 0.8 && gap < 3) expect(z).toBeLessThan(-gap + CHASE.probeRadius + 0.25 + CHASE.nearWallBoomCut * C.boom + 0.15)
    }
  })

  it('pulls in smoothly as you back towards a wall behind you, and the camera never crosses it', () => {
    const w = new Rig(0)
    w.probe = wall(0, 1, -6)
    w.minZ = -6 + 0.3 // your body stops at the wall
    w.run(0.5)
    const startBoom = w.boom()
    expect(startBoom).toBeGreaterThan(2.5)
    let last = w.boom()
    let worstDrop = 0
    for (let i = 0; i < 360; i++) {
      w.step({ speed: -1.5 }) // walking backwards towards the wall
      expect(w.camera.position.z).toBeGreaterThanOrEqual(-6 + 0.1)
      // W3: the boom is a spring toward the soft ball's length (it may trail a few centimetres behind a wall you back into), and the
      // HARD ball is the guarantee: never inside it, and never far inside the soft one
      if (w.boom() > CHASE.minBoom + 0.05) expect(w.camera.position.z).toBeGreaterThanOrEqual(-6 + CHASE.nearRadius - 1e-6)
      if (w.boom() > CHASE.minBoom + 0.05) expect(w.camera.position.z).toBeGreaterThanOrEqual(-6 + CHASE.probeRadius - 0.1)
      worstDrop = Math.max(worstDrop, last - w.boom())
      last = w.boom()
    }
    expect(w.boom()).toBeLessThan(startBoom - 1.5)
    expect(worstDrop).toBeLessThan(0.1) // many frames, never one lurch
  })

  it('comes back out slowly once the wall is gone, not in a snap, and arrives', () => {
    const w = new Rig(0)
    w.probe = wall(0, 1, -1.5)
    w.run(1.5)
    const squeezed = w.boom()
    expect(squeezed).toBeLessThan(1.6)
    w.probe = OPEN_PROBE
    w.run(0.1)
    expect(w.boom()).toBeLessThan(squeezed + 0.8)
    w.run(3)
    expect(w.boom()).toBeCloseTo(C.boom, 6)
  })

  it('looks ahead along the camera\'s own swing: the pull-in has started before the wall is reached, and never clips', () => {
    // a wall to the east; you stand still and look round to the right, so the camera swings round you into the wall
    const w = new Rig(Math.PI)
    w.probe = wall(-1, 0, -2.2) // solid for x > 2.2
    w.run(0.5)
    let last = w.boom()
    let worstBoomDrop = 0
    for (let i = 0; i < 150; i++) {
      w.step({ dx: 6 }) // look round to the right: from north towards east
      const cam = w.camera.position
      expect(cam.x).toBeLessThanOrEqual(2.2 - CHASE.probeRadius + 1e-6)
      worstBoomDrop = Math.max(worstBoomDrop, last - w.boom())
      last = w.boom()
    }
    expect(worstBoomDrop).toBeLessThan(0.2)
  })
})

describe('under a ceiling and above the floor', () => {
  it('keeps the camera under the ceiling however steeply you look down from above', () => {
    const w = new Rig(0)
    w.probe = wall(0, 1, -50, 3) // a ceiling of 3 m, no wall nearby
    for (let i = 0; i < 60; i++) w.step({ dy: 40 })
    w.run(1.5)
    expect(w.camera.position.y).toBeLessThanOrEqual(3 - CHASE.ceilingClearance + 1e-6)
    expect(w.camera.position.y).toBeGreaterThan(C.pivotHeight)
  })

  it('the same view in the open (no ceiling) goes higher, so it really is the ceiling that holds it', () => {
    const w = new Rig(0)
    for (let i = 0; i < 60; i++) w.step({ dy: 40 })
    w.run(1.5)
    expect(w.camera.position.y).toBeGreaterThan(3)
  })

  it('keeps the camera above the floor when you look up from below', () => {
    const low = new Rig(0)
    for (let i = 0; i < 60; i++) low.step({ dy: -40 })
    low.run(1.5)
    expect(low.camera.position.y).toBeGreaterThanOrEqual(CHASE.floorClearance - 1e-6)
  })

  it('boomWithinCeilings sees a ceiling that appears part-way along the boom (open sky into a room)', () => {
    // sky for x < 0, a 3 m ceiling for x >= 0; the boom climbs steeply towards +x
    const probe: BoomProbe = { cast: () => null, ceilingAt: (x) => (x >= 0 ? 3 : null) }
    const origin = { x: -1, y: 1.62, z: 0 }
    const s = Math.SQRT1_2
    const dir = { x: s, y: s, z: 0 }
    const len = boomWithinCeilings(probe, origin, dir, 4)
    const endY = origin.y + dir.y * len
    const endX = origin.x + dir.x * len
    if (endX >= 0) expect(endY).toBeLessThanOrEqual(3 - CHASE.ceilingClearance + 1e-9)
    expect(len).toBeLessThan(4)
    // a level boom is never cut
    expect(boomWithinCeilings(probe, origin, { x: 1, y: 0, z: 0 }, 4)).toBe(4)
  })
})
