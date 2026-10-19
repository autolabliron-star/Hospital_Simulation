/**
 * LayoutBuilder: the pure authoring tool for the hospital's interiors (pattern: Waltz City `interiors/layout/builder.ts`).
 *
 * A piece of the building is written ONCE in local coordinates `(lx, lz)` and placed through a `Frame`: an origin, a
 * heading and an optional mirror. Ward B is ward A mirrored in z (`mirror = -1`): positions are mirrored, geometry
 * winding is never touched (every shape here is symmetric about its own centre, so a mirrored prim is the same prim
 * at the mirrored position with a mirrored heading).
 *
 * Local axes: +lx runs east and +lz runs "forward" when the frame is unrotated and unmirrored. A frame with
 * heading h faces the way a person with heading h faces (0 faces +z, PI/2 faces +x).
 *
 * No three.js and no React in here: the layout is built and tested in node.
 */
import { areaById, wardSign, type ImagingModalityId, type Spot } from '@/sim/places'
import type { SeatKind, SeatPose, SeatSpec, Vec2, WardId } from '@/sim/types'
import type { AreaId, BuildingLayout, CommandWallPanel, ConsoleScreen, Footprint, LabelSpec, MatKey, Prim, Shape, TreeSpec, Vec3Tuple, WallPiece } from './types'

export interface PrimOpts {
  /** Rotation about y, in the frame's own terms (a heading relative to the frame). */
  ry?: number
  /** Lean about the prim's own x axis, radians (positive tilts the front face down). */
  rx?: number
  rz?: number
  /** Corner radius (roundedBox). */
  r?: number
  cast?: boolean
  receive?: boolean
  color?: string
  tile?: number
  /** Overview only: hidden in walk mode (see `Prim.overviewOnly`). */
  overviewOnly?: boolean
  /** Walk only: hidden in the overview (see `Prim.walkOnly`). */
  walkOnly?: boolean
}

export interface FootprintOpts {
  ry?: number
  overhead?: boolean
  serves?: { nodes: string[]; reach: number }
}

export interface SeatOpts {
  /** 'sit' (default) or 'lie'. For a lying seat the heading points from the head toward the feet. */
  pose?: SeatPose
  /** Facing, relative to the frame (0 = local +z). */
  ry?: number
  /** An explicit approach spot in WORLD coordinates (a bed's bedside). Otherwise the builder finds a free one. */
  approach?: Vec2
  /** Directions to try for the approach, as angles relative to the facing, best first. Default: front, then sides, then behind. */
  prefer?: readonly number[]
  /** Farthest the approach may be from the seat (default 1.0 m; a trolley is 2 m long, so its foot is further). */
  far?: number
}

/** A seat waiting for `LayoutBuilder.finish` to pick its approach spot once every footprint is known. */
interface PendingSeat {
  spec: SeatSpec
  explicit: boolean
  prefer: readonly number[]
  far: number
}

/** Default approach directions: straight ahead, the front diagonals, the sides, the rear diagonals, behind. */
const APPROACH_ANGLES: readonly number[] = [0, 0.7, -0.7, Math.PI / 2, -Math.PI / 2, 2.4, -2.4, Math.PI]
/** An approach spot is between this far and that far from the seat, and keeps this clear of every other piece of furniture. */
const APPROACH_NEAR = 0.5
const APPROACH_FAR = 1.0
const APPROACH_CLEAR = 0.4
/** ... and this far inside the walls of its area. */
const APPROACH_WALL = 0.5

/** Shapes smaller than this (largest side, metres) do not cast into the baked sun shadow. */
const CAST_MIN = 0.3

/** Seats for which no free approach spot was found (the tests require this to stay empty). */
export const UNRESOLVED_SEATS: string[] = []

