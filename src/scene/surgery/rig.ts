/**
 * R2 (agent O): the da Vinci 5 patient cart as three.js objects, with no React: THREE instanced pools, so three draw calls for the whole robot.
 *
 *   boxes   rounded boxes on the palette's `tinted` material (the cart's base and trim, the boom, its head, the arms' links, the carriages, the patient's drape)
 *   cyls    cylinders on `tinted` (wheels, the column, joint caps, spars, instrument shafts, and the pale sleeves of the sterile drapes sliding over the arms)
 *   glow    unlit emissive cylinders on MACHINE_GLOW (the arms' LED rings, the column's status band, the laser beam and crosshair, the surgical lights' faces)
 *
 * About 80 instances in all. `step` is the whole per-frame update: it solves the skeleton (robotPose.ts, from `RobotState`) and writes the matrices into
 * the typed arrays; colours are rewritten only when a state changes. Nothing is allocated in `step`. The layer (SurgeryLayer.tsx) calls it once a frame at
 * FRAME_PRIORITY.surgeryRig, only while level 2 is shown, so the node tests run the same code.
 *
 * Everything is in sim coordinates inside the level-2 group (the group's translation puts it 4.2 m up and 150 m west).
 */
import { Color, CylinderGeometry, Group, InstancedMesh, type BufferGeometry, Float32BufferAttribute, type Mesh } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { MACHINE_GLOW } from '@/scene/imaging/machines/machineMaterials'
import { MAT } from '@/scene/materials'
import { SURGERY } from '@/sim/places'
import type { CasePhase, RobotState, TheatreState } from '@/sim/types'
import { LIGHTS } from './dims'
import { hideInstance, putSegment, putSegmentPart, putYawed } from './matrices'
import { ARM_COUNT, CART, newRobotPose, poseRobot, type ArmPose, type RobotPose } from './robotPose'

// ---------------------------------------------------------------------------------------------
// The pools: which instance is which
// ---------------------------------------------------------------------------------------------

/** Box pool: the cart, then the patient's drape, then four per arm (drop link is a cylinder: upper arm, forearm, carriage). */
const B = { base: 0, trim: 1, turret: 2, beam: 3, head: 4, drape: 5, arm: 6, perArm: 3 } as const
export const BOX_COUNT = B.arm + B.perArm * ARM_COUNT
/** Cylinder pool: four wheels, the column's two sections, then per arm: the drop link, three joint caps, the spar, the shaft, three sleeves. */
const C = { wheel: 0, lower: 4, upper: 5, arm: 6, perArm: 10 } as const
export const CYL_COUNT = C.arm + C.perArm * ARM_COUNT
/** Glow pool: the laser (beam, two crosshair bars, a dot), the column's status band, the two lights, then per arm two LED rings. */
const G = { beam: 0, barX: 1, barZ: 2, dot: 3, band: 4, light: 5, arm: 7, perArm: 2 } as const
export const GLOW_COUNT = G.arm + G.perArm * ARM_COUNT

/** The theatre phases the patient lies under a sterile drape in. */
const DRAPED: ReadonlySet<CasePhase | 'idle' | 'turnover'> = new Set<CasePhase | 'idle' | 'turnover'>(['ports', 'docking', 'console', 'undocking', 'closing'])

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

const COL = {
  base: new Color('#eef1f1'),
  trim: new Color('#3aa89c'),
  turret: new Color('#f4f6f6'),
  beam: new Color('#f1f4f4'),
  head: new Color('#d3dadb'),
  link: new Color('#e3e8e9'),
  forearm: new Color('#d9dfe0'),
  carriage: new Color('#3a4245'),
  drop: new Color('#98a4a6'),
  cap: new Color('#7f8d90'),
  spar: new Color('#f6f8f8'),
  shaft: new Color('#b9c2c4'),
  sleeve: new Color('#c6e4ea'),
  wheel: new Color('#2b3133'),
  column: new Color('#e7ecec'),
  patientDrape: new Color('#6fb7bf'),
  laser: new Color(3.2, 0.25, 0.2),
}

/** Linear HDR colours of an LED ring by state (above 1 feeds the bloom). */
const LED = [new Color(0.1, 0.3, 0.55), new Color(0.12, 0.85, 0.78).multiplyScalar(1.5), new Color(1, 0.62, 0.18).multiplyScalar(2.2), new Color(0.2, 0.95, 0.45).multiplyScalar(1.7)]
const LIGHT_ON = new Color(2.4, 2.25, 1.9)
const LIGHT_OFF = new Color(0.32, 0.34, 0.36)

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

