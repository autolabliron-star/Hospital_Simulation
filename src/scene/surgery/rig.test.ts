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
import { BODY_LANDMARKS, LEG_BREAK_D, LITHOTOMY_LEG, PELVIS_ON_TABLE } from '@/sim/procedure/body'
import { emptyPatientPose } from '@/sim/procedure/empty'
import { newTablePose, setTablePose, tableLocalInto, tablePointInto } from '@/sim/surgery/tablePose'
import type { PatientPoseView, Vec3 } from '@/sim/types'
import { LIGHTS } from './dims'
import { BOX_COUNT, createSurgeryRig, CYL_COUNT, drawCallsOf, GLOW_COUNT, ledModeOf, TABLE_AT, trianglesOf, type SurgeryRig, type SurgeryRigStep } from './rig'
import { CART } from './robotPose'
import { BRACE_TILT_DEG, HEEL_REACH, TABLE_BOX_COUNT, TABLE_CYL_COUNT, TB, TC } from './table'
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
    // (R5 wave 2: the live table top and its boots and braces joined the pools: the plan's cap is 130 instances and 40 k triangles)
    expect(BOX_COUNT + CYL_COUNT + GLOW_COUNT).toBeLessThanOrEqual(130)
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


// ---------------------------------------------------------------------------------------------
// R5 wave 2: the live table
// ---------------------------------------------------------------------------------------------

/** A patient pose: level and supine unless told otherwise. */
function pose(over: Partial<PatientPoseView> = {}): PatientPoseView {
  return { ...emptyPatientPose(), ...over }
}

const M4 = new Matrix4()
/** Instance `i` of a pool as [centre x, y, z, size x, size y, size z] (the unit box's scale columns' lengths) and its matrix elements. */
function box(mesh: { getMatrixAt(i: number, m: Matrix4): void }, i: number): { c: Vec3; sx: number; sy: number; sz: number; e: number[] } {
  mesh.getMatrixAt(i, M4)
  const e = M4.elements.slice()
  return { c: { x: e[12], y: e[13], z: e[14] }, sx: Math.hypot(e[0], e[1], e[2]), sy: Math.hypot(e[4], e[5], e[6]), sz: Math.hypot(e[8], e[9], e[10]), e }
}
const T0 = SURGERY.table
const tb = (k: number): number => TABLE_AT.boxes + k
const tc = (k: number): number => TABLE_AT.cyls + k
const near = (a: Vec3, b: Vec3, tol: number): boolean => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < tol

