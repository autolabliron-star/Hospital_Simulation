/**
 * R2: the one rule that decides which level the screen shows (docs/R2-SURGERY.md), pure so the node tests can run it. LevelsFrame.tsx calls it once a
 * frame at FRAME_PRIORITY.levels (-9.5): after the player has moved and the camera is written, before anything is drawn or picked by level.
 *
 *   walking (any mode but the overview: `isWalkMode`, the flights between the two included)   `shown` = the level you stand on, `overview` false
 *   the overview (or no player yet)                                                            `shown` = the overview's Level switch, `overview` true
 */
import { isWalkMode } from '@/scene/building/render/walk/modeSwitch'
import { levelOf, type LevelId } from '@/sim/levels'
import { levelView } from './levelView'

/** The part of `sim.player` the rule reads. */
export interface LevelPlayer {
  mode: string
  x: number
}

/** Write `levelView` for this frame. Allocation-free. */
export function updateLevelView(player: Readonly<LevelPlayer> | null | undefined, overviewLevel: LevelId): void {
  if (player && isWalkMode(player.mode)) {
    levelView.shown = levelOf(player.x)
    levelView.overview = false
  } else {
    levelView.shown = overviewLevel
    levelView.overview = true
  }
}