function pool(geometry: BufferGeometry, material: InstancedMesh['material'], count: number, name: string, color: Color): InstancedMesh {
  const m = new InstancedMesh(geometry, material, count)
  m.name = name
  m.frustumCulled = false
  m.castShadow = false
  m.receiveShadow = false
  m.instanceMatrix.array.fill(0)
  // every instance gets a colour before the first draw, so the shader variant with instance colours compiles once, at start-up
  for (let i = 0; i < count; i++) m.setColorAt(i, color)
  if (m.instanceColor) m.instanceColor.needsUpdate = true
  return m
}

/** A unit cylinder (diameter 1, height 1, axis y) with a white RGBA vertex colour, for the glow material. */
function glowCylinder(): CylinderGeometry {
  const g = new CylinderGeometry(0.5, 0.5, 1, 10, 1)
  const n = g.getAttribute('position').count
  g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 4).fill(1), 4))
  return g
}

export interface SurgeryRigStep {
  robot: RobotState
  theatre: TheatreState
  /** Sim seconds (the tip motion's clock). */
  t: number
  /** Real seconds since the last frame, 0 while paused (the patient's drape eases on it). */
  dt: number
  /** The overview shows the storey from above: the surgical lights (a walk-mode ceiling) are not drawn. */
  overview: boolean
}

export interface SurgeryRig {
  root: Group
  boxes: InstancedMesh
  cyls: InstancedMesh
  glow: InstancedMesh
  /** The last skeleton solved (for tests and the screens). */
  pose: RobotPose
  memory: RigMemory
  /** The meshes that are drawn (the draw calls). */
  meshes(): Mesh[]
  step(s: SurgeryRigStep): void
  dispose(): void
}

/** What the rig remembers between frames: the patient's drape easing in and out, and the colours last written (so a colour is rewritten only on change). */
export interface RigMemory {
  drapeK: number
  lightsCode: number
  band: number
  ledMode: Int8Array
}

/** Write the cart: base and trim, wheels, the column's two sections, the turret, the boom beam and its head. */
export function writeCart(bm: Float32Array, cm: Float32Array, p: RobotPose): void {
  const h = p.heading
  const sinH = Math.sin(h)
  const cosH = Math.cos(h)
  putYawed(bm, B.base, p.cartX, 0.25, p.cartZ, 0.9, 0.38, 1.38, h)
  putYawed(bm, B.trim, p.cartX, 0.17, p.cartZ, 0.93, 0.05, 1.41, h)
  for (let i = 0; i < 4; i++) {
    const lx = i < 2 ? 0.4 : -0.4
    const lz = i % 2 === 0 ? 0.5 : -0.5
    const x = p.cartX + cosH * lx + sinH * lz
    const z = p.cartZ - sinH * lx + cosH * lz
    // a wheel's axis is the cart's x
    putSegment(cm, C.wheel + i, x - cosH * 0.05, 0.1, z + sinH * 0.05, x + cosH * 0.05, 0.1, z - sinH * 0.05, 0.2, 0.2, 0, 1, 0)
  }
  const under = p.boomTop - CART.boomThick
  // the column: a fixed lower section and an upper section that slides out of it as the boom rises
  putSegment(cm, C.lower, p.colX, CART.baseTop, p.colZ, p.colX, CART.lowerTop, p.colZ, 0.34, 0.34, 1, 0, 0)
  putSegment(cm, C.upper, p.colX, 1.2, p.colZ, p.colX, under, p.colZ, 0.27, 0.27, 1, 0, 0)
  // the turret and the boom beam turn with the boom; the head is a little wider
  const ba = p.boomAngle
  putYawed(bm, B.turret, p.colX, p.boomTop - 0.13, p.colZ, 0.4, 0.26, 0.4, ba)
  const z0 = -0.2
  const z1 = p.boomLen - CART.headLen / 2 + 0.1
  const mid = (z0 + z1) / 2
  putYawed(bm, B.beam, p.colX + p.boomUx * mid, p.boomTop - 0.09, p.colZ + p.boomUz * mid, 0.2, CART.boomThick, Math.max(0.05, z1 - z0), ba)
  putYawed(bm, B.head, p.headX, p.boomTop - 0.09, p.headZ, 0.28, CART.boomThick, CART.headLen, ba)
}

