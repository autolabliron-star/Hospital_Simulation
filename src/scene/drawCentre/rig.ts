/**
 * The animated part of the robot blood-draw centre as three.js objects, and the per-frame update that drives it from the sim's `DrawStationState`
 * (one per robot) and `TubePrepState`. Three meshes: the moving parts (ONE vertex-coloured mesh: robot heads, needles, tourniquet rings, tube bars,
 * the prep gripper, its held tube and the output trays; see movers.ts), the glow (status bars, the NIR light on the cradle, the scan-light chaser,
 * the label strip, the ticket slot, the send inlet ring) and the three robot screens (the live strip).
 *
 * `updateDrawRig` reads the states, eases each pose towards its target, and rewrites a part or a glow region only when it changed by more than
 * `EPS`. Nothing is allocated per frame: poses live in the rig's own objects and the maths goes through preallocated arrays.
 *
 * Draw calls: 3. Triangles: see the test (about 3k).
 */
import { type BufferGeometry, Group, type Material, Mesh } from 'three'
import { MACHINE_BODY, MACHINE_GLOW } from '@/scene/imaging/machines/machineMaterials'
import { type GlowRegion, linear, setRegion, setRegionRGB } from '@/scene/imaging/machines/geometry'
import { DRAW_CENTRE } from '@/sim/places'
import type { DrawStationState, DrawTicket, TubeKind, TubePrepState } from '@/sim/types'
import { LAB_CATALOGUE } from '@/content/lab'
import { type ArmGeometry, NEEDLE_TRAVEL, PREP_STOPS, TUBE_SLOTS, headZ, parkS, robotDims } from './dims'
import { takeTicketFlashRequests } from './flash'
import { buildGlow, buildMovers, buildScreens, type DrawMovers, type PrepParts, type RobotParts } from './geometry'
import {
  CHASER_SEGMENTS,
  GRIP_SPEED,
  HEAD_RATE,
  HEAD_SPEED,
  LED_HEX,
  NIR_FADE_SECONDS,
  SPIN_RATE,
  chaserLevels,
  cuffTarget,
  decayFlash,
  gripTargetInto,
  headTargetS,
  holdScan,
  labelGain,
  ledGain,
  newGripTarget,
  needleTarget,
  nirGain,
  nirTarget,
  slewTo,
  smoothTo,
  stepToward,
  tubeFills,
  visibleTrays,
  type GripTarget,
  type LedLight,
} from './motion'
import { type Movers } from './movers'

/** A glow value must move further than this to be rewritten. */
const EPS = 0.004
const changed = (a: number, b: number): boolean => !(Math.abs(a - b) <= EPS)

const TAU = Math.PI * 2
/** The tourniquet ring's radius when it is pulled tight, as a share of its open radius. */
const CUFF_TIGHT = 0.74
const NEEDLE_RATE = 14
const CUFF_RATE = 10
const GRIP_RATE = 7
const GRIP_OPEN_RATE = 14
/** Seconds a flash (ticket slot, send inlet) takes to fade. */
const FLASH_SECONDS = 0.9

const LED_LINEAR: Record<LedLight, [number, number, number]> = {
  white: linear(LED_HEX.white),
  teal: linear(LED_HEX.teal),
  amber: linear(LED_HEX.amber),
  green: linear(LED_HEX.green),
}
const CAP_LINEAR: Record<TubeKind, [number, number, number]> = {
  citrate: linear(LAB_CATALOGUE.tubes.citrate.hex),
  serum: linear(LAB_CATALOGUE.tubes.serum.hex),
  heparin: linear(LAB_CATALOGUE.tubes.heparin.hex),
  EDTA: linear(LAB_CATALOGUE.tubes.EDTA.hex),
  fluoride: linear(LAB_CATALOGUE.tubes.fluoride.hex),
}

interface RobotRig {
  parts: RobotParts
  head: number
  needlePart: number
  cuffPart: number
  bars: number[]
  arm: ArmGeometry
  park: number
  /** The head's fastest move in `s` units per second (HEAD_SPEED m/s over the forearm). */
  maxS: number
  led: GlowRegion
  nirRegion: GlowRegion
  chaseRegions: GlowRegion[]
  /** Eased state. */
  s: number
  hold: number
  needle: number
  cuff: number
  nir: number
  /** The tube kind each bar is painted for (null: unpainted), and the last glow values written. */
  kinds: (TubeKind | null)[]
  last: { ledR: number; ledG: number; ledB: number; nirGain: number; nirAlpha: number; chase: Float32Array }
}

