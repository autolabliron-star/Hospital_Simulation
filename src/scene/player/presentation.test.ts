/**
 * Presentation mode in the player system (src/ui/present): first person at 1.6 m with a 55 degree lens, a slow walk without running, no avatar (also in
 * flights), a cut to a shot and the eased glide between shots through walkable ground, and an exact return to the game's numbers on leaving.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { OVERVIEW_FOV_DEG, type RigHandle } from '@/scene/camera/cameraApi'
import { CONFIG } from '@/sim/config'
import { Simulation } from '@/sim/Simulation'
import type { PlayerViewKind } from '@/sim/types'
import { SHOTS, nextShot, shotYaw } from '@/ui/present/shots'
import { usePresentation } from '@/ui/present/presentation.store'
import { walkableAt } from './collision'
import { angleDelta } from './chaseMath'
import { useWalk, walkCam } from './state'
import { PlayerSystem } from './system'
import { PRESENT } from './tuning'

const DT = 1 / 60
const C = CONFIG.player.camera

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

/** The app's player system (walking starts through your eyes), or one that walks in third person (`view: 'third'`, the view V gives you). */
function make(view?: PlayerViewKind) {
  const sim = new Simulation(5)
  const camera = new PerspectiveCamera(OVERVIEW_FOV_DEG, 16 / 9, 1, 500)
  const rig = new FakeRig()
  const sys = new PlayerSystem({ camera, getSim: () => sim, getRig: () => rig, reducedMotion: () => false, walkView: view })
  made.push(sys)
  return { sim, camera, rig, sys }
}
type Rig = ReturnType<typeof make>

function run(r: Rig, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) r.sys.update(DT)
}

afterEach(() => {
  while (made.length) made.pop()?.dispose()
  walkCam.inputBlocked = false
  usePresentation.getState().setOn(false)
})

describe('the shots are places you can stand', () => {
  it('every shot of the lobby tour is walkable ground', () => {
    for (const s of SHOTS) expect(walkableAt(s.x, s.z), s.id).toBe(true)
  })
})