/** Write one arm: the drop link, two links, three joint caps, the spar, the carriage, the shaft and the sterile sleeves. */
export function writeArm(bm: Float32Array, cm: Float32Array, a: ArmPose, i: number): void {
  const b = B.arm + i * B.perArm
  const c = C.arm + i * C.perArm
  // the links are boxes lying along their direction, wide across the arm's plane
  putSegment(cm, c, a.mx, a.my, a.mz, a.sx, a.sy, a.sz, 0.1, 0.1, 1, 0, 0)
  putSegment(bm, b, a.sx, a.sy, a.sz, a.ex, a.ey, a.ez, 0.11, 0.09, a.lx, 0, a.lz)
  putSegment(bm, b + 1, a.ex, a.ey, a.ez, a.wx, a.wy, a.wz, 0.1, 0.085, a.lx, 0, a.lz)
  // joint caps: short cylinders across the plane
  const k = 0.06
  putSegment(cm, c + 1, a.sx - a.lx * k, a.sy, a.sz - a.lz * k, a.sx + a.lx * k, a.sy, a.sz + a.lz * k, 0.13, 0.13, 0, 1, 0)
  putSegment(cm, c + 2, a.ex - a.lx * k, a.ey, a.ez - a.lz * k, a.ex + a.lx * k, a.ey, a.ez + a.lz * k, 0.12, 0.12, 0, 1, 0)
  putSegment(cm, c + 3, a.wx - a.lx * k, a.wy, a.wz - a.lz * k, a.wx + a.lx * k, a.wy, a.wz + a.lz * k, 0.11, 0.11, 0, 1, 0)
  // the spar, with the carriage riding on it, and the instrument's shaft through the port
  putSegment(cm, c + 4, a.wx, a.wy, a.wz, a.qx, a.qy, a.qz, 0.07, 0.07, a.lx, 0, a.lz)
  putSegment(bm, b + 2, a.cx - a.dx * 0.08, a.cy - a.dy * 0.08, a.cz - a.dz * 0.08, a.cx + a.dx * 0.08, a.cy + a.dy * 0.08, a.cz + a.dz * 0.08, 0.085, 0.075, a.lx, 0, a.lz)
  if (a.fitted) putSegment(cm, c + 5, a.cx + a.dx * 0.08, a.cy + a.dy * 0.08, a.cz + a.dz * 0.08, a.tx, a.ty, a.tz, 0.012, 0.012, a.lx, 0, a.lz)
  else hideInstance(cm, c + 5)
  // the sterile drape slides over the links from the shoulder out
  putSegmentPart(cm, c + 6, a.sx, a.sy, a.sz, a.ex, a.ey, a.ez, a.drape, 0.135, 0.135, a.lx, 0, a.lz)
  putSegmentPart(cm, c + 7, a.ex, a.ey, a.ez, a.wx, a.wy, a.wz, a.drape * 1.2 - 0.2, 0.125, 0.125, a.lx, 0, a.lz)
  putSegmentPart(cm, c + 8, a.wx, a.wy, a.wz, a.qx, a.qy, a.qz, a.drape * 1.4 - 0.4, 0.1, 0.1, a.lx, 0, a.lz)
  // the drop link's sleeve is the same pale as the rest, once the arm is draped
  if (a.drape > 0.85) putSegment(cm, c + 9, a.mx, a.my - 0.01, a.mz, a.sx, a.sy + 0.04, a.sz, 0.115, 0.115, 1, 0, 0)
  else hideInstance(cm, c + 9)
}

/** The LED state of an arm: 0 dim (stowed, draping, cleaning), 1 ready (teal), 2 moving (amber), 3 docked (green). */
export function ledModeOf(phase: RobotState['phase'], engage: number): number {
  if (engage >= 0.999 && phase !== 'undocking') return 3
  if (engage > 0.001 || phase === 'undocking') return 2
  if (phase === 'stowed' || phase === 'draping' || phase === 'cleaning') return 0
  if (phase === 'docking' || phase === 'targeting') return 2
  return 1
}

