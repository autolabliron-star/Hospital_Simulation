/**
 * R5: the watch director with the REAL player system (src/scene/player/system.ts) and a real hospital: under the camera lease the player stands you still
 * and unseen and never writes the lens; the watch takes it into the robotic theatre; and the hand-back puts you, your mode and your camera back exactly,
 * from walk mode and from the overview (through the player's own flights).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { cameraLeased, leaseCamera, releaseCamera, type RigHandle } from '@/scene/camera/cameraApi'
import { walkCam } from '@/scene/player/state'
import { PlayerSystem } from '@/scene/player/system'
import { WallBoxProbe } from '@/scene/player/boomProbe'
import { areaById, SURGERY } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import { LEVEL2_DX } from '@/sim/levels'
import type { AreaId } from '@/sim/places'
import type { LevelId } from '@/sim/levels'
import { WatchDirector } from './director'
import type { WatchSim } from './rooms'
import { DIP_SECONDS } from './dolly'

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

const made: PlayerSystem[] = []
const probe = new WallBoxProbe()

function make() {
  const sim = new Simulation(5)
  const camera = new PerspectiveCamera(35, 16 / 9, 1, 500)
  const rig = new FakeRig()
  const sys = new PlayerSystem({ camera, getSim: () => sim, getRig: () => rig, reducedMotion: () => false })
  made.push(sys)
  const level = { value: 1 as LevelId }
  const area = { value: null as AreaId | null }
  const director = new WatchDirector({
    camera,
    sim: () => sim as unknown as WatchSim,
    generation: () => 0,
    player: {
      phase: () => sys.mode,
      snapshot: () => sys.snapshot(),
      viewPitch: () => sys.viewPitch,
      place: (x, z, h) => sys.placeAt(x, z, h),
      requestWalk: () => sys.requestWalk(),
      afterLease: (t, look) => sys.afterLease(t, look),
    },
    rig: () => rig,
    // the room focus while walking: the player's own flight out (cameraApi's walk bridge)
    flyTo: (pose) => sys.beginToOverview(pose),
    overviewLevel: { get: () => level.value, set: (l) => (level.value = l) },
    focusArea: { get: () => area.value, set: (a) => (area.value = a) },
    lease: { take: () => leaseCamera('watch'), release: () => releaseCamera('watch') },
    reducedMotion: () => false,
    probe,
    simCamera: walkCam.camera,
    publish: () => undefined,
  })
  /** One frame of the app: the player (-10), then the watch camera (-9.4). */
  const frame = (): void => {
    sys.update(DT)
    director.update(DT)
  }
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds / DT); i++) frame()
  }
  return { sim, camera, rig, sys, director, level, area, frame, run }
}

afterEach(() => {
  while (made.length) made.pop()?.dispose()
  releaseCamera('watch')
  walkCam.inputBlocked = false
})

const OR = areaById('l2Or').rect

describe('the player under the camera lease', () => {
  it('never writes the lens, stands you still and hides your avatar; the walk camera comes back when the lease ends', () => {
    const r = make()
    r.run(0.5)
    const at = { x: r.sim.player!.x, z: r.sim.player!.z }
    expect(leaseCamera('watch')).toBe(true)
    expect(cameraLeased()).toBe(true)
    r.camera.position.set(1, 2, 3)
    walkCam.camera.x = 42
    for (let i = 0; i < 30; i++) r.sys.update(DT)
    expect(r.camera.position.toArray()).toEqual([1, 2, 3])
    expect(walkCam.camera.x).toBe(42)
    expect(r.sim.playerAvatar!.fade).toBe(0)
    expect([r.sim.player!.x, r.sim.player!.z]).toEqual([at.x, at.z])
    releaseCamera('watch')
    r.sys.update(DT)
    expect(r.camera.position.distanceTo(new Vector3(1, 2, 3))).toBeGreaterThan(1)
  })
})

describe('watching with the real player', () => {
  it('from walk mode: the camera goes into the theatre, and comes back exactly to where you were looking from', () => {
    const r = make()
    r.run(0.6)
    const before = { x: r.sim.player!.x, z: r.sim.player!.z, heading: r.sim.player!.heading, pos: r.camera.position.clone(), dir: r.camera.getWorldDirection(new Vector3()) }
    expect(r.director.begin({ room: 'or', mode: 'watch', procedureId: 'or-cholecystectomy' })).toBe(true)
    // you stand at the viewing window, in walk mode, on level 2
    expect(r.sys.snapshot().x).toBeCloseTo(SURGERY.viewing.at.x, 0)
    expect(r.sys.snapshot().z).toBeCloseTo(SURGERY.viewing.at.z, 0)
    r.run(DIP_SECONDS + 0.2)
    expect(r.sim.player!.x).toBeCloseTo(SURGERY.viewing.at.x, 0)
    expect(r.director.phase).toBe('live')
    expect(r.sys.mode).toBe('walk')
    // the drawn camera is inside the theatre (level 2 is drawn 150 m west, 4.2 m up)
    const x = r.camera.position.x + LEVEL2_DX
    expect(x).toBeGreaterThan(OR.x0)
    expect(x).toBeLessThan(OR.x1)
    expect(r.camera.position.y).toBeGreaterThan(4.2 + 1)
    expect(r.sim.playerAvatar!.fade).toBe(0)
    r.run(2)

    r.director.end()
    r.run(DIP_SECONDS + 0.1)
    expect(r.director.phase).toBe('off')
    expect(cameraLeased()).toBe(false)
    expect(r.sim.player!.x).toBeCloseTo(before.x, 6)
    expect(r.sim.player!.z).toBeCloseTo(before.z, 6)
    expect(r.sim.player!.heading).toBeCloseTo(before.heading, 6)
    r.run(0.3)
    expect(r.camera.position.distanceTo(before.pos)).toBeLessThan(0.01)
    expect(r.camera.getWorldDirection(new Vector3()).distanceTo(before.dir)).toBeLessThan(0.01)
    expect(r.camera.near).toBe(0.1)
  })

  it('from the overview: your flight down, then back up to the shot you were on, and you stand where you stood', () => {
    const r = make()
    r.run(0.3)
    r.sys.beginToOverview(null)
    r.run(3)
    expect(r.sys.mode).toBe('overview')
    const stood = { x: r.sim.player!.x, z: r.sim.player!.z }
    const shot = { pos: r.rig.pos.clone(), tgt: r.rig.tgt.clone() }
    r.area.value = 'l2Or'
    expect(r.director.begin({ room: 'or', mode: 'watch', procedureId: 'or-cholecystectomy' })).toBe(true)
    expect(r.sys.mode).toBe('toWalk')
    r.run(3)
    expect(r.sys.mode).toBe('walk')
    expect(r.director.phase).toBe('live')

    r.director.end()
    expect(cameraLeased()).toBe(false)
    expect(r.sys.mode).toBe('toOverview')
    r.run(3)
    expect(r.sys.mode).toBe('overview')
    expect(r.director.phase).toBe('off')
    expect([r.sim.player!.x, r.sim.player!.z]).toEqual([stood.x, stood.z])
    expect(r.rig.pos.distanceTo(shot.pos)).toBeLessThan(1e-6)
    expect(r.rig.tgt.distanceTo(shot.tgt)).toBeLessThan(1e-6)
    expect(r.rig.suspended).toBe(false)
    expect(r.area.value).toBe('l2Or')
  })
})
