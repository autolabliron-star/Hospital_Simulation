/**
 * W4 health kiosks: where every part of a kiosk is, as pure numbers in world coordinates (metres, x east, z south, y up), derived from the contract
 * (`HEALTH_KIOSKS` in src/sim/places.ts) and the hand points of the poses (`ARM_IN`, `GRIP`, `FINGER` in the crowd's armIn.ts). The static furniture
 * (src/scene/rooms/healthKiosks.ts), the animated rig (rig.ts), the screen tiles (tiles.ts) and the tests all read these, so a part is drawn exactly
 * where the person's hand goes.
 *
 * The TOWER stands against the lobby's south wall with its screen side facing -z (north, into the lobby). Its own frame is "tower local": `lx` is the
 * user's RIGHT (world -x), `lz` runs from the tower's centre towards the user (world -z), so the front face is at `lz = TOWER.d / 2`. The user stands
 * on the PLATFORM `TOWER.stand` metres out from the tower's centre, facing the tower. The BP WING is a desk beside the tower with an arm tunnel
 * pointing at the stool; its frame is "seat local": `lx` is the sitter's LEFT (world +x), `lz` runs ahead of the sitter (world +z).
 */
import { ARM_IN, GRIP, FINGER, KIOSK_SEAT_HEIGHT } from '@/scene/actors/crowd/armIn'
import { HEALTH_KIOSKS } from '@/sim/places'

/** The tower: 0.56 wide, 0.42 deep, 2.06 tall with its cap and the overhead arm over the stand spot. */
export const TOWER = {
  w: 0.56,
  d: 0.42,
  plinth: 0.08,
  bodyTop: 1.96,
  capTop: 2.06,
  /** The footprint (collision and nav) is a little shallower than the drawn body: the face is where the hands go, and you stand 0.34 m from the footprint. */
  footprintDepth: 0.34,
  /** The ultrasonic height sensor: the arm from the cap to above the stand spot, and the puck at its end (bottom face height). */
  arm: { y0: 2.0, y1: 2.05, w: 0.07 },
  puck: { bottom: 1.965, top: 2.0, dia: 0.12 },
} as const

/** The weighing platform: 0.50 x 0.05 x 0.46, centred on the stand spot. */
export const PLATFORM = { w: 0.5, d: 0.46, h: 0.05 } as const

/** The touchscreen (15.6 inch, 16:10): bezel 0.39 x 0.24, centre height, tilt back. */
export const SCREEN = { w: 0.39, h: 0.24, t: 0.03, yc: 1.32, lean: 0.3, bezel: 0.015 } as const

/** Heights of the devices on the tower's front face. */
export const DEVICE = {
  lensY: 1.57,
  qrY: 1.09,
  clipY: 1.085,
  printerY: 0.95,
  ledY: 1.78,
  gripY0: 0.96,
  gripY1: 1.12,
  /** Sideways places on the face, tower local (+ is the user's right): the QR reader, the finger-clip cradle (where FINGER's right hand is) and the printer slot. */
  qrX: -0.02,
  clipX: -FINGER.x,
  printerX: 0.15,
} as const

/** The BP wing: the desk (0.50 x 0.72 x 0.48, a little off the sitter's axis so the tower's grip clears it), the unit on it and the tunnel. */
export const WING = {
  deskW: 0.5,
  deskD: 0.48,
  deskTop: 0.72,
  /** The desk spans the sitter's lx from -0.225 to 0.275 and lz from 0.50 to 0.98 ahead. */
  deskX0: -0.225,
  deskX1: 0.275,
  deskZ0: 0.5,
  deskZ1: 0.98,
  /** The BP unit housing on the desk. */
  unit: { x0: -0.2, x1: 0.268, z0: 0.52, z1: 0.96, y0: 0.72, y1: 1.02 },
  /** The BP screen on the unit's front face, left of the tunnel. */
  screen: { lx: -0.07, yc: 0.9, w: 0.23, h: 0.14, t: 0.03, lean: 0.5, bezel: 0.015 },
} as const

export interface P3 {
  x: number
  y: number
  z: number
}

export interface ScreenAnchor {
  /** The centre of the picture, a few millimetres in front of the bezel. */
  at: P3
  /** The way its face looks, atan2(dx, dz): the lobby is north, so a screen facing it has heading PI. */
  heading: number
  w: number
  h: number
  tilt: number
}

