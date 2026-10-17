import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { sim } from '@/sim'
import { tickBedsWall } from './commandWall'

/** Seconds between redraw checks: at most 2 Hz. The check itself repaints only when something the panel shows changed. */
const CHECK_EVERY = 0.5

/** Negative on purpose (positive priorities take over rendering in R3F). After the sim (-100), before the draw: register it in frameOrder.ts. */
export const BEDS_WALL_FRAME_PRIORITY = FRAME_PRIORITY.bedsWall

/**
 * Keeps the command wall's Beds panel up to date. Mount once inside the Canvas (App). It reads the live `sim` binding, so a
 * Jump needs no remount: the check sees a new Simulation object and repaints at once. The frame callback only counts time.
 */
export function CommandWallLive() {
  const since = useRef(CHECK_EVERY)
  useFrame((_, dt) => {
    since.current += dt
    if (since.current < CHECK_EVERY) return
    since.current = 0
    tickBedsWall(sim)
  }, BEDS_WALL_FRAME_PRIORITY)
  return null
}
