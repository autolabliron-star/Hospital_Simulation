/**
 * W4 robot blood-draw centre: the numbers of the drawing, shared by the static room (src/scene/rooms/bloodDraw.ts) and the animated rig
 * (this folder), so what is drawn and what moves always agree. Pure: no three.js, no React. World coordinates: metres, x east, z south, y up.
 *
 * The three robots stand against corridor B's wall (z 11.43) with the patient chair in front of each, facing the cabinet. The patient's LEFT
 * arm goes forward into an enclosed tunnel that reaches out of the cabinet's front: that line is the crowd's ARM_IN line (a seated person
 * with the left forearm held out in front).
 */
import { ARM_IN, KIOSK_SEAT_HEIGHT, armInPoint, armInTunnel } from '@/scene/actors/crowd/armIn'
import { DRAW_CENTRE, PNEUMATIC, areaById } from '@/sim/places'
import type { TubeKind } from '@/sim/types'

/**
 * The seated "arm in" pose of the crowd (agent S1: src/scene/actors/crowd/armIn.ts, the ONE place for these numbers): the middle of the left hand
 * is `ahead` 0.44 m in front of the seat centre, `left` 0.17 m to the left and `up` 0.40 m above the seat surface; the tunnel's axis runs straight
 * ahead through that point and its mouth is `mouth` 0.30 m ahead of the seat. The robot hood starts at that mouth (so the body of any sitter is
 * clear of it) and runs to the cabinet's front face, 0.57 m (longer than the crowd's `length` 0.4, because the contract puts the cabinet there).
 */
export { ARM_IN }

export const SEAT_HEIGHT = KIOSK_SEAT_HEIGHT

/** The robot cabinet: 0.82 wide (x), 1.05 high, 0.62 deep (z), white, with a teal band at 0.95. */
export const CABINET = { w: 0.82, h: 1.05, d: 0.62, plinth: 0.08, band: 0.95 } as const

/**
 * The arm tunnel's cross section, built round the crowd's arm line (axis height 0.85): a padded trough (shell 0.72 .. 0.78, pad top 0.795, 5 mm
 * under the forearm) under a clear hood (to 1.03), 0.30 wide. The knees are 0.27 m below the trough's underside.
 */
export const TUNNEL = { halfW: 0.15, yBase: 0.72, yPad: 0.78, yPadTop: 0.795, yTop: 1.03 } as const

/** The robot head rides under the hood's roof: its centre height and half sizes (its underside is 0.915, 2 cm above the hand). */
export const HEAD = { y: 0.94, halfZ: 0.045, halfX: 0.05, halfY: 0.025 } as const
/** The needle: it hides in the head and comes down this far (m) into the skin. */
export const NEEDLE_TRAVEL = 0.045
/** The rails the head rides on, under the hood's roof. */
export const RAIL_Y = 0.9775

/** The screen on its arm over the cabinet: centre height, size of the bezel and of the picture (a 16:10 cell of the live strip), lean back. */
export const SCREEN = { y: 1.38, bezelW: 0.47, bezelH: 0.3, picW: 0.43, picH: 0.268, lean: 0.12, thick: 0.035, dz: 0.18 } as const

/** The five tube slots in the cabinet's front window, and the longest bar (a full tube). */
export const TUBE_SLOTS = { count: 5, pitch: 0.055, dx: -0.2, base: 0.54, full: 0.26, width: 0.026 } as const

export interface ArmGeometry {
  /** The tunnel's axis (x), its height (y) and the hand's middle (z): the crowd's arm-in point. The axis runs along +z (the chair faces +z). */
  x: number
  y: number
  zHand: number
  /** The head's z for scan = 0 (over the back of the hand) and scan = 1 (over the forearm, near the mouth). */
  z0: number
  z1: number
  /** The tunnel's mouth (toward the chair, the crowd's `mouth`) and where it enters the cabinet. */
  zMouth: number
  zFront: number
  /** Where the head parks (deep in the tunnel, away from the arm). */
  zPark: number
}

