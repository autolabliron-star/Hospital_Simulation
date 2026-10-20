/**
 * The player system as a whole, in node: a real Simulation, a real camera and a fake rig. The keys, the mouse and the clock are
 * fed by hand (no DOM). Checks the spawn, walking, collision, first person, the Tab flights, the room focus hand-over and the
 * write-back into the sim.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { flyTo, isWalkMode, overviewPose, poseToLookAt, presetFor, registerWalkBridge, OVERVIEW_FOV_DEG, type CameraPose, type RigHandle } from '@/scene/camera/cameraApi'
import { useFocus } from '@/scene/camera/focus.store'
import { PLAYER_SPAWN } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import type { Entity } from '@/sim/types'
import { walkBody, walkCam, useWalk } from './state'
import { buildWallBoxes, insideWallBox } from './boomProbe'
import { walkableAt } from './collision'
import { angleDelta, rightOf, shoulderPose } from './chaseMath'
import type { ControlScheme } from './scheme'
import { PlayerSystem } from './system'
import { CHASE, EASY, FLIGHT } from './tuning'
import { CONFIG } from '@/sim/config'

const DT = 1 / 60
const C = CONFIG.player.camera

class FakeRig implements RigHandle {
  camera = {}
  suspended = false
  enabled = true
  pos = new Vector3(-11, 80, 66)
  tgt = new Vector3(-11, 0, 0)
  readonly calls: number[][] = []
  getPosition(out: Vector3): Vector3 {
    return out.copy(this.pos)
  }
  getTarget(out: Vector3): Vector3 {
    return out.copy(this.tgt)
  }
  setLookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
    this.calls.push([px, py, pz, tx, ty, tz])
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

/** A player system in the default ("easy") scheme, or in `classic` when a test is about the camera-relative one. */
function make(reduced = false, scheme?: ControlScheme): Rig {
  const sim = new Simulation(5)
  const camera = new PerspectiveCamera(OVERVIEW_FOV_DEG, 16 / 9, 1, 500)
  const rig = new FakeRig()
  const sys = new PlayerSystem({ camera, getSim: () => sim, getRig: () => rig, reducedMotion: () => reduced, scheme })
  made.push(sys)
  return { sim, camera, rig, sys }
}

function run(r: Rig, seconds: number, dt = DT): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) r.sys.update(dt)
}

afterEach(() => {
  while (made.length) made.pop()?.dispose()
  walkCam.inputBlocked = false
  useFocus.getState().setArea(null)
})

describe('arriving', () => {
  it('adds you to the sim as a walking doctor outside the main doors, facing in, with the chase camera behind your right shoulder', () => {
    const r = make()
    const p = r.sim.player!
    expect(p).not.toBeNull()
    expect(p.mode).toBe('walk')
    expect(p.view).toBe('third')
    expect(p.x).toBe(PLAYER_SPAWN.at.x)
    expect(p.z).toBe(PLAYER_SPAWN.at.z)
    expect(p.heading).toBe(PLAYER_SPAWN.heading)
    expect(r.sim.playerAvatar?.role).toBe('doctor')
    run(r, 0.1)
    // the camera is the walk lens, at the shoulder pose (in the open: nothing behind you on the plaza)
    const want = shoulderPose({ x: PLAYER_SPAWN.at.x, y: 0, z: PLAYER_SPAWN.at.z }, PLAYER_SPAWN.heading)
    expect(r.camera.position.distanceTo(new Vector3(want.position.x, want.position.y, want.position.z))).toBeLessThan(1e-6)
    expect(r.camera.fov).toBe(C.fovDeg)
    expect(r.camera.near).toBe(C.near)
    // the overview rig stands aside
    expect(r.rig.suspended).toBe(true)
    expect(r.rig.enabled).toBe(false)
    expect(useWalk.getState().mode).toBe('walk')
  })

  it('does not add you twice (a remount carries on from where you are)', () => {
    const r = make()
    run(r, 0.1)
    r.sys.placeAt(-55, 3, 1)
    run(r, 0.1)
    const again = new PlayerSystem({ camera: new PerspectiveCamera(35, 16 / 9, 1, 500), getSim: () => r.sim, getRig: () => r.rig, reducedMotion: () => false })
    made.push(again)
    expect(r.sim.player!.x).toBeCloseTo(-55, 6)
    expect(again.snapshot().x).toBeCloseTo(-55, 6)
    expect(again.snapshot().heading).toBeCloseTo(1, 6)
  })
})

