/**
 * The shell: floors, walls at the section cut, glazing, door frames and sliding door leaves.
 * Pure: it only appends primitives to a LayoutBuilder.
 */
import { AREAS, DOORS, ROOMS, WALL, type Area, type DoorSpec } from '@/sim/places'
import type { Frame, LayoutBuilder } from './builder'
import { buildWallPieces } from './walls'
import type { MatKey, WallPiece } from './types'

/** Walls start a little below the floor so no sliver of ground shows under them. */
const BELOW = 0.06
const THICK = WALL.thickness
const CUT = WALL.cutHeight
const CAP = 0.04

/** Floor material per area (see the palette table in docs/M2-ART.md). `null` = drawn by someone else. */
export function floorMaterial(a: Area): MatKey | null {
  switch (a.id) {
    case 'core':
      return null // S2 draws the pharmacy core floor
    case 'triage':
    case 'er':
    case 'hubA':
    case 'hubB':
    case 'staffA':
      return 'floorMint'
    case 'command':
      return 'floorSlate'
    case 'diagnostics':
    case 'lab': // W4: the automated lab is a clean clinical room like the imaging suite
    case 'mri':
    case 'ct':
    case 'xray':
    case 'ultrasound':
      return 'floorBlue' // the imaging suite's clinical rooms
    case 'mriControl':
    case 'ctControl':
      return 'floorMint' // control rooms: staff areas, calmer than the scan rooms
    case 'atrium':
      return 'stonePath'
    case 'loungeA':
    case 'quietB':
      return 'floorOak'
    // R2 level 2: the theatre side is clean surgical vinyl (cool blue-grey), pre-op and recovery a soft mint like triage and the ER,
    // the lifts and the theatre corridor terrazzo, and the family lounge warm oak
    case 'l2Hall':
    case 'l2Or':
    case 'l2Sterile':
      return 'floorBlue'
    case 'l2PreOp':
    case 'l2Pacu':
    case 'l2Staff':
      return 'floorMint'
    case 'l2Lounge':
      return 'floorOak'
    case 'l2Corridor':
    case 'l2LiftA':
    case 'l2LiftB':
      return 'floorTerrazzo'
    default:
      return a.kind === 'room' ? 'floorOak' : 'floorTerrazzo'
  }
}

