/**
 * R2 (docs/R2-SURGERY.md): you and the chase camera across two storeys, in node: a real Simulation, a real camera and a fake rig. The player system works in SIM
 * coordinates (level 2 is its own strip of the flat sim, sim x = drawn x + 150); the three.js camera is DRAWN (`present()`: shifted by (-150, +4.2, 0) on level 2,
 * rotation untouched). Checks the mapping of the camera and of its look target, that `walkCam.camera` stays in sim coordinates in every phase, that a
 * `placePlayer` to the other level leaves the chase camera at rest behind you there at once (a snap, no flight across the map), and that the walk <-> overview
 * flights agree in drawn coordinates (continuous, landing exactly on the rest pose) from level 2.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { OVERVIEW_FOV_DEG, type RigHandle } from '@/scene/camera/cameraApi'
import { useFocus } from '@/scene/camera/focus.store'
import { useOverviewLevel } from '@/scene/levels/levelView'
import { LEVEL2_DX, LEVEL_Y, levelOf } from '@/sim/levels'
import { LIFTS, PLAYER_SPAWN, SURGERY } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import { walkCam } from './state'
import { PlayerSystem } from './system'
import { FLIGHT } from './tuning'

const DT = 1 / 60

class FakeRig implements RigHandle {
  camera = {}
  suspended = false
  enabled = true
  pos = new Vector3(-11, 80, 66)
  tgt = new Vector3(-11, 0, 0)
  getPosition(out: Vector3): Vector3 {
    return out.copy(this.pos)
  }
  getTarget(out: Vector3): Vector3 {
    return out.copy(this.tgt)
  }
  setLookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
    this.pos.set(px, py, pz)
    this.tgt.set(tx, ty, tz)
  }
}

interface Rig {
  sim: Simulation
  camera: PerspectiveCamera
  rig: FakeRig
  sys: PlayerSystem
}

const made: PlayerSystem[] = []

function make(sim = new Simulation(5)): Rig {
  const camera = new PerspectiveCamera(OVERVIEW_FOV_DEG, 16 / 9, 1, 500)
  const rig = new FakeRig()
  // (the chase camera across storeys: walked in third person, the view V gives you)
  const sys = new PlayerSystem({ camera, getSim: () => sim, getRig: () => rig, reducedMotion: () => false, walkView: 'third' })
  made.push(sys)
  return { sim, camera, rig, sys }
}

function run(r: Rig, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) r.sys.update(DT)
}

afterEach(() => {
  while (made.length) made.pop()?.dispose()
  walkCam.inputBlocked = false
  useFocus.getState().setArea(null)
  useOverviewLevel.getState().set(1)
})

/** Where you arrive on level 2 by the lift (a walker's spot of lift A's lobby, facing out into the lobby), and the same on level 1. */
const ARRIVE_2 = { x: LIFTS.A[2].walkers[0].x, z: LIFTS.A[2].walkers[0].z, heading: Math.PI / 2 }
const ARRIVE_1 = { x: LIFTS.A[1].walkers[0].x, z: LIFTS.A[1].walkers[0].z, heading: Math.PI / 2 }

const camOf = (r: Rig): Vector3 => r.camera.position.clone()
const forward = (c: PerspectiveCamera): Vector3 => c.getWorldDirection(new Vector3())

