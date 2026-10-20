/**
 * S1: the simulation speed as the scene sees it. Layers that stand for a sim process (a kiosk arm, a surgery robot, the lab track, a door, a growing tray,
 * a scanner table) animate with `visualDt(dt)` so they keep up with the sim at 10x and 30x; speech bubbles, emotes, the camera, the daylight follow and the
 * CT gantry spin stay on real `dt`. Allocation-free: reads two fields of the loop.
 */
import { loop } from '@/sim'

/** A visual smoother never takes a bigger step than this, however fast the sim runs (a hitch must not make a part jump across its whole travel). */
export const VISUAL_DT_MAX = 0.25

/** The sim speed (1, 2, 4, 10 or 30). Not 0 while paused: use `visualDt` for animation, which is. */
export function timeScale(): number {
  return loop.speed
}

/** Scaled frame time for a layer that stands for a sim process: 0 while the sim is paused, `dt` x speed otherwise, at most `VISUAL_DT_MAX`. */
export function visualDt(dt: number): number {
  if (loop.paused) return 0
  const s = dt * loop.speed
  return s < VISUAL_DT_MAX ? s : VISUAL_DT_MAX
}
