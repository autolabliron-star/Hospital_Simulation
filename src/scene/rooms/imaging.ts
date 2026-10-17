/**
 * The imaging suite (R1): x -40..-22, z -12..12. It replaces the old "Lab & imaging" hall (`diagnostics.ts`).
 *
 *   imaging hall   a 4 m corridor (z -2..2) off the spine door: waiting seats along the walls, a booking desk by the door
 *   MRI + CT       a scan room (z -12..-4.5) behind a control room (z -4.5..-2) each; the wall between them is a full-height
 *                  glass observation window (see walls.ts); a console desk runs under the window with NO monitors (the
 *                  animated machines put live ones at `consoleScreens`)
 *   X-ray          radiography table, wall detector stand, a lead-glass screen and exposure console by the door
 *   ultrasound     a couch and an operator's stool
 *   blood draw     (`diagnostics`) two draw chairs, three changing cubicles with curtains, a sample hatch and a sink
 *
 * What is NOT drawn here: the MRI magnet and table, the CT gantry and table, the X-ray ceiling tube and rails, the ultrasound
 * cart and probe. `src/scene/imaging` (the machines agent) draws those and animates them. They appear here as FOOTPRINT-ONLY
 * obstacles (their full travel, from the table's `out` to its `in` position) so the people's nav and the keep-clear tests
 * route round them, and the MRI/CT `scanTable` seats sit at the loading position with an approach spot beside the table.
 *
 * Everything hugs the walls: the hall's centre line (z = 0) and the door spurs are the people's routes (src/sim/nav/graph.ts).
 */
import { IMAGING, type ScannerAnchors } from '@/sim/places'
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'
import { TILE } from '@/scene/building/layout/screenTiles'

/**
 * Width (z) of the MRI magnet and the CT gantry footprints. The nav's lattice rows north of the machines (z = -10.075) sit
 * 0.375 m from a 2.2 m wide machine's north edge: that is exactly the 0.35 m clearance a route needs to pass between them
 * and the machine, so the strip behind each machine stays connected to the door nodes. A wider footprint would cut it off.
 */
const MACHINE_WIDTH = 2.2

/** Floor markings: a tinted decal just above the floor (same height as the wayfinding lines). */
const DECAL_Y = 0.009
const ZONE_YELLOW = '#f2c230'
const ZONE_MAGENTA = '#c2398f'

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

function plant(f: Frame, id: string, x: number, z: number): void {
  f.cyl(x, 0, z, 0.42, 0.38, 'whitePlastic')
  f.sphere(x, 0.38, z, 0.6, 0.8, 0.6, 'leaf')
  f.sphere(x + 0.1, 0.9, z + 0.05, 0.4, 0.5, 0.4, 'leafDark')
  f.circle(id, x, z, 0.3)
}

/** A swivel chair facing `heading`. Drawn only: see `consoleSeat` for why it has no footprint. */
function officeChair(f: Frame, x: number, z: number, heading: number): void {
  const c = f.sub(x, z, heading)
  c.cyl(0, 0, 0, 0.46, 0.04, 'metalDark')
  c.cyl(0, 0.04, 0, 0.06, 0.36, 'metalDark')
  c.rbox(0, 0.4, 0, 0.5, 0.08, 0.48, 'fabricTeal', { r: 0.035 })
  c.rbox(0, 0.48, -0.23, 0.46, 0.5, 0.07, 'fabricTeal', { r: 0.035, rx: 0.1 })
}

/**
 * The operator's seat at a scanner (`console:<modality>`, kind `console`, pose `sit`) with its chair.
 *
 * The chair is deliberately NOT a nav obstacle. The control room is only 2.5 m deep and the contract puts the operator at
 * z = -3.35, but the nav's way through the room (the door node at z = -3.0, the inner-door node and the lattice node at
 * z = -3.25) runs within 0.2 m of that spot, so no clearance can hold there. It is a light swivel chair, and the seat's own
 * approach node lies on that lane anyway. See the report's change requests.
 */
function consoleSeat(f: Frame, id: string, a: ScannerAnchors, height: number, chair: boolean): void {
  if (chair) officeChair(f, a.operator.at.x, a.operator.at.z, a.operator.heading)
  f.seat(id, 'console', a.operator.at.x, a.operator.at.z, height, { ry: a.operator.heading })
}