describe('the camera is drawn where you are, level 2 included', () => {
  it('on level 2 the three.js camera is the chase camera shifted by (-150, +4.2, 0), which walkCam.camera keeps in sim coordinates; the rotation is untouched', () => {
    const r = make()
    run(r, 0.2)
    r.sys.placeAt(ARRIVE_2.x, ARRIVE_2.z, ARRIVE_2.heading)
    run(r, 1.5)
    const you = { x: r.sim.player!.x, z: r.sim.player!.z }
    expect(levelOf(you.x)).toBe(2)
    const sim = walkCam.camera
    const drawn = r.camera.position
    expect(drawn.x).toBeCloseTo(sim.x - LEVEL2_DX, 9)
    expect(drawn.y).toBeCloseTo(sim.y + LEVEL_Y[2], 9)
    expect(drawn.z).toBeCloseTo(sim.z, 9)
    // the sim camera is where the chase camera is relative to you (a boom length behind), on level 2's strip
    expect(sim.x).toBeGreaterThan(70)
    expect(Math.hypot(sim.x - you.x, sim.z - you.z)).toBeLessThan(6)
    expect(sim.y).toBeGreaterThan(0.5)
    expect(sim.y).toBeLessThan(4)
    // the drawn camera looks at the drawn look target (the target moved with it): the rotation is what the chase camera wrote
    const t = r.sys.lookingAt
    expect(t.x).toBeGreaterThan(-70)
    expect(t.x).toBeLessThan(-30)
    expect(t.y).toBeGreaterThan(LEVEL_Y[2])
    const toTarget = new Vector3(t.x - drawn.x, t.y - drawn.y, t.z - drawn.z).normalize()
    expect(forward(r.camera).dot(toTarget)).toBeGreaterThan(1 - 1e-6)
    // and you are in frame: the drawn avatar position (x - 150, y + 4.2) is in front of the camera, a few metres away
    const avatar = new Vector3(you.x - LEVEL2_DX, LEVEL_Y[2] + 1, you.z)
    const d = avatar.clone().sub(drawn)
    expect(d.length()).toBeLessThan(6)
    expect(forward(r.camera).dot(d.normalize())).toBeGreaterThan(0.8)
    expect(r.sim.player!.mode).toBe('walk')
  })

  it('on level 1 nothing is shifted: the camera is the sim\'s camera, exactly as before', () => {
    const r = make()
    run(r, 0.5)
    expect(r.camera.position.x).toBe(walkCam.camera.x)
    expect(r.camera.position.y).toBe(walkCam.camera.y)
    expect(r.camera.position.z).toBe(walkCam.camera.z)
    expect(levelOf(r.sim.player!.x)).toBe(1)
  })

  it('the snapshot, the look target and the flight start read the DRAWN camera', () => {
    const r = make()
    r.sys.placeAt(ARRIVE_2.x, ARRIVE_2.z, ARRIVE_2.heading)
    run(r, 1)
    const snap = r.sys.snapshot()
    expect(snap.camera.x).toBeCloseTo(r.camera.position.x, 9)
    expect(snap.camera.x).toBeLessThan(0)
    expect(snap.camera.y).toBeGreaterThan(LEVEL_Y[2])
    // you walk on level 2 (W then collisions), the camera follows in drawn coordinates
    r.sys.input.keyDown('KeyW')
    const x0 = r.camera.position.x
    run(r, 0.6)
    expect(r.camera.position.x).not.toBeCloseTo(x0, 2)
    expect(r.camera.position.x).toBeLessThan(0)
  })
})

