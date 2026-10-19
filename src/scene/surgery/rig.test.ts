/**
 * The robot rig in node, driven by hand-made states: three draw calls, the shared palette material and the imaging glow material (no new shader program), the
 * instance counts, every pose written without a NaN, the arms' links in the right places, the sterile drapes, the laser, the lights' faces, the LEDs, and a
 * frame that allocates nothing.
 */
import inspector from 'node:inspector'
import { Color, Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'
import { MACHINE_GLOW } from '@/scene/imaging/machines/machineMaterials'
import { MAT } from '@/scene/materials'
import { SURGERY } from '@/sim/places'
import { LIGHTS } from './dims'
import { BOX_COUNT, createSurgeryRig, CYL_COUNT, drawCallsOf, GLOW_COUNT, ledModeOf, trianglesOf, type SurgeryRig, type SurgeryRigStep } from './rig'
import { CART } from './robotPose'
import { dockedRobot, stowedRobot, surgeryState, theatre } from './testkit'

function step(rig: SurgeryRig, over: Partial<SurgeryRigStep> = {}): void {
  const s = surgeryState()
  rig.step({ robot: s.robot, theatre: s.theatre, t: 100, dt: 1 / 60, overview: false, ...over })
}

const _m = new Matrix4()
const hiddenAt = (mesh: { getMatrixAt(i: number, m: Matrix4): void }, i: number): boolean => {
  mesh.getMatrixAt(i, _m)
  return _m.determinant() === 0
}
const posAt = (mesh: { getMatrixAt(i: number, m: Matrix4): void }, i: number): [number, number, number] => {
  mesh.getMatrixAt(i, _m)
  return [_m.elements[12], _m.elements[13], _m.elements[14]]
}
const colourAt = (mesh: { getColorAt(i: number, c: Color): void }, i: number): Color => {
  const c = new Color()
  mesh.getColorAt(i, c)
  return c
}

describe('the rig\'s build', () => {
  const rig = createSurgeryRig()

  it('is three instanced pools: boxes and cylinders on the palette\'s tinted material, glow on the imaging machines\' glow material (no new shader program)', () => {
    expect(rig.boxes.material).toBe(MAT.tinted)
    expect(rig.cyls.material).toBe(MAT.tinted)
    expect(rig.glow.material).toBe(MACHINE_GLOW)
    expect(rig.meshes()).toEqual([rig.boxes, rig.cyls, rig.glow])
    expect(rig.root.children).toHaveLength(3)
  })

  it('is at most three draw calls and a small, bounded number of instances and triangles', () => {
    expect(drawCallsOf(rig)).toBeLessThanOrEqual(3)
    expect(rig.boxes.count).toBe(BOX_COUNT)
    expect(rig.cyls.count).toBe(CYL_COUNT)
    expect(rig.glow.count).toBe(GLOW_COUNT)
    expect(BOX_COUNT + CYL_COUNT + GLOW_COUNT).toBeLessThanOrEqual(90)
    // eslint-disable-next-line no-console
    console.log(`surgery rig: ${BOX_COUNT + CYL_COUNT + GLOW_COUNT} instances, ${trianglesOf(rig)} triangles, ${drawCallsOf(rig)} draw calls`)
    expect(trianglesOf(rig)).toBeLessThan(40_000)
  })

  it('never culls, casts or receives shadows (the OR lives in level 2, which never casts into the baked sun shadow), and gives every instance a colour from the start', () => {
    for (const m of rig.meshes()) {
      expect(m.frustumCulled).toBe(false)
      expect(m.castShadow).toBe(false)
      expect(m.receiveShadow).toBe(false)
      expect((m as unknown as { instanceColor: unknown }).instanceColor).not.toBeNull()
    }
  })

  it('starts with every instance collapsed: nothing is drawn before the first step', () => {
    for (const m of [rig.boxes, rig.cyls, rig.glow]) for (let i = 0; i < m.count; i++) expect(hiddenAt(m, i)).toBe(true)
  })
})

describe('writing the robot', () => {
  it('writes finite matrices in every phase\'s pose', () => {
    const rig = createSurgeryRig()
    const states = [
      stowedRobot('stowed'),
      stowedRobot('draping', 0.5),
      stowedRobot('draped', 1),
      dockedRobot('transverse', { phase: 'deploying', boomHeight: 2.0, boomExtend: 0.2, arms: stowedRobot('stowed', 1).arms }),
      dockedRobot('oblique', { phase: 'driving', laser: true, arms: stowedRobot('stowed', 1).arms }),
      dockedRobot('oblique', { phase: 'targeting' }),
      dockedRobot('transverse'),
      dockedRobot('transverse', { phase: 'undocking' }),
      stowedRobot('cleaning', 0.3),
    ]
    for (const r of states) {
      step(rig, { robot: r })
      for (const m of [rig.boxes, rig.cyls, rig.glow]) for (const v of m.instanceMatrix.array) expect(Number.isFinite(v), r.phase).toBe(true)
    }
  })

  it('puts the base on the floor where the cart is, wheels on the floor, and the column and boom at the state\'s height', () => {
    const rig = createSurgeryRig()
    const r = dockedRobot('transverse', { boomHeight: 2.3 })
    step(rig, { robot: r })
    const base = posAt(rig.boxes, 0)
    expect(base[0]).toBeCloseTo(r.cart.x, 5)
    expect(base[2]).toBeCloseTo(r.cart.z, 5)
    expect(base[1]).toBeGreaterThan(0.1)
    expect(base[1]).toBeLessThan(CART.baseTop)
    for (let i = 0; i < 4; i++) expect(posAt(rig.cyls, i)[1]).toBeCloseTo(0.1, 5)
    // the boom beam's top is the boom height: its centre is half a beam thickness under it
    const beam = posAt(rig.boxes, 3)
    expect(beam[1]).toBeCloseTo(2.3 - 0.09, 5)
    // the head sits at the end of the boom
    const head = posAt(rig.boxes, 4)
    expect(Math.hypot(head[0] - rig.pose.headX, head[2] - rig.pose.headZ)).toBeLessThan(1e-5)
  })

  it('draws each arm\'s links from its shoulder to the elbow to the wrist, and the instrument through the port', () => {
    const rig = createSurgeryRig()
    step(rig, { robot: dockedRobot('transverse') })
    for (const a of rig.pose.arms) {
      const upper = posAt(rig.boxes, 6 + a.index * 3)
      expect(upper[0]).toBeCloseTo((a.sx + a.ex) / 2, 4)
      expect(upper[1]).toBeCloseTo((a.sy + a.ey) / 2, 4)
      const fore = posAt(rig.boxes, 6 + a.index * 3 + 1)
      expect(fore[0]).toBeCloseTo((a.ex + a.wx) / 2, 4)
      expect(fore[2]).toBeCloseTo((a.ez + a.wz) / 2, 4)
      // the shaft (cylinder 5 of the arm's ten) runs from the carriage into the patient
      const shaft = 6 + a.index * 10 + 5
      expect(hiddenAt(rig.cyls, shaft)).toBe(false)
      const p = posAt(rig.cyls, shaft)
      expect(p[1]).toBeLessThan(a.cy)
      expect(p[1]).toBeGreaterThan(a.ty)
    }
  })

  it('hides the instrument shaft of an arm with no instrument fitted', () => {
    const rig = createSurgeryRig()
    const r = dockedRobot('transverse')
    r.arms[2].instrument = ''
    step(rig, { robot: r })
    expect(hiddenAt(rig.cyls, 6 + 2 * 10 + 5)).toBe(true)
    expect(hiddenAt(rig.cyls, 6 + 1 * 10 + 5)).toBe(false)
  })

  it('slides the sterile sleeves over the links with `drape`: none at 0, the upper arm and forearm at 0.2, all three at 1', () => {
    const rig = createSurgeryRig()
    const arm0 = 6 // the first arm's first cylinder
    step(rig, { robot: stowedRobot('stowed', 0) })
    for (const k of [6, 7, 8, 9]) expect(hiddenAt(rig.cyls, arm0 + k), `drape 0, sleeve ${k}`).toBe(true)
    step(rig, { robot: stowedRobot('draping', 0.2) })
    expect(hiddenAt(rig.cyls, arm0 + 6)).toBe(false)
    expect(hiddenAt(rig.cyls, arm0 + 7)).toBe(false)
    expect(hiddenAt(rig.cyls, arm0 + 8)).toBe(true)
    step(rig, { robot: stowedRobot('draped', 1) })
    for (const k of [6, 7, 8, 9]) expect(hiddenAt(rig.cyls, arm0 + k), `drape 1, sleeve ${k}`).toBe(false)
  })

  it('draws the laser crosshair only while the laser is on, from the boom\'s head onto the patient', () => {
    const rig = createSurgeryRig()
    const glowIdx = { beam: 0, barX: 1, barZ: 2, dot: 3 }
    step(rig, { robot: dockedRobot('transverse', { laser: false }) })
    for (const i of Object.values(glowIdx)) expect(hiddenAt(rig.glow, i)).toBe(true)
    const r = dockedRobot('transverse', { laser: true })
    step(rig, { robot: r })
    for (const i of Object.values(glowIdx)) expect(hiddenAt(rig.glow, i)).toBe(false)
    const dot = posAt(rig.glow, glowIdx.dot)
    expect(dot[0]).toBeCloseTo(SURGERY.ports.transverse[1].x, 5)
    expect(dot[2]).toBeCloseTo(SURGERY.ports.transverse[1].z, 5)
    // the beam's middle is between the head and the port
    const beam = posAt(rig.glow, glowIdx.beam)
    expect(beam[1]).toBeGreaterThan(SURGERY.ports.transverse[1].y)
    expect(beam[1]).toBeLessThan(2.3)
    // and it is red and bright (feeds the bloom)
    const c = colourAt(rig.glow, glowIdx.beam)
    expect(c.r).toBeGreaterThan(1)
    expect(c.g).toBeLessThan(0.5)
  })

  it('eases the patient\'s sterile drape in from the ports phase to the closing one, and out again after', () => {
    const rig = createSurgeryRig()
    const drape = 5
    const th = (phase: Parameters<typeof theatre>[0]) => theatre(phase)
    step(rig, { theatre: th('positioning'), dt: 1 })
    expect(hiddenAt(rig.boxes, drape)).toBe(true)
    step(rig, { theatre: th('ports'), dt: 0.1 })
    expect(hiddenAt(rig.boxes, drape)).toBe(false)
    const early = new Matrix4()
    rig.boxes.getMatrixAt(drape, early)
    for (let i = 0; i < 40; i++) step(rig, { theatre: th('console'), dt: 0.1 })
    const full = new Matrix4()
    rig.boxes.getMatrixAt(drape, full)
    expect(full.elements[5]).toBeGreaterThan(early.elements[5])
    expect(full.elements[5]).toBeCloseTo(0.24, 5)
    // on the table, over the patient's lower body
    const p = posAt(rig.boxes, drape)
    expect(p[0]).toBeCloseTo(SURGERY.table.at.x, 5)
    expect(p[2]).toBeGreaterThan(SURGERY.table.at.z)
    for (let i = 0; i < 40; i++) step(rig, { theatre: th('emergence'), dt: 0.1 })
    expect(hiddenAt(rig.boxes, drape)).toBe(true)
  })

  it('lights the surgical lights\' faces while the theatre\'s lights are on, dims them off, and draws none in the overview', () => {
    const rig = createSurgeryRig()
    const light = 5
    step(rig, { theatre: theatre('idle'), overview: false })
    for (let i = 0; i < LIGHTS.heads.length; i++) {
      expect(hiddenAt(rig.glow, light + i)).toBe(false)
      expect(colourAt(rig.glow, light + i).r).toBeLessThan(0.6)
    }
    step(rig, { theatre: theatre('console'), overview: false })
    for (let i = 0; i < LIGHTS.heads.length; i++) {
      const c = colourAt(rig.glow, light + i)
      expect(c.r).toBeGreaterThan(1.5)
      const p = posAt(rig.glow, light + i)
      expect(p[0]).toBeCloseTo(LIGHTS.heads[i].x, 5)
      expect(p[2]).toBeCloseTo(LIGHTS.heads[i].z, 5)
      expect(p[1]).toBeCloseTo(LIGHTS.faceY - 0.005, 2)
    }
    step(rig, { theatre: theatre('console'), overview: true })
    for (let i = 0; i < LIGHTS.heads.length; i++) expect(hiddenAt(rig.glow, light + i)).toBe(true)
  })

  it('shows each arm\'s state in its LED rings: dim stowed, teal ready, amber while moving, green docked', () => {
    expect(ledModeOf('stowed', 0)).toBe(0)
    expect(ledModeOf('draping', 0)).toBe(0)
    expect(ledModeOf('draped', 0)).toBe(1)
    expect(ledModeOf('driving', 0)).toBe(1)
    expect(ledModeOf('docking', 0)).toBe(2)
    expect(ledModeOf('targeting', 0.4)).toBe(2)
    expect(ledModeOf('targeting', 1)).toBe(3)
    expect(ledModeOf('docked', 1)).toBe(3)
    expect(ledModeOf('docked', 0.55)).toBe(2)
    expect(ledModeOf('undocking', 1)).toBe(2)
    const rig = createSurgeryRig()
    const ring = 7
    step(rig, { robot: dockedRobot('transverse') })
    const green = colourAt(rig.glow, ring)
    expect(green.g).toBeGreaterThan(green.r)
    step(rig, { robot: stowedRobot('stowed') })
    expect(colourAt(rig.glow, ring).b).toBeGreaterThan(colourAt(rig.glow, ring).r)
  })

  it('moves only what moved: the same state twice writes the same matrices (a frame is a pure function of the state, the time and the clock)', () => {
    const rig = createSurgeryRig()
    const r = dockedRobot('oblique')
    step(rig, { robot: r, t: 123.4 })
    const a = Array.from(rig.cyls.instanceMatrix.array)
    step(rig, { robot: r, t: 123.4 })
    expect(Array.from(rig.cyls.instanceMatrix.array)).toEqual(a)
    step(rig, { robot: r, t: 131.1 })
    expect(Array.from(rig.cyls.instanceMatrix.array)).not.toEqual(a)
  })
})

describe('a frame allocates nothing', () => {
  it('steps a docked robot 25 000 frames and V8\'s sampling heap profiler finds (next to) nothing allocated by the rig', async () => {
    const rig = createSurgeryRig()
    const r = dockedRobot('oblique')
    const th = theatre('console')
    // one input object, reused: the harness allocates nothing either (a fresh object literal a frame would be the test's own garbage)
    const input: SurgeryRigStep = { robot: r, theatre: th, t: 0, dt: 1 / 60, overview: false }
    for (let f = 0; f < 3000; f++) {
      input.t = f / 60
      rig.step(input)
    }
    const session = new inspector.Session()
    session.connect()
    const post = (method: string, params?: object) => new Promise<{ profile?: SamplingProfile }>((resolve, reject) => session.post(method, params as never, (e, res) => (e ? reject(e) : resolve(res as never))))
    await post('HeapProfiler.enable')
    await post('HeapProfiler.startSampling', { samplingInterval: 64 })
    for (let f = 3000; f < 28000; f++) {
      input.t = f / 60
      // the arms engage and let go now and then, the boom turns, the lights flip: every branch of the step runs
      r.boomYaw = 0.3 * Math.sin(f / 200)
      r.arms[2].engage = f % 3000 < 600 ? 0.55 : 1
      input.theatre.lights = f % 5000 < 2500
      rig.step(input)
    }
    const { profile } = await post('HeapProfiler.stopSampling')
    session.disconnect()
    const rows: [string, number][] = []
    const walk = (n: SamplingNode): void => {
      const own = /rig\.test|node:inspector|processTicks|task_queues|Promise/.test(`${n.callFrame.url} ${n.callFrame.functionName}`)
      if (!own && n.selfSize > 0) rows.push([`${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`, n.selfSize])
      n.children.forEach(walk)
    }
    walk(profile!.head)
    const total = rows.reduce((a, row) => a + row[1], 0)
    // 25 000 frames: under 200 KB, a few bytes a frame (the odd boxed double while V8 tiers the code up; one object per arm per frame would be 4 MB)
    expect(total, rows.map((row) => `${row[0]} ${row[1]}`).join('; ')).toBeLessThan(200 * 1024)
    rig.dispose()
  }, 120_000)
})

interface SamplingNode {
  callFrame: { functionName: string; url: string; lineNumber: number }
  selfSize: number
  children: SamplingNode[]
}
interface SamplingProfile {
  head: SamplingNode
}
