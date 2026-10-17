/**
 * The shoulder swap and the near-wall softening of the chase camera. The camera rides over your right shoulder; with a wall at that side
 * it glides over to the left (GTA's trick), holds the side for a moment, and goes back to the preferred shoulder (Q) when that has been
 * clear for a while. A wall still close to the lens lifts the camera off it a little. Throughout, the camera is never inside a wall, never
 * above a ceiling and never under the floor, and every smoother comes to an exact rest.
 *
 * Part one is on flat walls (so the numbers are plain), part two on the real building: the ward corridors and the whole floor plan.
 */
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { CONFIG } from '@/sim/config'
import { BUILDING, ceilingHeight, areaAt } from '@/sim/places'
import type { Vec3 } from '@/sim/types'
import { OPEN_PROBE, WallBoxProbe, buildWallBoxes, insideWallBox, type BoomProbe } from './boomProbe'
import { ChaseCamera } from './chaseCamera'
import { boomAfterHit, rightOf, shoulderPose } from './chaseMath'
import { settle, walkableAt } from './collision'
import { CHASE } from './tuning'

const DT = 1 / 60
const DEG = Math.PI / 180
const C = CONFIG.player.camera
const S = C.shoulder

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

interface Step {
  /** Your ground velocity, m/s. */
  vx?: number
  vz?: number
  dx?: number
  dy?: number
  firstPerson?: boolean
}

/** You and the chase camera, stepped like the player system steps it. `swapTimes` is when (s) the camera changed shoulder. */
class Rig {
  readonly camera = new PerspectiveCamera(CHASE.fov, 16 / 9, C.near, 500)
  readonly chase = new ChaseCamera('classic') // the camera steered by the mouse: these are the shoulder swap's own guarantees
  readonly feet: Vec3
  probe: BoomProbe
  t = 0
  readonly swapTimes: number[] = []
  private swaps = 0
  report!: ReturnType<ChaseCamera['update']>

  constructor(feet: Vec3, readonly yaw: number, probe: BoomProbe = OPEN_PROBE) {
    this.feet = { ...feet }
    this.probe = probe
    this.chase.reset(this.feet, yaw)
    this.chase.setLook(yaw)
    this.step()
  }

  step(o: Step = {}): void {
    const vx = o.vx ?? 0
    const vz = o.vz ?? 0
    this.feet.x += vx * DT
    this.feet.z += vz * DT
    this.t += DT
    this.report = this.chase.update(
      { feet: this.feet, vx, vz, heading: this.yaw, turning: false },
      { dt: DT, dx: o.dx ?? 0, dy: o.dy ?? 0, wheel: 0, dragging: false, firstPerson: !!o.firstPerson, floorY: this.feet.y },
      this.probe,
      this.camera,
    )
    if (this.chase.shoulderSwaps !== this.swaps) {
      this.swaps = this.chase.shoulderSwaps
      this.swapTimes.push(this.t)
    }
  }

  run(seconds: number, o: Step = {}): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.step(o)
  }

  /** The camera's lateral position over your head, metres to the camera's right (negative: left). */
  side(): number {
    const r = rightOf(this.chase.facing)
    return (this.camera.position.x - this.feet.x) * r.x + (this.camera.position.z - this.feet.z) * r.z
  }

  /** The whole camera state as numbers, for "to the last bit". */
  pose(): number[] {
    const c = this.camera
    return [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov, this.chase.shoulderOffset, this.chase.softening]
  }

  expectExactRest(seconds: number, o: Step = {}): void {
    const rest = this.pose()
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      this.step(o)
      expect(this.pose()).toEqual(rest)
    }
  }
}

/** The most swaps in any window of `seconds`. */
function mostSwapsIn(times: readonly number[], seconds: number): number {
  let most = 0
  for (let i = 0; i < times.length; i++) {
    let n = 0
    for (let j = i; j < times.length && times[j] < times[i] + seconds; j++) n++
    most = Math.max(most, n)
  }
  return most
}