/** A bank of waiting seats on a shared beam, facing local +z (as in the lobby). */
function seatRow(f: Frame, id: string, n: number, pitch: number, row: string): void {
  const w = n * pitch
  f.rbox(0, 0.1, 0, w, 0.06, 0.28, 'metalDark', { r: 0.02 })
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * pitch
    f.rbox(x, 0.3, 0.02, pitch - 0.07, 0.07, 0.46, 'fabricTeal', { r: 0.03 })
    f.rbox(x, 0.34, -0.2, pitch - 0.07, 0.38, 0.06, 'fabricTeal', { r: 0.03, rx: 0.1 })
    f.cyl(x, 0, 0, 0.05, 0.3, 'metalDark')
    f.seat(`waiting:imaging:${row}:${i}`, 'waiting', x, 0.02, 0.37)
  }
  f.rect(id, 0, 0, w, 0.55)
}

/** A hollow square of floor tape: outer yellow band and a thin magenta line just inside it. */
function zoneBorder(f: Frame, cx: number, cz: number, half: number): void {
  const band = (hx: number, t: number, color: string): void => {
    f.plane(cx, DECAL_Y, cz - hx + t / 2, 2 * hx, t, 'tinted', { color })
    f.plane(cx, DECAL_Y, cz + hx - t / 2, 2 * hx, t, 'tinted', { color })
    f.plane(cx - hx + t / 2, DECAL_Y, cz, t, 2 * hx - 2 * t, 'tinted', { color })
    f.plane(cx + hx - t / 2, DECAL_Y, cz, t, 2 * hx - 2 * t, 'tinted', { color })
  }
  band(half, 0.14, ZONE_YELLOW)
  band(half - 0.2, 0.05, ZONE_MAGENTA)
}

/** The footprint of a moving scanner table over its whole travel, out to in (`len` is the cradle's length). */
function tableTravel(f: Frame, id: string, a: ScannerAnchors, len: number, width = 0.7): void {
  const x0 = Math.min(a.table.out.x, a.table.in.x) - len / 2
  const x1 = Math.max(a.table.out.x, a.table.in.x) + len / 2
  f.rect(id, (x0 + x1) / 2, a.table.out.z, x1 - x0, width)
}

/**
 * A long console desk under the observation window (window side at `zWin`, the operator sits to the south): a white top,
 * end panels, drawer pedestals and keyboards, NO monitors. Returns nothing; the monitor anchors are added by the caller.
 */
function consoleDesk(f: Frame, id: string, x0: number, x1: number, zWin: number, depth: number, keyboards: number[]): number {
  const len = x1 - x0
  const cx = (x0 + x1) / 2
  const cz = zWin + depth / 2
  f.rbox(cx, 0.7, cz, len, 0.04, depth, 'whitePlastic', { r: 0.015 })
  for (const x of [x0 + 0.03, x1 - 0.03]) f.box(x, 0, cz, 0.05, 0.7, depth - 0.04, 'metalDark')
  f.box(cx, 0.25, zWin + 0.04, len - 0.1, 0.45, 0.02, 'whitePlastic', { cast: false })
  for (const x of [x0 + 0.35, x1 - 0.35]) {
    f.rbox(x, 0.08, cz + 0.02, 0.5, 0.6, depth - 0.1, 'whitePlastic', { r: 0.02 })
    const front = cz + 0.02 + (depth - 0.1) / 2 + 0.004
    f.box(x, 0.48, front, 0.2, 0.025, 0.01, 'metalDark', { cast: false })
    f.box(x, 0.3, front, 0.2, 0.025, 0.01, 'metalDark', { cast: false })
  }
  for (const x of keyboards) {
    f.rbox(x, 0.74, cz + 0.12, 0.42, 0.015, 0.14, 'metalDark', { r: 0.005, cast: false })
    f.rbox(x + 0.3, 0.74, cz + 0.12, 0.06, 0.015, 0.09, 'metalDark', { r: 0.005, cast: false })
  }
  f.rect(id, cx, cz, len, depth)
  return cz
}

