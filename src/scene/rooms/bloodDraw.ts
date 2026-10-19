/**
 * W4: the robot blood-draw centre's static room (the `diagnostics` area, x -28..-22, z 2..12). Everything that never moves, as layout prims
 * (palette materials only, merged per material by the building) with footprints and seats:
 *
 *   3 robot cabinets   against corridor B's wall (z 11.43): white, teal band, tube window, two red e-stops, a card reader, an enclosed arm
 *                      tunnel (padded trough under a clear hood, hand grip) on the crowd's ARM_IN line, a 21" screen on an arm, a clear
 *                      riser up to the pneumatic trunk (PNEUMATIC.sources), and the patient chair in front (seat `drawChair:robot:<i>`).
 *   tube-prep machine  BC-ROBO-like, on the west wall: glass hood over a 2 x 4 bank of tube bins in cap colours, printer, wrap station,
 *                      tray outlet (the gripper, the label strip and the trays are animated by src/scene/drawCentre).
 *   waiting bench      three seats on the west wall (`waiting:draw:<i>`).
 *   check-in kiosk     a pedestal with a tilted screen and a ticket slot by the door; the queue screen above the door.
 *   send station       the manual pneumatic inlet in the south-east corner, with its riser.
 *   cubicles + sink    the MRI changing cubicles on the east wall (their anchors are DRAW_CENTRE.cubicles) and the hand-wash counter.
 *
 * The numbers live in src/scene/drawCentre/dims.ts so the animated rig and this room agree. The old two-chair blood-draw corner (R1) is gone.
 */
import { DRAW_CENTRE } from '@/sim/places'
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'
import { LAB_CATALOGUE } from '@/content/lab'
import {
  CABINET,
  CHECKIN,
  PREP,
  PREP_BIN,
  PREP_BIN_KIND,
  PREP_STOPS,
  QUEUE_SCREEN,
  RAIL_Y,
  SCREEN,
  SEAT_HEIGHT,
  SEND,
  TUBE_SLOTS,
  TUNNEL,
  prepBinLocal,
  robotDims,
  type RobotDims,
} from '@/scene/drawCentre/dims'

const HALF_PI = Math.PI / 2
const YELLOW = '#f2c230'
const RED = '#d63a3a'

// ---------------------------------------------------------------------------------------------
// The robots
// ---------------------------------------------------------------------------------------------

/** An emergency stop on the cabinet's front face: a yellow ring and a red mushroom, axis along z. */
function eStop(f: Frame, ex: number, ey: number, zFront: number): void {
  f.cyl(ex, ey - 0.006, zFront - 0.006, 0.085, 0.012, 'tinted', { rx: HALF_PI, color: YELLOW, cast: false })
  f.sphere(ex, ey - 0.03, zFront - 0.026, 0.06, 0.06, 0.036, 'tinted', { color: RED, cast: false })
}

