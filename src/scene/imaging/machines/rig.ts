/**
 * The machines as three.js objects, and the per-frame update that animates them from the sim's `ScannerState`.
 *
 * `createRig` builds every mesh once (merged, vertex-coloured). `updateRig` reads the four scanner states and moves, rotates, dims
 * and shows parts; it compares the few numbers it uses with cached values and touches a matrix or a colour buffer only when one
 * changed by more than `EPS`, so an idle department costs a handful of comparisons. Nothing is allocated per frame: poses live in
 * the rig's own objects and the maths goes through the preallocated vectors at module scope.
 *
 * Draw calls (visible meshes): MRI 3 + 1 coil, CT 4, X-ray 5, ultrasound 3, monitors 4 = 20.
 */
import { type BufferGeometry, Group, type Material, Mesh, Quaternion, Vector3 } from 'three'
import type { ConsoleScreen } from '@/scene/building/layout'
import { IMAGING } from '@/sim/places'
import type { ImagingModality, ScannerState } from '@/sim/types'
import { buildCtCradle, buildCtGlow, buildCtRotor, buildCtStatic, CT } from './ct'
import { monitorPlanes } from './monitors'
import { type GlowGeometry, linear, setRegion, setRegionRGB } from './geometry'
import { MACHINE_BODY, MACHINE_GLOW } from './machineMaterials'
import { buildMriCoil, buildMriCradle, buildMriGlow, buildMriStatic } from './mri'
import {
  coilFor,
  collimatorTarget,
  ctStatusTarget,
  flashLevel,
  handShown,
  laserTarget,
  lampGain,
  lampLevel,
  LASER_FADE_SECONDS,
  ledGain,
  ledLevel,
  lerp,
  type ProbePose,
  probeTargetInto,
  rotorAdvance,
  smoothTo,
  stepToward,
  tableX,
  US_CART,
  type XrayPose,
  xrayPoseInto,
  XRAY_POSE,
} from './motion'
import { buildUsCable, buildUsCart, buildUsMonitor, buildUsProbe, PROBE_CABLE_ANCHOR } from './us'
import { buildXrayCarriage, buildXrayColumn, buildXrayGlow, buildXrayHead, buildXrayStatic, XRAY } from './xray'

/** A value must move further than this to be rewritten into a matrix or a colour buffer. */
const EPS = 0.0005

const changed = (a: number, b: number): boolean => !(Math.abs(a - b) <= EPS)

export type MonitorMaterial = (m: ImagingModality) => Material

interface MriRig {
  table: Group
  coils: Mesh[]
  glow: GlowGeometry
  last: { x: number; led: number; coil: number }
}

interface CtRig {
  table: Mesh
  rotor: Mesh
  glow: GlowGeometry
  angle: number
  laser: number
  status: number
  last: { x: number; angle: number; laser: number; status: number }
}

interface XrayRig {
  carriage: Mesh
  column: Mesh
  head: Mesh
  glow: GlowGeometry
  /** The head's colours as built, to scale for the exposure flash. */
  headBase: Float32Array
  pose: XrayPose
  flash: number
  tableField: number
  wallField: number
  lamp: number
  last: { z: number; angle: number; pivot: number; flash: number; tableField: number; wallField: number; lamp: number }
}

interface UsRig {
  probe: Mesh
  cable: Mesh
  probeVertices: number
  pose: ProbePose
  target: ProbePose
  hand: boolean
  last: { x: number; y: number; z: number; rx: number; tz: number }
}

export interface Rig {
  root: Group
  /** Every mesh of the rig (the three MRI coils are hidden until an exam needs them). */
  meshes: Mesh[]
  mri: MriRig
  ct: CtRig
  xray: XrayRig
  us: UsRig
}

interface MeshOpts {
  cast?: boolean
  receive?: boolean
  /** Posed by the rig: never culled (the bounding sphere of its geometry is in local space). */
  moving?: boolean
}

function makeMesh(rig: Mesh[], name: string, geometry: BufferGeometry, material: Material, o: MeshOpts = {}): Mesh {
  const m = new Mesh(geometry, material)
  m.name = name
  m.castShadow = o.cast ?? false
  m.receiveShadow = o.receive ?? false
  // nothing here is placed by three's own transform: the static parts are baked in world coordinates, the moving ones are posed by `updateRig`
  m.matrixAutoUpdate = false
  m.updateMatrix()
  if (o.moving) m.frustumCulled = false
  rig.push(m)
  return m
}

