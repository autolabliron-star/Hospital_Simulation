/**
 * R2 (agent O): the robotic OR's static furniture, in sim coordinates (places.ts SURGERY), written in DRAWN x through one frame at sim x = drawn + LEVEL2_DX like
 * the shell next door (shell.ts). The OR is drawn x -53..-44, z 2..10 (72 m^2): the table in the middle with its head north, the patient cart docking from the
 * west, the two surgeon consoles on the east side south of the viewing window, the vision cart in the north-west corner, the anaesthesia machine at the head
 * end, the back table and the Mayo stand at the foot, the circulator's standing desk by the door, and over it all the ceiling's lights, pendant and boom.
 *
 *   orTable:0                  the table (seat kind 'orTable', pose 'lie', head north), top at SURGERY.table.height
 *   console:or:surgeon / teach the two consoles' chairs (kind 'console', pose 'sit', facing west to the viewer); the hand controllers stand at
 *                              armIn.ts CONSOLE_HANDS above the seat and the viewer's hood in front of the face
 *   console:or:anaes           the anaesthetist's stool (kind 'console', pose 'sit')
 *
 * Draw calls: every prim uses a material the level-2 shell already merges (so the furniture adds none), except the ceiling items, which are `walkOnly` (the
 * overview's cut-away would be hidden by them) and all on `linen`, the one white the shell does not use: ONE more mesh. The screens are not here: the live
 * endoscope screens and the status tiles are the scene layer's (src/scene/surgery), at the anchors of surgery/dims.ts; this file draws their dark bezels.
 *
 * Keep-clear rules: every footprint stays half a wall inside the OR and 0.35 m from the nav routes (the layout tests judge both); the cart's drive path from
 * its parking bay to the dock, the table's approach, the standing spots of the team and the door's front stay free (or.test.ts). The seats' approach spots
 * are set by hand (surgery/dims.ts OR_APPROACH): the builder's own search would put them behind the consoles, against the wall.
 */
import { LEVEL2_DX } from '@/sim/levels'
import { SURGERY } from '@/sim/places'
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'
import type { MatKey } from '@/scene/building/layout/types'
import { BEZEL, CONSOLE_HEADING, CONSOLE_PARTS, CONSOLES, KIT_SCREENS, LIGHTS, LIVE_SCREENS, OR_APPROACH, SEAT_HEIGHT, VISION_HEADING } from '@/scene/surgery/dims'

/** A sim x as a drawn x. */
const drawn = (simX: number): number => simX - LEVEL2_DX

/** The OR's walls' inner faces (drawn), for the room's own checks. */
export const OR_ROOM = { x0: -52.9, x1: -44.1, z0: 2.1, z1: 9.9 } as const

const T = { cast: false } as const

