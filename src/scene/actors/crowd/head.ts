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
import { CRYO_SUITE, IMAGING, groundHeightAt } from '@/sim/places'
import { DEFAULT_SEAT_HEIGHT, LIE, LIE_RECLINE_LIFT_MAX, MIN_SEAT_HEIGHT, SEATED_CROWN, SEATED_HEAD_CENTRE, STAND_CROWN, STAND_HEAD_CENTRE, STAND_PELVIS, BODY } from './constants'
import { postureOf, type Posture } from './blend'
import { scaleFor } from './outfit'
import { BACKREST, MATTRESS } from '@/scene/rooms/bedParts'
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
 * (then the seat height defaults: 0.45 chair, 0.5 wheelchair; lying 0.49 ward bed, 0.44 ER trolley, 0.79 stretcher, the imaging tables at their own
 * heights, the surgery suite's trolleys (0.8) and OR table (0.88): the real mattress and table tops, see LIE and `lieSurfaceOf`)
 * or already the surface (then the floor is `groundHeightAt`, and the surface is the difference). A seat is never drawn lower than 0.45 m.
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
    const fallback = e.riding && e.vehicle === 'stretcher' ? LIE.stretcher : lieSurfaceOf(e.seated?.seatId)
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

/** Seat ids of the trolley beds of the ER bays (`erBay:bay:3`) and of the ward beds (`bed:A3`). */
const ER_BED_SEAT = 'erBay:'
const WARD_BED_SEAT = 'bed:'
/** R2: the pre-op and recovery trolleys of level 2 (`surgeryBed:preop:0`, `surgeryBed:pacu:2`) and the OR table (`orTable:0`). */
const SURGERY_BED_SEAT = 'surgeryBed:'
const OR_TABLE_SEAT = 'orTable:'

/** The top of each imaging table or couch a patient lies on, by seat id (rooms/imaging.ts: the seat's height is the table's `IMAGING[...].table.height`). */
const IMAGING_SEAT_SURFACE: ReadonlyMap<string, number> = new Map([
  ['scanTable:mri', IMAGING.mri.table.height],
  ['scanTable:ct', IMAGING.ct.table.height],
  ['xrayTable:xray', IMAGING.xray.table.height],
  ['usCouch:us', IMAGING.us.table.height],
  ['scanTable:cryo', CRYO_SUITE.ct.table.height], // R4: the cryoablation suite's CT table
])

/**
 * The top of the mattress, pad or table a lying person at seat `seatId` rests on, when the sim gives only the floor: an ER trolley, a scanner table, an
 * X-ray table or an ultrasound couch by their own heights, any other bed (the wards) 0.49 m, the mattress top.
 */
export function lieSurfaceOf(seatId: string | undefined): number {
  if (seatId === undefined) return LIE.bed
  if (seatId.startsWith(ER_BED_SEAT)) return LIE.trolley
  if (seatId.startsWith(SURGERY_BED_SEAT)) return LIE.surgeryBed
  // (the OR table's own top: places.ts SURGERY.table.height, which the layout builds the table to)
  if (seatId.startsWith(OR_TABLE_SEAT)) return LIE.orTable
  return IMAGING_SEAT_SURFACE.get(seatId) ?? LIE.bed
}

/**
 * Whether a lying person is in a bed that has a blanket for them: a ward bed, an ER bay trolley, a pre-op or recovery trolley of level 2 or a stretcher (a porter
 * pushes it or it stands where it was left). Somebody on a scanner table, an X-ray table, an ultrasound couch or the OR table lies bare (the OR table's
 * surgical drape is the theatre's own: scene/surgery).
 */
export function inBlanketBed(e: Pick<Entity, 'seated' | 'riding' | 'vehicle'>): boolean {
  if (e.riding === true && e.vehicle === 'stretcher') return true
  const id = e.seated?.seatId
  return id !== undefined && (id.startsWith(WARD_BED_SEAT) || id.startsWith(ER_BED_SEAT) || id.startsWith(SURGERY_BED_SEAT))
}

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
    // the backrest turns about a hinge a little below the back, so the rig rides the pelvis and all above it up by (a pelvis's height above the
    // mattress + the hinge's depth) * (1 - cos phi) / cos phi, at most LIE_RECLINE_LIFT_MAX: here for the procedural body (an avatar lies a little higher,
    // so its lift is a few cm more, up to the limit)
    const lift = Math.min(LIE_RECLINE_LIFT_MAX, ((LIE.pelvisAbove + (MATTRESS.top - BACKREST.hingeY)) * (1 - Math.cos(phi))) / Math.cos(phi))
    const back = BODY.waist * k + torso * Math.cos(phi)
    out.x -= Math.sin(e.heading) * back
    out.z -= Math.cos(e.heading) * back
    out.y = lv.floorY + lv.surface + LIE.pelvisAbove + 0.1 * k + torso * Math.sin(phi) + lift
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
