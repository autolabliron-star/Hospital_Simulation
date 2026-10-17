/**
 * The walk-mode building as plain data (W1). `buildWalkLayout()` is pure and deterministic: no randomness, no three.js, no DOM.
 * The renderer (../../render/walk) merges it into a handful of meshes per chunk, a few instanced door meshes and one sign mesh.
 */
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

export type { WalkLayout, WalkBox, WalkDoor, CeilingPiece, Tile, QuadPlacement, HangingSign, Plate } from './types'