/** A tall storage cabinet against a wall; its doors face local heading `heading` (0 = +z, the room is to the south). */
function cabinet(f: Frame, id: string, cx: number, cz: number, w: number, d: number, heading = 0, h = 1.9): void {
  const c = f.sub(cx, cz, heading)
  c.rbox(0, 0, 0, w, h, d, 'whitePlastic', { r: 0.03 })
  c.box(0, 0.05, d / 2 + 0.002, w - 0.08, h - 0.1, 0.008, 'frame', { cast: false })
  c.box(0, 0.05, d / 2 + 0.007, 0.012, h - 0.1, 0.006, 'metalDark', { cast: false })
  for (const s of [-1, 1]) c.box(s * 0.07, 1.0, d / 2 + 0.012, 0.02, 0.14, 0.012, 'metalDark', { cast: false })
  f.rect(id, cx, cz, w, d, { ry: heading })
}

// ---------------------------------------------------------------------------------------------
// The imaging hall
// ---------------------------------------------------------------------------------------------

/** The booking desk by the spine door, on the south wall's west end: visitors stand on its north side. */
function bookingDesk(f: Frame): void {
  const cx = -38.6
  const cz = 1.25
  f.rbox(cx, 0, cz, 2.0, 0.95, 0.55, 'whitePlastic', { r: 0.04 })
  f.rbox(cx, 0.95, cz, 2.12, 0.04, 0.67, 'woodOak', { r: 0.02 })
  // a mint front panel and a glowing name strip toward the visitors (north)
  f.box(cx, 0.22, cz - 0.282, 1.7, 0.5, 0.012, 'wallMint', { cast: false })
  f.box(cx, 0.9, cz - 0.292, 1.4, 0.03, 0.012, 'glowTeal')
  // two screens on the desk, facing the booking clerk (south)
  f.display(cx - 0.5, 1.28, cz + 0.12, 0.5, 0.32, TILE.reception, { ry: 0, lean: 0.3 })
  f.display(cx + 0.5, 1.28, cz + 0.12, 0.5, 0.32, TILE.chart, { ry: 0, lean: 0.3 })
  f.rect('imaging:booking', cx, cz, 2.12, 0.67)
}

function buildHall(b: LayoutBuilder): void {
  b.area = 'imagingHall'
  const w = b.world
  // the north wall's seats lie between the MRI-control and CT-control doors (spurs at x -38.2 and -29.4), the south wall's
  // between the ultrasound and blood-draw doors (spurs at -32.6 and -26.6); both clear of the centre line z = 0
  seatRow(b.at(-35.2, -1.62, 0), 'imaging:seatsN1', 4, 0.62, 'N1')
  seatRow(b.at(-29.9, 1.62, Math.PI), 'imaging:seatsS1', 4, 0.62, 'S1')
  bookingDesk(w)
  plant(w, 'imaging:plantNW', -39.5, -1.4)
  plant(w, 'imaging:plantNE', -22.55, -1.3)
  plant(w, 'imaging:plantSE', -22.55, 1.3)
  // a magazine table on the north wall between the seats and the CT door
  w.rbox(-31.9, 0, -1.65, 0.7, 0.45, 0.3, 'woodOak', { r: 0.03 })
  w.rbox(-31.9, 0.45, -1.65, 0.74, 0.03, 0.34, 'whitePlastic', { r: 0.012 })
  w.rect('imaging:sideTable', -31.9, -1.65, 0.74, 0.34)
}

// ---------------------------------------------------------------------------------------------
// MRI
// ---------------------------------------------------------------------------------------------

/**
 * MR warning sign on a wall face: a yellow plate with a magenta disc (no text: it has to read from the overview).
 * (x, z) is the plate's centre against the wall, `yBottom` its lower edge, `facing` the way the sign looks.
 */
function mriSign(f: Frame, x: number, yBottom: number, z: number, facing: 'west' | 'east' | 'north' | 'south'): void {
  const alongX = facing === 'west' || facing === 'east'
  const s = facing === 'west' || facing === 'north' ? -1 : 1 // which way the sign's face points along its axis
  const yDisc = yBottom + 0.225 - 0.006
  if (alongX) {
    f.box(x, yBottom, z, 0.02, 0.45, 0.45, 'tinted', { color: ZONE_YELLOW, cast: false })
    f.cyl(x + s * 0.016, yDisc, z, 0.26, 0.012, 'tinted', { color: ZONE_MAGENTA, cast: false, rz: Math.PI / 2 })
  } else {
    f.box(x, yBottom, z, 0.45, 0.45, 0.02, 'tinted', { color: ZONE_YELLOW, cast: false })
    f.cyl(x, yDisc, z + s * 0.016, 0.26, 0.012, 'tinted', { color: ZONE_MAGENTA, cast: false, rx: Math.PI / 2 })
  }
}