/** The arm tunnel: a collar on the cabinet's face, a padded trough, a clear hood with a hand grip inside, rails under its roof. It starts at the crowd's mouth. */
function tunnel(f: Frame, d: RobotDims): void {
  const a = d.arm
  const zEnd = a.zFront + 0.03
  const len = zEnd - a.zMouth
  const zc = (a.zMouth + zEnd) / 2
  const hoodH = TUNNEL.yTop - TUNNEL.yPad
  // collar where the tunnel leaves the cabinet
  f.rbox(a.x, 0.7, a.zFront - 0.012, 0.37, 0.34, 0.024, 'whitePlastic', { r: 0.03, cast: false })
  // the trough: a white shell with a teal pad (5 mm under the forearm) and two low rails
  f.rbox(a.x, TUNNEL.yBase, zc, 2 * TUNNEL.halfW, TUNNEL.yPad - TUNNEL.yBase, len, 'whitePlastic', { r: 0.03 })
  f.rbox(a.x, TUNNEL.yPadTop - 0.016, zc + 0.02, 0.13, 0.016, len - 0.06, 'fabricTeal', { r: 0.007, cast: false })
  for (const s of [-1, 1]) f.rbox(a.x + s * (TUNNEL.halfW - 0.007), TUNNEL.yPad - 0.01, zc, 0.014, 0.09, len, 'whitePlastic', { r: 0.006, cast: false })
  // the clear hood (a rounded tube of glass) over it
  f.rbox(a.x, TUNNEL.yPad, zc, 2 * TUNNEL.halfW, hoodH, len, 'glass', { r: 0.09 })
  // a frame at the mouth
  f.rbox(a.x, TUNNEL.yTop - 0.018, a.zMouth + 0.01, 2 * TUNNEL.halfW + 0.01, 0.02, 0.02, 'whitePlastic', { r: 0.008, cast: false })
  for (const s of [-1, 1]) f.rbox(a.x + s * TUNNEL.halfW, TUNNEL.yPad, a.zMouth + 0.01, 0.016, hoodH - 0.02, 0.02, 'whitePlastic', { r: 0.006, cast: false })
  // the hand grip (a bar across the palm) on a stub
  const gz = a.zHand + 0.065
  f.cyl(a.x, a.y - 0.02 - 0.05, gz, 0.028, 0.1, 'rubber', { rz: HALF_PI, cast: false })
  f.box(a.x, TUNNEL.yPadTop, gz, 0.02, a.y - 0.02 - TUNNEL.yPadTop, 0.02, 'metalDark', { cast: false })
  // two thin rails under the hood's roof, where the head rides
  const rl = len - 0.06
  for (const s of [-1, 1]) f.cyl(a.x + s * 0.06, RAIL_Y - rl / 2, zc, 0.008, rl, 'frame', { rx: HALF_PI, cast: false })
}

/** The 21 inch screen on an arm over the cabinet (the picture is the rig's live strip). */
function screenArm(f: Frame, d: RobotDims): void {
  const s = d.screen
  const post = s.y - SCREEN.bezelH / 2 - CABINET.h
  f.rbox(s.x, CABINET.h, s.z + 0.03, 0.06, post, 0.04, 'metalDark', { r: 0.01, cast: false })
  f.rbox(s.x, s.y - SCREEN.bezelH / 2, s.z, SCREEN.bezelW, SCREEN.bezelH, SCREEN.thick, 'metalDark', { ry: Math.PI, rx: -SCREEN.lean, r: 0.012, cast: false })
}

/** The pneumatic riser: a clear thin pipe from the cabinet top (PNEUMATIC.sources) to just under the trunk, with a collar at each end. */
/** The patient chair, centred on (x, z), facing +z (the cabinet): a pad, a back that leans away and two fixed arm rests. 0.5 m wide. */
function chair(f: Frame, d: RobotDims): void {
  const c = f.sub(d.chair.x, d.chair.z, 0)
  c.cyl(0, 0, 0, 0.46, 0.05, 'metalDark')
  c.cyl(0, 0.05, 0, 0.07, SEAT_HEIGHT - 0.15 - 0.05, 'metalDark')
  c.rbox(0, SEAT_HEIGHT - 0.1, 0.03, 0.42, 0.1, 0.5, 'fabricTeal', { r: 0.04 })
  c.rbox(0, SEAT_HEIGHT, -0.26, 0.42, 0.52, 0.08, 'fabricTeal', { r: 0.035, rx: -0.12 })
  for (const s of [-1, 1]) {
    c.rbox(s * 0.23, SEAT_HEIGHT + 0.13, 0.02, 0.04, 0.035, 0.36, 'whitePlastic', { r: 0.012 })
    c.box(s * 0.23, SEAT_HEIGHT - 0.1, 0.02, 0.025, 0.23, 0.04, 'metalDark', { cast: false })
  }
  // the patient steps in from the aisle to the left: the approach is beside the chair (its left, +x), clear of the next chair
  c.seat(`drawChair:robot:${d.index}`, 'drawChair', 0, 0, SEAT_HEIGHT, { approach: d.approach })
  f.rect(`draw:robot${d.index}:chair`, d.chair.x, d.chair.z, 0.5, 0.8)
}