interface PrepRig {
  parts: PrepParts
  idx: { bridge: number; carriage: number; rod: number; gripHead: number; fingerL: number; fingerR: number; heldBody: number; heldLabel: number; heldCap: number; trays: number[] }
  labelRegion: GlowRegion
  target: GripTarget
  lx: number
  lz: number
  y: number
  open: number
  held: number
  label: number
  spin: number
  heldKind: TubeKind | null
  lastLabel: number
}

export interface DrawRig {
  root: Group
  /** Every mesh of the rig (all drawn): the moving parts, the glow, the screens. */
  meshes: Mesh[]
  movers: Movers
  glow: ReturnType<typeof buildGlow>
  robots: RobotRig[]
  prep: PrepRig
  fills: Float32Array
  chase: Float32Array
  flash: { ticket: number; inlet: number; lastTicket: number; lastInlet: number }
  /** The newest ticket's issue time seen so far (NaN before the first frame), and the nurse draw count seen. */
  seen: { issuedAt: number; nurseDraws: number }
}

/** The part of `sim.blood` the rig reads. */
export interface BloodLike {
  readonly stations: readonly DrawStationState[]
  readonly prep: TubePrepState
  readonly queue: readonly DrawTicket[]
  readonly stats: { readonly nurseDraws: number }
}

function makeMesh(name: string, geometry: BufferGeometry, material: Material, o: { receive?: boolean } = {}): Mesh {
  const m = new Mesh(geometry, material)
  m.name = name
  m.castShadow = false
  m.receiveShadow = o.receive ?? false
  // nothing is placed by three's own transform: every part is baked in world coordinates and posed by `updateDrawRig`
  m.matrixAutoUpdate = false
  m.updateMatrix()
  return m
}

function makeRobotRig(dm: DrawMovers, glow: ReturnType<typeof buildGlow>, i: number): RobotRig {
  const parts = dm.robots[i]
  const d = robotDims(i)
  const idx = (p: (typeof parts)['head']): number => dm.movers.indexOf(p)
  const chaseRegions: GlowRegion[] = []
  for (let k = 0; k < CHASER_SEGMENTS; k++) chaseRegions.push(glow.regions[`chase${i}_${k}`])
  return {
    parts,
    head: idx(parts.head),
    needlePart: idx(parts.needle),
    cuffPart: idx(parts.cuff),
    bars: parts.bars.map(idx),
    arm: d.arm,
    park: parkS(d.arm),
    maxS: HEAD_SPEED / Math.abs(d.arm.z1 - d.arm.z0),
    led: glow.regions[`led${i}`],
    nirRegion: glow.regions[`nir${i}`],
    chaseRegions,
    s: parkS(d.arm),
    hold: -1,
    needle: 0,
    cuff: 0,
    nir: 0,
    kinds: parts.bars.map(() => null),
    last: { ledR: Number.NaN, ledG: Number.NaN, ledB: Number.NaN, nirGain: Number.NaN, nirAlpha: Number.NaN, chase: new Float32Array(CHASER_SEGMENTS).fill(Number.NaN) },
  }
}

function makePrepRig(dm: DrawMovers, glow: ReturnType<typeof buildGlow>): PrepRig {
  const p = dm.prep
  const idx = (part: Parameters<Movers['indexOf']>[0]): number => dm.movers.indexOf(part)
  return {
    parts: p,
    idx: {
      bridge: idx(p.bridge),
      carriage: idx(p.carriage),
      rod: idx(p.rod),
      gripHead: idx(p.gripHead),
      fingerL: idx(p.fingerL),
      fingerR: idx(p.fingerR),
      heldBody: idx(p.heldBody),
      heldLabel: idx(p.heldLabel),
      heldCap: idx(p.heldCap),
      trays: p.trays.map(idx),
    },
    labelRegion: glow.regions.label,
    target: newGripTarget(),
    lx: PREP_STOPS.home.lx,
    lz: PREP_STOPS.home.lz,
    y: PREP_STOPS.yHome,
    open: 1,
    held: 0,
    label: 0,
    spin: 0,
    heldKind: null,
    lastLabel: Number.NaN,
  }
}