describe('the shoulder swap on flat walls', () => {
  // facing +z (yaw 0) your right hand is -x: a wall whose face is 0.35 m from your centre on that side is `wall(1, 0, -0.35)`
  const rightWall = (d = 0.35): BoomProbe => wall(1, 0, -d)
  const leftWall = (d = 0.35): BoomProbe => wall(-1, 0, -d)

  it('in open space it stays on the preferred shoulder, however long you walk and look around', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0)
    w.run(10, { vz: 1.5 })
    for (let i = 0; i < 20; i++) w.step({ dx: 25, vz: 1.5 })
    w.run(4, { vz: 1.5 })
    expect(w.chase.shoulderSwaps).toBe(0)
    expect(w.chase.shoulderSide).toBe(1)
    expect(w.chase.shoulderOffset).toBe(S)
    expect(w.chase.softening).toBe(0)
  })

  it('a wall at your right shoulder swaps the camera to the left within half a second, and it stays there', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0)
    w.run(1)
    expect(w.chase.shoulderOffset).toBe(S)
    w.probe = rightWall()
    w.run(0.5, { vz: 1.5 })
    expect(w.chase.shoulderSide).toBe(-1)
    expect(w.chase.shoulderOffset).toBeCloseTo(-S, 2)
    expect(w.side()).toBeLessThan(-S + 0.03) // the camera itself is over the left shoulder
    // and it does not flicker: one swap, however long the run along the wall
    w.run(6, { vz: 1.5 })
    expect(w.chase.shoulderSwaps).toBe(1)
    expect(w.chase.shoulderOffset).toBe(-S)
    expect(w.chase.preferredShoulder).toBe(1) // Q did not change your preference
  })

  it('the glide takes about 0.35 s: not a cut, and not a crawl', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0)
    w.run(1)
    w.probe = rightWall()
    w.step() // the swap is decided on this frame
    const offsets: number[] = [w.chase.shoulderOffset]
    for (let i = 0; i < 30; i++) {
      w.step()
      offsets.push(w.chase.shoulderOffset)
    }
    // the first frame already has the wall's pull-in; from there the pivot travels from (nearly) your head to the left shoulder
    let worst = 0
    for (let i = 1; i < offsets.length; i++) worst = Math.max(worst, Math.abs(offsets[i] - offsets[i - 1]))
    expect(worst).toBeLessThan(0.09) // metres in a frame: at most about 5 m/s for a moment, never a jump
    const t90 = offsets.findIndex((o) => o < -S * 0.8)
    expect(t90).toBeGreaterThan(5) // not instant
    expect(t90 * DT).toBeLessThan(0.3)
    expect(offsets[Math.round(0.5 / DT)]).toBeCloseTo(-S, 2)
  })

  it('a wall on your LEFT does not move you off the right shoulder', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0, leftWall(0.5))
    w.run(3, { vz: 1.5 })
    expect(w.chase.shoulderSwaps).toBe(0)
    expect(w.chase.shoulderOffset).toBe(S)
  })

  it('walls on both sides: nowhere better to go, so it stays and the pivot slides in over your head', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0, both(rightWall(), leftWall()))
    w.run(3, { vz: 1.5 })
    expect(w.chase.shoulderSwaps).toBe(0)
    expect(w.chase.shoulderOffset).toBeGreaterThan(0)
    expect(w.chase.shoulderOffset).toBeLessThan(S - 0.2)
  })

  it('the other side must be clearly better: a wall only a little nearer on the right does not swap', () => {
    // right 0.5 m (free room 0.27: just not walled in); and a left wall at 0.6 m (free 0.37: not clearly open)
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0, both(rightWall(0.5), leftWall(0.6)))
    w.run(3, { vz: 1.5 })
    expect(w.chase.shoulderSwaps).toBe(0)
  })

  it('Q toggles the preferred shoulder: the camera glides across, in open space, and Q again brings it back', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0)
    w.run(0.5)
    w.chase.toggleShoulder()
    expect(w.chase.preferredShoulder).toBe(-1)
    w.run(0.6)
    expect(w.chase.shoulderSide).toBe(-1)
    expect(w.chase.shoulderOffset).toBeCloseTo(-S, 2)
    w.run(2)
    expect(w.chase.shoulderOffset).toBe(-S) // and it is exactly there
    expect(w.chase.shoulderSwaps).toBe(1)
    // it stays on the preferred (left) shoulder in the open, however long
    w.run(6, { vz: 1.5 })
    expect(w.chase.shoulderSwaps).toBe(1)
    // Q again, straight away (no hold for the key)
    w.chase.toggleShoulder()
    w.run(0.6)
    expect(w.chase.preferredShoulder).toBe(1)
    expect(w.chase.shoulderOffset).toBeCloseTo(S, 2)
    // the rest pose on the left shoulder is the right shoulder's mirror
    const feet = { x: 3, y: 0, z: -2 }
    const left = new Rig(feet, 0.7)
    left.chase.toggleShoulder()
    left.run(3)
    const want = shoulderPose(feet, 0.7, -1)
    expect(left.camera.position.distanceTo(new PerspectiveCamera().position.set(want.position.x, want.position.y, want.position.z))).toBeLessThan(1e-9)
  })

  it('Q is a real choice: with the preferred side walled in, the automatic swap still applies and the camera does not go there', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0, leftWall())
    w.run(1)
    w.chase.toggleShoulder() // prefer the left, which has the wall
    w.run(3, { vz: 1.5 })
    expect(w.chase.preferredShoulder).toBe(-1)
    expect(w.chase.shoulderSide).toBe(1) // still on the right: the left is walled in
    expect(w.chase.shoulderSwaps).toBe(0)
    // the wall goes away: the camera goes to the preferred shoulder after a moment
    w.probe = OPEN_PROBE
    w.run(0.5, { vz: 1.5 })
    expect(w.chase.shoulderSide).toBe(1)
    w.run(2, { vz: 1.5 })
    expect(w.chase.shoulderSide).toBe(-1)
    expect(w.chase.shoulderOffset).toBeCloseTo(-S, 2)
  })

  it('walled in on the preferred side while it is preferred: the camera takes the other shoulder', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0)
    w.chase.toggleShoulder() // prefer the left
    w.run(2)
    expect(w.chase.shoulderOffset).toBe(-S)
    w.probe = leftWall()
    w.run(0.6)
    expect(w.chase.shoulderSide).toBe(1)
    expect(w.chase.shoulderOffset).toBeCloseTo(S, 2)
  })

  it('holds a side for at least 1.2 s, then goes back to the preferred shoulder only once it has been clear for a good while', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0, rightWall())
    w.run(0.3) // swapped to the left
    expect(w.chase.shoulderSide).toBe(-1)
    // the wall at the right goes, and one at the left comes: the swap back must wait out the hold
    w.probe = leftWall()
    const t0 = w.t
    w.run(3)
    expect(w.swapTimes.length).toBe(2)
    expect(w.swapTimes[1] - w.swapTimes[0]).toBeGreaterThanOrEqual(CHASE.swapHoldSeconds - 1e-9)
    expect(w.swapTimes[1] - t0).toBeGreaterThanOrEqual(CHASE.swapHoldSeconds - 0.3)
    // in the open, back on the right after the dwell, not before
    const v = new Rig({ x: 0, y: 0, z: 0 }, 0, rightWall())
    v.run(0.3)
    v.probe = OPEN_PROBE
    v.run(CHASE.swapBackSeconds - 0.3)
    expect(v.chase.shoulderSide).toBe(-1)
    v.run(CHASE.swapBackSeconds + 1)
    expect(v.chase.shoulderSide).toBe(1)
    expect(v.chase.shoulderOffset).toBe(S)
  })

  it('a door in the wall you are hugging does not flip the camera; a long open stretch does', () => {
    // you walk +z at 2 m/s beside a wall at x = -0.35, with a gap in it from z = gap0 to gap1
    const gapped = (gap0: number, gap1: number): BoomProbe => {
      const plane = wall(1, 0, -0.35)
      return {
        cast(from, dir, length, radius) {
          // looking sideways out of the gap: clear while the whole ball is within it
          if (Math.abs(dir.x) > 0.99 && from.z > gap0 + radius && from.z < gap1 - radius) return null
          return plane.cast(from, dir, length, radius)
        },
        ceilingAt: () => null,
      }
    }
    const door = new Rig({ x: 0, y: 0, z: -10 }, 0, gapped(-4, -2.6)) // 1.4 m wide: about half a second to pass
    for (let i = 0; i < 60 * 8; i++) door.step({ vz: 2 })
    expect(door.chase.shoulderSwaps).toBe(1)
    expect(door.chase.shoulderSide).toBe(-1)
    // a 7 m opening is open ground: back to the right shoulder, and to the left again when the wall resumes
    const open = new Rig({ x: 0, y: 0, z: -10 }, 0, gapped(-6, 1))
    for (let i = 0; i < 60 * 9; i++) open.step({ vz: 2 })
    expect(open.swapTimes.length).toBe(3)
    expect(open.chase.shoulderSide).toBe(-1)
  })

  it('never swaps in first person: the wall is met there, and the swap comes when you leave', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0)
    w.run(1)
    w.run(1, { firstPerson: true })
    w.probe = rightWall()
    w.run(3, { firstPerson: true })
    expect(w.chase.shoulderSwaps).toBe(0)
    expect(w.chase.shoulderSide).toBe(1)
    w.run(0.8) // out of first person
    expect(w.chase.shoulderSide).toBe(-1)
    expect(w.chase.shoulderOffset).toBeCloseTo(-S, 2)
    // Q in first person only chooses: the camera follows when you leave
    const v = new Rig({ x: 0, y: 0, z: 0 }, 0)
    v.run(1, { firstPerson: true })
    v.chase.toggleShoulder()
    v.run(1, { firstPerson: true })
    expect(v.chase.shoulderSwaps).toBe(0)
    v.run(1)
    expect(v.chase.shoulderSide).toBe(-1)
    expect(v.chase.shoulderOffset).toBe(-S)
  })

  it('a swap ends in an exact rest, and so does the walk along the wall after it', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0, rightWall())
    w.run(3)
    expect(w.chase.shoulderOffset).toBe(-S)
    w.expectExactRest(2)
    // Q, then the same
    const v = new Rig({ x: 0, y: 0, z: 0 }, 0)
    v.run(1)
    v.chase.toggleShoulder()
    v.run(3)
    v.expectExactRest(2)
    // and after the walk: the follow lag and look-ahead settle with the shoulder swapped
    const u = new Rig({ x: 0, y: 0, z: 0 }, 0, rightWall())
    u.run(3, { vz: 2 })
    u.run(3)
    u.expectExactRest(2)
  })

  it('across the whole swap the camera never passes the wall, and keeps the pivot out of it', () => {
    // you stand at least a body radius from the wall; `sideways` walks you away from it (towards the left) for half a second
    for (const d of [0.3, 0.35, 0.5]) {
      for (const sideways of [0, 0.6]) {
        const w = new Rig({ x: 0, y: 0, z: 0 }, 0)
        w.run(1)
        w.probe = rightWall(d)
        for (let i = 0; i < 120; i++) {
          w.step({ vz: 1.5, vx: sideways * (i < 30 ? 1 : 0) })
          const c = w.camera.position
          const face = -d // the wall's face: solid for x < face
          expect(c.x, `d ${d} frame ${i}`).toBeGreaterThanOrEqual(face + CHASE.probeRadius - 1e-6)
          // the pivot ball is clear of the wall too
          const r = rightOf(w.chase.facing)
          const px = w.feet.x + r.x * w.chase.shoulderOffset
          expect(px, `d ${d} frame ${i}: pivot`).toBeGreaterThanOrEqual(face + CHASE.shoulderProbeRadius - 1e-6)
        }
      }
    }
  })
})

