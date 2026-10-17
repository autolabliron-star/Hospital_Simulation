/**
 * How far each ward bed's head is raised, as the scene shows it (L1). One tiny registry between two features that must agree
 * to the centimetre: the bed layer (src/scene/meals/ward) tilts the backrest, and the crowd raises a reclined patient's torso
 * to match (src/scene/actors/crowd), and the emote and speech anchors follow the head (src/scene/fx/headAnchor.ts).
 *
 * The sim says `RoomStatus.recline` (0 = flat, 1 = about 45 degrees) and poses the patient `seated.pose === 'recline'`. The bed
 * layer smooths the sim's number and writes the smoothed value here every frame; the crowd reads it back, so the torso and the
 * backrest are never out of step. When nothing drives the registry (the bed layer is not mounted, or `sim.life` is absent) the
 * pose alone decides: 'recline' is fully raised and everything else is flat.
 *
 * Pure (no three.js, no React): the maths is unit tested in node.
 */
import { ROOMS } from '@/sim/places'
import type { SeatPose } from '@/sim/types'

/** The backrest angle at recline = 1 (the bed head fully raised). */
export const RECLINE_MAX = Math.PI / 4

/** Room index (0..15, in `ROOMS` order) by room id and by bed seat id (`bed:A3`). */
const ROOM_INDEX = new Map<string, number>(ROOMS.map((r, i) => [r.id, i]))
const SEAT_INDEX = new Map<string, number>(ROOMS.map((r, i) => [`bed:${r.id}`, i]))

/** The smoothed recline of each room, or -1 when nothing drives it. */
const shown = new Float32Array(ROOMS.length).fill(-1)

export function roomIndex(roomId: string): number {
  return ROOM_INDEX.get(roomId) ?? -1
}

/** The bed layer writes the value it draws. */
export function setReclineShown(index: number, recline: number): void {
  if (index >= 0 && index < shown.length) shown[index] = recline
}

/** The value drawn for a room, or -1 when the bed layer is not driving it. */
export function reclineShown(roomId: string): number {
  const i = ROOM_INDEX.get(roomId)
  return i === undefined ? -1 : shown[i]
}

/** Forget every value (the bed layer unmounted, or a Jump rebuilt the hospital). */
export function clearReclineShown(): void {
  shown.fill(-1)
}

/** What the entity's seat says: `seated.pose === 'recline'` is fully raised, anything else flat. */
function byPose(pose: SeatPose): number {
  return pose === 'recline' ? 1 : 0
}

/**
 * How far the torso of a person in a bed is raised, 0..1. A patient in a ward bed follows the backrest that is drawn (even
 * while the bed head is being lowered and the pose has already gone back to 'lie'); anyone else follows their seat pose.
 */
export function reclineOfEntity(e: { seated?: { seatId: string; pose: SeatPose } }): number {
  const seat = e.seated
  if (!seat) return 0
  const i = SEAT_INDEX.get(seat.seatId)
  if (i !== undefined) {
    const v = shown[i]
    if (v >= 0) return v
  }
  return byPose(seat.pose)
}

/** The torso's angle above flat for a recline value (radians). */
export function reclineAngle(recline: number): number {
  return (recline < 0 ? 0 : recline > 1 ? 1 : recline) * RECLINE_MAX
}
