/**
 * The geometry of the animated parts of the draw centre (pure builders, no meshes): the moving parts (one `Movers` for the whole centre), the
 * glow regions (one glow mesh) and the three robot screens (one textured mesh). The static room is drawn by src/scene/rooms/bloodDraw.ts.
 *
 * Everything is baked in WORLD coordinates at the part's rest pose (the robot head at the wrist end of the forearm, the tube bars empty and gold,
 * the gripper at home), and the rig moves it from there. Uses the machines' geometry kit so the programs and the look match the imaging suite.
 */
import { BufferGeometry, Float32BufferAttribute, PlaneGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LAB_CATALOGUE } from '@/content/lab'
import { DRAW_CENTRE } from '@/sim/places'
import { bx, box, COL, cyl, GlowBuilder, type GlowGeometry, rbox, torus } from '@/scene/imaging/machines/geometry'
import { type Movers, MoversBuilder, type Part } from './movers'
import {
  CHECKIN,
  HEAD,
  PREP,
  PREP_STOPS,
  SCREEN,
  SEND,
  TUBE_SLOTS,
  TUNNEL,
  prepWorld,
  robotDims,
  type RobotDims,
} from './dims'
import { CHASER_SEGMENTS } from './motion'

/** The look of the moving parts. */
export const LOOK = {
  needle: '#d9dfe0',
  lens: '#4a0a10',
  tray: '#8fc6bc',
  tube: '#e3edf1',
  label: '#ffffff',
  stripe: '#1c2527',
  gold: LAB_CATALOGUE.tubes.serum.hex,
} as const

export interface RobotParts {
  head: Part
  needle: Part
  cuff: Part
  bars: Part[]
  /** Rest values the rig poses against. */
  rest: { headZ: number; cuffRadius: number; barBase: number; barX: number[] }
}

export interface PrepParts {
  bridge: Part
  carriage: Part
  rod: Part
  gripHead: Part
  fingerL: Part
  fingerR: Part
  heldBody: Part
  heldLabel: Part
  heldCap: Part
  trays: Part[]
  /** The home pose the parts were baked at, in the machine frame, and the rod's rest length. */
  rest: { lx: number; lz: number; yFinger: number; rodLength: number; fingerGap: number; heldDy: number }
}

export interface DrawMovers {
  movers: Movers
  robots: RobotParts[]
  prep: PrepParts
}

const CUFF_R = 0.058
const ROD_LENGTH = 0.15
const FINGER_GAP_OPEN = 0.02

function robotParts(b: MoversBuilder, d: RobotDims): Omit<RobotParts, 'bars'> & { bars: Part[] } {
  const a = d.arm
  const z0 = a.z0
  const i = d.index
  // the head: a white carriage with a dark underside, the NIR lens, the ultrasound nub and a teal accent
  const head = b.part(
    `head${i}`,
    [
      rbox(2 * HEAD.halfX, 2 * HEAD.halfY, 2 * HEAD.halfZ, 0.012, COL.white, { x: a.x, y: HEAD.y, z: z0 }),
      box(2 * HEAD.halfX - 0.01, 0.006, 2 * HEAD.halfZ - 0.01, COL.dark, { x: a.x, y: HEAD.y - HEAD.halfY - 0.002, z: z0 }),
      cyl('y', 0.02, 0.006, LOOK.lens, { x: a.x, y: HEAD.y - HEAD.halfY - 0.006, z: z0 - 0.016 }, 16),
      cyl('y', 0.011, 0.014, COL.greyMid, { x: a.x, y: HEAD.y - HEAD.halfY - 0.008, z: z0 + 0.026 }, 12),
      box(2 * HEAD.halfX - 0.03, 0.004, 0.03, COL.teal, { x: a.x, y: HEAD.y + HEAD.halfY + 0.001, z: z0 - 0.004 }),
    ],
    [a.x, HEAD.y, z0],
  )
  // the needle: hides inside the head, comes down NEEDLE_TRAVEL to the skin
  const needle = b.part(
    `needle${i}`,
    [
      box(0.004, 0.045, 0.004, LOOK.needle, { x: a.x, y: HEAD.y - HEAD.halfY + 0.005 + 0.0225, z: z0 + 0.0045 }),
      box(0.012, 0.012, 0.012, COL.greyMid, { x: a.x, y: HEAD.y + 0.016, z: z0 + 0.0045 }),
    ],
    [a.x, HEAD.y, z0],
  )
  // the tourniquet: a teal ring round the forearm just inside the tunnel's mouth, open at rest; it shrinks about the arm's axis
  const cz = a.zMouth + 0.022
  const cuff = b.part(`cuff${i}`, [torus('z', CUFF_R, 0.01, COL.teal, { x: a.x, y: a.y - 0.005, z: cz }, 40)], [a.x, a.y - 0.005, cz])
  // five tube bars in the cabinet's window, in their slots, gold at rest (the rig paints the cap colours)
  const wx = d.x + TUBE_SLOTS.dx
  const barX: number[] = []
  const bars: Part[] = []
  for (let k = 0; k < TUBE_SLOTS.count; k++) {
    const x = wx + (k - (TUBE_SLOTS.count - 1) / 2) * TUBE_SLOTS.pitch
    barX.push(x)
    const z = d.zFront - 0.0225
    bars.push(
      b.part(`bar${i}_${k}`, [box(TUBE_SLOTS.width, TUBE_SLOTS.full, 0.015, LOOK.gold, { x, y: TUBE_SLOTS.base + TUBE_SLOTS.full / 2, z })], [x, TUBE_SLOTS.base, z]),
    )
  }
  return { head, needle, cuff, bars, rest: { headZ: z0, cuffRadius: CUFF_R, barBase: TUBE_SLOTS.base, barX } }
}