describe('the live table top: the level table is the old static one', () => {
  const rig = createSurgeryRig()
  step(rig, { patient: pose(), dt: 1 / 60 })

  it('adds no draw call and no material: it lives in the rig\'s boxes and cylinders (the pools\' counts grew by the table\'s instances)', () => {
    expect(rig.meshes()).toEqual([rig.boxes, rig.cyls, rig.glow])
    expect(drawCallsOf(rig)).toBe(3)
    expect(rig.boxes.material).toBe(MAT.tinted)
    expect(rig.cyls.material).toBe(MAT.tinted)
    expect(BOX_COUNT).toBe(TABLE_AT.boxes + TABLE_BOX_COUNT)
    expect(CYL_COUNT).toBe(TABLE_AT.cyls + TABLE_CYL_COUNT)
    // eslint-disable-next-line no-console
    console.log(`surgery rig with the live table: ${TABLE_BOX_COUNT} box + ${TABLE_CYL_COUNT} cylinder instances for the table, ${BOX_COUNT + CYL_COUNT + GLOW_COUNT} in all, ${trianglesOf(rig)} triangles, ${drawCallsOf(rig)} draw calls`)
  })

  it('has the pad\'s top at the contract\'s 0.88 m, four sections end to end over the old 1.96 m, with a seam between them, and the platform under it', () => {
    let from = Infinity
    let to = -Infinity
    for (let k = 0; k < 4; k++) {
      const b = box(rig.boxes, tb(TB.pad + k))
      expect(b.c.x, `section ${k}`).toBeCloseTo(T0.at.x, 4)
      expect(b.c.y + b.sy / 2, `section ${k} top`).toBeCloseTo(T0.height, 4)
      expect(b.sx).toBeCloseTo(0.5, 4)
      from = Math.min(from, b.c.z - b.sz / 2 - T0.at.z)
      to = Math.max(to, b.c.z + b.sz / 2 - T0.at.z)
      if (k > 0) {
        const prev = box(rig.boxes, tb(TB.pad + k - 1))
        const gap = b.c.z - b.sz / 2 - (prev.c.z + prev.sz / 2)
        expect(gap, `seam ${k}`).toBeGreaterThan(0.002)
        expect(gap, `seam ${k}`).toBeLessThan(0.01)
      }
    }
    expect(from).toBeCloseTo(-0.98, 4)
    expect(to).toBeCloseTo(0.98, 4)
    const main = box(rig.boxes, tb(TB.platform))
    expect(main.c.y - main.sy / 2).toBeCloseTo(0.8, 4)
    expect(main.c.y + main.sy / 2).toBeCloseTo(0.84, 4)
    // the leg section's pad starts at the leg break
    const leg = box(rig.boxes, tb(TB.pad + 3))
    expect(leg.c.z - leg.sz / 2 - T0.at.z).toBeCloseTo(LEG_BREAK_D + 0.004, 4)
    // a rail down each side
    for (const [k, side] of [[0, -1], [1, 1]] as const) {
      const r = box(rig.boxes, tb(TB.rail + k))
      expect(r.c.x - T0.at.x, `rail ${k}`).toBeCloseTo(side * 0.265, 4)
      expect(r.c.y).toBeGreaterThan(0.79)
      expect(r.c.y).toBeLessThan(0.84)
    }
  })

  it('levels to the identity: the head block sits on the collar\'s top (0.68) under the platform, and nothing of the stirrups or braces is drawn', () => {
    const b = box(rig.boxes, tb(TB.block))
    expect(b.c.y - b.sy / 2).toBeCloseTo(0.68, 4)
    expect(b.c.y + b.sy / 2).toBeCloseTo(0.8, 4)
    expect(b.c.z - T0.at.z).toBeCloseTo(0.2, 4)
    for (let k = 0; k < 10; k++) expect(hiddenAt(rig.boxes, tb(TB.boot + k)), `boot box ${k}`).toBe(true)
    for (let k = 0; k < 2; k++) expect(hiddenAt(rig.boxes, tb(TB.brace + k)), `brace ${k}`).toBe(true)
    for (let k = 0; k < 4; k++) expect(hiddenAt(rig.cyls, tc(k)), `cylinder ${k}`).toBe(true)
  })

  it('keeps the platform\'s underside above the column\'s collar (top 0.68 m, 0.32 m about the pivot) however the table is tipped, so the head block hinges into the collar and nothing of the pad dips into it', () => {
    const p = newTablePose()
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    for (const [tilt, roll] of [[-30, 0], [-30, 8], [-25, -8], [25, 0], [25, 8], [15, -12]] as const) {
      setTablePose(p, tilt, roll)
      // the platform's underside (y 0.8) over the collar's whole plan: 0.18 either side, from 0.04 to 0.36 along the table
      for (const dx of [-0.18, 0, 0.18]) {
        for (const d of [0.04, 0.2, 0.36]) {
          tablePointInto(p, T0.at.x + dx, 0.8, T0.at.z + d, out)
          expect(out.y, `underside at ${dx}, ${d} with tilt ${tilt} roll ${roll}`).toBeGreaterThan(0.68)
        }
      }
    }
  })
})

