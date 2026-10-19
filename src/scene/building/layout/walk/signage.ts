/**
 * Wayfinding in the walk-mode building (W1): the hanging signs at `SIGNS` (places.ts) and the plates beside the doors. Pure data.
 * Every word comes from src/content/signs.json (through src/content/signs.ts); the renderer paints the pictures once into one small
 * canvas atlas (../../render/walk/signAtlas.ts) and this module only says what is in each cell and where its quad goes.
 *
 *   hanging sign   a two-sided panel on two rods from the ceiling, its lower edge about 2.2 m up, across the walking line. Each face
 *                  lists the places the sign points to with an arrow seen from THAT face's reader: ahead, left, right or behind. The
 *                  arrows are worked out from the geometry (where the place lies, relative to the way the reader walks), so the two
 *                  faces never contradict each other whatever heading the contract gives.
 *   room plate     the room number ("Room" over "A3") on the corridor wall beside every patient room door, at eye level.
 *   name plate     the name of each main room (content `plates.doors`) beside its door, on the side people come from.
 */
import { DOORS, ROOMS, SIGNS, WALL, areaAt, areaById, ceilingHeight, type AreaId, type DoorSpec } from '@/sim/places'
import { ROOM_PLATE_CAPTION, destinationCopy, doorPlateCopy, signTitle } from '@/content/signs'
import { allSigns } from '@/scene/wayfinding/signsL2'
import { buildWallPieces } from '../walls'
import type { WallPiece } from '../types'
import type { ArrowKind, HangingSign, Plate, QuadPlacement, SignRow, Tile, WalkBox } from './types'

// --- sizes ----------------------------------------------------------------------------------------------------------

/** Atlas cell sizes in pixels, and the size of the picture on the wall in metres (the ratio is the same, so nothing is stretched). */
export const SIGN_TILE = { w: 512, h: 168 } as const
export const SIGN = {
  w: 1.9,
  h: (1.9 * SIGN_TILE.h) / SIGN_TILE.w,
  /** Lower edge above the floor. */
  bottom: 2.2,
  thickness: 0.05,
  /** The frame around the picture. */
  rim: 0.02,
  rod: 0.02,
  rodInset: 0.7,
  /** At most this many places per sign. */
  maxRows: 3,
} as const

export const ROOM_PLATE = { tile: { w: 192, h: 128 }, w: 0.3, h: 0.2 } as const
export const NAME_PLATE = { tile: { w: 320, h: 92 }, w: 0.56, h: (0.56 * 92) / 320 } as const
/** Plates hang with their centre at eye level. */
export const PLATE_Y = 1.5
const PLATE_BACK = 0.02
const PLATE_RIM = 0.015
/** A plate's gap from the door jamb (and the plate must keep at least `PLATE_AT_DOOR` from a door edge, `FACE + 0.03` from a corner). */
const PLATE_GAP = 0.1
const JAMB = 0.035
const PLATE_AT_DOOR = 0.08
const FACE = WALL.thickness / 2
const FRONT_LIFT = 0.002

// --- helpers --------------------------------------------------------------------------------------------------------

const wrapPi = (a: number): number => {
  let r = a % (Math.PI * 2)
  if (r > Math.PI) r -= Math.PI * 2
  else if (r <= -Math.PI) r += Math.PI * 2
  return r
}

/** The footprint of a box `halfAlong` wide along its face and `halfAcross` thick, whose face looks along `heading`. */
export function orientedAabb(cx: number, cz: number, heading: number, halfAlong: number, halfAcross: number): { x0: number; x1: number; z0: number; z1: number } {
  const c = Math.abs(Math.cos(heading))
  const s = Math.abs(Math.sin(heading))
  const ex = c * halfAlong + s * halfAcross
  const ez = s * halfAlong + c * halfAcross
  return { x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez }
}

/** Where an area is for a sign's arrow: the middle of its rectangle. */
function areaPoint(id: AreaId): { x: number; z: number } {
  const r = areaById(id).rect
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }
}

/**
 * Which way a reader who stands at `from` and walks along `facing` turns to reach `target`: ahead (within 40 degrees), behind (more
 * than 140 degrees) or left or right. With x east and z south, the right-hand side of a walker facing (fx, fz) is (-fz, fx).
 */
export function arrowFor(from: { x: number; z: number }, facing: { x: number; z: number }, target: { x: number; z: number }): ArrowKind {
  const dx = target.x - from.x
  const dz = target.z - from.z
  const len = Math.hypot(dx, dz)
  if (len < 1e-6) return 'ahead'
  const fl = Math.hypot(facing.x, facing.z) || 1
  const cos = (dx * facing.x + dz * facing.z) / (len * fl)
  if (cos >= Math.cos((40 * Math.PI) / 180)) return 'ahead'
  if (cos <= Math.cos((140 * Math.PI) / 180)) return 'back'
  const right = (dx * -facing.z + dz * facing.x) / (len * fl)
  return right > 0 ? 'right' : 'left'
}

