/**
 * W4 lab: where everything of the automated lab is, as plain numbers (no three.js, no React). The static room (src/scene/rooms/lab.ts) draws
 * its housings from these, the rig (rig.ts) puts its moving parts and the instanced tubes on them, and the tests measure them against the
 * contract (src/sim/places.ts LAB, src/sim/labTrack.ts), so the picture and the sim never disagree about where a puck stops.
 *
 * Metres, y up, x east, z south. The lab is x -31..-25, z 16..22 (wall centre lines); the walls are 0.2 thick, so furniture lives inside
 * x -30.9..-25.1, z 16.1..21.9.
 */
import { LAB, type LabModuleKind } from '@/sim/places'
import { labTrackPointInto, LAB_STOPS } from '@/sim/labTrack'

export const TUBE = { r: 0.0085, h: 0.075, sink: 0.012 } as const
export const PUCK = { r: 0.022, h: 0.024 } as const
export const CAP = { r: 0.0098, h: 0.016 } as const

/** Bench: top of the track belt (the contract's `LAB.benchY`), the slab under it, and the half width of the bench round the track centre line. */
export const BENCH = { y: LAB.benchY, slabTop: LAB.benchY - 0.012, slabThick: 0.04, half: 0.15 } as const
/** Where a tube standing in a puck on the belt has its bottom, and where its cap sits. */
export const TUBE_BASE_Y = BENCH.y + PUCK.h - TUBE.sink
export const CAP_BASE_Y = TUBE_BASE_Y + TUBE.h

/** The face of a module that looks at the track. */
export type Face = 'e' | 'w' | 'n' | 's'

export interface Housing {
  id: string
  kind: LabModuleKind
  x0: number
  x1: number
  z0: number
  z1: number
  /** Height of the housing's top. */
  h: number
  /** Which face looks at the track (a west module looks east, a south one north, an east one west). */
  face: Face
}

/**
 * The module housings, in the sample order. They are drawn a little deeper than the contract's `across` so they touch the bench, and kept
 * inside the walls (0.1 m in from each area edge). Every housing contains the contract's `center`.
 */
export const HOUSINGS: readonly Housing[] = [
  { id: 'cfg0', kind: 'centrifuge', x0: -30.9, x1: -30.15, z0: 17.6, z1: 18.3, h: 0.96, face: 'e' },
  { id: 'cfg1', kind: 'centrifuge', x0: -30.9, x1: -30.15, z0: 18.4, z1: 19.1, h: 0.96, face: 'e' },
  { id: 'decap', kind: 'decapper', x0: -30.85, x1: -30.15, z0: 19.2, z1: 19.7, h: 1.25, face: 'e' },
  { id: 'haem', kind: 'haematology', x0: -29.675, x1: -28.825, z0: 21.15, z1: 21.9, h: 1.25, face: 'n' },
  { id: 'chem', kind: 'chemistry', x0: -28.775, x1: -27.325, z0: 21.15, z1: 21.9, h: 1.42, face: 'n' },
  { id: 'immuno', kind: 'immunoassay', x0: -27.275, x1: -26.325, z0: 21.15, z1: 21.9, h: 1.25, face: 'n' },
  { id: 'coag', kind: 'coagulation', x0: -25.8, x1: -25.1, z0: 19.8, z1: 20.4, h: 1.2, face: 'w' },
  { id: 'recap', kind: 'recapper', x0: -25.8, x1: -25.1, z0: 19.175, z1: 19.625, h: 1.25, face: 'w' },
  { id: 'archive', kind: 'archive', x0: -25.8, x1: -25.1, z0: 18.4, z1: 19.1, h: 1.9, face: 'w' },
]
const HOUSING_BY_ID = new Map(HOUSINGS.map((h) => [h.id, h]))
export function housingOf(id: string): Housing {
  const h = HOUSING_BY_ID.get(id)
  if (!h) throw new Error(`lab: no housing ${id}`)
  return h
}

