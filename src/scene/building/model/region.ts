/**
 * Which procedural prims the authored model replaces, as CELLS: every replaced prim is assigned to the zone that draws it, and the procedural
 * compilers put each zone's prims in meshes of their own (render/compile.ts `compileLayout`'s hook returns the cell; WalkBuilding.tsx compiles
 * each zone's walk parts apart). A cell is drawn while its zone is not (still loading, streaming, or failed: ./cells.ts) and hidden in the
 * same frame the zone appears, so the building never has a hole and a failed zone gives back exactly its own region (WP-7, now per zone).
 * Nothing is rebuilt at runtime. Without `?building=model` there is no coverage and the default build is byte-for-byte unchanged.
 *
 * Two coverages, chosen once before the procedural building mounts (src/scene/building/index.tsx):
 *
 *   zones   (manifest.json lists zones) the pipeline's rule (tools/arch/export-plan.ts, ./zones.ts): an area belongs to the zone that lists it
 *           (its floor; walking, its ceilings), a door line (and a ward room's drawer chute, the walk building's fill above it) to the zone
 *           of its centre, a wall line to the zone of the piece's centre, a span of outer glazing to the zone of the span's centre. Only zones the manifest lists get cells; the rest stays procedural.
 *   pilot   (no manifest) the pilot lobby: one cell, `pilot`, by the old rule (an area, wall piece or door whose CENTRE is in PILOT_REGION).
 *
 * Furniture (`replaces`, per zone; the manifest's list, else the defaults below): designed furniture in the model replaces procedural pieces.
 *   "lobby"                  everything the lobby builder emits (desk, seat rows, planters, side table) except the kiosks, screens and bezels
 *   "footprint:<id>"         the prims standing inside that layout footprint (oriented rect + 0.1 m); "footprint:<prefix>*" for a family
 *   "rect:<x0>,<x1>,<z0>,<z1>"  the same for a rect of your own (drawn metres, on the zone's level): for footprint-less pieces (the blood-draw
 *                            curtains and their rail). Same exceptions as `area:`; no trees.
 *   "area:<areaId>"          every layout prim whose CENTRE lies in that area's rect (on its level), except the shell (floors, walls, door lines:
 *                            those follow the zone rule above) and what is always kept; also the layout trees standing in the rect (they are
 *                            instanced meshes, not prims: `cellOfTree`). For a zone whose design replaces the whole interior (the atrium).
 * Screens and their bezels (`quad`, `screen`, `metalDark` above 1 m) always stay, and so do the sim's seats, footprints and collision (they
 * are data, never prims). Furniture that only shares an architecture material (triage dividers, the imaging glass) is never touched.
 *
 * Prims carry only material and position, so the cells are precomputed once as keys `mat|x|z` of the exact prims the shell and the builders emit.
 */
import { AREAS, DOORS, ROOMS, type Area } from '@/sim/places'
import { levelOf, type LevelId } from '@/sim/levels'
import type { MatKey } from '@/scene/materials'
import { buildLobby } from '@/scene/rooms/lobby'
import { getLayout } from '../layout'
import { LayoutBuilder } from '../layout/builder'
import { buildFloors, buildWalls, glazingSpans } from '../layout/shell'
import type { Footprint, Prim, WallPiece } from '../layout/types'
import type { WalkPart } from '../layout/walk/types'
import { DRAWER_GAP, buildWallPieces } from '../layout/walls'
import { cellReplaced } from './cells'
import { drawnX, parseRectKey, zoneAtSim, zoneDef, zoneOfArea } from './zones'

export const PILOT_REGION = { x0: -62.5, x1: -30, z0: -16.5, z1: 16.5 } as const

export const inPilotRegion = (x: number, z: number): boolean => x >= PILOT_REGION.x0 && x <= PILOT_REGION.x1 && z >= PILOT_REGION.z0 && z <= PILOT_REGION.z1

/** The pilot's one cell. */
export const PILOT_CELL = 'pilot'

/** Furniture a zone replaces when the manifest says nothing: the lobby zone is the pilot's design (tools/arch/lobby.py), which has its furniture. */
export const DEFAULT_REPLACES: Readonly<Record<string, readonly string[]>> = { lobby: ['lobby'] }

export type WalkPartMat = 'wall' | 'frame' | 'glass' | 'ceiling'

