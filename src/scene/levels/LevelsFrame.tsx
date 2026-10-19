/**
 * R2: writes `levelView` every frame at FRAME_PRIORITY.levels (-9.5), then shows and hides the `<LevelGroup>`s by it. Mount once inside the Canvas (World.tsx).
 * Everything that draws or picks by level (the crowd, the emote icons and bubbles, level 2's building, the roof cap) reads `levelView` after this runs.
 * No allocation: the player view and the store state are read in place.
 */
import { useFrame } from '@react-three/fiber'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { sim } from '@/sim'
import { applyLevelGroups } from './levelGroups'
import { updateLevelView } from './levelRule'
import { useOverviewLevel } from './levelView'

export function LevelsFrame(): null {
  // (`sim` is a live binding: a Jump swaps it, so it is read at every frame)
  useFrame(() => {
    updateLevelView(sim.player, useOverviewLevel.getState().level)
    applyLevelGroups()
  }, FRAME_PRIORITY.levels)
  return null
}