describe('placePlayer to the other level: the chase camera is at rest behind you there at once', () => {
  it('snaps: the very next frame the camera is on the new level, a boom behind you, and it stays put (no flight across the map)', () => {
    const r = make()
    run(r, 1)
    const before = camOf(r)
    r.sys.placeAt(ARRIVE_2.x, ARRIVE_2.z, ARRIVE_2.heading)
    // at once, before the next frame: the camera has already left level 1 for level 2 (drawn: over the west block, 4.2 m up)
    const after = camOf(r)
    expect(after.distanceTo(before)).toBeGreaterThan(10)
    const you = new Vector3(ARRIVE_2.x - LEVEL2_DX, LEVEL_Y[2], ARRIVE_2.z)
    expect(Math.hypot(after.x - you.x, after.z - you.z)).toBeLessThan(6)
    expect(after.y).toBeGreaterThan(LEVEL_Y[2])
    expect(walkCam.camera.x).toBeGreaterThan(70) // and walkCam is in sim coordinates
    // the frames after it do not move: it was already at rest (every smoother is at its resting value)
    let travelled = 0
    let prev = camOf(r)
    for (let i = 0; i < 120; i++) {
      r.sys.update(DT)
      const c = camOf(r)
      travelled += c.distanceTo(prev)
      prev = c
    }
    expect(travelled).toBeLessThan(1e-3)
    expect(r.camera.position.distanceTo(after)).toBeLessThan(1e-3)
  })

  it('lands exactly where a fresh system that spawned there rests: the same pose, behind you (both ways, 1 -> 2 -> 1)', () => {
    const r = make()
    run(r, 0.5)
    r.sys.placeAt(ARRIVE_2.x, ARRIVE_2.z, ARRIVE_2.heading)
    run(r, 0.5)
    const fresh2 = new Simulation(5)
    fresh2.addPlayer({ at: { x: ARRIVE_2.x, z: ARRIVE_2.z }, heading: ARRIVE_2.heading })
    const f2 = make(fresh2)
    run(f2, 2)
    expect(r.camera.position.distanceTo(f2.camera.position)).toBeLessThan(1e-3)
    expect(forward(r.camera).dot(forward(f2.camera))).toBeGreaterThan(1 - 1e-6)
    // and back down to the ground floor
    r.sys.placeAt(ARRIVE_1.x, ARRIVE_1.z, ARRIVE_1.heading)
    run(r, 0.5)
    const fresh1 = new Simulation(5)
    fresh1.addPlayer({ at: { x: ARRIVE_1.x, z: ARRIVE_1.z }, heading: ARRIVE_1.heading })
    const f1 = make(fresh1)
    run(f1, 2)
    expect(r.camera.position.distanceTo(f1.camera.position)).toBeLessThan(1e-3)
    expect(r.camera.position.y).toBeLessThan(LEVEL_Y[2])
  })

  it('a move on the same level keeps the view (the seat and bedside behaviour is unchanged): only the chase point is snapped', () => {
    const r = make()
    run(r, 1)
    r.sys.input.addLook(0.4 / 0.005, 0)
    run(r, 0.2)
    const look = r.sys.snapshot().lookOffset
    r.sys.placeAt(-55, 3, 1)
    run(r, 0.05)
    expect(r.sys.snapshot().lookOffset).toBeCloseTo(look, 1)
  })

  it('does not touch the camera while you are in the overview (the rig owns it); the next walk flies down to you on the new level', () => {
    const r = make()
    run(r, 0.5)
    r.sys.input.keyDown('Tab')
    run(r, FLIGHT.seconds + 0.3)
    expect(r.sim.player!.mode).toBe('overview')
    const parked = camOf(r)
    r.sys.placeAt(ARRIVE_2.x, ARRIVE_2.z, ARRIVE_2.heading)
    run(r, 0.1)
    expect(r.camera.position.distanceTo(parked)).toBeLessThan(1e-9)
    // (the sim camera is taken back from the drawn one by your level's offset)
    expect(walkCam.camera.x).toBeCloseTo(parked.x + LEVEL2_DX, 6)
    r.sys.input.keyDown('Tab')
    run(r, FLIGHT.seconds + 0.4)
    expect(r.sim.player!.mode).toBe('walk')
    expect(r.camera.position.x).toBeLessThan(0)
    expect(r.camera.position.y).toBeGreaterThan(LEVEL_Y[2])
    expect(walkCam.camera.x).toBeGreaterThan(70)
  })
})