describe('the live table top follows the patient\'s pose', () => {
  it('moves every part with the one table transform: the matrices carry a level part\'s centre to tablePointInto of it, within a millimetre, for tilts and rolls', () => {
    const p = newTablePose()
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    const lv = createSurgeryRig()
    step(lv, { patient: pose(), dt: 1 / 60 })
    for (const [tilt, roll] of [[-25, 0], [-30, 5], [20, -10], [12, 12], [0, 0]] as const) {
      const rig = createSurgeryRig()
      step(rig, { patient: pose({ headTiltDeg: tilt, rollDeg: roll }), dt: 1 / 60 })
      setTablePose(p, tilt, roll)
      for (let k = 0; k < 4; k++) {
        const level = box(lv.boxes, tb(TB.pad + k))
        tablePointInto(p, level.c.x, level.c.y, level.c.z, out)
        expect(near(box(rig.boxes, tb(TB.pad + k)).c, out, 1e-3), `pad ${k} at ${tilt}, ${roll}`).toBe(true)
      }
      // and the rails, the platform and the head block
      for (const i of [TB.platform, TB.block, TB.rail, TB.rail + 1]) {
        const level = box(lv.boxes, tb(i))
        tablePointInto(p, level.c.x, level.c.y, level.c.z, out)
        expect(near(box(rig.boxes, tb(i)).c, out, 1e-3), `part ${i} at ${tilt}, ${roll}`).toBe(true)
      }
      rig.dispose()
    }
    lv.dispose()
  })

  it('tips the head end down and the foot end up in Trendelenburg, lifts the right (west) side with a positive roll, and is exactly level again after', () => {
    const rig = createSurgeryRig()
    step(rig, { patient: pose({ headTiltDeg: -25 }), dt: 1 / 60 })
    const head = box(rig.boxes, tb(TB.pad)).c
    const foot = box(rig.boxes, tb(TB.pad + 2)).c
    expect(head.y).toBeLessThan(T0.height - 0.1)
    expect(foot.y).toBeGreaterThan(T0.height - 0.1)
    expect(head.y).toBeLessThan(foot.y - 0.25)
    step(rig, { patient: pose({ rollDeg: 10 }), dt: 1 / 60 })
    expect(box(rig.boxes, tb(TB.rail)).c.y).toBeGreaterThan(box(rig.boxes, tb(TB.rail + 1)).c.y + 0.08)
    const level = createSurgeryRig()
    // (a long frame lets the braces' follower settle, so the table is as level as a fresh one)
    step(level, { patient: pose(), dt: 1 / 60 })
    step(rig, { patient: pose(), dt: 5 })
    expect(Array.from(rig.boxes.instanceMatrix.array.slice(TABLE_AT.boxes * 16))).toEqual(Array.from(level.boxes.instanceMatrix.array.slice(TABLE_AT.boxes * 16)))
    level.dispose()
    rig.dispose()
  })

  it('draws a level, supine table when the step carries no pose', () => {
    const a = createSurgeryRig()
    const b = createSurgeryRig()
    step(a, {})
    step(b, { patient: pose() })
    expect(Array.from(a.boxes.instanceMatrix.array)).toEqual(Array.from(b.boxes.instanceMatrix.array))
    a.dispose()
    b.dispose()
  })

  it('lands the laser crosshair on the tilted patient: before docking its dot sits at the level landing point moved by the table\'s pose', () => {
    const rig = createSurgeryRig()
    const r = dockedRobot('transverse', { laser: true, arms: stowedRobot('stowed', 1).arms })
    step(rig, { robot: r, patient: pose(), dt: 1 / 60 })
    const level = { x: rig.pose.laserX, y: rig.pose.laserY, z: rig.pose.laserZ }
    step(rig, { robot: r, patient: pose({ headTiltDeg: -25, rollDeg: 4 }), dt: 1 / 60 })
    const p = newTablePose()
    setTablePose(p, -25, 4)
    const want = tablePointInto(p, level.x, level.y, level.z, { x: 0, y: 0, z: 0 })
    const got = { x: rig.pose.laserX, y: rig.pose.laserY, z: rig.pose.laserZ }
    expect(near(got, want, 1e-9)).toBe(true)
    expect(near(got, level, 0.05)).toBe(false)
    rig.dispose()
  })
})

