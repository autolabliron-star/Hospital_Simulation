/**
 * The overview's architect's cut for the authored model: one clipping plane shared by every model material, set once at load so the shader
 * programs are compiled with it (warm-up). Only its height moves: the storey's cut height in the overview, far above the roof while walking.
 * Moving it changes a uniform, never a define, so a mode switch recompiles nothing.
 */
import { Plane, Vector3 } from 'three'
import { WALL } from '@/sim/places'

/** Keeps y <= constant (three clips where normal . p + constant < 0). */
export const MODEL_CLIP = new Plane(new Vector3(0, -1, 0), WALL.cutHeight)

const NO_CUT = 1e4

/** The clip height for a mode: the procedural building's cut in the overview, nothing cut while walking. */
export const modelClipHeight = (walking: boolean): number => (walking ? NO_CUT : WALL.cutHeight)