/**
 * The kind of a walk box (layout/walk/types.ts `WalkPart`), when the hook is given it. The corridor rails, their brackets and the corner guards stand
 * off the wall line, so they take the cell of the nearest wall line within RAIL_REACH instead of needing to lie on it.
 */
export type WalkPartKind = WalkPart

/** How far (m) from a wall line a rail, bracket or guard may stand and still belong to it (RAIL 0.19 m, guard 0.12 m from the centre line). */
export const RAIL_REACH = 0.2
const STANDOFF_PARTS: ReadonlySet<string> = new Set(['rail', 'railBracket', 'guard'])

/** What one coverage decides. */
export interface Coverage {
  kind: 'pilot' | 'zones'
  /** The cells (zone ids, or `pilot`), in order. */
  cells: readonly string[]
  /** The cell of a layout prim (centre x, z in sim coordinates; material), or null: not replaced. */
  cellOfPrim(mat: MatKey, x: number, z: number): string | null
  /** The cell of a walk-mode box (its centre) or ceiling tile, or null. */
  cellOfWalkPart(mat: WalkPartMat, x: number, z: number, part?: WalkPartKind): string | null
  /** The cell of a layout tree (its base x, z in sim coordinates), or null: a tree stands in the rect of an `area:` key of a listed zone. */
  cellOfTree(x: number, z: number): string | null
}

export interface CoverageZone {
  id: string
  /** Furniture keys (see the header); null takes DEFAULT_REPLACES. */
  replaces: readonly string[] | null
}

// --- shared geometry --------------------------------------------------------------------------------------------------------------------------

interface Line {
  alongX: boolean
  c: number
  a: number
  b: number
  owner: string | null
}

const LINE_TOL = 0.02
const keyOf = (mat: string, x: number, z: number): string => `${mat}|${x.toFixed(3)}|${z.toFixed(3)}`

/** The area whose rect holds (x, z) on that level (the smallest, so a room inside a hall wins), or null. */
function areaAt(level: LevelId, x: number, z: number): Area | null {
  let best: Area | null = null
  let bestA = Infinity
  for (const a of AREAS) {
    const r = a.rect
    if (levelOf(r.x0) !== level || x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue
    const s = (r.x1 - r.x0) * (r.z1 - r.z0)
    if (s < bestA) {
      best = a
      bestA = s
    }
  }
  return best
}

function lineAt(lines: readonly Line[], x: number, z: number, tol = LINE_TOL): Line | null {
  for (const l of lines) {
    const across = l.alongX ? z : x
    const along = l.alongX ? x : z
    if (Math.abs(across - l.c) <= tol && along >= l.a && along <= l.b) return l
  }
  return null
}

/** The door lines (the opening plus its frame), each with an owner from `ownerOf(door centre)`. */
function doorLines(ownerOf: (x: number, z: number) => string | null): Line[] {
  return DOORS.map((d) => {
    const alongX = d.wallAxis === 'x'
    const mid = alongX ? d.center.x : d.center.z
    return { alongX, c: alongX ? d.center.z : d.center.x, a: mid - d.width / 2 - 0.05, b: mid + d.width / 2 + 0.05, owner: ownerOf(d.center.x, d.center.z) }
  })
}

/** The line whose centre line is nearest to (x, z) within `reach` (across), among those the point lies along. */
function nearestLine(lines: readonly Line[], x: number, z: number, reach: number): Line | null {
  let best: Line | null = null
  let bd = reach + 1e-9
  for (const l of lines) {
    const across = Math.abs((l.alongX ? z : x) - l.c)
    const along = l.alongX ? x : z
    if (across < bd && along >= l.a && along <= l.b) {
      bd = across
      best = l
    }
  }
  return best
}

/** Lobby prims that stay: the self check-in kiosks (inside their footprints), the screens and the screens' bezels (above the desk top). */
function lobbyPrimStays(p: Prim, kiosks: { x: number; z: number; hw: number; hd: number }[]): boolean {
  if (keptAlways(p)) return true
  const [x, , z] = p.position
  return kiosks.some((k) => Math.abs(x - k.x) <= Math.max(k.hw, k.hd) + 0.2 && Math.abs(z - k.z) <= Math.max(k.hw, k.hd) + 0.2)
}

/** Screens and their bezels are live (atlas tiles, status screens): never replaced. */
const keptAlways = (p: Prim): boolean => p.shape === 'quad' || p.mat === 'screen' || (p.mat === 'metalDark' && p.position[1] > 1.0)

function insideFootprint(p: Prim, f: Footprint, pad: number): boolean {
  const dx = p.position[0] - f.x
  const dz = p.position[2] - f.z
  if (f.kind === 'circle') return Math.hypot(dx, dz) <= f.hw + pad
  const c = Math.cos(f.rotationY)
  const s = Math.sin(f.rotationY)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) <= f.hw + pad && Math.abs(lz) <= f.hd + pad
}