describe('lithotomy: the leg section comes off and the boots swing in', () => {
  const lith = pose({ position: 'lithotomy' })

  it('hides the leg section beyond the break (platform, pad and both rails) and shows two boots, each a clamp, a pole, a sole, two walls and a heel board', () => {
    const rig = createSurgeryRig()
    step(rig, { patient: lith, dt: 1 / 60 })
    expect(hiddenAt(rig.boxes, tb(TB.platform + 1))).toBe(true)
    expect(hiddenAt(rig.boxes, tb(TB.pad + 3))).toBe(true)
    expect(hiddenAt(rig.boxes, tb(TB.rail + 2))).toBe(true)
    expect(hiddenAt(rig.boxes, tb(TB.rail + 3))).toBe(true)
    // the seat section, the main platform and the main rails stay, ending at the break
    const seat = box(rig.boxes, tb(TB.pad + 2))
    expect(seat.c.z + seat.sz / 2 - T0.at.z).toBeCloseTo(LEG_BREAK_D - 0.004, 4)
    for (let k = 0; k < 10; k++) expect(hiddenAt(rig.boxes, tb(TB.boot + k)), `boot box ${k}`).toBe(false)
    for (let k = 0; k < 2; k++) expect(hiddenAt(rig.cyls, tc(TC.pole + k)), `pole ${k}`).toBe(false)
    rig.dispose()
  })

  it('clamps each stirrup to a side rail just above the leg break, and cradles the calf from the knee to the ankle, mirrored for the right leg', () => {
    const rig = createSurgeryRig()
    step(rig, { patient: lith, dt: 1 / 60 })
    for (const [side, sign] of [[0, 1], [1, -1]] as const) {
      const clamp = box(rig.boxes, tb(TB.boot + side * TB.perBoot))
      expect(clamp.c.z - T0.at.z, `clamp ${side} along`).toBeGreaterThan(LEG_BREAK_D - 0.08)
      expect(clamp.c.z - T0.at.z).toBeLessThan(LEG_BREAK_D)
      expect(sign * (clamp.c.x - T0.at.x), `clamp ${side} on the rail`).toBeGreaterThan(0.25)
      expect(sign * (clamp.c.x - T0.at.x)).toBeLessThan(0.31)
      // the sole lies under the calf: it starts under the knee and runs along the calf (body.ts LITHOTOMY_LEG, the pelvis slid 0.3 m), 8.5 cm below it,
      // on to the heel 9 cm past the ankle
      const sole = box(rig.boxes, tb(TB.boot + side * TB.perBoot + 1))
      const lvl = newTablePose()
      const knee = tableLocalInto(lvl, PELVIS_ON_TABLE.lithotomy + LITHOTOMY_LEG.knee.d, sign * LITHOTOMY_LEG.knee.x, LITHOTOMY_LEG.knee.h - 0.085, { x: 0, y: 0, z: 0 })
      const ankle = tableLocalInto(lvl, PELVIS_ON_TABLE.lithotomy + LITHOTOMY_LEG.ankle.d, sign * LITHOTOMY_LEG.ankle.x, LITHOTOMY_LEG.ankle.h - 0.085, { x: 0, y: 0, z: 0 })
      const calf = Math.hypot(knee.x - ankle.x, knee.y - ankle.y, knee.z - ankle.z)
      const ax = { x: (ankle.x - knee.x) / calf, y: (ankle.y - knee.y) / calf, z: (ankle.z - knee.z) / calf }
      const heel = { x: ankle.x + ax.x * HEEL_REACH, y: ankle.y + ax.y * HEEL_REACH, z: ankle.z + ax.z * HEEL_REACH }
      const mid = { x: (knee.x + heel.x) / 2, y: (knee.y + heel.y) / 2, z: (knee.z + heel.z) / 2 }
      expect(near(sole.c, mid, 0.005), `sole ${side} runs from the knee to the heel`).toBe(true)
      expect(sole.sy, `sole ${side} length`).toBeCloseTo(calf + HEEL_REACH, 3)
      // 8.5 cm under the calf's axis (the landmarks lie 8.5 cm higher)
      const calfMid = tableLocalInto(lvl, PELVIS_ON_TABLE.lithotomy + (LITHOTOMY_LEG.knee.d + LITHOTOMY_LEG.ankle.d) / 2, sign * (LITHOTOMY_LEG.knee.x + LITHOTOMY_LEG.ankle.x) / 2, (LITHOTOMY_LEG.knee.h + LITHOTOMY_LEG.ankle.h) / 2, { x: 0, y: 0, z: 0 })
      const soleAtCalfMid = { x: (knee.x + ankle.x) / 2, y: (knee.y + ankle.y) / 2, z: (knee.z + ankle.z) / 2 }
      expect(calfMid.y - soleAtCalfMid.y).toBeCloseTo(0.085, 6)
      // the pole runs from the clamp to the sole
      const pole = box(rig.cyls, tc(TC.pole + side))
      expect(pole.sy, `pole ${side} reaches the sole`).toBeGreaterThan(0.4)
      expect(near(pole.c, { x: (clamp.c.x + sole.c.x) / 2, y: (clamp.c.y + sole.c.y) / 2, z: (clamp.c.z + sole.c.z) / 2 }, 0.06)).toBe(true)
    }
    const left = box(rig.boxes, tb(TB.boot + 1)).c
    const right = box(rig.boxes, tb(TB.boot + TB.perBoot + 1)).c
    expect(left.x - T0.at.x).toBeCloseTo(-(right.x - T0.at.x), 4)
    expect(left.y).toBeCloseTo(right.y, 4)
    expect(left.z).toBeCloseTo(right.z, 4)
    rig.dispose()
  })

  it('carries the boots with the tilt and roll of the table (the same matrix as the pad)', () => {
    const p = newTablePose()
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    const a = createSurgeryRig()
    const b = createSurgeryRig()
    step(a, { patient: lith, dt: 1 / 60 })
    step(b, { patient: pose({ position: 'lithotomy', headTiltDeg: -25, rollDeg: 5 }), dt: 1 / 60 })
    setTablePose(p, -25, 5)
    for (let k = 0; k < 10; k++) {
      const level = box(a.boxes, tb(TB.boot + k)).c
      tablePointInto(p, level.x, level.y, level.z, out)
      expect(near(box(b.boxes, tb(TB.boot + k)).c, out, 1e-3), `boot box ${k}`).toBe(true)
    }
    a.dispose()
    b.dispose()
  })

  it('starts in place on a warm start (the first frame snaps, no swing), and swings in and out over about 1.5 s when the position changes', () => {
    const warm = createSurgeryRig()
    step(warm, { patient: lith, dt: 1 / 60 })
    expect(warm.memory.table.st[0]).toBe(1)
    warm.dispose()

    const rig = createSurgeryRig()
    step(rig, { patient: pose(), dt: 1 / 60 })
    expect(rig.memory.table.st[0]).toBe(0)
    expect(hiddenAt(rig.boxes, tb(TB.boot))).toBe(true)
    const at = (): number => rig.memory.table.st[0]
    // the position changes: the boots come in, never overshooting, 95 % in 1.3 to 1.7 s, settled by 3 s
    const ks: number[] = []
    const soleAt: (Vec3 | null)[] = []
    let t95 = -1
    for (let f = 1; f <= 240; f++) {
      step(rig, { patient: lith, dt: 1 / 60 })
      ks.push(at())
      // (a boot is not drawn until it has begun to swing)
      soleAt.push(hiddenAt(rig.boxes, tb(TB.boot + 1)) ? null : box(rig.boxes, tb(TB.boot + 1)).c)
      if (t95 < 0 && at() >= 0.95) t95 = f / 60
    }
    let drawn = 0
    for (let i = 1; i < ks.length; i++) {
      expect(ks[i], `frame ${i}`).toBeGreaterThanOrEqual(ks[i - 1] - 1e-12)
      expect(ks[i]).toBeLessThanOrEqual(1 + 1e-9)
      const a = soleAt[i]
      const b = soleAt[i - 1]
      if (a !== null && b !== null) {
        drawn++
        // the sole moves a few centimetres a frame at most while it swings
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), `frame ${i}`).toBeLessThan(0.03)
      }
    }
    expect(drawn).toBeGreaterThan(200)
    expect(ks[0]).toBeGreaterThan(0)
    expect(ks[0], 'it starts gently').toBeLessThan(0.01)
    expect(t95).toBeGreaterThan(1.3)
    expect(t95).toBeLessThan(1.7)
    expect(ks[ks.length - 1]).toBeGreaterThan(0.999)
    // the leg section is off from about halfway
    expect(hiddenAt(rig.boxes, tb(TB.pad + 3))).toBe(true)
    // and back out again: the leg section returns before the boots are gone, no undershoot
    const out: number[] = []
    for (let f = 0; f < 240; f++) {
      step(rig, { patient: pose(), dt: 1 / 60 })
      out.push(at())
    }
    for (let i = 1; i < out.length; i++) {
      expect(out[i], `out ${i}`).toBeLessThanOrEqual(out[i - 1] + 1e-12)
      expect(out[i]).toBeGreaterThanOrEqual(-1e-9)
    }
    expect(hiddenAt(rig.boxes, tb(TB.boot))).toBe(true)
    expect(hiddenAt(rig.boxes, tb(TB.pad + 3))).toBe(false)
    rig.dispose()
  })

  it('swings about the clamp: stowed they point out to the side, in place they point to the feet, and the clamp does not move', () => {
    const rig = createSurgeryRig()
    step(rig, { patient: pose(), dt: 1 / 60 })
    // a nearly stowed stirrup (frame 1 of a swing in: k tiny, a quarter turn out)
    step(rig, { patient: lith, dt: 0.05 })
    const clamp0 = box(rig.boxes, tb(TB.boot)).c
    const sole0 = box(rig.boxes, tb(TB.boot + 1)).c
    const clampAlong0 = clamp0.z - T0.at.z
    // out to the side: the sole is far from the centre line and level with the clamp along the table
    expect(Math.abs(sole0.x - T0.at.x), 'out to the side').toBeGreaterThan(0.5)
    expect(Math.abs(sole0.z - T0.at.z - clampAlong0), 'level with the clamp').toBeLessThan(0.2)
    for (let f = 0; f < 600; f++) step(rig, { patient: lith, dt: 1 / 60 })
    const clamp1 = box(rig.boxes, tb(TB.boot)).c
    const sole1 = box(rig.boxes, tb(TB.boot + 1)).c
    expect(near(clamp0, clamp1, 1e-5), 'the clamp stays on the rail').toBe(true)
    expect(sole1.z - T0.at.z, 'in place: toward the feet').toBeGreaterThan(0.8)
    expect(Math.abs(sole1.x - T0.at.x)).toBeLessThan(0.4)
    rig.dispose()
  })

  it('freezes while paused (dt 0) and is stable at any frame time (a one-second hitch does not overshoot)', () => {
    const rig = createSurgeryRig()
    step(rig, { patient: pose(), dt: 1 / 60 })
    step(rig, { patient: lith, dt: 0.1 })
    const k = rig.memory.table.st[0]
    const before = Array.from(rig.boxes.instanceMatrix.array)
    step(rig, { patient: lith, dt: 0 })
    expect(rig.memory.table.st[0]).toBe(k)
    expect(Array.from(rig.boxes.instanceMatrix.array)).toEqual(before)
    for (const dt of [0.5, 1, 5, 30]) {
      step(rig, { patient: lith, dt })
      expect(rig.memory.table.st[0]).toBeLessThanOrEqual(1 + 1e-9)
      expect(rig.memory.table.st[0]).toBeGreaterThanOrEqual(k - 1e-9)
    }
    step(rig, { patient: pose(), dt: 100 })
    expect(rig.memory.table.st[0]).toBeGreaterThanOrEqual(-1e-9)
    expect(rig.memory.table.st[0]).toBeLessThan(0.001)
    rig.dispose()
  })
})