describe('near-wall softening on flat walls', () => {
  /** The camera's elevation above its pivot, degrees, and how far it is from it. */
  function lift(w: Rig): number {
    const r = rightOf(w.chase.facing)
    const px = w.feet.x + r.x * w.chase.shoulderOffset
    const pz = w.feet.z + r.z * w.chase.shoulderOffset
    const c = w.camera.position
    return Math.atan2(c.y - (w.feet.y + C.pivotHeight), Math.hypot(c.x - px, c.z - pz)) / DEG
  }
  function boom(w: Rig): number {
    const r = rightOf(w.chase.facing)
    const px = w.feet.x + r.x * w.chase.shoulderOffset
    const pz = w.feet.z + r.z * w.chase.shoulderOffset
    const c = w.camera.position
    return Math.hypot(c.x - px, c.y - (w.feet.y + C.pivotHeight), c.z - pz)
  }
  // a passage 1.2 m wide: both sides are open enough not to swap, but the lens is within 0.5 m of the wall beside it
  const passage = both(wall(1, 0, -0.6), wall(-1, 0, -0.6))

  it('a wall within half a metre of the lens lifts the camera: more pitch, a shorter boom, no swap', () => {
    const open = new Rig({ x: 0, y: 0, z: 0 }, 0)
    open.run(1)
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0, passage)
    w.run(2)
    expect(w.chase.shoulderSwaps).toBe(0)
    expect(w.chase.softening).toBeGreaterThan(0.5)
    expect(lift(w)).toBeGreaterThan(lift(open) + 4)
    expect(boom(w)).toBeLessThan(boom(open) - 0.3)
    expect(w.camera.position.y).toBeGreaterThan(open.camera.position.y + 0.2)
    // still behind you and still looking at you
    expect(w.camera.position.z).toBeLessThan(-1)
  })

  it('no wall within half a metre of the lens: no softening at all, the very same camera as in the open', () => {
    const open = new Rig({ x: 0, y: 0, z: 0 }, 0)
    open.run(2)
    // the lens (0.45 m over the shoulder) is 0.75 m from a wall 1.2 m to your right, and 1.2 m from one on your left
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0, both(wall(1, 0, -1.2), wall(-1, 0, -1.2)))
    w.run(2)
    expect(w.chase.softening).toBe(0)
    expect(w.pose()).toEqual(open.pose())
  })

  it('eases in quickly and lets go slowly, with no lurch, and ends in an exact rest', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0)
    w.run(1)
    const base = boom(w)
    w.probe = passage
    let last = boom(w)
    let worstDrop = 0
    for (let i = 0; i < 90; i++) {
      w.step()
      worstDrop = Math.max(worstDrop, last - boom(w))
      last = boom(w)
    }
    expect(worstDrop).toBeLessThan(0.1)
    expect(boom(w)).toBeLessThan(base - 0.3)
    w.run(2)
    w.expectExactRest(1)
    // the wall goes: it comes back out over about a second (never a snap), and arrives
    w.probe = OPEN_PROBE
    let worstGrow = 0
    last = boom(w)
    for (let i = 0; i < 60 * 3; i++) {
      w.step()
      worstGrow = Math.max(worstGrow, boom(w) - last)
      last = boom(w)
    }
    expect(worstGrow).toBeLessThan(0.05)
    expect(boom(w)).toBeCloseTo(base, 6)
    expect(w.chase.softening).toBe(0)
    w.expectExactRest(2)
  })

  it('is never allowed to pull the camera through a wall, a ceiling or the floor', () => {
    // a passage with a low ceiling: the lift would push into it
    const low = both(wall(1, 0, -0.6), wall(-1, 0, -0.6))
    const lowCeiling: BoomProbe = { cast: (a, b, c, d) => low.cast(a, b, c, d), ceilingAt: () => 2.6 }
    for (const pitch of [-10, 8, 30, 54]) {
      const w = new Rig({ x: 0, y: 0, z: 0 }, 0, lowCeiling)
      w.chase.setLook(0, pitch * DEG)
      for (let i = 0; i < 180; i++) {
        w.step({ vz: 1 })
        const c = w.camera.position
        expect(c.y).toBeLessThanOrEqual(2.6 - CHASE.ceilingClearance + 1e-9)
        expect(c.y).toBeGreaterThanOrEqual(CHASE.floorClearance - 1e-9)
        expect(c.x).toBeGreaterThanOrEqual(-0.6 + CHASE.probeRadius - 1e-6)
        expect(c.x).toBeLessThanOrEqual(0.6 - CHASE.probeRadius + 1e-6)
      }
    }
  })

  it('first person is not softened, and leaving it brings the softening back without a jump', () => {
    const w = new Rig({ x: 0, y: 0, z: 0 }, 0, passage)
    w.run(2)
    expect(w.chase.softening).toBeGreaterThan(0.5)
    w.run(0.5, { firstPerson: true })
    expect(w.camera.position.y).toBeCloseTo(C.eyeHeight, 6) // through your eyes: the softening does not touch it
    w.run(3, { firstPerson: true })
    expect(w.chase.softening).toBe(0)
    let worst = 0
    let last = w.camera.position.clone()
    for (let i = 0; i < 90; i++) {
      w.step()
      worst = Math.max(worst, w.camera.position.distanceTo(last))
      last = w.camera.position.clone()
    }
    expect(worst).toBeLessThan(0.3)
  })
})