export interface RobotDims {
  index: number
  /** The cabinet's centre on the floor and its front face (z). */
  x: number
  z: number
  zFront: number
  arm: ArmGeometry
  /** The patient chair (centre, facing +z) and its approach (to the patient's left side, in the aisle). */
  chair: { x: number; z: number }
  approach: { x: number; z: number }
  /** The picture's centre and normal (facing north, towards the chair), and the bezel's z. */
  screen: { x: number; y: number; z: number }
  /** The pneumatic riser: x, z, bottom y (the cabinet top) and top y (just under the trunk's tube). */
  riser: { x: number; z: number; y0: number; y1: number }
}

/** Heading 0 for every chair (facing +z): the tunnel code relies on it, the room test checks it. */
export function robotDims(index: number): RobotDims {
  const r = DRAW_CENTRE.robots[index]
  const frame = { x: r.chair.at.x, z: r.chair.at.z, heading: r.chair.heading, seatHeight: SEAT_HEIGHT }
  const hand = armInPoint(frame)
  const mouth = armInTunnel(frame).mouth
  const zFront = r.cabinet.z - CABINET.d / 2
  const src = PNEUMATIC.sources[index]
  return {
    index,
    x: r.cabinet.x,
    z: r.cabinet.z,
    zFront,
    arm: {
      x: hand.x,
      y: hand.y,
      zHand: hand.z,
      z0: hand.z + 0.07,
      z1: mouth.z + 0.065,
      zMouth: mouth.z,
      zFront,
      zPark: zFront - 0.13,
    },
    chair: { x: frame.x, z: frame.z },
    approach: { x: frame.x + 0.8, z: frame.z - 0.05 },
    screen: { x: r.cabinet.x, y: SCREEN.y, z: zFront + SCREEN.dz },
    riser: { x: src.x, z: src.z, y0: src.y, y1: 2.82 },
  }
}

/** The head's z for a position `s` along the arm (0 over the back of the hand, 1 over the forearm by the mouth; below 0 slides back towards the cabinet). */
export function headZ(a: ArmGeometry, s: number): number {
  return a.z0 + (a.z1 - a.z0) * s
}
/** `s` at which the head sits at its park position. */
export function parkS(a: ArmGeometry): number {
  return (a.zPark - a.z0) / (a.z1 - a.z0)
}

// ---------------------------------------------------------------------------------------------
// The tube-prep machine (BC-ROBO-like), against the west wall, facing east
// ---------------------------------------------------------------------------------------------

/**
 * 0.60 wide (along the wall, z) x 0.755 deep (x) x 1.18 high. Flush with the west wall's face, so its centre is 0.3775 m from it (the contract's
 * `prep.center.x` is -27.62: that would put the back 0.0975 m inside the wall, which the layout test refuses; the centre is here, and the
 * tray outlet stays where the contract puts it).
 */
const AREA = areaById('diagnostics').rect
const WALL_HALF = 0.1
export const PREP = {
  w: 0.6,
  d: 0.755,
  h: 1.18,
  /** Cabinet top (the working deck), roof, and the hood glass top. */
  deck: 0.78,
  roof: 1.16,
  cx: AREA.x0 + WALL_HALF + 0.755 / 2,
  cz: DRAW_CENTRE.prep.center.z,
  /** The tray outlet (contract) in the machine's frame: how far out of the centre along x. */
  tray: DRAW_CENTRE.prep.tray,
} as const

/** Machine frame (lx across, world -z; lz depth, world +x) to world. */
export function prepWorld(lx: number, lz: number): { x: number; z: number } {
  return { x: PREP.cx + lz, z: PREP.cz - lx }
}