/** Build every machine. `screens` are the console monitor anchors (`getLayout().consoleScreens`), `monitorMaterial` the textured material per modality. */
export function createRig(screens: readonly ConsoleScreen[], monitorMaterial: MonitorMaterial): Rig {
  const meshes: Mesh[] = []
  const root = new Group()
  root.name = 'imaging-machines'
  const of = (m: ImagingModality): ConsoleScreen[] => screens.filter((s) => s.modality === m)

  // --- MRI ---------------------------------------------------------------------------------------------
  const mriTable = new Group()
  mriTable.name = 'mri-table'
  mriTable.matrixAutoUpdate = false
  mriTable.position.set(0, 0, IMAGING.mri.table.out.z)
  mriTable.updateMatrix()
  const cradle = makeMesh(meshes, 'mri-cradle', buildMriCradle(), MACHINE_BODY, { moving: true, receive: true })
  const coils = (['head', 'knee', 'spine'] as const).map((k) => {
    const c = makeMesh(meshes, `mri-coil-${k}`, buildMriCoil(k), MACHINE_BODY, { moving: true, receive: true })
    c.visible = false
    return c
  })
  mriTable.add(cradle, ...coils)
  const mriGlow = buildMriGlow()
  root.add(
    makeMesh(meshes, 'mri-static', buildMriStatic(of('mri')), MACHINE_BODY, { cast: true, receive: true }),
    mriTable,
    makeMesh(meshes, 'mri-glow', mriGlow.geometry, MACHINE_GLOW),
  )

  // --- CT ----------------------------------------------------------------------------------------------
  const ctGlow = buildCtGlow()
  const ctTable = makeMesh(meshes, 'ct-table', buildCtCradle(), MACHINE_BODY, { moving: true, receive: true })
  ctTable.position.set(0, 0, IMAGING.ct.table.out.z)
  ctTable.updateMatrix()
  const rotor = makeMesh(meshes, 'ct-rotor', buildCtRotor(), MACHINE_BODY, { moving: true, receive: true })
  rotor.position.set(CT.rotor.x, CT.centreY, IMAGING.ct.machine.z)
  rotor.updateMatrix()
  root.add(
    makeMesh(meshes, 'ct-static', buildCtStatic(of('ct')), MACHINE_BODY, { cast: true, receive: true }),
    rotor,
    ctTable,
    makeMesh(meshes, 'ct-glow', ctGlow.geometry, MACHINE_GLOW),
  )

  // --- X-ray -------------------------------------------------------------------------------------------
  const xrayGlow = buildXrayGlow()
  const carriage = makeMesh(meshes, 'xray-carriage', buildXrayCarriage(), MACHINE_BODY, { moving: true, receive: true })
  const column = makeMesh(meshes, 'xray-column', buildXrayColumn(), MACHINE_BODY, { moving: true, receive: true })
  const headGeometry = buildXrayHead()
  const head = makeMesh(meshes, 'xray-head', headGeometry, MACHINE_BODY, { moving: true, receive: true })
  const headBase = new Float32Array((headGeometry.getAttribute('color').array as Float32Array).length)
  headBase.set(headGeometry.getAttribute('color').array as Float32Array)
  root.add(
    // the rails would throw a long stripe across the floor from a ceiling that is not drawn: they do not cast
    makeMesh(meshes, 'xray-rails', buildXrayStatic(of('xray')), MACHINE_BODY, { receive: true }),
    carriage,
    column,
    head,
    makeMesh(meshes, 'xray-glow', xrayGlow.geometry, MACHINE_GLOW),
  )

  // --- Ultrasound --------------------------------------------------------------------------------------
  const probeGeo = buildUsProbe()
  const probe = makeMesh(meshes, 'us-probe', probeGeo.geometry, MACHINE_BODY, { moving: true, receive: true })
  const cable = makeMesh(meshes, 'us-cable', buildUsCable(), MACHINE_BODY, { moving: true })
  root.add(makeMesh(meshes, 'us-cart', buildUsCart(), MACHINE_BODY, { cast: true, receive: true }), probe, cable)

  // --- Monitors ----------------------------------------------------------------------------------------
  for (const m of ['mri', 'ct', 'xray'] as const) {
    const list = of(m)
    if (list.length > 0) root.add(makeMesh(meshes, `${m}-monitor`, monitorPlanes(list), monitorMaterial(m)))
  }
  root.add(makeMesh(meshes, 'us-monitor', buildUsMonitor(), monitorMaterial('us')))

  const rig: Rig = {
    root,
    meshes,
    mri: { table: mriTable, coils, glow: mriGlow, last: { x: NaN, led: NaN, coil: -2 } },
    ct: { table: ctTable, rotor, glow: ctGlow, angle: 0, laser: 0, status: 0, last: { x: NaN, angle: NaN, laser: NaN, status: NaN } },
    xray: {
      carriage,
      column,
      head,
      glow: xrayGlow,
      headBase,
      pose: { carriageZ: 0, headAngle: 0, pivotY: 0, columnLength: 0, columnDrop: 0 },
      flash: 0,
      tableField: 0,
      wallField: 0,
      lamp: 0,
      last: { z: NaN, angle: NaN, pivot: NaN, flash: NaN, tableField: NaN, wallField: NaN, lamp: NaN },
    },
    us: {
      probe,
      cable,
      probeVertices: probeGeo.probeVertices,
      pose: { x: US_CART.holder.x, y: US_CART.holder.y, z: US_CART.holder.z, rx: 0, tz: 0 },
      target: { x: 0, y: 0, z: 0, rx: 0, tz: 0 },
      hand: true,
      last: { x: NaN, y: NaN, z: NaN, rx: NaN, tz: NaN },
    },
  }
  return rig
}