describe('in the building: the ward corridors', () => {
  const boxes = buildWallBoxes()
  const probe = new WallBoxProbe(boxes)

  /** Where the camera must be: outside the walls, under the ceiling, over the floor. */
  function checkCamera(cam: PerspectiveCamera, boom: number, label: string): void {
    const p = cam.position
    expect(insideWallBox(boxes, p.x, p.y, p.z, 0), `${label}: camera centre in a wall`).toBeNull()
    if (boom > CHASE.minBoom + 0.02) expect(insideWallBox(boxes, p.x, p.y, p.z, CHASE.probeRadius - 1e-6), `${label}: camera ball in a wall`).toBeNull()
    const area = areaAt(p.x, p.z)
    const ceiling = area ? ceilingHeight(area.id) : null
    if (ceiling !== null) expect(p.y, `${label}: camera above the ceiling (${area?.id})`).toBeLessThanOrEqual(ceiling - CHASE.ceilingClearance + 1e-9)
    expect(p.y, `${label}: camera under the floor`).toBeGreaterThanOrEqual(CHASE.floorClearance - 1e-9)
  }

  /** The closest you can walk to the wall at `z` (the nav grid's own answer), on the corridor side `inside`. */
  function hugZ(x: number, z: number): number {
    const out = { x: 0, z: 0 }
    settle(x, z, out)
    return out.z
  }

  // Ward B: the corridor runs z 12..16. Facing east (yaw pi / 2) your right hand is south (+z): the ROOM wall (z = 16, with the doors
  // of the patient rooms and the MedDrawer cabinets) is at your right. Ward A (z -16..-12), facing west, has its room wall at your right too.
  const runs = [
    { name: 'ward B, facing east along its room wall', yaw: Math.PI / 2, wallZ: 16, x0: -36, x1: 28, vx: 1 },
    { name: 'ward A, facing west along its room wall', yaw: -Math.PI / 2, wallZ: -16, x0: 28, x1: -36, vx: -1 },
  ]

  for (const run of runs) {
    it(`${run.name}: swaps to the left within half a second, once, and the camera is never in a wall`, () => {
      const hug = hugZ(run.x0 + run.vx * 6, run.wallZ)
      expect(Math.abs(hug - run.wallZ)).toBeLessThan(0.7) // a real spot at the wall
      expect(walkableAt(run.x0 + run.vx * 6, hug)).toBe(true)
      const centre = (Math.sign(run.wallZ) * 14)
      const w = new Rig({ x: run.x0, y: 0, z: centre }, run.yaw, probe)
      w.run(1.5) // settle in the middle of the corridor: nothing at either side
      expect(w.chase.shoulderSwaps).toBe(0)
      expect(w.chase.shoulderOffset).toBe(S)
      // walk towards the wall (1 m/s sideways, 2 m/s along), until you stand at it; note when the wall first comes within reach of
      // your right shoulder (the room it leaves for the pivot falls below the swap's threshold) and where the pivot is half a second
      // later. (The room doors in the wall are real openings: the wall is only "there" where the sweep says so.)
      const speed = 2
      let reached = -1
      let offsetHalfSecondLater = Number.NaN
      let lastSoft = 0
      for (let i = 0; i < 60 * 14; i++) {
        const dz = hug - w.feet.z
        const vz = Math.abs(dz) < 0.02 ? 0 : Math.sign(dz) * 1
        w.step({ vx: run.vx * speed, vz })
        checkCamera(w.camera, w.report.boom, `frame ${i}`)
        const head = { x: w.feet.x, y: C.pivotHeight, z: w.feet.z }
        const free = boomAfterHit(S, probe.cast(head, rightOf(w.chase.facing), S, CHASE.shoulderProbeRadius), CHASE.wallMargin, 0)
        if (reached < 0 && free < S * CHASE.swapGiveUpBelow) reached = w.t
        if (reached > 0 && Number.isNaN(offsetHalfSecondLater) && w.t - reached >= 0.5) offsetHalfSecondLater = w.chase.shoulderOffset
        // once the camera has swapped, the wall it left is not softened for again: the lift can only fade, never bob
        if (w.swapTimes.length > 0) expect(w.chase.softening, `frame ${i}`).toBeLessThanOrEqual(lastSoft + 1e-9)
        lastSoft = w.chase.softening
        if (reached > 0 && w.t - reached > 4) break
      }
      expect(reached).toBeGreaterThan(1.5)
      // the swap came as the wall got within reach, and the pivot is over the left shoulder within half a second of it
      expect(w.swapTimes.length).toBe(1)
      expect(w.swapTimes[0] - reached).toBeLessThan(0.1)
      expect(offsetHalfSecondLater).toBeCloseTo(-S, 2)
      expect(w.chase.shoulderSide).toBe(-1)
      expect(w.chase.shoulderOffset).toBe(-S)
      expect(w.chase.softening).toBe(0)
      // from a fresh start at the wall too: over the left shoulder after half a second
      const v = new Rig({ x: run.x0, y: 0, z: hug }, run.yaw, probe)
      v.run(0.5, { vx: run.vx * speed })
      expect(v.chase.shoulderOffset).toBeCloseTo(-S, 2)
    })

    it(`${run.name}: a long straight run along the wall flips at most once in any 3 s, never in a wall`, () => {
      const hug = hugZ(run.x0, run.wallZ)
      const w = new Rig({ x: run.x0, y: 0, z: hug }, run.yaw, probe)
      const frames = Math.round((Math.abs(run.x1 - run.x0) / 2) * 60)
      for (let i = 0; i < frames; i++) {
        w.step({ vx: run.vx * 2 })
        checkCamera(w.camera, w.report.boom, `frame ${i} x ${w.feet.x.toFixed(1)}`)
      }
      expect(w.swapTimes.length).toBeGreaterThanOrEqual(1)
      expect(mostSwapsIn(w.swapTimes, 3), `swaps at ${w.swapTimes.map((t) => t.toFixed(1)).join(', ')} s`).toBeLessThanOrEqual(1)
    })
  }

  it('in the middle of the corridor, nothing swaps, whichever way you turn the camera', () => {
    const w = new Rig({ x: -10, y: 0, z: 14 }, Math.PI / 2, probe)
    for (let i = 0; i < 360; i++) w.step({ dx: 6 }) // a slow full turn
    w.run(2)
    expect(w.chase.shoulderSwaps).toBe(0)
  })

  it('walked the other way round (the wall at your left) the camera stays on the right shoulder', () => {
    const hug = hugZ(-30, 16)
    const w = new Rig({ x: -30, y: 0, z: hug }, -Math.PI / 2, probe) // facing west: the room wall is at your left
    for (let i = 0; i < 60 * 5; i++) {
      w.step({ vx: -2 })
      checkCamera(w.camera, w.report.boom, `frame ${i}`)
    }
    expect(w.chase.shoulderSwaps).toBe(0)
    expect(w.chase.shoulderOffset).toBe(S)
  })
})

