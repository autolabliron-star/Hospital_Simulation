/**
 * How the L1 layers read the living-day view. `sim.life` is added to the Simulation by the orchestrator, so every read is
 * defensive: when it is absent the layers draw the default look (no bots, flat backrests, white door tiles, the static bedside tile).
 */
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import type { LivingDayView } from '@/sim/types'

/**
 * The L1 layers only read what the sim wrote in this frame's `SimLoop.frame` (priority `FRAME_PRIORITY.sim`), and nothing here
 * depends on the camera, so they run right after the sim and before every camera write. Negative, like every priority of ours.
 */
export const LIFE_PRIORITY = FRAME_PRIORITY.sim + 1

export function lifeOf(sim: unknown): LivingDayView | null {
  return (sim as { life?: LivingDayView } | null)?.life ?? null
}

/** Most bots the layers draw (the config builds two per ward and a spare: 5). */
export const MAX_BOTS = 6