/** A coil shelf: posts, three oak shelves, a head coil, a knee coil, flex coils and foam pads. */
function coilShelf(f: Frame, id: string, cx: number, cz: number, len: number): void {
  const d = 0.45
  for (const s of [-1, 1]) f.box(cx + s * (len / 2 - 0.03), 0, cz, 0.05, 1.75, d, 'frame')
  for (const y of [0.4, 0.9, 1.4]) f.box(cx, y, cz, len, 0.04, d, 'woodOak')
  f.rbox(cx - 0.65, 0.94, cz, 0.4, 0.3, 0.34, 'whitePlastic', { r: 0.08 }) // head coil
  f.box(cx - 0.65, 1.03, cz + 0.171, 0.26, 0.12, 0.01, 'metalDark', { cast: false })
  f.cyl(cx + 0.05, 0.94, cz, 0.34, 0.3, 'whitePlastic') // knee coil
  f.cyl(cx + 0.05, 1.0, cz, 0.22, 0.24, 'metalDark')
  f.rbox(cx + 0.55, 0.44, cz, 0.5, 0.05, 0.32, 'fabricTeal', { r: 0.02 }) // flex coils
  f.rbox(cx + 0.55, 0.49, cz, 0.46, 0.05, 0.3, 'fabricSage', { r: 0.02 })
  f.rbox(cx - 0.4, 0.44, cz, 0.6, 0.07, 0.34, 'linen', { r: 0.03 }) // foam pads
  f.rbox(cx + 0.2, 1.44, cz, 0.7, 0.12, 0.34, 'linen', { r: 0.04 })
  f.rect(id, cx, cz, len, d)
}

function buildMriControl(b: LayoutBuilder): void {
  b.area = 'mriControl'
  const w = b.world
  const m = IMAGING.mri
  const x = m.operator.at.x
  const cz = consoleDesk(w, 'imaging:mri:console', x - 2.1, x + 2.1, -4.4, 0.62, [x - 0.42, x + 0.42])
  // two monitor anchors on the desk, facing the operator (south); the machines agent draws the live monitors
  w.consoleScreen('mri', x - 0.42, 1.08, cz - 0.12, 0.6, 0.34, 0)
  w.consoleScreen('mri', x + 0.42, 1.08, cz - 0.12, 0.6, 0.34, 0)
  consoleSeat(w, 'console:mri', m, 0.48, true)
  // patient lockers on the west wall: metal stays outside zone IV
  w.rbox(-39.65, 0, -3.4, 0.46, 1.5, 1.9, 'whitePlastic', { r: 0.03 })
  for (let i = 0; i < 5; i++) {
    const z = -4.12 + i * 0.36
    w.box(-39.41, 0.15, z, 0.012, 1.2, 0.32, 'wallMint', { cast: false })
    w.box(-39.4, 0.75, z + 0.1, 0.01, 0.1, 0.02, 'metalDark', { cast: false })
  }
  w.rect('imaging:mri:lockers', -39.65, -3.4, 0.46, 1.9)
}

function buildMriRoom(b: LayoutBuilder): void {
  b.area = 'mri'
  const w = b.world
  const m = IMAGING.mri
  // machine envelopes (footprint only): the magnet, and the table over its whole travel, out to in
  w.rect('imaging:mri:magnet', m.machine.x, m.machine.z, 2.15, MACHINE_WIDTH)
  tableTravel(w, 'imaging:mri:table', m, 2.2)
  // the patient's place on the table at its loading position; no table geometry here (the machines agent draws it)
  w.seat('scanTable:mri', 'scanTable', m.table.out.x, m.table.out.z, m.table.height, {
    pose: 'lie',
    ry: m.table.heading,
    approach: { x: m.assist.at.x, z: m.assist.at.z - 0.55 },
  })
  // zone IV: a square of floor tape round the magnet and its table, and warning signs by the doors
  zoneBorder(w, m.machine.x, m.machine.z, 2.3)
  mriSign(w, -31.112, 0.7, -5.9, 'west') // inside, on the east wall by the inner door
  mriSign(w, -37.1, 0.7, -1.89, 'south') // outside, on the hall wall beside the control-room door
  coilShelf(w, 'imaging:mri:coils', -37.8, -11.675, 2.2)
  cabinet(w, 'imaging:mri:cabinet', -33.4, -11.65, 1.2, 0.5)
}

