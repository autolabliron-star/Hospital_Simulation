/**
 * Pharmacy core layout: every number here is derived from the contract (`places.ts`, `config.ts`) or is a pure
 * design dimension of the MedVend machinery. No three.js, no sim state: shared by the geometry builders, the
 * animation and the node tests.
 *
 * W2 (ceiling rail): the MedPods HANG from a rail under the ceiling, so nothing of the core stands on a robot lane any
 * more. What this file lays out for them:
 *   - the top dock ports: a port opening near the top of each MedVend glass face (at `PHARMACY.dockPortY`) and the
 *     short transfer tray that slides out across the gap to the side hatch of the pod hanging at the dock;
 *   - the overhead charging rank: contacts on the rail section above each rank slot;
 *   - the rail portals: a small opening near the top of the core's glass corridor walls where the rail leaves and
 *     re-enters the core (the glass below stays continuous, so nobody can walk through).
 *
 * MedVend face frame: a face serves one ward. "Out" is the distance from the island's centre line towards that
 * face's glass (so world z = FACE_SIGN * out). Ward A's face is on the north side (z < 0), ward B's on the south.
 */
import { CONFIG } from '@/sim/config'
import { CIRCUITS, pointAt, type PathPoint } from '@/sim/meds/circuit'
import { CORE, DOORS, PHARMACY, ROBOT, WALL } from '@/sim/places'
import type { Vec2, WardId } from '@/sim/types'

export const WARDS: readonly WardId[] = ['A', 'B'] as const
export const FACE_SIGN: Record<WardId, -1 | 1> = { A: -1, B: 1 }

export const ISLAND = PHARMACY.island
export const ISLAND_CX = (ISLAND.x0 + ISLAND.x1) / 2
/** Half the island depth: the glass faces sit at this "out". */
export const GLASS_OUT = ISLAND.z1

/** A unit-dose pack: width (x), height (y) and thickness (out). */
export const PACK = { x: 0.14, y: 0.1, z: 0.06 } as const

/** The picker hand's fixed offsets (see MV): where the hand sits above the carriage centre, at zero reach, and how far ahead of it a held pack sits. */
const HAND_MOUNT = 0.04
const HAND_BASE = 0.8
const PACK_AHEAD = 0.07

// ---------------------------------------------------------------------------------------------
// Top dock ports: port opening, transfer tray, the pod's side hatch
// ---------------------------------------------------------------------------------------------

/** Distance of the dock lane (the pod's centre line) from the island centre line. */
export const DOCK_LANE_OUT = Math.abs(PHARMACY.docks.A[0].z)

/** Height of the held pack's centre when the carriage stands at the sim's drop height (`CONFIG.pharmacy.dropHeight` = the contract's `dockPortY`). */
export const HAND_Y = CONFIG.pharmacy.dropHeight + HAND_MOUNT

/**
 * What a docked pod must offer (the robots' pod draws the actual hatch): the pod hangs on the dock lane with its length
 * along x, so its island-facing side is a plane at `out` = lane - half the pod width. The robots' side hatch is a plate 0.3 m
 * wide hinged on its top edge at `podBottomY + 0.315` and reaching 0.25 m down, so its opening is centred on the held pack's
 * height (`centreY`) and is wider and taller than a pack (a test checks this against `../robots/podParts`).
 */
export const HATCH = { out: DOCK_LANE_OUT - ROBOT.podSize.w / 2, centreY: HAND_Y, w: 0.3, h: 0.25 } as const

/**
 * The transfer tray: a flat plate that rides in a cradle behind the port. Stowed it lies behind the glass with its front edge
 * flush with the glass plane; extended it carries the pack across the gap and pokes `insert` into the hatch. The pack
 * stands on it at `packAt` from the plate's back edge. The plate is narrower than the pack, so the closed fingers of the
 * hand (which holds the pack at the plate's back while it pushes it on) never touch it.
 */
export const TRAY = {
  w: 0.12,
  t: 0.02,
  len: 0.3,
  /** Plate top: 5 mm under the held pack, so the palm (which rides at the pack's foot) clears it. */
  topY: HAND_Y - PACK.y / 2 - 0.005,
  /** Stowed back edge (out). The front edge is flush with the glass. */
  stowedBack: GLASS_OUT - 0.3,
  /** How far the extended plate pokes into the hatch. */
  insert: 0.03,
  /** Where the pack's centre sits on the plate, measured from the plate's back edge. */
  packAt: 0.13,
  /** How much further the pack slides forward, off the plate and into the pod, at the end of the transfer. */
  enter: 0.18,
  /** Cradle under the plate (static): width, thickness, back end (out). */
  cradle: { w: 0.16, t: 0.012, back: 0.8 },
  /** The fastest the plate may move (m/s). */
  maxSpeed: 3.4,
} as const
/** How far the plate travels between stowed and extended. */
export const TRAY_TRAVEL = HATCH.out + TRAY.insert - GLASS_OUT