/** Distance from a point to a footprint (0 inside it). */
export function footprintDistance(fp: Footprint, px: number, pz: number): number {
  if (fp.kind === 'circle') return Math.max(0, Math.hypot(px - fp.x, pz - fp.z) - fp.hw)
  const c = Math.cos(fp.rotationY)
  const s = Math.sin(fp.rotationY)
  const dx = px - fp.x
  const dz = pz - fp.z
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.hypot(Math.max(0, Math.abs(lx) - fp.hw), Math.max(0, Math.abs(lz) - fp.hd))
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000

const wrap = (a: number): number => {
  let r = a % (Math.PI * 2)
  if (r > Math.PI) r -= Math.PI * 2
  else if (r <= -Math.PI) r += Math.PI * 2
  return r
}

export class Frame {
  /** Local to world, rows of the 2x2 matrix: x = a lx + b lz + tx, z = c lx + d lz + tz. */
  constructor(
    readonly b: LayoutBuilder,
    readonly a: number,
    readonly bb: number,
    readonly c: number,
    readonly d: number,
    readonly tx: number,
    readonly tz: number,
  ) {}

  static make(b: LayoutBuilder, ox: number, oz: number, heading = 0, mirror: 1 | -1 = 1): Frame {
    const cs = Math.cos(heading)
    const sn = Math.sin(heading)
    return new Frame(b, cs, mirror * sn, -sn, mirror * cs, ox, oz)
  }

  /** +1 for a right-handed frame, -1 for a mirrored one. */
  get mirror(): number {
    return Math.sign(this.a * this.d - this.bb * this.c)
  }

  pt(lx: number, lz: number): { x: number; z: number } {
    return { x: this.a * lx + this.bb * lz + this.tx, z: this.c * lx + this.d * lz + this.tz }
  }

  /** World to local (the 2x2 part is orthogonal, so its inverse is its transpose). */
  toLocal(x: number, z: number): { lx: number; lz: number } {
    const dx = x - this.tx
    const dz = z - this.tz
    return { lx: this.a * dx + this.c * dz, lz: this.bb * dx + this.d * dz }
  }

  /** A local heading (0 = along local +z) as a world heading. */
  heading(rel = 0): number {
    const sx = Math.sin(rel)
    const cz = Math.cos(rel)
    return wrap(Math.atan2(this.a * sx + this.bb * cz, this.c * sx + this.d * cz))
  }

  /** A child frame at a local point, rotated by `rel` (a heading relative to this frame). */
  sub(lx: number, lz: number, rel = 0): Frame {
    const p = this.pt(lx, lz)
    const cs = Math.cos(rel)
    const sn = Math.sin(rel)
    // child local (x, z) -> parent local (x cs + z sn, -x sn + z cs)
    const a = this.a * cs - this.bb * sn
    const bb = this.a * sn + this.bb * cs
    const c = this.c * cs - this.d * sn
    const d = this.c * sn + this.d * cs
    return new Frame(this.b, a, bb, c, d, p.x, p.z)
  }

  // --- primitives (y = bottom of the shape) ----------------------------------------------------------------------

  private push(shape: Shape, mat: MatKey, lx: number, yBottom: number, lz: number, size: Vec3Tuple, o: PrimOpts, fallbackCast: boolean): this {
    const p = this.pt(lx, lz)
    const big = Math.max(size[0], size[1], size[2])
    const glow = mat === 'glowTeal' || mat === 'glowWarm' || mat === 'tintedGlow' || mat === 'laneLine' || mat === 'glass' || mat === 'screen'
    const prim: Prim = {
      shape,
      mat,
      position: [p.x, yBottom + size[1] / 2, p.z],
      size,
      rotationY: this.heading(o.ry ?? 0),
      castShadow: o.cast ?? (fallbackCast && !glow && big >= CAST_MIN),
      receiveShadow: o.receive ?? !glow,
    }
    if (o.rx) prim.rotationX = o.rx
    if (o.rz) prim.rotationZ = o.rz * this.mirror
    if (o.r !== undefined) prim.radius = o.r
    if (o.color !== undefined) prim.color = o.color
    if (o.tile !== undefined) prim.tile = o.tile
    if (o.overviewOnly) prim.overviewOnly = true
    if (o.walkOnly) prim.walkOnly = true
    this.b.prims.push(prim)
    return this
  }

  box(lx: number, y: number, lz: number, w: number, h: number, d: number, mat: MatKey, o: PrimOpts = {}): this {
    return this.push('box', mat, lx, y, lz, [w, h, d], o, true)
  }

  /** A box with soft corners (radius `o.r`, default 0.03). */
  rbox(lx: number, y: number, lz: number, w: number, h: number, d: number, mat: MatKey, o: PrimOpts = {}): this {
    const r = Math.min(o.r ?? 0.03, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)
    return this.push('roundedBox', mat, lx, y, lz, [w, h, d], { ...o, r }, true)
  }

  /** Vertical cylinder; `dia` is the diameter. */
  cyl(lx: number, y: number, lz: number, dia: number, h: number, mat: MatKey, o: PrimOpts = {}): this {
    return this.push('cylinder', mat, lx, y, lz, [dia, h, dia], o, true)
  }

  /** A vertical capsule of total height `h`. */
  capsule(lx: number, y: number, lz: number, dia: number, h: number, mat: MatKey, o: PrimOpts = {}): this {
    return this.push('capsule', mat, lx, y, lz, [dia, h, dia], o, true)
  }

  /** An ellipsoid; `y` is its bottom. */
  sphere(lx: number, y: number, lz: number, dx: number, dy: number, dz: number, mat: MatKey, o: PrimOpts = {}): this {
    return this.push('sphere', mat, lx, y, lz, [dx, dy, dz], o, true)
  }

  /** A ring lying flat (axis up); `o.rx = PI / 2` stands it up. `y` is the bottom of the flat ring. */
  torus(lx: number, y: number, lz: number, outer: number, tube: number, mat: MatKey, o: PrimOpts = {}): this {
    return this.push('torus', mat, lx, y, lz, [outer, tube, outer], o, true)
  }

  /** A flat quad lying on the floor at height `y`, facing up. */
  plane(lx: number, y: number, lz: number, w: number, d: number, mat: MatKey, o: PrimOpts = {}): this {
    const p = this.pt(lx, lz)
    this.b.prims.push({
      shape: 'plane',
      mat,
      position: [p.x, y, p.z],
      size: [w, 0, d],
      rotationY: this.heading(o.ry ?? 0),
      castShadow: false,
      receiveShadow: o.receive ?? true,
      ...(o.color !== undefined ? { color: o.color } : {}),
    })
    return this
  }

  /** A screen: a quad showing atlas tile `tile`, facing local +z, centred at (lx, y, lz). `lean` tilts its face up. */
  screen(lx: number, yc: number, lz: number, w: number, h: number, tile: number, o: PrimOpts & { lean?: number } = {}): this {
    const p = this.pt(lx, lz)
    const lean = o.lean ?? 0
    this.b.prims.push({
      shape: 'quad',
      mat: 'screen',
      position: [p.x, yc, p.z],
      size: [w, h, 0],
      rotationY: this.heading(o.ry ?? 0),
      ...(lean ? { rotationX: -lean } : {}),
      castShadow: false,
      receiveShadow: false,
      tile,
    })
    return this
  }

  /**
   * A flat display: a dark bezel (rounded box) with an atlas tile on its front face. The front looks along local
   * heading `ry` (0 = local +z) and leans back by `lean` radians so it faces up a little. (lx, yc, lz) is the centre.
   */
  display(lx: number, yc: number, lz: number, w: number, h: number, tile: number, o: { ry?: number; lean?: number; t?: number; bezel?: MatKey } = {}): this {
    const ry = o.ry ?? 0
    const lean = o.lean ?? 0
    const t = o.t ?? 0.03
    this.rbox(lx, yc - h / 2, lz, w, h, t, o.bezel ?? 'metalDark', { ry, rx: -lean, r: Math.min(0.012, t / 2 - 0.001), cast: false })
    const k = t / 2 + 0.003
    const nx = Math.sin(ry) * Math.cos(lean)
    const nz = Math.cos(ry) * Math.cos(lean)
    return this.screen(lx + nx * k, yc + Math.sin(lean) * k, lz + nz * k, w - 0.03, h - 0.03, tile, { ry, lean })
  }

  /**
   * A monitor anchor for a scanner console (data only, no geometry): the centre of the screen face at local (lx, yc, lz),
   * facing local heading `ry` (toward the operator). The machines agent draws the monitor there.
   */
  consoleScreen(modality: ImagingModalityId, lx: number, yc: number, lz: number, w: number, h: number, ry = 0): this {
    const p = this.pt(lx, lz)
    this.b.consoleScreens.push({ modality, x: round3(p.x), y: yc, z: round3(p.z), ry: this.heading(ry), w, h })
    return this
  }

  // --- seats ------------------------------------------------------------------------------------------------------

  /**
   * A place to sit or lie at the local point (lx, lz). `height` is the top of the cushion or mattress. The approach spot
   * (0.5-1.0 m away, on the open side) is chosen when the layout is finished.
   */
  seat(id: string, kind: SeatKind, lx: number, lz: number, height: number, o: SeatOpts = {}): this {
    const p = this.pt(lx, lz)
    const heading = this.heading(o.ry ?? 0)
    const spec: SeatSpec = {
      id,
      kind,
      area: this.b.area,
      x: p.x,
      z: p.z,
      heading,
      pose: o.pose ?? 'sit',
      height,
      approach: o.approach ? { x: o.approach.x, z: o.approach.z } : { x: p.x, z: p.z },
    }
    this.b.pendingSeats.push({ spec, explicit: o.approach !== undefined, prefer: o.prefer ?? APPROACH_ANGLES, far: o.far ?? APPROACH_FAR })
    return this
  }

  // --- footprints -------------------------------------------------------------------------------------------------

  /** Floor space of a rectangle `w` (local x) by `d` (local z) centred at the local point. */
  rect(id: string, lx: number, lz: number, w: number, d: number, o: FootprintOpts = {}): this {
    const p = this.pt(lx, lz)
    this.b.footprints.push({
      id,
      area: this.b.area,
      kind: 'rect',
      x: p.x,
      z: p.z,
      hw: w / 2,
      hd: d / 2,
      rotationY: this.heading(o.ry ?? 0),
      ...(o.overhead ? { overhead: true } : {}),
      ...(o.serves ? { serves: o.serves } : {}),
    })
    return this
  }

  circle(id: string, lx: number, lz: number, radius: number, o: FootprintOpts = {}): this {
    const p = this.pt(lx, lz)
    this.b.footprints.push({
      id,
      area: this.b.area,
      kind: 'circle',
      x: p.x,
      z: p.z,
      hw: radius,
      hd: radius,
      rotationY: 0,
      ...(o.overhead ? { overhead: true } : {}),
      ...(o.serves ? { serves: o.serves } : {}),
    })
    return this
  }
}

export class LayoutBuilder {
  readonly prims: Prim[] = []
  readonly footprints: Footprint[] = []
  readonly labels: LabelSpec[] = []
  readonly trees: TreeSpec[] = []
  readonly commandWall: CommandWallPanel[] = []
  readonly consoleScreens: ConsoleScreen[] = []
  readonly pendingSeats: PendingSeat[] = []
  walls: WallPiece[] = []
  /** The area the footprints being added belong to. */
  area: AreaId | 'outside' = 'lobby'

  /** A frame at a world point with a heading (and optional mirror). */
  at(x: number, z: number, heading = 0, mirror: 1 | -1 = 1): Frame {
    return Frame.make(this, x, z, heading, mirror)
  }

  /** The world frame: local = world. */
  get world(): Frame {
    return Frame.make(this, 0, 0, 0, 1)
  }

  /** A frame at a staff spot, facing the way the spot faces. */
  atSpot(s: Spot): Frame {
    return Frame.make(this, s.at.x, s.at.z, s.heading, 1)
  }

  label(spec: Partial<LabelSpec> & Pick<LabelSpec, 'text' | 'x' | 'z'>): void {
    this.labels.push({
      height: 0.9,
      maxWidth: 8,
      color: '#37605b',
      weight: 'regular',
      spacing: 0.08,
      ...spec,
    })
  }

  finish(): BuildingLayout {
    return {
      prims: this.prims,
      footprints: this.footprints,
      labels: this.labels,
      trees: this.trees,
      walls: this.walls,
      commandWall: this.commandWall,
      consoleScreens: this.consoleScreens,
      seats: this.resolveSeats(),
    }
  }

  /** Pick every seat's approach spot, then return the seats sorted by id (so the order never depends on build order). */
  private resolveSeats(): SeatSpec[] {
    const solid = this.footprints.filter((f) => !f.overhead && f.area !== 'outside')
    const seen = new Set<string>()
    for (const { spec, explicit, prefer, far } of this.pendingSeats) {
      if (seen.has(spec.id)) throw new Error(`Duplicate seat id ${spec.id}`)
      seen.add(spec.id)
      if (explicit) continue
      const own = solid.filter((f) => footprintDistance(f, spec.x, spec.z) <= 0.02)
      const others = solid.filter((f) => !own.includes(f))
      const rect = areaById(spec.area as Parameters<typeof areaById>[0]).rect
      const inside = (x: number, z: number) =>
        x > rect.x0 + APPROACH_WALL && x < rect.x1 - APPROACH_WALL && z > rect.z0 + APPROACH_WALL && z < rect.z1 - APPROACH_WALL
      let found = false
      for (const angle of prefer) {
        const h = spec.heading + angle
        const dx = Math.sin(h)
        const dz = Math.cos(h)
        for (let t = APPROACH_NEAR; t <= far + 1e-9 && !found; t += 0.05) {
          const x = spec.x + dx * t
          const z = spec.z + dz * t
          if (!inside(x, z)) continue
          if (own.some((f) => footprintDistance(f, x, z) < APPROACH_CLEAR)) continue
          if (others.some((f) => footprintDistance(f, x, z) < APPROACH_CLEAR)) continue
          spec.approach = { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 }
          found = true
        }
        if (found) break
      }
      if (!found) {
        // keep the seat (so ids stay stable) but make the failure loud: the nav build and the seat tests report it
        spec.approach = { x: spec.x + Math.sin(spec.heading) * 0.7, z: spec.z + Math.cos(spec.heading) * 0.7 }
        UNRESOLVED_SEATS.push(spec.id)
      }
    }
    return this.pendingSeats.map((p) => p.spec).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
}

/** A room frame for ward `w`: local +lx east, local +lz INTO the room from the corridor wall (toward the window). */
export function wardFrame(b: LayoutBuilder, w: WardId, x0: number, wallAbsZ: number): Frame {
  const s = wardSign(w)
  return Frame.make(b, x0, s * wallAbsZ, 0, s)
}