// ---------------------------------------------------------------------------------------------
// CT
// ---------------------------------------------------------------------------------------------

/** A lead-apron rack against a wall (its aprons face local heading `heading`): two posts, a rail, four aprons and a collar. */
function apronRack(f: Frame, id: string, cx: number, cz: number, len: number, heading = 0): void {
  const d = 0.4
  const c = f.sub(cx, cz, heading)
  for (const s of [-1, 1]) c.box(s * (len / 2 - 0.03), 0, 0, 0.05, 1.7, d, 'frame')
  c.box(0, 1.55, 0, len, 0.04, 0.05, 'frame')
  c.box(0, 0.1, 0, len, 0.04, d, 'metalDark')
  const n = 4
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + 0.3 + (i * (len - 0.6)) / (n - 1)
    c.rbox(x, 0.7, 0, 0.38, 0.85, 0.05, 'fabricTeal', { r: 0.02 })
    c.rbox(x, 0.62, 0.03, 0.34, 0.12, 0.03, 'fabricSage', { r: 0.015 })
  }
  c.rbox(0, 1.3, 0.12, 0.2, 0.2, 0.06, 'fabricSage', { r: 0.03 })
  f.rect(id, cx, cz, len, d, { ry: heading })
}

function buildCtControl(b: LayoutBuilder): void {
  b.area = 'ctControl'
  const w = b.world
  const c = IMAGING.ct
  const x = c.operator.at.x
  const cz = consoleDesk(w, 'imaging:ct:console', x - 2.9, x + 2.9, -4.4, 0.62, [x - 0.42, x + 0.42])
  w.consoleScreen('ct', x - 0.42, 1.08, cz - 0.12, 0.6, 0.34, 0)
  w.consoleScreen('ct', x + 0.42, 1.08, cz - 0.12, 0.6, 0.34, 0)
  consoleSeat(w, 'console:ct', c, 0.48, true)
  // a printer and supplies cabinet on the hall wall
  w.rbox(-25.4, 0, -2.36, 1.2, 0.85, 0.5, 'whitePlastic', { r: 0.03 })
  w.rbox(-25.4, 0.85, -2.36, 1.22, 0.04, 0.52, 'woodOak', { r: 0.015 })
  w.rbox(-25.5, 0.89, -2.36, 0.5, 0.2, 0.36, 'whitePlastic', { r: 0.03 })
  w.box(-25.5, 1.0, -2.17, 0.3, 0.03, 0.01, 'glowTeal', { cast: false })
  w.rect('imaging:ct:cabinet', -25.4, -2.36, 1.2, 0.5)
}

function buildCtRoom(b: LayoutBuilder): void {
  b.area = 'ct'
  const w = b.world
  const c = IMAGING.ct
  w.rect('imaging:ct:gantry', c.machine.x, c.machine.z, 1.0, MACHINE_WIDTH)
  tableTravel(w, 'imaging:ct:table', c, 2.2)
  w.seat('scanTable:ct', 'scanTable', c.table.out.x, c.table.out.z, c.table.height, {
    pose: 'lie',
    ry: c.table.heading,
    approach: { x: c.assist.at.x, z: c.assist.at.z - 0.55 },
  })
  apronRack(w, 'imaging:ct:aprons', -29.4, -11.7, 1.7)
  cabinet(w, 'imaging:ct:supplies', -23.8, -11.65, 1.4, 0.5)
}

// ---------------------------------------------------------------------------------------------
// X-ray
// ---------------------------------------------------------------------------------------------