/** 8 bins in 2 rows of 4: cap colours (the sim picks a bin; the tube it then holds is its own kind). */
/** The tube kind in each bin: the contract's DRAW_CENTRE.prep.bins (the sim's TubePrepState.bin indexes the same list). */
export const PREP_BIN_KIND: readonly TubeKind[] = DRAW_CENTRE.prep.bins
export const PREP_BIN = { cols: 4, pitchX: 0.125, rowZ: [-0.27, -0.13] as const, size: 0.1, y0: 0.8, top: 0.95 } as const
export function prepBinLocal(i: number): { lx: number; lz: number } {
  const c = i % PREP_BIN.cols
  const row = Math.floor(i / PREP_BIN.cols)
  return { lx: (c - (PREP_BIN.cols - 1) / 2) * PREP_BIN.pitchX, lz: PREP_BIN.rowZ[row] }
}

/** Where the gripper goes besides the bins (machine frame), and its heights. */
export const PREP_STOPS = {
  home: { lx: 0, lz: -0.02 },
  printer: { lx: -0.17, lz: 0.2 },
  wrap: { lx: 0.09, lz: 0.2 },
  drop: { lx: 0, lz: 0.36 },
  yHome: 1.07,
  yCarry: 1.05,
  yPick: 0.985,
  yDrop: 1.0,
  /** The bridge beam's height, and the longest the output rack shows (trays). */
  yBeam: 1.125,
  trays: 3,
} as const

// ---------------------------------------------------------------------------------------------
// Check-in kiosk, queue screen, send station
// ---------------------------------------------------------------------------------------------

/** The check-in pedestal 0.5 x 1.0 x 0.4 at checkIn.device (its front, +z, faces the guest). */
export const CHECKIN = {
  w: 0.5,
  h: 1.0,
  d: 0.4,
  /** The tilted screen head on top of the body: centre height, how far in front of the pedestal's centre (z), size, thickness, lean back. */
  head: { y: 0.88, dz: 0.17, w: 0.38, h: 0.26, t: 0.05 },
  lean: 0.35,
  screenW: 0.32,
  screenH: 0.2,
  slotY: 0.6,
} as const

/** The centre of the check-in screen's picture (the head's front face), world. */
export function checkInFace(): { x: number; y: number; z: number } {
  const c = DRAW_CENTRE.checkIn.device
  const k = CHECKIN.head.t / 2 + 0.003
  return { x: c.x, y: CHECKIN.head.y + Math.sin(CHECKIN.lean) * k, z: c.z + CHECKIN.head.dz + Math.cos(CHECKIN.lean) * k }
}

/** The queue screen above the door, facing into the room (+z). */
export const QUEUE_SCREEN = { w: 0.72, h: 0.45, bezel: 0.03 } as const

/** The manual send station on the south wall at the east end: 0.45 wide (x) x 0.28 deep (z) x 0.70 high at 0.95..1.65. */
export const SEND = { w: 0.45, d: 0.28, y0: 0.95, y1: 1.65, inletY: 1.12, screenY: 1.45, screenW: 0.3, screenH: 0.1875 } as const

/** Where a tile quad sits, in the atlas (src/scene/w4kit/tiles.ts anchors). Computed here so the layout and the tiles agree. */
export const TILE_ANCHORS = {
  drawCheckIn: () => ({ at: checkInFace(), heading: 0, w: CHECKIN.screenW, h: CHECKIN.screenH, tilt: CHECKIN.lean }),
  drawQueue: () => ({ at: { x: DRAW_CENTRE.queueScreen.x, y: DRAW_CENTRE.queueScreen.y, z: DRAW_CENTRE.queueScreen.z + 0.022 }, heading: DRAW_CENTRE.queueScreen.heading, w: QUEUE_SCREEN.w, h: QUEUE_SCREEN.h }),
  tubePrep: () => ({ at: { x: PREP.cx + PREP.d / 2 + 0.006, y: 0.52, z: PREP.cz }, heading: Math.PI / 2, w: 0.3, h: 0.1875 }),
  manualSend: () => ({ at: { x: DRAW_CENTRE.manualSend.x, y: SEND.screenY, z: DRAW_CENTRE.manualSend.z - SEND.d / 2 - 0.003 }, heading: Math.PI, w: SEND.screenW, h: SEND.screenH }),
}
