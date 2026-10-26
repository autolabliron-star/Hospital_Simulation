/**
 * R4 (agent B): the CT-guided, robot-assisted cryoablation suite's static layout on level 2 (docs/R4-CRYO-SUITE.md), in DRAWN x through one frame at
 * sim x = drawn + LEVEL2_DX like the rest of the storey (shell.ts):
 *
 *   l2CryoControl  z 10..13: the CT desk and the robot-planning station under the observation glass (z 13), their chairs and seats
 *   l2Cryo         z 13..22: the CT (gantry west, table east: LIVE, src/scene/cryoSuite; here only their floor footprints and the table's seat),
 *                  the floor-docked needle-guidance robot's base (its 5-axis arm is live), the argon cryo console, the gas cylinders, the screen boom
 *                  south of the table and a supply cabinet on the south wall
 *
 * Everything here is the procedural fallback that the authored theatres zone replaces (tools/arch/zones/theatres.py REPLACES the robot, console,
 * cylinders, cabinet, boom and both control desks); the CT gantry and table are kept live in both looks, so they are rects only.
 *
 * Seats: `scanTable:cryo` (kind scanTable, pose lie, head west: heading +pi/2, approach at the table's foot), `console:cryo:ct` and
 * `console:cryo:robot` (kind console, pose sit, facing the glass). The control chairs are drawn only, as at the imaging consoles (rooms/imaging.ts):
 * the room is 3 m deep and the seats' approach lane runs right behind them.
 *
 * Materials: only the ones the storey already merges (whitePlastic, metalDark, frame, fabricTeal, woodOak, glowTeal, glass) plus `linen` for the
 * boom's ceiling post, which is walk-only like the OR's ceiling fittings: no new mesh.
 */
import { LEVEL2_DX } from '@/sim/levels'
import { CRYO_SUITE } from '@/sim/places'
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'

/** A sim x as a drawn x. */
const drawn = (simX: number): number => simX - LEVEL2_DX

/** A footprint rectangle in drawn x (x0..x1, z0..z1). The id is without the `footprint:` prefix the bake uses. */
export interface CryoRect {
  id: string
  area: 'l2Cryo' | 'l2CryoControl'
  x0: number
  x1: number
  z0: number
  z1: number
  /** Overhead marker (walked under; hides the fallback in the authored look but blocks nobody). */
  overhead?: boolean
  /** What the authored (baked) look does with it. */
  bake: 'live' | 'baked' | 'marker'
}

/**
 * The suite's footprints (drawn x). The cabinet sits 5 cm further north than the brief's table (z 21.35..21.9): every footprint stays half a wall
 * (0.1 m) inside its room, and the south wall's inner face is at z 21.9.
 */
export const CRYO_FOOTPRINTS: readonly CryoRect[] = [
  { id: 'l2:cryo:ct:gantry', area: 'l2Cryo', x0: -60.45, x1: -59.55, z0: 16.45, z1: 18.35, bake: 'live' },
  { id: 'l2:cryo:ct:table', area: 'l2Cryo', x0: -58.8, x1: -55.9, z0: 17.15, z1: 17.65, bake: 'live' },
  { id: 'l2:cryo:robot', area: 'l2Cryo', x0: -58.25, x1: -56.95, z0: 15.85, z1: 16.65, bake: 'baked' },
  { id: 'l2:cryo:console', area: 'l2Cryo', x0: -59.35, x1: -58.65, z0: 14.1, z1: 15.1, bake: 'baked' },
  { id: 'l2:cryo:cylinders', area: 'l2Cryo', x0: -61.0, x1: -60.2, z0: 14.1, z1: 14.7, bake: 'baked' },
  { id: 'l2:cryo:cabinet', area: 'l2Cryo', x0: -61.0, x1: -58.6, z0: 21.35, z1: 21.9, bake: 'baked' },
  { id: 'l2:cryo:boom', area: 'l2Cryo', x0: -57.5, x1: -57.3, z0: 19.2, z1: 19.4, overhead: true, bake: 'marker' },
  { id: 'l2:cryoctl:desk', area: 'l2CryoControl', x0: -61.4, x1: -58.6, z0: 12.2, z1: 12.8, bake: 'baked' },
  { id: 'l2:cryoctl:station', area: 'l2CryoControl', x0: -58.0, x1: -56.6, z0: 12.2, z1: 12.8, bake: 'baked' },
]