function buildXray(b: LayoutBuilder): void {
  b.area = 'xray'
  const w = b.world
  const x = IMAGING.xray
  const tx = x.table.out.x
  const tz = x.table.out.z

  // the radiography table, running north-south: a pedestal, a floating top with a pad, a bucky tray down one side
  w.rbox(tx, 0, tz, 0.5, 0.62, 1.3, 'metalDark', { r: 0.04 })
  w.rbox(tx, 0.62, tz, 0.78, 0.09, 2.1, 'whitePlastic', { r: 0.035 })
  w.rbox(tx, 0.71, tz, 0.7, 0.04, 2.0, 'fabricTeal', { r: 0.02 })
  w.box(tx + 0.4, 0.64, tz, 0.03, 0.05, 1.9, 'metalDark', { cast: false })
  w.rect('imaging:xray:table', tx, tz, 0.8, 2.2)
  w.seat('xrayTable:xray', 'xrayTable', tx, tz, x.table.height, { pose: 'lie', ry: x.table.heading, approach: { x: tx + 0.8, z: tz - 0.2 } })
  // the ceiling tube's parked column (the tube and its rails are the machines agent's): a footprint only
  w.rect('imaging:xray:tube', x.machine.x, x.machine.z, 0.6, 0.6)

  // the wall detector (chest bucky) on the west wall: an upright rail, a carriage and a panel
  const sx = -39.6
  const sz = 5.3
  w.box(-39.82, 0, sz, 0.1, 2.2, 0.16, 'metalDark')
  w.rbox(sx, 0, sz, 0.5, 0.08, 0.8, 'metalDark', { r: 0.02 })
  w.rbox(-39.62, 0.75, sz, 0.14, 0.8, 0.5, 'whitePlastic', { r: 0.03 })
  w.box(-39.54, 0.82, sz, 0.02, 0.66, 0.4, 'glowWarm', { cast: false })
  w.rect('imaging:xray:detector', sx, sz, 0.5, 0.8)

  // the lead-glass screen across the corner by the door: a half-height lead panel with a glass top, and the exposure console
  const px = -35.2
  const pz = 4.5
  const pw = 2.2
  w.box(px, 0, pz, pw, 1.0, 0.08, 'whitePlastic')
  w.box(px, 0, pz + 0.045, pw, 0.12, 0.02, 'metalDark', { cast: false })
  w.box(px, 1.0, pz, pw, 0.92, 0.03, 'glass', { cast: false })
  w.box(px, 1.0, pz, pw, 0.04, 0.06, 'frame')
  w.box(px, 1.9, pz, pw, 0.04, 0.06, 'frame')
  for (const e of [px - pw / 2 + 0.03, px + pw / 2 - 0.03]) w.box(e, 1.0, pz, 0.06, 0.94, 0.06, 'frame')
  w.rect('imaging:xray:screen', px, pz, pw, 0.12)
  const dx = -34.7
  const dz = 4.17
  w.rbox(dx, 0.7, dz, 1.2, 0.04, 0.54, 'whitePlastic', { r: 0.015 })
  w.box(dx, 0, dz, 1.12, 0.7, 0.5, 'whitePlastic')
  w.rbox(dx - 0.3, 0.74, dz - 0.1, 0.4, 0.015, 0.14, 'metalDark', { r: 0.005, cast: false })
  w.rbox(dx + 0.3, 0.74, dz - 0.1, 0.1, 0.03, 0.1, 'glowTeal', { r: 0.01, cast: false })
  w.rect('imaging:xray:console', dx, dz, 1.2, 0.54)
  w.consoleScreen('xray', dx, 1.06, dz + 0.1, 0.5, 0.3, Math.PI)
  // the radiographer's stool (the operator spot), behind the screen's west end
  const a = x.operator.at
  w.cyl(a.x, 0, a.z, 0.36, 0.04, 'metalDark')
  w.cyl(a.x, 0.04, a.z, 0.05, 0.46, 'metalDark')
  w.cyl(a.x, 0.5, a.z, 0.36, 0.07, 'fabricTeal')
  w.circle('imaging:xray:stool', a.x, a.z, 0.22)
  w.seat('console:xray', 'console', a.x, a.z, 0.57, { ry: x.operator.heading })

  // lead aprons and a cassette cabinet along the east wall
  apronRack(w, 'imaging:xray:aprons', -34.3, 10.2, 1.3, -Math.PI / 2)
  cabinet(w, 'imaging:xray:cabinet', -34.35, 7.2, 1.3, 0.5, -Math.PI / 2)
}