const IDLE_STATION: DrawStationState = {
  index: 0,
  phase: 'idle',
  phaseTime: 0,
  progress: 0,
  ticket: null,
  patientId: null,
  patientName: null,
  tubes: [],
  tube: 0,
  tubeFill: 0,
  inversions: 0,
  cuff: 0,
  needle: 0,
  scan: 0,
  trayHere: false,
  attendantId: null,
  light: 'white',
  attempts: 0,
  drawsToday: 0,
  robotDrawsToday: 0,
  nurseDrawsToday: 0,
  version: 0,
}
const IDLE_BLOOD: BloodLike = {
  stations: [IDLE_STATION, IDLE_STATION, IDLE_STATION],
  prep: { phase: 'idle', progress: 0, ticket: null, queue: 0, bin: -1, held: null, rack: [], traysToday: 0, version: 0 },
  queue: [],
  stats: { nurseDraws: 0 },
}

/** Build every mesh of the centre. `screenMaterial` is the textured material of the live strip (see liveTexture.ts; tests pass a stub). */
export function createDrawRig(screenMaterial: Material): DrawRig {
  const dm = buildMovers()
  const glow = buildGlow()
  const root = new Group()
  root.name = 'draw-centre'
  const movers = dm.movers
  const movingMesh = makeMesh('draw-movers', movers.geometry, MACHINE_BODY, { receive: true })
  const glowMesh = makeMesh('draw-glow', glow.geometry, MACHINE_GLOW)
  const screens = makeMesh('draw-screens', buildScreens(), screenMaterial)
  root.add(movingMesh, glowMesh, screens)
  const robots = DRAW_CENTRE.robots.map((_, i) => makeRobotRig(dm, glow, i))
  const rig: DrawRig = {
    root,
    meshes: [movingMesh, glowMesh, screens],
    movers,
    glow,
    robots,
    prep: makePrepRig(dm, glow),
    fills: new Float32Array(TUBE_SLOTS.count),
    chase: new Float32Array(CHASER_SEGMENTS),
    flash: { ticket: 0, inlet: 0, lastTicket: Number.NaN, lastInlet: Number.NaN },
    seen: { issuedAt: Number.NaN, nurseDraws: Number.NaN },
  }
  // lay every part out for an idle centre (the held tube, the trays and the bars are hidden until used)
  updateDrawRig(rig, IDLE_BLOOD, 0, 0)
  rig.seen.issuedAt = Number.NaN
  rig.seen.nurseDraws = Number.NaN
  rig.flash.ticket = 0
  rig.flash.inlet = 0
  return rig
}

/** Free the geometries (the shared materials and the live texture belong to someone else). */
export function disposeDrawRig(rig: DrawRig): void {
  for (const m of rig.meshes) m.geometry.dispose()
}

// ---------------------------------------------------------------------------------------------
// Per-frame update
// ---------------------------------------------------------------------------------------------