/** The seats this file adds. */
export const CRYO_SEATS = { table: 'scanTable:cryo', ct: 'console:cryo:ct', robot: 'console:cryo:robot' } as const
/** The table seat's approach: the table's foot, 0.4 m east of its footprint (drawn x). */
export const CRYO_TABLE_APPROACH = { x: -55.5, z: 17.4 } as const
/** The control chairs' seat height. */
export const CRYO_CONSOLE_SEAT = 0.5

const T = { cast: false } as const
const rectOf = (id: string): CryoRect => CRYO_FOOTPRINTS.find((r) => r.id === id)!
const mid = (r: CryoRect) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, w: r.x1 - r.x0, d: r.z1 - r.z0 })

function footprint(D: Frame, id: string): void {
  const r = rectOf(id)
  const m = mid(r)
  D.rect(id, m.x, m.z, m.w, m.d, r.overhead ? { overhead: true } : {})
}

/** A screen anchor of CRYO_SUITE (sim x): centre, size, the heading it faces and how far it leans back. */
interface ScreenAnchor {
  x: number
  y: number
  z: number
  w: number
  h: number
  heading: number
  tilt?: number
}

/**
 * The dark bezel behind a live screen face: the face (the scene's quad) sits 3 mm proud of the bezel's front, the bezel 2 cm larger all round, 3 cm
 * thick, leaning back by the anchor's tilt (the face's normal tilts up by `tilt`).
 */
export function bezelBehind(D: Frame, a: ScreenAnchor): void {
  const t = 0.03
  const lean = a.tilt ?? 0
  const k = t / 2 + 0.003
  const nx = Math.sin(a.heading) * Math.cos(lean)
  const nz = Math.cos(a.heading) * Math.cos(lean)
  const cx = drawn(a.x) - nx * k
  const cy = a.y - Math.sin(lean) * k
  const cz = a.z - nz * k
  const w = a.w + 0.04
  const h = a.h + 0.04
  D.rbox(cx, cy - h / 2, cz, w, h, t, 'metalDark', { ry: a.heading, rx: -lean, r: 0.012, cast: false })
}

/** A swivel chair facing `heading` (drawn only, no footprint: see the file comment). */
function officeChair(D: Frame, x: number, z: number, heading: number): void {
  const c = D.sub(x, z, heading)
  c.cyl(0, 0, 0, 0.46, 0.04, 'metalDark', T)
  c.cyl(0, 0.04, 0, 0.06, 0.36, 'metalDark', T)
  c.rbox(0, 0.4, 0, 0.5, 0.08, 0.48, 'fabricTeal', { ...T, r: 0.035 })
  c.rbox(0, 0.48, -0.23, 0.46, 0.5, 0.07, 'fabricTeal', { ...T, r: 0.035, rx: 0.1 })
}

// ---------------------------------------------------------------------------------------------
// The scan room
// ---------------------------------------------------------------------------------------------

/** The needle-guidance robot's floor-docked base: 1.3 x 0.8 x 0.85 m, a column stub up to the arm's mount (the arm is live). */
function robotBase(D: Frame): void {
  const r = CRYO_SUITE.robot
  const bx = drawn(r.base.at.x)
  const bz = r.base.at.z
  const { w, d, h } = r.size
  const c = D.sub(bx, bz, r.base.heading)
  // the stainless docking plate on the floor, four locking castors, a graphite bumper and the white shell
  c.box(0, 0, 0, w + 0.06, 0.012, d + 0.06, 'frame', T)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.cyl(sx * (w / 2 - 0.12), 0.012, sz * (d / 2 - 0.1), 0.1, 0.09, 'metalDark', T)
  c.rbox(0, 0.08, 0, w, 0.1, d, 'metalDark', { ...T, r: 0.03 })
  c.rbox(0, 0.18, 0, w - 0.04, h - 0.22, d - 0.04, 'whitePlastic', { ...T, r: 0.06 })
  c.rbox(0, h - 0.06, 0, w - 0.1, 0.06, d - 0.1, 'whitePlastic', { ...T, r: 0.03 })
  // the status band round the shell, a push handle on the east end, an E-stop on the top
  for (const s of [-1, 1]) c.box(0, 0.62, s * (d / 2 - 0.012), w - 0.2, 0.025, 0.012, 'glowTeal', T)
  c.rbox(w / 2 + 0.02, 0.78, 0, 0.04, 0.04, 0.5, 'frame', { ...T, r: 0.015 })
  c.cyl(w / 2 - 0.15, h, d / 2 - 0.15, 0.06, 0.03, 'metalDark', T)
  // the column stub up to the mount (y 1.05), where the live arm starts
  const m = r.mount
  D.cyl(drawn(m.x), h - 0.02, m.z, 0.24, m.y - (h - 0.02) - 0.04, 'whitePlastic', T)
  D.cyl(drawn(m.x), m.y - 0.06, m.z, 0.2, 0.06, 'metalDark', T)
  footprint(D, 'l2:cryo:robot')
}