/** A box from bounds (local x0..x1, y0..y1, z0..z1). */
function bx(f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: MatKey): void {
  f.box((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, mat, T)
}

/** A soft-cornered box from bounds. */
function rb(f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: MatKey, r = 0.025): void {
  f.rbox((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, mat, { ...T, r })
}

/** A vertical cylinder at (x, z), diameter d, from y0 to y1. */
function cy(f: Frame, x: number, z: number, d: number, y0: number, y1: number, mat: MatKey): void {
  f.cyl(x, y0, z, d, y1 - y0, mat, T)
}

/** A cylinder lying along the frame's z (a grip, a handle), centred at (x, y, z), `len` long. */
function lying(f: Frame, x: number, y: number, z: number, d: number, len: number, mat: MatKey): void {
  // a vertical cylinder turned onto its side about x: `cyl` takes the bottom, so its centre is y + len / 2 before the turn
  f.cyl(x, y - len / 2, z, d, len, mat, { ...T, rx: Math.PI / 2 })
}

/**
 * A dark bezel for a screen that is anchored by its quad's centre and normal: the bezel sits just behind the quad (BEZEL / 2 + 3 mm), facing the same way, in
 * the frame `f` (world heading `ry` of the screen relative to the frame, lean back `lean`).
 */
function bezelBehind(f: Frame, qx: number, qy: number, qz: number, w: number, h: number, ry: number, lean: number): void {
  const t = BEZEL - 0.01
  const k = t / 2 + 0.003
  const nx = Math.sin(ry) * Math.cos(lean)
  const nz = Math.cos(ry) * Math.cos(lean)
  f.rbox(qx - nx * k, qy - Math.sin(lean) * k - h / 2, qz - nz * k, w + 0.03, h + 0.03, t, 'metalDark', { ...T, ry, rx: -lean, r: 0.01 })
}

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

function buildTable(D: Frame): void {
  const t = SURGERY.table
  const c = D.sub(drawn(t.at.x), t.at.z, t.heading) // +z runs from the head (north) to the feet
  // the base, the column and its housing, the platform and the pad (top at the contract's 0.88 m), a rail down each side
  rb(c, -0.3, 0.3, 0, 0.07, -0.28, 0.68, 'metalDark', 0.03)
  cy(c, 0, 0.2, 0.22, 0.07, 0.62, 'frame')
  rb(c, -0.18, 0.18, 0.62, 0.8, -0.05, 0.45, 'whitePlastic', 0.04)
  rb(c, -0.25, 0.25, 0.8, 0.84, -1.0, 1.0, 'frame', 0.012)
  rb(c, -0.25, 0.25, 0.83, t.height, -0.98, 0.98, 'fabricTeal', 0.02)
  for (const s of [-1, 1]) rb(c, s * 0.265 - 0.01, s * 0.265 + 0.01, 0.79, 0.84, -0.95, 0.95, 'frame', 0.008)
  c.rect('l2:or:table', 0, 0, 0.62, 2.08)
  // the head end is north (heading 0: the seat's heading runs from the head toward the feet, +z)
  D.seat('orTable:0', 'orTable', drawn(t.at.x), t.at.z, t.height, { pose: 'lie', ry: t.heading, approach: t.approach })
}

// ---------------------------------------------------------------------------------------------
// The surgeon's consoles
// ---------------------------------------------------------------------------------------------

/**
 * One console, in a frame whose +z runs east (toward the seat): the plinth and body, the tall back with the viewer's hood and its cushioned face, the arm rest and
 * the two hand controllers at CONSOLE_HANDS above the seat, the foot pedals on the floor, and the status panel on top. Then the chair.
 */
function buildConsole(D: Frame, which: (typeof CONSOLES)[number], statusAnchor: (typeof KIT_SCREENS)['consoleSurgeon']): void {
  const c = D.sub(drawn(which.centre.x), which.centre.z, CONSOLE_HEADING)
  rb(c, -0.45, 0.45, 0, 0.12, -0.4, 0.4, 'metalDark', 0.03)
  rb(c, -0.485, 0.485, 0.12, 0.72, -0.43, 0.34, 'whitePlastic', 0.05)
  rb(c, -0.485, 0.485, 0.72, 1.6, -0.43, -0.12, 'whitePlastic', 0.05)
  // the viewer: a dark hood out of the tall back, a cushioned face, and the opening (the live screen is the scene layer's)
  rb(c, -0.24, 0.24, 1.05, 1.5, -0.12, CONSOLE_PARTS.hoodFace - 0.05, 'metalDark', 0.04)
  rb(c, -0.19, 0.19, 1.1, 1.44, CONSOLE_PARTS.hoodFace - 0.06, CONSOLE_PARTS.hoodFace, 'fabricTeal', 0.025)
  // the arm rest across the front, and a control bay below it
  rb(c, -0.4, 0.4, 0.62, 0.7, 0.3, 0.56, 'fabricTeal', 0.03)
  rb(c, -0.4, 0.4, 0.3, 0.6, 0.34, 0.4, 'frame', 0.02)
  // the hand controllers, where the crowd's console pose puts the hands (CONSOLE_HANDS: 0.2 either side, 0.4 ahead of the seat, 0.34 above it)
  for (const s of [-1, 1]) {
    rb(c, s * 0.2 - 0.025, s * 0.2 + 0.025, 0.72, 0.76, 0.4, 0.5, 'metalDark', 0.012)
    lying(c, s * 0.2, CONSOLE_PARTS.controllerY, CONSOLE_PARTS.controllerZ, 0.045, 0.13, 'frame')
    c.sphere(s * 0.2, CONSOLE_PARTS.controllerY - 0.03, CONSOLE_PARTS.controllerZ + 0.07, 0.07, 0.06, 0.07, 'metalDark', T)
  }
  // the pedals: a low tray on the floor under the surgeon's feet, five pedals on it
  rb(c, -0.28, 0.28, 0, 0.04, 0.5, 0.78, 'metalDark', 0.012)
  for (let i = 0; i < 5; i++) rb(c, -0.24 + i * 0.12 - 0.04, -0.24 + i * 0.12 + 0.04, 0.04, 0.07, 0.56, 0.7, 'frame', 0.01)
  // the status panel on top of the tower, leaning back
  const a = statusAnchor
  bezelBehind(c, 0, CONSOLE_PARTS.statusY, CONSOLE_PARTS.statusZ, a.w, a.h, 0, CONSOLE_PARTS.statusTilt)
  cy(c, 0, -0.03, 0.06, 1.6, 1.66, 'metalDark')
  // footprint: the body's floor space. It is 0.88 wide (the body is 0.97 with its rounded shoulders and the plinth narrower still), so the walkway between the two
  // consoles (0.82 m) is wide enough for the nav's 0.25 m grid to find a row with 0.35 m on each side: that walkway is the only way to the chairs. The
  // controllers and the pedals stand 0.1 to 0.35 m beyond the body, low and in front of the chair, and are not in it.
  c.rect(`l2:or:console:${which.id}`, 0, 0, 0.88, 0.86)

  const s = D.sub(drawn(which.seatAt.x), which.seatAt.z, -Math.PI / 2) // +z runs west, toward the console
  cy(s, 0, 0, 0.48, 0.06, 0.1, 'metalDark')
  cy(s, 0, 0, 0.06, 0.1, 0.38, 'frame')
  rb(s, -0.23, 0.23, 0.37, SEAT_HEIGHT.console, -0.22, 0.22, 'fabricTeal', 0.04)
  rb(s, -0.22, 0.22, 0.45, 0.95, -0.26, -0.2, 'fabricTeal', 0.04)
  for (const side of [-1, 1]) rb(s, side * 0.27 - 0.025, side * 0.27 + 0.025, 0.6, 0.64, -0.2, 0.12, 'metalDark', 0.012)
  s.circle(`l2:or:console:${which.id}:chair`, 0, 0, 0.28)
  s.seat(which.seat, 'console', 0, 0, SEAT_HEIGHT.console, { pose: 'sit', ry: 0, approach: OR_APPROACH.consoles })
}

// ---------------------------------------------------------------------------------------------
// Vision cart, anaesthesia, back table, Mayo stand, circulator's desk, wall monitor
// ---------------------------------------------------------------------------------------------

/** The vision cart: a tower with the 3D monitor on an arm, the insufflator and the video units on their shelves, a status line. */
function buildVisionCart(D: Frame): void {
  const at = SURGERY.visionCart.at
  const c = D.sub(drawn(at.x), at.z, VISION_HEADING)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cy(c, sx * 0.27, sz * 0.36, 0.08, 0, 0.08, 'metalDark')
  rb(c, -0.31, 0.31, 0.08, 0.16, -0.43, 0.43, 'metalDark', 0.02)
  rb(c, -0.3, 0.3, 0.16, 0.78, -0.42, 0.38, 'whitePlastic', 0.03)
  for (const y of [0.3, 0.46]) bx(c, -0.26, 0.26, y, y + 0.012, 0.378, 0.382, 'frame')
  bx(c, -0.2, 0.2, 0.62, 0.636, 0.378, 0.384, 'glowTeal')
  rb(c, -0.23, 0.23, 0.78, 1.4, -0.35, -0.05, 'whitePlastic', 0.03)
  // the monitor arm and the bezel (the live screen is the scene layer's: LIVE_SCREENS[0])
  rb(c, -0.05, 0.05, 1.36, 1.42, -0.06, 0.1, 'metalDark', 0.012)
  const a = LIVE_SCREENS[0]
  const k = 0.124
  bezelBehind(c, 0, a.at.y, k, a.w, a.h, 0, a.tilt ?? 0)
  rb(c, -0.14, 0.14, 1.05, 1.1, -0.38, -0.34, 'metalDark', 0.01)
  c.rect('l2:or:vision', 0, 0, 0.68, 0.93)
}

/** The anaesthesia machine: a cabinet with drawers, a work surface with the ventilator and a vaporiser, and a tower with the monitor, turned to the table's head. */
function buildAnaesthesia(D: Frame): void {
  const m = SURGERY.anaesthesia.machine.at
  const c = D.sub(drawn(m.x), m.z, 0)
  rb(c, -0.29, 0.29, 0, 0.14, -0.35, 0.35, 'metalDark', 0.02)
  rb(c, -0.3, 0.3, 0.14, 0.78, -0.37, 0.37, 'whitePlastic', 0.03)
  for (let i = 0; i < 3; i++) bx(c, -0.26, 0.26, 0.28 + i * 0.16, 0.292 + i * 0.16, 0.37, 0.374, 'frame')
  rb(c, -0.32, 0.32, 0.78, 0.82, -0.39, 0.39, 'frame', 0.012)
  rb(c, -0.3, 0.3, 0.82, 1.52, -0.32, 0.1, 'whitePlastic', 0.03)
  rb(c, -0.22, -0.04, 0.82, 1.04, 0.1, 0.32, 'metalDark', 0.02)
  cy(c, 0.15, 0.22, 0.12, 0.82, 1.04, 'frame')
  cy(c, 0.15, 0.22, 0.09, 1.04, 1.08, 'metalDark')
  rb(c, -0.05, 0.05, 1.28, 1.36, 0.1, 0.13, 'metalDark', 0.01)
  const a = KIT_SCREENS.anaesthesia
  bezelBehind(c, 0, a.at.y, a.at.z - m.z, a.w, a.h, a.heading, a.tilt ?? 0)
  c.rect('l2:or:anaesthesia', 0, 0, 0.64, 0.78)
}

/** The anaesthetist's stool: a round seat with a low back on a column, at the head of the table. */
function buildStool(D: Frame): void {
  const st = SURGERY.anaesthesia.stool
  const c = D.sub(drawn(st.at.x), st.at.z, st.heading)
  cy(c, 0, 0, 0.46, 0.05, 0.09, 'metalDark')
  cy(c, 0, 0, 0.05, 0.09, 0.5, 'frame')
  cy(c, 0, 0, 0.34, 0.5, SEAT_HEIGHT.stool, 'fabricTeal')
  rb(c, -0.14, 0.14, 0.62, 0.78, -0.2, -0.16, 'fabricTeal', 0.03)
  c.circle('l2:or:stool', 0, 0, 0.25)
  c.seat('console:or:anaes', 'console', 0, 0, SEAT_HEIGHT.stool, { pose: 'sit', ry: 0, approach: OR_APPROACH.stool })
}

/** The back table: a stainless top under a sterile cover with the instrument trays laid out on it. */
function buildBackTable(D: Frame): void {
  const b = SURGERY.backTable
  const c = D.sub(drawn(b.at.x), b.at.z, b.heading)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cy(c, sx * (b.w / 2 - 0.04), sz * (b.l / 2 - 0.04), 0.04, 0, 0.86, 'frame')
  rb(c, -b.w / 2, b.w / 2, 0.86, 0.89, -b.l / 2, b.l / 2, 'frame', 0.012)
  bx(c, -b.w / 2 + 0.04, b.w / 2 - 0.04, 0.25, 0.27, -b.l / 2 + 0.04, b.l / 2 - 0.04, 'frame')
  rb(c, -0.34, 0.34, 0.89, 0.9, -0.7, 0.7, 'fabricTeal', 0.004)
  // trays and sets
  rb(c, -0.3, -0.02, 0.9, 0.925, -0.62, -0.18, 'metalDark', 0.01)
  rb(c, 0.02, 0.3, 0.9, 0.93, -0.6, -0.1, 'frame', 0.01)
  rb(c, -0.3, -0.04, 0.9, 0.94, 0.0, 0.38, 'whitePlastic', 0.02)
  rb(c, 0.04, 0.3, 0.9, 0.92, 0.1, 0.62, 'metalDark', 0.01)
  for (let i = 0; i < 4; i++) rb(c, -0.26 + i * 0.065, -0.21 + i * 0.065, 0.925, 0.935, -0.58, -0.28, 'frame', 0.004)
  // the footprint is the table's stance, 7.5 cm narrower than its top (which overhangs a little), all taken off the east side: that leaves the walkway between the
  // consoles and the back table (0.92 m) wide enough for the nav's 0.25 m grid to find a way out of the pocket between the two consoles' chairs
  c.rect('l2:or:backtable', -0.0375, 0, b.w - 0.075, b.l)
}

/** The Mayo stand: a tray on a column over a small base, under a sterile cover, a few instruments on it. */
function buildMayo(D: Frame): void {
  const m = SURGERY.mayo.at
  const c = D.sub(drawn(m.x), m.z, 0)
  rb(c, -0.25, 0.25, 0, 0.04, -0.3, 0.3, 'frame', 0.012)
  cy(c, 0, 0, 0.05, 0.04, 0.94, 'frame')
  rb(c, -0.25, 0.25, 0.94, 0.955, -0.15, 0.23, 'frame', 0.006)
  rb(c, -0.23, 0.23, 0.955, 0.962, -0.13, 0.21, 'fabricTeal', 0.003)
  rb(c, -0.16, 0.0, 0.962, 0.972, -0.08, 0.14, 'metalDark', 0.004)
  rb(c, 0.04, 0.2, 0.962, 0.97, -0.1, 0.12, 'frame', 0.004)
  c.rect('l2:or:mayo', 0, 0, 0.52, 0.62)
}

/** The circulator's standing desk against the north wall, with a monitor on a stand, a keyboard and a phone. */
function buildDesk(D: Frame): void {
  const d = SURGERY.circulatorDesk.at
  const cz = 2.36
  const c = D.sub(drawn(d.x), cz, 0)
  rb(c, -0.7, 0.7, 0, 0.96, -0.21, 0.21, 'whitePlastic', 0.03)
  rb(c, -0.73, 0.73, 0.96, 1.0, -0.23, 0.23, 'woodOak', 0.012)
  for (let i = 0; i < 3; i++) bx(c, -0.6 + i * 0.4, -0.25 + i * 0.4, 0.5, 0.512, 0.21, 0.214, 'frame')
  cy(c, 0, -0.08, 0.05, 1.0, 1.2, 'metalDark')
  const a = KIT_SCREENS.circulator
  bezelBehind(c, 0, a.at.y, a.at.z - cz, a.w, a.h, 0, a.tilt ?? 0)
  rb(c, -0.2, 0.2, 1.0, 1.015, 0.04, 0.14, 'metalDark', 0.005)
  rb(c, 0.38, 0.52, 1.0, 1.03, 0.0, 0.16, 'whitePlastic', 0.01)
  c.rect('l2:or:desk', 0, 0, 1.46, 0.42)
}

/** The wall monitor on the south wall over the table, and the bezels of the two boards in the rooms next door (their screens are the atlas's). */
function buildScreens(D: Frame): void {
  const w = LIVE_SCREENS[1]
  bezelBehind(D, drawn(w.at.x), w.at.y, w.at.z, w.w, w.h, w.heading, 0)
  const p = KIT_SCREENS.pacuBoard
  bezelBehind(D, drawn(p.at.x), p.at.y, p.at.z, p.w, p.h, p.heading, 0)
  const q = KIT_SCREENS.preOpBoard
  bezelBehind(D, drawn(q.at.x), q.at.y, q.at.z, q.w, q.h, q.heading, 0)
}

// ---------------------------------------------------------------------------------------------
// Floor marks and the ceiling
// ---------------------------------------------------------------------------------------------

/** Teal outlines on the floor: the cart's parking bay and its docking bay beside the table (a plane is flat and receives light, like the floor). */
function buildFloorMarks(D: Frame): void {
  const s = SURGERY.cart.size
  const strip = (x: number, z: number, w: number, d: number): void => {
    D.plane(x, 0.014, z, w, d, 'fabricTeal')
  }
  for (const bay of [SURGERY.cart.park, SURGERY.cart.dock]) {
    // the cart faces +x: its long side runs along x
    const x = drawn(bay.at.x)
    const z = bay.at.z
    const hl = s.l / 2 + 0.1
    const hw = s.w / 2 + 0.1
    const t = 0.04
    strip(x, z - hw, hl * 2, t)
    strip(x, z + hw, hl * 2, t)
    strip(x - hl, z, t, hw * 2)
    strip(x + hl, z, t, hw * 2)
  }
}

/** The ceiling's fittings, all `walkOnly` and on `linen` (one extra mesh): the twin surgical lights on their hub, the anaesthesia pendant, an equipment boom. */
function buildCeiling(D: Frame): void {
  const W = { ...T, walkOnly: true } as const
  const hub = LIGHTS.hub
  const hx = drawn(hub.x)
  D.cyl(hx, 2.82, hub.z, 0.3, 0.18, 'linen', W)
  D.cyl(hx, 2.7, hub.z, 0.1, 0.12, 'linen', W)
  for (const hd of LIGHTS.heads) {
    const x = drawn(hd.x)
    const dx = x - hx
    const dz = hd.z - hub.z
    const len = Math.hypot(dx, dz)
    D.rbox(hx + dx / 2, 2.74, hub.z + dz / 2, 0.07, 0.08, len, 'linen', { ...W, ry: Math.atan2(dx, dz), r: 0.02 })
    D.cyl(x, 2.6, hd.z, LIGHTS.housingDia, 0.1, 'linen', W)
    D.cyl(x, 2.7, hd.z, 0.3, 0.07, 'linen', W)
    D.cyl(x, 2.74, hd.z, 0.1, 0.1, 'linen', W)
  }
  // the anaesthesia pendant: a column from the ceiling and a head with the gas outlets, west of the machine
  D.cyl(-49.5, 1.7, 3.15, 0.16, 1.3, 'linen', W)
  D.rbox(-49.5, 1.7, 3.15, 0.5, 0.34, 0.28, 'linen', { ...W, r: 0.04 })
  D.cyl(-49.35, 1.55, 3.3, 0.06, 0.15, 'linen', W)
  D.cyl(-49.65, 1.55, 3.3, 0.06, 0.15, 'linen', W)
  // an equipment boom on the north-east: a column, a swung arm and a shelf for the video towers
  D.cyl(-46.0, 2.82, 3.7, 0.24, 0.18, 'linen', W)
  D.cyl(-46.0, 2.0, 3.7, 0.14, 0.82, 'linen', W)
  const ax = -46.6 - -46.0
  const az = 4.4 - 3.7
  D.rbox(-46.0 + ax / 2, 2.0, 3.7 + az / 2, 0.1, 0.1, Math.hypot(ax, az), 'linen', { ...W, ry: Math.atan2(ax, az), r: 0.025 })
  D.rbox(-46.6, 1.88, 4.4, 0.6, 0.04, 0.45, 'linen', { ...W, r: 0.015 })
  D.cyl(-46.6, 1.88, 4.4, 0.08, 0.12, 'linen', W)
}

export function buildOperatingRoom(b: LayoutBuilder): void {
  const D = b.at(LEVEL2_DX, 0) // drawn x in, sim x out
  b.area = 'l2Or'
  buildFloorMarks(D)
  buildTable(D)
  buildConsole(D, CONSOLES[0], KIT_SCREENS.consoleSurgeon)
  buildConsole(D, CONSOLES[1], KIT_SCREENS.consoleTeach)
  buildVisionCart(D)
  buildAnaesthesia(D)
  buildStool(D)
  buildBackTable(D)
  buildMayo(D)
  buildDesk(D)
  buildScreens(D)
  buildCeiling(D)
}
