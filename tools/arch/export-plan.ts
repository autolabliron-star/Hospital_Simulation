/**
 * Wave 3 "The architectural model", step 1: the floor plan Blender builds the realistic hospital from.
 *
 * The sim's floor plan (src/sim/places.ts) stays the single truth: people walk, collide and see by it, so the authored model must be built
 * TO it, never beside it. This dumps everything architectural to JSON for the Blender generator (tools/arch/*.py):
 *   - the frame: metres, x east, z south, y up; the storey (WALL), the building's rectangle, level 2's strip (sim x = drawn x + 150);
 *   - every area (rectangle, kind, level, ceiling height or open sky);
 *   - every door (centre, width, the wall it is in, auto / swing / opening);
 *   - the exact wall pieces the walk-mode building and the collision use (scene/building/layout/walls.ts `buildWallPieces`), with their class
 *     (solid, glass to the ceiling, glazing to the cut) and which ends are door cuts;
 *   - the view windows, the ward rooms' drawer chutes;
 *   - `furniture` (look pass): on both levels (x as drawn), the procedural layout's seats (the sim's seat points), footprints (the collision
 *     rects/circles) and stations (footprints that are a nav node's destination), so Blender places designed pieces exactly on them;
 *   - (zone rollout) the zone that owns each area, wall piece, glazing span, door and furniture anchor (tools/arch/zones.json, `zoneOf`), so the
 *     Blender generator builds each zone's glb from exactly its own pieces and the runtime can hide the procedural shell zone by zone.
 * Pure data; run with `npm run arch:plan` (writes assets-src/arch/plan.json, gitignored like the other conversion inputs).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { AREAS, BUILDING, DOORS, ROOMS, VIEW_WINDOWS, WALL, ceilingHeight } from '../../src/sim/places'
import { LEVEL2_DX, LEVEL2_FOOTPRINT, LEVEL_Y, levelOf } from '../../src/sim/levels'
import { DRAWER_GAP, buildWallPieces } from '../../src/scene/building/layout/walls'
import { buildLayout } from '../../src/scene/building/layout'
import { glazingSpans } from '../../src/scene/building/layout/shell'
import zonesJson from './zones.json'

const round = (v: number): number => Math.round(v * 1000) / 1000

// --- zones (tools/arch/zones.json, orchestrator-owned) -------------------------------------------------------------------------------------------
type Rect = { x0: number; x1: number; z0: number; z1: number }
export interface ZoneDef {
  id: string
  level: 1 | 2
  label: string
  rects: Rect[]
  areas: string[]
  status: string
}
export interface ZonesJson {
  version: number
  zones: ZoneDef[]
  budgets: { perZone: { draws: number; tris: number; lightmapMB: number }; sharedMaterialTexturesMB: number }
}
export const ZONES = zonesJson as unknown as ZonesJson

const EPS = 1e-6
const inRect = (x: number, z: number, r: Rect): boolean => x >= r.x0 - EPS && x <= r.x1 + EPS && z >= r.z0 - EPS && z <= r.z1 + EPS
const rectDist = (x: number, z: number, r: Rect): number => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1))

/**
 * The zone that owns a point (drawn frame) on a level: the FIRST zone in zones.json order on that level whose rects contain it (borders count,
 * so a line on the border between two zones goes to the one listed first), else the nearest zone of that level. The coverage rule of the zone
 * rollout: an area belongs to the zone that lists it; a wall piece, door or furniture anchor to `zoneOf` its centre; a span of outer glazing
 * (`glassCut`, split at the partitions meeting it) to `zoneOf` the span's centre. Every piece is built WHOLE by its owner.
 */
export function zoneOf(level: 1 | 2, x: number, z: number, zones: ZoneDef[] = ZONES.zones): string {
  const mine = zones.filter((zn) => zn.level === level)
  const hit = mine.find((zn) => zn.rects.some((r) => inRect(x, z, r)))
  if (hit) return hit.id
  let best = mine[0]?.id ?? ''
  let bd = Infinity
  for (const zn of mine)
    for (const r of zn.rects) {
      const d = rectDist(x, z, r)
      if (d < bd) [bd, best] = [d, zn.id]
    }
  return best
}