function updateRobot(rig: DrawRig, r: RobotRig, s: DrawStationState, dt: number, t: number): void {
  const m = rig.movers
  const phase = s.phase
  // the head: glides along the forearm with `scan`, holds at the target for the needle and the tubes, parks in the tunnel otherwise
  r.hold = holdScan(r.hold, phase, s.scan)
  r.s = slewTo(r.s, headTargetS(phase, s.scan, r.hold, r.park), HEAD_RATE, r.maxS, dt)
  const dz = headZ(r.arm, r.s) - r.parts.rest.headZ
  m.pose(r.head, 0, 0, dz)
  // the needle comes down out of the head
  r.needle = smoothTo(r.needle, needleTarget(phase, s.needle), NEEDLE_RATE, dt)
  m.pose(r.needlePart, 0, -NEEDLE_TRAVEL * r.needle, dz)
  // the tourniquet pulls tight about the arm's axis
  r.cuff = smoothTo(r.cuff, cuffTarget(s.cuff), CUFF_RATE, dt)
  const k = 1 - r.cuff * (1 - CUFF_TIGHT)
  m.pose(r.cuffPart, 0, 0, 0, k, k, 1)
  // the tube bars: cap colours, filling in turn; a tube that is mixing rocks a little
  tubeFills(rig.fills, s)
  const mixing = phase === 'filling' && s.inversions > 0 && s.tubeFill >= 0.98
  for (let b = 0; b < TUBE_SLOTS.count; b++) {
    const kind = b < s.tubes.length ? s.tubes[b] : null
    if (kind !== r.kinds[b]) {
      r.kinds[b] = kind
      if (kind !== null) m.paint(r.bars[b], CAP_LINEAR[kind][0], CAP_LINEAR[kind][1], CAP_LINEAR[kind][2])
    }
    const f = rig.fills[b]
    m.pose(r.bars[b], 0, 0, 0, 1, f <= 0 ? 0 : f < 0.04 ? 0.04 : f, 1, mixing && b === s.tube ? 0.05 * Math.sin(t * 10) : 0)
  }

  // the status bar
  const lin = LED_LINEAR[s.light] ?? LED_LINEAR.white
  const gain = ledGain(s.light, phase, t)
  const lr = lin[0] * gain
  const lg = lin[1] * gain
  const lb = lin[2] * gain
  if (changed(lr, r.last.ledR) || changed(lg, r.last.ledG) || changed(lb, r.last.ledB)) {
    setRegionRGB(rig.glow.geometry, r.led, lr, lg, lb, 1)
    r.last.ledR = lr
    r.last.ledG = lg
    r.last.ledB = lb
  }
  // the near-infrared light on the cradle: deep red, pulsing while the robot looks for the vein
  r.nir = stepToward(r.nir, nirTarget(phase), dt, NIR_FADE_SECONDS)
  const ng = nirGain(r.nir, t)
  if (changed(ng, r.last.nirGain) || changed(r.nir, r.last.nirAlpha)) {
    setRegion(rig.glow.geometry, r.nirRegion, ng, r.nir)
    r.last.nirGain = ng
    r.last.nirAlpha = r.nir
  }
  // the scan-light chaser along the tunnel roof
  chaserLevels(rig.chase, phase, t)
  for (let c = 0; c < CHASER_SEGMENTS; c++) {
    const v = rig.chase[c]
    if (changed(v, r.last.chase[c])) {
      setRegion(rig.glow.geometry, r.chaseRegions[c], 0.4 + 1.6 * v, v)
      r.last.chase[c] = v
    }
  }
}