describe('the shoulder braces', () => {
  it('show only when the head is tilted down by more than 10 degrees, at the shoulders\' cranial side, on the rails\' side of each shoulder', () => {
    const rig = createSurgeryRig()
    expect(BRACE_TILT_DEG).toBe(-10)
    for (const tilt of [0, 15, -5, -10]) {
      step(rig, { patient: pose({ headTiltDeg: tilt }), dt: 1 })
      for (let k = 0; k < 2; k++) {
        expect(hiddenAt(rig.boxes, tb(TB.brace + k)), `brace ${k} at ${tilt}`).toBe(true)
        expect(hiddenAt(rig.cyls, tc(TC.brace + k)), `post ${k} at ${tilt}`).toBe(true)
      }
    }
    for (const tilt of [-10.5, -25]) {
      step(rig, { patient: pose({ headTiltDeg: tilt }), dt: 5 })
      for (let k = 0; k < 2; k++) {
        expect(hiddenAt(rig.boxes, tb(TB.brace + k)), `brace ${k} at ${tilt}`).toBe(false)
        expect(hiddenAt(rig.cyls, tc(TC.brace + k)), `post ${k} at ${tilt}`).toBe(false)
      }
    }
    rig.dispose()
  })

  it('stands at the shoulders in the table\'s frame (a mirrored pair on the cranial side of the shoulder joints), tipped and rolled with the table', () => {
    const rig = createSurgeryRig()
    expect(-0.565).toBeLessThan(BODY_LANDMARKS.shoulder.d)
    for (const [tilt, roll] of [[-11, 0], [-25, 3], [-30, -5]] as const) {
      step(rig, { patient: pose({ headTiltDeg: tilt, rollDeg: roll }), dt: 5 })
      const p = newTablePose()
      setTablePose(p, tilt, roll)
      for (const [k, sign] of [[0, 1], [1, -1]] as const) {
        const want = tableLocalInto(p, -0.565, sign * 0.21, 0.065, { x: 0, y: 0, z: 0 })
        expect(near(box(rig.boxes, tb(TB.brace + k)).c, want, 2e-3), `brace ${k} at ${tilt}, ${roll}`).toBe(true)
      }
    }
    rig.dispose()
  })

  it('slides in from the side as the head goes down (a smooth follower, faster than the boots)', () => {
    const rig = createSurgeryRig()
    step(rig, { patient: pose(), dt: 1 / 60 })
    const xs: number[] = []
    for (let f = 0; f < 120; f++) {
      step(rig, { patient: pose({ headTiltDeg: -25 }), dt: 1 / 60 })
      if (!hiddenAt(rig.boxes, tb(TB.brace))) xs.push(box(rig.boxes, tb(TB.brace)).c.x)
    }
    expect(xs.length).toBeGreaterThan(30)
    // sliding inward (toward the centre line, x decreasing for the left brace) and settling
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1] + 1e-6)
    expect(xs[0] - xs[xs.length - 1]).toBeGreaterThan(0.05)
    expect(xs[xs.length - 2] - xs[xs.length - 1]).toBeLessThan(1e-3)
    rig.dispose()
  })
})

describe('a frame allocates nothing', () => {
  it('steps a docked robot 25 000 frames and V8\'s sampling heap profiler finds (next to) nothing allocated by the rig', async () => {
    const rig = createSurgeryRig()
    const r = dockedRobot('oblique')
    const th = theatre('console')
    // one input object, reused: the harness allocates nothing either (a fresh object literal a frame would be the test's own garbage)
    const patient = emptyPatientPose()
    const input: SurgeryRigStep = { robot: r, theatre: th, t: 0, dt: 1 / 60, overview: false, patient }
    // (R5: the table tips and rolls, the position flips in and out of lithotomy, the head goes down and up: every branch of the table's frame)
    const drive = (f: number): void => {
      patient.headTiltDeg = -28 * Math.sin(f / 700) * Math.sin(f / 700) + (f % 4000 < 1000 ? 12 : 0)
      patient.rollDeg = 8 * Math.sin(f / 300)
      patient.position = f % 2500 < 1250 ? 'lithotomy' : 'supine'
    }
    // the warm-up runs every branch too (a first run of the boots' or the braces' code under the profiler would be the engine tiering it up, not the rig)
    for (let f = 0; f < 3000; f++) {
      input.t = f / 60
      drive(f * 3)
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
      drive(f)
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