/** Write an arm's two glowing discs (on the outer faces of the shoulder and wrist caps). */
export function writeRings(gm: Float32Array, a: ArmPose, i: number): void {
  const g = G.arm + i * G.perArm
  const o = 0.066
  putSegment(gm, g, a.sx + a.lx * o, a.sy, a.sz + a.lz * o, a.sx + a.lx * (o + 0.012), a.sy, a.sz + a.lz * (o + 0.012), 0.1, 0.1, 0, 1, 0)
  putSegment(gm, g + 1, a.wx + a.lx * o, a.wy, a.wz + a.lz * o, a.wx + a.lx * (o + 0.012), a.wy, a.wz + a.lz * (o + 0.012), 0.08, 0.08, 0, 1, 0)
}

/** The laser crosshair, from the boom's head down onto the endoscope's port: a beam, two crossed bars and a dot; hidden when the laser is off. */
export function writeLaser(gm: Float32Array, p: RobotPose): void {
  if (!p.laser) {
    hideInstance(gm, G.beam)
    hideInstance(gm, G.barX)
    hideInstance(gm, G.barZ)
    hideInstance(gm, G.dot)
    return
  }
  const y = p.laserY + 0.004
  putSegment(gm, G.beam, p.headX, p.boomTop - CART.boomThick, p.headZ, p.laserX, y, p.laserZ, 0.006, 0.006, 1, 0, 0)
  putSegment(gm, G.barX, p.laserX - 0.22, y, p.laserZ, p.laserX + 0.22, y, p.laserZ, 0.008, 0.008, 0, 0, 1)
  putSegment(gm, G.barZ, p.laserX, y, p.laserZ - 0.22, p.laserX, y, p.laserZ + 0.22, 0.008, 0.008, 1, 0, 0)
  putSegment(gm, G.dot, p.laserX, y - 0.003, p.laserZ, p.laserX, y + 0.003, p.laserZ, 0.04, 0.04, 1, 0, 0)
}

/** The sterile drape over the patient's lower body, growing out of the table's pad as `k` goes 0 -> 1. */
export function writeDrape(bm: Float32Array, k: number): void {
  if (k <= 0.01) {
    hideInstance(bm, B.drape)
    return
  }
  putYawed(bm, B.drape, SURGERY.table.at.x, 0.86 + 0.12 * k, SURGERY.table.at.z + 0.25, 0.68, 0.24 * k, 1.5, 0)
}

/** The surgical lights' lit faces, a hair under their housings; none in the overview (their housings are a walk-mode ceiling). */
export function writeLights(gm: Float32Array, overview: boolean): void {
  for (let i = 0; i < LIGHTS.heads.length; i++) {
    const hd = LIGHTS.heads[i]
    if (overview) hideInstance(gm, G.light + i)
    else putSegment(gm, G.light + i, hd.x, LIGHTS.faceY - 0.012, hd.z, hd.x, LIGHTS.faceY + 0.002, hd.z, LIGHTS.faceDia, LIGHTS.faceDia, 1, 0, 0)
  }
}