describe('walking', () => {
  it('W walks the way you face at the walking speed, Shift hurries, and letting go brings you to rest (W3: a critically damped stop, not a dead one)', () => {
    const r = make()
    run(r, 0.1)
    r.sys.input.keyDown('KeyW')
    run(r, 1)
    expect(r.sim.player!.speed).toBeCloseTo(CONFIG.player.walkSpeed, 1)
    expect(r.sim.player!.x).toBeGreaterThan(PLAYER_SPAWN.at.x + 1.0) // facing east
    expect(r.sim.player!.z).toBeCloseTo(0, 3)
    expect(r.sim.playerAvatar!.anim).toBe('walk')
    r.sys.input.keyDown('ShiftLeft')
    run(r, 1)
    expect(r.sim.player!.speed).toBeCloseTo(CONFIG.player.hurrySpeed, 1)
    r.sys.input.keyUp('KeyW')
    run(r, 0.3) // W3: the stop is a spring (95 % of the way in `stopSeconds`), so it is nearly, not exactly, at rest after 0.3 s from a run
    expect(r.sim.player!.speed).toBeLessThan(0.25)
    run(r, 0.4)
    expect(r.sim.player!.speed).toBe(0)
    expect(r.sim.playerAvatar!.anim).toBe('idle')
  })

  it('classic: moves relative to the camera: look right with the mouse and W walks that way, the body turning to face it', () => {
    const r = make(false, 'classic')
    run(r, 0.1)
    // 90 degrees to the right of east (towards -z... facing east, the right hand is south, +z)
    r.sys.input.addLook(Math.PI / 2 / CHASE.yawPerPixel, 0)
    run(r, 0.5)
    const facing = r.sys.snapshot().facing
    r.sys.input.keyDown('KeyW')
    const x0 = r.sim.player!.x
    const z0 = r.sim.player!.z
    run(r, 0.8)
    const dx = r.sim.player!.x - x0
    const dz = r.sim.player!.z - z0
    expect(Math.atan2(dx, dz)).toBeCloseTo(facing, 1)
    expect(Math.abs(Math.atan2(dx, dz) - Math.atan2(Math.sin(facing), Math.cos(facing)))).toBeLessThan(0.15)
    expect(Math.abs(r.sim.player!.heading - facing)).toBeLessThan(0.2)
  })

  it('walks from the plaza in through the entrance and on across the lobby, and every step ends on ground you can stand on', () => {
    const r = make()
    run(r, 0.1)
    r.sys.input.keyDown('KeyW')
    r.sys.input.keyDown('ShiftLeft')
    for (let i = 0; i < 60 * 6; i++) {
      r.sys.update(DT)
      expect(walkableAt(r.sim.player!.x, r.sim.player!.z)).toBe(true)
    }
    expect(r.sim.player!.x).toBeGreaterThan(-58) // inside the lobby
    expect(Math.abs(r.sim.player!.z)).toBeLessThan(0.5) // straight through the doors
  })

  it('walking into a wall stops you at it; you never end inside it, however long you push', () => {
    const r = make()
    r.sys.placeAt(-66, 6, Math.PI / 2) // on the plaza, in front of the plain façade, away from the doors
    run(r, 0.1)
    r.sys.input.keyDown('KeyW')
    r.sys.input.keyDown('ShiftLeft')
    for (let i = 0; i < 60 * 5; i++) {
      r.sys.update(DT)
      expect(r.sim.player!.x).toBeLessThanOrEqual(-62.1 - CONFIG.player.bodyRadius + 1e-6)
    }
    expect(r.sim.player!.speed).toBe(0) // pressed against it
  })

  it('other people are not walked through: standing in your way, they hold you off', () => {
    const r = make()
    r.sys.placeAt(-55, 0, Math.PI / 2)
    run(r, 0.1)
    const e = r.sim.entities.get('player')!
    const stranger: Entity = { ...e, id: 'stranger', name: 'Stranger', position: { x: -54.4, y: 0, z: 0 }, role: 'visitor', anim: 'idle' } as Entity
    r.sim.entities.set('stranger', stranger)
    r.sys.input.keyDown('KeyW')
    for (let i = 0; i < 60 * 2; i++) {
      r.sys.update(DT)
      const d = Math.hypot(r.sim.player!.x - stranger.position.x, r.sim.player!.z - stranger.position.z)
      expect(d).toBeGreaterThan(0.5)
    }
  })

  it('while an overlay owns the keyboard (inputBlocked) you stand still, and the keys do not count', () => {
    const r = make()
    run(r, 0.1)
    r.sys.input.keyDown('KeyW')
    run(r, 0.5)
    const x = r.sim.player!.x
    walkCam.inputBlocked = true
    run(r, 0.5)
    const stoppedAt = r.sim.player!.x
    expect(stoppedAt).toBeLessThan(x + 0.5) // braked, no more than the stopping distance
    expect(r.sim.player!.speed).toBe(0)
    r.sys.input.keyDown('KeyD') // ignored
    r.sys.input.keyDown('Tab') // ignored
    run(r, 0.5)
    expect(r.sim.player!.x).toBe(stoppedAt)
    expect(r.sim.player!.mode).toBe('walk')
    walkCam.inputBlocked = false
  })
})

describe('first person', () => {
  it('V puts the camera at your eyes with the wider lens and fades your avatar out; V again brings you back', () => {
    const r = make()
    run(r, 0.1)
    expect(r.sim.playerAvatar!.fade).toBe(1)
    r.sys.input.keyDown('KeyV')
    run(r, 0.6)
    expect(r.sim.player!.view).toBe('first')
    expect(useWalk.getState().view).toBe('first')
    expect(r.camera.position.y).toBeCloseTo(C.eyeHeight, 5)
    expect(r.camera.fov).toBeCloseTo(C.fovFirstDeg, 5)
    expect(r.sim.playerAvatar!.fade).toBe(0)
    expect(walkCam.avatarFade).toBe(0)
    expect(walkCam.firstPerson).toBe(1)
    r.sys.input.keyDown('KeyV')
    run(r, 1)
    expect(r.sim.player!.view).toBe('third')
    expect(r.sim.playerAvatar!.fade).toBe(1)
    expect(r.camera.fov).toBe(C.fovDeg)
  })

  it('classic: through your own eyes you face where you look, and W walks that way', () => {
    const r = make(false, 'classic')
    run(r, 0.1)
    r.sys.input.keyDown('KeyV')
    run(r, 0.4)
    r.sys.input.addLook(-0.8 / CHASE.yawPerPixel, 0) // look 0.8 rad to the left
    run(r, 0.4)
    expect(Math.abs(r.sim.player!.heading - r.sys.snapshot().facing)).toBeLessThan(0.1)
  })

  it('the wheel pulled right in goes to first person, and back out leaves it', () => {
    const r = make()
    run(r, 0.1)
    for (let i = 0; i < 30 && r.sim.player!.view === 'third'; i++) {
      r.sys.input.addWheel(-100)
      run(r, 0.1)
    }
    expect(r.sim.player!.view).toBe('first')
    r.sys.input.addWheel(100)
    run(r, 0.1)
    expect(r.sim.player!.view).toBe('third')
  })
})

/** Where the camera is and how it points, to the last bit: two equal poses are a camera that has come to rest. */
function pose(r: Rig): number[] {
  const c = r.camera
  return [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov]
}

/** The ground direction you moved in over the last frame, as a heading. */
function movedHeading(r: Rig, frames = 1): number {
  const x0 = r.sim.player!.x
  const z0 = r.sim.player!.z
  run(r, frames * DT)
  return Math.atan2(r.sim.player!.x - x0, r.sim.player!.z - z0)
}

const DEG = Math.PI / 180
const boxes = buildWallBoxes()

/** Hold A or D (with a small dead band) to turn the body towards the compass heading `aim`; W and Shift are left as they are. */
function steerTowards(r: Rig, aim: number): void {
  const d = angleDelta(r.sim.player!.heading, aim) // positive: turn left
  r.sys.input.keyUp('KeyA')
  r.sys.input.keyUp('KeyD')
  if (d > 0.06) r.sys.input.keyDown('KeyA')
  else if (d < -0.06) r.sys.input.keyDown('KeyD')
}

describe('the control schemes', () => {
  it('the easy scheme is the default, and classic is a switch of the system', () => {
    expect(make().sys.scheme).toBe('easy')
    expect(make().sys.snapshot().scheme).toBe('easy')
    expect(make(false, 'easy').sys.scheme).toBe('easy')
    expect(make(false, 'classic').sys.scheme).toBe('classic')
    expect(make(false, 'classic').sys.snapshot().scheme).toBe('classic')
  })
})