describe('turning presentation on and off', () => {
  it('walking already looks like it (step 3): first person at 1.6 m with the 55 degree lens and no avatar, before, during and after', () => {
    const r = make()
    run(r, 0.6)
    expect(r.sim.player!.view).toBe('first')
    expect(r.camera.fov).toBeCloseTo(PRESENT.fov, 6)
    expect(r.camera.position.y).toBeCloseTo(PRESENT.eyeHeight, 6)
    expect(r.sim.playerAvatar!.fade).toBe(0)
    usePresentation.getState().setOn(true)
    run(r, 1.5)
    expect(r.sim.player!.view).toBe('first')
    expect(r.camera.fov).toBeCloseTo(PRESENT.fov, 6)
    expect(r.camera.position.y).toBeCloseTo(PRESENT.eyeHeight, 6)
    usePresentation.getState().setOn(false)
    run(r, 2.5)
    // C off returns to first person (the walk view), not to the chase camera
    expect(r.sim.player!.view).toBe('first')
    expect(useWalk.getState().view).toBe('first')
    expect(r.camera.fov).toBeCloseTo(C.fovFirstDeg, 6)
    expect(r.camera.position.y).toBeCloseTo(C.eyeHeight, 6)
    expect(r.sim.playerAvatar!.fade).toBe(0)
    // and V still gives you the chase camera
    r.sys.input.keyDown('KeyV')
    r.sys.input.keyUp('KeyV')
    run(r, 1)
    expect(r.sim.player!.view).toBe('third')
    expect(r.camera.fov).toBeCloseTo(C.fovDeg, 6)
  })

  it('from the overview, C flies you down into the walkthrough and C again leaves you walking through your own eyes', () => {
    const r = make()
    run(r, 0.2)
    r.sys.beginToOverview(null)
    run(r, 3)
    expect(r.sim.player!.mode).toBe('overview')
    usePresentation.getState().setOn(true)
    run(r, 3)
    expect(r.sim.player!.mode).toBe('walk')
    usePresentation.getState().setOn(false)
    run(r, 2)
    expect(r.sim.player!.view).toBe('first')
    expect(r.camera.fov).toBeCloseTo(C.fovFirstDeg, 6)
  })

  it('from third person (V): first person at 1.6 m with the 55 degree lens, no avatar; leaving brings back the chase camera exactly', () => {
    const r = make('third')
    run(r, 0.2)
    const third = r.sim.player!.view
    expect(third).toBe('third')
    usePresentation.getState().setOn(true)
    run(r, 1.5)
    expect(r.sim.player!.view).toBe('first')
    expect(r.camera.fov).toBeCloseTo(PRESENT.fov, 6)
    expect(r.camera.position.y).toBeCloseTo(PRESENT.eyeHeight, 6)
    expect(r.sim.playerAvatar!.fade).toBe(0)
    expect(walkCam.avatarFade).toBe(0)
    usePresentation.getState().setOn(false)
    run(r, 2.5)
    expect(r.sim.player!.view).toBe('third')
    expect(r.camera.fov).toBeCloseTo(C.fovDeg, 6)
    expect(r.sim.playerAvatar!.fade).toBeGreaterThan(0.9)
    // the walk is the game's again, run included
    r.sys.input.keyDown('KeyW')
    r.sys.input.keyDown('ShiftLeft')
    run(r, 1.5)
    expect(r.sim.player!.speed).toBeCloseTo(CONFIG.player.hurrySpeed, 1)
  })

  it('walks and runs at the game pace (the owner wants full speed while presenting)', () => {
    const r = make()
    r.sys.placeAt(-61, 0, Math.PI / 2)
    usePresentation.getState().setOn(true)
    run(r, 1)
    r.sys.input.keyDown('KeyW')
    r.sys.input.keyDown('ShiftLeft')
    run(r, 1.5)
    expect(PRESENT.speedScale).toBe(1)
    expect(r.sim.player!.speed).toBeCloseTo(CONFIG.player.hurrySpeed, 2)
    // no head bob in the walkthrough: the camera stays at the eye height while walking
    expect(r.camera.position.y).toBeCloseTo(PRESENT.eyeHeight, 6)
  })

  it('keeps the view first person: V, the wheel and Tab do nothing while presenting', () => {
    const r = make()
    usePresentation.getState().setOn(true)
    run(r, 1)
    r.sys.input.keyDown('KeyV')
    r.sys.input.keyUp('KeyV')
    r.sys.input.keyDown('Tab')
    r.sys.input.keyUp('Tab')
    run(r, 1)
    expect(r.sim.player!.view).toBe('first')
    expect(r.sim.player!.mode).toBe('walk')
  })

  it('from the overview it flies down to walking and the avatar is never visible, flight included', () => {
    const r = make()
    run(r, 0.2)
    r.sys.beginToOverview(null)
    run(r, 3)
    expect(r.sim.player!.mode).toBe('overview')
    usePresentation.getState().setOn(true)
    for (let i = 0; i < 60 * 3; i++) {
      r.sys.update(DT)
      expect(r.sim.playerAvatar!.fade).toBe(0)
    }
    expect(r.sim.player!.mode).toBe('walk')
    expect(r.sim.player!.view).toBe('first')
    expect(r.camera.fov).toBeCloseTo(PRESENT.fov, 3)
  })

  it('C pressed during the flight out to the overview is queued: the flight finishes, then the walkthrough starts (F-08)', () => {
    const r = make()
    run(r, 0.2)
    r.sys.beginToOverview(null)
    run(r, 0.3)
    expect(r.sim.player!.mode).toBe('toOverview')
    usePresentation.getState().setOn(true) // C
    r.sys.update(DT)
    expect(r.sim.player!.mode).toBe('toOverview') // the flight was not undone
    expect(usePresentation.getState().on).toBe(false)
    let landed = false
    for (let i = 0; i < 60 * 3 && !landed; i++) {
      r.sys.update(DT)
      landed = r.sim.player!.mode === 'overview'
    }
    expect(landed).toBe(true) // it did land in the overview first
    run(r, 4)
    expect(usePresentation.getState().on).toBe(true)
    expect(r.sim.player!.mode).toBe('walk')
    expect(r.sim.player!.view).toBe('first')
    expect(r.camera.fov).toBeCloseTo(PRESENT.fov, 3)
    expect(r.sim.playerAvatar!.fade).toBe(0)
  })

  it('a queued walkthrough is forgotten if you walk back down yourself first (Tab)', () => {
    const r = make()
    run(r, 0.2)
    r.sys.beginToOverview(null)
    run(r, 0.3)
    usePresentation.getState().setOn(true)
    r.sys.update(DT)
    expect(usePresentation.getState().on).toBe(false)
    r.sys.input.keyDown('Tab') // you reverse the flight yourself: walking back down
    run(r, 5)
    expect(r.sim.player!.mode).toBe('walk')
    expect(usePresentation.getState().on).toBe(false)
    expect(r.sim.player!.view).toBe('first') // the walk view (step 3), not the walkthrough's
  })

  it('a flight out to the overview ends the walkthrough (the game\'s camera, speed and avatar return)', () => {
    const r = make()
    usePresentation.getState().setOn(true)
    run(r, 1)
    r.sys.beginToOverview(null)
    expect(usePresentation.getState().on).toBe(false)
    run(r, 3)
    expect(r.sim.player!.mode).toBe('overview')
    expect(r.sim.playerAvatar!.fade).toBeGreaterThan(0.9)
  })
})

