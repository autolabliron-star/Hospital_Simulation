/**
 * W4: the shared status-screen atlas (4 x 4 tiles of 320 x 200 on one canvas, one draw call), as a registry: each feature registers the tiles
 * it owns with a painter and a version; <StatusScreens /> (src/scene/w4kit/StatusScreens.tsx, built by the lab agent) checks versions at 4 Hz,
 * repaints only tiles whose version changed and uploads the canvas at most 2 Hz. Contract glue, owned by the orchestrator.
 */
import type { Vec3 } from '@/sim/types'

export const W4_TILE = {
  kiosk0: 0,
  kiosk1: 1,
  bp0: 2,
  bp1: 3,
  triage: 4,
  drawCheckIn: 5,
  drawQueue: 6,
  tubePrep: 7,
  manualSend: 8,
  spare9: 9,
  labStatus: 10,
  centrifuge: 11,
  labReceive: 12,
  archive: 13,
  spare14: 14,
  spare15: 15,
} as const
export const W4_TILE_COUNT = 16
export const W4_TILE_PX = { w: 320, h: 200 } as const

export interface W4Tile {
  /** Where the screen quad sits (centre), which way it faces (heading, atan2(dx, dz)), its size in metres, and an optional tilt (radians back). */
  anchor: { at: Vec3; heading: number; w: number; h: number; tilt?: number }
  /** Changes whenever the painting would change. */
  version: () => number
  /** Paint the tile (0, 0, w, h in tile pixels). Runs at most 2 Hz; may build strings, never runs inside a frame callback. */
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

const tiles = new Map<number, W4Tile>()

/** Register (or replace) the tile at `index`; returns the function that removes it. */
export function registerTile(index: number, tile: W4Tile): () => void {
  tiles.set(index, tile)
  return () => {
    if (tiles.get(index) === tile) tiles.delete(index)
  }
}
export function w4Tiles(): ReadonlyMap<number, W4Tile> {
  return tiles
}
