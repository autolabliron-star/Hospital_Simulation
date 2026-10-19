/**
 * Plain data shapes of the building layout. Pure (no three.js, no React): the layout is built and tested in node,
 * and the renderer turns it into a few merged meshes per material.
 *
 * Coordinates: metres, x east, z south (north = -z), y up. Headings follow atan2(dx, dz): 0 faces +z.
 */
import type { MatKey } from '@/scene/materials'
import type { AreaId, ImagingModalityId } from '@/sim/places'
import type { SeatSpec } from '@/sim/types'

export type { MatKey, AreaId }

export type Shape =
  | 'box' // size = [w, h, d]
  | 'roundedBox' // size = [w, h, d], radius = corner radius
  | 'cylinder' // size = [diameter x, height, diameter z], vertical axis
  | 'capsule' // size = [diameter, total height, diameter], vertical
  | 'torus' // size = [outer diameter, tube diameter, outer diameter], lying flat (axis y); rotationX = PI/2 stands it up
  | 'sphere' // size = [dx, dy, dz] diameters
  | 'plane' // flat, faces up: size = [w, 0, d]
  | 'quad' // vertical, faces +z before rotation: size = [w, h, 0]; draws atlas tile `tile` (a screen)

export type Vec3Tuple = [number, number, number]

export interface Prim {
  shape: Shape
  mat: MatKey
  /** Centre of the shape. */
  position: Vec3Tuple
  size: Vec3Tuple
  rotationY: number
  rotationX?: number
  rotationZ?: number
  /** Corner radius for roundedBox. */
  radius?: number
  /** Per-object colour (hex). Only for `tinted` / `tintedGlow` shapes, which are drawn as coloured instances. */
  color?: string
  castShadow: boolean
  receiveShadow: boolean
  /** Atlas tile of a `quad` screen. */
  tile?: number
  /**
   * Drawn only in the overview (the architect's cut): hidden while you walk, where the walk-mode parts replace it (W1). Compiled
   * into its own merged meshes, toggled by `visible` only.
   */
  overviewOnly?: true
  /**
   * Drawn only while walking (R2): the OR's ceiling booms, pendants and light heads would hide the architect's cut from above. The
   * mirror of `overviewOnly`: compiled into its own merged meshes, toggled by `visible` only.
   */
  walkOnly?: true
}

/**
 * Space a piece of furniture takes on the floor, for the keep-clear tests (and, later, for the people's nav).
 * `serves` marks furniture that is the destination of a nav node (a seat, a counter, a bed): the nodes, and every
 * edge passing within `reach` metres of them, are exempt for this footprint.
 */
export interface Footprint {
  id: string
  /** The area the furniture belongs to; it must stay inside that area's rect ('outside' = the grounds). */
  area: AreaId | 'outside'
  kind: 'rect' | 'circle'
  x: number
  z: number
  /** Half extents along the footprint's own x / z axes (rect), or hw = radius (circle). */
  hw: number
  hd: number
  rotationY: number
  /** Overhead or wall-mounted things that people walk under / past are listed too, but flagged. */
  overhead?: boolean
  serves?: { nodes: string[]; reach: number }
}

/** A text label lying on the floor. */
export interface LabelSpec {
  text: string
  x: number
  z: number
  /** Letter height in metres (the width follows the text). */
  height: number
  maxWidth: number
  color: string
  weight: 'light' | 'regular' | 'medium'
  /** Letter spacing, in em. */
  spacing: number
}

export interface TreeSpec {
  x: number
  z: number
  /** Total height in metres. */
  height: number
  /** Canopy tint (hex). */
  tint: string
  /** 0..1 variation for the blob arrangement. */
  seed: number
}

/**
 * Where a live monitor goes on a scanner console (a control-room desk, the X-ray booth). The layout draws the desk and NO
 * monitor: the animated machines (src/scene/imaging) put a bezel, a stand and the live picture at each anchor.
 */
export interface ConsoleScreen {
  modality: ImagingModalityId
  /** Centre of the screen face (world metres). */
  x: number
  y: number
  z: number
  /** Heading of the screen's normal (the way it faces: toward the operator). */
  ry: number
  /** Width and height of the picture. */
  w: number
  h: number
}

export interface BuildingLayout {
  prims: Prim[]
  footprints: Footprint[]
  labels: LabelSpec[]
  trees: TreeSpec[]
  /** Pieces of wall as derived (for tests and for other layers that need the wall lines). */
  walls: WallPiece[]
  /** The curved video wall of the command center: panel centres/headings, for the live-map texture. */
  commandWall: CommandWallPanel[]
  /** Monitor anchors on the scanner consoles (two per MRI and CT control room, one in the X-ray booth). */
  consoleScreens: ConsoleScreen[]
  /**
   * Every place someone sits or lies (deterministic, ids stable, sorted by id). Each has its true seat height and a
   * walkable `approach` spot (see `SeatSpec`); the nav graph gets a node at every approach and the sim's `SeatRegistry`
   * hands them out. Ids read `<kind>:<group>:<local>` (e.g. `waiting:er:S1:2`, `bed:A3`, `visitor:A3`).
   */
  seats: SeatSpec[]
}

export type WallClass = 'solid' | 'glassFull' | 'glassCut' | 'skip'

export interface WallPiece {
  /** True for a wall running along x (constant z = `c`); false for one running along z (constant x = `c`). */
  alongX: boolean
  c: number
  a: number
  b: number
  outline: boolean
  /** The end at `a` / `b` is a door or drawer cut (so it is not extended to fill the corner). */
  cutA: boolean
  cutB: boolean
  cls: WallClass
}

export interface CommandWallPanel {
  x: number
  z: number
  /** Heading of the screen's normal (the way it faces). */
  heading: number
  width: number
  y0: number
  height: number
  /** 0..1 slice of the wall texture this panel shows. */
  u0: number
  u1: number
}