describe('classic (`?controls=classic`): the behaviour from before', () => {
  it('A and D walk sideways relative to the camera, the camera never turns by itself, and the body turns to face where it goes', () => {
    const r = make(false, 'classic')
    run(r, 0.1)
    r.sys.placeAt(-70, 0, Math.PI / 2)
    run(r, 1)
    const facing = r.sys.snapshot().facing
    r.sys.input.keyDown('KeyD') // the right of the picture: facing east, that is south (+z)
    run(r, 1)
    expect(r.sim.player!.z).toBeGreaterThan(1.0)
    expect(Math.abs(r.sim.player!.x + 70)).toBeLessThan(1e-6)
    expect(r.sys.snapshot().facing).toBeCloseTo(facing, 9) // the view does not turn
    expect(r.sys.snapshot().lookOffset).toBe(0)
    expect(Math.abs(angleDelta(r.sim.player!.heading, 0))).toBeLessThan(0.05) // the body faces where it went: south
    r.sys.input.keyUp('KeyD')
    r.sys.input.keyDown('KeyA')
    run(r, 2)
    expect(r.sim.player!.z).toBeLessThan(0)
    expect(r.sys.snapshot().facing).toBeCloseTo(facing, 9)
  })

  it('S walks back towards the camera at the full walking speed (there is no backing up at half speed)', () => {
    const r = make(false, 'classic')
    run(r, 0.1)
    r.sys.placeAt(-70, 0, Math.PI / 2)
    run(r, 1)
    r.sys.input.keyDown('KeyS')
    run(r, 1)
    expect(r.sim.player!.speed).toBeCloseTo(CONFIG.player.walkSpeed, 1)
    expect(r.sim.player!.x).toBeLessThan(-70.5)
    // the body turned round to face where it goes: west
    expect(Math.abs(angleDelta(r.sim.player!.heading, -Math.PI / 2))).toBeLessThan(0.05)
  })

  it('mouse look turns the camera itself, and it stays turned while you walk (no swing back)', () => {
    const r = make(false, 'classic')
    run(r, 0.1)
    r.sys.placeAt(-70, -8, 0)
    run(r, 1)
    const before = r.sys.snapshot().facing // classic keeps the view when you are placed somewhere: nothing swings behind you
    r.sys.input.addLook(0.6 / CHASE.yawPerPixel, 0)
    run(r, 0.5)
    const facing = r.sys.snapshot().facing
    expect(angleDelta(before, facing)).toBeCloseTo(-0.6, 2) // to the right: the view turns clockwise
    r.sys.input.keyDown('KeyS')
    run(r, 4)
    expect(r.sys.snapshot().facing).toBeCloseTo(facing, 9)
  })
})

