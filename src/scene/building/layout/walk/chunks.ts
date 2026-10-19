import { LEVEL2_SPLIT_X } from '@/sim/levels'

/**
 * Spatial chunks of the walk-mode building. One merged mesh per (chunk, material) keeps frustum culling meaningful at eye level
 * (a corridor, a room or the lobby sees one or two chunks), while the whole building stays under the draw-call budget.
 * The edges follow the building's natural blocks: the entrance block and the main corridor (west of x = -40), the imaging block and
 * the command center, the pharmacy core with the middle of the wards, and the atrium side.
 *
 * R2: level 2 lives in its own strip of the flat sim (sim x 88..110), so the last edge is where that strip starts: level 2's walk parts are
 * their own chunk (4), drawn inside the level-2 group, and never join the atrium chunk next to them in x.
 */
export const CHUNK_EDGES: readonly number[] = [-40, -12, 12, LEVEL2_SPLIT_X]
export const CHUNK_COUNT = CHUNK_EDGES.length + 1

/** The chunk an x belongs to (an x on an edge goes to the east chunk). */
export function chunkOfX(x: number): number {
  let i = 0
  while (i < CHUNK_EDGES.length && x >= CHUNK_EDGES[i]) i++
  return i
}