export interface KioskAnchors {
  index: number
  /** Tower centre on the floor. */
  tower: { x: number; z: number }
  /** The tower's front face (z). */
  frontZ: number
  /** The platform's centre = the stand spot. */
  stand: { x: number; z: number }
  seat: { x: number; z: number }
  screen: ScreenAnchor
  bpScreen: ScreenAnchor
  /** Centres of the glowing or animated parts. */
  led: P3
  puck: P3
  lens: P3
  qr: P3
  clip: P3
  printer: P3
  grips: [P3, P3]
  /** The first digit's centre (the leftmost as seen from the lobby, so the largest x) and the pitch between digits (towards -x). */
  digits: { x: number; y: number; z: number; w: number; h: number; pitch: number }
  /** The cuff ring at the tunnel's mouth and the tunnel's axis. */
  cuff: P3
  axis: { x: number; y: number; mouthZ: number; farZ: number; radius: number }
  /** The BP unit's SpO2 indicator (on its plate's front face) and status strip (on the unit's front face). */
  bpClip: P3
  bpLed: P3
}

/** A point of the tower's own frame in the world. */
export function towerPoint(i: number, lx: number, y: number, lz: number): P3 {
  const k = HEALTH_KIOSKS[i]
  return { x: k.tower.x - lx, y, z: k.tower.z - lz }
}

/** A point of the sitter's frame (the BP wing's frame) in the world: the stool of kiosk `i`, facing +z; `lx` is the sitter's left, `lz` ahead. */
export function wingPoint(i: number, lx: number, y: number, lz: number): P3 {
  const s = HEALTH_KIOSKS[i].bpSeat.at
  return { x: s.x + lx, y, z: s.z + lz }
}

function screenAt(centre: P3, normalLift: number, normalFwd: number, w: number, h: number, tilt: number): ScreenAnchor {
  // the face looks north (-z) and up by `tilt`: its centre is moved out along that normal
  return { at: { x: centre.x, y: centre.y + normalLift, z: centre.z - normalFwd }, heading: Math.PI, w, h, tilt }
}

function anchorsOf(i: number): KioskAnchors {
  const k = HEALTH_KIOSKS[i]
  const half = TOWER.d / 2
  const face = (lx: number, y: number, lz = half): P3 => towerPoint(i, lx, y, lz)
  // the touchscreen: the bezel's centre sits at the front plane, its front face 1.5 cm out along the tilted normal, the picture 3 mm further
  const bez = SCREEN.t / 2 + 0.003
  const sc = face(0, SCREEN.yc, half - 0.005)
  const screen = screenAt(sc, Math.sin(SCREEN.lean) * bez, Math.cos(SCREEN.lean) * bez, 0.352, 0.22, SCREEN.lean)
  // the BP screen: on the unit's front face (the sitter looks at it from the south side: it faces north)
  const w = WING.screen
  const bc = wingPoint(i, w.lx, w.yc, WING.unit.z0 + 0.005)
  const bbez = w.t / 2 + 0.003
  const bpScreen = screenAt(bc, Math.sin(w.lean) * bbez, Math.cos(w.lean) * bbez, 0.208, 0.13, w.lean)
  const stand = { x: k.stand.at.x, z: k.stand.at.z }
  // how far the stand spot is out from the tower's centre: a fixed point `ahead` of the user is `out - ahead` from the tower's centre
  const out = k.tower.z - stand.z
  const dig = { x: stand.x + 0.044, y: PLATFORM.h + 0.002, z: stand.z - PLATFORM.d / 2 + 0.07, w: 0.03, h: 0.052, pitch: 0.044 }
  return {
    index: i,
    tower: { x: k.tower.x, z: k.tower.z },
    frontZ: k.tower.z - half,
    stand,
    seat: { x: k.bpSeat.at.x, z: k.bpSeat.at.z },
    screen,
    bpScreen,
    led: face(0, DEVICE.ledY),
    puck: { x: stand.x, y: TOWER.puck.bottom, z: stand.z },
    lens: face(0, DEVICE.lensY),
    qr: face(DEVICE.qrX, DEVICE.qrY),
    clip: face(DEVICE.clipX, DEVICE.clipY, half + 0.025),
    printer: face(DEVICE.printerX, DEVICE.printerY),
    grips: [towerPoint(i, -GRIP.side, GRIP.up, out - GRIP.ahead), towerPoint(i, GRIP.side, GRIP.up, out - GRIP.ahead)],
    digits: dig,
    cuff: wingPoint(i, ARM_IN.left, KIOSK_SEAT_HEIGHT + ARM_IN.up, ARM_IN.mouth),
    axis: { x: k.bpSeat.at.x + ARM_IN.left, y: KIOSK_SEAT_HEIGHT + ARM_IN.up, mouthZ: k.bpSeat.at.z + ARM_IN.mouth, farZ: k.bpSeat.at.z + ARM_IN.mouth + ARM_IN.length, radius: ARM_IN.radius },
    bpClip: wingPoint(i, WING.unit.x1 - 0.045, WING.unit.y1 - 0.045, WING.unit.z0 - 0.004),
    bpLed: wingPoint(i, w.lx, w.yc + w.h / 2 + 0.03, WING.unit.z0),
  }
}

/** Anchors of both kiosks (built once). */
export const KIOSKS: readonly KioskAnchors[] = HEALTH_KIOSKS.map((_, i) => anchorsOf(i))