const AREA_PREFIX = 'area:'

interface LevelRect {
  level: LevelId
  r: Area['rect']
}

/** The rect of an area id, or null when there is no such area. */
function areaRect(id: string): LevelRect | null {
  const a = AREAS.find((o) => o.id === id)
  return a ? { level: levelOf(a.rect.x0), r: a.rect } : null
}

const inLevelRect = (a: LevelRect, x: number, z: number): boolean => levelOf(x) === a.level && x >= a.r.x0 && x <= a.r.x1 && z >= a.r.z0 && z <= a.r.z1

/** The keys of the shell prims (floors and walls of both levels): `area:` never takes those, they follow the zone rule. */
let shellKeySet: Set<string> | null = null
function shellKeys(): Set<string> {
  if (shellKeySet) return shellKeySet
  const out = new Set<string>()
  for (const p of shell().prims) out.add(keyOf(p.mat, p.position[0], p.position[2]))
  shellKeySet = out
  return out
}

const matches = (id: string, pattern: string): boolean => (pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern)

/** The furniture prim keys a `replaces` list names. Unknown keys are reported, not fatal. */
export function furnitureKeys(replaces: readonly string[], unknown: string[] = [], level: LevelId = 1): Set<string> {
  const out = new Set<string>()
  for (const r of replaces) {
    if (r === 'lobby') {
      const lobby = new LayoutBuilder()
      buildLobby(lobby)
      const kiosks = lobby.footprints.filter((f) => f.id.startsWith('lobby:kiosk'))
      for (const p of lobby.prims) if (!lobbyPrimStays(p, kiosks)) out.add(keyOf(p.mat, p.position[0], p.position[2]))
    } else if (r.startsWith('footprint:')) {
      const pattern = r.slice('footprint:'.length)
      const layout = getLayout()
      const fps = layout.footprints.filter((f) => matches(f.id, pattern))
      if (fps.length === 0) unknown.push(r)
      for (const p of layout.prims) if (!keptAlways(p) && fps.some((f) => insideFootprint(p, f, 0.1))) out.add(keyOf(p.mat, p.position[0], p.position[2]))
    } else if (r.startsWith(AREA_PREFIX)) {
      const area = areaRect(r.slice(AREA_PREFIX.length))
      if (!area) {
        unknown.push(r)
        continue
      }
      const shellOnly = shellKeys()
      for (const p of getLayout().prims) {
        if (keptAlways(p) || !inLevelRect(area, p.position[0], p.position[2])) continue
        const k = keyOf(p.mat, p.position[0], p.position[2])
        if (!shellOnly.has(k)) out.add(k)
      }
    } else if (r.startsWith('rect:')) {
      const rect = parseRectKey(r)
      if (!rect) {
        unknown.push(r)
        continue
      }
      const shellOnly = shellKeys()
      for (const p of getLayout().prims) {
        const [x, , z] = p.position
        if (keptAlways(p) || levelOf(x) !== level || drawnX(x) < rect.x0 || drawnX(x) > rect.x1 || z < rect.z0 || z > rect.z1) continue
        const k = keyOf(p.mat, x, z)
        if (!shellOnly.has(k)) out.add(k)
      }
    } else unknown.push(r)
  }
  return out
}

/** The rects of the `area:` keys of a replaces list, for the trees. Unknown areas are skipped (furnitureKeys reports them). */
function areaRectsOf(replaces: readonly string[]): LevelRect[] {
  const out: LevelRect[] = []
  for (const r of replaces) {
    const a = r.startsWith(AREA_PREFIX) ? areaRect(r.slice(AREA_PREFIX.length)) : null
    if (a) out.push(a)
  }
  return out
}