export function createSurgeryRig(): SurgeryRig {
  const boxGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.1)
  const cylGeo = new CylinderGeometry(0.5, 0.5, 1, 14, 1)
  const glowGeo = glowCylinder()
  const boxes = pool(boxGeo, MAT.tinted, BOX_COUNT, 'surgery-boxes', COL.base)
  const cyls = pool(cylGeo, MAT.tinted, CYL_COUNT, 'surgery-cylinders', COL.base)
  const glow = pool(glowGeo, MACHINE_GLOW, GLOW_COUNT, 'surgery-glow', LED[0])
  glow.renderOrder = 2

  // the colours that never change
  const paint = (m: InstancedMesh, i: number, c: Color): void => {
    m.setColorAt(i, c)
  }
  paint(boxes, B.base, COL.base)
  paint(boxes, B.trim, COL.trim)
  paint(boxes, B.turret, COL.turret)
  paint(boxes, B.beam, COL.beam)
  paint(boxes, B.head, COL.head)
  paint(boxes, B.drape, COL.patientDrape)
  for (let i = 0; i < ARM_COUNT; i++) {
    paint(boxes, B.arm + i * B.perArm, COL.link)
    paint(boxes, B.arm + i * B.perArm + 1, COL.forearm)
    paint(boxes, B.arm + i * B.perArm + 2, COL.carriage)
    const c = C.arm + i * C.perArm
    paint(cyls, c, COL.drop)
    for (let k = 1; k <= 3; k++) paint(cyls, c + k, COL.cap)
    paint(cyls, c + 4, COL.spar)
    paint(cyls, c + 5, COL.shaft)
    for (let k = 6; k <= 8; k++) paint(cyls, c + k, COL.sleeve)
    paint(cyls, c + 9, COL.drop)
  }
  for (let i = 0; i < 4; i++) paint(cyls, C.wheel + i, COL.wheel)
  paint(cyls, C.lower, COL.column)
  paint(cyls, C.upper, COL.column)
  for (let i = 0; i < GLOW_COUNT; i++) paint(glow, i, LED[0])
  for (const g of [G.beam, G.barX, G.barZ, G.dot]) paint(glow, g, COL.laser)
  for (let i = 0; i < LIGHTS.heads.length; i++) paint(glow, G.light + i, LIGHT_OFF)
  for (const m of [boxes, cyls, glow]) if (m.instanceColor) m.instanceColor.needsUpdate = true

  const root = new Group()
  root.name = 'surgery-rig'
  root.add(boxes, cyls, glow)

  const pose = newRobotPose()
  const bm = boxes.instanceMatrix.array as Float32Array
  const cm = cyls.instanceMatrix.array as Float32Array
  const gm = glow.instanceMatrix.array as Float32Array
  const mem: RigMemory = { drapeK: 0, lightsCode: -1, band: -1, ledMode: new Int8Array(ARM_COUNT * 2).fill(-1) }

  return {
    root,
    boxes,
    cyls,
    glow,
    pose,
    memory: mem,
    meshes: () => [boxes, cyls, glow],
    step(s: SurgeryRigStep): void {
      const r = s.robot
      poseRobot(r, s.t, pose)
      writeCart(bm, cm, pose)
      for (let i = 0; i < ARM_COUNT; i++) {
        const a = pose.arms[i]
        writeArm(bm, cm, a, i)
        writeRings(gm, a, i)
        const mode = ledModeOf(r.phase, a.engage)
        for (let k = 0; k < 2; k++) {
          const idx = i * 2 + k
          if (mem.ledMode[idx] !== mode) {
            mem.ledMode[idx] = mode
            glow.setColorAt(G.arm + idx, LED[mode])
            glow.instanceColor!.needsUpdate = true
          }
        }
      }
      // the column's status band follows the phase: dim stowed, ready, amber while driving, green docked
      const band = r.laser ? 2 : r.phase === 'docked' ? 3 : r.phase === 'stowed' ? 0 : 1
      putSegment(gm, G.band, pose.colX, pose.boomTop - 0.36, pose.colZ, pose.colX, pose.boomTop - 0.33, pose.colZ, 0.29, 0.29, 1, 0, 0)
      if (band !== mem.band) {
        mem.band = band
        glow.setColorAt(G.band, LED[band])
        glow.instanceColor!.needsUpdate = true
      }
      writeLaser(gm, pose)
      const want = DRAPED.has(s.theatre.phase) ? 1 : 0
      const stepK = s.dt * 1.6
      mem.drapeK = mem.drapeK < want ? Math.min(want, mem.drapeK + stepK) : Math.max(want, mem.drapeK - stepK)
      writeDrape(bm, mem.drapeK)
      writeLights(gm, s.overview)
      const code = s.overview ? 2 : s.theatre.lights ? 1 : 0
      if (code !== mem.lightsCode) {
        mem.lightsCode = code
        for (let i = 0; i < LIGHTS.heads.length; i++) glow.setColorAt(G.light + i, code === 1 ? LIGHT_ON : LIGHT_OFF)
        glow.instanceColor!.needsUpdate = true
      }
      boxes.instanceMatrix.needsUpdate = true
      cyls.instanceMatrix.needsUpdate = true
      glow.instanceMatrix.needsUpdate = true
    },
    dispose() {
      boxGeo.dispose()
      cylGeo.dispose()
      glowGeo.dispose()
      boxes.dispose()
      cyls.dispose()
      glow.dispose()
    },
  }
}

/** Draw calls of a rig: its meshes that draw anything. */
export function drawCallsOf(rig: SurgeryRig): number {
  return rig.meshes().filter((m) => m.visible && (m as InstancedMesh).count > 0).length
}

/** Triangles of a rig as drawn (every instance counts, hidden or not: a collapsed one still costs its vertices). */
export function trianglesOf(rig: SurgeryRig): number {
  let n = 0
  for (const m of rig.meshes()) {
    const g = m.geometry
    n += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * (m as InstancedMesh).count
  }
  return n
}