/** The argon cryo console: 0.7 x 1.0 x 1.35 m on castors, a needle-socket panel on its south face, its screen on an arm. */
function argonConsole(D: Frame): void {
  const k = CRYO_SUITE.console
  const cx = drawn(k.at.at.x)
  const cz = k.at.at.z
  const { w, d } = k.size
  const c = D.sub(cx, cz, k.at.heading) // local +z faces south, toward the room
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.cyl(sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 0.08, 0.08, 'metalDark', T)
  c.rbox(0, 0.08, 0, w, 0.95, d, 'whitePlastic', { ...T, r: 0.05 })
  c.rbox(0, 1.03, 0, w - 0.04, 0.05, d - 0.04, 'metalDark', { ...T, r: 0.02 })
  // the needle-socket panel (2 x 10 sockets on a graphite plate) and the four sensor ports under it
  c.box(0, 0.62, d / 2 + 0.006, w - 0.16, 0.3, 0.012, 'metalDark', T)
  c.box(0, 0.94, d / 2 + 0.008, w - 0.2, 0.02, 0.012, 'glowTeal', T)
  for (let i = 0; i < 4; i++) c.cyl(-0.18 + i * 0.12, 0.42, d / 2 + 0.01, 0.04, 0.04, 'frame', { ...T, rx: Math.PI / 2 })
  // the screen arm and the bezel behind the live face
  c.cyl(0, 1.08, d / 2 - 0.2, 0.06, 0.12, 'frame', T)
  bezelBehind(D, k.screen)
  footprint(D, 'l2:cryo:console')
}

/** The gas cart: three argon cylinders and one helium, chained to a frame, hoses to the console. */
function cylinderCart(D: Frame): void {
  const s = CRYO_SUITE.cylinders
  const c = D.sub(drawn(s.at.x), s.at.z, s.heading)
  c.box(0, 0, 0, 0.76, 0.06, 0.56, 'frame', T)
  c.box(0, 0.06, -0.24, 0.76, 1.2, 0.03, 'frame', T)
  for (let i = 0; i < 4; i++) {
    const x = -0.27 + i * 0.18
    c.cyl(x, 0.06, 0.02, 0.17, 1.3, i === 3 ? 'whitePlastic' : 'frame', T)
    c.cyl(x, 1.36, 0.02, 0.06, 0.1, 'metalDark', T)
  }
  c.box(0, 1.0, 0.11, 0.74, 0.02, 0.02, 'metalDark', T) // the chain
  c.box(0, 1.47, 0.02, 0.6, 0.03, 0.03, 'metalDark', T) // the manifold
  footprint(D, 'l2:cryo:cylinders')
}

/** The screen boom south of the table: a ceiling post (walk only), a cross arm and the two bezels behind the live plan and live faces. */
function monitorBoom(D: Frame): void {
  const p = CRYO_SUITE.screens.roomPlan
  const q = CRYO_SUITE.screens.roomLive
  const bx = (drawn(p.x) + drawn(q.x)) / 2
  const bz = p.z + 0.06
  const top = p.y + p.h / 2 + 0.06
  D.cyl(bx, top, bz, 0.12, 3.0 - top, 'linen', { ...T, walkOnly: true })
  D.rbox(bx, top - 0.05, bz, Math.abs(drawn(q.x) - drawn(p.x)) + 0.3, 0.06, 0.06, 'metalDark', { ...T, r: 0.02 })
  bezelBehind(D, p)
  bezelBehind(D, q)
  footprint(D, 'l2:cryo:boom')
}