// --- hanging signs ----------------------------------------------------------------------------------------------------

function signRows(areas: readonly AreaId[], at: { x: number; z: number }, normalHeading: number): SignRow[] {
  // the reader stands in front of the face and walks toward the sign: along the face's normal turned around
  const facing = { x: -Math.sin(normalHeading), z: -Math.cos(normalHeading) }
  return areas.slice(0, SIGN.maxRows).map((id) => {
    const copy = destinationCopy(id)
    const fallback = areaById(id)
    return {
      arrow: arrowFor(at, facing, areaPoint(id)),
      label: copy?.label ?? fallback.label,
      ...((copy?.detail ?? fallback.subtitle) ? { detail: copy?.detail ?? fallback.subtitle } : {}),
      accent: copy?.accent ?? 'neutral',
    }
  })
}

interface Signage {
  boxes: WalkBox[]
  tiles: Tile[]
  quads: QuadPlacement[]
  signs: HangingSign[]
  plates: Plate[]
}

function buildSigns(out: Signage, addTile: (t: Tile) => string): void {
  // R2: level 1's signs (the contract) and level 2's (src/scene/wayfinding/signsL2.ts)
  for (const s of allSigns(SIGNS)) {
    const area = areaAt(s.at.x, s.at.z)
    if (!area) throw new Error(`sign ${s.id} hangs outside the building`)
    const title = signTitle(s.id) ?? area.label
    const faces = [0, 1].map((f) => {
      const heading = wrapPi(s.heading + f * Math.PI)
      const key = `sign:${s.id}:${f === 0 ? 'front' : 'back'}`
      const tile = addTile({ kind: 'sign', key, title, rows: signRows(s.points, s.at, heading), w: SIGN_TILE.w, h: SIGN_TILE.h })
      return { heading, tile }
    })
    const y1 = SIGN.bottom + SIGN.h
    const halfAlong = SIGN.w / 2 + SIGN.rim
    const halfAcross = SIGN.thickness / 2
    out.signs.push({
      id: s.id,
      area: area.id,
      x: s.at.x,
      z: s.at.z,
      heading: wrapPi(s.heading),
      y0: SIGN.bottom - SIGN.rim,
      y1: y1 + SIGN.rim,
      w: SIGN.w,
      halfAlong,
      halfAcross,
      front: faces[0].tile,
      back: faces[1].tile,
    })
    const fp = orientedAabb(s.at.x, s.at.z, s.heading, halfAlong, halfAcross)
    out.boxes.push({ mat: 'wall', part: 'signBody', x0: fp.x0, x1: fp.x1, y0: SIGN.bottom - SIGN.rim, y1: y1 + SIGN.rim, z0: fp.z0, z1: fp.z1 })
    // two rods up to the ceiling
    const ceil = ceilingHeight(area.id) ?? WALL.height
    const tx = Math.cos(s.heading)
    const tz = -Math.sin(s.heading)
    for (const side of [-1, 1]) {
      const rx = s.at.x + tx * side * SIGN.rodInset
      const rz = s.at.z + tz * side * SIGN.rodInset
      out.boxes.push({ mat: 'frame', part: 'signRod', x0: rx - SIGN.rod / 2, x1: rx + SIGN.rod / 2, y0: y1 + SIGN.rim, y1: ceil, z0: rz - SIGN.rod / 2, z1: rz + SIGN.rod / 2 })
    }
    // the two pictures, each a hair off its face
    const cy = SIGN.bottom + SIGN.h / 2
    for (const face of faces) {
      const lift = halfAcross + FRONT_LIFT
      out.quads.push({
        tile: face.tile,
        cx: s.at.x + Math.sin(face.heading) * lift,
        cy,
        cz: s.at.z + Math.cos(face.heading) * lift,
        heading: face.heading,
        w: SIGN.w,
        h: SIGN.h,
      })
    }
  }
}

// --- plates ---------------------------------------------------------------------------------------------------------

/** The wall piece on a line that holds [lo, hi] with `margin` to spare at each end, or null. */
function pieceHolding(pieces: WallPiece[], alongX: boolean, c: number, lo: number, hi: number): WallPiece | null {
  for (const p of pieces) {
    if (p.alongX !== alongX || Math.abs(p.c - c) > 1e-6) continue
    const m0 = p.cutA ? PLATE_AT_DOOR : FACE + 0.03
    const m1 = p.cutB ? PLATE_AT_DOOR : FACE + 0.03
    if (lo >= p.a + m0 - 1e-9 && hi <= p.b - m1 + 1e-9) return p
  }
  return null
}

/** How far a plate's backing sits off the wall's centre line: on the face of a solid wall, on the glass of a glass one. */
const standoff = (p: WallPiece): number => (p.cls === 'solid' ? FACE : 0.035)

