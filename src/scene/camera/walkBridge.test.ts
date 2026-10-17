import { afterEach, describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  OVERVIEW_FOV_DEG,
  currentView,
  flyTo,
  getRig,
  isFlying,
  isWalkMode,
  overview,
  overviewPose,
  presetFor,
  registerControls,
  registerWalkBridge,
  tickFlight,
  type CameraPose,
  type FlightControls,
} from './cameraApi'

/** The rig as the room focus sees it, recording what it is asked to do. */
class Rig implements FlightControls {
  camera: { fov: number; aspect: number } = { fov: 60, aspect: 1.6 }
  suspended = false
  enabled = true
  readonly looks: number[][] = []
  getPosition(out: Vector3): Vector3 {
    return out.set(0, 80, 66)
  }
  getTarget(out: Vector3): Vector3 {
    return out.set(-11, 0, 0)
  }
  setLookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
    this.looks.push([px, py, pz, tx, ty, tz])
  }
}

afterEach(() => {
  registerWalkBridge(null)
  registerControls(null)
})

describe('the walk hand-over in the room focus', () => {
  it('a flight made while walking goes to the player, who flies you out to that very pose; the rig is not flown', () => {
    const rig = new Rig()
    registerControls(rig)
    const asked: (CameraPose | null)[] = []
    registerWalkBridge({ walking: () => true, toOverview: (p) => asked.push(p) })
    const pose = presetFor('mri')
    expect(isWalkMode()).toBe(true)
    flyTo(pose)
    expect(asked).toEqual([pose])
    expect(isFlying()).toBe(false)
    tickFlight(0.5)
    expect(rig.looks).toEqual([]) // nothing was written to the rig
  })

  it('overview() while walking asks for the whole-building shot, framed for the overview lens (not the walk lens)', () => {
    const rig = new Rig() // the camera's lens is the walk lens, 60 degrees
    registerControls(rig)
    const asked: (CameraPose | null)[] = []
    registerWalkBridge({ walking: () => true, toOverview: (p) => asked.push(p) })
    overview()
    expect(asked.length).toBe(1)
    const want = overviewPose(OVERVIEW_FOV_DEG, 1.6)
    expect(asked[0]!.distance).toBeCloseTo(want.distance, 9)
    expect(asked[0]!.pitchDeg).toBe(want.pitchDeg)
    expect(asked[0]!.target).toEqual(want.target)
  })

  it('shots are framed for the overview lens while walking, and for the real lens otherwise', () => {
    const rig = new Rig()
    registerControls(rig)
    registerWalkBridge({ walking: () => true, toOverview: () => undefined })
    expect(currentView(0.27)).toEqual({ fovDeg: OVERVIEW_FOV_DEG, aspect: 1.6, panelFrac: 0.27 })
    registerWalkBridge({ walking: () => false, toOverview: () => undefined })
    rig.camera.fov = 41
    expect(currentView(0.27).fovDeg).toBe(41)
    registerWalkBridge(null)
    expect(currentView(0).fovDeg).toBe(41)
  })

  it('when you are not walking, the flight is the rig\'s, as it always was', () => {
    const rig = new Rig()
    registerControls(rig)
    registerWalkBridge({ walking: () => false, toOverview: () => { throw new Error('not walking') } })
    expect(isWalkMode()).toBe(false)
    flyTo(presetFor('ct'), { seconds: 0.5 })
    expect(isFlying()).toBe(true)
    for (let i = 0; i < 40; i++) tickFlight(1 / 60)
    expect(isFlying()).toBe(false)
    expect(rig.looks.length).toBeGreaterThan(5)
  })

  it('getRig finds the rig only when it has the suspend switch', () => {
    registerControls(new Rig())
    expect(getRig()).not.toBeNull()
    const plain: FlightControls = { camera: {}, getPosition: (o) => o, getTarget: (o) => o, setLookAt: () => undefined }
    registerControls(plain)
    expect(getRig()).toBeNull()
    registerControls(null)
    expect(getRig()).toBeNull()
  })
})