describe('easy: A and D turn you, and the camera follows behind by itself', () => {
  /** Out on the plaza with room all round (the façade is 8 m away), facing `heading`, the camera settled behind you. */
  function onPlaza(heading = Math.PI / 2, x = -70, z = 0): Rig {
    const r = make()
    run(r, 0.1)
    r.sys.placeAt(x, z, heading)
    run(r, 2)
    return r
  }
  const heading = (r: Rig): number => r.sim.player!.heading

  it('D turns you right: the heading gets smaller, you stay where you are, and the very first frame already turns', () => {
    const r = onPlaza()
    const h0 = heading(r)
    const x0 = r.sim.player!.x
    const z0 = r.sim.player!.z
    r.sys.input.keyDown('KeyD')
    r.sys.update(DT)
    const first = angleDelta(h0, heading(r))
    expect(first).toBeLessThan(0) // right is clockwise from above: the heading gets smaller
    expect(Math.abs(first)).toBeGreaterThan(0.1 * DEG) // no dead frame (W3: no kick either: the rate rises as a first-order lag, so a fraction of a degree)
    expect(Math.abs(first)).toBeLessThan(0.45 * 140 * DEG * DT)
    run(r, 1 - DT)
    const turned = -angleDelta(h0, heading(r)) / DEG
    expect(turned).toBeGreaterThan(125)
    expect(turned).toBeLessThan(141) // about 140 degrees a second
    expect(r.sim.player!.x).toBe(x0) // turning is not walking
    expect(r.sim.player!.z).toBe(z0)
    expect(r.sim.player!.speed).toBe(0)
    // the avatar was written the same heading
    expect(r.sim.playerAvatar!.heading).toBeCloseTo(heading(r), 9)
  })

  it('A turns you left (the heading gets larger), at the same rate', () => {
    const r = onPlaza()
    const h0 = heading(r)
    r.sys.input.keyDown('KeyA')
    run(r, 1)
    const turned = angleDelta(h0, heading(r)) / DEG
    expect(turned).toBeGreaterThan(125)
    expect(turned).toBeLessThan(141)
  })

  it('letting go stops the turn at once (a few degrees of coast at most), and nothing keeps turning later', () => {
    const r = onPlaza()
    r.sys.input.keyDown('KeyD')
    run(r, 0.5)
    r.sys.input.keyUp('KeyD')
    const h = heading(r)
    run(r, 0.5)
    expect(Math.abs(angleDelta(h, heading(r))) / DEG).toBeLessThan(10)
    const rest = heading(r)
    run(r, 1)
    expect(heading(r)).toBe(rest)
  })

  it('the view turns with you: after a second of D the camera is within the lag limit of your heading, and settles exactly behind you', () => {
    const r = onPlaza()
    const facing0 = r.sys.snapshot().facing
    r.sys.input.keyDown('KeyD')
    let worst = 0
    for (let i = 0; i < 60; i++) {
      r.sys.update(DT)
      worst = Math.max(worst, Math.abs(angleDelta(r.sys.snapshot().facing, heading(r))))
      expect(Math.abs(angleDelta(r.sys.snapshot().facing, heading(r)))).toBeLessThanOrEqual(EASY.maxYawLag + 1e-9)
    }
    const lag = Math.abs(angleDelta(r.sys.snapshot().facing, heading(r)))
    expect(lag).toBeLessThanOrEqual(EASY.maxYawLag + 1e-9)
    expect(Math.abs(angleDelta(facing0, r.sys.snapshot().facing)) / DEG).toBeGreaterThan(90) // the picture really turned: it is not the mouse that did it
    expect(worst / DEG).toBeGreaterThan(5) // lazily: it trails a little
    r.sys.input.keyUp('KeyD')
    run(r, 2)
    // behind you, exactly: the facing is the heading, and the camera does not move any more
    expect(angleDelta(r.sys.snapshot().facing, heading(r))).toBeCloseTo(0, 12)
    expect(r.sys.snapshot().lookOffset).toBe(0)
    const rest = pose(r)
    for (let i = 0; i < 120; i++) {
      r.sys.update(DT)
      expect(pose(r)).toEqual(rest)
    }
    // and it is the shoulder pose behind where you now face
    const want = shoulderPose({ x: r.sim.player!.x, y: 0, z: r.sim.player!.z }, heading(r))
    expect(r.camera.position.distanceTo(new Vector3(want.position.x, want.position.y, want.position.z))).toBeLessThan(1e-6)
  })

  it('the camera lag never passes the limit (give or take the frame\'s own turn) even when running and turning (200 degrees a second)', () => {
    const r = onPlaza(Math.PI / 2, -70, -6)
    r.sys.input.keyDown('KeyD')
    r.sys.input.keyDown('ShiftLeft')
    r.sys.input.keyDown('KeyW')
    for (let i = 0; i < 60 * 3; i++) {
      r.sys.update(DT)
      expect(Math.abs(angleDelta(r.sys.snapshot().facing, heading(r)))).toBeLessThanOrEqual(EASY.maxYawLag + 200 * DEG * DT)
      expect(walkableAt(r.sim.player!.x, r.sim.player!.z)).toBe(true)
    }
  })

  it('running turns faster than walking (about 200 degrees a second against 140)', () => {
    const turnedIn = (run1: boolean): number => {
      const r = onPlaza(Math.PI / 2, -68, -7)
      const h0 = heading(r)
      r.sys.input.keyDown('KeyD')
      r.sys.input.keyDown('KeyW')
      if (run1) r.sys.input.keyDown('ShiftLeft')
      run(r, 0.8)
      return -angleDelta(h0, heading(r)) / DEG
    }
    const walking = turnedIn(false)
    const running = turnedIn(true)
    expect(walking).toBeGreaterThan(95) // 0.8 s at 140 degrees a second, less the ramp up
    expect(walking).toBeLessThan(113)
    expect(running).toBeGreaterThan(140) // 0.8 s at 200
    expect(running).toBeLessThan(161)
  })

  it('W walks along the way you face, never where the mouse looks; the mouse does not turn the body', () => {
    const r = onPlaza()
    r.sys.input.addLook(Math.PI / 2 / CHASE.yawPerPixel, 0) // look 90 degrees to the right
    run(r, 0.3)
    const h0 = heading(r)
    r.sys.input.keyDown('KeyW')
    const x0 = r.sim.player!.x
    const z0 = r.sim.player!.z
    run(r, 0.8)
    expect(r.sim.player!.x - x0).toBeGreaterThan(0.8) // east: the way you face
    expect(Math.abs(r.sim.player!.z - z0)).toBeLessThan(1e-6)
    expect(heading(r)).toBe(h0)
  })

  it('W and D together walk a curve: you move along your heading as it turns', () => {
    const r = onPlaza(Math.PI / 2, -68, -7)
    r.sys.input.keyDown('KeyW')
    r.sys.input.keyDown('KeyD')
    run(r, 0.6)
    for (let i = 0; i < 30; i++) {
      run(r, DT)
      const h = heading(r)
      const x = r.sim.player!.x
      const z = r.sim.player!.z
      run(r, DT)
      const dir = Math.atan2(r.sim.player!.x - x, r.sim.player!.z - z)
      expect(Math.abs(angleDelta(dir, h))).toBeLessThan(0.25) // the walk follows the body
    }
  })

  it('S backs up along your heading at half the walking speed, never runs, and does not turn you round', () => {
    const r = onPlaza()
    const h0 = heading(r)
    const x0 = r.sim.player!.x
    r.sys.input.keyDown('KeyS')
    run(r, 1)
    expect(r.sim.player!.speed).toBeCloseTo(CONFIG.player.walkSpeed * EASY.backSpeedFactor, 1)
    expect(r.sim.player!.x).toBeLessThan(x0 - 0.5) // west: backwards
    expect(heading(r)).toBe(h0) // still facing east
    r.sys.input.keyDown('ShiftLeft') // Shift does not run you backwards
    run(r, 0.6)
    expect(r.sim.player!.speed).toBeCloseTo(CONFIG.player.walkSpeed * EASY.backSpeedFactor, 1)
    r.sys.input.keyUp('KeyS')
    run(r, 0.6)
    expect(r.sim.player!.speed).toBe(0)
  })

  it('Shift runs forward, at the hurry speed', () => {
    const r = onPlaza(0, -66, -8) // (W3: the canopy columns are solid now; x = -68 would meet the one at (-68.25, -4.15))
    r.sys.input.keyDown('KeyW')
    r.sys.input.keyDown('ShiftLeft')
    run(r, 1)
    expect(r.sim.player!.speed).toBeCloseTo(CONFIG.player.hurrySpeed, 1)
  })

  describe('the mouse look is an offset around you', () => {
    const LOOK = 0.9 // radians to the right
    function lookRight(r: Rig): number {
      r.sys.input.addLook(LOOK / CHASE.yawPerPixel, 0)
      run(r, 0.5)
      const off = r.sys.snapshot().lookOffset
      expect(off).toBeCloseTo(-LOOK, 3) // to the right: the offset is negative, like the heading
      expect(Math.abs(angleDelta(r.sys.snapshot().facing, heading(r) + off))).toBeLessThan(1e-3)
      return off
    }

    it('while you stand still it stays wherever you left it (a minute of it)', () => {
      const r = onPlaza(0, -70, -8)
      const off = lookRight(r)
      run(r, 60)
      expect(r.sys.snapshot().lookOffset).toBe(off)
      expect(heading(r)).toBe(0)
    })

    it('walking, it holds for about a second and then swings back behind you, ending at exactly 0', () => {
      const r = onPlaza(0, -70, -8)
      r.sys.input.addLook(LOOK / CHASE.yawPerPixel, 0)
      r.sys.input.keyDown('KeyW')
      run(r, 0.9)
      expect(r.sys.snapshot().lookOffset).toBeCloseTo(-LOOK, 3) // not yet: the delay is a second without the mouse
      run(r, 0.6) // 1.5 s: on its way
      expect(Math.abs(r.sys.snapshot().lookOffset)).toBeGreaterThan(0.05)
      expect(Math.abs(r.sys.snapshot().lookOffset)).toBeLessThan(LOOK - 0.1)
      run(r, 3) // 4.5 s
      expect(r.sys.snapshot().lookOffset).toBe(0)
      expect(Math.abs(angleDelta(r.sys.snapshot().facing, heading(r)))).toBeLessThan(1e-9)
      expect(r.sim.player!.z).toBeLessThan(8) // (the plaza is long enough for the walk)
    })

    it('after standing a long while, the first steps start the swing back at once (the second without the mouse has long passed)', () => {
      const r = onPlaza(0, -70, -8)
      lookRight(r)
      run(r, 5)
      r.sys.input.keyDown('KeyW')
      run(r, 0.5)
      expect(Math.abs(r.sys.snapshot().lookOffset)).toBeLessThan(LOOK - 0.1)
    })

    it('turning on the spot counts as moving: the offset swings back while you turn', () => {
      const r = onPlaza(0, -70, 0)
      r.sys.input.addLook(LOOK / CHASE.yawPerPixel, 0)
      r.sys.input.keyDown('KeyD')
      run(r, 5)
      expect(r.sys.snapshot().lookOffset).toBe(0)
    })

    it('it never fights a drag: with the button held (even still) there is no swing back, and it starts a second after the release', () => {
      const r = onPlaza(0, -70, -8)
      const off = lookRight(r)
      r.sys.input.pointerDown(1, 300, 300, 0)
      expect(r.sys.input.dragging).toBe(true)
      r.sys.input.keyDown('KeyW')
      run(r, 3)
      expect(r.sys.snapshot().lookOffset).toBe(off)
      r.sys.input.pointerUp(300, 300, 9000)
      run(r, 0.8)
      expect(r.sys.snapshot().lookOffset).toBe(off)
      run(r, 0.7)
      expect(Math.abs(r.sys.snapshot().lookOffset)).toBeLessThan(Math.abs(off))
    })

    it('a mouse move in the middle of the swing back stops it and holds the new look', () => {
      const r = onPlaza(0, -70, -8)
      r.sys.input.addLook(LOOK / CHASE.yawPerPixel, 0)
      r.sys.input.keyDown('KeyW')
      run(r, 1.6)
      const mid = r.sys.snapshot().lookOffset
      expect(Math.abs(mid)).toBeLessThan(LOOK - 0.05)
      r.sys.input.addLook(20, 0) // a nudge to the right
      run(r, 0.4)
      expect(r.sys.snapshot().lookOffset).toBeLessThan(mid) // it went further right, not back
      const held = r.sys.snapshot().lookOffset
      run(r, 0.4)
      expect(r.sys.snapshot().lookOffset).toBeCloseTo(held, 3) // and holds, for the second the mouse is given
    })
  })

  describe('first person', () => {
    function inFirstPerson(): Rig {
      const r = onPlaza()
      r.sys.input.keyDown('KeyV')
      run(r, 0.6)
      expect(r.sim.player!.view).toBe('first')
      return r
    }

    it('A and D turn the view naturally: it follows your heading closely and ends exactly on it', () => {
      const r = inFirstPerson()
      const h0 = heading(r)
      r.sys.input.keyDown('KeyD')
      for (let i = 0; i < 30; i++) {
        r.sys.update(DT)
        expect(Math.abs(angleDelta(r.sys.snapshot().facing, heading(r)))).toBeLessThan(15 * DEG) // glued, quicker than behind you
      }
      expect(-angleDelta(h0, heading(r)) / DEG).toBeGreaterThan(60)
      r.sys.input.keyUp('KeyD')
      run(r, 1.5)
      expect(angleDelta(r.sys.snapshot().facing, heading(r))).toBeCloseTo(0, 12)
      // and A turns it back
      const h1 = heading(r)
      r.sys.input.keyDown('KeyA')
      run(r, 0.5)
      expect(angleDelta(h1, heading(r)) / DEG).toBeGreaterThan(60)
    })

    it('the mouse turns the body, as in any first person game: where you look is where you face, and W walks that way', () => {
      const r = inFirstPerson()
      const h0 = heading(r)
      r.sys.input.addLook(-0.8 / CHASE.yawPerPixel, 0) // look 0.8 rad to the left
      run(r, 0.5)
      expect(angleDelta(h0, heading(r))).toBeCloseTo(0.8, 1)
      expect(Math.abs(angleDelta(heading(r), r.sys.snapshot().facing))).toBeLessThan(0.02)
      run(r, 1)
      expect(r.sys.snapshot().lookOffset).toBe(0) // nothing is left over to swing back
      expect(angleDelta(r.sys.snapshot().facing, heading(r))).toBeCloseTo(0, 12)
      r.sys.input.keyDown('KeyW')
      run(r, 0.3)
      expect(Math.abs(angleDelta(movedHeading(r, 6), r.sys.snapshot().facing))).toBeLessThan(0.02)
    })

    it('going into first person with the mouse look held takes the look into your heading without the picture moving', () => {
      const r = onPlaza()
      r.sys.input.addLook(0.9 / CHASE.yawPerPixel, 0)
      run(r, 0.4)
      const facing = r.sys.snapshot().facing
      const was = heading(r)
      r.sys.input.keyDown('KeyV')
      let moved = 0
      for (let i = 0; i < 90; i++) {
        r.sys.update(DT)
        moved = Math.max(moved, Math.abs(angleDelta(facing, r.sys.snapshot().facing)))
      }
      expect(moved).toBeLessThan(1e-3) // the view never moved
      expect(angleDelta(was, heading(r))).toBeCloseTo(-0.9, 1) // you now face where you were looking
      expect(r.sys.snapshot().lookOffset).toBe(0)
      // and coming back out, the camera is behind you, where you look
      r.sys.input.keyDown('KeyV')
      run(r, 1.5)
      expect(r.sim.player!.view).toBe('third')
      expect(Math.abs(angleDelta(r.sys.snapshot().facing, heading(r)))).toBeLessThan(1e-9)
    })
  })

  it('while an overlay owns the keyboard, a held D stops turning you', () => {
    const r = onPlaza()
    r.sys.input.keyDown('KeyD')
    run(r, 0.3)
    walkCam.inputBlocked = true
    run(r, 0.5)
    const h = heading(r)
    run(r, 0.5)
    expect(heading(r)).toBe(h)
    expect(r.sim.player!.speed).toBe(0)
  })

  it('Tab out and back lands the camera exactly behind where you now face, and a held turn does not carry over', () => {
    const r = onPlaza()
    r.sys.input.keyDown('KeyD')
    run(r, 0.4)
    r.sys.input.keyDown('Tab') // the keys are cleared by the flight
    run(r, FLIGHT.seconds + 0.3)
    expect(r.sim.player!.mode).toBe('overview')
    const h = heading(r)
    r.sys.input.keyDown('Tab')
    run(r, FLIGHT.seconds + 0.6)
    expect(r.sim.player!.mode).toBe('walk')
    expect(heading(r)).toBe(h)
    const want = shoulderPose({ x: r.sim.player!.x, y: 0, z: r.sim.player!.z }, h)
    expect(r.camera.position.distanceTo(new Vector3(want.position.x, want.position.y, want.position.z))).toBeLessThan(1e-6)
    run(r, 1)
    expect(heading(r)).toBe(h)
  })

  it('steering with A and D walks you in through the entrance, and the camera is outside the walls on every frame of it', () => {
    const r = make()
    run(r, 0.1)
    r.sys.placeAt(-70, 2.5, Math.PI / 2 - 0.4) // (W3: the planter at (-70.2, 4.2) is solid now)
    run(r, 1)
    r.sys.input.keyDown('KeyW')
    r.sys.input.keyDown('ShiftLeft')
    for (let i = 0; i < 60 * 8; i++) {
      const p = r.sim.player!
      // aim at the middle of the doorway until you are in line with it, then straight in
      steerTowards(r, p.x < -64 ? Math.atan2(-62.5 - p.x, -p.z) : Math.PI / 2)
      r.sys.update(DT)
      expect(walkableAt(r.sim.player!.x, r.sim.player!.z)).toBe(true)
      const c = r.camera.position
      expect(insideWallBox(boxes, c.x, c.y, c.z, 0), `frame ${i}: camera (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) in a wall`).toBeNull()
    }
    expect(r.sim.player!.x).toBeGreaterThan(-58) // inside the lobby
    expect(Math.abs(r.sim.player!.z)).toBeLessThan(1)
  })
})

