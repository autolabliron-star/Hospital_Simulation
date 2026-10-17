// Ported from Waltz City (src/scene/actors/crowd/head.ts); the heights now follow the hospital's sit and lie postures.
/**
 * Where a person's head is, for anything that puts something over it (emotes, speech bubbles, the follow camera).
 * Same numbers the renderer uses, to the millimetre.
 *
 * Heights are above the ground for a standing person, above the seat surface for a seated one, for a person of
 * nominal size; real people are scaled by `scaleFor(id, variant)` (0.94 to 1.06).
 *
 *   standing   head centre 1.63 m    crown (top of the head) 1.745 m
 *   seated     head centre 0.82 m    crown 0.94 m        (above the seat surface)
 *   lying      head centre 0.72 m behind the hips along the bed, about 0.1 m above the mattress
 *   reclined   (L1, a ward bed with the head raised by phi) the torso above the waist turns up by phi: the head centre is
 *              0.1 + 0.6 sin(phi) m above the hips' plane and 0.1 + 0.6 cos(phi) m behind the hips
 */
import type { Entity, Vec3 } from '@/sim/types'
import { groundHeightAt } from '@/sim/places'
import { DEFAULT_SEAT_HEIGHT, LIE, MIN_SEAT_HEIGHT, SEATED_CROWN, SEATED_HEAD_CENTRE, STAND_CROWN, STAND_HEAD_CENTRE, STAND_PELVIS, BODY } from './constants'
import { postureOf, type Posture } from './blend'
import { scaleFor } from './outfit'
import { reclineAngle, reclineOfEntity } from '@/scene/rooms/bedPose'

export { SEATED_CROWN, SEATED_HEAD_CENTRE, STAND_CROWN, STAND_HEAD_CENTRE }
/** Convenience alias: the standing head height the sim's look-at targets assume. */
export const HEAD_HEIGHT = STAND_HEAD_CENTRE

/** Where an entity's body is: its posture, the floor under it, and the seat or mattress surface above that floor. */
export interface Levels {
  posture: Posture
  floorY: number
  /** Seat surface (sit) or mattress (lie) above the floor; 0 when standing. */
  surface: number
}

/**
 * Read the posture and heights of an entity. The sim puts a seated or lying person at the seat or bed; `position.y` may be the floor
 * (then the seat height defaults: 0.45 chair, 0.5 wheelchair, 0.62 bed, 0.85 stretcher) or already the surface (then the floor is
 * `groundHeightAt`, and the surface is the difference). A seat is never drawn lower than 0.45 m.
 */
export function levelsOf(e: Entity, out: Levels): Levels {
  const posture = postureOf(e.anim, e.seated?.pose, e.riding === true, e.vehicle)
  out.posture = posture
  if (posture === 'stand') {
    out.floorY = e.position.y
    out.surface = 0
    return out
  }
  const ground = groundHeightAt(e.position.x, e.position.z)
  const rel = e.position.y - ground
  if (posture === 'sit') {
    const fallback = e.riding && e.vehicle === 'wheelchair' ? LIE.wheelchairSeat : DEFAULT_SEAT_HEIGHT
    if (rel > 0.2) {
      out.floorY = ground
      out.surface = Math.max(MIN_SEAT_HEIGHT, rel)
    } else {
      out.floorY = e.position.y
      out.surface = Math.max(MIN_SEAT_HEIGHT, fallback)
    }
  } else {
    const fallback = e.riding && e.vehicle === 'stretcher' ? LIE.stretcher : LIE.bed
    if (rel > 0.3) {
      out.floorY = ground
      out.surface = rel
    } else {
      out.floorY = e.position.y
      out.surface = fallback
    }
  }
  return out
}

const _lv: Levels = { posture: 'stand', floorY: 0, surface: 0 }

/** Size factor of a person relative to the nominal body. */
export function sizeOf(e: Entity): number {
  return scaleFor(e.id, e.variant)
}

/** The centre of the head of an entity. Writes into `out` and returns it. */
export function headPosition<T extends Vec3>(e: Entity, out: T): T {
  const k = sizeOf(e)
  const lv = levelsOf(e, _lv)
  out.x = e.position.x
  out.z = e.position.z
  if (lv.posture === 'stand') out.y = lv.floorY + STAND_HEAD_CENTRE * k
  else if (lv.posture === 'sit') out.y = lv.floorY + lv.surface + SEATED_HEAD_CENTRE * k
  else {
    // flat on the back, head towards the back of the heading: 0.72 m from the hips, resting on the pillow; with the bed head
    // raised the part above the waist turns up about the waist joint
    const phi = reclineAngle(reclineOfEntity(e))
    const torso = (BODY.neck + BODY.headCentre) * k
    const back = BODY.waist * k + torso * Math.cos(phi)
    out.x -= Math.sin(e.heading) * back
    out.z -= Math.cos(e.heading) * back
    out.y = lv.floorY + lv.surface + LIE.pelvisAbove + 0.1 * k + torso * Math.sin(phi)
  }
  return out
}

/** The top of the head: put a bubble a hand's width above this. */
export function crownPosition<T extends Vec3>(e: Entity, out: T): T {
  const k = sizeOf(e)
  headPosition(e, out)
  const lv = _lv.posture
  if (lv === 'stand') out.y += (STAND_CROWN - STAND_HEAD_CENTRE) * k
  else if (lv === 'sit') out.y += (SEATED_CROWN - SEATED_HEAD_CENTRE) * k
  else out.y += (BODY.crown - BODY.headCentre) * k * Math.cos(reclineAngle(reclineOfEntity(e))) + 0.04
  return out
}

/** Pelvis height of a relaxed standing person of nominal size (for tests and labels). */
export const PELVIS_HEIGHT = STAND_PELVIS
