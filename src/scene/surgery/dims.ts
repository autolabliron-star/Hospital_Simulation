/**
 * R2 (agent O): the numbers the robotic OR's static room (src/scene/rooms/surgery/or.ts), the robot rig and the screens all agree on. Pure: no three.js, no
 * React. Everything is in SIM coordinates (places.ts SURGERY, x = drawn x + 150) and y is metres above the level-2 floor; the level-2 group moves them to
 * where they are drawn.
 *
 * Frames. A piece of furniture stands in a frame at (x, z) with a heading h (atan2(dx, dz): 0 faces +z, pi/2 faces +x). Its local +z is the way it faces, its
 * local +x is its left (the layout builder's frames work the same way), so a local point (lx, lz) is the world point
 *
 *     x = fx + cos(h) lx + sin(h) lz        z = fz - sin(h) lx + cos(h) lz
 */
import { l2 } from '@/sim/levels'
import { SURGERY, type Spot } from '@/sim/places'

export interface Pt2 {
  x: number
  z: number
}

/** The world x of a point in the local frame of something at (fx, fz) facing `h`. */
export const localX = (fx: number, _fz: number, h: number, lx: number, lz: number): number => fx + Math.cos(h) * lx + Math.sin(h) * lz
/** The world z of the same point. */
export const localZ = (_fx: number, fz: number, h: number, lx: number, lz: number): number => fz - Math.sin(h) * lx + Math.cos(h) * lz

/** Which way a thing at `from` faces to look at `to` (atan2(dx, dz)). */
export const headingTo = (from: Pt2, to: Pt2): number => Math.atan2(to.x - from.x, to.z - from.z)

// ---------------------------------------------------------------------------------------------
// The room's furniture
// ---------------------------------------------------------------------------------------------

/**
 * The vision cart turned toward the bedside assistant. (The contract's `SURGERY.visionCart.heading` is 3pi/4, which faces north-east, away from where the
 * assistant stands: the screen is turned the way the brief says, toward them.)
 */
export const VISION_HEADING = headingTo(SURGERY.visionCart.at, SURGERY.staff.assistant.at)

/** Where a console stands and which way its viewer faces: east, toward the surgeon's seat behind it (the seat looks west). */
export const CONSOLE_HEADING = Math.PI / 2

/** The two surgeon consoles by name, in the order of the seats. */
export const CONSOLES = [
  { id: 'surgeon', seat: 'console:or:surgeon', centre: SURGERY.consoles.surgeon.centre, seatAt: SURGERY.consoles.surgeon.seat.at },
  { id: 'teach', seat: 'console:or:teach', centre: SURGERY.consoles.teach.centre, seatAt: SURGERY.consoles.teach.seat.at },
] as const

/** Seat surfaces: the crowd draws a seated person on a console chair at the default 0.45 m (a registry seat is claimed at its own height). */
export const SEAT_HEIGHT = { console: 0.45, stool: 0.55 } as const

/**
 * The seat approaches the room picks by hand (the builder's own search would pick a spot behind the consoles, against the wall): in the pocket between the
 * two consoles' chairs (0.86 m from each seat, 0.44 m from either console), and east of the anaesthetist's stool.
 */
export const OR_APPROACH = {
  consoles: { x: l2(-44.75), z: 7.75 },
  stool: { x: l2(-47.8), z: 4.75 },
} as const satisfies Record<string, Pt2>

/** The surgical lights: two heads on one ceiling hub over the table (their bodies are walk-only prims, their faces glow instances of the rig). */
export const LIGHTS = {
  hub: { x: l2(-49.2), z: 5.9 },
  heads: [
    { x: l2(-49.85), z: 5.3 },
    { x: l2(-48.55), z: 6.5 },
  ] as readonly Pt2[],
  /** Underside of the housing, and the diameter of the lit face. */
  faceY: 2.6,
  faceDia: 0.56,
  housingDia: 0.7,
} as const

// ---------------------------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------------------------

/** A screen: its centre (sim x, y above the floor, sim z), which way it faces, its size and how far it leans back (radians, face up). */
export interface ScreenAnchor {
  at: { x: number; y: number; z: number }
  heading: number
  w: number
  h: number
  tilt?: number
}

/** The shared picture and the atlas tiles are 1.6 : 1, so a screen is `w` wide and `w / 1.6` tall. */
const ASPECT = 1.6
const screen = (x: number, y: number, z: number, heading: number, w: number, tilt = 0): ScreenAnchor => ({ at: { x, y, z }, heading, w, h: w / ASPECT, ...(tilt ? { tilt } : {}) })

/** The anaesthesia monitor's swivel about the vertical (radians; negative turns it west, toward the anaesthetist who stands north-west of the stool). */
export const ANAES_SWIVEL = -0.25

const visionC = SURGERY.visionCart.at
const consoleSurgeon = SURGERY.consoles.surgeon.centre
const consoleTeach = SURGERY.consoles.teach.centre
const anaesM = SURGERY.anaesthesia.machine.at
const desk = SURGERY.circulatorDesk.at

