/**
 * The walk-mode building as plain data (W1). `buildWalkLayout()` is pure and deterministic: no randomness, no three.js, no DOM.
 * The renderer (../../render/walk) merges it into a handful of meshes per chunk, a few instanced door meshes and one sign mesh.
 */
import { levelOf, type LevelId } from '@/sim/levels'
import { buildWallPieces } from '../walls'
import type { BuildingLayout } from '../types'
import { buildCeilings } from './ceilings'
import { buildCorridorFurniture } from './corridor'
import { buildWalkDoors } from './doors'
import { buildSignage } from './signage'
import { buildUpperWalls } from './upperWalls'
import type { WalkLayout } from './types'

/** `layout` is only read for its furniture footprints (the door sweeps keep clear of them). */
export function buildWalkLayout(layout: Pick<BuildingLayout, 'footprints'>): WalkLayout {
  const pieces = buildWallPieces()
  const signage = buildSignage(pieces)
  return {
    boxes: [...buildUpperWalls(pieces), ...buildCorridorFurniture(pieces), ...signage.boxes],
    ceilings: buildCeilings(),
    tiles: signage.tiles,
    quads: signage.quads,
    signs: signage.signs,
    plates: signage.plates,
    doors: buildWalkDoors(layout.footprints),
  }
}

/**
 * The part of the walk-mode building on one level (R2). Level 2 lies in its own strip of the flat sim (sim x 88..110) and is drawn in its own group,
 * so its boxes, ceilings, pictures, signs, plates and doors compile and move apart from level 1's. `tiles` stay whole: both levels share one atlas.
 */
export function walkLayoutOfLevel(layout: WalkLayout, level: LevelId): WalkLayout {
  const on = (x: number): boolean => levelOf(x) === level
  return {
    boxes: layout.boxes.filter((b) => on((b.x0 + b.x1) / 2)),
    ceilings: layout.ceilings.filter((c) => on((c.x0 + c.x1) / 2)),
    tiles: layout.tiles,
    quads: layout.quads.filter((q) => on(q.cx)),
    signs: layout.signs.filter((s) => on(s.x)),
    plates: layout.plates.filter((p) => on(p.x)),
    doors: layout.doors.filter((d) => on(d.x)),
  }
}

export type { WalkLayout, WalkBox, WalkDoor, CeilingPiece, Tile, QuadPlacement, HangingSign, Plate } from './types'
