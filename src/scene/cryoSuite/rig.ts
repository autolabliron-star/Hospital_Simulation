/**
 * R4: the cryoablation suite's live 3D, with no React (the layer, CryoSuiteLayer.tsx, mounts `root` and calls `step` once a frame). Six meshes:
 *
 *   ct-static  the CT gantry and the table's pedestal (src/scene/imaging/machines/ct.ts, turned by pi about the gantry and moved to CRYO_SUITE.ct.machine:
 *              the gantry WEST, the table EAST)                                                         MACHINE_BODY
 *   ct-rotor   the rotor ring, spinning with `state.rotor`                                                MACHINE_BODY
 *   ct-cradle  the table top, at `tablePos` between out and in                                           MACHINE_BODY
 *   ct-glow    the red positioning lasers (`state.lasers`) and the status strip (amber, green while scanning)  MACHINE_GLOW
 *   arm boxes  the needle-guidance robot's links (column, upper arm, forearm, hand, guide block, a status band) and the needles' handles
 *                                                                                                        MAT.tinted (instance colours)
 *   arm cyls   the five joints, the guide sleeve and up to six needles' shafts                            MAT.tinted (instance colours)
 *
 * With the screens (screens.ts) that is 7 draw calls; every material is one the hospital already compiles (no new shader program). The CT's geometry is
 * baked once at build; `step` writes three transforms, two glow regions when they change and the instance matrices, and allocates nothing.
 */
import { CylinderGeometry, Color, Group, InstancedMesh, Mesh, type BufferGeometry, type Material } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { buildCtBase, buildCtCradle, buildCtGantry, buildCtGlow, buildCtRotor, CT } from '@/scene/imaging/machines/ct'
import { type GlowGeometry, linear, merge, setRegion, setRegionRGB } from '@/scene/imaging/machines/geometry'
import { MACHINE_BODY, MACHINE_GLOW } from '@/scene/imaging/machines/machineMaterials'
import { LASER_FADE_SECONDS, ROTOR_TURNS_PER_SECOND, stepToward } from '@/scene/imaging/machines/motion'
import { MAT } from '@/scene/materials'
import { hideInstance, putSegment } from '@/scene/surgery/matrices'
import { CRYO_SUITE, IMAGING } from '@/sim/places'
import type { CryoSuiteState } from '@/sim/types'
import { ARM, armTargetInto, cryoTableX, easeGuide, NEEDLE, needlePoseInto, newArmPose, newGuide, newNeedlePose, solveArm, type ArmPose, type Guide, type NeedlePose } from './pose'

/** The most needles the scene draws (CONFIG.cryoSuite.maxNeedles). */
export const MAX_NEEDLES = 6

/** Box pool: the arm's links, then one handle per needle. */
const B = { column: 0, upper: 1, fore: 2, hand: 3, block: 4, band: 5, handle: 6 } as const
export const BOX_COUNT = B.handle + MAX_NEEDLES
/** Cylinder pool: the five joints, the guide sleeve, then one shaft per needle. */
const C = { j1: 0, j2: 1, j3: 2, j4: 3, j5: 4, guide: 5, needle: 6 } as const
export const CYL_COUNT = C.needle + MAX_NEEDLES

/** The brief's colours: white shells, graphite joints, a teal status glow (tinted, so in the palette's lit program). */
const COL = {
  white: new Color('#eef1f3'),
  graphite: new Color('#2b2f33'),
  steel: new Color('#c3cacf'),
  handle: new Color('#e9eef0'),
  teal: new Color('#3aa89c'),
  amber: new Color('#e3a23a'),
  green: new Color('#3cc879'),
}

const AMBER = linear('#ffb23a')
const GREEN = linear('#35e07a')