// ---------------------------------------------------------------------------------------------
// Ultrasound
// ---------------------------------------------------------------------------------------------

function buildUltrasound(b: LayoutBuilder): void {
  b.area = 'ultrasound'
  const w = b.world
  const u = IMAGING.us
  const cx = u.table.out.x
  const cz = u.table.out.z
  // the couch: a base, a padded top, a raised head section and a pillow (the head is at the south end, see IMAGING.us)
  w.rbox(cx, 0, cz, 0.5, 0.55, 1.4, 'metalDark', { r: 0.04 })
  w.rbox(cx, 0.52, cz, 0.76, 0.1, 1.95, 'whitePlastic', { r: 0.04 })
  w.rbox(cx, 0.61, cz - 0.15, 0.7, 0.07, 1.5, 'fabricTeal', { r: 0.03 })
  w.rbox(cx, 0.63, cz + 0.72, 0.7, 0.07, 0.6, 'fabricTeal', { r: 0.03, rx: -0.25 })
  w.rbox(cx, 0.68, cz + 0.8, 0.4, 0.07, 0.26, 'linen', { r: 0.035 })
  w.rect('imaging:us:couch', cx, cz, 0.78, 1.95)
  w.seat('usCouch:us', 'usCouch', cx, cz, u.table.height, { pose: 'lie', ry: u.table.heading, approach: { x: cx - 1.05, z: cz } })
  // the cart's footprint (the cart, its monitor and the probe are the machines agent's)
  w.rect('imaging:us:cart', u.machine.x, u.machine.z, 0.7, 0.9)
  // the sonographer's stool
  const a = u.operator.at
  w.cyl(a.x, 0, a.z, 0.4, 0.04, 'metalDark')
  w.cyl(a.x, 0.04, a.z, 0.05, 0.44, 'metalDark')
  w.cyl(a.x, 0.48, a.z, 0.4, 0.07, 'fabricSage')
  w.circle('imaging:us:stool', a.x, a.z, 0.23)
  w.seat('console:us', 'console', a.x, a.z, 0.55, { ry: u.operator.heading, approach: { x: a.x, z: a.z - 0.9 } })
  // a sink and gel counter on the west wall, a supplies cabinet on the east wall
  w.rbox(-33.63, 0, 5.5, 0.54, 0.88, 1.8, 'whitePlastic', { r: 0.03 })
  w.rbox(-33.63, 0.88, 5.5, 0.56, 0.04, 1.84, 'woodOak', { r: 0.02 })
  w.rbox(-33.6, 0.9, 5.0, 0.4, 0.015, 0.36, 'frame', { r: 0.01, cast: false })
  w.cyl(-33.78, 0.9, 5.0, 0.03, 0.25, 'frame', { cast: false })
  w.rbox(-33.64, 0.92, 6.0, 0.14, 0.2, 0.1, 'tinted', { r: 0.03, color: '#8ec9d6', cast: false }) // gel bottle
  w.rect('imaging:us:counter', -33.63, 5.5, 0.54, 1.8)
  cabinet(w, 'imaging:us:cabinet', -28.35, 4.0, 1.5, 0.5, -Math.PI / 2)
}

// ---------------------------------------------------------------------------------------------
// Blood draw and changing room (the `diagnostics` area)
// ---------------------------------------------------------------------------------------------

/** The blood-draw chair at (x, z), facing north: a padded chair with fixed arm rests. */
function drawChair(f: Frame, i: number, x: number, z: number): void {
  const c = f.sub(x, z, Math.PI)
  c.rbox(0, 0.1, 0, 0.7, 0.3, 1.05, 'fabricTeal', { r: 0.08 })
  c.rbox(0, 0.4, -0.45, 0.7, 0.5, 0.18, 'fabricTeal', { r: 0.08, rx: 0.2 })
  c.cyl(0, 0, 0.1, 0.4, 0.1, 'metalDark')
  for (const s of [-1, 1]) {
    c.rbox(s * 0.37, 0.4, 0.05, 0.06, 0.05, 0.6, 'whitePlastic', { r: 0.015 })
    c.box(s * 0.37, 0.1, 0.05, 0.03, 0.3, 0.05, 'metalDark', { cast: false })
  }
  // the approach is on the foot side (north): the chair's footprint is 1.1 m long, so the spot is a little over 1 m out
  c.seat(`drawChair:diag:${i}`, 'drawChair', 0, -0.15, 0.4, { far: 1.3 })
  f.rect(`diag:draw${i}`, x, z, 0.8, 1.1)
}

