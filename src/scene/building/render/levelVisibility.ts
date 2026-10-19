/**
 * Which part of the building each frame shows (R2): pure rules over two facts, whether you are walking (any mode but the overview, the flights
 * between the two included: `isWalkMode`) and the level the screen shows (`levelView.shown`, written once a frame at FRAME_PRIORITY.levels by the
 * levels frame: your level while walking, the overview switch in the overview). The components read the facts inside a `useFrame` that runs after
 * that callback and write `visible` from these. No allocation: plain booleans.
 *
 *   level 1 cut + overview-only parts    always (the cut shell stays drawn under level 2); the overview-only ones only in the overview
 *   level 1 walk building                walking on level 1
 *   level 2 group                        `shown === 2`: the overview's Level 2, or walking on level 2
 *   level 2 overview-only parts          the overview's Level 2
 *   level 2 walk-only parts + walk bldg  walking on level 2
 *   roof cap                             walking on level 2 only (a real roof over the open-topped model below: the overview wants it open)
 */
import type { LevelId } from '@/sim/levels'

/** After FRAME_PRIORITY.levels (-9.5) and everything that moves you, before the labels and the draw: the walk building's own priority (W1). */
export const BUILDING_VISIBILITY_PRIORITY = -0.1

export const level1WalkVisible = (walking: boolean, shown: LevelId): boolean => walking && shown === 1
export const level2Visible = (shown: LevelId): boolean => shown === 2
export const level2OverviewVisible = (walking: boolean, shown: LevelId): boolean => !walking && shown === 2
export const level2WalkVisible = (walking: boolean, shown: LevelId): boolean => walking && shown === 2
export const roofCapVisible = (walking: boolean, shown: LevelId): boolean => walking && shown === 2
