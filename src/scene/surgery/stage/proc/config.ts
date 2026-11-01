/**
 * R5 wave 3 (agent J): what differs between the two procedure rooms' drapes, as numbers (patient frame: `z` along the table toward the feet from the pelvis, `x` across with
 * the table's own +x, `h` above the pad: see mesh.ts).
 *
 *   cryo  the CT cryo suite's table (`scanTable:cryo`, heading +pi/2: the head west, the patient's supine left north where the robot is): a wide sheet from the shoulders to
 *         the feet, shaped over the body, hanging over the table's edges (the table goes into the gantry: the sheet clears the bore's liner, CT.linerIn, at every row); the
 *         window on the left flank (the kidney: the patient on her right side, the flank up) or on the back (the lung and the liver: prone)
 *   us    the ultrasound couch (`usCouch:us`, heading pi: the head south, the patient's left west): a short sheet from the shoulders to the hips with a window over the
 *         left breast; the arm that is up is outside it
 *
 * The window is where the needles go in. Its place is read from the SIM through its public functions (src/sim/procedure `cryoTargetInto` and `usTargetInto`), never from copies of
 * its numbers, so the drapes follow the sim when it moves its points: the CT's `ctField` (the skin window of the case's target) before any needle is planned, and the planned
 * needles' own `needleEntry` points (the sim maps each needle's plan entry and `dz` to the room, per target) once there are some; the couch's `breast`. A room point is carried into
 * the patient's frame by the table's place and heading (`toPatientInto`): the table out for the CT (the patient is drawn on it with the table out, whatever `tablePos` says: the
 * mesh's matrix carries the table's travel), the couch's own place.
 */
import { newCryoTargetCtx, cryoTargetInto, usTargetInto, newUsTargetCtx } from '@/sim/procedure'
import type { CtNeedlePath } from '@/sim/procedure/cryoPlaces'
import { ctSliceInto } from '@/sim/procedure/ctSlice'
import { CRYO_SUITE, IMAGING } from '@/sim/places'
import type { CryoTarget, PatientPosition, Vec3 } from '@/sim/types'

export type RoomId = 'cryo' | 'us'

export interface RoomConfig {
  id: RoomId
  /** The sheet's first and last cross-section (patient frame z), and the widest it ever lies (the sheet's top reaches at most this far to either side). */
  sheetZ0: number
  sheetZ1: number
  sideMax: number
  /** The pad's half width, and where the sheet's hang may start from at the least: just beyond the table's edge (the sheet lies over the pad out to there, then falls). */
  padHalf: number
  hangFrom: number
  /** The lowest the hang goes under the pad's top; a negative `bore` lets the hang clear the CT's liner (radius, about the axis `boreAxis` above the pad). */
  hangBottom: number
  bore: number
  boreAxis: number
}

/** The CT's bore liner (src/scene/imaging/machines/ct.ts `CT.linerIn` and `CT.centreY`, by value: features talk through registries; the test pins them equal). */
export const CT_LINER = 0.38
export const CT_AXIS_ABOVE_PAD = 1.0 - CRYO_SUITE.ct.table.height
/**
 * The CT table's width (ct.ts `buildCtCradle`: a slab CRADLE.width = 0.46 wide with the pad 3 cm in from each edge) and the couch's pad (tools/arch/zones/imaging.py `couch`: 0.68 wide,
 * on a frame 0.70), half widths, by value; the tests pin them to those sources.
 */
export const CT_SLAB_HALF = 0.23
export const CT_PAD_HALF = 0.2
export const COUCH_PAD_HALF = 0.34
export const COUCH_FRAME_HALF = 0.35
/** The sheet hangs this far beyond the table's edge. */
export const HANG_BEYOND = 0.02

export const ROOMS: Readonly<Record<RoomId, RoomConfig>> = {
  cryo: { id: 'cryo', sheetZ0: -0.5, sheetZ1: 0.98, sideMax: 0.3, padHalf: CT_PAD_HALF, hangFrom: CT_SLAB_HALF + HANG_BEYOND, hangBottom: -0.06, bore: CT_LINER - 0.006, boreAxis: CT_AXIS_ABOVE_PAD },
  us: { id: 'us', sheetZ0: -0.46, sheetZ1: 0.42, sideMax: 0.4, padHalf: COUCH_PAD_HALF, hangFrom: COUCH_FRAME_HALF + HANG_BEYOND, hangBottom: -0.2, bore: 0, boreAxis: 0 },
}