/** The bench: the U's three legs as boxes (x0, x1, z0, z1). */
export const BENCH_LEGS: readonly { id: string; x0: number; x1: number; z0: number; z1: number }[] = [
  { id: 'west', x0: -30.15, x1: -29.85, z0: 16.8, z1: 21.15 },
  { id: 'south', x0: -29.85, x1: -26.1, z0: 20.85, z1: 21.15 },
  { id: 'east', x0: -26.1, x1: -25.8, z0: 18.25, z1: 21.15 },
]

/** The two turntables: the loop's start (where the sorter puts tubes on the belt) and the far end of the outbound lane. */
export const TURNTABLES: readonly { id: string; x: number; z: number; r: number }[] = [
  { id: 'start', x: LAB.track[0].x, z: LAB.track[0].z, r: 0.17 },
  { id: 'end', x: LAB.track[5].x, z: LAB.track[5].z, r: 0.17 },
]

/** The stop of a module on the outbound lane (world x, z) and its distance along the loop. */
export function stopPoint(id: string): { x: number; z: number; s: number } {
  const s = LAB_STOPS[id]
  if (s === undefined) throw new Error(`lab: no stop for ${id}`)
  const p = labTrackPointInto(s, { x: 0, z: 0 })
  return { x: p.x, z: p.z, s }
}

// ---------------------------------------------------------------------------------------------
// Centrifuges
// ---------------------------------------------------------------------------------------------

export const CFG_COUNT = 2
/** Centrifuge i: the opening, the rotor, the lid hinge. The rim stands 0.1 m above the body top. */
export function centrifuge(i: number) {
  const h = housingOf(`cfg${i}`)
  const cx = (h.x0 + h.x1) / 2
  const cz = (h.z0 + h.z1) / 2
  return {
    h,
    cx,
    cz,
    bodyTop: 0.86,
    rimTop: h.h,
    openHalf: 0.25,
    /** The rotor's centre (its disc top is `rotorTop`) and radius; 24 buckets on a ring of `bucketR`. */
    rotor: { x: cx, y: 0.88, z: cz, r: 0.235, top: 0.91, bucketR: 0.18, buckets: 24 },
    /** The lid hinges along z at the housing's west edge and swings up and over to the west (rotation about z by `LID_MAX`). */
    hinge: { x: h.x0 + 0.01, y: h.h, z: cz },
    lid: { len: h.x1 - h.x0 - 0.02, depth: h.z1 - h.z0 - 0.02, thick: 0.05 },
  }
}
export const LID_MAX = 1.75
/** The most the rotor turns on screen (revolutions per second): faster than this and 60 Hz frames alias into a standstill. */
export const ROTOR_MAX_REV_PER_S = 4

// ---------------------------------------------------------------------------------------------
// Probes, grippers, the camera arch
// ---------------------------------------------------------------------------------------------

export const PROBE_IDS = ['haem', 'chem', 'immuno', 'coag'] as const
export type ProbeId = (typeof PROBE_IDS)[number]
/** Probe tip height at rest and fully dipped (into an uncapped tube: its mouth is at CAP_BASE_Y). */
export const PROBE_Y = { rest: 1.03, dip: CAP_BASE_Y - 0.012, rodLen: 0.12 } as const

/** The arm of an analyser over the track and where its probe hangs (the module's stop on the outbound lane). */
export function probeAt(id: ProbeId) {
  const h = housingOf(id)
  const p = stopPoint(id)
  return { h, x: p.x, z: p.z }
}

export const GRIPPER_IDS = ['decap', 'recap', 'sort'] as const
export type GripperId = (typeof GRIPPER_IDS)[number]
export const GRIPPER_Y = { rest: 1.08, down: 0.985 } as const
export function gripperAt(id: GripperId): { x: number; z: number } {
  if (id === 'sort') return { x: LAB.track[0].x - LAB.laneGap / 2, z: LAB.track[0].z }
  const p = stopPoint(id)
  return { x: p.x, z: p.z }
}

/** The quality camera: a portal over the belt at the camera stop. */
export const CAMERA_ARCH = { z0: 17.24, z1: 17.46, xLeft: -30.15, xRight: -29.85, post: 0.045, beamY0: 1.12, beamY1: 1.24 } as const