/** Free the geometries (the shared materials and the live textures belong to someone else). */
export function disposeRig(rig: Rig): void {
  for (const m of rig.meshes) m.geometry.dispose()
}

// ---------------------------------------------------------------------------------------------
// Per-frame update
// ---------------------------------------------------------------------------------------------

const COIL_INDEX = { head: 0, knee: 1, spine: 2 } as const

function updateMri(r: MriRig, s: ScannerState, t: number): void {
  const x = tableX(IMAGING.mri.table, s.tablePos)
  if (changed(x, r.last.x)) {
    r.table.position.x = x
    r.table.updateMatrix()
    r.last.x = x
  }
  const kind = coilFor(s.exam?.bodyPart)
  const coil = kind === null ? -1 : COIL_INDEX[kind]
  if (coil !== r.last.coil) {
    for (let i = 0; i < r.coils.length; i++) r.coils[i].visible = i === coil
    r.last.coil = coil
  }
  const led = ledLevel(s.activity, t)
  if (changed(led, r.last.led)) {
    setRegion(r.glow.geometry, r.glow.regions.led, ledGain(led))
    r.last.led = led
  }
}

const AMBER = linear('#ffb23a')
const GREEN = linear('#35e07a')

function updateCt(r: CtRig, s: ScannerState, dt: number): void {
  const x = tableX(IMAGING.ct.table, s.tablePos)
  if (changed(x, r.last.x)) {
    r.table.position.x = x
    r.table.updateMatrix()
    r.last.x = x
  }
  r.angle = rotorAdvance(r.angle, s.activity, dt)
  if (changed(r.angle, r.last.angle)) {
    r.rotor.rotation.x = r.angle
    r.rotor.updateMatrix()
    r.last.angle = r.angle
  }
  r.laser = stepToward(r.laser, laserTarget(s.phase), dt, LASER_FADE_SECONDS)
  if (changed(r.laser, r.last.laser)) {
    setRegion(r.glow.geometry, r.glow.regions.laser, 1.6, r.laser)
    r.last.laser = r.laser
  }
  r.status = stepToward(r.status, ctStatusTarget(s.activity), dt, 0.25)
  if (changed(r.status, r.last.status)) {
    const k = r.status
    const gain = 0.5 + 1.2 * k
    setRegionRGB(r.glow.geometry, r.glow.regions.status, lerp(AMBER[0], GREEN[0], k) * gain, lerp(AMBER[1], GREEN[1], k) * gain, lerp(AMBER[2], GREEN[2], k) * gain, 1)
    r.last.status = k
  }
}