describe('Tab: the flights to the overview and back', () => {
  it('flies up over 0.9 s, ends EXACTLY at the whole-building overview, adopts it into the rig and wakes the rig', () => {
    const r = make()
    run(r, 0.2)
    const standing = { x: r.sim.player!.x, z: r.sim.player!.z, heading: r.sim.player!.heading }
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('toOverview')
    expect(useWalk.getState().mode).toBe('toOverview')
    expect(r.rig.suspended).toBe(true) // still ours during the flight
    run(r, FLIGHT.seconds / 2)
    expect(r.sim.player!.mode).toBe('toOverview')
    expect(r.camera.position.y).toBeGreaterThan(5) // on its way up
    run(r, FLIGHT.seconds)
    expect(r.sim.player!.mode).toBe('overview')
    expect(useWalk.getState().mode).toBe('overview')
    // exactly at the overview pose, in the rig and on the camera
    const want = poseToLookAt(overviewPose(OVERVIEW_FOV_DEG, 16 / 9), { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 })
    expect(r.rig.calls.length).toBe(1)
    expect(r.rig.calls[0]).toEqual([want.px, want.py, want.pz, want.tx, want.ty, want.tz])
    expect(r.camera.position.toArray()).toEqual([want.px, want.py, want.pz])
    expect(r.camera.fov).toBe(OVERVIEW_FOV_DEG)
    expect(r.camera.near).toBe(FLIGHT.overviewNear)
    expect(r.rig.suspended).toBe(false)
    expect(r.rig.enabled).toBe(true)
    // your avatar stands where you left it
    expect(r.sim.player!.x).toBe(standing.x)
    expect(r.sim.player!.z).toBe(standing.z)
    expect(r.sim.player!.heading).toBe(standing.heading)
    expect(r.sim.player!.speed).toBe(0)
    expect(r.sim.playerAvatar!.fade).toBe(1)
  })

  it('and back down: ends exactly at the chase camera\'s resting pose, so it takes over with no jump', () => {
    const r = make()
    run(r, 0.2)
    r.sys.placeAt(-55, 3, 0.4)
    run(r, 0.1)
    r.sys.input.keyDown('Tab')
    run(r, 1.2)
    expect(r.sim.player!.mode).toBe('overview')
    // the rig now owns the camera: pretend it moved a little (the user orbited the overview)
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('toWalk')
    expect(r.rig.suspended).toBe(true)
    expect(r.rig.enabled).toBe(false)
    run(r, FLIGHT.seconds + 0.2)
    expect(r.sim.player!.mode).toBe('walk')
    expect(useWalk.getState().mode).toBe('walk')
    expect(r.camera.fov).toBe(C.fovDeg)
    expect(r.camera.near).toBe(C.near)
    // exactly the shoulder pose behind where you stand (the lobby is open here)
    const land = r.camera.position.clone()
    const want = shoulderPose({ x: r.sim.player!.x, y: 0, z: r.sim.player!.z }, r.sim.player!.heading)
    expect(land.distanceTo(new Vector3(want.position.x, want.position.y, want.position.z))).toBeLessThan(1e-6)
    // and the next frames of the chase camera do not move it
    run(r, 0.1)
    expect(r.camera.position.distanceTo(land)).toBeLessThan(1e-9)
  })

  it('the room focus while walking: flyTo first takes you out of walk mode, flying straight to the room\'s shot', () => {
    const r = make()
    run(r, 0.2)
    expect(isWalkMode()).toBe(true)
    const pose: CameraPose = presetFor('mri')
    flyTo(pose)
    expect(r.sim.player!.mode === 'walk').toBe(true) // takes effect on the next frame (one source of truth: the frame)
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('toOverview')
    run(r, FLIGHT.seconds + 0.1)
    expect(r.sim.player!.mode).toBe('overview')
    expect(isWalkMode()).toBe(false)
    const want = poseToLookAt(pose, { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 })
    expect(r.rig.calls[r.rig.calls.length - 1]).toEqual([want.px, want.py, want.pz, want.tx, want.ty, want.tz])
  })

  it('Tab during a flight reverses it from wherever the camera is, and the lens ends right either way', () => {
    const r = make()
    run(r, 0.2)
    r.sys.input.keyDown('Tab')
    run(r, 0.4)
    const mid = r.camera.position.clone()
    expect(mid.y).toBeGreaterThan(3)
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('toWalk')
    run(r, 1.2)
    expect(r.sim.player!.mode).toBe('walk')
    expect(r.camera.fov).toBe(C.fovDeg)
    // and out again, all the way
    r.sys.input.keyDown('Tab')
    run(r, 1.2)
    expect(r.sim.player!.mode).toBe('overview')
    expect(r.camera.fov).toBe(OVERVIEW_FOV_DEG)
  })

  it('walking closes the room focus (the panel belongs to the overview)', () => {
    const r = make()
    run(r, 0.2)
    r.sys.input.keyDown('Tab')
    run(r, 1.2)
    useFocus.getState().setArea('mri')
    r.sys.input.keyDown('Tab')
    run(r, 0.1)
    expect(useFocus.getState().area).toBeNull()
  })

  it('with reduced motion the flights are jumps: no frames in between', () => {
    const r = make(true)
    run(r, 0.2)
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('overview')
    expect(r.rig.suspended).toBe(false)
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('walk')
    expect(r.rig.suspended).toBe(true)
  })

  it('no walking, and no picking, while in the overview: the keys do nothing but Tab', () => {
    const r = make()
    run(r, 0.2)
    r.sys.input.keyDown('Tab')
    run(r, 1.2)
    const x = r.sim.player!.x
    r.sys.input.keyDown('KeyW')
    run(r, 1)
    expect(r.sim.player!.x).toBe(x)
    expect(isWalkMode()).toBe(false)
  })
})