/** The console's viewer: the screen a seated surgeon looks into, in the hood's east face (local +z of a console frame). */
export const CONSOLE_PARTS = {
  /** Local frame: +z toward the seat. The body is 0.97 wide (x) and 0.86 deep (z); the hood stands out of its top part. */
  hoodFace: 0.45,
  hoodY: 1.27,
  viewerW: 0.28,
  controllerZ: 0.5,
  controllerY: 0.79,
  /** The status panel on top of the tower, leaning back. */
  statusY: 1.7,
  statusZ: 0.04,
  statusTilt: 0.55,
} as const

const consoleAt = (c: Pt2, lx: number, y: number, lz: number): { x: number; y: number; z: number } => ({
  x: localX(c.x, c.z, CONSOLE_HEADING, lx, lz),
  y,
  z: localZ(c.x, c.z, CONSOLE_HEADING, lx, lz),
})

/** The live endoscope screens (the shared 256 x 160 texture): vision cart, wall monitor, the two console viewers. */
export const LIVE_SCREENS: readonly ScreenAnchor[] = [
  // the vision cart's monitor, 1.52 m up on its tower, a hair in front of the bezel
  {
    at: { x: localX(visionC.x, visionC.z, VISION_HEADING, 0, 0.124), y: 1.52, z: localZ(visionC.x, visionC.z, VISION_HEADING, 0, 0.124) },
    heading: VISION_HEADING,
    w: 0.46,
    h: 0.46 / ASPECT,
    tilt: 0.18,
  },
  // the wall monitor on the OR's south wall, over the table, read from the head and the sides
  screen(l2(-49.2), 1.7, 9.846, Math.PI, 1.0),
  // the viewers
  { at: consoleAt(consoleSurgeon, 0, CONSOLE_PARTS.hoodY, CONSOLE_PARTS.hoodFace + 0.004), heading: CONSOLE_HEADING, w: CONSOLE_PARTS.viewerW, h: CONSOLE_PARTS.viewerW / ASPECT },
  { at: consoleAt(consoleTeach, 0, CONSOLE_PARTS.hoodY, CONSOLE_PARTS.hoodFace + 0.004), heading: CONSOLE_HEADING, w: CONSOLE_PARTS.viewerW, h: CONSOLE_PARTS.viewerW / ASPECT },
]

/** Which live screen is which. */
export const LIVE = { visionCart: 0, wall: 1, viewerSurgeon: 2, viewerTeach: 3 } as const

/** The surgeryKit atlas tiles (4 x 4 of 320 x 200; the rest are spare). */
export const KIT_TILE = {
  consoleSurgeon: 0,
  consoleTeach: 1,
  anaesthesia: 2,
  circulator: 3,
  pacuBoard: 4,
  preOpBoard: 5,
} as const
export const KIT_TILE_COUNT = 16

/** The atlas screens' anchors, by tile. */
export const KIT_SCREENS: Readonly<Record<keyof typeof KIT_TILE, ScreenAnchor>> = {
  consoleSurgeon: { ...screen(0, 0, 0, 0, 0.3, CONSOLE_PARTS.statusTilt), at: consoleAt(consoleSurgeon, 0, CONSOLE_PARTS.statusY, CONSOLE_PARTS.statusZ), heading: CONSOLE_HEADING },
  consoleTeach: { ...screen(0, 0, 0, 0, 0.3, CONSOLE_PARTS.statusTilt), at: consoleAt(consoleTeach, 0, CONSOLE_PARTS.statusY, CONSOLE_PARTS.statusZ), heading: CONSOLE_HEADING },
  // the anaesthesia monitor on the machine's tower, swivelled a quarter radian toward the anaesthetist's place at the head of the table
  anaesthesia: screen(anaesM.x, 1.5, anaesM.z + 0.158, ANAES_SWIVEL, 0.42, 0.1),
  // the circulator's screen on the standing desk, facing south (the circulator stands south of it)
  circulator: screen(desk.x, 1.3, desk.z - 0.02, 0, 0.5, 0.12),
  // the recovery board on the PACU's north wall (the OR's south wall), over the bays; the pre-op board on its south wall over the supply cabinets
  pacuBoard: screen(l2(-48.5), 1.85, 10.144, 0, 0.9),
  preOpBoard: screen(l2(-59.8), 1.62, -10.144, Math.PI, 0.8),
}

/** A dark bezel stands this far proud of the wall behind a wall screen, and every screen quad stands this far in front of its bezel. */
export const BEZEL = 0.04

/** Where the cart's laser crosshair lands before an arm has a port: the middle of the two port lines (the endoscope's port, y above the floor). */
export const LASER_TARGET = {
  x: (SURGERY.ports.transverse[1].x + SURGERY.ports.oblique[1].x) / 2,
  y: SURGERY.ports.transverse[1].y,
  z: (SURGERY.ports.transverse[1].z + SURGERY.ports.oblique[1].z) / 2,
} as const

/** Convenience for tests: every anchor spot a person stands at in the OR. */
export const OR_SPOTS: readonly { id: string; spot: Spot }[] = [
  { id: 'circulator', spot: SURGERY.staff.circulator },
  { id: 'assistant', spot: SURGERY.staff.assistant },
  { id: 'scrub', spot: SURGERY.staff.scrub },
  { id: 'drape', spot: SURGERY.staff.drape },
  { id: 'drive', spot: SURGERY.staff.drive },
  { id: 'anaesthetist', spot: SURGERY.anaesthesia.stand },
]