function updateXray(r: XrayRig, s: ScannerState, dt: number): void {
  const p = xrayPoseInto(r.pose, s.detail)
  if (changed(p.carriageZ, r.last.z) || changed(p.headAngle, r.last.angle) || changed(p.pivotY, r.last.pivot)) {
    r.carriage.position.set(0, 0, p.carriageZ)
    r.carriage.updateMatrix()
    r.column.position.set(XRAY.x, XRAY_POSE.columnTopY, p.carriageZ)
    r.column.scale.set(1, p.columnLength, 1)
    r.column.updateMatrix()
    r.head.position.set(XRAY.x, p.pivotY, p.carriageZ)
    r.head.rotation.z = p.headAngle
    r.head.updateMatrix()
    r.last.z = p.carriageZ
    r.last.angle = p.headAngle
    r.last.pivot = p.pivotY
  }

  // the exposure: the whole head brightens (colours above 1 bloom) and falls away in about 0.2 s
  r.flash = flashLevel(r.flash, s.activity, dt)
  if (changed(r.flash, r.last.flash)) {
    const col = r.head.geometry.getAttribute('color')
    const a = col.array as Float32Array
    const f = r.flash
    const gr = 1 + 1.6 * f
    const gg = 1 + 1.1 * f
    const gb = 1 + 0.15 * f
    for (let i = 0; i < a.length; i += 3) {
      a[i] = r.headBase[i] * gr
      a[i + 1] = r.headBase[i + 1] * gg
      a[i + 2] = r.headBase[i + 2] * gb
    }
    col.needsUpdate = true
    r.last.flash = f
  }

  // the collimator light: a square on the table or on the wall detector while lining up and exposing
  r.tableField = stepToward(r.tableField, collimatorTarget(s.phase, s.detail, 'table'), dt, 0.12)
  if (changed(r.tableField, r.last.tableField)) {
    setRegion(r.glow.geometry, r.glow.regions.tableFill, 1, 0.8 * r.tableField)
    setRegion(r.glow.geometry, r.glow.regions.tableCross, 1.2, 0.9 * r.tableField)
    r.last.tableField = r.tableField
  }
  r.wallField = stepToward(r.wallField, collimatorTarget(s.phase, s.detail, 'wall'), dt, 0.12)
  if (changed(r.wallField, r.last.wallField)) {
    setRegion(r.glow.geometry, r.glow.regions.wallFill, 1, 0.85 * r.wallField)
    setRegion(r.glow.geometry, r.glow.regions.wallCross, 1, 0.9 * r.wallField)
    r.last.wallField = r.wallField
  }

  // the red lamp over the booth door: dim at rest, lit for the whole scan, brightest during the flash
  r.lamp = stepToward(r.lamp, lampLevel(s.phase, s.activity), dt, 0.1)
  if (changed(r.lamp, r.last.lamp)) {
    setRegion(r.glow.geometry, r.glow.regions.lamp, lampGain(r.lamp), 1)
    r.last.lamp = r.lamp
  }
}

const PROBE_RATE = 7
const PROBE_ROCK_RATE = 10
const _a = new Vector3()
const _b = new Vector3()
const _d = new Vector3()
const _q = new Quaternion()
const Z_AXIS = new Vector3(0, 0, 1)
const CABLE = 0.012

function updateUs(r: UsRig, s: ScannerState, dt: number, t: number): void {
  const p = r.pose
  const w = probeTargetInto(r.target, s.phase, s.detail, s.activity, t)
  p.x = smoothTo(p.x, w.x, PROBE_RATE, dt)
  p.y = smoothTo(p.y, w.y, PROBE_RATE, dt)
  p.z = smoothTo(p.z, w.z, PROBE_RATE, dt)
  p.rx = smoothTo(p.rx, w.rx, PROBE_ROCK_RATE, dt)
  p.tz = smoothTo(p.tz, w.tz, PROBE_ROCK_RATE, dt)

  const l = r.last
  if (changed(p.x, l.x) || changed(p.y, l.y) || changed(p.z, l.z) || changed(p.rx, l.rx) || changed(p.tz, l.tz)) {
    r.probe.position.set(p.x, p.y, p.z)
    r.probe.rotation.set(p.rx, 0, p.tz)
    r.probe.updateMatrix()
    l.x = p.x
    l.y = p.y
    l.z = p.z
    l.rx = p.rx
    l.tz = p.tz

    const show = handShown(p)
    if (show !== r.hand) {
      r.probe.geometry.setDrawRange(0, show ? Infinity : r.probeVertices)
      r.hand = show
    }

    // the cable: a unit box stretched from the probe's top to the socket on the cart
    _a.set(PROBE_CABLE_ANCHOR.x, PROBE_CABLE_ANCHOR.y, PROBE_CABLE_ANCHOR.z).applyMatrix4(r.probe.matrix)
    _b.set(US_CART.socket.x, US_CART.socket.y, US_CART.socket.z)
    _d.subVectors(_a, _b)
    const len = _d.length()
    if (len > 1e-4) {
      _q.setFromUnitVectors(Z_AXIS, _d.multiplyScalar(1 / len))
      r.cable.position.addVectors(_a, _b).multiplyScalar(0.5)
      r.cable.quaternion.copy(_q)
      r.cable.scale.set(CABLE, CABLE, len)
      r.cable.updateMatrix()
    }
  }
}

/**
 * Animate the machines from the scanners' states. `dt` is the seconds to advance (0 while the sim is paused: everything holds),
 * `t` a running clock for the periodic parts (LED pulse, probe rocking).
 */
export function updateRig(rig: Rig, scanners: Record<ImagingModality, ScannerState>, dt: number, t: number): void {
  updateMri(rig.mri, scanners.mri, t)
  updateCt(rig.ct, scanners.ct, dt)
  updateXray(rig.xray, scanners.xray, dt)
  updateUs(rig.us, scanners.us, dt, t)
}