describe('in the building: the camera over the whole floor plan, through a swap', () => {
  const boxes = buildWallBoxes()
  const probe = new WallBoxProbe(boxes)

  function checkFrame(cam: PerspectiveCamera, boom: number, label: string): void {
    const p = cam.position
    expect(insideWallBox(boxes, p.x, p.y, p.z, 0), `${label}: camera centre in a wall`).toBeNull()
    if (boom > CHASE.minBoom + 0.02) expect(insideWallBox(boxes, p.x, p.y, p.z, CHASE.probeRadius - 1e-6), `${label}: camera ball in a wall`).toBeNull()
    const area = areaAt(p.x, p.z)
    const ceiling = area ? ceilingHeight(area.id) : null
    if (ceiling !== null) expect(p.y, `${label}: camera above the ceiling (${area?.id})`).toBeLessThanOrEqual(ceiling - CHASE.ceilingClearance + 1e-9)
    expect(p.y, `${label}: camera under the floor`).toBeGreaterThanOrEqual(CHASE.floorClearance - 1e-9)
  }

  it('from every walkable spot beside a wall, eight yaws, two pitches: every frame of the swap is outside the walls, under the ceiling', () => {
    let candidates = 0
    let spots = 0
    let swapped = 0
    let softened = 0
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 500)
    for (let x = BUILDING.x0 - 10; x <= BUILDING.x1; x += 0.5) {
      for (let z = BUILDING.z0; z <= BUILDING.z1; z += 0.5) {
        const px = x + 0.11
        const pz = z + 0.07
        if (!walkableAt(px, pz)) continue
        // only places with a wall within reach at some side: those are the ones that swap and soften
        const head = { x: px, y: C.pivotHeight, z: pz }
        let near = false
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (probe.cast(head, { x: dx, y: 0, z: dz }, 0.55, CHASE.shoulderProbeRadius) !== null) near = true
        if (!near) continue
        if (candidates++ % 7 !== 0) continue // every seventh: a spread of places along every wall
        spots++
        for (let k = 0; k < 8; k++) {
          const yaw = k * 45 * DEG + 0.13
          for (const pitch of [-10 * DEG, 30 * DEG]) {
            const chase = new ChaseCamera('classic')
            const feet = { x: px, y: 0, z: pz }
            chase.reset(feet, yaw)
            chase.setLook(yaw, pitch)
            for (let i = 0; i < 36; i++) {
              const r = chase.update({ feet, vx: 0, vz: 0, heading: yaw, turning: false }, { dt: DT, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }, probe, camera)
              checkFrame(camera, r.boom, `(${px.toFixed(2)}, ${pz.toFixed(2)}) yaw ${k * 45} pitch ${Math.round(pitch / DEG)} frame ${i}`)
            }
            if (chase.shoulderSwaps > 0) swapped++
            if (chase.softening > 0) softened++
          }
        }
      }
    }
    expect(spots).toBeGreaterThan(150)
    expect(swapped).toBeGreaterThan(300) // the test does exercise the swap...
    expect(softened).toBeGreaterThan(500) // ...and the softening
  })

  it('the wheel all the way out, and the Q key pressed at every frame of a walk along a corridor wall', () => {
    const w = new Rig({ x: -30, y: 0, z: 15.6 }, Math.PI / 2, probe)
    w.chase.dist = CHASE.maxDistance
    for (let i = 0; i < 60 * 10; i++) {
      if (i % 37 === 0) w.chase.toggleShoulder()
      w.step({ vx: 2, dx: (i % 90 < 30 ? 3 : -1.5) })
      checkFrame(w.camera, w.report.boom, `frame ${i}`)
    }
  })
})