/** The zone that lists an area (zones.json `areas`). */
export function zoneOfArea(areaId: string, zones: ZoneDef[] = ZONES.zones): string {
  const owners = zones.filter((zn) => zn.areas.includes(areaId))
  if (owners.length !== 1) throw new Error(`area ${areaId} is listed by ${owners.length} zones in tools/arch/zones.json (must be exactly 1)`)
  return owners[0].id
}

/** A sim x as drawn (level 2 is moved back over the building and up a storey when it is drawn). */
const drawnX = (simX: number): number => (levelOf(simX) === 2 ? simX - LEVEL2_DX : simX)

export interface PlanJson {
  version: 1
  frame: { units: 'm'; x: 'east'; z: 'south'; y: 'up'; note: string }
  wall: typeof WALL
  building: { x0: number; x1: number; z0: number; z1: number }
  levels: { id: 1 | 2; y: number; footprint: { x0: number; x1: number; z0: number; z1: number } }[]
  areas: { id: string; label: string; kind: string; level: 1 | 2; rect: { x0: number; x1: number; z0: number; z1: number }; ceiling: number | null; zone: string }[]
  doors: { id: string; level: 1 | 2; x: number; z: number; width: number; wallAxis: 'x' | 'z'; kind: string; a: string; b: string; zone: string }[]
  /** `spans` (glassCut only): the glazing runs between the partitions meeting the piece (layout/shell.ts glazingSpans), along a..b as drawn. */
  walls: {
    level: 1 | 2
    alongX: boolean
    c: number
    a: number
    b: number
    cls: string
    outline: boolean
    cutA: boolean
    cutB: boolean
    zone: string
    spans?: { a: number; b: number; zone: string }[]
  }[]
  viewWindows: { id: string; level: 1 | 2; alongX: boolean; c: number; a: number; b: number }[]
  drawerChutes: { room: string; x: number; z: number; width: number }[]
  furniture: FurnitureJson
}

/** The procedural layout's furniture anchors inside the building, both levels, x AS DRAWN (level 2: sim x - 150), each with its level and
 * owning zone. Headings follow atan2(dx, dz). `region` is the building's rectangle. */
export interface FurnitureJson {
  region: { x0: number; x1: number; z0: number; z1: number }
  seats: { id: string; kind: string; area: string; level: 1 | 2; zone: string; x: number; z: number; heading: number; height: number; pose: string }[]
  footprints: {
    id: string
    area: string
    level: 1 | 2
    zone: string
    kind: 'rect' | 'circle'
    x: number
    z: number
    w: number
    d: number
    rotationY: number
    overhead: boolean
  }[]
  stations: { id: string; area: string; level: 1 | 2; zone: string; x: number; z: number; rotationY: number; nodes: string[]; reach: number }[]
}

export function exportFurniture(): FurnitureJson {
  const layout = buildLayout()
  const inside = (x: number, z: number) => {
    const lv = levelOf(x)
    const r = lv === 2 ? LEVEL2_FOOTPRINT : BUILDING
    const dx = drawnX(x)
    return dx >= r.x0 && dx <= r.x1 && z >= r.z0 && z <= r.z1
  }
  const fps = layout.footprints.filter((f) => f.area !== 'outside' && inside(f.x, f.z))
  const at = (x: number, z: number) => ({ level: levelOf(x), zone: zoneOf(levelOf(x), drawnX(x), z), x: round(drawnX(x)), z: round(z) })
  return {
    region: { x0: BUILDING.x0, x1: BUILDING.x1, z0: BUILDING.z0, z1: BUILDING.z1 },
    seats: layout.seats
      .filter((s) => inside(s.x, s.z))
      .map((s) => ({ id: s.id, kind: s.kind, area: s.area, ...at(s.x, s.z), heading: round(s.heading), height: round(s.height), pose: s.pose })),
    // w, d: full size along the footprint's own x / z (a circle: the diameter twice)
    footprints: fps.map((f) => ({
      id: f.id,
      area: f.area,
      kind: f.kind,
      ...at(f.x, f.z),
      w: round(f.hw * 2),
      d: round(f.hd * 2),
      rotationY: round(f.rotationY),
      overhead: f.overhead === true,
    })),
    stations: fps
      .filter((f) => f.serves)
      .map((f) => ({ id: f.id, area: f.area, ...at(f.x, f.z), rotationY: round(f.rotationY), nodes: [...(f.serves?.nodes ?? [])], reach: f.serves?.reach ?? 0 })),
  }
}

