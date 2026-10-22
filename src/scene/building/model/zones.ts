/**
 * The zone rollout (`?building=model` with public/assets/building/manifest.json): the building split into the zones of tools/arch/zones.json
 * (the orchestrator's contract, read-only here). Pure data and pure rules, so node tests them.
 *
 * Coordinates: zones.json rects are DRAWN coordinates on the zone's level (level 2's theatres sit over the west block at x -62..-40, the same
 * frame as LEVEL2_FOOTPRINT); the sim keeps level 2 in its own strip (sim x = drawn x + LEVEL2_DX). Everything below takes SIM coordinates
 * (what the procedural layout, the walls and the doors are authored in) and converts with `drawnX`.
 *
 * Ownership (the same rule as the pipeline's tools/arch/export-plan.ts `zoneOf`, which builds each zone's glb from exactly its own pieces; a
 * test holds the two to each other):
 *   an area             the zone that lists it in `areas`;
 *   a point             the FIRST zone in zones.json order on that level whose rects contain it (borders count, so a line on the border
 *                       between two zones goes to the one listed first), else the nearest zone of that level;
 *   a wall piece / door the zone of its centre; a span of outer glazing (`glassCut`, split where partitions meet it) the zone of the span's centre.
 */
import zonesJson from '../../../../tools/arch/zones.json'
import { LEVEL2_DX, LEVEL2_FOOTPRINT, levelOf, type LevelId } from '@/sim/levels'

export interface ZoneRect {
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface ZoneDef {
  id: string
  level: LevelId
  label: string
  rects: ZoneRect[]
  areas: string[]
  status: string
}

interface ZonesFile {
  version: number
  zones: ZoneDef[]
  budgets: { perZone: { draws: number; tris: number; lightmapMB: number }; sharedMaterialTexturesMB: number }
}

const FILE = zonesJson as unknown as ZonesFile

/** Every zone of the contract, in its order (the order breaks ties on shared borders). */
export const ZONES: readonly ZoneDef[] = FILE.zones
export const ZONE_IDS: readonly string[] = ZONES.map((z) => z.id)
export const ZONE_BUDGETS = FILE.budgets

const BY_ID = new Map(ZONES.map((z) => [z.id, z]))
export const zoneDef = (id: string): ZoneDef | undefined => BY_ID.get(id)

/** A sim x as drawn (level 2 moves back over the building). */
export const drawnX = (simX: number): number => (levelOf(simX) === 2 ? simX - LEVEL2_DX : simX)

const EPS = 1e-6
const inRect = (x: number, z: number, r: ZoneRect): boolean => x >= r.x0 - EPS && x <= r.x1 + EPS && z >= r.z0 - EPS && z <= r.z1 + EPS
const rectDist = (x: number, z: number, r: ZoneRect): number => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1))

/** The zone that owns a DRAWN point on a level (first containing zone in contract order, else the nearest of that level). */
export function zoneAtDrawn(level: LevelId, x: number, z: number, zones: readonly ZoneDef[] = ZONES): string | null {
  let best: string | null = null
  let bd = Infinity
  for (const zn of zones) {
    if (zn.level !== level) continue
    for (const r of zn.rects) if (inRect(x, z, r)) return zn.id
  }
  for (const zn of zones) {
    if (zn.level !== level) continue
    for (const r of zn.rects) {
      const d = rectDist(x, z, r)
      if (d < bd) {
        bd = d
        best = zn.id
      }
    }
  }
  return best
}

/** The zone that owns a SIM point (its level from the sim x). */
export const zoneAtSim = (simX: number, z: number, zones: readonly ZoneDef[] = ZONES): string | null => zoneAtDrawn(levelOf(simX), drawnX(simX), z, zones)

/** Is a DRAWN point inside a zone's own rects (no nearest-zone fallback)? Allocation-free. */
export function zoneContainsDrawn(zn: ZoneDef, x: number, z: number): boolean {
  for (let i = 0; i < zn.rects.length; i++) if (inRect(x, z, zn.rects[i])) return true
  return false
}

/**
 * The `rect:<x0>,<x1>,<z0>,<z1>` replaces key (drawn metres, on the zone's level): its rect, or null when the key is not one or is malformed
 * (four finite numbers with x0 < x1 and z0 < z1).
 */
export function parseRectKey(key: string): ZoneRect | null {
  if (!key.startsWith('rect:')) return null
  const parts = key.slice('rect:'.length).split(',')
  if (parts.length !== 4) return null
  const n = parts.map((s) => (s.trim() === '' ? NaN : Number(s)))
  if (!n.every(Number.isFinite)) return null
  const [x0, x1, z0, z1] = n
  return x0 < x1 && z0 < z1 ? { x0, x1, z0, z1 } : null
}

const AREA_ZONE = new Map<string, string>()
for (const zn of ZONES) for (const a of zn.areas) AREA_ZONE.set(a, zn.id)

/** The zone that lists an area, or null (an area no zone lists stays procedural). */
export const zoneOfArea = (areaId: string): string | null => AREA_ZONE.get(areaId) ?? null

/** Do two zones touch or overlap (same level, rects within 0.5 m)? */
export function zonesTouch(a: ZoneDef, b: ZoneDef): boolean {
  if (a.level !== b.level || a.id === b.id) return false
  const pad = 0.5
  for (const r of a.rects)
    for (const s of b.rects) if (r.x0 <= s.x1 + pad && s.x0 <= r.x1 + pad && r.z0 <= s.z1 + pad && s.z0 <= r.z1 + pad) return true
  return false
}

/** The zones that touch `id` (its neighbours on its own level). */
export function neighboursOf(id: string, zones: readonly ZoneDef[] = ZONES): string[] {
  const me = zones.find((z) => z.id === id)
  if (!me) return []
  return zones.filter((z) => zonesTouch(me, z)).map((z) => z.id)
}

/** Does a level-1 zone lie wholly under the level-2 slab (hidden while the overview shows level 2)? */
export function zoneUnderLevel2(zn: ZoneDef): boolean {
  if (zn.level !== 1) return false
  const f = LEVEL2_FOOTPRINT
  return zn.rects.every((r) => r.x0 >= f.x0 - EPS && r.x1 <= f.x1 + EPS && r.z0 >= f.z0 - EPS && r.z1 <= f.z1 + EPS)
}

/** Distance (drawn metres, in plan) from a drawn point to a zone's nearest rect (0 inside). */
export function zoneDistance(zn: ZoneDef, x: number, z: number): number {
  let d = Infinity
  for (const r of zn.rects) d = Math.min(d, rectDist(x, z, r))
  return d
}
