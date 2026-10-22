/**
 * The presentation's shots: where the walkthrough camera stands and what it looks at. Positions are sim metres (level 1), the eye is at
 * `EYE` (1.6 m), the look is level (a pitch of 0) at the target point. The four shots show the lobby from the entrance side, the desk, the
 * glazed wall and the seating, and `N` glides through them in order, looping (./glide.ts).
 *
 * Pure: no three.js and no store, so node can test it. The yaw is the compass radian the whole app uses, atan2(dx, dz).
 */
export interface Shot {
  id: string
  /** Where you stand (sim x, z). */
  x: number
  z: number
  /** What you look at (sim x, z). */
  lookX: number
  lookZ: number
  /** Look elevation above level, radians (positive looks down). 0 for all four. */
  pitch: number
}

/** Eye height of every shot, metres. */
export const EYE = 1.6

export const SHOTS: readonly Shot[] = [
  { id: 'lobby-entrance', x: -61, z: 0, lookX: -44, lookZ: 0, pitch: 0 },
  { id: 'lobby-desk', x: -48.5, z: 1.5, lookX: -51.5, lookZ: -3, pitch: 0 },
  { id: 'lobby-glass', x: -46.5, z: 0, lookX: -62, lookZ: 0, pitch: 0 },
  { id: 'lobby-seating', x: -55.5, z: 0.5, lookX: -59.6, lookZ: 5.3, pitch: 0 },
]

/** The compass heading (atan2(dx, dz)) a shot looks along. */
export function shotYaw(s: Shot): number {
  return Math.atan2(s.lookX - s.x, s.lookZ - s.z)
}

/** The index after `i` in the loop (the first shot after the last; also the first for anything before 0). */
export function nextShot(i: number, n: number = SHOTS.length): number {
  return (i + 1 + n) % n
}

/** The index before `i` in the loop. */
export function prevShot(i: number, n: number = SHOTS.length): number {
  return (i - 1 + n) % n
}
