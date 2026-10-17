/**
 * Sitting down (W1): E at a free chair, sofa, bench seat or café stool. You claim the seat in the seat registry (so nobody else is
 * sent to it), glide onto it in half a second and your avatar is drawn seated by the crowd, like anybody else in the waiting
 * rows. Any move key, E again, Tab or a Jump stands you up.
 *
 * While you sit, `step` re-asserts the seated pose of your avatar every frame, after the player system has written its own
 * (`sim.movePlayer` sets the walking or idle animation). The player system keeps the camera on you: `place` (the player's
 * `placePlayer`) puts its own idea of where you are on the seat, and back in front of it when you stand up, so the camera never
 * looks at an empty spot and you never pop back to where you stood. `SeatSession` is plain state with no React, and `step`
 * allocates nothing.
 */
import type { Simulation } from '@/sim/Simulation'
import type { Entity, SeatSpec } from '@/sim/types'

/** Your id in the seat registry (and the entity id of your avatar). */
export const PLAYER_ID = 'player'

/** The glide from where you stand onto the seat. */
export const SIT_SLIDE_SECONDS = 0.5

export interface Pose {
  x: number
  z: number
  heading: number
}

const TAU = Math.PI * 2

/** A smooth 0..1 ease (smoothstep). */
export function ease(k: number): number {
  const t = k < 0 ? 0 : k > 1 ? 1 : k
  return t * t * (3 - 2 * t)
}

/** The pose a fraction `k` of the way from `from` to `to`, turning the short way round. Writes into `out`. */
export function slidePose(from: Pose, to: Pose, k: number, out: Pose): Pose {
  const e = ease(k)
  out.x = from.x + (to.x - from.x) * e
  out.z = from.z + (to.z - from.z) * e
  let d = (to.heading - from.heading) % TAU
  if (d > Math.PI) d -= TAU
  else if (d < -Math.PI) d += TAU
  out.heading = from.heading + d * e
  return out
}

/** The way you face when you stand up: away from the seat, towards the spot in front of it. */
export function standHeading(seat: SeatSpec): number {
  return Math.atan2(seat.approach.x - seat.x, seat.approach.z - seat.z)
}

/** Moves the player system's own position (the walk camera follows it). `placePlayer` in src/scene/player/api.ts. */
export type PlaceFn = (x: number, z: number, heading: number) => void

export class SeatSession {
  constructor(private readonly place: PlaceFn = () => undefined) {}

  private seat: SeatSpec | null = null
  private t = 0
  private readonly from: Pose = { x: 0, z: 0, heading: 0 }
  private readonly to: Pose = { x: 0, z: 0, heading: 0 }
  private readonly at: Pose = { x: 0, z: 0, heading: 0 }
  private seated: NonNullable<Entity['seated']> | null = null

  /** The seat you are on, or null. */
  get active(): SeatSpec | null {
    return this.seat
  }

  /** Take the seat. False if you are not in the hospital or somebody else holds it. */
  sit(sim: Simulation, seat: SeatSpec): boolean {
    const me = sim.player
    if (!me) return false
    if (this.seat) this.stand(sim)
    if (!sim.seats.claimId(seat.id, PLAYER_ID)) return false
    this.seat = seat
    this.t = 0
    this.from.x = me.x
    this.from.z = me.z
    this.from.heading = me.heading
    this.to.x = seat.x
    this.to.z = seat.z
    this.to.heading = seat.heading
    this.seated = { seatId: seat.id, pose: seat.pose }
    this.place(seat.x, seat.z, seat.heading)
    return true
  }

  /** Per frame while seated: glide onto the seat, then stay, drawn seated. */
  step(sim: Simulation, dt: number): void {
    const seat = this.seat
    if (!seat) return
    this.t += dt
    const p = slidePose(this.from, this.to, this.t / SIT_SLIDE_SECONDS, this.at)
    sim.movePlayer(p.x, p.z, p.heading, 0)
    const av = sim.playerAvatar
    if (av) {
      av.anim = 'sit'
      av.seated = this.seated ?? undefined
      av.speed = 0
    }
  }

  /** Stand up in front of the seat. Returns the seat you left, or null if you were not seated. */
  stand(sim: Simulation): SeatSpec | null {
    const seat = this.seat
    if (!seat) return null
    this.seat = null
    this.seated = null
    sim.seats.release(seat.id, PLAYER_ID)
    const av = sim.playerAvatar
    if (av) {
      av.seated = undefined
      av.anim = 'idle'
    }
    const h = standHeading(seat)
    this.place(seat.approach.x, seat.approach.z, h)
    sim.movePlayer(seat.approach.x, seat.approach.z, h, 0)
    return seat
  }

  /** Let go without touching the hospital: a Jump has replaced it, and the new one never saw you sit. */
  forget(): void {
    this.seat = null
    this.seated = null
  }
}
