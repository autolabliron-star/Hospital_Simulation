/**
 * Plain data of the walk-mode building (W1): the parts that only exist when you walk the hospital at eye level (upper walls up to
 * 3 m, lintels, door frames, ceilings, handrails, hanging signs, door plates and the door leaves). Pure (no three.js, no React, no
 * DOM): built and tested in node. The overview never draws any of it; `layout.prims` is untouched (the M2 tests keep passing).
 *
 * Coordinates: metres, x east, z south (north = -z), y up. Headings follow atan2(dx, dz): 0 faces +z.
 */
import type { AreaId } from '@/sim/places'
import type { SignAccent } from '@/content/signs'

/** The palette materials walk-only boxes use. */
export type WalkBoxMat = 'wall' | 'frame' | 'glass'

export type WalkPart =
  | 'upperWall'
  | 'drawerFill'
  | 'lintel'
  | 'doorFrame'
  | 'glazing'
  | 'glazingFrame'
  | 'rail'
  | 'railBracket'
  | 'guard'
  | 'signBody'
  | 'signRod'
  | 'plateBody'

/** An axis-aligned box (every wall, frame and rail in this building runs along x or z). */
export interface WalkBox {
  mat: WalkBoxMat
  part: WalkPart
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

/**
 * A ceiling quad over (part of) an area. The UVs repeat one ceiling cell (5 x 5 tiles with a light panel in the middle) `nx` times
 * along x and `nz` times along z over the WHOLE area, so a quad cut at a chunk edge keeps the pattern running through.
 */
export interface CeilingPiece {
  area: AreaId
  y: number
  x0: number
  x1: number
  z0: number
  z1: number
  /** UV at (x0, z0) and (x1, z1). */
  u0: number
  u1: number
  v0: number
  v1: number
}

export type ArrowKind = 'ahead' | 'left' | 'right' | 'back'

export interface SignRow {
  arrow: ArrowKind
  label: string
  detail?: string
  accent: SignAccent
}

/** What gets painted into one cell of the sign atlas. `key` is unique per picture (identical pictures share a cell). */
export type Tile =
  | { kind: 'sign'; key: string; title: string; rows: SignRow[]; w: number; h: number }
  | { kind: 'room'; key: string; caption: string; id: string; w: number; h: number }
  | { kind: 'name'; key: string; label: string; sub?: string; w: number; h: number }

/** A flat picture on a wall or a sign: an atlas tile on a quad whose normal points along `heading` (atan2(dx, dz)). */
export interface QuadPlacement {
  tile: string
  cx: number
  cy: number
  cz: number
  heading: number
  /** Width and height in metres. */
  w: number
  h: number
}

/** A hanging wayfinding sign: a two-sided panel on two rods from the ceiling. */
export interface HangingSign {
  id: string
  area: AreaId
  x: number
  z: number
  /** The front face's normal (the contract's `SIGNS[].heading`); the back face looks the opposite way. */
  heading: number
  /** Panel bottom and top (metres above the floor). */
  y0: number
  y1: number
  /** Panel width across the walking line. */
  w: number
  /** Footprint of the panel and its body: half the width along the panel, half the thickness across it. */
  halfAlong: number
  halfAcross: number
  /** Atlas tiles of the two faces. */
  front: string
  back: string
}

export type PlateKind = 'room' | 'name'

/** A plate on a wall beside a door. */
export interface Plate {
  kind: PlateKind
  /** The room id (kind 'room') or the door id (kind 'name'). */
  id: string
  tile: string
  /** Centre of the plate's face. */
  x: number
  y: number
  z: number
  /** The face's normal. */
  heading: number
  w: number
  h: number
  /** The wall line the plate is on: along-axis of the wall and its constant coordinate. */
  alongX: boolean
  line: number
}

/** A door that moves: sliding leaves (`auto`) or one double-acting leaf (`swing`, W3: it swings away from whoever opens it). */
export interface WalkDoor {
  id: string
  kind: 'auto' | 'swing'
  /** Centre of the opening on the wall line. */
  x: number
  z: number
  width: number
  /** The wall runs along this axis ('x': people pass along z). */
  wallAxis: 'x' | 'z'
  /** Unit vector along the wall (+x or +z) and across it. */
  along: { x: number; z: number }
  /** auto: the leaves sit this far off the wall line (signed, across the wall) so they clear a thin glass sheet, and slide into the wall. */
  offset: number
  /**
   * swing: +1 hinge at the +along jamb, -1 at the other; `into` is the unit vector of the DEFAULT swing side (the room beyond). The doors are
   * double-acting (W3): the door bank picks +1 (toward `into`) or -1 (the other side) each time a shut door starts to open, away from the
   * body that opened it (render/walk/doorBank.ts `swing`).
   */
  hinge: 1 | -1
  into: { x: number; z: number }
  /** swing: the widest the leaf opens (radians), chosen so its sweep clears every footprint. */
  maxAngle: number
  /** Instance colour of a swing leaf. */
  color: string
  /** How close (metres) somebody sets it off, measured from the centre of the opening. */
  sense: number
}

export interface WalkLayout {
  boxes: WalkBox[]
  ceilings: CeilingPiece[]
  tiles: Tile[]
  quads: QuadPlacement[]
  signs: HangingSign[]
  plates: Plate[]
  doors: WalkDoor[]
}
