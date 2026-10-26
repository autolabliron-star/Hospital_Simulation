import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { useOverviewLevel } from '@/scene/levels/levelView'
import { LEVEL2_FOOTPRINT, LEVEL_Y } from '@/sim/levels'
import { AREAS, areaById, type AreaId } from '@/sim/places'
import {
  DEFAULT_VIEW,
  areaLevel,
  drawnRect,
  fitDistance,
  poseToLookAt,
  presetBox,
  presetFor,
  registerControls,
  registerWalkBridge,
  tickFlight,
  type CameraPose,
  type FlightControls,
  type LookAt,
} from './cameraApi'
import { useFocus } from './focus.store'
import { chooseLevel, focusRoom, unfocus } from './roomFocus'

const L2: AreaId[] = AREAS.filter((a) => a.id.startsWith('l2')).map((a) => a.id)
const L1: AreaId[] = AREAS.filter((a) => !a.id.startsWith('l2')).map((a) => a.id)

class Rig implements FlightControls {
  camera = { fov: 35, aspect: 1.6 }
  readonly looks: number[][] = []
  getPosition(out: Vector3): Vector3 {
    return out.set(-11, 80, 66)
  }
  getTarget(out: Vector3): Vector3 {
    return out.set(-11, 0, 0)
  }
  setLookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
    this.looks.push([px, py, pz, tx, ty, tz])
  }
}

describe('the shots of the level-2 areas are drawn: over the footprint, on the level-2 floor', () => {
  it('there are twelve level-2 areas (R4: + the cryo suite and its control room), each on level 2', () => {
    expect(L2.length).toBe(12)
    for (const id of L2) expect(areaLevel(id), id).toBe(2)
    for (const id of L1) expect(areaLevel(id), id).toBe(1)
  })

  it('looks at a point inside the drawn footprint at y of about 4.2 (the floor, and a person\'s height at most above it)', () => {
    const f = LEVEL2_FOOTPRINT
    for (const id of L2) {
      const pose = presetFor(id)
      expect(pose.target.x, id).toBeGreaterThanOrEqual(f.x0)
      expect(pose.target.x, id).toBeLessThanOrEqual(f.x1)
      expect(pose.target.z, id).toBeGreaterThanOrEqual(f.z0)
      expect(pose.target.z, id).toBeLessThanOrEqual(f.z1)
      expect(pose.target.y, id).toBeGreaterThanOrEqual(LEVEL_Y[2])
      expect(pose.target.y, id).toBeLessThanOrEqual(LEVEL_Y[2] + 1.2)
    }
  })

  it('looks at a point inside the area itself, as drawn', () => {
    for (const id of L2) {
      const r = drawnRect(areaById(id).rect)
      const pose = presetFor(id)
      expect(pose.target.x, id).toBeGreaterThanOrEqual(r.x0)
      expect(pose.target.x, id).toBeLessThanOrEqual(r.x1)
      expect(pose.target.z, id).toBeGreaterThanOrEqual(r.z0)
      expect(pose.target.z, id).toBeLessThanOrEqual(r.z1)
    }
  })

  it('keeps the box it frames over the footprint, standing on the level-2 floor', () => {
    const f = LEVEL2_FOOTPRINT
    for (const id of L2) {
      const b = presetBox(id)
      expect(b.y0, id).toBeCloseTo(LEVEL_Y[2], 9)
      expect(b.y1, id).toBeGreaterThan(LEVEL_Y[2] + 1.5)
      expect(b.x0, id).toBeGreaterThanOrEqual(f.x0 - 1e-9)
      expect(b.x1, id).toBeLessThanOrEqual(f.x1 + 1e-9)
      expect(b.z0, id).toBeGreaterThanOrEqual(f.z0 - 1e-9)
      expect(b.z1, id).toBeLessThanOrEqual(f.z1 + 1e-9)
    }
  })

  it('puts the camera above the level-2 floor and looking down, at every shot', () => {
    const l: LookAt = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 }
    for (const id of L2) {
      const pose = presetFor(id)
      poseToLookAt(pose, l)
      expect(l.py, id).toBeGreaterThan(LEVEL_Y[2] + 5)
      expect(pose.pitchDeg, id).toBeGreaterThan(30)
      expect(pose.pitchDeg, id).toBeLessThan(75)
      expect(pose.distance, id).toBeGreaterThanOrEqual(9)
      expect(pose.distance, id).toBeLessThanOrEqual(55)
    }
  })

  it('fits the framed box in the window beside the room panel (the hand-tuned shots; the long corridors stop at the maximum distance)', () => {
    for (const id of ['l2Or', 'l2PreOp', 'l2Pacu', 'l2Cryo'] as const) {
      const pose = presetFor(id, DEFAULT_VIEW)
      const need = fitDistance(pose.target, pose.pitchDeg, pose.yawDeg, presetBox(id), DEFAULT_VIEW)
      expect(pose.distance, id).toBeGreaterThanOrEqual(Math.min(need, 40) - 1e-9)
    }
  })

  it('leaves every ground-floor shot where it was (level 1 is unchanged)', () => {
    expect(presetFor('lobby').target).toEqual({ x: -53, y: 0.6, z: 0 })
    expect(presetFor('mri').target).toEqual({ x: -35.5, y: 0.9, z: -7 })
    for (const id of L1) {
      const pose = presetFor(id)
      expect(pose.target.y, id).toBeLessThan(1.5)
      expect(presetBox(id).y0, id).toBe(0)
    }
  })
})