/**
 * The window, in the patient frame, as a default: its middle (`zc`, `xc`) and half sizes (`hz` along, `hx` across). The needles' entries (`placeWindow`) widen it and move its
 * middle to what they need.
 */
export interface WindowSpec {
  zc: number
  xc: number
  hz: number
  hx: number
}

export function newWindowSpec(): WindowSpec {
  return { zc: 0, xc: 0, hz: 0.1, hx: 0.1 }
}

// ---------------------------------------------------------------------------------------------
// sim points in the patient's frame
// ---------------------------------------------------------------------------------------------

const TABLE = { cryo: CRYO_SUITE.ct.table.out, us: IMAGING.us.table.in } as const
const HEADING = { cryo: CRYO_SUITE.ct.table.heading, us: IMAGING.us.table.heading } as const
const HC = { cryo: Math.cos(HEADING.cryo), us: Math.cos(HEADING.us) } as const
const HS = { cryo: Math.sin(HEADING.cryo), us: Math.sin(HEADING.us) } as const

const P3: Vec3 = { x: 0, y: 0, z: 0 }
const CT_CTX = newCryoTargetCtx()
const US_CTX = newUsTargetCtx()
const ONE_NEEDLE: CtNeedlePath[] = [{ entry: { x: 0, y: 0 }, dz: 0 }]

/** A room point (sim x, z) as the patient's frame: z along the table toward the feet, x across, relative to the table's own place and heading (the patient's root is the origin). */
export function toPatientInto(room: RoomId, px: number, pz: number, out: Float64Array, o: number): void {
  const t = TABLE[room]
  const dx = px - t.x
  const dz = pz - t.z
  out[o] = dx * HS[room] + dz * HC[room]
  out[o + 1] = dx * HC[room] - dz * HS[room]
}

/** The patient-frame site (z, x) of a case's target field: the CT's `ctField` for `target`, the couch's breast. Written at out[o], out[o + 1]. */
export function fieldSiteInto(room: RoomId, target: CryoTarget, out: Float64Array, o: number): void {
  if (room === 'us') {
    usTargetInto('breast', US_CTX, P3)
  } else {
    CT_CTX.tablePos = 0
    CT_CTX.target = target
    CT_CTX.needle = -1
    CT_CTX.needles = ONE_NEEDLE
    cryoTargetInto('ctField', CT_CTX, P3)
  }
  toPatientInto(room, P3.x, P3.z, out, o)
}

/**
 * The patient-frame site (z, x) of a CT needle's skin entry: the sim's `needleEntry` point for this needle of `target`'s case, which is the plan's `entry` and `dz` seen through
 * the patient's roll (src/sim/procedure/ctSlice.ts: the one map the sim, the robot's arm and this window share), with the table out (the stage's matrix carries the table's
 * travel). Written at out[o], out[o + 1].
 */
export function siteOfNeedle(target: CryoTarget, needle: CtNeedlePath, out: Float64Array, o: number): void {
  ctSliceInto(target, 0, needle.entry.x, needle.entry.y, needle.dz, P3)
  toPatientInto('cryo', P3.x, P3.z, out, o)
}

const SITE = new Float64Array(2)

/**
 * The window of a room for the case's `target` and the patient's position, as a default (written into `out`): the target field's middle with half sizes a procedure needs: a hand's
 * breadth or more each way. The kidney's (the patient on her right side, the flank up) is smaller than the back's (face down); the couch's the breast's.
 */
export function windowInto(room: RoomId, position: PatientPosition, target: CryoTarget, out: WindowSpec): WindowSpec {
  fieldSiteInto(room, target, SITE, 0)
  out.zc = SITE[0]
  out.xc = SITE[1]
  if (room === 'us') {
    out.hz = 0.12
    out.hx = 0.13
  } else if (position === 'obliqueLeftUp') {
    out.hz = 0.16
    out.hx = 0.12
  } else {
    // face down (and the face-up patient before the turn: the window waits where the back will be)
    out.hz = 0.18
    out.hx = 0.17
  }
  return out
}

/** `windowInto` into a new object (the tests', and anything off the frame path). */
export function windowOf(room: RoomId, position: PatientPosition, target: CryoTarget = 'kidney'): WindowSpec {
  return windowInto(room, position, target, newWindowSpec())
}