describe('the shoulder: Q, and the walls beside you', () => {
  /** Where the camera is over your head, metres to the camera's right (negative: over the left shoulder). */
  function side(r: Rig): number {
    const rt = rightOf(r.sys.chase.facing)
    const p = r.sim.player!
    return (r.camera.position.x - p.x) * rt.x + (r.camera.position.z - p.z) * rt.z
  }
  /** Stand against the room wall of ward B (its right-hand wall when you face east, which is how you start). */
  function standAtWall(r: Rig): void {
    r.sys.placeAt(-20, 15.9, Math.PI / 2)
    run(r, 0.05)
  }

  it('Q puts the camera over the other shoulder, and Q again brings it back; holding it down does not repeat', () => {
    const r = make()
    run(r, 0.3)
    expect(side(r)).toBeCloseTo(C.shoulder, 4)
    r.sys.input.keyDown('KeyQ')
    r.sys.input.keyDown('KeyQ', true)
    r.sys.input.keyDown('KeyQ', true)
    r.sys.input.keyUp('KeyQ')
    run(r, 0.8)
    expect(r.sys.chase.preferredShoulder).toBe(-1)
    expect(side(r)).toBeCloseTo(-C.shoulder, 2)
    r.sys.input.keyDown('KeyQ')
    r.sys.input.keyUp('KeyQ')
    run(r, 0.8)
    expect(r.sys.chase.preferredShoulder).toBe(1)
    expect(side(r)).toBeCloseTo(C.shoulder, 2)
  })

  it('Q does nothing in the overview or during a flight', () => {
    const r = make()
    run(r, 0.2)
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('toOverview')
    r.sys.input.keyDown('KeyQ') // mid-flight
    run(r, 0.3)
    run(r, FLIGHT.seconds)
    expect(r.sim.player!.mode).toBe('overview')
    r.sys.input.keyDown('KeyQ') // in the overview
    run(r, 0.3)
    expect(r.sys.chase.preferredShoulder).toBe(1)
    // and the press was not kept for later: back down, the camera is still on the right
    r.sys.input.keyDown('Tab')
    run(r, FLIGHT.seconds + 0.5)
    expect(r.sim.player!.mode).toBe('walk')
    expect(r.sys.chase.preferredShoulder).toBe(1)
    expect(side(r)).toBeCloseTo(C.shoulder, 2)
  })

  it('against a wall at your right the camera is over your left shoulder, and Tab out and back lands on it with no swap in the flights', () => {
    const r = make()
    run(r, 0.2)
    standAtWall(r)
    run(r, 0.6)
    expect(r.sys.chase.shoulderSide).toBe(-1)
    expect(side(r)).toBeCloseTo(-C.shoulder, 2)
    // up: no swap during the flight or in the overview
    const swaps = r.sys.chase.shoulderSwaps
    r.sys.input.keyDown('Tab')
    for (let i = 0; i < 60 * (FLIGHT.seconds + 0.3); i++) {
      r.sys.update(DT)
      expect(r.sys.chase.shoulderSwaps).toBe(swaps)
    }
    expect(r.sim.player!.mode).toBe('overview')
    // and back down: the flight lands on the camera where it rests, over the left shoulder, and the chase carries on from there with no jump
    r.sys.input.keyDown('Tab')
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('toWalk')
    const landed = r.sys.chase.shoulderSwaps
    for (let i = 0; i < 60 * (FLIGHT.seconds + 0.3) && r.sim.player!.mode !== 'walk'; i++) {
      r.sys.update(DT)
      expect(r.sys.chase.shoulderSwaps).toBe(landed) // never mid-flight
    }
    expect(r.sim.player!.mode).toBe('walk')
    expect(side(r)).toBeCloseTo(-C.shoulder, 4)
    const land = r.camera.position.clone()
    run(r, 0.2)
    expect(r.camera.position.distanceTo(land)).toBeLessThan(1e-9)
    expect(r.sys.chase.shoulderSwaps).toBe(landed)
  })

  it('classic: walking along the wall, then away from it, the camera comes back to the right shoulder; never in a wall', () => {
    const r = make(false, 'classic')
    run(r, 0.2)
    standAtWall(r)
    r.sys.input.keyDown('KeyW') // east, along the wall
    run(r, 3)
    expect(r.sys.chase.shoulderSide).toBe(-1)
    expect(r.sys.chase.shoulderSwaps).toBe(1)
    r.sys.input.keyUp('KeyW')
    // turn the camera to the north (towards the middle of the corridor) and walk there, then stand in the open
    r.sys.input.addLook(-(Math.PI / 2) / CHASE.yawPerPixel, 0) // a drag to the left turns the view left: from east to north
    run(r, 0.4)
    r.sys.input.keyDown('KeyW')
    run(r, 1.2)
    r.sys.input.keyUp('KeyW')
    expect(r.sim.player!.z).toBeLessThan(15) // well off the wall
    run(r, 4)
    expect(r.sys.chase.shoulderSide).toBe(1)
    expect(r.sys.chase.shoulderSwaps).toBe(2)
    expect(side(r)).toBeCloseTo(C.shoulder, 4)
  })
})