/** The port opening in the glass, around the tray and the pack standing on it. */
export const PORT = {
  w: 0.26,
  y0: TRAY.topY - 0.055,
  y1: HAND_Y + PACK.y / 2 + 0.04,
  /** Frame bar width around the opening and its depth (out). */
  frame: 0.03,
  frameDepth: 0.06,
  /** The soft dock light sits under the sill, on the rail side (out of the glass). */
  glow: { w: 0.34, h: 0.02, d: 0.05, y: TRAY.topY - 0.055 - 0.05 - 0.01, out: GLASS_OUT + 0.045 },
} as const

/** MedVend dimensions (metres). */
export const MV = {
  kick: 0.12,
  /** Underside of the header. */
  headerY: ISLAND.height - 0.15,
  mastOut: 0.55,
  carriageOut: 0.62,
  carriage: { w: 0.46, h: 0.34, d: 0.3 },
  /** Hand centre at zero reach, how far the hand sits above the carriage centre, and where a held pack sits in front of it. */
  handBase: HAND_BASE,
  handMount: HAND_MOUNT,
  packAhead: PACK_AHEAD,
  bin: { out: 1.07, w: 0.84, h: 0.3, d: 0.18 },
  /** How far the arm reaches into the bin's front pack, and to push a pack onto the tray's back end. */
  reachBin: 0.2,
  reachTray: TRAY.stowedBack + TRAY.packAt - (HAND_BASE + PACK_AHEAD),
  /** The palm and the two fingers (width x, height y, depth out); finger centre offset when open, and travel to close on a pack. */
  palm: { w: 0.3, h: 0.1, d: 0.05 },
  finger: { t: 0.022, h: 0.11, d: 0.12, open: 0.115, travel: 0.03 },
} as const

/**
 * Packs in a stocked bin: 3 across and 2 layers, spaced wide enough that the open fingers fit between them. The pick
 * slot is the middle of the top layer, at the hand's mounting height.
 */
export const BIN_PACKS = { columns: 3, layers: 2, pitchX: 0.24, y0: -0.07, pitchY: 0.11 } as const
export const PICK_SLOT = { x: 0, y: BIN_PACKS.y0 + BIN_PACKS.pitchY }

export interface PanelRect {
  x0: number
  x1: number
  y0: number
  y1: number
}

/**
 * The glass panels of one MedVend face: the full-height pane with a port opening cut out at every dock port of that
 * ward. Rectangles in face space (x, y); the caller places them at `out = GLASS_OUT`.
 */
export function faceGlassPanels(ward: WardId): PanelRect[] {
  const y0 = MV.kick
  const y1 = MV.headerY
  const ports = PHARMACY.docks[ward].map((d) => d.x).sort((a, b) => a - b)
  const hw = PORT.w / 2
  const out: PanelRect[] = []
  let cursor = ISLAND.x0
  for (const px of ports) {
    out.push({ x0: cursor, x1: px - hw, y0, y1 })
    out.push({ x0: px - hw, x1: px + hw, y0, y1: PORT.y0 })
    out.push({ x0: px - hw, x1: px + hw, y0: PORT.y1, y1 })
    cursor = px + hw
  }
  out.push({ x0: cursor, x1: ISLAND.x1, y0, y1 })
  return out
}

// ---------------------------------------------------------------------------------------------
// Walls, pharmacist doors and rail portals of the glass core
// ---------------------------------------------------------------------------------------------

/** A people door in a corridor wall: a sliding glass door for the pharmacist (the pods no longer use doors). */
export interface Opening {
  id: string
  /** 'N' is the z = CORE.z0 wall, 'S' the z = CORE.z1 wall. */
  side: 'N' | 'S'
  /** Wall coordinate of the opening's centre and its clear width. */
  x: number
  z: number
  width: number
  kind: 'people'
  ward: WardId
}

/** The two pharmacist doors, one per ward. */
export const OPENINGS: Opening[] = WARDS.map((w): Opening => {
  const people = DOORS.find((d) => d.id === `pharmacist${w}`)
  if (!people) throw new Error(`No pharmacist door for ward ${w}`)
  return { id: `people:${w}`, side: w === 'A' ? 'N' : 'S', x: people.center.x, z: w === 'A' ? CORE.z0 : CORE.z1, width: people.width, kind: 'people', ward: w }
})

/**
 * A rail portal: a small opening near the top of the core's glass corridor wall, where the rail of one ward leaves
 * (`exit`, at ROBOT.exitX) or re-enters (`entry`, at ROBOT.entryX) the core. The glass below `y0` is continuous.
 */
