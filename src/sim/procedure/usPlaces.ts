/**
 * R5 wave 3: the ultrasound room's anchors, targets and camera foci for a ProSense cryoablation (./targets.ts delegates every `us*` anchor,
 * every ultrasound target and the ultrasound foci here). The room (IMAGING.us, places.ts, level 1): the couch, the ultrasound cart east of it,
 * the liquid-nitrogen console west of its head end. The patient lies on her back with the treated side's arm raised (`PatientArms` 'oneUp').
 *
 * The couch's heading is pi (facing north), so the head lies SOUTH of the body centre (+z) and the patient's left is WEST (-x). The treated
 * breast is the patient's LEFT one (`IMAGING.us.procedure.side`): the radiologist works from the west, where the console is, and the ultrasound
 * cart is across the couch, so the picture is in front of her and the patient both. `UsTargetCtx.side` is read for the breast point; the spots
 * are fixed to the west side (the baked room has the console there).
 *
 * Everything writes into preallocated objects: nothing allocates per frame.
 */
import { IMAGING, type Spot, type UsProcedureSpots } from '../places'
import type { FocusId, ProcAnchor, ProcTarget, Vec3 } from '../types'

export type UsAnchor = Extract<ProcAnchor, `us${string}`>
export type UsTargetId = Extract<ProcTarget, 'breast' | 'usFace' | 'usScreen' | 'prosenseScreen'>
export type UsFocus = Extract<FocusId, 'usScreen' | 'breast' | 'usRoom' | 'prosenseConsole'>

/** What ultrasound targets depend on at a moment (part of the engine's `TargetCtx`, field `us`). */
export interface UsTargetCtx {
  /** The treated breast: the patient's left or right. */
  side: 'left' | 'right'
}

const US = IMAGING.us
/** The ProSense places (always present on the ultrasound room). */
export const US_PROCEDURE: UsProcedureSpots = US.procedure!

export function newUsTargetCtx(): UsTargetCtx {
  return { side: US_PROCEDURE.side }
}

/** The spot of an ultrasound anchor (a shared object from places.ts: read it, never change it). */
export function usAnchorSpot(anchor: UsAnchor): Spot {
  switch (anchor) {
    case 'usDoctor':
      return US_PROCEDURE.doctor
    case 'usConsole':
      return US_PROCEDURE.console
    case 'usHead':
      return US_PROCEDURE.head
    case 'usDoor':
      return US_PROCEDURE.door
  }
}

function at(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

/** How far the face is from the body centre toward the head (m): the head lies at the couch's south end. */
const FACE_TO_HEAD = 0.7

/** Write the world point of an ultrasound target into `out` (and return it). */
export function usTargetInto(target: UsTargetId, ctx: UsTargetCtx, out: Vec3): Vec3 {
  const t = US.table
  const b = US_PROCEDURE.breast
  switch (target) {
    case 'breast':
      // the head is +z, so the patient's left is -x (west)
      return at(out, t.in.x + (ctx.side === 'left' ? -b.across : b.across), t.height + b.above, t.in.z + b.toHead)
    case 'usFace':
      return at(out, t.in.x, t.height + 0.2, t.in.z + FACE_TO_HEAD)
    case 'usScreen':
      return at(out, US.machine.x, US_PROCEDURE.usScreenHeight, US.machine.z)
    case 'prosenseScreen':
      // the console's screen is on its north face (the console is 0.76 m deep); the hands work its east side, where the sonographer stands
      return at(out, US_PROCEDURE.prosense.at.x + US_PROCEDURE.prosense.screenEast, US_PROCEDURE.prosense.screenHeight, US_PROCEDURE.prosense.at.z - 0.38)
  }
}

/** The point the watch camera frames for an ultrasound focus (sim frame). */
export function usFocusInto(focus: UsFocus, ctx: UsTargetCtx, out: Vec3): Vec3 {
  switch (focus) {
    case 'breast':
      return usTargetInto('breast', ctx, out)
    case 'usScreen':
      return usTargetInto('usScreen', ctx, out)
    case 'prosenseConsole':
      return usTargetInto('prosenseScreen', ctx, out)
    case 'usRoom': {
      // the middle of the couch, a little above it: the patient, the radiologist and the sonographer round her
      const t = US.table
      out.x = t.in.x
      out.y = t.height + 0.2
      out.z = t.in.z
      return out
    }
  }
}
