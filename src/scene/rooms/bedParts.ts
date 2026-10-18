/**
 * The shared numbers of a ward bed (L1): what the static room builder draws (rooms/patientRoom.ts) and where the live parts go
 * (the instanced backrest, the tray on the over-bed table, the bedside screen and the door tile in src/scene/meals/ward).
 * One file, so the static bed and the parts that move can never drift apart. Pure (no three.js, no React).
 *
 * Room coordinates (as in patientRoom.ts): `u` metres east of the room's west wall, `v` metres from the corridor wall toward
 * the window. The bed sits at `RoomSpec.bed` with its head at small `v`. "Bed-local" below means offsets from the bed centre:
 * `du` east, `dv` toward the window (the feet), so `dv < 0` is toward the head. World x is `bed.x + du`; world z is
 * `bed.z + wardSign * dv` (ward B is ward A mirrored in z).
 */
import { BANDS, ROOMS, wardSign, type RoomSpec } from '@/sim/places'

export const BED = { w: 0.95, l: 2.0 } as const

/** The mattress: its underside, its top (the seat height of a patient in bed), its size and its corner radius. */
export const MATTRESS = { y0: 0.32, top: 0.49, w: 0.88, l: 1.92, r: 0.06 } as const

/** The trolley bed of a triage or ER bay (rooms/triageEr.ts): its mattress top is the seat height of the patient lying on it (`erBay:*`), `linen` thick. */
export const TROLLEY = { top: 0.44, w: 0.82, l: 1.95, linen: 0.14 } as const

/**
 * A made bed, ward bed or trolley: the blanket lies flat on the mattress, this thick. A patient lying in the bed is covered by the crowd's own
 * blanket instead (src/scene/actors/crowd/gear.ts, a prop of the lying person), which stands well clear of this one.
 */
export const MADE_BLANKET = 0.03

/**
 * The head section of the mattress, raised by the sim's recline (0 = flat, 1 = RECLINE_MAX). It hinges at the waist of a lying
 * body (the pelvis is at the bed centre, the waist joint 0.1 m toward the head), just under the mattress top, so the
 * patient's torso and this section turn about nearly the same line. Local frame of the part (the hinge): +z toward the feet,
 * y up from the hinge axis. The pillow rides on it.
 */
export const BACKREST = {
  /** Bed-local dv and height of the hinge axis. */
  hingeDv: -0.1,
  hingeY: 0.46,
  /** The slab runs from the hinge to the mattress's head end. */
  length: MATTRESS.l / 2 - 0.1,
  slab: { w: MATTRESS.w, y0: MATTRESS.y0 - 0.46, y1: MATTRESS.top - 0.46, r: MATTRESS.r },
  /** Pillow: centre in the part's frame, and size. */
  pillow: { w: 0.56, h: 0.13, d: 0.34, z: -0.64, y: MATTRESS.top - 0.46 + 0.065, r: 0.055 },
} as const

/** The static mattress foot section: from the hinge to the foot end (the head section is the instanced backrest). */
export const FOOT_SECTION = {
  /** Bed-local dv of its centre and its length. */
  dv: (BACKREST.hingeDv + MATTRESS.l / 2) / 2,
  length: MATTRESS.l / 2 - BACKREST.hingeDv,
} as const

/**
 * The over-bed table: a C-frame on casters on the window side of the bed, its plate across the patient's lap. Offsets from the
 * bed centre (`du` east, `dv` toward the feet). The upright stands hard against the bed rail, so the strip beside the bed that the
 * nurse walks to the MedDrawer stays clear: the table is listed as an overhead footprint, never a nav obstacle.
 *
 * The plate stands clear above the blanket over the patient's knees (the crowd's blanket, actors/crowd/gear.ts, is 0.445 m above the mattress at the highest,
 * the mattress top is 0.49 m): its underside at 0.96 m, so a meal tray on it (`top`) is never inside the blanket, flat or with the bed head raised.
 */
export const OVERBED = {
  /** The plate: centre, size, underside height and thickness. */
  plate: { du: 0.1, dv: 0.35, w: 0.76, d: 0.42, y: 0.96, h: 0.035 },
  /** The upright and the foot plate on the floor. */
  column: { du: 0.54, dv: 0.35, w: 0.05, y0: 0.05, h: 0.915 },
  foot: { w: 0.07, d: 0.56, h: 0.03 },
  /** The top of the plate: where a tray stands. */
  top: 0.995,
} as const

/** The bedside screen on its arm (a display hanging over the bed head), in room coordinates. */
export const BEDSIDE_SCREEN = { du: -0.75, v: 0.5, y: 1.12, w: 0.4, h: 0.27, t: 0.03, lean: 0.38 } as const

/**
 * A door tile: a flat plate inlaid in the doorway threshold (a coloured mat from the door jambs' gap, straddling the wall line, clear of
 * the robot lane and its zebra), lit by the bed's state. On the floor so it reads from the overview in both wards, whichever way the wall faces.
 */
export const DOOR_TILE = { w: 1.2, d: 0.5, y: 0.014, h: 0.01 } as const

/** A place and a heading in the world. `y` is a height above the floor. */
export interface Anchor {
  x: number
  y: number
  z: number
  /** Rotation about y, radians (the room's bed heading unless noted). */
  ry: number
}

export interface BedAnchors {
  roomId: string
  /** The backrest hinge axis: x across the bed, at the bed's heading. */
  backrest: Anchor
  /** The middle of the tray's place on the over-bed table (its top face). */
  tray: Anchor
  /** The bedside screen: centre of the picture, its heading, and how far it leans back (rotation about x is `-lean`). */
  screen: Anchor & { lean: number; w: number; h: number }
  /** The doorway tile, centre of the plate's top face. */
  doorTile: Anchor
}

/** The anchors of one ward room. */
export function bedAnchors(room: RoomSpec): BedAnchors {
  const s = wardSign(room.ward)
  const bx = room.bed.x
  const bz = room.bed.z
  // the picture sits half a bezel plus a hair in front of the display's centre, along the way the display faces
  const k = BEDSIDE_SCREEN.t / 2 + 0.003
  const lean = BEDSIDE_SCREEN.lean
  return {
    roomId: room.id,
    backrest: { x: bx, y: BACKREST.hingeY, z: bz + s * BACKREST.hingeDv, ry: room.bedHeading },
    tray: { x: bx + OVERBED.plate.du, y: OVERBED.top, z: bz + s * OVERBED.plate.dv, ry: room.bedHeading },
    screen: {
      x: bx + BEDSIDE_SCREEN.du,
      y: BEDSIDE_SCREEN.y + Math.sin(lean) * k,
      z: s * (BANDS.roomWall + BEDSIDE_SCREEN.v + Math.cos(lean) * k),
      ry: room.bedHeading,
      lean,
      w: BEDSIDE_SCREEN.w - 0.03,
      h: BEDSIDE_SCREEN.h - 0.03,
    },
    doorTile: { x: room.door.x, y: DOOR_TILE.y + DOOR_TILE.h, z: room.door.z, ry: 0 },
  }
}

/** Anchors of all 16 rooms, in `ROOMS` order. */
export const BED_ANCHORS: readonly BedAnchors[] = ROOMS.map(bedAnchors)