/** The CT turned by pi about the imaging CT's gantry and moved onto the cryo suite's: the static parts' and the glow's geometry, baked once. */
function toSuite(g: BufferGeometry): BufferGeometry {
  const from = IMAGING.ct.machine
  const to = CRYO_SUITE.ct.machine
  g.translate(-from.x, 0, -from.z)
  g.rotateY(Math.PI)
  g.translate(to.x, 0, to.z)
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

function makeMesh(name: string, geometry: BufferGeometry, material: Material, moving: boolean): Mesh {
  const m = new Mesh(geometry, material)
  m.name = name
  m.castShadow = false // level 2 never casts into the baked sun shadow
  m.receiveShadow = !moving || material === MACHINE_BODY
  m.matrixAutoUpdate = false
  m.updateMatrix()
  if (moving) m.frustumCulled = false
  return m
}

function pool(geometry: BufferGeometry, count: number, name: string, color: Color): InstancedMesh {
  const m = new InstancedMesh(geometry, MAT.tinted, count)
  m.name = name
  m.frustumCulled = false
  m.castShadow = false
  m.receiveShadow = false
  m.instanceMatrix.array.fill(0)
  for (let i = 0; i < count; i++) m.setColorAt(i, color)
  if (m.instanceColor) m.instanceColor.needsUpdate = true
  return m
}

/** What the rig remembers between frames. */
export interface CryoRigMemory {
  angle: number
  laser: number
  status: number
  last: { x: number; angle: number; laser: number; status: number }
  /** The guide as drawn (eased toward the state's target). */
  guide: Guide
  target: Guide
  /** The band's colour code last written (0 dim, 1 moving, 2 aligned). */
  band: number
  /** Snap the arm on the next step (first frame, a Jump). */
  snap: boolean
}

export interface CryoRigStep {
  state: CryoSuiteState
  /** Sim seconds. */
  t: number
  /** Visual seconds since the last frame (0 while paused). */
  dt: number
}

export interface CryoRig {
  root: Group
  ctStatic: Mesh
  rotor: Mesh
  cradle: Mesh
  glow: Mesh
  ctGlow: GlowGeometry
  boxes: InstancedMesh
  cyls: InstancedMesh
  arm: ArmPose
  needles: NeedlePose[]
  memory: CryoRigMemory
  /** The meshes that are drawn (the draw calls). */
  meshes(): Mesh[]
  step(s: CryoRigStep): void
  /** The next step snaps the arm to its pose (a Jump, a new day). */
  snap(): void
  dispose(): void
}

/** The radius of each link's box (m): for drawing and for the keep-out tests. */
export const LINK = { column: 0.13, upper: 0.11, fore: 0.09, hand: 0.06 } as const

/** Write the arm's links and joints from a solved pose. */
export function writeArm(bm: Float32Array, cm: Float32Array, a: ArmPose): void {
  // the links as boxes lying along their direction, their width across the arm's plane (the hand's axis is the guide's pitch axis)
  const px = Math.cos(a.j1)
  const pz = -Math.sin(a.j1)
  putSegment(bm, B.column, a.m.x, a.m.y - 0.02, a.m.z, a.s.x, a.s.y, a.s.z, LINK.column, LINK.column, px, 0, pz)
  putSegment(bm, B.upper, a.s.x, a.s.y, a.s.z, a.e.x, a.e.y, a.e.z, LINK.upper, LINK.upper * 0.8, px, 0, pz)
  putSegment(bm, B.fore, a.e.x, a.e.y, a.e.z, a.w.x, a.w.y, a.w.z, LINK.fore, LINK.fore * 0.8, px, 0, pz)
  // the hand stops short of the guide's sleeve
  const hl = ARM.hand - 0.035
  putSegment(bm, B.hand, a.w.x, a.w.y, a.w.z, a.w.x + a.h.x * hl, a.w.y, a.w.z + a.h.z * hl, LINK.hand, LINK.hand * 0.75, a.u.x, a.u.y, a.u.z)
  // the guide block round the sleeve, along the guide's axis
  putSegment(bm, B.block, a.g.x - a.u.x * 0.03, a.g.y - a.u.y * 0.03, a.g.z - a.u.z * 0.03, a.g.x + a.u.x * 0.01, a.g.y + a.u.y * 0.01, a.g.z + a.u.z * 0.01, 0.05, 0.05, a.h.x, 0, a.h.z)
  // a status band round the upper arm, near the shoulder
  const bx = a.s.x + (a.e.x - a.s.x) * 0.18
  const by = a.s.y + (a.e.y - a.s.y) * 0.18
  const bz = a.s.z + (a.e.z - a.s.z) * 0.18
  putSegment(bm, B.band, bx, by, bz, bx + (a.e.x - a.s.x) * 0.05, by + (a.e.y - a.s.y) * 0.05, bz + (a.e.z - a.s.z) * 0.05, LINK.upper + 0.012, LINK.upper * 0.8 + 0.012, px, 0, pz)
  // joints: the turret on the mount (vertical), the shoulder and elbow (across the arm's plane), the wrist (vertical), the guide's pitch (along the hand)
  putSegment(cm, C.j1, a.m.x, a.m.y - 0.03, a.m.z, a.m.x, a.m.y + 0.05, a.m.z, 0.2, 0.2, 1, 0, 0)
  putSegment(cm, C.j2, a.s.x - px * 0.08, a.s.y, a.s.z - pz * 0.08, a.s.x + px * 0.08, a.s.y, a.s.z + pz * 0.08, 0.14, 0.14, 0, 1, 0)
  putSegment(cm, C.j3, a.e.x - px * 0.065, a.e.y, a.e.z - pz * 0.065, a.e.x + px * 0.065, a.e.y, a.e.z + pz * 0.065, 0.12, 0.12, 0, 1, 0)
  putSegment(cm, C.j4, a.w.x, a.w.y - 0.05, a.w.z, a.w.x, a.w.y + 0.05, a.w.z, 0.1, 0.1, 1, 0, 0)
  putSegment(cm, C.j5, a.g.x - a.h.x * 0.06, a.g.y, a.g.z - a.h.z * 0.06, a.g.x - a.h.x * 0.025, a.g.y, a.g.z - a.h.z * 0.025, 0.07, 0.07, 0, 1, 0)
  const half = ARM.guideLen / 2
  putSegment(cm, C.guide, a.g.x - a.u.x * half, a.g.y - a.u.y * half, a.g.z - a.u.z * half, a.g.x + a.u.x * half, a.g.y + a.u.y * half, a.g.z + a.u.z * half, 0.028, 0.028, a.h.x, 0, a.h.z)
}

/** Write needle k's shaft and handle, or hide them. */
export function writeNeedle(bm: Float32Array, cm: Float32Array, k: number, n: NeedlePose): void {
  if (!n.shown) {
    hideInstance(cm, C.needle + k)
    hideInstance(bm, B.handle + k)
    return
  }
  putSegment(cm, C.needle + k, n.hub.x, n.hub.y, n.hub.z, n.tip.x, n.tip.y, n.tip.z, NEEDLE.dia, NEEDLE.dia, 0, 1, 0)
  const hl = NEEDLE.handleLen
  putSegment(bm, B.handle + k, n.hub.x - n.u.x * hl, n.hub.y - n.u.y * hl, n.hub.z - n.u.z * hl, n.hub.x, n.hub.y, n.hub.z, NEEDLE.handleDia, NEEDLE.handleDia, 0, 1, 0)
}

/** The band's code: 0 dim (stowed), 1 moving (amber), 2 aligned (green). */
export function bandCode(s: CryoSuiteState): number {
  const p = s.robot.phase
  return p === 'aligned' ? 2 : p === 'stowed' ? 0 : 1
}

/** A scan is running (the rotor spinning, the status strip green). */
export function scanning(s: CryoSuiteState): boolean {
  return s.rotor > 0.5
}

const changed = (a: number, b: number): boolean => !(Math.abs(a - b) < 1e-6)

export function createCryoRig(): CryoRig {
  const ctStaticGeo = toSuite(merge([buildCtGantry(), buildCtBase()]))
  const ctGlow = buildCtGlow()
  toSuite(ctGlow.geometry)
  const rotorGeo = buildCtRotor()
  rotorGeo.rotateY(Math.PI)
  const cradleGeo = buildCtCradle()

  const ctStatic = makeMesh('cryo-ct-static', ctStaticGeo, MACHINE_BODY, false)
  const rotor = makeMesh('cryo-ct-rotor', rotorGeo, MACHINE_BODY, true)
  rotor.position.set(CRYO_SUITE.ct.machine.x + (IMAGING.ct.machine.x - CT.rotor.x), CT.centreY, CRYO_SUITE.ct.machine.z)
  rotor.updateMatrix()
  const cradle = makeMesh('cryo-ct-cradle', cradleGeo, MACHINE_BODY, true)
  cradle.position.set(cryoTableX(0), 0, CRYO_SUITE.ct.table.out.z)
  cradle.updateMatrix()
  const glow = makeMesh('cryo-ct-glow', ctGlow.geometry, MACHINE_GLOW, false)
  glow.renderOrder = 2
  // the lasers start off, the strip amber
  setRegion(ctGlow.geometry, ctGlow.regions.laser, 1.6, 0)
  setRegionRGB(ctGlow.geometry, ctGlow.regions.status, AMBER[0] * 0.5, AMBER[1] * 0.5, AMBER[2] * 0.5, 1)

  const boxGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.12)
  const cylGeo = new CylinderGeometry(0.5, 0.5, 1, 12, 1)
  const boxes = pool(boxGeo, BOX_COUNT, 'cryo-arm-boxes', COL.white)
  const cyls = pool(cylGeo, CYL_COUNT, 'cryo-arm-cylinders', COL.graphite)
  boxes.setColorAt(B.block, COL.graphite)
  boxes.setColorAt(B.band, COL.graphite)
  for (let k = 0; k < MAX_NEEDLES; k++) {
    boxes.setColorAt(B.handle + k, COL.handle)
    cyls.setColorAt(C.needle + k, COL.steel)
  }
  cyls.setColorAt(C.guide, COL.teal)
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true
  if (cyls.instanceColor) cyls.instanceColor.needsUpdate = true

  const root = new Group()
  root.name = 'cryo-suite-rig'
  root.add(ctStatic, rotor, cradle, boxes, cyls, glow)

  const arm = newArmPose()
  const needles: NeedlePose[] = []
  for (let k = 0; k < MAX_NEEDLES; k++) needles.push(newNeedlePose())
  const bm = boxes.instanceMatrix.array as Float32Array
  const cm = cyls.instanceMatrix.array as Float32Array
  const mem: CryoRigMemory = { angle: 0, laser: 0, status: 0, last: { x: Number.NaN, angle: Number.NaN, laser: 0, status: 0 }, guide: newGuide(), target: newGuide(), band: -1, snap: true }
  const bandColours = [COL.graphite, COL.amber, COL.green]

  const meshes = [ctStatic, rotor, cradle, glow, boxes, cyls]
  return {
    root,
    ctStatic,
    rotor,
    cradle,
    glow,
    ctGlow,
    boxes,
    cyls,
    arm,
    needles,
    memory: mem,
    meshes: () => meshes,
    snap() {
      mem.snap = true
    },
    step(p: CryoRigStep): void {
      const s = p.state
      const dt = p.dt
      // the table top carries the patient (the sim moves the patient by the same tablePos)
      const x = cryoTableX(s.tablePos)
      if (changed(x, mem.last.x)) {
        cradle.position.x = x
        cradle.updateMatrix()
        mem.last.x = x
      }
      // the rotor spins up and down with the scan
      const a = mem.angle + (s.rotor < 0 ? 0 : s.rotor > 1 ? 1 : s.rotor) * ROTOR_TURNS_PER_SECOND * 2 * Math.PI * dt
      mem.angle = a - Math.floor(a / (2 * Math.PI)) * 2 * Math.PI
      if (changed(mem.angle, mem.last.angle)) {
        rotor.rotation.x = -mem.angle
        rotor.updateMatrix()
        mem.last.angle = mem.angle
      }
      mem.laser = stepToward(mem.laser, s.lasers ? 1 : 0, dt, LASER_FADE_SECONDS)
      if (changed(mem.laser, mem.last.laser)) {
        setRegion(ctGlow.geometry, ctGlow.regions.laser, 1.6, mem.laser)
        mem.last.laser = mem.laser
      }
      mem.status = stepToward(mem.status, scanning(s) ? 1 : 0, dt, 0.25)
      if (changed(mem.status, mem.last.status)) {
        const k = mem.status
        const gain = 0.5 + 1.2 * k
        setRegionRGB(ctGlow.geometry, ctGlow.regions.status, (AMBER[0] + (GREEN[0] - AMBER[0]) * k) * gain, (AMBER[1] + (GREEN[1] - AMBER[1]) * k) * gain, (AMBER[2] + (GREEN[2] - AMBER[2]) * k) * gain, 1)
        mem.last.status = k
      }

      // the arm: the state's target pose, eased, then solved
      armTargetInto(s, p.t, mem.target)
      easeGuide(mem.guide, mem.target, dt, 0.35, mem.snap)
      mem.snap = false
      solveArm(mem.guide, arm)
      writeArm(bm, cm, arm)
      const band = bandCode(s)
      if (band !== mem.band) {
        mem.band = band
        boxes.setColorAt(B.band, bandColours[band])
        boxes.instanceColor!.needsUpdate = true
      }

      // the needles ride with the patient
      for (let k = 0; k < MAX_NEEDLES; k++) {
        const n = needles[k]
        if (k < s.needles.length) needlePoseInto(s, k, n)
        else n.shown = false
        writeNeedle(bm, cm, k, n)
      }
      boxes.instanceMatrix.needsUpdate = true
      cyls.instanceMatrix.needsUpdate = true
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose()
      boxes.dispose()
      cyls.dispose()
    },
  }
}

/** Draw calls of the rig: its meshes that draw anything. */
export function drawCallsOf(rig: CryoRig): number {
  return rig.meshes().filter((m) => m.visible).length
}