function robot(f: Frame, i: number): void {
  const d = robotDims(i)
  const { x, z, zFront } = d
  f.box(x, 0, z, 0.74, CABINET.plinth, 0.54, 'metalDark')
  f.rbox(x, CABINET.plinth, z, CABINET.w, CABINET.h - CABINET.plinth, CABINET.d, 'whitePlastic', { r: 0.045 })
  // the teal band at 0.95 round the front
  f.box(x, CABINET.band - 0.01, zFront - 0.004, CABINET.w - 0.02, 0.03, 0.01, 'fabricTeal', { cast: false })
  // the tube window: a dark frame and panel, and a slot for each of the five tubes (the rig draws the blood in them)
  const wx = x + TUBE_SLOTS.dx
  f.rbox(wx, 0.5, zFront - 0.006, 0.31, 0.34, 0.012, 'metalDark', { r: 0.01, cast: false })
  f.box(wx, 0.52, zFront - 0.0125, 0.29, 0.3, 0.002, 'screen')
  for (let k = 0; k < TUBE_SLOTS.count; k++) {
    f.box(wx + (k - (TUBE_SLOTS.count - 1) / 2) * TUBE_SLOTS.pitch, TUBE_SLOTS.base - 0.012, zFront - 0.0138, TUBE_SLOTS.width + 0.006, TUBE_SLOTS.full + 0.024, 0.002, 'frame', { cast: false })
  }
  // two e-stops at the lower front corners, a card reader under the tunnel
  for (const s of [-1, 1]) eStop(f, x + s * 0.34, 0.4, zFront)
  f.rbox(d.arm.x, 0.55, zFront - 0.006, 0.13, 0.07, 0.012, 'metalDark', { r: 0.008, cast: false })
  f.box(d.arm.x, 0.575, zFront - 0.0135, 0.025, 0.004, 0.002, 'glowTeal', { cast: false })
  tunnel(f, d)
  screenArm(f, d)
  // the tube riser up to the pneumatic trunk is built with the pipe system (src/scene/rooms/pneumatic.ts)
  chair(f, d)
  f.rect(`draw:robot${i}`, x, z, CABINET.w, CABINET.d)
}

// ---------------------------------------------------------------------------------------------
// The tube-prep machine
// ---------------------------------------------------------------------------------------------