/** The prims of the shell (floors and walls on both levels) and the wall pieces they were built from. */
function shell(): { prims: Prim[]; pieces: WallPiece[] } {
  const b = new LayoutBuilder()
  buildFloors(b)
  const pieces = buildWalls(b)
  return { prims: b.prims, pieces }
}

const isFloor = (p: Prim): boolean => p.shape === 'plane' && p.position[1] <= 0.01

/** Build a coverage from its parts: line owners, an area rule, the furniture keys. */
function makeCoverage(
  kind: Coverage['kind'],
  cells: readonly string[],
  lines: readonly Line[],
  areaCell: (level: LevelId, x: number, z: number) => string | null,
  furniture: ReadonlyMap<string, string>,
  treeCell: (x: number, z: number) => string | null = () => null,
): Coverage {
  let primCells: Map<string, string> | null = null
  const primMap = (): Map<string, string> => {
    if (primCells) return primCells
    const out = new Map<string, string>()
    for (const p of shell().prims) {
      const [x, , z] = p.position
      const cell = isFloor(p) ? areaCell(levelOf(x), x, z) : (lineAt(lines, x, z)?.owner ?? null)
      if (cell) out.set(keyOf(p.mat, x, z), cell)
    }
    for (const [k, cell] of furniture) if (!out.has(k)) out.set(k, cell)
    primCells = out
    return out
  }
  return {
    kind,
    cells,
    cellOfPrim: (mat, x, z) => primMap().get(keyOf(mat, x, z)) ?? null,
    cellOfWalkPart: (mat, x, z, part) =>
      mat === 'ceiling'
        ? areaCell(levelOf(x), x, z)
        : part !== undefined && STANDOFF_PARTS.has(part)
          ? (nearestLine(lines, x, z, RAIL_REACH)?.owner ?? null)
          : (lineAt(lines, x, z)?.owner ?? null),
    cellOfTree: treeCell,
  }
}

// --- the pilot ----------------------------------------------------------------------------------------------------------------------------

/** A wall piece is the pilot's when it is on level 1 and its centre is in the region. */
export function coversPiece(p: WallPiece): boolean {
  if (p.cls === 'skip') return false
  const [x, z] = p.alongX ? [(p.a + p.b) / 2, p.c] : [p.c, (p.a + p.b) / 2]
  return levelOf(x) === 1 && inPilotRegion(x, z)
}

/** An area is the pilot's (floor, ceiling) when it is on level 1 and its centre is in the region. */
export function coversArea(a: Area): boolean {
  const x = (a.rect.x0 + a.rect.x1) / 2
  const z = (a.rect.z0 + a.rect.z1) / 2
  return levelOf(a.rect.x0) === 1 && inPilotRegion(x, z)
}

/** The pilot lobby's coverage (one cell): the rule of tools/arch/shell.py for `?building=model` without a manifest. */
export function pilotCoverage(): Coverage {
  const lines: Line[] = []
  for (const p of buildWallPieces()) if (coversPiece(p)) lines.push({ alongX: p.alongX, c: p.c, a: p.a - 1e-6, b: p.b + 1e-6, owner: PILOT_CELL })
  for (const l of doorLines((x, z) => (levelOf(x) === 1 && inPilotRegion(x, z) ? PILOT_CELL : null))) if (l.owner) lines.push(l)
  const furniture = new Map<string, string>()
  for (const k of furnitureKeys(['lobby'])) furniture.set(k, PILOT_CELL)
  return makeCoverage('pilot', [PILOT_CELL], lines, (level, x, z) => {
    if (level !== 1) return null
    const a = areaAt(1, x, z)
    return a && coversArea(a) ? PILOT_CELL : null
  }, furniture)
}

// --- the zones ----------------------------------------------------------------------------------------------------------------------------

/**
 * The coverage of the zones the manifest lists. Door lines come first (a jamb at a door cut is the door's), then the wall pieces; an outer
 * glazing piece is split into its spans, each owned by the zone of its centre. Owners outside `zones` are dropped (that part stays procedural).
 */
