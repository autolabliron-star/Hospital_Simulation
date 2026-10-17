/**
 * Upper walls (W1 walk mode): the building closes above the architect's section cut. Pure data (boxes), derived from the same wall pieces
 * as the cut walls, so the two always meet:
 *
 *   solid       a wall box from the cut (a hair below it, so the darker cap strip is hidden) up to `WALL.height`;
 *   glassCut    the outer shell's glazing continues to the ceiling in the same mullion rhythm (a floor-to-ceiling window wall), with a
 *               top rail; the cap rail of the cut glazing stays as the transom at 1.3 m;
 *   glassFull   already full height: nothing to add;
 *   skip        the pharmacy core's own glass box: nothing to add (only its ceiling, see ./ceilings.ts).
 *
 * Over every door a wall lintel closes the opening above `WALL.doorHeight`, and doors that have a leaf get full-height frames
 * (jambs from the cut to the head, and the head). Over every MedDrawer gap the wall continues above the cabinet (it is flush with the
 * cut). Nothing here is ever lower than the cut, so the door openings stay clear below `doorHeight`.
 */
import { DOORS, ROOMS, WALL, type DoorSpec } from '@/sim/places'
import { DOOR_FRAME_ACROSS, glazingPanelCount, glazingSpans } from '../shell'
import { DRAWER_GAP, buildWallPieces } from '../walls'
import type { WallPiece } from '../types'
import type { WalkBox, WalkBoxMat, WalkPart } from './types'

const T = WALL.thickness
const CUT = WALL.cutHeight
const H = WALL.height
const DOOR_H = WALL.doorHeight
const CAP = 0.04
/** The upper wall is a touch thicker than the cut wall, so it hides the cap strip's edges without z-fighting (the door frames are thicker still). */
const SKIN = 0.004
/** Top rail of the upper glazing. */
const RAIL = 0.07

/** The doors of the core's glass box belong to the pharmacy builder (S2); everything else gets lintels, frames and leaves here. */
export const CORE_DOOR_IDS: readonly string[] = ['pharmacistA', 'pharmacistB']
export const isWalkDoor = (d: DoorSpec): boolean => !CORE_DOOR_IDS.includes(d.id)

/** A box centred on a wall line segment [a, b], `across` thick. */
export function lineBox(alongX: boolean, c: number, a: number, b: number, y0: number, y1: number, across: number, mat: WalkBoxMat, part: WalkPart): WalkBox {
  return alongX
    ? { mat, part, x0: a, x1: b, y0, y1, z0: c - across / 2, z1: c + across / 2 }
    : { mat, part, x0: c - across / 2, x1: c + across / 2, y0, y1, z0: a, z1: b }
}

function solidUpper(out: WalkBox[], p: WallPiece): void {
  const a = p.a - (p.cutA ? 0 : T / 2)
  const b = p.b + (p.cutB ? 0 : T / 2)
  out.push(lineBox(p.alongX, p.c, a, b, CUT - CAP, H, T + SKIN, 'wall', 'upperWall'))
}

function glazingUpper(out: WalkBox[], p: WallPiece, pieces: WallPiece[]): void {
  const top = H - RAIL
  for (const [a, b] of glazingSpans(p, pieces)) {
    const len = b - a
    const n = glazingPanelCount(len)
    const pw = len / n
    out.push(lineBox(p.alongX, p.c, a, b, top, H, 0.12, 'frame', 'glazingFrame'))
    for (let i = 0; i <= n; i++) out.push(lineBox(p.alongX, p.c, a + i * pw - 0.025, a + i * pw + 0.025, CUT, top, 0.1, 'frame', 'glazingFrame'))
    for (let i = 0; i < n; i++) out.push(lineBox(p.alongX, p.c, a + i * pw + 0.025, a + (i + 1) * pw - 0.025, CUT, top, 0.025, 'glass', 'glazing'))
  }
}

/** The lintel above a door opening, and (for a door with a leaf) the full-height frame. */
function doorParts(out: WalkBox[], d: DoorSpec): void {
  const alongX = d.wallAxis === 'x'
  const c = alongX ? d.center.z : d.center.x
  const mid = alongX ? d.center.x : d.center.z
  const h = d.width / 2
  out.push(lineBox(alongX, c, mid - h - 0.02, mid + h + 0.02, DOOR_H, H, T, 'wall', 'lintel'))
  if (d.kind === 'opening' || d.kind === 'counter') return
  // the same footprint as the cut-height jambs of the shell (centred on the opening's edge), carried up to the head
  for (const s of [-1, 1]) out.push(lineBox(alongX, c, mid + s * h - 0.035, mid + s * h + 0.035, CUT, DOOR_H, DOOR_FRAME_ACROSS, 'frame', 'doorFrame'))
  out.push(lineBox(alongX, c, mid - h - 0.035, mid + h + 0.035, DOOR_H - 0.06, DOOR_H, DOOR_FRAME_ACROSS, 'frame', 'doorFrame'))
}

/** All upper walls, lintels, door frames and drawer fills (the outer glazing included). */
export function buildUpperWalls(pieces: WallPiece[] = buildWallPieces()): WalkBox[] {
  const out: WalkBox[] = []
  for (const p of pieces) {
    if (p.cls === 'solid') solidUpper(out, p)
    else if (p.cls === 'glassCut') glazingUpper(out, p, pieces)
  }
  for (const d of DOORS) if (isWalkDoor(d)) doorParts(out, d)
  for (const r of ROOMS) out.push(lineBox(true, r.drawer.z, r.drawer.x - DRAWER_GAP / 2, r.drawer.x + DRAWER_GAP / 2, CUT, H, T, 'wall', 'drawerFill'))
  return out
}