function prepMachine(f: Frame): void {
  // the machine frame: local x runs across the front (world -z), local z towards the front (world +x, east)
  const p = f.sub(PREP.cx, PREP.cz, HALF_PI)
  const hd = PREP.d / 2
  const hw = PREP.w / 2
  p.box(0, 0, 0, 0.56, 0.06, 0.7, 'metalDark')
  p.rbox(0, 0.06, 0, PREP.w, PREP.deck - 0.06, PREP.d, 'whitePlastic', { r: 0.03 })
  p.box(0, 0.7, hd - 0.004, PREP.w - 0.02, 0.025, 0.01, 'fabricTeal', { cast: false })
  for (let k = 0; k < 3; k++) p.box(-0.17, 0.12 + k * 0.03, hd - 0.003, 0.2, 0.012, 0.008, 'metalDark', { cast: false })
  // the small display (tile `tubePrep`) in its bezel
  p.rbox(0, 0.52 - 0.1075 - 0.012, hd - 0.003, 0.33, 0.2175, 0.012, 'metalDark', { r: 0.008, cast: false })
  // the working deck under the hood: back panel against the wall, four corner posts, a roof
  p.box(0, PREP.deck, -hd + 0.012, PREP.w - 0.04, PREP.roof - PREP.deck, 0.024, 'whitePlastic')
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(sx * (hw - 0.015), PREP.deck, sz * (hd - 0.015), 0.025, PREP.roof - PREP.deck, 0.025, 'frame', { cast: false })
  // a clear roof in a white frame, so the bins and the gripper show from above (the overview looks down on it)
  p.box(0, PREP.roof, 0, PREP.w, PREP.h - PREP.roof, PREP.d, 'glass')
  for (const sx of [-1, 1]) p.box(sx * (hw - 0.0075), PREP.roof, 0, 0.015, PREP.h - PREP.roof, PREP.d, 'whitePlastic', { cast: false })
  for (const sz of [-1, 1]) p.box(0, PREP.roof, sz * (hd - 0.0075), PREP.w - 0.03, PREP.h - PREP.roof, 0.015, 'whitePlastic', { cast: false })
  p.rbox(0, PREP.deck, 0.01, PREP.w - 0.03, PREP.roof - PREP.deck, PREP.d - 0.04, 'glass', { r: 0.02 })
  // the bank of tube bins: 2 rows of 4, one cap colour each
  for (let i = 0; i < PREP_BIN_KIND.length; i++) {
    const b = prepBinLocal(i)
    p.box(b.lx, PREP.deck, b.lz, PREP_BIN.size + 0.02, 0.02, PREP_BIN.size + 0.02, 'metalDark', { cast: false })
    p.rbox(b.lx, PREP_BIN.y0, b.lz, PREP_BIN.size, PREP_BIN.top - PREP_BIN.y0, PREP_BIN.size, 'tinted', { r: 0.012, color: LAB_CATALOGUE.tubes[PREP_BIN_KIND[i]].hex, cast: false })
  }
  // the label printer (its strip is the rig's glow) and the wrap station's two rollers
  const pr = PREP_STOPS.printer
  p.rbox(pr.lx, PREP.deck, pr.lz, 0.2, 0.1, 0.11, 'metalDark', { r: 0.01, cast: false })
  const wr = PREP_STOPS.wrap
  for (const s of [-1, 1]) p.cyl(wr.lx + s * 0.022, PREP.deck, wr.lz, 0.026, 0.12, 'metalDark', { cast: false })
  // the gripper's rails (a world-frame cylinder along world x: local z)
  const rl = 0.63
  for (const s of [-1, 1]) {
    const w = { x: PREP.cx - 0.015, z: PREP.cz - s * (hw - 0.03) }
    f.cyl(w.x, PREP_STOPS.yBeam + 0.012 - rl / 2, w.z, 0.012, rl, 'frame', { rz: HALF_PI, cast: false })
  }
  // the tray outlet on the front: a shelf with side plates, at the contract's tray point
  const lz = PREP.tray.x - PREP.cx
  p.rbox(0, 0.915, lz, 0.26, 0.015, 0.12, 'metalDark', { r: 0.004, cast: false })
  for (const s of [-1, 1]) p.box(s * 0.135, 0.915, lz, 0.01, 0.07, 0.12, 'frame', { cast: false })
  f.rect('draw:prep', (PREP.cx - hd + PREP.tray.x + 0.06) / 2, PREP.cz, PREP.tray.x + 0.06 - (PREP.cx - hd), PREP.w)
}

// ---------------------------------------------------------------------------------------------
// Bench, check-in, queue screen, send station
// ---------------------------------------------------------------------------------------------

function bench(f: Frame): void {
  const seats = DRAW_CENTRE.bench
  const x = seats[0].at.x
  const zs = seats.map((s) => s.at.z)
  const pitch = zs[1] - zs[0]
  const len = zs[zs.length - 1] - zs[0] + pitch
  const cz = (zs[0] + zs[zs.length - 1]) / 2
  f.rbox(x - 0.03, 0.3, cz, 0.44, 0.07, len, 'fabricTeal', { r: 0.03 })
  f.rbox(x - 0.3, 0.34, cz, 0.06, 0.4, len, 'fabricTeal', { r: 0.025 })
  for (const e of [-1, 1]) f.box(x - 0.03, 0, cz + e * (len / 2 - 0.05), 0.4, 0.3, 0.04, 'metalDark')
  seats.forEach((s, i) => f.seat(`waiting:draw:${i}`, 'waiting', s.at.x, s.at.z, 0.37, { ry: s.heading }))
  f.rect('draw:bench', x - 0.045, cz, 0.58, len + 0.04)
}

