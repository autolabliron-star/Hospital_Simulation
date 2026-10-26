/**
 * R4: the suite's live 3D in node, driven by hand-made states: at most 7 draw calls with the screens, only materials the hospital already compiles,
 * the CT turned to face east with its table where the contract says, the rotor spinning only while scanning, the lasers, the arm and the needles
 * written without a NaN, and a frame that allocates nothing measurable.
 */
import { Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'
import { mockEnv } from '@/scene/imaging/images/mockCanvas'
import { MACHINE_BODY, MACHINE_GLOW } from '@/scene/imaging/machines/machineMaterials'
import { MAT } from '@/scene/materials'
import { CRYO_SUITE } from '@/sim/places'
import { cryoTableX } from './pose'
import { BOX_COUNT, createCryoRig, CYL_COUNT, drawCallsOf, MAX_NEEDLES, type CryoRig } from './rig'
import { createCryoScreens } from './screens'
import { cryoState } from './testkit'

const _m = new Matrix4()
const hidden = (mesh: { getMatrixAt(i: number, m: Matrix4): void }, i: number): boolean => {
  mesh.getMatrixAt(i, _m)
  return _m.determinant() === 0
}

function stepAll(rig: CryoRig, s = cryoState(), t = 100, dt = 1 / 60): void {
  rig.step({ state: s, t, dt })
}

describe('the rig\'s build', () => {
  const rig = createCryoRig()
  const screens = createCryoScreens(mockEnv().env)

  it('is six meshes plus the screens: 7 draw calls, on MACHINE_BODY, MACHINE_GLOW, the palette\'s tinted and the screens\' basic map (no new program)', () => {
    expect(drawCallsOf(rig) + 1).toBeLessThanOrEqual(7)
    expect(rig.root.children).toHaveLength(6)
    for (const m of [rig.ctStatic, rig.rotor, rig.cradle]) expect(m.material).toBe(MACHINE_BODY)
    expect(rig.glow.material).toBe(MACHINE_GLOW)
    expect(rig.boxes.material).toBe(MAT.tinted)
    expect(rig.cyls.material).toBe(MAT.tinted)
    expect(BOX_COUNT).toBeLessThanOrEqual(12)
    expect(CYL_COUNT).toBeLessThanOrEqual(16)
    expect(MAX_NEEDLES).toBe(6)
    // the screens' material is the imaging monitors' kind: a map, no tone mapping, vertex colours
    expect(screens.material.map).toBe(screens.texture)
    expect(screens.material.toneMapped).toBe(false)
    expect(screens.material.vertexColors).toBe(true)
  })

  it('never casts (level 2 never casts into the baked sun shadow)', () => {
    for (const m of rig.meshes()) expect(m.castShadow, m.name).toBe(false)
  })

  it('the CT is the imaging CT turned to face east: the gantry at the suite\'s machine anchor, the pedestal east of it, inside the footprints', () => {
    const g = rig.ctStatic.geometry
    g.computeBoundingBox()
    const bb = g.boundingBox!
    const m = CRYO_SUITE.ct.machine
    // the gantry's housing is 0.9 m deep (x) and 1.9 m wide (z); the pedestal runs east to x -57.4 (drawn)
    expect(bb.min.x).toBeGreaterThan(m.x - 0.48)
    expect(bb.max.x).toBeLessThan(m.x + 2.65)
    expect(bb.min.z).toBeGreaterThan(m.z - 0.97)
    expect(bb.max.z).toBeLessThan(m.z + 0.97)
    expect(bb.max.y).toBeLessThan(2.0)
    // the rotor in the plane the target reaches with the table in
    expect(rig.rotor.position.x).toBeCloseTo(m.x + 0.2, 6)
  })
})

describe('the rig\'s step', () => {
  it('moves the cradle with tablePos, spins the rotor only with `rotor`, fades the lasers in and out', () => {
    const rig = createCryoRig()
    const s = cryoState({ step: 'planningCt', tablePos: 0 })
    s.rotor = 0
    s.lasers = false
    stepAll(rig, s)
    expect(rig.cradle.position.x).toBeCloseTo(cryoTableX(0), 9)
    const a0 = rig.memory.angle
    for (let i = 0; i < 30; i++) stepAll(rig, s)
    expect(rig.memory.angle).toBe(a0)
    s.tablePos = 0.5
    s.rotor = 1
    s.lasers = true
    for (let i = 0; i < 30; i++) stepAll(rig, s)
    expect(rig.cradle.position.x).toBeCloseTo(cryoTableX(0.5), 9)
    expect(rig.memory.angle).not.toBe(a0)
    expect(rig.memory.laser).toBeCloseTo(1, 6)
    expect(rig.memory.status).toBeCloseTo(1, 6)
    s.lasers = false
    s.rotor = 0
    for (let i = 0; i < 60; i++) stepAll(rig, s)
    expect(rig.memory.laser).toBe(0)
    const a1 = rig.memory.angle
    stepAll(rig, s)
    expect(rig.memory.angle).toBe(a1)
  })

  it('writes every instance without a NaN in every robot phase, and shows only the needles that are in (or waiting in the guide)', () => {
    const rig = createCryoRig()
    for (const robot of ['stowed', 'deploying', 'aiming', 'aligned', 'retracting'] as const) {
      const s = cryoState({ step: 'aim', needles: 4, robot, robotNeedle: 1, inserted: [1, 0, 0, 0] })
      rig.snap()
      stepAll(rig, s, 10)
      for (const a of [rig.boxes.instanceMatrix.array, rig.cyls.instanceMatrix.array]) for (const v of a) expect(Number.isFinite(v)).toBe(true)
      // the arm is drawn
      expect(hidden(rig.boxes, 1)).toBe(false)
      // needle 0 is in; 1 waits in the guide only while aligned; 2, 3 not yet; 4, 5 do not exist
      expect(hidden(rig.cyls, 6)).toBe(false)
      expect(hidden(rig.cyls, 7)).toBe(robot !== 'aligned')
      expect(hidden(rig.cyls, 8)).toBe(true)
      expect(hidden(rig.cyls, 10)).toBe(true)
      expect(hidden(rig.cyls, 11)).toBe(true)
    }
  })

  it('eases the arm toward a new target (no jump), and snaps after a Jump', () => {
    const rig = createCryoRig()
    const s = cryoState({ step: 'aim', robot: 'stowed' })
    stepAll(rig, s, 0)
    const g0 = { ...rig.memory.guide.g }
    s.robot.phase = 'aligned'
    s.robot.needle = 0
    stepAll(rig, s, 1, 1 / 60)
    const moved = Math.hypot(rig.memory.guide.g.x - g0.x, rig.memory.guide.g.y - g0.y, rig.memory.guide.g.z - g0.z)
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThan(0.1)
    rig.snap()
    stepAll(rig, s, 2, 1 / 60)
    expect(Math.hypot(rig.memory.guide.g.x - rig.memory.target.g.x, rig.memory.guide.g.y - rig.memory.target.g.y, rig.memory.guide.g.z - rig.memory.target.g.z)).toBeLessThan(1e-9)
  })

  // No heap-growth test here: under vitest the pose maths runs unoptimised and boxes its doubles (about 400 bytes a call, the same for the
  // existing da Vinci pose code), so the heap grows with no object allocated. The guard is the static check in noAllocations.test.ts.
})