function prepParts(b: MoversBuilder): PrepParts {
  const S = PREP_STOPS
  const home = prepWorld(S.home.lx, S.home.lz)
  const rails = { z0: PREP.cz - 0.27, z1: PREP.cz + 0.27 }
  // the bridge: a beam across the two rails, riding along the machine's depth
  const bridge = b.part('prepBridge', [bx(home.x - 0.018, home.x + 0.018, S.yBeam - 0.012, S.yBeam + 0.012, rails.z0 - 0.02, rails.z1 + 0.02, COL.dark)], [home.x, S.yBeam, PREP.cz])
  // the carriage on the bridge, a rod hanging from it (stretched to reach the fingers), and the gripper head with two fingers
  const carriage = b.part('prepCarriage', [rbox(0.06, 0.035, 0.07, 0.008, COL.white, { x: home.x, y: S.yBeam - 0.005, z: home.z })], [home.x, S.yBeam, home.z])
  const yTop = S.yBeam - 0.0225
  const rod = b.part('prepRod', [box(0.01, ROD_LENGTH, 0.01, COL.greyMid, { x: home.x, y: yTop - ROD_LENGTH / 2, z: home.z })], [home.x, yTop, home.z])
  const yFinger = S.yHome
  const gripHead = b.part('prepGripHead', [rbox(0.04, 0.022, 0.05, 0.006, COL.dark, { x: home.x, y: yFinger + 0.03, z: home.z })], [home.x, yFinger, home.z])
  const finger = (id: string, side: number): Part =>
    b.part(id, [rbox(0.014, 0.04, 0.006, 0.002, COL.greyMid, { x: home.x, y: yFinger, z: home.z + side * FINGER_GAP_OPEN })], [home.x, yFinger, home.z])
  const fingerL = finger('prepFingerL', -1)
  const fingerR = finger('prepFingerR', 1)
  // the held tube: a pale body with a white label (and barcode stripes) on its +x side, and a cap; hangs below the fingers
  const heldDy = -0.04
  const hy = yFinger + heldDy
  const heldBody = b.part('heldBody', [cyl('y', 0.008, 0.1, LOOK.tube, { x: home.x, y: hy, z: home.z }, 12)], [home.x, hy, home.z])
  const stripe = (dz: number): BufferGeometry => box(0.0015, 0.04, 0.0014, LOOK.stripe, { x: home.x + 0.0092, y: hy, z: home.z + dz })
  const heldLabel = b.part(
    'heldLabel',
    [box(0.002, 0.05, 0.014, LOOK.label, { x: home.x + 0.0085, y: hy, z: home.z }), stripe(-0.004), stripe(0), stripe(0.004)],
    [home.x, hy, home.z],
  )
  const heldCap = b.part('heldCap', [cyl('y', 0.0095, 0.02, LOOK.gold, { x: home.x, y: hy + 0.056, z: home.z }, 12)], [home.x, hy, home.z])
  // the output rack: up to three labelled trays stacked on the tray outlet's shelf
  const trays: Part[] = []
  const tx = PREP.tray.x
  for (let k = 0; k < S.trays; k++) {
    const y = 0.93 + k * 0.014
    trays.push(b.part(`tray${k}`, [rbox(0.1, 0.012, 0.22, 0.003, LOOK.tray, { x: tx, y: y + 0.006, z: PREP.cz })], [tx, y, PREP.cz]))
  }
  return { bridge, carriage, rod, gripHead, fingerL, fingerR, heldBody, heldLabel, heldCap, trays, rest: { lx: S.home.lx, lz: S.home.lz, yFinger, rodLength: ROD_LENGTH, fingerGap: FINGER_GAP_OPEN, heldDy } }
}

