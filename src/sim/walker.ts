/**
 * Walker: how a person gets from A to B. The controllers in people.ts and the ER pathway only talk to this interface, so
 * the movement model can change without touching them.
 *
 * Routes come from the people nav graph (src/sim/nav/graph.ts): corridor centre lines, perpendicular door spurs, and round the
 * furniture. The whole corridor is the people's (W2: the MedPods ride a ceiling rail, there are no robot lanes on the floor).
 *
 * Two kinds of walker:
 *   - `makeWalker()`: a solo walker. It follows its route exactly (the M1 behaviour) and knows nothing of other people.
 *   - `makeWalker(crowd)`: a member of a `Crowd` (src/sim/nav/crowd.ts). The same route, but the body keeps to the right of
 *     the path, slows behind slower walkers, steps round standing and seated people, takes turns at single-file doors and
 *     is always pulled back onto walkable ground. Call `crowd.beginStep()` once per sim step before the people update.
 */
import type { Crowd } from './nav/crowd'
import { PathFollower } from './nav/follower'
import { planRoute } from './nav/graph'
import type { Vec2 } from './types'

export type WalkStatus = 'moving' | 'waiting' | 'arrived'

export interface WalkerOptions {
  /** A stable id (the person's entity id): the personal walking style (keep-right offset, pace) derives from it. */
  id?: string
  /** Body radius in metres (default 0.25). A porter pushing a stretcher is wider. */
  radius?: number
}

export interface Walker {
  readonly x: number
  readonly z: number
  readonly heading: number
  readonly speed: number
  /** Plan a route to `to` and start walking it. */
  goTo(to: Vec2): void
  /** Put the person somewhere without walking (spawn, seat snap). */
  place(x: number, z: number, heading: number): void
  /** Turn towards a heading (standing at a bedside or a desk). */
  face(heading: number): void
  /**
   * Advance one fixed step. Returns 'arrived' on the last waypoint, 'waiting' when held in a crowd by someone in the way or
   * a door to wait at, otherwise 'moving'.
   */
  step(dt: number, speed: number): WalkStatus
  /** Leave the crowd for good (a person who walks out of the building or fades away). A solo walker: nothing to do. */
  remove(): void
  /**
   * Mark this person as a fixed obstacle for the others (seated, lying, serving at a desk). A walker with no route is one
   * anyway; `goTo` clears the flag. A solo walker: nothing to do.
   */
  setStatic(on: boolean): void
  /** Body radius in metres (a wider vehicle). A solo walker: nothing to do. */
  setRadius?(radius: number): void
  /**
   * Wave 1: carry a pushed vehicle (a box `halfWidth` x `halfLength` centred `ahead` in front, along the heading), or put it down (null).
   * In a crowd the others avoid its real footprint and the walker looks ahead from it. A solo walker: nothing to do.
   */
  setFootprint?(f: { ahead: number; halfWidth: number; halfLength: number } | null): void
}

class NavWalker implements Walker {
  private readonly f = new PathFollower()
  private readonly here: Vec2 = { x: 0, z: 0 }

  get x(): number {
    return this.f.x
  }
  get z(): number {
    return this.f.z
  }
  get heading(): number {
    return this.f.heading
  }
  get speed(): number {
    return this.f.speed
  }
  goTo(to: Vec2): void {
    this.here.x = this.f.x
    this.here.z = this.f.z
    this.f.setPath(planRoute(this.here, to))
  }

  place(x: number, z: number, heading: number): void {
    this.f.reset(x, z, heading)
  }

  face(heading: number): void {
    this.f.heading = heading
  }

  step(dt: number, speed: number): WalkStatus {
    return this.f.step(dt, speed)
  }

  remove(): void {}

  setStatic(_on: boolean): void {}
}

/** A walker for one person: in `crowd` if given (keep-right and avoidance, see the module comment), else a solo walker. */
export function makeWalker(crowd?: Crowd, opts?: WalkerOptions): Walker {
  return crowd ? crowd.createWalker(opts) : new NavWalker()
}
