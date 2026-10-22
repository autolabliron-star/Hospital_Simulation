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
 *   - `furniture` (look pass): for the pilot region on level 1, the procedural layout's seats (the sim's seat points), footprints (the
 *     collision rects/circles) and stations (footprints that are a nav node's destination), so Blender places designed pieces exactly on them.
 * Pure data; run with `npm run arch:plan` (writes assets-src/arch/plan.json, gitignored like the other conversion inputs).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { AREAS, BUILDING, DOORS, ROOMS, VIEW_WINDOWS, WALL, ceilingHeight } from '../../src/sim/places'
import { LEVEL2_DX, LEVEL2_FOOTPRINT, LEVEL_Y, levelOf } from '../../src/sim/levels'
import { DRAWER_GAP, buildWallPieces } from '../../src/scene/building/layout/walls'
import { buildLayout } from '../../src/scene/building/layout'
import { PILOT_REGION } from '../../src/scene/building/model/region'

const round = (v: number): number => Math.round(v * 1000) / 1000

/** A sim x as drawn (level 2 is moved back over the building and up a storey when it is drawn). */
const drawnX = (simX: number): number => (levelOf(simX) === 2 ? simX - LEVEL2_DX : simX)

export interface PlanJson {
  version: 1
  frame: { units: 'm'; x: 'east'; z: 'south'; y: 'up'; note: string }
  wall: typeof WALL
  building: { x0: number; x1: number; z0: number; z1: number }
  levels: { id: 1 | 2; y: number; footprint: { x0: number; x1: number; z0: number; z1: number } }[]
  areas: { id: string; label: string; kind: string; level: 1 | 2; rect: { x0: number; x1: number; z0: number; z1: number }; ceiling: number | null }[]
  doors: { id: string; level: 1 | 2; x: number; z: number; width: number; wallAxis: 'x' | 'z'; kind: string; a: string; b: string }[]
  walls: { level: 1 | 2; alongX: boolean; c: number; a: number; b: number; cls: string; outline: boolean; cutA: boolean; cutB: boolean }[]
  viewWindows: { id: string; level: 1 | 2; alongX: boolean; c: number; a: number; b: number }[]
  drawerChutes: { room: string; x: number; z: number; width: number }[]
  furniture: FurnitureJson
}

/** The procedural layout's furniture anchors in the pilot region (level 1, sim = drawn coordinates there). Headings follow atan2(dx, dz). */
export interface FurnitureJson {
  region: { x0: number; x1: number; z0: number; z1: number }
  seats: { id: string; kind: string; area: string; x: number; z: number; heading: number; height: number; pose: string }[]
  footprints: { id: string; area: string; kind: 'rect' | 'circle'; x: number; z: number; w: number; d: number; rotationY: number; overhead: boolean }[]
  stations: { id: string; area: string; x: number; z: number; rotationY: number; nodes: string[]; reach: number }[]
}

const inRegion = (x: number, z: number): boolean => x >= PILOT_REGION.x0 && x <= PILOT_REGION.x1 && z >= PILOT_REGION.z0 && z <= PILOT_REGION.z1

export function exportFurniture(): FurnitureJson {
  const layout = buildLayout()
  const lvl1 = (x: number, z: number) => levelOf(x) === 1 && inRegion(x, z)
  const fps = layout.footprints.filter((f) => f.area !== 'outside' && lvl1(f.x, f.z))
  return {
    region: { ...PILOT_REGION },
    seats: layout.seats
      .filter((s) => lvl1(s.x, s.z))
      .map((s) => ({ id: s.id, kind: s.kind, area: s.area, x: round(s.x), z: round(s.z), heading: round(s.heading), height: round(s.height), pose: s.pose })),
    // w, d: full size along the footprint's own x / z (a circle: the diameter twice)
    footprints: fps.map((f) => ({
      id: f.id,
      area: f.area,
      kind: f.kind,
      x: round(f.x),
      z: round(f.z),
      w: round(f.hw * 2),
      d: round(f.hd * 2),
      rotationY: round(f.rotationY),
      overhead: f.overhead === true,
    })),
    stations: fps
      .filter((f) => f.serves)
      .map((f) => ({ id: f.id, area: f.area, x: round(f.x), z: round(f.z), rotationY: round(f.rotationY), nodes: [...(f.serves?.nodes ?? [])], reach: f.serves?.reach ?? 0 })),
  }
}

export function exportPlan(): PlanJson {
  const lvl = (simX: number): 1 | 2 => levelOf(simX)
  const rect = (r: { x0: number; x1: number; z0: number; z1: number }) => ({ x0: round(drawnX(r.x0)), x1: round(drawnX(r.x1)), z0: round(r.z0), z1: round(r.z1) })
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
    areas: AREAS.map((a) => ({ id: a.id, label: a.label, kind: a.kind, level: lvl(a.rect.x0), rect: rect(a.rect), ceiling: ceilingHeight(a.id) })),
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
    })),
    walls: buildWallPieces().map((w) => {
      // a wall along x has constant z = c and runs a..b in x; along z, constant x = c
      const level = w.alongX ? lvl(w.a) : lvl(w.c)
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
    `plan: ${plan.areas.length} areas, ${plan.doors.length} doors, ${plan.walls.length} wall pieces, ${plan.furniture.seats.length} seats / ${plan.furniture.footprints.length} footprints in the pilot region -> ${out}`,
  )
}
