/**
 * R2: which level the screen shows (docs/R2-SURGERY.md). A plain registry plus a small store, so renderers read it inside `useFrame`
 * without importing each other. Contract glue, owned by the orchestrator; agent L1 writes `levelView` each frame at
 * FRAME_PRIORITY.levels (your level while walking, the overview switch in the overview) and makes every renderer honour it.
 *
 *   overview, Level 1   the hospital as today; level 2 is hidden
 *   overview, Level 2   the level-2 storey sits on the hospital; level 1 stays drawn around it, and level-1 people under the slab hide
 *   walking on level 1  level 1 only
 *   walking on level 2  level 2 only (and a roof cap over the open-topped model below)
 */
import { create } from 'zustand'
import { levelOf, underLevel2, type LevelId } from '@/sim/levels'

export interface LevelViewState {
  /** The level whose interior is shown and whose people are drawn: yours while walking, the switch's in the overview. */
  shown: LevelId
  /** True in the overview (level 1 stays drawn around level 2), false while walking (only `shown` is drawn). */
  overview: boolean
}

/** Read inside frame callbacks; written once per frame at FRAME_PRIORITY.levels. */
export const levelView: LevelViewState = { shown: 1, overview: true }

/** Should a person (or anything placed from a sim position) at sim (x, z) be drawn now? Allocation-free. */
export function shownAt(simX: number, simZ: number): boolean {
  const level = levelOf(simX)
  if (level === levelView.shown) return true
  // the overview of level 2 keeps the ground floor drawn around the storey, not under it
  return levelView.overview && levelView.shown === 2 && level === 1 && !underLevel2(simX, simZ)
}

/** The overview's Level switch (UI: ui/LevelSwitch.tsx, the L key). Walking ignores it: you see your own level. */
export const useOverviewLevel = create<{ level: LevelId; set(level: LevelId): void }>((set) => ({
  level: 1,
  set: (level) => set({ level }),
}))