describe('the flights between walking and the overview, from level 2', () => {
  /** Run `seconds` and return the largest step the camera made in one frame. */
  function maxStep(r: Rig, seconds: number): number {
    let worst = 0
    let prev = camOf(r)
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      r.sys.update(DT)
      const c = camOf(r)
      worst = Math.max(worst, c.distanceTo(prev))
      prev = c
    }
    return worst
  }

  it('Tab out of level 2 flies from the drawn camera (no jump at the start), never leaps across the map, ends at the whole-building overview and opens it on Level 2', () => {
    const r = make()
    r.sys.placeAt(ARRIVE_2.x, ARRIVE_2.z, ARRIVE_2.heading)
    run(r, 1.5)
    const start = camOf(r)
    expect(useOverviewLevel.getState().level).toBe(1)
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('toOverview')
    // the first frame of the flight is next to where the chase camera was (drawn)
    expect(camOf(r).distanceTo(start)).toBeLessThan(1)
    // the overview opens on the level you stand on
    expect(useOverviewLevel.getState().level).toBe(2)
    // a swoop of about 100 m in about a second: a step of up to ~9 m a frame at the middle of the ease, never the 150 m of a mix-up of the two coordinate systems
    expect(maxStep(r, FLIGHT.seconds + 0.3)).toBeLessThan(15)
    expect(r.sim.player!.mode).toBe('overview')
    expect(r.camera.position.y).toBeGreaterThan(30)
    // the sim camera in the overview is the drawn one taken back by your level
    expect(walkCam.camera.x).toBeCloseTo(r.camera.position.x + LEVEL2_DX, 6)
    expect(walkCam.camera.y).toBeCloseTo(r.camera.position.y - LEVEL_Y[2], 6)
  })

  it('and back down: lands EXACTLY on the chase camera\'s drawn resting pose, which the chase camera then keeps (no jump at the hand-over)', () => {
    const r = make()
    r.sys.placeAt(ARRIVE_2.x, ARRIVE_2.z, ARRIVE_2.heading)
    run(r, 1.5)
    const rest = camOf(r)
    const restFwd = forward(r.camera)
    r.sys.input.keyDown('Tab')
    run(r, FLIGHT.seconds + 0.3)
    expect(r.sim.player!.mode).toBe('overview')
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('toWalk')
    expect(maxStep(r, FLIGHT.seconds + 0.1)).toBeLessThan(15)
    expect(r.sim.player!.mode).toBe('walk')
    expect(r.camera.position.distanceTo(rest)).toBeLessThan(1e-3)
    expect(forward(r.camera).dot(restFwd)).toBeGreaterThan(1 - 1e-6)
    // the chase camera takes over at that very pose: the next frames do not move it
    expect(maxStep(r, 0.5)).toBeLessThan(1e-3)
    expect(r.camera.position.distanceTo(rest)).toBeLessThan(1e-3)
    expect(walkCam.camera.x).toBeCloseTo(r.camera.position.x + LEVEL2_DX, 6)
  })

  it('Tab out of level 1 (the overview had been left on Level 2) opens the overview on Level 1', () => {
    const r = make()
    useOverviewLevel.getState().set(2)
    run(r, 0.3)
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(useOverviewLevel.getState().level).toBe(1)
  })

  it('a room\'s shot (the room focus flies out with a pose) leaves the overview level to the room focus', () => {
    const r = make()
    run(r, 0.3)
    useOverviewLevel.getState().set(2)
    r.sys.beginToOverview({ target: { x: -45, y: 4.2, z: 6 }, distance: 18, pitchDeg: 45, yawDeg: 0 })
    expect(useOverviewLevel.getState().level).toBe(2)
  })

  it('walking on level 2 and the surgeon\'s console spot: the camera is drawn at the OR (over the west block), not on the far strip', () => {
    const r = make()
    const s = SURGERY.consoles.surgeon.seat
    r.sys.placeAt(s.at.x, s.at.z, s.heading)
    run(r, 1.5)
    expect(levelOf(r.sim.player!.x)).toBe(2)
    expect(r.camera.position.x).toBeGreaterThan(-60)
    expect(r.camera.position.x).toBeLessThan(-35)
    expect(Math.abs(r.camera.position.z - s.at.z)).toBeLessThan(8)
    expect(PLAYER_SPAWN.at.x).toBeLessThan(-60)
  })
})
