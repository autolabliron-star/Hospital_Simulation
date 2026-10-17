/**
 * Where the bed-flow people stand inside a ward room. Every spot is inside its room, clear of the doorway and the
 * furniture (checked in beds.spots.test.ts), so nobody idles in a pinch.
 *
 *   room (ward B shown; ward A is mirrored in z; the corridor is at the top):
 *        door
 *   +----[  ]----------------+
 *   | cleaner/doctor spot ->  |  H0  bedside: where doctors and the cleaner stand, facing the bed
 *   |                  bed    |
 *   | H1  stretcher / linen / |  H1  1.1 m further in: the porter's spot with a stretcher, wheelchair or linen cart
 *   |     wheelchair spot     |
 *   |       bathroom door spot|  the pod is in the window corner; patients fade in and out here
 *   +-------------------------+
 */
import { HANDOVER, roomById, wardSign, type Spot } from '../places'
import type { RoomId, Vec2 } from '../types'

/** Doctor's and cleaner's spot by the bed (inside the room, on the door side of the bed). */
export function bedsideSpot(roomId: RoomId): Spot {
  return HANDOVER[roomId][0]
}

/**
 * The porter's spot with a stretcher, a wheelchair or a linen cart, facing the corridor wall so that the vehicle (0.8 m
 * for a wheelchair and cart, 1.45 m for a stretcher, ahead of the porter) lies along the bed, a hand's breadth from it.
 */
export function porterSpot(roomId: RoomId): Spot {
  const r = roomById(roomId)
  return { at: HANDOVER[roomId][1].at, heading: r.ward === 'A' ? 0 : Math.PI }
}

/** The porter's spot with the linen cart: the cart stands at the foot of the bed (facing east, along the room). */
export function linenSpot(roomId: RoomId): Spot {
  return { at: HANDOVER[roomId][1].at, heading: Math.PI / 2 }
}

/** Where a patient waits for the wheelchair: where its seat will be (0.8 m ahead of the porter). */
export function chairSpot(roomId: RoomId): Vec2 {
  const p = porterSpot(roomId)
  return { x: p.at.x + Math.sin(p.heading) * 0.8, z: p.at.z + Math.cos(p.heading) * 0.8 }
}

/** The bathroom pod's door (in the window corner): a patient walks here, fades out, and comes back dressed. */
export function bathroomSpot(roomId: RoomId): Spot {
  const r = roomById(roomId)
  const s = wardSign(r.ward)
  const at = { x: r.rect.x0 + 3.3, z: s * 20.3 }
  // the pod's door faces west, a little further along the window wall
  return { at, heading: Math.atan2(0.5, s * 0.7) }
}

/** A family member's standing spot when the visitor chair and both window spots are taken. */
export function familyFallbackSpot(roomId: RoomId): Vec2 {
  const r = roomById(roomId)
  const s = wardSign(r.ward)
  return { x: r.rect.x0 + 1.6, z: s * 19.6 }
}