function checkIn(f: Frame): void {
  const c = DRAW_CENTRE.checkIn.device
  f.box(c.x, 0, c.z, 0.46, 0.05, 0.36, 'metalDark')
  f.rbox(c.x, 0.05, c.z, CHECKIN.w, 0.76, CHECKIN.d, 'whitePlastic', { r: 0.04 })
  const h = CHECKIN.head
  f.rbox(c.x, h.y - h.h / 2, c.z + h.dz, h.w, h.h, h.t, 'metalDark', { rx: -CHECKIN.lean, r: 0.015, cast: false })
  // the ticket slot, a card reader pad and a teal dot (the slot's glow is the rig's)
  f.rbox(c.x + 0.1, CHECKIN.slotY - 0.01, c.z + CHECKIN.d / 2 + 0.002, 0.16, 0.026, 0.01, 'metalDark', { r: 0.006, cast: false })
  f.rbox(c.x - 0.12, CHECKIN.slotY - 0.03, c.z + CHECKIN.d / 2 + 0.002, 0.11, 0.07, 0.01, 'metalDark', { r: 0.008, cast: false })
  f.box(c.x - 0.12, CHECKIN.slotY - 0.004, c.z + CHECKIN.d / 2 + 0.008, 0.02, 0.004, 0.002, 'glowTeal', { cast: false })
  f.rect('draw:checkin', c.x, c.z, CHECKIN.w, CHECKIN.d)
}

/** The bezel of the queue screen above the door (the picture is atlas tile `drawQueue`). Overhead: it needs no footprint. */
function queueScreen(f: Frame): void {
  const q = DRAW_CENTRE.queueScreen
  f.rbox(q.x, q.y - QUEUE_SCREEN.h / 2 - QUEUE_SCREEN.bezel, q.z + 0.002, QUEUE_SCREEN.w + 2 * QUEUE_SCREEN.bezel, QUEUE_SCREEN.h + 2 * QUEUE_SCREEN.bezel, 0.03, 'metalDark', { r: 0.012, cast: false })
}

/** The manual send station: the nurse puts the tubes she drew by hand into its inlet. A wall-hung box with a screen, a round inlet and a riser. */
function sendStation(f: Frame): void {
  const s = DRAW_CENTRE.manualSend
  f.rbox(s.x, SEND.y0, s.z, SEND.w, SEND.y1 - SEND.y0, SEND.d, 'whitePlastic', { r: 0.03 })
  for (const k of [-1, 1]) f.box(s.x + k * 0.15, 0.8, s.z + 0.04, 0.03, SEND.y0 - 0.8, 0.06, 'metalDark', { cast: false })
  const zf = s.z - SEND.d / 2
  // the inlet: a dark mouth and a frame ring (the glowing ring is the rig's)
  f.cyl(s.x, SEND.inletY - 0.0035, zf - 0.002, 0.1, 0.007, 'metalDark', { rx: HALF_PI, cast: false })
  f.torus(s.x, SEND.inletY - 0.07, zf - 0.006, 0.12, 0.012, 'frame', { rx: HALF_PI, cast: false })
  f.rbox(s.x, SEND.screenY - SEND.screenH / 2 - 0.0125, zf - 0.003, SEND.screenW + 0.025, SEND.screenH + 0.025, 0.012, 'metalDark', { r: 0.008, cast: false })
  // its riser up to the trunk (from PNEUMATIC.sources[3]): src/scene/rooms/pneumatic.ts
  f.rect('draw:send', s.x, s.z, SEND.w, SEND.d)
}

