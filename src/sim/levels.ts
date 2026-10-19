/**
 * R2: two storeys in a flat sim. Contract glue, owned by the orchestrator. See docs/R2-SURGERY.md.
 *
 * The simulation is 2D (x/z) and stays flat: every person, seat, zone and wall of level 2 lives in its own strip of the sim's
 * x/z plane, `LEVEL2_DX` metres east of where it is drawn (sim x 88..110, 40 m past the plinth). The two levels never overlap in
 * 2D and no query radius reaches across the gap, so areas, walkability, the nav graph, the crowd, seats, collision, the camera boom,
 * sight lines, door sensing and audio all work per level with no floor field. `groundHeightAt` stays 0: heights are floor-relative
 * in the sim.
 *
 * Drawing is one rigid translation per level: level 2 is shifted by (-LEVEL2_DX, +LEVEL_Y[2], 0), which stacks it 4.2 m up (a
 * 3.0 m storey plus a 1.2 m slab and plenum) over the west block of the hospital (`LEVEL2_FOOTPRINT`). Renderers that place things
 * from sim positions use `toDisplayInto`; the level-2 scene is authored in sim coordinates inside one group translated by the same
 * offset. People change level only through the lifts (`src/sim/lifts`): a nav edge across the gap would make walkers glide.
 */
import type { Rect } from './places'
import type { Vec3 } from './types'

export type LevelId = 1 | 2

/** Floor height of each level as drawn (m). The sim never uses it. */
export const LEVEL_Y: Readonly<Record<LevelId, number>> = { 1: 0, 2: 4.2 }

/** sim x = display x + LEVEL2_DX on level 2; y and z are unchanged. */
export const LEVEL2_DX = 150
/** Sim x at or beyond this is level 2 (halfway across the gap between the plinth and the strip). */
export const LEVEL2_SPLIT_X = 70

/** Where level 2 stands, as drawn: over the lobby, triage, the ER, the main corridor and both lift shafts. */
export const LEVEL2_FOOTPRINT: Rect = { x0: -62, x1: -40, z0: -22, z1: 22 }
/** The same footprint in sim coordinates. */
export const LEVEL2_STRIP: Rect = { x0: -62 + LEVEL2_DX, x1: -40 + LEVEL2_DX, z0: -22, z1: 22 }

/** The level a sim position is on. */
export function levelOf(simX: number): LevelId {
  return simX >= LEVEL2_SPLIT_X ? 2 : 1
}

/** What to add to a sim x to draw it (0 on level 1). */
export function levelDx(level: LevelId): number {
  return level === 2 ? -LEVEL2_DX : 0
}

/** Authoring helper for level-2 anchors: the sim x of a display x on level 2. */
export function l2(displayX: number): number {
  return displayX + LEVEL2_DX
}

/** A sim position as drawn: level 2 moves west by LEVEL2_DX and up by LEVEL_Y[2]. `out` may be `sim`. Allocation-free. */
export function toDisplayInto(sim: Readonly<Vec3>, out: Vec3): Vec3 {
  if (sim.x >= LEVEL2_SPLIT_X) {
    out.x = sim.x - LEVEL2_DX
    out.y = sim.y + LEVEL_Y[2]
  } else {
    out.x = sim.x
    out.y = sim.y
  }
  out.z = sim.z
  return out
}

/** A drawn position on `level` back in sim coordinates (y back to floor-relative). `out` may be `disp`. Allocation-free. */
export function toSimInto(disp: Readonly<Vec3>, level: LevelId, out: Vec3): Vec3 {
  out.x = disp.x - levelDx(level)
  out.y = disp.y - LEVEL_Y[level]
  out.z = disp.z
  return out
}

/** Is a level-1 sim point under the level-2 slab (hidden from above when level 2 is shown)? */
export function underLevel2(simX: number, simZ: number): boolean {
  const r = LEVEL2_FOOTPRINT
  return simX >= r.x0 && simX <= r.x1 && simZ >= r.z0 && simZ <= r.z1
}

/** Is a rect (sim coordinates) on level 2? Every level-2 rect lies wholly in the strip. */
export function rectLevel(r: Rect): LevelId {
  return levelOf((r.x0 + r.x1) / 2)
}