/** Three changing cubicles along the east wall: partitions, a bench and hooks in each, a curtain rail and a curtain each. */
function cubicles(f: Frame): void {
  const xFront = -23.45
  const xWall = -22.15
  const depth = xWall - xFront
  const cxm = (xFront + xWall) / 2
  const z0 = 3.9
  const pitch = 1.4
  const n = 3
  for (let k = 0; k <= n; k++) f.box(cxm, 0, z0 + k * pitch, depth, 1.9, 0.04, 'whitePlastic')
  f.box(xFront + 0.02, 1.94, z0 + (n * pitch) / 2, 0.04, 0.03, n * pitch, 'frame', { cast: false }) // curtain rail
  for (let k = 0; k < n; k++) {
    const zc = z0 + (k + 0.5) * pitch
    f.rbox(xWall - 0.2, 0, zc, 0.34, 0.45, 1.0, 'woodOak', { r: 0.03 }) // bench
    f.box(xWall - 0.01, 1.5, zc, 0.03, 0.04, 1.0, 'frame', { cast: false }) // hook rail
    f.rbox(xWall - 0.18, 0.45, zc + 0.15, 0.28, 0.07, 0.34, 'linen', { r: 0.03 }) // a folded gown
  }
  // curtains: the first cubicle is closed (occupied), the second half drawn, the third open with the curtain gathered
  f.box(xFront + 0.02, 0.1, z0 + 0.5 * pitch, 0.03, 1.84, pitch - 0.08, 'fabricSage')
  f.box(xFront + 0.02, 0.1, z0 + pitch + 0.32, 0.03, 1.84, 0.7, 'fabricSage')
  f.box(xFront + 0.02, 0.1, z0 + 2 * pitch + 0.13, 0.08, 1.84, 0.2, 'fabricSage')
  f.rect('imaging:cubicles', cxm, z0 + (n * pitch) / 2, depth, n * pitch)
}

function sampleHatch(f: Frame): void {
  const cx = -25.0
  // a counter with a rack of sample tubes under a pass-through hatch into the lab (R2 builds the lab behind it)
  f.rbox(cx, 0, 11.625, 1.0, 0.9, 0.55, 'whitePlastic', { r: 0.03 })
  f.rbox(cx, 0.9, 11.625, 1.06, 0.04, 0.59, 'woodOak', { r: 0.02 })
  f.box(cx, 1.15, 11.84, 0.9, 0.62, 0.12, 'frame')
  f.box(cx, 1.22, 11.775, 0.7, 0.42, 0.02, 'metalDark', { cast: false })
  f.box(cx, 1.55, 11.775, 0.5, 0.025, 0.012, 'glowTeal', { cast: false })
  f.rbox(cx - 0.2, 0.94, 11.6, 0.4, 0.04, 0.2, 'metalDark', { r: 0.01, cast: false })
  const tubes = ['#d94b4b', '#7a4fb8', '#e8c13a', '#3a8fd9', '#d94b4b', '#7a4fb8']
  tubes.forEach((color, i) => f.cyl(cx - 0.34 + i * 0.07, 0.98, 11.6, 0.035, 0.1, 'tinted', { color, cast: false }))
  f.rect('imaging:hatch', cx, 11.625, 1.0, 0.55)
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

function buildBloodDraw(b: LayoutBuilder): void {
  b.area = 'diagnostics'
  const w = b.world
  // two chairs on the south wall, facing north, with the sample hatch between them
  drawChair(w, 0, -26.4, 10.6)
  drawChair(w, 1, -23.6, 10.6)
  sampleHatch(w)
  cubicles(w)
  sinkCounter(w)
}

// ---------------------------------------------------------------------------------------------

export function buildImaging(b: LayoutBuilder): void {
  buildHall(b)
  buildMriControl(b)
  buildMriRoom(b)
  buildCtControl(b)
  buildCtRoom(b)
  buildXray(b)
  buildUltrasound(b)
  buildBloodDraw(b)
}