export function exportPlan(): PlanJson {
  const lvl = (simX: number): 1 | 2 => levelOf(simX)
  const rect = (r: { x0: number; x1: number; z0: number; z1: number }) => ({ x0: round(drawnX(r.x0)), x1: round(drawnX(r.x1)), z0: round(r.z0), z1: round(r.z1) })
  const pieces = buildWallPieces()
  return {
    version: 1,
    frame: {
      units: 'm',
      x: 'east',
      z: 'south',
      y: 'up',
      note: 'All x are AS DRAWN: level 2 stands over the west block at y = levels[1].y; its sim x is drawn x + 150. Floors are at each level y.',
    },
    wall: WALL,
    building: { ...BUILDING },
    levels: [
      { id: 1, y: LEVEL_Y[1], footprint: { ...BUILDING } },
      { id: 2, y: LEVEL_Y[2], footprint: { ...LEVEL2_FOOTPRINT } },
    ],
    areas: AREAS.map((a) => ({ id: a.id, label: a.label, kind: a.kind, level: lvl(a.rect.x0), rect: rect(a.rect), ceiling: ceilingHeight(a.id), zone: zoneOfArea(a.id) })),
    doors: DOORS.map((d) => ({
      id: d.id,
      level: lvl(d.center.x),
      x: round(drawnX(d.center.x)),
      z: round(d.center.z),
      width: d.width,
      wallAxis: d.wallAxis,
      kind: d.kind,
      a: d.a,
      b: d.b,
      zone: zoneOf(lvl(d.center.x), drawnX(d.center.x), d.center.z),
    })),
    walls: pieces.map((w) => {
      // a wall along x has constant z = c and runs a..b in x; along z, constant x = c
      const level = w.alongX ? lvl(w.a) : lvl(w.c)
      const c = w.alongX ? w.c : drawnX(w.c)
      const along = (v: number) => (w.alongX ? drawnX(v) : v)
      const owner = (t: number) => (w.alongX ? zoneOf(level, t, c) : zoneOf(level, c, t))
      const mid = (along(w.a) + along(w.b)) / 2
      const spans = w.cls === 'glassCut' ? glazingSpans(w, pieces).map(([a, b]) => ({ a: round(along(a)), b: round(along(b)), zone: owner((along(a) + along(b)) / 2) })) : undefined
      return {
        level,
        alongX: w.alongX,
        c: round(w.alongX ? w.c : drawnX(w.c)),
        a: round(w.alongX ? drawnX(w.a) : w.a),
        b: round(w.alongX ? drawnX(w.b) : w.b),
        cls: w.cls,
        outline: w.outline,
        cutA: w.cutA,
        cutB: w.cutB,
        zone: owner(mid),
        ...(spans ? { spans } : {}),
      }
    }),
    viewWindows: VIEW_WINDOWS.map((v) => {
      const level = v.alongX ? lvl(v.a) : lvl(v.c)
      return { id: v.id, level, alongX: v.alongX, c: round(v.alongX ? v.c : drawnX(v.c)), a: round(v.alongX ? drawnX(v.a) : v.a), b: round(v.alongX ? drawnX(v.b) : v.b) }
    }),
    drawerChutes: ROOMS.map((r) => ({ room: r.id, x: r.drawer.x, z: r.drawer.z, width: DRAWER_GAP })),
    furniture: exportFurniture(),
  }
}

// run as a script: write the JSON
if (process.argv[1] && /export-plan\.ts$/.test(process.argv[1])) {
  const out = resolve(process.cwd(), 'assets-src/arch/plan.json')
  mkdirSync(dirname(out), { recursive: true })
  const plan = exportPlan()
  writeFileSync(out, JSON.stringify(plan, null, 1))
  console.log(
    `plan: ${plan.areas.length} areas, ${plan.doors.length} doors, ${plan.walls.length} wall pieces, ${plan.furniture.seats.length} seats / ${plan.furniture.footprints.length} footprints, ${ZONES.zones.length} zones -> ${out}`,
  )
}
