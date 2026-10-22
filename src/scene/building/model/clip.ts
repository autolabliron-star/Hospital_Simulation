/**
 * The overview's architect's cut for the authored model: one clipping plane per storey, shared by every model material of that storey, set once
 * at load so the shader programs are compiled with it (warm-up; one plane either way, so both storeys share programs). Only the height moves:
 * the storey's cut height in the overview, far above the roof while walking. Moving it changes a uniform, never a define, so a mode switch
 * recompiles nothing.
 */
import { Plane, Vector3 } from 'three'
import { LEVEL_Y, type LevelId } from '@/sim/levels'
import { WALL } from '@/sim/places'

/** Keeps y <= constant (three clips where normal . p + constant < 0). Level 1 (and the pilot). */
export const MODEL_CLIP = new Plane(new Vector3(0, -1, 0), WALL.cutHeight)
/** The same cut for a level-2 zone, one storey up. */
export const MODEL_CLIP_L2 = new Plane(new Vector3(0, -1, 0), LEVEL_Y[2] + WALL.cutHeight)

const NO_CUT = 1e4

/** The clip height for a mode: the procedural building's cut in the overview, nothing cut while walking. */
export const modelClipHeight = (walking: boolean, level: LevelId = 1): number => (walking ? NO_CUT : LEVEL_Y[level] + WALL.cutHeight)

export const clipOfLevel = (level: LevelId): Plane => (level === 2 ? MODEL_CLIP_L2 : MODEL_CLIP)

/** Both planes for this frame (allocation-free). */
export function updateModelClips(walking: boolean): void {
  MODEL_CLIP.constant = modelClipHeight(walking, 1)
  MODEL_CLIP_L2.constant = modelClipHeight(walking, 2)
}
