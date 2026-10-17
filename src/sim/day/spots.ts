/**
 * Where shift changes stand: the staff-room lockers and their waiting spots, and the spot beside a post where the
 * incoming person meets the outgoing one. Everything here is checked in the tests to be walkable and out of every doorway
 * (the skill pitfall: nobody idles in a pinch).
 */
import { isWalkable } from '../nav/layout'
import { inDoorway, dist, headingTo, type Post } from '../er/spots'
import { STAFF_ROOM, type Spot } from '../places'
import type { Vec2 } from '../types'

/** Clearance of a body centre from walls and furniture for a standing spot. */
export const STAND_CLEAR = 0.3

/** A spot somebody may stand at and talk: walkable, clear of walls and out of doorways. */
export function validStand(x: number, z: number): boolean {
  return isWalkable(x, z, STAND_CLEAR) && !inDoorway(x, z, STAND_CLEAR)
}

/** The staff-room lockers (facing the lockers), then the spots one step behind them where the next person waits. */
export const LOCKER_SPOTS: readonly Spot[] = STAFF_ROOM.lockers
export const LOCKER_WAIT: readonly Spot[] = STAFF_ROOM.lockers.map((s) => ({ at: { x: s.at.x, z: s.at.z + 1.0 }, heading: s.heading }))

/**
 * Where the incoming person stands to meet the one who holds `post`: about a metre away, on the first side that is a valid
 * place to stand and talk, facing the post. The post itself must be valid: handovers never take place in a pinch.
 */
export function meetSpot(post: Post): Spot {
  const h = post.heading
  // to the side first (a natural pair), then along the facing line, then the diagonals
  const dirs: [number, number][] = [
    [Math.cos(h), -Math.sin(h)],
    [-Math.cos(h), Math.sin(h)],
    [-Math.sin(h), -Math.cos(h)],
    [Math.sin(h), Math.cos(h)],
    [0.707, 0.707],
    [-0.707, 0.707],
    [0.707, -0.707],
    [-0.707, -0.707],
  ]
  for (const d of [1.0, 1.2, 1.5]) {
    for (const [dx, dz] of dirs) {
      const x = post.at.x + dx * d
      const z = post.at.z + dz * d
      if (validStand(x, z)) return { at: { x, z }, heading: headingTo({ x, z }, post.at) }
    }
  }
  // a post in a tight spot: stand on it (the outgoing person steps aside when they leave)
  return { at: { x: post.at.x, z: post.at.z }, heading: post.heading }
}

/** Distance between two points (re-exported so the day code needs one import). */
export { dist }

/** Is a spot near `p` (within `r` m)? */
export function near(a: Vec2, b: Vec2, r: number): boolean {
  return dist(a, b) <= r
}