// ---------------------------------------------------------------------------------------------
// The receive station, the totem, the review desk
// ---------------------------------------------------------------------------------------------

/** The receive station: the cabinet under the trunk's drop, its hood, and the face the sorter works through. */
export const RECEIVE = { x0: -30.35, x1: -29.45, z0: 16.1, z1: 16.8, h: 1.3, hoodTop: 1.5, hoodR: 0.085 } as const
/** The hood's axis (where the pipe drops in), and how many landed tubes wait inside it on the hopper floor. */
export const RECEIVE_HOOD = { x: LAB.receive.x, z: LAB.receive.z, slots: 4, ring: 0.035 } as const
/** The review desk: its footprint, and which way its screen faces (west, towards the scientist's spot LAB.tech[0]). */
export const DESK = { x0: -27.4, x1: -26.7, z0: 19.05, z1: 19.65, top: 0.74 } as const
/** The status totem: body and the front that faces the corridor (north). */
export const TOTEM = { x: LAB.statusTotem.x, z: LAB.statusTotem.z, w: 0.5, d: 0.1, h: 1.6 } as const

// ---------------------------------------------------------------------------------------------
// Status screens (W4 atlas tiles): where each quad sits
// ---------------------------------------------------------------------------------------------

/** The bezel of a status screen stands this far off its wall; the quad sits 4 mm in front of it. */
export const BEZEL = 0.02

export interface ScreenAnchor {
  at: { x: number; y: number; z: number }
  heading: number
  w: number
  h: number
  tilt?: number
}
export const SCREENS: Readonly<Record<'labStatus' | 'centrifuge' | 'labReceive' | 'archive', ScreenAnchor>> = {
  /** On the totem's north face, readable from the corridor through the glass front. */
  labStatus: { at: { x: TOTEM.x, y: 1.36, z: TOTEM.z - TOTEM.d / 2 - BEZEL - 0.004 }, heading: Math.PI, w: 0.4, h: 0.25 },
  /** On the west wall above the centrifuges, facing the lab. */
  centrifuge: { at: { x: -30.9 + BEZEL + 0.004, y: 1.62, z: 18.35 }, heading: Math.PI / 2, w: 0.48, h: 0.3 },
  /** On the receive station's face. */
  labReceive: { at: { x: (RECEIVE.x0 + RECEIVE.x1) / 2, y: 1.12, z: RECEIVE.z1 + BEZEL + 0.004 }, heading: 0, w: 0.32, h: 0.2 },
  /** Above the archive's glass door, facing the lab. */
  archive: { at: { x: -25.8 - BEZEL - 0.004, y: 1.75, z: 18.75 }, heading: -Math.PI / 2, w: 0.32, h: 0.2 },
}

// ---------------------------------------------------------------------------------------------
// The archive racks (display only): where the fridge's 48 tubes stand
// ---------------------------------------------------------------------------------------------

export const ARCHIVE_SHOWN = 48
const ARCHIVE_SHELVES = [0.98, 1.2, 1.42] as const
const ARCHIVE_COLS = 8
const ARCHIVE_ROWS = 2

/** The bottom-centre of archive display tube `k` (0..47): 3 shelves of 2 rows of 8, filling from the bottom shelf up. */
export function archiveTubeAt(k: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const h = housingOf('archive')
  const perShelf = ARCHIVE_COLS * ARCHIVE_ROWS
  const shelf = Math.floor(k / perShelf) % ARCHIVE_SHELVES.length
  const j = k % perShelf
  const col = j % ARCHIVE_COLS
  const row = Math.floor(j / ARCHIVE_COLS)
  out.x = h.x0 + 0.17 + row * 0.19
  out.z = h.z0 + 0.1 + col * ((h.z1 - h.z0 - 0.2) / (ARCHIVE_COLS - 1))
  out.y = ARCHIVE_SHELVES[shelf] + 0.03
  return out
}
export const ARCHIVE_SHELF_Y = ARCHIVE_SHELVES