describe('the shoulder with the easy scheme: turning with A along a wall', () => {
  it('walking along the wall, then turning away from it with A and walking off, the camera comes back to the right shoulder; never in a wall', () => {
    const r = make()
    run(r, 0.2)
    r.sys.placeAt(-20, 15.9, Math.PI / 2) // the right-hand wall of ward B, facing east
    run(r, 0.65)
    r.sys.input.keyDown('KeyW') // east, along the wall
    run(r, 3)
    expect(r.sys.chase.shoulderSide).toBe(-1)
    expect(r.sys.chase.shoulderSwaps).toBe(1)
    r.sys.input.keyUp('KeyW')
    // turn to the north (towards the middle of the corridor) with A, and walk there, then stand in the open
    for (let i = 0; i < 60 * 3 && Math.abs(angleDelta(r.sim.player!.heading, Math.PI)) > 0.12; i++) {
      r.sys.input.keyDown('KeyA')
      r.sys.update(DT)
    }
    r.sys.input.keyUp('KeyA')
    run(r, 0.4)
    expect(Math.abs(angleDelta(r.sim.player!.heading, Math.PI))).toBeLessThan(0.3)
    r.sys.input.keyDown('KeyW')
    for (let i = 0; i < 60 * 1.2; i++) {
      r.sys.update(DT)
      const c = r.camera.position
      expect(insideWallBox(boxes, c.x, c.y, c.z, 0)).toBeNull()
    }
    r.sys.input.keyUp('KeyW')
    expect(r.sim.player!.z).toBeLessThan(15) // well off the wall
    run(r, 4)
    expect(r.sys.chase.shoulderSide).toBe(1)
    expect(r.sys.chase.shoulderSwaps).toBe(2)
  })
})