describe('cuts and glides', () => {
  it('a cut puts you at the shot, level, looking at its target, fully blended after one frame', () => {
    const r = make()
    r.sys.presentCut(0)
    run(r, 0.05)
    const s = SHOTS[0]
    expect(usePresentation.getState().on).toBe(true)
    expect(r.sys.presentState.shot).toBe(0)
    expect(Math.hypot(r.sim.player!.x - s.x, r.sim.player!.z - s.z)).toBeLessThan(0.05)
    expect(r.camera.position.y).toBeCloseTo(1.6, 6)
    expect(r.camera.fov).toBeCloseTo(55, 6)
    expect(Math.abs(angleDelta(r.sys.snapshot().facing, shotYaw(s)))).toBeLessThan(1e-6)
    // it looks level at the target: the camera's forward points at the look point
    const dir = new Vector3()
    r.camera.getWorldDirection(dir)
    expect(Math.atan2(dir.x, dir.z)).toBeCloseTo(shotYaw(s), 5)
    expect(Math.abs(dir.y)).toBeLessThan(1e-6)
  })

  it('every shot cuts to a settled, walkable pose', () => {
    const r = make()
    for (let i = 0; i < SHOTS.length; i++) {
      r.sys.presentCut(i)
      run(r, 0.05)
      expect(walkableAt(r.sim.player!.x, r.sim.player!.z)).toBe(true)
      expect(r.sys.presentState.shot).toBe(i)
    }
  })

  it('a glide runs 6 to 8 s on walkable ground, ends on the next shot, never jumps and never leaves the eye height', () => {
    const r = make()
    r.sys.presentCut(0)
    run(r, 0.1)
    r.sys.presentGlide()
    let frames = 0
    let last = r.camera.position.clone()
    let maxStep = 0
    let lastYaw = r.sys.snapshot().facing
    let maxTurn = 0
    run(r, DT) // the glide starts on the next frame
    expect(r.sys.presentState.gliding).toBe(true)
    while (r.sys.presentState.gliding && frames < 60 * 12) {
      r.sys.update(DT)
      frames++
      expect(walkableAt(r.sim.player!.x, r.sim.player!.z)).toBe(true)
      expect(r.camera.position.y).toBeCloseTo(1.6, 6)
      maxStep = Math.max(maxStep, r.camera.position.distanceTo(last))
      last = r.camera.position.clone()
      const yaw = r.sys.snapshot().facing
      maxTurn = Math.max(maxTurn, Math.abs(angleDelta(lastYaw, yaw)))
      lastYaw = yaw
    }
    expect(frames / 60).toBeGreaterThanOrEqual(5.9)
    expect(frames / 60).toBeLessThanOrEqual(8.1)
    expect(maxStep * 60).toBeLessThan(3.5)
    expect(maxTurn * 60).toBeLessThan(1.5) // rad/s: a calm turn
    const to = SHOTS[nextShot(0)]
    run(r, 0.1)
    expect(Math.hypot(r.sim.player!.x - to.x, r.sim.player!.z - to.z)).toBeLessThan(0.1)
    expect(r.sys.presentState.shot).toBe(1)
    expect(Math.abs(angleDelta(r.sys.snapshot().facing, shotYaw(to)))).toBeLessThan(1e-3)
  })

  it('N four times loops back to the first shot', () => {
    const r = make()
    r.sys.presentCut(0)
    run(r, 0.1)
    for (let k = 0; k < 4; k++) {
      r.sys.presentGlide()
      run(r, 9)
    }
    expect(r.sys.presentState.shot).toBe(0)
    expect(Math.hypot(r.sim.player!.x - SHOTS[0].x, r.sim.player!.z - SHOTS[0].z)).toBeLessThan(0.15)
  })

  it('a glide asked for while presentation is off turns it on and glides to the first shot from where you stand', () => {
    const r = make()
    run(r, 0.2)
    r.sys.placeAt(-57, 1, 0.5)
    r.sys.presentGlide()
    run(r, 0.5)
    expect(usePresentation.getState().on).toBe(true)
    expect(r.sys.presentState.gliding).toBe(true)
    run(r, 9)
    expect(r.sys.presentState.gliding).toBe(false)
    expect(r.sys.presentState.shot).toBe(0)
    expect(Math.hypot(r.sim.player!.x - SHOTS[0].x, r.sim.player!.z - SHOTS[0].z)).toBeLessThan(0.15)
  })

  it('a walk key ends the glide at once and you walk on from where you are', () => {
    const r = make()
    r.sys.presentCut(0)
    run(r, 0.1)
    r.sys.presentGlide()
    run(r, 2)
    expect(r.sys.presentState.gliding).toBe(true)
    r.sys.input.keyDown('KeyD')
    run(r, 0.1)
    expect(r.sys.presentState.gliding).toBe(false)
  })

  it('people in the way hold the glide off (the body slides, it is not teleported along the path)', () => {
    const r = make()
    r.sys.presentCut(0)
    run(r, 0.1)
    const e = r.sim.entities.get('player')!
    const stranger = { ...e, id: 'stranger', name: 'Stranger', position: { x: -57, y: 0, z: 0 }, role: 'visitor', anim: 'idle' }
    r.sim.entities.set('stranger', stranger as typeof e)
    r.sys.presentGlide()
    for (let i = 0; i < 60 * 8; i++) {
      r.sys.update(DT)
      expect(Math.hypot(r.sim.player!.x - stranger.position.x, r.sim.player!.z - stranger.position.z)).toBeGreaterThan(0.45)
    }
  })
})