/** All the moving parts of the centre, in one geometry. */
export function buildMovers(): DrawMovers {
  const b = new MoversBuilder()
  const robots = DRAW_CENTRE.robots.map((_, i) => robotParts(b, robotDims(i)))
  const prep = prepParts(b)
  return { movers: b.build(), robots, prep }
}

// ---------------------------------------------------------------------------------------------
// Glow
// ---------------------------------------------------------------------------------------------

export const GLOW_HEX = { led: '#f4f8f8', nir: '#ff2418', chase: '#33e6da', label: '#ffe9b0', ticket: '#ffd27a', inlet: '#35e0c6' } as const

/** The glow mesh: per robot the status bar, the NIR strip on the cradle and 8 chaser segments; the label strip, the ticket slot and the inlet ring. */
export function buildGlow(): GlowGeometry {
  const g = new GlowBuilder()
  for (let i = 0; i < DRAW_CENTRE.robots.length; i++) {
    const d = robotDims(i)
    const a = d.arm
    g.region(`led${i}`, GLOW_HEX.led, [bx(d.x - 0.38, d.x - 0.08, 0.987, 1.003, d.zFront - 0.009, d.zFront - 0.004, GLOW_HEX.led)])
    g.region(`nir${i}`, GLOW_HEX.nir, [bx(a.x - 0.035, a.x + 0.035, TUNNEL.yPadTop + 0.001, TUNNEL.yPadTop + 0.004, a.zMouth + 0.04, a.zHand + 0.09, GLOW_HEX.nir)])
    const z0 = a.zMouth + 0.09
    const z1 = a.zFront - 0.05
    for (let k = 0; k < CHASER_SEGMENTS; k++) {
      const zc = z0 + ((z1 - z0) * k) / (CHASER_SEGMENTS - 1)
      g.region(`chase${i}_${k}`, GLOW_HEX.chase, [bx(a.x - 0.02, a.x + 0.02, 1.0, 1.003, zc - 0.022, zc + 0.022, GLOW_HEX.chase)])
    }
  }
  // the label printer's strip on the front edge of the printer's top (machine frame lz 0.2 + 0.045)
  const pr = PREP_STOPS.printer
  const lw = prepWorld(pr.lx, pr.lz + 0.046)
  g.region('label', GLOW_HEX.label, [bx(lw.x - 0.007, lw.x + 0.007, PREP.deck + 0.1 + 0.001, PREP.deck + 0.1 + 0.005, lw.z - 0.07, lw.z + 0.07, GLOW_HEX.label)])
  // the check-in ticket slot
  const c = DRAW_CENTRE.checkIn.device
  g.region('ticket', GLOW_HEX.ticket, [bx(c.x + 0.1 - 0.07, c.x + 0.1 + 0.07, CHECKIN.slotY - 0.004, CHECKIN.slotY + 0.002, c.z + CHECKIN.d / 2 + 0.006, c.z + CHECKIN.d / 2 + 0.01, GLOW_HEX.ticket)])
  // the send station's inlet ring, a little in front of the static frame
  const s = DRAW_CENTRE.manualSend
  g.region('inlet', GLOW_HEX.inlet, [torus('z', 0.056, 0.0065, GLOW_HEX.inlet, { x: s.x, y: SEND.inletY, z: s.z - SEND.d / 2 - 0.013 }, 40)])
  return g.build()
}

// ---------------------------------------------------------------------------------------------
// The robots' screens (the live strip's three cells)
// ---------------------------------------------------------------------------------------------

/** The picture of robot `i`: the i-th third of the strip texture, facing north, leaning back by SCREEN.lean, white vertex colours (the monitor material needs them). */
function screenQuad(d: RobotDims, cells: number): BufferGeometry {
  const g = new PlaneGeometry(SCREEN.picW, SCREEN.picH)
  const uv = g.getAttribute('uv')
  for (let v = 0; v < uv.count; v++) uv.setX(v, (d.index + uv.getX(v)) / cells)
  const n = g.getAttribute('position').count
  g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3))
  // facing -z, tilted so the face looks up a little: normal (0, sin lean, -cos lean)
  g.rotateX(-SCREEN.lean)
  g.rotateY(Math.PI)
  const k = SCREEN.thick / 2 + 0.003
  g.translate(d.screen.x, d.screen.y + Math.sin(SCREEN.lean) * k, d.screen.z - Math.cos(SCREEN.lean) * k)
  return g
}

/** The three robot screens, merged into one mesh (UV windows into the 768 x 160 strip). */
export function buildScreens(): BufferGeometry {
  const cells = DRAW_CENTRE.robots.length
  const quads = DRAW_CENTRE.robots.map((_, i) => screenQuad(robotDims(i), cells))
  const g = mergeGeometries(quads, false)
  if (!g) throw new Error('drawCentre: the screens did not merge')
  for (const q of quads) q.dispose()
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}