describe('the write-back', () => {
  it('writes where you are, your mode and view to the sim every frame, and the slow store only when something changes', () => {
    const r = make()
    run(r, 0.1)
    let publishes = 0
    const unsub = useWalk.subscribe(() => publishes++)
    r.sys.input.keyDown('KeyW')
    run(r, 2)
    expect(publishes).toBe(0) // walking changes nothing the HUD shows from the store
    r.sys.input.keyDown('KeyV')
    run(r, 0.1)
    expect(publishes).toBe(1)
    unsub()
    expect(r.sim.entities.get('player')!.position.x).toBe(r.sim.player!.x)
  })

  it('keeps a pose another system gave you (sitting) while you stand still, and a step stands you up', () => {
    const r = make()
    run(r, 0.1)
    r.sim.playerAvatar!.anim = 'sit'
    run(r, 0.5)
    expect(r.sim.playerAvatar!.anim).toBe('sit')
    r.sys.input.keyDown('KeyW')
    run(r, 0.3)
    expect(r.sim.playerAvatar!.anim).toBe('walk')
  })

  it('survives a Jump: the sim is swapped for another that carries you over, and you carry on', () => {
    const r = make()
    run(r, 0.1)
    r.sys.input.keyDown('KeyW')
    run(r, 0.5)
    const next = new Simulation(5)
    const was = r.sim.player!
    const p = next.addPlayer({ at: { x: was.x, z: was.z }, heading: was.heading })
    p.mode = was.mode
    p.view = was.view
    let current = r.sim
    const sys = new PlayerSystem({ camera: r.camera, getSim: () => current, getRig: () => r.rig, reducedMotion: () => false })
    made.push(sys)
    run({ ...r, sys }, 0.2)
    const before = next.player!.x
    current = next
    for (let i = 0; i < 30; i++) sys.update(DT)
    expect(next.player!.x).toBeGreaterThan(before - 1e-9)
    expect(next.player!.mode).toBe('walk')
    // and a sim that does not have you yet gets you at once
    const bare = new Simulation(5)
    current = bare
    sys.update(DT)
    expect(bare.player).not.toBeNull()
    expect(bare.player!.x).toBeCloseTo(sys.snapshot().x, 6)
  })

  it('placeAt puts you on the nearest standing place, whatever it was asked for', () => {
    const r = make()
    run(r, 0.1)
    r.sys.placeAt(-62, 3, 2) // inside the façade (W3: not at z = 5, where a plant stands: placeAt keeps to the walls and the region)
    run(r, 0.1)
    expect(walkableAt(r.sim.player!.x, r.sim.player!.z)).toBe(true)
    expect(r.sim.player!.heading).toBeCloseTo(2, 6)
  })
})

describe('walkBody: the body\'s numbers for the legs, the doors, the camera and the quality ladder', () => {
  it('is published every frame: live, where you are, the velocity achieved, the velocity the keys ask for, the acceleration, the stop point', () => {
    const r = make()
    run(r, 0.1)
    expect(walkBody.live).toBe(true)
    expect(walkBody.x).toBe(r.sim.player!.x)
    expect(walkBody.z).toBe(r.sim.player!.z)
    expect(walkBody.stopping).toBe(false)
    expect(walkBody.wishX).toBe(0)
    r.sys.input.keyDown('KeyW')
    r.sys.update(DT)
    expect(walkBody.wishX).toBeCloseTo(CONFIG.player.walkSpeed, 9) // facing east
    expect(walkBody.vx).toBeGreaterThan(0)
    expect(walkBody.vx).toBeLessThan(0.1) // the first frame of a start: a gentle one
    expect(walkBody.ax).toBeGreaterThan(0)
    run(r, 1)
    expect(walkBody.vx).toBeCloseTo(CONFIG.player.walkSpeed, 6)
    expect(walkBody.x).toBe(r.sim.player!.x)
    expect(walkBody.restX).toBeGreaterThan(walkBody.x + 0.13) // 0.16 m of coast from a 1.4 m/s walk
    expect(walkBody.restX).toBeLessThan(walkBody.x + 0.2)
    expect(walkBody.stillFor).toBe(0)
    // let go: stopping, then at rest where it said
    const said = walkBody.restX
    r.sys.input.keyUp('KeyW')
    r.sys.update(DT)
    expect(walkBody.stopping).toBe(true)
    expect(walkBody.wishX).toBe(0)
    expect(walkBody.ax).toBeLessThan(0)
    run(r, 1)
    expect(walkBody.stopping).toBe(false)
    expect(Math.abs(walkBody.x - said)).toBeLessThan(0.01)
    expect(walkBody.stillFor).toBeGreaterThan(0.5)
    expect(walkBody.vx).toBe(0)
  })

  it('the turn rate is the heading\'s change per second, whatever turned it: A and D here', () => {
    const r = make()
    run(r, 0.1)
    r.sys.input.keyDown('KeyD')
    run(r, 0.5)
    expect(walkBody.turnRate).toBeLessThan(-2) // right: the heading gets smaller, about 140 degrees a second
    expect(walkBody.turnRate).toBeGreaterThan(-2.5)
    r.sys.input.keyUp('KeyD')
    run(r, 0.6)
    expect(walkBody.turnRate).toBe(0)
  })

  it('stands still (at rest, stillFor counting) in the overview, in a flight and while an overlay owns the keys', () => {
    const r = make()
    run(r, 0.1)
    r.sys.input.keyDown('KeyW')
    run(r, 1)
    r.sys.input.keyDown('Tab')
    run(r, FLIGHT.seconds + 0.2)
    expect(r.sim.player!.mode).toBe('overview')
    expect(walkBody.vx).toBe(0)
    expect(walkBody.vz).toBe(0)
    expect(walkBody.stopping).toBe(false)
    const was = walkBody.stillFor
    run(r, 1)
    expect(walkBody.stillFor).toBeCloseTo(was + 1, 6)
    expect(walkBody.live).toBe(true)
  })

  it('a pinned run (head on into a wall) publishes no velocity and keeps the intent: the legs see a body that is pushing, not moving', () => {
    const r = make()
    r.sys.placeAt(-66, 6, Math.PI / 2)
    run(r, 0.1)
    r.sys.input.keyDown('KeyW')
    r.sys.input.keyDown('ShiftLeft')
    run(r, 3)
    expect(walkBody.vx).toBe(0)
    expect(walkBody.wishX).toBeCloseTo(CONFIG.player.hurrySpeed, 9)
    expect(walkBody.stillFor).toBeGreaterThan(1)
  })
})

describe('tidy', () => {
  it('disposing hands the overview rig back awake and unregisters the room-focus bridge', () => {
    const r = make()
    run(r, 0.1)
    expect(r.rig.suspended).toBe(true)
    expect(isWalkMode()).toBe(true)
    r.sys.dispose()
    expect(r.rig.suspended).toBe(false)
    expect(r.rig.enabled).toBe(true)
    expect(isWalkMode()).toBe(false)
    registerWalkBridge(null)
  })
})