export interface Portal {
  id: string
  ward: WardId
  kind: 'exit' | 'entry'
  side: 'N' | 'S'
  /** Wall coordinate of the portal's centre line (the circuit's crossing point). */
  x: number
  z: number
}

export const PORTAL = {
  /** Clear width: the pod (0.5 m wide, its corner up to 0.3 m off the centre line on the door turn) with room for its sway. */
  width: 0.8,
  /** Sill and top: from just under the pod's bottom to where the rail's hangers meet the ceiling. */
  y0: ROBOT.podBottomY - 0.05,
  y1: ROBOT.rail.hangerTopY,
  /** Jamb strip width, and the sill's height and extra width each side. */
  jamb: 0.04,
  sill: { h: 0.04, extra: 0.04 },
  /** Frame depth (z) of the jambs and the sill. */
  depth: 0.1,
  /** The flap is split in two halves with this gap between them: the rail's bogie stem always passes through it. */
  slot: 0.26,
  /** The flaps hinge on a line under the rail's underside, on the core side of the wall. */
  hingeY: ROBOT.rail.undersideY,
  hingeOffset: 0.06,
  flapT: 0.012,
  /** Lifted flap angle from hanging (radians, about 85 degrees: nearly horizontal, above the pod). */
  lift: (85 * Math.PI) / 180,
  /** A flap lifts while a pod is within `trigger` metres of the portal and drops `closeAfter` seconds after the last one left. */
  trigger: 2,
  closeAfter: 0.5,
  /** Opening speed (fraction per second of sim time). */
  speed: 1 / 0.35,
} as const

/** The two flap halves of a portal: each hangs from the hinge line, `cx` off the centre line (either side of the central slot), `w` wide and `len` long. */
export const FLAP = {
  w: (PORTAL.width - PORTAL.slot) / 2 - 0.01,
  len: PORTAL.hingeY - PORTAL.y0,
  cx: PORTAL.slot / 2 + 0.005 + ((PORTAL.width - PORTAL.slot) / 2 - 0.01) / 2,
} as const

/** Height of a flap half's lowest edge when it has swung `angle` radians up from hanging (0 = shut, `PORTAL.lift` = open). */
export function flapLowestY(angle: number): number {
  return PORTAL.hingeY - FLAP.len * Math.cos(angle)
}

export const PORTALS: Portal[] = WARDS.flatMap((w): Portal[] => {
  const side = w === 'A' ? 'N' : 'S'
  const z = w === 'A' ? CORE.z0 : CORE.z1
  return [
    { id: `portal-exit:${w}`, ward: w, kind: 'exit', side, x: ROBOT.exitX, z },
    { id: `portal-entry:${w}`, ward: w, kind: 'entry', side, x: ROBOT.entryX, z },
  ]
})

export const WALL_GLASS = { y0: 0.1, y1: WALL.height - 0.05 } as const
/** Frame bars per door leaf (top, bottom and two sides). */
export const BARS_PER_LEAF = 4
export const DOOR = { height: WALL.doorHeight, leafT: 0.03, inset: 0.075, speed: 1 / 0.55, closeAfter: 1, triggerPeople: 1.4 } as const

/** Wall segments (x intervals) of a corridor wall between its pharmacist doors, as {a, b, aOpen, bOpen}. */
export function wallSegments(side: 'N' | 'S'): { a: number; b: number; aOpen: boolean; bOpen: boolean }[] {
  const ops = OPENINGS.filter((o) => o.side === side).sort((p, q) => p.x - q.x)
  const out: { a: number; b: number; aOpen: boolean; bOpen: boolean }[] = []
  let cursor = CORE.x0
  let open = false
  for (const o of ops) {
    out.push({ a: cursor, b: o.x - o.width / 2, aOpen: open, bOpen: true })
    cursor = o.x + o.width / 2
    open = true
  }
  out.push({ a: cursor, b: CORE.x1, aOpen: open, bOpen: false })
  return out
}

/** The portals in a corridor wall, left to right. */
export function portalsOf(side: 'N' | 'S'): Portal[] {
  return PORTALS.filter((p) => p.side === side).sort((p, q) => p.x - q.x)
}

/**
 * The glass of one corridor wall as rectangles (x along the wall, y up): every piece between the pharmacist doors, full
 * height except at the portals, where only the part below the sill exists.
 */