export function buildFloors(b: LayoutBuilder): void {
  const w = b.world
  for (const a of AREAS) {
    const mat = floorMaterial(a)
    if (!mat) continue
    const r = a.rect
    w.plane((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2, r.x1 - r.x0, r.z1 - r.z0, mat)
  }
}

// ---------------------------------------------------------------------------------------------
// Walls and glazing
// ---------------------------------------------------------------------------------------------

/** World frame helper: a box centred on a wall line segment [a, b] of the given piece. */
function lineBox(w: Frame, p: WallPiece, a: number, b: number, y: number, h: number, across: number, mat: MatKey, cast = true): void {
  const mid = (a + b) / 2
  const len = b - a
  if (p.alongX) w.box(mid, y, p.c, len, h, across, mat, { cast })
  else w.box(p.c, y, mid, across, h, len, mat, { cast })
}

/** A thin box at a point ON the wall line at position `t` along it (a post). */
function post(w: Frame, p: WallPiece, t: number, y: number, h: number, along: number, across: number, mat: MatKey): void {
  if (p.alongX) w.box(t, y, p.c, along, h, across, mat)
  else w.box(p.c, y, t, across, h, along, mat)
}

function solidWall(w: Frame, p: WallPiece): void {
  const a = p.a - (p.cutA ? 0 : THICK / 2)
  const b = p.b + (p.cutB ? 0 : THICK / 2)
  lineBox(w, p, a, b, -BELOW, CUT - CAP + BELOW, THICK, 'wall')
  lineBox(w, p, a, b, CUT - CAP, CAP, THICK, 'wallCap')
}

/** x or z positions where a perpendicular wall meets the line of this piece (room partitions meeting the glazing). */
function breaksOf(p: WallPiece, pieces: WallPiece[]): number[] {
  const out = new Set<number>()
  for (const q of pieces) {
    if (q.alongX === p.alongX || q.cls === 'skip') continue
    const touches = Math.abs(q.a - p.c) < 0.011 || Math.abs(q.b - p.c) < 0.011
    if (touches && q.c > p.a + 0.05 && q.c < p.b - 0.05) out.add(q.c)
  }
  return [...out].sort((x, y) => x - y)
}

/** One run of floor-to-cut glazing between two points of the line: glass panels in slim mullions, a base rail and a cap rail. */
function glazingRun(w: Frame, p: WallPiece, a: number, b: number): void {
  const len = b - a
  if (len < 0.3) return
  const n = glazingPanelCount(len)
  const pw = len / n
  lineBox(w, p, a, b, 0, 0.07, 0.12, 'frame')
  lineBox(w, p, a, b, CUT - 0.05, 0.05, 0.12, 'frame')
  for (let i = 0; i <= n; i++) post(w, p, a + i * pw, 0.07, CUT - 0.12, 0.05, 0.1, 'frame')
  for (let i = 0; i < n; i++) {
    const t0 = a + i * pw + 0.025
    const t1 = a + (i + 1) * pw - 0.025
    lineBox(w, p, t0, t1, 0.07, CUT - 0.12, 0.025, 'glass', false)
  }
}

/**
 * The runs of glazing of an outer-shell piece: the piece's span, split where partitions meet it so the mullions line up with them.
 * Shared with the walk-mode upper glazing (./walk/upperWalls.ts), which continues the same mullions up to the ceiling.
 */
export function glazingSpans(p: WallPiece, pieces: WallPiece[]): [number, number][] {
  const a = p.a + (p.cutA ? 0 : THICK / 2)
  const b = p.b - (p.cutB ? 0 : THICK / 2)
  const stops = [a, ...breaksOf(p, pieces).flatMap((t) => [t - THICK / 2, t + THICK / 2]), b]
  const out: [number, number][] = []
  for (let i = 0; i + 1 < stops.length; i += 2) if (stops[i + 1] - stops[i] >= 0.3) out.push([stops[i], stops[i + 1]])
  return out
}

/** Panels in a glazing run of this length (the same count for the cut glazing and the walk-mode glazing above it). */
export function glazingPanelCount(len: number): number {
  return Math.max(1, Math.round(len / 1.3))
}

/** Floor-to-cut glazing of the outer shell, split where partitions meet it so the mullions line up with them. */
function glazingCut(w: Frame, p: WallPiece, pieces: WallPiece[]): void {
  for (const [a, b] of glazingSpans(p, pieces)) glazingRun(w, p, a, b)
}

/** A full-height glass partition: tall panels in a slim frame. */
function glazingFull(w: Frame, p: WallPiece): void {
  const a = p.a + (p.cutA ? 0 : THICK / 2)
  const b = p.b - (p.cutB ? 0 : THICK / 2)
  const len = b - a
  if (len < 0.3) return
  const H = WALL.height
  const n = Math.max(1, Math.round(len / 2.2))
  const pw = len / n
  lineBox(w, p, a, b, 0, 0.12, 0.1, 'frame')
  lineBox(w, p, a, b, H - 0.07, 0.07, 0.1, 'frame')
  for (let i = 0; i <= n; i++) post(w, p, a + i * pw, 0.12, H - 0.19, 0.06, 0.08, 'frame')
  for (let i = 0; i < n; i++) {
    const t0 = a + i * pw + 0.03
    const t1 = a + (i + 1) * pw - 0.03
    lineBox(w, p, t0, t1, 0.12, H - 0.19, 0.025, 'glass', false)
  }
}

/**
 * How deep a door frame is across the wall: a few millimetres proud of both wall faces, so the frame's faces never share a plane with
 * the wall's (the two materials would shimmer against each other at eye level). The walk-mode frames above the cut use it too.
 */
export const DOOR_FRAME_ACROSS = THICK + 0.008

/** Slim frame jambs either side of a door opening (cut height). */
function jambs(w: Frame, d: DoorSpec): void {
  if (d.kind === 'opening' || d.kind === 'counter') return
  const h = d.width / 2
  const alongZ = d.wallAxis === 'z'
  for (const s of [-1, 1]) {
    const t = s * h
    if (alongZ) w.box(d.center.x, 0, d.center.z + t, DOOR_FRAME_ACROSS, CUT, 0.07, 'frame')
    else w.box(d.center.x + t, 0, d.center.z, 0.07, CUT, DOOR_FRAME_ACROSS, 'frame')
  }
}

/**
 * Sliding door leaf of a patient room, parked open on the corridor side of the wall, to the east of the opening
 * (a soft mint panel: one of the few colour accents along the corridor). It stays 0.5 m clear of the robot lane.
 */
function roomDoorLeaves(w: Frame): void {
  for (const r of ROOMS) {
    const s = r.ward === 'A' ? -1 : 1 // the room lies on this side of the wall; the corridor on the other
    const z = r.door.z - s * (THICK / 2 + 0.022)
    const x0 = r.door.x + r.doorWidth / 2 + 0.02
    // overview only: walking, the room door is the swing leaf of the walk-mode building (src/scene/building/render/walk)
    w.box(x0 + 0.65, 0, z, 1.3, CUT - 0.1, 0.035, 'wallMint', { cast: false, overviewOnly: true })
    w.box(x0 + 0.3, CUT - 0.1, z, 2.0, 0.05, 0.05, 'frame', { cast: false, overviewOnly: true }) // top track
  }
}

export function buildWalls(b: LayoutBuilder): WallPiece[] {
  const w = b.world
  const pieces = buildWallPieces()
  for (const p of pieces) {
    if (p.cls === 'solid') solidWall(w, p)
    else if (p.cls === 'glassCut') glazingCut(w, p, pieces)
    else if (p.cls === 'glassFull') glazingFull(w, p)
  }
  for (const d of DOORS) {
    if (d.id === 'pharmacistA' || d.id === 'pharmacistB') continue // S2's glass core
    jambs(w, d)
  }
  roomDoorLeaves(w)
  b.walls = pieces
  return pieces
}