describe('the room focus switches the overview level', () => {
  let rig: Rig
  beforeEach(() => {
    rig = new Rig()
    registerControls(rig)
    useOverviewLevel.setState({ level: 1 })
    useFocus.setState({ area: null })
  })
  afterEach(() => {
    registerWalkBridge(null)
    registerControls(null)
    useOverviewLevel.setState({ level: 1 })
    useFocus.setState({ area: null })
  })

  /** Runs the flight to its end and returns where the camera was last put. */
  const land = (): number[] => {
    for (let i = 0; i < 200; i++) tickFlight(1 / 60)
    return rig.looks[rig.looks.length - 1]
  }

  it('shows Level 2 for a level-2 area, and flies the camera to it over the footprint', () => {
    focusRoom('l2Or')
    expect(useOverviewLevel.getState().level).toBe(2)
    expect(useFocus.getState().area).toBe('l2Or')
    const [px, py, , tx, ty] = land()
    expect(ty).toBeGreaterThan(LEVEL_Y[2])
    expect(py).toBeGreaterThan(ty)
    expect(tx).toBeLessThan(LEVEL2_FOOTPRINT.x1)
    expect(px).toBeLessThan(LEVEL2_FOOTPRINT.x1 + 40)
  })

  it('shows Level 1 for a ground-floor area, the ones under the slab (the lobby, triage, the ER) included', () => {
    for (const id of ['mri', 'lobby', 'triage', 'er', 'atrium'] as const) {
      useOverviewLevel.setState({ level: 2 })
      focusRoom(id)
      expect(useOverviewLevel.getState().level, id).toBe(1)
    }
  })

  it('every area sets its own level, from either level', () => {
    for (const id of [...L1, ...L2]) {
      for (const start of [1, 2] as const) {
        useOverviewLevel.setState({ level: start })
        focusRoom(id)
        expect(useOverviewLevel.getState().level, `${id} from ${start}`).toBe(areaLevel(id))
      }
    }
  })

  it('sets the level BEFORE it flies, also when you are walking (the player flies you out to the pose, and lands in the level set by then)', () => {
    const asked: { pose: CameraPose | null; level: number }[] = []
    registerWalkBridge({ walking: () => true, toOverview: (pose) => asked.push({ pose, level: useOverviewLevel.getState().level }) })
    focusRoom('l2Pacu')
    expect(asked.length).toBe(1)
    expect(asked[0].level).toBe(2)
    expect(asked[0].pose!.target.y).toBeGreaterThan(LEVEL_Y[2])
    expect(rig.looks).toEqual([])
  })

  it('the Level switch closes a room panel that is on the other level, and keeps one that is on this level', () => {
    focusRoom('l2Or')
    chooseLevel(2)
    expect(useFocus.getState().area).toBe('l2Or')
    chooseLevel(1)
    expect(useOverviewLevel.getState().level).toBe(1)
    expect(useFocus.getState().area).toBeNull()

    focusRoom('mri')
    chooseLevel(2)
    expect(useOverviewLevel.getState().level).toBe(2)
    expect(useFocus.getState().area).toBeNull()
  })

  it('leaving a room keeps the level you were looking at', () => {
    focusRoom('l2Or')
    unfocus()
    expect(useOverviewLevel.getState().level).toBe(2)
    expect(useFocus.getState().area).toBeNull()
  })
})
