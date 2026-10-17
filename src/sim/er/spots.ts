/**
 * Where staff and bystanders stand: fixed posts and the spots around a bay, a chair or a bed. Everything here is
 * checked in tests to be walkable, clear of furniture, and out of every doorway
 * (skill pitfall: nobody idles in a pinch).
 */
import { isWalkable, WALK_ZONES } from '../nav/layout'
import type { SeatSpec, Vec2 } from '../types'

export interface Post {
  at: Vec2
  heading: number
}

/** Heading that faces `to` from `from` (atan2(dx, dz)). */
export function headingTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

const NAV_CLEAR = 0.3

const DOORWAYS = WALK_ZONES.filter((z) => z.kind === 'door')

/** Is the point in (or within `pad` metres of) a doorway? Nobody should idle there. */
export function inDoorway(x: number, z: number, pad = 0.3): boolean {
  for (const d of DOORWAYS) if (x >= d.x0 - pad && x <= d.x1 + pad && z >= d.z0 - pad && z <= d.z1 + pad) return true
  return false
}

// --- fixed posts ---------------------------------------------------------------------------------

/** ER doctors wait here between patients (middle of the ER hall, off the through-routes). */
export const ER_DOCTOR_POSTS: Post[] = [
  { at: { x: -56, z: 11.4 }, heading: Math.PI },
  { at: { x: -50, z: 11.4 }, heading: Math.PI },
]
/** ER nurses wait here. */
export const ER_NURSE_POSTS: Post[] = [
  { at: { x: -56, z: 16.6 }, heading: 0 },
  { at: { x: -50, z: 16.6 }, heading: 0 },
]
/** Triage nurse 1 works bays 0-1, nurse 2 bays 2-3. They wait in the hall in front of their bays. */
export const TRIAGE_NURSE_POSTS: Post[] = [
  { at: { x: -57.4, z: -16.6 }, heading: Math.PI },
  { at: { x: -48.5, z: -16.6 }, heading: Math.PI },
]
export const TRIAGE_NURSE_BAYS: number[][] = [[0, 1], [2, 3]]
/** Where the paramedics wait with the stretcher when every bay is taken. */
export const AMBULANCE_HOLD: Post = { at: { x: -58.6, z: 12.6 }, heading: Math.PI / 2 }
/** Porters wait here, in the lobby beside the spine opening. */
export const PORTER_BASES: Post[] = [
  { at: { x: -46.2, z: -4.6 }, heading: Math.PI },
  { at: { x: -46.2, z: 4.6 }, heading: 0 },
  { at: { x: -47.8, z: -4.9 }, heading: Math.PI },
]
/** Cleaners start their patrol at different points of the loop. */
export interface PatrolStop {
  at: Vec2
  mop: boolean
}
export const PATROL: PatrolStop[] = [
  { at: { x: -48, z: 2 }, mop: true },
  { at: { x: -42, z: -8 }, mop: false },
  { at: { x: -36, z: -14 }, mop: true },
  { at: { x: -4, z: -14 }, mop: false },
  { at: { x: 13.6, z: -14 }, mop: true },
  { at: { x: 30, z: -6 }, mop: true },
  { at: { x: 13.6, z: 14 }, mop: false },
  { at: { x: -4, z: 14 }, mop: true },
  { at: { x: -36, z: 14 }, mop: false },
  { at: { x: -42, z: 8 }, mop: true },
]
/** Linen cart: picked up in the clean supply room, left at one of these corridor spots. */
export const LINEN_PICKUP: Vec2 = { x: -33, z: 18 }
// On the inner side of the corridor centre line (|z| = 13.6), and far enough from the command doors (x = -17) and the meal
// stops (L1, room side, x = -21.4 / -11.4 / 8.6 / 18.6) that neither the cart nor the porter 0.8 m behind it ever stands in
// a doorway or in the way of a parked MealBot.
export const LINEN_DROPS: Vec2[] = [
  { x: -21.0, z: 13.6 },
  { x: 3.0, z: 13.6 },
  { x: -21.0, z: -13.6 },
  { x: 3.0, z: -13.6 },
]

// --- around a seat ---------------------------------------------------------------------------------

export type SeatSide = 'foot' | 'doctor' | 'nurse' | 'companion' | 'lab'

/** Unit vector from the seat towards its approach spot (the way into the bay). */
function inward(seat: SeatSpec): Vec2 {
  const dx = seat.approach.x - seat.x
  const dz = seat.approach.z - seat.z
  const d = Math.hypot(dx, dz)
  return d > 1e-6 ? { x: dx / d, z: dz / d } : { x: Math.sin(seat.heading), z: Math.cos(seat.heading) }
}

/**
 * A standing spot beside a seat: `foot` is the approach itself, `doctor` and `nurse` are 0.85 m to either side of it,
 * `companion` is further out in the hall. Falls back to nearer spots when a candidate is not walkable.
 */
export function seatSpot(seat: SeatSpec, side: SeatSide): Vec2 {
  const u = inward(seat)
  const l = { x: -u.z, z: u.x }
  const a = seat.approach
  const candidates: Vec2[] = []
  const push = (du: number, dl: number) => candidates.push({ x: a.x + u.x * du + l.x * dl, z: a.z + u.z * du + l.z * dl })
  switch (side) {
    case 'doctor':
      push(0.1, 0.85)
      push(0.1, 0.6)
      push(0, -0.85)
      break
    case 'nurse':
      push(0.1, -0.85)
      push(0.1, -0.6)
      push(0, 0.85)
      break
    case 'companion':
      push(1.1, 0.5)
      push(1.1, -0.5)
      push(1.6, 0)
      break
    case 'lab':
      push(0.8, 0.2)
      push(0.8, -0.2)
      break
    default:
      break
  }
  candidates.push({ x: a.x, z: a.z })
  for (const c of candidates) if (isWalkable(c.x, c.z, NAV_CLEAR)) return c
  return { x: a.x, z: a.z }
}

/** Where a caller stands to talk to somebody sitting on `seat`: in front of it, a little further out than the approach. */
export function callSpot(seat: SeatSpec, away = 0.9): Vec2 {
  const u = inward(seat)
  const c = { x: seat.approach.x + u.x * away, z: seat.approach.z + u.z * away }
  return isWalkable(c.x, c.z, NAV_CLEAR) ? c : { x: seat.approach.x, z: seat.approach.z }
}

/** Where the person stands after getting up from a seat, facing away from it. */
export function standHeading(seat: SeatSpec): number {
  const u = inward(seat)
  return Math.atan2(u.x, u.z)
}

/** Window spots in a patient room (visitors who do not get the chair stand here), facing the bed. */
export function windowSpots(room: { rect: { x0: number; x1: number; z0: number; z1: number }; ward: 'A' | 'B'; bed: Vec2 }): Vec2[] {
  const s = room.ward === 'A' ? -1 : 1
  const x0 = room.rect.x0
  return [
    { x: x0 + 3.0, z: s * 19.4 },
    { x: x0 + 2.0, z: s * 19.0 },
  ]
}