function updatePrep(rig: DrawRig, p: PrepRig, prep: TubePrepState, dt: number, t: number): void {
  const m = rig.movers
  const g = gripTargetInto(p.target, prep)
  p.lx = slewTo(p.lx, g.lx, GRIP_RATE, GRIP_SPEED, dt)
  p.lz = slewTo(p.lz, g.lz, GRIP_RATE, GRIP_SPEED, dt)
  p.y = slewTo(p.y, g.y, GRIP_RATE, GRIP_SPEED, dt)
  p.open = smoothTo(p.open, g.open, GRIP_OPEN_RATE, dt)
  // the held tube and its label show up and vanish with a quick ease
  p.held = smoothTo(p.held, g.held ? 1 : 0, 20, dt)
  p.label = smoothTo(p.label, g.label ? 1 : 0, 20, dt)
  if (g.spin) p.spin = (p.spin + SPIN_RATE * dt) % TAU
  const rest = p.parts.rest
  // the fingers' world offset from the pose they were baked at (machine frame: lx across = world -z, lz depth = world +x)
  const dx = p.lz - rest.lz
  const dz = -(p.lx - rest.lx)
  const dy = p.y - rest.yFinger
  m.pose(p.idx.bridge, dx, 0, 0)
  m.pose(p.idx.carriage, dx, 0, dz)
  const rodTop = PREP_STOPS.yBeam - 0.0225
  const sy = (rodTop - p.y - 0.041) / rest.rodLength
  m.pose(p.idx.rod, dx, 0, dz, 1, sy < 0.02 ? 0.02 : sy > 1 ? 1 : sy, 1)
  m.pose(p.idx.gripHead, dx, dy, dz)
  const gap = 0.011 + (rest.fingerGap - 0.011) * p.open
  m.pose(p.idx.fingerL, dx, dy, dz + (rest.fingerGap - gap))
  m.pose(p.idx.fingerR, dx, dy, dz - (rest.fingerGap - gap))
  // the held tube hangs below the fingers and spins in the wrap station; it takes the cap colour of the kind it holds
  if (prep.held !== p.heldKind) {
    p.heldKind = prep.held
    if (prep.held !== null) m.paint(p.idx.heldCap, CAP_LINEAR[prep.held][0], CAP_LINEAR[prep.held][1], CAP_LINEAR[prep.held][2])
  }
  const hs = p.held < 0.02 ? 0 : p.held
  m.pose(p.idx.heldBody, dx, dy, dz, hs, hs, hs, 0, p.spin)
  m.pose(p.idx.heldCap, dx, dy, dz, hs, hs, hs, 0, p.spin)
  const ls = p.held < 0.02 ? 0 : p.label
  m.pose(p.idx.heldLabel, dx, dy, dz, ls, ls, ls, 0, p.spin)
  // the output rack
  const trays = visibleTrays(prep.rack)
  for (let k = 0; k < p.idx.trays.length; k++) m.pose(p.idx.trays[k], 0, 0, 0, 1, k < trays ? 1 : 0, 1)
  // the label strip
  const lg = labelGain(g.printing, t)
  if (changed(lg, p.lastLabel)) {
    setRegion(rig.glow.geometry, p.labelRegion, lg, g.printing ? 1 : 0.5)
    p.lastLabel = lg
  }
}

function updateFlashes(rig: DrawRig, blood: BloodLike, dt: number): void {
  const f = rig.flash
  // a new ticket was issued: the slot glows (the first frame only learns what is already there)
  let newest = -1
  for (let i = 0; i < blood.queue.length; i++) if (blood.queue[i].issuedAt > newest) newest = blood.queue[i].issuedAt
  if (Number.isNaN(rig.seen.issuedAt)) rig.seen.issuedAt = newest
  else if (newest > rig.seen.issuedAt) {
    f.ticket = 1
    rig.seen.issuedAt = newest
  }
  if (takeTicketFlashRequests() > 0) f.ticket = 1
  // the nurse drew by hand: the tubes go into the send station's inlet
  const hand = blood.stats.nurseDraws
  if (Number.isNaN(rig.seen.nurseDraws)) rig.seen.nurseDraws = hand
  else if (hand > rig.seen.nurseDraws) {
    f.inlet = 1
    rig.seen.nurseDraws = hand
  } else if (hand < rig.seen.nurseDraws) rig.seen.nurseDraws = hand
  f.ticket = decayFlash(f.ticket, dt, FLASH_SECONDS)
  f.inlet = decayFlash(f.inlet, dt, FLASH_SECONDS)
  if (changed(f.ticket, f.lastTicket)) {
    setRegion(rig.glow.geometry, rig.glow.regions.ticket, 0.35 + 1.6 * f.ticket, 0.3 + 0.7 * f.ticket)
    f.lastTicket = f.ticket
  }
  if (changed(f.inlet, f.lastInlet)) {
    setRegion(rig.glow.geometry, rig.glow.regions.inlet, 0.35 + 1.7 * f.inlet, 0.3 + 0.7 * f.inlet)
    f.lastInlet = f.inlet
  }
}

/**
 * Animate the centre from the sim's draw state. `dt` is the seconds to advance (0 while the sim is paused: everything holds), `t` a running clock
 * for the periodic parts (the NIR pulse, the chaser, the label strip).
 */
export function updateDrawRig(rig: DrawRig, blood: BloodLike, dt: number, t: number): void {
  for (let i = 0; i < rig.robots.length; i++) {
    const s = blood.stations[i]
    if (s) updateRobot(rig, rig.robots[i], s, dt, t)
  }
  updatePrep(rig, rig.prep, blood.prep, dt, t)
  updateFlashes(rig, blood, dt)
  rig.movers.commit()
}