export function zoneCoverage(zones: readonly CoverageZone[], unknown: string[] = []): Coverage {
  const ids = new Set(zones.map((z) => z.id))
  const own = (id: string | null): string | null => (id && ids.has(id) ? id : null)
  const lines: Line[] = doorLines((x, z) => own(zoneAtSim(x, z)))
  // the drawer chutes cut the ward rooms' walls like doors: the walk building fills the gap above the cabinet; the zone that owns the chute
  // (its centre) draws that fill
  for (const r of ROOMS) lines.push({ alongX: true, c: r.drawer.z, a: r.drawer.x - DRAWER_GAP / 2 - 0.05, b: r.drawer.x + DRAWER_GAP / 2 + 0.05, owner: own(zoneAtSim(r.drawer.x, r.drawer.z)) })
  const pieces = buildWallPieces()
  for (const p of pieces) {
    if (p.cls === 'skip') continue
    const at = (t: number): string | null => own(p.alongX ? zoneAtSim(t, p.c) : zoneAtSim(p.c, t))
    if (p.cls === 'glassCut') {
      const spans = glazingSpans(p, pieces)
      // each span, out to the middle of the partition gap on either side, so the posts at its ends are its own
      spans.forEach(([a, b], i) => {
        const lo = i === 0 ? p.a - 1e-6 : (spans[i - 1][1] + a) / 2
        const hi = i === spans.length - 1 ? p.b + 1e-6 : (b + spans[i + 1][0]) / 2
        lines.push({ alongX: p.alongX, c: p.c, a: lo, b: hi, owner: at((a + b) / 2) })
      })
      if (spans.length === 0) lines.push({ alongX: p.alongX, c: p.c, a: p.a - 1e-6, b: p.b + 1e-6, owner: at((p.a + p.b) / 2) })
    } else lines.push({ alongX: p.alongX, c: p.c, a: p.a - 1e-6, b: p.b + 1e-6, owner: at((p.a + p.b) / 2) })
  }
  const furniture = new Map<string, string>()
  const treeRects: { cell: string; area: LevelRect }[] = []
  for (const z of zones) {
    const list = z.replaces ?? DEFAULT_REPLACES[z.id] ?? []
    for (const k of furnitureKeys(list, unknown, zoneDef(z.id)?.level ?? 1)) if (!furniture.has(k)) furniture.set(k, z.id)
    for (const area of areaRectsOf(list)) treeRects.push({ cell: z.id, area })
  }
  return makeCoverage('zones', zones.map((z) => z.id), lines, (level, x, z) => {
    const a = areaAt(level, x, z)
    return a ? own(zoneOfArea(a.id)) : null
  }, furniture, (x, z) => {
    for (const t of treeRects) if (inLevelRect(t.area, x, z)) return t.cell
    return null
  })
}

// --- the active coverage (chosen once, before the procedural building mounts) ----------------------------------------------------------------

let active: Coverage | null = null

/** Set by src/scene/building/index.tsx once it knows whether there is a manifest (before BuildingMeshes / WalkBuilding mount). */
export function setCoverage(c: Coverage | null): void {
  active = c
}
export const getCoverage = (): Coverage | null => active

/** The hook of render/compile.ts (`compileLayout`'s third argument): the cell of a prim, or null. */
export const primCell = (mat: MatKey, x: number, z: number): string | null => active?.cellOfPrim(mat, x, z) ?? null

/** The hook of the walk building (`compileWalk`): the cell of a walk part, or null. */
export const walkPartCell = (mat: WalkPartMat, x: number, z: number, part?: WalkPartKind): string | null => active?.cellOfWalkPart(mat, x, z, part) ?? null

/** The hook of render/compile.ts for the layout trees: the cell of a tree (it stands in the rect of an `area:` key), or null. */
export const treeCell = (x: number, z: number): string | null => active?.cellOfTree(x, z) ?? null

/** Is this prim hidden right now (its cell's model is drawn)? */
export const hidesPrim = (mat: MatKey, x: number, z: number): boolean => {
  const c = primCell(mat, x, z)
  return c !== null && cellReplaced(c)
}

/** Is this walk part hidden right now (its cell's model is drawn)? */
export const hidesWalkPart = (mat: WalkPartMat, x: number, z: number, part?: WalkPartKind): boolean => {
  const c = walkPartCell(mat, x, z, part)
  return c !== null && cellReplaced(c)
}