function addPlate(out: Signage, kind: 'room' | 'name', id: string, tile: string, w: number, h: number, alongX: boolean, c: number, along: number, s: 1 | -1, p: WallPiece): void {
  const off = standoff(p)
  const heading = alongX ? (s > 0 ? 0 : Math.PI) : s > 0 ? Math.PI / 2 : -Math.PI / 2
  const back0 = c + s * off
  const back1 = c + s * (off + PLATE_BACK)
  const lo = Math.min(back0, back1)
  const hi = Math.max(back0, back1)
  const y0 = PLATE_Y - h / 2 - PLATE_RIM
  const y1 = PLATE_Y + h / 2 + PLATE_RIM
  const a0 = along - w / 2 - PLATE_RIM
  const a1 = along + w / 2 + PLATE_RIM
  out.boxes.push(alongX ? { mat: 'frame', part: 'plateBody', x0: a0, x1: a1, y0, y1, z0: lo, z1: hi } : { mat: 'frame', part: 'plateBody', x0: lo, x1: hi, y0, y1, z0: a0, z1: a1 })
  const face = c + s * (off + PLATE_BACK + FRONT_LIFT)
  out.quads.push({ tile, cx: alongX ? along : face, cy: PLATE_Y, cz: alongX ? face : along, heading, w, h })
  out.plates.push({ kind, id, tile, x: alongX ? along : face, y: PLATE_Y, z: alongX ? face : along, heading, w, h, alongX, line: c })
}

function buildRoomPlates(out: Signage, addTile: (t: Tile) => string, pieces: WallPiece[]): void {
  for (const r of ROOMS) {
    const s: 1 | -1 = r.ward === 'A' ? 1 : -1 // the corridor lies this way from the room's wall
    const along = r.door.x + r.doorWidth / 2 + JAMB + PLATE_GAP + PLATE_RIM + ROOM_PLATE.w / 2
    const p = pieceHolding(pieces, true, r.door.z, along - ROOM_PLATE.w / 2 - PLATE_RIM, along + ROOM_PLATE.w / 2 + PLATE_RIM)
    if (!p) throw new Error(`room plate ${r.id}: no wall beside the door`)
    const tile = addTile({ kind: 'room', key: `room:${r.id}`, caption: ROOM_PLATE_CAPTION, id: r.id, w: ROOM_PLATE.tile.w, h: ROOM_PLATE.tile.h })
    addPlate(out, 'room', r.id, tile, ROOM_PLATE.w, ROOM_PLATE.h, true, r.door.z, along, s, p)
  }
}

/** Which way (+1 or -1 across the wall) the face of door `d` toward its area `a` looks; null when both sides are the same area. */
function faceSide(d: DoorSpec): 1 | -1 | null {
  if (d.a === d.b) return null
  const alongX = d.wallAxis === 'x'
  const probe = alongX ? areaAt(d.center.x, d.center.z - 0.3) : areaAt(d.center.x - 0.3, d.center.z)
  return probe?.id === d.a ? -1 : 1
}

function buildNamePlates(out: Signage, addTile: (t: Tile) => string, pieces: WallPiece[]): void {
  for (const d of DOORS) {
    const copy = doorPlateCopy(d.id)
    if (!copy) continue
    const s = faceSide(d)
    if (s === null) continue
    const alongX = d.wallAxis === 'x'
    const c = alongX ? d.center.z : d.center.x
    const mid = alongX ? d.center.x : d.center.z
    const jamb = d.kind === 'opening' || d.kind === 'counter' ? 0 : JAMB
    let placed = false
    for (const side of [1, -1]) {
      const along = mid + side * (d.width / 2 + jamb + PLATE_GAP + PLATE_RIM + NAME_PLATE.w / 2)
      const p = pieceHolding(pieces, alongX, c, along - NAME_PLATE.w / 2 - PLATE_RIM, along + NAME_PLATE.w / 2 + PLATE_RIM)
      if (!p) continue
      const tile = addTile({ kind: 'name', key: `name:${copy.label}|${copy.sub ?? ''}`, label: copy.label, ...(copy.sub ? { sub: copy.sub } : {}), w: NAME_PLATE.tile.w, h: NAME_PLATE.tile.h })
      addPlate(out, 'name', d.id, tile, NAME_PLATE.w, NAME_PLATE.h, alongX, c, along, s, p)
      placed = true
      break
    }
    if (!placed) throw new Error(`name plate for door ${d.id}: no wall beside it`)
  }
}

/** The hanging signs and plates: boxes (bodies, rods, plate backings), atlas cells and the quads that show them. */
export function buildSignage(pieces: WallPiece[] = buildWallPieces()): Signage {
  const out: Signage = { boxes: [], tiles: [], quads: [], signs: [], plates: [] }
  const seen = new Map<string, Tile>()
  const addTile = (t: Tile): string => {
    if (!seen.has(t.key)) {
      seen.set(t.key, t)
      out.tiles.push(t)
    }
    return t.key
  }
  buildSigns(out, addTile)
  buildRoomPlates(out, addTile, pieces)
  buildNamePlates(out, addTile, pieces)
  return out
}

