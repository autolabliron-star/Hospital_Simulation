/**
 * Where "above this person's head" is, for every layer that floats something over a person (emote icons, speech
 * bubbles). One function, so they all agree and stack instead of overlapping.
 *
 * The anchor is the point just above the head where the bottom of an icon (or the tail tip of a speech bubble) sits:
 *   standing  2.05 m  (the crown is at 1.75 m)
 *   seated    1.45 m  (the crown is at about 1.4 m on a chair; a wheelchair rider counts as seated)
 *   lying     1.20 m  (head on the pillow, about 0.8 m up), shifted along the body to the pillow end
 *   reclined  (L1) the bed head is raised by phi: the head is TORSO sin(phi) higher and TORSO (1 - cos(phi)) nearer the hips
 * Heights are metres above `entity.position.y`, which the sim keeps at ground level (floor-relative on level 2 too: the anchor is a SIM point, and
 * whoever draws it maps it with `toDisplayInto`, src/sim/levels.ts). R2: a lying patient on a surgery trolley (mattress 0.8 m) or the OR table (0.88 m)
 * is higher than one in a ward bed (0.49 m): the anchor rides up by the difference, as it does for a stretcher.
 */
import type { Entity, Vec3 } from '@/sim/types'
import { LIE } from '@/scene/actors/crowd/constants'
import { lieSurfaceOf } from '@/scene/actors/crowd/head'
import { reclineAngle, reclineOfEntity } from '@/scene/rooms/bedPose'

export type HeadPose = 'stand' | 'sit' | 'lie'

/** W3: lying heights follow the real mattress tops (a ward bed's is 0.49 m, crowd constants LIE.bed), 13 cm lower than before. */
export const HEAD_Y: Record<HeadPose, number> = { stand: 2.05, sit: 1.45, lie: 1.07 }
/** A stretcher's mattress is 0.30 m higher than a ward bed's (0.79 m against 0.49 m). */
export const STRETCHER_LIFT = 0.3
/**
 * How far the head is from the body's centre when lying. The contract's heading runs head to feet (`RoomSpec.bedHeading`),
 * so the head end is behind the centre; 0.75 m is where `RoomSpec.pillow` sits relative to `RoomSpec.bed`.
 */
export const LIE_HEAD_OFFSET = 0.75
/** Waist joint to the head centre (neck plus half a head): the part of a lying body that turns up when the bed head is raised. */
export const LIE_TORSO = 0.6

/** The entity fields the anchor reads. */
export type AnchorSource = Pick<Entity, 'position' | 'heading' | 'anim'> &
  Partial<Pick<Entity, 'seated' | 'riding' | 'vehicle'>>

/** Which of the three poses this entity is in. A rider counts by their vehicle, everyone else by `anim` or their seat. */
export function headPose(e: Pick<Entity, 'anim'> & Partial<Pick<Entity, 'seated' | 'riding' | 'vehicle'>>): HeadPose {
  if (e.riding) {
    if (e.vehicle === 'stretcher') return 'lie'
    if (e.vehicle === 'wheelchair') return 'sit'
  }
  if (e.anim === 'lie' || e.seated?.pose === 'lie' || e.seated?.pose === 'recline') return 'lie'
  if (e.anim === 'sit' || e.seated?.pose === 'sit') return 'sit'
  return 'stand'
}

/** R2: the pre-op and recovery trolleys and the OR table of level 2 (`surgeryBed:preop:0`, `orTable:0`). */
function isSurgerySeat(seatId: string): boolean {
  return seatId.startsWith('surgeryBed:') || seatId.startsWith('orTable:')
}

/** Writes the world position of the anchor into `out` (no allocation) and returns the pose. */
export function headAnchor(e: AnchorSource, out: Vec3): HeadPose {
  const pose = headPose(e)
  let y = e.position.y + HEAD_Y[pose]
  let x = e.position.x
  let z = e.position.z
  if (pose === 'lie') {
    const phi = reclineAngle(reclineOfEntity(e))
    const offset = LIE_HEAD_OFFSET - LIE_TORSO * (1 - Math.cos(phi))
    x -= Math.sin(e.heading) * offset
    z -= Math.cos(e.heading) * offset
    y += LIE_TORSO * Math.sin(phi)
    if (e.riding && e.vehicle === 'stretcher') y += STRETCHER_LIFT
    else if (e.seated !== undefined && isSurgerySeat(e.seated.seatId)) y += lieSurfaceOf(e.seated.seatId) - LIE.bed
  }
  out.x = x
  out.y = y
  out.z = z
  return pose
}