// ---------------------------------------------------------------------------------------------
// The changing cubicles and the sink (moved here from imaging.ts; the cubicle anchors are DRAW_CENTRE.cubicles)
// ---------------------------------------------------------------------------------------------

/**
 * Three changing cubicles along the east wall: partitions, a bench and hooks in each, a curtain rail and a curtain each. Footprints are the
 * four partitions and the three benches, not the whole block: the patient stands IN the cubicle (DRAW_CENTRE.cubicles[i].at) and walks
 * in from the approach spot 1.2 m west of it.
 */
function cubicles(f: Frame): void {
  const xFront = -23.45
  const xWall = -22.15
  const depth = xWall - xFront
  const cxm = (xFront + xWall) / 2
  const z0 = 3.9
  const pitch = 1.4
  const n = 3
  for (let k = 0; k <= n; k++) {
    f.box(cxm, 0, z0 + k * pitch, depth, 1.9, 0.04, 'whitePlastic')
    f.rect(`imaging:cubicles:part${k}`, cxm, z0 + k * pitch, depth, 0.04)
  }
  f.box(xFront + 0.02, 1.94, z0 + (n * pitch) / 2, 0.04, 0.03, n * pitch, 'frame', { cast: false }) // curtain rail
  for (let k = 0; k < n; k++) {
    const zc = z0 + (k + 0.5) * pitch
    f.rbox(xWall - 0.15, 0, zc, 0.26, 0.45, 1.0, 'woodOak', { r: 0.03 }) // bench
    f.rect(`imaging:cubicles:bench${k}`, xWall - 0.15, zc, 0.26, 1.0)
    f.box(xWall - 0.01, 1.5, zc, 0.03, 0.04, 1.0, 'frame', { cast: false }) // hook rail
    f.rbox(xWall - 0.15, 0.45, zc + 0.15, 0.22, 0.07, 0.34, 'linen', { r: 0.03 }) // a folded gown
  }
  // curtains: the first cubicle is closed (occupied), the second half drawn, the third open with the curtain gathered
  f.box(xFront + 0.02, 0.1, z0 + 0.5 * pitch, 0.03, 1.84, pitch - 0.08, 'fabricSage')
  f.box(xFront + 0.02, 0.1, z0 + pitch + 0.32, 0.03, 1.84, 0.7, 'fabricSage')
  f.box(xFront + 0.02, 0.1, z0 + 2 * pitch + 0.13, 0.08, 1.84, 0.2, 'fabricSage')
}

function sinkCounter(f: Frame): void {
  // by the door: hand washing on the way in, and the paper towels and gloves
  f.rbox(-27.63, 0, 4.6, 0.54, 0.88, 1.8, 'whitePlastic', { r: 0.03 })
  f.rbox(-27.63, 0.88, 4.6, 0.55, 0.04, 1.82, 'woodOak', { r: 0.02 })
  f.rbox(-27.6, 0.9, 4.2, 0.4, 0.015, 0.36, 'frame', { r: 0.01, cast: false })
  f.cyl(-27.8, 0.9, 4.2, 0.03, 0.25, 'frame', { cast: false })
  f.rbox(-27.8, 1.2, 5.2, 0.12, 0.28, 0.2, 'whitePlastic', { r: 0.03 })
  f.rbox(-27.8, 1.2, 5.55, 0.1, 0.16, 0.16, 'tinted', { r: 0.03, color: '#7fc4e8', cast: false })
  f.rect('imaging:sink', -27.63, 4.6, 0.54, 1.8)
}

// ---------------------------------------------------------------------------------------------

export function buildDrawCentre(b: LayoutBuilder): void {
  b.area = 'diagnostics'
  const w = b.world
  for (let i = 0; i < DRAW_CENTRE.robots.length; i++) robot(w, i)
  prepMachine(w)
  bench(w)
  checkIn(w)
  queueScreen(w)
  sendStation(w)
  cubicles(w)
  sinkCounter(w)
}