/** A tall supply cabinet on the south wall: glass doors over a drawer base. */
function supplyCabinet(D: Frame): void {
  const m = mid(rectOf('l2:cryo:cabinet'))
  D.rbox(m.x, 0, m.z, m.w, 0.9, m.d - 0.04, 'whitePlastic', { ...T, r: 0.03 })
  D.rbox(m.x, 0.9, m.z, m.w + 0.02, 0.04, m.d, 'woodOak', { ...T, r: 0.015 })
  D.rbox(m.x, 0.94, m.z + 0.05, m.w, 1.0, m.d - 0.14, 'whitePlastic', { ...T, r: 0.03 })
  D.box(m.x, 1.0, m.z - m.d / 2 + 0.115, m.w - 0.1, 0.88, 0.01, 'glass', T)
  footprint(D, 'l2:cryo:cabinet')
}

function buildScanRoom(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2Cryo'
  const ct = CRYO_SUITE.ct
  // the CT is live (src/scene/cryoSuite): its gantry and the table's pedestal and cradle at `out` are obstacles only
  footprint(D, 'l2:cryo:ct:gantry')
  footprint(D, 'l2:cryo:ct:table')
  D.seat(CRYO_SEATS.table, 'scanTable', drawn(ct.table.out.x), ct.table.out.z, ct.table.height, {
    pose: 'lie',
    ry: ct.table.heading,
    approach: { x: CRYO_TABLE_APPROACH.x + LEVEL2_DX, z: CRYO_TABLE_APPROACH.z },
  })
  robotBase(D)
  argonConsole(D)
  cylinderCart(D)
  monitorBoom(D)
  supplyCabinet(D)
}

// ---------------------------------------------------------------------------------------------
// The control room
// ---------------------------------------------------------------------------------------------

/** A desk under the glass from its footprint, with the bezel of its live screen, a keyboard, and the seat and chair in front of it. */
function controlDesk(D: Frame, id: string, screen: ScreenAnchor, seatId: string, seat: { at: { x: number; z: number }; heading: number }): void {
  const m = mid(rectOf(id))
  D.rbox(m.x, 0.7, m.z, m.w, 0.04, m.d, 'woodOak', { ...T, r: 0.015 })
  for (const s of [-1, 1]) D.rbox(m.x + s * (m.w / 2 - 0.2), 0, m.z, 0.36, 0.7, m.d - 0.06, 'whitePlastic', { ...T, r: 0.02 })
  // the monitor's foot and the bezel behind the live face, a keyboard in front of it
  D.cyl(drawn(screen.x), 0.74, screen.z + 0.08, 0.05, screen.y - screen.h / 2 - 0.74, 'metalDark', T)
  bezelBehind(D, screen)
  D.rbox(drawn(screen.x), 0.74, m.z - 0.12, 0.44, 0.02, 0.14, 'metalDark', { ...T, r: 0.005 })
  footprint(D, id)
  const sx = drawn(seat.at.x)
  officeChair(D, sx, seat.at.z, seat.heading)
  D.seat(seatId, 'console', sx, seat.at.z, CRYO_CONSOLE_SEAT, { ry: seat.heading, prefer: [Math.PI, 2.4, -2.4, Math.PI / 2, -Math.PI / 2] })
}

function buildControlRoom(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2CryoControl'
  controlDesk(D, 'l2:cryoctl:desk', CRYO_SUITE.screens.ctConsole, CRYO_SEATS.ct, CRYO_SUITE.seats.ctConsole)
  controlDesk(D, 'l2:cryoctl:station', CRYO_SUITE.screens.robotStation, CRYO_SEATS.robot, CRYO_SUITE.seats.robotStation)
}

export function buildCryoSuite(b: LayoutBuilder): void {
  const D = b.at(LEVEL2_DX, 0) // drawn x in, sim x out
  buildScanRoom(b, D)
  buildControlRoom(b, D)
}