export function wallGlassPanels(side: 'N' | 'S'): PanelRect[] {
  const out: PanelRect[] = []
  const hw = PORTAL.width / 2
  for (const seg of wallSegments(side)) {
    let cursor = seg.a
    for (const p of portalsOf(side)) {
      if (p.x - hw < seg.a || p.x + hw > seg.b) continue
      if (p.x - hw > cursor) out.push({ x0: cursor, x1: p.x - hw, y0: WALL_GLASS.y0, y1: WALL_GLASS.y1 })
      out.push({ x0: p.x - hw, x1: p.x + hw, y0: WALL_GLASS.y0, y1: PORTAL.y0 })
      cursor = p.x + hw
    }
    if (seg.b - cursor > 1e-6) out.push({ x0: cursor, x1: seg.b, y0: WALL_GLASS.y0, y1: WALL_GLASS.y1 })
  }
  return out.filter((r) => r.x1 - r.x0 > 0.01)
}

/** The x intervals of a wall's top frame bar and ranges where frame posts may stand: everything but the portals' jamb-to-jamb gaps. */
export function wallSolidIntervals(a: number, b: number, side: 'N' | 'S'): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = []
  const gap = PORTAL.width / 2 + PORTAL.jamb
  let cursor = a
  for (const p of portalsOf(side)) {
    if (p.x + gap < a || p.x - gap > b) continue
    if (p.x - gap > cursor) out.push({ a: cursor, b: p.x - gap })
    cursor = Math.max(cursor, p.x + gap)
  }
  if (b - cursor > 1e-6) out.push({ a: cursor, b })
  return out
}

// ---------------------------------------------------------------------------------------------
// Desks and the overhead charging rank
// ---------------------------------------------------------------------------------------------

export const DESK = { w: 1.6, d: 0.7, top: 0.76, topT: 0.04 } as const

export interface DeskSpec {
  ward: WardId
  centre: Vec2
  /** Unit vector the pharmacist faces (towards the island). */
  forward: Vec2
  /** Plan rectangle of the whole desk. */
  rect: { x0: number; x1: number; z0: number; z1: number }
}

/** The pharmacist stands at `spot`; the desk is one stride in front of them, towards the island. */
export const DESKS: DeskSpec[] = WARDS.map((w) => {
  const d = PHARMACY.desk[w]
  const forward = { x: Math.sin(d.heading), z: Math.cos(d.heading) }
  const centre = { x: d.spot.x + forward.x * 0.75, z: d.spot.z + forward.z * 0.75 }
  return {
    ward: w,
    centre,
    forward,
    rect: { x0: centre.x - DESK.w / 2, x1: centre.x + DESK.w / 2, z0: centre.z - DESK.d / 2, z1: centre.z + DESK.d / 2 },
  }
})

/**
 * The charging contacts over one rank slot: two slim bars on the sides of the rail (their centres `x` off the rail's centre
 * line, `length` long along the rank), with a thin glow strip along the outer face of each. They sit on the rail itself, above the pod and
 * its bogie's roof, and only the glow follows the charge state.
 */
export const CONTACT = {
  length: 0.3,
  t: 0.012,
  h: 0.04,
  /** Contact centre offset from the rail's centre line, and its height (inside the beam's height above the underside). */
  x: ROBOT.rail.width / 2 + 0.008,
  y: ROBOT.rail.undersideY + 0.025,
  /** The glow strip lies on the contact's outer face. */
  glow: { t: 0.006, h: 0.012, x: ROBOT.rail.width / 2 + 0.008 + 0.006 + 0.003, y: ROBOT.rail.undersideY + 0.025 },
} as const

export interface RankSlot {
  ward: WardId
  /** 0 is the rank head (first pod in line). */
  slot: number
  x: number
  z: number
}

/** One charging slot per pod, at the exact places the idle pods queue in the rank (the rail runs overhead along x = rankX). */
export const RANK_SLOTS: RankSlot[] = WARDS.flatMap((w) => {
  const c = CIRCUITS[w]
  const pitch = ROBOT.podSize.l + CONFIG.pods.minGap
  const p: PathPoint = { x: 0, z: 0, heading: 0 }
  return Array.from({ length: ROBOT.podsPerWard }, (_, k): RankSlot => {
    pointAt(c, c.rankHead - k * pitch, p)
    return { ward: w, slot: k, x: p.x, z: p.z }
  })
})

export interface DockSpec {
  ward: WardId
  /** Index into PHARMACY.docks[ward]. */
  port: number
  x: number
  z: number
}

export const DOCKS: DockSpec[] = WARDS.flatMap((w) => PHARMACY.docks[w].map((d, port): DockSpec => ({ ward: w, port, x: d.x, z: d.z })))

/** Index into DOCKS of a ward's port. */
export function dockIndex(ward: WardId, port: number): number {
  const i = DOCKS.findIndex((d) => d.ward === ward && d.port === port)
  if (i < 0) throw new Error(`No dock ${ward}${port}`)
  return i
}
